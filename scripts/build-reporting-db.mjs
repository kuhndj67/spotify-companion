#!/usr/bin/env node
/**
 * Build `data/reporting/reporting.db` from `data/history.db`.
 *
 * Read-only against `history.db`, so it is **safe to run while the container is up** — unlike the
 * maintenance scripts, which are writers. Nothing here can touch the one artefact that cannot be
 * regenerated.
 *
 * ⚠️ NEEDS THE tsx LOADER, because importing the real bucketing and the real `bucketOf` is the
 * point: `npm run reporting:build`. A dashboard that re-derives "which week" or "is this a skip"
 * in SQL is the two-copies-of-one-rule shape that has already cost this project three defects.
 *
 * usage:
 *   npm run reporting:build
 *   REPORT_TIME_ZONE=UTC npm run reporting:build      # to compare bucketings
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReportingDb } from '../src/reporting/ReportingDbBuilder.js';
import { DEFAULT_REPORT_TIME_ZONE } from '../src/reporting/timeBuckets.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const historyDbPath = process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db');
const outputPath =
  process.env.REPORTING_DB_PATH ?? join(projectRoot, 'data', 'reporting', 'reporting.db');
const timeZone = process.env.REPORT_TIME_ZONE ?? DEFAULT_REPORT_TIME_ZONE;
const creditsPath =
  process.env.ARTIST_CREDITS_PATH ?? join(projectRoot, 'data', 'artist-credits.json');

/**
 * ⚠️ ABSENT CREDITS DEGRADE TO LEAD-ONLY, AND THAT IS ANNOUNCED RATHER THAN ASSUMED.
 *
 * A lead-only report undercounts collaborators by 38-82% (Macklemore 9 plays instead of 50) and
 * looks exactly like a correct report from inside a chart. So the build prints the coverage, writes
 * it to report_meta, and raises the coverage caveat to `critical` when it is not 100%.
 */
const credits = existsSync(creditsPath)
  ? JSON.parse(readFileSync(creditsPath, 'utf8'))
  : undefined;

if (credits === undefined) {
  console.warn(`
⚠️  NO ARTIST CREDITS CACHE at ${creditsPath}
    Every play will resolve to its LEAD ARTIST ONLY, which undercounts collaborators by 38-82%.
    Run \`npm run reporting:credits\` first. Building anyway, and recording the shortfall.
`);
}

const result = buildReportingDb({
  historyDbPath,
  outputPath,
  timeZone,
  generatedAt: new Date().toISOString(),
  credits,
});

console.log(`
reporting.db built
  source        : ${result.outputPath}
  from          : ${historyDbPath}
  time zone     : ${result.timeZone}
  generated at  : ${result.generatedAt}

  rows          : ${result.rows}
  local days    : ${result.earliestDay} .. ${result.latestDay}
  tracks        : ${result.distinctTracks}
  artists (lead): ${result.distinctArtists}
  multi-artist  : ${result.multiArtistRows} rows -- UNDERCOUNTED for every artist but the lead
  credit unknown: ${result.creditUnknownRows} rows -- backfilled, so the stored credit string
                  never carried the collaboration.

  play_artist   : ${result.artistRows} rows (one per credited artist per play)
  full credits  : ${result.playsWithFullCredit} of ${result.rows} plays (${((result.playsWithFullCredit / Math.max(1, result.rows)) * 100).toFixed(1)}%)

  ⚠️ Rank artists on artist_credit_totals.artist_plays, NOT artist_totals.plays (lead-only).
     SUM(artist_plays) EXCEEDS the play count by design: a collaboration counts for each
     credited artist. Use play_fact for anything that must total the number of plays.

     See: SELECT severity, topic FROM report_caveat ORDER BY severity, topic;
`);
