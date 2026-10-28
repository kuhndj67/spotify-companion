/**
 * U11 (LC-87, BR-89) — PBT-95 (`safeReturnPath`) and PBT-99 (the bounded store of sign-ins in progress).
 *
 * ⚠️ Positive controls: an ordinary path IS kept (PBT-95: a function returning `/` for everything would pass the
 * origin property); a fresh entry IS returned once (PBT-99: a store that returned nothing would pass "never
 * returns an expired one").
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import { safeReturnPath } from '../src/access/returnPath.js';
import { MAX_PENDING, PENDING_TTL_MS, PendingSignIns, type PendingSignIn } from '../src/access/pendingSignIns.js';

const ORIGIN = 'https://machine2.local:3443';

describe('safeReturnPath (PBT-95)', () => {
  it('for ANY input, the result resolved against the public origin has the public origin', () => {
    const hostile = fc.oneof(
      fc.string(),
      fc.string({ unit: 'binary' }),
      fc.webUrl(),
      fc.constantFrom('//evil.com', '/\\evil.com', '/\t/evil.com', '/%2F%2Fevil.com', '\\\\evil.com', 'https://evil.com', '/https://evil.com', '/javascript:alert(1)', ' /x', '/\n/evil.com'),
      fc.string().map((s) => `/${s}`),
      fc.string().map((s) => `//${s}`),
    );
    fc.assert(
      fc.property(hostile, (raw) => {
        const out = safeReturnPath(raw);
        assert.equal(new URL(out, ORIGIN).origin, ORIGIN, `${JSON.stringify(raw)} → ${JSON.stringify(out)}`);
        assert.ok(out.startsWith('/') && !out.startsWith('//'));
      }),
    );
  });

  it('⭐ ordinary in-app paths are kept as given', () => {
    for (const p of ['/', '/?tab=history', '/rules#top', '/api/x?y=1&z=%2F']) assert.equal(safeReturnPath(p), p);
  });

  it('refuses non-strings, over-long paths, and any return into /auth/ (which would start another sign-in)', () => {
    for (const p of [undefined, null, 42, ['/x'], '/' + 'a'.repeat(512), '/auth/sign-in', '/auth', '/auth?x=1', '/auth/callback?code=x']) {
      assert.equal(safeReturnPath(p), '/', String(p));
    }
  });
});

const entry = (state: string, createdAt: number): PendingSignIn => ({ state, nonce: `n-${state}`, codeVerifier: `v-${state}`, returnPath: '/', createdAt });

type Op = { kind: 'add'; state: string } | { kind: 'consume'; state: string } | { kind: 'advance'; ms: number } | { kind: 'burst'; count: number };
// ⚠️ A FEW names, not many: with 51 the generator almost never consumed one name twice inside ten minutes, and a
// store that never removed a consumed entry passed this property (seen: only the example test below failed).
// Names beyond 32 are still reached through the cap, by the many-adds case below.
const stateName = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 5 }).map((i) => `s${i}`) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 60 }).map((i) => `s${i}`) },
);
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: stateName.map((state) => ({ kind: 'add' as const, state })) },
  { weight: 3, arbitrary: stateName.map((state) => ({ kind: 'consume' as const, state })) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 4 * 60_000 }).map((ms) => ({ kind: 'advance' as const, ms })) },
  // Someone pressing *Sign in* over and over: the only way past the cap inside ten minutes.
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 40 }).map((count) => ({ kind: 'burst' as const, count })) },
);

describe('PendingSignIns (PBT-99)', () => {
  it('under ANY sequence: never more than 32; never an expired or consumed entry; each live one at most once', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 200 }), (ops) => {
        const store = new PendingSignIns();
        let now = 1_000_000;
        // The model: what the store may still return, with when it was added.
        const live = new Map<string, number>();
        for (const o of ops) {
          if (o.kind === 'advance') {
            now += o.ms;
          } else if (o.kind === 'burst') {
            for (let i = 0; i < o.count; i++) {
              const state = `b${i}`;
              store.add(entry(state, now), now);
              live.delete(state);
              live.set(state, now);
            }
          } else if (o.kind === 'add') {
            store.add(entry(o.state, now), now);
            live.delete(o.state);
            live.set(o.state, now);
          } else {
            const got = store.consume(o.state, now);
            const addedAt = live.get(o.state);
            if (got !== undefined) {
              assert.ok(addedAt !== undefined, `returned ${o.state}, which was consumed or never added`);
              assert.ok(now - got.createdAt < PENDING_TTL_MS, 'returned an expired entry');
              assert.equal(got.createdAt, addedAt);
            }
            live.delete(o.state);
          }
          assert.ok(store.size <= MAX_PENDING, `size ${store.size}`);
        }
      }),
    );
  });

  it('⭐ a fresh entry is returned exactly once', () => {
    const store = new PendingSignIns();
    store.add(entry('a', 0), 0);
    assert.equal(store.consume('a', PENDING_TTL_MS - 1)?.state, 'a');
    assert.equal(store.consume('a', PENDING_TTL_MS - 1), undefined);
  });

  it('at ten minutes it is gone; the 33rd addition drops the oldest', () => {
    const store = new PendingSignIns();
    store.add(entry('a', 0), 0);
    assert.equal(store.consume('a', PENDING_TTL_MS), undefined);
    for (let i = 0; i <= MAX_PENDING; i++) store.add(entry(`s${i}`, i), i);
    assert.equal(store.size, MAX_PENDING);
    assert.equal(store.consume('s0', MAX_PENDING), undefined);
    assert.equal(store.consume(`s${MAX_PENDING}`, MAX_PENDING)?.state, `s${MAX_PENDING}`);
  });
});
