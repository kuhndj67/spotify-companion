/**
 * Take a VERIFIABLE backup of `data/history.db`.
 *
 * `data/` holds the only artefact in this project that cannot be regenerated. Code comes back from
 * git, labels from MusicBrainz, enrichment from Spotify — months of play records come back from
 * nowhere. This script and `restore-history.mjs` are the pair that makes that recoverable.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN A `cp`. Before 2026-09-27 `data/` held ten ad-hoc backups in five
 * naming conventions, written by three different scripts, and **not one of them had a restore
 * path** — every script wrote a backup, none ever read one back. An unverified backup is a belief,
 * not a guarantee, and this one is a prerequisite for migration 007 for that reason.
 *
 * ⚠️ A FILE COPY IS NOT A BACKUP, AND THE MEASURED REASON IS NOT THE ONE THAT WAS WRITTEN DOWN.
 * `history.db-wal` really can be larger than `history.db` — 3673 KB against 3396 KB, measured
 * 2026-09-27. The project's notes inferred from that that copying the `.db` alone "loses over half
 * the corpus". **That inference is false**: measured on the live database the same day, a `.db`-only
 * copy held 824 of 850 plays. WAL size tracks *page churn*, not row count.
 *
 * ⚠️ The corrected reading is MORE dangerous, not less. The loss is 3%, it is confined to the
 * newest rows, and the truncated copy opens with `integrity_check: ok`. A 50% loss announces
 * itself; three percent of the most recent plays does not. So: checkpoint first — but do it for the
 * real reason, which is that the uncheckpointed frames are exactly the plays you have not got
 * anywhere else yet.
 *
 * ⚠️ AND ROW COUNTS ARE NOT VERIFICATION. `data/CORRUPT-snapshot-20260921-201444` reports a
 * perfectly plausible 586 plays and 126 decision rows, and **fails `integrity_check`**. A verifier
 * that counted rows would have passed it. That file is kept deliberately as the known-bad case
 * `restore-history.mjs --verify-only` is tested against — a probe that says "no problem" must be
 * checked against a case where you know what the answer has to be.
 *
 * ⚠️ STOP THE CONTAINER FIRST: `docker compose down`. Checkpointing is a WRITE, so this script is a
 * writer and the standing hazard applies to it. Running a writer against the live container
 * corrupted this database once already (audit 2026-09-21); it reported `integrity_check: ok` at the
 * time and surfaced later as a just-written value reading null. This script refuses rather than
 * trusting the operator to remember.
 *
 * usage:
 *   node scripts/backup-history.mjs --label before-migration-007
 *   node scripts/backup-history.mjs --label nightly --out D:/somewhere/else
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ U6 (BR-47.1): the manifest helpers MOVED to src/backup/manifest.ts so the app's in-app backup and this
// script compute a manifest the same way. Re-exported so restore-history.mjs's imports keep working.
// This is why `db:backup` now runs under `node --import tsx`.
import { WriterLock } from '../src/lock/WriterLock.js';
import { readAppVersion } from '../src/version.js';
import { MANIFEST_NAME, MANIFEST_SCHEMA, maxIds, schemaVersionOf, sha256, tableCounts } from '../src/backup/manifest.js';
export { MANIFEST_NAME, MANIFEST_SCHEMA, maxIds, schemaVersionOf, sha256, tableCounts };

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db');

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}

const LABEL = flag('label');
const OUT_DIR = flag('out', join(projectRoot, 'data'));

// ── ONE naming convention, and the label is required ─────────────────────────────────────────
//
// The ten pre-existing backups used five conventions — `-20260905-202637`, `-20260923T011356Z`,
// `-2026-09-22T00-08-11-067Z` and two more — which sorted inconsistently and, worse, gave two
// backups taken eight minutes apart names that no one could tell apart by purpose. The label is
// mandatory because a backup whose reason is not recorded is one nobody will dare delete and
// nobody will dare restore.
function stamp(now) {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')}Z`;
}

/**
 * U10 (FR-77, BR-78.7, P-79): hold the ONE writer lock for as long as this script runs.
 *
 * Replaces the `docker ps` guard (`assertNobodyElseHoldsIt`), which could see only a container on THIS machine and
 * not a host `npm start`, and whose SQLite lock probe could not see the container at all (locks do not cross the
 * Rancher bind mount, probed 2026-09-27). The lock file is exclusive across the mount in both directions (probed
 * 2026-10-21), and the app takes the same lock, so one rule now answers *is anyone else writing?*
 *
 * A held lock is watched for one stale window (30 s) before any verdict: a live holder refuses this script, naming
 * itself; a dead one is taken over. Released on exit.
 *
 * ⚠️ Until `1.0.0-beta.9` is deployed, the running container does not take this lock: stop it first
 * (`docker compose down`), as before.
 */
export async function holdWriterLock(dbPath, script, timings = {}) {
  // `timings` exists for the tests (heartbeat and stale window in milliseconds); the scripts never pass it.
  const lock = new WriterLock({ databasePath: dbPath, kind: `script:${script}`, appVersion: readAppVersion(), ...timings });
  const outcome = await lock.acquire();
  if (!outcome.ok) {
    throw new Error(`${outcome.detail}. Stop it first (docker compose down, or end npm start), then run this again.`);
  }
  lock.startHeartbeat();
  process.on('exit', () => lock.release());
  return lock;
}

async function main() {
  if (!LABEL) {
    console.error(
      '\n✖ --label is required.\n' +
        '  A backup whose reason is not recorded is one nobody will dare delete and nobody will\n' +
        '  dare restore. Example: --label before-migration-007\n',
    );
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(LABEL)) {
    console.error(`\n✖ --label must be lower-case letters, digits and hyphens. Got: ${LABEL}\n`);
    process.exit(2);
  }
  if (!existsSync(DB)) {
    console.error(`\n✖ no database at ${DB}\n`);
    process.exit(2);
  }

  try {
    await holdWriterLock(DB, 'db-backup');
  } catch (error) {
    console.error(`\n✖ REFUSING TO BACK UP: ${error.message}\n`);
    process.exit(2);
  }

  // ── checkpoint, so the backup is of a whole file rather than a split one ────────────────────
  let checkpoint = null;
  const wal = `${DB}-wal`;
  const walBytesBefore = existsSync(wal) ? statSync(wal).size : 0;
  if (walBytesBefore > 0) {
    const cp = new DatabaseSync(DB);
    checkpoint = cp.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    cp.close();
  }

  // ── verify the SOURCE before copying it ────────────────────────────────────────────────────
  //
  // Backing up a corrupt database produces a corrupt backup that looks like insurance. The
  // CORRUPT- snapshot in `data/` is what that looks like after the fact.
  const src = new DatabaseSync(DB, { readOnly: true });
  const integrity = src.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') {
    src.close();
    console.error(
      `\n✖ REFUSING TO BACK UP: the SOURCE database fails integrity_check: ${integrity}\n` +
        `  Backing this up would produce a corrupt backup that looks like insurance.\n`,
    );
    process.exit(2);
  }
  const counts = tableCounts(src);
  const ids = maxIds(src, counts);
  const schemaVersion = schemaVersionOf(src);
  const journalMode = src.prepare('PRAGMA journal_mode').get().journal_mode;
  src.close();

  // ── copy ───────────────────────────────────────────────────────────────────────────────────
  const takenAt = new Date();
  const dir = join(OUT_DIR, `backup-${LABEL}-${stamp(takenAt)}`);
  mkdirSync(dir, { recursive: true });

  const copied = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${DB}${suffix}`;
    if (!existsSync(from)) continue;
    const to = join(dir, `history.db${suffix}`);
    copyFileSync(from, to);
    copied.push({ file: `history.db${suffix}`, bytes: statSync(to).size });
  }

  const manifest = {
    manifestSchema: MANIFEST_SCHEMA,
    label: LABEL,
    takenAt: takenAt.toISOString(),
    source: DB,
    schemaVersion,
    journalMode,
    integrityCheckAtBackup: integrity,
    walBytesBeforeCheckpoint: walBytesBefore,
    checkpoint,
    files: copied,
    sha256: { 'history.db': sha256(join(dir, 'history.db')) },
    counts,
    maxIds: ids,
    // Stated in the record rather than only in this comment, because whoever reads the manifest
    // during an incident will not be reading the script.
    verification:
      'A restore is verified by integrity_check AND these counts. Counts alone are insufficient: ' +
      'data/CORRUPT-snapshot-20260921-201444 reports 586 plays and fails integrity_check.',
  };
  writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\n✅ backed up to ${dir}`);
  console.log(`   schema v${schemaVersion} · integrity_check: ${integrity}`);
  if (checkpoint) console.log(`   checkpointed ${walBytesBefore} WAL bytes: ${JSON.stringify(checkpoint)}`);
  else console.log(`   WAL was already empty — nothing to checkpoint`);
  for (const [t, c] of Object.entries(counts)) console.log(`   ${String(c).padStart(7)}  ${t}`);
  console.log(
    `\n   ⚠️ NOT YET VERIFIED AS RESTORABLE. Verify it now, while you still have the original:\n` +
      `      npm run db:restore -- ${dir} --verify-only\n`,
  );
}

// Importable for tests; only runs when invoked directly.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  await main();
}
