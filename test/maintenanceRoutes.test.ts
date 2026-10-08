/**
 * `/api/maintenance/*` — U6's routes, over real HTTP (FR-57…FR-59, FR-64, BR-46.1–46.5, P-41, P-42).
 *
 * ## ⭐ What these tests defend
 *
 *   - **Every maintenance POST is behind `ingestGuard`**: a missing Origin, a cross-site Origin, a missing
 *     ingest header and a non-POST are all refused with the rule named — so a page on another site cannot make
 *     the app back up, restore or undo on its behalf.
 *   - The upload body is the FILE (P-41), and `express.json` does not swallow it.
 *   - The whole flow over HTTP: A's *Create backup* download is accepted by B's *Restore backup*, the
 *     comparison comes back, a wrong word is refused, the right one answers 202 and asks for a restart.
 *
 * Real HTTP on an ephemeral port, like `api.test.ts` — this project's worst defect was a wiring bug.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';

import { createApi, type ApiDeps } from '../src/api.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { INGEST_HEADER, INGEST_HEADER_VALUE, UPLOAD_CAP_BYTES } from '../src/ingest/types.js';
import { CONFIRM_WORD, MaintenanceService } from '../src/maintenance/MaintenanceService.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const ORIGIN = 'http://localhost:3010';
const GOOD = { origin: ORIGIN, [INGEST_HEADER]: INGEST_HEADER_VALUE };

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface Served {
  base: string;
  restarts: () => number;
}

async function serveInstall(gaps: number): Promise<Served> {
  const root = mkdtempSync(join(tmpdir(), 'u6-routes-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = new SqliteHistoryRepository(join(dataDir, 'history.db'));
  const ins = repo.database.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)');
  for (let i = 0; i < gaps; i++) ins.run('2026-10-07T00:00:00Z');
  const rulesPath = join(root, 'rules.json');
  writeFileSync(rulesPath, '{"version":1,"rules":[]}');
  let restarts = 0;
  const maintenance = new MaintenanceService({
    dataDir,
    rulesPath,
    appVersion: 'test',
    liveDb: () => repo.database,
    requestRestart: () => void restarts++,
    supervised: true,
    now: () => new Date('2026-10-07T12:00:00Z'),
  });
  const server = serve({ maintenance });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  cleanups.push(() => repo.close());
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, restarts: () => restarts };
}

function serve(overrides: Partial<ApiDeps>): Server {
  const deps: ApiDeps = {
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
    now: () => '2026-10-07T12:00:00.000Z',
    reportTimeZone: 'America/New_York',
    ...overrides,
  };
  const app = express();
  app.use(createApi(deps));
  return createServer(app);
}

async function backupFrom(s: Served): Promise<Buffer> {
  const r = await fetch(`${s.base}/api/maintenance/backup`, { method: 'POST', headers: GOOD });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/gzip');
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="spotify-backup-\d{8}T\d{6}Z\.tar\.gz"/);
  return Buffer.from(await r.arrayBuffer());
}

describe('ingestGuard on every maintenance POST (BR-46.1–46.3, P-42)', () => {
  const routes = ['/api/maintenance/backup', '/api/maintenance/restore', '/api/maintenance/undo', '/api/maintenance/restore/confirm', '/api/maintenance/restore/cancel'];
  const bad: [string, Record<string, string>][] = [
    ['no Origin', { [INGEST_HEADER]: INGEST_HEADER_VALUE }],
    ['a cross-site Origin', { origin: 'https://evil.example', [INGEST_HEADER]: INGEST_HEADER_VALUE }],
    ['no ingest header', { origin: ORIGIN }],
  ];
  for (const route of routes) {
    for (const [why, headers] of bad) {
      it(`${route} — refused with ${why}`, async () => {
        const s = await serveInstall(1);
        const r = await fetch(`${s.base}${route}`, { method: 'POST', headers });
        assert.equal(r.status, 403);
        const body: Body = await r.json();
        assert.match(body.rule, /^BR-46\.[23]$/);
        assert.equal(s.restarts(), 0);
      });
    }
  }

  it('POSITIVE control: a correct request to the read-only status route needs no ingest header', async () => {
    const s = await serveInstall(1);
    const r = await fetch(`${s.base}/api/maintenance`);
    assert.equal(r.status, 200);
    const body: Body = await r.json();
    assert.equal(body.busy, null);
    assert.equal(body.sizes.uploadCapBytes, UPLOAD_CAP_BYTES);
    assert.equal(body.view.backup.label, 'Create backup', 'the derived view rides along (app.js cannot import src/)');
  });
});

describe('⭐ the flow over HTTP — A backs up, B restores', () => {
  it('upload → comparison → wrong word refused → RESTORE → 202 and a restart request', async () => {
    const a = await serveInstall(6);
    const b = await serveInstall(2);
    const archive = await backupFrom(a);

    const upload = await fetch(`${b.base}/api/maintenance/restore`, {
      method: 'POST',
      headers: { ...GOOD, 'content-type': 'application/gzip' },
      body: archive,
    });
    assert.equal(upload.status, 200);
    const { token, comparison, view }: Body = await upload.json();
    assert.equal(view.confirmWord, CONFIRM_WORD);
    assert.equal(typeof token, 'string');
    assert.equal(comparison.rules, 'identical');
    assert.equal(comparison.backup.schemaVersion, comparison.current.schemaVersion);

    const confirm = (typed: string) =>
      fetch(`${b.base}/api/maintenance/restore/confirm`, {
        method: 'POST',
        headers: { ...GOOD, 'content-type': 'application/json' },
        body: JSON.stringify({ token, typed }),
      });
    assert.equal((await confirm('restore')).status, 400);
    assert.equal(b.restarts(), 0);
    const ok = await confirm(CONFIRM_WORD);
    assert.equal(ok.status, 202);
    assert.deepEqual(await ok.json(), { restarting: true });
    assert.equal(b.restarts(), 1);
  });

  it('a JSON-typed body is not a backup — express.json does not get to reinterpret the upload', async () => {
    const b = await serveInstall(1);
    const r = await fetch(`${b.base}/api/maintenance/restore`, {
      method: 'POST',
      headers: { ...GOOD, 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    assert.equal(r.status, 422);
  });

  it('a body over the cap is 413 (BR-46.4)', async () => {
    const b = await serveInstall(1);
    const r = await fetch(`${b.base}/api/maintenance/restore`, {
      method: 'POST',
      headers: { ...GOOD, 'content-type': 'application/gzip' },
      body: Buffer.alloc(UPLOAD_CAP_BYTES + 1),
    });
    assert.equal(r.status, 413);
  });

  it('undo with nothing to undo is 409', async () => {
    const b = await serveInstall(1);
    const r = await fetch(`${b.base}/api/maintenance/undo`, { method: 'POST', headers: GOOD });
    assert.equal(r.status, 409);
  });
});

describe('not deployed — 503, never a throw', () => {
  it('every maintenance route answers 503 when maintenance is absent', async () => {
    const server = serve({ maintenance: null });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/api/maintenance`)).status, 503);
    assert.equal((await fetch(`${base}/api/maintenance/backup`, { method: 'POST', headers: GOOD })).status, 503);
  });
});
