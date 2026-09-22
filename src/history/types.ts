/**
 * Listening history domain types (U1).
 *
 * One convention runs through all of these and matters more than it looks: **`null` means
 * "unknown", and it is never interchangeable with `false`, `0`, or an empty string.**
 *
 * The functional design expressed this as a `Maybe<T>` wrapper. This implementation uses
 * `T | null` instead — the same semantics, matching the existing `Enrichment` shape and the
 * nullable columns in the schema, without wrapping every field in an object. The one thing the
 * wrapper added, a per-field reason, is only useful for a handful of fields, and `Enrichment`
 * already carries a `warnings` array for that purpose.
 *
 * The rule is enforced where it actually matters: the export serialisers must render null as an
 * explicit `unknown` token (BR-6.3). Missing data here is correlated with the variable being
 * measured (R2), so an unknown that exports as a blank cell hides a bias rather than showing it.
 */

/**
 * Three values, exhaustively. `abandoned` was retired in U1 Functional Design (Q7): anything
 * that is not a clean completion or a clean below-threshold track change is `unknown`.
 */
export type PlayOutcome = 'completed' | 'skipped' | 'unknown';

/** How the record came to exist. Backfilled rows have no observation trail. */
export type Provenance = 'live' | 'backfilled';

/**
 * Who ended the track. `rule` is unreachable until U5 exists, but the column is populated with
 * `user` from the very first play — see US-13's split across U1 and U5. If it arrived only with
 * U5, every play recorded before then would be permanently unattributed, and a later migration
 * would have to *assume* they were user skips rather than having recorded it.
 */
export type SkipSource = 'user' | 'rule';

/*
 * ⚰️ `ATTRIBUTION_VERSION` was removed 2026-09-22 with the rest of `skip_attribution`. Classifier
 * v2 answers "was this a rejection?" in the outcome itself, so there is no second rule left to
 * version. `classifierVersion` is the one that matters now. See `skipAttribution.ts`.
 */

/** Why a play stopped. Feeds classification; also kept as evidence for diagnostics. */
export type CloseReason =
  | 'track-change'
  | 'pause-idle'
  | 'playback-stopped'
  | 'app-shutdown';

/** One poll sample. Immutable: observations are facts, and nothing may rewrite them. */
export interface Observation {
  /** Wall clock of the poll. */
  atMs: number;
  trackId: string;
  progressMs: number;
  /**
   * Track length as reported *at this sample*. Stored per observation rather than per play
   * because Spotify has been seen to report it inconsistently mid-play; keeping it per sample
   * makes that visible instead of silently overwriting it.
   */
  durationMs: number;
  /** False while paused — this is what distinguishes a pause from a stall. */
  isPlaying: boolean;
}

/**
 * The derived summary a verdict rests on. Recomputable from the trail (FR-20); stored so that
 * reading a verdict does not require re-deriving it.
 */
export interface OutcomeEvidence {
  /**
   * Total time spent listening — the sum of forward progress, seeded with the first sample's
   * position. Re-hearing a passage adds to it again, which is why no rewind rule is needed.
   */
  listenedMs: number;
  durationMs: number;
  /**
   * `listenedMs / durationMs` — the decision variable.
   *
   * **May exceed 1.0, and must never be clamped.** A ratio of 2.4 means the track was heard
   * nearly two and a half times. Clamping looks like defensive hygiene and would silently
   * destroy the repeat-listen signal.
   */
  completionRatio: number;
  /**
   * Furthest point reached.
   *
   * ⚠️ **The classifier reads this as of v2.** It used to be evidence only. `durationMs -
   * maxProgressMs` is the *unobserved tail* — how much of the track was still to run when the
   * API stopped reporting it — and that is the axis the transition-overlap effect lives on.
   *
   * Position, not listened time: a rewind inflates `listenedMs` without moving the tail, and the
   * question here is "where had the track got to", not "how much was heard".
   */
  maxProgressMs: number;
  /** Largest gap between samples: the staleness bound on everything above. */
  maxObservationGapMs: number;
  observationCount: number;
  sawPause: boolean;
  /** A backward jump occurred. Evidence only — deliberately does *not* affect classification. */
  rewound: boolean;
  endedWithIdle: boolean;
}

/** Parameters of classification. Passed in, never read from config — see outcomeClassifier. */
export interface ClassifierTolerances {
  /** Ratio at or above which a play counts as completed. 0.90 (U1 FD Q5). */
  completionThreshold: number;
  /**
   * Slack for progress jitter. Spotify occasionally reports progress slightly lower between
   * polls; without tolerance that would read as a rewind. Also bounds the forward-step cap.
   */
  jitterToleranceMs: number;
  /**
   * Largest *unobserved tail* (`durationMs - maxProgressMs`) that still counts as a completion
   * when a play closes on `track-change`. 55 000 ms — see `outcomeClassifier` for the derivation.
   *
   * ⚠️ **In milliseconds, not a ratio, and that is the whole point.** The effect removes a roughly
   * constant number of seconds; a ratio divides by duration, so a proportional threshold over a
   * constant-time effect misfiles short tracks. Measured 2026-09-22: `ratio < 0.75` whenever
   * `duration < 4 x tail`, so at a 41 s tail every track under 164 s read as a user skip — and the
   * corpus's 10th-percentile duration is 146 s.
   */
  maxUnobservedTailMs: number;
  /**
   * Sanity rail on the rule above: `maxProgressMs / durationMs` must be at least this.
   *
   * 0.75. It refuses a genuine short-track skip that the tail rule alone would accept — a 60 s
   * track abandoned at 40 s has a 20 s tail, inside the overlap range, but only 0.67 of position.
   * It costs one known-ambiguous row (`Mascara`); see `outcomeClassifier`.
   */
  minObservedPositionRatio: number;
}

/** A single listening event, as persisted. */
/**
 * The as-of-play label snapshot, as read back for export and display.
 *
 * Two levels, side by side and **never merged** (Q12): a release's label is a fact about a past
 * pressing, an artist's is a fact about now. Token — *Full Bag* is `Never Too Different`
 * (independent) at release level and `Atlantic` at artist level, and both are true.
 */
export interface LabelFields {
  verdict: string | null;
  confidence: string | null;
  contested: boolean | null;
  /** Distinct label names that voted. */
  names: string[] | null;
  matchMethod: string | null;
  narrowingTier: string | null;
  unknownReason: string | null;
  /** The exact resolution version this verdict came from (BR-13.4). */
  resolutionId: number | null;
  classifierVersion: number | null;
  /**
   * The artist-level resolution version this play's genres came from (BR-13.4).
   *
   * There is no artist-level *verdict* beside it. One was classified over the artist's release
   * browse until 2026-09-06, and that browse counts features as the artist's own — see
   * migration 004. The label a track was released under is the release-level fields above.
   */
  artistResolutionId: number | null;
  likedAtStart: boolean | null;
  likedAtEnd: boolean | null;
  likedAddedAt: string | null;
  likedTransition: string | null;
  /**
   * Artist genres from MusicBrainz, with vote counts. Spotify stopped returning genres entirely,
   * so this is the only source. `null` = unknown, `[]` = asked and there are none.
   */
  artistGenres: { name: string; count: number }[] | null;
}

export interface PlayRecord {
  id: number;
  trackId: string;
  /**
   * The join key to MusicBrainz (U2). Recorded from the first play so labels can be backfilled
   * retrospectively — which is what makes shipping U1 before U2 a reversible decision.
   */
  isrc: string | null;
  title: string;
  artistName: string;
  artistId: string | null;
  albumName: string;
  releaseDate: string | null;
  ageYears: number | null;
  following: boolean | null;
  /**
   * U4, schema v5. Both come back from the `GET /tracks/{id}` call already made for every
   * enriched track and from `recently-played`, so persisting them costs **zero** extra requests
   * (BR-31.4).
   *
   * ⚠️ **`null` is unknown and never `false`.** Three distinct causes reach this column as null
   * and they are not the same fact:
   *   - the row predates migration 005 → **unanswerable** (BR-31.3, BR-27.5a)
   *   - `GET /tracks/{id}` failed → **unknown** (BR-31.3b — `error` is not `unknown`)
   *   - enrichment has not landed yet → **unknown**
   * Only the first is decided by the schema-era watermark; the others are ordinary unknowns.
   * Writing `false` for any of them would assert a fact about the variable under study.
   */
  explicit: boolean | null;
  /** `album` | `single` | `compilation`, as Spotify reports it. Null per the note on `explicit`. */
  albumType: string | null;
  /** ISO 8601 UTC. */
  startedAt: string;
  endedAt: string;
  outcome: PlayOutcome;
  closeReason: CloseReason;
  evidence: OutcomeEvidence;
  provenance: Provenance;
  /**
   * ⚠️ **HISTORICALLY AN ASSERTION, AND IT WAS WRONG.** Before 2026-09-21 this was written
   * `user` for every live skip on the assumption that every early track change was the
   * listener's. It is kept as-is on historical rows because rewriting it would erase the
   * evidence that the claim was ever made.
   *
   * It is still the right column for U5: `user` vs `rule` is a question only U5 can answer, and
   * recording rule-initiated skips distinctly is a Phase 4 exit criterion. What made the old
   * values unreliable — transitions being counted as rejections — is now handled in the
   * **outcome** by classifier v2, so a v2 `skipped` row is a rejection by construction.
   */
  skipSource: SkipSource | null;
  /**
   * How far into the **next** track the app was when it first saw it, in ms. Corroborating
   * evidence for a late-learned transition. `null` means not measured — never zero.
   */
  successorLagMs: number | null;
  contextType: string | null;
  /**
   * U2 label enrichment. Every field is `null` until resolved, and **`null` here means one of
   * two different things**, which is why `labelUnknownReason` exists alongside `labelVerdict`:
   * `null` verdict = pending (never looked up), `unknown` verdict = looked up and not known
   * (BR-7.7). Collapsing them would corrupt the coverage metric R2 is measured with.
   */
  label?: LabelFields;
  /**
   * Which classifier produced `outcome`. Without it, a partially reclassified database is
   * indistinguishable from a consistent one — you could not tell which rows had been revisited.
   * It is what makes FR-20's "recompute the outcomes" a safe operation rather than a destructive
   * one.
   */
  classifierVersion: number;
}

/** A play before it has an id — what the observer hands the repository. */
export type NewPlayRecord = Omit<PlayRecord, 'id'>;

/**
 * The four `history.*` aggregates a rule can read, counted over plays **strictly before** an
 * instant (BR-27.2/27.3).
 *
 * ⚠️ **`null` means "no history to count", never `0`.** Substituting zero would make
 * *"never skipped this track"* silently true for a track never heard — US-16's stated failure
 * mode, and the same error as writing `completed` onto a backfilled play.
 *
 * ⚠️ **The artist counts are keyed on the PRIMARY artist** and are low for a frequent guest.
 * `artist_id` stores `track.artists[0]`, so a feature credit files under the lead: measured
 * 2026-09-06, Ren appears on 34 plays and owns the primary id on 26 — about 24% low. A schema
 * limit, not a listening pattern. `historyRepository.test.ts` pins it.
 */
export interface HistoryCounts {
  playsOfTrack: number | null;
  skipsOfTrack: number | null;
  playsOfArtist: number | null;
  skipsOfArtist: number | null;
}

/** Query filter. Domain types only: no SQL fragments, or the NFR-10 interface is decorative. */
export interface HistoryFilter {
  /** ISO 8601. Inclusive lower bound on `startedAt` — supports incremental export (FR-52). */
  since?: string;
  until?: string;
  outcome?: PlayOutcome;
  limit?: number;
}

/**
 * Coverage counts shipped alongside every export (FR-51, BR-6.4).
 *
 * These exist so "how much is missing?" is a number the analyst can see rather than an
 * assumption they have to make. R2's missing-data bias is correlated with the variable being
 * measured, so its size has to be visible.
 */
export interface CoverageStats {
  totalPlays: number;
  byOutcome: Record<PlayOutcome, number>;
  byProvenance: Record<Provenance, number>;
  unknownIsrc: number;
  unknownFollowing: number;
  unknownReleaseDate: number;
  unknownSkipSource: number;
  /** Plays not written because persistence was failing (BR-3.9). */
  countedGaps: number;
}

/**
 * Per-track counts for the now-playing statistics panel.
 *
 * ⚠️ **`totalPlays` counts times the track came up, not times it was heard.** A track replayed
 * twice inside one uninterrupted play is one row here; the repeat shows up in
 * `evidence.completionRatio` exceeding 1.0, which is exactly why that value is never clamped.
 * Reading this number as "times listened" would undercount the repeat-listen signal.
 *
 * Counts are split into display buckets, never summed into a single "interest" figure — and
 * `not-observed` is kept apart from `inconclusive`, because "the app was off" and "the app could
 * not tell" are different facts. See `PlayBucket`.
 */
export interface TrackPlayStats {
  trackId: string;
  totalPlays: number;
  /** Keyed by `PlayBucket`. Declared structurally to keep this module free of imports. */
  byBucket: {
    completed: number;
    skipped: number;
    inconclusive: number;
    'not-observed': number;
  };
  /** ISO 8601, or null when the track has never been recorded. */
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
}

/**
 * One play reduced to what a trend needs.
 *
 * Deliberately not a `PlayRecord`: the trend reads a few hundred rows on every track change, and
 * hydrating the full record — evidence, label snapshot, genres — to count two columns would make
 * a display feature the most expensive query in the app.
 */
export interface PlayTimePoint {
  startedAt: string;
  outcome: PlayOutcome;
  /**
   * Required, not optional. A backfilled play is `unknown` because the app was not watching, and
   * a live play is `unknown` because it watched and could not tell — the chart must never merge
   * those, so it cannot be given the outcome without the provenance.
   */
  provenance: Provenance;
}
