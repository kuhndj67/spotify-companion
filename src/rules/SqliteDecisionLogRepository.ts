/**
 * SQLite implementation of the decision log (LC-13). 🔌 IMPURE
 *
 * Takes an open `DatabaseSync` rather than a path: the log shares `history.db` with `play`, and
 * ⚠️ **two writers on one SQLite file is this project's standing hazard**. One connection.
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { DecisionLogRepository } from './DecisionLogRepository.js';
import type {
  DecisionFilter,
  DecisionLogEntry,
  NewDecisionLogEntry,
  PlayLinkState,
  Verdict,
} from './types.js';

interface DecisionRow {
  id: number;
  evaluation_id: string;
  decided_at: string;
  play_id: number | null;
  play_link: string;
  track_id: string;
  rule_id: string;
  rule_name: string;
  rule_hash: string;
  verdict: string;
  matched: number;
  fields_seen: string;
  unknown_fields: string;
  rested_on_unknown: number;
  partial_data: number;
  dry_run: number;
  executed: number;
  error: string | null;
  engine_version: number;
  rule_set_version: number;
  rule_set_content_hash: string;
}

/**
 * SQLite's compiled-in bound-variable limit is 32,766 on modern builds and 999 on older ones.
 * Chunking well below the lower figure costs nothing and removes the question.
 *
 * ⚠️ This matters for the **one-time** case, not the steady state: the first prune after the cap
 * is lowered, or after a long unattended stretch, can name tens of thousands of ids at once —
 * and that failure would land inside the poll tick.
 */
const DELETE_CHUNK = 500;

/**
 * ⚠️ **The delete statement's text is a tested artefact** (BR-29.3b). It names one table and
 * contains no reference to `play`. Keeping it as a module constant is what lets
 * `decisionLogRepository.test.ts` assert on the text rather than only on the behaviour — a
 * single join-and-delete statement would satisfy every behavioural test and lose the property.
 */
export const DELETE_SQL_PREFIX = 'DELETE FROM decision_log WHERE id IN (';

/**
 * ⚠️ Normalise `undefined` to `null` before serialising (BR-23.4, PBT-31).
 *
 * `JSON.stringify` **drops keys whose value is `undefined`**, so a field the rule demonstrably
 * read would vanish from its own record — and a reader would take the absence for *"the rule
 * never looked at it"*, which is the opposite of what happened. `Maybe<T> = T | null` means
 * undefined is not currently reachable through `field.read`, so this is a **pin, not a fix**:
 * it starts earning its keep the day someone adds a field whose reader can return undefined.
 */
function serialiseFieldsSeen(fields: Readonly<Record<string, unknown>>): string {
  const normalised: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    normalised[key] = fields[key] === undefined ? null : fields[key];
  }
  return JSON.stringify(normalised);
}

function rowToEntry(row: DecisionRow): DecisionLogEntry {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    decidedAt: row.decided_at,
    playId: row.play_id,
    playLink: row.play_link as PlayLinkState,
    trackId: row.track_id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    ruleHash: row.rule_hash,
    verdict: row.verdict as Verdict,
    matched: row.matched !== 0,
    fieldsSeen: JSON.parse(row.fields_seen) as Record<string, unknown>,
    unknownFields: JSON.parse(row.unknown_fields) as string[],
    restedOnUnknown: row.rested_on_unknown !== 0,
    partialData: row.partial_data !== 0,
    dryRun: row.dry_run !== 0,
    executed: row.executed !== 0,
    error: row.error,
    engineVersion: row.engine_version,
    ruleSetVersion: row.rule_set_version,
    ruleSetContentHash: row.rule_set_content_hash,
  };
}

export class SqliteDecisionLogRepository implements DecisionLogRepository {
  readonly #db: DatabaseSync;
  #insert: StatementSync | null = null;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  record(entries: readonly NewDecisionLogEntry[]): void {
    if (entries.length === 0) return;

    this.#insert ??= this.#db.prepare(
      `INSERT INTO decision_log (
         evaluation_id, decided_at, play_id, play_link, track_id,
         rule_id, rule_name, rule_hash, verdict, matched,
         fields_seen, unknown_fields, rested_on_unknown, partial_data,
         dry_run, executed, error, engine_version, rule_set_version, rule_set_content_hash
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    this.#db.exec('BEGIN');
    try {
      for (const e of entries) {
        this.#insert.run(
          e.evaluationId,
          e.decidedAt,
          e.playId,
          e.playLink,
          e.trackId,
          e.ruleId,
          e.ruleName,
          e.ruleHash,
          e.verdict,
          e.matched ? 1 : 0,
          serialiseFieldsSeen(e.fieldsSeen),
          JSON.stringify(e.unknownFields),
          e.restedOnUnknown ? 1 : 0,
          e.partialData ? 1 : 0,
          e.dryRun ? 1 : 0,
          e.executed ? 1 : 0,
          e.error,
          e.engineVersion,
          e.ruleSetVersion,
          e.ruleSetContentHash,
        );
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  attachPlayId(evaluationId: string, playId: number): void {
    this.#db
      .prepare(
        `UPDATE decision_log SET play_id = ?, play_link = 'linked'
          WHERE evaluation_id = ? AND play_link = 'pending'`,
      )
      .run(playId, evaluationId);
  }

  markLinkFailed(evaluationId: string): void {
    this.#db
      .prepare(
        `UPDATE decision_log SET play_link = 'link-failed'
          WHERE evaluation_id = ? AND play_link = 'pending'`,
      )
      .run(evaluationId);
  }

  list(filter: DecisionFilter): DecisionLogEntry[] {
    const where: string[] = [];
    const args: (string | number)[] = [];

    if (filter.from !== undefined) {
      where.push('decided_at >= ?');
      args.push(filter.from);
    }
    // Half-open, matching `DateRange`: adjacent ranges partition without double-counting.
    if (filter.to !== undefined) {
      where.push('decided_at < ?');
      args.push(filter.to);
    }
    if (filter.ruleId !== undefined) {
      where.push('rule_id = ?');
      args.push(filter.ruleId);
    }
    if (filter.trackId !== undefined) {
      where.push('track_id = ?');
      args.push(filter.trackId);
    }
    if (filter.matchedOnly === true) where.push('matched = 1');
    if (filter.cursor !== undefined) {
      where.push('id < ?');
      args.push(filter.cursor);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.#db
      .prepare(`SELECT * FROM decision_log ${clause} ORDER BY id DESC LIMIT ?`)
      .all(...args, filter.limit) as unknown as DecisionRow[];

    return rows.map(rowToEntry);
  }

  countSince(sinceIso: string): number {
    const row = this.#db
      .prepare('SELECT COUNT(*) AS n FROM decision_log WHERE decided_at >= ?')
      .get(sinceIso) as { n: number };
    return row.n;
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM decision_log').get() as { n: number };
    return row.n;
  }

  /**
   * See the interface for why this is two statements. The `SELECT` is where a future retention
   * policy may join `play`; the `DELETE` may never mention it.
   */
  pruneToCap(cap: number): number {
    const total = this.count();
    if (total <= cap) return 0;

    // Oldest first. `id` is the insertion order and `decided_at` is the decision instant; they
    // agree for live writes, and `id` is the one that cannot tie.
    const ids = (
      this.#db
        .prepare(`SELECT id FROM decision_log ORDER BY id ASC LIMIT ?`)
        .all(total - cap) as unknown as { id: number }[]
    ).map((r) => r.id);

    let deleted = 0;
    this.#db.exec('BEGIN');
    try {
      for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        const chunk = ids.slice(i, i + DELETE_CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        this.#db.prepare(`${DELETE_SQL_PREFIX}${placeholders})`).run(...chunk);
        deleted += chunk.length;
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }

    return deleted;
  }
}
