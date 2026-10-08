/**
 * LC-34 — the backup verifier, moved into `src/backup/` (BR-47.1) and extended for untrusted input.
 *
 * ## ⭐ What these tests defend
 *
 *   - **PBT-53**: a backup round-trips — counts and sha256 identical — and a single deleted row is caught
 *     as a `mismatch`, which `integrity_check` alone cannot see.
 *   - **PBT-54**: a database carrying a trigger or a view is refused. A SQLite file is a program the engine
 *     runs; a trigger in an uploaded file fires on the APP's own later writes.
 *   - The schema allowlist accepts every name the app has EVER created — a legitimate v3 backup holds
 *     tables migration 004 later dropped, and refusing it would make old backups unrestorable.
 *   - A damaged file is a `corrupt` VERDICT, never an exception — an exception here would be a crash path
 *     reachable by upload.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';
import fc from 'fast-check';
import './fc-config.js';

import { MANIFEST_NAME, maxIds, schemaVersionOf, sha256, tableCounts } from '../src/backup/manifest.js';
import { verdictOf, verifyBackup } from '../src/backup/verifier.js';
import { MIGRATIONS, migrate } from '../src/history/migrations.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface MakeOptions {
  rows?: number;
  upToVersion?: number;
  /** Runs against the database AFTER the manifest is written — tampering the manifest cannot see coming. */
  tamper?: (db: DatabaseSync) => void;
  /** Runs BEFORE the manifest — a hostile file whose manifest honestly describes it. */
  hostile?: (db: DatabaseSync) => void;
  manifest?: boolean;
}

function makeBackup(options: MakeOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'u6-verifier-'));
  dirs.push(dir);
  const file = join(dir, 'history.db');
  const db = new DatabaseSync(file);
  const upTo = options.upToVersion ?? Math.max(...MIGRATIONS.map((m) => m.version));
  migrate(db, MIGRATIONS.filter((m) => m.version <= upTo), '2026-10-07T00:00:00.000Z');
  if (upTo >= 1) {
    const ins = db.prepare('INSERT INTO recording_gap (occurred_at) VALUES (?)');
    for (let i = 0; i < (options.rows ?? 3); i++) ins.run(`2026-10-07T00:00:${String(i % 60).padStart(2, '0')}Z`);
  }
  options.hostile?.(db);
  db.close();

  if (options.manifest !== false) {
    const ro = new DatabaseSync(file, { readOnly: true });
    const counts = tableCounts(ro);
    const manifest = {
      manifestSchema: 1,
      label: 'test',
      takenAt: '2026-10-07T00:00:00Z',
      schemaVersion: schemaVersionOf(ro),
      sha256: { 'history.db': sha256(file) },
      counts,
      maxIds: maxIds(ro, counts),
    };
    ro.close();
    writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(manifest));
  }
  if (options.tamper) {
    const rw = new DatabaseSync(file);
    options.tamper(rw);
    rw.close();
  }
  return dir;
}

describe('verifyBackup — PBT-53: a backup round-trips, and incompleteness is caught', () => {
  it('any number of rows verifies, untrusted, with counts and sha256 identical', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), (rows) => {
        const r = verifyBackup(makeBackup({ rows }), { untrusted: true });
        return verdictOf(r) === 'verified' && r.counts?.recording_gap === rows;
      }),
      { numRuns: 15 },
    );
  });

  it('negative control: ONE deleted row is a mismatch — and integrity_check alone still says ok', () => {
    const dir = makeBackup({ rows: 5, tamper: (db) => db.exec('DELETE FROM recording_gap WHERE id = (SELECT MAX(id) FROM recording_gap)') });
    const r = verifyBackup(dir, { untrusted: true });
    assert.equal(verdictOf(r), 'mismatch');
    assert.equal(r.checks.find((c) => c.name === 'integrity_check ok')?.ok, true);
  });
});

describe('verifyBackup — PBT-54: triggers and views are refused (BR-47.4)', () => {
  it('a backup carrying a trigger is refused-schema, even though its manifest honestly describes it', () => {
    const dir = makeBackup({
      hostile: (db) => db.exec(`CREATE TRIGGER evil AFTER INSERT ON recording_gap BEGIN DELETE FROM recording_gap; END`),
    });
    assert.equal(verdictOf(verifyBackup(dir, { untrusted: true })), 'refused-schema');
  });

  it('a backup carrying a view is refused-schema', () => {
    const dir = makeBackup({ hostile: (db) => db.exec('CREATE VIEW v AS SELECT 1') });
    assert.equal(verdictOf(verifyBackup(dir, { untrusted: true })), 'refused-schema');
  });

  it('an unknown table is refused-schema', () => {
    const dir = makeBackup({ hostile: (db) => db.exec('CREATE TABLE payload (x)') });
    assert.equal(verdictOf(verifyBackup(dir, { untrusted: true })), 'refused-schema');
  });

  it('negative control: the same backup WITHOUT the trigger verifies', () => {
    assert.equal(verdictOf(verifyBackup(makeBackup(), { untrusted: true })), 'verified');
  });

  it('the developer path (untrusted: false) still READS such a file — inspection is not restoration', () => {
    const dir = makeBackup({ hostile: (db) => db.exec('CREATE VIEW v AS SELECT 1') });
    assert.equal(verdictOf(verifyBackup(dir)), 'verified');
  });
});

describe('verifyBackup — schema versions (BR-47.5)', () => {
  it('⚠️ an OLDER schema holding tables a later migration dropped is accepted — the allowlist spans every version', () => {
    // v3 predates migration 004, which DROPPED artist_label and artist_label_signal_vote.
    const dir = makeBackup({ upToVersion: 3 });
    const names = (() => {
      const db = new DatabaseSync(join(dir, 'history.db'), { readOnly: true });
      const n = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => String(r.name));
      db.close();
      return n;
    })();
    assert.ok(names.includes('artist_label'), 'fixture must contain a table later dropped, or this test proves nothing');
    assert.equal(verdictOf(verifyBackup(dir, { untrusted: true })), 'verified');
  });

  it('a NEWER schema than this app supports is refused-schema', () => {
    const dir = makeBackup({ hostile: (db) => db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (999, ?)').run('2099-01-01') });
    assert.equal(verdictOf(verifyBackup(dir, { untrusted: true })), 'refused-schema');
  });
});

describe('verdictOf — the ONE classifier both scripts now share', () => {
  it('no manifest → unverifiable (intact, completeness unknown)', () => {
    assert.equal(verdictOf(verifyBackup(makeBackup({ manifest: false }))), 'unverifiable');
  });

  it('a manifest but no history.db → incomplete (the case the two old classifiers disagreed on)', () => {
    const dir = makeBackup();
    rmSync(join(dir, 'history.db'));
    assert.equal(verdictOf(verifyBackup(dir)), 'incomplete');
  });

  it('⚠️ a damaged file is a corrupt VERDICT, never an exception', () => {
    const dir = makeBackup();
    const file = join(dir, 'history.db');
    const bytes = readFileSync(file);
    // Keep the 100-byte header (so it still claims to be SQLite) and garble everything after it.
    for (let i = 100; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    writeFileSync(file, bytes);
    let r: ReturnType<typeof verifyBackup> | undefined;
    assert.doesNotThrow(() => {
      r = verifyBackup(dir, { untrusted: true });
    });
    assert.equal(verdictOf(r!), 'corrupt');
  });
});
