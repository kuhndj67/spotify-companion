/**
 * LC-73 — the kept-backup store (U10, FR-76, FR-80, BR-80, P-81, P-82).
 *
 *   data/backups/
 *     scheduled/      spotify-backup-<UTC stamp>.tar.gz     kept: SNAPSHOT_KEEP (default 14)
 *     before-change/  spotify-backup-<UTC stamp>.tar.gz     kept: BEFORE_CHANGE_KEEP (default 5)
 *
 * ## One format
 *
 * Every kept backup is the archive *Create backup* downloads (U6's `createBackup`: integrity-checked source,
 * self-contained copy, manifest from the copy, verified as an upload would be), so *Restore backup* accepts every
 * file here. Only the destination differs: instead of streaming to a browser, the archive is written into
 * `data/.work/` and **renamed** into its kind's folder — the same mount, so the folder never holds a partial file.
 *
 * ## Rotation per kind
 *
 * Each kind rotates on its own, only AFTER the new file has arrived, and only over its own `spotify-backup-*`
 * names: a month of daily backups can never push out the copy taken before a migration, and nothing else in
 * `data/` is ever deleted (the old CSV snapshots stay where they are).
 *
 * ## Space first (P-82)
 *
 * The backup is written on the database's own disk. Filling it would break the database's writes, which is worse
 * than a missing backup, so a backup needs 2 × (database + WAL) + 100 MB free, and nothing is deleted to make room.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { createBackup, WORK_DIR_NAME } from '../maintenance/onlineBackup.js';
import { enoughSpace, rotationDeletes, sortKept, spaceNeeded, stampToMs } from './keptBackupDecision.js';

export type BackupKind = 'scheduled' | 'before-change';

/** The folder under the data directory that holds the store (IN-U10-2: always beside the database). */
export const BACKUPS_DIR_NAME = 'backups';

export interface KeptBackupStoreDeps {
  /** `history.db`'s path; the store lives beside it. */
  readonly databasePath: string;
  readonly rulesPath: string;
  readonly appVersion: string;
  readonly now: () => Date;
  readonly keep: Readonly<Record<BackupKind, number>>;
  /** Free bytes on the disk holding `dir`. Injected for tests; the real one asks the filesystem. */
  readonly freeBytes?: (dir: string) => number;
  readonly log?: (line: string) => void;
}

export type KeepResult =
  | { readonly ok: true; readonly path: string; readonly bytes: number; readonly takenAt: string; readonly deleted: readonly string[] }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly spaceShort?: { readonly freeBytes: number; readonly neededBytes: number };
    };

/** BR-86.4: what Settings shows about kept backups (status, not a manager: FD Q5 = A). */
export interface BackupStatusView {
  readonly health: { readonly level: 'ok' | 'warn' | 'fail' | 'off'; readonly detail: string };
  readonly scheduled: { readonly newestAt: string | null; readonly count: number };
  readonly beforeChange: { readonly newestAt: string | null; readonly count: number };
  /** As the user sees it: `data/backups/` (the host path; the container's `/data` is the same folder). */
  readonly folder: string;
}

export interface NewestBackup {
  readonly name: string;
  readonly takenAtMs: number;
}

export class KeptBackupStore {
  readonly #deps: KeptBackupStoreDeps;
  readonly #dataDir: string;
  readonly #log: (line: string) => void;

  constructor(deps: KeptBackupStoreDeps) {
    this.#deps = deps;
    this.#dataDir = dirname(deps.databasePath);
    this.#log = deps.log ?? ((line) => console.log(line));
  }

  /** `data/backups/<kind>/` — as the host and the container both see it, relative to the data directory. */
  dirOf(kind: BackupKind): string {
    return join(this.#dataDir, BACKUPS_DIR_NAME, kind);
  }

  /**
   * Take a backup through `liveDb` (the app's OWN connection: U6's one-writer rule) and keep it. The caller holds
   * any busy lock; at startup nothing else runs yet.
   */
  async keep(liveDb: DatabaseSync, kind: BackupKind, reason: string): Promise<KeepResult> {
    const started = Date.now();
    const dir = this.dirOf(kind);
    mkdirSync(dir, { recursive: true });

    const free = (this.#deps.freeBytes ?? diskFreeBytes)(dir);
    const db = sizeOf(this.#deps.databasePath);
    const wal = sizeOf(`${this.#deps.databasePath}-wal`);
    if (!enoughSpace(free, db, wal)) {
      const spaceShort = { freeBytes: free, neededBytes: spaceNeeded(db, wal) };
      const result = { ok: false as const, reason: 'not enough disk space', spaceShort };
      this.#log(`[backup] ${kind} NOT taken (${reason}): not enough disk space (${mb(free)} MB free, ${mb(spaceShort.neededBytes)} MB needed)`);
      return result;
    }

    const made = await createBackup({
      liveDb,
      dataDir: this.#dataDir,
      rulesPath: this.#deps.rulesPath,
      appVersion: this.#deps.appVersion,
      now: this.#deps.now,
      label: `${kind}: ${reason}`,
    });
    if (!made.ok) {
      this.#log(`[backup] ${kind} FAILED (${reason}): ${made.reason}`);
      return { ok: false, reason: made.reason };
    }

    const chunks: Buffer[] = [];
    for await (const chunk of made.stream) chunks.push(chunk as Buffer);
    made.cleanup();

    // Same mount as the store, so the rename below is atomic: the store never holds a partial file.
    const work = join(this.#dataDir, WORK_DIR_NAME);
    mkdirSync(work, { recursive: true });
    const temp = join(work, `keep-${randomUUID()}.tar.gz`);
    const target = uniqueTarget(dir, made.filename);
    try {
      writeFileSync(temp, Buffer.concat(chunks));
      renameSync(temp, target);
    } catch (error) {
      tryUnlink(temp);
      const why = error instanceof Error ? error.message : String(error);
      this.#log(`[backup] ${kind} FAILED (${reason}): ${why}`);
      return { ok: false, reason: why };
    }

    const deleted = this.#rotate(kind);
    const bytes = made.bytes;
    this.#log(
      `[backup] ${kind} kept (${reason}): ${basename(target)}, ${mb(bytes, 1)} MB, ${Date.now() - started} ms` +
        (deleted.length > 0 ? `; rotated out ${deleted.length}` : ''),
    );
    return { ok: true, path: target, bytes, takenAt: made.summary.takenAt, deleted };
  }

  /** The newest kept backup of a kind, by its stamp; `null` when there is none. */
  newest(kind: BackupKind): NewestBackup | null {
    const kept = sortKept(this.#names(kind));
    const last = kept.at(-1);
    return last ? { name: last.name, takenAtMs: stampToMs(last.stamp) } : null;
  }

  count(kind: BackupKind): number {
    return sortKept(this.#names(kind)).length;
  }

  #rotate(kind: BackupKind): string[] {
    const dir = this.dirOf(kind);
    const deleted = rotationDeletes(this.#names(kind), this.#deps.keep[kind]);
    for (const name of deleted) tryUnlink(join(dir, name));
    return deleted;
  }

  #names(kind: BackupKind): string[] {
    const dir = this.dirOf(kind);
    return existsSync(dir) ? readdirSync(dir) : [];
  }
}

/** Two backups in the same second get `-2`, `-3`… rather than one renaming over the other. */
function uniqueTarget(dir: string, filename: string): string {
  let target = join(dir, filename);
  for (let n = 2; existsSync(target); n += 1) target = join(dir, filename.replace(/\.tar\.gz$/, `-${n}.tar.gz`));
  return target;
}

function diskFreeBytes(dir: string): number {
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function mb(bytes: number, digits = 0): string {
  return (bytes / (1024 * 1024)).toFixed(digits);
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}
