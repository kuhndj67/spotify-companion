/**
 * SQLite implementation of {@link HistoryRepository}.
 *
 * **This is the only file in the project that knows what SQLite is.** That containment is the
 * point of NFR-10's interface: `node:sqlite` is experimental in Node 22 (R10), and if its API
 * moves, this file changes and nothing else does.
 *
 * Configuration choices worth stating:
 *
 *  - **WAL journaling** so an external tool — a SQLite browser, a notebook — can read the file
 *    while the app writes. That is the practical shape of the download-only integration decision
 *    (§3.5): the user's own tools reach the data without the app opening a network path.
 *  - **`busy_timeout`** so brief contention waits rather than erroring. A reader holding the file
 *    for a moment should not cost a play record.
 *  - **Foreign keys on**, so `ON DELETE CASCADE` actually cascades when W-2's eventual trail
 *    pruning arrives. SQLite defaults this off, which is a well-known trap.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HistoryRepository } from './HistoryRepository.js';
import { migrate, type MigrationReport } from './migrations.js';
import type {
  CoverageStats,
  CloseReason,
  HistoryFilter,
  NewPlayRecord,
  Observation,
  OutcomeEvidence,
  PlayOutcome,
  PlayRecord,
  Provenance,
  SkipSource,
} from './types.js';

interface PlayRow {
  id: number;
  track_id: string;
  isrc: string | null;
  title: string;
  artist_name: string;
  artist_id: string | null;
  album_name: string;
  release_date: string | null;
  age_years: number | null;
  following: number | null;
  started_at: string;
  ended_at: string;
  outcome: string;
  close_reason: string;
  provenance: string;
  skip_source: string | null;
  context_type: string | null;
  classifier_version: number;
  ev_listened_ms: number;
  ev_duration_ms: number;
  ev_completion_ratio: number;
  ev_max_progress_ms: number;
  ev_max_gap_ms: number;
  ev_observation_count: number;
  ev_saw_pause: number;
  ev_rewound: number;
  ev_ended_with_idle: number;
}

/** SQLite has no boolean type. null must survive the round trip as null, never as 0. */
function toDbBool(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function fromDbBool(value: number | null): boolean | null {
  return value === null ? null : value !== 0;
}

function rowToRecord(row: PlayRow): PlayRecord {
  return {
    id: row.id,
    trackId: row.track_id,
    isrc: row.isrc,
    title: row.title,
    artistName: row.artist_name,
    artistId: row.artist_id,
    albumName: row.album_name,
    releaseDate: row.release_date,
    ageYears: row.age_years,
    following: fromDbBool(row.following),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    outcome: row.outcome as PlayOutcome,
    closeReason: row.close_reason as CloseReason,
    provenance: row.provenance as Provenance,
    skipSource: row.skip_source as SkipSource | null,
    contextType: row.context_type,
    classifierVersion: row.classifier_version,
    evidence: {
      listenedMs: row.ev_listened_ms,
      durationMs: row.ev_duration_ms,
      completionRatio: row.ev_completion_ratio,
      maxProgressMs: row.ev_max_progress_ms,
      maxObservationGapMs: row.ev_max_gap_ms,
      observationCount: row.ev_observation_count,
      sawPause: row.ev_saw_pause !== 0,
      rewound: row.ev_rewound !== 0,
      endedWithIdle: row.ev_ended_with_idle !== 0,
    },
  };
}

export class SqliteHistoryRepository implements HistoryRepository {
  #db: DatabaseSync;
  #migration: MigrationReport;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA busy_timeout = 5000');
    this.#db.exec('PRAGMA foreign_keys = ON');

    // Before any write. A half-migrated schema must never take data.
    this.#migration = migrate(this.#db);
  }

  get migrationReport(): MigrationReport {
    return this.#migration;
  }

  get schemaVersion(): number {
    return this.#migration.to;
  }

  /**
   * Probe writability rather than assuming it.
   *
   * Bind-mount permission problems under Rancher Desktop otherwise surface as a failure at the
   * first play boundary — minutes after startup, with the user having already seen a
   * healthy-looking UI. Failing at startup makes it immediate and diagnosable.
   */
  verifyWritable(): void {
    this.#db.exec('BEGIN');
    try {
      this.#db.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)').run('__probe__');
      this.#db.prepare("DELETE FROM recording_gap WHERE occurred_at = '__probe__'").run();
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  recordPlay(play: NewPlayRecord, trail: readonly Observation[]): number {
    this.#db.exec('BEGIN');
    try {
      const result = this.#db
        .prepare(
          `INSERT INTO play (
             track_id, isrc, title, artist_name, artist_id, album_name, release_date,
             age_years, following, started_at, ended_at, outcome, close_reason, provenance,
             skip_source, context_type, classifier_version,
             ev_listened_ms, ev_duration_ms, ev_completion_ratio, ev_max_progress_ms,
             ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound, ev_ended_with_idle
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          play.trackId,
          play.isrc,
          play.title,
          play.artistName,
          play.artistId,
          play.albumName,
          play.releaseDate,
          play.ageYears,
          toDbBool(play.following),
          play.startedAt,
          play.endedAt,
          play.outcome,
          play.closeReason,
          play.provenance,
          play.skipSource,
          play.contextType,
          play.classifierVersion,
          play.evidence.listenedMs,
          play.evidence.durationMs,
          play.evidence.completionRatio,
          play.evidence.maxProgressMs,
          play.evidence.maxObservationGapMs,
          play.evidence.observationCount,
          play.evidence.sawPause ? 1 : 0,
          play.evidence.rewound ? 1 : 0,
          play.evidence.endedWithIdle ? 1 : 0,
        );

      const playId = Number(result.lastInsertRowid);

      const insertObservation = this.#db.prepare(
        `INSERT INTO observation (play_id, sequence, at_ms, progress_ms, duration_ms, is_playing)
         VALUES (?,?,?,?,?,?)`,
      );
      for (const [index, observation] of trail.entries()) {
        insertObservation.run(
          playId,
          index,
          observation.atMs,
          observation.progressMs,
          observation.durationMs,
          observation.isPlaying ? 1 : 0,
        );
      }

      this.#db.exec('COMMIT');
      return playId;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  getPlay(id: number): PlayRecord | null {
    const row = this.#db.prepare('SELECT * FROM play WHERE id = ?').get(id) as PlayRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * Generator, so callers iterate lazily and memory stays constant regardless of history size.
   *
   * `node:sqlite` has no cursor API, so this pages through in blocks by id rather than reading
   * everything at once. The paging is invisible to callers, who simply iterate.
   */
  *listPlays(filter: HistoryFilter = {}): IterableIterator<PlayRecord> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.since) {
      conditions.push('started_at >= ?');
      params.push(filter.since);
    }
    if (filter.until) {
      conditions.push('started_at <= ?');
      params.push(filter.until);
    }
    if (filter.outcome) {
      conditions.push('outcome = ?');
      params.push(filter.outcome);
    }

    const PAGE = 500;
    let afterId = 0;
    let yielded = 0;

    for (;;) {
      const where = [...conditions, 'id > ?'];
      const statement = this.#db.prepare(
        `SELECT * FROM play WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ${PAGE}`,
      );
      const rows = statement.all(...params, afterId) as unknown as PlayRow[];
      if (rows.length === 0) return;

      for (const row of rows) {
        yield rowToRecord(row);
        afterId = row.id;
        yielded++;
        if (filter.limit !== undefined && yielded >= filter.limit) return;
      }

      if (rows.length < PAGE) return;
    }
  }

  getTrail(playId: number): Observation[] {
    const rows = this.#db
      .prepare(
        `SELECT at_ms, progress_ms, duration_ms, is_playing
         FROM observation WHERE play_id = ? ORDER BY sequence ASC`,
      )
      .all(playId) as {
      at_ms: number;
      progress_ms: number;
      duration_ms: number;
      is_playing: number;
    }[];

    const play = this.#db.prepare('SELECT track_id FROM play WHERE id = ?').get(playId) as
      | { track_id: string }
      | undefined;

    return rows.map((row) => ({
      atMs: row.at_ms,
      trackId: play?.track_id ?? '',
      progressMs: row.progress_ms,
      durationMs: row.duration_ms,
      isPlaying: row.is_playing !== 0,
    }));
  }

  updateOutcome(
    playId: number,
    outcome: PlayOutcome,
    evidence: OutcomeEvidence,
    classifierVersion: number,
  ): void {
    // Observations are deliberately untouched: they are facts, and only the verdict is
    // provisional (BR-4.2).
    this.#db
      .prepare(
        `UPDATE play SET
           outcome = ?, classifier_version = ?,
           ev_listened_ms = ?, ev_duration_ms = ?, ev_completion_ratio = ?,
           ev_max_progress_ms = ?, ev_max_gap_ms = ?, ev_observation_count = ?,
           ev_saw_pause = ?, ev_rewound = ?, ev_ended_with_idle = ?
         WHERE id = ?`,
      )
      .run(
        outcome,
        classifierVersion,
        evidence.listenedMs,
        evidence.durationMs,
        evidence.completionRatio,
        evidence.maxProgressMs,
        evidence.maxObservationGapMs,
        evidence.observationCount,
        evidence.sawPause ? 1 : 0,
        evidence.rewound ? 1 : 0,
        evidence.endedWithIdle ? 1 : 0,
        playId,
      );
  }

  hasPlayNear(trackId: string, startedAt: string, toleranceMs: number): boolean {
    const target = Date.parse(startedAt);
    if (Number.isNaN(target)) return false;

    const rows = this.#db
      .prepare('SELECT started_at FROM play WHERE track_id = ?')
      .all(trackId) as { started_at: string }[];

    return rows.some((row) => {
      const existing = Date.parse(row.started_at);
      return !Number.isNaN(existing) && Math.abs(existing - target) <= toleranceMs;
    });
  }

  coverage(): CoverageStats {
    const count = (sql: string): number => {
      const row = this.#db.prepare(sql).get() as { n: number } | undefined;
      return row?.n ?? 0;
    };

    return {
      totalPlays: count('SELECT COUNT(*) AS n FROM play'),
      byOutcome: {
        completed: count("SELECT COUNT(*) AS n FROM play WHERE outcome = 'completed'"),
        skipped: count("SELECT COUNT(*) AS n FROM play WHERE outcome = 'skipped'"),
        unknown: count("SELECT COUNT(*) AS n FROM play WHERE outcome = 'unknown'"),
      },
      byProvenance: {
        live: count("SELECT COUNT(*) AS n FROM play WHERE provenance = 'live'"),
        backfilled: count("SELECT COUNT(*) AS n FROM play WHERE provenance = 'backfilled'"),
      },
      unknownIsrc: count('SELECT COUNT(*) AS n FROM play WHERE isrc IS NULL'),
      unknownFollowing: count('SELECT COUNT(*) AS n FROM play WHERE following IS NULL'),
      unknownReleaseDate: count('SELECT COUNT(*) AS n FROM play WHERE release_date IS NULL'),
      unknownSkipSource: count('SELECT COUNT(*) AS n FROM play WHERE skip_source IS NULL'),
      countedGaps: count('SELECT COUNT(*) AS n FROM recording_gap'),
    };
  }

  recordGap(): void {
    try {
      this.#db
        .prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)')
        .run(new Date().toISOString());
    } catch {
      // If the gap counter itself cannot be written the database is unusable; the caller has
      // already degraded to display-only, and throwing here would add nothing.
    }
  }

  close(): void {
    this.#db.close();
  }
}
