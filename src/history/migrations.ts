/**
 * Forward-only schema migration (NFR-12).
 *
 * ## Why forward-only
 *
 * There are no `down` migrations. Reversing a migration over irreplaceable data is a trap
 * dressed as a safety net: the rollback that looks reassuring in a code review is the one that
 * deletes months of listening history when someone runs it by mistake.
 *
 * ## Why migrations exist from day one
 *
 * The schema grows per phase (Application Design Q4 = B): U2 adds label columns, U5 adds rule
 * attribution. Exercising the migration path from U1 means it is proven before U2's backfill
 * depends on it, rather than first attempted under pressure against real accumulated data.
 *
 * ## Migration 001 creates exactly what U1 needs and nothing more
 *
 * No speculative label or rule columns sitting null. Each phase's schema is informed by what the
 * previous one taught.
 */

import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  description: string;
  up(db: DatabaseSync): void;
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'listening history: play, observation, gap counter',
    up(db) {
      db.exec(`
        CREATE TABLE play (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id             TEXT    NOT NULL,
          isrc                 TEXT,
          title                TEXT    NOT NULL,
          artist_name          TEXT    NOT NULL,
          artist_id            TEXT,
          album_name           TEXT    NOT NULL,
          release_date         TEXT,
          age_years            INTEGER,
          following            INTEGER,
          started_at           TEXT    NOT NULL,
          ended_at             TEXT    NOT NULL,
          outcome              TEXT    NOT NULL
                                 CHECK (outcome IN ('completed','skipped','unknown')),
          close_reason         TEXT    NOT NULL,
          provenance           TEXT    NOT NULL
                                 CHECK (provenance IN ('live','backfilled')),
          skip_source          TEXT    CHECK (skip_source IN ('user','rule')),
          context_type         TEXT,
          classifier_version   INTEGER NOT NULL,
          ev_listened_ms       INTEGER NOT NULL,
          ev_duration_ms       INTEGER NOT NULL,
          ev_completion_ratio  REAL    NOT NULL,
          ev_max_progress_ms   INTEGER NOT NULL,
          ev_max_gap_ms        INTEGER NOT NULL,
          ev_observation_count INTEGER NOT NULL,
          ev_saw_pause         INTEGER NOT NULL,
          ev_rewound           INTEGER NOT NULL,
          ev_ended_with_idle   INTEGER NOT NULL
        );

        CREATE TABLE observation (
          play_id     INTEGER NOT NULL REFERENCES play(id) ON DELETE CASCADE,
          sequence    INTEGER NOT NULL,
          at_ms       INTEGER NOT NULL,
          progress_ms INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          is_playing  INTEGER NOT NULL,
          PRIMARY KEY (play_id, sequence)
        );

        CREATE INDEX idx_play_started ON play(started_at);
        CREATE INDEX idx_play_track   ON play(track_id);
        CREATE INDEX idx_play_isrc    ON play(isrc);
        CREATE INDEX idx_play_outcome ON play(outcome);

        CREATE TABLE recording_gap (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          occurred_at TEXT NOT NULL
        );
      `);
    },
  },
];

/**
 * `idx_play_isrc` is created here, before U2 exists, deliberately. The label backfill scans for
 * plays that have an ISRC and no label; without the index that is a full table scan over a
 * growing table, repeated for every batch.
 */

export function currentVersion(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

/**
 * Apply pending migrations in order.
 *
 * Called at startup **before** anything subscribes to the tick stream. A half-migrated schema
 * must never accept writes — the resulting rows would be structurally wrong in a way that is hard
 * to detect and impossible to undo, so refusing to write is correct even though it means running
 * degraded.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
  nowIso: string = new Date().toISOString(),
): MigrationReport {
  const from = currentVersion(db);
  const applied: string[] = [];

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;

    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        nowIso,
      );
      db.exec('COMMIT');
      applied.push(`${migration.version}: ${migration.description}`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.version} (${migration.description}) failed: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return { from, to: currentVersion(db), applied };
}
