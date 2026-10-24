/**
 * LC-32 — the Express face of `admitIngest` (P-42).
 *
 * Mounted on the maintenance routes ONLY, and always AFTER the app-wide `localGuard` / `decideAccess`, which is
 * not edited: it stays the one admission rule HTTP and the WebSocket upgrade share. This adds the stricter
 * conditions a route that can replace the corpus needs — `POST`, an `Origin` that is present and allowed, and
 * the ingest header.
 *
 * ⚠️ The origin rule is `localGuard`'s own `isAllowedOrigin`, imported — never a second copy. The 2026-09-05
 * WebSocket `403` was two copies of one rule that diverged.
 *
 * Reused unchanged by U7 for rules and credentials.
 */

import type { RequestHandler } from 'express';

import { isAllowedOrigin, type AdmittedAccess } from '../localGuard.js';
import { admitIngest } from './admitIngest.js';
import { INGEST_HEADER } from './types.js';

export const ingestGuard: RequestHandler = (req, res, next) => {
  // U11 (BR-92.4): the origin rule of the mode admission used, handed on by it. In server mode the loopback rule
  // would refuse the app's own pages. Absent (a route mounted without admission, as some tests do) → the loopback
  // rule, the stricter default.
  const access = res.locals.access as AdmittedAccess | undefined;
  const originAllowed = access?.originAllowed ?? isAllowedOrigin;
  const verdict = admitIngest(
    { method: req.method, origin: req.headers.origin, ingestHeader: req.get(INGEST_HEADER) },
    originAllowed,
  );
  if (!verdict.ok) {
    res.status(403).json({ error: verdict.detail, rule: verdict.rule });
    return;
  }
  next();
};
