/**
 * LC-36 — MaintenanceService: backup, restore, undo, the lock and the staging window (FR-57…59, BR-48, BR-49,
 * BR-51.3, P-40, P-41).
 *
 * ## ⭐ What these tests defend
 *
 *   - The whole round trip, in-process: installation A backs up; installation B receives the archive, shows
 *     the comparison, takes the typed confirmation, stages it, asks to restart — and the next "startup" puts A's
 *     history in B. Then undo puts B's own history back. This is U6's exit test without Docker.
 *   - **PBT-58**: the upload cap aborts at the first byte over, never after buffering the whole body — proven
 *     with an ENDLESS stream, which a buffer-then-check implementation would never return from.
 *   - Refusals leave nothing behind (FR-62), and nothing outside `data/.work/` changes before confirmation.
 *   - One operation at a time (BR-51.3), a staged upload expires (10 min), and the confirm word is exact.
 */

import assert from 'node:assert/strict';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, it } from 'node:test';
import fc from 'fast-check';
import './fc-config.js';

import { RulesWriter } from '../src/configuration/RulesWriter.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { CONFIRM_WORD, MaintenanceService, STAGING_TTL_MS } from '../src/maintenance/MaintenanceService.js';
import { WORK_DIR_NAME } from '../src/maintenance/onlineBackup.js';
import { PENDING_DIR, READY_MARKER, STAGE_FILE, applyPendingRestore, finishRestoreRules, type RestoreOutcome } from '../src/maintenance/startupRestorer.js';
import { hashRuleSetContent } from '../src/rules/ruleHash.js';

const roots: string[] = [];
const open: SqliteHistoryRepository[] = [];
afterEach(() => {
  for (const r of open.splice(0)) {
    try {
      r.close();
    } catch {
      /* already closed by the test */
    }
  }
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Install {
  root: string;
  dataDir: string;
  rulesPath: string;
  repo: SqliteHistoryRepository;
  service: MaintenanceService;
  restarts: number;
  clock: { t: number };
  caps?: { uploadBytes: number; expandedBytes: number };
}

function install(gaps: number, rules = '{"version":1,"rules":[]}', caps?: { uploadBytes: number; expandedBytes: number }): Install {
  const root = mkdtempSync(join(tmpdir(), 'u6-svc-'));
  roots.push(root);
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = new SqliteHistoryRepository(join(dataDir, 'history.db'));
  open.push(repo);
  const ins = repo.database.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)');
  for (let i = 0; i < gaps; i++) ins.run('2026-10-07T00:00:00Z');
  const rulesPath = join(root, 'rules.json');
  writeFileSync(rulesPath, rules);
  const clock = { t: Date.parse('2026-10-07T12:00:00Z') };
  const box: Install = { root, dataDir, rulesPath, repo, restarts: 0, clock, caps, service: undefined as unknown as MaintenanceService };
  box.service = newService(box);
  return box;
}

/** A service as the app builds one at startup. A restart builds a NEW one — the old one stays `restarting`. */
function newService(box: Install, startup?: { restore: RestoreOutcome; swept: number }): MaintenanceService {
  return new MaintenanceService({
    dataDir: box.dataDir,
    rulesPath: box.rulesPath,
    appVersion: 'test',
    liveDb: () => box.repo.database,
    requestRestart: () => void box.restarts++,
    supervised: true,
    now: () => new Date(box.clock.t),
    caps: box.caps,
    startup,
    // U7 (BR-59.1): the same comparison the Rules pop-up uses, through RulesWriter.
    rulesCandidate: (text) => rulesWriterFor(box).compareCandidate(text),
    currentRulesHash: () => rulesWriterFor(box).download()?.hash ?? null,
  });
}

function rulesWriterFor(box: Install): RulesWriter {
  return new RulesWriter({ rulesPath: box.rulesPath, watcher: null, now: () => box.clock.t });
}

function gapsIn(repo: SqliteHistoryRepository): number {
  return Number(repo.database.prepare('SELECT COUNT(*) AS c FROM recording_gap').get()?.c);
}

/** Simulate the restart: close the live connection, run the startup swap, reopen. */
function restart(box: Install): void {
  box.repo.close();
  const outcome = applyPendingRestore(box.dataDir);
  assert.equal(outcome.kind, 'applied', JSON.stringify(outcome));
  box.repo = new SqliteHistoryRepository(join(box.dataDir, 'history.db'));
  open.push(box.repo);
  box.service = newService(box, { restore: outcome, swept: 0 });
}

async function download(box: Install): Promise<string> {
  const r = await box.service.backup();
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  if (!r.ok) throw new Error('unreachable');
  const path = join(box.root, 'download.tar.gz');
  try {
    await pipeline(r.stream, createWriteStream(path));
  } finally {
    r.cleanup();
  }
  return path;
}

describe('⭐ the round trip — A backs up, B restores it, B undoes it', () => {
  it('moves A’s history into B, then puts B’s own history back', async () => {
    const a = install(7, '{"version":1,"rules":[{"id":"a"}]}');
    const b = install(2);
    const archive = await download(a);

    const received = await b.service.receiveUpload(createReadStream(archive));
    assert.equal(received.ok, true, received.ok ? '' : received.reason);
    if (!received.ok) return;
    assert.equal(received.comparison.rules, 'differs', 'rules are compared and reported (BR-48.7)');
    assert.equal(received.comparison.current.decisions, 0);

    // Nothing outside data/.work/ has changed before confirmation (P-40).
    assert.equal(existsSync(join(b.dataDir, PENDING_DIR)), false);
    assert.equal(gapsIn(b.repo), 2);

    assert.deepEqual(b.service.confirm(received.token, CONFIRM_WORD), { ok: true, restarting: true });
    assert.equal(b.restarts, 1);
    assert.ok(existsSync(join(b.dataDir, PENDING_DIR, READY_MARKER)));
    restart(b);
    assert.equal(gapsIn(b.repo), 7, 'B now holds A’s history');
    assert.equal(b.service.status().lastRestore?.kind, 'applied', 'the outcome is reported after the restart (BR-48.6)');
    assert.deepEqual(readdirSync(join(b.dataDir, WORK_DIR_NAME)), [], 'nothing left behind (FR-62)');

    // Undo (BR-49.2) — the same path, from previous/.
    assert.equal(b.service.status().previous !== null, true);
    const undo = b.service.prepareUndo();
    assert.equal(undo.ok, true, undo.ok ? '' : undo.reason);
    if (!undo.ok) return;
    assert.equal(b.service.confirm(undo.token, CONFIRM_WORD).ok, true);
    restart(b);
    assert.equal(gapsIn(b.repo), 2, 'B’s own history is back');
    // Undo is its own inverse (BR-49.3): A's history is now the previous one.
    assert.equal(b.service.prepareUndo().ok, true);
  });
});

describe('confirmation (BR-48.2) and the staging window', () => {
  it('the confirm word is exact — anything else is refused and nothing is staged', async () => {
    const a = install(1);
    const b = install(1);
    const r = await b.service.receiveUpload(createReadStream(await download(a)));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    for (const typed of ['restore', 'RESTORE ', '', 'yes']) {
      const c = b.service.confirm(r.token, typed);
      assert.equal(c.ok === false && c.status, 400);
    }
    assert.equal(existsSync(join(b.dataDir, PENDING_DIR)), false);
    assert.equal(b.restarts, 0);
  });

  it('a staged upload expires after the window, and its work dir is removed', async () => {
    const a = install(1);
    const b = install(1);
    const r = await b.service.receiveUpload(createReadStream(await download(a)));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    b.clock.t += STAGING_TTL_MS + 1;
    const c = b.service.confirm(r.token, CONFIRM_WORD);
    assert.equal(c.ok === false && c.status, 409);
    assert.deepEqual(readdirSync(join(b.dataDir, WORK_DIR_NAME)), []);
  });

  it('cancel removes the staged upload', async () => {
    const a = install(1);
    const b = install(1);
    const r = await b.service.receiveUpload(createReadStream(await download(a)));
    if (!r.ok) throw new Error(r.reason);
    b.service.cancel(r.token);
    assert.deepEqual(readdirSync(join(b.dataDir, WORK_DIR_NAME)), []);
  });
});

describe('refusals leave nothing behind (FR-62)', () => {
  it('a file that is not a backup is refused with a reason, and .work/ is empty afterwards', async () => {
    const b = install(1);
    const r = await b.service.receiveUpload(Readable.from([Buffer.from('not an archive at all')]));
    assert.equal(r.ok === false && r.status, 422);
    assert.deepEqual(readdirSync(join(b.dataDir, WORK_DIR_NAME)), []);
    assert.equal(gapsIn(b.repo), 1);
  });
});

describe('PBT-58 — the upload cap aborts at the first byte over (BR-46.4, P-41)', () => {
  it('for any cap, a body of exactly cap bytes passes the cap check, and cap+1 is refused as too large', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4096 }), fc.integer({ min: 1, max: 512 }), async (cap, chunk) => {
        const b = install(0, undefined, { uploadBytes: cap, expandedBytes: 1 << 20 });
        const body = (n: number) => {
          const parts: Buffer[] = [];
          for (let left = n; left > 0; left -= chunk) parts.push(Buffer.alloc(Math.min(chunk, left), 7));
          return Readable.from(parts);
        };
        const at = await b.service.receiveUpload(body(cap));
        const over = await b.service.receiveUpload(body(cap + 1));
        // At the cap: not refused for SIZE (it is refused later, as not-a-backup, which is the point).
        const atOk = at.ok === false && at.status === 422;
        const overOk = over.ok === false && over.status === 413 && over.rule === 'BR-46.4';
        return atOk && overOk && readdirSync(join(b.dataDir, WORK_DIR_NAME)).length === 0;
      }),
      { numRuns: 25 },
    );
  });

  it('⭐ an ENDLESS body is refused — a buffer-then-check implementation would never return', async () => {
    const b = install(0, undefined, { uploadBytes: 64 * 1024, expandedBytes: 1 << 20 });
    let produced = 0;
    const endless = new Readable({
      read() {
        produced += 16 * 1024;
        this.push(Buffer.alloc(16 * 1024));
      },
    });
    const r = await b.service.receiveUpload(endless);
    assert.equal(r.ok === false && r.status, 413);
    assert.ok(produced < 1024 * 1024, `stopped reading early (${produced} bytes produced)`);
  });
});

describe('one operation at a time (BR-51.3)', () => {
  it('a second backup while one is downloading is refused with 409, and allowed once it finishes', async () => {
    const a = install(1);
    const first = await a.service.backup();
    assert.equal(first.ok, true);
    const second = await a.service.backup();
    assert.equal(second.ok === false && second.status, 409);
    if (first.ok) {
      first.stream.resume();
      first.cleanup();
    }
    const third = await a.service.backup();
    assert.equal(third.ok, true);
    if (third.ok) {
      third.stream.resume();
      third.cleanup();
    }
  });

  it('status reports the lock, the caps and whether a restart is automatic', () => {
    const a = install(1);
    const s = a.service.status();
    assert.equal(s.busy, null);
    assert.equal(s.supervised, true);
    assert.ok(s.sizes.databaseBytes !== null && s.sizes.databaseBytes > 0);
    assert.equal(s.previous, null);
  });
});

// ─── U7 — restore can also restore rules, only if asked (FR-72, BR-59) ─────────────────────────────────────────

const ruleJson = (id: string) =>
  JSON.stringify({ version: 1, rules: [{ id, name: id, enabled: true, action: 'skip', onUnknown: 'no-match', dryRun: true, predicate: { kind: 'compare', field: 'album.ageYears', op: 'gt', value: 40 } }] });

describe('U7 — the opt-in rules choice in the restore flow', () => {
  it('BR-59.1: staging compares the backup’s rules through RulesWriter (added / removed by id)', async () => {
    const a = install(3, ruleJson('theirs'));
    const b = install(1, ruleJson('mine'));
    const received = await b.service.receiveUpload(createReadStream(await download(a)));
    assert.ok(received.ok);
    if (!received.ok) return;
    assert.equal(received.comparison.rules, 'differs');
    assert.deepEqual(received.comparison.rulesComparison?.added.map((r) => r.id), ['theirs']);
    assert.deepEqual(received.comparison.rulesComparison?.removed.map((r) => r.id), ['mine']);
    b.service.cancel(received.token);
  });

  it('opted IN: the rules travel into restore-pending/ with the hash confirmed against, and apply after the restart', async () => {
    const a = install(3, ruleJson('theirs'));
    const b = install(1, ruleJson('mine'));
    const received = await b.service.receiveUpload(createReadStream(await download(a)));
    if (!received.ok) assert.fail(received.reason);
    assert.deepEqual(b.service.confirm(received.token, CONFIRM_WORD, true), { ok: true, restarting: true });

    const pending = join(b.dataDir, PENDING_DIR);
    assert.equal(readFileSync(join(pending, 'rules.json'), 'utf8'), ruleJson('theirs'));
    assert.deepEqual(JSON.parse(readFileSync(join(pending, STAGE_FILE), 'utf8')), {
      reason: 'restore', applyRules: true, rulesHashAtConfirm: hashRuleSetContent(ruleJson('mine')),
    });
    assert.equal(readFileSync(b.rulesPath, 'utf8'), ruleJson('mine'), 'nothing in config/ changes before the restart');

    b.repo.close();
    const outcome = applyPendingRestore(b.dataDir);
    b.repo = new SqliteHistoryRepository(join(b.dataDir, 'history.db'));
    open.push(b.repo);
    assert.equal(finishRestoreRules(outcome, true, rulesWriterFor(b)), 'applied');
    assert.equal(readFileSync(b.rulesPath, 'utf8'), ruleJson('theirs'));
    assert.equal(gapsIn(b.repo), 3);
  });

  it('opted OUT (the default): no rules in restore-pending/, and the current rules survive the restore', async () => {
    const a = install(3, ruleJson('theirs'));
    const b = install(1, ruleJson('mine'));
    const received = await b.service.receiveUpload(createReadStream(await download(a)));
    if (!received.ok) assert.fail(received.reason);
    b.service.confirm(received.token, CONFIRM_WORD);
    assert.equal(existsSync(join(b.dataDir, PENDING_DIR, 'rules.json')), false);

    b.repo.close();
    const outcome = applyPendingRestore(b.dataDir);
    b.repo = new SqliteHistoryRepository(join(b.dataDir, 'history.db'));
    open.push(b.repo);
    assert.equal(finishRestoreRules(outcome, true, rulesWriterFor(b)), 'not-requested');
    assert.equal(readFileSync(b.rulesPath, 'utf8'), ruleJson('mine'));
  });

  it('BR-59.2: INVALID backup rules are reported with the validator’s reason, and cannot be opted in', async () => {
    const a = install(3, '{"version":1,"rules":[{"id":"broken"}]}');
    const b = install(1, ruleJson('mine'));
    const received = await b.service.receiveUpload(createReadStream(await download(a)));
    if (!received.ok) assert.fail(received.reason);
    assert.equal(received.comparison.rulesComparison, null);
    assert.ok((received.comparison.rulesInvalid?.length ?? 0) > 0);
    const r = b.service.confirm(received.token, CONFIRM_WORD, true);
    assert.ok(!r.ok && r.status === 400 && /not valid/.test(r.reason));
    b.service.cancel(received.token);
  });
});
