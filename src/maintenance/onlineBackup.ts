/**
 * LC-35 — *Create backup*: the running app snapshots its own database, with no downtime (FR-57, BR-44, P-38).
 *
 * ## One writer
 *
 * The copy is taken through the app's OWN connection with `node:sqlite`'s `backup()`. No second process opens
 * `history.db`, so nothing needs guarding — the script-side `docker ps` guard exists only because the scripts
 * are a second process. Probed 2026-10-07: 281 writes on the same connection interleaved with the copy, and
 * the copy was consistent (`integrity_check: ok`, every play present, a clean point in time).
 *
 * ⚠️ **Never "simplify" this into a file copy.** A `.db`-only copy of the live database held 824 of 850 plays
 * with `integrity_check: ok` (2026-09-27): the newest 3%, silently gone.
 *
 * ## Order of operations
 *
 *   integrity_check the LIVE db (BR-44.5) → backup() into data/.work/<id>/ → make the copy SELF-CONTAINED
 *   (no -wal, BR-45.4) → manifest FROM THE COPY (BR-44.4) → verify the copy as untrusted (BR-44.3) → archive
 *
 * The manifest is built from the copy, never the live database: the live one keeps changing during the copy,
 * so a live manifest would disagree with its own backup on a busy evening.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import * as sqlite from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';

import { MANIFEST_NAME, MANIFEST_SCHEMA, maxIds, schemaVersionOf, sha256, tableCounts, type BackupManifest } from '../backup/manifest.js';
import { verdictOf, verifyBackup, type Verdict } from '../backup/verifier.js';
import { writeArchive } from '../ingest/archive.js';
import type { ArchiveEntryName } from '../ingest/types.js';

/** `data/.work/` — every working directory lives here, inside the `./data` mount (BR-50.1). */
export const WORK_DIR_NAME = '.work';

type BackupFn = (source: DatabaseSync, destination: string) => Promise<number>;

/**
 * IN-U6-1 — is `backup()` available on this Node? The Dockerfile pins a minor that has it; this check is what
 * protects a HOST deployment (`npm start`), which the pin cannot reach. Read off the module namespace so a
 * missing export is a value, not an import-time crash.
 */
export function backupCapability(): { available: true } | { available: false; reason: string } {
  const fn = (sqlite as unknown as { backup?: unknown }).backup;
  if (typeof fn === 'function') return { available: true };
  return {
    available: false,
    reason: `This Node (${process.version}) lacks node:sqlite backup(); Create backup needs Node 22.16 or later.`,
  };
}

export interface CreateBackupDeps {
  /** The app's own live connection — `SqliteHistoryRepository.database`. */
  liveDb: DatabaseSync;
  /** The directory holding `history.db` (the `./data` mount). */
  dataDir: string;
  /** `config/rules.json` — copied into the archive as authored, if it exists (BR-45.5). */
  rulesPath: string;
  appVersion: string;
  now: () => Date;
}

export type CreateBackupResult =
  | {
      ok: true;
      filename: string;
      stream: Readable;
      /** Archive size — the route sends it as Content-Length. */
      bytes: number;
      summary: { takenAt: string; plays: number | null; schemaVersion: number | null };
      /** Release resources. The work dir is already gone (BR-44.6); calling this is always safe. */
      cleanup: () => void;
    }
  | { ok: false; reason: string; verdict?: Verdict };

function stamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')}Z`;
}

export async function createBackup(deps: CreateBackupDeps): Promise<CreateBackupResult> {
  const capability = backupCapability();
  if (!capability.available) return { ok: false, reason: capability.reason };

  // BR-44.5 — backing up a corrupt database produces a corrupt backup that looks like insurance.
  const integrity = String(deps.liveDb.prepare('PRAGMA integrity_check').get()?.integrity_check);
  if (integrity !== 'ok') {
    return { ok: false, reason: `Your current database fails its integrity check (${integrity}); a backup of it would not be insurance.` };
  }

  const workRoot = join(deps.dataDir, WORK_DIR_NAME);
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, 'backup-'));
  const cleanup = () => rmSync(work, { recursive: true, force: true });

  try {
    const copyPath = join(work, 'history.db');
    await (sqlite as unknown as { backup: BackupFn }).backup(deps.liveDb, copyPath);

    // BR-45.4 — ONE self-contained file. The archive carries `history.db` alone, so anything left in a `-wal`
    // beside the copy would be silently missing from the backup — the 824-of-850 shape. Switching the copy to
    // rollback-journal mode checkpoints and removes its WAL. The app re-enables WAL when it opens a restore.
    const copy = new DatabaseSync(copyPath);
    let counts: Record<string, number>;
    let manifest: BackupManifest;
    try {
      copy.exec('PRAGMA journal_mode = DELETE');
      counts = tableCounts(copy);
      manifest = {
        manifestSchema: MANIFEST_SCHEMA,
        source: 'app',
        label: 'in-app',
        takenAt: deps.now().toISOString(),
        appVersion: deps.appVersion,
        schemaVersion: schemaVersionOf(copy),
        journalMode: 'delete',
        counts,
        maxIds: maxIds(copy, counts),
      };
    } finally {
      copy.close();
    }
    if (existsSync(`${copyPath}-wal`)) {
      return fail(cleanup, 'the backup copy still has a WAL file beside it, so the archive would be incomplete');
    }

    const present = new Set<ArchiveEntryName>(['manifest.json', 'history.db']);
    if (existsSync(deps.rulesPath)) {
      copyFileSync(deps.rulesPath, join(work, 'rules.json'));
      present.add('rules.json');
    }
    manifest.sha256 = { 'history.db': sha256(copyPath) };
    manifest.entries = [...present];
    writeFileSync(join(work, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);

    // BR-44.3 — verified as an UPLOAD would be, so a backup this app offers is one this app would accept.
    const verification = verifyBackup(work, { untrusted: true });
    const verdict = verdictOf(verification);
    if (verdict !== 'verified') {
      return { ...fail(cleanup, `the backup did not verify (${verdict})`), verdict };
    }

    // ⚠️ The archive is built IN FULL, in memory, and the work dir removed BEFORE the download starts. `tar`
    // reads entries lazily while it streams; deleting the work dir under a live stream (a browser that
    // disconnects mid-download) raised ENOENT and "write after destroyed" as UNCAUGHT errors — a crash path,
    // and destroying the stream first did not stop tar's internal readers. Found by
    // maintenanceService.test.ts, 2026-10-07. Memory is bounded: ~1.6 MB today, and the caps bound the worst.
    const chunks: Buffer[] = [];
    for await (const chunk of writeArchive(work, present)) chunks.push(chunk as Buffer);
    const archive = Buffer.concat(chunks);
    cleanup();

    const takenAt = deps.now();
    return {
      ok: true,
      filename: `spotify-backup-${stamp(takenAt)}.tar.gz`,
      stream: Readable.from([archive]),
      bytes: archive.length,
      summary: { takenAt: manifest.takenAt!, plays: counts['play'] ?? null, schemaVersion: manifest.schemaVersion ?? null },
      // Nothing is left on disk; kept so callers have one shape. Safe to call at any time, any number of times.
      cleanup: () => {},
    };
  } catch (e) {
    return fail(cleanup, e instanceof Error ? e.message : String(e));
  }
}

function fail(cleanup: () => void, reason: string): { ok: false; reason: string } {
  cleanup();
  return { ok: false, reason };
}
