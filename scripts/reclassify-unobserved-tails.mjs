/**
 * Re-derive stored outcomes under classifier v2 (FR-20).
 *
 * Classifier v1 recorded a `track-change` close below the completion threshold as `skipped`.
 * In some playback contexts Spotify stops reporting a track before that track stops playing, so
 * the play closed at 81-90% while the listener heard it finish. v2 admits those as completions
 * when the *unobserved tail* is small. See `src/history/outcomeClassifier.ts`.
 *
 * ⚠️ DRY RUN BY DEFAULT. `--apply` writes. Nothing is written without it.
 *
 * ⚠️ STOP THE CONTAINER FIRST. `docker compose down`. Running a writer against the live
 * container corrupted this database once already (audit 2026-09-21); it reported
 * `integrity_check: ok` at the time and surfaced later as a just-written value reading null.
 * This script refuses to apply if it can see the app holding the database.
 *
 * ⚠️ IT RE-DERIVES RATHER THAN PATCHES. Every verdict comes from `reclassify` over the row's own
 * retained trail, using the same pure code the live path uses. There is no SQL that encodes the
 * rule a second time — that divergence is what the `localGuard` incident was.
 *
 * ⚠️ THIS IS WHY IT NEEDS THE tsx LOADER: `node --import tsx scripts/reclassify-unobserved-tails.mjs`.
 * Importing the real classifier is the point. `scripts/attribute-skips.mjs` took the other route and
 * holds its own copy of `USER_SKIP_RATIO_CEILING`; if that constant ever moves, the two disagree
 * silently. Use `npm run reclassify` rather than a bare `node`.
 *
 * usage:
 *   node scripts/reclassify-unobserved-tails.mjs             # dry run, prints the full diff
 *   node scripts/reclassify-unobserved-tails.mjs --apply     # writes, after its own backup
 *   node scripts/reclassify-unobserved-tails.mjs --limit 20  # dry run, first 20 changes
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLASSIFIER_VERSION,
  DEFAULT_TOLERANCES,
  reclassify,
} from '../src/history/outcomeClassifier.js';
import { attributeSkip } from '../src/history/skipAttribution.js';
import { ATTRIBUTION_VERSION } from '../src/history/types.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const limitIdx = argv.indexOf('--limit');
const LIMIT = limitIdx === -1 ? Infinity : Number.parseInt(argv[limitIdx + 1] ?? '0', 10);

const T = DEFAULT_TOLERANCES;

// ── guard: never write while the app might be writing ────────────────────────────────────────
//
// ⚠️ THE OBVIOUS GUARD DOES NOT WORK, AND ITS FAILURE IS A FALSE POSITIVE. The first version of
// this checked for `history.db-wal` on the theory that a clean shutdown removes it. It does — but
// **any read-only open recreates it**, so the check fired after this script's own dry run and
// after every read-only inspection tool. A guard that refuses on the normal case gets routinely
// overridden, and then it is not protecting anything.
//
// The precise question is whether another connection *holds* the database, which SQLite answers
// directly: an exclusive lock cannot be taken while anyone else has it open. That is a real test
// of the dangerous condition rather than a proxy for it.
if (APPLY) {
  let probe;
  try {
    probe = new DatabaseSync(DB);
    probe.exec('PRAGMA locking_mode = EXCLUSIVE');
    // The lock is only actually acquired on first write, so force one that changes nothing.
    probe.exec('BEGIN EXCLUSIVE');
    probe.exec('ROLLBACK');
  } catch (error) {
    console.error(
      `\n✖ REFUSING TO APPLY: could not take an exclusive lock on ${DB}.\n` +
        `  Another process holds this database — almost certainly the app.\n` +
        `  Run \`docker compose down\` and re-run. See the warning at the top of this script.\n` +
        `  (${error instanceof Error ? error.message : String(error)})\n`,
    );
    process.exit(2);
  } finally {
    probe?.close();
  }

  // A non-empty WAL alongside no other holder means frames this process should fold in before
  // it starts, so the backup taken below is of a checkpointed file rather than a split one.
  const wal = `${DB}-wal`;
  if (existsSync(wal)) {
    const cp = new DatabaseSync(DB);
    const result = cp.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    cp.close();
    console.log(`checkpointed WAL before backup: ${JSON.stringify(result)}`);
  }
}

const db = new DatabaseSync(DB, { readOnly: !APPLY });

const integrity = db.prepare('PRAGMA integrity_check').all();
if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
  console.error('✖ integrity_check did not return ok:', JSON.stringify(integrity));
  process.exit(2);
}

// ── load every live play with its trail ──────────────────────────────────────────────────────
const plays = db
  .prepare(
    `SELECT id, title, artist_name, started_at, outcome, close_reason, provenance,
            skip_attribution, classifier_version, attribution_version,
            ev_completion_ratio, ev_duration_ms, ev_max_progress_ms, ev_ended_with_idle
     FROM play WHERE provenance = 'live' ORDER BY id`,
  )
  .all();

const trailStmt = db.prepare(
  `SELECT at_ms, progress_ms, duration_ms, is_playing, play_id
   FROM observation WHERE play_id = ? ORDER BY sequence`,
);

const changes = [];
let unchanged = 0;
let noTrail = 0;

for (const p of plays) {
  const rows = trailStmt.all(p.id);
  if (rows.length === 0) {
    // A live row with no trail cannot be re-derived, and must not be guessed at.
    noTrail++;
    continue;
  }

  const trail = rows.map((r) => ({
    atMs: r.at_ms,
    trackId: '',
    progressMs: r.progress_ms,
    durationMs: r.duration_ms,
    isPlaying: r.is_playing === 1,
  }));

  const result = reclassify(trail, p.close_reason, T, p.ev_ended_with_idle === 1);
  const nextOutcome = result.outcome;
  const nextAttribution = attributeSkip(nextOutcome, result.evidence);

  if (nextOutcome === p.outcome && nextAttribution === p.skip_attribution) {
    unchanged++;
    continue;
  }

  changes.push({
    id: p.id,
    title: p.title,
    artist: p.artist_name,
    startedAt: p.started_at,
    from: p.outcome,
    to: nextOutcome,
    fromAttribution: p.skip_attribution,
    toAttribution: nextAttribution,
    closeReason: p.close_reason,
    tailS: (p.ev_duration_ms - p.ev_max_progress_ms) / 1000,
    position: p.ev_max_progress_ms / p.ev_duration_ms,
    ratio: p.ev_completion_ratio,
    rationale: result.rationale,
  });
}

// ── report ───────────────────────────────────────────────────────────────────────────────────
console.log(`\ndatabase   : ${DB}`);
console.log(`mode       : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (writes nothing)'}`);
console.log(`classifier : v${CLASSIFIER_VERSION}  tail <= ${T.maxUnobservedTailMs / 1000}s, position >= ${T.minObservedPositionRatio}`);
console.log(`live plays : ${plays.length}   re-derived identical: ${unchanged}   no trail (skipped): ${noTrail}`);
console.log(`CHANGES    : ${changes.length}\n`);

const shown = changes.slice(0, LIMIT);
if (shown.length > 0) {
  console.log('  id   started            from -> to               tail   pos    ratio  title');
  for (const c of shown) {
    const from = `${c.from}${c.fromAttribution ? '/' + c.fromAttribution : ''}`;
    const to = `${c.to}${c.toAttribution ? '/' + c.toAttribution : ''}`;
    console.log(
      `  ${String(c.id).padStart(4)} ${c.startedAt.slice(0, 16)}  ` +
        `${from.padEnd(20)} -> ${to.padEnd(10)} ${(c.tailS.toFixed(0) + 's').padStart(5)}  ` +
        `${c.position.toFixed(3)}  ${c.ratio.toFixed(3)}  ${c.title.slice(0, 28)}`,
    );
  }
  if (changes.length > shown.length) console.log(`  … and ${changes.length - shown.length} more`);
}

const transitions = {};
for (const c of changes) {
  const k = `${c.from}${c.fromAttribution ? '/' + c.fromAttribution : ''} -> ${c.to}`;
  transitions[k] = (transitions[k] ?? 0) + 1;
}
console.log('\ntransition summary:');
for (const [k, v] of Object.entries(transitions).sort()) console.log(`  ${k.padEnd(40)} ${v}`);

// ── anything unexpected is a stop, not a warning ──────────────────────────────────────────────
const unexpected = changes.filter(
  (c) => !(c.from === 'skipped' && c.to === 'completed'),
);
if (unexpected.length > 0) {
  console.log(
    `\n⚠️  ${unexpected.length} change(s) are NOT skipped->completed. v2 only adds a completion ` +
      `path, so anything else means a second behaviour changed too. Review before applying:`,
  );
  for (const c of unexpected.slice(0, 20))
    console.log(`     id ${c.id}: ${c.from} -> ${c.to}  (${c.rationale})`);
}

if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to write. Stop the container first.\n');
  db.close();
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(dirname(DB), `backup-before-reclassify-v2-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(DB, join(backupDir, 'history.db'));
writeFileSync(
  join(backupDir, 'changes.json'),
  JSON.stringify({ classifierVersion: CLASSIFIER_VERSION, tolerances: T, changes }, null, 1),
  'utf8',
);
console.log(`\nbackup + change manifest written to ${backupDir}`);

const update = db.prepare(
  `UPDATE play SET outcome = ?, skip_attribution = ?, attribution_version = ?,
                   classifier_version = ?
   WHERE id = ?`,
);

db.exec('BEGIN');
try {
  for (const c of changes) {
    update.run(
      c.to,
      c.toAttribution,
      c.toAttribution === null ? null : ATTRIBUTION_VERSION,
      CLASSIFIER_VERSION,
      c.id,
    );
  }
  // Every live row that was re-derived now carries v2, including the ones whose verdict did not
  // move — otherwise the version column cannot distinguish "unchanged by v2" from "never seen
  // by v2", which is the whole reason it exists.
  db.prepare(
    `UPDATE play SET classifier_version = ? WHERE provenance = 'live' AND id IN (
       SELECT DISTINCT play_id FROM observation)`,
  ).run(CLASSIFIER_VERSION);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  console.error('✖ rolled back:', error);
  process.exit(1);
}

const after = db
  .prepare(
    `SELECT outcome, skip_attribution, COUNT(*) n FROM play WHERE provenance='live'
     GROUP BY 1,2 ORDER BY 1,2`,
  )
  .all();
console.log('\nAFTER — live distribution:');
for (const r of after)
  console.log(`  ${r.outcome}${r.skip_attribution ? '/' + r.skip_attribution : ''}`.padEnd(32), r.n);

const post = db.prepare('PRAGMA integrity_check').all();
console.log(`\nintegrity_check: ${JSON.stringify(post)}`);
db.close();
console.log('Done.\n');
