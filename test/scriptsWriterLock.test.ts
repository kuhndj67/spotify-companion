/**
 * U10 (BR-78.7, P-79): every script that WRITES `history.db` holds the one writer lock, and the `docker ps` guard
 * it replaced is gone.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

// @ts-expect-error -- an .mjs script without type declarations; loaded through tsx, as the scripts run.
import { holdWriterLock } from '../scripts/backup-history.mjs';
import { WriterLock } from '../src/lock/WriterLock.js';

const WRITERS = [
  'backup-history.mjs',
  'restore-history.mjs',
  'reclassify-unobserved-tails.mjs',
  'repair-skip-source.mjs',
  'repair-backfill-timestamps.mjs',
];

describe('writing scripts take the writer lock (structural)', () => {
  for (const file of WRITERS) {
    it(`${file} awaits holdWriterLock and no longer has the docker ps guard`, () => {
      const code = readFileSync(join('scripts', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.match(code, /await holdWriterLock\(/);
      assert.doesNotMatch(code, /assertNobodyElseHoldsIt\(|i-have-stopped-the-container/);
    });
  }
});

describe('holdWriterLock', () => {
  const dirs: string[] = [];
  const locks: WriterLock[] = [];
  afterEach(() => {
    for (const l of locks.splice(0)) l.release();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('⭐ refuses while the app holds the database, naming it; proceeds once it is released', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'u10-scriptlock-'));
    dirs.push(dir);
    const db = join(dir, 'history.db');
    const timings = { heartbeatMs: 10, staleWindowMs: 120 };
    const app = new WriterLock({ databasePath: db, kind: 'app', appVersion: 'test', log: () => {}, ...timings });
    locks.push(app);
    await app.acquire();
    app.startHeartbeat();

    await assert.rejects(holdWriterLock(db, 'db-backup', { ...timings, log: () => {} }), /in use by app .*Stop it first/);

    app.release();
    const script: WriterLock = await holdWriterLock(db, 'db-backup', { ...timings, log: () => {} });
    locks.push(script);
    assert.equal(script.state, 'held');
    assert.match(readFileSync(`${db}.lock`, 'utf8'), /"kind":"script:db-backup"/);
  });
});
