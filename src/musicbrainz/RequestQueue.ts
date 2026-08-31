/**
 * The single serialised request queue (NFR-15, BR-7.1, NFR Design P-1 and P-4).
 *
 * ## Why this exists at all
 *
 * MusicBrainz is free, unauthenticated and community-run. Its rate limit is **policy**, not
 * enforcement — there is no API key, so there is no per-key throttle to absorb a mistake. Being
 * blocked would take out the entire unit rather than degrade it. **Self-restraint is the only
 * control**, and this class is where it lives.
 *
 * **A single instance is a correctness property, not a convention.** Two independently-correct
 * limiters still emit two requests per second. There is no path from any component to
 * `MusicBrainzClient` except through here.
 *
 * ## Two priority classes, and priority means ordering only
 *
 * Backfill has real volume — dozens of unresolved ISRCs at two calls each, plus artist joins.
 * Under strict FIFO the track playing *right now* queues behind all of it and its label arrives
 * minutes late, showing the user a `pending` panel that never settles.
 *
 * ⚠️ **Priority selects order, never rate.** A `HIGH` item waits its turn in the 1 req/sec cadence
 * like everything else. A priority that bypassed the limiter would defeat NFR-15 exactly when the
 * app is busiest, which is precisely when the policy matters.
 *
 * ## The pause is not per-request backoff
 *
 * On repeated `503`s the **whole queue stops**. Per-request retry gets this backwards: it
 * *increases* pressure exactly when the service is signalling overload. A client that keeps
 * requesting through a `503` is the one that gets blocked.
 *
 * A pause leaves work **queued**, never answered. Nothing becomes `unknown` because the queue was
 * busy — that would corrupt the coverage metric R2 is measured with (BR-7.7).
 */

export type Priority = 'high' | 'low';

export interface RequestQueueOptions {
  /**
   * Minimum spacing between request *starts*. Not configurable from the environment on purpose
   * (Infrastructure Design Q4): there is no legitimate value other than ~1 req/sec, so a setting
   * would exist only to violate NFR-15 — most likely while debugging, and then forgotten.
   */
  minIntervalMs?: number;
  /** Consecutive throttle signals before the whole queue stops. */
  pauseAfterThrottles?: number;
  /** How long a pause lasts before work resumes. */
  pauseMs?: number;
  /** Injected so tests do not wait in real time. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Entry<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  priority: Priority;
  /** Insertion order, so equal priorities stay FIFO rather than depending on sort stability. */
  sequence: number;
}

/**
 * Thrown by a caller's `run` to tell the queue it was throttled.
 *
 * The queue does not inspect HTTP status codes — that is the client's job — but it does need to
 * know that a failure was a *throttle* rather than an ordinary error, because only throttles
 * should stop the whole queue.
 */
export class ThrottledError extends Error {
  constructor(message = 'Throttled by MusicBrainz (503)') {
    super(message);
    this.name = 'ThrottledError';
  }
}

export class RequestQueue {
  readonly #minIntervalMs: number;
  readonly #pauseAfterThrottles: number;
  readonly #pauseMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  #queue: Entry<unknown>[] = [];
  #running = false;
  #sequence = 0;
  #lastStartedAt = Number.NEGATIVE_INFINITY;
  #consecutiveThrottles = 0;
  #pausedUntil = 0;

  constructor(options: RequestQueueOptions = {}) {
    this.#minIntervalMs = options.minIntervalMs ?? 1_000;
    this.#pauseAfterThrottles = options.pauseAfterThrottles ?? 2;
    this.#pauseMs = options.pauseMs ?? 30_000;
    this.#now = options.now ?? (() => Date.now());
    this.#sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get depth(): number {
    return this.#queue.length;
  }

  /** True while the queue is stopped after repeated throttling. */
  get paused(): boolean {
    return this.#now() < this.#pausedUntil;
  }

  /**
   * Submit work. Resolves with the result, or rejects with whatever `run` threw.
   *
   * The returned promise is the caller's only handle — there is no way to jump the queue, and no
   * synchronous variant, because either would be a way to make a request without being counted.
   */
  enqueue<T>(run: () => Promise<T>, priority: Priority = 'low'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority,
        sequence: this.#sequence++,
      } as Entry<unknown>);
      void this.#drain();
    });
  }

  /** Highest priority first; within a priority, insertion order. */
  #take(): Entry<unknown> | undefined {
    if (this.#queue.length === 0) return undefined;

    let bestIndex = 0;
    for (let i = 1; i < this.#queue.length; i += 1) {
      const entry = this.#queue[i]!;
      const best = this.#queue[bestIndex]!;
      const better =
        (entry.priority === 'high' && best.priority !== 'high') ||
        (entry.priority === best.priority && entry.sequence < best.sequence);
      if (better) bestIndex = i;
    }
    return this.#queue.splice(bestIndex, 1)[0];
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;

    try {
      while (this.#queue.length > 0) {
        // A pause stops everything, not just the request that was throttled.
        const pauseRemaining = this.#pausedUntil - this.#now();
        if (pauseRemaining > 0) {
          await this.#sleep(pauseRemaining);
          continue;
        }

        // Spacing is measured from the previous request's START, so a slow response does not
        // earn the next one an immediate slot. MusicBrainz latency was measured at 0.1-6.7s;
        // spacing from completion would let a fast burst follow a slow one.
        const sinceLast = this.#now() - this.#lastStartedAt;
        if (sinceLast < this.#minIntervalMs) {
          await this.#sleep(this.#minIntervalMs - sinceLast);
          continue;
        }

        // Re-selected after every wait: a HIGH item that arrived while we were sleeping should
        // go first. Selecting before the wait would let a backfill sweep hold the slot it
        // claimed seconds ago against the track the user is looking at right now.
        const entry = this.#take();
        if (entry === undefined) break;

        this.#lastStartedAt = this.#now();

        try {
          const value = await entry.run();
          this.#consecutiveThrottles = 0;
          entry.resolve(value);
        } catch (error) {
          if (error instanceof ThrottledError) {
            this.#consecutiveThrottles += 1;
            if (this.#consecutiveThrottles >= this.#pauseAfterThrottles) {
              this.#pausedUntil = this.#now() + this.#pauseMs;
              this.#consecutiveThrottles = 0;
            }
          } else {
            // Only throttles count toward the pause. A malformed response or a parse failure
            // says nothing about whether the service wants us to slow down.
            this.#consecutiveThrottles = 0;
          }
          entry.reject(error);
        }
      }
    } finally {
      this.#running = false;
      // Work can arrive while the loop is unwinding; restart rather than stall.
      if (this.#queue.length > 0) void this.#drain();
    }
  }
}
