/**
 * U11 (P-94): the app's REAL admission and sign-in routes, served over HTTP on a random port against the fake provider,
 * and a minimal browser (a cookie jar, the public `Host`, no auto-follow). Shared by `signInFlow.test.ts` and
 * `accessSecrets.test.ts`, so the secrets test drives exactly what the flow test drives.
 *
 * The session pieces are wired as `server.ts` wires them (the live connections are covered in
 * `liveConnections.test.ts`).
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApi, type ApiDeps } from '../../src/api.js';
import { ProviderClient } from '../../src/access/ProviderClient.js';
import { PendingSignIns } from '../../src/access/pendingSignIns.js';
import { verifySession } from '../../src/access/session.js';
import { RevokedSessions } from '../../src/access/liveConnections.js';
import { serverGuard, type ServerAccessPolicy } from '../../src/localGuard.js';
import type { FakeOidcProvider } from './fakeOidcProvider.js';

export const PUBLIC_ORIGIN = 'https://app.test:3443';
export const POLICY: ServerAccessPolicy = { mode: 'server', publicHost: 'app.test:3443', publicOrigin: PUBLIC_ORIGIN };
export const LIFETIME_MS = 7 * 24 * 3_600_000;

export function baseDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
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

export interface Harness {
  base: string;
  logs: string[];
  clock: { now: number };
  key: Buffer;
  /** The session key in force now (*Sign out everywhere* replaces it). */
  keyNow(): Buffer;
  close(): Promise<void>;
}

export async function startApp(
  provider: FakeOidcProvider,
  options: { issuer?: string; providerPortal?: string; pending?: PendingSignIns } = {},
): Promise<Harness> {
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
          pending: options.pending ?? new PendingSignIns(),
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
    keyNow: () => key,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export interface Reply {
  status: number;
  location: string | undefined;
  setCookies: string[];
  body: string;
}

/** A browser, reduced to what the flow needs: a cookie jar, `Host` set to the public origin's, no auto-follow. */
export class Browser {
  readonly jar = new Map<string, string>();
  /** Every reply this browser received, for the secrets test to search. */
  readonly replies: Reply[] = [];
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
          const reply = { status: res.statusCode ?? 0, location: res.headers.location, body, setCookies };
          this.replies.push(reply);
          resolve(reply);
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
