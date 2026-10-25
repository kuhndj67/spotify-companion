/**
 * U11 (P-94; BR-89, BR-90, BR-92.3) — the whole sign-in, through the app's REAL admission and routes, against a fake
 * provider that misbehaves on purpose. Each refusal is one switch and one test.
 *
 * ⚠️ The positive control is the first test: a clean sign-in COMPLETES and the session it issues is admitted. Every
 * refusal below would pass against a sign-in that never worked at all.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApi, type ApiDeps } from '../src/api.js';
import { ProviderClient } from '../src/access/ProviderClient.js';
import { PendingSignIns, PENDING_TTL_MS } from '../src/access/pendingSignIns.js';
import { verifySession } from '../src/access/session.js';
import { RevokedSessions } from '../src/access/liveConnections.js';
import { INGEST_HEADER } from '../src/ingest/types.js';
import { SESSION_COOKIE, readCookie, serverGuard, type ServerAccessPolicy } from '../src/localGuard.js';
import { PRE_SIGN_IN_COOKIE } from '../src/access/authRoutes.js';
import { startFakeOidcProvider, type FakeOidcProvider } from './support/fakeOidcProvider.js';

const PUBLIC_ORIGIN = 'https://app.test:3443';
const POLICY: ServerAccessPolicy = { mode: 'server', publicHost: 'app.test:3443', publicOrigin: PUBLIC_ORIGIN };
const LIFETIME_MS = 7 * 24 * 3_600_000;

function baseDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    repository: null,
    historyStartupError: null,
    exportService: null,
    likedSet: null,
    labelStartupError: null,
    observerStats: null,
    nowPlaying: { current: { playing: false } as never },
    listToolNames: async () => [],
    diagnostics: async () => ({ ok: true, steps: [] }) as never,
    likedFor: () => undefined,
    ruleSet: null,
    decisionLog: null,
    backTest: null,
    reloadRules: null,
    automation: null,
    skipExecutorEnabled: false,
    skipAttempts: null,
    now: () => new Date().toISOString(),
    reportTimeZone: 'America/New_York',
    ...overrides,
  };
}

interface Harness {
  base: string;
  logs: string[];
  clock: { now: number };
  key: Buffer;
  close(): Promise<void>;
}

async function startApp(provider: FakeOidcProvider, options: { issuer?: string; providerPortal?: string } = {}): Promise<Harness> {
  const logs: string[] = [];
  const clock = { now: Date.now() };
  let key = randomBytes(32);
  const revoked = new RevokedSessions(() => clock.now);
  const client = new ProviderClient({
    issuer: options.issuer ?? provider.issuer,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    redirectUri: `${PUBLIC_ORIGIN}/auth/callback`,
    fetch: provider.fetch,
    now: () => clock.now,
    retryIntervalMs: 0,
  });
  const app = express();
  app.use(
    serverGuard(POLICY, (cookie) =>
      verifySession(cookie, { key, now: clock.now, allowedSubject: 'owner', revoked }),
    ),
  );
  app.use(
    createApi(
      baseDeps({
        auth: {
          provider: client,
          pending: new PendingSignIns(),
          publicOrigin: PUBLIC_ORIGIN,
          allowedSubject: 'owner',
          sessionLifetimeMs: LIFETIME_MS,
          providerPortal: options.providerPortal ?? null,
          sessionKey: () => key,
          now: () => clock.now,
          newSessionId: () => randomBytes(16).toString('base64url'),
          log: (line) => logs.push(line),
          // As server.ts wires them (the live connections are covered in test/liveConnections.test.ts).
          signOut: (session) => revoked.add(session.sid, session.exp),
          signOutEverywhere: () => {
            key = randomBytes(32);
            revoked.clear();
            return { ok: true };
          },
        },
      }),
    ),
  );
  app.get('/', (_req, res) => res.send('the app'));
  const server: Server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    logs,
    clock,
    key,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

interface Reply {
  status: number;
  location: string | undefined;
  setCookies: string[];
  body: string;
}

/** A browser, reduced to what the flow needs: a cookie jar, `Host` set to the public origin's, no auto-follow. */
class Browser {
  readonly jar = new Map<string, string>();
  constructor(private readonly app: Harness) {}

  get(path: string, extra: Record<string, string> = {}, method = 'GET'): Promise<Reply> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${this.app.base}${path}`, { method, headers: { host: POLICY.publicHost, ...(cookie ? { cookie } : {}), ...extra } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const setCookies = res.headers['set-cookie'] ?? [];
          for (const line of setCookies) {
            const [pair, ...attrs] = line.split(';');
            const eq = pair!.indexOf('=');
            const name = pair!.slice(0, eq).trim();
            const value = pair!.slice(eq + 1).trim();
            if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '') this.jar.delete(name);
            else this.jar.set(name, value);
          }
          resolve({ status: res.statusCode ?? 0, location: res.headers.location, body, setCookies });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  /** `/auth/sign-in` → the provider's authorize endpoint → the callback address it redirects back to. */
  async startAndReachProvider(provider: FakeOidcProvider, returnPath = '/history'): Promise<{ signIn: Reply; callbackPath: string | null }> {
    const signIn = await this.get(`/auth/sign-in?return=${encodeURIComponent(returnPath)}`);
    if (signIn.status !== 302 || signIn.location === undefined || !signIn.location.startsWith(provider.issuer)) return { signIn, callbackPath: null };
    const atProvider = await provider.fetch(signIn.location, { redirect: 'manual' });
    const back = new URL(atProvider.headers.get('location') ?? '');
    assert.equal(back.origin, PUBLIC_ORIGIN, 'the provider redirects to the public origin');
    return { signIn, callbackPath: back.pathname + back.search };
  }

  async signIn(provider: FakeOidcProvider, returnPath = '/history'): Promise<Reply> {
    const { signIn, callbackPath } = await this.startAndReachProvider(provider, returnPath);
    if (callbackPath === null) return signIn;
    return this.get(callbackPath);
  }
}

let provider: FakeOidcProvider;
let app: Harness;

before(async () => {
  provider = await startFakeOidcProvider();
});
after(async () => {
  await provider.close();
});
beforeEach(async () => {
  provider.misbehave = {};
  provider.subject = 'owner';
  await app?.close();
  app = await startApp(provider);
});
after(async () => {
  await app?.close();
});

const reasonOf = (body: string) => /data-reason="([a-z-]+)"/.exec(body)?.[1];

describe('a clean sign-in (positive control)', () => {
  it('⭐ completes: 302 to the return path, a __Host- session cookie, and that session is admitted', async () => {
    const browser = new Browser(app);
    const done = await browser.signIn(provider, '/history?tab=week');
    assert.equal(done.status, 302, app.logs.join('\n'));
    assert.equal(done.location, '/history?tab=week');
    const cookieLine = done.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(cookieLine, 'session cookie set');
    for (const attr of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', `Max-Age=${LIFETIME_MS / 1000}`]) assert.ok(cookieLine!.includes(attr), attr);
    const session = await browser.get('/auth/session');
    assert.equal(session.status, 200);
    assert.equal(JSON.parse(session.body).subject, 'owner');
    const page = await browser.get('/');
    assert.equal(page.body, 'the app');
    assert.ok(app.logs.some((l) => l.startsWith('[access] sign-in completed for "owner"')));
  });

  it('without a session, the app is not served: a navigation goes to the sign-in', async () => {
    const r = await new Browser(app).get('/', { 'sec-fetch-mode': 'navigate' });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/auth/sign-in?return=%2F');
  });

  it('a hostile return path becomes /', async () => {
    const done = await new Browser(app).signIn(provider, '//evil.example/x');
    assert.equal(done.status, 302);
    assert.equal(done.location, '/');
  });

  it('BR-90.3: an aud array that contains the client, with azp the client, is ACCEPTED', async () => {
    provider.misbehave = { audArrayWithAzp: true };
    assert.equal((await new Browser(app).signIn(provider)).status, 302);
  });

  it('BR-90.6: a new key is fetched again at most once a minute: refused at once, accepted 60 s later', async () => {
    assert.equal((await new Browser(app).signIn(provider)).status, 302); // the first key set is now cached
    provider.rotate();
    provider.misbehave = { signWithSecondKey: true };
    const jwksFetches = () => provider.requests.filter((r) => r === 'GET /sso/jwks').length;
    const before = jwksFetches();
    const soon = await new Browser(app).signIn(provider);
    assert.equal(reasonOf(soon.body), 'verification', 'within a minute of the last fetch, no refetch');
    assert.equal(jwksFetches(), before);
    // The library's clock is Date.now(); move it past the minute.
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      app.clock.now = Date.now();
      const later = await new Browser(app).signIn(provider);
      assert.equal(later.status, 302, app.logs.join('\n'));
      assert.equal(jwksFetches(), before + 1, 'exactly one refetch');
    } finally {
      Date.now = realNow;
    }
  });
});

/** BR-90: each switch → refused at the callback with this reason, and no session. */
const ID_TOKEN_REFUSALS: ReadonlyArray<[string, FakeOidcProvider['misbehave']]> = [
  ['wrong iss', { wrongIss: true }],
  ['wrong aud', { wrongAud: true }],
  ['aud array without azp', { audArrayWithoutAzp: true }],
  ['expired', { expired: true }],
  ['iat in the future', { futureIat: true }],
  ['alg none', { algNone: true }],
  ['HS256 keyed with the public key', { hs256WithPublicKey: true }],
  ['unknown kid', { unknownKid: true }],
  ['tampered signature', { tamperedSignature: true }],
  ['wrong nonce', { wrongNonce: true }],
  ['token endpoint fails', { tokenEndpointFails: true }],
];

describe('the ID token is verified (BR-90): each misbehaviour is refused', () => {
  for (const [name, misbehave] of ID_TOKEN_REFUSALS) {
    it(`${name} → verification, 400, no session`, async () => {
      provider.misbehave = misbehave;
      const browser = new Browser(app);
      const r = await browser.signIn(provider);
      assert.equal(r.status, 400, r.body);
      assert.equal(reasonOf(r.body), 'verification');
      assert.ok(!browser.jar.has(SESSION_COOKIE));
      assert.ok(app.logs.some((l) => l.startsWith('[access] sign-in refused: verification')));
    });
  }

  it('BR-90.5: another account → 403 naming it, no session', async () => {
    provider.subject = 'Owner';
    const browser = new Browser(app);
    const r = await browser.signIn(provider);
    assert.equal(r.status, 403);
    assert.equal(reasonOf(r.body), 'wrong-account');
    assert.ok(r.body.includes('Signed in as <strong>Owner</strong>'));
    assert.ok(!browser.jar.has(SESSION_COOKIE));
  });

  it('the subject is escaped on the page', async () => {
    provider.subject = '<img src=x onerror=alert(1)>';
    const r = await new Browser(app).signIn(provider);
    assert.ok(!r.body.includes('<img'));
    assert.ok(r.body.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });
});

describe('the callback is bound to its sign-in (BR-89.4)', () => {
  it('the provider returned an error → provider-error, with its code on the page', async () => {
    provider.misbehave = { errorCallback: true };
    const r = await new Browser(app).signIn(provider);
    assert.equal(reasonOf(r.body), 'provider-error');
    assert.ok(r.body.includes('<code>access_denied</code>'));
  });

  it('a callback used twice (a replayed code) → expired the second time', async () => {
    const browser = new Browser(app);
    const { callbackPath } = await browser.startAndReachProvider(provider);
    const pre = browser.jar.get(PRE_SIGN_IN_COOKIE)!;
    assert.equal((await browser.get(callbackPath!)).status, 302);
    browser.jar.set(PRE_SIGN_IN_COOKIE, pre);
    const again = await browser.get(callbackPath!);
    assert.equal(reasonOf(again.body), 'expired');
  });

  it('no pre-sign-in cookie (another browser) → state', async () => {
    const browser = new Browser(app);
    const { callbackPath } = await browser.startAndReachProvider(provider);
    const otherBrowser = new Browser(app);
    assert.equal(reasonOf((await otherBrowser.get(callbackPath!)).body), 'state');
  });

  it("the cookie names another sign-in (another tab) → state", async () => {
    const browser = new Browser(app);
    const first = await browser.startAndReachProvider(provider);
    await browser.startAndReachProvider(provider); // overwrites the pre-sign-in cookie
    assert.equal(reasonOf((await browser.get(first.callbackPath!)).body), 'state');
  });

  it('an unknown state → expired', async () => {
    const browser = new Browser(app);
    await browser.startAndReachProvider(provider);
    assert.equal(reasonOf((await browser.get('/auth/callback?state=made-up&code=x')).body), 'expired');
  });

  it('a sign-in older than ten minutes → expired', async () => {
    const browser = new Browser(app);
    const { callbackPath } = await browser.startAndReachProvider(provider);
    app.clock.now += PENDING_TTL_MS;
    assert.equal(reasonOf((await browser.get(callbackPath!)).body), 'expired');
  });
});

describe('the provider itself (BR-88.6)', () => {
  it("discovery's issuer differs from the configured one → provider-mismatch at sign-in, 503", async () => {
    provider.misbehave = { discoveryIssuerMismatch: true };
    const r = await new Browser(app).get('/auth/sign-in');
    assert.equal(r.status, 503);
    assert.equal(reasonOf(r.body), 'provider-mismatch');
  });

  it('no PKCE S256 on offer → provider-mismatch', async () => {
    provider.misbehave = { noS256: true };
    assert.equal(reasonOf((await new Browser(app).get('/auth/sign-in')).body), 'provider-mismatch');
  });

  it('unreachable → provider-unreachable, 503; an existing session is unaffected', async () => {
    const browser = new Browser(app);
    assert.equal((await browser.signIn(provider)).status, 302);
    const dead = await startApp(provider, { issuer: 'https://localhost:1/sso' });
    try {
      const r = await new Browser(dead).get('/auth/sign-in');
      assert.equal(r.status, 503);
      assert.equal(reasonOf(r.body), 'provider-unreachable');
    } finally {
      await dead.close();
    }
    assert.equal((await browser.get('/')).body, 'the app');
  });

  it('the problem page by link shows no words from the link', async () => {
    const r = await new Browser(app).get('/auth/problem?reason=wrong-account&subject=%3Cb%3EZQXJ&providerError=ZQXK');
    assert.equal(r.status, 200);
    assert.ok(!r.body.includes('ZQXJ') && !r.body.includes('ZQXK'));
  });
});

describe('signing out (BR-94)', () => {
  const sameSite = { origin: 'https://app.test:3443', [INGEST_HEADER]: '1' };

  it('⭐ sign out: the cookie is expired, the session is refused afterwards, and the answer names the signed-out page', async () => {
    const browser = new Browser(app);
    assert.equal((await browser.signIn(provider)).status, 302);
    const cookie = browser.jar.get(SESSION_COOKIE)!;
    const out = await browser.get('/auth/sign-out', sameSite, 'POST');
    assert.equal(out.status, 200, out.body);
    assert.deepEqual(JSON.parse(out.body), { next: '/auth/signed-out' });
    assert.ok(out.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && /Max-Age=0/.test(c)));
    // Even a copy of the old cookie, kept by someone, is refused now (revoked until its expiry).
    const replay = new Browser(app);
    replay.jar.set(SESSION_COOKIE, cookie);
    assert.equal((await replay.get('/api/anything')).status, 401);
    assert.equal((await new Browser(app).get('/auth/signed-out')).status, 200, 'the signed-out page needs no session');
    assert.ok(app.logs.some((l) => l.startsWith('[access] signed out "owner"')));
  });

  it('sign out everywhere: two sessions, both refused afterwards', async () => {
    const one = new Browser(app);
    const two = new Browser(app);
    assert.equal((await one.signIn(provider)).status, 302);
    assert.equal((await two.signIn(provider)).status, 302);
    assert.equal((await one.get('/auth/session')).status, 200);
    const out = await one.get('/auth/sign-out-everywhere', sameSite, 'POST');
    assert.equal(out.status, 200, out.body);
    assert.equal((await one.get('/auth/session')).status, 401);
    assert.equal((await two.get('/auth/session')).status, 401);
  });

  it('BR-92.4: a sign-out from another site is refused, and changes nothing', async () => {
    const browser = new Browser(app);
    assert.equal((await browser.signIn(provider)).status, 302);
    assert.equal((await browser.get('/auth/sign-out', { [INGEST_HEADER]: '1' }, 'POST')).status, 403, 'no Origin');
    assert.equal((await browser.get('/auth/sign-out', { origin: 'https://evil.example', [INGEST_HEADER]: '1' }, 'POST')).status, 403);
    assert.equal((await browser.get('/auth/sign-out', { origin: 'https://app.test:3443' }, 'POST')).status, 403, 'no app header');
    assert.equal((await browser.get('/auth/session')).status, 200, 'still signed in');
  });

  it('without a session, sign-out is 401 (never a 500)', async () => {
    assert.equal((await new Browser(app).get('/auth/sign-out', sameSite, 'POST')).status, 401);
  });
});

describe('sign in at the provider first (BR-89.6)', () => {
  const PORTAL = 'https://sso.example:9443/';

  it('⭐ with a portal configured: the page first, then Continue starts the sign-in, which completes to the return path', async () => {
    const withPortal = await startApp(provider, { providerPortal: PORTAL });
    try {
      const browser = new Browser(withPortal);
      const first = await browser.get('/auth/sign-in?return=%2Fhistory%3Ftab%3Dweek');
      assert.equal(first.status, 200);
      assert.ok(first.body.includes('data-testid="sign-in-first"'));
      assert.ok(first.body.includes(`href="${PORTAL}" target="_blank" rel="noopener noreferrer"`), 'the portal, in a new tab');
      const cont = /data-testid="sign-in-continue" href="([^"]+)"/.exec(first.body)?.[1]?.replace(/&amp;/g, '&');
      assert.equal(cont, `/auth/sign-in?go=1&return=${encodeURIComponent('/history?tab=week')}`);
      assert.equal(browser.jar.has(PRE_SIGN_IN_COOKIE), false, 'the page creates no sign-in state');

      const started = await browser.get(cont!);
      assert.equal(started.status, 302);
      assert.ok(started.location?.startsWith(provider.issuer));
      const atProvider = await provider.fetch(started.location!, { redirect: 'manual' });
      const back = new URL(atProvider.headers.get('location') ?? '');
      const done = await browser.get(back.pathname + back.search);
      assert.equal(done.status, 302, withPortal.logs.join('\n'));
      assert.equal(done.location, '/history?tab=week');
      assert.ok(browser.jar.has(SESSION_COOKIE));
    } finally {
      await withPortal.close();
    }
  });

  it('a hostile return path is made safe before it reaches the Continue link', async () => {
    const withPortal = await startApp(provider, { providerPortal: PORTAL });
    try {
      const page = await new Browser(withPortal).get('/auth/sign-in?return=%2F%2Fevil.example%22%3E%3Cscript%3E');
      assert.ok(!page.body.includes('evil.example'));
      assert.ok(!page.body.includes('<script>'));
      assert.ok(page.body.includes('/auth/sign-in?go=1&amp;return=%2F'));
    } finally {
      await withPortal.close();
    }
  });

  it('without a portal (the default): /auth/sign-in goes straight to the provider, as before', async () => {
    const r = await new Browser(app).get('/auth/sign-in');
    assert.equal(r.status, 302);
    assert.ok(r.location?.startsWith(provider.issuer));
  });
});

describe('local mode (BR-88.2)', () => {
  it('no /auth/* route exists: each is a 404', async () => {
    const local = express();
    local.use(createApi(baseDeps()));
    const server = createServer(local);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const path of ['/auth/sign-in', '/auth/callback', '/auth/problem', '/auth/session', '/auth/signed-out']) {
        assert.equal((await fetch(`${base}${path}`)).status, 404, path);
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('the cookie helper reads only the named cookie', () => {
  it('readCookie', () => {
    assert.equal(readCookie(`${PRE_SIGN_IN_COOKIE}=abc; other=1`, PRE_SIGN_IN_COOKIE), 'abc');
  });
});
