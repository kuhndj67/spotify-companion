/**
 * "A rule skipped this play" — one definition, and the two bugs that got there first.
 *
 * ## 🔧 Bug 1: the halt could not fire at all (2026-10-04)
 *
 * `recentPlaysForCounting` derived `skippedByRule` from `play.skip_source === 'rule'`, and **nothing ever
 * wrote `'rule'`** — `PlayObserver` hardcoded `outcome === 'skipped' ? 'user' : null` from U1, sound while
 * nothing else could skip and wrong the moment U5 shipped. Live database: 56 `'user'`, 831 `null`, zero
 * `'rule'`. So the counter was `false` for every play and `consecutiveRuleSkips` could only return `0`.
 *
 * ⚠️ `safetyCounters.ts` was at 100% on every axis and PBT-46/47 passed — they test the counter against
 * *supplied* input, and nothing asserted anything ever supplies `true`.
 *
 * ## 🔧 Bug 2: the FIX failed live by 11–14 MILLISECONDS (same day)
 *
 * The fix matched on `track_id` plus `enqueued_at BETWEEN started_at AND ended_at`, on the reasoning that
 * `play_id` is backfilled in a try/catch and could be missing while the window's ends cannot be.
 *
 * ⚠️ **`ended_at` is the last observation in the trail**, and the attempt is enqueued from the decision
 * taken on that same tick — just after it. Four real skips came in **11, 13, 14 and 14 ms after**
 * `ended_at`, every one outside its own play's window. ⚠️ **And it worked for refusals**, whose plays run
 * on for minutes — so the failing case was exactly a SKIP, which by definition ends the play it fired
 * during. The tests passed because their fixtures used generous windows: **a fixture never shows you a
 * 14 ms race.**
 *
 * ⚠️ On those same four skips `play_id` was populated correctly every time. The argument for the window
 * was reasoning; the measurement said the opposite.
 *
 * ## What is pinned here
 *
 *   1. The counter **counts** — the assertion whose absence was bug 1.
 *   2. ⭐ An attempt enqueued **after `ended_at`** still counts — the regression test for bug 2.
 *   3. ⭐ The halt latches on the **FOURTH** consecutive skip, not the third.
 *   4. The safety limit still works with `skip_source` wrong.
 *   5. A missing `play_id` is **surfaced**, not designed around.
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

interface Harness {
  db: DatabaseSync;
  history: SqliteHistoryRepository;
  attempts: SqliteSkipAttemptRepository;
}

function fresh(): Harness {
  const history = new SqliteHistoryRepository(':memory:');
  const db = history.database;
  migrate(db);
  return { db, history, attempts: new SqliteSkipAttemptRepository(db) };
}

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

/** ⚠️ `NewSkipAttempt` is `Omit<SkipAttempt, 'id'>`, so every field is required. */
function newAttempt(over: Partial<NewSkipAttempt> & { evaluationId: string; trackId: string }): NewSkipAttempt {
  return {
    playId: null,
    ruleId: 'r',
    state: 'queued',
    enqueuedAt: '2026-10-04T10:00:00.000Z',
    firedAt: null,
    refusedReason: null,
    reportedTrackIdBefore: null,
    reportedProgressMsBefore: null,
    reportedTrackIdAfter: null,
    reportedProgressMsAfter: null,
    ...over,
  };
}

/** An attempt that reached the player and was linked to `playId`, exactly as the live path does. */
function firedAndLinked(
  h: Harness,
  playId: number,
  trackId: string,
  evaluationId: string,
  enqueuedAt = '2026-10-04T10:00:03.000Z',
): number {
  const id = h.attempts.enqueue(newAttempt({ evaluationId, trackId, enqueuedAt }));
  h.attempts.transition(id, 'confirmed', { firedAt: enqueuedAt });
  h.attempts.attachPlayId(evaluationId, playId);
  return id;
}

describe('⭐ the counter COUNTS — the assertion whose absence was bug 1', () => {
  it('a linked, fired attempt makes skippedByRule true', () => {
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    firedAndLinked(h, playId, 't1', 'ev-1');

    assert.equal(h.history.recentPlaysForCounting(20)[0]?.skippedByRule, true);
    h.db.close();
  });

  it('⚠️ a play with no attempt resets the run (BR-35.9)', () => {
    const h = fresh();
    const a = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    firedAndLinked(h, a, 't1', 'ev-1');
    insertPlay(h.db, 't2', '2026-10-04T10:01:00.000Z', '2026-10-04T10:01:05.000Z'); // the listener's own

    assert.equal(consecutiveRuleSkips(h.history.recentPlaysForCounting(20)), 0, 'reset, not merely not-incremented');
    h.db.close();
  });
});

describe('⭐⭐ bug 2: an attempt enqueued AFTER ended_at still counts', () => {
  it('14 ms after the play closed — the exact live failure', () => {
    // Measured on four real skips: enqueued 11, 13, 14 and 14 ms after `ended_at`, because `ended_at` is
    // the last OBSERVATION and the attempt comes from the decision taken on that same tick. Keyed on
    // `play_id`, the gap is irrelevant. Keyed on the window, every real skip was missed.
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T14:35:10.039Z', '2026-10-04T14:35:16.044Z');
    firedAndLinked(h, playId, 't1', 'ev-1', '2026-10-04T14:35:16.058Z');

    assert.equal(
      h.history.recentPlaysForCounting(20)[0]?.skippedByRule,
      true,
      'a window-based key returned false here, on every real skip',
    );
    h.db.close();
  });

  it('⚠️ and the four real timings from 2026-10-04 all count', () => {
    const h = fresh();
    const live: [string, string, string][] = [
      ['2026-10-04T14:35:10.039Z', '2026-10-04T14:35:16.044Z', '2026-10-04T14:35:16.058Z'],
      ['2026-10-04T14:35:19.075Z', '2026-10-04T14:35:22.125Z', '2026-10-04T14:35:22.136Z'],
      ['2026-10-04T14:35:25.131Z', '2026-10-04T14:35:28.051Z', '2026-10-04T14:35:28.064Z'],
      ['2026-10-04T14:35:31.051Z', '2026-10-04T14:35:34.041Z', '2026-10-04T14:35:34.055Z'],
    ];
    live.forEach(([start, end, enqueued], i) => {
      const playId = insertPlay(h.db, `t${i}`, start, end);
      firedAndLinked(h, playId, `t${i}`, `ev-${i}`, enqueued);
    });

    const counted = h.history.recentPlaysForCounting(20);
    assert.deepEqual(counted.map((r) => r.skippedByRule), [true, true, true, true]);
    h.db.close();
  });
});

describe('⭐⭐ the halt latches on the FOURTH consecutive skip, not the third', () => {
  /**
   * ⚠️ **`MAX_CONSECUTIVE_RULE_SKIPS` is 3, and four tracks are skipped before automation stops.**
   *
   * The counter reads **closed** plays, and the skip that triggers the check has not closed yet — the
   * track change it causes is what closes it. So at the check following skip N the counter can see at
   * most N−1 closed rule-skips:
   *
   * | skip | closed rule-skips the counter sees | halt? |
   * |---|---|---|
   * | 1 | 0 | no |
   * | 2 | 1 | no |
   * | 3 | 2 | no |
   * | **4** | **3** | ⚠️ **yes** |
   *
   * ⚠️ **This is inherent to counting closed plays, not an implementation slip**, and it is accepted
   * (user, 2026-10-04) on condition that it is **stated wherever the threshold is stated**. Anything
   * that says "3" without saying "the 4th skip is the one that latches it" is under-describing the
   * behaviour by one track.
   */
  it('reaches the threshold only after the fourth skip has fired', () => {
    const h = fresh();
    const seen: { afterSkip: number; counted: number; wouldHalt: boolean }[] = [];

    for (let n = 1; n <= MAX_CONSECUTIVE_RULE_SKIPS + 1; n += 1) {
      // The play for skip n is still OPEN at its own halt check, so it is not inserted yet.
      const counted = consecutiveRuleSkips(h.history.recentPlaysForCounting(20));
      seen.push({ afterSkip: n, counted, wouldHalt: counted >= MAX_CONSECUTIVE_RULE_SKIPS });

      // ...then the skip lands, the track changes, and the play closes and is linked.
      const playId = insertPlay(h.db, `t${n}`, `2026-10-04T10:0${n}:00.000Z`, `2026-10-04T10:0${n}:05.000Z`);
      firedAndLinked(h, playId, `t${n}`, `ev-${n}`, `2026-10-04T10:0${n}:05.014Z`);
    }

    assert.deepEqual(
      seen.map((s) => s.counted),
      [0, 1, 2, 3],
      'the counter lags the skip it is checking by exactly one',
    );
    assert.deepEqual(
      seen.map((s) => s.wouldHalt),
      [false, false, false, true],
      'so the FOURTH skip is the one that latches the halt',
    );
    h.db.close();
  });
});

describe('⭐ the safety limit does not depend on the label being right', () => {
  it('⚠️ counts even when skip_source still says `user`', () => {
    // The exact state the corpus was in after the first live test. If the counter read the label this
    // would be 0 — which is what it was. A guard that depends on a label is a guard that a labelling bug
    // disables.
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z', 'skipped', 'user');
    firedAndLinked(h, playId, 't1', 'ev-1');

    assert.equal(h.history.recentPlaysForCounting(20)[0]?.skippedByRule, true);
    h.db.close();
  });

  it('⚠️ and counts regardless of the OUTCOME the classifier assigned', () => {
    // An attempt that reached the player IS a rule skip, whatever the classifier later decided about the
    // tail. BR-35 counts what automation DID, not how the play was graded.
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z', 'completed', null);
    firedAndLinked(h, playId, 't1', 'ev-1');

    assert.equal(h.history.recentPlaysForCounting(20)[0]?.skippedByRule, true);
    h.db.close();
  });

  it('a REFUSED attempt does not count — it never reached the player', () => {
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    const id = h.attempts.enqueue(newAttempt({ evaluationId: 'ev-1', trackId: 't1' }));
    h.attempts.transition(id, 'refused', { refusedReason: 'automation-off' });
    h.attempts.attachPlayId('ev-1', playId);

    assert.equal(h.history.recentPlaysForCounting(20)[0]?.skippedByRule, false);
    assert.equal(h.attempts.reachedPlayerForEvaluation('ev-1'), false);
    h.db.close();
  });

  it('⚠️ an UNCONFIRMED attempt DOES count — unknown counts as landed (P-30)', () => {
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    const id = h.attempts.enqueue(newAttempt({ evaluationId: 'ev-1', trackId: 't1' }));
    h.attempts.transition(id, 'unconfirmed', { firedAt: '2026-10-04T10:00:03.000Z' });
    h.attempts.attachPlayId('ev-1', playId);

    assert.equal(h.history.recentPlaysForCounting(20)[0]?.skippedByRule, true);
    assert.equal(h.attempts.reachedPlayerForEvaluation('ev-1'), true);
    h.db.close();
  });

  it('⚠️ a REPEAT listen does not inherit the earlier play’s attempt', () => {
    // Two play rows, two ids, two independent answers.
    const h = fresh();
    const first = insertPlay(h.db, 'same', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    firedAndLinked(h, first, 'same', 'ev-1');
    insertPlay(h.db, 'same', '2026-10-04T11:00:00.000Z', '2026-10-04T11:03:00.000Z', 'completed', null);

    assert.deepEqual(h.history.recentPlaysForCounting(20).map((r) => r.skippedByRule), [true, false]);
    h.db.close();
  });
});

describe('⭐ a missing play_id is SURFACED, not designed around', () => {
  /**
   * ⚠️ The counter joins on `play_id`, so an attempt that reached the player and was never linked is
   * invisible to it — the one state that would silently weaken the halt.
   *
   * The previous design tried to make the key immune to that and broke on a 14 ms race instead. The
   * answer is not a cleverer key: it is **a visible failure.** `/api/diagnostics` reports a non-zero
   * count here as a fault.
   */
  it('unlinkedFiredCount reports a fired attempt with no play row', () => {
    const h = fresh();
    insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    const id = h.attempts.enqueue(newAttempt({ evaluationId: 'ev-1', trackId: 't1' }));
    h.attempts.transition(id, 'confirmed', { firedAt: '2026-10-04T10:00:03.000Z' });
    // ...and attachPlayId is deliberately NOT called.

    assert.equal(h.attempts.unlinkedFiredCount(), 1);
    assert.equal(h.history.recentPlaysForCounting(20)[0]?.skippedByRule, false, 'so it is invisible to the counter');
    h.db.close();
  });

  it('is zero once the link is made', () => {
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z');
    firedAndLinked(h, playId, 't1', 'ev-1');
    assert.equal(h.attempts.unlinkedFiredCount(), 0);
    h.db.close();
  });

  it('⚠️ a REFUSED attempt with no play_id is not a fault', () => {
    // Refusals routinely have no play link -- the play may never close while the attempt is refused, and
    // nothing was issued. Counting them here would make the fault indicator permanently red.
    const h = fresh();
    const id = h.attempts.enqueue(newAttempt({ evaluationId: 'ev-1', trackId: 't1' }));
    h.attempts.transition(id, 'refused', { refusedReason: 'play-closed' });
    assert.equal(h.attempts.unlinkedFiredCount(), 0);
    h.db.close();
  });
});

describe('⭐ the label and the counter agree, because both come from skip_attempt', () => {
  it('markSkippedByRule sets the label the counter already implies', () => {
    const h = fresh();
    const playId = insertPlay(h.db, 't1', '2026-10-04T10:00:00.000Z', '2026-10-04T10:00:05.000Z', 'skipped', 'user');
    firedAndLinked(h, playId, 't1', 'ev-1');

    // What `server.ts` does in the link callback.
    assert.equal(h.attempts.reachedPlayerForEvaluation('ev-1'), true);
    h.history.markSkippedByRule(playId);

    const row = h.db.prepare('SELECT skip_source FROM play WHERE id = ?').get(playId) as { skip_source: string };
    assert.equal(row.skip_source, 'rule');
    assert.equal(h.history.recentPlaysForCounting(20)[0]?.skippedByRule, true, 'and the counter agrees');
    h.db.close();
  });
});
