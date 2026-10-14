#!/usr/bin/env node
/**
 * Branch protection as code (U8, LC-53, P-62, BR-63.3/63.4).
 *
 *   node scripts/protect.mjs --plan     print the committed ruleset; no network (smoke's safe mode)
 *   npm run protect                     compare it with GitHub's live ruleset and PRINT THE DIFFERENCE. Read-only
 *   npm run protect -- --apply          create or update the live ruleset to match the file. Idempotent
 *
 * The ruleset lives in `.github/rulesets/main.json`, where review can see it, and is cross-checked against the CI
 * job names by `test/rulesetMatchesWorkflow.test.ts`. ⚠️ A required check named after a job that does not exist
 * leaves `main` waiting for a check that never reports, which is why a CI job rename must fail CI first.
 *
 * Bypass: actor 5 / `RepositoryRole` is the repository **admin** role, i.e. the owner. `bypass_mode: always`
 * lets the owner push to `main` directly. That exception is stated in CONTRIBUTING.md, not hidden here (BR-63.3).
 * ⚠️ So the positive control (BR-63.5) must be a merge attempted WITHOUT the bypass: `gh pr merge` without
 * `--admin` has to be refused.
 *
 * Uses the owner's `gh` login on this PC. It is the only write-capable credential in U8, and it never goes to
 * the walk machine (IN-U8 "already decided").
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULESET_FILE = join(root, '.github', 'rulesets', 'main.json');

const args = process.argv.slice(2);
const plan = args.includes('--plan');
const apply = args.includes('--apply');

const desired = JSON.parse(readFileSync(RULESET_FILE, 'utf8'));

if (plan) {
  console.log(`Ruleset "${desired.name}" from ${RULESET_FILE}:`);
  console.log(JSON.stringify(desired, null, 2));
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

/** The fields this file controls, in a stable shape, for `rs` (live or file) against the file. */
function normalise(rs) {
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

try {
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  const list = JSON.parse(gh(['api', `repos/${repo}/rulesets`]));
  const match = list.find((r) => r.name === desired.name);
  const live = match ? JSON.parse(gh(['api', `repos/${repo}/rulesets/${match.id}`])) : null;

  if (!live) {
    console.log(`${repo}: no live ruleset named "${desired.name}". Applying would CREATE it:`);
    console.log(JSON.stringify(normalise(desired), null, 2));
  } else {
    const d = diffLines(normalise(live), normalise(desired));
    if (d.length === 0) {
      console.log(`${repo}: live ruleset "${desired.name}" (id ${live.id}) MATCHES the file. Nothing to do.`);
      process.exit(0);
    }
    console.log(`${repo}: live ruleset "${desired.name}" (id ${live.id}) DIFFERS from the file:`);
    for (const line of d) console.log(line);
  }

  if (!apply) {
    console.log('\nRead-only. Re-run with --apply to make GitHub match the file.');
    process.exit(0);
  }

  const body = JSON.stringify(desired);
  if (live) {
    gh(['api', '--method', 'PUT', `repos/${repo}/rulesets/${live.id}`, '--input', '-'], body);
  } else {
    gh(['api', '--method', 'POST', `repos/${repo}/rulesets`, '--input', '-'], body);
  }
  // Read back: a write that was accepted is not a write that took (the P-50 lesson).
  const after = JSON.parse(gh(['api', `repos/${repo}/rulesets`])).find((r) => r.name === desired.name);
  const readBack = after ? JSON.parse(gh(['api', `repos/${repo}/rulesets/${after.id}`])) : null;
  const remaining = readBack ? diffLines(normalise(readBack), normalise(desired)) : ['(not found after apply)'];
  if (remaining.length > 0) {
    console.error('Applied, but the read-back still differs:');
    for (const line of remaining) console.error(line);
    process.exit(1);
  }
  console.log(`Applied and read back: live ruleset "${desired.name}" (id ${readBack.id}) matches the file.`);
  console.log('⚠️ Not yet PROVEN: the positive control (BR-63.5) -- a failing PR refused merge without --admin.');
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(2);
}
