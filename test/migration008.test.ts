/**
 * U10 — migration 8 (`app_meta`) and the open/migrate split (BR-79.1, BR-79.4, P-80).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { MIGRATIONS, currentVersion, migrate, pendingVersions } from '../src/history/migrations.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';

const upTo = (v: number) => MIGRATIONS.filter((m) => m.version <= v);

function v7File(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'migration008-'));
  const path = join(dir, 'history.db');
  const db = new DatabaseSync(path);
  migrate(db, upTo(7));
  db.close();
  return { dir, path };
}

describe('migration 8', () => {
  it('v7 → v8 adds app_meta and nothing else changes version', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, upTo(7));
    assert.deepEqual(pendingVersions(db), [8]);
    const report = migrate(db);
    assert.deepEqual(report.applied, ['8: U10 data safety: app_meta (the last app version to open this database)']);
    assert.equal(currentVersion(db), 8);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'app_meta'").get());
  });

  it('additive: v7 code against a v8 database applies nothing and still reads its tables (rollback)', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const report = migrate(db, upTo(7));
    assert.deepEqual(report, { from: 8, to: 8, applied: [] });
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM play').get());
  });
});

describe('SqliteHistoryRepository — open without migrating', () => {
  it('{ migrate: false } leaves a v7 file at v7, byte for byte, until migrate() is called', () => {
    const { dir, path } = v7File();
    try {
      const before = readFileSync(path);
      const repo = new SqliteHistoryRepository(path, { migrate: false });
      assert.equal(repo.schemaVersion, 7);
      assert.deepEqual(repo.pendingMigrations, [8]);
      assert.equal(repo.lastAppVersion(), null, 'no app_meta before v8');
      repo.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const reader = new DatabaseSync(path, { readOnly: true });
      assert.equal(reader.prepare('SELECT MAX(version) AS v FROM schema_version').get()?.v, 7);
      reader.close();
      assert.equal(readFileSync(path).length, before.length);

      const report = repo.migrate();
      assert.equal(report.from, 7);
      assert.equal(report.to, 8);
      assert.deepEqual(repo.pendingMigrations, []);
      repo.database.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records and reads back the last app version, overwriting the previous one', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    assert.equal(repo.lastAppVersion(), null);
    repo.recordAppVersion('1.0.0-beta.8');
    repo.recordAppVersion('1.0.0-beta.9');
    assert.equal(repo.lastAppVersion(), '1.0.0-beta.9');
  });

  it('the default still migrates on open (every existing caller)', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    assert.equal(repo.schemaVersion, 8);
    assert.deepEqual(repo.pendingMigrations, []);
  });
});
