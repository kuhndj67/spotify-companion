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
  HistoryCounts,
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

  /**
   * Deduplication for backfill (BR-5.4): has this track already been recorded ending here?
   *
   * ⚠️ **Keyed on the END of the play, and that is the whole point.** `recently-played` gives one
   * timestamp per item, `played_at`, and it is the moment the track **finished** — measured
   * against 41 plays this app had itself observed start and end, it matched the end with a median
   * error of 3.0 s. Matching it against a stored *start* compares two instants a whole track
   * apart, so every already-recorded play looked new and was inserted again. The end timestamp is
   * the one value Spotify reports exactly; dedup uses it rather than one derived from it.
   */
  hasPlayNearEnd(trackId: string, endedAt: string, toleranceMs: number): boolean;


  /**
   * The four `history.*` aggregates a rule can read, counted over plays **strictly before**
   * `beforeIso` (BR-27.2/27.3, LC-22).
   *
   * ## ⚠️ One method, two callers, and that is the requirement
   *
   * The live coordinator calls it with `before = now`; the back-test calls it with
   * `before = row.startedAt`. The design originally gave the back-test a SQL window function
   * and the live path nothing at all — two implementations of *"plays of this artist before
   * this instant"* that would agree on every fixture and diverge only on the corpus. That is
   * the WebSocket `403` shape, where the admission rule was re-implemented rather than reused,
   * the copies diverged, and **all 411 tests passed** while every handshake failed.
   *
   * ## ⚠️ Strictly before, never inclusive
   *
   * A window that includes the current row makes every play count itself, so
   * `history.playsOfTrack >= 1` is true for **every row in existence** — a rule that looks like
   * it is working and is matching nothing but its own arithmetic (BR-27.3).
   *
   * ## ⚠️ Point-in-time, not as-of-now
   *
   * US-24 requires two back-tests of the same rule over the same history to be identical. Under
   * as-of-now counts they are identical only within a day, because the corpus grows underneath a
   * range that has not changed. **Fixture history does not grow, so no unit test would catch
   * it**; it would surface months later as unexplained drift. PBT-22 and PBT-22a exist for this.
   *
   * ## ⚠️ `artist_id` is the PRIMARY artist, so the artist counts run low
   *
   * The schema stores `track.artists[0]`, so a feature credit files under the lead and is absent
   * from the guest's totals. Measured 2026-09-06: Ren appears on 34 plays and owns the primary
   * id on 26 — about 24% low for someone who guests often. It reads as a listening pattern and
   * is a schema limit. Live evaluation and back-test inherit it **equally**, which is what keeps
   * NFR-26's replay honest; `historyRepository.test.ts` pins the limitation.
   *
   * Returns `null` for a count with no history to count, **never `0`** — substituting zero makes
   * *"never skipped this track"* silently true for a track never heard (US-16's failure mode).
   */
  historyCountsBefore(
    trackId: string,
    artistId: string | null,
    beforeIso: string,
  ): HistoryCounts;

  /**
   * The highest `play.id` that existed when migration 005 ran, or `null` on a database that
   * never had one.
   *
   * ⚠️ **A row id, not a date** (BR-27.5c). The 6-hourly backfill inserts rows dated in the
   * past, so a row written *after* v5 for a play that happened *before* it genuinely carries
   * `explicit` and `album_type`. Judging era by `started_at` would mark that real data
   * unanswerable; judging by id answers correctly.
   */
  v5Watermark(): number | null;

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

  /**
   * The most recent `limit` plays, oldest-first, reduced to *was this skipped by a rule*.
   *
   * ⚠️ **U5, for BR-35.1's consecutive-skip halt. It lives HERE and not on the skip-attempt store**,
   * because the counter resets on any play **not** skipped by a rule (BR-35.9) — and `skip_attempt`
   * has no row for such a play, so a query over that table alone counts "three rule skips ever"
   * rather than "three in a row". LC-24 listed a `recentForConsecutive` method on the wrong
   * repository; corrected 2026-10-02.
   *
   * ⚠️ **`play.skip_source` is the authoritative source**, and it exists for precisely this: US-13 was
   * deliberately split across U1 and U5 so every play recorded before automation existed already
   * carries the fact. An attempt is not a skip — a `refused` or `cancelled` attempt never touched the
   * player — so the halt must count what the *play* records, not what was tried.
   *
   * ⚠️ **Oldest-first**, because `consecutiveRuleSkips` counts the trailing run and a reversed array
   * silently returns a different number.
   */
  /**
   * Mark a play as skipped BY A RULE, once the attempt has been linked to it (BR-35.3).
   *
   * ⚠️ A correction, not the first write: see the implementation for why the answer is not available
   * when the row is inserted.
   */
  markSkippedByRule(playId: number): void;

  recentPlaysForCounting(limit: number): { readonly playId: number; readonly skippedByRule: boolean }[];

  close(): void;
}
