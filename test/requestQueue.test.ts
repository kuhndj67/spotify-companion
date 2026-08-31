/**
 * Request queue — the single control that keeps U2 inside MusicBrainz's policy.
 *
 * There is no API key here, so no per-key throttle absorbs a mistake: being blocked takes out the
 * whole unit rather than degrading it. These tests use an injected clock, so they assert the
 * *policy* rather than waiting in real time.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RequestQueue, ThrottledError } from '../src/musicbrainz/RequestQueue.js';

/**
 * A controllable clock. `sleep` advances time instantly, so a test that exercises a 30-second
 * pause takes microseconds — and, more importantly, asserts the interval that was *requested*
 * rather than the one that happened to elapse.
 */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get sleeps() {
      return sleeps;
    },
    get time() {
      return now;
    },
  };
}

function makeQueue(clock: ReturnType<typeof fakeClock>, over = {}) {
  return new RequestQueue({ now: clock.now, sleep: clock.sleep, ...over });
}

describe('rate limiting', () => {
  it('spaces requests by at least the minimum interval', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    const startedAt: number[] = [];

    await Promise.all(
      [1, 2, 3].map(() =>
        queue.enqueue(async () => {
          startedAt.push(clock.now());
        }),
      ),
    );

    assert.equal(startedAt.length, 3);
    for (let i = 1; i < startedAt.length; i += 1) {
      assert.ok(
        startedAt[i]! - startedAt[i - 1]! >= 1_000,
        `requests ${i - 1} and ${i} were ${startedAt[i]! - startedAt[i - 1]!}ms apart`,
      );
    }
  });

  it('measures spacing from the previous start, not its completion', async () => {
    // MusicBrainz latency was measured at 0.1-6.7s. Spacing from completion would let a fast
    // burst follow a slow response, which is exactly when the total rate would exceed policy.
    const clock = fakeClock();
    const queue = makeQueue(clock);
    const startedAt: number[] = [];

    await queue.enqueue(async () => {
      startedAt.push(clock.now());
      clock.advance(6_700); // a slow response, as observed live
    });
    await queue.enqueue(async () => {
      startedAt.push(clock.now());
    });

    // The second request may start immediately, because more than 1s has already passed.
    assert.ok(startedAt[1]! - startedAt[0]! >= 1_000);
  });

  it('runs work one at a time', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    let concurrent = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        queue.enqueue(async () => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          await Promise.resolve();
          concurrent -= 1;
        }),
      ),
    );

    assert.equal(peak, 1, 'two concurrent requests would double the effective rate');
  });
});

describe('priority selects order, never rate', () => {
  it('serves a high-priority item before queued low-priority work', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    const order: string[] = [];

    const all = [
      queue.enqueue(async () => void order.push('low-1'), 'low'),
      queue.enqueue(async () => void order.push('low-2'), 'low'),
      queue.enqueue(async () => void order.push('high'), 'high'),
    ];
    await Promise.all(all);

    // low-1 is already in flight when high arrives; high must precede the rest.
    assert.equal(order[0], 'low-1');
    assert.equal(order[1], 'high', 'the live track must not wait behind a backfill sweep');
    assert.equal(order[2], 'low-2');
  });

  it('keeps FIFO order within a priority class', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    const order: number[] = [];

    await Promise.all(
      [0, 1, 2, 3].map((n) => queue.enqueue(async () => void order.push(n), 'low')),
    );
    assert.deepEqual(order, [0, 1, 2, 3]);
  });

  it('does not let a high-priority item skip the rate limit', async () => {
    // This is the failure that would defeat NFR-15 exactly when the app is busiest.
    const clock = fakeClock();
    const queue = makeQueue(clock);
    const startedAt: number[] = [];

    await Promise.all([
      queue.enqueue(async () => void startedAt.push(clock.now()), 'low'),
      queue.enqueue(async () => void startedAt.push(clock.now()), 'high'),
      queue.enqueue(async () => void startedAt.push(clock.now()), 'high'),
    ]);

    for (let i = 1; i < startedAt.length; i += 1) {
      assert.ok(startedAt[i]! - startedAt[i - 1]! >= 1_000);
    }
  });
});

describe('throttling pauses the whole queue (P-4)', () => {
  it('stops everything after repeated 503s rather than backing off per request', async () => {
    // Per-request retry increases pressure exactly when the service is signalling overload.
    const clock = fakeClock();
    const queue = makeQueue(clock, { pauseAfterThrottles: 2, pauseMs: 30_000 });

    await assert.rejects(queue.enqueue(async () => Promise.reject(new ThrottledError())));
    await assert.rejects(queue.enqueue(async () => Promise.reject(new ThrottledError())));

    assert.equal(queue.paused, true, 'two consecutive throttles must stop the queue');

    const before = clock.time;
    await queue.enqueue(async () => 'after the pause');
    assert.ok(
      clock.time - before >= 30_000,
      'work queued during a pause must wait for it to lift',
    );
  });

  it('resets the throttle count after a success', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock, { pauseAfterThrottles: 2 });

    await assert.rejects(queue.enqueue(async () => Promise.reject(new ThrottledError())));
    await queue.enqueue(async () => 'ok');
    await assert.rejects(queue.enqueue(async () => Promise.reject(new ThrottledError())));

    assert.equal(queue.paused, false, 'throttles must be consecutive to trigger a pause');
  });

  it('does not pause for ordinary errors', async () => {
    // A malformed response or a parse failure says nothing about whether the service wants us
    // to slow down. Treating it as a throttle would stall the queue for a bug of our own.
    const clock = fakeClock();
    const queue = makeQueue(clock, { pauseAfterThrottles: 2 });

    await assert.rejects(queue.enqueue(async () => Promise.reject(new Error('malformed JSON'))));
    await assert.rejects(queue.enqueue(async () => Promise.reject(new Error('malformed JSON'))));

    assert.equal(queue.paused, false);
  });

  it('a pause delays work rather than answering it', async () => {
    // BR-7.7: nothing may become `unknown` because the queue was busy. A pause is a delay.
    const clock = fakeClock();
    const queue = makeQueue(clock, { pauseAfterThrottles: 1, pauseMs: 5_000 });

    await assert.rejects(queue.enqueue(async () => Promise.reject(new ThrottledError())));
    const result = await queue.enqueue(async () => 'resolved eventually');
    assert.equal(result, 'resolved eventually');
  });
});

describe('results and failures reach the caller', () => {
  it('resolves with the value the work returned', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    assert.equal(await queue.enqueue(async () => 42), 42);
  });

  it('rejects with the original error', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    await assert.rejects(
      queue.enqueue(async () => {
        throw new Error('upstream said no');
      }),
      /upstream said no/,
    );
  });

  it('keeps draining after a failure', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    const results: string[] = [];

    const failing = queue.enqueue(async () => {
      throw new Error('boom');
    });
    const following = queue.enqueue(async () => {
      results.push('ran');
      return 'ok';
    });

    await assert.rejects(failing);
    await following;
    assert.deepEqual(results, ['ran'], 'one failure must not stall the queue');
  });

  it('reports its depth', async () => {
    const clock = fakeClock();
    const queue = makeQueue(clock);
    const work = [1, 2, 3].map(() => queue.enqueue(async () => undefined));
    assert.ok(queue.depth >= 0);
    await Promise.all(work);
    assert.equal(queue.depth, 0);
  });
});
