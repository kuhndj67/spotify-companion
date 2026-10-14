#!/usr/bin/env node
/**
 * Make a release (U8, LC-51, P-60, BR-66.4) — the OWNER's path, and the only one that makes a versioned release.
 *
 *   npm run release                 --plan: gather the facts, print the decision and the commands. Changes nothing
 *   npm run release -- --apply      verify -> decide -> build -> deploy -> health -> git tag. Does NOT push
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
import { readAppVersion } from '../src/version.js';
import { decide } from './lib/releaseDecision.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// `--plan` is the default and may be given explicitly (smoke does); with `--apply` as well, it is ambiguous.
const apply = process.argv.includes('--apply');
if (apply && process.argv.includes('--plan')) {
  console.error('Give --plan or --apply, not both.');
  process.exit(2);
}
const CONTAINER = 'spotify-now-playing';
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

const facts = {
  candidate,
  gitTags: lines(git.out),
  imageTags: lines(images.out),
  treeClean: lines(status.out).length === 0,
};

console.log(`Candidate: ${candidate} (package.json)`);
console.log(`Git tags (v*): ${facts.gitTags.filter((t) => t.startsWith('v')).join(', ') || '(none)'}`);
console.log(`Image tags: ${facts.imageTags.join(', ') || '(none)'}`);
console.log(`Working tree: ${facts.treeClean ? 'clean' : 'DIRTY'}`);

if (!apply) {
  const d = decide({ ...facts, verifyPassed: true });
  console.log('\n--plan (verify NOT run; assumed to pass for this preview):');
  if (!d.accept) {
    console.log(`  REFUSED: ${d.reason} — ${d.detail}`);
  } else {
    console.log(`  would ACCEPT ${candidate} (previous release: ${d.previous ?? 'none'})`);
    console.log('  then: npm run verify');
    console.log('        docker compose build');
    console.log('        docker compose up -d');
    console.log(`        wait for ${CONTAINER} to be healthy`);
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

// Check every exit code DIRECTLY -- a piped build once read as success here (CLAUDE.md).
for (const [label, args] of [
  ['build', ['compose', 'build']],
  ['deploy', ['compose', 'up', '-d']],
]) {
  console.log(`\n${label}: docker ${args.join(' ')}`);
  const r = run('docker', args, { inherit: true });
  if (!r.ok) {
    console.error(`${label} FAILED (exit ${r.status}). No tag was made.`);
    process.exit(1);
  }
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
