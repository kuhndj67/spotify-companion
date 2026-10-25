/**
 * U10 (LC-71, BR-79, P-80) — the step between opening the history database and letting anything write to it.
 *
 *   opened WITHOUT migrating ─▶ backupDue? ─yes─▶ keep a before-change backup through THIS connection
 *                                   │                      │ failed ─▶ BeforeChangeBackupFailed: nothing changed
 *                                   no                     ok
 *                                   ▼                      ▼
 *                              migrate ─▶ record this app version as the last to open the database
 *
 * A version change counts as a risky change (FD Q1 = A): the first start of an updated *App only* install, a
 * rollback and a restore from an older backup are all backed up before anything is written, so `update` needs no
 * backup of its own.
 *
 * Extracted from `server.ts` (which no test can import) so the guarantee — **a failed backup leaves the database
 * exactly as it was** — is tested, not described.
 */

import type { KeepResult } from '../backup/KeptBackupStore.js';
import { backupDue } from '../backup/keptBackupDecision.js';
import type { SqliteHistoryRepository } from './SqliteHistoryRepository.js';

/** A before-change backup that could not be taken: the change is refused and the database left untouched. */
export class BeforeChangeBackupFailed extends Error {}

/**
 * U11 (BR-97, P-101): SQLite did not use WAL on this volume. Nothing is written (no backup, no migration); the app
 * runs display-only and Diagnostics names the mode and the path. Not a reason to undo a restore: the volume, not the
 * restored file, is at fault.
 */
export class WalRefused extends Error {}

export type PrepareOutcome = { readonly backedUp: string | null };

export async function prepareHistory(
  repo: SqliteHistoryRepository,
  runningVersion: string,
  keepBeforeChange: (reason: string) => Promise<KeepResult>,
): Promise<PrepareOutcome> {
  if (repo.journalMode !== 'wal') {
    throw new WalRefused(`SQLite did not use WAL for ${repo.path}: it chose journal mode "${repo.journalMode}". Nothing was written; recording is off until the database is on a volume that supports WAL`);
  }
  const due = backupDue({
    schemaVersion: repo.schemaVersion,
    pendingMigrations: repo.pendingMigrations,
    lastAppVersion: repo.lastAppVersion(),
    runningVersion,
  });
  if (due.due) {
    const kept = await keepBeforeChange(due.reason);
    if (!kept.ok) {
      const space = kept.spaceShort
        ? ` (${Math.round(kept.spaceShort.freeBytes / 1048576)} MB free, ${Math.round(kept.spaceShort.neededBytes / 1048576)} MB needed)`
        : '';
      throw new BeforeChangeBackupFailed(
        `the backup before this change (${due.reason}) could not be taken: ${kept.reason}${space}. Your database was not changed`,
      );
    }
  }
  repo.migrate();
  repo.recordAppVersion(runningVersion);
  return { backedUp: due.due ? due.reason : null };
}
