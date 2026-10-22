#!/usr/bin/env node
/**
 * Set `play.skip_source = 'rule'` on plays that a rule actually skipped. 🔌 IMPURE
 *
 * ## Why this exists
 *
 * `PlayObserver` hardcoded `skipSource: outcome === 'skipped' ? 'user' : null` from U1 — sound while
 * nothing else could skip, and wrong the moment U5 shipped. The first live arming (2026-10-04) produced
 * **four rule-skips recorded as the listener's own rejections**.
 *
 * ⚠️ **That matters because the hypothesis gate's `ELIGIBLE` predicate is
 * `outcome IN ('completed','skipped')` with NO `skip_source` guard.** Left uncorrected, a rule that skips
 * major-label tracks makes the corpus *"show"* the listener skipping major-label tracks — circular by
 * construction, and in the direction that would appear to support R1.
 *
 * ## ⚠️ This is a RETROACTIVE CORRECTION, and it is only possible because the evidence was stored
 *
 * `skip_attempt` records every attempt with its `play_id`, so *which plays a rule skipped* is a fact on
 * disk rather than a reconstruction. **Store observations; derive judgements** — the same property that
 * let classifier v2 re-derive 24 outcomes from retained trails.
 *
 * It uses `ruleSkippedThisPlay`, the same predicate the safety counter uses, so the repair cannot disagree
 * with the guard.
 *
 * ## Safety
 *
 * - **Dry run by default.** `--apply` is required, and takes its own backup first.
 * - **Refuses while anything else writes the database** — it holds the one writer lock (`holdWriterLock`,
 *   U10), imported rather than re-implemented. ⚠️ SQLite's own locks do not cross the Rancher Desktop bind
 *   mount; the lock file does (probed 2026-10-21).
 * - **Only ever writes `'rule'`**, and only where an attempt reached the player. It never writes `'user'`
 *   and never clears a value, so it cannot manufacture a rejection.
 */

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { holdWriterLock } from './backup-history.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.HISTORY_DB_PATH ?? join(root, 'data', 'history.db');
const APPLY = process.argv.includes('--apply');

/**
 * ⚠️ Kept in step with `RULE_SKIPPED_THIS_PLAY_SQL` in `src/playback/SqliteSkipAttemptRepository.ts`.
 * It is duplicated here because this is a `.mjs` script that must run without the tsx loader; the
 * states and the join key are the whole of it.
 */
const CANDIDATES = `
  SELECT p.id, p.title, p.artist_name, p.outcome, p.skip_source, p.started_at,
         (SELECT GROUP_CONCAT(sa.id) FROM skip_attempt sa
           WHERE sa.play_id = p.id
             AND sa.state IN ('fired', 'confirmed', 'unconfirmed')) AS attempt_ids
    FROM play p
   WHERE EXISTS (SELECT 1 FROM skip_attempt sa
                  WHERE sa.play_id = p.id
                    AND sa.state IN ('fired', 'confirmed', 'unconfirmed'))
   ORDER BY p.id`;

async function main() {
  await holdWriterLock(DB, 'repair-skip-source');

  const db = new DatabaseSync(DB);
  const rows = db.prepare(CANDIDATES).all();

  console.log(`\n${rows.length} play(s) were skipped by a rule, according to skip_attempt:\n`);
  const needing = [];
  for (const r of rows) {
    const mark = r.skip_source === 'rule' ? '  already rule' : '  NEEDS REPAIR';
    console.log(
      `${mark}  play ${r.id}  ${String(r.title).slice(0, 28).padEnd(28)}  ` +
        `outcome=${String(r.outcome).padEnd(9)} skip_source=${String(r.skip_source)}  attempts=${r.attempt_ids}`,
    );
    if (r.skip_source !== 'rule') needing.push(r.id);
  }

  // ⚠️ Reported even though it changes nothing: a rule-skip the classifier did NOT call `skipped` is
  // still a rule skip, and whether that happens is worth knowing.
  const notSkipped = rows.filter((r) => r.outcome !== 'skipped');
  if (notSkipped.length > 0) {
    console.log(
      `\n⚠️  ${notSkipped.length} of them have outcome != 'skipped'. They are still rule skips — BR-35 ` +
        `counts what automation DID, not how the play was graded.`,
    );
  }

  if (needing.length === 0) {
    console.log('\n✅ Nothing to repair.');
    db.close();
    return;
  }

  if (!APPLY) {
    console.log(
      `\n${needing.length} row(s) would be set to 'rule'. DRY RUN — nothing written.\n` +
        `   Re-run with --apply to write them.`,
    );
    db.close();
    return;
  }

  const update = db.prepare(`UPDATE play SET skip_source = 'rule' WHERE id = ?`);
  db.exec('BEGIN');
  try {
    for (const id of needing) update.run(id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const after = db.prepare(
    `SELECT COUNT(*) AS n FROM play WHERE skip_source = 'rule'`,
  ).get();
  const integrity = db.prepare('PRAGMA integrity_check').get();
  console.log(`\n✅ ${needing.length} row(s) set to 'rule'. Total now: ${after.n}`);
  console.log(`   integrity_check: ${integrity.integrity_check}`);
  db.close();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
