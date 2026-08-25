/**
 * Enrichment: the read-only data the MCP server cannot supply.
 *
 * Chain, per track (1 call, cached by track ID):
 *   GET /tracks/{id}   -> release date, artist IDs, track number, explicit, album art
 *
 * Plus follow status, resolved against a cached set of followed artists rather than a
 * per-track call (see FollowedArtistsCache below).
 *
 * WHAT IS NOT HERE, AND WHY — all verified empirically against a live Development Mode
 * token on 2026-08-24, not inferred from documentation:
 *
 *   - `GET /me/following/contains` returns **403** even with `user-follow-read` granted.
 *     The scope is present on the token; the endpoint itself is restricted. Follow status
 *     is therefore derived from `GET /me/following?type=artist`, which returns 200.
 *   - `GET /artists/{id}` returns **no `genres` field** in Development Mode. The response
 *     carries only: external_urls, href, id, images, name, type, uri. The call was removed
 *     entirely rather than kept as dead weight — genres need an external source (CQ2).
 *   - track.popularity / artist.popularity (removed Feb 2026) -> no play-count proxy.
 *   - album.label (removed Feb 2026) -> no signed-vs-independent signal.
 *
 * See aidlc-docs/inception/research/research-findings.md Part 3.
 */

import { SpotifyWebApiClient } from './webApiClient.js';

interface SpotifyArtistRef {
  id: string;
  name: string;
}

interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface AlbumArt {
  /** Largest available, for the blurred backdrop. Verified: 640px on live responses. */
  full: string;
  /** Mid size for the cover thumbnail — 300px where offered, else the largest. */
  display: string;
  /** Smallest, for a fast first paint. Verified: 64px on live responses. */
  thumb: string;
}

/**
 * Spotify returns images largest-first, but the sizes offered vary by album, so pick by
 * measured width rather than by array position.
 */
function pickArt(images: SpotifyImage[] | undefined): AlbumArt | null {
  const usable = (images ?? []).filter((image) => typeof image.url === 'string' && image.url);
  if (usable.length === 0) return null;

  const byWidth = [...usable].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const largest = byWidth[0]!;
  const smallest = byWidth[byWidth.length - 1]!;
  const mid = byWidth.find((image) => (image.width ?? 0) <= 400) ?? largest;

  return { full: largest.url, display: mid.url, thumb: smallest.url };
}

interface SpotifyTrack {
  id: string;
  name: string;
  track_number: number;
  duration_ms: number;
  explicit: boolean;
  artists: SpotifyArtistRef[];
  album: {
    id: string;
    name: string;
    album_type: string;
    release_date: string;
    release_date_precision: 'year' | 'month' | 'day';
    total_tracks: number;
    images?: SpotifyImage[];
  };
  external_urls?: { spotify?: string };
}

interface FollowedArtistsPage {
  artists: {
    items: { id: string }[];
    next: string | null;
    cursors?: { after?: string };
  };
}

/**
 * The set of artists the user follows, fetched once and reused.
 *
 * `GET /me/following/contains` — the natural per-track check — is 403 in Development Mode,
 * so membership is resolved locally against the full followed list instead. This is also
 * cheaper: following changes rarely, so one paginated fetch serves many tracks, and a
 * track change costs zero follow-related API calls.
 */
class FollowedArtistsCache {
  #api: SpotifyWebApiClient;
  #ids: Set<string> | null = null;
  #fetchedAt = 0;
  #inFlight: Promise<Set<string>> | null = null;

  static readonly TTL_MS = 10 * 60 * 1000;
  static readonly MAX_PAGES = 40; // 2000 artists; a guard against a runaway cursor loop.

  constructor(api: SpotifyWebApiClient) {
    this.#api = api;
  }

  async #load(): Promise<Set<string>> {
    const ids = new Set<string>();
    let after: string | undefined;

    for (let page = 0; page < FollowedArtistsCache.MAX_PAGES; page++) {
      const params: Record<string, string> = { type: 'artist', limit: '50' };
      if (after) params.after = after;

      const response = await this.#api.get<FollowedArtistsPage>('/me/following', params);
      const artists = response?.artists;
      if (!artists) break;

      for (const artist of artists.items ?? []) ids.add(artist.id);

      if (!artists.next) break;
      after = artists.cursors?.after;
      if (!after) break;
    }

    this.#ids = ids;
    this.#fetchedAt = Date.now();
    return ids;
  }

  async ids(): Promise<Set<string>> {
    if (this.#ids && Date.now() - this.#fetchedAt < FollowedArtistsCache.TTL_MS) {
      return this.#ids;
    }
    this.#inFlight ??= this.#load().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async has(artistId: string): Promise<boolean> {
    return (await this.ids()).has(artistId);
  }
}

export interface Enrichment {
  trackId: string;
  releaseDate: string | null;
  releaseDatePrecision: string | null;
  releaseYear: number | null;
  /** Whole years since release — the input to the planned auto-skip rule. */
  ageYears: number | null;
  albumType: string | null;
  totalTracks: number | null;
  trackNumber: number | null;
  explicit: boolean | null;
  /**
   * Always empty in Development Mode — Spotify no longer returns artist genres. Kept in the
   * shape so an external genre source (CQ2) can populate it without a contract change.
   */
  genres: string[];
  /** Why `genres` is empty, so the UI can say so instead of showing a bare dash. */
  genresUnavailableReason: string | null;
  primaryArtistId: string | null;
  primaryArtistName: string | null;
  following: boolean | null;
  /** Album artwork, from `track.album.images`. Null when the album has no art. */
  art: AlbumArt | null;
  spotifyUrl: string | null;
  /** Per-field failures, so a partial result still renders instead of blanking the panel. */
  warnings: string[];
}

function parseYear(releaseDate: string | undefined): number | null {
  if (!releaseDate) return null;
  const year = Number.parseInt(releaseDate.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

/**
 * Whole years between release and now. Uses full date precision where Spotify provides it,
 * falling back to year-only, which is what most older catalogue entries carry.
 */
function ageInYears(releaseDate: string | undefined, precision: string | undefined): number | null {
  const year = parseYear(releaseDate);
  if (year === null) return null;

  if (precision === 'day' || precision === 'month') {
    const parsed = new Date(releaseDate!);
    if (!Number.isNaN(parsed.getTime())) {
      return Math.floor((Date.now() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
  }
  return new Date().getUTCFullYear() - year;
}

export class EnrichmentService {
  #api: SpotifyWebApiClient;
  #followed: FollowedArtistsCache;
  #cache = new Map<string, Enrichment>();
  #inFlight = new Map<string, Promise<Enrichment>>();

  constructor(api: SpotifyWebApiClient) {
    this.#api = api;
    this.#followed = new FollowedArtistsCache(api);
  }

  /** Exposed for diagnostics — proves the followed-artists workaround is functioning. */
  async followedArtistCount(): Promise<number> {
    return (await this.#followed.ids()).size;
  }

  get(trackId: string): Enrichment | undefined {
    return this.#cache.get(trackId);
  }

  /** Fetches enrichment for a track, deduplicating concurrent requests and caching results. */
  async fetch(trackId: string): Promise<Enrichment> {
    const cached = this.#cache.get(trackId);
    if (cached) return cached;

    const existing = this.#inFlight.get(trackId);
    if (existing) return existing;

    const pending = this.#build(trackId).finally(() => this.#inFlight.delete(trackId));
    this.#inFlight.set(trackId, pending);
    return pending;
  }

  async #build(trackId: string): Promise<Enrichment> {
    const warnings: string[] = [];

    const result: Enrichment = {
      trackId,
      releaseDate: null,
      releaseDatePrecision: null,
      releaseYear: null,
      ageYears: null,
      albumType: null,
      totalTracks: null,
      trackNumber: null,
      explicit: null,
      genres: [],
      genresUnavailableReason: 'Spotify no longer returns artist genres in Development Mode',
      primaryArtistId: null,
      primaryArtistName: null,
      following: null,
      art: null,
      spotifyUrl: null,
      warnings,
    };

    const track = await this.#api.get<SpotifyTrack>(`/tracks/${trackId}`).catch((error) => {
      warnings.push(`track lookup: ${error.message}`);
      return null;
    });

    if (track) {
      result.releaseDate = track.album?.release_date ?? null;
      result.releaseDatePrecision = track.album?.release_date_precision ?? null;
      result.releaseYear = parseYear(track.album?.release_date);
      result.ageYears = ageInYears(track.album?.release_date, track.album?.release_date_precision);
      result.albumType = track.album?.album_type ?? null;
      result.totalTracks = track.album?.total_tracks ?? null;
      result.trackNumber = track.track_number ?? null;
      result.explicit = track.explicit ?? null;
      result.primaryArtistId = track.artists?.[0]?.id ?? null;
      result.primaryArtistName = track.artists?.[0]?.name ?? null;
      result.art = pickArt(track.album?.images);
      result.spotifyUrl = track.external_urls?.spotify ?? null;
    }

    if (result.primaryArtistId) {
      try {
        result.following = await this.#followed.has(result.primaryArtistId);
      } catch (error) {
        warnings.push(`follow check: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Only cache complete results — a transient failure shouldn't be remembered forever.
    if (warnings.length === 0) this.#cache.set(trackId, result);

    return result;
  }
}
