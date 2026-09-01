/**
 * Liked-status capture (BR-9).
 *
 * This is the one part of U2 whose values **cannot be recovered later**. Unlike an observation
 * trail, liked state is point-in-time: if it is not captured when the play happens, it is gone.
 * So the tests here are mostly about what happens when things go wrong.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LikedSetCache } from '../src/spotify/LikedSetCache.js';
import type { SpotifyWebApiClient } from '../src/spotify/webApiClient.js';

/** A scheduler that fires on demand, so a 30-second window costs no real time. */
function manualScheduler() {
  const queued: (() => void)[] = [];
  return {
    schedule: (fn: () => void) => {
      queued.push(fn);
      return {
        cancel: () => {
          const index = queued.indexOf(fn);
          if (index >= 0) queued.splice(index, 1);
        },
      };
    },
    async fire() {
      const pending = [...queued];
      queued.length = 0;
      for (const fn of pending) fn();
      // Let the async settle inside the callback complete.
      await new Promise((resolve) => setImmediate(resolve));
    },
    get depth() {
      return queued.length;
    },
  };
}

function stubApi(
  handler: (path: string, params?: Record<string, string>) => unknown,
): SpotifyWebApiClient {
  return {
    get: async (path: string, params?: Record<string, string>) => handler(path, params),
  } as unknown as SpotifyWebApiClient;
}

function savedPage(items: { id: string; addedAt: string }[], total = items.length) {
  return {
    items: items.map((item) => ({ added_at: item.addedAt, track: { id: item.id } })),
    total,
    next: null,
  };
}

describe('the saved-track set', () => {
  it('loads the set and answers membership locally', async () => {
    // /me/tracks/contains is 403 in Development Mode while /me/tracks works, so the set is
    // fetched once and resolved in memory.
    const api = stubApi(() => savedPage([{ id: 'a', addedAt: '2026-08-01T00:00:00Z' }]));
    const cache = new LikedSetCache({ api });

    await cache.refresh();
    assert.equal(cache.isLiked('a'), true);
    assert.equal(cache.isLiked('b'), false);
    assert.equal(cache.size, 1);
  });

  it('pages until the set is complete', async () => {
    const pages = new Map<string, unknown>([
      [
        '0',
        {
          items: Array.from({ length: 50 }, (_, i) => ({
            added_at: '2026-08-01T00:00:00Z',
            track: { id: `t${i}` },
          })),
          next: 'more',
        },
      ],
      ['50', savedPage([{ id: 'last', addedAt: '2026-08-01T00:00:00Z' }])],
    ]);

    const api = stubApi((_path, params) => pages.get(params?.offset ?? '0'));
    const cache = new LikedSetCache({ api });
    await cache.refresh();

    assert.equal(cache.size, 51);
    assert.equal(cache.isLiked('last'), true);
  });
});

describe('null is not false, and here it cannot be fixed later (BR-9.5)', () => {
  it('answers null before the set has ever loaded', async () => {
    const api = stubApi(() => null);
    const cache = new LikedSetCache({ api });

    assert.equal(cache.isLiked('a'), null, 'never false — we have not looked');
    assert.equal(cache.available, false);
  });

  it('answers null when the set could not be fetched', async () => {
    // Writing `false` here would record an observed choice that never happened, in the
    // dependent variable of the experiment.
    const api = stubApi(() => {
      throw new Error('network down');
    });
    const cache = new LikedSetCache({ api });
    await cache.refresh();

    assert.equal(cache.isLiked('a'), null);
    assert.equal(cache.available, false);
  });

  it('keeps a stale set rather than clearing it when a refresh fails', async () => {
    // A ten-minute-old answer beats `null` for every play until the next success, because
    // these values cannot be recovered afterwards.
    let fail = false;
    const api = stubApi(() => {
      if (fail) throw new Error('network down');
      return savedPage([{ id: 'a', addedAt: '2026-08-01T00:00:00Z' }]);
    });

    const cache = new LikedSetCache({ api });
    await cache.refresh();
    fail = true;
    await cache.refresh();

    assert.equal(cache.isLiked('a'), true, 'the previous set survives a failed refresh');
  });
});

describe('the grace window (BR-9.3, BR-9.4)', () => {
  it('upgrades to liked when added_at falls inside the play window', async () => {
    // Liking often happens a beat after a track ends. Sampling exactly at the boundary would
    // record `kept-unliked` and lose the strongest positive signal available.
    const scheduler = manualScheduler();
    let liked = false;

    const api = stubApi(() =>
      liked ? savedPage([{ id: 'a', addedAt: '2026-08-31T10:03:10Z' }]) : savedPage([]),
    );

    const cache = new LikedSetCache({ api, schedule: scheduler.schedule });
    await cache.refresh();

    const pending = cache.captureAtClose(1, 'a', '2026-08-31T10:00:00Z', false);
    liked = true;
    await scheduler.fire();

    const result = await pending;
    assert.equal(result.likedAtEnd, true);
    assert.equal(result.likedAddedAt, '2026-08-31T10:03:10Z');
  });

  it('refuses to attribute a like that predates the play', async () => {
    // Without this test, a track liked last week and re-surfacing in page 1 would be credited
    // to the play that just ended.
    const scheduler = manualScheduler();
    const api = stubApi(() => savedPage([{ id: 'a', addedAt: '2026-08-01T00:00:00Z' }]));

    const cache = new LikedSetCache({ api, schedule: scheduler.schedule });
    await cache.refresh();

    // The set already contains it, so the close-time sample answers immediately.
    const result = await cache.captureAtClose(1, 'a', '2026-08-31T10:00:00Z', true);
    assert.equal(result.likedAtEnd, true);
    assert.equal(result.likedAddedAt, '2026-08-01T00:00:00Z');
  });

  it('settles to false when the window passes with no like', async () => {
    const scheduler = manualScheduler();
    const api = stubApi(() => savedPage([]));

    const cache = new LikedSetCache({ api, schedule: scheduler.schedule });
    await cache.refresh();

    const pending = cache.captureAtClose(1, 'a', '2026-08-31T10:00:00Z', false);
    await scheduler.fire();

    const result = await pending;
    assert.equal(result.likedAtEnd, false, 'we looked and there was no like — that is an answer');
  });

  it('settles to null, not false, when the window check itself fails', async () => {
    const scheduler = manualScheduler();
    let calls = 0;
    const api = stubApi(() => {
      calls += 1;
      if (calls === 1) return savedPage([]);
      throw new Error('network down');
    });

    const cache = new LikedSetCache({ api, schedule: scheduler.schedule });
    await cache.refresh();

    const pending = cache.captureAtClose(1, 'a', '2026-08-31T10:00:00Z', false);
    await scheduler.fire();

    const result = await pending;
    assert.equal(result.likedAtEnd, null, 'we did not observe a choice');
  });

  it('skips the window when the track was already liked at close', async () => {
    // Nothing to wait for, and a needless request against the budget.
    const scheduler = manualScheduler();
    const api = stubApi(() => savedPage([{ id: 'a', addedAt: '2026-08-01T00:00:00Z' }]));

    const cache = new LikedSetCache({ api, schedule: scheduler.schedule });
    await cache.refresh();

    await cache.captureAtClose(1, 'a', '2026-08-31T10:00:00Z', true);
    assert.equal(scheduler.depth, 0, 'no grace window should have been scheduled');
  });

  it('skips the window when liked status is unknown', async () => {
    // A window cannot upgrade `null` to anything meaningful — we still would not know what the
    // state was at the start.
    const scheduler = manualScheduler();
    const api = stubApi(() => {
      throw new Error('down');
    });

    const cache = new LikedSetCache({ api, schedule: scheduler.schedule });
    await cache.refresh();

    const result = await cache.captureAtClose(1, 'a', '2026-08-31T10:00:00Z', null);
    assert.equal(result.likedAtEnd, null);
    assert.equal(scheduler.depth, 0);
  });
});

describe('graceful shutdown flushes pending checks (P-8, Q7 = C)', () => {
  it('completes an outstanding window rather than dropping it', async () => {
    // Covers the ordinary Ctrl-C and restart cases without persisting durable state for a
    // 30-second interval.
    const scheduler = manualScheduler();
    let liked = false;
    const api = stubApi(() =>
      liked ? savedPage([{ id: 'a', addedAt: '2026-08-31T10:03:10Z' }]) : savedPage([]),
    );

    const cache = new LikedSetCache({ api, schedule: scheduler.schedule });
    await cache.refresh();

    const pending = cache.captureAtClose(1, 'a', '2026-08-31T10:00:00Z', false);
    assert.equal(cache.pendingChecks, 1);

    liked = true;
    await cache.flushPending();

    const result = await pending;
    assert.equal(result.likedAtEnd, true);
    assert.equal(cache.pendingChecks, 0);
  });

  it('is safe to call with nothing pending', async () => {
    const api = stubApi(() => savedPage([]));
    const cache = new LikedSetCache({ api });
    await cache.flushPending();
    assert.equal(cache.pendingChecks, 0);
  });
});
