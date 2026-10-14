#!/usr/bin/env node
/**
 * Run every script's SAFE MODE, and fail if any of them cannot start. 🔌 IMPURE, read-only.
 *
 * ## ⚠️ Why this exists: `scripts/` is outside every guard
 *
 * `test/noOrphanModules.test.ts` asserts reachability, but it walks **`src/` only**, and it walks
 * **modules, not methods**. `scripts/` holds 20 files — the hypothesis-gate runner, the `played_at`
 * repair, the P-U5-1 probes, the backup/restore pair — and **every one of them is untested and
 * unexecuted by CI**. They are also the tools most likely to be reached for during an incident, which is
 * the worst possible moment to discover one does not start.
 *
 * ⚠️ **`npm run reclassify` was DEAD FOR A WEEK** (`f864e4e` → 2026-09-29). Commit `f864e4e` removed
 * `ATTRIBUTION_VERSION` and `attributeSkip` from `src/` and left the script importing both, so the FR-20
 * re-derivation tool could not reach line one of work — and **891 tests stayed green** throughout,
 * because `scripts/` is outside the walk entirely.
 *
 * ## ⚠️ `node --check` WOULD NOT HAVE CAUGHT IT, and that is the whole design
 *
 * A missing named export is a **link-time** failure, not a parse error. The module has to be *evaluated*.
 * And evaluating it by importing is only safe for scripts that guard their `main()` —
 * `backup-history.mjs` and `restore-history.mjs` do, `reclassify-unobserved-tails.mjs` **does not**, and
 * importing that one would run it. So the convention is **invoke the safe mode**, never import the file.
 *
 * ## ⚠️ A NON-ZERO EXIT IS NOT A FAILURE HERE
 *
 * Several of these scripts correctly **refuse** to run: `backup-history.mjs` exits non-zero while the
 * container is up, because SQLite's locks do not cross the Rancher Desktop bind mount and `docker ps` is
 * the only working check. **That refusal is the guard working**, and a smoke test that demanded exit 0
 * would either fail on a healthy machine or pressure someone into weakening the guard.
 *
 * So the discriminator is **did the module LOAD**, not what it then decided:
 *
 * | Signature in output | Verdict |
 * |---|---|
 * | `SyntaxError`, `ERR_MODULE_NOT_FOUND`, `does not provide an export named` | ❌ **the failure this exists to catch** |
 * | `ReferenceError`, `TypeError: … is not a function` at module scope | ❌ a top-level evaluation failure |
 * | anything else, any exit code | ✅ it started, and whatever it decided is its own business |
 *
 * ⚠️ **`--apply` paths are deliberately absent.** Several of these are writers, and this is not the place
 * to discover that.
 *
 * ## ⚠️ What this does NOT prove
 *
 * **That the script works.** It proves the script can be started. A dry run that silently does nothing
 * would pass — which is why `restore-history.mjs` carries its own `--self-test` against a deliberately
 * corrupt snapshot, and why W-6 exists. This closes the *"cannot start at all"* gap and nothing wider.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * Each script's safe mode.
 *
 * ## ⚠️ "SAFE MODE" IS A CLAIM THAT HAS TO BE CHECKED, and the first draft of this file got it wrong
 *
 * That draft invoked `backup-history.mjs --label smoke-test-dry-run --dry-run`. **`backup-history.mjs`
 * has no `--dry-run` flag** — the argument was silently ignored, and the run only came back clean because
 * the container was up and the `docker ps` guard refused. **With the container down it would have written
 * a real backup directory on every run.** A flag that does not exist reads exactly like a safety mode.
 *
 * The same draft also ran three scripts that genuinely write: it rebuilt `reporting.db`, rewrote
 * `artist-credits.json`, and POSTed a schema sync to Metabase. Nothing irreplaceable was touched and no
 * upstream budget was spent — **because the credit cache happened to be warm.** That is luck, not design:
 * cold, the same run would have spent hundreds of Spotify requests.
 *
 * ⚠️ So the NFR plan's warning is literal: ***“`--apply` paths stay out of CI — several of these are
 * writers, and CI is not a place to discover that.”*** A script whose only mode writes is **skipped with a
 * reason**, not invoked and hoped about.
 *
 * ## The fields
 *
 * - `args` — the read-only invocation. ⚠️ **Every `--flag` here is checked against the script's own
 *   source** before it runs (`assertFlagsExist`), because that is the mistake above.
 * - `skip` — why this one cannot be invoked. Required when there is no side-effect-free mode.
 * - `tsx` — the script imports from `src/`, so it needs the loader.
 *
 * ⚠️ **Every `.mjs` in `scripts/` must appear here**, and a missing one fails the run — otherwise adding
 * a script silently opts out of the only check it has, which is how `scripts/` became a blind spot.
 */
const ENTRY_POINTS = [
  // ── read-only by design ───────────────────────────────────────────────────────────────────────
  {
    file: 'restore-history.mjs',
    args: ['--self-test'],
    // U6: imports the verifier from src/backup/ (BR-47.1), so it needs the loader.
    tsx: true,
    // ⚠️ Works on a TEMP COPY of the deliberately-corrupt snapshot, and proves the verifier can FAIL.
    // This also evaluates `backup-history.mjs`, which it imports -- see that entry's skip reason.
  },
  { file: 'verify-all-backups.mjs', args: [], tsx: true },
  { file: 'reclassify-unobserved-tails.mjs', args: [], tsx: true },
  { file: 'repair-backfill-timestamps.mjs', args: [] },
  // Dry run by default; `--apply` is required. Refuses while the container is up.
  { file: 'repair-skip-source.mjs', args: [], tsx: true },
  { file: 'hypothesis-gate.mjs', args: [] },
  { file: 'measure-confound.mjs', args: [] },
  { file: 'check-rules-schema.mjs', args: [], tsx: true },
  // U6: prints what verify:up/down would do and touches nothing — no Docker call in this mode.
  { file: 'verify-install.mjs', args: ['--plan'] },
  // U8: prints the committed ruleset; no network. The default mode reads GitHub, and --apply WRITES it.
  { file: 'protect.mjs', args: ['--plan'] },
  // U8: --plan reads git tags and `docker image ls` and decides; verify is not run and nothing is built or tagged.
  // With no Docker it refuses (exit 2), which is still a load.
  { file: 'release.mjs', args: ['--plan'], tsx: true },
  { file: 'probe-p-u5-1-analyse.mjs', args: [] },
  { file: 'probe-p-u5-1-mark.mjs', args: [] },
  { file: 'probe-p-u5-1.mjs', args: ['--rehearse'] },
  {
    file: 'probe-p-u5-1-step.mjs',
    args: ['--no-post'],
    // ⚠️ This one WRITES TO THE PLAYER in its ordinary mode. `--no-post` is its read-only path and the
    // script itself exempts that path from its own shutdown guard, which is the confirmation it writes
    // nothing. Included because a probe that cannot start is discovered at the worst moment.
  },
  {
    file: 'rules-init.mjs',
    args: [],
    // Creates `config/rules.json` from the template and REFUSES to overwrite. On a fresh checkout it
    // creates the file, which is its purpose; thereafter it is a no-op that reports the refusal.
  },

  // ── writers: skipped, with the reason ─────────────────────────────────────────────────────────
  {
    file: 'backup-history.mjs',
    skip:
      'it has NO read-only mode -- taking the backup IS the operation, and the `--dry-run` a previous ' +
      'draft of this file passed does not exist. Its module body is still evaluated here, because ' +
      'restore-history.mjs and reclassify-unobserved-tails.mjs both import assertNobodyElseHoldsIt ' +
      'from it, so the load check is not lost.',
  },
  {
    file: 'build-reporting-db.mjs',
    skip: 'rebuilds data/reporting/reporting.db on every run. Derived and regenerable, but Metabase may be querying it.',
  },
  {
    file: 'resolve-artist-credits.mjs',
    skip:
      'rewrites data/artist-credits.json and makes a live GET /tracks/{id} for every uncached track. ' +
      'Harmless with a warm cache and hundreds of requests with a cold one -- so not a CI check.',
  },
  {
    file: 'metabase-setup.mjs',
    skip: 'POSTs /api/database and a schema sync to the running Metabase. Idempotent, but it is a write to an external service.',
  },
  {
    file: 'metabase-report.mjs',
    skip: 'POSTs queries to Metabase and writes its output to disk.',
  },

  // ── interactive: no mode to invoke ────────────────────────────────────────────────────────────
  {
    file: 'auth.mjs',
    skip: 'interactive: opens a browser and waits on an OAuth redirect. There is no safe mode.',
  },
  {
    file: 'mcp-setup.mjs',
    skip: 'interactive: prompts for paths and writes a config. No read-only mode exists.',
  },
  { file: 'smoke-entry-points.mjs', skip: 'this runner. Running itself would recurse.' },
];

/**
 * ⚠️ **Every flag passed above must appear in the target script's source.**
 *
 * This is the guard against the defect that shipped in the first draft: `--dry-run` passed to a script
 * that has no such flag, silently ignored, reading as a safety mode. An unrecognised argument is the
 * worst kind, because the run comes back green.
 *
 * ⚠️ It checks the flag is MENTIONED, not that it is honoured — a real limit, and the reason the skip
 * entries above carry prose rather than relying on this.
 */
function assertFlagsExist(entry, source) {
  const unknown = (entry.args ?? [])
    .filter((a) => a.startsWith('--'))
    .filter((flag) => !source.includes(flag));
  return unknown;
}

/** Output that means the module never got going. ⚠️ The first three are the reclassify breakage. */
const LOAD_FAILURES = [
  /SyntaxError/,
  /ERR_MODULE_NOT_FOUND/,
  /does not provide an export named/,
  /Cannot find (?:module|package)/,
  /ERR_UNKNOWN_FILE_EXTENSION/,
  /ReferenceError/,
  /ERR_REQUIRE_ESM/,
];

function run({ file, args, tsx }) {
  const argv = tsx ? ['--import', 'tsx', join('scripts', file), ...args] : [join('scripts', file), ...args];
  const r = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    // ⚠️ Bounded. A script that waits on stdin would otherwise hang the whole run, and these all
    // complete in well under a second when they are healthy.
    timeout: 90_000,
    // Nothing here should read stdin; if one tries, it gets EOF rather than blocking for ever.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (r.error?.code === 'ETIMEDOUT') {
    return { ok: false, why: 'timed out after 90s — it is waiting for something', output };
  }
  if (r.error) return { ok: false, why: `could not be spawned: ${r.error.message}`, output };

  const failure = LOAD_FAILURES.find((pattern) => pattern.test(output));
  if (failure !== undefined) {
    return { ok: false, why: `failed to LOAD (${failure.source})`, output };
  }
  return { ok: true, exit: r.status, output };
}

/**
 * ⚠️ **Prove the flag guard can FAIL**, because a guard that never fires is decorative.
 *
 * This project has shipped two of those: the lock probe that could not see the container, and
 * `MAX_PREDICATE_DEPTH`'s first `depthOf`, which would have overflowed computing its own input. Run with
 * `--self-test`.
 */
function selfTest() {
  const source = "if (argv.includes('--verify-only')) {}";
  const good = assertFlagsExist({ args: ['--verify-only'] }, source);
  const bad = assertFlagsExist({ args: ['--dry-run'] }, source);

  if (good.length !== 0) {
    console.error('❌ self-test: a flag the script DOES mention was rejected');
    process.exit(1);
  }
  if (bad.length !== 1 || bad[0] !== '--dry-run') {
    console.error(
      '❌ self-test: the guard did NOT catch an unknown flag. This is the exact defect it exists ' +
        'for -- `--dry-run` passed to backup-history.mjs, which has no such flag.',
    );
    process.exit(1);
  }
  console.log('✅ self-test: the flag guard accepts a known flag and rejects an unknown one.');
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const declared = new Set(ENTRY_POINTS.map((e) => e.file));
  const present = readdirSync(join(ROOT, 'scripts')).filter((n) => n.endsWith('.mjs'));

  const undeclared = present.filter((n) => !declared.has(n));
  const vanished = [...declared].filter((n) => !present.includes(n));

  let failures = 0;

  if (undeclared.length > 0) {
    // ⚠️ Fails rather than warns. A new script that is not listed here has silently opted out of the
    // only check it has, which is how `scripts/` became a blind spot in the first place.
    console.error(
      `❌ ${undeclared.length} script(s) are not declared in ENTRY_POINTS. Add a safe mode, or a ` +
        `\`skip\` with a reason:\n   ${undeclared.join('\n   ')}`,
    );
    failures += undeclared.length;
  }
  if (vanished.length > 0) {
    console.error(`❌ declared but missing from scripts/: ${vanished.join(', ')}`);
    failures += vanished.length;
  }

  for (const entry of ENTRY_POINTS) {
    if (entry.skip !== undefined) {
      console.log(`⏭  ${entry.file} — skipped: ${entry.skip}`);
      continue;
    }
    const path = join(ROOT, 'scripts', entry.file);
    if (!existsSync(path)) continue;

    const unknown = assertFlagsExist(entry, readFileSync(path, 'utf8'));
    if (unknown.length > 0) {
      // ⚠️ FAILS rather than warns. A flag the script does not know about is silently dropped, and the
      // invocation then runs in whatever its DEFAULT mode is -- which for a writer means writing.
      failures += 1;
      console.error(
        `\u274c ${entry.file} — ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not ` +
          `mentioned in the script. An unrecognised flag is ignored, so this would run in the ` +
          `script's DEFAULT mode. Not invoking it.`,
      );
      continue;
    }

    const result = run(entry);
    if (result.ok) {
      // ⚠️ The exit code is REPORTED, not judged. A non-zero exit from a script that refused to run
      // against a live container is the guard working.
      const note = result.exit === 0 ? 'exit 0' : `exit ${result.exit} (refused or declined — fine)`;
      console.log(`✅ ${entry.file} — started, ${note}`);
    } else {
      failures += 1;
      console.error(`❌ ${entry.file} — ${result.why}`);
      console.error(indent(result.output.trim().split('\n').slice(0, 12).join('\n')));
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(
      `${failures} entry point(s) could not start. ⚠️ This is the \`npm run reclassify\` failure: a ` +
        `tool that is unreachable until the moment it is needed.`,
    );
    process.exit(1);
  }
  console.log('All entry points start. ⚠️ That they WORK is a different question — see W-6.');
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `     ${line}`)
    .join('\n');
}

main();
