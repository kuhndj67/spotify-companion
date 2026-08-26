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

  close(): void;
}
