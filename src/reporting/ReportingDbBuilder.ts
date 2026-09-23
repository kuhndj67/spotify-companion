/**
 * Materialises `reporting.db` from `history.db`.
 *
 * ## Why a second database rather than pointing the BI tool at `history.db`
 *
 * 1. **`history.db` has exactly one writer, and it stays that way.** A maintenance script run
 *    against the live container corrupted it once (audit 2026-09-21); it reported
 *    `integrity_check: ok` at the time and surfaced later as a just-written value reading `null`.
 *    A BI tool holding read handles on a WAL database beside the app is a risk with no upside.
 * 2. **A read-only mount may not be able to open a WAL database at all.** SQLite needs the `-shm`
 *    file to read one, and a reader concurrent with a live writer generally needs *write* access to
 *    it. The existing WAL-over-bind-mount finding does not cover this case — that probe was one
 *    writer in one container.
 * 3. **The BI tool must not do date arithmetic.** See `factRow.ts`: `%W` is not the ISO week, and
 *    `started_at` is UTC while 63% of plays fall in the previous local evening.
 *
 * `reporting.db` is derived and disposable — regenerable from `history.db` at any time — which is
 * the opposite of `history.db`, the one artefact in this project that comes back from nowhere.
 *
 * ## ⚠️ It is rewritten whole, which is why the container mounts a DIRECTORY
 *
 * Each build writes a temporary file and renames it into place, so a reader never sees a
 * half-built database. **That rename replaces the inode.** A single-file bind mount binds an
 * inode, so `./data/reporting/reporting.db:/reporting/reporting.db` would either fail or silently
 * detach the container's view from the host file after the first rebuild — the container would
 * serve the original file for ever while the host kept updating a different one. The compose file
 * therefore mounts `./data/reporting` as a directory, for the same reason `./data` is a directory
 * mount for SQLite's `-wal` and `-shm` siblings.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FACT_COLUMNS, toFactRow, type FactRow, type SourcePlay } from './factRow.js';

export interface BuildResult {
  rows: number;
  timeZone: string;
  generatedAt: string;
  outputPath: string;
  distinctArtists: number;
  distinctTracks: number;
  multiArtistRows: number;
  /** Rows where the credit count is unknowable (backfilled). Reported, never folded into the above. */
  creditUnknownRows: number;
  earliestDay: string | null;
  latestDay: string | null;
}

export interface BuildOptions {
  historyDbPath: string;
  outputPath: string;
  timeZone: string;
  /** ISO 8601. Injected rather than read, so a build is a function of its inputs. */
  generatedAt: string;
}

/**
 * Caveats written INTO the reporting database.
 *
 * ⚠️ These are not documentation for developers — they are rows a person building a question in
 * the BI tool can see. Every one of them is a way this data produces a **plausible wrong answer**
 * rather than an error, and every one has already been mistaken for a finding at least once in
 * this project's history. A caveat that lives only in CLAUDE.md does not reach the person reading
 * a chart.
 */
const CAVEATS: { severity: string; topic: string; caveat: string }[] = [
  {
    severity: 'critical',
    topic: 'artist_id is the LEAD artist only',
    caveat:
      'artist_id is track.artists[0]. A feature credit is filed under the lead and is absent from '
      + 'the guest\'s totals. Measured 2026-09-22 over 662 plays: Ren 44 as lead vs 79 in credit '
      + '(44% low), Prof 38% low, Token 59% low, Macklemore 9 vs 50 (82% low). 148 of the 576 LIVE '
      + 'rows carry a multi-artist credit; the true rate is higher because 86 backfilled rows cannot '
      + 'show one at all (see the artist_name caveat). RANKING artists by play count is therefore '
      + 'WRONG, not just low: Macklemore places 5th by lead credit and 2nd by real credit. Use '
      + 'artist_credit_count > 1 to find affected rows, and artist_credit_count IS NULL for rows '
      + 'where it cannot be known.',
  },
  {
    severity: 'critical',
    topic: 'not-observed is not a zero',
    caveat:
      'A backfilled play has NO observation trail and never can have one — the app was not running, '
      + 'and recently-played reports no progress. Its outcome is unknown because it was never '
      + 'watched, which is a different fact from a live play the app watched and could not classify '
      + '(inconclusive). Merging them once made 74% completion on the days the app ran read as 38% '
      + 'overall. Never sum not-observed into completed or skipped. Filter on observed = 1 to see '
      + 'only measured plays, but do not delete the others: their volume is real information about '
      + 'how much the instrument missed.',
  },
  {
    severity: 'critical',
    topic: 'artist_name means two different things by provenance',
    caveat:
      'On LIVE rows artist_name is the full joined credit ("Ren, Eden Nash"); on BACKFILLED rows it '
      + 'is the LEAD NAME ONLY ("Ren"), because RecentlyPlayedBackfill stores artists[0].name. '
      + 'Measured 2026-09-22: 148 of 576 live rows are multi-artist and 0 of 86 backfilled rows are '
      + '- not because those tracks are solo but because it was never recorded. The same track '
      + 'appears both ways. GROUP ARTIST REPORTS ON lead_artist_name, which is well defined for '
      + 'both; grouping on artist_name also fragments one artist across every collaboration.',
  },
  {
    severity: 'warning',
    topic: 'skipped means a rejection, as of classifier v2',
    caveat:
      'Until 2026-09-22 a skipped row could be a transition rather than a rejection: in the AI DJ '
      + 'context Spotify stops REPORTING a track 18-41s before it stops PLAYING, so 24 of 46 live '
      + 'skips were tracks that played to the end. Classifier v2 reclassifies those as completed. '
      + 'A skipped row now means the listener rejected it. classifier_version = 2 marks rows '
      + 're-derived under the new rule; version 1 rows are backfilled and were never eligible.',
  },
  {
    severity: 'warning',
    topic: 'completion_ratio is listened time and may exceed 1.0',
    caveat:
      'It is listened time over duration, not position, so replaying a track legitimately exceeds '
      + '1.0 and must never be clamped — clamping looks like hygiene and destroys the repeat-listen '
      + 'signal. For "how far did it get", use max_progress_ms or unobserved_tail_ms instead.',
  },
  {
    severity: 'warning',
    topic: 'calendar buckets are pre-computed in local time',
    caveat:
      'local_day, local_week and local_month are finished strings computed in the report time zone '
      + 'by the same module the app chart uses. DO NOT re-derive them from started_at, which is '
      + 'UTC: 63% of plays fall between 23:00Z and 04:00Z, the previous local evening, so a UTC day '
      + 'misdates 49% of plays. SQLite %W is not the ISO week either. Group on the local_* columns.',
  },
  {
    severity: 'info',
    topic: 'null means unknown, never false or zero',
    caveat:
      'Throughout this data a null is an absent measurement, not a negative one. Missing data here '
      + 'correlates with what is being measured, so treating a null as 0 hides a bias rather than '
      + 'showing it. This is why label_verdict, completion_ratio and explicit are nullable.',
  },
  {
    severity: 'info',
    topic: 'this database is derived and disposable',
    caveat:
      'Rebuilt whole from history.db by scripts/build-reporting-db.mjs. Nothing should ever be '
      + 'written here by hand — the next build discards it. history.db is the artefact that cannot '
      + 'be regenerated; this one always can.',
  },
];

const DDL = `
CREATE TABLE play_fact (
  play_id            INTEGER PRIMARY KEY,
  started_at         TEXT    NOT NULL,
  local_day          TEXT    NOT NULL,
  local_week         TEXT    NOT NULL,
  local_month        TEXT    NOT NULL,
  local_hour         INTEGER NOT NULL,
  local_weekday      TEXT    NOT NULL,
  local_weekday_ord  INTEGER NOT NULL,
  artist_id          TEXT,
  artist_name        TEXT    NOT NULL,
  lead_artist_name   TEXT    NOT NULL,
  -- Nullable ON PURPOSE: unknown on backfilled rows, which record only the lead name.
  artist_credit_count INTEGER,
  track_id           TEXT    NOT NULL,
  track_title        TEXT    NOT NULL,
  outcome            TEXT    NOT NULL,
  play_bucket        TEXT    NOT NULL,
  provenance         TEXT    NOT NULL,
  observed           INTEGER NOT NULL,
  completion_ratio   REAL,
  duration_ms        INTEGER,
  duration_s         INTEGER,
  max_progress_ms    INTEGER,
  unobserved_tail_ms INTEGER,
  label_verdict      TEXT,
  explicit           INTEGER,
  album_type         TEXT,
  classifier_version INTEGER,
  has_isrc           INTEGER NOT NULL,
  artist_lead_only   INTEGER NOT NULL
);

CREATE INDEX idx_fact_artist ON play_fact(artist_id);
CREATE INDEX idx_fact_lead   ON play_fact(lead_artist_name);
CREATE INDEX idx_fact_track  ON play_fact(track_id);
CREATE INDEX idx_fact_week   ON play_fact(local_week);
CREATE INDEX idx_fact_day    ON play_fact(local_day);

CREATE TABLE report_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE report_caveat (
  id       INTEGER PRIMARY KEY,
  severity TEXT NOT NULL,
  topic    TEXT NOT NULL,
  caveat   TEXT NOT NULL
);

-- Convenience views. Deliberately thin: they name a ranking so it is not re-derived per question,
-- and they carry the lead-artist warning in their own column list.
-- ⚠️ GROUPED ON lead_artist_name, NOT artist_name. Grouping on the full credit string fragments
-- one artist across every collaboration: Ren's 55 plays split into 44 + 11 across six strings, and
-- Macklemore's 29 across eighteen. That reads as a smaller artist rather than as an artefact of the
-- grouping, which is the most persuasive kind of wrong answer this data produces.
CREATE VIEW artist_totals AS
  SELECT artist_id,
         lead_artist_name,
         COUNT(*)                                        AS plays,
         SUM(observed)                                   AS observed_plays,
         SUM(play_bucket = 'completed')                  AS completed,
         SUM(play_bucket = 'skipped')                    AS skipped,
         SUM(play_bucket = 'inconclusive')               AS inconclusive,
         SUM(play_bucket = 'not-observed')               AS not_observed,
         -- Counts only rows that COULD show a collaboration: backfilled rows never can.
         SUM(COALESCE(artist_credit_count, 1) > 1)       AS multi_artist_plays,
         SUM(artist_credit_count IS NULL)                AS credit_unknown_plays,
         COUNT(DISTINCT artist_name)                     AS distinct_credit_strings,
         MIN(local_day)                                  AS first_day,
         MAX(local_day)                                  AS last_day
    FROM play_fact
   GROUP BY artist_id, lead_artist_name;

CREATE VIEW track_totals AS
  SELECT track_id,
         track_title,
         artist_id,
         lead_artist_name,
         COUNT(*)                          AS plays,
         SUM(observed)                     AS observed_plays,
         SUM(play_bucket = 'completed')    AS completed,
         SUM(play_bucket = 'skipped')      AS skipped,
         SUM(play_bucket = 'inconclusive') AS inconclusive,
         SUM(play_bucket = 'not-observed') AS not_observed,
         MIN(local_day)                    AS first_day,
         MAX(local_day)                    AS last_day
    FROM play_fact
   GROUP BY track_id, track_title, artist_id, lead_artist_name;
`;

const SOURCE_QUERY = `
  SELECT id, started_at, outcome, provenance, close_reason,
         artist_id, artist_name, track_id, title,
         ev_completion_ratio, ev_duration_ms, ev_max_progress_ms,
         label_verdict, explicit, album_type, classifier_version, isrc
    FROM play
   ORDER BY started_at
`;

export function buildReportingDb(options: BuildOptions): BuildResult {
  const { historyDbPath, outputPath, timeZone, generatedAt } = options;

  // Read-only: this process must never be able to write history.db, whatever else it does.
  const source = new DatabaseSync(historyDbPath, { readOnly: true });
  let plays: SourcePlay[];
  try {
    const integrity = source.prepare('PRAGMA integrity_check').all() as {
      integrity_check: string;
    }[];
    if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') {
      throw new Error(`history.db integrity_check: ${JSON.stringify(integrity)}`);
    }
    plays = source.prepare(SOURCE_QUERY).all() as unknown as SourcePlay[];
  } finally {
    source.close();
  }

  const facts: FactRow[] = plays.map((play) => toFactRow(play, timeZone));

  mkdirSync(dirname(outputPath), { recursive: true });
  // Build beside the target, then rename: a reader never sees a partial database. See the note at
  // the top about why this makes a directory mount mandatory.
  const temporaryPath = join(dirname(outputPath), `.building-${process.pid}.db`);
  rmSync(temporaryPath, { force: true });

  const out = new DatabaseSync(temporaryPath);
  try {
    out.exec(DDL);

    const placeholders = FACT_COLUMNS.map(() => '?').join(',');
    const insert = out.prepare(
      `INSERT INTO play_fact (${FACT_COLUMNS.join(',')}) VALUES (${placeholders})`,
    );
    out.exec('BEGIN');
    for (const fact of facts) {
      insert.run(...FACT_COLUMNS.map((column) => fact[column] as never));
    }

    const caveat = out.prepare(
      'INSERT INTO report_caveat (severity, topic, caveat) VALUES (?,?,?)',
    );
    for (const entry of CAVEATS) caveat.run(entry.severity, entry.topic, entry.caveat);

    const meta = out.prepare('INSERT INTO report_meta (key, value) VALUES (?,?)');
    const days = facts.map((fact) => fact.local_day).sort();
    const summary: BuildResult = {
      rows: facts.length,
      timeZone,
      generatedAt,
      outputPath,
      distinctArtists: new Set(facts.map((fact) => fact.artist_id).filter((id) => id !== null)).size,
      distinctTracks: new Set(facts.map((fact) => fact.track_id)).size,
      // ⚠️ A null credit count is NOT counted as single-artist. It is unknown, and folding it in
      // would understate the multi-artist rate — the same `null` != `0` rule as everywhere else.
      multiArtistRows: facts.filter((fact) => (fact.artist_credit_count ?? 0) > 1).length,
      creditUnknownRows: facts.filter((fact) => fact.artist_credit_count === null).length,
      earliestDay: days[0] ?? null,
      latestDay: days[days.length - 1] ?? null,
    };
    for (const [key, value] of Object.entries({
      generated_at: generatedAt,
      time_zone: timeZone,
      source_db: historyDbPath,
      rows: String(summary.rows),
      distinct_artists_lead: String(summary.distinctArtists),
      distinct_tracks: String(summary.distinctTracks),
      multi_artist_rows: String(summary.multiArtistRows),
      credit_unknown_rows: String(summary.creditUnknownRows),
      earliest_local_day: summary.earliestDay ?? 'none',
      latest_local_day: summary.latestDay ?? 'none',
      read_this_first: 'SELECT * FROM report_caveat ORDER BY severity, topic',
    })) {
      meta.run(key, value);
    }

    out.exec('COMMIT');
    // Fold the WAL in so the published file is self-contained: the container mounts the directory
    // read-only, and a reader that needs to create a -shm beside a WAL database may not be able to.
    out.exec('PRAGMA journal_mode = DELETE');
    out.close();

    renameSync(temporaryPath, outputPath);
    return summary;
  } catch (error) {
    try {
      out.close();
    } catch {
      // Already closed on the success path; closing twice is not an error worth masking this one.
    }
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
