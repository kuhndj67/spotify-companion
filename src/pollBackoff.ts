/**
 * The poll's response to Spotify refusing it (NFR-17: *handle Spotify 429 with `Retry-After`*). ⚙️ PURE.
 *
 * ## Why (2026-10-23)
 *
 * Spotify answered *"The app has exceeded its rate limits"* in two bursts (10-22 22:00Z for 10 min; 10-23 13:40Z for
 * 38+ min, still going when the container was stopped). The app kept polling every 3 s straight through both: about
 * 20 refused requests a minute against an app already over its limit, which can only lengthen the refusal. The
 * walk environment was running with the same Spotify app at the time, which is likely what crossed the limit; the
 * app still has to respond to the refusal properly whoever caused it.
 *
 * The refusal reaches us as TEXT from the connector (`McpToolError`), so Spotify's `Retry-After` header is not
 * visible on this path. Hence a fixed, growing schedule — and a `Retry-After` honoured whenever the text does carry
 * one (the direct Web API client puts it there: *"Rate limited by Spotify. Retry after 30s."*).
 *
 * ## The rule
 *
 * - A rate-limit refusal → wait 30 s, then 60 s, 2 min, 5 min, then 10 min per try (the cap), or Spotify's own
 *   `Retry-After` if it is longer. One request per wait, never a burst.
 * - ANY other outcome (a track, nothing playing, another error) → the normal interval at once. Recovering must never
 *   wait: a backoff that fails to exit is a silent recording outage (W-7's warning).
 * - Never shorter than the normal interval.
 */

/** The waits after the 1st, 2nd, 3rd… consecutive refusal; the last repeats. */
export const RATE_LIMIT_STEPS_MS: readonly number[] = [30_000, 60_000, 120_000, 300_000, 600_000];

/** Spotify's own words, as the connector relays them, and the Web API client's. */
export function isRateLimited(text: string): boolean {
  return /exceeded its rate limit|rate limit|too many requests|\b429\b/i.test(text);
}

/** A `Retry-After` carried in the text, in milliseconds; `null` when there is none. */
export function retryAfterMs(text: string): number | null {
  const m = /retry[- ]after:?\s*(\d+)\s*s?/i.exec(text);
  return m ? Number(m[1]) * 1000 : null;
}

export type PollResult = { readonly kind: 'ok' } | { readonly kind: 'error'; readonly text: string };

export interface BackoffState {
  /** Consecutive rate-limit refusals; 0 when not backing off. */
  readonly refusals: number;
}

export interface NextPoll {
  readonly state: BackoffState;
  /** How long after this poll STARTED the next one should start. */
  readonly delayMs: number;
  /** Set only while backing off: why, in words, for the indicator. */
  readonly backingOff: boolean;
}

export function nextPoll(
  state: BackoffState,
  result: PollResult,
  baseMs: number,
  steps: readonly number[] = RATE_LIMIT_STEPS_MS,
): NextPoll {
  if (result.kind === 'ok' || !isRateLimited(result.text)) {
    return { state: { refusals: 0 }, delayMs: baseMs, backingOff: false };
  }
  const refusals = state.refusals + 1;
  const step = steps.length === 0 ? baseMs : steps[Math.min(refusals, steps.length) - 1]!;
  return {
    state: { refusals },
    delayMs: Math.max(baseMs, step, retryAfterMs(result.text) ?? 0),
    backingOff: true,
  };
}
