/**
 * U10 — the step between opening history and writing to it (LC-71, BR-79, P-80).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import type { KeepResult } from '../src/backup/KeptBackupStore.js';
import { MIGRATIONS, migrate } from '../src/history/migrations.js';
import { BeforeChangeBackupFailed, prepareHistory } from '../src/history/prepareHistory.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';

const dirs: string[] = [];
const repos: SqliteHistoryRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) {
    try {
      r.close();
    } catch {
      // already closed
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A v7 database on disk, as every install has before U10, opened without migrating. */
function v7(): { path: string; repo: SqliteHistoryRepository } {
  const dir = mkdtempSync(join(tmpdir(), 'u10-prepare-'));
  dirs.push(dir);
  const path = join(dir, 'history.db');
  const db = new DatabaseSync(path);
  migrate(db, MIGRATIONS.filter((m) => m.version <= 7));
  db.exec("INSERT INTO recording_gap (occurred_at) VALUES ('2026-10-22T00:00:00Z')");
  db.close();
  const repo = new SqliteHistoryRepository(path, { migrate: false });
  repos.push(repo);
  return { path, repo };
}

const kept: KeepResult = { ok: true, path: 'x', bytes: 1, takenAt: 't', deleted: [] };

describe('prepareHistory', () => {
  it('⭐ a failed before-change backup refuses the migration and leaves the database exactly as it was', async () => {
    const { path, repo } = v7();
    repo.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = readFileSync(path);
    await assert.rejects(
      prepareHistory(repo, '1.0.0-beta.9', async () => ({ ok: false, reason: 'not enough disk space', spaceShort: { freeBytes: 1048576, neededBytes: 209715200 } })),
      (e: unknown) => {
        assert.ok(e instanceof BeforeChangeBackupFailed);
        assert.match((e as Error).message, /migration 7→8 · first run with version tracking.*not enough disk space \(1 MB free, 200 MB needed\)\. Your database was not changed/);
        return true;
      },
    );
    assert.equal(repo.schemaVersion, 7);
    assert.deepEqual(repo.pendingMigrations, [8]);
    repo.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    assert.deepEqual(readFileSync(path), before, 'not one byte changed');
  });

  it('backs up first, then migrates and records the version', async () => {
    const { repo } = v7();
    const reasons: string[] = [];
    const out = await prepareHistory(repo, '1.0.0-beta.9', async (reason) => {
      assert.equal(repo.schemaVersion, 7, 'the backup sees the database BEFORE the migration');
      reasons.push(reason);
      return kept;
    });
    assert.deepEqual(reasons, ['migration 7→8 · first run with version tracking']);
    assert.equal(out.backedUp, reasons[0]);
    assert.equal(repo.schemaVersion, 8);
    assert.equal(repo.lastAppVersion(), '1.0.0-beta.9');
  });

  it('⭐ a fresh install (empty database) is not backed up and records from its first start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'u10-fresh-'));
    dirs.push(dir);
    const repo = new SqliteHistoryRepository(join(dir, 'history.db'), { migrate: false });
    repos.push(repo);
    let calls = 0;
    await prepareHistory(repo, '1.0.0-beta.9', async () => (calls++, { ok: false, reason: 'the backup did not verify (incomplete)' }));
    assert.equal(calls, 0, 'no backup is attempted for an empty database');
    assert.equal(repo.schemaVersion, 8);
    assert.equal(repo.lastAppVersion(), '1.0.0-beta.9');
  });

  it('the same version again: no backup; another version: a backup naming both', async () => {
    const { repo } = v7();
    await prepareHistory(repo, '1.0.0-beta.9', async () => kept);
    let calls = 0;
    const again = await prepareHistory(repo, '1.0.0-beta.9', async () => (calls++, kept));
    assert.equal(calls, 0);
    assert.equal(again.backedUp, null);
    const reasons: string[] = [];
    await prepareHistory(repo, '1.0.0-beta.8', async (r) => (reasons.push(r), kept));
    assert.deepEqual(reasons, ['version 1.0.0-beta.9→1.0.0-beta.8'], 'a rollback is a change too (BR-79.5)');
  });
});
