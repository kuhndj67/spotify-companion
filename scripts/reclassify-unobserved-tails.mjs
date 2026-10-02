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
 *
 * ⚠️ THIS LINE USED TO SAY *"refuses to apply if it can see the app holding the database"*, AND IT
 * COULD NOT SEE IT. The exclusive-lock guard was blind to the container — SQLite's locks do not
 * cross the Rancher Desktop bind mount — so it returned green exactly when the danger was present,
 * which is how the 2026-09-21 corruption happened with a guard in place. **Fixed 2026-09-29**: the
 * check is now `docker ps` plus the lock probe, and it fails closed. See the guard comment below.
 *
 * ⚠️ The general lesson, which outlives this script: **a recorded reassurance decays exactly like a
 * recorded negative, because nothing ever re-tests it.** This one survived a corruption incident it
 * had failed to prevent.
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
// ⚠️ ONE admission rule, imported rather than copied — see the guard comment below.
import { assertNobodyElseHoldsIt } from './backup-history.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const limitIdx = argv.indexOf('--limit');
const LIMIT = limitIdx === -1 ? Infinity : Number.parseInt(argv[limitIdx + 1] ?? '0', 10);

const T = DEFAULT_TOLERANCES;

// ── guard: never write while the app might be writing ────────────────────────────────────────
//
// ⚠️ THE GUARD THIS SCRIPT USED TO CARRY WAS BLIND, AND IT PASSED EXACTLY WHEN THE DANGER WAS
// PRESENT. Fixed 2026-09-29; the history is worth keeping because both wrong versions looked right.
//
// v1 checked for `history.db-wal` on the theory that a clean shutdown removes it. It does — but
// **any read-only open recreates it**, so the check fired after this script's own dry run and after
// every read-only inspection tool. A guard that refuses on the normal case gets routinely
// overridden, and then it is not protecting anything. That much was already recorded here.
//
// ⚠️ v2 — an exclusive-lock probe — replaced it and this comment claimed it was *"a real test of the
// dangerous condition rather than a proxy for it."* **It is not.** Probed 2026-09-27: with
// `spotify-now-playing` up, healthy and actively recording, a host process **successfully acquired
// `BEGIN EXCLUSIVE`** on `data/history.db`. The app holds its connection for its entire process
// lifetime (`SqliteHistoryRepository.ts:192`), so this is not a race — **SQLite's locks do not cross
// the Rancher Desktop bind mount** between the Windows host and the Linux VM. The one writer that
// matters was invisible to it.
//
// ⚠️ **This mechanically explains the U4 corruption incident** (audit 2026-09-21): the guard said
// yes, so two writers hit one file. It is the same family as *"a guard computed the same way as the
// thing it guards is not a guard"* — here, **a guard that cannot observe the condition it guards** —
// and it is worse than no guard, because it produced a green light and a reassuring docstring.
//
// ✅ v3 delegates to `assertNobodyElseHoldsIt`, which checks **`docker ps`** for the container AND
// keeps the lock probe for a host writer like `npm start`. Neither check sees the other's writer, so
// both are needed; the lock probe was incomplete, not useless. It **fails closed**: if `docker`
// cannot be reached the answer is *unknown*, and unknown refuses.
//
// ⚠️ It is imported rather than re-implemented deliberately. **One admission rule, invoked twice,
// never written twice** — this project has already shipped a divergence of exactly that shape, where
// the WebSocket upgrade handler re-implemented the local-access policy, the copies drifted, and every
// page load returned 200 while every handshake returned 403 with all 411 tests passing.
if (APPLY) {
  try {
    assertNobodyElseHoldsIt(DB, { override: argv.includes('--i-have-stopped-the-container') });
  } catch (error) {
    console.error(
      `\n✖ REFUSING TO APPLY: ${error instanceof Error ? error.message : String(error)}\n` +
        `  See the warning at the top of this script.\n`,
    );
    process.exit(2);
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
            classifier_version,
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

  if (nextOutcome === p.outcome) {
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
    const from = c.from;
    const to = c.to;
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
  const k = `${c.from} -> ${c.to}`;
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

// ⚠️ `skip_attribution` and `attribution_version` are NOT written, and not read either.
// They were retired 2026-09-22 and their columns nulled (kept, not dropped, because dropping breaks
// by-image rollback). `domain-entities.md` §6 is explicit: *"Do not reintroduce it, and do not read
// it: classifier v2 subsumes it, and the two rules could contradict each other."*
const update = db.prepare(
  `UPDATE play SET outcome = ?, classifier_version = ?
   WHERE id = ?`,
);

db.exec('BEGIN');
try {
  for (const c of changes) {
    update.run(c.to, CLASSIFIER_VERSION, c.id);
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
    `SELECT outcome, COUNT(*) n FROM play WHERE provenance='live'
     GROUP BY 1 ORDER BY 1`,
  )
  .all();
console.log('\nAFTER — live distribution:');
for (const r of after) console.log(`  ${r.outcome}`.padEnd(32), r.n);

const post = db.prepare('PRAGMA integrity_check').all();
console.log(`\nintegrity_check: ${JSON.stringify(post)}`);
db.close();
console.log('Done.\n');
