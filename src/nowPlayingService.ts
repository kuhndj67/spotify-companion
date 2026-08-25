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
import { SpotifyMcpClient } from './mcp/spotifyMcpClient.js';
import type { NowPlaying } from './mcp/parseNowPlaying.js';
import type { EnrichmentService, Enrichment } from './spotify/enrichment.js';

export type Snapshot =
  | { playing: false }
  | ({ playing: true; enrichment: Enrichment | null } & NowPlaying)
  | { error: string; detail: string };

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
  #current: Snapshot = { playing: false };
  #lastSignature = '';

  constructor(spotify: SpotifyMcpClient, enrichment: EnrichmentService) {
    super();
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

  async #poll(): Promise<void> {
    let snapshot: Snapshot;

    try {
      const nowPlaying = await this.#spotify.getNowPlaying();

      if (!nowPlaying) {
        this.#publish({ playing: false });
        return;
      }

      const cached = nowPlaying.trackId ? this.#enrichment.get(nowPlaying.trackId) ?? null : null;
      snapshot = { playing: true, enrichment: cached, ...nowPlaying };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[now-playing] MCP call failed:', detail);
      this.#publish({ error: 'Could not reach the Spotify MCP server.', detail });
      return;
    }

    this.#publish(snapshot);

    // Fetch enrichment for a track we haven't seen, then republish with it attached.
    if (snapshot.playing && snapshot.trackId && !snapshot.enrichment) {
      const trackId = snapshot.trackId;
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
  }

  start(): void {
    if (this.#timer) return;
    void this.#poll();
    this.#timer = setInterval(() => void this.#poll(), config.pollIntervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
