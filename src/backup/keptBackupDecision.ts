/**
 * LC-72 — the kept-backup decisions (U10, BR-79.1, BR-80.4, BR-81.1–81.2, P-80…P-84). ⚙️ PURE.
 *
 * Every function here is a function of its arguments: times arrive as numbers, never read from a clock, so the
 * restart-loop and "never ok for none written" properties can be asserted for any input (PBT-80…PBT-84).
 */


const MB = 1024 * 1024;
/** P-82 (NFR Q2 = A): the margin on top of twice the database. */
export const SPACE_MARGIN_BYTES = 100 * MB;

// ── BR-79.1: is a before-change backup due? ────────────────────────────────────────────────────────────────

export interface ChangeFacts {
  readonly schemaVersion: number;
  readonly pendingMigrations: readonly number[];
  readonly lastAppVersion: string | null;
  readonly runningVersion: string;
}

export type BackupDue = { readonly due: false } | { readonly due: true; readonly reason: string };

/**
 * Due when a migration is pending, or the database was last opened by another (or an unrecorded) version.
 *
 * ⚠️ **Never for a brand-new, empty database** (schema 0): there is nothing to protect, and a backup of an empty
 * file does not verify, so requiring one would stop every fresh install from ever recording. Found by running the
 * app on an empty data folder, 2026-10-22; every unit test had started from an existing v7 database.
 */
export function backupDue(f: ChangeFacts): BackupDue {
  if (f.schemaVersion === 0) return { due: false };
  const reasons: string[] = [];
  if (f.pendingMigrations.length > 0) {
    reasons.push(`migration ${f.schemaVersion}→${Math.max(...f.pendingMigrations)}`);
  }
  if (f.lastAppVersion === null) reasons.push('first run with version tracking');
  else if (f.lastAppVersion !== f.runningVersion) reasons.push(`version ${f.lastAppVersion}→${f.runningVersion}`);
  return reasons.length === 0 ? { due: false } : { due: true, reason: reasons.join(' · ') };
}

// ── BR-81.1: is a scheduled backup due? ────────────────────────────────────────────────────────────────────

/** From the newest scheduled backup ON DISK, never from process start: no restart can postpone or multiply it. */
export function scheduledDue(newestAtMs: number | null, nowMs: number, intervalMs: number): boolean {
  return newestAtMs === null || nowMs - newestAtMs >= intervalMs;
}

// ── P-82: free space ───────────────────────────────────────────────────────────────────────────────────────

export function spaceNeeded(databaseBytes: number, walBytes: number): number {
  return 2 * (databaseBytes + walBytes) + SPACE_MARGIN_BYTES;
}

export function enoughSpace(freeBytes: number, databaseBytes: number, walBytes: number): boolean {
  return freeBytes >= spaceNeeded(databaseBytes, walBytes);
}

// ── BR-80.4: rotation ──────────────────────────────────────────────────────────────────────────────────────

/** A kept backup's file name: U6's stamp, plus `-N` when two land in the same second. */
const KEPT_NAME = /^spotify-backup-(\d{8}T\d{6}Z)(?:-(\d+))?\.tar\.gz$/;

export interface KeptName {
  readonly name: string;
  readonly stamp: string;
  readonly n: number;
}

export function parseKeptName(name: string): KeptName | null {
  const m = KEPT_NAME.exec(name);
  return m ? { name, stamp: m[1]!, n: m[2] === undefined ? 1 : Number(m[2]) } : null;
}

/** Oldest first. By the parsed stamp and suffix: by name, `…Z-2` would sort BEFORE `…Z` (`-` < `.`). */
export function sortKept(names: readonly string[]): KeptName[] {
  return names
    .map(parseKeptName)
    .filter((k): k is KeptName => k !== null)
    .sort((a, b) => (a.stamp === b.stamp ? a.n - b.n : a.stamp < b.stamp ? -1 : 1));
}

/** The names to delete so that the newest `keep` remain. Never a name outside the kept pattern. */
export function rotationDeletes(names: readonly string[], keep: number): string[] {
  const kept = sortKept(names);
  return kept.slice(0, Math.max(0, kept.length - Math.max(1, keep))).map((k) => k.name);
}

/** `20261022T031500Z` → epoch ms. */
export function stampToMs(stamp: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

// ── BR-81.2: backup health ─────────────────────────────────────────────────────────────────────────────────

export type HealthLevel = 'ok' | 'warn' | 'fail';

export interface HealthFacts {
  /** `SNAPSHOTS_ENABLED`; off on the verification install. */
  readonly scheduledEnabled: boolean;
  readonly newestScheduledAtMs: number | null;
  readonly nowMs: number;
  readonly uptimeMs: number;
  readonly intervalMs: number;
  readonly lastError: string | null;
  readonly spaceShort: { readonly freeBytes: number; readonly neededBytes: number } | null;
}

export type BackupHealth = { readonly level: HealthLevel | 'off'; readonly detail: string };

/** ⚠️ Never `ok` for "none written" — the defect that hid for 18 days (FR-80). */
export function backupHealth(f: HealthFacts): BackupHealth {
  if (!f.scheduledEnabled) return { level: 'off', detail: 'Scheduled backups are turned off (SNAPSHOTS_ENABLED=false).' };
  if (f.spaceShort) {
    return {
      level: 'fail',
      detail: `Not enough disk space for a backup: ${toMb(f.spaceShort.freeBytes)} MB free, ${toMb(f.spaceShort.neededBytes)} MB needed.`,
    };
  }
  if (f.lastError) return { level: 'fail', detail: `The last automatic backup failed: ${f.lastError}` };
  if (f.newestScheduledAtMs === null) {
    return f.uptimeMs >= f.intervalMs
      ? { level: 'fail', detail: 'No automatic backup has been written, although one was due.' }
      : { level: 'warn', detail: 'No automatic backup yet; the first is due shortly.' };
  }
  const age = f.nowMs - f.newestScheduledAtMs;
  if (age > 2 * f.intervalMs) {
    return { level: 'warn', detail: `Automatic backups have stopped: the newest is ${toDays(age)} old.` };
  }
  return { level: 'ok', detail: `Newest automatic backup ${toHours(age)} ago.` };
}

function toMb(bytes: number): number {
  return Math.round(bytes / MB);
}

function toHours(ms: number): string {
  const h = Math.max(0, Math.round(ms / 3_600_000));
  return h === 1 ? '1 hour' : `${h} hours`;
}

function toDays(ms: number): string {
  const d = Math.round(ms / 86_400_000);
  return d === 1 ? '1 day' : `${d} days`;
}
