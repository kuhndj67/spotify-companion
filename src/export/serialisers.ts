/**
 * Export serialisation (FR-49–51, FR-54). ⚙️ PURE — imports nothing impure.
 *
 * ## The one rule that carries the analytical weight
 *
 * **`unknown` must be visibly distinct from every legitimate value, in every column.** Not an
 * empty cell, not `0`, not `false`.
 *
 * This looks pedantic and is not. R2's missing data is *correlated with the variable being
 * measured* — MusicBrainz coverage is thinnest exactly for the independent releases the project
 * most wants to study. An `unknown` that exports as a blank cell disappears into a spreadsheet,
 * and a bias that cannot be seen cannot be corrected for. The coverage counts (FR-51) exist for
 * the same reason: to turn "how much is missing?" from an assumption into a number.
 */

import type { CoverageStats, PlayRecord } from '../history/types.js';

/**
 * The token for absent data. Deliberately not empty, not `null`, not `NA` — something a human
 * scanning a spreadsheet column cannot mistake for a value or overlook as whitespace.
 */
export const UNKNOWN_TOKEN = 'unknown';

/** Columns, in order. Every recorded field is present: no summarised view (FR-50). */
export const CSV_COLUMNS = [
  'id',
  'started_at',
  'ended_at',
  'track_id',
  'isrc',
  'title',
  'artist_name',
  'artist_id',
  'album_name',
  'release_date',
  'age_years',
  'following',
  'outcome',
  'close_reason',
  'provenance',
  'skip_source',
  'context_type',
  'classifier_version',
  // -- U4, schema v5 ----------------------------------------------------------
  // ⚠️ These two export as the literal token `unknown` when absent, like every other
  // nullable field (BR-6.3) — and here that token is doing real work. A blank cell would be
  // read as "not explicit" and "no album type", which is a fabricated answer about rows that
  // predate migration 005 and about rows whose `GET /tracks/{id}` failed.
  'explicit',
  'album_type',
  'listened_ms',
  'duration_ms',
  'completion_ratio',
  'max_progress_ms',
  'max_observation_gap_ms',
  'observation_count',
  'saw_pause',
  'rewound',
  'ended_with_idle',
  // -- U2 --------------------------------------------------------------------
  // Both levels are exported side by side and never merged (Q12, BR-13.7), so the choice of
  // which one an analysis uses is visible in the data rather than baked in here.
  'label_verdict',
  'label_confidence',
  'label_contested',
  'label_names',
  'label_match_method',
  'label_narrowing_tier',
  'label_unknown_reason',
  'label_resolution_id',
  'label_classifier_version',
  // The artist level exports a pointer and genres, and no verdict. One was exported until
  // 2026-09-06; it was classified over the artist's release browse, which counts releases the
  // artist only features on, so the column carried other artists' record deals (migration 004).
  'artist_resolution_id',
  'liked_at_start',
  'liked_at_end',
  'liked_added_at',
  'liked_transition',
  'artist_genres',
] as const;

/**
 * `pending` is exported as its own token, never as `unknown` (BR-7.7).
 *
 * A lookup that has not happened and a lookup that came back empty are different facts. Counting
 * in-flight rows as absent data would corrupt the very coverage metric R2 is measured with — and
 * a downstream analysis dropping `unknown` rows would drop them for the wrong reason.
 */
export const PENDING_TOKEN = 'pending';

function renderVerdict(value: string | null | undefined): string {
  return value === null || value === undefined ? PENDING_TOKEN : value;
}

/**
 * Genres, joined with their vote counts kept.
 *
 * `alternative rock:11; hard rock:6` rather than a bare name list: the count is the only quality
 * signal MusicBrainz gives, separating a genre eleven people agreed on from one person's opinion.
 * Dropping it in the export would throw away information the database has.
 */
function renderGenres(genres: { name: string; count: number }[] | null | undefined): string {
  if (genres === null || genres === undefined) return UNKNOWN_TOKEN;
  if (genres.length === 0) return 'none';
  return genres.map((genre) => `${genre.name}:${genre.count}`).join('; ');
}

/** Label name lists are joined rather than nested, so a CSV cell stays one value. */
function renderNames(names: string[] | null | undefined): string {
  if (names === null || names === undefined) return UNKNOWN_TOKEN;
  return names.length === 0 ? UNKNOWN_TOKEN : names.join('; ');
}

/**
 * Render a possibly-absent value.
 *
 * `null` and `undefined` become the token. `false` and `0` do **not** — they are values, and
 * conflating them with absence is the specific defect this function exists to prevent.
 */
export function renderMaybe(value: unknown): string {
  if (value === null || value === undefined) return UNKNOWN_TOKEN;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** RFC 4180 quoting: only when needed, doubling embedded quotes. */
export function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsvHeader(): string {
  return CSV_COLUMNS.join(',');
}

/** Field order must match CSV_COLUMNS exactly. */
export function toCsvRow(play: PlayRecord): string {
  const values = [
    play.id,
    play.startedAt,
    play.endedAt,
    play.trackId,
    play.isrc,
    play.title,
    play.artistName,
    play.artistId,
    play.albumName,
    play.releaseDate,
    play.ageYears,
    play.following,
    play.outcome,
    play.closeReason,
    play.provenance,
    play.skipSource,
    play.contextType,
    play.classifierVersion,
    play.explicit,
    play.albumType,
    play.evidence.listenedMs,
    play.evidence.durationMs,
    play.evidence.completionRatio,
    play.evidence.maxProgressMs,
    play.evidence.maxObservationGapMs,
    play.evidence.observationCount,
    play.evidence.sawPause,
    play.evidence.rewound,
    play.evidence.endedWithIdle,
    renderVerdict(play.label?.verdict),
    play.label?.confidence ?? null,
    play.label?.contested ?? null,
    renderNames(play.label?.names),
    play.label?.matchMethod ?? null,
    play.label?.narrowingTier ?? null,
    play.label?.unknownReason ?? null,
    play.label?.resolutionId ?? null,
    play.label?.classifierVersion ?? null,
    play.label?.artistResolutionId ?? null,
    play.label?.likedAtStart ?? null,
    play.label?.likedAtEnd ?? null,
    play.label?.likedAddedAt ?? null,
    play.label?.likedTransition ?? null,
    renderGenres(play.label?.artistGenres),
  ];
  return values.map((value) => csvEscape(renderMaybe(value))).join(',');
}

/**
 * One JSON object per play.
 *
 * Absent values are emitted as the string token rather than JSON `null`, so CSV and JSON exports
 * agree. A tool reading both should not have to special-case which one it got.
 */
export function toJsonObject(play: PlayRecord): Record<string, unknown> {
  return {
    id: play.id,
    started_at: play.startedAt,
    ended_at: play.endedAt,
    track_id: play.trackId,
    isrc: renderMaybe(play.isrc),
    title: play.title,
    artist_name: play.artistName,
    artist_id: renderMaybe(play.artistId),
    album_name: play.albumName,
    release_date: renderMaybe(play.releaseDate),
    age_years: renderMaybe(play.ageYears),
    following: renderMaybe(play.following),
    outcome: play.outcome,
    close_reason: play.closeReason,
    provenance: play.provenance,
    skip_source: renderMaybe(play.skipSource),
    context_type: renderMaybe(play.contextType),
    classifier_version: play.classifierVersion,
    explicit: renderMaybe(play.explicit),
    album_type: renderMaybe(play.albumType),
    evidence: {
      listened_ms: play.evidence.listenedMs,
      duration_ms: play.evidence.durationMs,
      completion_ratio: play.evidence.completionRatio,
      max_progress_ms: play.evidence.maxProgressMs,
      max_observation_gap_ms: play.evidence.maxObservationGapMs,
      observation_count: play.evidence.observationCount,
      saw_pause: play.evidence.sawPause,
      rewound: play.evidence.rewound,
      ended_with_idle: play.evidence.endedWithIdle,
    },
    // The label a track was released under, resolved through its ISRC. There is no second,
    // artist-level verdict beside it any more -- see migration 004.
    label: {
      verdict: renderVerdict(play.label?.verdict),
      confidence: renderMaybe(play.label?.confidence),
      contested: renderMaybe(play.label?.contested),
      names: renderNames(play.label?.names),
      match_method: renderMaybe(play.label?.matchMethod),
      narrowing_tier: renderMaybe(play.label?.narrowingTier),
      unknown_reason: renderMaybe(play.label?.unknownReason),
      resolution_id: renderMaybe(play.label?.resolutionId),
      classifier_version: renderMaybe(play.label?.classifierVersion),
    },
    artist_resolution_id: renderMaybe(play.label?.artistResolutionId),
    liked: {
      at_start: renderMaybe(play.label?.likedAtStart),
      at_end: renderMaybe(play.label?.likedAtEnd),
      added_at: renderMaybe(play.label?.likedAddedAt),
      transition: renderMaybe(play.label?.likedTransition),
    },
    // Structured in JSON rather than flattened, so the vote counts stay machine-readable.
    artist_genres: play.label?.artistGenres ?? UNKNOWN_TOKEN,
  };
}

/**
 * Coverage as CSV comment lines.
 *
 * `#` prefixed so spreadsheet imports can skip them, while the numbers still travel with the
 * data rather than being separately requestable and therefore forgotten.
 */
export function coverageAsCsvComments(coverage: CoverageStats): string {
  return [
    `# total_plays: ${coverage.totalPlays}`,
    `# outcome_completed: ${coverage.byOutcome.completed}`,
    `# outcome_skipped: ${coverage.byOutcome.skipped}`,
    `# outcome_unknown: ${coverage.byOutcome.unknown}`,
    `# provenance_live: ${coverage.byProvenance.live}`,
    `# provenance_backfilled: ${coverage.byProvenance.backfilled}`,
    `# unknown_isrc: ${coverage.unknownIsrc}`,
    `# unknown_following: ${coverage.unknownFollowing}`,
    `# unknown_release_date: ${coverage.unknownReleaseDate}`,
    `# unknown_skip_source: ${coverage.unknownSkipSource}`,
    `# counted_gaps: ${coverage.countedGaps}`,
    `# note: "${UNKNOWN_TOKEN}" means the value was not known, which is not the same as false or zero`,
  ].join('\n');
}
