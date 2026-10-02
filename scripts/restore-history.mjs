/**
 * Restore `data/history.db` from a backup — and, more importantly, VERIFY that a backup could be
 * restored, before you need it to be.
 *
 * ⚠️ THIS IS THE HALF THAT HAS NEVER EXISTED. Until 2026-09-27 `data/` held ten backups written by
 * three scripts and **nothing ever read one back**. That is not a gap in tooling, it is a gap in
 * knowledge: a backup nobody has restored is a belief about a file, and the one time this project
 * needed it (the U4 corruption incident, audit 2026-09-21) the recovery was improvised.
 *
 * ⚠️ `--verify-only` IS THE COMMAND THAT MATTERS, and it is safe to run at any time against any
 * backup. It writes nothing and touches no live file. Run it on the day you take a backup, not on
 * the day you need one.
 *
 * ── What verification means here, and why counting rows is not it ────────────────────────────
 *
 * `data/CORRUPT-snapshot-20260921-201444` opens cleanly, reports a **plausible** 586 plays and 126
 * decision rows, and **fails `integrity_check`**. A verifier that compared row counts against a
 * manifest would have passed that file and called it insurance. So verification is:
 *
 *   1. the file's sha256 matches the manifest        — it is the file that was backed up
 *   2. `integrity_check` returns ok                  — ⚠️ the check the CORRUPT snapshot fails
 *   3. every table's count matches the manifest      — it is as COMPLETE as when backed up
 *   4. every max(id) matches the manifest            — a delete-plus-insert keeps counts equal
 *   5. schema_version matches the manifest           — it is the era it claims to be
 *
 * ⚠️ AND THE VERIFIER ITSELF IS VERIFIED. A checker that only ever sees good input is
 * indistinguishable from one that returns ok unconditionally — this project has been bitten by
 * exactly that (PBT-22 passed trivially against counts that were always zero). So
 * `--self-test` runs the verifier against the known-bad CORRUPT snapshot and FAILS if it passes.
 *
 * ── Restoring ────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ DRY RUN BY DEFAULT. `--apply` writes. And `--apply` takes its own backup of whatever is
 * currently there first, so a restore is itself reversible — restoring the wrong backup must not be
 * the unrecoverable act.
 *
 * ⚠️ STOP THE CONTAINER FIRST: `docker compose down`. This refuses rather than trusting you to
 * remember — and it refuses on `docker ps`, NOT on a SQLite lock. Probed 2026-09-27: a host process
 * can take `BEGIN EXCLUSIVE` while the container holds the database open, because SQLite's locks do
 * not cross the Rancher Desktop bind mount. A lock-based guard is blind to the only writer that
 * matters. See `backup-history.mjs`.
 *
 * ⚠️ IT WILL NOT SILENTLY DOWNGRADE THE SCHEMA. Backups in `data/` span schema v3 to v6. Restoring
 * an older one under a newer image is fine — `migrate` rolls it forward. Restoring a NEWER backup
 * under an older image is not: `migrate` skips versions at or below current, so the app would run
 * against a schema it does not know it has. That is refused unless `--allow-schema-downgrade`.
 *
 * usage:
 *   node scripts/restore-history.mjs <backup-dir> --verify-only   # safe, writes nothing
 *   node scripts/restore-history.mjs --self-test                  # prove the verifier rejects bad input
 *   node scripts/restore-history.mjs <backup-dir>                 # dry run: says what it would do
 *   node scripts/restore-history.mjs <backup-dir> --apply         # restores, after backing up current
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST_NAME,
  assertNobodyElseHoldsIt,
  maxIds,
  schemaVersionOf,
  sha256,
  tableCounts,
} from './backup-history.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db');
const KNOWN_BAD = join(projectRoot, 'data', 'CORRUPT-snapshot-20260921-201444');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const VERIFY_ONLY = argv.includes('--verify-only');
const SELF_TEST = argv.includes('--self-test');
const ALLOW_DOWNGRADE = argv.includes('--allow-schema-downgrade');
const OVERRIDE = argv.includes('--i-have-stopped-the-container');
const DIR = argv.find((a) => !a.startsWith('--'));

/**
 * Verify a backup directory. Returns { ok, checks: [{name, ok, detail}], manifest }.
 *
 * ⚠️ It works on a COPY in a temp directory and never opens the backup in place. Opening a SQLite
 * file read-write modifies it — a verifier that mutated the thing it was checking would slowly
 * consume the backups it exists to protect, and a read-only open still recreates a WAL beside them.
 */
export function verifyBackup(dir) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  const manifestPath = join(dir, MANIFEST_NAME);
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      add('manifest present and parses', true, `label=${manifest.label} takenAt=${manifest.takenAt}`);
    } catch (e) {
      add('manifest present and parses', false, e.message);
    }
  } else {
    // ⚠️ Not a hard failure. Ten pre-existing backups have no manifest, and refusing to look at
    // them would make this tool useless for exactly the backups most in need of checking. What is
    // lost is completeness — integrity can still be checked, counts cannot be compared to anything.
    add('manifest present and parses', false, 'NO MANIFEST — pre-dates backup-history.mjs');
  }

  const dbFile = join(dir, 'history.db');
  if (!existsSync(dbFile)) {
    add('history.db present', false, dir);
    return { ok: false, checks, manifest };
  }
  add('history.db present', true, `${Math.round(statSync(dbFile).size / 1024)} KB`);

  if (manifest?.sha256?.['history.db']) {
    const actual = sha256(dbFile);
    const expected = manifest.sha256['history.db'];
    add('sha256 matches manifest', actual === expected, actual === expected ? '' : `${actual.slice(0, 16)}… != ${expected.slice(0, 16)}…`);
  }

  const work = mkdtempSync(join(tmpdir(), 'restore-verify-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${dbFile}${suffix}`;
      if (existsSync(from)) copyFileSync(from, join(work, `history.db${suffix}`));
    }
    const db = new DatabaseSync(join(work, 'history.db'));

    // ⚠️ THE CHECK THE CORRUPT SNAPSHOT FAILS. Everything else about that file looks fine.
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    add('integrity_check ok', integrity === 'ok', integrity);

    const schemaVersion = schemaVersionOf(db);
    const counts = tableCounts(db);
    const ids = maxIds(db, counts);
    db.close();

    add('schema_version readable', schemaVersion !== null, `v${schemaVersion}`);

    if (manifest) {
      if (manifest.schemaVersion !== undefined) {
        const ok = manifest.schemaVersion === schemaVersion;
        add('schema_version matches manifest', ok, ok ? `v${schemaVersion}` : `v${schemaVersion} != v${manifest.schemaVersion}`);
      }
      if (manifest.counts) {
        const bad = Object.entries(manifest.counts).filter(([t, c]) => counts[t] !== c);
        add(
          'every table count matches manifest',
          bad.length === 0,
          bad.length === 0
            ? `${Object.keys(manifest.counts).length} tables`
            : bad.map(([t, c]) => `${t}: ${counts[t]} != ${c}`).join(', '),
        );
      }
      if (manifest.maxIds) {
        const bad = Object.entries(manifest.maxIds).filter(([t, m]) => ids[t] !== m);
        add(
          'every max(id) matches manifest',
          bad.length === 0,
          bad.length === 0 ? '' : bad.map(([t, m]) => `${t}: ${ids[t]} != ${m}`).join(', '),
        );
      }
    }

    return { ok: checks.every((c) => c.ok), checks, manifest, schemaVersion, counts, maxIds: ids };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Three outcomes, and conflating them is a real hazard — an earlier version of this script printed
 * "could not be checked against a manifest" for a backup whose manifest was present and DISAGREED.
 * Found by the tamper rehearsal, 2026-09-27.
 *
 *   corrupt        integrity_check failed — the bytes are damaged
 *   mismatch       ⚠️ integrity is fine and the manifest disagrees. This is NOT the database that
 *                  was backed up: rows are missing, or it is a different file entirely
 *   unverifiable   no manifest (the ten pre-2026-09-27 backups). Intact, completeness unknown
 *
 * ⚠️ The distinction matters because `integrity_check` and the manifest catch DIFFERENT failures and
 * neither catches the other's. Measured in the rehearsal: a backup with one play deleted returns
 * `integrity_check: ok`, and the CORRUPT snapshot returns plausible row counts. Integrity sees
 * damage; the manifest sees incompleteness. A verifier needs both.
 */
function classify(result) {
  const by = (n) => result.checks.find((c) => c.name === n);
  if (by('integrity_check ok')?.ok === false) return 'corrupt';
  const disagreements = [
    'sha256 matches manifest',
    'schema_version matches manifest',
    'every table count matches manifest',
    'every max(id) matches manifest',
  ].map(by).filter((c) => c && !c.ok);
  if (disagreements.length > 0) return 'mismatch';
  if (by('manifest present and parses')?.ok === false) return 'unverifiable';
  return 'other';
}

function diagnose(result) {
  switch (classify(result)) {
    case 'corrupt':
      return '✖ NOT RESTORABLE: integrity_check failed — the file is damaged. Do not restore it.\n';
    case 'mismatch':
      return (
        '✖ NOT THE DATABASE THAT WAS BACKED UP. integrity_check passes, but the manifest\n' +
        '  disagrees (see above): rows are missing, or this is a different file altogether.\n' +
        '  ⚠️ This is MORE serious than a missing manifest, not less — the file is internally\n' +
        '  consistent, so nothing else will ever complain about it.\n'
      );
    case 'unverifiable':
      return (
        '⚠️ INCOMPLETELY VERIFIED: intact, but there is no manifest to check it against, so its\n' +
        '  COMPLETENESS is unknown. Intact is not the same as whole. Expected for the ten backups\n' +
        '  taken before 2026-09-27.\n'
      );
    default:
      return '✖ verification failed — read the checks above.\n';
  }
}

function report(dir, result) {
  console.log(`\nverifying ${dir}`);
  for (const c of result.checks) {
    console.log(`  ${c.ok ? '✅' : '✖ '} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  if (result.counts) {
    for (const [t, c] of Object.entries(result.counts)) console.log(`      ${String(c).padStart(7)}  ${t}`);
  }
  return result.ok;
}

/**
 * ⚠️ Prove the verifier can FAIL. A checker that has only ever seen good input is
 * indistinguishable from one that returns ok unconditionally.
 */
function selfTest() {
  console.log('\n── self-test: the verifier must REJECT a known-bad backup ──');
  if (!existsSync(KNOWN_BAD)) {
    console.error(
      `\n✖ SELF-TEST CANNOT RUN: ${KNOWN_BAD} is missing.\n` +
        `  That directory is the known-bad case this verifier is tested against. It is kept\n` +
        `  deliberately — if it was tidied away, the verifier lost its only negative control.\n`,
    );
    process.exit(2);
  }
  const bad = verifyBackup(KNOWN_BAD);
  report(KNOWN_BAD, bad);
  const integrity = bad.checks.find((c) => c.name === 'integrity_check ok');
  if (bad.ok || integrity?.ok !== false) {
    console.error(
      '\n✖ SELF-TEST FAILED: the verifier PASSED a database known to be corrupt.\n' +
        '  Do not trust any verification this script reports until that is fixed.\n',
    );
    process.exit(1);
  }
  console.log(
    '\n✅ self-test passed: the verifier rejected the corrupt snapshot on integrity_check,\n' +
      `   having counted a plausible ${bad.counts?.play ?? '?'} plays first. Row counts alone would\n` +
      '   have passed it.\n',
  );
}

function main() {
  if (SELF_TEST) {
    selfTest();
    if (!DIR) return;
  }
  if (!DIR) {
    console.error('\n✖ give a backup directory, or --self-test\n');
    process.exit(2);
  }
  if (!existsSync(DIR)) {
    console.error(`\n✖ no such directory: ${DIR}\n`);
    process.exit(2);
  }

  const result = verifyBackup(DIR);
  const ok = report(DIR, result);

  if (VERIFY_ONLY) {
    if (ok) {
      console.log('\n✅ VERIFIED RESTORABLE. Nothing was written.\n');
      return;
    }
    console.error(`\n${diagnose(result)}`);
    process.exit(1);
  }

  if (!ok) {
    console.error(`\n${diagnose(result)}`);
    // ⚠️ Corruption and disagreement are both refusals; only a MISSING manifest is a judgement call.
    if (classify(result) !== 'unverifiable') process.exit(2);
  }

  // ── schema direction ────────────────────────────────────────────────────────────────────────
  let liveVersion = null;
  if (existsSync(DB)) {
    const live = new DatabaseSync(DB, { readOnly: true });
    liveVersion = schemaVersionOf(live);
    live.close();
  }
  const backupVersion = result.schemaVersion;
  if (liveVersion !== null && backupVersion !== null && backupVersion > liveVersion && !ALLOW_DOWNGRADE) {
    console.error(
      `\n✖ REFUSING TO RESTORE: the backup is schema v${backupVersion} and the live database is ` +
        `v${liveVersion}.\n` +
        `  \`migrate\` skips versions at or below current, so this image would run against a schema\n` +
        `  it does not know it has. Use the matching image, or --allow-schema-downgrade if you mean it.\n`,
    );
    process.exit(2);
  }

  if (!APPLY) {
    console.log(
      `\n── DRY RUN. Nothing written. With --apply this would:\n` +
        `   1. refuse if anything holds ${DB}\n` +
        `   2. back up the CURRENT database first (label: before-restore)\n` +
        `   3. copy history.db, -wal and -shm from the backup over it\n` +
        `   4. re-verify the restored database and print its counts\n` +
        `   live schema: v${liveVersion} · backup schema: v${backupVersion}\n`,
    );
    return;
  }

  // ── apply ───────────────────────────────────────────────────────────────────────────────────
  try {
    if (existsSync(DB)) assertNobodyElseHoldsIt(DB, { override: OVERRIDE });
  } catch (error) {
    console.error(`\n✖ REFUSING TO RESTORE: ${error.message}\n`);
    process.exit(2);
  }

  // ⚠️ Restoring the wrong backup must not be the unrecoverable act.
  if (existsSync(DB)) {
    const safety = join(dirname(DB), `backup-before-restore-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')}Z`);
    mkdirSync(safety, { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(`${DB}${suffix}`)) copyFileSync(`${DB}${suffix}`, join(safety, `history.db${suffix}`));
    }
    console.log(`\n   current database preserved at ${safety}`);
  }

  // Remove the live sidecars before copying: a stale -wal beside a restored .db is a split file
  // describing two different databases, which is worse than either alone.
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${DB}${suffix}`)) unlinkSync(`${DB}${suffix}`);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const from = join(DIR, `history.db${suffix}`);
    if (existsSync(from)) copyFileSync(from, `${DB}${suffix}`);
  }

  const after = new DatabaseSync(DB, { readOnly: true });
  const integrity = after.prepare('PRAGMA integrity_check').get().integrity_check;
  const counts = tableCounts(after);
  const version = schemaVersionOf(after);
  after.close();

  console.log(`\n✅ restored from ${DIR}`);
  console.log(`   schema v${version} · integrity_check: ${integrity}`);
  for (const [t, c] of Object.entries(counts)) console.log(`   ${String(c).padStart(7)}  ${t}`);
  if (integrity !== 'ok') {
    console.error('\n✖ THE RESTORED DATABASE FAILS integrity_check. Do not start the app.\n');
    process.exit(1);
  }
  console.log('\n   Start the container when you are ready: docker compose up -d\n');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
