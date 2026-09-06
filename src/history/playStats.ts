/**
 * Weekly bucketing for the listening-statistics panel.
 *
 * **Pure** (P-9): every function here is a function of its arguments, `now` included. That is not
 * ceremony — a trend chart whose window depends on ambient time cannot be tested for the one thing
 * that actually goes wrong in it, which is the boundary between two weeks.
 *
 * ## Why the buckets are built here and not in SQL
 *
 * SQLite's `strftime('%W')` counts weeks from the first Sunday of the year, `%U` from the first
 * Monday, and neither is the ISO week. At a year boundary they produce a week `00` that is
 * sometimes a partial week and sometimes fused with the previous December — which is to say the
 * chart would be quietly wrong for one week in fifty-two, in a way that looks like a listening
 * pattern rather than a bug. This is the same shape as the `inc=releases` finding: a plausible
 * wrong answer is worse than a loud one. The corpus is a few hundred rows and grows by ~200 a
 * day, so counting in JavaScript costs nothing and is testable at the boundary.
 *
 * ## Empty weeks are emitted, not skipped
 *
 * A week with no plays is a **zero**, and it is a fact about listening. Omitting it would compress
 * the x-axis and turn a fortnight away from Spotify into a continuous line — the opposite of the
 * trend the panel exists to show.
 */

import type { PlayOutcome, PlayTimePoint } from './types.js';

export type { PlayTimePoint };

/** How far back the artist trend can reach: 26 weeks ≈ 6 months. */
export const MAX_TREND_WEEKS = 26;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** One column of the trend. `total` is the sum of `byOutcome`, kept so the view need not re-add. */
export interface WeekBucket {
  /** ISO date (`YYYY-MM-DD`) of the Monday that opens the week, UTC. */
  weekStart: string;
  byOutcome: Record<PlayOutcome, number>;
  total: number;
}

export interface TrendWindow {
  /** Monday of the first week shown. */
  start: string;
  /** Monday of the week containing `now` — the window always ends with the current week. */
  end: string;
  /**
   * True when the window was clipped by `MAX_TREND_WEEKS` rather than by the start of the corpus.
   *
   * The caller needs to tell those apart: a window that stops at the cap means "there is older
   * history off-screen", and a window that stops at the corpus means "this is everything there
   * is". Rendering both as the same axis would let 17 days of data read as six months of it.
   */
  capped: boolean;
}

/** Monday of the week containing `iso`, as a `YYYY-MM-DD` date in UTC. */
export function startOfWeekUtc(iso: string): string {
  const at = new Date(iso);
  // getUTCDay() is 0 for Sunday; shift so Monday is 0 and the week never splits a weekend.
  const daysSinceMonday = (at.getUTCDay() + 6) % 7;
  const monday = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate() - daysSinceMonday,
  );
  return new Date(monday).toISOString().slice(0, 10);
}

/** `weekStart` shifted by whole weeks. Exact: week starts are midnight UTC, so no DST to cross. */
function shiftWeeks(weekStart: string, weeks: number): string {
  return new Date(Date.parse(`${weekStart}T00:00:00.000Z`) + weeks * MS_PER_WEEK)
    .toISOString()
    .slice(0, 10);
}

/**
 * The window to plot: adaptive, capped at `maxWeeks`.
 *
 * Anchored on the **corpus** start rather than on the artist's first play, so that every artist's
 * chart shares one x-axis. Anchoring per artist would silently rescale the axis between tracks,
 * and two charts that cannot be compared are worse than one that is mostly empty.
 *
 * `firstPlayedAt === null` (an empty database) collapses to the current week alone.
 */
export function trendWindow(
  firstPlayedAt: string | null,
  nowIso: string,
  maxWeeks: number = MAX_TREND_WEEKS,
): TrendWindow {
  const end = startOfWeekUtc(nowIso);
  const earliestAllowed = shiftWeeks(end, -(Math.max(1, maxWeeks) - 1));
  const corpusStart = firstPlayedAt === null ? end : startOfWeekUtc(firstPlayedAt);

  // A corpus that starts *after* the cap is the normal young-database case; the window then
  // begins at the corpus and the chart is honestly short.
  const capped = corpusStart < earliestAllowed;
  return { start: capped ? earliestAllowed : corpusStart, end, capped };
}

/** Every Monday from `start` to `end` inclusive. */
export function weekStarts(window: TrendWindow): string[] {
  const weeks: string[] = [];
  for (let week = window.start; week <= window.end; week = shiftWeeks(week, 1)) {
    weeks.push(week);
    // Guard against a malformed window (start after end) spinning forever.
    if (weeks.length > 1000) break;
  }
  return weeks;
}

/**
 * Count plays into weekly buckets.
 *
 * Outcomes are kept apart rather than summed. `unknown` is not zero and it is not a skip: for a
 * backfilled play it means there was never an observation trail to classify, and folding it into
 * either of the others would report a judgement the data cannot support (the `null` ≠ `false`
 * rule, applied to a chart).
 */
export function weeklyBuckets(
  plays: readonly PlayTimePoint[],
  window: TrendWindow,
): WeekBucket[] {
  const buckets = new Map<string, WeekBucket>();
  for (const weekStart of weekStarts(window)) {
    buckets.set(weekStart, {
      weekStart,
      byOutcome: { completed: 0, skipped: 0, unknown: 0 },
      total: 0,
    });
  }

  for (const play of plays) {
    const bucket = buckets.get(startOfWeekUtc(play.startedAt));
    // Plays outside the window are dropped rather than clamped into the edge bucket, which would
    // pile six months of history onto one column and read as a listening spike.
    if (bucket === undefined) continue;
    bucket.byOutcome[play.outcome] += 1;
    bucket.total += 1;
  }

  return [...buckets.values()];
}
