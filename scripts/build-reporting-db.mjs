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

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReportingDb } from '../src/reporting/ReportingDbBuilder.js';
import { DEFAULT_REPORT_TIME_ZONE } from '../src/reporting/timeBuckets.js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const historyDbPath = process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db');
const outputPath =
  process.env.REPORTING_DB_PATH ?? join(projectRoot, 'data', 'reporting', 'reporting.db');
const timeZone = process.env.REPORT_TIME_ZONE ?? DEFAULT_REPORT_TIME_ZONE;

const result = buildReportingDb({
  historyDbPath,
  outputPath,
  timeZone,
  generatedAt: new Date().toISOString(),
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
  credit unknown: ${result.creditUnknownRows} rows -- backfilled, so the credit was never recorded.
                  The real multi-artist rate is therefore HIGHER than the number above.
                  See: SELECT * FROM report_caveat WHERE severity = 'critical';
`);
