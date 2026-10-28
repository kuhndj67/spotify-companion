#!/usr/bin/env node
/**
 * Make a release (U8, LC-51, P-60, BR-66.4) — the OWNER's path, and the only one that makes a versioned release.
 *
 *   npm run release                 --plan: gather the facts, print the decision and the commands. Changes nothing
 *   npm run release -- --apply      verify -> decide -> build -> deploy -> health -> git tag. Does NOT push
 *   npm run release -- --apply --no-deploy
 *                                   U11: the deployment is ELSEWHERE (a server). verify -> decide -> build -> health
 *                                   on the throwaway verification install (:3011, `verify:up` / `verify:down`, which
 *                                   prove this machine's live setup unchanged) -> git tag. Never starts compose.yaml
 *                                   here: a second recorder beside the server would double-count every play.
 *
 * The version is whatever `package.json` says (bump it first, in its own commit). The decision is the pure
 * `scripts/lib/releaseDecision.ts`; this file only gathers facts and runs commands.
 *
 * ⚠️ An installer's `docker compose up --build` is untouched by any of this: immutability is a property of a
 * RELEASE, not of an install (P-60). Only this path refuses to overwrite an image tag.
 *
 * ⚠️ `--apply` deploys to the LIVE container (`compose.yaml`). Rollback is the previous version's image:
 * set its tag in compose.yaml and `docker compose up -d` (BR-66.5).
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { compareSemVer, isSemVer, readAppVersion } from '../src/version.js';
import { decide } from './lib/releaseDecision.js';
import { acceptedPins, parseAcceptance, pinFromCompose } from './lib/connectorAcceptance.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// `--plan` is the default and may be given explicitly (smoke does); with `--apply` as well, it is ambiguous.
const apply = process.argv.includes('--apply');
if (apply && process.argv.includes('--plan')) {
  console.error('Give --plan or --apply, not both.');
  process.exit(2);
}
const CONTAINER = 'spotify-companion'; // U9 (BR-71.1); the image repository has the same name
const noDeploy = process.argv.includes('--no-deploy');
const HEALTH_TIMEOUT_MS = 180_000;

function run(cmd, args, { inherit = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' && cmd === 'npm' });
  return { ok: !r.error && r.status === 0, status: r.status, out: (r.stdout ?? '').trim(), err: r.error?.message ?? (r.stderr ?? '').trim() };
}

function lines(s) {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const candidate = readAppVersion();
const git = run('git', ['tag', '--list']);
const status = run('git', ['status', '--porcelain']);
const images = run('docker', ['image', 'ls', CONTAINER, '--format', '{{.Tag}}']);

if (!git.ok || !status.ok) {
  console.error(`git could not be read: ${git.err || status.err}`);
  process.exit(2);
}
// ⚠️ Fails CLOSED: if Docker cannot be asked, the image tags are UNKNOWN, and unknown cannot prove a tag is free.
if (!images.ok) {
  console.error(`docker could not list images (${images.err}). Image tags are unknown, so no release can be decided.`);
  process.exit(2);
}

// U9 (P-74): the connector pin now, at the last release, and which pins passed the acceptance.
const pin = pinFromCompose(readFileSync(join(root, 'compose.yaml'), 'utf8'));
if (pin === null) {
  console.error('compose.yaml has no full-SHA MCP_SERVER_REF; the connector pin is unknown, so no release can be decided.');
  process.exit(2);
}
const lastRelease = lines(git.out)
  .filter((t) => t.startsWith('v') && isSemVer(t.slice(1)))
  .map((t) => t.slice(1))
  .sort(compareSemVer)
  .at(-1);
let previousPin = null;
if (lastRelease !== undefined) {
  const before = run('git', ['show', `v${lastRelease}:compose.yaml`]);
  previousPin = before.ok ? pinFromCompose(before.out) : null;
  // ⚠️ Fails CLOSED: an unreadable previous pin is treated as DIFFERENT, so an unaccepted pin is still refused.
  if (previousPin === null) previousPin = 'unknown (could not read compose.yaml at the last release tag)';
}
const acceptance = parseAcceptance(readFileSync(join(root, 'scripts', 'connector-acceptance.json'), 'utf8'));
if (!acceptance.ok) {
  console.error(`scripts/connector-acceptance.json is malformed: ${acceptance.problems.join('; ')}`);
  process.exit(2);
}

// U9 (P-75): is the pre-U9 container running? `null` when Docker cannot say -- which the decision refuses.
const old = run('docker', ['ps', '--filter', 'name=^spotify-now-playing$', '--filter', 'status=running', '--format', '{{.Names}}']);
const oldContainerRunning = old.ok ? lines(old.out).length > 0 : null;

// 1.0.0-beta.5: where the credentials are (only secrets/app/ is mounted).
const appCredentialsPresent = existsSync(join(root, 'secrets', 'app', 'musicbrainz.json'));
const oldCredentialsPresent = ['spotify-config.json', 'musicbrainz.json'].some((f) => existsSync(join(root, 'secrets', f)));

const facts = {
  candidate,
  gitTags: lines(git.out),
  imageTags: lines(images.out),
  treeClean: lines(status.out).length === 0,
  pin,
  previousPin,
  acceptedPins: acceptedPins(acceptance.entries),
  oldContainerRunning,
  appCredentialsPresent,
  oldCredentialsPresent,
};

console.log(`Candidate: ${candidate} (package.json)`);
console.log(`Git tags (v*): ${facts.gitTags.filter((t) => t.startsWith('v')).join(', ') || '(none)'}`);
console.log(`Image tags: ${facts.imageTags.join(', ') || '(none)'}`);
console.log(`Working tree: ${facts.treeClean ? 'clean' : 'DIRTY'}`);
console.log(`Connector pin: ${pin.slice(0, 8)} (last release: ${previousPin === null ? 'none' : previousPin.slice(0, 8)}; accepted: ${facts.acceptedPins.map((p) => p.slice(0, 8)).join(', ') || 'none'})`);
console.log(`Pre-U9 container spotify-now-playing: ${oldContainerRunning === null ? 'UNKNOWN (docker ps failed)' : oldContainerRunning ? 'RUNNING' : 'not running'}`);

if (!apply) {
  const d = decide({ ...facts, verifyPassed: true });
  console.log('\n--plan (verify NOT run; assumed to pass for this preview):');
  if (!d.accept) {
    console.log(`  REFUSED: ${d.reason} — ${d.detail}`);
  } else {
    console.log(`  would ACCEPT ${candidate} (previous release: ${d.previous ?? 'none'})`);
    console.log('  then: npm run verify');
    if (noDeploy) {
      console.log('        docker compose build   (--no-deploy: nothing is started from compose.yaml)');
      console.log('        npm run verify:up, wait for it to be healthy, npm run verify:down (proves the live setup unchanged)');
    } else {
      console.log('        POST /api/backups on the running app (a before-change backup; --app-is-down skips it)');
      console.log('        docker compose build');
      console.log('        docker compose up -d');
      console.log(`        wait for ${CONTAINER} to be healthy`);
    }
    console.log(`        git tag -a ${d.gitTag} -m "Release ${candidate}"`);
    console.log('  Nothing is pushed. Run with --apply to do it.');
  }
  process.exit(0);
}

console.log('\nRunning npm run verify…');
const verify = run('npm', ['run', 'verify'], { inherit: true });
const d = decide({ ...facts, verifyPassed: verify.ok });
if (!d.accept) {
  console.error(`REFUSED: ${d.reason} — ${d.detail}`);
  process.exit(1);
}

// U10 (FR-76b, BR-82, IN-U10-7): before anything is built, ask the RUNNING app to keep a before-change backup, and
// go on only when the host can SEE that file. `--app-is-down` skips only this step: the new version still backs up
// before its first run (BR-79).
if (noDeploy) {
  console.log('\n--no-deploy: the deployment is elsewhere; no backup from an app here, and nothing started from compose.yaml.');
} else if (process.argv.includes('--app-is-down')) {
  console.log('\n--app-is-down: no backup from the running app. The new version backs up before its first run.');
} else {
  const kept = await keepReleaseBackup(process.env.SPOTIFY_COMPANION_PORT ?? '3010', candidate);
  if (!kept.ok) {
    console.error(`\nREFUSED: no backup before this release — ${kept.reason}`);
    console.error('If the app is not running on purpose, run again with --app-is-down (the new version backs up first).');
    process.exit(1);
  }
  console.log(`\nBackup before release kept: data/backups/before-change/${kept.file}`);
}

// Check every exit code DIRECTLY -- a piped build once read as success here (CLAUDE.md).
for (const [label, args] of [
  ['build', ['compose', 'build']],
  ...(noDeploy ? [] : [['deploy', ['compose', 'up', '-d']]]),
]) {
  console.log(`\n${label}: docker ${args.join(' ')}`);
  const r = run('docker', args, { inherit: true });
  if (!r.ok) {
    console.error(`${label} FAILED (exit ${r.status}). No tag was made.`);
    process.exit(1);
  }
}

if (noDeploy) {
  // The built image, run on the throwaway verification install: compose.verify.yaml's image is this version (a
  // checked copy of package.json), and verify:up waits for it to be healthy. verify:down then proves the live setup
  // here unchanged. Either failing means no tag.
  for (const [label, sub] of [['verification install up', 'up'], ['verification install down', 'down']]) {
    console.log(`\n${label}: node scripts/verify-install.mjs ${sub}`);
    const r = run('node', ['scripts/verify-install.mjs', sub], { inherit: true });
    if (!r.ok) {
      console.error(`${label} FAILED (exit ${r.status}). No tag was made.`);
      if (sub === 'up') run('node', ['scripts/verify-install.mjs', 'down'], { inherit: true });
      process.exit(1);
    }
  }
  const tagged = run('git', ['tag', '-a', d.gitTag, '-m', `Release ${candidate}`]);
  if (!tagged.ok) {
    console.error(`Built and healthy on the verification install, but git tag ${d.gitTag} FAILED: ${tagged.err}`);
    process.exit(1);
  }
  console.log(`\nReleased ${candidate}: ${d.imageTag} built and healthy on the verification install, tagged ${d.gitTag}.`);
  console.log('Nothing was deployed here. Update the server to the published image after CI publishes it.');
  console.log(`Not pushed. To publish the tag: git push origin ${d.gitTag}`);
  process.exit(0);
}

const deadline = Date.now() + HEALTH_TIMEOUT_MS;
let health = '';
while (Date.now() < deadline) {
  health = run('docker', ['inspect', '-f', '{{.State.Health.Status}} {{.Config.Image}}', CONTAINER]).out;
  if (health.startsWith('healthy')) break;
  await new Promise((r) => setTimeout(r, 5_000));
}
if (!health.startsWith('healthy') || !health.endsWith(d.imageTag)) {
  console.error(`The container is not healthy on ${d.imageTag} (last: "${health}"). No tag was made.`);
  console.error(`Rollback: set compose.yaml's image to the previous version (${d.previous ?? 'see docker image ls'}) and docker compose up -d.`);
  process.exit(1);
}

const tag = run('git', ['tag', '-a', d.gitTag, '-m', `Release ${candidate}`]);
if (!tag.ok) {
  console.error(`Deployed and healthy, but git tag ${d.gitTag} FAILED: ${tag.err}`);
  process.exit(1);
}
console.log(`\nReleased ${candidate}: ${d.imageTag} is live and healthy, tagged ${d.gitTag}.`);
console.log(`Not pushed. To publish the tag: git push origin ${d.gitTag}`);

/**
 * U10 (BR-82): `POST /api/backups` on the running app, through `ingestGuard` (Origin + ingest header), retrying while
 * it answers 409 (a backup or restore in progress) for up to 60 s. Succeeds only if the returned file exists under
 * the host's `data/backups/before-change/`: a backup the host cannot see is not counted.
 */
async function keepReleaseBackup(port, version) {
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    let res;
    try {
      res = await fetch(`${origin}/api/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, 'x-spotify-companion-ingest': '1' },
        body: JSON.stringify({ reason: `release ${version}` }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      return { ok: false, reason: `the app at ${origin} could not be reached (${error instanceof Error ? error.message : String(error)})` };
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }
    if (!res.ok) return { ok: false, reason: `the app answered ${res.status}: ${body.error ?? 'no reason given'}` };
    const onHost = join(root, 'data', 'backups', 'before-change', String(body.file ?? ''));
    if (!body.file || !existsSync(onHost)) return { ok: false, reason: `the app reported ${body.file ?? 'no file'}, but it is not visible at ${onHost}` };
    return { ok: true, file: body.file };
  }
}
