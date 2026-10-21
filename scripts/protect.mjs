#!/usr/bin/env node
/**
 * Branch and tag protection as code (U8, LC-53, P-62, BR-63.3/63.4).
 *
 *   node scripts/protect.mjs --plan     print the committed rulesets; no network (smoke's safe mode)
 *   npm run protect                     compare them with GitHub's live rulesets and PRINT THE DIFFERENCE. Read-only
 *   npm run protect -- --apply          create or update each live ruleset to match its file. Idempotent
 *
 * Every `.github/rulesets/*.json` is one ruleset, matched to the live one by `name`. `main.json` protects the
 * branch and is cross-checked against the CI job names by `test/rulesetMatchesWorkflow.test.ts`. ⚠️ A required
 * check named after a job that does not exist leaves `main` waiting for a check that never reports, which is why a
 * CI job rename must fail CI first.
 *
 * `release-tags.json` (2026-10-21, pre-public code review 2.5.1): a pushed `v*` tag PUBLISHES the image, so
 * creating, moving and deleting `v*` tags is restricted to the bypass actor. A collaborator with write access can
 * push branches and open pull requests, but cannot cut a release.
 *
 * Bypass: actor 5 / `RepositoryRole` is the repository **admin** role, i.e. the owner. `bypass_mode: always`
 * lets the owner push to `main` directly and push release tags. That exception is stated in CONTRIBUTING.md, not
 * hidden here (BR-63.3). ⚠️ So the positive controls must be attempted WITHOUT the bypass: `gh pr merge` without
 * `--admin` has to be refused (BR-63.5), and a `v*` tag push by a write-access collaborator has to be refused.
 *
 * Uses the owner's `gh` login on this PC. It is the only write-capable credential in U8, and it never goes to
 * the walk machine (IN-U8 "already decided").
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULESET_DIR = join(root, '.github', 'rulesets');

const args = process.argv.slice(2);
const plan = args.includes('--plan');
const apply = args.includes('--apply');

const rulesets = readdirSync(RULESET_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: join(RULESET_DIR, f), desired: JSON.parse(readFileSync(join(RULESET_DIR, f), 'utf8')) }));

if (plan) {
  for (const { file, desired } of rulesets) {
    console.log(`Ruleset "${desired.name}" from ${file}:`);
    console.log(JSON.stringify(desired, null, 2));
  }
  console.log('\n--plan: nothing was read from or written to GitHub.');
  process.exit(0);
}

function gh(ghArgs, input) {
  const r = spawnSync('gh', ghArgs, { encoding: 'utf8', input, shell: false });
  if (r.error) throw new Error(`gh could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`gh ${ghArgs.join(' ')} failed (${r.status}): ${r.stderr.trim()}`);
  return r.stdout;
}

/**
 * Project a value onto the shape of `want`: only the keys the FILE sets, sorted. GitHub returns keys in its own
 * order and adds defaults the file never mentions (`required_reviewers`, `allowed_merge_methods`, ids, links), and a
 * comparison that counts those reports a difference for ever. ⚠️ First version did exactly that -- found on the
 * first live apply, 2026-10-14. A diff that always differs teaches its reader to ignore it.
 *
 * Array elements BEYOND the file's are kept as they are, so a rule or a bypass actor added on GitHub still shows.
 */
function project(live, want) {
  if (Array.isArray(want)) {
    if (!Array.isArray(live)) return live;
    return [...want.map((w, i) => project(live[i], w)), ...live.slice(want.length)];
  }
  if (want !== null && typeof want === 'object') {
    if (live === null || typeof live !== 'object') return live;
    return Object.fromEntries(Object.keys(want).sort().map((k) => [k, project(live[k], want[k])]));
  }
  return live;
}

const byType = (rs) => ({ ...rs, rules: [...(rs.rules ?? [])].sort((a, b) => String(a.type).localeCompare(String(b.type))) });

/** The fields `desired`'s file controls, in a stable shape, for `rs` (live or file). */
function normalise(rs, desired) {
  return project(byType(rs), byType(desired));
}

function diffLines(a, b) {
  const left = JSON.stringify(a, null, 2).split('\n');
  const right = JSON.stringify(b, null, 2).split('\n');
  const out = [];
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    if (left[i] === right[i]) continue;
    if (left[i] !== undefined) out.push(`- live: ${left[i]}`);
    if (right[i] !== undefined) out.push(`+ file: ${right[i]}`);
  }
  return out;
}

/** Compare one ruleset with GitHub and, with --apply, make GitHub match it. True when it matches at the end. */
function syncOne(repo, list, desired) {
  const match = list.find((r) => r.name === desired.name);
  const live = match ? JSON.parse(gh(['api', `repos/${repo}/rulesets/${match.id}`])) : null;

  if (!live) {
    console.log(`${repo}: no live ruleset named "${desired.name}". Applying would CREATE it:`);
    console.log(JSON.stringify(normalise(desired, desired), null, 2));
  } else {
    const d = diffLines(normalise(live, desired), normalise(desired, desired));
    if (d.length === 0) {
      console.log(`${repo}: live ruleset "${desired.name}" (id ${live.id}) MATCHES the file. Nothing to do.`);
      return true;
    }
    console.log(`${repo}: live ruleset "${desired.name}" (id ${live.id}) DIFFERS from the file:`);
    for (const line of d) console.log(line);
  }

  if (!apply) return false;

  const body = JSON.stringify(desired);
  if (live) {
    gh(['api', '--method', 'PUT', `repos/${repo}/rulesets/${live.id}`, '--input', '-'], body);
  } else {
    gh(['api', '--method', 'POST', `repos/${repo}/rulesets`, '--input', '-'], body);
  }
  // Read back: a write that was accepted is not a write that took (the P-50 lesson).
  const after = JSON.parse(gh(['api', `repos/${repo}/rulesets`])).find((r) => r.name === desired.name);
  const readBack = after ? JSON.parse(gh(['api', `repos/${repo}/rulesets/${after.id}`])) : null;
  const remaining = readBack ? diffLines(normalise(readBack, desired), normalise(desired, desired)) : ['(not found after apply)'];
  if (remaining.length > 0) {
    console.error(`Applied "${desired.name}", but the read-back still differs:`);
    for (const line of remaining) console.error(line);
    return false;
  }
  console.log(`Applied and read back: live ruleset "${desired.name}" (id ${readBack.id}) matches the file.`);
  return true;
}

try {
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  const list = JSON.parse(gh(['api', `repos/${repo}/rulesets`]));
  const matched = rulesets.map(({ desired }) => syncOne(repo, list, desired));
  for (const r of list.filter((r) => !rulesets.some(({ desired }) => desired.name === r.name))) {
    console.log(`⚠️ ${repo}: live ruleset "${r.name}" (id ${r.id}) has no file in .github/rulesets/. Left alone.`);
  }

  if (!apply) {
    if (matched.some((ok) => !ok)) console.log('\nRead-only. Re-run with --apply to make GitHub match the files.');
    process.exit(0);
  }
  if (matched.some((ok) => !ok)) process.exit(1);
  console.log('⚠️ Not yet PROVEN: the positive controls -- a failing PR refused merge without --admin (BR-63.5), and a');
  console.log('   `v*` tag push by a write-access collaborator refused (release-tags).');
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(2);
}
