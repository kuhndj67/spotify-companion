#!/usr/bin/env node
/**
 * Create the Artist Play Summary dashboard and its track drill-down, over the Metabase API.
 *
 * ## Why in a script rather than by clicking
 *
 * Metabase keeps questions and dashboards in its own H2 application database, inside a Docker
 * volume. Built by hand they exist only there: not reviewable, not diffable, and gone if the volume
 * is ever recreated. Built by this script they are a file in the repo, and rebuilding them is one
 * command.
 *
 * Idempotent: re-running updates the existing cards and dashboards in place rather than making a
 * second copy of everything.
 *
 * ## ⚠️ NO METABASE "MODEL" IS CREATED, DELIBERATELY
 *
 * The SQL views in `reporting.db` are already the curated layer — which artist counts, which time
 * bucket, what a skip means. A Metabase Model on top would be a **second** place those questions
 * are answered, in a tool that cannot see the credit rules, and the two would drift. That shape has
 * already cost this project four defects (`bucketOf` vs `trackPlayStats`, `localGuard` HTTP vs
 * WebSocket, `attribute-skips.mjs` vs `skipAttribution.ts`, `artist_totals` grouped on the wrong
 * column). Questions read the views directly.
 *
 * ## What it builds
 *
 * - **Artist Play Summary** — time down, artists across, play counts in the cells. Week, day and
 *   month variants, plus the ranking table that says what is lead and what is guest.
 * - **Artist detail** — the same shape for one artist's tracks, reached by clicking an artist.
 *
 * usage:  npm run reporting:report
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = process.env.METABASE_CONFIG_PATH ?? join(projectRoot, 'secrets', 'metabase.json');
const fromFile = existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, 'utf8')) : {};
const BASE = process.env.MB_URL ?? fromFile.baseUrl ?? 'http://localhost:3020';
const KEY = process.env.MB_API_KEY ?? fromFile.apiKey;

/** How many artists across the top of the pivot. 20 covers 57% of artist-plays on this corpus. */
const TOP_N = Number(process.env.MB_TOP_ARTISTS ?? 20);

if (!KEY || KEY.startsWith('mb_paste')) {
  console.error(`✖ No Metabase API key. See scripts/metabase-setup.mjs.`);
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
    /* reported raw below */
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}\n  ${text.slice(0, 500)}`);
  }
  return json;
}

// ── resolve ids rather than hardcoding them ──────────────────────────────────────────────────
// ⚠️ Field ids are assigned by Metabase when it syncs, so they differ between installs and change
// if a table is re-synced. Hardcoding them produces a dashboard that is silently empty on any other
// machine, which is the failure this whole reporting effort keeps running into: a plausible result.
const databases = await api('GET', '/api/database');
const list = Array.isArray(databases) ? databases : (databases.data ?? []);
const db = list.find((entry) => entry.engine === 'sqlite' && entry.details?.db?.endsWith('reporting.db'));
if (db === undefined) {
  console.error('✖ reporting.db is not registered. Run: npm run reporting:metabase');
  process.exit(1);
}

const meta = await api('GET', `/api/database/${db.id}/metadata`);
const tableOf = (name) => {
  const table = meta.tables.find((entry) => entry.name === name);
  if (table === undefined) throw new Error(`table ${name} not found — run npm run reporting:build`);
  return table;
};
const fieldOf = (table, name) => {
  const field = table.fields.find((entry) => entry.name === name);
  if (field === undefined) throw new Error(`${table.name}.${name} not found`);
  return field.id;
};

const playArtist = tableOf('play_artist');
const totalsView = tableOf('artist_credit_totals');

const F = {
  artistName: fieldOf(playArtist, 'artist_name'),
  artistRank: fieldOf(playArtist, 'artist_rank'),
  week: fieldOf(playArtist, 'local_week'),
  day: fieldOf(playArtist, 'local_day'),
  month: fieldOf(playArtist, 'local_month'),
  trackTitle: fieldOf(playArtist, 'track_title'),
  bucket: fieldOf(playArtist, 'play_bucket'),
};

console.log(`database ${db.id}, play_artist table ${playArtist.id}`);

// ── card helpers ─────────────────────────────────────────────────────────────────────────────
const existingCards = await api('GET', '/api/card');

async function upsertCard(spec) {
  const found = existingCards.find((card) => card.name === spec.name && !card.archived);
  if (found) {
    console.log(`  updating card "${spec.name}" (${found.id})`);
    return api('PUT', `/api/card/${found.id}`, spec);
  }
  console.log(`  creating card "${spec.name}"`);
  return api('POST', '/api/card', spec);
}

/** A pivot of counts: `timeField` down the side, `columnField` across the top. */
function pivotCard({ name, description, timeField, columnField, filter }) {
  return {
    name,
    description,
    type: 'question',
    display: 'pivot',
    dataset_query: {
      type: 'query',
      database: db.id,
      query: {
        'source-table': playArtist.id,
        aggregation: [['count']],
        breakout: [
          ['field', timeField, null],
          ['field', columnField, null],
        ],
        ...(filter === undefined ? {} : { filter }),
      },
    },
    visualization_settings: {
      'pivot_table.column_split': {
        rows: [['field', timeField, null]],
        columns: [['field', columnField, null]],
        values: [['aggregation', 0]],
      },
      'pivot.show_row_totals': true,
      'pivot.show_column_totals': true,
    },
  };
}

// ── the cards ────────────────────────────────────────────────────────────────────────────────
// ⚠️ Filtered on artist_rank, which is a STORED column. Metabase has no view of the credit rules,
// so asking it to work out "the top artists" would answer that question in a second place.
const topArtists = ['<=', ['field', F.artistRank, null], TOP_N];

console.log('\ncards:');
const byWeek = await upsertCard(
  pivotCard({
    name: 'Artist Play Summary — by week',
    description:
      `Plays per artist per local week. Top ${TOP_N} artists by TOTAL credited plays across the `
      + 'whole corpus, so the columns stay the same whatever time range is filtered and two ranges '
      + 'can be compared. Counts EVERY credited appearance, not just lead credits: Ren reads 87 '
      + 'rather than 55, and Chris Webby appears at all. Summing the cells exceeds the number of '
      + 'plays, because a collaboration counts once per artist.',
    timeField: F.week,
    columnField: F.artistName,
    filter: topArtists,
  }),
);

const byDay = await upsertCard(
  pivotCard({
    name: 'Artist Play Summary — by day',
    description:
      'Same as the weekly view at day grain. Days are LOCAL days: 63% of this corpus falls between '
      + '23:00Z and 04:00Z, which is the previous local evening, so a UTC day would misdate half the '
      + 'plays.',
    timeField: F.day,
    columnField: F.artistName,
    filter: topArtists,
  }),
);

const byMonth = await upsertCard(
  pivotCard({
    name: 'Artist Play Summary — by month',
    description:
      'Month grain. The corpus currently spans 33 days, so this has two partial rows and becomes '
      + 'useful as history accumulates rather than now.',
    timeField: F.month,
    columnField: F.artistName,
    filter: topArtists,
  }),
);

const ranking = await upsertCard({
  name: 'Artist ranking — lead vs guest',
  description:
    'Every credited artist, ranked by total credited plays, split into lead and guest appearances. '
    + 'guest_plays > 0 with lead_plays = 0 is an artist a lead-only report cannot see at all — 99 '
    + 'of 234 artists on this corpus.',
  type: 'question',
  display: 'table',
  dataset_query: {
    type: 'query',
    database: db.id,
    query: {
      'source-table': totalsView.id,
      'order-by': [['desc', ['field', fieldOf(totalsView, 'artist_plays'), null]]],
    },
  },
  visualization_settings: {},
});

// The drill-down. `artist_name` is left unfiltered here and constrained by a dashboard parameter,
// which is what the click-through on the summary sets.
const trackDetail = await upsertCard(
  pivotCard({
    name: 'Artist detail — tracks by week',
    description:
      'One artist\'s tracks per local week. Reached by clicking an artist in the summary; the artist '
      + 'filter comes from the dashboard parameter. Unfiltered it shows every track, which is 515 '
      + 'columns — use it through the dashboard.',
    timeField: F.week,
    columnField: F.trackTitle,
  }),
);

const outcomeMix = await upsertCard(
  pivotCard({
    name: 'Artist detail — outcome mix by week',
    description:
      'How the selected artist\'s plays closed, per week. ⚠️ `not-observed` means the app was not '
      + 'running and never saw the play, which is NOT the same as inconclusive (it watched and could '
      + 'not tell). Never add not-observed into completed or skipped.',
    timeField: F.week,
    columnField: F.bucket,
  }),
);

console.log(`\ncard ids: week ${byWeek.id}, day ${byDay.id}, month ${byMonth.id}, ranking ${ranking.id}, tracks ${trackDetail.id}, outcomes ${outcomeMix.id}`);

// ── dashboards ───────────────────────────────────────────────────────────────────────────────
const existingDashboards = await api('GET', '/api/dashboard');

async function upsertDashboard(name, description) {
  const found = existingDashboards.find((entry) => entry.name === name && !entry.archived);
  if (found) {
    console.log(`  updating dashboard "${name}" (${found.id})`);
    return api('GET', `/api/dashboard/${found.id}`);
  }
  console.log(`  creating dashboard "${name}"`);
  return api('POST', '/api/dashboard', { name, description });
}

console.log('\ndashboards:');

// Detail dashboard first: the summary needs its id for the click-through.
const detail = await upsertDashboard(
  'Artist detail',
  'One artist, over time. Reached by clicking an artist in Artist Play Summary.',
);

const artistParam = {
  id: 'artist_name_param',
  name: 'Artist',
  slug: 'artist',
  type: 'string/=',
  sectionId: 'string',
};

await api('PUT', `/api/dashboard/${detail.id}`, {
  parameters: [artistParam],
  dashcards: [
    {
      id: -1,
      card_id: trackDetail.id,
      row: 0,
      col: 0,
      size_x: 24,
      size_y: 8,
      parameter_mappings: [
        {
          parameter_id: artistParam.id,
          card_id: trackDetail.id,
          target: ['dimension', ['field', F.artistName, null]],
        },
      ],
    },
    {
      id: -2,
      card_id: outcomeMix.id,
      row: 8,
      col: 0,
      size_x: 24,
      size_y: 6,
      parameter_mappings: [
        {
          parameter_id: artistParam.id,
          card_id: outcomeMix.id,
          target: ['dimension', ['field', F.artistName, null]],
        },
      ],
    },
  ],
});

const summary = await upsertDashboard(
  'Artist Play Summary',
  `Plays by artist and time. Top ${TOP_N} artists by total credited plays. Click an artist to open `
  + 'their tracks. Counts every credited appearance, not just leads.',
);

/**
 * Click-through: clicking a cell opens the detail dashboard for that artist.
 *
 * ⚠️ `columnName` is the COLUMN the click reads the artist from, and on a pivot the artist is the
 * column header rather than a row value. If this stops passing the artist, that is the first thing
 * to check — a click-through that silently passes nothing lands on an unfiltered dashboard showing
 * every artist, which looks like data rather than like a broken link.
 */
const clickToDetail = {
  click_behavior: {
    type: 'link',
    linkType: 'dashboard',
    targetId: detail.id,
    parameterMapping: {
      [artistParam.id]: {
        id: artistParam.id,
        source: { type: 'column', id: 'artist_name', name: 'Artist Name' },
        target: { type: 'parameter', id: artistParam.id },
      },
    },
  },
};

await api('PUT', `/api/dashboard/${summary.id}`, {
  dashcards: [
    { id: -1, card_id: byWeek.id, row: 0, col: 0, size_x: 24, size_y: 8, visualization_settings: clickToDetail },
    { id: -2, card_id: ranking.id, row: 8, col: 0, size_x: 12, size_y: 8 },
    { id: -3, card_id: byDay.id, row: 8, col: 12, size_x: 12, size_y: 8 },
    { id: -4, card_id: byMonth.id, row: 16, col: 0, size_x: 24, size_y: 5 },
  ],
});

console.log(`
✅ built.

  Artist Play Summary : ${BASE}/dashboard/${summary.id}
  Artist detail       : ${BASE}/dashboard/${detail.id}

  Top ${TOP_N} artists across the top, local time down the side, every credited appearance counted.
  Click an artist in the weekly pivot to open their track breakdown.

⚠️ Cell totals exceed the play count: a collaboration counts once per credited artist.
⚠️ artist_rank is corpus-wide, so "top ${TOP_N}" does not re-rank when you filter a time range.
   SELECT severity, topic, caveat FROM report_caveat ORDER BY severity;
`);
