/**
 * Repair the damage done by the `played_at` defect (fixed 2026-09-06).
 *
 * ## What was wrong
 *
 * `GET /me/player/recently-played` returns one timestamp per item, `played_at`, and it is the
 * moment the track **finished**. `RecentlyPlayedBackfill` stored it as the play's `startedAt`
 * *and* its `endedAt`. Two consequences:
 *
 *   1. Every backfilled row starts about one track duration late, and has zero span.
 *   2. Deduplication compared that end-timestamp against stored *starts*, putting a whole track
 *      between the two instants. So a play already recorded live never matched, and every
 *      restart inserted it again as a fresh `unknown` row.
 *
 * The evidence is measured, not read: across 41 plays this app had itself observed start and end,
 * `played_at` matched the recorded END with a median error of 3.0 s and a maximum of 8.8 s.
 *
 * ## What this script does
 *
 *   A. Rewrites `started_at` to `ended_at - ev_duration_ms` for backfilled rows. `ended_at` is
 *      already correct — it is the value Spotify actually reported — so nothing measured is
 *      being overwritten, only a value that was mis-assigned.
 *   B. Deletes backfilled rows that duplicate a play already recorded live, identified by their
 *      end timestamps landing within a tolerance of each other.
 *
 * ## ⚠️ Read this before running it with --apply
 *
 * `data/history.db` is the one artefact in this project that cannot be regenerated. This script
 * **refuses to run without a backup** and prints exactly what it would change first. Dry run is
 * the default; `--apply` is required to write anything, and it makes its own timestamped copy.
 *
 * Deletion is used rather than a `superseded` flag because these rows are not observations that
 * turned out to be wrong — they are rows that never corresponded to a distinct listening event.
 * Retaining them would mean every consumer had to learn to exclude them, forever.
 *
 *   node scripts/repair-backfill-timestamps.mjs            # dry run, writes nothing
 *   node scripts/repair-backfill-timestamps.mjs --apply    # backs up, then repairs
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';

const DB_PATH = process.env.HISTORY_DB_PATH ?? 'data/history.db';
const APPLY = process.argv.includes('--apply');

/** Two plays of the same track ending this close are the same event. Matches the shipped dedup. */
const DEDUP_TOLERANCE_MS = 60_000;

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}.`);
  process.exit(1);
}

if (APPLY) {
  const backup = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(DB_PATH, backup);
  console.log(`Backup written: ${backup}\n`);
}

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });

const backfilled = db
  .prepare(
    `SELECT id, track_id, title, artist_name, started_at, ended_at, ev_duration_ms
       FROM play WHERE provenance = 'backfilled' ORDER BY id`,
  )
  .all();

const live = db
  .prepare(`SELECT id, track_id, started_at, ended_at FROM play WHERE provenance = 'live'`)
  .all();

const liveByTrack = new Map();
for (const row of live) {
  if (!liveByTrack.has(row.track_id)) liveByTrack.set(row.track_id, []);
  liveByTrack.get(row.track_id).push(row);
}

const duplicates = [];
const reshape = [];

for (const row of backfilled) {
  const end = Date.parse(row.ended_at);

  const twin = (liveByTrack.get(row.track_id) ?? []).find(
    (l) => Math.abs(Date.parse(l.ended_at) - end) <= DEDUP_TOLERANCE_MS,
  );

  if (twin !== undefined) {
    duplicates.push({ ...row, twinId: twin.id });
    continue;
  }

  // Clamp: a missing or absurd duration must not produce a start after the end.
  const duration = row.ev_duration_ms > 0 ? row.ev_duration_ms : 0;
  const derived = new Date(end - duration).toISOString();
  if (derived !== row.started_at) reshape.push({ ...row, derived });
}

console.log(`Database:            ${DB_PATH}`);
console.log(`Backfilled rows:     ${backfilled.length}`);
console.log(`Live rows:           ${live.length}`);
console.log(`\nA. Rows to re-time:  ${reshape.length}`);
for (const row of reshape.slice(0, 5)) {
  console.log(
    `   #${row.id} ${row.title.slice(0, 28).padEnd(28)} ${row.started_at} -> ${row.derived}`,
  );
}
if (reshape.length > 5) console.log(`   ... and ${reshape.length - 5} more`);

console.log(`\nB. Duplicate rows to delete: ${duplicates.length}`);
for (const row of duplicates.slice(0, 5)) {
  console.log(
    `   #${row.id} ${row.title.slice(0, 28).padEnd(28)} ends ${row.ended_at}` +
      `  (duplicate of live #${row.twinId})`,
  );
}
if (duplicates.length > 5) console.log(`   ... and ${duplicates.length - 5} more`);

// Every deletion is a play row; its observations cascade, but a backfilled row has none by
// definition. Assert that rather than trust it — deleting a row that turned out to carry a trail
// would destroy an observation, which is the one thing here that is genuinely irreplaceable.
const withTrail = duplicates.filter(
  (row) =>
    db.prepare('SELECT COUNT(*) AS n FROM observation WHERE play_id = ?').get(row.id).n > 0,
);
if (withTrail.length > 0) {
  console.error(
    `\nREFUSING: ${withTrail.length} row(s) marked for deletion carry an observation trail.`,
  );
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to make these changes.');
  process.exit(0);
}

db.exec('BEGIN');
try {
  const retime = db.prepare('UPDATE play SET started_at = ? WHERE id = ?');
  for (const row of reshape) retime.run(row.derived, row.id);

  const remove = db.prepare('DELETE FROM play WHERE id = ?');
  for (const row of duplicates) remove.run(row.id);

  db.exec('COMMIT');
  console.log(`\nApplied: ${reshape.length} re-timed, ${duplicates.length} deleted.`);
} catch (error) {
  db.exec('ROLLBACK');
  console.error('\nFailed, rolled back:', error);
  process.exit(1);
}

const after = db.prepare('SELECT COUNT(*) AS n FROM play').get().n;
console.log(`Plays now: ${after}`);
db.close();
