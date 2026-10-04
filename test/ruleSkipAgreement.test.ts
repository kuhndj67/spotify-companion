/**
 * "A rule skipped this play" — one definition, two call sites, and the halt that could not fire.
 *
 * ## 🔧 The defect this file exists for, found 2026-10-04
 *
 * `recentPlaysForCounting` derived `skippedByRule` from `play.skip_source === 'rule'`, and
 * **nothing in the codebase ever wrote `'rule'`**: `PlayObserver` hardcoded
 * `outcome === 'skipped' ? 'user' : null` from U1 — sound while nothing else could skip, and wrong the
 * moment U5 shipped. So the counter returned `false` for every play, `consecutiveRuleSkips` could only
 * ever return `0`, and **the 3-consecutive runaway halt could not fire at all.**
 *
 * ⚠️ **It passed everything.** `safetyCounters.ts` is at 100% line/branch/function and PBT-46/47 pass —
 * they test the counter against *supplied* input, and nothing asserted that anything ever supplies
 * `true`. A column that is structurally empty reads as *this never happens*. That is the
 * `recordSuccessorLag` shape for the third time in this project, and the first time it disabled a
 * safety limit rather than losing a measurement.
 *
 * ⚠️ `knip` did not see it either: `skip_source` is both read and written, just never with that value.
 *
 * ## ⭐ What is asserted here
 *
 *   1. **The counter counts.** A fired attempt makes `skippedByRule` true — the assertion whose absence
 *      was the whole defect.
 *   2. **The two call sites agree.** The `skip_source` label and the safety counter answer the same
 *      question, so they must never disagree about the same data.
 *   3. **The safety limit does not depend on the label.** With `skip_source` wrong — or `play_id`
 *      never backfilled — the counter still counts. *A guard that depends on a label is a guard that a
 *      labelling bug disables.*
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { migrate } from '../src/history/migrations.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { SqliteSkipAttemptRepository } from '../src/playback/SqliteSkipAttemptRepository.js';
import { consecutiveRuleSkips } from '../src/playback/safetyCounters.js';
import { MAX_CONSECUTIVE_RULE_SKIPS } from '../src/playback/types.js';
import type { NewSkipAttempt } from '../src/playback/types.js';

function fresh(): { db: DatabaseSync; history: SqliteHistoryRepository; attempts: SqliteSkipAttemptRepository } {
  const history = new SqliteHistoryRepository(':memory:');
  const db = history.database;
  migrate(db);
  return { db, history, attempts: new SqliteSkipAttemptRepository(db) };
}

/** A closed play, with an explicit window. `skipSource` is what the OLD code would have written. */
function insertPlay(
  db: DatabaseSync,
  trackId: string,
  startedAt: string,
  endedAt: string,
  outcome = 'skipped',
  skipSource: string | null = 'user',
): number {
  const r = db
    .prepare(
      `INSERT INTO play (track_id, title, artist_name, album_name, started_at, ended_at,
                         outcome, close_reason, provenance, classifier_version, skip_source,
                         ev_listened_ms, ev_duration_ms, ev_completion_ratio, ev_max_progress_ms,
                         ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound,
                         ev_ended_with_idle)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(trackId, 't', 'a', 'al', startedAt, endedAt, outcome, 'track-change', 'live', 1, skipSource,
         0, 0, 0, 0, 0, 1, 0, 0, 0);
  return Number(r.lastInsertRowid);
}

/** A complete `NewSkipAttempt`. ⚠️ `NewSkipAttempt` is `Omit<SkipAttempt, 'id'>`, so every field is required. */
function newAttempt(trackId: string, at: string, evaluationId: string): NewSkipAttempt {
  return {
    evaluationId,
    playId: null,
    trackId,
    ruleId: 'r',
    state: 'queued',
    enqueuedAt: at,
    firedAt: null,
    refusedReason: null,
    reportedTrackIdBefore: null,
    reportedProgressMsBefore: null,
    reportedTrackIdAfter: null,
    reportedProgressMsAfter: null,
  };
}

/** An attempt that REACHED THE PLAYER, enqueued at `at`. */
function insertFiredAttempt(
  attempts: SqliteSkipAttemptRepository,
  trackId: string,
  at: string,
  evaluationId = `ev-${trackId}-${at}`,
): number {
  const id = attempts.enqueue(newAttempt(trackId, at, evaluationId));
  attempts.transition(id, 'confirmed', { firedAt: at });
  return id;
}

describe('⭐ the counter COUNTS — the assertion whose absence disabled the halt', () => {
  it('a fired attempt inside the play window makes skippedByRule true', () => {
    const { db, history, attempts } = fresh();
    insertPlay(db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    insertFiredAttempt(attempts, 't1', '2026-10-04T10:00:03.000Z');

    const counted = history.recentPlaysForCounting(20);
    assert.equal(counted.length, 1);
    assert.equal(counted[0]?.skippedByRule, true, 'this was false for every play before 2026-10-04');
    db.close();
  });

  it('⭐ and consecutiveRuleSkips therefore reaches the halt threshold', () => {
    // The end-to-end claim: three adjacent rule-skips produce a count that trips BR-35.1. Before the
    // fix this could only ever be 0, so the primary runaway guard was inert.
    const { db, history, attempts } = fresh();
    for (let i = 0; i < MAX_CONSECUTIVE_RULE_SKIPS; i += 1) {
      const start = `2026-10-04T10:0${i}:00.000Z`;
      const end = `2026-10-04T10:0${i}:05.000Z`;
      insertPlay(db, `t${i}`, start, end);
      insertFiredAttempt(attempts, `t${i}`, `2026-10-04T10:0${i}:03.000Z`);
    }

    const count = consecutiveRuleSkips(history.recentPlaysForCounting(20));
    assert.equal(count, MAX_CONSECUTIVE_RULE_SKIPS);
    assert.ok(count >= MAX_CONSECUTIVE_RULE_SKIPS, 'the halt can now fire');
    db.close();
  });

  it('⚠️ a play with no attempt resets the run (BR-35.9)', () => {
    const { db, history, attempts } = fresh();
    insertPlay(db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    insertFiredAttempt(attempts, 't1', '2026-10-04T10:00:03.000Z');
    // The listener's own skip — no attempt row.
    insertPlay(db, 't2', '2026-10-04T10:01:00.000Z', '2026-10-04T10:01:05.000Z');

    assert.equal(consecutiveRuleSkips(history.recentPlaysForCounting(20)), 0, 'reset, not merely not-incremented');
    db.close();
  });
});

describe('⭐ the two call sites agree, because there is one definition', () => {
  it('firedDuring and recentPlaysForCounting answer identically over mixed data', () => {
    // The label (`skip_source`) and the safety counter ask the same question. This is the pin that
    // stops them drifting — one admission rule invoked twice, which is the WebSocket 403's lesson.
    const { db, history, attempts } = fresh();

    const cases: { track: string; start: string; end: string; firedAt: string | null }[] = [
      { track: 'in-window', start: '2026-10-04T10:00:00.000Z', end: '2026-10-04T10:00:10.000Z', firedAt: '2026-10-04T10:00:05.000Z' },
      { track: 'no-attempt', start: '2026-10-04T10:01:00.000Z', end: '2026-10-04T10:01:10.000Z', firedAt: null },
      { track: 'before-window', start: '2026-10-04T10:02:00.000Z', end: '2026-10-04T10:02:10.000Z', firedAt: '2026-10-04T09:59:00.000Z' },
      { track: 'after-window', start: '2026-10-04T10:03:00.000Z', end: '2026-10-04T10:03:10.000Z', firedAt: '2026-10-04T10:09:00.000Z' },
      { track: 'at-start', start: '2026-10-04T10:04:00.000Z', end: '2026-10-04T10:04:10.000Z', firedAt: '2026-10-04T10:04:00.000Z' },
      { track: 'at-end', start: '2026-10-04T10:05:00.000Z', end: '2026-10-04T10:05:10.000Z', firedAt: '2026-10-04T10:05:10.000Z' },
    ];

    const byPlayId = new Map<number, (typeof cases)[number]>();
    for (const c of cases) {
      byPlayId.set(insertPlay(db, c.track, c.start, c.end), c);
      if (c.firedAt !== null) insertFiredAttempt(attempts, c.track, c.firedAt);
    }

    const counted = history.recentPlaysForCounting(50);
    assert.equal(counted.length, cases.length);

    for (const row of counted) {
      const c = byPlayId.get(row.playId)!;
      const label = attempts.firedDuring(c.track, c.start, c.end);
      assert.equal(
        row.skippedByRule,
        label,
        `${c.track}: the counter says ${row.skippedByRule} and the label says ${label}`,
      );
    }

    // And the expected answers, so "they agree" cannot be satisfied by both being wrong.
    const answer = (track: string) =>
      counted.find((r) => byPlayId.get(r.playId)!.track === track)?.skippedByRule;
    assert.equal(answer('in-window'), true);
    assert.equal(answer('no-attempt'), false);
    assert.equal(answer('before-window'), false, 'an earlier attempt is a different play');
    assert.equal(answer('after-window'), false);
    assert.equal(answer('at-start'), true, 'the window is inclusive at both ends');
    assert.equal(answer('at-end'), true);
    db.close();
  });

  it('⚠️ a REPEAT listen does not inherit the earlier play’s attempt', () => {
    // Keyed on the window, so the same track heard twice gets two independent answers. A track-id-only
    // match would make every later play of a once-skipped track count toward the halt.
    const { db, history, attempts } = fresh();
    insertPlay(db, 'same-track', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:10.000Z');
    insertFiredAttempt(attempts, 'same-track', '2026-10-04T10:00:05.000Z');
    insertPlay(db, 'same-track', '2026-10-04T11:00:00.000Z', '2026-10-04T11:03:00.000Z', 'completed', null);

    const counted = history.recentPlaysForCounting(20);
    assert.deepEqual(counted.map((r) => r.skippedByRule), [true, false]);
    db.close();
  });
});

describe('⭐ the safety limit does not depend on the label being right', () => {
  it('⚠️ counts even when skip_source still says `user`', () => {
    // This is the exact state the corpus was in. If the counter read the label, this would be 0 — which
    // is what it was. A guard that depends on a label is a guard that a labelling bug disables.
    const { db, history, attempts } = fresh();
    insertPlay(db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z', 'skipped', 'user');
    insertFiredAttempt(attempts, 't1', '2026-10-04T10:00:03.000Z');

    assert.equal(history.recentPlaysForCounting(20)[0]?.skippedByRule, true);
    db.close();
  });

  it('⚠️ counts even when skip_attempt.play_id was never backfilled', () => {
    // `attachPlayId` runs in a try/catch that is explicitly allowed to fail, because it is not
    // load-bearing. Keying the counter on `play_id` would make the halt UNDER-count whenever that
    // backfill failed -- and a halt that under-counts is a halt that does not fire.
    const { db, history, attempts } = fresh();
    insertPlay(db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    insertFiredAttempt(attempts, 't1', '2026-10-04T10:00:03.000Z');

    const nulls = db.prepare('SELECT COUNT(*) c FROM skip_attempt WHERE play_id IS NULL').get() as { c: number };
    assert.equal(nulls.c, 1, 'play_id is deliberately unset here');
    assert.equal(history.recentPlaysForCounting(20)[0]?.skippedByRule, true);
    db.close();
  });

  it('⚠️ a REFUSED attempt does not count — it never reached the player', () => {
    const { db, history, attempts } = fresh();
    insertPlay(db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    const id = attempts.enqueue(newAttempt('t1', '2026-10-04T10:00:03.000Z', 'ev-1'));
    attempts.transition(id, 'refused', { refusedReason: 'automation-off' });

    assert.equal(history.recentPlaysForCounting(20)[0]?.skippedByRule, false);
    assert.equal(attempts.firedDuring('t1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z'), false);
    db.close();
  });

  it('⚠️ an UNCONFIRMED attempt DOES count — unknown counts as landed', () => {
    // P-30's rule, and the restrictive direction for a safety limit: a halt that under-counts is a halt
    // that does not fire.
    const { db, history, attempts } = fresh();
    insertPlay(db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    const id = attempts.enqueue(newAttempt('t1', '2026-10-04T10:00:03.000Z', 'ev-1'));
    attempts.transition(id, 'unconfirmed', { firedAt: '2026-10-04T10:00:03.000Z' });

    assert.equal(history.recentPlaysForCounting(20)[0]?.skippedByRule, true);
    db.close();
  });
});
