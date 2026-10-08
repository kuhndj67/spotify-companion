/**
 * LC-34 — verify a backup directory before anything may be restored from it.
 *
 * MOVED from `scripts/restore-history.mjs` (BR-47.1, Q4 = A). The app's *Restore backup* and the developer
 * `db:restore` / `db:verify-backups` scripts import this one copy. The eight original checks are unchanged;
 * U6 adds the untrusted-input checks of BR-47.2/47.4/47.5, which only bite on files from outside.
 *
 * ⚠️ It works on a COPY in a temp directory and never opens the backup in place. Opening a SQLite file
 * read-write modifies it — a verifier that mutated the thing it was checking would slowly consume the
 * backups it exists to protect, and even a read-only open recreates a WAL beside them.
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, migrate } from '../history/migrations.js';
import { MANIFEST_NAME, maxIds, schemaVersionOf, sha256, tableCounts, type BackupManifest } from './manifest.js';

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
  manifest: BackupManifest | null;
  schemaVersion?: number | null;
  counts?: Record<string, number>;
  maxIds?: Record<string, number | null>;
}

/**
 * The verdicts, kept distinct because conflating them is its own bug — an earlier script printed "could not
 * be checked against a manifest" for a backup whose manifest was present and DISAGREED.
 *
 *   verified        every check passed
 *   corrupt         integrity_check failed — the bytes are damaged
 *   mismatch        ⚠️ integrity is fine and the manifest disagrees: NOT the database that was backed up
 *   unverifiable    no manifest. Intact, completeness unknown (the pre-2026-09-27 backups)
 *   refused-schema  ⚠️ U6: contains something the app's schema never had (a trigger, a view, an unknown
 *                   object) or is newer than this app supports. Only reachable with `untrusted: true`
 *   incomplete      something else failed — e.g. `history.db` missing, or the schema unreadable
 *
 * ⚠️ `integrity_check` and the manifest catch DIFFERENT failures and neither catches the other's: a backup
 * with one play deleted returns `integrity_check: ok`, and the CORRUPT snapshot returns plausible counts.
 *
 * ⚠️ ONE classifier. Before U6 there were two — `classify()` in `restore-history.mjs` and inline logic in
 * `verify-all-backups.mjs` — which disagreed about a backup with a manifest but no `history.db` (one said
 * `mismatch`, the other "other"). Found while moving this file; both scripts now call this.
 */
export type Verdict = 'verified' | 'corrupt' | 'mismatch' | 'unverifiable' | 'refused-schema' | 'incomplete';

const MANIFEST_CHECKS = [
  'sha256 matches manifest',
  'schema_version matches manifest',
  'every table count matches manifest',
  'every max(id) matches manifest',
] as const;

const SCHEMA_CHECKS = ['no triggers or views', 'only known tables and indexes', 'schema not newer than this app'] as const;

export function verdictOf(result: VerifyResult): Verdict {
  const by = (n: string) => result.checks.find((c) => c.name === n);
  if (by('integrity_check ok')?.ok === false) return 'corrupt';
  if (result.ok) return 'verified';
  if (SCHEMA_CHECKS.some((n) => by(n)?.ok === false)) return 'refused-schema';
  if (MANIFEST_CHECKS.some((n) => by(n)?.ok === false)) return 'mismatch';
  if (by('manifest present and parses')?.ok === false) return 'unverifiable';
  return 'incomplete';
}

export interface VerifyOptions {
  /**
   * ⚠️ U6 — the file came from OUTSIDE (an upload). Adds BR-47.2/47.4/47.5. The developer path leaves this
   * off so a legacy backup is still READABLE for inspection; the app's restore always sets it, and only a
   * `verified` result is restorable from an upload (BR-47.3).
   */
  untrusted?: boolean;
}

/**
 * The schema object names the app has EVER created — every table and index, at every schema version.
 *
 * ⚠️ A union across versions, not today's schema alone: migration 004 DROPPED `artist_label` and
 * `artist_label_signal_vote` and RENAMED `artist_label_resolution`, so a legitimate v3 backup contains names
 * today's schema lacks. Computed by replaying the real migrations into memory — never a hardcoded list,
 * which would silently go stale at the next migration.
 */
function knownSchemaNames(): { names: Set<string>; maxVersion: number } {
  const names = new Set<string>();
  const db = new DatabaseSync(':memory:');
  try {
    const versions = [...MIGRATIONS].map((m) => m.version).sort((a, b) => a - b);
    for (const v of versions) {
      migrate(db, MIGRATIONS.filter((m) => m.version <= v), '1970-01-01T00:00:00.000Z');
      for (const row of db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'index')`).all()) {
        names.add(String(row.name));
      }
    }
    return { names, maxVersion: versions[versions.length - 1] ?? 0 };
  } finally {
    db.close();
  }
}

let cachedKnown: ReturnType<typeof knownSchemaNames> | null = null;

/** Created by `ANALYZE`: planner statistics, data only. Allowed so an analysed database is not refused. */
const SQLITE_STAT_TABLES = /^sqlite_stat[1-4]$/;

function schemaChecks(db: DatabaseSync, schemaVersion: number | null, add: (n: string, ok: boolean, d?: string) => void): void {
  cachedKnown ??= knownSchemaNames();
  const objects = db.prepare('SELECT type, name FROM sqlite_master').all().map((r) => ({ type: String(r.type), name: String(r.name) }));

  // BR-47.4 — a SQLite file is a program the engine runs: a trigger in an uploaded file fires on the APP's
  // own later writes. The app's schema has none (measured: 12 tables, 21 indexes), so any is refused.
  const executable = objects.filter((o) => o.type === 'trigger' || o.type === 'view');
  add('no triggers or views', executable.length === 0, executable.map((o) => `${o.type} ${o.name}`).join(', '));

  const unknown = objects.filter(
    (o) => (o.type === 'table' || o.type === 'index') && !cachedKnown!.names.has(o.name) && !SQLITE_STAT_TABLES.test(o.name),
  );
  add('only known tables and indexes', unknown.length === 0, unknown.map((o) => `${o.type} ${o.name}`).join(', '));

  // BR-47.5 — newer refuses; older is fine (the app migrates it on first open, as it migrates its own).
  const tooNew = schemaVersion !== null && schemaVersion > cachedKnown.maxVersion;
  add(
    'schema not newer than this app',
    !tooNew,
    tooNew ? `backup is v${schemaVersion}, this app supports up to v${cachedKnown.maxVersion}` : `v${schemaVersion}`,
  );
}

/** Verify a backup directory. */
export function verifyBackup(dir: string, options: VerifyOptions = {}): VerifyResult {
  const checks: VerifyCheck[] = [];
  const add = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

  const manifestPath = join(dir, MANIFEST_NAME);
  let manifest: BackupManifest | null = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
      add('manifest present and parses', true, `label=${manifest.label} takenAt=${manifest.takenAt}`);
    } catch (e) {
      add('manifest present and parses', false, e instanceof Error ? e.message : String(e));
    }
  } else {
    // ⚠️ Not a hard failure. The pre-2026-09-27 backups have no manifest, and refusing to look at them would
    // make this tool useless for exactly the backups most in need of checking.
    add('manifest present and parses', false, 'NO MANIFEST — pre-dates backup-history.mjs');
  }

  const dbFile = join(dir, 'history.db');
  if (!existsSync(dbFile)) {
    add('history.db present', false, dir);
    return { ok: false, checks, manifest };
  }
  add('history.db present', true, `${Math.round(statSync(dbFile).size / 1024)} KB`);

  const expectedSha = manifest?.sha256?.['history.db'];
  if (expectedSha) {
    const actual = sha256(dbFile);
    add('sha256 matches manifest', actual === expectedSha, actual === expectedSha ? '' : `${actual.slice(0, 16)}… != ${expectedSha.slice(0, 16)}…`);
  }

  const work = mkdtempSync(join(tmpdir(), 'restore-verify-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${dbFile}${suffix}`;
      if (existsSync(from)) copyFileSync(from, join(work, `history.db${suffix}`));
    }
    let schemaVersion: number | null;
    let counts: Record<string, number>;
    let ids: Record<string, number | null>;
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(work, 'history.db'));
      // Opening is lazy: a damaged file is often only discovered at the first read. Force one here so the
      // failure lands in THIS catch, not in a later query.
      db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    } catch (e) {
      // ⚠️ U6: a file that is not a readable database is a VERDICT (`corrupt`), never an exception. Before U6
      // the developer scripts threw here, which was survivable; an uploaded file that throws would be a crash
      // path reachable from outside (NFR-13).
      add('integrity_check ok', false, `does not open as a SQLite database: ${e instanceof Error ? e.message : String(e)}`);
      // ⚠️ Close what DID open: the constructor can succeed and the first read fail, and an open handle makes
      // the temp copy undeletable on Windows (EBUSY) — found by the damaged-file test, 2026-10-07.
      try {
        db?.close();
      } catch {
        /* already unusable */
      }
      return { ok: false, checks, manifest };
    }
    try {
      // BR-47.2 — an untrusted schema may not run functions with side effects. Set before anything reads it.
      if (options.untrusted) db.exec('PRAGMA trusted_schema = OFF');

      // ⚠️ THE CHECK THE CORRUPT SNAPSHOT FAILS. Everything else about that file looks fine.
      const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check);
      add('integrity_check ok', integrity === 'ok', integrity);

      schemaVersion = schemaVersionOf(db);
      if (options.untrusted) schemaChecks(db, schemaVersion, add);
      counts = tableCounts(db);
      ids = maxIds(db, counts);
    } catch (e) {
      add('integrity_check ok', false, `unreadable: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, checks, manifest };
    } finally {
      db.close();
    }

    add('schema_version readable', schemaVersion !== null, `v${schemaVersion}`);

    if (manifest) {
      if (manifest.schemaVersion !== undefined) {
        const ok = manifest.schemaVersion === schemaVersion;
        add('schema_version matches manifest', ok, ok ? `v${schemaVersion}` : `v${schemaVersion} != v${manifest.schemaVersion}`);
      }
      if (manifest.counts) {
        const bad = Object.entries(manifest.counts).filter(([t, c]) => counts[t] !== c);
        add(
          'every table count matches manifest',
          bad.length === 0,
          bad.length === 0 ? `${Object.keys(manifest.counts).length} tables` : bad.map(([t, c]) => `${t}: ${counts[t]} != ${c}`).join(', '),
        );
      }
      if (manifest.maxIds) {
        const bad = Object.entries(manifest.maxIds).filter(([t, m]) => ids[t] !== m);
        add('every max(id) matches manifest', bad.length === 0, bad.length === 0 ? '' : bad.map(([t, m]) => `${t}: ${ids[t]} != ${m}`).join(', '));
      }
    }

    return { ok: checks.every((c) => c.ok), checks, manifest, schemaVersion, counts, maxIds: ids };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
