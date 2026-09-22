/**
 * Migration 005 — the decision log, the two `play` columns rules read, and the schema-era
 * watermark.
 *
 * Three of these tests exist because of specific mistakes rather than for coverage:
 *
 *   - **The watermark is a row id, not a date** (BR-27.5c). The backfill writes rows dated in
 *     the past, so a date-based era test marks real data unanswerable.
 *   - **No `UNIQUE` constraint** (BR-22.1a). It would pass every behavioural test in U4 and
 *     then have to be dropped in U5 — a non-additive migration, which retires the by-image
 *     rollback guarantee.
 *   - **Rollback leaves nothing behind.** The watermark is written in the migration's own
 *     transaction, so a failed 005 must not leave a `meta` row for columns that do not exist.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { MIGRATIONS, currentVersion, migrate } from '../src/history/migrations.js';

const upTo = (v: number) => MIGRATIONS.filter((m) => m.version <= v);

/**
 * ⚠️ These tests are about migration 005 specifically, so they apply 005 AND NOTHING LATER.
 * Calling bare `migrate(db)` made them assert on whatever the newest migration happened to be,
 * which broke the moment 006 landed — and would have kept breaking on every future one. A test
 * named for a migration should pin that migration.
 */
const migrateTo5 = (db: DatabaseSync) => migrate(db, upTo(5));

/** A database at schema v4, i.e. the state the running container is in today. */
function atV4(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db, upTo(4));
  return db;
}

function insertPlay(db: DatabaseSync, trackId: string, startedAt: string): number {
  const result = db
    .prepare(
      `INSERT INTO play (track_id, title, artist_name, album_name, started_at, ended_at,
                         outcome, close_reason, provenance, classifier_version,
                         ev_listened_ms, ev_duration_ms, ev_completion_ratio, ev_max_progress_ms,
                         ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound,
                         ev_ended_with_idle)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(trackId, 't', 'a', 'al', startedAt, startedAt, 'unknown', 'track-change', 'live', 1,
         0, 0, 0, 0, 0, 1, 0, 0, 0);
  return Number(result.lastInsertRowid);
}

describe('migration 005', () => {
  it('takes a v4 database to v5', () => {
    const db = atV4();
    assert.equal(currentVersion(db), 4);

    const report = migrateTo5(db);

    assert.equal(report.from, 4);
    assert.equal(report.to, 5);
    assert.equal(report.applied.length, 1);
    assert.match(report.applied[0]!, /^5: /);
  });

  it('is idempotent — a second run applies nothing', () => {
    const db = atV4();
    migrateTo5(db);

    const second = migrateTo5(db);

    assert.deepEqual(second.applied, []);
    assert.equal(second.from, 5);
    assert.equal(second.to, 5);
  });

  it('adds explicit and album_type to play, both nullable', () => {
    const db = atV4();
    migrateTo5(db);

    const columns = db.prepare('PRAGMA table_info(play)').all() as { name: string; notnull: number }[];
    const explicit = columns.find((c) => c.name === 'explicit');
    const albumType = columns.find((c) => c.name === 'album_type');

    assert.ok(explicit, 'play.explicit exists');
    assert.ok(albumType, 'play.album_type exists');
    // ⚠️ NOT NULL would force a default, and every default here is a fabricated fact:
    // `false` asserts "not explicit" about a row nobody asked.
    assert.equal(explicit!.notnull, 0);
    assert.equal(albumType!.notnull, 0);
  });

  it('leaves pre-existing rows null rather than defaulting them', () => {
    const db = atV4();
    insertPlay(db, 'track-before', '2026-08-20T10:00:00.000Z');

    migrateTo5(db);

    const row = db.prepare('SELECT explicit, album_type FROM play WHERE track_id = ?')
      .get('track-before') as { explicit: number | null; album_type: string | null };
    assert.equal(row.explicit, null);
    assert.equal(row.album_type, null);
  });

  describe('the schema-era watermark', () => {
    it('records the highest play id that existed before the migration', () => {
      const db = atV4();
      insertPlay(db, 'a', '2026-08-20T10:00:00.000Z');
      const last = insertPlay(db, 'b', '2026-08-21T10:00:00.000Z');

      migrateTo5(db);

      const row = db.prepare("SELECT value FROM meta WHERE key = 'v5_watermark_play_id'")
        .get() as { value: string };
      assert.equal(row.value, String(last));
    });

    it('is 0 on an empty database, not null or absent', () => {
      const db = atV4();

      migrateTo5(db);

      const row = db.prepare("SELECT value FROM meta WHERE key = 'v5_watermark_play_id'")
        .get() as { value: string } | undefined;
      assert.equal(row?.value, '0');
    });

    /**
     * ⚠️ The reason the watermark is an id and not a date. The 6-hourly backfill inserts rows
     * dated in the past, so a row written AFTER v5 for a play that happened BEFORE it carries
     * both new values honestly. Judging era by `started_at` would call that row unanswerable.
     */
    it('puts a post-v5 row for an OLD play above the watermark', () => {
      const db = atV4();
      insertPlay(db, 'old-and-pre-v5', '2026-08-20T10:00:00.000Z');
      migrateTo5(db);

      const backfilledLater = insertPlay(db, 'old-but-post-v5', '2026-08-19T10:00:00.000Z');

      const watermark = Number(
        (db.prepare("SELECT value FROM meta WHERE key = 'v5_watermark_play_id'")
          .get() as { value: string }).value,
      );
      assert.ok(
        backfilledLater > watermark,
        'a row inserted after the migration is post-v5 however old the play is',
      );
    });
  });

  describe('the decision log', () => {
    it('accepts a row whose play_id is null', () => {
      const db = atV4();
      migrateTo5(db);

      // BR-24.1: the decision precedes its play row by seconds to minutes.
      assert.doesNotThrow(() =>
        db
          .prepare(
            `INSERT INTO decision_log (evaluation_id, decided_at, play_id, play_link, track_id,
                                       rule_id, rule_name, rule_hash, verdict, matched,
                                       fields_seen, unknown_fields, rested_on_unknown,
                                       partial_data, dry_run, executed, error, engine_version,
                                       rule_set_version, rule_set_content_hash)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run('ev1', '2026-09-20T10:00:00.000Z', null, 'pending', 'track1', 'r1', 'Rule One',
               'hash1', 'true', 1, '{}', '[]', 0, 0, 1, 0, null, 1, 1, 'sethash'),
      );
    });

    /**
     * ⚠️ BR-22.1a. One decision per play is a **U4** invariant enforced by the coordinator.
     * FR-34 is a Must and makes U5 write a second decision for one play legitimately; a
     * constraint here would have to be dropped, and dropping one is non-additive.
     */
    it('has NO unique constraint that would forbid a second decision per play', () => {
      const db = atV4();
      migrateTo5(db);

      const indexes = db.prepare('PRAGMA index_list(decision_log)').all() as { unique: number }[];
      const unique = indexes.filter((i) => i.unique === 1);

      assert.deepEqual(
        unique.map((i) => i),
        [],
        'a UNIQUE index here would have to be dropped in U5, and dropping is non-additive',
      );
    });

    it('creates the three indexes the listing, grouping and back-fill paths need', () => {
      const db = atV4();
      migrateTo5(db);

      const names = (db.prepare('PRAGMA index_list(decision_log)').all() as { name: string }[])
        .map((i) => i.name);

      for (const expected of [
        'idx_decision_decided_at',
        'idx_decision_evaluation',
        'idx_decision_play',
      ]) {
        assert.ok(names.includes(expected), `${expected} exists`);
      }
    });
  });

  /**
   * ⚠️ The watermark is written inside the migration's own transaction. If 005 fails partway,
   * a `meta` row claiming a v5 era must not survive for columns that were rolled back.
   */
  it('leaves no watermark behind when the migration fails', () => {
    const db = atV4();
    const doomed = {
      version: 5,
      description: 'deliberately broken 005',
      up(d: DatabaseSync) {
        d.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        d.exec("INSERT INTO meta (key, value) VALUES ('v5_watermark_play_id', '0')");
        d.exec('SELECT this_is_not_valid_sql(');
      },
    };

    assert.throws(() => migrate(db, [...upTo(4), doomed]));

    assert.equal(currentVersion(db), 4);
    const metaExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
      .get();
    assert.equal(metaExists, undefined, 'a rolled-back 005 leaves no meta table');
  });
});
