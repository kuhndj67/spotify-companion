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
      // ⚠️ This narrow hand-written shape is why `explicit` and `album_type` were believed
      // absent from this endpoint: a field a local type does not declare is indistinguishable
      // from a field the API does not send. Probed 2026-09-20 — HTTP 200, both present on 3/3
      // items (`album`, `album`, `single`), alongside `external_ids.isrc`.
      album?: { name: string; release_date?: string; album_type?: string };
      explicit?: boolean;
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

/** Two plays of the same track ending within this window are the same event (BR-5.4). */
const DEDUP_TOLERANCE_MS = 60_000;

/**
 * The start of a play, derived from the end Spotify reports and the track's length.
 *
 * Approximate by construction: it assumes the track ran without a pause. Validated against 41
 * plays observed live — median error 5.7 s, and 38 of 41 inside the one-minute dedup window. The
 * three outliers are longer than the track, which is what a pause looks like from here.
 *
 * A bad `duration_ms` must not produce a start *after* the end, which would be an impossible row.
 */
function startedAtFrom(playedAt: string, durationMs: number | undefined): string {
  const end = Date.parse(playedAt);
  const duration = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 0;
  if (Number.isNaN(end)) return playedAt;
  return new Date(end - duration).toISOString();
}

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

      // Dedup on the END, because that is what `played_at` is -- see the comment on startedAt
      // below. Comparing it against stored *starts* put a whole track duration between the two
      // instants, so every play already recorded live looked new and was inserted a second time.
      if (this.#repo.hasPlayNearEnd(track.id, item.played_at, DEDUP_TOLERANCE_MS)) {
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
        // ⚠️ `?? null`, never `?? false`. An item that omitted `explicit` would be unknown, and
        // recording it as "not explicit" is a fabricated fact about a backfilled play — the same
        // error as writing `completed` onto a row with no observation trail.
        explicit: track.explicit ?? null,
        albumType: track.album?.album_type ?? null,
        // ⚠️ A backfilled play has no observation trail and therefore no completion ratio, so
        // there is nothing to attribute FROM. Null means "never asked", and it must stay null:
        // `recently-played` reports no progress, so no later pass can answer this either.
        successorLagMs: null,
        // Not looked up: follow status is a *current* fact, and asserting it retroactively for a
        // play that happened hours ago would be a small fabrication in a dataset whose value
        // depends on not making any.
        following: null,
        // ⚠️ `played_at` is when the track **FINISHED**, not when it started. The docs do not say
        // so; the live data does. Across 41 plays this app had itself observed start and end,
        // `played_at` matched the recorded END with a median error of 3.0 s and a maximum of
        // 8.8 s, and matched a start exactly once (by 177 s, itself about a track length).
        //
        // Storing it as the start put every backfilled row roughly one track duration late AND
        // defeated deduplication, so each restart re-inserted plays already recorded live as
        // fresh `unknown` rows. The start is therefore derived; the end is the measured value.
        startedAt: startedAtFrom(item.played_at, track.duration_ms),
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
