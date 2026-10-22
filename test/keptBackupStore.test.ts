/**
 * LC-73 — the kept-backup store (U10, BR-80, P-81, P-82), on real files in a temporary folder.
 */

import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { KeptBackupStore, type BackupKind } from '../src/backup/KeptBackupStore.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { readArchive } from '../src/ingest/archive.js';
import { MaintenanceService } from '../src/maintenance/MaintenanceService.js';
import { WORK_DIR_NAME } from '../src/maintenance/onlineBackup.js';

const roots: string[] = [];
const repos: SqliteHistoryRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.close();
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(opts: { keep?: Partial<Record<BackupKind, number>>; free?: number; clock?: { t: number } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'u10-kept-'));
  roots.push(root);
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const databasePath = join(dataDir, 'history.db');
  const repo = new SqliteHistoryRepository(databasePath);
  repos.push(repo);
  const ins = repo.database.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)');
  for (let i = 0; i < 20; i++) ins.run('2026-10-22T00:00:00Z');
  const rulesPath = join(root, 'rules.json');
  writeFileSync(rulesPath, '{"version":1,"rules":[]}');
  const clock = opts.clock ?? { t: Date.parse('2026-10-22T03:00:00Z') };
  const store = new KeptBackupStore({
    databasePath,
    rulesPath,
    appVersion: '1.0.0-test',
    now: () => new Date(clock.t),
    keep: { scheduled: 14, 'before-change': 5, ...opts.keep },
    ...(opts.free === undefined ? {} : { freeBytes: () => opts.free! }),
    log: () => {},
  });
  return { root, dataDir, databasePath, repo, rulesPath, store, clock };
}

describe('KeptBackupStore', () => {
  it('keeps the archive in backups/<kind>/, labelled with its kind and reason, and leaves no work file', async () => {
    const s = setup();
    const r = await s.store.keep(s.repo.database, 'before-change', 'migration 7→8');
    assert.equal(r.ok, true, r.ok ? '' : r.reason);
    if (!r.ok) return;
    assert.equal(r.path, join(s.dataDir, 'backups', 'before-change', 'spotify-backup-20261022T030000Z.tar.gz'));
    const staged = mkdtempSync(join(s.root, 'staged-'));
    const read = await readArchive(r.path, staged);
    assert.equal(read.ok, true);
    const manifest = JSON.parse(readFileSync(join(staged, 'manifest.json'), 'utf8'));
    assert.equal(manifest.label, 'before-change: migration 7→8');
    assert.equal(manifest.appVersion, '1.0.0-test');
    const work = join(s.dataDir, WORK_DIR_NAME);
    assert.deepEqual(existsSync(work) ? readdirSync(work).filter((n) => n.startsWith('keep-')) : [], []);
    assert.equal(s.store.newest('before-change')?.name, 'spotify-backup-20261022T030000Z.tar.gz');
    assert.equal(s.store.newest('scheduled'), null);
  });

  it('⭐ positive control: Restore backup accepts a kept backup through its upload path (BR-80.1)', async () => {
    const s = setup();
    const r = await s.store.keep(s.repo.database, 'scheduled', 'scheduled');
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const service = new MaintenanceService({
      dataDir: s.dataDir,
      rulesPath: s.rulesPath,
      appVersion: 'test',
      liveDb: () => s.repo.database,
      requestRestart: () => {},
      supervised: true,
      now: () => new Date(),
    });
    const received = await service.receiveUpload(createReadStream(r.path));
    assert.equal(received.ok, true, received.ok ? '' : `${received.reason}`);
    if (received.ok) service.cancel(received.token);
  });

  it('rotates each kind on its own and never touches other files', async () => {
    const s = setup({ keep: { scheduled: 2 } });
    mkdirSync(join(s.dataDir, 'snapshots'), { recursive: true });
    writeFileSync(join(s.dataDir, 'snapshots', 'history-snapshot-2026-10-03T01-11-20-888.csv'), 'old');
    mkdirSync(s.store.dirOf('scheduled'), { recursive: true });
    writeFileSync(join(s.store.dirOf('scheduled'), 'notes.txt'), 'mine');

    await s.store.keep(s.repo.database, 'before-change', 'version a→b');
    for (let i = 0; i < 4; i++) {
      s.clock.t += 24 * 3_600_000;
      const r = await s.store.keep(s.repo.database, 'scheduled', 'scheduled');
      assert.equal(r.ok, true);
    }
    assert.equal(s.store.count('scheduled'), 2);
    assert.equal(s.store.count('before-change'), 1, 'daily backups never push out a before-change one');
    assert.ok(existsSync(join(s.dataDir, 'snapshots', 'history-snapshot-2026-10-03T01-11-20-888.csv')));
    assert.ok(existsSync(join(s.store.dirOf('scheduled'), 'notes.txt')));
    assert.equal(s.store.newest('scheduled')?.name, 'spotify-backup-20261026T030000Z.tar.gz');
  });

  it('two backups in the same second do not overwrite each other', async () => {
    const s = setup();
    await s.store.keep(s.repo.database, 'scheduled', 'scheduled');
    await s.store.keep(s.repo.database, 'scheduled', 'scheduled');
    assert.deepEqual(readdirSync(s.store.dirOf('scheduled')).sort(), [
      'spotify-backup-20261022T030000Z-2.tar.gz',
      'spotify-backup-20261022T030000Z.tar.gz',
    ]);
    assert.equal(s.store.newest('scheduled')?.name, 'spotify-backup-20261022T030000Z-2.tar.gz');
  });

  it('short of space: no file is written, and the shortfall is reported in numbers', async () => {
    const s = setup({ free: 1024 });
    const r = await s.store.keep(s.repo.database, 'before-change', 'migration 7→8');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'not enough disk space');
    assert.equal(r.spaceShort?.freeBytes, 1024);
    assert.ok((r.spaceShort?.neededBytes ?? 0) >= 100 * 1024 * 1024);
    assert.deepEqual(readdirSync(s.store.dirOf('before-change')), []);
  });
});

describe('MaintenanceService.keepBackup (BR-80.5)', () => {
  it('shares the busy lock with Create backup: busy → 409; free → kept', async () => {
    const s = setup();
    const service = new MaintenanceService({
      dataDir: s.dataDir,
      rulesPath: s.rulesPath,
      appVersion: 'test',
      liveDb: () => s.repo.database,
      requestRestart: () => {},
      supervised: true,
      now: () => new Date(s.clock.t),
      keptBackups: s.store,
    });
    const download = await service.backup();
    assert.equal(download.ok, true);
    const busy = await service.keepBackup('scheduled', 'scheduled');
    assert.equal(busy.ok, false);
    if (!busy.ok && 'status' in busy) assert.equal(busy.status, 409);
    if (download.ok) download.cleanup();
    const kept = await service.keepBackup('scheduled', 'scheduled');
    assert.equal(kept.ok, true);
  });
});
