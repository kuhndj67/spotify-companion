/**
 * LC-32 — the stricter admission rule for routes that accept a file from outside (BR-46.1–46.3, P-42).
 *
 * Runs AFTER `decideAccess`, never instead of it, and never inside it. `decideAccess` stays the one rule
 * HTTP and the WebSocket upgrade share — the function the 2026-09-05 incident taught this project to change
 * least. An ingest route replaces the corpus, so it is held to more than the app-wide policy:
 *
 *   - `POST` only (BR-46.1)
 *   - an `Origin` is REQUIRED and must be allowed (BR-46.2). ⚠️ The app-wide `isAllowedOrigin` ADMITS a
 *     missing Origin; browsers always send one on POST, so its absence here means "not a browser".
 *   - the custom ingest header is present (BR-46.3) — a cross-site page cannot set it without a CORS
 *     preflight, which this app never grants.
 *
 * ⚠️ PURE. The loopback-origin rule is PASSED IN rather than imported, so the origin policy is still
 * written exactly once (in `localGuard.ts`) and this module stays free of Express.
 */

import { INGEST_HEADER, INGEST_HEADER_VALUE, type IngestRefusal } from './types.js';

export interface IngestRequest {
  readonly method: string;
  readonly origin: string | undefined;
  readonly ingestHeader: string | undefined;
}

export type IngestAdmission = { readonly ok: true } | ({ readonly ok: false } & IngestRefusal);

export function admitIngest(
  req: IngestRequest,
  isAllowedOrigin: (origin: string) => boolean,
): IngestAdmission {
  if (req.method !== 'POST') {
    return { ok: false, rule: 'BR-46.1', detail: `${req.method} is not accepted here; use POST` };
  }
  if (req.origin === undefined || req.origin === '') {
    return { ok: false, rule: 'BR-46.2', detail: 'an Origin header is required for this request' };
  }
  if (!isAllowedOrigin(req.origin)) {
    return { ok: false, rule: 'BR-46.2', detail: 'this Origin is not allowed' };
  }
  if (req.ingestHeader !== INGEST_HEADER_VALUE) {
    return { ok: false, rule: 'BR-46.3', detail: `the ${INGEST_HEADER} header is required for this request` };
  }
  return { ok: true };
}
