/**
 * The field catalogue — what a rule may talk about (FR-27, FR-28). ⚙️ PURE
 *
 * ## Why this is a static table and not reflection over `TrackFacts`
 *
 * Reflection would expose every field the interface happens to gain, including ones nobody has
 * decided are meaningful or has measured. It would also have exposed the artist-level label
 * verdict right up until migration 004 deleted it on 2026-09-06 — and then silently stopped.
 *
 * An explicit table means **adding a field is a decision** (BR-16.1). It is the same reasoning
 * that keeps `majorRootList` a written list rather than a heuristic.
 *
 * ## `availability` and `note` answer different questions
 *
 * `availability` is about **presence**: how often does this field carry a value?
 * `note` is about **standing**: what is this field worth, and what is it not?
 *
 * They are never merged (BR-16.3). A field can be always-present and misleading, or often-unknown
 * and completely trustworthy when it is there.
 */

import type { FieldDefinition, FieldType, Operator, TrackFacts } from './types.js';

/**
 * Operators admissible per type.
 *
 * `is-unknown` is valid on **every** type — it asks about presence, not value (BR-15.3).
 *
 * ⚠️ `exists` appears nowhere. See the note on `Operator` in types.ts.
 */
const OPERATORS: Readonly<Record<FieldType, readonly Operator[]>> = Object.freeze({
  string: ['eq', 'neq', 'in', 'contains', 'is-unknown'],
  number: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is-unknown'],
  boolean: ['eq', 'neq', 'is-unknown'],
  date: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'is-unknown'],
  enum: ['eq', 'neq', 'in', 'is-unknown'],
});

/**
 * The note on `label.classification`.
 *
 * The Phase 2 hypothesis gate ran its single confirmatory evaluation on 2026-09-10 and R1 was not
 * supported. Writing "skip major-label releases" remains a perfectly legitimate *preference* — it
 * is the user's taste. What it is no longer is a rule backed by evidence that the field predicts
 * this listener's skips, and a rule author could easily believe otherwise.
 */
const LABEL_CLASSIFICATION_NOTE =
  'Tested 2026-09-10 against this listener’s own skips — no detectable effect ' +
  '(major 9.2%, independent 8.6%, p = 0.888, 95% CI [−7.7%, +8.9%]). ' +
  'Legitimate as a preference; not evidence-backed as a predictor.';

/**
 * The note on the artist-level history counts.
 *
 * The schema stores one artist id per play — `track.artists[0]` — so a featured credit is filed
 * under the lead artist and is absent from the guest's totals. Measured 2026-09-06: Ren appears
 * on 34 plays but owns the primary id on 26, so any per-artist figure is ~24% low for someone who
 * guests often. It reads as a listening pattern rather than as a schema limit.
 */
const PRIMARY_ARTIST_NOTE =
  'Counts the PRIMARY artist only. A featured credit is filed under the lead artist, so this ' +
  'runs ~24% low for an artist who guests often (measured 2026-09-06).';

const FIELDS: readonly FieldDefinition[] = Object.freeze([
  // -- track ----------------------------------------------------------------
  {
    name: 'track.title',
    type: 'string',
    description: 'Track title as Spotify reports it.',
    availability: 'always',
    read: (f: TrackFacts) => f.track.title,
  },
  {
    name: 'track.durationMs',
    type: 'number',
    description: 'Track length in milliseconds.',
    availability: 'always',
    read: (f: TrackFacts) => f.track.durationMs,
  },
  {
    name: 'track.explicit',
    type: 'boolean',
    description: 'Spotify’s explicit-content flag.',
    availability: 'usually',
    read: (f: TrackFacts) => f.track.explicit,
  },
  {
    name: 'track.isrc',
    type: 'string',
    description: 'International Standard Recording Code. The key label resolution turns on.',
    availability: 'usually',
    read: (f: TrackFacts) => f.track.isrc,
  },

  // -- artist ---------------------------------------------------------------
  {
    name: 'artist.name',
    type: 'string',
    description: 'Primary artist name, or the joined credit string when several are credited.',
    availability: 'always',
    read: (f: TrackFacts) => f.artist.name,
  },
  {
    name: 'artist.following',
    type: 'boolean',
    description: 'Whether you follow this artist on Spotify.',
    availability: 'usually',
    read: (f: TrackFacts) => f.artist.following,
  },
  {
    name: 'artist.genres',
    type: 'string',
    multiValued: true,
    description:
      'Genres MusicBrainz lists for the artist. Matching is per genre and on word boundaries, ' +
      'so "rap" matches "pop rap" but not "trap". An artist MusicBrainz lists no genres for is ' +
      'false, not unknown.',
    availability: 'often-unknown',
    read: (f: TrackFacts) => f.artist.genres,
  },

  // -- album ----------------------------------------------------------------
  {
    name: 'album.name',
    type: 'string',
    description: 'Album or single name.',
    availability: 'always',
    read: (f: TrackFacts) => f.album.name,
  },
  {
    name: 'album.releaseDate',
    type: 'date',
    description:
      'Release date. Sometimes year-only, in which case ordering comparisons are unknown — ' +
      'use album.ageYears to compare by age.',
    availability: 'usually',
    read: (f: TrackFacts) => f.album.releaseDate,
  },
  {
    name: 'album.ageYears',
    type: 'number',
    description: 'Years since release. The field to use for ordering by age.',
    availability: 'usually',
    read: (f: TrackFacts) => f.album.ageYears,
  },
  {
    name: 'album.type',
    type: 'string',
    description: 'album, single or compilation.',
    availability: 'usually',
    read: (f: TrackFacts) => f.album.type,
  },

  // -- label ----------------------------------------------------------------
  {
    name: 'label.name',
    type: 'string',
    description: 'Label names MusicBrainz lists for the release this recording came from.',
    availability: 'often-unknown',
    read: (f: TrackFacts) => f.label.name,
  },
  {
    name: 'label.classification',
    type: 'enum',
    enumValues: ['major', 'independent', 'unknown'],
    description:
      'Whether the release-level label resolves to a major or an independent. Unresolved is ' +
      'unknown — MusicBrainz coverage is incomplete, especially on recent releases.',
    availability: 'often-unknown',
    note: LABEL_CLASSIFICATION_NOTE,
    read: (f: TrackFacts) => f.label.classification,
  },
  {
    name: 'label.confidence',
    type: 'string',
    description: 'Ordinal confidence in the label verdict.',
    availability: 'often-unknown',
    read: (f: TrackFacts) => f.label.confidence,
  },

  // -- liked ----------------------------------------------------------------
  {
    name: 'liked.atStart',
    type: 'boolean',
    description: 'Whether the track was in your saved tracks when it started playing.',
    availability: 'usually',
    read: (f: TrackFacts) => f.liked.atStart,
  },
  {
    name: 'liked.transition',
    type: 'enum',
    enumValues: ['kept-liked', 'kept-unliked', 'liked-during', 'unliked-during', 'unknown'],
    description: 'How your saved-track status for this track changed across the play.',
    availability: 'often-unknown',
    read: (f: TrackFacts) => f.liked.transition,
  },

  // -- history --------------------------------------------------------------
  {
    name: 'history.playsOfTrack',
    type: 'number',
    description:
      'Times this track has been played before now. Unknown, never zero, when there is no ' +
      'history to count.',
    availability: 'usually',
    read: (f: TrackFacts) => f.history.playsOfTrack,
  },
  {
    name: 'history.skipsOfTrack',
    type: 'number',
    description: 'Times this track has been skipped before now.',
    availability: 'usually',
    read: (f: TrackFacts) => f.history.skipsOfTrack,
  },
  {
    name: 'history.playsOfArtist',
    type: 'number',
    description: 'Times this artist has been played before now (as primary artist).',
    availability: 'usually',
    note: PRIMARY_ARTIST_NOTE,
    read: (f: TrackFacts) => f.history.playsOfArtist,
  },
  {
    name: 'history.skipsOfArtist',
    type: 'number',
    description: 'Times this artist has been skipped before now (as primary artist).',
    availability: 'usually',
    note: PRIMARY_ARTIST_NOTE,
    read: (f: TrackFacts) => f.history.skipsOfArtist,
  },

  // ⚠️ NO context.* FIELDS. See BR-16.6/16.7 and the TrackFacts header: context_type is NULL on
  // every live play and present on every backfilled one, so a rule over it would back-test as
  // populated while being unknown 100% of the time in production. `context.deviceName` is absent
  // because its live availability has never been probed.
]);

const BY_NAME: ReadonlyMap<string, FieldDefinition> = new Map(FIELDS.map((f) => [f.name, f]));

export function allFields(): readonly FieldDefinition[] {
  return FIELDS;
}

export function findField(name: string): FieldDefinition | undefined {
  return BY_NAME.get(name);
}

export function operatorsFor(type: FieldType): readonly Operator[] {
  return OPERATORS[type];
}

/** Whether `op` may be used against a field of `type`. Total: unknown types yield false. */
export function operatorAllowed(type: FieldType, op: Operator): boolean {
  return (OPERATORS[type] ?? []).includes(op);
}
