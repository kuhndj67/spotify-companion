/**
 * Calendar bucketing for reports and charts. ⚙️ PURE
 *
 * ## Why this module exists, and why it takes a time zone
 *
 * `playStats.ts` bucketed in **UTC**, which is correct for its own tests and was never wrong for
 * anything it drew. It is badly wrong for a *daily* report.
 *
 * Measured 2026-09-22 on 662 plays, host zone `America/New_York`:
 *
 * ```
 *   plays by UTC hour:  23Z 80 · 00Z 97 · 01Z 112 · 02Z 79 · 03Z 39 · 04Z 10
 *                       = 417 of 662 (63%) between 23:00Z and 04:00Z
 *                       = 19:00-00:00 LOCAL, i.e. the previous local day
 *
 *   DAY differs UTC vs local : 327 of 662  (49%)
 *   ISO WEEK differs         :  18 of 662  ( 3%)  -- one seam, Sunday evenings
 * ```
 *
 * So a UTC "day" misdates **half the corpus**, and it would read as a listening pattern rather
 * than a bug — the same shape as the `%W` week-numbering trap that put this bucketing in
 * JavaScript in the first place.
 *
 * ⚠️ **This is ONE implementation with a parameter, not a second implementation.** `playStats.ts`
 * delegates here and passes `'UTC'`, so its behaviour and its tests are unchanged; the report
 * passes the local zone. Writing a separate local-time bucketer for the report would have been
 * the two-copies-of-one-rule shape that has already cost this project three defects (`bucketOf`
 * vs `trackPlayStats`, `localGuard` HTTP vs WebSocket, `attribute-skips.mjs` vs
 * `skipAttribution.ts`).
 *
 * ⚠️ **Switching the app chart to local time is a ONE-LINE change with a consequence**: 18 plays
 * move from the week of 2026-09-07 to the week of 2026-08-31. That is a real correction, not a
 * regression, but it changes numbers a person may have already read — so it is a deliberate
 * decision, not a tidy-up.
 *
 * ## Why every function demands a time zone
 *
 * `new Intl.DateTimeFormat(locale, {})` with no `timeZone` silently uses the **system** zone.
 * That is ambient non-determinism of exactly the kind `test/purity.test.ts` exists to catch: the
 * same play would bucket differently on two machines, and every test would still pass. There is
 * therefore **no default** — a caller must say which zone it means. `purity.test.ts` also now
 * rejects `Intl.DateTimeFormat()` and `resolvedOptions().timeZone` in a pure module.
 *
 * DST is handled by the zone database rather than by an offset: probed in the container on
 * 2026-09-22, `America/New_York` yields `EST` in January and `EDT` in July, so a fixed `-05:00`
 * would have been wrong for most of the year. Full ICU is present — the image is
 * `node:22-bookworm-slim`, not Alpine.
 */

/** `YYYY-MM-DD`, `YYYY-MM` and hour parts of an instant, as seen in `timeZone`. */
interface CalendarParts {
  year: string;
  month: string;
  day: string;
  hour: number;
}

/**
 * Formatters are expensive to construct and cheap to reuse, and a report builds one bucket per
 * play. Keyed by zone; the key is the only input that varies.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    // `hourCycle: 'h23'` so midnight is hour 0 rather than 24 — 'h24' reports 24 for midnight,
    // which would put every midnight play in a bucket that does not exist.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * ⚠️ Read through `formatToParts`, never by parsing a formatted string. A locale can reorder or
 * re-punctuate the output, and `en-CA` producing `YYYY-MM-DD` today is a convention rather than a
 * guarantee. Parts are addressed by name and cannot be reordered.
 */
function partsOf(iso: string, timeZone: string): CalendarParts {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    throw new RangeError(`timeBuckets: not a parseable instant: ${JSON.stringify(iso)}`);
  }

  const found: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }

  return {
    year: found.year!,
    month: found.month!,
    day: found.day!,
    hour: Number.parseInt(found.hour!, 10),
  };
}

/** The calendar day containing `iso` in `timeZone`, as `YYYY-MM-DD`. */
export function localDay(iso: string, timeZone: string): string {
  const { year, month, day } = partsOf(iso, timeZone);
  return `${year}-${month}-${day}`;
}

/** The calendar month containing `iso` in `timeZone`, as `YYYY-MM`. */
export function localMonth(iso: string, timeZone: string): string {
  const { year, month } = partsOf(iso, timeZone);
  return `${year}-${month}`;
}

/** Hour of the local day, `0`–`23`. Useful as a report dimension; never used for day bucketing. */
export function localHour(iso: string, timeZone: string): number {
  return partsOf(iso, timeZone).hour;
}

/**
 * Monday of the ISO week containing `iso` in `timeZone`, as `YYYY-MM-DD`.
 *
 * The weekday is derived from the already-localised calendar date rather than from the instant,
 * which is what makes this correct across a DST boundary: the local date is fixed first, and the
 * week is then pure calendar arithmetic over it.
 *
 * ⚠️ Anchored at **noon UTC** on that local date. Midnight would sit on the day boundary, where a
 * zone transition can move the date by a day and silently shift the whole week.
 */
export function localWeekStart(iso: string, timeZone: string): string {
  const day = localDay(iso, timeZone);
  return weekStartOfCalendarDay(day);
}

/** Monday of the ISO week containing a bare `YYYY-MM-DD`. Pure calendar arithmetic, no zone. */
export function weekStartOfCalendarDay(day: string): string {
  const at = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) {
    throw new RangeError(`timeBuckets: not a calendar day: ${JSON.stringify(day)}`);
  }
  // getUTCDay() is 0 for Sunday; shift so Monday is 0 and the week never splits a weekend.
  const daysSinceMonday = (at.getUTCDay() + 6) % 7;
  const monday = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate() - daysSinceMonday,
  );
  return new Date(monday).toISOString().slice(0, 10);
}

/** Short weekday name for a bare `YYYY-MM-DD`. Noon-anchored, for the reason above. */
export function weekdayOfCalendarDay(day: string): string {
  const at = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) {
    throw new RangeError(`timeBuckets: not a calendar day: ${JSON.stringify(day)}`);
  }
  // Fixed English names rather than a locale lookup: this is a stable key a report groups and
  // sorts by, not prose for a reader, and a locale-dependent key would regroup by machine.
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getUTCDay()]!;
}

/** Monday-first ordinal for a bare `YYYY-MM-DD`, so a report can sort weekdays correctly. */
export function weekdayOrdinalOfCalendarDay(day: string): number {
  const at = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) {
    throw new RangeError(`timeBuckets: not a calendar day: ${JSON.stringify(day)}`);
  }
  return (at.getUTCDay() + 6) % 7;
}

/**
 * The zone a report buckets in.
 *
 * ⚠️ **Not read from the system.** It is configuration, so that a report generated on one machine
 * and read on another says the same thing, and so that `purity.test.ts` stays meaningful.
 */
export const DEFAULT_REPORT_TIME_ZONE = 'America/New_York';
