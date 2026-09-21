/**
 * The live facts a decision is taken over, and whether they have settled (LC-21, BR-22.5).
 * 🔌 IMPURE shell around a ⚙️ pure predicate.
 *
 * ## ⚠️ Why this module exists at all
 *
 * BR-22.5 originally said `enrichmentSettled` was answered by *"the resolver's queue state"*.
 * **There is no such state.** The resolver exposes nothing per track; the only state that
 * exists is `labelByTrack` / `labelInFlight` in `server.ts`, and it has **four** exits that
 * leave a track uncached — three of which a naive *not-cached-and-not-in-flight* test reads
 * identically as *"still working"*:
 *
 * | Exit | Truth | Naive reading |
 * |---|---|---|
 * | Enrichment has not landed | genuinely pending | pending ✅ |
 * | **No ISRC and no artist id** | permanently unanswerable | pending ❌ |
 * | **Both resolutions returned null** (uncached, will retry) | transiently failed | pending ❌ |
 * | **Label enrichment disabled** | never answerable | pending ❌ |
 *
 * Under the naive definition a keyless track waits the **full 10 s cap** and is stamped
 * `partialData = true` — recording **permanent absence as a timeout**, which is precisely the
 * distinction FQ3 exists to draw. ⚠️ **It would corrupt the one number U4 was built to
 * measure, in the direction that reads as "the wait is too short".**
 *
 * ## ⚠️ And why it is not in `server.ts`
 *
 * `settled` is a **judgement**, and `server.ts` is 952 lines with no tests, an allowed orphan
 * only because nothing in it judges anything. Wiring this there would have grown the one file
 * the orphan check excuses.
 */

import type { LabelResolutionState, Maybe } from './types.js';
import type { FactSources } from './trackFacts.js';

/** What the display already resolved for a track, as far as the rules engine cares. */
export interface LiveLabelFacts {
  readonly name: Maybe<string>;
  readonly classification: Maybe<'major' | 'independent' | 'unknown'>;
  readonly confidence: Maybe<string>;
  /** `null` = never asked, `[]` = asked and there are none. The distinction is load-bearing. */
  readonly genres: Maybe<readonly string[]>;
}

/** The inputs the settled predicate reasons over. Everything is explicit; nothing is inferred. */
export interface SettledInputs {
  /** Whether Spotify enrichment has landed for this track. */
  readonly enrichmentLanded: boolean;
  /** Whether label enrichment is configured at all. */
  readonly labelEnrichmentEnabled: boolean;
  /** Present only once enrichment has landed. */
  readonly isrc: Maybe<string>;
  readonly primaryArtistId: Maybe<string>;
  /** What the resolver has recorded for this track, if anything. */
  readonly labelState: LabelResolutionState | null;
}

/**
 * ⚙️ PURE. Whether the decision can be taken now without waiting out the cap (BR-22.5a/5b).
 *
 * ⚠️ **`not-attemptable` is terminal and immediate.** Without it, the three confusable exits
 * above all read as pending.
 */
export function isSettled(inputs: SettledInputs): boolean {
  // Nothing at all is known yet, so nothing downstream can be. This is the one genuinely
  // "pending" case, and the only one that should ever consume the wait.
  if (!inputs.enrichmentLanded) return false;

  // The feature is off. Waiting 10 s for a resolver that will never run is pure cost, and the
  // `partialData` it would set would be a lie about the enrichment latency.
  if (!inputs.labelEnrichmentEnabled) return true;

  // ⚠️ No key, so no lookup is possible for this track — ever. This is PERMANENT ABSENCE and
  // must not be recorded as a timeout.
  if (inputs.isrc === null && inputs.primaryArtistId === null) return true;

  switch (inputs.labelState) {
    case 'completed':
    case 'failed':
    case 'not-attemptable':
      return true;
    case 'pending':
    case null:
      return false;
  }
}

/**
 * Holds the per-track live state the trigger and the fact builder need. 🔌 IMPURE
 *
 * ⚠️ Bounded. A long-running container would otherwise accumulate one entry per distinct track
 * heard, for ever — the same unbounded-growth shape the display label cache already guards.
 */
export class LiveFactSource {
  readonly #labelEnrichmentEnabled: boolean;
  readonly #maxTracks: number;

  readonly #labelState = new Map<string, LabelResolutionState>();
  readonly #labelFacts = new Map<string, LiveLabelFacts>();
  /**
   * ⚠️ Sampled at play START and never re-read (BR-9.1). Liked state is point-in-time: unlike
   * an observation trail it cannot be recovered once the play is under way.
   */
  readonly #likedAtStart = new Map<string, boolean | null>();

  constructor(labelEnrichmentEnabled: boolean, maxTracks = 200) {
    this.#labelEnrichmentEnabled = labelEnrichmentEnabled;
    this.#maxTracks = maxTracks;
  }

  noteLikedAtStart(trackId: string, liked: boolean | null): void {
    this.#likedAtStart.set(trackId, liked);
    this.#evict(this.#likedAtStart);
  }

  likedAtStart(trackId: string): boolean | null {
    return this.#likedAtStart.get(trackId) ?? null;
  }

  /** Called when a lookup is dispatched. */
  noteLabelPending(trackId: string): void {
    this.#labelState.set(trackId, 'pending');
    this.#evict(this.#labelState);
  }

  /**
   * Called when a lookup ends, however it ended.
   *
   * ⚠️ **`failed` is not `completed` and neither is `not-attemptable`.** All three settle the
   * trigger, but they are three different facts and the log must be able to tell them apart —
   * `error` is not `unknown`, which produced three U2 defects that all passed the full suite.
   */
  noteLabelResult(trackId: string, state: LabelResolutionState, facts?: LiveLabelFacts): void {
    this.#labelState.set(trackId, state);
    if (facts !== undefined) {
      this.#labelFacts.set(trackId, facts);
      this.#evict(this.#labelFacts);
    }
    this.#evict(this.#labelState);
  }

  labelState(trackId: string): LabelResolutionState | null {
    return this.#labelState.get(trackId) ?? null;
  }

  /** The settled predicate, applied to this source's recorded state. */
  isSettled(input: {
    trackId: string;
    enrichmentLanded: boolean;
    isrc: Maybe<string>;
    primaryArtistId: Maybe<string>;
  }): boolean {
    return isSettled({
      enrichmentLanded: input.enrichmentLanded,
      labelEnrichmentEnabled: this.#labelEnrichmentEnabled,
      isrc: input.isrc,
      primaryArtistId: input.primaryArtistId,
      labelState: this.labelState(input.trackId),
    });
  }

  /**
   * Assemble everything a rule may read about the track playing now.
   *
   * ⚠️ **`liked.transition` is `null` here, always, and that is structural** (BR-23.9). It is
   * derived at play *close*, from `likedAtStart` against the state at the end, so a decision
   * taken ~10 s into a play cannot have it. A back-test reads it from the stored row and sees
   * it populated — the exact profile that got `context` excluded from the catalogue. The field
   * is kept because it is genuinely useful in back-testing; the catalogue note says it is
   * unavailable live so nobody writes a rule that back-tests beautifully and never fires.
   */
  factSources(input: {
    trackId: string;
    title: string;
    durationMs: number;
    explicit: Maybe<boolean>;
    isrc: Maybe<string>;
    artistId: Maybe<string>;
    artistName: string;
    following: Maybe<boolean>;
    albumName: string;
    releaseDate: Maybe<string>;
    ageYears: Maybe<number>;
    albumType: Maybe<string>;
    playsOfTrack: Maybe<number>;
    skipsOfTrack: Maybe<number>;
    playsOfArtist: Maybe<number>;
    skipsOfArtist: Maybe<number>;
    evaluatedAtMs: number;
  }): FactSources {
    const label = this.#labelFacts.get(input.trackId);

    return {
      trackId: input.trackId,
      title: input.title,
      durationMs: input.durationMs,
      explicit: input.explicit,
      isrc: input.isrc,

      artistId: input.artistId,
      artistName: input.artistName,
      following: input.following,
      genres: label?.genres ?? null,

      albumName: input.albumName,
      releaseDate: input.releaseDate,
      ageYears: input.ageYears,
      albumType: input.albumType,

      labelName: label?.name ?? null,
      labelClassification: label?.classification ?? null,
      labelConfidence: label?.confidence ?? null,

      likedAtStart: this.likedAtStart(input.trackId),
      // Structurally unavailable live — see the note above. Never guessed, never defaulted.
      likedTransition: null,

      playsOfTrack: input.playsOfTrack,
      skipsOfTrack: input.skipsOfTrack,
      playsOfArtist: input.playsOfArtist,
      skipsOfArtist: input.skipsOfArtist,

      evaluatedAtMs: input.evaluatedAtMs,
    };
  }

  /** Oldest-first, matching the display cache's policy. */
  #evict(map: Map<string, unknown>): void {
    while (map.size > this.#maxTracks) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}
