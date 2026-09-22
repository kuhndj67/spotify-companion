/**
 * `historyCountsBefore` — LC-22, BR-27.2/27.3/27.7.
 *
 * ## ⚠️ Why this file carries a property test rather than only examples
 *
 * Point-in-time counting has **no observable failure mode**. An as-of-now implementation
 * produces entirely plausible numbers today and diverges only across months, as the corpus grows
 * underneath a range that has not changed. **Fixture history does not grow**, so no example test
 * separates the two: they agree on every fixture, for ever.
 *
 * PBT-22 makes the divergence immediate — insert plays dated *after* a range and the answer must
 * not move. ⚠️ **PBT-22a is the other half**: PBT-22 passes perfectly against an implementation
 * that returns zero for everything, so the positive control proves the counter is wired to
 * anything at all. Neither test is meaningful alone.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';

import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import type { NewPlayRecord, PlayOutcome } from '../src/history/types.js';

const TRACK = 'abcdefghijklmnopqrstuv';
const ARTIST = 'artist1234567890123456';

function play(startedAt: string, overrides: Partial<NewPlayRecord> = {}): NewPlayRecord {
  return {
    trackId: TRACK,
    isrc: null,
    title: 'A Track',
    artistName: 'An Artist',
    artistId: ARTIST,
    albumName: 'An Album',
    releaseDate: null,
    ageYears: null,
    following: null,
    explicit: null,
    albumType: null,
    skipAttribution: null,
    successorLagMs: null,
    attributionVersion: null,
    startedAt,
    endedAt: startedAt,
    outcome: 'completed',
    closeReason: 'track-change',
    provenance: 'live',
    skipSource: null,
    contextType: null,
    classifierVersion: 1,
    evidence: {
      listenedMs: 0,
      durationMs: 0,
      completionRatio: 0,
      maxProgressMs: 0,
      maxObservationGapMs: 0,
      observationCount: 1,
      sawPause: false,
      rewound: false,
      endedWithIdle: false,
    },
    ...overrides,
  };
}

const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`;

describe('historyCountsBefore', () => {
  it('counts plays and skips strictly before the instant', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    repo.recordPlay(play(at(1)), []);
    repo.recordPlay(play(at(2), { outcome: 'skipped' }), []);
    repo.recordPlay(play(at(3)), []);

    const counts = repo.historyCountsBefore(TRACK, ARTIST, at(3));

    assert.equal(counts.playsOfTrack, 2);
    assert.equal(counts.skipsOfTrack, 1);
  });

  /**
   * ⚠️ BR-27.3. A window including the current row makes every play count itself, so
   * `history.playsOfTrack >= 1` becomes true for every row in existence — a rule that looks
   * like it is working and is matching nothing but its own arithmetic.
   */
  it('EXCLUDES a play at exactly the boundary instant', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    repo.recordPlay(play(at(5)), []);

    const counts = repo.historyCountsBefore(TRACK, ARTIST, at(5));

    assert.equal(counts.playsOfTrack, null, 'the row must not count itself');
  });

  /**
   * ⚠️ `null` is unknown and is never `0` (US-16's stated failure mode): a zero here makes
   * "never skipped this track" silently true for a track never heard.
   */
  it('reports null, not zero, for a track with no history', () => {
    const repo = new SqliteHistoryRepository(':memory:');

    const counts = repo.historyCountsBefore(TRACK, ARTIST, at(9));

    assert.equal(counts.playsOfTrack, null);
    assert.equal(counts.skipsOfTrack, null);
    assert.equal(counts.playsOfArtist, null);
    assert.equal(counts.skipsOfArtist, null);
  });

  /** But a track WITH history and no skips answers `0` — the data answered the question. */
  it('reports zero skips when there are prior plays and none were skipped', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    repo.recordPlay(play(at(1)), []);

    const counts = repo.historyCountsBefore(TRACK, ARTIST, at(2));

    assert.equal(counts.playsOfTrack, 1);
    assert.equal(counts.skipsOfTrack, 0, 'asked and answered is not the same as never asked');
  });

  it('cannot answer the artist counts when there is no artist id', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    repo.recordPlay(play(at(1)), []);

    const counts = repo.historyCountsBefore(TRACK, null, at(2));

    assert.equal(counts.playsOfTrack, 1);
    assert.equal(counts.playsOfArtist, null, 'no key is "cannot ask", not "artist is new"');
    assert.equal(counts.skipsOfArtist, null);
  });

  /**
   * ⚠️ The primary-artist limitation, pinned so a later unit that records every artist id
   * breaks this test rather than silently changing every historical figure.
   */
  it('counts the artist by PRIMARY id only, so a guest credit is not counted', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    // A collaboration whose lead is someone else. `artistName` carries the joined display
    // string; `artist_id` carries only artists[0].
    repo.recordPlay(
      play(at(1), { artistId: 'leadartist12345678901', artistName: 'Lead, Guest' }),
      [],
    );

    const guest = repo.historyCountsBefore(TRACK, ARTIST, at(2));

    assert.equal(
      guest.playsOfArtist,
      null,
      'the guest owns no primary id on this play, so it is absent from their totals (~24% low for Ren)',
    );
  });
});

describe('point-in-time counting (PBT-22, PBT-22a)', () => {
  /**
   * ⭐ **PBT-22** — the only thing that will ever catch an as-of-now implementation.
   */
  it('is unchanged by plays inserted AFTER the instant', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 20, max: 28 }), { minLength: 1, maxLength: 12 }),
        (before, after) => {
          const repo = new SqliteHistoryRepository(':memory:');
          for (const d of before) repo.recordPlay(play(at(d)), []);

          const first = repo.historyCountsBefore(TRACK, ARTIST, at(10));
          for (const d of after) repo.recordPlay(play(at(d)), []);
          const second = repo.historyCountsBefore(TRACK, ARTIST, at(10));

          assert.deepEqual(second, first);
        },
      ),
      { numRuns: 60 },
    );
  });

  /**
   * ⭐ **PBT-22a — the positive control.** Without it, a `historyCountsBefore` that returned
   * zero (or null) for every input would satisfy PBT-22 perfectly and prove nothing.
   */
  it('DOES change when a play is inserted before the instant', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 10, max: 19 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 9 }),
        (existing, earlier) => {
          const repo = new SqliteHistoryRepository(':memory:');
          for (const d of existing) repo.recordPlay(play(at(d)), []);

          const before = repo.historyCountsBefore(TRACK, ARTIST, at(20));
          repo.recordPlay(play(at(earlier)), []);
          const after = repo.historyCountsBefore(TRACK, ARTIST, at(20));

          assert.equal(after.playsOfTrack, (before.playsOfTrack ?? 0) + 1);
        },
      ),
      { numRuns: 60 },
    );
  });

  /** NFR-26: the same query over unchanged history is identical on repeated runs. */
  it('is deterministic across repeated calls', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    for (const d of [1, 2, 3, 4]) {
      repo.recordPlay(play(at(d), { outcome: (d % 2 ? 'completed' : 'skipped') as PlayOutcome }), []);
    }

    const a = repo.historyCountsBefore(TRACK, ARTIST, at(9));
    const b = repo.historyCountsBefore(TRACK, ARTIST, at(9));

    assert.deepEqual(b, a);
  });
});

describe('v5Watermark', () => {
  it('is 0 on a database migrated while empty — every row is post-v5', () => {
    const repo = new SqliteHistoryRepository(':memory:');

    assert.equal(repo.v5Watermark(), 0);
  });

  it('puts rows written after the migration above it', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const watermark = repo.v5Watermark()!;

    const id = repo.recordPlay(play(at(1)), []);

    assert.ok(id > watermark);
  });
});
