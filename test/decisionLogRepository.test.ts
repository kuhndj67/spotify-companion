/**
 * The decision log's storage (LC-13) — round-trip, the link states, and the fenced prune.
 *
 * ⚠️ Two tests here assert on **SQL text** rather than behaviour, which is unusual and
 * deliberate. `pruneToCap`'s safety property is *"the DELETE cannot reach `play`"*, and a
 * single statement that joined and deleted would satisfy every behavioural assertion in this
 * file while losing the property completely. Same reasoning as `localGuard.test.ts` pinning the
 * upgrade handler structurally.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { migrate } from '../src/history/migrations.js';
import {
  DELETE_SQL_PREFIX,
  SqliteDecisionLogRepository,
} from '../src/rules/SqliteDecisionLogRepository.js';
import { RULE_ENGINE_VERSION, type NewDecisionLogEntry } from '../src/rules/types.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return db;
}

/** A real `play` row. `decision_log.play_id` is a foreign key, so an invented id is refused. */
function insertPlay(db: DatabaseSync): number {
  const result = db
    .prepare(
      `INSERT INTO play (track_id, title, artist_name, album_name, started_at, ended_at,
                         outcome, close_reason, provenance, classifier_version,
                         ev_listened_ms, ev_duration_ms, ev_completion_ratio, ev_max_progress_ms,
                         ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound,
                         ev_ended_with_idle)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run('abcdefghijklmnopqrstuv', 't', 'a', 'al', '2026-09-20T10:00:00.000Z',
         '2026-09-20T10:03:00.000Z', 'completed', 'track-change', 'live', 1,
         0, 0, 0, 0, 0, 1, 0, 0, 0);
  return Number(result.lastInsertRowid);
}

function entry(overrides: Partial<NewDecisionLogEntry> = {}): NewDecisionLogEntry {
  return {
    evaluationId: 'ev-1',
    decidedAt: '2026-09-20T10:00:00.000Z',
    playId: null,
    playLink: 'pending',
    trackId: 'abcdefghijklmnopqrstuv',
    ruleId: 'skip-majors',
    ruleName: 'Skip majors',
    ruleHash: 'hash-1',
    verdict: 'true',
    matched: true,
    fieldsSeen: { 'label.classification': 'major' },
    unknownFields: [],
    restedOnUnknown: false,
    partialData: false,
    dryRun: true,
    executed: false,
    error: null,
    engineVersion: RULE_ENGINE_VERSION,
    ruleSetVersion: 1,
    ruleSetContentHash: 'set-hash-1',
    trigger: 'initial',
    ...overrides,
  };
}

describe('SqliteDecisionLogRepository — round trip', () => {
  it('reads back what it wrote, by value', () => {
    const repo = new SqliteDecisionLogRepository(freshDb());
    const written = entry();

    repo.record([written]);
    const [read] = repo.list({ limit: 10 });

    assert.ok(read);
    /*
     * ⚠️ `title` is excluded alongside `id`, and is ASSERTED SEPARATELY rather than quietly dropped.
     *
     * It is not a stored field: `decision_log` has no title column, and the repository looks it up from
     * `play` at read time — which is why `NewDecisionLogEntry` omits it. Removing it from this
     * comparison without saying anything would weaken the one test whose job is *every stored field
     * round-trips*, by making it silently tolerant of any future derived field too.
     */
    const { id: _id, title, ...stored } = read;
    assert.deepEqual(stored, written, 'every STORED field round-trips by value');
    assert.equal(title, null, 'and `title` is derived: no play row was inserted here, so it is unknown');
  });

  it('writes one row per rule evaluated, sharing an evaluationId', () => {
    const repo = new SqliteDecisionLogRepository(freshDb());

    repo.record([
      entry({ ruleId: 'a', matched: true }),
      entry({ ruleId: 'b', matched: false, verdict: 'false' }),
      entry({ ruleId: 'c', matched: false, verdict: 'unknown' }),
    ]);

    const rows = repo.list({ limit: 10 });
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((r) => r.evaluationId)).size, 1);
  });

  /**
   * ⚠️ BR-23.4 / PBT-31. `JSON.stringify` drops keys whose value is `undefined`, so a field the
   * rule demonstrably read would vanish from its own record — and the absence reads as "the
   * rule never looked at it", which is the opposite of what happened.
   */
  it('keeps every field it was given, writing unknowns as an explicit null', () => {
    const repo = new SqliteDecisionLogRepository(freshDb());

    repo.record([
      entry({
        fieldsSeen: {
          'label.classification': null,
          'artist.genres': undefined,
          'track.explicit': false,
        },
      }),
    ]);

    const [read] = repo.list({ limit: 1 });
    const seen = read!.fieldsSeen;

    assert.deepEqual(Object.keys(seen).sort(), [
      'artist.genres',
      'label.classification',
      'track.explicit',
    ]);
    assert.equal(seen['label.classification'], null);
    assert.equal(seen['artist.genres'], null, 'undefined must survive as an explicit null');
    assert.equal(seen['track.explicit'], false, 'false is not unknown');
  });

  it('rolls the whole decision back if one row fails', () => {
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);

    assert.throws(() =>
      repo.record([
        entry({ ruleId: 'a' }),
        // verdict is NOT NULL in the schema.
        entry({ ruleId: 'b', verdict: null as unknown as 'true' }),
      ]),
    );

    assert.equal(repo.count(), 0, 'a decision whose own account is partial is worse than none');
  });
});

describe('the play link (BR-24.1, BR-24.3a)', () => {
  it('starts pending and becomes linked when the play closes', () => {
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    repo.record([entry({ evaluationId: 'ev-x' })]);

    const playId = insertPlay(db);

    repo.attachPlayId('ev-x', playId);

    const [read] = repo.list({ limit: 1 });
    assert.equal(read!.playId, playId);
    assert.equal(read!.playLink, 'linked');
  });

  /**
   * ⚠️ The distinction the column exists for. `PlayObserver` fires `onPlayRecorded` only after
   * `recordPlay` succeeds, so a failed write leaves `playId` null for ever — identical to a
   * play that never closed, which is an expected W-3 case rather than a fault.
   */
  it('records a failed write as link-failed, not as a pending link', () => {
    const repo = new SqliteDecisionLogRepository(freshDb());
    repo.record([entry({ evaluationId: 'ev-y' })]);

    repo.markLinkFailed('ev-y');

    const [read] = repo.list({ limit: 1 });
    assert.equal(read!.playId, null);
    assert.equal(read!.playLink, 'link-failed');
    assert.notEqual(read!.playLink, 'pending', 'a fault must not look like "still waiting"');
  });

  it('does not overwrite a link that already succeeded', () => {
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    const playId = insertPlay(db);
    repo.record([entry({ evaluationId: 'ev-z', playId, playLink: 'linked' })]);

    repo.markLinkFailed('ev-z');

    assert.equal(repo.list({ limit: 1 })[0]!.playLink, 'linked');
  });
});

describe('filtering', () => {
  it('returns only matched rows when asked', () => {
    const repo = new SqliteDecisionLogRepository(freshDb());
    repo.record([entry({ ruleId: 'a', matched: true }), entry({ ruleId: 'b', matched: false })]);

    const rows = repo.list({ limit: 10, matchedOnly: true });

    assert.deepEqual(rows.map((r) => r.ruleId), ['a']);
  });

  it('treats the range as half-open, so adjacent ranges do not double-count', () => {
    const repo = new SqliteDecisionLogRepository(freshDb());
    repo.record([entry({ decidedAt: '2026-09-20T00:00:00.000Z' })]);

    const inclusiveStart = repo.list({ limit: 10, from: '2026-09-20T00:00:00.000Z' });
    const exclusiveEnd = repo.list({ limit: 10, to: '2026-09-20T00:00:00.000Z' });

    assert.equal(inclusiveStart.length, 1, '[from is inclusive');
    assert.equal(exclusiveEnd.length, 0, 'to) is exclusive');
  });
});

describe('pruneToCap (BR-29)', () => {
  function withRows(n: number): SqliteDecisionLogRepository {
    const repo = new SqliteDecisionLogRepository(freshDb());
    repo.record(
      Array.from({ length: n }, (_, i) =>
        entry({ evaluationId: `ev-${i}`, ruleId: `rule-${i}` }),
      ),
    );
    return repo;
  }

  it('does nothing while under the cap', () => {
    const repo = withRows(10);

    assert.equal(repo.pruneToCap(100), 0);
    assert.equal(repo.count(), 10);
  });

  it('prunes oldest-first down to exactly the cap', () => {
    const repo = withRows(20);

    const deleted = repo.pruneToCap(5);

    assert.equal(deleted, 15);
    assert.equal(repo.count(), 5);
    const remaining = repo.list({ limit: 100 }).map((r) => r.ruleId);
    assert.deepEqual(remaining, ['rule-19', 'rule-18', 'rule-17', 'rule-16', 'rule-15']);
  });

  /** ⚠️ BR-29.5. The case that matters is the first prune after a long unattended stretch. */
  it('chunks a delete list far larger than any bound-variable limit', () => {
    const repo = withRows(2_400);

    const deleted = repo.pruneToCap(10);

    assert.equal(deleted, 2_390);
    assert.equal(repo.count(), 10);
  });

  /**
   * ⚠️ Structural, not behavioural. A `DELETE ... USING play` or
   * `DELETE ... WHERE id IN (SELECT ... JOIN play ...)` would pass every test above.
   *
   * A decision row is recomputable from rules plus history. A play row is recomputable from
   * nothing: `recently-played` is a 50-play window, and seven of the corpus's ten early days
   * exist only as backfilled rows.
   */
  it('has a DELETE statement that cannot reach the play table', () => {
    assert.ok(DELETE_SQL_PREFIX.startsWith('DELETE FROM decision_log'));
    assert.ok(!/\bplay\b/.test(DELETE_SQL_PREFIX), 'the DELETE may never name play');
    assert.ok(!/\bJOIN\b/i.test(DELETE_SQL_PREFIX));
    assert.ok(!/\bUSING\b/i.test(DELETE_SQL_PREFIX));
    assert.ok(!/\bSELECT\b/i.test(DELETE_SQL_PREFIX), 'no subquery: it could reach anywhere');
  });

  it('keeps that guarantee in the shipped source, not only in the constant', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'rules', 'SqliteDecisionLogRepository.ts'),
      'utf8',
    );

    const deleteStatements = src.match(/DELETE\s+FROM[^`'"]*/gi) ?? [];
    assert.ok(deleteStatements.length > 0, 'the guard must not pass by there being no DELETE');
    for (const statement of deleteStatements) {
      assert.ok(
        !/\bplay\b/.test(statement),
        `a DELETE in this module names play: ${statement}`,
      );
    }
  });

  it('leaves the play table untouched', () => {
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    insertPlay(db);
    repo.record(Array.from({ length: 30 }, (_, i) => entry({ evaluationId: `e${i}` })));

    repo.pruneToCap(1);

    const plays = db.prepare('SELECT COUNT(*) AS n FROM play').get() as { n: number };
    assert.equal(plays.n, 1);
  });
});

describe('the track title on a read row (decision log UI)', () => {
  /**
   * ⚠️ `decision_log` has NO title column. The title is looked up from `play` at read time, which is
   * why `NewDecisionLogEntry` omits it — nothing writes one.
   *
   * ## ⭐ The two cases that matter
   *
   *   1. **Keyed on `track_id`, not `play_id`.** `play_id` is `null` while the play is still OPEN
   *      (BR-24.1: the decision precedes the play row), and this log is read live — so the
   *      currently-playing track is exactly the row a reader is most likely looking at. Keying on
   *      `play_id` would leave that one blank.
   *   2. **`null` renders as a FACT, not a blank.** No play row for this track yet means it is the
   *      first time the track has been heard.
   */

  it('⭐ resolves the title from the play row for the same track', () => {
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    insertPlay(db);
    repo.record([entry({ trackId: 'abcdefghijklmnopqrstuv' })]);

    assert.equal(repo.list({ limit: 10 })[0]?.title, 't');
    db.close();
  });

  it('⭐ ⚠️ resolves it even when play_id is NULL, which is the live case', () => {
    // A decision taken while the play is still open has no play_id. That is the row on screen when
    // someone opens the log during a track, so it is the one that must not be blank.
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    insertPlay(db);
    repo.record([entry({ trackId: 'abcdefghijklmnopqrstuv', playId: null, playLink: 'pending' })]);

    const row = repo.list({ limit: 10 })[0];
    assert.equal(row?.playId, null, 'no play link at all');
    assert.equal(row?.title, 't', 'and still a title');
    db.close();
  });

  it('⭐ ⚠️ is NULL when no play row carries that track id — never an empty string', () => {
    // `''` would render as a title that happens to be blank. `null` is unknown, and the UI says what
    // it means: "first play of this track".
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    repo.record([entry({ trackId: 'never-played-before' })]);

    assert.equal(repo.list({ limit: 10 })[0]?.title, null);
    db.close();
  });

  it('⚠️ takes the MOST RECENT play, so a retitled track shows its current title', () => {
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    insertPlay(db);
    db.prepare(
      `INSERT INTO play (track_id, title, artist_name, album_name, started_at, ended_at,
                         outcome, close_reason, provenance, classifier_version,
                         ev_listened_ms, ev_duration_ms, ev_completion_ratio, ev_max_progress_ms,
                         ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound,
                         ev_ended_with_idle)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('abcdefghijklmnopqrstuv', 'Remastered Title', 'a', 'al', '2026-09-25T10:00:00.000Z',
          '2026-09-25T10:03:00.000Z', 'completed', 'track-change', 'live', 1,
          0, 0, 0, 0, 0, 1, 0, 0, 0);

    repo.record([entry({ trackId: 'abcdefghijklmnopqrstuv' })]);
    assert.equal(repo.list({ limit: 10 })[0]?.title, 'Remastered Title');
    db.close();
  });

  it('⭐ ⚠️ the subquery does not break ?trackId= filtering', () => {
    // The `where` clauses name their columns UNQUOTED -- `track_id = ?`. `play` also has a `track_id`,
    // so a JOIN would have made that ambiguous and the filter would have quietly stopped meaning what
    // it says. A correlated subquery leaves it untouched. This is the test that would catch a JOIN.
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    insertPlay(db);
    repo.record([
      entry({ evaluationId: 'ev-a', trackId: 'abcdefghijklmnopqrstuv' }),
      entry({ evaluationId: 'ev-b', trackId: 'some-other-track' }),
    ]);

    const filtered = repo.list({ limit: 10, trackId: 'abcdefghijklmnopqrstuv' });
    assert.equal(filtered.length, 1, 'the filter still selects on decision_log.track_id');
    assert.equal(filtered[0]?.evaluationId, 'ev-a');
    assert.equal(filtered[0]?.title, 't');
    db.close();
  });

  it('⚠️ and does not break date filtering either', () => {
    // `play` has `started_at`; `decision_log` has `decided_at`. Different names, so this one could not
    // collide -- asserted anyway, because the next column added to `play` might not be so lucky.
    const db = freshDb();
    const repo = new SqliteDecisionLogRepository(db);
    insertPlay(db);
    repo.record([entry({ decidedAt: '2026-09-20T10:00:00.000Z' })]);

    assert.equal(repo.list({ limit: 10, from: '2026-09-21T00:00:00.000Z' }).length, 0);
    assert.equal(repo.list({ limit: 10, from: '2026-09-19T00:00:00.000Z' }).length, 1);
    db.close();
  });
});
