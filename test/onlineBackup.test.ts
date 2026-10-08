/**
 * LC-35 — *Create backup* from the live connection (FR-57, BR-44, P-38).
 *
 * ## ⭐ What these tests defend
 *
 *   - The 2026-10-07 probe, as a test: a backup taken WHILE the same connection is inserting rows comes out
 *     consistent and verifies as an upload would.
 *   - ⚠️ The archive's `history.db` is SELF-CONTAINED. The live database runs in WAL mode; if the copy kept a
 *     `-wal` beside it, the archive (which carries `history.db` alone) would silently lose the newest rows —
 *     the 824-of-850 shape, which reported `integrity_check: ok`.
 *   - The working directory is gone after cleanup, and nothing else is left in `data/.work/` (FR-62).
 */

import assert from 'node:assert/strict';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, it } from 'node:test';

import { verdictOf, verifyBackup } from '../src/backup/verifier.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { readArchive } from '../src/ingest/archive.js';
import { WORK_DIR_NAME, backupCapability, createBackup } from '../src/maintenance/onlineBackup.js';

const roots: string[] = [];
const repos: SqliteHistoryRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.close();
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function liveSetup(rows: number, withRules = true) {
  const root = mkdtempSync(join(tmpdir(), 'u6-online-'));
  roots.push(root);
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = new SqliteHistoryRepository(join(dataDir, 'history.db'));
  repos.push(repo);
  const ins = repo.database.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)');
  for (let i = 0; i < rows; i++) ins.run(`2026-10-07T00:00:00Z`);
  const rulesPath = join(root, 'rules.json');
  if (withRules) writeFileSync(rulesPath, '{"version":1,"rules":[]}');
  return { root, dataDir, repo, rulesPath, ins };
}

async function saveArchive(stream: NodeJS.ReadableStream, root: string): Promise<string> {
  const path = join(root, 'download.tar.gz');
  await pipeline(stream, createWriteStream(path));
  return path;
}

describe('createBackup', () => {
  it('this Node has backup() (the image pins a minor that does — IN-U6-1)', () => {
    assert.deepEqual(backupCapability(), { available: true });
  });

  it('⭐ a backup taken while the SAME connection inserts rows verifies as an upload would', async () => {
    const live = liveSetup(200);
    let writing = true;
    let written = 0;
    const writer = (async () => {
      while (writing) {
        live.ins.run('2026-10-07T01:00:00Z');
        written++;
        await new Promise((r) => setImmediate(r));
      }
    })();
    const result = await createBackup({
      liveDb: live.repo.database,
      dataDir: live.dataDir,
      rulesPath: live.rulesPath,
      appVersion: 'test',
      now: () => new Date('2026-10-07T12:00:00Z'),
    });
    writing = false;
    await writer;
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    if (!result.ok) return;

    const archive = await saveArchive(result.stream, live.root);
    result.cleanup();
    const staged = join(live.root, 'staged');
    mkdirSync(staged);
    const read = await readArchive(archive, staged);
    assert.equal(read.ok, true);

    // ⚠️ Self-contained: the archive's database carries no WAL, and still verifies on its own.
    assert.equal(existsSync(join(staged, 'history.db-wal')), false);
    const v = verifyBackup(staged, { untrusted: true });
    assert.equal(verdictOf(v), 'verified');
    const n = v.counts?.['recording_gap'] ?? -1;
    assert.ok(n >= 200 && n <= 200 + written, `copy is a point in time between the start and the end: ${n}`);
    assert.ok(written > 0, 'the writer must actually have interleaved, or this test proves nothing');
  });

  it('includes rules.json when it exists, and omits it when it does not (BR-45.5)', async () => {
    for (const withRules of [true, false]) {
      const live = liveSetup(3, withRules);
      const r = await createBackup({ liveDb: live.repo.database, dataDir: live.dataDir, rulesPath: live.rulesPath, appVersion: 't', now: () => new Date() });
      assert.equal(r.ok, true);
      if (!r.ok) continue;
      const staged = join(live.root, `staged-${withRules}`);
      mkdirSync(staged);
      const read = await readArchive(await saveArchive(r.stream, live.root), staged);
      r.cleanup();
      assert.equal(read.ok && read.entries.has('rules.json'), withRules);
    }
  });

  it('FR-62: after cleanup, nothing is left in data/.work/', async () => {
    const live = liveSetup(3);
    const r = await createBackup({ liveDb: live.repo.database, dataDir: live.dataDir, rulesPath: live.rulesPath, appVersion: 't', now: () => new Date() });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    await saveArchive(r.stream, live.root);
    r.cleanup();
    assert.deepEqual(readdirSync(join(live.dataDir, WORK_DIR_NAME)), []);
  });
});
