/**
 * Integration tests — the whole U1 pipeline, end to end.
 *
 * Unit tests prove each piece in isolation. These prove they fit together:
 *
 *   tick stream → PlayObserver → outcomeClassifier → SqliteHistoryRepository → ExportService
 *
 * The seam most worth testing this way is the one where a unit test cannot help: the observer
 * consumes the *unsuppressed* tick stream, and a design that fed it the signature-suppressed
 * `change` stream instead would still pass every unit test while silently recording sparse
 * trails and producing plausible-but-wrong verdicts.
 *
 * Playback is driven by a scripted source rather than a live account, so these run in CI. Live
 * playback verification is a separate, manual check.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { PlayObserver, type PlaybackSample } from '../src/history/PlayObserver.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { MIGRATIONS } from '../src/history/migrations.js';
import { DEFAULT_TOLERANCES } from '../src/history/outcomeClassifier.js';
import { ExportService, validateFilter, parseFormat } from '../src/export/ExportService.js';
import { UNKNOWN_TOKEN } from '../src/export/serialisers.js';

const T = DEFAULT_TOLERANCES;
const POLL = 3000;

/** Collects everything written, so an export can be asserted on as a whole. */
function collector(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

function track(id: string, durationMs: number, overrides: Partial<PlaybackSample> = {}) {
  return (progressMs: number): PlaybackSample => ({
    trackId: id,
    title: `Track ${id}`,
    artistName: `Artist ${id}`,
    albumName: `Album ${id}`,
    progressMs,
    durationMs,
    isPlaying: true,
    isrc: `ISRC${id}`,
    artistId: `artist-${id}`,
    releaseDate: '2020-01-01',
    ageYears: 6,
    following: true,
    contextType: 'playlist',
    ...overrides,
  });
}

/** Play a track from `fromMs` to `toMs` at the poll interval. Returns the wall clock reached. */
function play(
  observer: PlayObserver,
  make: (progressMs: number) => PlaybackSample,
  fromMs: number,
  toMs: number,
  atMs: number,
): number {
  let clock = atMs;
  for (let progress = fromMs; progress <= toMs; progress += POLL) {
    observer.observe(make(progress), clock);
    clock += POLL;
  }
  return clock;
}

describe('a listening session end to end', () => {
  it('records completions, skips and interruptions in one session', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);
    let clock = 1_700_000_000_000;

    // 1. A four-minute track played through — completed.
    clock = play(observer, track('aaa', 240_000), 0, 237_000, clock);

    // 2. Abandoned after 20 s of a four-minute track — skipped, because the next track starts.
    clock = play(observer, track('bbb', 240_000), 0, 21_000, clock);

    // 3. Paused a minute in and never resumed — unknown, not skipped.
    clock = play(observer, track('ccc', 240_000), 0, 60_000, clock);
    observer.observe({ ...track('ccc', 240_000)(60_000), isPlaying: false }, clock);
    clock += POLL;
    observer.observe(null, clock); // device idle

    const plays = [...repo.listPlays()];
    assert.equal(plays.length, 3);

    const [first, second, third] = plays;
    assert.equal(first!.trackId, 'aaa');
    assert.equal(first!.outcome, 'completed');

    assert.equal(second!.trackId, 'bbb');
    assert.equal(second!.outcome, 'skipped');
    assert.equal(second!.skipSource, 'user', 'US-13: attributed from the first play');

    assert.equal(third!.trackId, 'ccc');
    assert.equal(third!.outcome, 'unknown', 'walking away is not a rejection');
    assert.equal(third!.evidence.sawPause, true);

    repo.close();
  });

  it('the full trail is retained, so verdicts can be recomputed (FR-20)', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    let clock = play(observer, track('ddd', 240_000), 0, 60_000, 1_700_000_000_000);
    observer.observe(null, clock);

    const playRecord = [...repo.listPlays()][0]!;
    const trail = repo.getTrail(playRecord.id);

    assert.equal(trail.length, playRecord.evidence.observationCount);
    assert.ok(trail.length > 15, 'a sparse trail would mean the observer consumed the wrong stream');
    repo.close();
  });

  it('a change-suppressed stream would record a completed track as SKIPPED', () => {
    // Models the defect precisely rather than approximately.
    //
    // `signature()` covers trackId, isPlaying, device, volume, shuffle, repeat and whether
    // enrichment has landed — deliberately NOT progress. So a track played start to finish with
    // no other state change emits `change` essentially once, at the start. The observer's last
    // sample for that track would sit near progress 0.
    const full = new SqliteHistoryRepository(':memory:');
    const sparse = new SqliteHistoryRepository(':memory:');
    const fullObserver = new PlayObserver(full, T);
    const sparseObserver = new PlayObserver(sparse, T);

    const make = track('eee', 120_000);
    const start = 1_700_000_000_000;

    // Full tick stream: every poll through to the end.
    let clock = start;
    for (let progress = 0; progress <= 117_000; progress += POLL) {
      fullObserver.observe(make(progress), clock);
      clock += POLL;
    }
    fullObserver.observe(null, clock);

    // Change-suppressed stream: one sample at track start, then the next state change — the
    // track ending. Same listening; almost none of it observed.
    sparseObserver.observe(make(0), start);
    sparseObserver.observe(null, clock);

    const fullPlay = [...full.listPlays()][0]!;
    const sparsePlay = [...sparse.listPlays()][0]!;

    assert.equal(fullPlay.outcome, 'completed', 'the track was played in full');
    assert.equal(
      sparsePlay.outcome,
      'unknown',
      'the same listening, sampled on `change`, loses the completion entirely',
    );
    assert.ok(
      sparsePlay.evidence.listenedMs < fullPlay.evidence.listenedMs / 10,
      'the sparse trail sees almost none of the listening',
    );

    full.close();
    sparse.close();
  });
});

describe('recording through to export', () => {
  it('exports what was recorded, with unknown values visible', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    let clock = play(observer, track('fff', 240_000), 0, 237_000, 1_700_000_000_000);
    // A track with no enrichment yet — the fields that will be unknown in the export.
    clock = play(
      observer,
      track('ggg', 240_000, { isrc: null, following: null, ageYears: null }),
      0,
      21_000,
      clock,
    );
    observer.observe(null, clock);

    const { stream, text } = collector();
    const rows = await new ExportService(repo).writeTo(stream, { format: 'csv' });
    assert.equal(rows, 2);

    const output = text();
    assert.match(output, /# total_plays: 2/);
    assert.match(output, /# unknown_isrc: 1/);
    assert.match(output, /ISRCfff/);
    assert.ok(
      output.includes(`,${UNKNOWN_TOKEN},`),
      'unknown must be visible in the output, not an empty cell',
    );
    repo.close();
  });

  it('incremental export returns only newer plays (FR-52)', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    // Two sessions a day apart.
    const day1 = Date.parse('2026-08-01T10:00:00.000Z');
    let clock = play(observer, track('old', 120_000), 0, 117_000, day1);
    observer.observe(null, clock);

    const day2 = Date.parse('2026-08-02T10:00:00.000Z');
    clock = play(observer, track('new', 120_000), 0, 117_000, day2);
    observer.observe(null, clock);

    const filter = validateFilter({ since: '2026-08-02T00:00:00.000Z' });
    const { stream, text } = collector();
    const rows = await new ExportService(repo).writeTo(stream, {
      format: parseFormat('csv'),
      filter,
    });

    assert.equal(rows, 1);
    assert.match(text(), /Track new/);
    assert.ok(!text().includes('Track old'));
    repo.close();
  });

  it('JSON export is valid JSON containing coverage and plays', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    const clock = play(observer, track('hhh', 120_000), 0, 117_000, 1_700_000_000_000);
    observer.observe(null, clock);

    const { stream, text } = collector();
    await new ExportService(repo).writeTo(stream, { format: 'json' });

    const parsed = JSON.parse(text()) as {
      coverage: { totalPlays: number };
      plays: { track_id: string }[];
      exported_count: number;
    };
    assert.equal(parsed.coverage.totalPlays, 1);
    assert.equal(parsed.plays.length, 1);
    assert.equal(parsed.plays[0]!.track_id, 'hhh');
    assert.equal(parsed.exported_count, 1);
    repo.close();
  });

  it('an empty history exports a well-formed file rather than failing', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const { stream, text } = collector();
    const rows = await new ExportService(repo).writeTo(stream, { format: 'json' });

    assert.equal(rows, 0);
    const parsed = JSON.parse(text()) as { plays: unknown[] };
    assert.deepEqual(parsed.plays, []);
    repo.close();
  });
});

describe('restart behaviour', () => {
  it('history survives a repository being closed and reopened', () => {
    // Uses a temp file rather than :memory:, since the point is persistence across connections.
    const path = `${process.env.TEMP ?? '/tmp'}/u1-restart-${Date.now()}.db`;

    const first = new SqliteHistoryRepository(path);
    const observer = new PlayObserver(first, T);
    const clock = play(observer, track('iii', 120_000), 0, 117_000, 1_700_000_000_000);
    observer.observe(null, clock);
    first.close();

    const second = new SqliteHistoryRepository(path);
    assert.equal(second.schemaVersion, MIGRATIONS[MIGRATIONS.length - 1]!.version);
    assert.equal(second.migrationReport.applied.length, 0, 'migration must not re-run');
    assert.equal([...second.listPlays()].length, 1, 'history must survive a restart (NFR-11)');
    second.close();
  });

  it('the in-progress play is flushed on shutdown, not lost', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    play(observer, track('jjj', 240_000), 0, 30_000, 1_700_000_000_000);
    assert.equal([...repo.listPlays()].length, 0, 'still in progress');

    observer.flush();

    const plays = [...repo.listPlays()];
    assert.equal(plays.length, 1);
    assert.equal(plays[0]!.outcome, 'unknown');
    assert.equal(plays[0]!.closeReason, 'app-shutdown');
    repo.close();
  });
});
