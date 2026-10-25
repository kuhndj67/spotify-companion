/**
 * U11 (LC-88, BR-89, BR-90.5, BR-91.4, BR-92.3): the sign-in routes. 🔌 IMPURE. Mounted only in server mode, so
 * in local mode every `/auth/*` path is a `404` (BR-88.2).
 *
 * The flow (business-logic-model §2):
 *   GET /auth/sign-in?return=  → BR-89.6: with a provider portal configured and no `go=1`, the *Sign in first* page;
 *                                otherwise a PendingSignIn, a pre-sign-in cookie bound to its `state`, 302 to the provider
 *   GET /auth/callback         → consume it, check the cookie, redeem and verify (ProviderClient), check the
 *                                allowed account, issue the session cookie, 302 to the return path
 *   GET /auth/problem          → the problem page by reason
 *   GET /auth/signed-out       → the signed-out page
 *   GET /auth/session          → the session admission verified (NOT an open route: it needs one)
 *   POST /auth/sign-out        → BR-94.1: this session revoked, its live connections closed, the cookie expired
 *   POST /auth/sign-out-everywhere → BR-94.2: a new session key, every live connection closed, the cookie expired
 *   GET /auth/auth.css         → the pages' one stylesheet
 *
 * ⚠️ Admission is not decided here. `decideAccess` (in `localGuard.ts`) has already run for every request, and the
 * open routes are listed THERE. The session these routes read is the one admission put in `res.locals.access`;
 * the only cookie read here is the pre-sign-in cookie, which binds a callback to the browser that started it.
 *
 * ⚠️ Logged (BR-95.3, P-97): each outcome and its reason, the subject on success and on `wrong-account`, and the
 * provider client's error name and code. Never a code, a token, a cookie, `state`, `nonce` or the verifier.
 */

import express, { type Router, type Response } from 'express';
import { SESSION_COOKIE, readCookie, type AdmittedAccess } from '../localGuard.js';
import { AUTH_CSS, isSignInRefusal, problemPage, signedOutPage, signInFirstPage } from './authPages.js';
import type { PendingSignIns } from './pendingSignIns.js';
import { PENDING_TTL_MS } from './pendingSignIns.js';
import type { ProviderClient, SignInOutcome, SignInRefusal } from './ProviderClient.js';
import { safeReturnPath } from './returnPath.js';
import { signSession, type Session } from './session.js';
import { ingestGuard } from '../ingest/ingestGuard.js';

/** BR-89.2: binds a callback to the browser that started the sign-in. Not `__Host-`: that prefix requires path `/`. */
export const PRE_SIGN_IN_COOKIE = 'companion-signin';

export interface AuthRoutesDeps {
  readonly provider: Pick<ProviderClient, 'begin' | 'complete'>;
  readonly pending: PendingSignIns;
  readonly publicOrigin: string;
  readonly allowedSubject: string;
  readonly sessionLifetimeMs: number;
  /** BR-89.6: where the owner signs in at the provider first; null → the sign-in starts at once. */
  readonly providerPortal?: string | null;
  /** The current session key. A function, because *Sign out everywhere* replaces it (BR-94.2). */
  readonly sessionKey: () => Uint8Array;
  readonly now: () => number;
  /** A fresh random session id (BR-91.1). */
  readonly newSessionId: () => string;
  readonly log: (line: string) => void;
  /** BR-94.1: revoke this session and close its live connections. */
  readonly signOut?: (session: Session) => void;
  /** BR-94.2: replace the session key and close every live connection. */
  readonly signOutEverywhere?: () => { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

const STATUS_BY_REASON: Record<SignInRefusal, number> = {
  expired: 400,
  state: 400,
  'provider-error': 400,
  'provider-unreachable': 503,
  'provider-mismatch': 503,
  verification: 400,
  'wrong-account': 403,
};

export function createAuthRoutes(deps: AuthRoutesDeps): Router {
  const router = express.Router();
  const secure = '; Secure; HttpOnly; SameSite=Lax';

  const refuse = (res: Response, outcome: Extract<SignInOutcome, { ok: false }>, subject?: string) => {
    deps.log(
      `[access] sign-in refused: ${outcome.reason}` +
        (subject !== undefined ? ` (signed in as ${JSON.stringify(subject)})` : '') +
        (outcome.detail !== undefined ? ` [${outcome.detail}]` : ''),
    );
    res
      .status(STATUS_BY_REASON[outcome.reason])
      .type('html')
      .set('Cache-Control', 'no-store')
      .send(problemPage(outcome.reason, { publicOrigin: deps.publicOrigin, subject, providerError: outcome.providerError }));
  };

  router.get('/auth/sign-in', async (req, res) => {
    const returnPath = safeReturnPath(req.query.return);
    // BR-89.6: a provider whose sign-in page does not resume a request (Synology SSO Server, measured) is signed in to
    // first; Continue comes back here with go=1. Nothing is created before then, so the page costs no state.
    if (deps.providerPortal && req.query.go !== '1') {
      const continueHref = `/auth/sign-in?go=1&return=${encodeURIComponent(returnPath)}`;
      res.status(200).type('html').set('Cache-Control', 'no-store').send(signInFirstPage(deps.providerPortal, continueHref));
      return;
    }
    const started = await deps.provider.begin(returnPath);
    if (!started.ok) {
      refuse(res, started);
      return;
    }
    deps.pending.add(started.pending, deps.now());
    res.setHeader('Set-Cookie', `${PRE_SIGN_IN_COOKIE}=${started.pending.state}; Path=/auth/; Max-Age=${PENDING_TTL_MS / 1000}${secure}`);
    // No body: Express's redirect() writes one that repeats the address, and with it `state` and `nonce`. They belong
    // in `Location` (BR-89.1), never on a page (BR-95.3; found by test/accessSecrets.test.ts).
    res.status(302).set('Cache-Control', 'no-store').set('Location', started.url).end();
  });

  router.get('/auth/callback', async (req, res) => {
    // The pre-sign-in cookie is spent whatever happens next.
    res.setHeader('Set-Cookie', `${PRE_SIGN_IN_COOKIE}=; Path=/auth/; Max-Age=0${secure}`);
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const boundState = readCookie(req.headers.cookie, PRE_SIGN_IN_COOKIE);
    // Consumed by the first callback that names it, success or failure (BR-89.3).
    const pending = state === undefined ? undefined : deps.pending.consume(state, deps.now());
    if (boundState === undefined || (pending !== undefined && boundState !== state)) {
      refuse(res, { ok: false, reason: 'state' });
      return;
    }
    if (pending === undefined) {
      refuse(res, { ok: false, reason: 'expired' });
      return;
    }

    const outcome = await deps.provider.complete(new URL(req.originalUrl, deps.publicOrigin), pending);
    if (!outcome.ok) {
      refuse(res, outcome);
      return;
    }
    // BR-90.5: exactly, case-sensitive. No session for anyone else.
    if (outcome.subject !== deps.allowedSubject) {
      refuse(res, { ok: false, reason: 'wrong-account' }, outcome.subject);
      return;
    }

    const now = deps.now();
    const exp = now + deps.sessionLifetimeMs;
    const cookie = signSession({ sub: outcome.subject, iat: now, exp, sid: deps.newSessionId() }, deps.sessionKey());
    res.append('Set-Cookie', `${SESSION_COOKIE}=${cookie}; Path=/; Max-Age=${Math.floor(deps.sessionLifetimeMs / 1000)}${secure}`);
    deps.log(`[access] sign-in completed for ${JSON.stringify(outcome.subject)}; session ends ${new Date(exp).toISOString()}`);
    res.set('Cache-Control', 'no-store').redirect(302, pending.returnPath);
  });

  router.get('/auth/problem', (req, res) => {
    const reason = isSignInRefusal(req.query.reason) ? req.query.reason : 'verification';
    // No subject and no provider error from the query: a link must not be able to put words on this page.
    res.status(200).type('html').set('Cache-Control', 'no-store').send(problemPage(reason, { publicOrigin: deps.publicOrigin }));
  });

  router.get('/auth/signed-out', (_req, res) => {
    res.status(200).type('html').set('Cache-Control', 'no-store').send(signedOutPage());
  });

  router.get('/auth/auth.css', (_req, res) => {
    res.type('css').send(AUTH_CSS);
  });

  // BR-94: state-changing, so admission has already required the public Origin (BR-92.4), and `ingestGuard` adds the
  // app's own header. Both answer JSON naming the page to go to; the page navigates there.
  const expireCookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0${secure}`;
  router.post('/auth/sign-out', ingestGuard, (_req, res) => {
    const session = (res.locals.access as AdmittedAccess | undefined)?.session;
    if (session === undefined || deps.signOut === undefined) {
      res.status(401).json({ signIn: '/auth/sign-in' });
      return;
    }
    deps.signOut(session);
    deps.log(`[access] signed out ${JSON.stringify(session.sub)} (this session)`);
    res.setHeader('Set-Cookie', expireCookie);
    res.set('Cache-Control', 'no-store').json({ next: '/auth/signed-out' });
  });

  router.post('/auth/sign-out-everywhere', ingestGuard, (_req, res) => {
    const session = (res.locals.access as AdmittedAccess | undefined)?.session;
    if (session === undefined || deps.signOutEverywhere === undefined) {
      res.status(401).json({ signIn: '/auth/sign-in' });
      return;
    }
    const outcome = deps.signOutEverywhere();
    if (!outcome.ok) {
      // The old key is still in force, so every session still is: say so, never claim it worked.
      deps.log(`[access] sign out everywhere FAILED: ${outcome.reason}`);
      res.status(500).json({ error: `Sign out everywhere did not happen: ${outcome.reason}` });
      return;
    }
    deps.log(`[access] signed out everywhere by ${JSON.stringify(session.sub)}: new session key, every connection closed`);
    res.setHeader('Set-Cookie', expireCookie);
    res.set('Cache-Control', 'no-store').json({ next: '/auth/signed-out' });
  });

  router.get('/auth/session', (_req, res) => {
    const session = (res.locals.access as AdmittedAccess | undefined)?.session;
    if (session === undefined) {
      // Admission should never let this through without one; refusing here costs nothing (P-92).
      res.status(401).json({ signIn: '/auth/sign-in' });
      return;
    }
    res.set('Cache-Control', 'no-store').json({ subject: session.sub, expiresAt: new Date(session.exp).toISOString(), publicOrigin: deps.publicOrigin });
  });

  return router;
}
