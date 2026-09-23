/**
 * The reporting fact row: one play, flattened, with its calendar buckets pre-computed. ⚙️ PURE
 *
 * ## Why the buckets are computed here and not in the BI tool
 *
 * A BI tool grouping by "week" does its own date arithmetic in SQL. SQLite's `%W` counts weeks
 * from the first Sunday and `%U` from the first Monday, and **neither is the ISO week** — at a
 * year boundary they emit a week `00` that is sometimes partial and sometimes fused with December.
 * That is one wrong week in fifty-two, drawn as a listening pattern rather than raised as an
 * error, and it is the reason this project already refused to bucket in SQL once.
 *
 * It would also re-timezone. `started_at` is UTC and 63% of this corpus falls between 23:00Z and
 * 04:00Z — the previous local evening — so a tool applying its own zone (or none) misdates 49% of
 * plays by a day.
 *
 * So the fact row carries `local_day`, `local_week` and `local_month` as **finished strings**,
 * computed by `timeBuckets.ts`, the same module the app's own chart uses. The BI tool groups by a
 * column and does no arithmetic. One implementation, and the report cannot disagree with the app.
 *
 * ⚠️ `play_bucket` comes from `bucketOf` in `history/playStats.ts` — **not a second copy of that
 * rule.** Re-deriving "is this a skip" in a dashboard is how the 2026-09-21 defect got its second
 * appearance, when `bucketOf` and `trackPlayStats` each held a version and fixing one missed the
 * other.
 */

import { bucketOf, type PlayBucket } from '../history/playStats.js';
import type { PlayOutcome, Provenance } from '../history/types.js';
import {
  localDay,
  localHour,
  localMonth,
  localWeekStart,
  weekdayOfCalendarDay,
  weekdayOrdinalOfCalendarDay,
} from './timeBuckets.js';

/** The columns read out of `history.db`. Exactly the source of every field below. */
export interface SourcePlay {
  id: number;
  started_at: string;
  outcome: string;
  provenance: string;
  close_reason: string | null;
  artist_id: string | null;
  artist_name: string | null;
  track_id: string | null;
  title: string | null;
  ev_completion_ratio: number | null;
  ev_duration_ms: number | null;
  ev_max_progress_ms: number | null;
  label_verdict: string | null;
  explicit: number | null;
  album_type: string | null;
  classifier_version: number | null;
  isrc: string | null;
}

export interface FactRow {
  play_id: number;
  /** UTC instant, kept for traceability back to `history.db`. Never grouped on. */
  started_at: string;
  local_day: string;
  local_week: string;
  local_month: string;
  local_hour: number;
  local_weekday: string;
  local_weekday_ord: number;

  artist_id: string | null;
  /**
   * The credit string as stored.
   *
   * ⚠️ **THIS FIELD MEANS TWO DIFFERENT THINGS DEPENDING ON `provenance`.** Measured 2026-09-22:
   * live rows hold the full joined credit (`"Macklemore, anees, MC Abdul, Amer Zahr"`) and 148 of
   * 576 are multi-artist; backfilled rows hold **only the lead name** — `RecentlyPlayedBackfill`
   * stores `artists[0].name` — and **0 of 86** are multi-artist, not because those tracks are
   * solo but because the information was never recorded. The same track appears as
   * `"Ren, Eden Nash"` when live and `"Ren"` when backfilled.
   *
   * Group on `lead_artist_name` instead; it is well defined for both.
   */
  artist_name: string;
  /**
   * The lead artist's own name — the first element of the credit string, which pairs 1:1 with
   * `artist_id`.
   *
   * ⚠️ Derived rather than guessed: `artist_name` is built in `artists` order, so element 0 is
   * `artists[0]`, which is exactly what `artist_id` holds. Verified over the corpus — Ren's id
   * appears under 6 credit strings and Macklemore's under 18, every one of them beginning with the
   * lead's name.
   *
   * ⚠️ **Group artist reports on this, not on `artist_name`.** Grouping on the full credit
   * fragments one artist across every collaboration: Ren's 55 plays split into 44 + 11 across six
   * strings, which reads as a smaller artist rather than as a grouping artefact.
   */
  lead_artist_name: string;
  /**
   * How many names appear in the credit, or `null` when that is unknowable.
   *
   * ⚠️ **`null` on backfilled rows, and that is the point** — `null` means unknown here exactly as
   * it does everywhere else in this project. A backfilled row records only the lead name, so a
   * count of `1` would assert "this track has one artist" when the truth is "nobody wrote it
   * down". Writing `1` would make the multi-artist rate look lower than it is.
   */
  artist_credit_count: number | null;

  track_id: string;
  track_title: string;

  outcome: string;
  /** `completed` | `skipped` | `inconclusive` | `not-observed`, from `bucketOf`. */
  play_bucket: PlayBucket;
  provenance: string;
  /** 1 when the app watched this play and holds a trail; 0 when it was backfilled. */
  observed: number;

  completion_ratio: number | null;
  duration_ms: number | null;
  duration_s: number | null;
  max_progress_ms: number | null;
  /** `duration - maxProgress`: the axis classifier v2 decides `skipped` vs `completed` on. */
  unobserved_tail_ms: number | null;

  label_verdict: string | null;
  explicit: number | null;
  album_type: string | null;
  classifier_version: number | null;
  has_isrc: number;

  /**
   * Always 1, and it is a warning rather than a fact about the play.
   *
   * ⚠️ `artist_id` is `track.artists[0]` — the **lead** artist only, so a feature credit is filed
   * under the lead and absent from the guest's totals. Resolved and measured 2026-09-22 over 662
   * plays and 234 credited artists:
   *
   * ```
   *   99 of 234 artists are INVISIBLE here   (0 lead plays, 185 artist-plays between them)
   *   112 of 234 are understated at all
   *   Ren          55 lead -> 87 credited   (37% understated)
   *   Macklemore   29 lead -> 50 credited   (42%)  -- 5th lead-only, 3rd corrected
   *   Chris Webby   0 lead -> 24 credited   (invisible)
   *   Ryan Lewis    0 lead -> 17 credited   (invisible)
   *   Token/Prof   unaffected -- they always lead
   * ```
   *
   * ⚠️ Earlier revisions of this comment quoted "Ren 44 vs 79 (44%), Macklemore 9 vs 50 (82%),
   * Token 59%". **Those were wrong**: they compared exact bare-string matches against
   * credit-contains matches, so `"Macklemore, Kesha"` never counted as a Macklemore *lead*, which
   * made every lead figure too low and every percentage too high. The numbers above come from the
   * resolved credits.
   *
   * ⚠️ **`play_artist` is the fix, and this column marks the rows that still need it.** Rank
   * artists on `artist_credit_totals.artist_plays`, never on a count over `play_fact`.
   */
  artist_lead_only: number;
}

/**
 * Number of names in a stored credit string, or `null` when the string cannot carry the answer.
 *
 * `provenance` decides first, as it does in `bucketOf`: a backfilled row holds only the lead name,
 * so its credit count is **unknown**, not 1.
 */
export function creditCount(artistName: string, provenance: string): number | null {
  if (provenance !== 'live') return null;
  const trimmed = artistName.trim();
  if (trimmed === '') return null;
  return trimmed.split(',').filter((part) => part.trim() !== '').length;
}

/** The lead artist's name: the first element of a credit string. `"A, B, C"` -> `"A"`. */
export function leadArtistName(artistName: string): string {
  const first = artistName.split(',')[0]!.trim();
  return first === '' ? 'unknown' : first;
}

/**
 * Flatten one play into a fact row.
 *
 * ⚠️ **Total, and never invents a bucket.** A row whose `started_at` cannot be interpreted throws
 * from `timeBuckets`, because filing it under an arbitrary day would make the report wrong with
 * nothing saying so. A row with no artist or track id keeps a `null` id and a readable name —
 * `null` means unknown here exactly as it does everywhere else, and must not become `0` or `''`.
 */
export function toFactRow(play: SourcePlay, timeZone: string): FactRow {
  const day = localDay(play.started_at, timeZone);
  const artistName = play.artist_name ?? 'unknown';
  const durationMs = play.ev_duration_ms;
  const maxProgressMs = play.ev_max_progress_ms;

  return {
    play_id: play.id,
    started_at: play.started_at,
    local_day: day,
    local_week: localWeekStart(play.started_at, timeZone),
    local_month: localMonth(play.started_at, timeZone),
    local_hour: localHour(play.started_at, timeZone),
    local_weekday: weekdayOfCalendarDay(day),
    local_weekday_ord: weekdayOrdinalOfCalendarDay(day),

    artist_id: play.artist_id,
    artist_name: artistName,
    lead_artist_name: leadArtistName(artistName),
    artist_credit_count: creditCount(artistName, play.provenance),

    track_id: play.track_id ?? 'unknown',
    track_title: play.title ?? 'unknown',

    outcome: play.outcome,
    play_bucket: bucketOf({
      startedAt: play.started_at,
      outcome: play.outcome as PlayOutcome,
      provenance: play.provenance as Provenance,
    }),
    provenance: play.provenance,
    observed: play.provenance === 'live' ? 1 : 0,

    completion_ratio: play.ev_completion_ratio,
    duration_ms: durationMs,
    duration_s: durationMs === null ? null : Math.round(durationMs / 1000),
    max_progress_ms: maxProgressMs,
    unobserved_tail_ms:
      durationMs === null || maxProgressMs === null ? null : durationMs - maxProgressMs,

    label_verdict: play.label_verdict,
    explicit: play.explicit,
    album_type: play.album_type,
    classifier_version: play.classifier_version,
    has_isrc: play.isrc === null ? 0 : 1,

    artist_lead_only: 1,
  };
}

/** Column order for the generated table. Exported so the writer cannot drift from the type. */
export const FACT_COLUMNS: readonly (keyof FactRow)[] = [
  'play_id',
  'started_at',
  'local_day',
  'local_week',
  'local_month',
  'local_hour',
  'local_weekday',
  'local_weekday_ord',
  'artist_id',
  'artist_name',
  'lead_artist_name',
  'artist_credit_count',
  'track_id',
  'track_title',
  'outcome',
  'play_bucket',
  'provenance',
  'observed',
  'completion_ratio',
  'duration_ms',
  'duration_s',
  'max_progress_ms',
  'unobserved_tail_ms',
  'label_verdict',
  'explicit',
  'album_type',
  'classifier_version',
  'has_isrc',
  'artist_lead_only',
];
