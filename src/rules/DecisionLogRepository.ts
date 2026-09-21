/**
 * The decision log's storage boundary (LC-13, NFR-10).
 *
 * Call sites name this interface and never `node:sqlite`. The log lives in `history.db`
 * alongside `play`, because the back-fill and the agreement join both need one connection and
 * because a second database file would be a second thing to back up.
 */

import type { DecisionFilter, DecisionLogEntry, NewDecisionLogEntry } from './types.js';

export interface DecisionLogRepository {
  /**
   * All rows of one decision, in one transaction.
   *
   * ⚠️ One decision over ten rules is ten rows sharing an `evaluationId` (BR-23.1). A partial
   * write would leave a decision whose own account of itself is incomplete, and the log's whole
   * job is answering *"why did my rule **not** fire?"* — which a missing row makes unanswerable
   * in exactly the case someone is asking about.
   */
  record(entries: readonly NewDecisionLogEntry[]): void;

  /**
   * Complete the `playId` link when the play closes (BR-24.1).
   *
   * ⚠️ Called only from `onPlayRecorded`, which fires **only after** `recordPlay` succeeds.
   * When the write fails the coordinator must call `markLinkFailed` instead — leaving the row
   * `pending` for ever would make a fault indistinguishable from a play that never closed.
   */
  attachPlayId(evaluationId: string, playId: number): void;

  /**
   * Record that the link will never arrive because the play row could not be written
   * (BR-24.3a).
   */
  markLinkFailed(evaluationId: string): void;

  list(filter: DecisionFilter): DecisionLogEntry[];

  countSince(sinceIso: string): number;

  /** Total rows. Drives the retention check and the diagnostics report. */
  count(): number;

  /**
   * Prune oldest-first to the cap, returning how many rows were deleted (BR-29.1).
   *
   * ## ⚠️ Two statements, and the split is the safety property
   *
   * A `SELECT` chooses the ids — and **may join `play`**, because the most useful retention
   * policy there is (*"keep the decisions where the rule and I disagreed"*) needs the outcome,
   * and banning the read would have quietly deleted the interesting rows first. A `SELECT`
   * cannot destroy anything.
   *
   * The `DELETE` then names **only** the decision table, by explicit id list. A decision row is
   * recomputable from rules plus history; a play row is recomputable from nothing —
   * `recently-played` is a 50-play window and seven of the corpus's ten early days exist only
   * as backfilled rows. A pruner able to name `play` in a `DELETE` is one wrong `WHERE` clause
   * from the one artefact here that cannot come back.
   *
   * ⚠️ **A single statement that joined and deleted would pass every behavioural test** and
   * lose the property entirely, which is why the rule constrains the SQL **text** and
   * `decisionLogRepository.test.ts` asserts on it.
   */
  pruneToCap(cap: number): number;
}
