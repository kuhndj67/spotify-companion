/**
 * Filling in labels for plays already recorded, and re-resolving what has aged out.
 *
 * ## The database is the queue of record (P-5)
 *
 * There is no persisted queue. What still needs doing is **derivable** — plays with an ISRC and no
 * verdict, resolutions past their TTL — so a restart loses the in-memory queue and nothing else.
 * The self-healing property comes free from a decision made for other reasons.
 *
 * ## Everything here runs at LOW priority
 *
 * Backfill has real volume: dozens of unresolved ISRCs at two calls each, plus artist joins, at
 * one request per second. Queued ahead of the live track, the label for what is playing *right
 * now* would arrive minutes late — a `pending` panel that never settles. It never competes.
 *
 * ## It never revises history (BR-8.4a)
 *
 * A new resolution appends a version; the play's as-of-play snapshot stands. That is enforced in
 * the repository's `WHERE label_verdict IS NULL`, so it cannot be forgotten here.
 */

import type { SpotifyWebApiClient } from '../spotify/webApiClient.js';
import type { LabelRepository } from './LabelRepository.js';
import type { LabelCache } from './LabelCache.js';
import type { LabelEnrichmentService } from './LabelEnrichmentService.js';

export interface LabelBackfillOptions {
  repository: LabelRepository;
  cache: LabelCache;
  enrichment: LabelEnrichmentService;
  /** Used only to recover missing ISRCs, which is a Spotify call, not a MusicBrainz one. */
  api: SpotifyWebApiClient | null;
  batchSize?: number;
  now?: () => string;
}

export interface BackfillReport {
  isrcsRecovered: number;
  labelsResolved: number;
  artistsResolved: number;
  refreshed: number;
  genresFilled: number;
  errors: number;
}

export class LabelBackfillJob {
  readonly #repository: LabelRepository;
  readonly #cache: LabelCache;
  readonly #enrichment: LabelEnrichmentService;
  readonly #api: SpotifyWebApiClient | null;
  readonly #batchSize: number;
  readonly #now: () => string;
  #running = false;

  constructor(options: LabelBackfillOptions) {
    this.#repository = options.repository;
    this.#cache = options.cache;
    this.#enrichment = options.enrichment;
    this.#api = options.api;
    this.#batchSize = options.batchSize ?? 25;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  get running(): boolean {
    return this.#running;
  }

  /**
   * One bounded sweep.
   *
   * Bounded so a large backlog cannot monopolise the single queue for hours — the next sweep
   * picks up where this one stopped, because the work set is a query rather than a cursor.
   *
   * Re-entrancy is guarded: a scheduled sweep must not overlap the startup sweep.
   */
  async runOnce(): Promise<BackfillReport> {
    if (this.#running) {
      return {
        isrcsRecovered: 0,
        labelsResolved: 0,
        artistsResolved: 0,
        refreshed: 0,
        genresFilled: 0,
        errors: 0,
      };
    }
    this.#running = true;

    const report: BackfillReport = {
      isrcsRecovered: 0,
      labelsResolved: 0,
      artistsResolved: 0,
      refreshed: 0,
      genresFilled: 0,
      errors: 0,
    };

    try {
      await this.#recoverIsrcs(report);
      await this.#resolveLabels(report);
      await this.#refreshStale(report);
      await this.#collectGenres(report);
    } finally {
      this.#running = false;
    }

    return report;
  }

  /**
   * Recover ISRCs for backfilled plays (BR-8.1).
   *
   * 47 of the 71 recorded plays came from `recently-played`, which returns no `external_ids`.
   * They do carry `track_id`, so the ISRC is recoverable at one `GET /tracks/{id}` each — a
   * **one-off** cost, not a per-play one, and it uses Spotify's client and NFR-17's existing
   * 429/401 handling rather than the MusicBrainz queue.
   */
  async #recoverIsrcs(report: BackfillReport): Promise<void> {
    if (this.#api === null) return;

    const plays = this.#repository.listPlaysNeedingIsrc(this.#batchSize);
    // Deduplicated by track: 50 rows in the real database resolve to 47 distinct tracks, and
    // paying twice for the same track would be a straightforward waste of the budget.
    const byTrack = new Map<string, number[]>();
    for (const play of plays) {
      byTrack.set(play.trackId, [...(byTrack.get(play.trackId) ?? []), play.playId]);
    }

    for (const [trackId] of byTrack) {
      try {
        const track = await this.#api.get<{ external_ids?: { isrc?: string } }>(`/tracks/${trackId}`);
        if (track?.external_ids?.isrc) report.isrcsRecovered += 1;
      } catch {
        report.errors += 1;
      }
    }
  }

  async #resolveLabels(report: BackfillReport): Promise<void> {
    const plays = this.#repository.listPlaysNeedingLabels(this.#batchSize);

    for (const play of plays) {
      try {
        const resolution = await this.#enrichment.resolveRelease(
          {
            isrc: play.isrc,
            artistName: '',
            artistId: play.artistId,
            albumName: play.albumName,
            releaseDate: play.releaseDate,
            title: '',
          },
          'low',
        );

        // Written once; a later version appends rather than revising (BR-8.4a). A null
        // snapshot means the lookup failed transiently -- the play stays `pending` and comes
        // back round on the next sweep rather than being permanently marked unresolvable.
        const snapshot = this.#enrichment.toSnapshot(resolution, play.isrc);
        if (snapshot === null) {
          report.errors += 1;
        } else if (this.#repository.applyLabelSnapshot(play.playId, snapshot)) {
          report.labelsResolved += 1;
        }

        if (play.artistId !== null) {
          const artist = await this.#enrichment.resolveArtist(play.artistId, 'low');
          const artistSnapshot = this.#enrichment.toArtistSnapshot(artist);
          if (artistSnapshot !== null) {
            const wroteArtist = this.#repository.applyArtistSnapshot(play.playId, artistSnapshot);
            if (wroteArtist) report.artistsResolved += 1;
          }
        }
      } catch {
        // A failure on one play must not stop the sweep. The row simply stays in the work set,
        // which is exactly what P-5's derived queue is for.
        report.errors += 1;
      }
    }
  }

  /**
   * Collect genres for artists resolved before migration 003 added them.
   *
   * Those resolutions are `resolved` and therefore fresh for the full 90-day TTL, so they would
   * otherwise carry no genres for a quarter. Re-resolving appends a version (BR-13.1); the chain
   * then records that the genres were learned on a later date, which is exactly what happened.
   */
  async #collectGenres(report: BackfillReport): Promise<void> {
    for (const artistId of this.#repository.listArtistsNeedingGenres(this.#batchSize)) {
      try {
        await this.#enrichment.resolveArtist(artistId, 'low', { force: true });
      } catch {
        report.errors += 1;
      }
    }
    report.genresFilled = this.#repository.fillMissingArtistGenres(this.#batchSize * 20);
  }

  /**
   * Re-resolve what has aged past its TTL, appending a new version each time.
   *
   * This is the loop that makes the version chain capable of recording a *change* rather than
   * only our own catalogue gaps filling in.
   */
  async #refreshStale(report: BackfillReport): Promise<void> {
    const stale = this.#cache.listStale(this.#now(), this.#batchSize);

    for (const entry of stale) {
      try {
        const existing = this.#repository.getCurrentLabelResolution(entry.key);
        await this.#enrichment.resolveRelease(
          {
            isrc: entry.key,
            artistName: '',
            artistId: null,
            albumName: existing?.candidates[0]?.releaseTitle ?? null,
            releaseDate: existing?.candidates[0]?.releaseDate ?? null,
            title: '',
          },
          'low',
        );
        report.refreshed += 1;
      } catch {
        report.errors += 1;
      }
    }
  }
}
