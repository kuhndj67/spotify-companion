/**
 * Persistence boundary for listening history (NFR-10).
 *
 * Every consumer — U2's label backfill, U4's back-testing, U5's skip attribution — reaches
 * storage through this interface. That is what makes `node:sqlite` being experimental (R10) a
 * contained risk rather than a bet: replacing the engine changes one implementation file and no
 * call sites.
 *
 * **The interface must not leak SQL semantics.** Filters are domain types (`HistoryFilter`),
 * never fragments of SQL, or the abstraction is decorative and the swap it promises is fictional.
 */

import type {
  CoverageStats,
  HistoryFilter,
  NewPlayRecord,
  Observation,
  OutcomeEvidence,
  PlayOutcome,
  PlayRecord,
  PlayTimePoint,
  TrackPlayStats,
} from './types.js';

export interface HistoryRepository {
  /**
   * Persist a finished play together with its entire observation trail, atomically.
   *
   * One transaction per play (NFR Design P-2): a partial play is never visible, and ~200
   * transactions a day keeps `node:sqlite`'s synchronous API off the critical path.
   */
  recordPlay(play: NewPlayRecord, trail: readonly Observation[]): number;

  getPlay(id: number): PlayRecord | null;

  /**
   * Streamed rather than returned as an array — export must not buffer a year of history
   * (~73k rows) into memory, because doing so would stall the event loop and with it the
   * now-playing display.
   */
  listPlays(filter?: HistoryFilter): IterableIterator<PlayRecord>;

  /** The retained trail for a play. Empty for backfilled rows, which never had one. */
  getTrail(playId: number): Observation[];

  /**
   * Update a verdict after reclassification (FR-20).
   *
   * Observations are never touched — they are facts, and only the derived judgement is
   * provisional.
   */
  updateOutcome(
    playId: number,
    outcome: PlayOutcome,
    evidence: OutcomeEvidence,
    classifierVersion: number,
  ): void;

  /** Deduplication for backfill (BR-5.4): was this track already recorded at about this time? */
  hasPlayNear(trackId: string, startedAt: string, toleranceMs: number): boolean;

  /** Coverage counts for export (FR-51) and diagnostics. */
  coverage(): CoverageStats;

  /** Plays lost to a persistence failure (BR-3.9) — counted, never silently dropped. */
  recordGap(): void;

  /**
   * How often a track has come up, split by outcome. Backs the now-playing statistics panel.
   *
   * Returns a zeroed record rather than null for a track with no history: "played nought times"
   * is the correct answer for a track being heard for the first time, and it is a different
   * statement from "history is unavailable", which is the caller's 503.
   */
  trackPlayStats(trackId: string): TrackPlayStats;

  /**
   * Play times for one artist since a moment, for the weekly trend.
   *
   * ⚠️ **Matches on the PRIMARY artist only** — `artistId` is `track.artists[0]`, the single id
   * this schema stores. A feature credit is therefore attributed to the lead artist and is absent
   * from the guest's trend. Measured on the corpus: Ren appears on 34 plays but owns the primary
   * id on 26 of them, so the number is ~24% low for a heavily-featuring artist. The panel says
   * "primary artist" for exactly this reason; fixing it properly needs every artist id recorded
   * per play, which is a schema change and is not retroactive.
   */
  listPlayTimesForArtist(artistId: string, sinceIso: string): PlayTimePoint[];

  /**
   * The oldest `startedAt` in the corpus, or null when empty.
   *
   * Anchors the trend's x-axis for *every* artist, so two artists' charts can be compared. See
   * `trendWindow` — anchoring per artist would rescale the axis between tracks.
   */
  firstPlayStartedAt(): string | null;

  close(): void;
}
