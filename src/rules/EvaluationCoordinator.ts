/**
 * The evaluation trigger (LC-14, BR-22). 🔌 IMPURE
 *
 * ## ⚠️ It does NOT own the play boundary (BR-22.8)
 *
 * `PlayObserver` does, and it owns more of it than is obvious: the `track-change` close, the
 * `pause-idle` and `playback-stopped` closes, and the null-progress projection in
 * `toPlaybackSample`. An earlier draft of this component re-derived the boundary from
 * `trackId` and null samples, which is **two segmenters that must agree** — and BR-24.1's
 * `evaluationId → playId` back-fill depends on their agreement, so a divergence would
 * silently mis-link decisions to plays rather than fail.
 *
 * That is the WebSocket `403` exactly: the admission rule was re-implemented rather than
 * reused, the copies diverged, and **all 411 tests passed** while every handshake returned 403.
 *
 * ⚠️ **Consequence, accepted (BR-22.8a): no repository means no evaluation.** The observer's
 * hooks are the boundary signal, and `onPlayRecorded` only fires when a play is written. With
 * recording down the engine goes quiet — the safe direction, and the decision log has nowhere
 * to live in that state anyway.
 *
 * ## ⚠️ It consumes `tick`, never `change` (BR-22.6)
 *
 * `change` is signature-suppressed and the signature excludes progress. A trigger fed from it
 * would evaluate sparsely, at the wrong moments, and **would look like it was working**. The
 * same mistake in `PlayObserver` produced sparse trails and plausible-but-wrong verdicts.
 */

import type { DecisionSummaryInput } from './decisionSummary.js';
import type { LiveFactSource } from './liveFactSource.js';
import { assembleFacts } from './trackFacts.js';
import { decide } from './RuleEngine.js';
import type { HistoryCounts } from '../history/types.js';
import type { DecisionExecutor, DecisionTrigger, LoadedRule, Maybe } from './types.js';

/** What the coordinator needs from each tick. A projection of the snapshot, not the snapshot. */
/**
 * ⚠️ BR-38.2's absolute hold bound, and **deliberately NOT `ENRICHMENT_WAIT_MS`** (BR-38.5).
 *
 * That constant is 10 s and is measured-correct for U4's purpose — the longest observed enrichment
 * settle was 9.0 s. A LABEL is a different wait: it sits behind a 1 req/sec MusicBrainz queue whose
 * bounded retry has been seen to take a `503` at 1200 ms spacing. Reusing 10 s here would make `hold`
 * behave exactly like `no-match`, because the rule would always time out before the thing it was
 * waiting for arrived.
 *
 * ⚠️ A constant, not a setting. The hold window is a correctness bound on FR-33, not an operational
 * cadence — the same reasoning as `MAX_PREDICATE_DEPTH` and the BR-35 safety limits.
 */
export const HOLD_MAX_MS = 30_000;

export interface EvaluationSample {
  readonly trackId: string;
  readonly title: string;
  readonly durationMs: number;
  readonly explicit: Maybe<boolean>;
  readonly isrc: Maybe<string>;
  readonly artistId: Maybe<string>;
  readonly artistName: string;
  readonly following: Maybe<boolean>;
  readonly albumName: string;
  readonly releaseDate: Maybe<string>;
  readonly ageYears: Maybe<number>;
  readonly albumType: Maybe<string>;
  /** Whether Spotify enrichment has landed. Distinct from "every field happens to be null". */
  readonly enrichmentLanded: boolean;
}

export interface EvaluationCoordinatorDeps {
  readonly rules: () => readonly LoadedRule[];
  readonly ruleSet: () => { readonly version: number; readonly contentHash: string; readonly rules: readonly LoadedRule[] };
  readonly liveFacts: LiveFactSource;
  readonly executor: DecisionExecutor;
  readonly historyCounts: (trackId: string, artistId: string | null, beforeIso: string) => HistoryCounts;
  /** Link completion. Separate calls, because a failed write is not a pending one (BR-24.3a). */
  readonly attachPlayId: (evaluationId: string, playId: number) => void;
  readonly markLinkFailed: (evaluationId: string) => void;
  /** Injected: the trigger is a function of time and must be testable without sleeping. */
  readonly nowMs: () => number;
  readonly newEvaluationId: () => string;
  /**
   * ⚠️ **An admitted guess** (BR-22.3). The enrichment latency this waits on has never been
   * measured; the figure that appeared to measure it (0.2 s) was `resolvedAt` stamped *before*
   * the two MusicBrainz calls, recording initiation rather than completion.
   *
   * ⚠️ Raising it widens BR-22.7's blind spot: plays that END before the cap produce no
   * decision row at all — measured 2.8% of plays and 4 of 31 skips at 10 s, 3.5% and 5 of 31
   * at 15 s. Re-measure before changing it.
   */
  readonly enrichmentWaitMs: number;
  readonly onError?: (error: unknown) => void;
  /**
   * Called once per decision, after it has been recorded.
   *
   * ⚠️ **Formatting is deliberately not done here.** The coordinator hands over facts; the
   * caller decides what to do with them. That keeps the log line testable as a pure function
   * and keeps a `console.log` out of the component whose correctness matters most.
   */
  readonly onDecision?: (summary: DecisionSummaryInput) => void;
}

interface CurrentPlay {
  readonly trackId: string;
  readonly startedAtMs: number;
  readonly evaluationId: string;
  decided: boolean;
  /**
   * ⚠️ U5, BR-37. At most ONE re-evaluation per play.
   *
   * FR-34 asks for a second decision when slow enrichment lands. Without this flag the coordinator
   * would re-evaluate on every subsequent tick, writing a decision group every 3 seconds for the rest
   * of the track — and BR-22.1a deliberately created no uniqueness constraint that would have made
   * that visible in the schema.
   */
  reEvaluated: boolean;
  /** Whether the initial decision was taken on incomplete facts. Only then is a second pass useful. */
  decidedOnPartialData: boolean;
  /** Track length at the moment of the decision, for BR-38.2's 50%-of-duration bound. */
  durationMs: number;
}

export class EvaluationCoordinator {
  readonly #deps: EvaluationCoordinatorDeps;
  #current: CurrentPlay | null = null;
  /** Counted rather than thrown: a logging fault must never stop the poll loop. */
  #errors = 0;
  #decisions = 0;
  #partialDataCount = 0;

  constructor(deps: EvaluationCoordinatorDeps) {
    this.#deps = deps;
  }

  /**
   * The measurement U4 exists to collect. ⚠️ `partialData` counts how often the **cap fired**,
   * which is the first real measurement of enrichment latency — and the denominator is
   * `decisions`, never the play count, because a play shorter than the wait produces no row.
   */
  get stats(): { decisions: number; partialData: number; errors: number } {
    return { decisions: this.#decisions, partialData: this.#partialDataCount, errors: this.#errors };
  }

  /** From `PlayObserver.onPlayStarted`. The boundary is the observer's; this just follows it. */
  onPlayStarted(trackId: string, atMs: number): void {
    this.#current = {
      trackId,
      startedAtMs: atMs,
      evaluationId: this.#deps.newEvaluationId(),
      decided: false,
      reEvaluated: false,
      decidedOnPartialData: false,
      // Replaced by the real duration on the first tick that carries one.
      durationMs: 0,
    };
  }

  /**
   * From `PlayObserver.onPlayRecorded`, which fires **only after the write succeeds**.
   * Completes the `playId` link (BR-24.1).
   */
  onPlayRecorded(trackId: string, playId: number): void {
    const play = this.#current;
    if (play === null || play.trackId !== trackId || !play.decided) return;
    this.#safely(() => this.#deps.attachPlayId(play.evaluationId, playId));
  }

  /**
   * ⚠️ The play closed and its row could NOT be written. Without this the row would stay
   * `pending` for ever — indistinguishable from a play that never closed, which is an expected
   * W-3 case rather than a fault on the one artefact that cannot be regenerated.
   */
  onPlayDropped(trackId: string): void {
    const play = this.#current;
    if (play === null || play.trackId !== trackId || !play.decided) return;
    this.#safely(() => this.#deps.markLinkFailed(play.evaluationId));
  }

  /**
   * One tick of the poll loop.
   *
   * ⚠️ **Exactly one decision per play — in U4** (BR-22.1). Enforced by the `decided` flag and
   * tested here, deliberately **not** by a uniqueness constraint: FR-34 is a Must and makes U5
   * write a second decision per play legitimately, and dropping a constraint later would be a
   * non-additive migration that retires the by-image rollback guarantee.
   */
  onTick(sample: EvaluationSample | null, atMs: number): void {
    const play = this.#current;
    if (play === null) return;
    // A tick for some other track is stale. The observer, not this class, decides boundaries.
    if (sample === null || sample.trackId !== play.trackId) return;

    play.durationMs = sample.durationMs;

    const settled = this.#deps.liveFacts.isSettled({
      trackId: sample.trackId,
      enrichmentLanded: sample.enrichmentLanded,
      isrc: sample.isrc,
      primaryArtistId: sample.artistId,
    });

    // ── FR-34: the SECOND pass, after a decision ───────────────────────────────────────────────
    if (play.decided) {
      // ⚠️ Only worth doing if the first pass ran out of patience. A decision taken on SETTLED facts
      // has nothing left to learn, so re-evaluating it would write a second identical decision group
      // and burn a `historyCountsBefore` query for no information.
      if (play.reEvaluated || !play.decidedOnPartialData || !settled) return;
      play.reEvaluated = true;
      this.#decide(play, sample, atMs, false, 'enrichment-arrived');
      return;
    }

    if (settled) {
      this.#decide(play, sample, atMs, false, 'initial');
      return;
    }

    // ── FR-33: the hold (BR-38.2) ──────────────────────────────────────────────────────────────
    //
    // ⚠️ A holding rule waits LONGER than `ENRICHMENT_WAIT_MS`, and BR-38.5 says so explicitly: that
    // constant is measured-correct for U4's purpose (max observed settle 9.0 s), but a label behind a
    // 1 req/sec MusicBrainz queue can take far longer. Reusing it would make `hold` indistinguishable
    // from `no-match` -- the rule would always time out before the label it was waiting for arrived.
    const elapsed = atMs - play.startedAtMs;
    const deadline = this.#holdDeadlineMs(play);

    if (deadline !== null) {
      if (elapsed < deadline) return; // still holding
      // ⚠️ The hold expired. BR-38.4: take the FR-35 partial-data path, which is what makes a held
      // rule decide rather than hang for the rest of the track.
      this.#decide(play, sample, atMs, true, 'initial');
      return;
    }

    if (elapsed >= this.#deps.enrichmentWaitMs) {
      // ⚠️ The cap fired. `partialData` means THE WAIT TIMED OUT (FQ3) — not that some field
      // read null, which is an ordinary unknown and is recorded per field in `fieldsSeen`.
      this.#decide(play, sample, atMs, true, 'initial');
    }
    // else: wait for the next tick.
  }

  /**
   * How long this play may hold, or `null` when no loaded rule asks to hold.
   *
   * **BR-38.2: `min(label resolved, 30 000 ms, 50% of track duration)`.** The *label resolved* term is
   * handled by the caller — `settled` short-circuits ahead of this — so what remains is the lesser of
   * the two bounds.
   *
   * ⚠️ **The duration term is a SECOND, INDEPENDENT bound, not a re-expression of the first**
   * (BR-38.3). On a 40-second track, 50% is 20 s and the cap never applies; on a seven-minute one, 30 s
   * applies long before half. Taking only the millisecond figure would hold a short track past its own
   * end, which BR-38.7 forbids: holding past the point the track has finished is pointless.
   *
   * ⚠️ A duration of 0 means no tick has carried one yet, so the duration bound is not yet knowable
   * and only the absolute cap applies. Treating 0 as "half of nothing" would decide instantly.
   */
  #holdDeadlineMs(play: CurrentPlay): number | null {
    const anyHolds = this.#deps
      .ruleSet()
      .rules.some((loaded) => loaded.status.state === 'active' && loaded.rule.onUnknown === 'hold');
    if (!anyHolds) return null;

    const halfDuration = play.durationMs > 0 ? play.durationMs / 2 : Number.POSITIVE_INFINITY;
    return Math.min(HOLD_MAX_MS, halfDuration);
  }

  /**
   * In-progress state for diagnostics — and, from U5, the key the action point matches against.
   *
   * ⚠️ **Never used to make a decision.** The drain uses `evaluationId` to answer *is this still the
   * play the rule matched?*, which is a check about identity rather than a judgement about facts. The
   * boundary is still `PlayObserver`'s: this class only reports what it was told.
   *
   * ⚠️ `evaluationId` is exposed because it is the only per-play identifier that exists **while the
   * play is open** — `playId` is written when the play closes. That is the same fact that made
   * `skip_attempt.play_id` nullable.
   */
  get inProgress(): { trackId: string; evaluationId: string; decided: boolean } | null {
    return this.#current === null
      ? null
      : {
          trackId: this.#current.trackId,
          evaluationId: this.#current.evaluationId,
          decided: this.#current.decided,
        };
  }

  #decide(
    play: CurrentPlay,
    sample: EvaluationSample,
    atMs: number,
    partialData: boolean,
    trigger: DecisionTrigger,
  ): void {
    // Marked decided BEFORE the work, so a throw cannot produce a second attempt on the next
    // tick and two decision groups for one play.
    play.decided = true;
    if (trigger === 'initial') play.decidedOnPartialData = partialData;

    this.#safely(() => {
      const decidedAt = new Date(atMs).toISOString();

      // ⚠️ Point-in-time, with `before = now` — the SAME method the back-test uses with
      // `before = row.startedAt` (BR-27.7). Two implementations would agree on every fixture
      // and diverge only on the corpus.
      const counts = this.#deps.historyCounts(sample.trackId, sample.artistId, decidedAt);

      const facts = assembleFacts(
        this.#deps.liveFacts.factSources({
          trackId: sample.trackId,
          title: sample.title,
          durationMs: sample.durationMs,
          explicit: sample.explicit,
          isrc: sample.isrc,
          artistId: sample.artistId,
          artistName: sample.artistName,
          following: sample.following,
          albumName: sample.albumName,
          releaseDate: sample.releaseDate,
          ageYears: sample.ageYears,
          albumType: sample.albumType,
          playsOfTrack: counts.playsOfTrack,
          skipsOfTrack: counts.skipsOfTrack,
          playsOfArtist: counts.playsOfArtist,
          skipsOfArtist: counts.skipsOfArtist,
          evaluatedAtMs: atMs,
        }),
      );

      // ⚠️ The set is read ONCE, here, and used throughout. That is what makes a reload land
      // between evaluations rather than inside one (BR-26.2, P-23) — cheap only because U3's
      // engine is pure, so there is no partially-updated evaluator state to reconcile.
      const ruleSet = this.#deps.ruleSet();
      const decision = decide(ruleSet.rules, facts, partialData);

      this.#deps.executor.execute({
        decision,
        ruleSet: { ...ruleSet, loadedAt: decidedAt, state: 'applied', rejection: null },
        trackId: sample.trackId,
        evaluationId: play.evaluationId,
        decidedAt,
        partialData,
        // ⚠️ U5, BR-37.3. A HELD play's decision is `initial` even when it is taken late: it was
        // never decided before, so there is nothing to re-evaluate. Only a decision taken on partial
        // data and later revisited is `enrichment-arrived` — and BR-37.6 means that pass may CANCEL a
        // pending skip and may never create one, which `SkipExecutor` enforces.
        trigger,
      });

      this.#decisions += 1;
      if (partialData) this.#partialDataCount += 1;

      // Inside #safely: a logging fault is counted like any other and must never reach the
      // poll loop. It fires only after the rows are written, so a line on screen always
      // means a row in the database.
      this.#deps.onDecision?.({
        trackId: sample.trackId,
        title: sample.title,
        artistName: sample.artistName,
        elapsedMs: atMs - play.startedAtMs,
        partialData,
        rules: decision.outcomes.map((outcome) => ({
          name: ruleSet.rules.find((r) => r.rule.id === outcome.ruleId)?.rule.name ?? outcome.ruleId,
          verdict: outcome.verdict,
          matched: decision.matchedRuleIds.includes(outcome.ruleId),
        })),
      });
    });
  }

  /**
   * ⚠️ **A failure here must never stop recording.** Rules are text that can be retyped; the
   * play records are the artefact that cannot be regenerated (BR-20.10, applied to the trigger).
   */
  #safely(work: () => void): void {
    try {
      work();
    } catch (error) {
      this.#errors += 1;
      if (this.#deps.onError !== undefined) this.#deps.onError(error);
      else console.error('[rules] evaluation failed:', error);
    }
  }
}
