/**
 * Resolving a track's label — the flow everything else calls.
 *
 * Orchestrates; owns nothing. The queue enforces the rate limit, the cache holds the facts, the
 * classifier makes the judgement, and this class puts them in order.
 *
 * ## ⚠️ This must never delay the now-playing display (NFR-16, BR-7.5)
 *
 * MusicBrainz latency was **measured at 0.1–6.7 s**, highly variable, and at 1 req/sec behind a
 * backfill sweep it can be minutes. Nothing here is awaited on the display path: the panel renders
 * from Spotify data and label fields arrive later by the same push the UI already uses.
 *
 * That is why `pending` is a real state rather than a flavour of `unknown` (BR-7.7). Counting
 * in-flight lookups as absent data would corrupt the coverage metric that exists to measure R2.
 */

import type { Priority } from './RequestQueue.js';
import { MusicBrainzError, type MusicBrainzClient } from './MusicBrainzClient.js';
import type { LabelCache } from './LabelCache.js';
import type { LabelSnapshot, ArtistLabelSnapshot, NewLabelResolution } from './LabelRepository.js';
import { classify } from './labelClassifier.js';
import { isrcPrefixVote } from './isrcPrefix.js';
import { narrowReleases } from './releaseNarrowing.js';
import { MAJOR_ROOTS } from './majorRootList.js';
import type {
  ArtistLabelResolution,
  LabelResolution,
  ResolutionStatus,
  UnknownReason,
} from './types.js';

/** Bumped whenever the classifier's rules change, so a re-tune is visible in the data. */
export const LABEL_CLASSIFIER_VERSION = 1;

export interface TrackContext {
  isrc: string | null;
  artistName: string;
  artistId: string | null;
  albumName: string | null;
  releaseDate: string | null;
  title: string;
}

export interface LabelEnrichmentOptions {
  client: MusicBrainzClient;
  cache: LabelCache;
  /** Injected so the service stays deterministic under test. */
  now?: () => string;
  /** Search fallback is off unless explicitly enabled (Q3 = B). */
  allowSearchFallback?: boolean;
}

export class LabelEnrichmentService {
  readonly #client: MusicBrainzClient;
  readonly #cache: LabelCache;
  readonly #now: () => string;
  readonly #allowSearchFallback: boolean;

  constructor(options: LabelEnrichmentOptions) {
    this.#client = options.client;
    this.#cache = options.cache;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#allowSearchFallback = options.allowSearchFallback ?? true;
  }

  /**
   * Resolve the release-level label for a track, using the cache when it is still fresh.
   *
   * Returns the resolution actually used — cached or newly appended — so the caller can record
   * which version its verdict came from (BR-13.4).
   */
  async resolveRelease(
    track: TrackContext,
    priority: Priority = 'low',
  ): Promise<LabelResolution | null> {
    if (track.isrc === null) return null;

    const now = this.#now();
    const cached = this.#cache.getRelease(track.isrc);
    if (cached !== null && this.#cache.isFresh(cached, now)) return cached;

    const resolution = await this.#resolveReleaseFromUpstream(track, now, priority);
    const id = this.#cache.putRelease(resolution);
    return { ...resolution, id, supersedesId: cached?.id ?? null };
  }

  async #resolveReleaseFromUpstream(
    track: TrackContext,
    now: string,
    priority: Priority,
  ): Promise<NewLabelResolution> {
    const isrc = track.isrc!;

    const empty = (status: ResolutionStatus, matchMethod: 'isrc' | 'search' | 'none') => ({
      isrc,
      recordingMbid: null,
      matchMethod,
      narrowingTier: 'none' as const,
      releaseCount: 0,
      resolvedAt: now,
      status,
      candidates: [],
      votes: [],
    });

    let recordingMbid: string | null;
    let matchMethod: 'isrc' | 'search' = 'isrc';

    try {
      ({ recordingMbid } = await this.#client.lookupRecordingByIsrc(isrc, priority));
    } catch (error) {
      // A 404 is an ANSWER about the catalogue; anything else is a fact about the network, and
      // the two must stay separable or the coverage gap fills with transport noise (BR-10.2).
      if (error instanceof MusicBrainzError && error.kind === 'not-found') {
        recordingMbid = null;
      } else {
        return empty('error', 'none');
      }
    }

    // Search fallback, deliberately almost never firing: `score` does not rank correctness, so
    // the client only returns a hit on count == 1 plus an exact normalised match.
    if (recordingMbid === null && this.#allowSearchFallback) {
      try {
        recordingMbid = await this.#client.searchRecording(track.artistName, track.title, priority);
        if (recordingMbid !== null) matchMethod = 'search';
      } catch {
        recordingMbid = null;
      }
    }

    if (recordingMbid === null) return empty('not-found', 'none');

    let releases;
    try {
      releases = await this.#client.listReleasesForRecording(recordingMbid, priority);
    } catch (error) {
      if (error instanceof MusicBrainzError && error.kind === 'not-found') {
        return { ...empty('not-found', matchMethod), recordingMbid };
      }
      return { ...empty('error', matchMethod), recordingMbid };
    }

    const narrowed = narrowReleases(releases, track.albumName, track.releaseDate);
    const classification = classify(narrowed.candidates, {
      majorRoots: MAJOR_ROOTS,
      narrowingTier: narrowed.tier,
      isrcVote: isrcPrefixVote(isrc),
    });

    return {
      isrc,
      recordingMbid,
      matchMethod,
      narrowingTier: narrowed.tier,
      releaseCount: narrowed.releaseCount,
      resolvedAt: now,
      status: 'resolved',
      candidates: narrowed.candidates,
      votes: classification.votes,
    };
  }

  /**
   * Resolve the artist-level label through the exact Spotify-URL join.
   *
   * ⚠️ **Answers a different question from the release level and is never merged with it** (Q12).
   * Token — *Full Bag* is `Never Too Different` (independent) at release level and `Atlantic` at
   * artist level. Both are true: an Atlantic artist releasing this one independently.
   */
  async resolveArtist(
    spotifyArtistId: string,
    priority: Priority = 'low',
  ): Promise<ArtistLabelResolution | null> {
    const now = this.#now();
    const cached = this.#cache.getArtist(spotifyArtistId);
    if (cached !== null && this.#cache.isFresh(cached, now)) return cached;

    let artistMbid: string | null = null;
    let status: ResolutionStatus = 'resolved';
    let releases: Awaited<ReturnType<MusicBrainzClient['listReleasesForArtist']>> = [];

    try {
      artistMbid = await this.#client.lookupArtistBySpotifyId(spotifyArtistId, priority);
      if (artistMbid === null) {
        status = 'not-found';
      } else {
        releases = await this.#client.listReleasesForArtist(artistMbid, priority);
      }
    } catch (error) {
      status = error instanceof MusicBrainzError && error.kind === 'not-found' ? 'not-found' : 'error';
    }

    // Bootlegs and regional licensees inflate an artist's set and say nothing about a signing
    // (Slipknot picks up `Smokin' Cactus` and `Jigu Records` this way), so only official
    // releases vote at this level.
    const official = releases.filter((release) => release.status === null || release.status === 'Official');
    const candidates = official.flatMap((release) =>
      release.labels.map((label) => ({
        labelName: label.labelName,
        labelMbid: label.labelMbid,
        labelType: label.labelType,
        catalogNumber: label.catalogNumber,
        releaseId: release.releaseId,
        releaseTitle: release.title,
        releaseDate: release.date,
        releaseStatus: release.status,
      })),
    );

    const classification = classify(candidates, {
      majorRoots: MAJOR_ROOTS,
      narrowingTier: 'none',
      isrcVote: null,
      capConfidenceAt: 'medium',
    });

    const id = this.#cache.putArtist({
      spotifyArtistId,
      artistMbid,
      releaseCount: releases.length,
      namedLabelCount: new Set(candidates.map((c) => c.labelName)).size,
      resolvedAt: now,
      status,
      candidates,
      votes: classification.votes,
    });

    return {
      id,
      spotifyArtistId,
      artistMbid,
      releaseCount: releases.length,
      namedLabelCount: new Set(candidates.map((c) => c.labelName)).size,
      resolvedAt: now,
      status,
      supersedesId: cached?.id ?? null,
      candidates,
      votes: classification.votes,
    };
  }

  /**
   * Derive the as-of-play snapshot from a resolution.
   *
   * ⚠️ **Returns `null` for a transient failure**, and the caller must then write nothing.
   *
   * This is not a nicety. The snapshot is immutable once written (BR-8.4a), so recording
   * `unknown / error` would let **one network blip permanently mark a play as unresolvable** —
   * it would never re-enter the backfill work set, because that set is "plays with no verdict".
   * A transport failure is not an answer; the play stays `pending` and is retried.
   *
   * Found by running the real system against an unreachable endpoint: 21 plays were written as
   * `unknown / error` in a single sweep, and under BR-8.4a every one of them would have stayed
   * that way forever.
   */
  toSnapshot(resolution: LabelResolution | null, isrc: string | null): LabelSnapshot | null {
    if (resolution !== null && resolution.status === 'error') return null;

    if (resolution === null) {
      return {
        verdict: 'unknown',
        confidence: 'low',
        contested: false,
        labelNames: [],
        matchMethod: 'none',
        narrowingTier: 'none',
        unknownReason: isrc === null ? 'noIsrc' : 'notFound',
        resolutionId: null,
        classifierVersion: LABEL_CLASSIFIER_VERSION,
      };
    }

    const classification = classify(resolution.candidates, {
      majorRoots: MAJOR_ROOTS,
      narrowingTier: resolution.narrowingTier,
      isrcVote: isrcPrefixVote(resolution.isrc),
    });

    // Transport failures never reach here (they returned null above), so an `unknown` at this
    // point is a genuine finding about MusicBrainz's catalogue rather than about the network.
    const unknownReason: UnknownReason | null =
      classification.verdict !== 'unknown'
        ? null
        : (classification.unknownReason ?? 'notFound');

    return {
      verdict: classification.verdict,
      confidence: classification.confidence,
      contested: classification.contested,
      labelNames: classification.labelNames,
      matchMethod: resolution.matchMethod,
      narrowingTier: resolution.narrowingTier,
      unknownReason,
      resolutionId: resolution.id,
      classifierVersion: LABEL_CLASSIFIER_VERSION,
    };
  }

  /** Same rule as {@link toSnapshot}: a transient failure writes nothing. */
  toArtistSnapshot(resolution: ArtistLabelResolution | null): ArtistLabelSnapshot | null {
    if (resolution !== null && resolution.status === 'error') return null;

    if (resolution === null) {
      return { verdict: 'unknown', confidence: 'low', labelNames: [], resolutionId: null };
    }

    const classification = classify(resolution.candidates, {
      majorRoots: MAJOR_ROOTS,
      narrowingTier: 'none',
      isrcVote: null,
      capConfidenceAt: 'medium',
    });

    return {
      verdict: classification.verdict,
      confidence: classification.confidence,
      labelNames: classification.labelNames,
      resolutionId: resolution.id,
    };
  }
}
