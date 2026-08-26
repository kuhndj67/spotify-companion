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
  /** Furthest point reached. Evidence only — the classifier does not read it. */
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
}

/** A single listening event, as persisted. */
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
  /** ISO 8601 UTC. */
  startedAt: string;
  endedAt: string;
  outcome: PlayOutcome;
  closeReason: CloseReason;
  evidence: OutcomeEvidence;
  provenance: Provenance;
  skipSource: SkipSource | null;
  contextType: string | null;
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
