/**
 * The MusicBrainz HTTP client.
 *
 * Knows the shape of the API and nothing about scheduling — every call goes through
 * {@link RequestQueue}, which is the only thing that enforces NFR-15.
 *
 * ## ⚠️ The two-call chain must stay two calls (BR-1.2)
 *
 * The obvious first attempt — `GET /ws/2/isrc/{isrc}?inc=releases` — returns **200 with the `inc`
 * parameter silently ignored**. Not an error, not a warning: the parameter is dropped and the
 * response contains recordings and no releases.
 *
 * Nineteen ISRCs came back looking like "MusicBrainz has no releases for anything I listen to",
 * which was false. It read as a coverage finding rather than a bug, and was caught only by
 * checking a recording *known* to have 44 releases.
 *
 * **A wrong request shape is indistinguishable from absent data.** This is the fourth
 * documentation-vs-reality catch in this project and the first where the wrong answer was
 * *plausible* rather than an error code. Folding the chain back into one call would reintroduce
 * it, and no test asserting "no releases" would notice.
 *
 * ## The artist join is exact, and that is why it is safe
 *
 * MusicBrainz stores streaming links as first-class `url` entities, so the Spotify artist ID the
 * app already holds is a **direct key** — no name matching, no `score`. MusicBrainz holds three
 * artists named `Prof`; the join returns the right one by construction.
 *
 * ## Search is the opposite, and is therefore nearly disabled
 *
 * For Ren's *Starry Night Act III* the top **two** hits scored 100 and were different recordings,
 * while the near-correct one scored 95. **`score` does not rank correctness.** Search is used only
 * on a single unambiguous exact match (BR-1.5, Q3 = B), and every row records which method found
 * it so searched matches can be excluded from analysis without re-deriving them.
 */

import { ThrottledError, type Priority, type RequestQueue } from './RequestQueue.js';
import type { ReleaseSummary } from './releaseNarrowing.js';
import { normaliseIsrc } from './isrcPrefix.js';
import { normaliseTitle } from './releaseNarrowing.js';

/** Distinguishes a fact about MusicBrainz's catalogue from a fact about the network. */
export type MusicBrainzFailureKind = 'not-found' | 'throttled' | 'timeout' | 'malformed' | 'network';

export class MusicBrainzError extends Error {
  constructor(
    readonly kind: MusicBrainzFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'MusicBrainzError';
  }
}

export interface MusicBrainzClientOptions {
  queue: RequestQueue;
  /**
   * The contact address NFR-14 requires. Read from `secrets/`, never committed.
   * U7 (BR-57.4): may be a GETTER, so a contact saved in Settings applies to the next request without a restart.
   */
  userAgent: string | (() => string);
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * Attempts per request before giving up (P-4, Q2 = D). Each attempt goes back through the
   * queue, so retrying never raises the request rate.
   */
  maxAttempts?: number;
  /** Extra delay before a retry, doubled each time. On top of the queue's own spacing. */
  retryBackoffMs?: number;
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected for tests, so a backoff costs no real time. */
  sleep?: (ms: number) => Promise<void>;
}

interface RecordingLookup {
  recordingMbid: string | null;
}

export class MusicBrainzClient {
  readonly #queue: RequestQueue;
  readonly #userAgent: () => string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #retryBackoffMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: MusicBrainzClientOptions) {
    this.#queue = options.queue;
    const ua = options.userAgent;
    this.#userAgent = typeof ua === 'function' ? ua : () => ua;
    this.#baseUrl = (options.baseUrl ?? 'https://musicbrainz.org/ws/2').replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#retryBackoffMs = options.retryBackoffMs ?? 2_000;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * One request, with **bounded retry** on transient failures (P-4, Q2 = D).
   *
   * Failures stay classified through the retry: `not-found` is a fact about the catalogue and is
   * cacheable, while `throttled` / `timeout` / `network` are facts about the network on a
   * particular Tuesday. Both render as `unknown` to a reader, but folding the second into the
   * first would inflate the apparent coverage gap with transport noise — and that gap is the
   * measurement R2 depends on (BR-10.2).
   *
   * ## Why this is not optional, measured
   *
   * A live run over the 19 real ISRCs at 1.2 s spacing — wider than the 1 req/sec policy floor,
   * and the same spacing an earlier research probe used without rejection — still took a `503`
   * on **6 of 19** tracks. Without a retry each one became an `error` resolution, so a third of
   * the corpus failed on a single pass for reasons that had nothing to do with MusicBrainz's
   * catalogue.
   *
   * That matters beyond convenience: `error` and `notFound` are meant to say different things
   * about coverage (BR-10.2), and a transport failure rate that high would swamp the coverage
   * signal R2 is measured with.
   *
   * ⚠️ **Each attempt goes back through the queue**, so retrying never raises the request rate —
   * it only spends more time. The backoff is *additional* delay on top of the queue's spacing,
   * and the queue's own pause-after-repeated-`503`s (P-4) still applies on top of both.
   */
  async #request<T>(path: string, params: Record<string, string>, priority: Priority): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await this.#attempt<T>(path, params, priority);
      } catch (error) {
        lastError = error;

        // A 404 is an ANSWER, not a failure. Retrying it would waste the only budget there is
        // and could not change the outcome.
        const retryable =
          error instanceof ThrottledError ||
          (error instanceof MusicBrainzError &&
            (error.kind === 'timeout' || error.kind === 'network'));

        if (!retryable || attempt === this.#maxAttempts) throw error;

        await this.#sleep(this.#retryBackoffMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  }

  async #attempt<T>(path: string, params: Record<string, string>, priority: Priority): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`);
    url.searchParams.set('fmt', 'json');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    return this.#queue.enqueue(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

      let response: Response;
      try {
        response = await this.#fetch(url, {
          headers: { 'User-Agent': this.#userAgent(), Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        throw new MusicBrainzError(
          aborted ? 'timeout' : 'network',
          aborted ? `Timed out after ${this.#timeoutMs}ms: ${path}` : `Network failure: ${String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 404) {
        throw new MusicBrainzError('not-found', `Not found: ${path}`);
      }

      // MusicBrainz signals rate-limit rejection with 503, not 429. ThrottledError is what the
      // queue watches for, so this is the one failure that can stop the whole queue.
      if (response.status === 503) {
        throw new ThrottledError(`MusicBrainz returned 503 for ${path}`);
      }

      if (!response.ok) {
        throw new MusicBrainzError('network', `HTTP ${response.status} for ${path}`);
      }

      try {
        return (await response.json()) as T;
      } catch {
        // Never parsed optimistically. A 200 carrying something unexpected is a malformed
        // response, not an empty result — the distinction is the whole lesson of the `inc=` bug.
        throw new MusicBrainzError('malformed', `Unparseable response for ${path}`);
      }
    }, priority);
  }

  /**
   * Step 1 of the chain: ISRC → recording MBID.
   *
   * ⚠️ **No `inc` parameter.** Passing `inc=releases` here returns 200 with the parameter
   * silently dropped, which looks exactly like a recording that has no releases.
   */
  async lookupRecordingByIsrc(isrc: string, priority: Priority = 'low'): Promise<RecordingLookup> {
    const body = await this.#request<{ recordings?: { id?: string }[] }>(
      `/isrc/${encodeURIComponent(normaliseIsrc(isrc))}`,
      {},
      priority,
    );

    const recordings = body.recordings ?? [];
    return { recordingMbid: recordings[0]?.id ?? null };
  }

  /**
   * Step 2 of the chain: recording MBID → releases with their labels.
   *
   * This is the call where `inc=labels` actually works, and it is the reason the chain cannot be
   * collapsed into step 1.
   */
  async listReleasesForRecording(
    recordingMbid: string,
    priority: Priority = 'low',
  ): Promise<ReleaseSummary[]> {
    const body = await this.#request<{ releases?: RawRelease[] }>(
      '/release',
      { recording: recordingMbid, inc: 'labels', limit: '100' },
      priority,
    );
    return (body.releases ?? []).map(toReleaseSummary);
  }

  /**
   * The exact Spotify → MusicBrainz artist join.
   *
   * `GET /url?resource=https://open.spotify.com/artist/{id}&inc=artist-rels` — the Spotify ID we
   * already hold is a direct key, so there is none of the misattribution hazard that makes search
   * unsafe. Returns `null` when MusicBrainz has no link for the artist, which is an answer.
   */
  async lookupArtistBySpotifyId(
    spotifyArtistId: string,
    priority: Priority = 'low',
  ): Promise<string | null> {
    const body = await this.#request<{ relations?: { artist?: { id?: string } }[] }>(
      '/url',
      {
        resource: `https://open.spotify.com/artist/${spotifyArtistId}`,
        inc: 'artist-rels',
      },
      priority,
    );

    for (const relation of body.relations ?? []) {
      if (relation.artist?.id) return relation.artist.id;
    }
    return null;
  }

  /**
   * An artist's genres.
   *
   * ⚠️ **`inc=genres`, not `inc=tags`.** They look interchangeable and are not: `tags` is the raw
   * free-text folksonomy and carries non-genre noise — a live probe returned `supergroup` for
   * Audioslave and `2008 universal fire victim` for Dolly Parton. `genres` is the curated subset
   * MusicBrainz has mapped to actual genre entities.
   *
   * The vote `count` is kept rather than discarded: it separates a genre four people agree on
   * from one person's opinion, and U3's rules will want to threshold on it.
   */
  async lookupArtistGenres(
    artistMbid: string,
    priority: Priority = 'low',
  ): Promise<{ name: string; count: number }[]> {
    const body = await this.#request<{ genres?: { name?: string; count?: number }[] }>(
      `/artist/${encodeURIComponent(artistMbid)}`,
      { inc: 'genres' },
      priority,
    );

    return (body.genres ?? [])
      .filter((genre): genre is { name: string; count?: number } => typeof genre.name === 'string')
      .map((genre) => ({ name: genre.name, count: genre.count ?? 0 }))
      // Most-agreed first, so a display that truncates keeps the useful ones.
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /**
   * Search fallback — deliberately almost never fires.
   *
   * Returns a recording MBID **only** when there is exactly one hit *and* its artist and title
   * match exactly after normalisation (Q3 = B). Anything else returns `null`.
   *
   * The Ren case is the argument: two hits scored 100 and were different recordings, and the
   * near-correct one scored 95. Any threshold rule will occasionally be **confidently wrong**, and
   * a wrong label is invisible downstream while `unknown` is counted.
   */
  async searchRecording(
    artist: string,
    title: string,
    priority: Priority = 'low',
  ): Promise<string | null> {
    const query = `artist:"${escapeLucene(artist)}" AND recording:"${escapeLucene(title)}"`;
    const body = await this.#request<{
      count?: number;
      recordings?: { id?: string; title?: string; 'artist-credit'?: { name?: string }[] }[];
    }>('/recording', { query, limit: '5' }, priority);

    const recordings = body.recordings ?? [];

    // `count` is the total MusicBrainz found, not the page size. More than one means ambiguity,
    // and ambiguity here is what produced a confidently wrong track.
    if ((body.count ?? recordings.length) !== 1 || recordings.length !== 1) return null;

    const hit = recordings[0]!;
    const hitArtist = hit['artist-credit']?.[0]?.name ?? '';
    const titlesMatch = normaliseTitle(hit.title ?? '') === normaliseTitle(title);
    const artistsMatch = normaliseTitle(hitArtist) === normaliseTitle(artist);

    return titlesMatch && artistsMatch ? (hit.id ?? null) : null;
  }
}

interface RawRelease {
  id?: string;
  title?: string;
  date?: string;
  status?: string;
  'label-info'?: {
    'catalog-number'?: string | null;
    label?: { id?: string; name?: string; type?: string | null } | null;
  }[];
}

function toReleaseSummary(release: RawRelease): ReleaseSummary {
  const labels = (release['label-info'] ?? [])
    .filter((info) => info.label?.name)
    .map((info) => ({
      labelName: info.label!.name!,
      labelMbid: info.label!.id ?? null,
      labelType: (info.label!.type ?? null) as ReleaseSummary['labels'][number]['labelType'],
      catalogNumber: info['catalog-number'] ?? null,
    }));

  return {
    releaseId: release.id ?? '',
    title: release.title ?? null,
    date: release.date ?? null,
    status: release.status ?? null,
    labels,
  };
}

/** Lucene special characters, escaped so a title containing them cannot alter the query. */
function escapeLucene(value: string): string {
  return value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}
