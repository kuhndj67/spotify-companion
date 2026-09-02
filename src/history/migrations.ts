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
  {
    version: 2,
    description: 'label enrichment: versioned resolutions, liked evidence',
    up(db) {
      db.exec(`
        -- ============================================================================
        -- Cached MusicBrainz facts. APPEND-ONLY (BR-13.1).
        --
        -- Re-resolving inserts a NEW ROW rather than replacing the old one, because two
        -- different things are both called "the data changed":
        --
        --   our knowledge changed  a volunteer catalogued a release we could not see
        --                          -> the old verdict was WRONG, prefer the new one
        --   the world changed      the artist signed to a major
        --                          -> the old verdict was RIGHT FOR ITS TIME, keep it
        --
        -- MusicBrainz cannot tell you which occurred: a lookup that 404'd in August and
        -- returns Atlantic in January is byte-identical either way. So both readings are
        -- kept and the choice is made per level at analysis time (BR-13.6).
        -- ============================================================================

        CREATE TABLE label_resolution (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          isrc           TEXT    NOT NULL,
          recording_mbid TEXT,
          match_method   TEXT    NOT NULL
                           CHECK (match_method IN ('isrc','search','none')),
          narrowing_tier TEXT    NOT NULL
                           CHECK (narrowing_tier IN ('title-date','title','all','none')),
          release_count  INTEGER NOT NULL DEFAULT 0,
          resolved_at    TEXT    NOT NULL,
          status         TEXT    NOT NULL
                           CHECK (status IN ('resolved','not-found','error')),
          supersedes_id  INTEGER REFERENCES label_resolution(id),
          -- Idempotence guard for BR-8.6: a backfill re-run that resolved the same ISRC
          -- twice in the same instant would otherwise silently double the candidate set.
          UNIQUE (isrc, resolved_at)
        );

        -- Candidates key to the RESOLUTION VERSION, never to the ISRC (BR-13.2). Keyed to
        -- the ISRC they would accumulate across every resolution, and BR-8.7's
        -- reclassification would fold 2026 facts together with 2027 facts and vote on the
        -- union -- a verdict derived from a world-state that never existed at any moment.
        CREATE TABLE label_candidate (
          resolution_id  INTEGER NOT NULL
                           REFERENCES label_resolution(id) ON DELETE CASCADE,
          label_name     TEXT    NOT NULL,
          label_mbid     TEXT,
          label_type     TEXT,
          catalog_number TEXT,
          release_id     TEXT    NOT NULL,
          release_title  TEXT,
          release_date   TEXT,
          release_status TEXT
        );

        CREATE TABLE artist_label_resolution (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          spotify_artist_id TEXT    NOT NULL,
          artist_mbid       TEXT,
          release_count     INTEGER NOT NULL DEFAULT 0,
          named_label_count INTEGER NOT NULL DEFAULT 0,
          resolved_at       TEXT    NOT NULL,
          status            TEXT    NOT NULL
                              CHECK (status IN ('resolved','not-found','error')),
          supersedes_id     INTEGER REFERENCES artist_label_resolution(id),
          UNIQUE (spotify_artist_id, resolved_at)
        );

        CREATE TABLE artist_label (
          resolution_id INTEGER NOT NULL
                          REFERENCES artist_label_resolution(id) ON DELETE CASCADE,
          label_name    TEXT    NOT NULL,
          label_mbid    TEXT,
          label_type    TEXT,
          release_count INTEGER NOT NULL DEFAULT 0
        );

        -- Votes are split by scope rather than carrying a scope column, because once they key
        -- to a resolution_id a single column would have to point into TWO tables. SQLite
        -- cannot express a polymorphic foreign key and therefore cannot enforce it; six
        -- columns of duplication buys a real REFERENCES with cascade on both.
        CREATE TABLE label_signal_vote (
          resolution_id INTEGER NOT NULL
                          REFERENCES label_resolution(id) ON DELETE CASCADE,
          signal        TEXT    NOT NULL
                          CHECK (signal IN ('major-root-list','label-relationship','isrc-prefix')),
          verdict       TEXT    NOT NULL
                          CHECK (verdict IN ('major','independent','unknown')),
          strength      TEXT    NOT NULL CHECK (strength IN ('strong','weak')),
          evidence      TEXT
        );

        CREATE TABLE artist_label_signal_vote (
          resolution_id INTEGER NOT NULL
                          REFERENCES artist_label_resolution(id) ON DELETE CASCADE,
          signal        TEXT    NOT NULL
                          CHECK (signal IN ('major-root-list','label-relationship','isrc-prefix')),
          verdict       TEXT    NOT NULL
                          CHECK (verdict IN ('major','independent','unknown')),
          strength      TEXT    NOT NULL CHECK (strength IN ('strong','weak')),
          evidence      TEXT
        );

        -- ============================================================================
        -- The derived snapshot on the play: AS-OF-PLAY, immutable once written (BR-8.4a).
        --
        -- Every column is nullable and NULL means UNKNOWN -- never false, never 0, end to
        -- end including exports, where it renders as the literal token "unknown". Missing
        -- data here is correlated with the variable being measured (R2), so a blank that
        -- reads as "no" would manufacture the finding.
        -- ============================================================================

        ALTER TABLE play ADD COLUMN label_verdict TEXT
          CHECK (label_verdict IN ('major','independent','unknown'));
        ALTER TABLE play ADD COLUMN label_confidence TEXT
          CHECK (label_confidence IN ('high','medium','low'));
        ALTER TABLE play ADD COLUMN label_contested INTEGER;
        ALTER TABLE play ADD COLUMN label_names TEXT;
        ALTER TABLE play ADD COLUMN label_match_method TEXT;
        ALTER TABLE play ADD COLUMN label_narrowing_tier TEXT;
        ALTER TABLE play ADD COLUMN label_unknown_reason TEXT;
        ALTER TABLE play ADD COLUMN artist_label_verdict TEXT
          CHECK (artist_label_verdict IN ('major','independent','unknown'));
        ALTER TABLE play ADD COLUMN artist_label_confidence TEXT
          CHECK (artist_label_confidence IN ('high','medium','low'));
        ALTER TABLE play ADD COLUMN artist_label_names TEXT;
        ALTER TABLE play ADD COLUMN label_classifier_version INTEGER;

        -- Pointers to the EXACT versions the verdict came from (BR-13.4). These replace the
        -- label_resolved_at timestamp proposed at NFR Design: a pointer is strictly more
        -- informative and cannot drift out of step with the row it describes. They are also
        -- what lets BR-12's trace reconstruct the derivation from the candidates that
        -- version actually held, rather than from whatever the current ones happen to be.
        ALTER TABLE play ADD COLUMN label_resolution_id INTEGER
          REFERENCES label_resolution(id);
        ALTER TABLE play ADD COLUMN artist_label_resolution_id INTEGER
          REFERENCES artist_label_resolution(id);

        -- Liked evidence. NULL means unknown and NEVER false: the saved-track set can be
        -- unavailable, and a false written in its place would read as an observed choice
        -- and is unrecoverable (BR-9.5).
        ALTER TABLE play ADD COLUMN liked_at_start INTEGER;
        ALTER TABLE play ADD COLUMN liked_at_end INTEGER;
        ALTER TABLE play ADD COLUMN liked_added_at TEXT;
        ALTER TABLE play ADD COLUMN liked_transition TEXT
          CHECK (liked_transition IN
            ('liked-during','unliked-during','kept-liked','kept-unliked','unknown'));

        -- The current version for a key is ORDER BY resolved_at DESC LIMIT 1 (BR-13.3).
        -- There is deliberately NO is_current flag: a maintained flag has to be updated on
        -- every insert, and its failure mode is two rows both claiming to be current, which
        -- reads as valid data. A query cannot go stale.
        CREATE INDEX idx_label_resolution_key
          ON label_resolution(isrc, resolved_at DESC);
        CREATE INDEX idx_artist_resolution_key
          ON artist_label_resolution(spotify_artist_id, resolved_at DESC);
        CREATE INDEX idx_label_candidate_res ON label_candidate(resolution_id);
        CREATE INDEX idx_artist_label_res    ON artist_label(resolution_id);
        CREATE INDEX idx_label_vote_res      ON label_signal_vote(resolution_id);
        CREATE INDEX idx_artist_vote_res     ON artist_label_signal_vote(resolution_id);
        CREATE INDEX idx_play_label_verdict  ON play(label_verdict);
        CREATE INDEX idx_play_artist_id      ON play(artist_id);
      `);
    },
  },
  {
    version: 3,
    description: 'artist genres from MusicBrainz (Spotify no longer supplies them)',
    up(db) {
      db.exec(`
        -- Spotify's GET /artists/{id} returns NO genres field at all -- one of this project's
        -- four documentation-vs-reality catches. MusicBrainz has them, and we are already
        -- talking to it for labels, so a genre is one extra request per distinct artist per
        -- TTL window rather than a new integration.
        --
        -- Stored as a JSON array of {name, count}. The count is MusicBrainz's vote tally, kept
        -- rather than discarded because it separates "four people agree this is hard rock"
        -- from one person's opinion -- and because U3's rules will want to threshold on it.
        --
        -- NULL means unknown, as everywhere else. An empty array means "we asked and there are
        -- none", which is a different fact.
        ALTER TABLE artist_label_resolution ADD COLUMN genres TEXT;

        -- The as-of-play snapshot, same immutability rule as the label columns (BR-8.4a).
        ALTER TABLE play ADD COLUMN artist_genres TEXT;
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
