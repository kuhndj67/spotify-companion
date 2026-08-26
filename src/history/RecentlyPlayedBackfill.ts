/**
 * Fills gaps from `GET /me/player/recently-played` (FR-22, BR-5).
 *
 * Without this, the dataset is biased toward the hours the app happens to be running — which is
 * not a random sample of listening.
 *
 * ## Backfilled plays are always `unknown`, never `completed`
 *
 * This is the tempting shortcut and it is wrong. The endpoint returns tracks Spotify considered
 * played, which invites treating them as completions — but it reports **no progress data**, so
 * that would be an inference dressed as an observation. Worse, it would inflate the completion
 * rate exactly during the periods the app was down: a bias correlated with downtime rather than
 * randomly distributed.
 *
 * `unknown` is the only honest verdict available here.
 */

import type { SpotifyWebApiClient } from '../spotify/webApiClient.js';
import type { HistoryRepository } from './HistoryRepository.js';
import { CLASSIFIER_VERSION } from './outcomeClassifier.js';
import type { NewPlayRecord } from './types.js';

interface RecentlyPlayedResponse {
  items?: {
    played_at: string;
    track?: {
      id: string;
      name: string;
      duration_ms: number;
      artists?: { id: string; name: string }[];
      album?: { name: string; release_date?: string };
      external_ids?: { isrc?: string };
    };
    context?: { type?: string } | null;
  }[];
}

export interface BackfillReport {
  fetched: number;
  inserted: number;
  duplicates: number;
  error: string | null;
}

/** Two plays of the same track within this window are treated as the same event (BR-5.4). */
const DEDUP_TOLERANCE_MS = 60_000;

export class RecentlyPlayedBackfill {
  #api: SpotifyWebApiClient;
  #repo: HistoryRepository;

  constructor(api: SpotifyWebApiClient, repo: HistoryRepository) {
    this.#api = api;
    this.#repo = repo;
  }

  async run(limit = 50): Promise<BackfillReport> {
    const report: BackfillReport = { fetched: 0, inserted: 0, duplicates: 0, error: null };

    let response: RecentlyPlayedResponse | null;
    try {
      response = await this.#api.get<RecentlyPlayedResponse>('/me/player/recently-played', {
        limit: String(limit),
      });
    } catch (error) {
      // BR-5.6: non-fatal. The app starts regardless — a missing backfill is a gap in the data,
      // not a reason to have no app.
      report.error = error instanceof Error ? error.message : String(error);
      return report;
    }

    const items = response?.items ?? [];
    report.fetched = items.length;

    // Oldest first, so an interruption leaves a contiguous prefix rather than scattered rows
    // with holes in between.
    const ordered = [...items].reverse();

    for (const item of ordered) {
      const track = item.track;
      if (!track?.id || !item.played_at) continue;

      if (this.#repo.hasPlayNear(track.id, item.played_at, DEDUP_TOLERANCE_MS)) {
        report.duplicates++;
        continue;
      }

      const record: NewPlayRecord = {
        trackId: track.id,
        isrc: track.external_ids?.isrc ?? null,
        title: track.name,
        artistName: track.artists?.[0]?.name ?? '',
        artistId: track.artists?.[0]?.id ?? null,
        albumName: track.album?.name ?? '',
        releaseDate: track.album?.release_date ?? null,
        ageYears: null,
        // Not looked up: follow status is a *current* fact, and asserting it retroactively for a
        // play that happened hours ago would be a small fabrication in a dataset whose value
        // depends on not making any.
        following: null,
        startedAt: item.played_at,
        endedAt: item.played_at,
        outcome: 'unknown',
        closeReason: 'playback-stopped',
        evidence: {
          listenedMs: 0,
          durationMs: track.duration_ms ?? 0,
          completionRatio: 0,
          maxProgressMs: 0,
          maxObservationGapMs: 0,
          // Zero observations is the marker that this row has no trail and must never be
          // reclassified (BR-4.5).
          observationCount: 0,
          sawPause: false,
          rewound: false,
          endedWithIdle: true,
        },
        provenance: 'backfilled',
        skipSource: null,
        contextType: item.context?.type ?? null,
        classifierVersion: CLASSIFIER_VERSION,
      };

      try {
        this.#repo.recordPlay(record, []);
        report.inserted++;
      } catch (error) {
        report.error = error instanceof Error ? error.message : String(error);
        return report;
      }
    }

    return report;
  }
}
