/**
 * U11 (LC-84, BR-91, P-91): the app's own session, as a cookie value the app signs and later verifies.
 *
 *   v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, "v1." + payload))>
 *
 * Nothing to negotiate: no algorithm field, no key id, no header. Verification, in this order and no other (P-91):
 * exactly three parts → version `v1` → recompute the MAC → compare in constant time after a length check → **only
 * then** parse the payload → check its shape, `exp`, the subject and revocation. Every failure is a value
 * (`invalid` or `expired`), never an exception that reaches a caller (P-92).
 *
 * Deterministic given its arguments: the clock (`now`), the key and the session id are all passed in. ⚠️ Not in
 * `purity.test.ts`'s list only because that list forbids `node:crypto` as a whole (for `randomBytes`); this module
 * uses only the HMAC and `timingSafeEqual`, and PBT-96 holds it to the property instead.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** BR-91.1: subject, issued-at, expires-at, a random session id. Nothing else. */
export interface Session {
  readonly sub: string;
  /** Milliseconds since the epoch. */
  readonly iat: number;
  readonly exp: number;
  readonly sid: string;
}

export type SessionVerdict =
  | { readonly kind: 'valid'; readonly session: Session }
  | { readonly kind: 'expired' }
  | { readonly kind: 'invalid' };

export const MIN_SESSION_KEY_BYTES = 32;
/** Far above any cookie this module writes (~200 bytes); refusing early bounds the work an attacker can ask for. */
const MAX_COOKIE_LENGTH = 1024;
const VERSION = 'v1';

export function signSession(session: Session, key: Uint8Array): string {
  assertKey(key);
  const payload = Buffer.from(JSON.stringify({ sub: session.sub, iat: session.iat, exp: session.exp, sid: session.sid }), 'utf8').toString('base64url');
  return `${VERSION}.${payload}.${mac(key, payload)}`;
}

export interface VerifyContext {
  readonly key: Uint8Array;
  readonly now: number;
  /** BR-91.5: rechecked on every request, so changing the allowed account ends the old one's sessions. */
  readonly allowedSubject: string;
  /** BR-94.1: ids signed out on this run, until their own expiry. */
  readonly revoked: { has(sid: string): boolean };
}

export function verifySession(cookie: string | undefined, context: VerifyContext): SessionVerdict {
  const invalid: SessionVerdict = { kind: 'invalid' };
  if (typeof cookie !== 'string' || cookie.length === 0 || cookie.length > MAX_COOKIE_LENGTH) return invalid;
  if (context.key.length < MIN_SESSION_KEY_BYTES) return invalid;

  const parts = cookie.split('.');
  if (parts.length !== 3) return invalid;
  const [version, payload, signature] = parts as [string, string, string];
  if (version !== VERSION) return invalid;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return invalid;

  const expected = Buffer.from(mac(context.key, payload), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return invalid;

  // Only now, with the MAC matched, is the payload ours to read.
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return invalid;
  }
  const session = asSession(parsed);
  if (session === null) return invalid;
  if (session.sub !== context.allowedSubject) return invalid;
  if (context.revoked.has(session.sid)) return invalid;
  if (context.now >= session.exp) return { kind: 'expired' };
  return { kind: 'valid', session };
}

function mac(key: Uint8Array, payload: string): string {
  return createHmac('sha256', key).update(`${VERSION}.${payload}`, 'utf8').digest('base64url');
}

function asSession(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sub !== 'string' || v.sub === '') return null;
  if (typeof v.sid !== 'string' || v.sid === '') return null;
  if (!Number.isSafeInteger(v.iat) || !Number.isSafeInteger(v.exp)) return null;
  if ((v.exp as number) <= (v.iat as number)) return null;
  return { sub: v.sub, iat: v.iat as number, exp: v.exp as number, sid: v.sid };
}

function assertKey(key: Uint8Array): void {
  // Signing is ours to get right, so a short key is a programming fault, not a verdict.
  if (key.length < MIN_SESSION_KEY_BYTES) throw new Error(`session key must be at least ${MIN_SESSION_KEY_BYTES} bytes`);
}
