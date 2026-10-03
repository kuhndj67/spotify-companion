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

import { localWeekStart } from '../reporting/timeBuckets.js';
import type { PlayTimePoint } from './types.js';

export type { PlayTimePoint };

/**
 * What a play contributes to the chart.
 *
 * ⚠️ **`not-observed` and `inconclusive` are separated deliberately, and merging them is the
 * defect this type exists to prevent.** Both were `unknown` until 2026-09-06, and the result was
 * that a chart of *listening* was silently reporting the *app's uptime*:
 *
 * - `not-observed` — the play came from `recently-played` because the app was not running.
 *   There is no observation trail, there never can be, and nothing about how the track was
 *   listened to is known. On this corpus that was **84 of 149 plays**, from the seven days before
 *   the container deployment existed.
 * - `inconclusive` — the app *was* watching and could not classify: a pause, a stop, a shutdown
 *   mid-track. A real measurement that happens to be indeterminate.
 *
 * Rendering both as one "unknown" bar made 74% completion on the days the instrument was running
 * look like 38% completion overall. That is the `null` ≠ `0` rule applied to a chart: the absence
 * of a measurement is not a measurement with an absent value.
 */
export type PlayBucket =
  | 'completed'
  /**
   * The listener skipped it.
   *
   * ✅ As of classifier v2 this means what it says. A fourth bucket, `ended-early`, existed from
   * 2026-09-21 to 2026-09-22 to hold plays that ran nearly to the end and were then replaced by
   * something the listener did not choose — 24 of 46 live skips. Those turned out to be
   * **completions**: the API had stopped reporting the track while it was still playing. v2
   * classifies them as `completed`, so there is nothing left for a fourth bucket to hold.
   *
   * ⚠️ Do not re-derive that distinction here. It belongs in the outcome, which is where v2 put
   * it — a display-layer split over a fixed outcome is how the 2026-09-21 defect happened, twice
   * (`bucketOf` and `trackPlayStats` each had a copy).
   */
  | 'skipped'
  | 'inconclusive'
  | 'not-observed';

/*
 * ⚠️ **`PLAY_BUCKETS` was REMOVED 2026-10-03 (found by `knip`), and it should not come back.**
 *
 * It declared *"the four display buckets, in stack order"* and **nothing imported it, ever.** The order
 * it claimed to own actually lives in `public/app.js` as `DRAWN_SERIES` — which carries a label and a
 * fill per bucket, and which deliberately **omits `not-observed` from the plot** while still counting it
 * everywhere else. So this constant was not merely dead: it read as the source of truth for a stack order
 * that a different file decides, and the two could have disagreed silently.
 *
 * ⚠️ The `PlayBucket` **type** is still used and is unaffected. If a server-side list is ever wanted,
 * remember that *drawn* and *counted* are different sets — that asymmetry is the 2026-09-06 fix.
 */

/**
 * Which bucket a play falls in. Provenance decides first — it is the stronger fact.
 *
 * ⚠️ **THIS ONCE AGAIN RETURNS `skipped` FOR EVERY `skipped` OUTCOME, AND THAT IS NOT A
 * REGRESSION — read this before "re-fixing" it.** It did so until 2026-09-21, and that *was* a
 * defect: the panel reported skips of artists the listener never skips, because v1's outcome
 * counted transitions as rejections. The fix then was a display-layer split on
 * `skipAttribution`.
 *
 * Classifier v2 (2026-09-22) moved the correction into the **outcome**, where it belongs: a
 * `skipped` row now excludes the overlapping transitions by construction, so there is nothing for
 * this function to subtract. The old split has been removed, and re-adding one here would
 * reintroduce the two-copies-of-one-rule shape that cost the 2026-09-21 defect its second
 * appearance — `bucketOf` and `trackPlayStats` each held a version, and fixing one missed the other.
 */
export function bucketOf(play: PlayTimePoint): PlayBucket {
  if (play.provenance === 'backfilled') return 'not-observed';
  if (play.outcome === 'unknown') return 'inconclusive';
  return play.outcome;
}

function emptyCounts(): Record<PlayBucket, number> {
  return { completed: 0, skipped: 0, inconclusive: 0, 'not-observed': 0 };
}

/** How far back the artist trend can reach: 26 weeks ≈ 6 months. */
export const MAX_TREND_WEEKS = 26;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** One column of the trend. `total` is the sum of `byBucket`, kept so the view need not re-add. */
export interface WeekBucket {
  /**
   * ISO date (`YYYY-MM-DD`) of the Monday that opens the week, **in the report time zone** — not
   * UTC. See `startOfWeek`.
   */
  weekStart: string;
  byBucket: Record<PlayBucket, number>;
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

/**
 * Monday of the week containing `iso`, as a `YYYY-MM-DD` date in `timeZone`.
 *
 * ⚠️ **NO DEFAULT ZONE, ON PURPOSE.** This was `startOfWeekUtc(iso)` until 2026-09-22, and UTC is
 * measurably not what a reader means by "a week": the host zone is `America/New_York` and 63% of
 * plays fall between 23:00Z and 04:00Z, which is the *previous* local evening. A defaulted
 * parameter would let a caller get UTC back without saying so, which is how the old behaviour
 * would quietly return.
 *
 * ⚠️ **Switching to local time moved 18 of 662 plays** out of the week of 2026-09-07 and into
 * 2026-08-31 — Sunday-evening listening that UTC counted as Monday. Numbers read off this chart
 * before 2026-09-22 are therefore not directly comparable with numbers read after it. The effect
 * is ~3% at week granularity and smaller at month, against 49% at *day* granularity, which is why
 * it was worth correcting even though the chart shows weeks.
 *
 * ⚠️ The arithmetic lives in `reporting/timeBuckets.ts` and is **not duplicated here.** A second
 * copy differing only by time zone is the shape that produced `bucketOf` vs `trackPlayStats`.
 */
export function startOfWeek(iso: string, timeZone: string): string {
  return localWeekStart(iso, timeZone);
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
  timeZone: string,
  maxWeeks: number = MAX_TREND_WEEKS,
): TrendWindow {
  const end = startOfWeek(nowIso, timeZone);
  const earliestAllowed = shiftWeeks(end, -(Math.max(1, maxWeeks) - 1));
  const corpusStart = firstPlayedAt === null ? end : startOfWeek(firstPlayedAt, timeZone);

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
 * Buckets are kept apart rather than summed — see `PlayBucket`. In particular a play the app
 * never watched is never counted alongside one it watched and could not classify.
 */
export function weeklyBuckets(
  plays: readonly PlayTimePoint[],
  window: TrendWindow,
  timeZone: string,
): WeekBucket[] {
  const buckets = new Map<string, WeekBucket>();
  for (const weekStart of weekStarts(window)) {
    buckets.set(weekStart, { weekStart, byBucket: emptyCounts(), total: 0 });
  }

  for (const play of plays) {
    const bucket = buckets.get(startOfWeek(play.startedAt, timeZone));
    // Plays outside the window are dropped rather than clamped into the edge bucket, which would
    // pile six months of history onto one column and read as a listening spike.
    if (bucket === undefined) continue;
    bucket.byBucket[bucketOf(play)] += 1;
    bucket.total += 1;
  }

  return [...buckets.values()];
}
