/**
 * P-33 — the one-method player client, and **PBT-44**: P-30's transport classification.
 *
 * ## ⚠️ The structural test is the point of this file
 *
 * `test/noOrphanModules.test.ts` walks **modules, not methods**. Two dead methods lived inside a
 * heavily-executed file for their entire lives and that check was satisfied throughout — so a second
 * method added here would be invisible to it. **The one-method rule has to be asserted on this
 * module's exported shape**, which is what the first describe block does.
 *
 * ## ⚠️ And PBT-44 pins a conflict resolution, not just behaviour
 *
 * NFR-17 says handle 429 with `Retry-After`. BR-43.5 says never retry a skip. P-30 resolves it by
 * asking *did the request reach the device?* — so a 429 refuses **without waiting**, and anything whose
 * landing is unknown counts as having landed. Deleting the `assert` on "does not wait" would let someone
 * reintroduce a `Retry-After` sleep that satisfies NFR-17's letter and turns a skip into
 * *"skip whatever is playing in 30 seconds"*.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SpotifyPlayerClient } from '../src/playback/spotifyPlayerClient.js';
import type { PlayerClient } from '../src/playback/spotifyPlayerClient.js';

function clientWith(
  responder: (url: string, init: RequestInit | undefined, call: number) => Response | Promise<Response>,
  onInvalidate: () => void = () => {},
): { client: SpotifyPlayerClient; calls: () => number; tokens: () => string[] } {
  let calls = 0;
  const tokens: string[] = [];
  let tokenSeq = 0;
  const client = new SpotifyPlayerClient(
    async () => {
      tokenSeq += 1;
      const t = `token-${tokenSeq}`;
      tokens.push(t);
      return t;
    },
    onInvalidate,
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      return responder(String(url), init, calls);
    }) as unknown as typeof fetch,
  );
  return { client, calls: () => calls, tokens: () => tokens };
}

const ok = (status = 204) => new Response(null, { status });

describe('⭐ P-33 — the client exposes EXACTLY ONE method', () => {
  it('skipToNext and nothing else', () => {
    const { client } = clientWith(() => ok());
    const own = Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter(
      (n) => n !== 'constructor',
    );
    assert.deepEqual(
      own,
      ['skipToNext'],
      'A general PlayerClient is how a skip-only unit acquires the ability to pause the user music. ' +
        'Nothing in U5 needs pause, seek, volume or transfer-playback, and an unused capability on a ' +
        'live device is indistinguishable from an intended one the day someone calls it (BR-30, P-33). ' +
        'If a method is genuinely needed, that is a design decision, not a test update.',
    );
  });

  it('⚠️ exposes no pause, seek, volume, play or transfer', () => {
    const { client } = clientWith(() => ok());
    const surface = client as unknown as Record<string, unknown>;
    for (const forbidden of ['pause', 'play', 'seek', 'setVolume', 'volume', 'transferPlayback', 'previous']) {
      assert.equal(typeof surface[forbidden], 'undefined', `${forbidden} must not exist`);
    }
  });

  it('the PlayerClient interface is one method wide', () => {
    // A compile-time assertion: this only typechecks while the interface has exactly `skipToNext`.
    const minimal: PlayerClient = { skipToNext: async () => ({ kind: 'issued' }) };
    assert.equal(typeof minimal.skipToNext, 'function');
  });
});

describe('PBT-44 — transport outcomes, classified by "did it reach the device?"', () => {
  it('204 is issued', async () => {
    const { client } = clientWith(() => ok(204));
    assert.deepEqual(await client.skipToNext(), { kind: 'issued' });
  });

  it('200 is issued too', async () => {
    const { client } = clientWith(() => ok(200));
    assert.deepEqual(await client.skipToNext(), { kind: 'issued' });
  });

  it('POSTs to /me/player/next', async () => {
    let seen = '';
    let method = '';
    const { client } = clientWith((url, init) => {
      seen = url;
      method = String(init?.method);
      return ok();
    });
    await client.skipToNext();
    assert.equal(seen, 'https://api.spotify.com/v1/me/player/next');
    assert.equal(method, 'POST');
  });

  it('⚠️ 401 is ONE forced refresh and ONE retry — and that is not a retry of the SKIP', async () => {
    // A 401 is rejected at the edge: the request provably never reached the player, so re-issuing
    // COMPLETES the first attempt rather than making a second one (P-30). The container refreshes its
    // token roughly hourly, so this is routine rather than exceptional.
    let invalidated = 0;
    const { client, calls, tokens } = clientWith(
      (_url, _init, call) => (call === 1 ? ok(401) : ok(204)),
      () => {
        invalidated += 1;
      },
    );
    assert.deepEqual(await client.skipToNext(), { kind: 'issued' });
    assert.equal(calls(), 2, 'exactly two requests');
    assert.equal(invalidated, 1, 'the cached token is dropped once');
    assert.notEqual(tokens()[0], tokens()[1], 'the retry uses a fresh token');
  });

  it('a 401 that persists is failed, not retried again', async () => {
    const { client, calls } = clientWith(() => ok(401));
    const outcome = await client.skipToNext();
    assert.equal(outcome.kind, 'failed');
    assert.equal(calls(), 2, 'one refresh, one retry, then stop');
  });

  it('⭐ 429 refuses WITHOUT waiting, as upstream-rate-limited', async () => {
    const started = Date.now();
    const { client, calls } = clientWith(
      () => new Response(null, { status: 429, headers: { 'retry-after': '30' } }),
    );
    const outcome = await client.skipToNext();

    assert.equal(outcome.kind, 'refused');
    assert.equal(outcome.kind === 'refused' && outcome.reason, 'upstream-rate-limited');
    assert.ok(
      Date.now() - started < 1_000,
      'honouring a 30s Retry-After would turn this into "skip whatever is playing in 30 seconds" — ' +
        'not the action that was decided (P-30)',
    );
    assert.equal(calls(), 1, 'and it does not re-issue');
  });

  it('⚠️ 429 is NOT reported as our own rate-limited reason', async () => {
    // `rate-limited` is BR-35.2's hourly safety cap. Conflating the two would make the runaway halt's
    // evidence unreadable, and saying what tripped it is the halt's only job.
    const { client } = clientWith(() => new Response(null, { status: 429 }));
    const outcome = await client.skipToNext();
    assert.notEqual(outcome.kind === 'refused' && outcome.reason, 'rate-limited');
  });

  it('404 refuses as no-active-device — benign, not a defect', async () => {
    const { client } = clientWith(() => ok(404));
    const outcome = await client.skipToNext();
    assert.equal(outcome.kind, 'refused');
    assert.equal(outcome.kind === 'refused' && outcome.reason, 'no-active-device');
  });

  it('⚠️ a network error is FAILED, because the landing is UNKNOWN', async () => {
    // null is unknown and unknown is not false. An unknown landing counts as having landed, so it is
    // surfaced and never retried (P-30, BR-43.5).
    const { client } = clientWith(() => {
      throw new Error('socket hang up');
    });
    const outcome = await client.skipToNext();
    assert.equal(outcome.kind, 'failed');
    assert.match(outcome.kind === 'failed' ? outcome.detail : '', /socket hang up/);
  });

  it('a 5xx is failed', async () => {
    const { client } = clientWith(() => new Response('upstream boom', { status: 502 }));
    const outcome = await client.skipToNext();
    assert.equal(outcome.kind, 'failed');
  });

  it('⚠️ a 403 carries the missing-scope hint', async () => {
    // Development Mode has produced six wrong conclusions in this project by failing in misleading
    // ways. A 403 on this endpoint almost always means the scope was never granted.
    const { client } = clientWith(() => new Response('Forbidden', { status: 403 }));
    const outcome = await client.skipToNext();
    assert.equal(outcome.kind, 'failed');
    assert.match(outcome.kind === 'failed' ? outcome.detail : '', /user-modify-playback-state/);
  });

  it('⚠️ NO outcome expresses a retry', async () => {
    // FR-48 / BR-36.4: surface, do not retry. The union has no member for it.
    for (const responder of [
      () => ok(204),
      () => new Response(null, { status: 429 }),
      () => ok(404),
      () => new Response('x', { status: 500 }),
    ]) {
      const { client } = clientWith(responder);
      const outcome = await client.skipToNext();
      assert.ok(['issued', 'refused', 'failed'].includes(outcome.kind));
    }
  });
});
