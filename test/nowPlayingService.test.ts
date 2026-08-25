/**
 * Tests for NowPlayingService — the poll loop's change detection and enrichment attachment.
 *
 * The change-detection logic is what keeps the WebSocket from broadcasting on every poll:
 * progress advances constantly, so naive equality would push a message every 3 seconds to
 * every client. Getting this wrong is invisible in manual testing but wasteful at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { SpotifyMcpClient } from '../src/mcp/spotifyMcpClient.js';
import type { EnrichmentService, Enrichment } from '../src/spotify/enrichment.js';
import type { NowPlaying } from '../src/mcp/parseNowPlaying.js';

// config.ts reads the environment once at import, and node:test gives each file its own
// process — so shortening the poll interval here affects only this suite. Without it the
// 3-second default means a single poll per test, and the change-detection assertions
// would pass vacuously.
const POLL_MS = 5;
process.env.POLL_INTERVAL_MS = String(POLL_MS);

const { NowPlayingService } = await import('../src/nowPlayingService.js');

/** Long enough for several poll cycles plus the async enrichment hop. */
const SEVERAL_POLLS = POLL_MS * 12;

const settle = (ms = SEVERAL_POLLS) => new Promise((resolve) => setTimeout(resolve, ms));

function track(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    isPlaying: true,
    track: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    trackId: 'track-1',
    progress: '0:30',
    duration: '3:00',
    progressMs: 30_000,
    durationMs: 180_000,
    device: 'Desktop (Computer)',
    volume: '70%',
    shuffle: 'Off',
    repeat: 'off',
    raw: '# Currently Playing',
    ...overrides,
  };
}

function enrichment(overrides: Partial<Enrichment> = {}): Enrichment {
  return {
    trackId: 'track-1',
    releaseDate: '2020-01-01',
    releaseDatePrecision: 'day',
    releaseYear: 2020,
    ageYears: 6,
    albumType: 'album',
    totalTracks: 10,
    trackNumber: 1,
    explicit: false,
    genres: [],
    genresUnavailableReason: null,
    primaryArtistId: 'artist-1',
    primaryArtistName: 'Test Artist',
    following: true,
    art: null,
    spotifyUrl: null,
    warnings: [],
    ...overrides,
  };
}

/** Stubs both collaborators and drives one poll cycle via start(). */
function makeService(options: {
  nowPlaying?: NowPlaying | null | (() => NowPlaying | null);
  mcpError?: Error;
  cached?: Enrichment;
  fetched?: Enrichment;
  onFetch?: () => void;
}) {
  const mcp = {
    async getNowPlaying() {
      if (options.mcpError) throw options.mcpError;
      return typeof options.nowPlaying === 'function'
        ? options.nowPlaying()
        : (options.nowPlaying ?? null);
    },
  } as unknown as SpotifyMcpClient;

  const enrichmentService = {
    get: () => options.cached,
    fetch: async () => {
      options.onFetch?.();
      return options.fetched ?? enrichment();
    },
  } as unknown as EnrichmentService;

  return new NowPlayingService(mcp, enrichmentService);
}

/** Collects every event of one type until the service is stopped. */
function collect(
  service: InstanceType<typeof NowPlayingService>,
  event: 'tick' | 'change',
) {
  const seen: unknown[] = [];
  service.on(event, (snapshot: unknown) => seen.push(snapshot));
  return seen;
}

describe('NowPlayingService', () => {
  it('publishes a track snapshot on the first poll', async () => {
    const service = makeService({ nowPlaying: track() });
    const tick = once(service, 'tick');
    service.start();
    const [snapshot] = await tick;
    service.stop();

    assert.equal((snapshot as { playing: boolean }).playing, true);
    assert.equal((snapshot as { track: string }).track, 'Test Track');
  });

  it('publishes an idle snapshot when nothing is playing', async () => {
    const service = makeService({ nowPlaying: null });
    const tick = once(service, 'tick');
    service.start();
    const [snapshot] = await tick;
    service.stop();

    assert.deepEqual(snapshot, { playing: false });
  });

  it('publishes an error snapshot when MCP fails, instead of throwing', async () => {
    const service = makeService({ mcpError: new Error('mcp down') });
    const tick = once(service, 'tick');
    service.start();
    const [snapshot] = await tick;
    service.stop();

    const error = snapshot as { error: string; detail: string };
    assert.match(error.error, /Spotify MCP server/);
    assert.match(error.detail, /mcp down/);
  });

  it('exposes the latest snapshot via .current', async () => {
    const service = makeService({ nowPlaying: track() });
    assert.deepEqual(service.current, { playing: false });

    const tick = once(service, 'tick');
    service.start();
    await tick;
    service.stop();

    assert.equal((service.current as { track: string }).track, 'Test Track');
  });

  it('attaches enrichment asynchronously after the track appears', async () => {
    const service = makeService({ nowPlaying: track(), fetched: enrichment() });
    const ticks = collect(service, 'tick');

    service.start();
    await settle();
    service.stop();

    assert.ok(ticks.length >= 2, 'expected a bare tick then an enriched one');
    assert.equal((ticks[0] as { enrichment: unknown }).enrichment, null);
    const enriched = ticks.at(-1) as { enrichment: Enrichment | null };
    assert.equal(enriched.enrichment?.releaseDate, '2020-01-01');
  });

  it('uses a cached enrichment immediately without re-fetching', async () => {
    let fetched = false;
    const service = makeService({
      nowPlaying: track(),
      cached: enrichment(),
      onFetch: () => {
        fetched = true;
      },
    });

    const tick = once(service, 'tick');
    service.start();
    const [snapshot] = await tick;
    await settle();
    service.stop();

    assert.ok((snapshot as { enrichment: Enrichment }).enrichment);
    assert.equal(fetched, false, 'a cached enrichment must not trigger a fetch');
  });

  describe('change detection', () => {
    // Progress advances every poll. If that counted as a change, every client would get a
    // message every interval — the interpolation in the browser exists precisely so it
    // does not have to.
    it('does not emit change when only progress advances', async () => {
      let progressMs = 30_000;
      const service = makeService({
        nowPlaying: () => track({ progressMs: (progressMs += 3000) }),
        cached: enrichment(),
      });

      const changes = collect(service, 'change');
      service.start();
      await settle();
      service.stop();

      assert.equal(changes.length, 1, 'only the initial transition should count as a change');
    });

    it('emits change when the track changes', async () => {
      const ids = ['track-1', 'track-2'];
      let index = 0;
      const service = makeService({
        nowPlaying: () => track({ trackId: ids[Math.min(index++, 1)] }),
        cached: enrichment(),
      });

      const changes = collect(service, 'change');
      service.start();
      await settle();
      service.stop();

      assert.ok(changes.length >= 2, 'a new track must be announced');
    });

    it('emits change when playback is paused', async () => {
      let playing = true;
      const service = makeService({
        nowPlaying: () => track({ isPlaying: (playing = !playing) }),
        cached: enrichment(),
      });

      const changes = collect(service, 'change');
      service.start();
      await settle();
      service.stop();

      assert.ok(changes.length >= 2, 'a pause must be announced');
    });
  });

  it('is safe to start twice and stop when never started', async () => {
    const service = makeService({ nowPlaying: track() });
    service.start();
    service.start();
    service.stop();
    service.stop();
    // Reaching here without throwing is the assertion.
    assert.ok(true);
  });
});
