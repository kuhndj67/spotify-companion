/**
 * Local-only access enforcement (Requirements Q7 and Q9).
 *
 * Q9 asked for security kept as simple as possible, but genuinely sufficient to ensure the
 * app is only ever reachable from this machine. Three cheap layers, no auth system:
 *
 *   1. compose.yaml publishes to 127.0.0.1 only, so the port isn't on the LAN.
 *   2. This guard rejects any request whose peer address isn't loopback — a backstop if the
 *      port binding is ever changed carelessly.
 *   3. Host/Origin validation, so a page on another site can't drive this app through the
 *      user's browser via DNS rebinding.
 *
 * ⚠️ **Layer 2 is unavailable in the container deployment**, and that is deliberate rather than
 * an oversight — see `AccessPolicy.trustPublishedPort`. Published-port traffic arrives from the
 * Docker bridge gateway, so the peer check can only ever refuse valid requests there. With it
 * disabled, layers 1 and 3 carry the whole posture: reachability is constrained by the
 * `127.0.0.1` publish, and DNS rebinding by Host/Origin.
 *
 * Measured before choosing this (2026-09-05): the default bridge network is **empty** and the
 * machine's other compose projects sit on their own networks, so no container can reach this
 * app. The residual exposure is host-local processes — which is equally true of the host
 * `npm start` deployment, and was accepted there.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Session, SessionVerdict } from './access/session.js';
import { config } from './config.js';
import { isIP } from 'node:net';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  // Express reports IPv4-mapped IPv6 for dual-stack sockets.
  const normalised = address.replace(/^::ffff:/, '');
  if (normalised === '::1') return true;
  if (isIP(normalised) === 4) return normalised.startsWith('127.');
  return false;
}

/**
 * Accepts "localhost:3000", "127.0.0.1:3000", "[::1]:3000" — with or without a port.
 *
 * The trailing content after the hostname must be validated, not merely discarded. An
 * earlier version took everything up to `]` for bracketed hosts and ignored the remainder,
 * which admitted `[::1].a.com` and `[::1]evil.com` — an attacker controls this header, so
 * that was a real bypass. Found by the property test asserting that appending any label to
 * a loopback name must not keep it loopback.
 */
export function isLoopbackHostHeader(value: string | undefined): boolean {
  if (!value) return false;

  let hostname: string;
  let remainder: string;

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return false;
    hostname = value.slice(0, close + 1);
    remainder = value.slice(close + 1);
  } else {
    const colon = value.indexOf(':');
    hostname = colon === -1 ? value : value.slice(0, colon);
    remainder = colon === -1 ? '' : value.slice(colon);
  }

  // Only an optional ":port" may follow the hostname.
  if (remainder !== '' && !/^:\d{1,5}$/.test(remainder)) return false;

  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/** Origin is absent on same-origin navigations; only validate it when present. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The two flags that decide admission, passed explicitly so the policy is testable without
 * mutating global config — and so that reading this file tells you the whole rule.
 */
export interface AccessPolicy {
  /** Enforce local-only access at all. Disable only for deliberate LAN exposure. */
  localOnly: boolean;
  /**
   * Skip the peer-address check ONLY, keeping Host/Origin validation (open item 1, option B,
   * chosen by the user 2026-09-05).
   *
   * ⚠️ This exists because inside a container the peer check **cannot** succeed for any
   * legitimate request. Traffic published through `127.0.0.1:3010:3000` arrives from the Docker
   * bridge gateway, never from loopback, so the check refuses every valid request while
   * defending against nothing. What actually constrains reachability in that deployment is the
   * `127.0.0.1` publish: without it the port is on the LAN; with it only host-local processes
   * can connect.
   *
   * It is **opt-in** rather than inferred from `inContainer`, so that enabling it is always a
   * deliberate deployment decision that appears in `compose.yaml` where it can be reviewed —
   * and so the host deployment keeps the strict check it can genuinely satisfy.
   */
  trustPublishedPort: boolean;
}

/**
 * The fields admission actually depends on, lifted out of `Request` so that the WebSocket
 * upgrade path — which has an `IncomingMessage` and a raw socket, not an Express `Request` —
 * can be judged by the *same* function rather than by a second copy of the rule.
 *
 * ⚠️ It was a second copy, in `server.ts`'s `upgrade` handler, and the copies diverged: option B
 * added `trustPublishedPort` to the HTTP path only, so in the container every HTTP request was
 * admitted while every WebSocket handshake was refused. The whole test suite passed, because the
 * tests exercised the policy function and the upgrade handler was not covered by any of them.
 * Keep exactly one rule.
 *
 * U11 (P-88): both call sites build this with {@link accessRequestFrom}, one helper, so neither reads a header or a
 * cookie itself. `method`, `path` and `sessionCookie` are read only by the server policy; local mode ignores them.
 */
export interface AccessRequest {
  remoteAddress: string | undefined;
  host: string | undefined;
  origin: string | undefined;
  method?: string | undefined;
  /** The path alone, without the query. */
  path?: string | undefined;
  /** The value of the session cookie, if the request carried one. */
  sessionCookie?: string | undefined;
}

/**
 * U11 (BR-92): the server policy. It replaces the local one entirely: `localOnly` and `trustPublishedPort` have no
 * effect in server mode (BR-88.5).
 */
export interface ServerAccessPolicy {
  readonly mode: 'server';
  /** `URL.host` of the public origin: what a browser sends as `Host` (BR-92.2). */
  readonly publicHost: string;
  /** `URL.origin` of the public origin. */
  readonly publicOrigin: string;
}

/** Why a request was refused, so callers can keep their own distinct responses (BR-92.5). */
export type AccessRefusal =
  | 'peer'
  | 'host-or-origin'
  /** U11 (BR-92.4): a state-changing request without an `Origin` equal to the public origin. */
  | 'cross-site'
  /** U11: no session, or one that failed verification (treated as absent, BR-91.2). */
  | 'no-session'
  | 'session-expired';

export type AccessDecision = { ok: true; session?: Session } | { ok: false; reason: AccessRefusal };

/** The session step, with its key, clock, allowed account and revocations already bound by the caller. */
export type SessionVerifier = (cookie: string | undefined) => SessionVerdict;

/** `__Host-` (BR-91.4): the browser sends it only over HTTPS, for exactly this host, at path `/`. */
export const SESSION_COOKIE = '__Host-companion-session';

/**
 * BR-92.3: the ONLY routes admitted without a session, and only for `GET` (and `HEAD`, which Express answers as
 * `GET`). The list is here, in the rule, not in the routes.
 *
 * ⚠️ Deviation from BR-92.3, which names three pages and a stylesheet: `/auth/signed-out` is added. *Sign out*
 * redirects there (BR-94.1), and by then there is no session to admit it with.
 */
export const OPEN_ROUTES: ReadonlySet<string> = new Set([
  '/auth/sign-in',
  '/auth/callback',
  '/auth/problem',
  '/auth/signed-out',
  '/auth/auth.css',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * BR-92.2: `Host` equals the public origin's host and port. The default port (443) may be omitted or explicit.
 * Nothing may follow: the same discipline as {@link isLoopbackHostHeader}, whose bypass was appended content.
 */
export function isPublicHostHeader(value: string | undefined, publicHost: string): boolean {
  if (!value) return false;
  const given = value.toLowerCase();
  const expected = publicHost.toLowerCase();
  if (given === expected) return true;
  // `URL.host` omits :443 for https, so an explicit :443 is the only other accepted spelling, and only then.
  const hasPort = expected.startsWith('[') ? /\]:\d+$/.test(expected) : expected.includes(':');
  return !hasPort && given === `${expected}:443`;
}

/** BR-92.2: an `Origin`, when present, equals the public origin exactly. */
export function isPublicOrigin(origin: string | undefined, publicOrigin: string): boolean {
  return origin === undefined || origin === publicOrigin;
}

/**
 * The admission rule. **The single source of truth** — HTTP and WebSocket both route here.
 *
 * ⚠️ Host/Origin validation is **not** conditional. It is the DNS-rebinding defence, it is the
 * check that caught a real bypass (see `isLoopbackHostHeader`), and under
 * `trustPublishedPort` it is the *only* remaining check — so it must never be skipped.
 *
 * U11 (BR-92.1): in server mode the order is Host/Origin → route class → session; the first failure decides. A
 * session step that throws is `no-session`, never an admission (P-92). Local mode is exactly the pre-U11 rule
 * (BR-92.6, PBT-100): it ignores `method`, `path` and `sessionCookie`.
 */
export function decideAccess(
  req: AccessRequest,
  policy: AccessPolicy | ServerAccessPolicy,
  verifySession?: SessionVerifier,
): AccessDecision {
  if ('mode' in policy && policy.mode === 'server') return decideServerAccess(req, policy, verifySession);
  const local = policy as AccessPolicy;

  if (!local.localOnly) return { ok: true };

  if (!local.trustPublishedPort && !isLoopbackAddress(req.remoteAddress)) {
    return { ok: false, reason: 'peer' };
  }

  if (!isLoopbackHostHeader(req.host) || !isAllowedOrigin(req.origin)) {
    return { ok: false, reason: 'host-or-origin' };
  }

  return { ok: true };
}

function decideServerAccess(
  req: AccessRequest,
  policy: ServerAccessPolicy,
  verifySession: SessionVerifier | undefined,
): AccessDecision {
  if (!isPublicHostHeader(req.host, policy.publicHost) || !isPublicOrigin(req.origin, policy.publicOrigin)) {
    return { ok: false, reason: 'host-or-origin' };
  }
  const method = (req.method ?? 'GET').toUpperCase();
  // BR-92.4: a browser sends the cookie on its own, but it does not let a page forge `Origin`. Absent is refused.
  if (!SAFE_METHODS.has(method) && req.origin !== policy.publicOrigin) return { ok: false, reason: 'cross-site' };

  if (SAFE_METHODS.has(method) && req.path !== undefined && OPEN_ROUTES.has(req.path)) return { ok: true };

  if (verifySession === undefined) return { ok: false, reason: 'no-session' };
  let verdict: SessionVerdict;
  try {
    verdict = verifySession(req.sessionCookie);
  } catch {
    return { ok: false, reason: 'no-session' };
  }
  if (verdict.kind === 'valid') return { ok: true, session: verdict.session };
  return { ok: false, reason: verdict.kind === 'expired' ? 'session-expired' : 'no-session' };
}

/**
 * U11 (P-88): the ONE builder of an {@link AccessRequest}, for the Express middleware and the upgrade handler alike.
 * Neither call site reads a header or the cookie itself.
 */
export function accessRequestFrom(incoming: IncomingMessage): AccessRequest {
  return {
    remoteAddress: incoming.socket?.remoteAddress,
    host: incoming.headers.host,
    origin: incoming.headers.origin,
    method: incoming.method,
    path: pathOf(incoming.url),
    sessionCookie: readCookie(incoming.headers.cookie, SESSION_COOKIE),
  };
}

function pathOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url, 'http://path.invalid').pathname;
  } catch {
    return undefined;
  }
}

/**
 * One cookie's value from a `Cookie` header. A name that appears twice counts as absent: two values for the session
 * cookie means something set one the app did not, and choosing between them would be a guess.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  let found: string | undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    if (found !== undefined) return undefined;
    found = part.slice(eq + 1).trim();
  }
  return found;
}

/**
 * What admission hands the routes after it (`res.locals.access`): the session it verified, and the `Origin` rule
 * of the mode in force, so `ingestGuard` checks the same origin admission did (U11: in server mode the loopback
 * rule would refuse every save).
 */
export interface AdmittedAccess {
  readonly session: Session | undefined;
  readonly originAllowed: (origin: string | undefined) => boolean;
}

export function applyAccessPolicy(
  req: Request,
  res: Response,
  next: NextFunction,
  policy: AccessPolicy | ServerAccessPolicy,
  verifySession?: SessionVerifier,
): void {
  const decision = decideAccess(accessRequestFrom(req), policy, verifySession);

  if (decision.ok) {
    const access: AdmittedAccess = {
      session: decision.session,
      originAllowed:
        'mode' in policy && policy.mode === 'server'
          ? (origin) => origin !== undefined && origin === policy.publicOrigin
          : isAllowedOrigin,
    };
    // Always present in Express. The pre-U11 tests' response doubles have none, and stay unchanged (BR-92.6).
    if (res.locals !== undefined) res.locals.access = access;
    next();
    return;
  }

  switch (decision.reason) {
    case 'peer':
      res.status(403).type('text/plain').send('This application only accepts local connections.');
      return;
    case 'host-or-origin':
      res.status(403).type('text/plain').send('Invalid Host or Origin.');
      return;
    case 'cross-site':
      res.status(403).type('text/plain').send('A change must come from this app\'s own pages.');
      return;
    case 'no-session':
    case 'session-expired':
      // BR-92.5: a page navigation goes to the sign-in; anything else (fetch, API) is told where it is.
      if (isNavigation(req)) {
        res.redirect(302, `/auth/sign-in?return=${encodeURIComponent(req.originalUrl ?? req.url ?? '/')}`);
      } else {
        res.status(401).json({ signIn: '/auth/sign-in' });
      }
      return;
  }
}

function isNavigation(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const mode = req.headers['sec-fetch-mode'];
  if (mode !== undefined) return mode === 'navigate';
  return (req.headers.accept ?? '').includes('text/html');
}

/** U11 (LC-83): the server-mode middleware, with the policy and the session step bound once at startup. */
export function serverGuard(policy: ServerAccessPolicy, verifySession: SessionVerifier): RequestHandler {
  return (req, res, next) => applyAccessPolicy(req, res, next, policy, verifySession);
}

export function localGuard(req: Request, res: Response, next: NextFunction): void {
  applyAccessPolicy(req, res, next, {
    localOnly: config.localOnly,
    trustPublishedPort: config.trustPublishedPort,
  });
}
