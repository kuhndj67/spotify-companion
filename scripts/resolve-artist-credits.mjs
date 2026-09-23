#!/usr/bin/env node
/**
 * Resolve the full artist credit for every track in the corpus, and cache it.
 *
 * ## Why this exists
 *
 * `play.artist_id` is `track.artists[0]` — the **lead** artist only — so a feature credit is filed
 * under the lead and absent from the guest's totals. Measured 2026-09-22: Ren 44 as lead against
 * 79 in credit, Macklemore **9 against 50**. A report ranking artists by play count therefore
 * ranks them *wrongly*, not merely low.
 *
 * ## Where the credits come from, and why it is nearly free
 *
 * `play.artist_name` is `artists.map(a => a.name).join(', ')` on **live** rows, so splitting it on
 * `', '` recovers every artist exactly. ⚠️ **That is verified, not assumed**: checked against
 * Spotify's own `artists[]` for all 119 multi-artist tracks in the corpus on 2026-09-22 —
 * **119 of 119 exact, 0 mismatches.** There is no partial-matching problem, because the stored
 * string is a join of exact names rather than free text.
 *
 * ⚠️ **Backfilled rows are the exception.** `RecentlyPlayedBackfill` stores `artists[0].name`
 * alone, so a track only ever seen backfilled has no credit to split — 0 of 86 backfilled rows
 * carry a multi-artist credit, not because those tracks are solo but because it was never
 * recorded. Those tracks are the only ones needing a request.
 *
 * ## ⚠️ THE BATCH ENDPOINT IS 403 IN DEVELOPMENT MODE
 *
 * `GET /v1/tracks?ids=` returns **403 Forbidden** — confirmed with a batch of a *single* id on
 * 2026-09-22, which rules out payload size and rate limiting. `GET /v1/tracks/{id}` returns
 * **200**. Same family as the `/contains` finding: Development Mode blocks the "several items"
 * endpoints while leaving the single-item ones open. So this costs one request per track, and any
 * future rewrite that "optimises" it into a batch will get a 403 for every call.
 *
 * ## The cache is ACQUIRED data, not derived data
 *
 * It lives in `data/artist-credits.json`, beside `history.db` and **not** inside
 * `data/reporting/`, because that directory holds a database that is rebuilt whole and thrown
 * away. This file cost requests. It is re-acquirable, but only by spending them again, so a
 * reporting rebuild must not be able to destroy it.
 *
 * Read-only against `history.db`, so it is safe to run while the container is up.
 *
 * usage:
 *   npm run reporting:credits            # resolve what is missing, then stop
 *   npm run reporting:credits -- --all   # re-resolve every track, ignoring the cache
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db');
const CACHE = process.env.ARTIST_CREDITS_PATH ?? join(projectRoot, 'data', 'artist-credits.json');
const CONFIG =
  process.env.SPOTIFY_CONFIG_PATH ?? join(projectRoot, 'secrets', 'spotify-config.json');
const ALL = process.argv.includes('--all');

/** Spacing between requests. Generous: this is a one-off and the rate limit is shared with the app. */
const SPACING_MS = 140;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function accessToken() {
  const { clientId, clientSecret, refreshToken } = JSON.parse(await readFile(CONFIG, 'utf8'));
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token refresh ${res.status}: ${JSON.stringify(body)}`);
  return body.access_token;
}

// ── what the corpus knows ────────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB, { readOnly: true });
const tracks = db
  .prepare(
    `SELECT track_id,
            MAX(CASE WHEN provenance = 'live' THEN artist_name END) AS live_credit,
            MAX(artist_name)                                        AS any_name,
            MAX(CASE WHEN provenance = 'live' THEN artist_id END)   AS live_artist_id,
            MAX(artist_id)                                          AS any_artist_id,
            SUM(provenance = 'live')                                AS live_rows,
            COUNT(*)                                                AS plays,
            MAX(title)                                              AS title
       FROM play
      WHERE track_id IS NOT NULL
      GROUP BY track_id`,
  )
  .all();
db.close();

const cache = existsSync(CACHE) && !ALL ? JSON.parse(await readFile(CACHE, 'utf8')) : {};
const before = Object.keys(cache).length;

/**
 * A track's credit is derivable locally when a LIVE row recorded it: that row holds the joined
 * string. Otherwise the names were never written down and only Spotify has them.
 */
const derivable = [];
const needsRequest = [];
for (const track of tracks) {
  if (cache[track.track_id] !== undefined) continue;
  if (track.live_rows > 0 && track.live_credit !== null) derivable.push(track);
  else needsRequest.push(track);
}

console.log(`
tracks in corpus        : ${tracks.length}
already cached          : ${before}
derivable from live rows: ${derivable.length}   (free -- split the stored credit)
need a Spotify request  : ${needsRequest.length}   (backfilled-only: the credit was never recorded)
`);

// ── free: split what a live row already recorded ─────────────────────────────────────────────
for (const track of derivable) {
  const names = track.live_credit.split(', ').map((name) => name.trim());
  cache[track.track_id] = {
    title: track.title,
    // ⚠️ Only the LEAD's id is known from stored data. A name with no id is still usable for
    // grouping; a fabricated id would not be. `null` means unknown, as everywhere else.
    artists: names.map((name, index) => ({
      name,
      id: index === 0 ? (track.live_artist_id ?? track.any_artist_id) : null,
    })),
    source: 'split-live-credit',
  };
}

// ── paid: one request per track the corpus never recorded a full credit for ───────────────────
let resolved = 0;
let failed = 0;
if (needsRequest.length > 0) {
  const token = await accessToken();
  for (const [index, track] of needsRequest.entries()) {
    // ⚠️ SINGLE-item endpoint. The batch form is 403 here -- see the header.
    const res = await fetch(`https://api.spotify.com/v1/tracks/${track.track_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      failed++;
      console.log(`  ${res.status} on ${track.track_id} (${track.title})`);
      await sleep(SPACING_MS);
      continue;
    }
    const body = await res.json();
    cache[track.track_id] = {
      title: body.name,
      artists: body.artists.map((artist) => ({ name: artist.name, id: artist.id })),
      source: 'spotify-track',
    };
    resolved++;
    if ((index + 1) % 10 === 0) console.log(`  ...${index + 1}/${needsRequest.length}`);
    await sleep(SPACING_MS);
  }
}

await writeFile(CACHE, JSON.stringify(cache, null, 1), 'utf8');

const entries = Object.values(cache);
const multi = entries.filter((entry) => entry.artists.length > 1).length;
const withIds = entries.filter((entry) => entry.artists.every((a) => a.id !== null)).length;

console.log(`
cache written : ${CACHE}
  tracks      : ${Object.keys(cache).length}  (was ${before})
  resolved by request : ${resolved}${failed > 0 ? `   FAILED: ${failed}` : ''}
  multi-artist tracks : ${multi}
  every artist has an id : ${withIds} of ${entries.length}
    (the rest are guests whose id was never recorded -- names group fine, ids are absent
     rather than invented)
`);

if (failed > 0) {
  console.error(`⚠️  ${failed} track(s) did not resolve. Re-run to retry only those; the cache is
    incremental and a failure is never written as an empty credit.`);
  process.exit(1);
}
