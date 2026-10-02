/**
 * The reporting fact row and the `reporting.db` builder.
 *
 * ⚠️ The builder is exercised against a **real migrated schema**, not a hand-rolled one. Its
 * source query names columns by hand, so a migration that renames or drops one of them would
 * otherwise break the report silently — the build would succeed and the column would arrive
 * `undefined`, which SQLite stores as `null`, which this project's own convention reads as
 * "unknown". A wrong answer that looks like absent data is the failure mode this whole codebase is
 * organised against.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { CLASSIFIER_VERSION, DEFAULT_TOLERANCES, summarise } from '../src/history/outcomeClassifier.js';
import type { NewPlayRecord } from '../src/history/types.js';
import { completeTrail } from './historyGenerators.js';
import { buildReportingDb } from '../src/reporting/ReportingDbBuilder.js';
import { creditCount, leadArtistName, toFactRow, type SourcePlay } from '../src/reporting/factRow.js';

const NY = 'America/New_York';

function source(overrides: Partial<SourcePlay> = {}): SourcePlay {
  return {
    id: 1,
    started_at: '2026-09-22T01:25:00.000Z',
    outcome: 'completed',
    provenance: 'live',
    close_reason: 'track-change',
    artist_id: 'artist1234567890123456',
    artist_name: 'Ren, Eden Nash',
    track_id: 'track1234567890123456',
    title: 'A Track',
    ev_completion_ratio: 0.95,
    ev_duration_ms: 200_000,
    ev_max_progress_ms: 190_000,
    label_verdict: 'independent',
    explicit: 0,
    album_type: 'single',
    classifier_version: 2,
    isrc: 'USUM71703861',
    ...overrides,
  };
}

describe('creditCount — tri-state, because provenance decides first', () => {
  it('counts the names on a live row', () => {
    assert.equal(creditCount('Macklemore, anees, MC Abdul, Amer Zahr', 'live'), 4);
    assert.equal(creditCount('Ren', 'live'), 1);
  });

  it('is NULL on a backfilled row rather than 1', () => {
    // ⚠️ The whole point. A backfilled row stores only artists[0].name, so the credit count is
    // UNKNOWN. Writing 1 would assert "this track has one artist" and would make the corpus-wide
    // multi-artist rate look lower than it is — 0 of 86 backfilled rows can show a collaboration.
    assert.equal(creditCount('Ren', 'backfilled'), null);
    assert.equal(creditCount('Ren, Eden Nash', 'backfilled'), null);
  });

  it('is NULL rather than 0 for an empty credit', () => {
    assert.equal(creditCount('', 'live'), null);
    assert.equal(creditCount('   ', 'live'), null);
  });
});

describe('leadArtistName', () => {
  it('takes the first element, which is what artist_id refers to', () => {
    assert.equal(leadArtistName('Macklemore, anees, MC Abdul, Amer Zahr'), 'Macklemore');
    assert.equal(leadArtistName('Ren, Eden Nash'), 'Ren');
    assert.equal(leadArtistName('Ren'), 'Ren');
  });

  it('never returns an empty string, because a blank axis label reads as a bug', () => {
    assert.equal(leadArtistName(''), 'unknown');
    assert.equal(leadArtistName(', Someone'), 'unknown');
  });
});

describe('toFactRow', () => {
  it('buckets in the given zone, not UTC', () => {
    // The corpus play from timeBuckets.test.ts: 01:25Z is the previous local evening.
    const fact = toFactRow(source(), NY);
    assert.equal(fact.local_day, '2026-09-21');
    assert.equal(fact.local_hour, 21);
    assert.equal(fact.local_weekday, 'Mon');
    assert.equal(fact.local_month, '2026-09');
    assert.equal(fact.local_week, '2026-09-21');

    const utc = toFactRow(source(), 'UTC');
    assert.equal(utc.local_day, '2026-09-22');
    assert.notEqual(fact.local_day, utc.local_day);
  });

  it('takes play_bucket from bucketOf rather than re-deriving it', () => {
    assert.equal(toFactRow(source({ outcome: 'completed' }), NY).play_bucket, 'completed');
    assert.equal(toFactRow(source({ outcome: 'skipped' }), NY).play_bucket, 'skipped');
    // Provenance decides first: a backfilled row is never `inconclusive`.
    assert.equal(
      toFactRow(source({ outcome: 'unknown', provenance: 'backfilled' }), NY).play_bucket,
      'not-observed',
    );
    assert.equal(
      toFactRow(source({ outcome: 'unknown', provenance: 'live' }), NY).play_bucket,
      'inconclusive',
    );
  });

  it('computes the unobserved tail, the axis classifier v2 decides on', () => {
    const fact = toFactRow(source({ ev_duration_ms: 200_000, ev_max_progress_ms: 190_000 }), NY);
    assert.equal(fact.unobserved_tail_ms, 10_000);
  });

  it('keeps a null as a null, never as 0 or an empty string', () => {
    const fact = toFactRow(
      source({
        ev_completion_ratio: null,
        ev_duration_ms: null,
        ev_max_progress_ms: null,
        label_verdict: null,
        explicit: null,
        album_type: null,
        artist_id: null,
        isrc: null,
      }),
      NY,
    );
    assert.equal(fact.completion_ratio, null);
    assert.equal(fact.duration_ms, null);
    assert.equal(fact.duration_s, null);
    assert.equal(fact.unobserved_tail_ms, null);
    assert.equal(fact.label_verdict, null);
    assert.equal(fact.artist_id, null);
    // has_isrc is a derived 0/1 flag, not the ISRC itself, so 0 here means "absent" by design.
    assert.equal(fact.has_isrc, 0);
  });

  it('throws rather than filing a play under an arbitrary day', () => {
    assert.throws(() => toFactRow(source({ started_at: 'not a date' }), NY), RangeError);
  });
});

describe('buildReportingDb', () => {
  function withTempDirs<T>(run: (dirs: { history: string; output: string }) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'reporting-test-'));
    try {
      return run({
        history: join(dir, 'history.db'),
        output: join(dir, 'reporting', 'reporting.db'),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function seed(path: string): void {
    const repo = new SqliteHistoryRepository(path);
    const trail = completeTrail(200_000);
    const evidence = summarise(trail, DEFAULT_TOLERANCES);
    const base: NewPlayRecord = {
      trackId: 'track1234567890123456',
      isrc: 'USUM71703861',
      title: 'A Track',
      artistName: 'Ren, Eden Nash',
      artistId: 'artist1234567890123456',
      albumName: 'An Album',
      releaseDate: '2019-05-17',
      ageYears: 7,
      following: true,
      // 01:25Z -> the previous local evening. The row that proves the zone landed.
      startedAt: '2026-09-22T01:25:00.000Z',
      endedAt: '2026-09-22T01:28:00.000Z',
      outcome: 'completed',
      closeReason: 'track-change',
      evidence,
      provenance: 'live',
      skipSource: null,
      contextType: 'playlist',
      contextUri: null,
      explicit: null,
      albumType: null,
      successorLagMs: null,
      classifierVersion: CLASSIFIER_VERSION,
    };
    repo.recordPlay(base, trail);
    repo.recordPlay(
      {
        ...base,
        trackId: 'track2222222222222222',
        title: 'Backfilled Track',
        artistName: 'Ren',
        startedAt: '2026-09-07T01:00:00.000Z',
        endedAt: '2026-09-07T01:03:00.000Z',
        outcome: 'unknown',
        provenance: 'backfilled',
      },
      [],
    );
    repo.close();
  }

  it('builds a self-contained database with the expected shape', () => {
    withTempDirs(({ history, output }) => {
      seed(history);
      const result = buildReportingDb({
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
      });

      assert.equal(result.rows, 2);
      assert.equal(result.timeZone, NY);

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        // ⚠️ No WAL. The container mounts the directory READ-ONLY, and a reader may be unable to
        // create the -shm file a WAL database needs. A build that left WAL on would produce a
        // database Metabase cannot open, and the failure would look like a driver problem.
        const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
        assert.equal(mode.journal_mode.toLowerCase(), 'delete');

        // Field access rather than deepEqual: node:sqlite returns null-prototype row objects, so
        // comparing against a plain literal fails on the prototype rather than on the value.
        const integrity = db.prepare('PRAGMA integrity_check').all() as {
          integrity_check: string;
        }[];
        assert.equal(integrity.length, 1);
        assert.equal(integrity[0]!.integrity_check, 'ok');

        const objects = (
          db
            .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`)
            .all() as { name: string }[]
        ).map((row) => row.name);
        for (const expected of [
          'artist_totals',
          'play_fact',
          'report_caveat',
          'report_meta',
          'track_totals',
        ]) {
          assert.ok(objects.includes(expected), `missing ${expected} (got ${objects.join(', ')})`);
        }
      } finally {
        db.close();
      }
    });
  });

  it('buckets in the report zone, so the report cannot disagree with the app', () => {
    withTempDirs(({ history, output }) => {
      seed(history);
      buildReportingDb({
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
      });

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        const rows = db
          .prepare('SELECT started_at, local_day, local_week FROM play_fact ORDER BY started_at')
          .all() as { started_at: string; local_day: string; local_week: string }[];
        // 2026-09-07T01:00Z is Sunday the 6th locally: the week of 08-31, not 09-07. This is the
        // 18-play seam, in a test, so a zone regression fails here rather than in a chart.
        assert.equal(rows[0]!.local_day, '2026-09-06');
        assert.equal(rows[0]!.local_week, '2026-08-31');
        assert.equal(rows[1]!.local_day, '2026-09-21');
      } finally {
        db.close();
      }
    });
  });

  it('records the credit count as unknown for a backfilled row', () => {
    withTempDirs(({ history, output }) => {
      seed(history);
      buildReportingDb({
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
      });

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        const rows = db
          .prepare(
            `SELECT provenance, artist_credit_count, lead_artist_name, play_bucket
               FROM play_fact ORDER BY provenance`,
          )
          .all() as {
          provenance: string;
          artist_credit_count: number | null;
          lead_artist_name: string;
          play_bucket: string;
        }[];
        const backfilled = rows.find((row) => row.provenance === 'backfilled')!;
        const live = rows.find((row) => row.provenance === 'live')!;

        assert.equal(backfilled.artist_credit_count, null, 'unknown, not 1');
        assert.equal(backfilled.play_bucket, 'not-observed');
        assert.equal(live.artist_credit_count, 2);
        // Both group under the same artist despite different credit strings.
        assert.equal(backfilled.lead_artist_name, 'Ren');
        assert.equal(live.lead_artist_name, 'Ren');
      } finally {
        db.close();
      }
    });
  });

  it('groups artist_totals so one artist is not fragmented across credit strings', () => {
    withTempDirs(({ history, output }) => {
      seed(history);
      buildReportingDb({
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
      });

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        // Two plays, two different credit strings, ONE artist. Grouping on artist_name would
        // return two rows of one play each and read as a smaller artist.
        const rows = db
          .prepare('SELECT lead_artist_name, plays, distinct_credit_strings FROM artist_totals')
          .all() as { lead_artist_name: string; plays: number; distinct_credit_strings: number }[];
        assert.equal(rows.length, 1, 'one artist, not one row per collaboration');
        assert.equal(rows[0]!.lead_artist_name, 'Ren');
        assert.equal(rows[0]!.plays, 2);
        assert.equal(rows[0]!.distinct_credit_strings, 2);
      } finally {
        db.close();
      }
    });
  });

  it('carries the caveats into the database, where a report author will see them', () => {
    withTempDirs(({ history, output }) => {
      seed(history);
      buildReportingDb({
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
      });

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        const critical = (
          db
            .prepare(`SELECT topic FROM report_caveat WHERE severity = 'critical' ORDER BY topic`)
            .all() as { topic: string }[]
        ).map((row) => row.topic);
        // ⚠️ Asserted by TOPIC, not by count. A count says nothing about which warning is present,
        // and it breaks whenever a caveat is added — which trains whoever hits it to bump the number
        // rather than read the list. These are the traps that yield a confident wrong answer.
        for (const expected of ['artist_id is the LEAD artist only', 'not-observed is not a zero']) {
          assert.ok(
            critical.some((topic) => topic.includes(expected)),
            `missing critical caveat "${expected}"; got: ${critical.join(' | ')}`,
          );
        }

        const meta = Object.fromEntries(
          (db.prepare('SELECT key, value FROM report_meta').all() as {
            key: string;
            value: string;
          }[]).map((row) => [row.key, row.value]),
        );
        assert.equal(meta.time_zone, NY);
        assert.equal(meta.generated_at, '2026-09-23T00:00:00.000Z');
        assert.equal(meta.rows, '2');
        assert.equal(meta.credit_unknown_rows, '1');
      } finally {
        db.close();
      }
    });
  });

  it('expands a collaboration into one play_artist row per credited artist', () => {
    withTempDirs(({ history, output }) => {
      seed(history);
      const result = buildReportingDb({
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
        credits: {
          track1234567890123456: {
            title: 'A Track',
            artists: [
              { name: 'Ren', id: 'artist1234567890123456' },
              { name: 'Eden Nash', id: null },
            ],
            source: 'split-live-credit',
          },
          track2222222222222222: {
            title: 'Backfilled Track',
            artists: [
              { name: 'Ren', id: 'artist1234567890123456' },
              { name: 'Chris Webby', id: 'webby00000000000000000' },
            ],
            source: 'spotify-track',
          },
        },
      });

      // 2 plays, 2 artists each.
      assert.equal(result.rows, 2);
      assert.equal(result.artistRows, 4);
      assert.equal(result.playsWithFullCredit, 2);

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        const totals = db
          .prepare(
            `SELECT artist_name, artist_plays, lead_plays, guest_plays
               FROM artist_credit_totals ORDER BY artist_plays DESC, artist_name`,
          )
          .all() as {
          artist_name: string;
          artist_plays: number;
          lead_plays: number;
          guest_plays: number;
        }[];

        // Ren leads both; the guests are credited without leading. A guest-only artist is exactly
        // the case a lead-only view renders INVISIBLE — 99 of 234 artists on the real corpus.
        const ren = totals.find((row) => row.artist_name === 'Ren')!;
        assert.equal(ren.artist_plays, 2);
        assert.equal(ren.lead_plays, 2);

        const webby = totals.find((row) => row.artist_name === 'Chris Webby')!;
        assert.equal(webby.artist_plays, 1);
        assert.equal(webby.lead_plays, 0, 'invisible in a lead-only view');
        assert.equal(webby.guest_plays, 1);

        // ⚠️ The sum across artists EXCEEDS the play count, by design. Pinned so nobody "fixes" it.
        const summed = totals.reduce((total, row) => total + row.artist_plays, 0);
        assert.equal(summed, 4);
        const plays = db.prepare('SELECT COUNT(*) AS n FROM play_fact').get() as { n: number };
        assert.equal(plays.n, 2);
        assert.ok(summed > plays.n, 'artist-plays must exceed plays when collaborations exist');

        // Every play keeps exactly one lead, so `is_lead` can be trusted as a de-duplicator.
        const leads = db
          .prepare('SELECT COUNT(*) AS n FROM play_artist WHERE is_lead = 1')
          .get() as { n: number };
        assert.equal(leads.n, 2);

        // A guest id that was never recorded stays null rather than becoming an empty string.
        const eden = db
          .prepare(`SELECT artist_id FROM play_artist WHERE artist_name = 'Eden Nash'`)
          .get() as { artist_id: string | null };
        assert.equal(eden.artist_id, null);
      } finally {
        db.close();
      }
    });
  });

  it('falls back to lead-only when credits are absent, and SAYS SO', () => {
    withTempDirs(({ history, output }) => {
      seed(history);
      // No `credits`: the degraded mode. It must be announced, because a lead-only report looks
      // exactly like a correct one from inside a chart.
      const result = buildReportingDb({
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
      });

      assert.equal(result.playsWithFullCredit, 0);
      assert.equal(result.artistRows, 2, 'one lead per play, no guests recovered');

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        const sources = db
          .prepare('SELECT DISTINCT credit_source FROM play_artist')
          .all() as { credit_source: string }[];
        assert.deepEqual(sources.map((row) => row.credit_source), ['lead-only-fallback']);

        // The coverage shortfall is raised to `critical`, not left as a footnote.
        const critical = (
          db
            .prepare(`SELECT topic FROM report_caveat WHERE severity = 'critical'`)
            .all() as { topic: string }[]
        ).map((row) => row.topic);
        assert.ok(
          critical.some((topic) => topic.includes('coverage')),
          `expected a critical coverage caveat, got: ${critical.join(' | ')}`,
        );

        const meta = Object.fromEntries(
          (db.prepare('SELECT key, value FROM report_meta').all() as {
            key: string;
            value: string;
          }[]).map((row) => [row.key, row.value]),
        );
        assert.equal(meta.artist_credit_coverage, '0.0%');
      } finally {
        db.close();
      }
    });
  });

  it('ranks artists deterministically, with ties broken by name', () => {
    // ⚠️ An unstable rank silently reshuffles the report's COLUMNS between rebuilds, so the same
    // dashboard would show different artists on different days with nothing saying why. Ties are
    // broken by name so a rebuild is reproducible.
    withTempDirs(({ history, output }) => {
      seed(history);
      const options = {
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
        credits: {
          track1234567890123456: {
            title: 'A Track',
            artists: [
              { name: 'Ren', id: 'artist1234567890123456' },
              { name: 'Zed Guest', id: null },
            ],
            source: 'split-live-credit',
          },
          track2222222222222222: {
            title: 'Backfilled Track',
            artists: [
              { name: 'Ren', id: 'artist1234567890123456' },
              { name: 'Alpha Guest', id: null },
            ],
            source: 'spotify-track',
          },
        },
      };
      buildReportingDb(options);

      const readRanks = () => {
        const db = new DatabaseSync(output, { readOnly: true });
        try {
          return (
            db
              .prepare(
                `SELECT DISTINCT artist_name, artist_rank, artist_total_plays
                   FROM play_artist ORDER BY artist_rank`,
              )
              .all() as { artist_name: string; artist_rank: number; artist_total_plays: number }[]
          ).map((row) => `${row.artist_rank}:${row.artist_name}:${row.artist_total_plays}`);
        } finally {
          db.close();
        }
      };

      const first = readRanks();
      // Ren has 2 plays so leads; the two guests have 1 each and tie, broken alphabetically.
      assert.deepEqual(first, ['1:Ren:2', '2:Alpha Guest:1', '3:Zed Guest:1']);

      // Rebuilding must produce the identical ordering.
      buildReportingDb({ ...options, generatedAt: '2026-09-23T02:00:00.000Z' });
      assert.deepEqual(readRanks(), first, 'rank must be stable across rebuilds');
    });
  });

  it('rebuilds in place over an existing database without duplicating anything', () => {
    // ⚠️ THE REGRESSION GUARD FOR THE IN-PLACE DESIGN. The first implementation built a temp file
    // and renamed it over the target, which fails on Windows with EPERM once anything holds the
    // target open -- and Metabase does, as a live data source. The rebuild now drops and recreates
    // every object inside one transaction on the existing file, so the failure mode moved from
    // "cannot write" to "wrote twice". A lingering view or a missed DROP would either throw or
    // silently double every count, and a doubled count reads as listening, not as a bug.
    withTempDirs(({ history, output }) => {
      seed(history);
      const options = {
        historyDbPath: history,
        outputPath: output,
        timeZone: NY,
        generatedAt: '2026-09-23T00:00:00.000Z',
      };

      const first = buildReportingDb(options);

      // Counted after the FIRST build rather than hardcoded. A literal here breaks every time a
      // caveat is added, which trains whoever hits it to bump the number — and this test is about
      // duplication, not about how many caveats there happen to be.
      const afterFirst = (() => {
        const db = new DatabaseSync(output, { readOnly: true });
        try {
          const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
          return {
            caveats: count('SELECT COUNT(*) AS n FROM report_caveat'),
            meta: count('SELECT COUNT(*) AS n FROM report_meta'),
          };
        } finally {
          db.close();
        }
      })();

      const second = buildReportingDb({ ...options, generatedAt: '2026-09-23T01:00:00.000Z' });

      assert.equal(second.rows, first.rows);
      assert.equal(second.artistRows, first.artistRows);

      const db = new DatabaseSync(output, { readOnly: true });
      try {
        const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
        assert.equal(count('SELECT COUNT(*) AS n FROM play_fact'), first.rows);
        assert.equal(count('SELECT COUNT(*) AS n FROM play_artist'), first.artistRows);
        // Caveats and meta are re-inserted every build, so a missed DROP doubles them here first
        // and loudest.
        assert.equal(count('SELECT COUNT(*) AS n FROM report_caveat'), afterFirst.caveats);
        assert.equal(count('SELECT COUNT(*) AS n FROM report_meta'), afterFirst.meta);
        assert.equal(
          count('SELECT COUNT(*) AS n FROM report_meta'),
          count('SELECT COUNT(DISTINCT key) AS n FROM report_meta'),
          'report_meta keys must stay unique across rebuilds',
        );

        // The second build's metadata won, so the file is the newer one rather than a merge.
        const generated = db
          .prepare(`SELECT value FROM report_meta WHERE key = 'generated_at'`)
          .get() as { value: string };
        assert.equal(generated.value, '2026-09-23T01:00:00.000Z');

        // journal_mode must survive a rebuild: WAL here would need a -shm the read-only container
        // mount cannot create.
        const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
        assert.equal(mode.journal_mode.toLowerCase(), 'delete');
      } finally {
        db.close();
      }
    });
  });

  it('leaves no output at all when the SOURCE cannot be opened', () => {
    withTempDirs(({ output }) => {
      assert.throws(() =>
        buildReportingDb({
          historyDbPath: join(tmpdir(), 'definitely-not-a-database-xyz.db'),
          outputPath: output,
          timeZone: NY,
          generatedAt: '2026-09-23T00:00:00.000Z',
        }),
      );
      // Nothing half-built left behind: a stale-but-valid-looking file is worse than none.
      assert.throws(() => new DatabaseSync(output, { readOnly: true }));
    });
  });
});
