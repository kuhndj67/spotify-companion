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
        const critical = db
          .prepare(`SELECT topic FROM report_caveat WHERE severity = 'critical' ORDER BY topic`)
          .all() as { topic: string }[];
        // These three are the ones that produce a confident wrong answer rather than an error.
        assert.equal(critical.length, 3, critical.map((row) => row.topic).join(' | '));

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

  it('refuses to publish a partial database if the build fails', () => {
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
