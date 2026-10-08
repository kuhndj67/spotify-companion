/**
 * LC-36 — orchestrates *Create backup*, *Restore backup* and *Undo last restore* (FR-57…FR-59, BR-48, BR-49,
 * BR-51.3, P-40).
 *
 * ## Validate fully, then act (P-40)
 *
 *   upload ─▶ work dir ─▶ parse (never extract) ─▶ verify (untrusted) ─▶ comparison + TOKEN
 *                 └────────── nothing outside data/.work/<id>/ has changed ──────────┘
 *   confirm(token, "RESTORE") ─▶ restore-pending/ (ready written LAST) ─▶ requestRestart()
 *
 * Confirmation is a SECOND request carrying a token, so a refused, abandoned or timed-out dialog has nothing to
 * undo. The swap itself happens at the next startup (`startupRestorer.ts`), before the database is opened.
 *
 * ## One operation at a time (BR-51.3)
 *
 * A second backup, upload or confirmation while one is in progress is refused with `busy` (the route's `409`).
 * There is no timer anywhere in here: an expired staging token is noticed — and its directory removed — the
 * next time anything is asked, and the startup sweep catches whatever a crash left.
 *
 * `requestRestart` is INJECTED. In production it runs the app's one shutdown path and exits 0 so Docker's
 * `restart: unless-stopped` brings it back (probed); in tests it records the call, so no test can exit the
 * process.
 */

import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';

import { MANIFEST_NAME, MANIFEST_SCHEMA, maxIds, schemaVersionOf, sha256, tableCounts, type BackupManifest } from '../backup/manifest.js';
import { verdictOf, verifyBackup, type VerifyResult } from '../backup/verifier.js';
import { readArchive } from '../ingest/archive.js';
import { EXPANDED_CAP_BYTES, UPLOAD_CAP_BYTES, type IngestRefusal } from '../ingest/types.js';
import { WORK_DIR_NAME, backupCapability, createBackup, type CreateBackupResult } from './onlineBackup.js';
import { PENDING_DIR, PREVIOUS_DIR, READY_MARKER, STAGE_FILE, type MovedRecord, type RestoreOutcome } from './startupRestorer.js';

/** BR-48.2 — the word the user types to confirm a destructive restore. */
export const CONFIRM_WORD = 'RESTORE';
/** A staged upload waits this long for confirmation, then is discarded (business-logic-model §3a). */
export const STAGING_TTL_MS = 10 * 60 * 1000;

export interface DatabaseSummary {
  takenAt: string | null;
  plays: number | null;
  decisions: number | null;
  schemaVersion: number | null;
}

export interface Comparison {
  backup: DatabaseSummary;
  current: DatabaseSummary;
  /** BR-48.7 — compared and REPORTED; U6 never applies it. */
  rules: 'none' | 'identical' | 'differs';
}

export type Busy = null | 'backup' | 'restore-verify' | 'restore-stage' | 'restarting';

export interface MaintenanceStatus {
  busy: Busy;
  backup: { available: true } | { available: false; reason: string };
  lastRestore: RestoreOutcome | null;
  previous: { movedAt: string; plays: number | null; reason: 'restore' | 'undo' } | null;
  sweptAtStartup: number;
  /** P-46 — headroom you can see. */
  sizes: { databaseBytes: number | null; uploadCapBytes: number; expandedCapBytes: number };
  /** Whether a restart will happen by itself (Docker) or must be done by hand (`npm start`). */
  supervised: boolean;
  /**
   * When THIS process started. The UI waits for it to CHANGE to know a restart happened — watching for the
   * server to go down misses a restart faster than the poll (the app is listening ~0.5 s after starting).
   */
  startedAt: string;
}

export interface MaintenanceDeps {
  dataDir: string;
  rulesPath: string;
  appVersion: string;
  /** The live connection, or `null` when history failed to open (the app then runs display-only). */
  liveDb: () => DatabaseSync | null;
  /** Called once a restore is staged. Production: shut down cleanly and exit 0. */
  requestRestart: () => void;
  /** `true` in the container — Docker restarts the app. `false` under `npm start`. */
  supervised: boolean;
  now: () => Date;
  /** From startup: what `applyPendingRestore` and `sweepLeftovers` reported. */
  startup?: { restore: RestoreOutcome; swept: number };
  caps?: { uploadBytes: number; expandedBytes: number };
}

export type Refused = { ok: false; status: 400 | 409 | 413 | 422 | 503; reason: string; rule?: string };

interface Staged {
  workDir: string;
  comparison: Comparison;
  reason: 'restore' | 'undo';
  expiresAt: number;
}

export class MaintenanceService {
  readonly #deps: MaintenanceDeps;
  #busy: Busy = null;
  readonly #staged = new Map<string, Staged>();
  readonly #startedAt: string;

  constructor(deps: MaintenanceDeps) {
    this.#deps = deps;
    this.#startedAt = deps.now().toISOString();
  }

  // ── status ──────────────────────────────────────────────────────────────────────────────────────────────

  status(): MaintenanceStatus {
    this.#expire();
    const dbPath = join(this.#deps.dataDir, 'history.db');
    const moved = this.#moved();
    return {
      busy: this.#busy,
      backup: this.#deps.liveDb() === null ? { available: false, reason: 'History is not available, so there is nothing to back up.' } : backupCapability(),
      lastRestore: this.#deps.startup?.restore.kind === 'none' ? null : (this.#deps.startup?.restore ?? null),
      previous: moved && !moved.noDatabase ? { movedAt: moved.movedAt, plays: moved.plays, reason: moved.reason } : null,
      sweptAtStartup: this.#deps.startup?.swept ?? 0,
      sizes: {
        databaseBytes: existsSync(dbPath) ? statSync(dbPath).size : null,
        uploadCapBytes: this.#caps().uploadBytes,
        expandedCapBytes: this.#caps().expandedBytes,
      },
      supervised: this.#deps.supervised,
      startedAt: this.#startedAt,
    };
  }

  // ── create backup (FR-57) ───────────────────────────────────────────────────────────────────────────────

  /** Holds the lock until the returned `cleanup` runs — the caller runs it when the download ends. */
  async backup(): Promise<Extract<CreateBackupResult, { ok: true }> | Refused> {
    const live = this.#deps.liveDb();
    if (live === null) return { ok: false, status: 503, reason: 'History is not available, so there is nothing to back up.' };
    if (!this.#acquire('backup')) return this.#busyRefusal();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.#busy = null;
      }
    };
    try {
      const result = await createBackup({
        liveDb: live,
        dataDir: this.#deps.dataDir,
        rulesPath: this.#deps.rulesPath,
        appVersion: this.#deps.appVersion,
        now: this.#deps.now,
      });
      if (!result.ok) {
        release();
        return { ok: false, status: 503, reason: result.reason, ...(result.verdict ? { rule: `verdict:${result.verdict}` } : {}) };
      }
      return {
        ...result,
        cleanup: () => {
          result.cleanup();
          release();
        },
      };
    } catch (e) {
      release();
      return { ok: false, status: 503, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── restore: receive and inspect (FR-58, BR-46, BR-47) ─────────────────────────────────────────────────

  /**
   * Stream an upload into a fresh work dir, enforcing the cap AS BYTES ARRIVE (BR-46.4, P-41), then parse and
   * verify it. Nothing outside the work dir changes; on any refusal the work dir is removed.
   */
  async receiveUpload(body: Readable): Promise<({ ok: true; token: string; comparison: Comparison }) | Refused> {
    this.#expire();
    if (this.#deps.liveDb() === null) return { ok: false, status: 503, reason: 'History is not available, so there is nothing to restore over.' };
    if (!this.#acquire('restore-verify')) return this.#busyRefusal();
    const workDir = this.#newWorkDir('upload-');
    try {
      const uploadPath = join(workDir, 'upload.bin');
      const capped = await this.#streamWithCap(body, uploadPath);
      if (capped !== null) return this.#refuse(workDir, 413, capped);

      const staged = join(workDir, 'staged');
      mkdirSync(staged);
      const read = await readArchive(uploadPath, staged, { totalExpandedBytes: this.#caps().expandedBytes });
      if (!read.ok) return this.#refuse(workDir, 422, read.refusal);
      rmSync(uploadPath, { force: true });

      const manifest = this.#readJson<BackupManifest>(join(staged, MANIFEST_NAME));
      // BR-45.6 — a manifest format this app does not know is refused, never guessed at.
      if (manifest === null || (manifest.manifestSchema ?? 1) !== MANIFEST_SCHEMA) {
        return this.#refuse(workDir, 422, { rule: 'BR-45.6', detail: 'this backup was made by a version of the app this one cannot read' });
      }
      const verification = verifyBackup(staged, { untrusted: true });
      const verdict = verdictOf(verification);
      // BR-47.3 — only a FULLY verified upload is restorable; `unverifiable` refuses.
      if (verdict !== 'verified') {
        return this.#refuse(workDir, 422, { rule: 'BR-47', detail: describeVerdict(verdict, verification) });
      }

      const comparison: Comparison = {
        backup: summaryFrom(manifest.takenAt ?? null, verification),
        current: this.#currentSummary(),
        rules: this.#compareRules(join(staged, 'rules.json')),
      };
      // BR-48.7 — the archive's rules are compared and reported, then DISCARDED: U6 never writes config/.
      rmSync(join(staged, 'rules.json'), { force: true });
      const token = this.#stage(workDir, comparison, 'restore');
      return { ok: true, token, comparison };
    } catch (e) {
      return this.#refuse(workDir, 422, { rule: 'BR-46.11', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      this.#busy = null;
    }
  }

  /** BR-49.2 — undo is a restore whose source is `previous/`, through the same verification and confirmation. */
  prepareUndo(): ({ ok: true; token: string; comparison: Comparison }) | Refused {
    this.#expire();
    const moved = this.#moved();
    const previous = join(this.#deps.dataDir, PREVIOUS_DIR);
    if (moved === null || moved.noDatabase || !existsSync(join(previous, 'history.db'))) {
      return { ok: false, status: 409, reason: 'There is no previous history to go back to.' };
    }
    if (!this.#acquire('restore-verify')) return this.#busyRefusal();
    const workDir = this.#newWorkDir('undo-');
    try {
      const staged = join(workDir, 'staged');
      mkdirSync(staged);
      // Copy the SET, then make the copy self-contained — `previous/` itself is never opened or altered.
      for (const sfx of ['', '-wal', '-shm']) {
        if (existsSync(join(previous, `history.db${sfx}`))) copyFileSync(join(previous, `history.db${sfx}`), join(staged, `history.db${sfx}`));
      }
      const manifest = buildManifest(join(staged, 'history.db'), moved.movedAt, this.#deps.appVersion);
      writeFileSync(join(staged, MANIFEST_NAME), JSON.stringify(manifest));
      const verification = verifyBackup(staged, { untrusted: true });
      const verdict = verdictOf(verification);
      if (verdict !== 'verified') return this.#refuse(workDir, 422, { rule: 'BR-47', detail: describeVerdict(verdict, verification) });
      const comparison: Comparison = {
        backup: summaryFrom(moved.movedAt, verification),
        current: this.#currentSummary(),
        rules: 'none',
      };
      const token = this.#stage(workDir, comparison, 'undo');
      return { ok: true, token, comparison };
    } catch (e) {
      return this.#refuse(workDir, 422, { rule: 'BR-47', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      this.#busy = null;
    }
  }

  // ── restore: confirm and stage (BR-48.2–48.4) ──────────────────────────────────────────────────────────

  confirm(token: string, typed: string): { ok: true; restarting: boolean } | Refused {
    this.#expire();
    if (typed !== CONFIRM_WORD) {
      return { ok: false, status: 400, reason: `Type ${CONFIRM_WORD} to confirm.`, rule: 'BR-48.2' };
    }
    const staged = this.#staged.get(token);
    if (staged === undefined) {
      return { ok: false, status: 409, reason: 'This restore is no longer waiting — it was confirmed, cancelled or timed out. Upload the file again.' };
    }
    if (!this.#acquire('restore-stage')) return this.#busyRefusal();
    try {
      const pending = join(this.#deps.dataDir, PENDING_DIR);
      if (existsSync(join(pending, READY_MARKER))) {
        this.#busy = null;
        return { ok: false, status: 409, reason: 'A restore is already staged and waiting for the app to restart.' };
      }
      rmSync(pending, { recursive: true, force: true });
      mkdirSync(pending);
      const from = join(staged.workDir, 'staged');
      renameSync(join(from, 'history.db'), join(pending, 'history.db'));
      renameSync(join(from, MANIFEST_NAME), join(pending, MANIFEST_NAME));
      writeFileSync(join(pending, STAGE_FILE), JSON.stringify({ reason: staged.reason }));
      // BR-48.3 — `ready` LAST. A pending directory without it is incomplete and is swept, never applied.
      writeFileSync(join(pending, READY_MARKER), '');
      this.#staged.delete(token);
      rmSync(staged.workDir, { recursive: true, force: true });
      this.#busy = 'restarting';
      this.#deps.requestRestart();
      return { ok: true, restarting: this.#deps.supervised };
    } catch (e) {
      rmSync(join(this.#deps.dataDir, PENDING_DIR), { recursive: true, force: true });
      this.#busy = null;
      return { ok: false, status: 503, reason: `Could not stage the restore: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.` };
    }
  }

  cancel(token: string): void {
    const staged = this.#staged.get(token);
    if (staged === undefined) return;
    this.#staged.delete(token);
    rmSync(staged.workDir, { recursive: true, force: true });
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────────────────────

  #caps() {
    return this.#deps.caps ?? { uploadBytes: UPLOAD_CAP_BYTES, expandedBytes: EXPANDED_CAP_BYTES };
  }

  #acquire(kind: Exclude<Busy, null>): boolean {
    if (this.#busy !== null) return false;
    this.#busy = kind;
    return true;
  }

  #busyRefusal(): Refused {
    return { ok: false, status: 409, reason: `Another maintenance operation is in progress (${this.#busy}).`, rule: 'BR-51.3' };
  }

  #newWorkDir(prefix: string): string {
    const root = join(this.#deps.dataDir, WORK_DIR_NAME);
    mkdirSync(root, { recursive: true });
    return mkdtempSync(join(root, prefix));
  }

  #refuse(workDir: string, status: Refused['status'], refusal: IngestRefusal | { rule: string; detail: string }): Refused {
    rmSync(workDir, { recursive: true, force: true });
    return { ok: false, status, reason: refusal.detail, rule: refusal.rule };
  }

  #stage(workDir: string, comparison: Comparison, reason: 'restore' | 'undo'): string {
    const token = randomUUID();
    this.#staged.set(token, { workDir, comparison, reason, expiresAt: this.#deps.now().getTime() + STAGING_TTL_MS });
    return token;
  }

  /** Discard staged uploads past their TTL. Called on every entry point — there is no timer. */
  #expire(): void {
    const now = this.#deps.now().getTime();
    for (const [token, staged] of this.#staged) {
      if (staged.expiresAt <= now) {
        this.#staged.delete(token);
        rmSync(staged.workDir, { recursive: true, force: true });
      }
    }
  }

  /** BR-46.4 / PBT-58 — abort at the FIRST byte over the cap, never after buffering the whole body. */
  async #streamWithCap(body: Readable, path: string): Promise<IngestRefusal | null> {
    const cap = this.#caps().uploadBytes;
    let total = 0;
    let over = false;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        total += chunk.length;
        if (total > cap) {
          over = true;
          done(new Error('upload exceeds the size limit'));
          return;
        }
        done(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(path, { flags: 'wx' }));
      return null;
    } catch (e) {
      if (over) return { rule: 'BR-46.4', detail: `the file is larger than the ${Math.round(cap / (1024 * 1024))} MB limit` };
      return { rule: 'BR-46.11', detail: `the upload did not complete: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  #currentSummary(): DatabaseSummary {
    const db = this.#deps.liveDb();
    if (db === null) return { takenAt: null, plays: null, decisions: null, schemaVersion: null };
    const count = (t: string): number | null => {
      try {
        return Number(db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get()?.c ?? 0);
      } catch {
        return null;
      }
    };
    return { takenAt: null, plays: count('play'), decisions: count('decision_log'), schemaVersion: schemaVersionOf(db) };
  }

  #compareRules(stagedRules: string): Comparison['rules'] {
    if (!existsSync(stagedRules)) return 'none';
    try {
      const mine = existsSync(this.#deps.rulesPath) ? readFileSync(this.#deps.rulesPath) : null;
      return mine !== null && mine.equals(readFileSync(stagedRules)) ? 'identical' : 'differs';
    } catch {
      return 'differs';
    }
  }

  #moved(): MovedRecord | null {
    return this.#readJson<MovedRecord>(join(this.#deps.dataDir, PREVIOUS_DIR, 'moved.json'));
  }

  #readJson<T>(path: string): T | null {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
      return null;
    }
  }
}

function summaryFrom(takenAt: string | null, v: VerifyResult): DatabaseSummary {
  return {
    takenAt,
    plays: v.counts?.['play'] ?? null,
    decisions: v.counts?.['decision_log'] ?? null,
    schemaVersion: v.schemaVersion ?? null,
  };
}

/** A manifest for a database staged from `previous/` (undo). The copy is made self-contained first. */
function buildManifest(dbPath: string, takenAt: string, appVersion: string): BackupManifest {
  const db = new DatabaseSync(dbPath);
  let manifest: BackupManifest;
  try {
    db.exec('PRAGMA journal_mode = DELETE');
    const counts = tableCounts(db);
    manifest = {
      manifestSchema: MANIFEST_SCHEMA,
      source: 'app',
      label: 'undo',
      takenAt,
      appVersion,
      schemaVersion: schemaVersionOf(db),
      counts,
      maxIds: maxIds(db, counts),
    };
  } finally {
    db.close();
  }
  // Hashed after close, so the file is final.
  manifest.sha256 = { 'history.db': sha256(dbPath) };
  return manifest;
}

function describeVerdict(verdict: string, v: VerifyResult): string {
  const failed = v.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  const plain: Record<string, string> = {
    corrupt: 'The file is damaged.',
    mismatch: 'The file does not match its own record of what was backed up — rows are missing or it was altered.',
    unverifiable: 'The file has no record of what was backed up, so it cannot be checked.',
    'refused-schema': 'The file contains something a backup from this app never contains, or comes from a newer version.',
    incomplete: 'The file is incomplete.',
  };
  return `${plain[verdict] ?? 'The file did not verify.'} ${failed.join('; ')}`.trim();
}
