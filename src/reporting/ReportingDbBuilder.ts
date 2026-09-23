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
 * ## ⚠️ It is rebuilt IN PLACE, in one transaction — and the first design was wrong
 *
 * The first version built a temporary file and renamed it over the target, for filesystem-level
 * atomicity. **That fails on Windows with `EPERM` once anything holds the target open**, because
 * Windows will not rename over an open file. It worked while Metabase merely had the directory
 * mounted and broke the moment Metabase became a live data source — so it passed every check until
 * the whole system was actually running, which is the only place it could have been caught.
 *
 * The rebuild now drops and recreates every object inside a single transaction on the existing
 * file. That is **better, not merely a workaround**: atomicity comes from SQLite rather than from
 * the filesystem, a crash mid-build rolls back to the previous contents instead of leaving a
 * `.building-*.db` behind, and the inode never changes, so a reader's open handle stays valid.
 *
 * `busy_timeout` is set because Metabase holds a pooled read connection: the exclusive lock is
 * available between its queries, not during one, so the writer waits rather than failing.
 *
 * ⚠️ **The container still mounts a DIRECTORY, and it must.** An in-place transaction writes a
 * `reporting.db-journal` sibling, which has to live beside the database — the same reason `./data`
 * is a directory mount for SQLite's `-wal` and `-shm` siblings.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { FACT_COLUMNS, toFactRow, type FactRow, type SourcePlay } from './factRow.js';

/**
 * One track's full artist credit, from `data/artist-credits.json`.
 *
 * ⚠️ `id` is `null` for a guest whose id was never recorded. Names group correctly; a fabricated
 * id would not, and `null` means unknown here exactly as it does everywhere else.
 */
export interface TrackCredit {
  title: string;
  artists: { name: string; id: string | null }[];
  source: string;
}
export type CreditMap = Record<string, TrackCredit>;

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
  /** Rows in `play_artist`: one per (play, credited artist). Exceeds `rows` by design. */
  artistRows: number;
  /** How many plays got a full credit rather than a lead-only fallback. */
  playsWithFullCredit: number;
  earliestDay: string | null;
  latestDay: string | null;
}

export interface BuildOptions {
  historyDbPath: string;
  outputPath: string;
  timeZone: string;
  /** ISO 8601. Injected rather than read, so a build is a function of its inputs. */
  generatedAt: string;
  /**
   * Full artist credits by track id, from `scripts/resolve-artist-credits.mjs`.
   *
   * ⚠️ **Optional, and the build says so loudly when it is absent.** Without it every play resolves
   * to its lead artist alone, which undercounts collaborators by 38-82% — and a report that is
   * silently lead-only looks exactly like a correct one. `report_meta.artist_credit_coverage` and a
   * `critical` caveat both record which mode the database was built in.
   */
  credits?: CreditMap;
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
    topic: 'artist_id is the LEAD artist only -- use play_artist instead',
    caveat:
      'artist_id and lead_artist_name are track.artists[0], the LEAD ONLY, so a feature credit is '
      + 'filed under the lead and absent from the guest. Resolved and measured 2026-09-22 over 662 '
      + 'plays and 234 credited artists: 99 OF 234 ARTISTS ARE INVISIBLE in a lead-only view '
      + '(0 lead plays, 185 artist-plays between them) and 112 of 234 are understated at all. '
      + 'Ren 55 lead -> 87 credited (37% understated). Macklemore 29 -> 50 (42%), moving from 5th '
      + 'to 3rd. Chris Webby 0 -> 24 and Ryan Lewis 0 -> 17, both entirely absent. Token and Prof '
      + 'are UNAFFECTED because they always lead -- the undercount is not uniform, so it cannot be '
      + 'corrected with a scaling factor. FIX: rank artists on the artist_credit_totals view or the '
      + 'play_artist table, which count every credited appearance. Never rank artists on play_fact.',
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

-- ⚠️ ONE ROW PER (PLAY, CREDITED ARTIST). A four-artist collaboration produces four rows, so
-- SUM(plays) ACROSS ARTISTS EXCEEDS THE PLAY COUNT and that is correct: the play counts for each
-- artist credited on it. Never present a total over this table as "plays"; it is "artist-plays".
-- Use play_fact for anything that must add up to the number of plays.
CREATE TABLE play_artist (
  play_id         INTEGER NOT NULL,
  artist_position INTEGER NOT NULL,   -- 0 = lead, as stored in track.artists
  artist_name     TEXT    NOT NULL,
  artist_id       TEXT,               -- NULL for a guest whose id was never recorded
  is_lead         INTEGER NOT NULL,
  -- How this credit was obtained. 'lead-only-fallback' means the full credit was NOT available and
  -- this row undercounts; it is recorded per row so a question can exclude or surface it.
  credit_source   TEXT    NOT NULL,
  -- Dimensions duplicated from play_fact so an artist pivot needs no join. ~850 rows; free.
  local_day       TEXT    NOT NULL,
  local_week      TEXT    NOT NULL,
  local_month     TEXT    NOT NULL,
  local_hour      INTEGER NOT NULL,
  local_weekday   TEXT    NOT NULL,
  local_weekday_ord INTEGER NOT NULL,
  track_id        TEXT    NOT NULL,
  track_title     TEXT    NOT NULL,
  play_bucket     TEXT    NOT NULL,
  provenance      TEXT    NOT NULL,
  observed        INTEGER NOT NULL,
  completion_ratio REAL,
  label_verdict   TEXT,
  PRIMARY KEY (play_id, artist_position)
);

CREATE INDEX idx_pa_name  ON play_artist(artist_name);
CREATE INDEX idx_pa_id    ON play_artist(artist_id);
CREATE INDEX idx_pa_week  ON play_artist(local_week);
CREATE INDEX idx_pa_day   ON play_artist(local_day);

-- The ranking the Artist Play Summary should use: every credited appearance, not just leads.
CREATE VIEW artist_credit_totals AS
  SELECT artist_name,
         MAX(artist_id)                             AS artist_id,
         COUNT(*)                                   AS artist_plays,
         SUM(is_lead)                               AS lead_plays,
         COUNT(*) - SUM(is_lead)                     AS guest_plays,
         SUM(observed)                              AS observed_plays,
         SUM(play_bucket = 'completed')             AS completed,
         SUM(play_bucket = 'skipped')               AS skipped,
         SUM(play_bucket = 'inconclusive')          AS inconclusive,
         SUM(play_bucket = 'not-observed')          AS not_observed,
         SUM(credit_source = 'lead-only-fallback')  AS undercounted_rows,
         COUNT(DISTINCT track_id)                   AS distinct_tracks,
         MIN(local_day)                             AS first_day,
         MAX(local_day)                             AS last_day
    FROM play_artist
   GROUP BY artist_name;

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

  const out = new DatabaseSync(outputPath);
  try {
    // ⚠️ Metabase holds a POOLED READ CONNECTION to this file. The exclusive lock is free between
    // its queries but not during one, so without a timeout a rebuild fails with SQLITE_BUSY
    // whenever it happens to land on a query. Wait instead of failing.
    out.exec('PRAGMA busy_timeout = 15000');
    // DELETE rather than WAL: the container mounts this directory READ-ONLY, and a reader that has
    // to create a -shm beside a WAL database may be unable to. Set before the transaction, because
    // journal_mode cannot change inside one.
    out.exec('PRAGMA journal_mode = DELETE');

    // ⚠️ IMMEDIATE, not deferred. A deferred transaction takes its write lock at the first write,
    // by which point the schema has already been dropped — so a busy reader would abort the build
    // with the tables gone. IMMEDIATE acquires the lock up front: either the whole rebuild proceeds
    // or nothing is touched.
    out.exec('BEGIN IMMEDIATE');
    // Drop in reverse dependency order: views reference the tables.
    out.exec(`
      DROP VIEW  IF EXISTS artist_credit_totals;
      DROP VIEW  IF EXISTS artist_totals;
      DROP VIEW  IF EXISTS track_totals;
      DROP TABLE IF EXISTS play_artist;
      DROP TABLE IF EXISTS play_fact;
      DROP TABLE IF EXISTS report_caveat;
      DROP TABLE IF EXISTS report_meta;
    `);
    out.exec(DDL);

    const placeholders = FACT_COLUMNS.map(() => '?').join(',');
    const insert = out.prepare(
      `INSERT INTO play_fact (${FACT_COLUMNS.join(',')}) VALUES (${placeholders})`,
    );
    for (const fact of facts) {
      insert.run(...FACT_COLUMNS.map((column) => fact[column] as never));
    }

    // ── play_artist ──────────────────────────────────────────────────────────────────────────
    const credits = options.credits ?? {};
    const insertArtist = out.prepare(
      `INSERT INTO play_artist (
         play_id, artist_position, artist_name, artist_id, is_lead, credit_source,
         local_day, local_week, local_month, local_hour, local_weekday, local_weekday_ord,
         track_id, track_title, play_bucket, provenance, observed, completion_ratio, label_verdict
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    let artistRows = 0;
    let playsWithFullCredit = 0;
    for (const fact of facts) {
      const credit = credits[fact.track_id];
      /**
       * ⚠️ THE FALLBACK IS LABELLED, NOT SILENT. With no cached credit, a play resolves to its lead
       * alone — which is the 38-82% undercount. Recording `lead-only-fallback` per row is what lets
       * a question tell "this artist has few plays" from "this row could not be resolved", and those
       * are the two readings a ranked axis cannot distinguish on its own.
       */
      const artists =
        credit === undefined
          ? [{ name: fact.lead_artist_name, id: fact.artist_id }]
          : credit.artists;
      const creditSource = credit === undefined ? 'lead-only-fallback' : credit.source;
      if (credit !== undefined) playsWithFullCredit++;

      for (const [position, artist] of artists.entries()) {
        insertArtist.run(
          fact.play_id,
          position,
          artist.name,
          // Position 0 is the lead, and play.artist_id is exactly that, so prefer the stored id
          // over the cache for it: the cache may carry a null where the corpus has the real value.
          position === 0 ? (fact.artist_id ?? artist.id) : artist.id,
          position === 0 ? 1 : 0,
          creditSource,
          fact.local_day,
          fact.local_week,
          fact.local_month,
          fact.local_hour,
          fact.local_weekday,
          fact.local_weekday_ord,
          fact.track_id,
          fact.track_title,
          fact.play_bucket,
          fact.provenance,
          fact.observed,
          fact.completion_ratio,
          fact.label_verdict,
        );
        artistRows++;
      }
    }

    const caveat = out.prepare(
      'INSERT INTO report_caveat (severity, topic, caveat) VALUES (?,?,?)',
    );
    for (const entry of CAVEATS) caveat.run(entry.severity, entry.topic, entry.caveat);

    // ⚠️ A build-specific caveat, because the coverage is a property of THIS build rather than of
    // the data model. A lead-only database looks exactly like a complete one from inside a chart.
    const coverage = facts.length === 0 ? 1 : playsWithFullCredit / facts.length;
    caveat.run(
      coverage === 1 ? 'info' : 'critical',
      'artist credit coverage of this build',
      coverage === 1
        ? `Every one of the ${facts.length} plays has a FULL artist credit in play_artist, so `
          + 'artist_credit_totals counts guest appearances as well as leads. Macklemore reads 50 '
          + 'rather than 9. Rank artists on artist_credit_totals.artist_plays, NOT on '
          + 'artist_totals.plays, which is lead-only. Remember that summing artist_plays exceeds '
          + 'the play count, because a collaboration counts for each credited artist.'
        : `⚠️ ONLY ${playsWithFullCredit} of ${facts.length} plays `
          + `(${(coverage * 100).toFixed(1)}%) have a full artist credit. The rest fall back to the `
          + "LEAD ARTIST ALONE and are marked credit_source = 'lead-only-fallback' in "
          + 'play_artist. Those rows undercount collaborators by 38-82%. Run '
          + '`npm run reporting:credits` and rebuild.',
    );

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
      artistRows,
      playsWithFullCredit,
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
      artist_rows: String(summary.artistRows),
      plays_with_full_credit: String(summary.playsWithFullCredit),
      artist_credit_coverage:
        facts.length === 0 ? 'n/a' : `${((playsWithFullCredit / facts.length) * 100).toFixed(1)}%`,
      rank_artists_on: 'artist_credit_totals.artist_plays (NOT artist_totals.plays, lead-only)',
      earliest_local_day: summary.earliestDay ?? 'none',
      latest_local_day: summary.latestDay ?? 'none',
      read_this_first: 'SELECT * FROM report_caveat ORDER BY severity, topic',
    })) {
      meta.run(key, value);
    }

    out.exec('COMMIT');
    out.close();
    return summary;
  } catch (error) {
    // Roll back so the file keeps its PREVIOUS contents. A failed rebuild must leave the last good
    // report in place rather than an empty or half-populated one: a report that is quietly missing
    // rows reads as a finding about the listening, not as a failed build.
    try {
      out.exec('ROLLBACK');
    } catch {
      // No transaction open — the failure happened before BEGIN, so there is nothing to undo.
    }
    try {
      out.close();
    } catch {
      // Closing twice is not an error worth masking the real one.
    }
    throw error;
  }
}
