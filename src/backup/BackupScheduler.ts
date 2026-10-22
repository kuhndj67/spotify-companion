/**
 * LC-74 — scheduled backups, from the newest on disk (U10, FR-80, BR-81.1, P-83).
 *
 * ## Why not a timer per interval
 *
 * `SnapshotScheduler` (retired) ran `setInterval(24 h)` from process start, and deliberately not at startup. Every
 * container restart reset the 24 hours, so on a machine that restarts more often than daily nothing was written
 * after 2026-10-03 — while diagnostics said `ok`.
 *
 * This asks one question, at startup and every 15 minutes: *is the newest scheduled backup on disk older than the
 * interval?* (`scheduledDue`). The answer depends only on the files, so a restart can neither postpone a backup nor
 * take an extra one: at most one per interval, whatever the restarts.
 *
 * A busy refusal (a *Create backup* or restore in progress) is not a failure: the next check tries again.
 */

import type { KeepResult } from './KeptBackupStore.js';
import { backupHealth, scheduledDue, type BackupHealth } from './keptBackupDecision.js';

export const CHECK_EVERY_MS = 15 * 60 * 1000;

export interface BackupSchedulerDeps {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly checkEveryMs?: number;
  /** Epoch ms of the newest scheduled backup on disk, or `null`. */
  readonly newestAtMs: () => number | null;
  /** Keep one scheduled backup (`MaintenanceService.keepBackup('scheduled', …)`); `busy` when refused with 409. */
  readonly keep: () => Promise<KeepResult | { ok: false; status: number; reason: string }>;
  readonly now: () => number;
  /** When this process started, for "none written after one interval of uptime". */
  readonly startedAtMs: number;
}

export interface SchedulerStatus {
  readonly lastAttemptAt: number | null;
  readonly lastError: string | null;
  readonly spaceShort: { readonly freeBytes: number; readonly neededBytes: number } | null;
}

export class BackupScheduler {
  readonly #deps: BackupSchedulerDeps;
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #status: SchedulerStatus = { lastAttemptAt: null, lastError: null, spaceShort: null };

  constructor(deps: BackupSchedulerDeps) {
    this.#deps = deps;
  }

  get status(): SchedulerStatus {
    return this.#status;
  }

  /** BR-81.2, through the pure rule. */
  health(): BackupHealth {
    const now = this.#deps.now();
    return backupHealth({
      scheduledEnabled: this.#deps.enabled,
      newestScheduledAtMs: this.#deps.newestAtMs(),
      nowMs: now,
      uptimeMs: now - this.#deps.startedAtMs,
      intervalMs: this.#deps.intervalMs,
      lastError: this.#status.lastError,
      spaceShort: this.#status.spaceShort,
    });
  }

  /** Checks once now (the startup check), then every 15 minutes. */
  start(): void {
    if (!this.#deps.enabled || this.#timer) return;
    void this.check();
    this.#timer = setInterval(() => void this.check(), this.#deps.checkEveryMs ?? CHECK_EVERY_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One check. Returns whether a backup was kept. Never throws: a failed backup must not take down the app. */
  async check(): Promise<boolean> {
    if (!this.#deps.enabled || this.#running) return false;
    if (!scheduledDue(this.#deps.newestAtMs(), this.#deps.now(), this.#deps.intervalMs)) return false;
    this.#running = true;
    try {
      const result = await this.#deps.keep();
      if (result.ok) {
        this.#status = { lastAttemptAt: this.#deps.now(), lastError: null, spaceShort: null };
        return true;
      }
      if ('status' in result && result.status === 409) return false; // busy: the next check tries again
      this.#status = {
        lastAttemptAt: this.#deps.now(),
        lastError: 'spaceShort' in result && result.spaceShort ? null : result.reason,
        spaceShort: 'spaceShort' in result && result.spaceShort ? result.spaceShort : null,
      };
      return false;
    } catch (error) {
      this.#status = { lastAttemptAt: this.#deps.now(), lastError: error instanceof Error ? error.message : String(error), spaceShort: null };
      return false;
    } finally {
      this.#running = false;
    }
  }
}
