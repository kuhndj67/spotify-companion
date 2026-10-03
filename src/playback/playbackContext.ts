/**
 * Fetch the playback context Spotify reports, which the MCP surface does not expose. 🔌 IMPURE
 *
 * BR-41.1/41.2. `GET /me/player/currently-playing` returns a `context`; the MCP `getNowPlaying` the poll
 * loop reads returns **none**. So `play.context_type` has been NULL on every live play since v1 and
 * populated only on backfilled rows — ⚠️ **the field was available exactly where the outcome variable
 * was not.** This closes that.
 *
 * ## ⚠️ Fetched ONCE PER TRACK, never per tick
 *
 * The poll runs every 3 seconds — **1,200 requests/hour, already 98.4% of this app's Spotify
 * footprint**. Adding a context fetch to each tick would **double** it, to collect a value that cannot
 * change within a single play.
 *
 * So the result is cached against the track id and re-fetched only when the track changes: **~16
 * requests/hour at the median play rate**, which is the same order as the per-track `GET /tracks/{id}`
 * enrichment already costs.
 *
 * ⚠️ **Caching longer would be wrong, not merely stale.** `context.uri` **goes stale on its own** — it
 * kept naming an album through 33 minutes of autoplay by other artists — so a cache that outlived the
 * track would compound an inaccuracy the field already has.
 *
 * ## ⚠️ EVIDENCE ONLY — and that is a rule, not a preference
 *
 * No rule field is exposed over context in U5 (BR-41.3/41.5). A rule over `context_uri` would classify
 * algorithmic placement as album playback, which is wrong **in the direction that hides what R1 is
 * about**. And `context_type` cannot identify the AI DJ in any case: the DJ and a radio station are both
 * `type: playlist` sharing the `37i9dQZF1E` prefix. The discriminator is whether the **queue** exposes
 * tracks, which is why FR-36 asks at runtime.
 *
 * ## ⚠️ A failure here must never cost a play
 *
 * Context is evidence about a play, not part of it. Every failure resolves to `null` — *unknown*, never
 * a guess — and recording continues. NFR-18: every upstream failure is partial data, never fatal.
 */

import type { Maybe } from '../rules/types.js';

export interface PlaybackContext {
  readonly contextType: Maybe<string>;
  readonly contextUri: Maybe<string>;
}

const ABSENT: PlaybackContext = { contextType: null, contextUri: null };

/** Just enough of the Web API client to ask one question. */
export interface ContextSource {
  get<T>(path: string): Promise<T | null>;
}

interface CurrentlyPlayingResponse {
  readonly context?: { readonly type?: string; readonly uri?: string } | null;
}

export class PlaybackContextCache {
  readonly #api: ContextSource;
  readonly #onRequest?: (outcome: 'ok' | 'error') => void;
  #trackId: string | null = null;
  #value: PlaybackContext = ABSENT;
  #inFlight: Promise<void> | null = null;

  /**
   * @param onRequest records the upstream call for M1/M2, so the footprint this module adds is
   *        **visible in the same place as the footprint it was weighed against**. A fetcher that was
   *        not counted would be exactly the blind spot `upstreamMetrics` exists to remove.
   */
  constructor(api: ContextSource, onRequest?: (outcome: 'ok' | 'error') => void) {
    this.#api = api;
    this.#onRequest = onRequest;
  }

  /** The context for `trackId`, as last fetched. `null` fields mean not yet known, or not knowable. */
  get(trackId: string): PlaybackContext {
    return this.#trackId === trackId ? this.#value : ABSENT;
  }

  /**
   * Fetch the context for `trackId` if it is not already cached.
   *
   * ⚠️ **Returns immediately when a fetch is already in flight for this track.** The poll is a 3-second
   * timer and a slow response would otherwise start a second request on the next tick, then a third —
   * turning one call per track into one per tick under exactly the conditions (a slow upstream) where
   * that is least welcome.
   *
   * ⚠️ **Never throws.** The caller is the poll loop.
   */
  async ensure(trackId: string): Promise<void> {
    if (this.#trackId === trackId) return;
    if (this.#inFlight !== null) return;

    this.#inFlight = (async () => {
      try {
        const body = await this.#api.get<CurrentlyPlayingResponse>('/me/player/currently-playing');
        this.#onRequest?.('ok');
        // ⚠️ A 204 (nothing playing) arrives as `null` from the client, and so does a 404. Both mean
        // *no context*, which is `null` rather than an error — the listener simply is not playing.
        this.#value = {
          contextType: body?.context?.type ?? null,
          contextUri: body?.context?.uri ?? null,
        };
        this.#trackId = trackId;
      } catch (error) {
        this.#onRequest?.('error');
        // ⚠️ `null`, and the track is NOT marked as fetched — so the next tick may retry. A failure that
        // poisoned the cache would record `unknown` for the whole play on one transient error.
        this.#value = ABSENT;
        console.error(
          `[context] could not read playback context: ${
            error instanceof Error ? error.message : String(error)
          }. Recording null (unknown), which is correct rather than a guess.`,
        );
      } finally {
        this.#inFlight = null;
      }
    })();

    await this.#inFlight;
  }
}
