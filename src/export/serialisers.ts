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
  'listened_ms',
  'duration_ms',
  'completion_ratio',
  'max_progress_ms',
  'max_observation_gap_ms',
  'observation_count',
  'saw_pause',
  'rewound',
  'ended_with_idle',
] as const;

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
    play.evidence.listenedMs,
    play.evidence.durationMs,
    play.evidence.completionRatio,
    play.evidence.maxProgressMs,
    play.evidence.maxObservationGapMs,
    play.evidence.observationCount,
    play.evidence.sawPause,
    play.evidence.rewound,
    play.evidence.endedWithIdle,
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
