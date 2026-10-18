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
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ U6 (BR-47.1): the manifest helpers MOVED to src/backup/manifest.ts so the app's in-app backup and this
// script compute a manifest the same way. Re-exported so restore-history.mjs's imports keep working.
// This is why `db:backup` now runs under `node --import tsx`.
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
const OVERRIDE = argv.includes('--i-have-stopped-the-container');
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

export const CONTAINER_NAME = process.env.SPOTIFY_CONTAINER_NAME ?? 'spotify-companion';

/**
 * Is the recording container running?
 *
 * ⚠️ THIS CHECK EXISTS BECAUSE THE EXCLUSIVE-LOCK GUARD CANNOT SEE THE CONTAINER. Probed
 * 2026-09-27: with `spotify-now-playing` up, healthy and actively recording, a host process
 * **successfully acquired `BEGIN EXCLUSIVE`** on `data/history.db`. SQLite's locks do not cross the
 * Rancher Desktop bind mount between the Windows host and the Linux VM, so a host-side lock probe
 * is blind to the one writer that matters.
 *
 * ⚠️ That makes the docstring in `reclassify-unobserved-tails.mjs` — *"This script refuses to apply
 * if it can see the app holding the database"* — **false against the real deployment**, which the
 * container has been since 2026-09-05. It also explains the U4 corruption incident mechanically:
 * the guard passed, so two writers hit one file. A guard that cannot observe the condition it guards
 * is the same family as *"a guard computed the same way as the thing it guards is not a guard"*.
 *
 * ⚠️ FAILS CLOSED. If `docker` is missing or errors, the answer is **unknown**, and unknown is not
 * `false` — this project's rule end to end. Unknown refuses, and `--i-have-stopped-the-container`
 * is the deliberate override.
 */
export function containerState() {
  const r = spawnSync('docker', ['ps', '--filter', `name=^${CONTAINER_NAME}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  if (r.error || r.status !== 0) return { known: false, running: null, detail: r.error?.message ?? `docker exited ${r.status}` };
  return { known: true, running: r.stdout.trim().length > 0, detail: r.stdout.trim() };
}

/**
 * Refuse while anything might be writing the database. TWO checks, because they see different
 * writers and neither sees both:
 *
 *   - the container, via `docker ps`     — the deployment since 2026-09-05, invisible to locking
 *   - another HOST process, via a lock   — e.g. `npm start`, or a second maintenance script
 *
 * ⚠️ The lock probe is kept even though it missed the container. It is not useless, it is
 * *incomplete*: it still catches the `npm start` case that CLAUDE.md warns about. Deleting it
 * because it failed once would remove the half that works.
 *
 * ⚠️ The obvious third guard — "does `history.db-wal` exist?" — does NOT work, and its failure mode
 * is a false positive: any read-only open recreates the WAL, so the check fires after every
 * inspection tool and then gets routinely overridden. A guard that refuses on the normal case is not
 * protecting anything.
 */
export function assertNobodyElseHoldsIt(dbPath, { override = false } = {}) {
  const c = containerState();
  if (!override) {
    if (!c.known) {
      throw new Error(
        `cannot tell whether the ${CONTAINER_NAME} container is running (${c.detail}). ` +
          `Unknown is not "no" — refusing. Pass --i-have-stopped-the-container if you are certain.`,
      );
    }
    if (c.running) {
      throw new Error(
        `the ${CONTAINER_NAME} container is RUNNING and holds this database open. ` +
          `Run \`docker compose down\` first. ` +
          `⚠️ Note the lock probe below CANNOT see it — SQLite locks do not cross the bind mount.`,
      );
    }
  }

  let probe;
  try {
    probe = new DatabaseSync(dbPath);
    probe.exec('PRAGMA locking_mode = EXCLUSIVE');
    probe.exec('BEGIN EXCLUSIVE'); // the lock is only taken on first write
    probe.exec('ROLLBACK');
  } catch (error) {
    throw new Error(
      `could not take an exclusive lock on ${dbPath} — another HOST process holds it, ` +
        `most likely \`npm start\`. (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    probe?.close();
  }
}

function main() {
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
    assertNobodyElseHoldsIt(DB, { override: OVERRIDE });
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
  main();
}
