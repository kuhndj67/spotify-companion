/**
 * LC-37 / LC-38 — the journaled startup swap and the leftovers sweep (BR-48.5–48.6, BR-50, P-43, P-44).
 *
 * ## ⭐ PBT-55 — the property this unit's safety rests on
 *
 * Power can fail between ANY two file operations of the swap. For every one of them, this test stops the
 * restorer dead there (a simulated crash skips every recovery path, as a power cut would), optionally deletes
 * the journal too, then starts again normally — and asserts:
 *
 *   1. `data/history.db` exists and passes `integrity_check` — **never missing, never empty**;
 *   2. it is either the OLD database or the NEW one, never a mixture;
 *   3. ⚠️ the OLD database survives somewhere (live, or in `previous/`) — the corpus being restored over is
 *      the one artefact that cannot be regenerated.
 *
 * The fault points are COUNTED from a clean run, not listed by hand, so a step added later is covered
 * automatically — a hand-written list would stop covering exactly the step someone forgot to add.
 *
 * The old database is left with a live `-wal` beside it, as production's is, so the "siblings move as a set"
 * rule is exercised: a WAL left beside a different database would be replayed into it.
 */

import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import { MANIFEST_NAME, maxIds, schemaVersionOf, sha256, tableCounts } from '../src/backup/manifest.js';
import { RulesWriter } from '../src/configuration/RulesWriter.js';
import { MIGRATIONS, migrate } from '../src/history/migrations.js';
import { hashRuleSetContent } from '../src/rules/ruleHash.js';
import {
  PENDING_DIR,
  PREVIOUS_DIR,
  READY_MARKER,
  STAGE_FILE,
  applyPendingRestore,
  finishRestoreRules,
  revertToPrevious,
  sweepLeftovers,
  type FaultPoint,
} from '../src/maintenance/startupRestorer.js';

const OLD_ROWS = 5;
const NEW_ROWS = 9;
const roots: string[] = [];
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function buildDb(path: string, rows: number): void {
  const db = new DatabaseSync(path);
  migrate(db, MIGRATIONS, '2026-10-07T00:00:00.000Z');
  db.exec('PRAGMA journal_mode = DELETE');
  const ins = db.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)');
  for (let i = 0; i < rows; i++) ins.run('2026-10-07T00:00:00Z');
  db.close();
}

/** data/ with an OLD database that has a live -wal beside it, and a verified NEW database staged and ready. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'u6-swap-'));
  roots.push(root);
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);

  // Old database in WAL mode, copied as a set while a connection holds it open — so the copy's -wal carries
  // committed rows that are NOT yet in the main file.
  const src = join(root, 'old.db');
  buildDb(src, 0);
  const live = new DatabaseSync(src);
  live.exec('PRAGMA journal_mode = WAL');
  live.exec('PRAGMA wal_autocheckpoint = 0');
  const ins = live.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)');
  for (let i = 0; i < OLD_ROWS; i++) ins.run('2026-10-07T00:00:00Z');
  for (const sfx of ['', '-wal', '-shm']) copyFileSync(`${src}${sfx}`, join(dataDir, `history.db${sfx}`));
  live.close();

  const pending = join(dataDir, PENDING_DIR);
  mkdirSync(pending);
  const staged = join(pending, 'history.db');
  buildDb(staged, NEW_ROWS);
  const ro = new DatabaseSync(staged, { readOnly: true });
  const counts = tableCounts(ro);
  writeFileSync(
    join(pending, MANIFEST_NAME),
    JSON.stringify({ manifestSchema: 1, takenAt: '2026-10-02T21:14:00Z', schemaVersion: schemaVersionOf(ro), sha256: { 'history.db': sha256(staged) }, counts, maxIds: maxIds(ro, counts) }),
  );
  ro.close();
  writeFileSync(join(pending, STAGE_FILE), JSON.stringify({ reason: 'restore' }));
  writeFileSync(join(pending, READY_MARKER), '');
  return dataDir;
}

/** Rows in a database (opened on a COPY of its set, so a probe never alters the evidence). `null` = absent. */
function rowsIn(dir: string): number | null {
  if (!existsSync(join(dir, 'history.db'))) return null;
  const probe = mkdtempSync(join(tmpdir(), 'u6-probe-'));
  try {
    for (const sfx of ['', '-wal', '-shm']) if (existsSync(join(dir, `history.db${sfx}`))) copyFileSync(join(dir, `history.db${sfx}`), join(probe, `history.db${sfx}`));
    const db = new DatabaseSync(join(probe, 'history.db'));
    try {
      assert.equal(String(db.prepare('PRAGMA integrity_check').get()?.integrity_check), 'ok', `${dir}/history.db fails integrity_check`);
      return Number(db.prepare('SELECT COUNT(*) AS c FROM recording_gap').get()?.c);
    } finally {
      db.close();
    }
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

class SimulatedCrash extends Error {
  readonly simulatedCrash = true;
}

function countFaultPoints(): string[] {
  const seen: string[] = [];
  const outcome = applyPendingRestore(fixture(), { fault: (l) => void seen.push(l) });
  assert.equal(outcome.kind, 'applied', 'the clean run must apply, or the fault points are counted from the wrong path');
  return seen;
}

describe('applyPendingRestore — the clean path', () => {
  it('swaps the staged database in, keeps the old one (with its WAL rows) in previous/, and cleans up', () => {
    const dataDir = fixture();
    const outcome = applyPendingRestore(dataDir);
    assert.deepEqual(outcome, { kind: 'applied', takenAt: '2026-10-02T21:14:00Z', plays: 0 });
    assert.equal(rowsIn(dataDir), NEW_ROWS);
    assert.equal(rowsIn(join(dataDir, PREVIOUS_DIR)), OLD_ROWS, 'the old database must arrive WITH the rows its -wal carried');
    assert.equal(existsSync(join(dataDir, PENDING_DIR)), false);
    assert.equal(existsSync(join(dataDir, 'history.db-wal')), false, 'no sibling of the old database may sit beside the new one');
  });

  it('no ready marker → nothing happens', () => {
    const dataDir = fixture();
    rmSync(join(dataDir, PENDING_DIR, READY_MARKER));
    assert.deepEqual(applyPendingRestore(dataDir), { kind: 'none' });
    assert.equal(rowsIn(dataDir), OLD_ROWS);
  });

  it('a staged file that no longer verifies is refused and the live database is untouched', () => {
    const dataDir = fixture();
    writeFileSync(join(dataDir, PENDING_DIR, 'history.db'), 'tampered after staging');
    const outcome = applyPendingRestore(dataDir);
    assert.equal(outcome.kind, 'failed');
    assert.equal(rowsIn(dataDir), OLD_ROWS);
    assert.equal(existsSync(join(dataDir, PENDING_DIR)), false);
  });
});

describe('applyPendingRestore — ⭐ PBT-55: a crash at EVERY step, then a normal start', () => {
  const points = countFaultPoints();

  it(`covers every fault point of a clean run (${points.length} found)`, () => {
    assert.ok(points.length >= 8, `suspiciously few fault points: ${points.join(', ')}`);
  });

  for (const deleteJournal of [false, true]) {
    for (let k = 0; k < points.length; k++) {
      it(`crash at #${k} (${points[k]})${deleteJournal ? ' + journal lost' : ''} → never empty, old corpus survives`, () => {
        const dataDir = fixture();
        let n = 0;
        const crashAt: FaultPoint = () => {
          if (n++ === k) throw new SimulatedCrash(`crash at ${points[k]}`);
        };
        assert.throws(() => applyPendingRestore(dataDir, { fault: crashAt }), SimulatedCrash);
        if (deleteJournal) rmSync(join(dataDir, PENDING_DIR, 'journal.json'), { force: true });

        // The next start.
        const outcome = applyPendingRestore(dataDir);
        sweepLeftovers(dataDir);

        const live = rowsIn(dataDir);
        assert.ok(live === OLD_ROWS || live === NEW_ROWS, `live database must be the old or the new one, got ${live}`);
        if (outcome.kind === 'applied') assert.equal(live, NEW_ROWS);
        const oldSurvives = live === OLD_ROWS || rowsIn(join(dataDir, PREVIOUS_DIR)) === OLD_ROWS;
        assert.ok(oldSurvives, 'the corpus that was restored over must survive, live or in previous/');
      });
    }
  }

  it('PBT-55 negative control: the harness DOES detect a missing database', () => {
    const dataDir = fixture();
    rmSync(join(dataDir, 'history.db'));
    assert.equal(rowsIn(dataDir), null);
  });
});

describe('applyPendingRestore — an ordinary error at every step is a FAILED restore with the old data put back', () => {
  const points = countFaultPoints();
  for (let k = 0; k < points.length; k++) {
    it(`error at #${k} (${points[k]})`, () => {
      const dataDir = fixture();
      let n = 0;
      const outcome = applyPendingRestore(dataDir, {
        fault: () => {
          if (n++ === k) throw new Error(`EBUSY at ${points[k]}`);
        },
      });
      sweepLeftovers(dataDir);
      const live = rowsIn(dataDir);
      if (outcome.kind === 'failed') assert.equal(live, OLD_ROWS, 'a failed restore must leave the old database live');
      else assert.equal(live, NEW_ROWS);
    });
  }
});

describe('revertToPrevious', () => {
  it('puts the previous database back after a restored one fails to open (BR-48.6)', () => {
    const dataDir = fixture();
    assert.equal(applyPendingRestore(dataDir).kind, 'applied');
    assert.equal(revertToPrevious(dataDir), true);
    assert.equal(rowsIn(dataDir), OLD_ROWS);
  });

  it('never empties data/: with no previous database it does nothing', () => {
    const dataDir = fixture();
    rmSync(join(dataDir, PENDING_DIR), { recursive: true });
    assert.equal(revertToPrevious(dataDir), false);
    assert.equal(rowsIn(dataDir), OLD_ROWS);
  });
});

describe('sweepLeftovers — LC-38 (BR-50.4, BR-50.6)', () => {
  it('removes .work/ contents and an incomplete restore-pending/, and touches nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'u6-sweep-'));
    roots.push(root);
    const keep = ['backup-before-x-20260101T000000Z', 'snapshots', 'reporting', 'CORRUPT-snapshot-20260921-201444', PREVIOUS_DIR];
    for (const d of keep) {
      mkdirSync(join(root, d));
      writeFileSync(join(root, d, 'f'), 'x');
    }
    mkdirSync(join(root, '.work', 'backup-abc'), { recursive: true });
    mkdirSync(join(root, '.work', 'upload-def'), { recursive: true });
    mkdirSync(join(root, PENDING_DIR));
    writeFileSync(join(root, PENDING_DIR, 'history.db'), 'half-staged, no ready marker');

    assert.equal(sweepLeftovers(root), 3);
    assert.deepEqual(readdirSync(join(root, '.work')), []);
    assert.equal(existsSync(join(root, PENDING_DIR)), false);
    for (const d of keep) assert.ok(existsSync(join(root, d, 'f')), `${d} must be untouched`);
  });

  it('leaves a READY restore-pending/ alone — that is an applicable restore, not a leftover', () => {
    const dataDir = fixture();
    assert.equal(sweepLeftovers(dataDir), 0);
    assert.ok(existsSync(join(dataDir, PENDING_DIR, READY_MARKER)));
  });
});

// ─── U7 — PBT-67: restore with rules (BR-59.4–59.6) ───────────────────────────────────────────────────────────

const CURRENT_RULES = JSON.stringify({ version: 1, rules: [{ id: 'mine', name: 'Mine', enabled: true, action: 'skip', onUnknown: 'no-match', dryRun: true, predicate: { kind: 'compare', field: 'album.ageYears', op: 'gt', value: 40 } }] });
const BACKUP_RULES = JSON.stringify({ version: 1, rules: [{ id: 'theirs', name: 'From the backup', enabled: true, action: 'skip', onUnknown: 'no-match', dryRun: true, predicate: { kind: 'compare', field: 'album.ageYears', op: 'gt', value: 10 } }] });

/** `fixture()` plus a config/rules.json beside data/, and the backup's rules staged — opted in or not. */
function fixtureWithRules(applyRules: boolean | 'u6-era'): { dataDir: string; rulesPath: string } {
  const dataDir = fixture();
  const rulesPath = join(dirname(dataDir), 'config', 'rules.json');
  mkdirSync(dirname(rulesPath));
  writeFileSync(rulesPath, CURRENT_RULES);
  const pending = join(dataDir, PENDING_DIR);
  writeFileSync(join(pending, 'rules.json'), BACKUP_RULES);
  writeFileSync(
    join(pending, STAGE_FILE),
    JSON.stringify(applyRules === true ? { reason: 'restore', applyRules: true, rulesHashAtConfirm: hashRuleSetContent(CURRENT_RULES) } : { reason: 'restore' }),
  );
  return { dataDir, rulesPath };
}

const writerFor = (rulesPath: string) => new RulesWriter({ rulesPath, watcher: null, now: () => Date.parse('2026-10-08T12:00:00Z') });

describe('U7 — restore with rules (BR-59)', () => {
  it('the restorer carries an opted-in rules file OUT of pending/ and never writes config/ itself', () => {
    const { dataDir, rulesPath } = fixtureWithRules(true);
    const outcome = applyPendingRestore(dataDir);
    assert.equal(outcome.kind, 'applied');
    assert.deepEqual(outcome.kind === 'applied' && outcome.rules, { content: BACKUP_RULES, expectedHash: hashRuleSetContent(CURRENT_RULES) });
    assert.equal(readFileSync(rulesPath, 'utf8'), CURRENT_RULES, 'config/ untouched by the restorer');
  });

  it('BR-59.4 + the U6 compatibility rule: a stage.json WITHOUT applyRules never carries rules', () => {
    const { dataDir } = fixtureWithRules('u6-era');
    const outcome = applyPendingRestore(dataDir);
    assert.equal(outcome.kind === 'applied' && outcome.rules, undefined);
    assert.equal(finishRestoreRules(outcome, true, writerFor('unused')), 'not-requested');
  });

  it('BR-59.5: applied after the database opens', () => {
    const { dataDir, rulesPath } = fixtureWithRules(true);
    const outcome = applyPendingRestore(dataDir);
    assert.equal(finishRestoreRules(outcome, true, writerFor(rulesPath)), 'applied');
    assert.equal(readFileSync(rulesPath, 'utf8'), BACKUP_RULES);
  });

  it('⚠️ BR-59.5: the restored database did NOT open → rules NOT applied', () => {
    const { dataDir, rulesPath } = fixtureWithRules(true);
    const outcome = applyPendingRestore(dataDir);
    const r = finishRestoreRules(outcome, false, writerFor(rulesPath));
    assert.ok(typeof r === 'object' && r !== null && 'skipped' in r);
    assert.equal(readFileSync(rulesPath, 'utf8'), CURRENT_RULES);
  });

  it('BR-59.6: a hand edit between confirm and startup → not applied, and says why', () => {
    const { dataDir, rulesPath } = fixtureWithRules(true);
    const outcome = applyPendingRestore(dataDir);
    writeFileSync(rulesPath, CURRENT_RULES.replace('Mine', 'Mine, edited'));
    const r = finishRestoreRules(outcome, true, writerFor(rulesPath));
    assert.ok(typeof r === 'object' && r !== null && /changed after you confirmed/.test(r.skipped));
    assert.match(readFileSync(rulesPath, 'utf8'), /edited/);
  });

  describe('⭐ PBT-67 — a crash at EVERY restorer step leaves the current rules untouched unless the restore completes', () => {
    const points = countFaultPoints();
    for (let k = 0; k < points.length; k++) {
      it(`crash at #${k} (${points[k]}) → rules are the current set, or the backup's only with the backup's history`, () => {
        const { dataDir, rulesPath } = fixtureWithRules(true);
        let n = 0;
        assert.throws(() => applyPendingRestore(dataDir, { fault: () => { if (n++ === k) throw new SimulatedCrash(points[k]); } }), SimulatedCrash);
        assert.equal(readFileSync(rulesPath, 'utf8'), CURRENT_RULES, 'a crash inside the restorer never touches config/');

        // The next start: restorer, then (database opened) the rules step.
        const outcome = applyPendingRestore(dataDir);
        sweepLeftovers(dataDir);
        finishRestoreRules(outcome, true, writerFor(rulesPath));

        const rules = readFileSync(rulesPath, 'utf8');
        assert.ok(rules === CURRENT_RULES || rules === BACKUP_RULES);
        if (rules === BACKUP_RULES) assert.equal(rowsIn(dataDir), NEW_ROWS, 'backup rules only ever arrive WITH the backup history');
      });
    }
  });
});
