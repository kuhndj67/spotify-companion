/**
 * Saved-track ("liked") status, and the grace window that catches a like made just after a track
 * ends (BR-9).
 *
 * ## Why a cached set rather than a membership check
 *
 * `GET /me/tracks/contains` returns **403** in Development Mode, while `GET /me/tracks` returns
 * 200 — the third confirmed instance of that pattern, after `/me/following/contains` and
 * `/artists/{id}`'s missing `genres`. Development Mode appears to block the membership-check
 * family generally while leaving list endpoints open. The workaround is always the same: fetch the
 * set once, cache it, resolve locally. 596 saved tracks is 12 requests at `limit=50`.
 *
 * ## ⚠️ `null` is not `false`, and here it cannot be fixed later
 *
 * Unlike an observation trail, liked state is **point-in-time**: if it is not captured when the
 * play happens, it is gone. If the set is unavailable the answer is `null` and the transition is
 * `unknown` (BR-9.5). Writing `false` in its place would record an *observed choice* that never
 * happened, in the dependent variable of the experiment.
 *
 * ## The grace window
 *
 * Liking often happens a beat *after* a track ends, especially if the user reaches for their
 * phone. Sampling exactly at the play boundary would record that as `kept-unliked` and lose the
 * strongest positive signal the Spotify API can yield.
 *
 * What makes the window safe rather than a guess is `added_at`: page 1 of `GET /me/tracks` carries
 * an exact timestamp, so a like is **provably** attributable to the play window rather than
 * inferred from ordering (BR-9.4).
 */

import type { SpotifyWebApiClient } from './webApiClient.js';

interface SavedTracksPage {
  items?: { added_at?: string; track?: { id?: string } }[];
  total?: number;
  next?: string | null;
}

export interface LikedSetCacheOptions {
  api: SpotifyWebApiClient;
  /** How long the cached set may be reused before a refresh. */
  ttlMs?: number;
  /** How long after a play closes to re-check for a late like. */
  graceMs?: number;
  now?: () => number;
  /** Injected so tests do not wait 30 real seconds. */
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}

/** A pending grace-window check, held so it can be flushed on shutdown (P-8). */
interface PendingCheck {
  playId: number;
  trackId: string;
  playStartedAt: string;
  likedAtStart: boolean | null;
  timer: { cancel: () => void };
  settle: (result: { likedAtEnd: boolean | null; likedAddedAt: string | null }) => void;
}

export class LikedSetCache {
  readonly #api: SpotifyWebApiClient;
  readonly #ttlMs: number;
  readonly #graceMs: number;
  readonly #now: () => number;
  readonly #schedule: (fn: () => void, ms: number) => { cancel: () => void };

  /** Track id → `added_at`. Absent means not liked *as of the last refresh*. */
  #saved = new Map<string, string>();
  #loadedAt = Number.NEGATIVE_INFINITY;
  #available = false;
  #refreshing: Promise<void> | null = null;
  #pending = new Set<PendingCheck>();

  constructor(options: LikedSetCacheOptions) {
    this.#api = options.api;
    this.#ttlMs = options.ttlMs ?? 15 * 60_000;
    this.#graceMs = options.graceMs ?? 30_000;
    this.#now = options.now ?? (() => Date.now());
    this.#schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        // Never hold the process open for a grace-window check.
        timer.unref?.();
        return { cancel: () => clearTimeout(timer) };
      });
  }

  get size(): number {
    return this.#saved.size;
  }

  /** False until a refresh has succeeded. While false, every answer is `null`. */
  get available(): boolean {
    return this.#available;
  }

  get pendingChecks(): number {
    return this.#pending.size;
  }

  /**
   * Fetch the saved-track set.
   *
   * On failure the previous set is **kept** rather than cleared: a stale answer from ten minutes
   * ago is far better than `null` for every play until the next refresh succeeds, and the values
   * this records cannot be recovered afterwards.
   */
  async refresh(): Promise<void> {
    this.#refreshing ??= this.#doRefresh().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #doRefresh(): Promise<void> {
    const next = new Map<string, string>();

    try {
      const limit = 50;
      for (let offset = 0; ; offset += limit) {
        const page = await this.#api.get<SavedTracksPage>('/me/tracks', {
          limit: String(limit),
          offset: String(offset),
        });
        if (page === null) break;

        const items = page.items ?? [];
        for (const item of items) {
          if (item.track?.id) next.set(item.track.id, item.added_at ?? '');
        }
        if (items.length < limit || page.next === null) break;
      }

      this.#saved = next;
      this.#loadedAt = this.#now();
      this.#available = true;
    } catch {
      // Deliberately swallowed and left unavailable-but-stale. A liked status is enrichment;
      // it must never take down recording or the display (NFR-18).
      if (this.#saved.size === 0) this.#available = false;
    }
  }

  async ensureFresh(): Promise<void> {
    if (this.#now() - this.#loadedAt < this.#ttlMs) return;
    await this.refresh();
  }

  /**
   * Is this track liked?
   *
   * **`null` means unknown**, and is returned whenever the set has never loaded. It is never
   * `false` in that case — see the header.
   */
  isLiked(trackId: string): boolean | null {
    if (!this.#available) return null;
    return this.#saved.has(trackId);
  }

  /** `added_at` for a liked track, which is what makes attribution provable. */
  addedAt(trackId: string): string | null {
    return this.#saved.get(trackId) ?? null;
  }

  /**
   * Sample at play close, then re-check after the grace window.
   *
   * Resolves once, with the final answer. The caller amends the play row exactly once (BR-9.2).
   */
  captureAtClose(
    playId: number,
    trackId: string,
    playStartedAt: string,
    likedAtStart: boolean | null,
  ): Promise<{ likedAtEnd: boolean | null; likedAddedAt: string | null }> {
    const immediate = this.isLiked(trackId);

    // Already liked at close, or we cannot tell — either way the window adds nothing.
    if (immediate === true || immediate === null) {
      return Promise.resolve({
        likedAtEnd: immediate,
        likedAddedAt: immediate === true ? this.addedAt(trackId) : null,
      });
    }

    return new Promise((resolve) => {
      const check: PendingCheck = {
        playId,
        trackId,
        playStartedAt,
        likedAtStart,
        timer: this.#schedule(() => void this.#settle(check), this.#graceMs),
        settle: resolve,
      };
      this.#pending.add(check);
    });
  }

  /**
   * Re-check page 1 and attribute by `added_at`.
   *
   * A like counts for this play only if its `added_at` falls **at or after the play's start**
   * (BR-9.4). Without that test, a track liked last week and re-surfacing in page 1 would be
   * credited to the play that just ended.
   */
  async #settle(check: PendingCheck): Promise<void> {
    this.#pending.delete(check);

    try {
      const page = await this.#api.get<SavedTracksPage>('/me/tracks', {
        limit: '50',
        offset: '0',
      });

      for (const item of page?.items ?? []) {
        if (item.track?.id !== check.trackId) continue;

        const addedAt = item.added_at ?? null;
        const attributable =
          addedAt !== null && Date.parse(addedAt) >= Date.parse(check.playStartedAt);

        if (attributable) {
          this.#saved.set(check.trackId, addedAt);
          check.settle({ likedAtEnd: true, likedAddedAt: addedAt });
          return;
        }
      }

      check.settle({ likedAtEnd: false, likedAddedAt: null });
    } catch {
      // The window could not be checked. `null`, not `false` — we did not observe a choice.
      check.settle({ likedAtEnd: null, likedAddedAt: null });
    }
  }

  /**
   * Complete every outstanding grace-window check now (Q7 = C).
   *
   * Called on graceful shutdown, which covers the ordinary Ctrl-C and restart cases without
   * persisting durable state for a 30-second interval. An ungraceful kill loses at most one
   * `liked-during` upgrade on one play.
   */
  async flushPending(): Promise<void> {
    const outstanding = [...this.#pending];
    for (const check of outstanding) check.timer.cancel();
    await Promise.all(outstanding.map((check) => this.#settle(check)));
  }
}
