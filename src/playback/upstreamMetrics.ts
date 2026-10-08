/**
 * How hard this app leans on Spotify and MusicBrainz (LC-28, M1–M4). 🔌 recording shell, ⚙️ pure
 * aggregation.
 *
 * ## ⚠️ Why this exists: the question could not be answered at all
 *
 * The user asked whether the app has a *"light touch"* on the vendor APIs, and whether a reasonable
 * rate could be determined. **Neither was answerable**, because nothing counted requests.
 * `webApiClient.ts` throws on a 429 with the `Retry-After` **inside a message string** and records
 * nothing — so the app had no idea whether it had ever been rate-limited.
 *
 * ⚠️ **The metric is the prerequisite for the research, not a parallel task.**
 *
 * ## What is and is not knowable about a "reasonable" rate
 *
 *   - **MusicBrainz publishes one**: 1 req/sec sustained with an identifying `User-Agent`. We comply
 *     (NFR-14/15) — and have already probed *tighter* than the published floor, since 6 of 19 tracks
 *     took a `503` at 1200 ms spacing.
 *   - **Spotify publishes no number at all**, only that limiting is calculated in rolling 30-second
 *     windows and differs by app mode. So *"what is reasonable"* is **not derivable from
 *     documentation**, and this project has drawn six wrong conclusions from those docs already.
 *
 * ⚠️ **A clean 429 counter bounds nothing except "below the limit".** Same logic as the hypothesis
 * gate's CI ruling out ±8pp *and nothing smaller*. **Do not read zero rate-limit hits as headroom.**
 *
 * ## ⚠️ The measured shape, and why M4 outgrew its brief
 *
 * Measured 2026-09-30: the 3-second poll is **1,200 of ~1,220 requests/hour — 98.4%**. Everything else
 * is already light, and Development Mode is why: the `/contains` family returning 403 forced *fetch the
 * set once, cache it, resolve locally*, so follow and liked status cost **zero** per-track requests.
 *
 * **M4 — the share of polls returning nothing playing — is the POSITIVE LIVENESS SIGNAL.** It
 * distinguishes *polling and hearing silence* from *not polling at all*. The 2026-09-30 outage ran ~13
 * hours unnoticed for exactly want of it, because *"no new rows"* is ambiguous in both directions.
 * ⚠️ **It makes the state visible; it does not alert.** A monitor cannot live in the container when the
 * failure mode is *the container is not running*.
 *
 * ## ⚠️ U7 (P-55, BR-58.3): a poll has THREE outcomes, and the field is a SHARE
 *
 * Until U7 a poll was a boolean, and that is how both halves of one defect happened: a Spotify error that arrived
 * as **text** was counted as *playing* (F5 — confirmed live by probe P-U7-3), and a *thrown* MCP error was counted
 * as *idle* (F6). So **historic M4 figures mixed both** (BR-58.6); none were used to conclude anything (W-7 not
 * started). Now `idleShare = idle ÷ (playing + idle)` and errors are counted on their own.
 *
 * The field was also renamed. `pollsReturningNothingPlaying` held a **share** but read as a **count**, and was
 * misread exactly that way on 2026-10-08 while checking the app after a reboot.
 */

import { RULE_SKIP_WINDOW_MS } from './types.js';

export type Upstream = 'spotify' | 'musicbrainz' | 'mcp';

/** What one poll of the now-playing surface found (P-55). An error is neither playing nor idle. */
export type PollOutcome = 'playing' | 'idle' | 'error';

/**
 * The one place a now-playing snapshot becomes a poll outcome (P-55, PBT-65). Structural, so this pure module
 * need not import the impure poll service: an error snapshot carries `error`, a playing one `playing: true`.
 * ⚠️ `error` is checked FIRST — that ordering is the fix for F5/F6.
 */
export function pollOutcomeOf(snapshot: object): PollOutcome {
  if ('error' in snapshot) return 'error';
  return (snapshot as { playing?: unknown }).playing === true ? 'playing' : 'idle';
}

/** What became of one request, for M2. */
export type RequestOutcome = 'ok' | 'rate-limited' | 'error';

/** One recorded request. ⚠️ Kept as observations so the judgements below can be re-derived. */
interface Record_ {
  readonly upstream: Upstream;
  readonly outcome: RequestOutcome;
  readonly atMs: number;
  readonly retryAfterMs: number | null;
}

/** Spotify's own accounting window, which is why M1 reports in it. */
export const SPOTIFY_WINDOW_MS = 30_000;

/**
 * How long records are kept.
 *
 * ⚠️ **Bounded on purpose.** This is an in-memory ring, not a table: a counter that grew for the
 * lifetime of the process would be a slow leak in the one component meant to prove the app is
 * well-behaved. One hour covers both reporting windows with room to spare.
 */
const RETENTION_MS = RULE_SKIP_WINDOW_MS;

export interface UpstreamSnapshot {
  readonly perUpstream: Readonly<
    Record<Upstream, {
      /** ⚠️ Spotify's OWN window. An hourly mean hides exactly the burst that would trip a limit. */
      readonly rolling30s: number;
      readonly perHour: number;
      /** ⚠️ M2: COUNTED, not logged. See the note on `record`. */
      readonly rateLimitHits: number;
      readonly errors: number;
      readonly lastRetryAfterMs: number | null;
      readonly lastRateLimitedAtMs: number | null;
    }>
  >;
  /** M3: the efficiency ratio — requests per play, the *"light touch"* measure. */
  readonly requestsPerPlay: number | null;
  /**
   * M4: the positive liveness signal — a SHARE in [0, 1], `idle ÷ (playing + idle)`. `null` until a poll
   * that was not an error has been recorded: a run of nothing but errors is not "100% idle", it is unknown.
   */
  readonly idleShare: number | null;
  readonly pollsTotal: number;
  readonly pollsIdle: number;
  /** ⚠️ Counted apart from the share: a credential outage must not read as listening silence. */
  readonly pollsError: number;
}

export class UpstreamMetrics {
  #records: Record_[] = [];
  #polls = 0;
  #pollsIdle = 0;
  #pollsError = 0;
  #plays = 0;

  /**
   * Record one upstream request.
   *
   * ⚠️ **M2 COUNTS, it does not log.** A failure written to stdout and never aggregated is the
   * `successor_lag_ms` shape: that column was `null` on all 662 rows for its entire life because the two
   * methods meant to write it had no callers, and a structurally empty field reads as *this never
   * happens*. The 2026-09-30 measurement had to reconstruct successor lag from retained trails because
   * the field designed to hold it was never wired.
   */
  record(
    upstream: Upstream,
    outcome: RequestOutcome,
    atMs: number,
    retryAfterMs: number | null = null,
  ): void {
    this.#records.push({ upstream, outcome, atMs, retryAfterMs });
    this.#prune(atMs);
  }

  /** One poll of the now-playing surface (P-55). */
  recordPoll(outcome: PollOutcome): void {
    this.#polls += 1;
    if (outcome === 'idle') this.#pollsIdle += 1;
    if (outcome === 'error') this.#pollsError += 1;
  }

  /** One play recorded, for M3's denominator. */
  recordPlay(): void {
    this.#plays += 1;
  }

  /**
   * ⚠️ **Takes `now` as a parameter**, like `playStats.ts` and `safetyCounters.ts`. A rolling window
   * anchored on an ambient clock is untestable at exactly the boundary that goes wrong.
   */
  snapshot(nowMs: number): UpstreamSnapshot {
    this.#prune(nowMs);

    const blank = () => ({
      rolling30s: 0,
      perHour: 0,
      rateLimitHits: 0,
      errors: 0,
      lastRetryAfterMs: null as number | null,
      lastRateLimitedAtMs: null as number | null,
    });

    const per: Record<Upstream, ReturnType<typeof blank>> = {
      spotify: blank(),
      musicbrainz: blank(),
      mcp: blank(),
    };

    for (const r of this.#records) {
      const bucket = per[r.upstream];
      bucket.perHour += 1;
      // Half-open, like every other window in this project: `(now - w, now]`.
      if (r.atMs > nowMs - SPOTIFY_WINDOW_MS && r.atMs <= nowMs) bucket.rolling30s += 1;
      if (r.outcome === 'rate-limited') {
        bucket.rateLimitHits += 1;
        bucket.lastRetryAfterMs = r.retryAfterMs;
        bucket.lastRateLimitedAtMs = r.atMs;
      }
      if (r.outcome === 'error') bucket.errors += 1;
    }

    return {
      perUpstream: per,
      // ⚠️ `null` rather than 0 when there are no plays. A ratio with an empty denominator is not
      // "zero requests per play", it is unknown — and `null` is unknown, never 0.
      requestsPerPlay: this.#plays === 0 ? null : this.#records.length / this.#plays,
      idleShare: this.#polls - this.#pollsError === 0 ? null : this.#pollsIdle / (this.#polls - this.#pollsError),
      pollsTotal: this.#polls,
      pollsIdle: this.#pollsIdle,
      pollsError: this.#pollsError,
    };
  }

  #prune(nowMs: number): void {
    const floor = nowMs - RETENTION_MS;
    if (this.#records.length > 0 && this.#records[0]!.atMs <= floor) {
      this.#records = this.#records.filter((r) => r.atMs > floor);
    }
  }
}
