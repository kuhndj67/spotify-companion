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
 */

import type { Request, Response, NextFunction } from 'express';
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

export function localGuard(req: Request, res: Response, next: NextFunction): void {
  if (!config.localOnly) {
    next();
    return;
  }

  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).type('text/plain').send('This application only accepts local connections.');
    return;
  }

  if (!isLoopbackHostHeader(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
    res.status(403).type('text/plain').send('Invalid Host or Origin.');
    return;
  }

  next();
}
