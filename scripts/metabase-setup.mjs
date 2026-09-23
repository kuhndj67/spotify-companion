#!/usr/bin/env node
/**
 * Register `reporting.db` with Metabase and sync its schema.
 *
 * Idempotent: run it again after a rebuild and it re-syncs rather than duplicating the connection.
 *
 * ## Authentication
 *
 * Needs a Metabase **API key**, not a password:
 *
 *   Metabase -> gear -> Admin settings -> Authentication -> API keys -> Create API key
 *   Group: Administrators.  Then:  MB_API_KEY=mb_... npm run reporting:metabase
 *
 * ⚠️ **An API key rather than a session login, deliberately.** A password typed into a script ends
 * up in shell history and in this repo's transcript, grants everything that account can do, and
 * cannot be withdrawn without changing the password. An API key is scoped, revocable from the same
 * screen that created it, and leaves the account itself untouched. This is a local single-user box,
 * but "local" is the reason to keep the blast radius small rather than a reason not to bother.
 *
 * ⚠️ It is read from the environment and **never written to a file** by this script. If you want it
 * persisted, put it in `secrets/`, which is already gitignored and already the convention here.
 *
 * ## The path is a CONTAINER path
 *
 * `/reporting/reporting.db`, not a host path. `reporting/compose.yaml` mounts `../data/reporting`
 * as a read-only directory. Giving Metabase a Windows path is the most likely reason a setup
 * "succeeds" and then shows no data.
 *
 * usage:
 *   MB_API_KEY=mb_xxx npm run reporting:metabase
 *   MB_API_KEY=mb_xxx npm run reporting:metabase -- --resync   # after a data rebuild
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The key comes from `secrets/metabase.json`, or from `MB_API_KEY` for a one-off.
 *
 * ⚠️ `secrets/` and not `config/`: it is gitignored with a committed `.example.json` beside it,
 * which is already this project's convention for `spotify-config.json` and `musicbrainz.json`. A
 * new convention for one more credential is a second place to check before publishing anything.
 */
const SECRETS = process.env.METABASE_CONFIG_PATH ?? join(projectRoot, 'secrets', 'metabase.json');
const fromFile = existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, 'utf8')) : {};

const BASE = process.env.MB_URL ?? fromFile.baseUrl ?? 'http://localhost:3020';
const KEY = process.env.MB_API_KEY ?? fromFile.apiKey;
const DB_PATH = process.env.MB_DB_PATH ?? '/reporting/reporting.db';
const DB_NAME = process.env.MB_DB_NAME ?? 'Spotify listening';

if (!KEY || KEY.startsWith('mb_paste')) {
  console.error(`
✖ No Metabase API key. Looked in ${SECRETS} and in MB_API_KEY.

  Metabase -> gear -> Admin settings -> Authentication -> API keys -> Create API key
  Group: Administrators

  Then either copy secrets/metabase.example.json to secrets/metabase.json and paste the key in,
  or run once with:  MB_API_KEY=mb_your_key npm run reporting:metabase

  (An API key rather than your password: it is scoped and revocable. See the header of
   scripts/metabase-setup.mjs.)
`);
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-api-key': KEY,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error bodies are reported raw below */
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${res.statusText}\n  ${text.slice(0, 400)}`);
  }
  return json;
}

// ── find or create the connection ────────────────────────────────────────────────────────────
const existing = await api('GET', '/api/database');
const databases = Array.isArray(existing) ? existing : (existing.data ?? []);
let db = databases.find((entry) => entry.engine === 'sqlite' && entry.details?.db === DB_PATH);

// A connection with our name but the WRONG path is the failure this script exists to fix, so it is
// corrected in place rather than duplicated — two connections called the same thing, one of them
// empty, is worse than either.
const misnamed = databases.find((entry) => entry.name === DB_NAME && entry.details?.db !== DB_PATH);

if (db === undefined && misnamed !== undefined) {
  console.log(`found "${DB_NAME}" pointing at ${JSON.stringify(misnamed.details?.db)} — correcting`);
  db = await api('PUT', `/api/database/${misnamed.id}`, {
    engine: 'sqlite',
    details: { db: DB_PATH, 'advanced-options': false },
  });
} else if (db === undefined) {
  console.log(`creating connection "${DB_NAME}" -> ${DB_PATH}`);
  db = await api('POST', '/api/database', {
    name: DB_NAME,
    engine: 'sqlite',
    details: { db: DB_PATH, 'advanced-options': false },
  });
} else {
  console.log(`connection already present: id ${db.id} -> ${DB_PATH}`);
}

// ── sync, then scan so the columns get their field types and value lists ──────────────────────
console.log('syncing schema...');
await api('POST', `/api/database/${db.id}/sync_schema`);

// Metabase syncs asynchronously; poll the table list rather than guessing at a sleep.
let tables = [];
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise((r) => setTimeout(r, 1000));
  const meta = await api('GET', `/api/database/${db.id}/metadata`);
  tables = meta.tables ?? [];
  if (tables.length > 0) break;
}

if (tables.length === 0) {
  console.error(`
✖ Synced, but Metabase found NO TABLES.

  That almost always means the file is not visible at ${DB_PATH} inside the container.
  Check with:
      docker exec spotify-metabase sh -c 'ls -la /reporting/'
  and rebuild the data with:
      npm run reporting:build
`);
  process.exit(1);
}

console.log(`\ntables and views Metabase can see (${tables.length}):`);
for (const table of tables.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${table.name.padEnd(22)} ${String(table.fields?.length ?? '?').padStart(3)} fields`);
}

console.log(`
✅ ready.  Open ${BASE}/browse/databases/${db.id}

Start here:
  artist_credit_totals   every credited appearance -- THE artist ranking. Rank on artist_plays.
  play_artist            one row per (play, credited artist). Artist x time pivots live here.
  play_fact              one row per play. Use this whenever a total must equal the play count.
  report_caveat          read this first: the ways this data yields a confident wrong answer.

⚠️ artist_totals is LEAD-ONLY and kept only for comparison -- it hides 99 of 234 artists.
⚠️ SUM(artist_plays) exceeds the play count by design: a collaboration counts for each artist.
`);
