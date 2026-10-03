/**
 * LC-24 — the skip-attempt store. **PBT-37** (the guard keys on the play, not the track) and
 * **PBT-49** (round-trip, with `undefined` normalised to `null`).
 *
 * ## The two tests that exist because of a specific requirement rather than for coverage
 *
 *   - **PBT-37 asserts BOTH directions.** A second attempt on the same play is refused; the *same
 *     track* on a *new* play is not. A guard keyed on `track_id` would pass the first half and fail
 *     the second, and the failure would be invisible — a repeat listen silently never skipped. FR-40's
 *     original *"never skip the same track twice within one session"* was withdrawn for exactly this,
 *     because it is the same class of error as clamping `completionRatio` to 1.0.
 *   - **The rolling-window query filters on STATE, not on `fired_at` being set.** A `refused` attempt
 *     never touched the player, so counting it would halt automation over skips that never happened.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { MIGRATIONS, migrate } from '../src/history/migrations.js';
import { SqliteSkipAttemptRepository } from '../src/playback/SqliteSkipAttemptRepository.js';
import type { NewSkipAttempt } from '../src/playback/types.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS);
  return db;
}

/** A play row, so `skip_attempt.play_id`'s foreign key has something to point at. */
function insertPlay(db: DatabaseSync, trackId: string, startedAt: string): number {
  db.prepare(
    `INSERT INTO play
       (track_id, title, artist_name, album_name, started_at, ended_at, outcome, close_reason,
        provenance, classifier_version, ev_listened_ms, ev_duration_ms, ev_completion_ratio,
        ev_max_progress_ms, ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound,
        ev_ended_with_idle)
     VALUES (?, 'T', 'A', 'Al', ?, ?, 'completed', 'track-change', 'live', 2,
             180000, 180000, 1.0, 180000, 3000, 60, 0, 0, 0)`,
  ).run(trackId, startedAt, startedAt);
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as unknown as { id: number };
  return row.id;
}

function attempt(
  playId: number,
  trackId: string,
  over: Partial<NewSkipAttempt> = {},
): NewSkipAttempt {
  return {
    evaluationId: `ev-${playId}`,
    playId,
    trackId,
    ruleId: 'r1',
    state: 'queued',
    enqueuedAt: '2026-10-02T10:00:00.000Z',
    firedAt: null,
    refusedReason: null,
    reportedTrackIdBefore: null,
    reportedProgressMsBefore: null,
    reportedTrackIdAfter: null,
    reportedProgressMsAfter: null,
    ...over,
  };
}

describe('PBT-49 — a SkipAttempt round-trips by value', () => {
  it('writes and reads back every field', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');

    const id = repo.enqueue(
      attempt(playId, 't1', {
        state: 'confirmed',
        firedAt: '2026-10-02T10:00:05.000Z',
        reportedTrackIdBefore: 't1',
        reportedProgressMsBefore: 1200,
        reportedTrackIdAfter: 't2',
        reportedProgressMsAfter: 300,
      }),
    );

    const read = repo.get(id);
    assert.ok(read);
    assert.equal(read.id, id);
    assert.equal(read.evaluationId, `ev-${playId}`);
    assert.equal(read.playId, playId);
    assert.equal(read.trackId, 't1');
    assert.equal(read.ruleId, 'r1');
    assert.equal(read.state, 'confirmed');
    assert.equal(read.firedAt, '2026-10-02T10:00:05.000Z');
    assert.equal(read.reportedTrackIdBefore, 't1');
    assert.equal(read.reportedProgressMsBefore, 1200);
    assert.equal(read.reportedTrackIdAfter, 't2');
    assert.equal(read.reportedProgressMsAfter, 300);
    db.close();
  });

  it('⚠️ normalises undefined to null rather than letting the driver throw', () => {
    // node:sqlite rejects `undefined` as a bound value, so an optional field left unset would fail at
    // runtime — and only on the code path that happens not to set it.
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');

    const sparse = {
      evaluationId: 'ev-sparse',
      playId,
      trackId: 't1',
      ruleId: 'r1',
      state: 'queued',
      enqueuedAt: '2026-10-02T10:00:00.000Z',
      firedAt: undefined,
      refusedReason: undefined,
      reportedTrackIdBefore: undefined,
      reportedProgressMsBefore: undefined,
      reportedTrackIdAfter: undefined,
      reportedProgressMsAfter: undefined,
    } as unknown as NewSkipAttempt;

    const id = repo.enqueue(sparse);
    const read = repo.get(id);
    assert.ok(read);
    assert.equal(read.firedAt, null, 'undefined must arrive as an explicit null');
    assert.equal(read.refusedReason, null);
    assert.equal(read.reportedProgressMsBefore, null);
    db.close();
  });

  it('returns null for an id that does not exist', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    assert.equal(repo.get(9999), null);
    db.close();
  });
});

describe('⭐ PBT-37 — the guard keys on evaluationId (the PLAY), never the track', () => {
  it('a second attempt for the SAME evaluationId is detected', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');

    assert.equal(repo.attemptedForPlay('ev-1'), false, 'nothing attempted yet');
    repo.enqueue(attempt(playId, 't1', { evaluationId: 'ev-1' }));
    assert.equal(repo.attemptedForPlay('ev-1'), true);
    db.close();
  });

  it('⚠️ the SAME TRACK on a NEW PLAY is NOT blocked — a repeat listen stays skippable', () => {
    // The half a track_id-keyed guard would fail, silently: the listener chose to hear the track
    // again, and their rule would never fire for it.
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const first = insertPlay(db, 'same-track', '2026-10-02T09:00:00.000Z');
    const second = insertPlay(db, 'same-track', '2026-10-02T11:00:00.000Z');

    repo.enqueue(attempt(first, 'same-track', { evaluationId: 'ev-first' }));

    assert.equal(repo.attemptedForPlay('ev-first'), true);
    assert.equal(
      repo.attemptedForPlay('ev-second'),
      false,
      'a recurring track is a NEW play with a NEW evaluationId, and stays fully skippable (BR-36.2)',
    );
    assert.ok(second > first);
    db.close();
  });

  it('⚠️ WORKS WHILE playId IS STILL NULL — which is the normal case at the action point', () => {
    // PlayObserver writes the play row at CLOSE, so during the play there is no playId. A
    // playId-keyed guard would have been unenforceable exactly when it is needed, and NOT NULL on
    // that column would have thrown on the first real skip.
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);

    const id = repo.enqueue(attempt(0, 't1', { evaluationId: 'ev-open', playId: null }));
    assert.equal(repo.get(id)?.playId, null);
    assert.equal(repo.attemptedForPlay('ev-open'), true, 'the guard works with no play row at all');
    db.close();
  });

  it('attachPlayId backfills once the play closes, and the guard is unaffected', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const id = repo.enqueue(attempt(0, 't1', { evaluationId: 'ev-open', playId: null }));
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');

    repo.attachPlayId('ev-open', playId);

    assert.equal(repo.get(id)?.playId, playId);
    assert.equal(repo.attemptedForPlay('ev-open'), true, 'the guard never read this column');
    db.close();
  });

  it('⚠️ attachPlayId does not overwrite a playId already set', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const first = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const second = insertPlay(db, 't2', '2026-10-02T10:00:00.000Z');
    const id = repo.enqueue(attempt(first, 't1', { evaluationId: 'ev-x' }));

    repo.attachPlayId('ev-x', second);
    assert.equal(repo.get(id)?.playId, first, 'the first write wins; a re-link is not a correction');
    db.close();
  });

  it('⚠️ holds regardless of outcome — a failed attempt does not earn a retry', () => {
    // BR-36.4. One attempt is the budget.
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');

    const id = repo.enqueue(attempt(playId, 't1', { evaluationId: 'ev-u' }));
    repo.transition(id, 'unconfirmed', { firedAt: '2026-10-02T10:00:05.000Z' });

    assert.equal(repo.attemptedForPlay('ev-u'), true, 'an unconfirmed attempt still spent the budget');
    db.close();
  });

  it('a REFUSED attempt also spends the budget', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const id = repo.enqueue(attempt(playId, 't1', { evaluationId: 'ev-r' }));
    repo.transition(id, 'refused', { refusedReason: 'automation-off' });
    assert.equal(repo.attemptedForPlay('ev-r'), true);
    db.close();
  });
});

describe('transition writes state AND evidence together (BR-43.2)', () => {
  it('records the before/after pair with the state', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const id = repo.enqueue(attempt(playId, 't1'));

    repo.transition(id, 'fired', {
      firedAt: '2026-10-02T10:00:05.000Z',
      reportedTrackIdBefore: 't1',
      reportedProgressMsBefore: 900,
    });

    const read = repo.get(id);
    assert.equal(read?.state, 'fired');
    assert.equal(read?.reportedTrackIdBefore, 't1');
    assert.equal(read?.reportedProgressMsBefore, 900);
    db.close();
  });

  it('leaves fields the patch does not mention untouched', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const id = repo.enqueue(attempt(playId, 't1'));

    repo.transition(id, 'fired', { firedAt: 'f1', reportedTrackIdBefore: 't1' });
    repo.transition(id, 'confirmed', { reportedTrackIdAfter: 't2' });

    const read = repo.get(id);
    assert.equal(read?.state, 'confirmed');
    assert.equal(read?.firedAt, 'f1', 'not overwritten by the second transition');
    assert.equal(read?.reportedTrackIdBefore, 't1');
    assert.equal(read?.reportedTrackIdAfter, 't2');
    db.close();
  });

  it('records a refusal reason', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const id = repo.enqueue(attempt(playId, 't1'));
    repo.transition(id, 'refused', { refusedReason: 'rule-disabled' });
    assert.equal(repo.get(id)?.refusedReason, 'rule-disabled');
    db.close();
  });
});

describe('queued() — the startup sweep', () => {
  it('returns only rows still in queued, oldest id first', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const p1 = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const p2 = insertPlay(db, 't2', '2026-10-02T09:05:00.000Z');
    const p3 = insertPlay(db, 't3', '2026-10-02T09:10:00.000Z');

    const a1 = repo.enqueue(attempt(p1, 't1'));
    repo.enqueue(attempt(p2, 't2'));
    const a3 = repo.enqueue(attempt(p3, 't3'));
    repo.transition(a1, 'confirmed', { firedAt: 'x' });

    const still = repo.queued();
    assert.deepEqual(
      still.map((a) => a.playId),
      [p2, p3],
    );
    assert.ok(still.every((a) => a.state === 'queued'));
    assert.ok(a3 > 0);
    db.close();
  });
});

describe('firedSince — BR-35.2s rolling window input, WITH ids', () => {
  it('⚠️ counts fired, confirmed and unconfirmed; NOT queued, cancelled or refused', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const at = (n: number) => `2026-10-02T10:0${n}:00.000Z`;

    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const playId = insertPlay(db, `t${i}`, at(i));
      ids.push(repo.enqueue(attempt(playId, `t${i}`)));
    }

    // Three reached the player.
    repo.transition(ids[0]!, 'fired', { firedAt: at(0) });
    repo.transition(ids[1]!, 'confirmed', { firedAt: at(1) });
    repo.transition(ids[2]!, 'unconfirmed', { firedAt: at(2) });
    // Three did not. ⚠️ The refused one even carries a fired_at, to prove the query filters on STATE.
    repo.transition(ids[3]!, 'cancelled');
    repo.transition(ids[4]!, 'refused', { refusedReason: 'play-closed', firedAt: at(4) });
    // ids[5] stays queued.

    const fired = repo.firedSince('2026-10-02T09:00:00.000Z');
    assert.equal(
      fired.length,
      3,
      'a refused attempt never touched the player — counting it would halt over skips that never happened',
    );
    db.close();
  });

  it('excludes attempts at or before the cutoff', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const id = repo.enqueue(attempt(playId, 't1'));
    repo.transition(id, 'fired', { firedAt: '2026-10-02T10:00:00.000Z' });

    assert.equal(repo.firedSince('2026-10-02T10:00:00.000Z').length, 0, 'exclusive cutoff');
    assert.equal(repo.firedSince('2026-10-02T09:59:59.000Z').length, 1);
    db.close();
  });

  it('returns epoch milliseconds, which is what the counter consumes', () => {
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const playId = insertPlay(db, 't1', '2026-10-02T09:00:00.000Z');
    const id = repo.enqueue(attempt(playId, 't1'));
    repo.transition(id, 'fired', { firedAt: '2026-10-02T10:00:00.000Z' });

    const [first] = repo.firedSince('2026-10-02T00:00:00.000Z');
    assert.equal(first?.firedAtMs, Date.parse('2026-10-02T10:00:00.000Z'));
    db.close();
  });

  it('⭐ returns REAL attempt ids, because the halt record names them', () => {
    // BR-35.8 requires the acknowledgement surface to say which rule-skips counted. An earlier draft
    // returned timestamps only and the drain synthesised ids from array indices -- which would have
    // pointed the user at attempts that do not exist, in the one place they are asked to review
    // evidence before clearing a safety latch.
    const db = freshDb();
    const repo = new SqliteSkipAttemptRepository(db);
    const ids: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const playId = insertPlay(db, `t${i}`, `2026-10-02T09:0${i}:00.000Z`);
      const id = repo.enqueue(attempt(playId, `t${i}`, { evaluationId: `ev-${i}` }));
      repo.transition(id, 'fired', { firedAt: `2026-10-02T10:0${i}:00.000Z` });
      ids.push(id);
    }

    const fired = repo.firedSince('2026-10-02T00:00:00.000Z');
    assert.deepEqual(
      fired.map((f) => f.id),
      ids,
      'the ids must be the rows that actually fired',
    );
    db.close();
  });
});
