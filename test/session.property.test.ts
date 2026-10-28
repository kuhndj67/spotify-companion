/**
 * U11 (LC-84, LC-85, BR-91, BR-94.2, BR-95.2) — PBT-96, the session codec, and the key store against a real folder.
 *
 * ⚠️ PBT-96's positive control is the round trip: a verifier that refused everything would pass every tampering
 * property.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { signSession, verifySession, type Session, type VerifyContext } from '../src/access/session.js';
import { SessionKeyStore } from '../src/access/SessionKeyStore.js';

const key = (seed: number) => Buffer.alloc(32, seed);
const KEY = key(7);

const sessionArb: fc.Arbitrary<Session> = fc
  .record({
    sub: fc.string({ minLength: 1, maxLength: 40 }),
    iat: fc.integer({ min: 0, max: 4_000_000_000_000 }),
    life: fc.integer({ min: 1, max: 90 * 24 * 3_600_000 }),
    sid: fc.stringMatching(/^[A-Za-z0-9_-]{8,32}$/),
  })
  .map(({ sub, iat, life, sid }) => ({ sub, iat, exp: iat + life, sid }));

const ctx = (s: Session, over: Partial<VerifyContext> = {}): VerifyContext => ({
  key: KEY,
  now: s.iat,
  allowedSubject: s.sub,
  revoked: new Set(),
  ...over,
});

describe('session codec (PBT-96)', () => {
  it('⭐ positive control: sign → verify round-trips, for any session, at any time before its expiry', () => {
    fc.assert(
      fc.property(sessionArb, fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), (s, f) => {
        const now = s.iat + Math.floor((s.exp - s.iat) * f);
        assert.deepEqual(verifySession(signSession(s, KEY), ctx(s, { now })), { kind: 'valid', session: s });
      }),
    );
  });

  it('flipping ANY character of the cookie never gives valid', () => {
    fc.assert(
      fc.property(sessionArb, fc.nat(), fc.integer({ min: 1, max: 127 }), (s, at, delta) => {
        const cookie = signSession(s, KEY);
        const i = at % cookie.length;
        const flipped = cookie.slice(0, i) + String.fromCharCode((cookie.charCodeAt(i) + delta) % 128) + cookie.slice(i + 1);
        fc.pre(flipped !== cookie);
        assert.notEqual(verifySession(flipped, ctx(s)).kind, 'valid');
      }),
    );
  });

  it('verifying under any other key never gives valid', () => {
    fc.assert(
      fc.property(sessionArb, fc.uint8Array({ minLength: 32, maxLength: 64 }), (s, other) => {
        fc.pre(!Buffer.from(other).equals(KEY));
        assert.equal(verifySession(signSession(s, KEY), ctx(s, { key: other })).kind, 'invalid');
      }),
    );
  });

  it('any now at or after exp is expired, never valid', () => {
    fc.assert(
      fc.property(sessionArb, fc.nat({ max: 10 * 365 * 24 * 3_600_000 }), (s, after) => {
        assert.equal(verifySession(signSession(s, KEY), ctx(s, { now: s.exp + after })).kind, 'expired');
      }),
    );
  });

  it('any string that is not a v1 cookie signed by this key is invalid, and nothing throws', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string().map((x) => `v1.${x}`), fc.string().map((x) => `v2.${x}.${x}`)), (raw) => {
        assert.equal(verifySession(raw, { key: KEY, now: 0, allowedSubject: 'x', revoked: new Set() }).kind, 'invalid');
      }),
    );
  });

  it('a payload re-signed under another key, with this key\'s format, is invalid', () => {
    const s: Session = { sub: 'owner', iat: 1, exp: 10_000, sid: 'abcdefgh' };
    const forged = signSession({ ...s, exp: 9_999_999_999_999 }, key(9));
    const [, payload] = forged.split('.');
    const [, , mac] = signSession(s, KEY).split('.');
    assert.equal(verifySession(`v1.${payload}.${mac}`, ctx(s)).kind, 'invalid');
    assert.equal(verifySession(forged, ctx(s)).kind, 'invalid');
  });

  it('BR-91.5 and BR-94.1: another allowed subject, or a revoked id, is invalid', () => {
    const s: Session = { sub: 'owner', iat: 1, exp: 10_000, sid: 'abcdefgh' };
    const cookie = signSession(s, KEY);
    assert.equal(verifySession(cookie, ctx(s, { allowedSubject: 'Owner' })).kind, 'invalid');
    assert.equal(verifySession(cookie, ctx(s, { revoked: new Set(['abcdefgh']) })).kind, 'invalid');
    assert.equal(verifySession(undefined, ctx(s)).kind, 'invalid');
    assert.equal(verifySession('', ctx(s)).kind, 'invalid');
  });

  it('a short key cannot sign, and verifies nothing', () => {
    const s: Session = { sub: 'owner', iat: 1, exp: 10_000, sid: 'abcdefgh' };
    assert.throws(() => signSession(s, Buffer.alloc(31)));
    assert.equal(verifySession(signSession(s, KEY), ctx(s, { key: Buffer.alloc(31) })).kind, 'invalid');
  });
});

describe('SessionKeyStore against a real folder', () => {
  const withFolder = (fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'u11-key-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const s: Session = { sub: 'owner', iat: 1, exp: 10_000, sid: 'abcdefgh' };

  it('creates a 32-byte key when absent; a second store reads the SAME key and does not overwrite it', () => {
    withFolder((dir) => {
      const path = join(dir, 'secrets', 'session.key');
      const first = new SessionKeyStore(path).loadOrCreate();
      const second = new SessionKeyStore(path).loadOrCreate();
      assert.ok(first.ok && second.ok);
      if (first.ok && second.ok) {
        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(first.key.length, 32);
        assert.ok(first.key.equals(second.key));
      }
      if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    });
  });

  it('after replace(), a cookie signed with the old key verifies nothing; the new key is what a restart reads', () => {
    withFolder((dir) => {
      const path = join(dir, 'session.key');
      const store = new SessionKeyStore(path);
      const old = store.loadOrCreate();
      assert.ok(old.ok);
      if (!old.ok) return;
      const cookie = signSession(s, old.key);
      const fresh = store.replace();
      assert.ok(fresh.ok);
      if (!fresh.ok) return;
      assert.ok(!fresh.key.equals(old.key));
      assert.equal(verifySession(cookie, ctx(s, { key: fresh.key })).kind, 'invalid');
      const reread = new SessionKeyStore(path).loadOrCreate();
      assert.ok(reread.ok && reread.key.equals(fresh.key));
    });
  });

  it('a file that is not a key is refused, never replaced, and the reason does not quote it', () => {
    withFolder((dir) => {
      const path = join(dir, 'session.key');
      writeFileSync(path, 'hunter2-not-a-key\n');
      const r = new SessionKeyStore(path).loadOrCreate();
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(!r.reason.includes('hunter2'));
      assert.equal(readFileSync(path, 'utf8'), 'hunter2-not-a-key\n');
    });
  });
});
