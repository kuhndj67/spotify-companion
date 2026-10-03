/**
 * BR-41.1/41.2 — the live context fetcher.
 *
 * ## ⚠️ The test that justifies the whole design
 *
 * **One request per track, not one per tick.** The poll runs every 3 seconds and is already 98.4% of
 * this app's Spotify footprint; a per-tick fetch would double it to collect a value that cannot change
 * within a play. The `many ticks, one request` case is the one that would silently regress.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PlaybackContextCache } from '../src/playback/playbackContext.js';
import type { ContextSource } from '../src/playback/playbackContext.js';

function source(
  responder: (call: number) => unknown,
): { api: ContextSource; calls: () => number } {
  let calls = 0;
  return {
    api: {
      get: async <T,>() => {
        calls += 1;
        const r = responder(calls);
        if (r instanceof Error) throw r;
        return r as T | null;
      },
    },
    calls: () => calls,
  };
}

const PLAYLIST = { context: { type: 'playlist', uri: 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq' } };

describe('⭐ one request per TRACK, never per tick', () => {
  it('many ticks for the same track make exactly one request', async () => {
    const s = source(() => PLAYLIST);
    const cache = new PlaybackContextCache(s.api);

    for (let i = 0; i < 20; i += 1) await cache.ensure('t1');

    assert.equal(s.calls(), 1, 'a per-tick fetch would DOUBLE the app Spotify footprint');
    assert.equal(cache.get('t1').contextType, 'playlist');
  });

  it('a new track triggers exactly one more', async () => {
    const s = source(() => PLAYLIST);
    const cache = new PlaybackContextCache(s.api);
    await cache.ensure('t1');
    await cache.ensure('t2');
    await cache.ensure('t2');
    assert.equal(s.calls(), 2);
  });

  it('⚠️ get() for a different track returns nulls rather than the previous track value', async () => {
    // context.uri GOES STALE on its own -- it named an album through 33 minutes of autoplay by other
    // artists -- so serving a cached value across a track boundary would compound an inaccuracy the
    // field already has.
    const s = source(() => PLAYLIST);
    const cache = new PlaybackContextCache(s.api);
    await cache.ensure('t1');

    assert.equal(cache.get('t2').contextType, null);
    assert.equal(cache.get('t2').contextUri, null);
  });

  it('⚠️ a slow response does not start a second request on the next tick', async () => {
    // The poll is a 3s timer. Without the in-flight guard, a slow upstream turns one call per track
    // into one per tick -- under exactly the conditions where that is least welcome.
    const box: { release?: () => void } = {};
    let calls = 0;
    const api: ContextSource = {
      get: async <T,>() => {
        calls += 1;
        await new Promise<void>((r) => {
          box.release = r;
        });
        return PLAYLIST as unknown as T;
      },
    };
    const cache = new PlaybackContextCache(api);

    const first = cache.ensure('t1');
    await cache.ensure('t1'); // the next tick, while the first is still in flight
    await cache.ensure('t1');
    assert.equal(calls, 1, 'exactly one request is outstanding');

    box.release?.();
    await first;
    assert.equal(cache.get('t1').contextType, 'playlist');
  });
});

describe('⚠️ a failure costs nothing but the context', () => {
  it('never throws, and records null rather than a guess', async () => {
    const s = source(() => new Error('upstream down'));
    const cache = new PlaybackContextCache(s.api);

    await assert.doesNotReject(() => cache.ensure('t1'));
    assert.equal(cache.get('t1').contextType, null);
  });

  it('⚠️ does NOT poison the cache — a later tick may retry', async () => {
    // A failure that marked the track as fetched would record `unknown` for the whole play on one
    // transient error. NFR-18: every upstream failure is partial data, never fatal.
    const s = source((call) => (call === 1 ? new Error('transient') : PLAYLIST));
    const cache = new PlaybackContextCache(s.api);

    await cache.ensure('t1');
    assert.equal(cache.get('t1').contextType, null);

    await cache.ensure('t1');
    assert.equal(s.calls(), 2, 'the next tick retried');
    assert.equal(cache.get('t1').contextType, 'playlist');
  });

  it('nothing playing (204/404 → null body) means null context, not an error', async () => {
    const s = source(() => null);
    const cache = new PlaybackContextCache(s.api);
    await cache.ensure('t1');
    assert.equal(cache.get('t1').contextType, null);
    assert.equal(cache.get('t1').contextUri, null);
  });

  it('a context with no type still yields nulls rather than undefined', async () => {
    const s = source(() => ({ context: {} }));
    const cache = new PlaybackContextCache(s.api);
    await cache.ensure('t1');
    assert.equal(cache.get('t1').contextType, null);
  });
});

describe('⚠️ the fetch counts toward the footprint it was weighed against', () => {
  it('reports each request to the metrics hook', async () => {
    // A fetcher that was not counted would be exactly the blind spot upstreamMetrics exists to remove.
    const outcomes: string[] = [];
    const s = source((call) => (call === 1 ? PLAYLIST : new Error('boom')));
    const cache = new PlaybackContextCache(s.api, (o) => outcomes.push(o));

    await cache.ensure('t1');
    await cache.ensure('t2');

    assert.deepEqual(outcomes, ['ok', 'error']);
  });
});

describe('⚠️ what this records cannot answer', () => {
  it('the DJ and a radio station are indistinguishable by type', async () => {
    // Both are `type: playlist` with the 37i9dQZF1E prefix (R11, re-confirmed by P-U5-1). The
    // discriminator is whether the QUEUE exposes tracks, which is why FR-36 asks at runtime and why
    // BR-41.3 keeps this field as evidence only.
    const dj = { context: { type: 'playlist', uri: 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq' } };
    const radio = { context: { type: 'playlist', uri: 'spotify:playlist:37i9dQZF1E4xunLN1DdaFF' } };

    const a = new PlaybackContextCache(source(() => dj).api);
    const b = new PlaybackContextCache(source(() => radio).api);
    await a.ensure('t1');
    await b.ensure('t1');

    assert.equal(a.get('t1').contextType, b.get('t1').contextType, 'type cannot tell them apart');
    assert.notEqual(a.get('t1').contextUri, b.get('t1').contextUri);
  });
});
