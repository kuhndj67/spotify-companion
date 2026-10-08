/**
 * What a backup records about itself — MOVED from `scripts/backup-history.mjs` (BR-47.1, Q4 = A) so the app's
 * in-app backup (U6) and the developer `db:*` scripts compute it the same way. One copy, imported by both.
 *
 * ⚠️ The field names are the developer manifest's, unchanged (`counts`, `maxIds`, `sha256['history.db']`,
 * `schemaVersion`), so one verifier reads backups made by either path — including every manifest-bearing
 * backup already in `data/`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export const MANIFEST_NAME = 'manifest.json';
/** The developer manifest's own format number. Left at 1: U6 adds fields, it removes none. */
export const MANIFEST_SCHEMA = 1;

export interface BackupManifest {
  manifestSchema?: number;
  label?: string;
  takenAt?: string;
  schemaVersion?: number | null;
  journalMode?: string;
  sha256?: Record<string, string>;
  counts?: Record<string, number>;
  maxIds?: Record<string, number | null>;
  /** U6: which path made it. Absent on developer backups taken before U6. */
  source?: 'app' | 'script';
  /** U6: the app version that made it (BR-44.4). ⚠️ No hostname — FD Q3 = A. */
  appVersion?: string;
  /** U6: the archive's entries, as written (BR-45.2). */
  entries?: string[];
  [extra: string]: unknown;
}

/**
 * Every table in the database, read from `sqlite_master` rather than from a hardcoded list.
 *
 * ⚠️ Deliberately introspected. Migration 007 added `skip_attempt`, and a hardcoded list would silently
 * stop covering the newest table at exactly the migration a backup exists to protect.
 */
export function tableCounts(db: DatabaseSync): Record<string, number> {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => String(r.name));
  const counts: Record<string, number> = {};
  for (const t of tables) {
    // Identifiers cannot be bound, and these come from sqlite_master rather than from input.
    counts[t] = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get()?.c ?? 0);
  }
  return counts;
}

/** The highest id in each table that has one — a count alone cannot see a delete-plus-insert. */
export function maxIds(db: DatabaseSync, counts: Record<string, number>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const t of Object.keys(counts)) {
    const hasId = Number(db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = 'id'`).get(t)?.c ?? 0);
    if (hasId) {
      const m = db.prepare(`SELECT MAX(id) AS m FROM "${t}"`).get()?.m;
      out[t] = m === null || m === undefined ? null : Number(m);
    }
  }
  return out;
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function schemaVersionOf(db: DatabaseSync): number | null {
  try {
    const v = db.prepare('SELECT MAX(version) AS v FROM schema_version').get()?.v;
    return v === null || v === undefined ? null : Number(v);
  } catch {
    // A database predating the table. `null` is unknown; it is never 0.
    return null;
  }
}
