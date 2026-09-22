#!/usr/bin/env node
/**
 * Re-measure the claims behind open item 4.
 *
 * ## Why this exists
 *
 * Item 4 stood in CLAUDE.md for 20 days asserting four numbers, every one of them taken at
 * n≈10 and **none of which replicated** at 10× the sample:
 *
 * | Claimed 2026-09-02 | Measured 2026-09-22 |
 * |---|---|
 * | majors ~30% longer (248 s vs 191 s) | 213 s vs 201 s — a 6% gap |
 * | 13 of 27 plays crowd the threshold (48%) | 52 of 443 (11.7%) |
 * | crossfade is the mechanism | ruled out — 21–41 s lost, cap is 12 s |
 * | correction moves the result toward R1 | backwards |
 *
 * ⚠️ **The item itself flagged the risk** — *"n=10/11, so the duration gap may be chance"* — and
 * it was read as fact anyway. A number that has to be re-derived by hand does not get
 * re-derived. Run this instead of trusting the prose.
 *
 *   node scripts/measure-confound.mjs
 *
 * ⚠️ **Read-only, and this is NOT the hypothesis gate.** Under BR-11.7 the single confirmatory
 * evaluation was spent on 2026-09-10. Everything here is exploratory and cannot discharge
 * anything.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env['HISTORY_DB_PATH'] ?? join(root, 'data', 'history.db');

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

const LIVE = "provenance = 'live'";
const pct = (n, d) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

console.log('\n=== 1. Track duration by label class (the "majors run longer" claim) ===');
for (const group of ['major', 'independent', 'unknown']) {
  const rows = all(
    `SELECT ev_duration_ms d FROM play WHERE ${LIVE} AND ev_duration_ms > 0 AND label_verdict = ?`,
    group,
  );
  const med = median(rows.map((r) => r.d));
  console.log(
    `  ${group.padEnd(12)} n=${String(rows.length).padStart(4)}  median ${med === null ? 'n/a' : Math.round(med / 1000) + 's'}`,
  );
}
console.log('  ⚠️ Claimed 2026-09-02 at n=10/11: majors 248s, independents 191s (a ~30% gap).');

console.log('\n=== 2. Crowding around the 0.90 completion threshold ===');
const tc = all(
  `SELECT ev_completion_ratio r FROM play WHERE ${LIVE} AND close_reason = 'track-change' AND ev_duration_ms > 0`,
);
const near = tc.filter((x) => Math.abs(x.r - 0.9) <= 0.05).length;
console.log(`  ${near} of ${tc.length} live track-change plays within ±0.05 of 0.90  (${pct(near, tc.length)})`);
console.log('  ⚠️ Claimed 2026-09-02: 13 of 27 (48%).');

console.log('\n=== 3. How much is actually left unplayed (crossfade is capped at 12s) ===');
const lost = tc.length
  ? all(
      `SELECT (ev_duration_ms - ev_max_progress_ms) / 1000.0 s FROM play
        WHERE ${LIVE} AND close_reason = 'track-change' AND ev_duration_ms > 0`,
    ).map((r) => r.s)
  : [];
// ⚠️ Clamped. `Math.floor(n * 1)` indexes one past the end, which silently reported max as 0
// -- a quantile helper that returns a plausible wrong number rather than failing.
const sortedLost = [...lost].sort((a, b) => a - b);
const q = (p) => sortedLost[Math.min(sortedLost.length - 1, Math.floor(sortedLost.length * p))] ?? 0;
console.log(`  median ${q(0.5).toFixed(1)}s   p90 ${q(0.9).toFixed(1)}s   max ${q(1).toFixed(1)}s`);
const unattributedLost = all(
  `SELECT (ev_duration_ms - ev_max_progress_ms) / 1000.0 s FROM play
    WHERE ${LIVE} AND skip_attribution = 'unattributed'`,
).map((r) => r.s);
if (unattributedLost.length > 0) {
  console.log(
    `  unattributed skips lose ${Math.min(...unattributedLost).toFixed(0)}–${Math.max(...unattributedLost).toFixed(0)}s ` +
      `(n=${unattributedLost.length}) — ⚠️ above the 12s crossfade cap means crossfade is not the mechanism`,
  );
}

console.log('\n=== 4. Direction: who does the correction actually remove skips from? ===');
console.log('  group        eligible  allSkips          userSkips         unattributed/allSkips');
for (const group of ['major', 'independent', 'unknown']) {
  const r = one(
    `SELECT COUNT(*) elig,
            SUM(CASE WHEN outcome = 'skipped' THEN 1 ELSE 0 END) sk,
            SUM(CASE WHEN skip_attribution = 'user' THEN 1 ELSE 0 END) usk,
            SUM(CASE WHEN skip_attribution = 'unattributed' THEN 1 ELSE 0 END) un
       FROM play
      WHERE ${LIVE} AND outcome IN ('completed','skipped') AND label_verdict = ?`,
    group,
  );
  console.log(
    `  ${group.padEnd(12)} ${String(r.elig).padStart(8)}  ` +
      `${String(r.sk).padStart(3)} (${pct(r.sk, r.elig).padStart(5)})  ` +
      `${String(r.usk).padStart(3)} (${pct(r.usk, r.elig).padStart(5)})  ` +
      `${String(r.un).padStart(3)}/${r.sk} (${pct(r.un, r.sk)})`,
  );
}

console.log(
  '\n⚠️ EXPLORATORY. BR-11.7 spent the single confirmatory evaluation on 2026-09-10; nothing\n' +
    '   here re-opens it. Small counts here are noise, not findings — the whole reason item 4\n' +
    '   needed rewriting is that numbers at n≈10 were written down and then believed.\n',
);

db.close();
