/**
 * LC-37 / LC-38 — apply a staged restore at startup, BEFORE the database is opened; then sweep leftovers.
 *
 * ## Why at startup (P-38)
 *
 * The running app never swaps its open database. *Restore backup* stages the verified file in
 * `data/restore-pending/`, writes `ready` last, and exits; Docker restarts the container and THIS runs before
 * `new SqliteHistoryRepository(...)`. At that moment nothing has the database open — so there is no second
 * writer to guard against, here or on any other machine.
 *
 * ## Journaled and idempotent (P-43)
 *
 * Power can fail between any two file operations. Before each step, `journal.json` records the step about to
 * run; every step is written so that re-running it after a crash completes it rather than repeating it. At the
 * next start the journal says exactly where the swap stopped. ⚠️ Inferring state from which files exist was
 * rejected: after step 2, "history.db missing, previous/ present" reads the same whether the swap is half done
 * or someone deleted a file by hand.
 *
 * ## The invariant
 *
 * ⚠️ **The app never starts on an empty database because of a restore.** Every failure path puts the database
 * that was there back. A failure can cost the restore; it can never cost the corpus (BR-48.6).
 *
 * ⚠️ **`history.db`, `-wal` and `-shm` move as a set.** A WAL left beside a DIFFERENT database is worse than a
 * missing one: SQLite would replay the old log into the new file. Before the staged file goes in, any sibling
 * left in `data/` is moved to `previous/` with the database it belongs to.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { verdictOf, verifyBackup } from '../backup/verifier.js';
import { WORK_DIR_NAME } from './onlineBackup.js';

export const PENDING_DIR = 'restore-pending';
export const PREVIOUS_DIR = 'previous';
const PREVIOUS_TMP = 'previous.incoming';
export const READY_MARKER = 'ready';
export const STAGE_FILE = 'stage.json';
const JOURNAL = 'journal.json';
const DB_SET = ['history.db', 'history.db-wal', 'history.db-shm'] as const;

type Step = 'verify' | 'move-current-aside' | 'move-staged-in' | 'cleanup';
const ORDER: readonly Step[] = ['verify', 'move-current-aside', 'move-staged-in', 'cleanup'];

interface Journal {
  id: string;
  step: Step;
}

/** What `previous/moved.json` records about the database a restore replaced (domain-entities §5). */
export interface MovedRecord {
  id: string;
  movedAt: string;
  reason: 'restore' | 'undo';
  /** `null` when there was no database to move (a fresh installation). */
  plays: number | null;
  noDatabase?: boolean;
}

/**
 * U7 (BR-59.4/59.5): the backup's rules, carried OUT of the pending directory before cleanup removes it — only when
 * the user ticked *"also replace my rules"*. The restorer never writes `config/` itself; `finishRestoreRules` does,
 * and only once the restored database has opened.
 */
export interface PendingRules {
  readonly content: string;
  /** The current rules' hash when the user confirmed — BR-59.6 refuses to apply over a later hand edit. */
  readonly expectedHash: string | null;
}

/** What became of the restore's rules, for the after-restart message (BR-59.7, frontend-components §4). */
export type RulesRestoreResult = 'applied' | 'not-requested' | { readonly skipped: string };

export type RestoreOutcome =
  | { kind: 'none' }
  | {
      kind: 'applied';
      /** For an undo, when the history was SET ASIDE (`moved.json`), not when a backup was taken. */
      takenAt: string | null;
      plays: number | null;
      /** Present only for an undo, so the after-restart message does not say *"from a backup"*. */
      reason?: 'undo';
      rules?: PendingRules | null;
      rulesResult?: RulesRestoreResult;
    }
  | { kind: 'failed'; reason: string };

/**
 * Test seam for PBT-55. Called with a label before every operation that changes the filesystem. A test throws
 * a `{ simulatedCrash: true }` error from it to stop the restorer dead — the error is re-thrown past every
 * recovery path, exactly as a power cut would skip them. Production passes nothing.
 */
export type FaultPoint = (label: string) => void;
const isSimulatedCrash = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { simulatedCrash?: unknown }).simulatedCrash === true;

export interface RestoreOptions {
  now?: () => Date;
  fault?: FaultPoint;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Apply a staged restore if one is ready. Never throws (except a simulated crash, by design).
 */
export function applyPendingRestore(dataDir: string, options: RestoreOptions = {}): RestoreOutcome {
  const pending = join(dataDir, PENDING_DIR);
  if (!existsSync(join(pending, READY_MARKER))) return { kind: 'none' };

  const fault = options.fault ?? (() => {});
  const now = options.now ?? (() => new Date());
  const previous = join(dataDir, PREVIOUS_DIR);
  const previousTmp = join(dataDir, PREVIOUS_TMP);
  const journalPath = join(pending, JOURNAL);
  const manifest = readJson<{ takenAt?: string; counts?: Record<string, number> }>(join(pending, 'manifest.json'));
  // Written by MaintenanceService beside the manifest, so the backup's own manifest is never edited.
  // ⚠️ A U6-era stage.json has no `applyRules`, and reads as false: a restore staged by U6 never applies rules.
  const stage = readJson<{ reason?: 'restore' | 'undo'; applyRules?: boolean; rulesHashAtConfirm?: string | null }>(join(pending, STAGE_FILE));
  const journal: Journal = readJson<Journal>(journalPath) ?? { id: `${now().getTime()}`, step: 'verify' };
  const startAt = ORDER.indexOf(journal.step);

  const record = (step: Step) => {
    fault(`journal:${step}`);
    writeFileSync(journalPath, JSON.stringify({ id: journal.id, step } satisfies Journal));
  };
  const moved = (): MovedRecord | null => readJson<MovedRecord>(join(previous, 'moved.json'));

  try {
    // ── 1. verify — the staged file sat on disk across a restart; check it again (BR-48.5) ───────────────
    if (startAt <= ORDER.indexOf('verify')) {
      record('verify');
      const verdict = verdictOf(verifyBackup(pending, { untrusted: true }));
      if (verdict !== 'verified') {
        fault('rm:pending');
        rmSync(pending, { recursive: true, force: true });
        return { kind: 'failed', reason: `the staged backup no longer verifies (${verdict}); your history is unchanged` };
      }
    }

    // ── 2. move the current database aside, as a SET, into previous/ (BR-49.1) ───────────────────────────
    if (startAt <= ORDER.indexOf('move-current-aside')) {
      record('move-current-aside');
      if (moved()?.id !== journal.id) {
        if (!existsSync(previousTmp)) {
          fault('mkdir:previous.incoming');
          mkdirSync(previousTmp, { recursive: true });
        }
        let plays: number | null = null;
        for (const name of DB_SET) {
          if (existsSync(join(dataDir, name))) {
            fault(`rename:${name}->previous.incoming`);
            renameSync(join(dataDir, name), join(previousTmp, name));
          }
        }
        const hadDatabase = existsSync(join(previousTmp, 'history.db'));
        if (hadDatabase) plays = countPlays(join(previousTmp, 'history.db'));
        const rec: MovedRecord = {
          id: journal.id,
          movedAt: now().toISOString(),
          reason: stage?.reason ?? 'restore',
          plays,
          ...(hadDatabase ? {} : { noDatabase: true }),
        };
        if (!hadDatabase && existsSync(join(previous, 'history.db'))) {
          // ⚠️ NEVER replace a previous/ that holds a database with one that does not. Reached when the
          // journal was lost after this step had already run: data/ is empty BECAUSE its database is
          // already in previous/. Replacing it would delete the corpus being restored over.
          fault('rm:previous.incoming(empty)');
          rmSync(previousTmp, { recursive: true, force: true });
        } else {
          fault('write:moved.json');
          writeFileSync(join(previousTmp, 'moved.json'), JSON.stringify(rec));
          fault('rm:previous');
          rmSync(previous, { recursive: true, force: true });
          fault('rename:previous.incoming->previous');
          renameSync(previousTmp, previous);
        }
      }
    }

    // ── 3. move the staged database in ────────────────────────────────────────────────────────────────────
    if (startAt <= ORDER.indexOf('move-staged-in')) {
      record('move-staged-in');
      const staged = join(pending, 'history.db');
      if (existsSync(staged)) {
        // ⚠️ No sibling of the OLD database may sit beside the new one. If a crash left one, it belongs with
        // the database it came from.
        for (const name of DB_SET) {
          if (existsSync(join(dataDir, name))) {
            fault(`rename:${name}->previous(stray)`);
            renameSync(join(dataDir, name), join(previous, `stray-${name}`));
          }
        }
        fault('rename:staged->history.db');
        renameSync(staged, join(dataDir, 'history.db'));
      } else if (!existsSync(join(dataDir, 'history.db'))) {
        throw new Error('the staged database disappeared before it could be moved in');
      }
    }

    // ── 4. clean up — removing the pending directory (with its journal) is what marks the swap done ───────
    record('cleanup');
    // U7: read the rules OUT first — cleanup deletes them. Reading is all that happens here; config/ is untouched.
    const rulesFile = join(pending, 'rules.json');
    const rules: PendingRules | null =
      stage?.applyRules === true && existsSync(rulesFile)
        ? { content: readFileSync(rulesFile, 'utf8'), expectedHash: stage.rulesHashAtConfirm ?? null }
        : null;
    fault('rm:pending');
    rmSync(pending, { recursive: true, force: true });
    return {
      kind: 'applied',
      takenAt: manifest?.takenAt ?? null,
      plays: manifest?.counts?.['play'] ?? null,
      ...(stage?.reason === 'undo' ? { reason: 'undo' as const } : {}),
      ...(rules ? { rules } : {}),
    };
  } catch (e) {
    if (isSimulatedCrash(e)) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    revertToPrevious(dataDir, journal.id);
    rmSync(pending, { recursive: true, force: true });
    return { kind: 'failed', reason: `${reason}; your previous history was put back` };
  }
}

/**
 * Put `previous/` back as the live database (BR-48.6). Used when a swap fails part-way, and by `server.ts`
 * when a restored database fails to open. Only acts if `previous/` holds a database — it never empties `data/`.
 *
 * @param id when given, only a `previous/` moved aside by THIS restore is put back.
 */
export function revertToPrevious(dataDir: string, id?: string): boolean {
  const previous = join(dataDir, PREVIOUS_DIR);
  const previousTmp = join(dataDir, PREVIOUS_TMP);
  // A crash between moving files into previous.incoming and renaming it: the old database is THERE.
  const source = existsSync(join(previousTmp, 'history.db')) ? previousTmp : previous;
  const rec = readJson<MovedRecord>(join(source, 'moved.json'));
  if (!existsSync(join(source, 'history.db'))) return false;
  if (id !== undefined && rec !== null && rec.id !== id) return false;

  // Only a DIFFERENT live database is moved out of the way. ⚠️ If `data/` holds no `history.db`, any `-wal` or
  // `-shm` still there belongs to the database being put back — the swap was interrupted between moving the
  // `.db` and its siblings — and discarding it would lose that database's newest committed rows. Found by
  // PBT-55's ordinary-error sweep at "rename:history.db-wal", 2026-10-07.
  if (existsSync(join(dataDir, 'history.db'))) {
    const failed = join(dataDir, WORK_DIR_NAME, `failed-restore-${Date.now()}`);
    mkdirSync(failed, { recursive: true });
    for (const name of DB_SET) {
      if (existsSync(join(dataDir, name))) renameSync(join(dataDir, name), join(failed, name));
    }
  }
  for (const name of DB_SET) {
    if (existsSync(join(source, name))) renameSync(join(source, name), join(dataDir, name));
  }
  rmSync(source, { recursive: true, force: true });
  return true;
}

function countPlays(dbPath: string): number | null {
  // The moved-aside database's play count, for Settings (BR-49.4). A failure is just "unknown" — an unreadable
  // old database must not stop a restore the user confirmed.
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return Number(db.prepare('SELECT COUNT(*) AS c FROM play').get()?.c ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * LC-38 — remove what a crash left behind (BR-50.4, P-44). Runs AFTER `applyPendingRestore`.
 *
 * ⚠️ Touches ONLY `data/.work/*`, a `restore-pending/` with no `ready` marker, and a stale
 * `previous.incoming/` that holds no database. Never `backup-*`, `snapshots/`, `reporting/`,
 * `CORRUPT-snapshot-*` or `previous/` itself (BR-50.6).
 *
 * @returns how many leftovers were removed — non-zero means an operation was interrupted, worth seeing.
 */
export function sweepLeftovers(dataDir: string): number {
  let removed = 0;
  const work = join(dataDir, WORK_DIR_NAME);
  if (existsSync(work)) {
    for (const name of readdirSync(work)) {
      rmSync(join(work, name), { recursive: true, force: true });
      removed++;
    }
  }
  const pending = join(dataDir, PENDING_DIR);
  if (existsSync(pending) && !existsSync(join(pending, READY_MARKER))) {
    rmSync(pending, { recursive: true, force: true });
    removed++;
  }
  const previousTmp = join(dataDir, PREVIOUS_TMP);
  if (existsSync(previousTmp) && !existsSync(join(previousTmp, 'history.db'))) {
    rmSync(previousTmp, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * BR-59.5/59.6 — apply a restore's rules, or say why not. Called by `server.ts` AFTER the restored database has
 * opened (step 5) and BEFORE the rules watcher starts, so the watcher's first load is already the restored set and
 * no rule ever runs against the wrong corpus.
 *
 * ⚠️ `databaseOpened: false` means BR-48.6 fell back to the previous history — then the backup's rules must NOT be
 * applied: they would sit on top of a corpus the user did not choose to restore over.
 */
export function finishRestoreRules(
  outcome: RestoreOutcome,
  databaseOpened: boolean,
  writer: { applyAtStartup(content: string, expectedCurrentHash: string | null): { applied: true } | { applied: false; reason: string } },
): RulesRestoreResult | null {
  if (outcome.kind !== 'applied') return null;
  if (!outcome.rules) return 'not-requested';
  if (!databaseOpened) return { skipped: 'the restored history did not open, so its rules were not applied either' };
  const r = writer.applyAtStartup(outcome.rules.content, outcome.rules.expectedHash);
  return r.applied ? 'applied' : { skipped: r.reason };
}
