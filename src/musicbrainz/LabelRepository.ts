/**
 * Persistence boundary for label enrichment (U2).
 *
 * A separate interface from `HistoryRepository` rather than an extension of it, for two reasons:
 * U2 owns these entities and their types, so the dependency points the right way; and the U1
 * interface stays the small, readable thing it was. `SqliteHistoryRepository` implements both, so
 * consumers still get one object and one connection.
 *
 * **The interface must not leak SQL semantics** — same rule as U1. Callers never see
 * `resolved_at DESC LIMIT 1`; they ask for the current resolution and get one.
 *
 * ---
 *
 * ## Everything here is append-only (BR-13.1)
 *
 * There is no `updateLabelResolution`. Re-resolving inserts a **new version**, because two
 * different things are both called "the data changed":
 *
 * - **our knowledge changed** — a volunteer catalogued a release we could not see. The old
 *   verdict was *wrong*; prefer the new one.
 * - **the world changed** — the artist signed to a major. The old verdict was *right for its
 *   time*; keep it.
 *
 * MusicBrainz cannot tell you which occurred, so both readings are kept and the choice is made
 * per level at analysis time: **latest** for release-level (a fact about a past pressing, so newer
 * is better measurement), **as-of-play** for artist-level (a fact about now, so the covariate is
 * "signed *when this played*") — BR-13.6, BR-11.1a.
 */

import type {
  ArtistGenre,
  ArtistResolution,
  Confidence,
  LabelCandidate,
  LabelResolution,
  LabelVerdict,
  MatchMethod,
  NarrowingTier,
  ResolutionStatus,
  SignalVote,
  UnknownReason,
} from './types.js';

/** A resolution about to be written. No `id` — the store assigns the version identity. */
export interface NewLabelResolution {
  isrc: string;
  recordingMbid: string | null;
  matchMethod: MatchMethod;
  narrowingTier: NarrowingTier;
  releaseCount: number;
  resolvedAt: string;
  status: ResolutionStatus;
  candidates: LabelCandidate[];
  votes: SignalVote[];
}

/**
 * Genres only. There is no artist-level label verdict — see {@link ArtistResolution} for why the
 * release browse it was classified from had to go.
 */
export interface NewArtistResolution {
  spotifyArtistId: string;
  artistMbid: string | null;
  resolvedAt: string;
  status: ResolutionStatus;
  /** `null` = never asked or the lookup failed; `[]` = asked, MusicBrainz has none. */
  genres: ArtistGenre[] | null;
}

/**
 * The as-of-play snapshot written onto a play row.
 *
 * Written **once** and never revised (BR-8.4a). A later resolution appends a version; it does not
 * rewrite history. `labelResolutionId` records which version this verdict came from, which is what
 * lets the trace reconstruct the derivation from the candidates that version actually held.
 */
export interface LabelSnapshot {
  verdict: LabelVerdict;
  confidence: Confidence;
  contested: boolean;
  labelNames: string[];
  matchMethod: MatchMethod;
  narrowingTier: NarrowingTier;
  unknownReason: UnknownReason | null;
  resolutionId: number | null;
  classifierVersion: number;
}

/**
 * The artist-level as-of-play snapshot: the genres, and a pointer to the version they came from.
 *
 * `resolutionId` is also the **work-set terminator**. It used to be `artist_label_verdict IS NULL`
 * that said "this play still needs the artist level", which only worked because a not-found artist
 * was written down as verdict `unknown`. With no verdict left to write, the pointer is what stops
 * an artist MusicBrainz has never heard of from being looked up on every single sweep.
 */
export interface ArtistSnapshot {
  resolutionId: number | null;
  genres: ArtistGenre[] | null;
}

/**
 * Liked evidence. Booleans are `boolean | null` and **`null` is not `false`** (BR-9.5): the
 * saved-track set can be unavailable, and a fabricated `false` would read as an observed choice
 * and cannot be recovered later.
 */
export interface LikedEvidence {
  likedAtStart: boolean | null;
  likedAtEnd: boolean | null;
  /** Exact `added_at` from Spotify, which is what makes grace-window attribution provable. */
  likedAddedAt: string | null;
}

/**
 * The as-of-play pointers stored on a play row.
 *
 * These are what let the trace reconstruct a derivation from the candidates the traced version
 * **actually held** (BR-13.4), rather than from whatever the current ones happen to be.
 */
export interface PlayLabelPointers {
  labelResolutionId: number | null;
  artistResolutionId: number | null;
  labelClassifierVersion: number | null;
  labelUnknownReason: UnknownReason | null;
}

/** One play awaiting label work. */
export interface PlayNeedingLabels {
  playId: number;
  trackId: string;
  isrc: string | null;
  artistId: string | null;
  albumName: string;
  releaseDate: string | null;
}

/** A key whose newest resolution has aged past its TTL and should be re-resolved. */
export interface StaleResolution {
  key: string;
  status: ResolutionStatus;
  resolvedAt: string;
}

/**
 * Coverage, the instrument R2 is measured with.
 *
 * `asOf` is **required, not decorative**: under BR-13 the same query run twice can legitimately
 * differ, because a previously-`unknown` ISRC may have resolved in between. A coverage figure
 * without a timestamp is not interpretable.
 */
export interface LabelCoverage {
  asOf: string;
  total: number;
  resolved: number;
  /** Queued or in flight — **never counted as `unknown`** (BR-7.7). */
  pending: number;
  byVerdict: Record<LabelVerdict, number>;
  unknownByReason: Record<UnknownReason, number>;
  /**
   * The breakdown that keeps R2 visible. Measured: pre-2022 resolved 5/5, 2022-onward 6/14.
   * A single aggregate would hide that the misses concentrate on recent independent releases —
   * exactly the population the hypothesis is about.
   */
  byReleaseYear: { year: string; total: number; resolved: number }[];
}

export interface LabelRepository {
  /** Append a release-level resolution version. Returns the new version's id. */
  insertLabelResolution(resolution: NewLabelResolution): number;

  /** The exact versions a play's verdict came from, for the trace (BR-13.4). */
  getPlayLabelPointers(playId: number): PlayLabelPointers;

  /** The newest version for an ISRC (BR-13.3), or `null` if never resolved. */
  getCurrentLabelResolution(isrc: string): LabelResolution | null;

  /** A specific version, by id — what the trace uses so it explains what actually ran. */
  getLabelResolutionById(id: number): LabelResolution | null;

  insertArtistResolution(resolution: NewArtistResolution): number;
  getCurrentArtistResolution(spotifyArtistId: string): ArtistResolution | null;

  /**
   * Write the as-of-play snapshot.
   *
   * **Refuses to overwrite** an existing verdict (BR-8.4a) and reports whether it wrote. Backfill
   * relies on this: a re-run must fill gaps without revising what was believed at the time.
   */
  applyLabelSnapshot(playId: number, snapshot: LabelSnapshot): boolean;

  applyArtistSnapshot(playId: number, snapshot: ArtistSnapshot): boolean;

  /** Amend liked evidence once, after the grace window (BR-9.2). */
  updateLikedEvidence(playId: number, evidence: LikedEvidence): void;

  /**
   * Plays with an ISRC and no label snapshot — the backfill work set.
   *
   * The database *is* the queue of record (P-5): the in-memory queue is a fast path, and a restart
   * loses nothing because this query re-derives what remains to be done.
   */
  listPlaysNeedingLabels(limit: number): PlayNeedingLabels[];

  /** Plays whose ISRC is missing but whose `track_id` can recover it (BR-8.1). */
  listPlaysNeedingIsrc(limit: number): PlayNeedingLabels[];

  /**
   * Keys whose newest resolution has aged past its TTL.
   *
   * `now` is passed in rather than read, so a TTL test does not depend on the wall clock.
   */
  listStaleLabelResolutions(
    now: string,
    unknownTtlDays: number,
    resolvedTtlDays: number,
    limit: number,
  ): StaleResolution[];

  /**
   * Artist ids whose newest resolution predates genre collection.
   *
   * Genres arrived in migration 003, after artists had already been resolved. Those resolutions
   * are `resolved` and therefore fresh for the full 90-day TTL, so without this they would carry
   * no genres for a quarter. Re-resolving **appends a version** (BR-13.1) rather than editing the
   * old one — the chain then records that the genres were learned on a later date, which is true.
   */
  listArtistsNeedingGenres(limit: number): string[];

  /**
   * Copy genres onto plays that have none, from the newest resolution for their artist.
   *
   * ⚠️ **This is not a BR-8.4a violation, and the distinction matters.** That rule protects the
   * *verdict* — a judgement that must reflect what was believed at the time. Genres are
   * descriptive metadata about the artist, not a judgement about this play, and the column is
   * only ever filled when it is `NULL`. No verdict is touched.
   */
  fillMissingArtistGenres(limit: number): number;

  labelCoverage(now: string): LabelCoverage;
}
