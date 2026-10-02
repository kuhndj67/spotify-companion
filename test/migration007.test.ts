/**
 * Migration 007 — `skip_attempt`, the re-evaluation `trigger`, and `play.context_uri`.
 *
 * Most of these tests exist because of a specific mistake or a specific near-miss rather than for
 * coverage:
 *
 *   - **`context_type` already existed.** The design said 007 adds `context_type` *and*
 *     `context_uri`. It has been in the schema since **v1** and is already populated on backfilled
 *     rows. Re-adding it fails the `ALTER`, which aborts the migration inside its own transaction
 *     and leaves the app running **display-only** with the page still loading. Caught by the
 *     compiler during Step 1; pinned here so it cannot come back.
 *   - **The 909 existing `decision_log` rows are `initial` by construction**, supplied by the
 *     column DEFAULT and never by an `UPDATE`. A default is a statement about what the code that
 *     wrote those rows could have meant; an `UPDATE` would be a judgement *about* them.
 *   - **No `UNIQUE` anywhere** (BR-22.1a, BR-37.2). It would pass every behavioural test and then
 *     have to be dropped, making a future migration non-additive and retiring the by-image rollback
 *     guarantee — which is the recovery path for the only unit that can interrupt the music.
 *   - **Rollback leaves nothing behind.** A failed 007 must not leave a `skip_attempt` table.
 *   - **No retry column exists**, because *surface, do not retry* has to be true of the schema and
 *     not only of the code that writes it.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { MIGRATIONS, currentVersion, migrate } from '../src/history/migrations.js';

const upTo = (v: number) => MIGRATIONS.filter((m) => m.version <= v);

/**
 * ⚠️ Applies 007 AND NOTHING LATER, for the reason `migration005.test.ts` records: a test named for
 * a migration must pin that migration, or it starts asserting on whichever one happens to be newest
 * and breaks the moment 008 lands.
 */
const migrateTo7 = (db: DatabaseSync) => migrate(db, upTo(7));

/** A database at schema v6 — the state the running container is in before U5 deploys. */
function atV6(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db, upTo(6));
  return db;
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]).map(
    (r) => r.name,
  );
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { c: number };
  return row.c > 0;
}

function insertDecision(db: DatabaseSync, evaluationId: string): void {
  db.prepare(
    `INSERT INTO decision_log
       (evaluation_id, decided_at, track_id, rule_id, rule_name, rule_hash, verdict, matched,
        fields_seen, unknown_fields, rested_on_unknown, partial_data, dry_run, executed,
        engine_version, rule_set_version, rule_set_content_hash, play_link)
     VALUES (?, '2026-10-01T00:00:00.000Z', 't1', 'r1', 'Rule 1', 'rh', 'false', 0,
             '{}', '[]', 0, 0, 1, 0, 1, 1, 'hash', 'pending')`,
  ).run(evaluationId);
}

describe('migration 007 — schema v7', () => {
  it('applies once and reports v7', () => {
    const db = atV6();
    assert.equal(currentVersion(db), 6);
    const report = migrateTo7(db);
    assert.equal(currentVersion(db), 7);
    assert.ok(report.applied.some((a) => a.startsWith('7:')));
    db.close();
  });

  it('is idempotent — a second run applies nothing', () => {
    const db = atV6();
    migrateTo7(db);
    const second = migrateTo7(db);
    assert.deepEqual(second.applied, []);
    assert.equal(currentVersion(db), 7);
    db.close();
  });
});

describe('⚠️ context_type already existed; only context_uri is added', () => {
  it('context_type is present at v6, BEFORE 007 runs', () => {
    const db = atV6();
    assert.ok(
      columns(db, 'play').includes('context_type'),
      'context_type has existed since v1. If this fails, the premise of 007 has changed.',
    );
    assert.ok(!columns(db, 'play').includes('context_uri'));
    db.close();
  });

  it('007 adds context_uri and does not disturb context_type', () => {
    const db = atV6();
    migrateTo7(db);
    const cols = columns(db, 'play');
    assert.ok(cols.includes('context_uri'));
    assert.ok(cols.includes('context_type'));
    db.close();
  });

  it('⚠️ re-adding context_type would FAIL — which is why 007 must not try', () => {
    // This is the failure the design would have caused: ALTER TABLE ADD COLUMN on an existing
    // column throws, and because migrate() wraps each migration in BEGIN/COMMIT with ROLLBACK on
    // failure, the whole of 007 would abort. The app would then run display-only (NFR-13) with the
    // UI looking entirely healthy.
    const db = atV6();
    assert.throws(
      () => db.exec('ALTER TABLE play ADD COLUMN context_type TEXT'),
      /duplicate column/i,
    );
    db.close();
  });

  it('existing play rows keep NULL context_uri — never a guess', () => {
    const db = atV6();
    db.prepare(
      `INSERT INTO play
         (track_id, title, artist_name, album_name, started_at, ended_at, outcome, close_reason,
          provenance, classifier_version, ev_listened_ms, ev_duration_ms, ev_completion_ratio,
          ev_max_progress_ms, ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound,
          ev_ended_with_idle)
       VALUES ('t1','T','A','Al','2026-09-01T00:00:00.000Z','2026-09-01T00:03:00.000Z',
               'completed','track-change','live',2, 180000,180000,1.0,180000,3000,60,0,0,0)`,
    ).run();
    migrateTo7(db);
    const row = db.prepare('SELECT context_uri FROM play WHERE track_id = ?').get('t1') as {
      context_uri: string | null;
    };
    assert.equal(row.context_uri, null);
    db.close();
  });
});

describe('decision_log.trigger', () => {
  it('⚠️ existing rows become "initial" by DEFAULT, with no UPDATE', () => {
    const db = atV6();
    insertDecision(db, 'e1');
    insertDecision(db, 'e2');
    migrateTo7(db);

    const rows = db.prepare('SELECT evaluation_id, trigger FROM decision_log ORDER BY id').all() as {
      evaluation_id: string;
      trigger: string;
    }[];
    assert.deepEqual(
      rows.map((r) => r.trigger),
      ['initial', 'initial'],
    );
    const nulls = db.prepare('SELECT COUNT(*) AS c FROM decision_log WHERE trigger IS NULL').get() as {
      c: number;
    };
    assert.equal(nulls.c, 0, 'NOT NULL DEFAULT must leave no nulls on existing rows');
    db.close();
  });

  it('⚠️ "trigger" is a SQLite keyword and works unquoted in every position', () => {
    // Probed 2026-10-02 rather than assumed: CREATE TRIGGER makes this a keyword, and the kind of
    // defect it would cause is one that works in four positions and fails in the fifth.
    const db = atV6();
    migrateTo7(db);
    insertDecision(db, 'e3');
    db.prepare("UPDATE decision_log SET trigger = 'enrichment-arrived' WHERE evaluation_id = 'e3'").run();
    const row = db
      .prepare('SELECT trigger FROM decision_log WHERE trigger = ?')
      .get('enrichment-arrived') as { trigger: string };
    assert.equal(row.trigger, 'enrichment-arrived');
    db.close();
  });
});

describe('skip_attempt', () => {
  it('exists with the BR-43.2 evidence columns', () => {
    const db = atV6();
    migrateTo7(db);
    const cols = columns(db, 'skip_attempt');
    for (const expected of [
      'id',
      'evaluation_id',
      'play_id',
      'track_id',
      'rule_id',
      'state',
      'enqueued_at',
      'fired_at',
      'refused_reason',
      'reported_track_id_before',
      'reported_progress_ms_before',
      'reported_track_id_after',
      'reported_progress_ms_after',
    ]) {
      assert.ok(cols.includes(expected), `missing column ${expected}`);
    }
    db.close();
  });

  it('⚠️ has NO retry column and no attempt counter', () => {
    // FR-48 / BR-36.4: surface, do not retry. One attempt is the budget per play row, so there is
    // deliberately nothing here to increment. This must be true of the schema, not only of the code.
    const db = atV6();
    migrateTo7(db);
    const offenders = columns(db, 'skip_attempt').filter((c) =>
      /retry|retries|attempt_count|attempts/.test(c),
    );
    assert.deepEqual(offenders, []);
    db.close();
  });

  it('⚠️ carries NO UNIQUE constraint anywhere (BR-22.1a, BR-37.2)', () => {
    const db = atV6();
    migrateTo7(db);
    const indexes = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='skip_attempt'`)
      .all() as { name: string; sql: string | null }[];
    for (const ix of indexes) {
      assert.ok(
        !/unique/i.test(ix.sql ?? ''),
        `${ix.name} is UNIQUE. One-attempt-per-play is enforced in code, never by the schema — a ` +
          `UNIQUE index would have to be dropped later, making that migration non-additive and ` +
          `retiring the by-image rollback guarantee.`,
      );
    }
    const table = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='skip_attempt'`)
      .get() as { sql: string };
    assert.ok(!/UNIQUE/i.test(table.sql), 'no UNIQUE in the table definition either');
    db.close();
  });

  it('indexes the three columns that are actually queried', () => {
    const db = atV6();
    migrateTo7(db);
    const names = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='skip_attempt'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    assert.ok(names.includes('idx_skip_attempt_play'), 'BR-36.1 lookup on every drain');
    assert.ok(names.includes('idx_skip_attempt_enqueued'), 'BR-35.2 rolling window, startup sweep');
    assert.ok(names.includes('idx_skip_attempt_evaluation'), 'joining back to the decision (FR-41)');
    db.close();
  });
});

describe('⚠️ rollback: a failed 007 leaves nothing behind', () => {
  it('a throwing 007 leaves no skip_attempt table and the version at 6', () => {
    const db = atV6();
    const seven = MIGRATIONS.find((m) => m.version === 7);
    assert.ok(seven);

    // Same shape as migration005.test.ts: run the real `up`, then fail inside the same
    // transaction, and assert the rollback took the table with it.
    const sabotaged = [
      ...upTo(6),
      {
        version: 7,
        description: seven.description,
        up(d: DatabaseSync) {
          seven.up(d);
          throw new Error('simulated failure after the DDL');
        },
      },
    ];

    assert.throws(() => migrate(db, sabotaged));
    assert.equal(currentVersion(db), 6, 'version must not advance');
    assert.ok(
      !tableExists(db, 'skip_attempt'),
      'a rolled-back 007 must leave no skip_attempt table — otherwise a retry fails on a ' +
        'half-applied schema that reports v6',
    );
    assert.ok(!columns(db, 'play').includes('context_uri'));
    assert.ok(!columns(db, 'decision_log').includes('trigger'));
    db.close();
  });
});

describe('⚠️ rollback to U4: a v7 database is safe under an older image', () => {
  it('applying only migrations up to 6 against a v7 database applies nothing', () => {
    const db = atV6();
    migrateTo7(db);
    assert.equal(currentVersion(db), 7);

    // This is what U4's image does: it carries migrations 1..6 and nothing else.
    const report = migrate(db, upTo(6));
    assert.deepEqual(report.applied, [], 'an older image must apply nothing to a newer database');
    assert.equal(report.from, 7);
    assert.equal(report.to, 7);
    assert.equal(currentVersion(db), 7, 'and must not downgrade the recorded version');

    // ⚠️ This test proves the SKIP. It does not prove U4's code runs correctly against the extra
    // table and columns — those are separate claims, and the second one needs the real image.
    // Infrastructure Q3 = A requires that live check before U5 ships.
    db.close();
  });
});
