/**
 * Verify every backup under `data/` and print one line each. READ-ONLY — writes nothing, and works
 * on temp copies so it never opens a backup in place.
 *
 * ⚠️ WHY A SWEEP AND NOT JUST A SINGLE-BACKUP CHECK. The question that matters is not *"is this
 * backup good?"* but *"do I have a good one?"*, and those have different answers. On 2026-09-27 the
 * first run of this found eleven directories of which one was corrupt, nine were intact but had no
 * manifest to check completeness against, and exactly one was fully verified.
 *
 * ⚠️ Run it after a Rancher Desktop upgrade, before any migration, and whenever you are about to
 * rely on a backup. It is the cheapest possible check and it answers the only question that counts.
 *
 * usage: npm run db:verify-backups
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyBackup } from './restore-history.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.argv[2] ?? join(projectRoot, 'data');

const dirs = readdirSync(DATA, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^(backup-|CORRUPT-)/.test(e.name))
  .map((e) => e.name)
  .sort();

if (dirs.length === 0) {
  console.log(`no backup directories under ${DATA}`);
  process.exit(0);
}

const tally = { verified: 0, unverifiable: 0, mismatch: 0, corrupt: 0 };
const rows = [];

for (const name of dirs) {
  const r = verifyBackup(join(DATA, name));
  const by = (n) => r.checks.find((c) => c.name === n);
  const integrity = by('integrity_check ok')?.ok;
  const hasManifest = by('manifest present and parses')?.ok;

  let state;
  if (integrity === false) state = 'corrupt';
  else if (r.ok) state = 'verified';
  else if (!hasManifest) state = 'unverifiable';
  else state = 'mismatch';
  tally[state]++;

  rows.push({
    name,
    state,
    schema: r.schemaVersion ?? '?',
    plays: r.counts?.play ?? '?',
    decisions: r.counts?.decision_log ?? '—',
  });
}

const icon = { verified: '✅', unverifiable: '⚠️ ', mismatch: '✖ ', corrupt: '✖ ' };
const w = Math.max(...rows.map((r) => r.name.length));
console.log('');
for (const r of rows) {
  console.log(
    `${icon[r.state]} ${r.name.padEnd(w)}  v${String(r.schema).padEnd(2)}  ` +
      `plays=${String(r.plays).padStart(5)}  decisions=${String(r.decisions).padStart(5)}  ${r.state}`,
  );
}

console.log(
  `\n  ${tally.verified} fully verified · ${tally.unverifiable} intact but unverifiable · ` +
    `${tally.mismatch} manifest mismatch · ${tally.corrupt} CORRUPT`,
);

// ⚠️ `unverifiable` is NOT a failure and must not be reported as one. It means intact-but-unknown,
// which is what every backup taken before 2026-09-27 is — none of them carried a manifest. Saying
// "9 failed" would train the reader to ignore this output, and then the one real corrupt file goes
// unnoticed. `null` is unknown, and unknown is never `false`.
if (tally.corrupt > 0 || tally.mismatch > 0) {
  console.error(
    `\n✖ ${tally.corrupt + tally.mismatch} backup(s) must not be relied on. Run\n` +
      `  npm run db:restore -- <dir> --verify-only\n  on each for the detail.\n`,
  );
  process.exit(1);
}
if (tally.verified === 0) {
  console.error(
    '\n⚠️ NOT ONE backup is fully verified. Every one is intact-but-unknown, so you do not\n' +
      '   currently know that you can restore anything. Take one with `npm run db:backup`.\n',
  );
  process.exit(1);
}
console.log('');
