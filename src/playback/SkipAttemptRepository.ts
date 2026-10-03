/**
 * Storage for skip attempts (LC-24). The interface, so call sites never name `node:sqlite`.
 *
 * Satisfies **NFR-10**, for the reason `HistoryRepository` records: `node:sqlite` is experimental in
 * Node 22 (R10), and if its API moves, the blast radius is one file rather than every caller.
 *
 * ## ⚠️ What this repository does NOT answer, and why that matters
 *
 * **It cannot compute the consecutive-skip count.** BR-35.9 resets that counter on any play *not*
 * skipped by a rule, and `skip_attempt` has no row for such a play — so a query over this table alone
 * would count "three rule skips ever" rather than "three in a row".
 *
 * ⚠️ **LC-24 listed `recentForConsecutive(limit): SkipAttempt[]` and that method is not here.** The
 * authoritative source for *was this play skipped by a rule* is **`play.skip_source = 'rule'`** — the
 * column U1 created for exactly this purpose, with US-13 deliberately split across U1 and U5 so that
 * every play recorded before automation existed would already carry the fact. So the consecutive run
 * is read from `play` via `HistoryRepository.recentPlaysForCounting`, and this table answers only
 * questions about *attempts*. Corrected during Step 4, 2026-10-02.
 *
 * ⚠️ **The distinction is not pedantic: an attempt is not a skip.** A `refused` or `cancelled` attempt
 * never touched the player, so counting it would halt automation over skips that never happened.
 */

import type { NewSkipAttempt, RefusalReason, SkipAttempt, SkipAttemptState } from './types.js';

/** Fields that may be written alongside a state transition. All optional; absent means unchanged. */
export interface TransitionPatch {
  readonly refusedReason?: RefusalReason;
  readonly firedAt?: string;
  readonly reportedTrackIdBefore?: string | null;
  readonly reportedProgressMsBefore?: number | null;
  readonly reportedTrackIdAfter?: string | null;
  readonly reportedProgressMsAfter?: number | null;
}

export interface SkipAttemptRepository {
  /** Insert a `queued` attempt and return its id. */
  enqueue(attempt: NewSkipAttempt): number;

  /**
   * Move an attempt to a new state, writing any evidence alongside it.
   *
   * ⚠️ **State and evidence go in ONE statement** (BR-43.2). A state written without its evidence is
   * a row that says `fired` and cannot say *against what* — and the window in which it is wrong is
   * exactly the window in which the process might die.
   */
  transition(id: number, state: SkipAttemptState, patch?: TransitionPatch): void;

  /**
   * Every attempt still sitting in `queued`.
   *
   * ⚠️ **Used by the STARTUP SWEEP.** The queue is in memory, so a `queued` row surviving a restart
   * is one whose drain never ran. It is closed as `refused: play-closed` rather than fired: a skip
   * that survives a restart would fire into whatever happens to be playing when the app returns
   * (P-29). Failing closed *and* leaving a record — an attempt that never fired because the app
   * restarted must be distinguishable from one that never existed.
   */
  queued(): SkipAttempt[];

  /**
   * Has any attempt already been made for this play?
   *
   * ⚠️ **Keyed on `evaluationId`, which identifies the PLAY** — not on `playId`, and never on
   * `trackId`.
   *
   * `playId` does not exist yet while the play is open (`PlayObserver` writes the row at close), so a
   * `playId`-keyed guard is unenforceable at the action point. `evaluationId` is created once per play
   * in `onPlayStarted` and is available throughout. Corrected 2026-10-02.
   *
   * ⚠️ **Never `trackId`** (BR-36.2). A recurring track is a new play and stays fully skippable.
   * FR-40's original wording — *never skip the same track twice within one session* — was **withdrawn**
   * because suppressing a repeat listen is the same class of error as clamping `completionRatio` to
   * 1.0: hygiene that destroys signal. It also required a definition of "session" this corpus has
   * never modelled.
   *
   * ⚠️ **True regardless of the attempt's outcome** (BR-36.4). One attempt is the budget; a failed
   * attempt does not earn a retry.
   */
  attemptedForPlay(evaluationId: string): boolean;

  /**
   * Backfill `playId` once the play row exists, from `PlayObserver`'s `onPlayRecorded`.
   *
   * ⚠️ **Convenience for later analysis, never load-bearing for the guard.** Exactly the role
   * `DecisionLogRepository.attachPlayId` plays for the decision log — and if it never runs, the guard
   * is unaffected because it does not read this column.
   */
  attachPlayId(evaluationId: string, playId: number): void;

  /**
   * Attempts that **reached the player** since `sinceIso`, for BR-35.2's rolling window.
   *
   * ⚠️ **Returns ids alongside timestamps, and the ids are load-bearing.** BR-35.8 requires the
   * acknowledgement surface to say *which rule-skips counted*, so `RunawayHalt.attemptIds` must name
   * real rows. An earlier draft returned timestamps only and synthesised the ids from array indices —
   * which would have produced a halt record pointing at attempts that do not exist, in the one place
   * the user is asked to review evidence before clearing a safety latch.
   *
   * ⚠️ **`fired`, `confirmed` and `unconfirmed` all count; `queued`, `cancelled` and `refused` do
   * not.** The first three issued a `POST`; the last three did not.
   *
   * ⚠️ **Counting `unconfirmed` is deliberate.** Whether the skip landed is *unknown*, and unknown
   * counts as landed — the same rule P-30 applies to transport failures, and the restrictive
   * direction for a safety limit. A halt that under-counts is a halt that does not fire.
   */
  firedSince(sinceIso: string): readonly { readonly id: number; readonly firedAtMs: number }[];

  /** One attempt by id, for the UI and for tests. `null` when absent. */
  get(id: number): SkipAttempt | null;

  /**
   * The most recently enqueued attempt, whatever became of it. `null` when there has never been one.
   *
   * ⚠️ **For diagnostics, and it must return the attempt in ANY state** — including `refused`. A
   * "last attempt" that showed only the ones that fired would answer *when did automation last act*
   * while appearing to answer *is automation working*, and those diverge in exactly the case worth
   * seeing: a rule matching repeatedly and being refused every time, which looks identical to no
   * matches at all.
   */
  latest(): SkipAttempt | null;
}
