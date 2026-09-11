#!/usr/bin/env node
/**
 * Create `config/rules.json` from the committed example, once.
 *
 * ## Why a setup step rather than the app doing it
 *
 * `config/` is mounted **read-only** at U3 (infrastructure design Q1 = A): nothing in the unit
 * writes rules, and granting a write capability nothing uses is the habit `compose.yaml`'s
 * `musicbrainz.json` comment exists to warn against. An app that tried to self-heal a missing
 * file would fail with EROFS on every startup of a fresh install — the noisy-fresh-install
 * outcome the design was trying to avoid, reached from the other direction.
 *
 * So the file is created here, on the host, the same shape as `npm run auth` creating
 * `secrets/spotify-config.json`.
 *
 * ## ⚠️ Creating the directory is the real reason this script exists
 *
 * Docker creates a missing bind-mount source directory **itself, owned by root**. The container
 * entrypoint drops privileges to `node`, so a root-owned `config/` leaves the app unable to read
 * its own rules — with a permissions error that reads like a code fault rather than a setup one.
 *
 * Running this before the first `compose up` creates `config/` as the invoking user and avoids
 * that entirely.
 *
 * Refuses to overwrite an existing file. Rules are user-authored, and this script is exactly the
 * kind of thing someone re-runs while debugging something else.
 */

import { mkdir, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const configDir = join(root, 'config');
const target = join(configDir, 'rules.json');
const example = join(configDir, 'rules.example.json');

const exists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

async function main() {
  // Created as the invoking user. See the header — this is the point of the script.
  await mkdir(configDir, { recursive: true });

  if (await exists(target)) {
    console.log(`config/rules.json already exists — leaving it alone.`);
    console.log(`  ${target}`);
    return;
  }

  if (!(await exists(example))) {
    console.error(`Missing template: ${example}`);
    console.error(`It is committed to the repository; a fresh checkout should have it.`);
    process.exitCode = 1;
    return;
  }

  await copyFile(example, target);
  console.log(`Created config/rules.json from the example.`);
  console.log(`  ${target}`);
  console.log(``);
  console.log(`It contains no rules, which is a valid rule set — nothing will be skipped.`);
  console.log(`Nothing evaluates rules yet in any case: U3 is the pure core, and the app`);
  console.log(`does not consume its decisions until U4/U5.`);
}

main().catch((error) => {
  console.error(`rules:init failed:`, error);
  process.exitCode = 1;
});
