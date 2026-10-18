#!/usr/bin/env node
/**
 * U6's verification installation — install it, remove it, and PROVE the live deployment was not touched.
 *
 *   npm run verify:up      install `compose.verify.yaml` (project `spotify-verify`) on http://localhost:3011
 *   npm run verify:down    remove it, then prove the live deployment and the repo are unchanged
 *   node scripts/verify-install.mjs --plan    print what would happen; touches nothing (smoke's safe mode)
 *
 * ## The contract (user requirement, 2026-10-07)
 *
 * > *"…cleanly installed for the test and then cleanly removed without impacting the primary deployment at all
 * > (either the deployment or the project artifacts that enable it)."*
 *
 * So this script does not merely avoid touching the live deployment — it MEASURES that it did not:
 *
 *   1. it REFUSES unless `compose.verify.yaml` resolves to the project `spotify-verify`. ⚠️ Measured: the live
 *      project is `spotify`, derived from the directory name — a second Compose file without an explicit name
 *      would share it, and its `down` could act on the live deployment;
 *   2. before installing, it records the live container's id, start time, restart count, image and health, and
 *      the repo's `git status`;
 *   3. after removing, it asserts all of those are UNCHANGED, and that nothing named `*verify*` remains.
 *
 * Everything the installation owns lives in ONE gitignored directory, `verify-install/`, so removal is deleting
 * that directory. It is given a PLACEHOLDER Spotify config, never the live one.
 *
 * ## `up --probe-credentials` — U7's probes P-U7-1/2 ONLY (IN-U7-3, a written, probe-only amendment)
 *
 * Writes a REDUCED COPY of the real credentials instead of the placeholder: `clientId`, `clientSecret`,
 * `redirectUri`, `refreshToken`, with `accessToken: "placeholder"` and `expiresAt: 0` — exactly the shape U7's
 * BR-56.4 would write, which is the premise P-U7-1 tests. It is a COPY inside `verify-install/`: the live
 * `secrets/` is read, never mounted and never written. `down` deletes it with the rest and says so.
 * ⚠️ For every other use of the copy, the placeholder contract above still holds.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = join(root, 'compose.verify.yaml');
const PROJECT = 'spotify-verify';
const INSTALL = join(root, 'verify-install');
const BASELINE = join(INSTALL, 'baseline.json');
/**
 * U9 (BR-71.1, BR-71.3): the live container is `spotify-companion`, or `spotify-now-playing` before the crossing.
 * The no-impact proof must work on either side of it, so the baseline records WHICH one was found, and the proof
 * compares that same container afterwards.
 */
const LIVE_CONTAINERS = ['spotify-companion', 'spotify-now-playing'];
const VERIFY_CONTAINER = 'spotify-companion-verify';
const URL = 'http://localhost:3011';

const mode = process.argv.includes('--plan') ? 'plan' : process.argv[2];
const probeCredentials = process.argv.includes('--probe-credentials');
const PROBE_FILE = join(INSTALL, 'secrets', 'spotify-config.json');

/**
 * The reduced copy (IN-U7-3). Values are copied, never printed. Refuses rather than writing a partial file — a
 * probe built on a half-copied credential would test nothing.
 */
function writeReducedCredentials() {
  const live = JSON.parse(readFileSync(join(root, 'secrets', 'spotify-config.json'), 'utf8'));
  const missing = ['clientId', 'clientSecret', 'redirectUri', 'refreshToken'].filter((k) => typeof live[k] !== 'string' || live[k] === '');
  if (missing.length > 0) fail(`secrets/spotify-config.json lacks ${missing.join(', ')} — cannot build the reduced copy.`);
  const reduced = {
    clientId: live.clientId,
    clientSecret: live.clientSecret,
    redirectUri: live.redirectUri,
    refreshToken: live.refreshToken,
    accessToken: 'placeholder',
    expiresAt: 0,
  };
  writeFileSync(PROBE_FILE, JSON.stringify(reduced, null, 2));
  console.log('⚠️ PROBE MODE (IN-U7-3): verify-install/secrets/spotify-config.json is a REDUCED COPY of the real');
  console.log('   credentials (4 values + accessToken "placeholder", expiresAt 0). Removed by `npm run verify:down`.');
}

function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  if (r.error) {
    if (allowFail) return null;
    throw new Error(`${cmd} could not be run: ${r.error.message}`);
  }
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}: ${r.stderr.trim()}`);
  }
  return r.status === 0 ? r.stdout : null;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(2);
}

/** Refuse unless this file is its own project (the trap in the header). */
function assertProjectName() {
  const out = run('docker', ['compose', '-f', COMPOSE_FILE, 'config', '--format', 'json']);
  const name = JSON.parse(out).name;
  if (name !== PROJECT) fail(`compose.verify.yaml resolves to project "${name}", not "${PROJECT}". Refusing — it could act on the live deployment.`);
}

/** The five live properties the contract promises not to change. */
function liveSnapshot(only = null) {
  for (const name of only ? [only] : LIVE_CONTAINERS) {
    const out = run('docker', ['inspect', name], { allowFail: true });
    if (out === null) continue;
    const c = JSON.parse(out)[0];
    return {
      present: true,
      name,
      id: c.Id,
      startedAt: c.State.StartedAt,
      restartCount: c.RestartCount,
      image: c.Image,
      health: c.State.Health?.Status ?? null,
    };
  }
  return { present: false };
}

/** Tracked-file changes only — `verify-install/` is gitignored and must not appear here. */
function gitStatus() {
  return (run('git', ['status', '--porcelain', '--untracked-files=no'], { allowFail: true }) ?? '').trim();
}

function plan() {
  const text = readFileSync(COMPOSE_FILE, 'utf8');
  const declared = /^name:\s*(\S+)/m.exec(text)?.[1] ?? '(none)';
  console.log(`verify-install --plan  (touches nothing)

  compose file   compose.verify.yaml — declares project "${declared}"${declared === PROJECT ? '' : '  ⚠️ NOT spotify-verify — up/down would refuse'}
  install dir    verify-install/ (gitignored) — ${existsSync(INSTALL) ? 'EXISTS (up would refuse)' : 'absent'}

  up:   refuse unless the project resolves to "${PROJECT}" · record the live baseline · create verify-install/
        (data/, state/ empty, config/rules.json from the template, a PLACEHOLDER Spotify config — or, with
        --probe-credentials, a REDUCED COPY of the real one for U7's probes P-U7-1/2 only, IN-U7-3) ·
        docker compose -f compose.verify.yaml up -d · wait for health · ${URL}
  down: refuse unless the project resolves · docker compose -f compose.verify.yaml down (no --rmi) ·
        delete verify-install/ · prove the live container and git status unchanged, and nothing *verify* left`);
}

function up() {
  if (existsSync(INSTALL)) fail('verify-install/ already exists — run `npm run verify:down` first (a half-removed install is not a clean start).');
  assertProjectName();
  const live = liveSnapshot();
  if (!live.present) console.warn(`⚠️ No live container (${LIVE_CONTAINERS.join(' or ')}) is present; the no-impact proof will compare against its absence.`);

  for (const d of ['data', 'state', 'config', 'secrets']) mkdirSync(join(INSTALL, d), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify({ takenAt: new Date().toISOString(), live, git: gitStatus(), probeCredentials }, null, 2));
  copyFileSync(join(root, 'config', 'rules.example.json'), join(INSTALL, 'config', 'rules.json'));
  // ⚠️ The EXAMPLE, with placeholder values. Never secrets/spotify-config.json — except the reduced COPY in probe mode.
  copyFileSync(join(root, 'secrets', 'spotify-config.example.json'), PROBE_FILE);
  if (probeCredentials) writeReducedCredentials();

  run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d']);
  const deadline = Date.now() + 60_000;
  let health = 'starting';
  while (Date.now() < deadline) {
    const out = run('docker', ['inspect', '--format', '{{.State.Health.Status}}', VERIFY_CONTAINER], { allowFail: true });
    health = out?.trim() ?? 'missing';
    if (health === 'healthy') break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
  }
  console.log(`\n${health === 'healthy' ? '✅' : '⚠️ '} verification installation ${health} at ${URL}`);
  console.log(probeCredentials
    ? '   It holds a REDUCED COPY of the real credentials (probe mode) and cannot skip tracks. Remove it with `npm run verify:down`.\n'
    : '   It has no Spotify credentials and cannot skip tracks. Remove it with `npm run verify:down`.\n');
}

function down() {
  assertProjectName();
  if (!existsSync(BASELINE)) fail('No baseline in verify-install/ — nothing was installed by `verify:up`, or it was removed by hand.');
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

  run('docker', ['compose', '-f', COMPOSE_FILE, 'down']); // ⚠️ never --rmi: the image tag is the live one
  rmSync(INSTALL, { recursive: true, force: true });

  const problems = [];
  // The SAME container the baseline found (U9: either name), so the proof cannot pass by looking at another one.
  const now = liveSnapshot(baseline.live.name ?? null);
  for (const key of ['present', 'name', 'id', 'startedAt', 'restartCount', 'image', 'health']) {
    if (JSON.stringify(now[key]) !== JSON.stringify(baseline.live[key])) {
      problems.push(`live ${key} changed: ${JSON.stringify(baseline.live[key])} → ${JSON.stringify(now[key])}`);
    }
  }
  const leftContainers = (run('docker', ['ps', '-a', '--filter', `name=${VERIFY_CONTAINER}`, '--format', '{{.Names}}'], { allowFail: true }) ?? '').trim();
  if (leftContainers) problems.push(`container still present: ${leftContainers}`);
  const leftNetworks = (run('docker', ['network', 'ls', '--filter', `name=${PROJECT}`, '--format', '{{.Name}}'], { allowFail: true }) ?? '').trim();
  if (leftNetworks) problems.push(`network still present: ${leftNetworks}`);
  if (existsSync(INSTALL)) problems.push('verify-install/ still exists');
  if (baseline.probeCredentials && existsSync(PROBE_FILE)) problems.push('the reduced credential copy still exists');
  const git = gitStatus();
  if (git !== baseline.git) problems.push(`tracked files changed during the test:\n${git}`);

  if (problems.length > 0) {
    console.error('\n✖ NO-IMPACT PROOF FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\n✅ Removed. The live deployment is unchanged — same container, start time, restart count, image and
   health as before the install — no *verify* container, network or directory remains, and no tracked file
   changed.${baseline.probeCredentials ? '\n   The reduced credential copy (probe mode, IN-U7-3) is gone.' : ''}\n`);
}

try {
  if (mode === 'plan') plan();
  else if (mode === 'up') up();
  else if (mode === 'down') down();
  else fail('usage: verify-install.mjs up | down | --plan');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
