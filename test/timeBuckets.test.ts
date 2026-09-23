/**
 * Calendar bucketing (`src/reporting/timeBuckets.ts`).
 *
 * Every case here is one that would produce a **plausible wrong report** rather than an error:
 * a day off by one, a week seam in the wrong place, a midnight bucket that does not exist. None
 * of them throw, and none of them are visible in a chart that does not already look odd.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REPORT_TIME_ZONE,
  localDay,
  localHour,
  localMonth,
  localWeekStart,
  weekStartOfCalendarDay,
} from '../src/reporting/timeBuckets.js';
import { startOfWeek } from '../src/history/playStats.js';

const NY = 'America/New_York';

describe('localDay — the defect this module exists for', () => {
  it('puts a late-evening local play on the evening it happened, not the UTC morning after', () => {
    // 2026-09-22T01:25Z is 2026-09-21 21:25 in New York. This exact play is in the corpus, and
    // 327 of 662 plays share the shape: 49% of the corpus is misdated by a UTC day bucket.
    assert.equal(localDay('2026-09-22T01:25:00.000Z', NY), '2026-09-21');
    assert.equal(localDay('2026-09-22T01:25:00.000Z', 'UTC'), '2026-09-22');
  });

  it('agrees with UTC for a play in the middle of the local afternoon', () => {
    assert.equal(localDay('2026-09-22T16:31:00.000Z', NY), '2026-09-22');
    assert.equal(localDay('2026-09-22T16:31:00.000Z', 'UTC'), '2026-09-22');
  });

  it('handles the local-midnight boundary in both directions', () => {
    // 04:00Z is exactly 00:00 EDT — the first instant of the new local day.
    assert.equal(localDay('2026-09-22T04:00:00.000Z', NY), '2026-09-22');
    // One millisecond earlier is still the previous local day.
    assert.equal(localDay('2026-09-22T03:59:59.999Z', NY), '2026-09-21');
  });
});

describe('DST is handled by the zone, not by a fixed offset', () => {
  it('uses a -05:00 offset in winter and -04:00 in summer', () => {
    // A fixed offset would be wrong for roughly half the year, and the corpus (Aug-Sep) is
    // entirely in the summer half — so a hardcoded -04:00 would pass every test written today
    // and start misdating plays in November.
    assert.equal(localDay('2026-01-15T04:30:00.000Z', NY), '2026-01-14'); // 23:30 EST
    assert.equal(localDay('2026-07-15T04:30:00.000Z', NY), '2026-07-15'); // 00:30 EDT
  });

  it('survives the spring-forward instant without losing or duplicating a day', () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT. Nothing side of it may land on the 7th or the 9th.
    assert.equal(localDay('2026-03-08T06:30:00.000Z', NY), '2026-03-08'); // 01:30 EST
    assert.equal(localDay('2026-03-08T07:30:00.000Z', NY), '2026-03-08'); // 03:30 EDT
  });

  it('survives the fall-back instant, where one local hour occurs twice', () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST. Both 01:30s are the same local day.
    assert.equal(localDay('2026-11-01T05:30:00.000Z', NY), '2026-11-01'); // 01:30 EDT
    assert.equal(localDay('2026-11-01T06:30:00.000Z', NY), '2026-11-01'); // 01:30 EST
  });
});

describe('localHour', () => {
  it('reports midnight as 0, never 24', () => {
    // `hourCycle: 'h24'` reports midnight as 24, which would bucket every midnight play into an
    // hour that does not exist on any axis.
    assert.equal(localHour('2026-09-22T04:00:00.000Z', NY), 0);
    assert.equal(localHour('2026-09-22T04:59:00.000Z', NY), 0);
  });

  it('covers the evening block the corpus actually sits in', () => {
    assert.equal(localHour('2026-09-22T00:29:00.000Z', NY), 20);
    assert.equal(localHour('2026-09-22T01:25:00.000Z', NY), 21);
    assert.equal(localHour('2026-09-21T23:51:00.000Z', NY), 19);
  });
});

describe('localMonth', () => {
  it('moves a month boundary with the local day, not the UTC one', () => {
    // 2026-09-01T02:00Z is 2026-08-31 22:00 local: an August play, not a September one.
    assert.equal(localMonth('2026-09-01T02:00:00.000Z', NY), '2026-08');
    assert.equal(localMonth('2026-09-01T02:00:00.000Z', 'UTC'), '2026-09');
  });
});

describe('localWeekStart', () => {
  it('maps every day of a week to the same Monday', () => {
    // 2026-08-17 is a Monday; local noon on each day through Sunday must collapse to it.
    for (const day of ['17', '18', '19', '20', '21', '22', '23']) {
      assert.equal(localWeekStart(`2026-08-${day}T16:00:00.000Z`, NY), '2026-08-17');
    }
  });

  it('keeps a Sunday-evening local play in the week that Sunday belongs to', () => {
    // THE 18-PLAY SEAM. 2026-09-07T01:00Z is Sunday 2026-09-06 21:00 local. UTC calls it Monday
    // the 7th and opens a new week; locally it closes the previous one. 18 of 662 plays move.
    assert.equal(localWeekStart('2026-09-07T01:00:00.000Z', NY), '2026-08-31');
    assert.equal(localWeekStart('2026-09-07T01:00:00.000Z', 'UTC'), '2026-09-07');
  });

  it('opens a new week on Monday local, not on Monday UTC', () => {
    // Monday 2026-09-07 09:00 local is unambiguously the new week in both zones.
    assert.equal(localWeekStart('2026-09-07T13:00:00.000Z', NY), '2026-09-07');
  });
});

describe('weekStartOfCalendarDay', () => {
  it('is anchored at noon so a zone transition cannot move the date', () => {
    assert.equal(weekStartOfCalendarDay('2026-03-08'), '2026-03-02');
    assert.equal(weekStartOfCalendarDay('2026-11-01'), '2026-10-26');
  });

  it('crosses a year boundary without emitting a week 00', () => {
    // The `%W`/`%U` trap this bucketing exists to avoid: neither is the ISO week, and both emit a
    // week 00 at the year seam that is sometimes partial and sometimes fused with December.
    assert.equal(weekStartOfCalendarDay('2027-01-01'), '2026-12-28'); // Friday -> prev Monday
    assert.equal(weekStartOfCalendarDay('2026-12-31'), '2026-12-28');
    assert.equal(weekStartOfCalendarDay('2027-01-04'), '2027-01-04'); // a Monday
  });
});

describe('playStats delegates here rather than holding a second copy', () => {
  it('startOfWeek is exactly localWeekStart, for any zone', () => {
    // If these ever diverge, there are two implementations of one rule again — the shape that
    // produced `bucketOf` vs `trackPlayStats` and the localGuard HTTP/WebSocket split.
    for (const iso of [
      '2026-08-17T00:00:00.000Z',
      '2026-09-07T01:00:00.000Z',
      '2026-09-22T16:31:13.653Z',
      '2027-01-01T12:00:00.000Z',
    ]) {
      for (const zone of ['UTC', NY]) {
        assert.equal(startOfWeek(iso, zone), localWeekStart(iso, zone), `${iso} ${zone}`);
      }
    }
  });
});

describe('totality', () => {
  it('throws on an uninterpretable instant rather than inventing a bucket', () => {
    // A silent fallback here would file the play under some arbitrary day, which is worse than
    // failing: the report would be wrong and nothing would say so.
    assert.throws(() => localDay('not a date', NY), RangeError);
    assert.throws(() => weekStartOfCalendarDay('2026-13-99'), RangeError);
  });

  it('rejects an unknown time zone rather than falling back to the system one', () => {
    assert.throws(() => localDay('2026-09-22T01:25:00.000Z', 'Mars/Olympus_Mons'), RangeError);
  });

  it('the configured report zone is a real zone', () => {
    assert.doesNotThrow(() => localDay('2026-09-22T01:25:00.000Z', DEFAULT_REPORT_TIME_ZONE));
  });
});
