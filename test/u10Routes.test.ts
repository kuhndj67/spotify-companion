/**
 * U10 routes (FR-76b, FR-80…82): keep a backup for the release script, Settings' status, the two switches, and the
 * completed-download hook behind the weekly reminder (BR-87.1).
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';

import { createApi, type ApiDeps } from '../src/api.js';
import { KeptBackupStore } from '../src/backup/KeptBackupStore.js';
import { BackupReminder } from '../src/backup/backupReminder.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { INGEST_HEADER, INGEST_HEADER_VALUE } from '../src/ingest/types.js';
import { localGuard } from '../src/localGuard.js';
import { MaintenanceService } from '../src/maintenance/MaintenanceService.js';
import { UpdateChecker } from '../src/update/UpdateChecker.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ORIGIN = 'http://localhost:3010';
const GOOD = { origin: ORIGIN, [INGEST_HEADER]: INGEST_HEADER_VALUE, 'content-type': 'application/json' };

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function install() {
  const root = mkdtempSync(join(tmpdir(), 'u10-routes-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const databasePath = join(dataDir, 'history.db');
  const repo = new SqliteHistoryRepository(databasePath);
  cleanups.push(() => repo.close());
  const rulesPath = join(root, 'rules.json');
  writeFileSync(rulesPath, '{"version":1,"rules":[]}');
  const store = new KeptBackupStore({ databasePath, rulesPath, appVersion: 'test', now: () => new Date('2026-10-22T03:00:00Z'), keep: { scheduled: 14, 'before-change': 5 }, log: () => {} });
  const maintenance = new MaintenanceService({
    dataDir,
    rulesPath,
    appVersion: 'test',
    liveDb: () => repo.database,
    requestRestart: () => {},
    supervised: true,
    now: () => new Date('2026-10-22T03:00:00Z'),
    keptBackups: store,
  });
  const clock = { t: Date.parse('2026-10-22T03:00:00Z') };
  const reminder = new BackupReminder(join(root, 'state', 'backup-reminder.json'), () => new Date(clock.t));
  const updateChecker = new UpdateChecker({ path: join(root, 'state', 'update-check.json'), runningVersion: '1.0.0-beta.8', fetch: async () => new Response('[]'), log: () => {} });

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
    now: () => '2026-10-22T03:00:00.000Z',
    reportTimeZone: 'America/New_York',
    maintenance,
    appVersion: '1.0.0-beta.8',
    updateChecker,
    backupReminder: reminder,
    backupStatus: () => ({
      health: { level: 'ok', detail: 'fine' },
      scheduled: { newestAt: null, count: store.count('scheduled') },
      beforeChange: { newestAt: null, count: store.count('before-change') },
      folder: 'data/backups/',
    }),
    onBackupDownloaded: () => reminder.recordDownload(),
  };
  const app = express();
  app.use(localGuard);
  app.use(createApi(deps));
  const server: Server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://localhost:${port}`, port, store, reminder, updateChecker, clock };
}

describe('U10 routes', () => {
  it('POST /api/backups keeps a before-change backup and names its file; refused without the ingest guard', async () => {
    const s = await install();
    const refused = await fetch(`${s.base}/api/backups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(refused.status, 403);
    const r = await fetch(`${s.base}/api/backups`, { method: 'POST', headers: GOOD, body: JSON.stringify({ reason: 'release 1.0.0-beta.9' }) });
    const body: Body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.file, 'spotify-backup-20261022T030000Z.tar.gz');
    assert.ok(existsSync(join(s.store.dirOf('before-change'), body.file)));
  });

  it('GET /api/settings/status carries the version, the update check, the reminder and the backups', async () => {
    const s = await install();
    const body: Body = await (await fetch(`${s.base}/api/settings/status`)).json();
    assert.equal(body.appVersion, '1.0.0-beta.8');
    assert.equal(body.updateCheck.status, 'not-yet');
    assert.equal(body.backupReminder.enabled, true);
    assert.equal(body.backupReminder.verdict.level, 'ok');
    assert.equal(body.backups.folder, 'data/backups/');
  });

  it('the two switches: saved, validated, and refused from another site', async () => {
    const s = await install();
    for (const [route, read] of [
      ['/api/update-check', (b: Body) => b.status === 'off'],
      ['/api/backup-reminder', (b: Body) => b.enabled === false],
    ] as const) {
      const bad = await fetch(`${s.base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":"no"}' });
      assert.equal(bad.status, 400, route);
      const cross = await fetch(`${s.base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"enabled":false}' });
      assert.equal(cross.status, 403, `${route} from another site`);
      const ok = await fetch(`${s.base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":false}' });
      assert.equal(ok.status, 200);
      assert.ok(read(await ok.json()), route);
    }
    s.updateChecker.stop();
  });

  it('⭐ a COMPLETED Create backup download resets the reminder; one that never finishes does not', async () => {
    const s = await install();
    s.clock.t += 8 * 86_400_000;
    assert.equal(s.reminder.verdict().level, 'warn');

    // A download that cannot finish: a stream that sends a little and then waits forever.
    const { Readable } = await import('node:stream');
    let sent = false;
    const endless = new Readable({
      read() {
        if (!sent) {
          sent = true;
          this.push(Buffer.alloc(1024));
        }
      },
    });
    cleanups.push(() => void endless.destroy());
    const app = express();
    app.use(
      createApi({
        ...(await stubDeps()),
        maintenance: {
          backup: async () => ({
            ok: true,
            filename: 'spotify-backup-x.tar.gz',
            bytes: 10_000_000,
            stream: endless,
            summary: { takenAt: 't', plays: 0, schemaVersion: 8 },
            cleanup: () => {},
          }),
        } as never,
        onBackupDownloaded: () => s.reminder.recordDownload(),
      }),
    );
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
    const aborted = new AbortController();
    const r1 = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/api/maintenance/backup`, { method: 'POST', headers: GOOD, signal: aborted.signal });
    assert.equal(r1.status, 200);
    aborted.abort();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(s.reminder.state.lastDownloadAt, null, 'an unfinished download is not a copy');

    const r2 = await fetch(`${s.base}/api/maintenance/backup`, { method: 'POST', headers: GOOD });
    await r2.arrayBuffer();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(s.reminder.state.lastDownloadAt, 'recorded after a completed download');
    assert.equal(s.reminder.verdict().level, 'ok');
  });
});

/** The minimum ApiDeps for a stub server. */
async function stubDeps(): Promise<ApiDeps> {
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
    now: () => '2026-10-22T03:00:00.000Z',
    reportTimeZone: 'America/New_York',
  };
}
