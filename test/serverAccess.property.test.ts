/**
 * U11 (LC-83, BR-92) — admission in server mode: PBT-93 (public Host/Origin), PBT-94 (`decideAccess`, server
 * policy), PBT-100 (local mode unchanged), and the middleware's responses by reason (BR-92.5).
 *
 * ⚠️ Positive controls: the configured host IS admitted (PBT-93), a valid session on a valid Host IS admitted
 * (PBT-94); a rule that refused everything would otherwise pass both.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import {
  OPEN_ROUTES,
  SESSION_COOKIE,
  decideAccess,
  isAllowedOrigin,
  isLoopbackAddress,
  isLoopbackHostHeader,
  isPublicHostHeader,
  isPublicOrigin,
  readCookie,
  serverGuard,
  type AccessPolicy,
  type AccessRequest,
  type ServerAccessPolicy,
  type SessionVerifier,
} from '../src/localGuard.js';
import { ingestGuard } from '../src/ingest/ingestGuard.js';
import { INGEST_HEADER } from '../src/ingest/types.js';
import type { Session } from '../src/access/session.js';

const POLICY: ServerAccessPolicy = { mode: 'server', publicHost: 'machine2.local:3443', publicOrigin: 'https://machine2.local:3443' };
const SESSION: Session = { sub: 'owner', iat: 0, exp: 1, sid: 'sid-1' };
const VALID: SessionVerifier = (cookie) => (cookie === 'good' ? { kind: 'valid', session: SESSION } : { kind: 'invalid' });

const hostLabel = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
const appended = fc.oneof(
  hostLabel.map((l) => `.${l}`),
  fc.string({ minLength: 1, maxLength: 6 }),
  fc.integer({ min: 0, max: 65535 }).map((p) => `:${p}`),
  fc.constantFrom('.', ':', '/', '@evil.com', '%00', ' ', '\t', '#'),
);

describe('public Host and Origin (PBT-93)', () => {
  it('⭐ the configured host is admitted, in any letter case; :443 is accepted only for a host without a port', () => {
    assert.equal(isPublicHostHeader('machine2.local:3443', POLICY.publicHost), true);
    assert.equal(isPublicHostHeader('MACHINE2.local:3443', POLICY.publicHost), true);
    assert.equal(isPublicHostHeader('machine2.local', 'machine2.local'), true);
    assert.equal(isPublicHostHeader('machine2.local:443', 'machine2.local'), true);
    assert.equal(isPublicHostHeader('machine2.local:3443:443', POLICY.publicHost), false);
    assert.equal(isPublicHostHeader('[fd00::1]:443', '[fd00::1]'), true);
    assert.equal(isPublicHostHeader('[fd00::1]:3443:443', '[fd00::1]:3443'), false);
  });

  it('appending ANY label, character or port to the configured host is refused', () => {
    fc.assert(
      fc.property(fc.constantFrom('machine2.local:3443', 'machine2.local', '[fd00::1]:3443'), appended, (host, extra) => {
        const given = host + extra;
        fc.pre(!(extra === ':443' && !host.endsWith(':3443')));
        assert.equal(isPublicHostHeader(given, host), false, given);
      }),
    );
  });

  it('any other host is refused, including the loopback names local mode admits', () => {
    fc.assert(
      fc.property(fc.oneof(hostLabel, fc.constantFrom('localhost:3000', '127.0.0.1', '192.168.0.223:3443', 'machine2:3443')), (other) => {
        fc.pre(other.toLowerCase() !== POLICY.publicHost);
        assert.equal(isPublicHostHeader(other, POLICY.publicHost), false);
      }),
    );
    assert.equal(isPublicHostHeader(undefined, POLICY.publicHost), false);
    assert.equal(isPublicHostHeader('', POLICY.publicHost), false);
  });

  it('an Origin is admitted iff absent or EXACTLY the public origin', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), appended.map((x) => POLICY.publicOrigin + x), fc.constant('http://machine2.local:3443')), (origin) => {
        assert.equal(isPublicOrigin(origin, POLICY.publicOrigin), origin === POLICY.publicOrigin);
      }),
    );
    assert.equal(isPublicOrigin(undefined, POLICY.publicOrigin), true);
  });
});

const method = fc.constantFrom('GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH');
const anyPath = fc.oneof(
  fc.constantFrom('/', '/api/now-playing', '/ws', '/app.js', '/api/diagnostics', '/auth/session', '/auth/sign-out', '/auth/sign-in/', '/AUTH/SIGN-IN', '/auth'),
  fc.webPath(),
  fc.constantFrom(...OPEN_ROUTES),
);
const requestArb: fc.Arbitrary<AccessRequest> = fc.record({
  remoteAddress: fc.constantFrom('127.0.0.1', '172.17.0.1', '192.168.0.50', undefined),
  host: fc.oneof(fc.constant(POLICY.publicHost), fc.constant('localhost:3000'), hostLabel),
  origin: fc.oneof(fc.constant(undefined), fc.constant(POLICY.publicOrigin), fc.constant('https://evil.example')),
  method,
  path: anyPath,
  sessionCookie: fc.constantFrom(undefined, 'good', 'bad', ''),
});

describe('decideAccess, server policy (PBT-94)', () => {
  it('for ANY request outside the open routes, no valid session → not admitted', () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const isOpen = (req.method === 'GET' || req.method === 'HEAD') && OPEN_ROUTES.has(req.path ?? '');
        fc.pre(!isOpen && req.sessionCookie !== 'good');
        assert.equal(decideAccess(req, POLICY, VALID).ok, false);
      }),
    );
  });

  it('a valid session with a wrong Host, or a foreign Origin, is never admitted', () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        fc.pre(req.host !== POLICY.publicHost || (req.origin !== undefined && req.origin !== POLICY.publicOrigin));
        const d = decideAccess({ ...req, sessionCookie: 'good' }, POLICY, VALID);
        assert.deepEqual(d, { ok: false, reason: 'host-or-origin' });
      }),
    );
  });

  it('a state-changing request needs an Origin equal to the public origin, even with a valid session (BR-92.4)', () => {
    fc.assert(
      fc.property(fc.constantFrom('POST', 'PUT', 'DELETE', 'PATCH'), anyPath, (m, path) => {
        const base = { remoteAddress: '192.168.0.50', host: POLICY.publicHost, method: m, path, sessionCookie: 'good' };
        assert.deepEqual(decideAccess({ ...base, origin: undefined }, POLICY, VALID), { ok: false, reason: 'cross-site' });
        assert.equal(decideAccess({ ...base, origin: POLICY.publicOrigin }, POLICY, VALID).ok, true);
      }),
    );
  });

  it('⭐ the open routes are admitted without a session, by GET or HEAD, only with a valid Host', () => {
    for (const path of OPEN_ROUTES) {
      for (const m of ['GET', 'HEAD']) {
        const ok = decideAccess({ remoteAddress: undefined, host: POLICY.publicHost, origin: undefined, method: m, path }, POLICY);
        assert.deepEqual(ok, { ok: true }, `${m} ${path}`);
        const wrongHost = decideAccess({ remoteAddress: undefined, host: 'evil.example', origin: undefined, method: m, path }, POLICY);
        assert.equal(wrongHost.ok, false);
      }
    }
  });

  it('⭐ a valid session on a valid Host is admitted, and the session is handed on', () => {
    const d = decideAccess({ remoteAddress: '192.168.0.50', host: POLICY.publicHost, origin: undefined, method: 'GET', path: '/', sessionCookie: 'good' }, POLICY, VALID);
    assert.deepEqual(d, { ok: true, session: SESSION });
  });

  it('P-92: a session step that THROWS, or none at all, is refused; expired is told apart', () => {
    const req: AccessRequest = { remoteAddress: undefined, host: POLICY.publicHost, origin: undefined, method: 'GET', path: '/', sessionCookie: 'good' };
    assert.deepEqual(decideAccess(req, POLICY, () => { throw new Error('boom'); }), { ok: false, reason: 'no-session' });
    assert.deepEqual(decideAccess(req, POLICY), { ok: false, reason: 'no-session' });
    assert.deepEqual(decideAccess(req, POLICY, () => ({ kind: 'expired' })), { ok: false, reason: 'session-expired' });
  });
});

/** ⚠️ FROZEN: `decideAccess` as it was before U11 (commit 6621d10). Do not edit; PBT-100 compares against it. */
function preU11DecideAccess(req: { remoteAddress: string | undefined; host: string | undefined; origin: string | undefined }, policy: AccessPolicy) {
  if (!policy.localOnly) return { ok: true };
  if (!policy.trustPublishedPort && !isLoopbackAddress(req.remoteAddress)) return { ok: false, reason: 'peer' };
  if (!isLoopbackHostHeader(req.host) || !isAllowedOrigin(req.origin)) return { ok: false, reason: 'host-or-origin' };
  return { ok: true };
}

describe('local mode is unchanged (PBT-100, BR-92.6)', () => {
  it('for ANY request and local policy, decideAccess equals the frozen pre-U11 rule, whatever the U11 fields say', () => {
    fc.assert(
      fc.property(
        fc.record({
          remoteAddress: fc.constantFrom('127.0.0.1', '::1', '::ffff:127.0.0.1', '172.17.0.1', '192.168.0.50', undefined),
          host: fc.oneof(fc.constantFrom('localhost:3000', '127.0.0.1:3010', '[::1]:3000', POLICY.publicHost, undefined), fc.string()),
          origin: fc.oneof(fc.constantFrom(undefined, 'http://localhost:3010', POLICY.publicOrigin), fc.string()),
          method,
          path: anyPath,
          sessionCookie: fc.constantFrom(undefined, 'good', 'bad'),
        }),
        fc.record({ localOnly: fc.boolean(), trustPublishedPort: fc.boolean() }),
        (req, policy) => {
          assert.deepEqual(decideAccess(req, policy, VALID), preU11DecideAccess(req, policy));
        },
      ),
    );
  });
});

describe('readCookie', () => {
  it('finds one cookie among others; a name given twice counts as absent', () => {
    assert.equal(readCookie(`a=1; ${SESSION_COOKIE}=v1.x.y; b=2`, SESSION_COOKIE), 'v1.x.y');
    assert.equal(readCookie(`${SESSION_COOKIE}=one; ${SESSION_COOKIE}=two`, SESSION_COOKIE), undefined);
    assert.equal(readCookie('companion-session=v1.x.y', SESSION_COOKIE), undefined);
    assert.equal(readCookie(undefined, SESSION_COOKIE), undefined);
  });
});


/** `fetch` will not send a `Host` of our choosing, so the middleware is driven through `node:http`. */
function send(base: string, path: string, init: { method?: string; headers: Record<string, string> }) {
  return new Promise<{ status: number; location: string | undefined; body: string }>((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the server-mode middleware, through Express (BR-92.5)', () => {
  async function withApp(fn: (base: string) => Promise<void>) {
    const app = express();
    app.use(serverGuard(POLICY, VALID));
    app.get('/', (_req, res) => res.send('app'));
    app.get('/api/thing', (_req, res) => res.json({ ok: true }));
    app.get('/auth/problem', (_req, res) => res.send('problem page'));
    app.post('/api/save', ingestGuard, (_req, res) => res.json({ saved: true }));
    app.get('/whoami', (_req, res) => res.json({ sub: res.locals.access?.session?.sub ?? null }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.close();
    }
  }
  const headers = (extra: Record<string, string> = {}) => ({ host: POLICY.publicHost, ...extra });

  it('a page navigation without a session → 302 to the sign-in, carrying the return path', async () => {
    await withApp(async (base) => {
      const r = await send(base, '/?tab=x', { headers: headers({ 'sec-fetch-mode': 'navigate' }) });
      assert.equal(r.status, 302);
      assert.equal(r.location, `/auth/sign-in?return=${encodeURIComponent('/?tab=x')}`);
    });
  });

  it('an API request without a session → 401 JSON naming the sign-in', async () => {
    await withApp(async (base) => {
      const r = await send(base, '/api/thing', { headers: headers() });
      assert.equal(r.status, 401);
      assert.deepEqual(JSON.parse(r.body), { signIn: '/auth/sign-in' });
    });
  });

  it('a wrong Host → 403 text, even with a valid session; an open route needs no session', async () => {
    await withApp(async (base) => {
      const bad = await send(base, '/', { headers: { host: 'evil.example', cookie: `${SESSION_COOKIE}=good` } });
      assert.equal(bad.status, 403);
      const open = await send(base, '/auth/problem', { headers: headers() });
      assert.equal(open.status, 200);
    });
  });

  it('⭐ with a valid session: admitted, and the routes after it see the session', async () => {
    await withApp(async (base) => {
      const r = await send(base, '/whoami', { headers: headers({ cookie: `${SESSION_COOKIE}=good` }) });
      assert.deepEqual(JSON.parse(r.body), { sub: 'owner' });
    });
  });

  it('ingestGuard in server mode: the public Origin plus the header is admitted; no header, or no Origin, is refused', async () => {
    await withApp(async (base) => {
      const cookie = `${SESSION_COOKIE}=good`;
      const ok = await send(base, '/api/save', { method: 'POST', headers: headers({ cookie, origin: POLICY.publicOrigin, [INGEST_HEADER]: '1' }) });
      assert.equal(ok.status, 200);
      const noHeader = await send(base, '/api/save', { method: 'POST', headers: headers({ cookie, origin: POLICY.publicOrigin }) });
      assert.equal(noHeader.status, 403);
      const noOrigin = await send(base, '/api/save', { method: 'POST', headers: headers({ cookie, [INGEST_HEADER]: '1' }) });
      assert.equal(noOrigin.status, 403);
    });
  });
});
