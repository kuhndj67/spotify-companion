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
   * ⚠️ **Keyed on the PLAY ROW, never on `track_id`** (BR-36.1/36.2). A recurring track is a new play
   * and stays fully skippable. FR-40's original wording — *never skip the same track twice within one
   * session* — was **withdrawn** because suppressing a repeat listen is the same class of error as
   * clamping `completionRatio` to 1.0: hygiene that destroys signal. It also required a definition of
   * "session" that this corpus has never modelled.
   *
   * ⚠️ **True regardless of the attempt's outcome** (BR-36.4). One attempt is the budget; a failed
   * attempt does not earn a retry.
   */
  attemptedForPlay(playId: number): boolean;

  /**
   * Epoch-millisecond timestamps of attempts that **reached the player** since `sinceIso`, for
   * BR-35.2's rolling window.
   *
   * ⚠️ **`fired`, `confirmed` and `unconfirmed` all count; `queued`, `cancelled` and `refused` do
   * not.** The first three issued a `POST`; the last three did not.
   *
   * ⚠️ **Counting `unconfirmed` is deliberate.** Whether the skip landed is *unknown*, and unknown
   * counts as landed — the same rule P-30 applies to transport failures, and the restrictive
   * direction for a safety limit. A halt that under-counts is a halt that does not fire.
   */
  firedSinceMs(sinceIso: string): number[];

  /** One attempt by id, for the UI and for tests. `null` when absent. */
  get(id: number): SkipAttempt | null;
}
