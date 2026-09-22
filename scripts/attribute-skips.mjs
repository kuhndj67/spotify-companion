#!/usr/bin/env node
/**
 * Derive `skip_attribution` for plays recorded before the attribution rule existed (FR-20).
 *
 * ## What this corrects
 *
 * Until 2026-09-21 every live skip was written `skip_source = 'user'`, asserted rather than
 * observed. Measured over the corpus, **18 of 35 live skips** were tracks that played to
 * 81–90% and were then replaced by something the listener did not choose. The statistics panel
 * reported those as skips of artists the listener never skips.
 *
 * ## ⚠️ What it does NOT do
 *
 * - **It does not touch `outcome`.** The hypothesis gate's eligibility predicate is
 *   `outcome IN ('completed','skipped')`, and those thresholds are pre-registered constants.
 *   Moving them after a confirmatory run is what pre-registration exists to prevent.
 * - **It does not rewrite `skip_source`.** That column keeps saying `user` on every historical
 *   skip, because that is what the app claimed at the time and erasing it would destroy the
 *   evidence that the claim was ever made.
 * - **It does not touch observations.** Trails are facts; only the derived judgement is
 *   provisional, which is the entire reason this is possible.
 *
 * ## Usage
 *
 *   node scripts/attribute-skips.mjs            # dry run, writes nothing
 *   node scripts/attribute-skips.mjs --apply    # takes its own backup first
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env['HISTORY_DB_PATH'] ?? join(root, 'data', 'history.db');
const apply = process.argv.includes('--apply');

// Mirrors src/history/skipAttribution.ts. ⚠️ Kept in step by attributeSkips.test.ts, which
// asserts the script's constant equals the module's — a second copy that drifts would
// reattribute the corpus differently from the way live plays are attributed.
const USER_SKIP_RATIO_CEILING = 0.75;
const ATTRIBUTION_VERSION = 1;

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

if (apply) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(root, 'data', `backup-before-attribution-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(dbPath, join(backupDir, 'history.db'));
  console.log(`Backup: ${backupDir}`);
}

const db = new DatabaseSync(dbPath);

const rows = db
  .prepare(
    `SELECT id, title, artist_name, provenance, ev_completion_ratio AS ratio,
            ev_duration_ms AS dur, ev_max_progress_ms AS maxp, skip_attribution
       FROM play
      WHERE outcome = 'skipped'
      ORDER BY id`,
  )
  .all();

let user = 0;
let unattributed = 0;
let backfilled = 0;
let unchanged = 0;
const changes = [];

for (const row of rows) {
  // ⚠️ A backfilled row has no trail, so it has no completion ratio to attribute FROM. Its
  // `ratio` column is a zero written by the backfill, not a measurement — attributing on it
  // would read "the listener skipped this" out of the app's own downtime. Left null for ever:
  // `recently-played` reports no progress, so no later pass can answer it either.
  if (row.provenance !== 'live') {
    backfilled += 1;
    continue;
  }

  const attribution = row.ratio < USER_SKIP_RATIO_CEILING ? 'user' : 'unattributed';
  if (attribution === 'user') user += 1;
  else unattributed += 1;

  if (row.skip_attribution === attribution) {
    unchanged += 1;
    continue;
  }
  changes.push({ ...row, attribution });
}

console.log(`\n${rows.length} skipped play(s): ${user} user, ${unattributed} unattributed, ` +
  `${backfilled} backfilled (left null), ${unchanged} already correct\n`);

if (unattributed > 0) {
  console.log('Reattributed AWAY from the listener:');
  for (const c of changes.filter((c) => c.attribution === 'unattributed')) {
    const lost = ((c.dur - c.maxp) / 1000).toFixed(0);
    console.log(
      `  #${String(c.id).padStart(4)} ratio ${c.ratio.toFixed(3)}  ${lost}s unplayed  ` +
        `${String(c.artist_name).slice(0, 26).padEnd(26)} ${String(c.title).slice(0, 30)}`,
    );
  }
}

if (!apply) {
  console.log(`\nDry run. ${changes.length} row(s) would change. Re-run with --apply to write.`);
  db.close();
  process.exit(0);
}

db.exec('BEGIN');
try {
  const update = db.prepare(
    'UPDATE play SET skip_attribution = ?, attribution_version = ? WHERE id = ?',
  );
  for (const c of changes) update.run(c.attribution, ATTRIBUTION_VERSION, c.id);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  console.error('Rolled back:', error);
  process.exit(1);
}

const check = db.prepare('PRAGMA integrity_check').get();
console.log(`\nWrote ${changes.length} row(s). integrity_check: ${check.integrity_check}`);
db.close();
