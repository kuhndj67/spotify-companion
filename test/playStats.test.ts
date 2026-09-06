/**
 * Weekly bucketing for the statistics panel.
 *
 * The interesting failures here are all boundaries, and none of them are visible in the chart —
 * a week counted into its neighbour looks exactly like a listening pattern. So the tests are
 * mostly about edges: the Sunday/Monday seam, the year seam where SQLite's own week functions
 * disagree with each other, and the difference between a window that stopped at the cap and one
 * that stopped because there is no more history.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TREND_WEEKS,
  startOfWeekUtc,
  trendWindow,
  weekStarts,
  weeklyBuckets,
} from '../src/history/playStats.js';
import type { PlayTimePoint } from '../src/history/types.js';

function play(startedAt: string, outcome: PlayTimePoint['outcome'] = 'completed'): PlayTimePoint {
  return { startedAt, outcome };
}

describe('startOfWeekUtc', () => {
  it('maps every day of a week to the same Monday', () => {
    // 2026-08-17 is a Monday; through Sunday the 23rd they must all collapse to it.
    for (const day of ['17', '18', '19', '20', '21', '22', '23']) {
      assert.equal(startOfWeekUtc(`2026-08-${day}T12:00:00.000Z`), '2026-08-17');
    }
    assert.equal(startOfWeekUtc('2026-08-24T00:00:00.000Z'), '2026-08-24');
  });

  it('puts Sunday at the END of its week, not the start', () => {
    // The single most likely off-by-one: getUTCDay() calls Sunday 0, so an unshifted
    // implementation moves Sunday's plays forward into the following week.
    assert.equal(startOfWeekUtc('2026-08-23T23:59:59.999Z'), '2026-08-17');
  });

  it('is exact at midnight UTC on the Monday itself', () => {
    assert.equal(startOfWeekUtc('2026-08-17T00:00:00.000Z'), '2026-08-17');
  });

  it('crosses a year boundary without inventing a week zero', () => {
    // This is what SQLite's %W and %U disagree about. 2026-12-28 is a Monday, so the week
    // straddles into January and must keep ONE week start, not split at the year.
    assert.equal(startOfWeekUtc('2026-12-31T18:00:00.000Z'), '2026-12-28');
    assert.equal(startOfWeekUtc('2027-01-01T06:00:00.000Z'), '2026-12-28');
    assert.equal(startOfWeekUtc('2027-01-03T23:00:00.000Z'), '2026-12-28');
    assert.equal(startOfWeekUtc('2027-01-04T00:00:00.000Z'), '2027-01-04');
  });
});

describe('trendWindow', () => {
  it('anchors on the corpus when the corpus is younger than the cap', () => {
    const window = trendWindow('2026-08-20T19:22:01.154Z', '2026-09-05T10:00:00.000Z');
    assert.equal(window.start, '2026-08-17');
    assert.equal(window.end, '2026-08-31');
    // Not capped: the axis stops because there is no more history, not because of the limit.
    // The caption depends on telling those apart — "all history" versus "last 26 weeks".
    assert.equal(window.capped, false);
    assert.equal(weekStarts(window).length, 3);
  });

  it('clips to the cap once the corpus is older, and says so', () => {
    const window = trendWindow('2025-01-01T00:00:00.000Z', '2026-09-05T10:00:00.000Z');
    assert.equal(window.capped, true);
    assert.equal(weekStarts(window).length, MAX_TREND_WEEKS);
    assert.equal(window.end, '2026-08-31');
  });

  it('collapses to the current week alone on an empty database', () => {
    const window = trendWindow(null, '2026-09-05T10:00:00.000Z');
    assert.equal(window.start, '2026-08-31');
    assert.equal(window.end, '2026-08-31');
    assert.equal(window.capped, false);
    assert.deepEqual(weekStarts(window), ['2026-08-31']);
  });

  it('always ends with the week containing now, even with no plays in it', () => {
    // The current week is the one the user is listening in; dropping it because it is empty
    // would make the chart look like listening had stopped.
    const window = trendWindow('2026-06-01T00:00:00.000Z', '2026-09-05T10:00:00.000Z');
    assert.equal(window.end, startOfWeekUtc('2026-09-05T10:00:00.000Z'));
  });
});

describe('weeklyBuckets', () => {
  const window = trendWindow('2026-08-17T00:00:00.000Z', '2026-09-02T12:00:00.000Z');

  it('emits a zero bucket for a week with no plays rather than skipping it', () => {
    // A silent gap compresses the axis and turns a fortnight away from Spotify into a
    // continuous line — the opposite of the trend the panel exists to show.
    const buckets = weeklyBuckets([play('2026-08-18T09:00:00.000Z')], window);
    assert.equal(buckets.length, 3);
    assert.deepEqual(
      buckets.map((bucket) => bucket.total),
      [1, 0, 0],
    );
    assert.deepEqual(
      buckets.map((bucket) => bucket.weekStart),
      ['2026-08-17', '2026-08-24', '2026-08-31'],
    );
  });

  it('keeps the three outcomes apart and never folds unknown into either', () => {
    const buckets = weeklyBuckets(
      [
        play('2026-08-18T09:00:00.000Z', 'completed'),
        play('2026-08-19T09:00:00.000Z', 'skipped'),
        play('2026-08-20T09:00:00.000Z', 'unknown'),
        play('2026-08-21T09:00:00.000Z', 'unknown'),
      ],
      window,
    );
    assert.deepEqual(buckets[0]!.byOutcome, { completed: 1, skipped: 1, unknown: 2 });
    assert.equal(buckets[0]!.total, 4);
  });

  it('total is always the sum of the parts', () => {
    const buckets = weeklyBuckets(
      [
        play('2026-08-18T09:00:00.000Z', 'completed'),
        play('2026-08-25T09:00:00.000Z', 'skipped'),
        play('2026-09-01T09:00:00.000Z', 'unknown'),
      ],
      window,
    );
    for (const bucket of buckets) {
      const sum =
        bucket.byOutcome.completed + bucket.byOutcome.skipped + bucket.byOutcome.unknown;
      assert.equal(bucket.total, sum, `week ${bucket.weekStart} does not add up`);
    }
  });

  it('drops plays before the window instead of piling them onto the first column', () => {
    // Clamping out-of-range rows into the edge bucket is the tempting alternative, and it
    // would render six months of history as one enormous spike in the oldest week.
    const buckets = weeklyBuckets(
      [play('2026-05-01T09:00:00.000Z'), play('2026-08-18T09:00:00.000Z')],
      window,
    );
    assert.equal(buckets[0]!.total, 1);
    assert.equal(
      buckets.reduce((sum, bucket) => sum + bucket.total, 0),
      1,
    );
  });

  it('drops plays after the window rather than clamping them to the last column', () => {
    const buckets = weeklyBuckets([play('2026-10-01T09:00:00.000Z')], window);
    assert.equal(
      buckets.reduce((sum, bucket) => sum + bucket.total, 0),
      0,
    );
  });

  it('files a Sunday-night play into the week it belongs to', () => {
    // 2026-08-23 is a Sunday: it belongs to the week of the 17th, not the 24th.
    const buckets = weeklyBuckets([play('2026-08-23T22:45:00.000Z')], window);
    assert.equal(buckets[0]!.total, 1);
    assert.equal(buckets[1]!.total, 0);
  });

  it('returns an empty-but-complete axis when there are no plays at all', () => {
    const buckets = weeklyBuckets([], window);
    assert.equal(buckets.length, 3);
    assert.ok(buckets.every((bucket) => bucket.total === 0));
  });
});
