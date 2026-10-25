/**
 * U11 (LC-96; P-88, P-90, P-96, BR-91.6) — structural guards for server mode, in the idiom of `purity.test.ts`.
 *
 *   1. One admission rule: the session cookie, the cookie parser and the session verifier are touched only by the
 *      rule (`localGuard.ts`), the sign-in routes (`access/authRoutes.ts`), their definition (`access/session.ts`) and
 *      the composition root that binds them (`server.ts`). A route that read the cookie itself would be a second
 *      rule, and second rules drift (the 2026-09-05 WebSocket 403).
 *   2. Recording never depends on access: no module on the poll and record path imports `src/access/`.
 *   3. `openid-client` is imported by `access/ProviderClient.ts` only, so replacing it changes one module.
 *
 * ⚠️ Positive controls: each scanner is seen to find a planted violation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

function sources(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sources(full) : name.endsWith('.ts') ? [full] : [];
  });
}
const rel = (full: string) => relative(SRC, full).replace(/\\/g, '/');
/** Code only: comments may mention these names while explaining them. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FILES = sources().map((f) => ({ path: rel(f), text: code(readFileSync(f, 'utf8')) }));

const SESSION_TOUCH = /\bSESSION_COOKIE\b|\breadCookie\(|\bverifySession\(|headers\.cookie\b/;
const MAY_TOUCH_SESSION = new Set(['localGuard.ts', 'access/authRoutes.ts', 'access/session.ts', 'server.ts']);

/** The poll and record path: everything that observes, records, backs up or acts on playback. */
const RECORDING_PATH = /^(history|playback|mcp|spotify|rules|backup|lock|export|musicbrainz|maintenance|ingest)\/|^nowPlayingService\.ts$|^pollBackoff\.ts$/;
const IMPORTS_ACCESS = /from\s+['"](?:\.\.?\/)+access\//;

function sessionTouchers(files: { path: string; text: string }[]): string[] {
  return files.filter((f) => !MAY_TOUCH_SESSION.has(f.path) && SESSION_TOUCH.test(f.text)).map((f) => f.path);
}
function recordingImportsAccess(files: { path: string; text: string }[]): string[] {
  return files.filter((f) => RECORDING_PATH.test(f.path) && IMPORTS_ACCESS.test(f.text)).map((f) => f.path);
}
function openidImporters(files: { path: string; text: string }[]): string[] {
  return files.filter((f) => /from\s+['"]openid-client['"]/.test(f.text)).map((f) => f.path);
}

describe('server mode, structurally', () => {
  it('1. only the admission rule and the sign-in routes touch the session cookie or the verifier', () => {
    assert.deepEqual(sessionTouchers(FILES), []);
  });

  it('2. no module on the poll and record path imports src/access/ (BR-91.6)', () => {
    assert.ok(FILES.filter((f) => RECORDING_PATH.test(f.path)).length > 20, 'the recording path was found');
    assert.deepEqual(recordingImportsAccess(FILES), []);
  });

  it('3. openid-client is imported by the provider client only', () => {
    assert.deepEqual(openidImporters(FILES), ['access/ProviderClient.ts']);
  });

  it('⭐ positive controls: each scanner finds a planted violation', () => {
    assert.deepEqual(sessionTouchers([{ path: 'api.ts', text: "const c = req.headers.cookie;" }]), ['api.ts']);
    assert.deepEqual(sessionTouchers([{ path: 'rules/x.ts', text: 'verifySession(c, ctx)' }]), ['rules/x.ts']);
    assert.deepEqual(recordingImportsAccess([{ path: 'history/PlayObserver.ts', text: "import { x } from '../access/session.js';" }]), ['history/PlayObserver.ts']);
    assert.deepEqual(openidImporters([{ path: 'api.ts', text: "import * as o from 'openid-client';" }]), ['api.ts']);
  });
});
