/**
 * SQLite implementation of the skip-attempt store (LC-24). 🔌 IMPURE
 *
 * Takes an open `DatabaseSync` rather than a path, for the reason `SqliteDecisionLogRepository`
 * records: `skip_attempt` shares `history.db` with `play`, and ⚠️ **two writers on one SQLite file is
 * this project's standing hazard**. One connection.
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { SkipAttemptRepository, TransitionPatch } from './SkipAttemptRepository.js';
import type { NewSkipAttempt, RefusalReason, SkipAttempt, SkipAttemptState } from './types.js';

interface AttemptRow {
  id: number;
  evaluation_id: string;
  play_id: number | null;
  track_id: string;
  rule_id: string;
  state: string;
  enqueued_at: string;
  fired_at: string | null;
  refused_reason: string | null;
  reported_track_id_before: string | null;
  reported_progress_ms_before: number | null;
  reported_track_id_after: string | null;
  reported_progress_ms_after: number | null;
}

/**
 * States in which the `POST` was actually issued, for BR-35.2's rolling window.
 *
 * ⚠️ `unconfirmed` is in here. Whether the skip landed is *unknown*, and unknown counts as landed —
 * the restrictive direction for a safety limit, and the same rule P-30 applies to transport failures.
 * A halt that under-counts is a halt that does not fire.
 */
const REACHED_THE_PLAYER: readonly SkipAttemptState[] = ['fired', 'confirmed', 'unconfirmed'];

/**
 * ⚠️ **THE ONE DEFINITION of "a rule skipped this play", as SQL.** Two call sites use it:
 *
 *   1. `SqliteSkipAttemptRepository.firedDuring` — which decides the `skip_source` LABEL written on
 *      the play row, for exports and for R1's eligibility.
 *   2. `SqliteHistoryRepository.recentPlaysForCounting` — which feeds the **3-consecutive SAFETY
 *      LIMIT** (BR-35.1/35.9).
 *
 * ⚠️ **It is keyed on the TRACK and the play's TIME WINDOW, never on `skip_attempt.play_id`.**
 * `play_id` is backfilled after the play row is written (`attachPlayId`), inside a try/catch that is
 * explicitly allowed to fail because it is not load-bearing. A safety limit that read it would
 * **under-count whenever that backfill failed** — and a halt that under-counts is a halt that does not
 * fire. The window cannot fail: both ends are columns on the play row itself.
 *
 * ⚠️ A repeat listen is a different window, so it cannot inherit an earlier play's attempt.
 *
 * ⚠️ `ended_at IS NULL` is tolerated for a play still open. `test/ruleSkipAgreement.test.ts` pins
 * that the two call sites answer identically on the same data — one rule invoked twice, never written
 * twice, which is the lesson of the WebSocket `403`.
 */
export const RULE_SKIPPED_THIS_PLAY_SQL = `
  EXISTS (SELECT 1 FROM skip_attempt sa
           WHERE sa.track_id = %PLAY%.track_id
             AND sa.state IN ('fired', 'confirmed', 'unconfirmed')
             AND sa.enqueued_at >= %PLAY%.started_at
             AND (%PLAY%.ended_at IS NULL OR sa.enqueued_at <= %PLAY%.ended_at))`;

/** Bind the shared predicate to a table alias. */
export function ruleSkippedThisPlay(playAlias: string): string {
  return RULE_SKIPPED_THIS_PLAY_SQL.split('%PLAY%').join(playAlias);
}

/**
 * ⚠️ `undefined` is normalised to `null` on the way in, never left to the driver.
 *
 * `node:sqlite` rejects `undefined` as a bound value, so an optional field left unset would throw at
 * runtime rather than at compile time — and only on the code path that happens not to set it. U4 hit
 * the same class of defect from the other direction: `JSON.stringify` silently *drops* keys whose
 * value is `undefined`, which is why BR-23.4 requires an explicit null. Same rule, different layer.
 */
function orNull<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

export class SqliteSkipAttemptRepository implements SkipAttemptRepository {
  readonly #insert: StatementSync;
  readonly #byId: StatementSync;
  readonly #latest: StatementSync;
  readonly #firedDuring: StatementSync;
  readonly #queued: StatementSync;
  readonly #attempted: StatementSync;
  readonly #firedSince: StatementSync;
  readonly #attachPlay: StatementSync;
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;

    this.#insert = db.prepare(
      `INSERT INTO skip_attempt
         (evaluation_id, play_id, track_id, rule_id, state, enqueued_at, fired_at, refused_reason,
          reported_track_id_before, reported_progress_ms_before,
          reported_track_id_after, reported_progress_ms_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.#byId = db.prepare(`SELECT * FROM skip_attempt WHERE id = ?`);
    // ⚠️ `ORDER BY id DESC`, not `enqueued_at DESC`: the timestamp has second-ish resolution and two
    // attempts in one second would order arbitrarily. The rowid is monotonic by construction.
    this.#latest = db.prepare(`SELECT * FROM skip_attempt ORDER BY id DESC LIMIT 1`);

    // ⚠️ The same window rule as `ruleSkippedThisPlay`, expressed against bound parameters because
    // here there is no play row to join to — `PlayObserver` asks this BEFORE the row exists.
    this.#firedDuring = db.prepare(
      `SELECT 1 AS hit FROM skip_attempt
        WHERE track_id = ?
          AND state IN ('fired', 'confirmed', 'unconfirmed')
          AND enqueued_at >= ?
          AND enqueued_at <= ?
        LIMIT 1`,
    );

    this.#queued = db.prepare(`SELECT * FROM skip_attempt WHERE state = 'queued' ORDER BY id`);

    // ⚠️ evaluation_id — the per-play key that exists while the play is OPEN. Never play_id (which
    // is null until the play closes) and never track_id (BR-36.2). Uses
    // idx_skip_attempt_evaluation_play; runs on every drain.
    this.#attempted = db.prepare(
      `SELECT COUNT(*) AS c FROM skip_attempt WHERE evaluation_id = ?`,
    );

    this.#attachPlay = db.prepare(
      `UPDATE skip_attempt SET play_id = ? WHERE evaluation_id = ? AND play_id IS NULL`,
    );

    // ⚠️ Filters on state, not merely on fired_at being non-null: a row could in principle carry a
    // timestamp from an earlier transition, and the question here is "did this reach the player".
    this.#firedSince = db.prepare(
      `SELECT id, fired_at FROM skip_attempt
        WHERE fired_at IS NOT NULL
          AND fired_at > ?
          AND state IN ('fired', 'confirmed', 'unconfirmed')
        ORDER BY fired_at`,
    );
  }

  enqueue(attempt: NewSkipAttempt): number {
    this.#insert.run(
      attempt.evaluationId,
      attempt.playId,
      attempt.trackId,
      attempt.ruleId,
      attempt.state,
      attempt.enqueuedAt,
      orNull(attempt.firedAt),
      orNull(attempt.refusedReason),
      orNull(attempt.reportedTrackIdBefore),
      orNull(attempt.reportedProgressMsBefore),
      orNull(attempt.reportedTrackIdAfter),
      orNull(attempt.reportedProgressMsAfter),
    );
    const row = this.#db.prepare('SELECT last_insert_rowid() AS id').get() as unknown as { id: number };
    return row.id;
  }

  /**
   * ⚠️ **One statement, built from whichever evidence the patch carries** (BR-43.2).
   *
   * The alternative — an `UPDATE` for the state and another for the evidence — leaves a window in
   * which the row says `fired` and cannot say against what. That window is short, and it is exactly
   * the window in which a crash is most likely, because issuing the `POST` is the riskiest thing this
   * unit does.
   */
  transition(id: number, state: SkipAttemptState, patch: TransitionPatch = {}): void {
    const sets: string[] = ['state = ?'];
    const values: (string | number | null)[] = [state];

    const push = (column: string, value: string | number | null | undefined): void => {
      if (value === undefined) return;
      sets.push(`${column} = ?`);
      values.push(value);
    };

    push('refused_reason', patch.refusedReason);
    push('fired_at', patch.firedAt);
    push('reported_track_id_before', patch.reportedTrackIdBefore);
    push('reported_progress_ms_before', patch.reportedProgressMsBefore);
    push('reported_track_id_after', patch.reportedTrackIdAfter);
    push('reported_progress_ms_after', patch.reportedProgressMsAfter);

    values.push(id);
    this.#db.prepare(`UPDATE skip_attempt SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  queued(): SkipAttempt[] {
    return (this.#queued.all() as unknown as AttemptRow[]).map(toAttempt);
  }

  attemptedForPlay(evaluationId: string): boolean {
    const row = this.#attempted.get(evaluationId) as unknown as { c: number };
    return row.c > 0;
  }

  attachPlayId(evaluationId: string, playId: number): void {
    this.#attachPlay.run(playId, evaluationId);
  }

  firedSince(sinceIso: string): readonly { id: number; firedAtMs: number }[] {
    const rows = this.#firedSince.all(sinceIso) as unknown as { id: number; fired_at: string }[];
    return rows.map((r) => ({ id: r.id, firedAtMs: Date.parse(r.fired_at) }));
  }

  get(id: number): SkipAttempt | null {
    const row = this.#byId.get(id) as unknown as AttemptRow | undefined;
    return row === undefined ? null : toAttempt(row);
  }

  latest(): SkipAttempt | null {
    const row = this.#latest.get() as unknown as AttemptRow | undefined;
    return row === undefined ? null : toAttempt(row);
  }

  firedDuring(trackId: string, fromIso: string, toIso: string): boolean {
    return this.#firedDuring.get(trackId, fromIso, toIso) !== undefined;
  }
}

function toAttempt(row: AttemptRow): SkipAttempt {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    playId: row.play_id,
    trackId: row.track_id,
    ruleId: row.rule_id,
    // ⚠️ Not validated against the union here. The column deliberately carries no CHECK constraint —
    // SQLite has no ALTER TABLE DROP CONSTRAINT, so one would have to be widened by rebuilding the
    // table, making a future migration non-additive and retiring by-image rollback. Migration 006
    // recorded the same reasoning for `skip_source`. The union is enforced where it is written.
    state: row.state as SkipAttemptState,
    enqueuedAt: row.enqueued_at,
    firedAt: row.fired_at,
    refusedReason: row.refused_reason as RefusalReason | null,
    reportedTrackIdBefore: row.reported_track_id_before,
    reportedProgressMsBefore: row.reported_progress_ms_before,
    reportedTrackIdAfter: row.reported_track_id_after,
    reportedProgressMsAfter: row.reported_progress_ms_after,
  };
}

/** Exported for the test that pins which states count toward the rolling window. */
/*
 * ⚠️ A `STATES_THAT_REACHED_THE_PLAYER` alias was exported here and imported by nothing. Removed
 * 2026-10-03 (found by `knip`). `REACHED_THE_PLAYER` above is the one definition; if a test ever needs
 * it, export THAT rather than adding a second name for it.
 */
