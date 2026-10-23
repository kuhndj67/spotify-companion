/**
 * NFR-17 — the poll's response to Spotify's rate limit (`src/pollBackoff.ts`), found live 2026-10-23.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import { RATE_LIMIT_STEPS_MS, isRateLimited, nextPoll, retryAfterMs } from '../src/pollBackoff.js';

const SPOTIFY = 'Error getting current track: The app has exceeded its rate limits.';
const BASE = 3000;

describe('nextPoll', () => {
  it('⭐ the real refusal backs off 30 s, 60 s, 2 min, 5 min, then 10 min per try', () => {
    let state = { refusals: 0 };
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = nextPoll(state, { kind: 'error', text: SPOTIFY }, BASE);
      assert.equal(n.backingOff, true);
      waits.push(n.delayMs);
      state = n.state;
    }
    assert.deepEqual(waits, [30_000, 60_000, 120_000, 300_000, 600_000, 600_000, 600_000]);
  });

  it('any other outcome returns to the normal interval at once (a backoff must always exit)', () => {
    fc.assert(
      fc.property(fc.nat(50), fc.oneof(fc.constant({ kind: 'ok' as const }), fc.constant({ kind: 'error' as const, text: 'Could not reach the Spotify MCP server.' })), (refusals, result) => {
        assert.deepEqual(nextPoll({ refusals }, result, BASE), { state: { refusals: 0 }, delayMs: BASE, backingOff: false });
      }),
    );
  });

  it('while refused: the wait never shrinks, never exceeds the cap unless Spotify asks for longer, never below the normal interval', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), fc.option(fc.integer({ min: 0, max: 3600 }), { nil: null }), (n, retryS) => {
        const text = retryS === null ? SPOTIFY : `Rate limited by Spotify. Retry after ${retryS}s.`;
        let state = { refusals: 0 };
        let last = 0;
        for (let i = 0; i < n; i++) {
          const next = nextPoll(state, { kind: 'error', text }, BASE);
          assert.ok(next.delayMs >= last && next.delayMs >= BASE);
          assert.ok(next.delayMs <= Math.max(RATE_LIMIT_STEPS_MS.at(-1)!, (retryS ?? 0) * 1000));
          last = next.delayMs;
          state = next.state;
        }
      }),
    );
  });

  it('honours a Retry-After longer than the schedule', () => {
    assert.equal(nextPoll({ refusals: 0 }, { kind: 'error', text: 'Rate limited by Spotify. Retry after 900s.' }, BASE).delayMs, 900_000);
    assert.equal(retryAfterMs('Retry-After: 12'), 12_000);
    assert.equal(retryAfterMs(SPOTIFY), null);
  });

  it('recognises the refusal wordings, and not ordinary errors', () => {
    for (const t of [SPOTIFY, 'HTTP 429', 'Too Many Requests', 'Rate limited by Spotify. Retry after 30s.']) assert.ok(isRateLimited(t), t);
    for (const t of ['Could not reach the Spotify MCP server.', 'The access token expired', 'Not found']) assert.ok(!isRateLimited(t), t);
  });
});
