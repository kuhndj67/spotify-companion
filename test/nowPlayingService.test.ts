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
// ⚠️ Dynamic too, and for the same reason: a STATIC import of the client loads config.ts before the line above
// sets the interval, and the change-detection tests then see one poll and fail (found 2026-10-08).
const { CredentialsDirectoryError, McpToolError } = await import('../src/mcp/spotifyMcpClient.js');

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
    isrc: 'USUM71703861',
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

  it('FR-71: a Spotify error that arrived as TEXT is an error snapshot naming Spotify, not "could not reach"', async () => {
    // Verbatim from probe P-U7-3 (2026-10-08): a corrupted refresh token, on the real server.
    const text =
      'Error getting current track: Failed to refresh access token. Please run "npm run auth" to re-authenticate.';
    const service = makeService({ mcpError: new McpToolError('getNowPlaying', text) });
    const tick = once(service, 'tick');
    service.start();
    const [snapshot] = await tick;
    service.stop();

    const error = snapshot as { error: string; detail: string };
    assert.match(error.error, /^Spotify returned an error: Error getting current track: Failed to refresh/);
    assert.equal(error.detail, text);
    assert.ok(!('playing' in (snapshot as object)), 'never a now-playing snapshot — the F5 shape');
  });

  it('U9 (P-68): a blocked credentials directory shows ITS reason, not "could not reach the MCP server"', async () => {
    const reason = 'Credentials are mounted as single files, which cannot take a token refresh: mount ./secrets as a directory';
    const service = makeService({ mcpError: new CredentialsDirectoryError(reason) });
    const tick = once(service, 'tick');
    service.start();
    const [snapshot] = await tick;
    service.stop();

    const error = snapshot as { error: string; detail: string };
    assert.equal(error.error, reason);
    assert.equal(error.detail, reason);
    assert.doesNotMatch(error.error, /Spotify MCP server/);
  });

  it('BR-58.2: the reason on the indicator is bounded; the full text stays in detail', async () => {
    const text = `Error getting current track: ${'x'.repeat(500)}`;
    const service = makeService({ mcpError: new McpToolError('getNowPlaying', text) });
    const tick = once(service, 'tick');
    service.start();
    const [snapshot] = await tick;
    service.stop();

    const error = snapshot as { error: string; detail: string };
    assert.ok(error.error.length <= 'Spotify returned an error: '.length + 200);
    assert.equal(error.detail, text);
  });

  it('U7 (P-49): pause() waits for a poll already IN FLIGHT, not just the next one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Hold the first poll open inside "the MCP call".
    const mcp = { getNowPlaying: async () => { await gate; return null; } };
    const held = new NowPlayingService(mcp as unknown as SpotifyMcpClient, { get: () => undefined } as unknown as EnrichmentService);
    held.start();
    let paused = false;
    const pausing = held.pause().then(() => (paused = true));
    await settle(POLL_MS * 3);
    assert.equal(paused, false, 'must not report paused while a poll is inside the MCP call');
    release();
    await pausing;
    assert.equal(paused, true);
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

describe('NFR-17 — the poll backs off while Spotify refuses it (2026-10-23)', () => {
  const REFUSAL = 'Error getting current track: The app has exceeded its rate limits.';

  function counting(responses: () => NowPlaying | null | Error, steps: readonly number[]) {
    let calls = 0;
    const mcp = {
      async getNowPlaying() {
        calls++;
        const r = responses();
        if (r instanceof Error) throw r;
        return r;
      },
    } as unknown as SpotifyMcpClient;
    const enrichmentService = { get: () => undefined, fetch: async () => enrichment() } as unknown as EnrichmentService;
    const service = new NowPlayingService(mcp, enrichmentService, { rateLimitStepsMs: steps });
    return { service, calls: () => calls };
  }

  it('⭐ refused: one request per wait, not one per interval; the indicator says so', async () => {
    const s = counting(() => new McpToolError('getNowPlaying', REFUSAL), [10_000]);
    s.service.start();
    await settle(POLL_MS * 30);
    s.service.stop();
    assert.equal(s.calls(), 1, 'a 10 s wait allows no second request in 150 ms');
    const current = s.service.current as { error: string; detail: string };
    assert.match(current.error, /Spotify is limiting this app's requests\. Next try in 10 s\./);
    assert.equal(current.detail, REFUSAL);
  });

  it('positive control: an ordinary error still polls at the normal interval', async () => {
    const s = counting(() => new McpToolError('getNowPlaying', 'Not found'), [10_000]);
    s.service.start();
    await settle(POLL_MS * 30);
    s.service.stop();
    assert.ok(s.calls() > 5, `expected many polls, got ${s.calls()}`);
  });

  it('recovers: after the refusals stop, polling returns to the normal interval at once', async () => {
    let n = 0;
    const s = counting(() => (n++ < 2 ? new McpToolError('getNowPlaying', REFUSAL) : null), [20, 20]);
    s.service.start();
    await settle(POLL_MS * 40);
    s.service.stop();
    assert.ok(s.calls() > 8, `expected the normal cadence after recovery, got ${s.calls()} calls`);
    assert.deepEqual(s.service.current, { playing: false });
  });
});
