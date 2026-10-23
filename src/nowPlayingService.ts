/**
 * Polls the MCP server, attaches enrichment, and publishes changes.
 *
 * The browser no longer polls (Q5 selected WebSocket push). One backend loop drives all
 * connected clients, so load against Spotify is a function of time, not of how many tabs
 * are open. Spotify's Development Mode rate limits make that distinction worth keeping.
 *
 * Enrichment is fetched off the critical path: the track appears immediately, and the
 * enrichment panel fills in a moment later when the three Web API calls return. Results are
 * cached per track, so a 3-second poll of an unchanged track costs no Web API calls at all.
 */

import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { CredentialsDirectoryError, McpToolError, SpotifyMcpClient } from './mcp/spotifyMcpClient.js';
import type { NowPlaying } from './mcp/parseNowPlaying.js';
import type { EnrichmentService, Enrichment } from './spotify/enrichment.js';
import { nextPoll, RATE_LIMIT_STEPS_MS, type BackoffState, type PollResult } from './pollBackoff.js';

export type Snapshot =
  | { playing: false }
  | ({ playing: true; enrichment: Enrichment | null } & NowPlaying)
  | { error: string; detail: string };

/** BR-58.2: the reason shown on the Spotify indicator is bounded; the full text stays in `detail` and the log. */
const MAX_REASON_CHARS = 200;

function clip(text: string): string {
  return text.length <= MAX_REASON_CHARS ? text : `${text.slice(0, MAX_REASON_CHARS - 1)}…`;
}

/** Fields that mean "something actually changed", ignoring progress ticks. */
function signature(snapshot: Snapshot): string {
  if ('error' in snapshot) return `error:${snapshot.detail}`;
  if (!snapshot.playing) return 'idle';
  return [snapshot.trackId, snapshot.isPlaying, snapshot.device, snapshot.volume,
    snapshot.shuffle, snapshot.repeat, snapshot.enrichment ? 'enriched' : 'bare'].join('|');
}

export class NowPlayingService extends EventEmitter {
  #spotify: SpotifyMcpClient;
  #enrichment: EnrichmentService;
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  /** NFR-17: consecutive rate-limit refusals, and the waits (injectable so tests need not wait 30 s). */
  #backoff: BackoffState = { refusals: 0 };
  readonly #steps: readonly number[];
  #current: Snapshot = { playing: false };
  #lastSignature = '';

  constructor(spotify: SpotifyMcpClient, enrichment: EnrichmentService, options: { rateLimitStepsMs?: readonly number[] } = {}) {
    super();
    this.#steps = options.rateLimitStepsMs ?? RATE_LIMIT_STEPS_MS;
    this.#spotify = spotify;
    this.#enrichment = enrichment;
  }

  get current(): Snapshot {
    return this.#current;
  }

  #publish(snapshot: Snapshot): void {
    this.#current = snapshot;

    const next = signature(snapshot);
    if (next !== this.#lastSignature) {
      this.#lastSignature = next;
      this.emit('change', snapshot);
    }

    // Always emit a tick so clients can resynchronise progress and detect liveness.
    this.emit('tick', snapshot);
  }

  async #poll(): Promise<PollResult> {
    let snapshot: Snapshot;

    try {
      const nowPlaying = await this.#spotify.getNowPlaying();

      if (!nowPlaying) {
        this.#publish({ playing: false });
        return { kind: 'ok' };
      }

      const cached = nowPlaying.trackId ? this.#enrichment.get(nowPlaying.trackId) ?? null : null;
      snapshot = { playing: true, enrichment: cached, ...nowPlaying };
    } catch (error) {
      // FR-71 (BR-58.2): Spotify ANSWERED and refused — the MCP server is fine. Say so, with Spotify's reason,
      // rather than "could not reach", which would send the user looking at the wrong component.
      if (error instanceof McpToolError) {
        const result: PollResult = { kind: 'error', text: error.toolText };
        // NFR-17: a RATE-LIMIT refusal backs off (pollBackoff.ts). Logged when the wait changes, not every poll.
        const next = nextPoll(this.#backoff, result, config.pollIntervalMs, this.#steps);
        if (next.backingOff) {
          console.error(
            `[now-playing] Spotify is limiting this app (refusal ${next.state.refusals}): next try in ` +
              `${Math.round(next.delayMs / 1000)} s. Spotify said: ${error.toolText}`,
          );
          this.#publish({
            error: `Spotify is limiting this app's requests. Next try in ${Math.round(next.delayMs / 1000)} s.`,
            detail: error.toolText,
          });
        } else {
          console.error('[now-playing] Spotify returned an error:', error.toolText);
          this.#publish({ error: `Spotify returned an error: ${clip(error.toolText)}`, detail: error.toolText });
        }
        return result;
      }
      // U9 (P-68): the connector was deliberately NOT started -- the credentials mount cannot take a token refresh.
      // The message names the fix; "could not reach" would send the user looking at the connector.
      if (error instanceof CredentialsDirectoryError) {
        this.#publish({ error: clip(error.message), detail: error.message });
        return { kind: 'error', text: error.message };
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[now-playing] MCP call failed:', detail);
      this.#publish({ error: 'Could not reach the Spotify MCP server.', detail });
      return { kind: 'error', text: detail };
    }

    this.#publish(snapshot);

    // Fetch enrichment for a track we haven't seen, then republish with it attached. NOT awaited: the poll's
    // cadence must not wait on three Web API calls (with self-scheduled polls it would; `setInterval` never did).
    if (snapshot.playing && snapshot.trackId && !snapshot.enrichment) void this.#enrich(snapshot.trackId);
    return { kind: 'ok' };
  }

  async #enrich(trackId: string): Promise<void> {
    try {
      const enrichment = await this.#enrichment.fetch(trackId);
      const current = this.#current;
      // Guard against the track having changed while the lookup was in flight.
      if ('playing' in current && current.playing && current.trackId === trackId) {
        this.#publish({ ...current, enrichment });
      }
    } catch (error) {
      console.error('[enrichment] lookup failed:', error);
    }
  }

  /**
   * Polls now, then schedules each next poll from the last one's result (NFR-17, `pollBackoff.ts`): the normal
   * interval measured START to START, as `setInterval` kept it (the recording classifier depends on the gaps), or
   * the backoff wait while Spotify is refusing. One poll at a time.
   */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#loop();
  }

  stop(): void {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #loop(): void {
    const startedAt = Date.now();
    const poll = this.#poll().then((result) => {
      const wasBackingOff = this.#backoff.refusals > 0;
      const next = nextPoll(this.#backoff, result, config.pollIntervalMs, this.#steps);
      if (wasBackingOff && !next.backingOff) {
        console.log(`[now-playing] Spotify is answering again after ${this.#backoff.refusals} refused poll(s).`);
      }
      this.#backoff = next.state;
      return next.delayMs;
    });
    this.#track(poll.then(() => undefined));
    void poll.then((delayMs) => {
      if (!this.#running) return;
      this.#timer = setTimeout(() => this.#loop(), Math.max(0, delayMs - (Date.now() - startedAt)));
      this.#timer.unref();
    });
  }

  /**
   * U7 (P-49): stop polling AND wait for any poll already in flight, so nothing is inside an MCP call while the
   * credentials file is replaced. `stop()` alone only prevents the NEXT poll.
   */
  async pause(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.#inFlight]);
  }

  /** Resume after `pause()`. Polls immediately, so the new credentials are tried at once. */
  resume(): void {
    this.start();
  }

  readonly #inFlight = new Set<Promise<void>>();

  #track(poll: Promise<void>): void {
    this.#inFlight.add(poll);
    void poll.finally(() => this.#inFlight.delete(poll));
  }
}
