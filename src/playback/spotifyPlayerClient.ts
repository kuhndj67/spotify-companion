/**
 * The only thing in this codebase that issues a player command. 🔌 IMPURE (P-33)
 *
 * ## ⚠️ EXACTLY ONE METHOD, AND THAT IS THE PHASE BOUNDARY
 *
 * `skipToNext()`. No pause, no seek, no volume, no transfer-playback, no play.
 *
 * U4's guard was *`src/playback/` does not exist*. U5 ends that, and this method count is half of what
 * replaces it — the other half being that nothing in `src/rules/` imports `src/playback/`.
 *
 * ⚠️ **A general `PlayerClient` is how a skip-only unit acquires the ability to pause the user's
 * music.** Nothing in U5 needs it and no requirement asks for it, and an unused capability against a
 * live device is indistinguishable from an intended one the day someone calls it. **BR-30 already makes
 * this argument about a constructor parameter** — *"an injected-but-uncalled one reduces the boundary to
 * one line of restraint"* — and it applies unchanged to a method.
 *
 * ⚠️ **The one-method rule is asserted on this module's EXPORTED SHAPE, not via the orphan check.**
 * `test/noOrphanModules.test.ts` walks **modules, not methods**: `recordSuccessorLag` and
 * `updateSkipAttribution` had zero callers for their entire lives inside a heavily-executed file and
 * that check was satisfied throughout. **A second method here would be invisible to it.**
 *
 * ## ⚠️ It takes a token provider, not the Web API client
 *
 * Handing it `SpotifyWebApiClient` would give the one module that can act on the player a general
 * read-and-write surface onto Spotify. A function returning a bearer token is the whole dependency.
 */

import type { RefusalReason } from './types.js';

/**
 * What became of the request, classified by **P-30: did it reach the device?**
 *
 * ⚠️ This classification is the resolution of a real conflict. **NFR-17** says handle 429 with
 * `Retry-After`; **BR-43.5** says an unconfirmed skip is never retried. Honouring a 30-second
 * `Retry-After` and then issuing `next` is *"skip whatever is playing in 30 seconds"* — not the action
 * that was decided. FR-48 was written about **confirmation** and never contemplated **transport**.
 */
export type SkipOutcome =
  /** 2xx. The command reached the device; BR-43.3's confirmation decides whether it took effect. */
  | { readonly kind: 'issued' }
  /**
   * The request **provably did not reach the device**, for a reason that is not a defect. Nothing
   * happened, and nothing should be waited for.
   */
  | { readonly kind: 'refused'; readonly reason: RefusalReason; readonly detail: string }
  /**
   * ⚠️ **Landing UNKNOWN.** A 5xx, a network error, or anything unclassified. `null` is unknown and
   * unknown is not `false` — so this is treated as having landed, and is never retried.
   */
  | { readonly kind: 'failed'; readonly detail: string };

export type TokenProvider = () => Promise<string>;

/** ⚠️ The interface is one method wide, and the structural test pins that it stays so. */
export interface PlayerClient {
  skipToNext(): Promise<SkipOutcome>;
}

export class SpotifyPlayerClient implements PlayerClient {
  readonly #token: TokenProvider;
  readonly #invalidate: () => void;
  readonly #fetch: typeof fetch;

  /**
   * @param token      returns a bearer token
   * @param invalidate drops the cached token, so the 401 retry asks for a fresh one
   * @param fetchImpl  injected for tests; a real `POST` to a live device is not something a unit test
   *                   may do, and this is the only module in the project that could
   */
  constructor(token: TokenProvider, invalidate: () => void, fetchImpl: typeof fetch = fetch) {
    this.#token = token;
    this.#invalidate = invalidate;
    this.#fetch = fetchImpl;
  }

  /**
   * `POST /me/player/next`.
   *
   * ⚠️ **Fires on the reported track boundary, with no lag guard and no compensating delay**
   * (BR-43.1). Probe P-U5-1 measured the audio following the reported boundary within ~2 s, so a skip
   * there costs 2–3 s of the outgoing track — not the 18–41 s the design plan predicted. The original
   * hypothesis was backwards: the API never lagged, the DJ stops *playing* 18–50 s early and reports
   * that accurately.
   *
   * ⚠️ **No fixed offset is applied anywhere** (P-34). The DJ has at least three transition behaviours
   * and `dj-talk`'s audio lag is **negative**, so even the sign varies and nothing in the API predicts
   * which is coming. Compensating by an average would be wrong on at least one type.
   */
  async skipToNext(): Promise<SkipOutcome> {
    const url = 'https://api.spotify.com/v1/me/player/next';

    const attempt = async (token: string): Promise<Response> =>
      this.#fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

    let response: Response;
    try {
      response = await attempt(await this.#token());

      // ⚠️ ONE forced refresh and ONE retry on 401 — and this is NOT a retry of the skip.
      //
      // A 401 is rejected at the edge: the request provably never reached the player, so re-issuing
      // COMPLETES the first attempt rather than making a second one (P-30). The distinction matters
      // because BR-43.5 forbids retrying a skip, and a 401 is routine — the container refreshes its
      // token roughly hourly.
      if (response.status === 401) {
        this.#invalidate();
        response = await attempt(await this.#token());
      }
    } catch (error) {
      // Network failure. ⚠️ Did the request arrive? Unknown — so it counts as having landed.
      return { kind: 'failed', detail: describe(error) };
    }

    if (response.status >= 200 && response.status < 300) return { kind: 'issued' };

    // ⚠️ 429: the edge refused it, so nothing happened — but `Retry-After` is DELIBERATELY NOT
    // honoured. By the time it elapsed, the track would have changed, and skipping then is a different
    // action from the one that was decided. The reason is kept distinct from our own hourly cap:
    // conflating them would make the runaway halt's evidence unreadable.
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') ?? 'unknown';
      return {
        kind: 'refused',
        reason: 'upstream-rate-limited',
        detail: `Spotify returned 429; Retry-After ${retryAfter}s, deliberately not honoured`,
      };
    }

    // ⚠️ 404 is Spotify's "no active device" — the listener stopped playing between the drain's
    // play-open check and the POST. Benign and provable, so it is a refusal rather than a failure: in
    // the `failed` bucket it would read as a defect every time someone pressed stop.
    if (response.status === 404) {
      return {
        kind: 'refused',
        reason: 'no-active-device',
        detail: 'Spotify reports no active device — playback had already stopped',
      };
    }

    // 403 on this endpoint usually means a missing scope, and the hint matters: Development Mode has
    // already produced six wrong conclusions in this project by failing in misleading ways.
    const detail = await response.text().catch(() => '');
    const hint =
      response.status === 403
        ? ' A 403 here usually means the user-modify-playback-state scope is missing — re-run `npm run auth`.'
        : '';
    return {
      kind: 'failed',
      detail: `POST /me/player/next failed (${response.status}).${hint} ${detail.slice(0, 300)}`.trim(),
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
