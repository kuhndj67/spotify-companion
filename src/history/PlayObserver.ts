/**
 * Segments the poll stream into plays and persists them (BR-1, BR-3).
 *
 * ## It consumes `tick`, never `change`
 *
 * `NowPlayingService` emits both. `change` is signature-suppressed and the signature
 * deliberately excludes progress, so the UI is not spammed by a moving progress bar.
 *
 * **Consuming `change` here would be a silent, serious defect.** The observation trail would
 * contain only the samples where something *else* changed — losing precisely the progress data
 * the classifier depends on. Verdicts would still be produced. They would simply be wrong, and
 * the error would stay invisible until someone tried to analyse months of history.
 *
 * ## It decides where a play ends, not what it meant
 *
 * Segmentation is here; judgement lives in the pure classifier. This module is deliberately thin.
 *
 * ## There is no backward-jump branch
 *
 * Backward progress on the same track simply continues the play. Rewinding adds listening time,
 * which raises the ratio by itself, so the replay-versus-rewind question — once the hardest
 * disambiguation in this unit — no longer exists.
 *
 * Consequence worth knowing: a track played twice in a row is **one** record with a ratio near
 * 2.0, not two records.
 */

import type { HistoryRepository } from './HistoryRepository.js';
import { CLASSIFIER_VERSION, classify, summarise } from './outcomeClassifier.js';
import type {
  ClassifierTolerances,
  CloseReason,
  NewPlayRecord,
  Observation,
} from './types.js';

/** The subset of a snapshot this module needs. Keeps it independent of the UI payload shape. */
export interface PlaybackSample {
  trackId: string;
  title: string;
  artistName: string;
  albumName: string;
  progressMs: number;
  durationMs: number;
  isPlaying: boolean;
  isrc: string | null;
  artistId: string | null;
  releaseDate: string | null;
  ageYears: number | null;
  following: boolean | null;
  contextType: string | null;
  /** U4, schema v5. See the note on `PlayRecord.explicit` — null is unknown, never `false`. */
  explicit: boolean | null;
  albumType: string | null;
}

interface InProgressPlay {
  sample: PlaybackSample;
  trail: Observation[];
  startedAtMs: number;
}

/**
 * A stuck play — same track, never advancing, never ending — would otherwise grow the buffer
 * without bound. Beyond this many samples the trail is thinned by dropping every other interior
 * observation, which preserves shape while bounding memory.
 */
const MAX_TRAIL = 4000;

/**
 * Optional hooks for units built on top of recording (U2).
 *
 * Both are **fire-and-forget and individually guarded**: recording must never be affected by
 * whatever a hook does. `onPlayStarted` exists because liked state is point-in-time — BR-9.1's
 * `likedAtStart` cannot be recovered once the play has begun, unlike an observation trail.
 */
export interface PlayObserverHooks {
  onPlayStarted?(sample: PlaybackSample): void;
  onPlayRecorded?(playId: number, record: NewPlayRecord): void;
}

export class PlayObserver {
  #repo: HistoryRepository;
  #tolerances: ClassifierTolerances;
  #hooks: PlayObserverHooks;
  #current: InProgressPlay | null = null;
  #degraded = false;
  #recorded = 0;
  #gaps = 0;
  #lastRecordedAt: string | null = null;

  constructor(
    repo: HistoryRepository,
    tolerances: ClassifierTolerances,
    hooks: PlayObserverHooks = {},
  ) {
    this.#repo = repo;
    this.#tolerances = tolerances;
    this.#hooks = hooks;
  }

  /**
   * Run a hook without letting it affect recording.
   *
   * U1 works whether or not U2 exists, and a throw from label enrichment must not cost a play
   * record — the same containment that keeps history from affecting the display.
   */
  #safely(what: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      console.error(`[history] ${what} hook failed:`, error);
    }
  }

  get stats(): {
    recorded: number;
    gaps: number;
    degraded: boolean;
    lastRecordedAt: string | null;
    inProgressTrackId: string | null;
  } {
    return {
      recorded: this.#recorded,
      gaps: this.#gaps,
      degraded: this.#degraded,
      lastRecordedAt: this.#lastRecordedAt,
      inProgressTrackId: this.#current?.sample.trackId ?? null,
    };
  }

  /** Call on every poll, including unchanged ones. `null` means nothing is playing. */
  observe(sample: PlaybackSample | null, atMs: number): void {
    if (sample === null) {
      // Nothing playing. Whether the last sample was paused distinguishes "walked away
      // mid-track" from "playback stopped" — both classify as unknown, but the distinction is
      // worth keeping in the evidence.
      const paused = this.#current?.trail.at(-1)?.isPlaying === false;
      this.#close(paused ? 'pause-idle' : 'playback-stopped');
      return;
    }

    if (this.#current && this.#current.sample.trackId !== sample.trackId) {
      this.#close('track-change');
    }

    if (!this.#current) {
      this.#current = { sample, trail: [], startedAtMs: atMs };
      // BR-9.1 — liked state is point-in-time and cannot be recovered once the play is under
      // way, unlike an observation trail. It has to be sampled here or not at all.
      this.#safely('onPlayStarted', () => this.#hooks.onPlayStarted?.(sample));
    } else {
      // Refresh the metadata: enrichment usually lands a moment after the track starts, so the
      // first sample of a play often has null isrc/following that later samples carry.
      this.#current.sample = sample;
    }

    this.#current.trail.push({
      atMs,
      trackId: sample.trackId,
      progressMs: Math.max(0, sample.progressMs),
      durationMs: Math.max(0, sample.durationMs),
      isPlaying: sample.isPlaying,
    });

    if (this.#current.trail.length > MAX_TRAIL) this.#thin();
  }

  /** Flush the in-progress play on shutdown. Recorded as `unknown` — never discarded (BR-2.6). */
  flush(): void {
    this.#close('app-shutdown');
  }

  /** Drop every other interior sample, keeping first and last. Bounds a pathological trail. */
  #thin(): void {
    const trail = this.#current!.trail;
    const kept: Observation[] = [trail[0]!];
    for (let i = 1; i < trail.length - 1; i += 2) kept.push(trail[i]!);
    kept.push(trail[trail.length - 1]!);
    this.#current!.trail = kept;
  }

  #close(reason: CloseReason): void {
    const play = this.#current;
    this.#current = null;
    if (!play || play.trail.length === 0) return; // BR-1.4: no evidence, no record

    const endedWithIdle = reason === 'playback-stopped' || reason === 'pause-idle';
    const evidence = summarise(play.trail, this.#tolerances, endedWithIdle);
    const { outcome } = classify(evidence, this.#tolerances, reason);

    const record: NewPlayRecord = {
      trackId: play.sample.trackId,
      isrc: play.sample.isrc,
      title: play.sample.title,
      artistName: play.sample.artistName,
      artistId: play.sample.artistId,
      albumName: play.sample.albumName,
      releaseDate: play.sample.releaseDate,
      ageYears: play.sample.ageYears,
      following: play.sample.following,
      explicit: play.sample.explicit,
      albumType: play.sample.albumType,
      startedAt: new Date(play.startedAtMs).toISOString(),
      endedAt: new Date(play.trail[play.trail.length - 1]!.atMs).toISOString(),
      outcome,
      closeReason: reason,
      evidence,
      provenance: 'live',
      // US-13, U1 half: every live-observed skip is the user's. `rule` becomes reachable in U5.
      // Recording it from the first play is what stops Phases 1–3 being permanently
      // unattributed and needing a migration that *assumes* the answer.
      skipSource: outcome === 'skipped' ? 'user' : null,
      contextType: play.sample.contextType,
      classifierVersion: CLASSIFIER_VERSION,
    };

    try {
      const playId = this.#repo.recordPlay(record, play.trail);
      this.#recorded++;
      this.#lastRecordedAt = record.endedAt;
      this.#safely('onPlayRecorded', () => this.#hooks.onPlayRecorded?.(playId, record));
      if (this.#degraded) {
        console.log('[history] recording recovered');
        this.#degraded = false;
      }
    } catch (error) {
      // BR-3.9: a dropped play is indistinguishable from "nothing was playing" — a plausible
      // reading of the data, and therefore an undetectable corruption. Count it instead.
      this.#gaps++;
      this.#repo.recordGap();
      if (!this.#degraded) {
        // BR-3.8 / P-6: once per failure class, not once per tick. At a 3 s poll the alternative
        // is 1,200 identical lines an hour, burying everything else.
        this.#degraded = true;
        console.error(
          '[history] recording failed; continuing in display-only mode:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
