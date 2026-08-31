/**
 * SQLite implementation of {@link HistoryRepository}.
 *
 * **This is the only file in the project that knows what SQLite is.** That containment is the
 * point of NFR-10's interface: `node:sqlite` is experimental in Node 22 (R10), and if its API
 * moves, this file changes and nothing else does.
 *
 * Configuration choices worth stating:
 *
 *  - **WAL journaling** so an external tool — a SQLite browser, a notebook — can read the file
 *    while the app writes. That is the practical shape of the download-only integration decision
 *    (§3.5): the user's own tools reach the data without the app opening a network path.
 *  - **`busy_timeout`** so brief contention waits rather than erroring. A reader holding the file
 *    for a moment should not cost a play record.
 *  - **Foreign keys on**, so `ON DELETE CASCADE` actually cascades when W-2's eventual trail
 *    pruning arrives. SQLite defaults this off, which is a well-known trap.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HistoryRepository } from './HistoryRepository.js';
import { migrate, type MigrationReport } from './migrations.js';
import type {
  ArtistLabelSnapshot,
  LabelCoverage,
  LabelRepository,
  LabelSnapshot,
  LikedEvidence,
  NewArtistLabelResolution,
  NewLabelResolution,
  PlayNeedingLabels,
  StaleResolution,
} from '../musicbrainz/LabelRepository.js';
import type {
  ArtistLabelResolution,
  LabelCandidate,
  LabelResolution,
  LabelVerdict,
  SignalVote,
  UnknownReason,
} from '../musicbrainz/types.js';
import type {
  CoverageStats,
  CloseReason,
  HistoryFilter,
  NewPlayRecord,
  Observation,
  OutcomeEvidence,
  PlayOutcome,
  PlayRecord,
  Provenance,
  SkipSource,
} from './types.js';

interface PlayRow {
  id: number;
  track_id: string;
  isrc: string | null;
  title: string;
  artist_name: string;
  artist_id: string | null;
  album_name: string;
  release_date: string | null;
  age_years: number | null;
  following: number | null;
  started_at: string;
  ended_at: string;
  outcome: string;
  close_reason: string;
  provenance: string;
  skip_source: string | null;
  context_type: string | null;
  classifier_version: number;
  ev_listened_ms: number;
  ev_duration_ms: number;
  ev_completion_ratio: number;
  ev_max_progress_ms: number;
  ev_max_gap_ms: number;
  ev_observation_count: number;
  ev_saw_pause: number;
  ev_rewound: number;
  ev_ended_with_idle: number;
}

/** SQLite has no boolean type. null must survive the round trip as null, never as 0. */
function toDbBool(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function fromDbBool(value: number | null): boolean | null {
  return value === null ? null : value !== 0;
}

function rowToRecord(row: PlayRow): PlayRecord {
  return {
    id: row.id,
    trackId: row.track_id,
    isrc: row.isrc,
    title: row.title,
    artistName: row.artist_name,
    artistId: row.artist_id,
    albumName: row.album_name,
    releaseDate: row.release_date,
    ageYears: row.age_years,
    following: fromDbBool(row.following),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    outcome: row.outcome as PlayOutcome,
    closeReason: row.close_reason as CloseReason,
    provenance: row.provenance as Provenance,
    skipSource: row.skip_source as SkipSource | null,
    contextType: row.context_type,
    classifierVersion: row.classifier_version,
    evidence: {
      listenedMs: row.ev_listened_ms,
      durationMs: row.ev_duration_ms,
      completionRatio: row.ev_completion_ratio,
      maxProgressMs: row.ev_max_progress_ms,
      maxObservationGapMs: row.ev_max_gap_ms,
      observationCount: row.ev_observation_count,
      sawPause: row.ev_saw_pause !== 0,
      rewound: row.ev_rewound !== 0,
      endedWithIdle: row.ev_ended_with_idle !== 0,
    },
  };
}

export class SqliteHistoryRepository implements HistoryRepository, LabelRepository {
  #db: DatabaseSync;
  #migration: MigrationReport;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA busy_timeout = 5000');
    this.#db.exec('PRAGMA foreign_keys = ON');

    // Before any write. A half-migrated schema must never take data.
    this.#migration = migrate(this.#db);
  }

  get migrationReport(): MigrationReport {
    return this.#migration;
  }

  get schemaVersion(): number {
    return this.#migration.to;
  }

  /**
   * Probe writability rather than assuming it.
   *
   * Bind-mount permission problems under Rancher Desktop otherwise surface as a failure at the
   * first play boundary — minutes after startup, with the user having already seen a
   * healthy-looking UI. Failing at startup makes it immediate and diagnosable.
   */
  verifyWritable(): void {
    this.#db.exec('BEGIN');
    try {
      this.#db.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)').run('__probe__');
      this.#db.prepare("DELETE FROM recording_gap WHERE occurred_at = '__probe__'").run();
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  recordPlay(play: NewPlayRecord, trail: readonly Observation[]): number {
    this.#db.exec('BEGIN');
    try {
      const result = this.#db
        .prepare(
          `INSERT INTO play (
             track_id, isrc, title, artist_name, artist_id, album_name, release_date,
             age_years, following, started_at, ended_at, outcome, close_reason, provenance,
             skip_source, context_type, classifier_version,
             ev_listened_ms, ev_duration_ms, ev_completion_ratio, ev_max_progress_ms,
             ev_max_gap_ms, ev_observation_count, ev_saw_pause, ev_rewound, ev_ended_with_idle
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          play.trackId,
          play.isrc,
          play.title,
          play.artistName,
          play.artistId,
          play.albumName,
          play.releaseDate,
          play.ageYears,
          toDbBool(play.following),
          play.startedAt,
          play.endedAt,
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
          play.evidence.sawPause ? 1 : 0,
          play.evidence.rewound ? 1 : 0,
          play.evidence.endedWithIdle ? 1 : 0,
        );

      const playId = Number(result.lastInsertRowid);

      const insertObservation = this.#db.prepare(
        `INSERT INTO observation (play_id, sequence, at_ms, progress_ms, duration_ms, is_playing)
         VALUES (?,?,?,?,?,?)`,
      );
      for (const [index, observation] of trail.entries()) {
        insertObservation.run(
          playId,
          index,
          observation.atMs,
          observation.progressMs,
          observation.durationMs,
          observation.isPlaying ? 1 : 0,
        );
      }

      this.#db.exec('COMMIT');
      return playId;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  getPlay(id: number): PlayRecord | null {
    const row = this.#db.prepare('SELECT * FROM play WHERE id = ?').get(id) as PlayRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * Generator, so callers iterate lazily and memory stays constant regardless of history size.
   *
   * `node:sqlite` has no cursor API, so this pages through in blocks by id rather than reading
   * everything at once. The paging is invisible to callers, who simply iterate.
   */
  *listPlays(filter: HistoryFilter = {}): IterableIterator<PlayRecord> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.since) {
      conditions.push('started_at >= ?');
      params.push(filter.since);
    }
    if (filter.until) {
      conditions.push('started_at <= ?');
      params.push(filter.until);
    }
    if (filter.outcome) {
      conditions.push('outcome = ?');
      params.push(filter.outcome);
    }

    const PAGE = 500;
    let afterId = 0;
    let yielded = 0;

    for (;;) {
      const where = [...conditions, 'id > ?'];
      const statement = this.#db.prepare(
        `SELECT * FROM play WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ${PAGE}`,
      );
      const rows = statement.all(...params, afterId) as unknown as PlayRow[];
      if (rows.length === 0) return;

      for (const row of rows) {
        yield rowToRecord(row);
        afterId = row.id;
        yielded++;
        if (filter.limit !== undefined && yielded >= filter.limit) return;
      }

      if (rows.length < PAGE) return;
    }
  }

  getTrail(playId: number): Observation[] {
    const rows = this.#db
      .prepare(
        `SELECT at_ms, progress_ms, duration_ms, is_playing
         FROM observation WHERE play_id = ? ORDER BY sequence ASC`,
      )
      .all(playId) as {
      at_ms: number;
      progress_ms: number;
      duration_ms: number;
      is_playing: number;
    }[];

    const play = this.#db.prepare('SELECT track_id FROM play WHERE id = ?').get(playId) as
      | { track_id: string }
      | undefined;

    return rows.map((row) => ({
      atMs: row.at_ms,
      trackId: play?.track_id ?? '',
      progressMs: row.progress_ms,
      durationMs: row.duration_ms,
      isPlaying: row.is_playing !== 0,
    }));
  }

  updateOutcome(
    playId: number,
    outcome: PlayOutcome,
    evidence: OutcomeEvidence,
    classifierVersion: number,
  ): void {
    // Observations are deliberately untouched: they are facts, and only the verdict is
    // provisional (BR-4.2).
    this.#db
      .prepare(
        `UPDATE play SET
           outcome = ?, classifier_version = ?,
           ev_listened_ms = ?, ev_duration_ms = ?, ev_completion_ratio = ?,
           ev_max_progress_ms = ?, ev_max_gap_ms = ?, ev_observation_count = ?,
           ev_saw_pause = ?, ev_rewound = ?, ev_ended_with_idle = ?
         WHERE id = ?`,
      )
      .run(
        outcome,
        classifierVersion,
        evidence.listenedMs,
        evidence.durationMs,
        evidence.completionRatio,
        evidence.maxProgressMs,
        evidence.maxObservationGapMs,
        evidence.observationCount,
        evidence.sawPause ? 1 : 0,
        evidence.rewound ? 1 : 0,
        evidence.endedWithIdle ? 1 : 0,
        playId,
      );
  }

  hasPlayNear(trackId: string, startedAt: string, toleranceMs: number): boolean {
    const target = Date.parse(startedAt);
    if (Number.isNaN(target)) return false;

    const rows = this.#db
      .prepare('SELECT started_at FROM play WHERE track_id = ?')
      .all(trackId) as { started_at: string }[];

    return rows.some((row) => {
      const existing = Date.parse(row.started_at);
      return !Number.isNaN(existing) && Math.abs(existing - target) <= toleranceMs;
    });
  }

  coverage(): CoverageStats {
    const count = (sql: string): number => {
      const row = this.#db.prepare(sql).get() as { n: number } | undefined;
      return row?.n ?? 0;
    };

    return {
      totalPlays: count('SELECT COUNT(*) AS n FROM play'),
      byOutcome: {
        completed: count("SELECT COUNT(*) AS n FROM play WHERE outcome = 'completed'"),
        skipped: count("SELECT COUNT(*) AS n FROM play WHERE outcome = 'skipped'"),
        unknown: count("SELECT COUNT(*) AS n FROM play WHERE outcome = 'unknown'"),
      },
      byProvenance: {
        live: count("SELECT COUNT(*) AS n FROM play WHERE provenance = 'live'"),
        backfilled: count("SELECT COUNT(*) AS n FROM play WHERE provenance = 'backfilled'"),
      },
      unknownIsrc: count('SELECT COUNT(*) AS n FROM play WHERE isrc IS NULL'),
      unknownFollowing: count('SELECT COUNT(*) AS n FROM play WHERE following IS NULL'),
      unknownReleaseDate: count('SELECT COUNT(*) AS n FROM play WHERE release_date IS NULL'),
      unknownSkipSource: count('SELECT COUNT(*) AS n FROM play WHERE skip_source IS NULL'),
      countedGaps: count('SELECT COUNT(*) AS n FROM recording_gap'),
    };
  }

  recordGap(): void {
    try {
      this.#db
        .prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)')
        .run(new Date().toISOString());
    } catch {
      // If the gap counter itself cannot be written the database is unusable; the caller has
      // already degraded to display-only, and throwing here would add nothing.
    }
  }

  // ==========================================================================
  // U2 — label enrichment (LabelRepository)
  //
  // Everything below is APPEND-ONLY. There is deliberately no updateLabelResolution:
  // re-resolving inserts a new version, because "our knowledge changed" and "the world
  // changed" are different facts that MusicBrainz cannot distinguish for us (BR-13.1).
  // ==========================================================================

  insertLabelResolution(resolution: NewLabelResolution): number {
    this.#db.exec('BEGIN');
    try {
      // The previous newest version, so the chain is explicitly linked rather than only
      // implied by timestamp ordering.
      const previous = this.#db
        .prepare(
          'SELECT id FROM label_resolution WHERE isrc = ? ORDER BY resolved_at DESC LIMIT 1',
        )
        .get(resolution.isrc) as { id: number } | undefined;

      const info = this.#db
        .prepare(
          `INSERT INTO label_resolution
             (isrc, recording_mbid, match_method, narrowing_tier, release_count,
              resolved_at, status, supersedes_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          resolution.isrc,
          resolution.recordingMbid,
          resolution.matchMethod,
          resolution.narrowingTier,
          resolution.releaseCount,
          resolution.resolvedAt,
          resolution.status,
          previous?.id ?? null,
        );

      const id = Number(info.lastInsertRowid);
      this.#insertCandidates('label_candidate', id, resolution.candidates);
      this.#insertVotes('label_signal_vote', id, resolution.votes);

      this.#db.exec('COMMIT');
      return id;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  insertArtistLabelResolution(resolution: NewArtistLabelResolution): number {
    this.#db.exec('BEGIN');
    try {
      const previous = this.#db
        .prepare(
          `SELECT id FROM artist_label_resolution
           WHERE spotify_artist_id = ? ORDER BY resolved_at DESC LIMIT 1`,
        )
        .get(resolution.spotifyArtistId) as { id: number } | undefined;

      const info = this.#db
        .prepare(
          `INSERT INTO artist_label_resolution
             (spotify_artist_id, artist_mbid, release_count, named_label_count,
              resolved_at, status, supersedes_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          resolution.spotifyArtistId,
          resolution.artistMbid,
          resolution.releaseCount,
          resolution.namedLabelCount,
          resolution.resolvedAt,
          resolution.status,
          previous?.id ?? null,
        );

      const id = Number(info.lastInsertRowid);
      this.#insertCandidates('artist_label', id, resolution.candidates);
      this.#insertVotes('artist_label_signal_vote', id, resolution.votes);

      this.#db.exec('COMMIT');
      return id;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #insertCandidates(table: string, resolutionId: number, candidates: LabelCandidate[]): void {
    if (table === 'artist_label') {
      // The artist-level table carries a per-label release count rather than release detail:
      // it aggregates a career, so which pressing a label appeared on is not the question.
      const statement = this.#db.prepare(
        `INSERT INTO artist_label (resolution_id, label_name, label_mbid, label_type, release_count)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const counts = new Map<string, number>();
      for (const candidate of candidates) {
        counts.set(candidate.labelName, (counts.get(candidate.labelName) ?? 0) + 1);
      }
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (seen.has(candidate.labelName)) continue;
        seen.add(candidate.labelName);
        statement.run(
          resolutionId,
          candidate.labelName,
          candidate.labelMbid,
          candidate.labelType,
          counts.get(candidate.labelName) ?? 1,
        );
      }
      return;
    }

    const statement = this.#db.prepare(
      `INSERT INTO label_candidate
         (resolution_id, label_name, label_mbid, label_type, catalog_number,
          release_id, release_title, release_date, release_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const candidate of candidates) {
      statement.run(
        resolutionId,
        candidate.labelName,
        candidate.labelMbid,
        candidate.labelType,
        candidate.catalogNumber,
        candidate.releaseId,
        candidate.releaseTitle,
        candidate.releaseDate,
        candidate.releaseStatus,
      );
    }
  }

  #insertVotes(table: string, resolutionId: number, votes: SignalVote[]): void {
    const statement = this.#db.prepare(
      `INSERT INTO ${table} (resolution_id, signal, verdict, strength, evidence)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const vote of votes) {
      statement.run(resolutionId, vote.signal, vote.verdict, vote.strength, vote.evidence);
    }
  }

  #loadCandidates(resolutionId: number): LabelCandidate[] {
    const rows = this.#db
      .prepare(
        `SELECT label_name, label_mbid, label_type, catalog_number,
                release_id, release_title, release_date, release_status
         FROM label_candidate WHERE resolution_id = ?`,
      )
      .all(resolutionId) as Record<string, string | null>[];

    return rows.map((row) => ({
      labelName: row.label_name as string,
      labelMbid: row.label_mbid ?? null,
      labelType: (row.label_type ?? null) as LabelCandidate['labelType'],
      catalogNumber: row.catalog_number ?? null,
      releaseId: row.release_id as string,
      releaseTitle: row.release_title ?? null,
      releaseDate: row.release_date ?? null,
      releaseStatus: row.release_status ?? null,
    }));
  }

  #loadArtistCandidates(resolutionId: number): LabelCandidate[] {
    const rows = this.#db
      .prepare(
        'SELECT label_name, label_mbid, label_type, release_count FROM artist_label WHERE resolution_id = ?',
      )
      .all(resolutionId) as Record<string, string | number | null>[];

    return rows.map((row) => ({
      labelName: row.label_name as string,
      labelMbid: (row.label_mbid ?? null) as string | null,
      labelType: (row.label_type ?? null) as LabelCandidate['labelType'],
      catalogNumber: null,
      // Artist-level candidates are not tied to one release; the count is the evidence.
      releaseId: `aggregate:${String(row.release_count ?? 0)}`,
      releaseTitle: null,
      releaseDate: null,
      releaseStatus: null,
    }));
  }

  #loadVotes(table: string, resolutionId: number): SignalVote[] {
    const rows = this.#db
      .prepare(`SELECT signal, verdict, strength, evidence FROM ${table} WHERE resolution_id = ?`)
      .all(resolutionId) as Record<string, string | null>[];

    return rows.map((row) => ({
      signal: row.signal as SignalVote['signal'],
      verdict: row.verdict as LabelVerdict,
      strength: row.strength as SignalVote['strength'],
      evidence: row.evidence ?? null,
    }));
  }

  getCurrentLabelResolution(isrc: string): LabelResolution | null {
    // No is_current flag to maintain: a maintained flag can end up with two rows both claiming
    // to be current, and that reads as valid data. This query cannot go stale (BR-13.3).
    const row = this.#db
      .prepare('SELECT * FROM label_resolution WHERE isrc = ? ORDER BY resolved_at DESC LIMIT 1')
      .get(isrc) as Record<string, unknown> | undefined;
    return row === undefined ? null : this.#toLabelResolution(row);
  }

  getLabelResolutionById(id: number): LabelResolution | null {
    const row = this.#db.prepare('SELECT * FROM label_resolution WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? null : this.#toLabelResolution(row);
  }

  #toLabelResolution(row: Record<string, unknown>): LabelResolution {
    const id = row.id as number;
    return {
      id,
      isrc: row.isrc as string,
      recordingMbid: (row.recording_mbid ?? null) as string | null,
      matchMethod: row.match_method as LabelResolution['matchMethod'],
      narrowingTier: row.narrowing_tier as LabelResolution['narrowingTier'],
      releaseCount: row.release_count as number,
      resolvedAt: row.resolved_at as string,
      status: row.status as LabelResolution['status'],
      supersedesId: (row.supersedes_id ?? null) as number | null,
      candidates: this.#loadCandidates(id),
      votes: this.#loadVotes('label_signal_vote', id),
    };
  }

  getCurrentArtistLabelResolution(spotifyArtistId: string): ArtistLabelResolution | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM artist_label_resolution
         WHERE spotify_artist_id = ? ORDER BY resolved_at DESC LIMIT 1`,
      )
      .get(spotifyArtistId) as Record<string, unknown> | undefined;
    return row === undefined ? null : this.#toArtistResolution(row);
  }

  getArtistLabelResolutionById(id: number): ArtistLabelResolution | null {
    const row = this.#db.prepare('SELECT * FROM artist_label_resolution WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? null : this.#toArtistResolution(row);
  }

  #toArtistResolution(row: Record<string, unknown>): ArtistLabelResolution {
    const id = row.id as number;
    return {
      id,
      spotifyArtistId: row.spotify_artist_id as string,
      artistMbid: (row.artist_mbid ?? null) as string | null,
      releaseCount: row.release_count as number,
      namedLabelCount: row.named_label_count as number,
      resolvedAt: row.resolved_at as string,
      status: row.status as ArtistLabelResolution['status'],
      supersedesId: (row.supersedes_id ?? null) as number | null,
      candidates: this.#loadArtistCandidates(id),
      votes: this.#loadVotes('artist_label_signal_vote', id),
    };
  }

  /**
   * Write the as-of-play snapshot, refusing to overwrite one that already exists.
   *
   * `WHERE label_verdict IS NULL` is the whole of BR-8.4a. A later resolution appends a version;
   * it does not revise what was believed at the time. Backfill depends on this being enforced
   * here rather than remembered by every caller.
   */
  applyLabelSnapshot(playId: number, snapshot: LabelSnapshot): boolean {
    const info = this.#db
      .prepare(
        `UPDATE play SET
           label_verdict = ?, label_confidence = ?, label_contested = ?,
           label_names = ?, label_match_method = ?, label_narrowing_tier = ?,
           label_unknown_reason = ?, label_resolution_id = ?, label_classifier_version = ?
         WHERE id = ? AND label_verdict IS NULL`,
      )
      .run(
        snapshot.verdict,
        snapshot.confidence,
        snapshot.contested ? 1 : 0,
        snapshot.labelNames.length > 0 ? JSON.stringify(snapshot.labelNames) : null,
        snapshot.matchMethod,
        snapshot.narrowingTier,
        snapshot.unknownReason,
        snapshot.resolutionId,
        snapshot.classifierVersion,
        playId,
      );
    return info.changes > 0;
  }

  applyArtistLabelSnapshot(playId: number, snapshot: ArtistLabelSnapshot): boolean {
    const info = this.#db
      .prepare(
        `UPDATE play SET
           artist_label_verdict = ?, artist_label_confidence = ?,
           artist_label_names = ?, artist_label_resolution_id = ?
         WHERE id = ? AND artist_label_verdict IS NULL`,
      )
      .run(
        snapshot.verdict,
        snapshot.confidence,
        snapshot.labelNames.length > 0 ? JSON.stringify(snapshot.labelNames) : null,
        snapshot.resolutionId,
        playId,
      );
    return info.changes > 0;
  }

  /**
   * Amend liked evidence.
   *
   * Booleans are stored as 1/0/NULL, and **NULL is never written as 0** — the saved-track set can
   * be unavailable, and a fabricated `false` would read as an observed choice (BR-9.5). The
   * transition is derived here rather than passed in, so the two can never disagree.
   */
  updateLikedEvidence(playId: number, evidence: LikedEvidence): void {
    const { likedAtStart: start, likedAtEnd: end } = evidence;

    const transition =
      start === null || end === null
        ? 'unknown'
        : start && end
          ? 'kept-liked'
          : !start && end
            ? 'liked-during'
            : start && !end
              ? 'unliked-during'
              : 'kept-unliked';

    this.#db
      .prepare(
        `UPDATE play SET liked_at_start = ?, liked_at_end = ?, liked_added_at = ?,
                         liked_transition = ?
         WHERE id = ?`,
      )
      .run(
        start === null ? null : start ? 1 : 0,
        end === null ? null : end ? 1 : 0,
        evidence.likedAddedAt,
        transition,
        playId,
      );
  }

  listPlaysNeedingLabels(limit: number): PlayNeedingLabels[] {
    // The database is the queue of record (P-5): a restart loses the in-memory queue and
    // nothing else, because this query re-derives exactly what remains to be done.
    const rows = this.#db
      .prepare(
        `SELECT id, track_id, isrc, artist_id, album_name, release_date
         FROM play
         WHERE isrc IS NOT NULL AND label_verdict IS NULL
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit) as Record<string, string | number | null>[];
    return rows.map(toPlayNeedingLabels);
  }

  listPlaysNeedingIsrc(limit: number): PlayNeedingLabels[] {
    const rows = this.#db
      .prepare(
        `SELECT id, track_id, isrc, artist_id, album_name, release_date
         FROM play
         WHERE isrc IS NULL
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit) as Record<string, string | number | null>[];
    return rows.map(toPlayNeedingLabels);
  }

  /**
   * Keys whose newest version has aged past its TTL.
   *
   * Two TTLs, because they answer different questions (P-3). A `resolved` row is re-checked
   * because the underlying fact can change — an artist signs. An `unknown` row is re-checked
   * because MusicBrainz's *completeness* changes, and the probe measured that gap as
   * recency-biased toward exactly the music the hypothesis is about.
   *
   * `now` is a parameter rather than a clock read, so TTL behaviour is testable without waiting
   * ninety days.
   */
  listStaleLabelResolutions(
    now: string,
    unknownTtlDays: number,
    resolvedTtlDays: number,
    limit: number,
  ): StaleResolution[] {
    const cutoff = (days: number): string =>
      new Date(Date.parse(now) - days * 86_400_000).toISOString();

    const rows = this.#db
      .prepare(
        `SELECT isrc AS key, status, resolved_at FROM label_resolution AS r
         WHERE r.resolved_at = (
                 SELECT MAX(resolved_at) FROM label_resolution WHERE isrc = r.isrc)
           AND ( (r.status = 'resolved'  AND r.resolved_at < ?)
              OR (r.status <> 'resolved' AND r.resolved_at < ?) )
         ORDER BY r.resolved_at ASC
         LIMIT ?`,
      )
      .all(cutoff(resolvedTtlDays), cutoff(unknownTtlDays), limit) as Record<string, string>[];

    return rows.map((row) => ({
      key: row.key as string,
      status: row.status as StaleResolution['status'],
      resolvedAt: row.resolved_at as string,
    }));
  }

  labelCoverage(now: string): LabelCoverage {
    const count = (sql: string, ...params: (string | number)[]): number => {
      const row = this.#db.prepare(sql).get(...params) as { n: number } | undefined;
      return row?.n ?? 0;
    };

    const byVerdict: Record<LabelVerdict, number> = {
      major: count("SELECT COUNT(*) AS n FROM play WHERE label_verdict = 'major'"),
      independent: count("SELECT COUNT(*) AS n FROM play WHERE label_verdict = 'independent'"),
      unknown: count("SELECT COUNT(*) AS n FROM play WHERE label_verdict = 'unknown'"),
    };

    const reasons: UnknownReason[] = ['noIsrc', 'notFound', 'noEligibleCandidate', 'error'];
    const unknownByReason = Object.fromEntries(
      reasons.map((reason) => [
        reason,
        count('SELECT COUNT(*) AS n FROM play WHERE label_unknown_reason = ?', reason),
      ]),
    ) as Record<UnknownReason, number>;

    // BR-10.3 — the breakdown that keeps R2 visible. A single aggregate would hide that the
    // misses concentrate on recent releases.
    const yearRows = this.#db
      .prepare(
        `SELECT COALESCE(substr(release_date, 1, 4), 'unknown') AS year,
                COUNT(*) AS total,
                SUM(CASE WHEN label_verdict IS NOT NULL AND label_verdict <> 'unknown'
                         THEN 1 ELSE 0 END) AS resolved
         FROM play GROUP BY year ORDER BY year`,
      )
      .all() as Record<string, string | number>[];

    return {
      asOf: now,
      total: count('SELECT COUNT(*) AS n FROM play'),
      resolved: byVerdict.major + byVerdict.independent,
      // `pending` is a real state, never folded into `unknown` (BR-7.7): counting in-flight
      // lookups as absent data would corrupt the very metric R2 is measured with.
      pending: count('SELECT COUNT(*) AS n FROM play WHERE label_verdict IS NULL'),
      byVerdict,
      unknownByReason,
      byReleaseYear: yearRows.map((row) => ({
        year: String(row.year),
        total: Number(row.total),
        resolved: Number(row.resolved),
      })),
    };
  }

  close(): void {
    this.#db.close();
  }
}

function toPlayNeedingLabels(row: Record<string, string | number | null>): PlayNeedingLabels {
  return {
    playId: row.id as number,
    trackId: row.track_id as string,
    isrc: (row.isrc ?? null) as string | null,
    artistId: (row.artist_id ?? null) as string | null,
    albumName: row.album_name as string,
    releaseDate: (row.release_date ?? null) as string | null,
  };
}
