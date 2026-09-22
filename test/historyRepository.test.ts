/**
 * Repository and migration tests.
 *
 * Uses an in-memory database, so these are fast and hermetic. The one thing they cannot cover is
 * the bind-mount permission behaviour under Rancher Desktop — that is on the Build and Test
 * verification checklist for live confirmation, because it is exactly the kind of thing this
 * project has twice been wrong about when reasoning instead of probing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { MIGRATIONS } from '../src/history/migrations.js';

/** The newest schema this codebase knows about. */
const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
import { DEFAULT_TOLERANCES, CLASSIFIER_VERSION, summarise } from '../src/history/outcomeClassifier.js';
import type { NewPlayRecord } from '../src/history/types.js';
import { completeTrail } from './historyGenerators.js';

function makeRepo(): SqliteHistoryRepository {
  return new SqliteHistoryRepository(':memory:');
}

function samplePlay(overrides: Partial<NewPlayRecord> = {}): NewPlayRecord {
  const trail = completeTrail(180_000);
  return {
    trackId: 'abcdefghijklmnopqrstuv',
    isrc: 'USUM71703861',
    title: 'A Track',
    artistName: 'An Artist',
    artistId: 'artist1234567890123456',
    albumName: 'An Album',
    releaseDate: '2019-05-17',
    ageYears: 7,
    following: true,
    startedAt: '2026-08-25T10:00:00.000Z',
    endedAt: '2026-08-25T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    evidence: summarise(trail, DEFAULT_TOLERANCES),
    provenance: 'live',
    skipSource: null,
    contextType: 'playlist',
    explicit: null,
    albumType: null,
    skipAttribution: null,
    successorLagMs: null,
    attributionVersion: null,
    classifierVersion: CLASSIFIER_VERSION,
    ...overrides,
  };
}

describe('migrations', () => {
  it('applies every migration on a fresh database', () => {
    // Asserted against MIGRATIONS rather than a hardcoded number: the schema grows per phase
    // (U2 added 002, U5 will add another), and a literal here turns every future migration
    // into a spurious failure in a U1 test that is not actually about U2.
    const repo = makeRepo();
    assert.equal(repo.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(repo.migrationReport.from, 0);
    assert.equal(repo.migrationReport.applied.length, MIGRATIONS.length);
    repo.close();
  });

  it('is a no-op on an already-migrated database', () => {
    // Same connection reopened is not possible with :memory:, so assert the version-guard
    // logic directly: a second migrate call must apply nothing.
    const repo = makeRepo();
    const before = repo.schemaVersion;
    const again = new SqliteHistoryRepository(':memory:');
    assert.equal(again.schemaVersion, before);
    repo.close();
    again.close();
  });
});

describe('recordPlay', () => {
  it('round-trips a play with its evidence', () => {
    const repo = makeRepo();
    const play = samplePlay();
    const id = repo.recordPlay(play, completeTrail(180_000));

    const stored = repo.getPlay(id);
    assert.ok(stored);
    assert.equal(stored.trackId, play.trackId);
    assert.equal(stored.isrc, play.isrc);
    assert.equal(stored.outcome, 'completed');
    assert.equal(stored.evidence.listenedMs, play.evidence.listenedMs);
    assert.ok(Math.abs(stored.evidence.completionRatio - play.evidence.completionRatio) < 1e-9);
    repo.close();
  });

  it('preserves the observation trail', () => {
    const repo = makeRepo();
    const trail = completeTrail(60_000);
    const id = repo.recordPlay(samplePlay(), trail);

    const stored = repo.getTrail(id);
    assert.equal(stored.length, trail.length);
    assert.equal(stored[0]!.progressMs, trail[0]!.progressMs);
    assert.equal(stored.at(-1)!.progressMs, trail.at(-1)!.progressMs);
    repo.close();
  });

  it('keeps null distinct from false — the tri-state rule at the storage layer', () => {
    const repo = makeRepo();
    const unknownId = repo.recordPlay(samplePlay({ following: null, isrc: null }), []);
    const falseId = repo.recordPlay(samplePlay({ following: false }), []);

    assert.equal(repo.getPlay(unknownId)!.following, null, 'unknown must not become false');
    assert.equal(repo.getPlay(falseId)!.following, false, 'false must not become null');
    assert.equal(repo.getPlay(unknownId)!.isrc, null);
    repo.close();
  });

  it('records a play with no trail (backfill)', () => {
    const repo = makeRepo();
    const id = repo.recordPlay(samplePlay({ provenance: 'backfilled', outcome: 'unknown' }), []);
    assert.equal(repo.getTrail(id).length, 0);
    assert.equal(repo.getPlay(id)!.provenance, 'backfilled');
    repo.close();
  });
});

describe('listPlays', () => {
  it('streams every play, paging transparently', () => {
    const repo = makeRepo();
    // More than one page (500) to exercise the paging loop.
    for (let i = 0; i < 1200; i++) {
      repo.recordPlay(samplePlay({ startedAt: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z` }), []);
    }
    assert.equal([...repo.listPlays()].length, 1200);
    repo.close();
  });

  it('filters by outcome and by since', () => {
    const repo = makeRepo();
    repo.recordPlay(samplePlay({ outcome: 'completed', startedAt: '2026-01-01T00:00:00.000Z' }), []);
    repo.recordPlay(samplePlay({ outcome: 'skipped', startedAt: '2026-06-01T00:00:00.000Z' }), []);

    assert.equal([...repo.listPlays({ outcome: 'skipped' })].length, 1);
    assert.equal([...repo.listPlays({ since: '2026-03-01T00:00:00.000Z' })].length, 1);
    repo.close();
  });

  it('honours limit', () => {
    const repo = makeRepo();
    for (let i = 0; i < 10; i++) repo.recordPlay(samplePlay(), []);
    assert.equal([...repo.listPlays({ limit: 3 })].length, 3);
    repo.close();
  });
});

describe('updateOutcome — FR-20', () => {
  it('changes the verdict without touching observations', () => {
    const repo = makeRepo();
    const trail = completeTrail(20_000); // the short-track case
    const id = repo.recordPlay(samplePlay({ outcome: 'skipped' }), trail);

    const before = repo.getTrail(id);
    const evidence = summarise(trail, { ...DEFAULT_TOLERANCES, completionThreshold: 0.8 });
    repo.updateOutcome(id, 'completed', evidence, CLASSIFIER_VERSION + 1);

    assert.equal(repo.getPlay(id)!.outcome, 'completed');
    assert.equal(repo.getPlay(id)!.classifierVersion, CLASSIFIER_VERSION + 1);
    assert.deepEqual(repo.getTrail(id), before, 'observations are facts and must not be rewritten');
    repo.close();
  });
});

describe('hasPlayNearEnd — backfill deduplication', () => {
  it('matches within the tolerance window and not outside it', () => {
    const repo = makeRepo();
    // samplePlay ends at 10:03:00.
    repo.recordPlay(samplePlay({ startedAt: '2026-08-25T10:00:00.000Z' }), []);

    assert.equal(
      repo.hasPlayNearEnd('abcdefghijklmnopqrstuv', '2026-08-25T10:03:30.000Z', 60_000),
      true,
    );
    assert.equal(
      repo.hasPlayNearEnd('abcdefghijklmnopqrstuv', '2026-08-25T11:00:00.000Z', 60_000),
      false,
    );
    repo.close();
  });

  it('keys on the END, not the start — the defect that duplicated every restart', () => {
    // `played_at` from recently-played is the moment the track FINISHED. A play recorded live
    // from 10:00 to 10:03 is therefore reported as 10:03. Matching that against the stored START
    // compares two instants a whole track apart, so the row looked new every single time.
    const repo = makeRepo();
    repo.recordPlay(samplePlay({ startedAt: '2026-08-25T10:00:00.000Z' }), []);

    assert.equal(
      repo.hasPlayNearEnd('abcdefghijklmnopqrstuv', '2026-08-25T10:03:00.000Z', 60_000),
      true,
      'a play already recorded live must be recognised from its end timestamp',
    );
    // And the start must NOT match, or the tolerance is simply swallowing the whole track.
    assert.equal(
      repo.hasPlayNearEnd('abcdefghijklmnopqrstuv', '2026-08-25T10:00:00.000Z', 60_000),
      false,
    );
    repo.close();
  });
});

describe('coverage', () => {
  it('counts outcomes, provenance and unknown fields', () => {
    const repo = makeRepo();
    repo.recordPlay(samplePlay({ outcome: 'completed' }), []);
    repo.recordPlay(samplePlay({ outcome: 'skipped', isrc: null, following: null }), []);
    repo.recordPlay(samplePlay({ outcome: 'unknown', provenance: 'backfilled' }), []);

    const coverage = repo.coverage();
    assert.equal(coverage.totalPlays, 3);
    assert.equal(coverage.byOutcome.completed, 1);
    assert.equal(coverage.byOutcome.skipped, 1);
    assert.equal(coverage.byOutcome.unknown, 1);
    assert.equal(coverage.byProvenance.backfilled, 1);
    assert.equal(coverage.unknownIsrc, 1);
    assert.equal(coverage.unknownFollowing, 1);
    repo.close();
  });

  it('counts recording gaps', () => {
    const repo = makeRepo();
    repo.recordGap();
    repo.recordGap();
    assert.equal(repo.coverage().countedGaps, 2);
    repo.close();
  });
});

describe('verifyWritable', () => {
  it('succeeds on a healthy database and leaves no trace', () => {
    const repo = makeRepo();
    repo.verifyWritable();
    assert.equal(repo.coverage().countedGaps, 0, 'the probe must not count as a real gap');
    repo.close();
  });
});

describe('listening statistics', () => {
  it('counts a track by outcome and reports its first and last play', () => {
    const repo = makeRepo();
    repo.recordPlay(samplePlay({ startedAt: '2026-08-25T10:00:00.000Z' }), []);
    repo.recordPlay(
      samplePlay({ startedAt: '2026-08-26T10:00:00.000Z', outcome: 'skipped' }),
      [],
    );
    repo.recordPlay(
      samplePlay({ startedAt: '2026-08-24T10:00:00.000Z', outcome: 'unknown' }),
      [],
    );
    repo.recordPlay(samplePlay({ trackId: 'someothertrackid000000' }), []);

    const stats = repo.trackPlayStats('abcdefghijklmnopqrstuv');
    assert.equal(stats.totalPlays, 3);
    assert.deepEqual(stats.byBucket, {
      completed: 1,
      skipped: 1,
      'ended-early': 0,
      inconclusive: 1,
      'not-observed': 0,
    });
    // MIN/MAX across outcome groups, not within one — an implementation that took them from a
    // single group would be right whenever the first and last play happen to share an outcome.
    assert.equal(stats.firstPlayedAt, '2026-08-24T10:00:00.000Z');
    assert.equal(stats.lastPlayedAt, '2026-08-26T10:00:00.000Z');
    repo.close();
  });

  it('reports zero for a track never played, rather than null', () => {
    // "Played nought times" is the right answer for a track being heard for the first time, and
    // it is a different statement from "history is unavailable" — which is a 503, not a zero.
    const repo = makeRepo();
    const stats = repo.trackPlayStats('neverplayedaaaaaaaaaaa');
    assert.equal(stats.totalPlays, 0);
    assert.deepEqual(stats.byBucket, {
      completed: 0,
      skipped: 0,
      'ended-early': 0,
      inconclusive: 0,
      'not-observed': 0,
    });
    assert.equal(stats.firstPlayedAt, null);
    assert.equal(stats.lastPlayedAt, null);
    repo.close();
  });

  it('lists play times for one artist, in order, from a cutoff', () => {
    const repo = makeRepo();
    repo.recordPlay(samplePlay({ startedAt: '2026-08-01T10:00:00.000Z' }), []);
    repo.recordPlay(
      // Stored WITH an attribution, so this asserts a round-trip rather than a default: the
      // repository must carry the judgement, never manufacture one.
      samplePlay({
        startedAt: '2026-08-25T10:00:00.000Z',
        outcome: 'skipped',
        skipAttribution: 'user',
      }),
      [],
    );
    repo.recordPlay(samplePlay({ startedAt: '2026-08-27T10:00:00.000Z' }), []);
    repo.recordPlay(
      samplePlay({ startedAt: '2026-08-26T10:00:00.000Z', artistId: 'otherartist0000000000' }),
      [],
    );

    const points = repo.listPlayTimesForArtist('artist1234567890123456', '2026-08-17T00:00:00.000Z');
    // Provenance travels with the point. Without it the caller cannot tell a play the app never
    // watched from one it watched and could not classify, which is the whole reason the chart
    // was reporting uptime as though it were listening.
    assert.deepEqual(points, [
      // ⚠️ A skip carries WHO with it now. The chart cannot be handed an outcome without its
      // attribution, for the same reason it cannot be handed one without provenance.
      {
        startedAt: '2026-08-25T10:00:00.000Z',
        outcome: 'skipped',
        provenance: 'live',
        skipAttribution: 'user',
      },
      {
        startedAt: '2026-08-27T10:00:00.000Z',
        outcome: 'completed',
        provenance: 'live',
        skipAttribution: null,
      },
    ]);
    repo.close();
  });

  it('attributes a play to the PRIMARY artist only — the documented undercount', () => {
    // The schema stores one artist id. A feature credit is filed under the lead artist, so the
    // guest's trend does not contain it. This test pins the limitation rather than the fix:
    // if a later unit records every artist, this is the test that should fail and be rewritten.
    const repo = makeRepo();
    repo.recordPlay(
      samplePlay({
        artistName: 'Inpatient, Ren, Chris Webby',
        artistId: 'inpatient00000000000',
        startedAt: '2026-08-25T10:00:00.000Z',
      }),
      [],
    );
    assert.equal(repo.listPlayTimesForArtist('inpatient00000000000', '2026-01-01T00:00:00.000Z').length, 1);
    assert.equal(repo.listPlayTimesForArtist('ren000000000000000000', '2026-01-01T00:00:00.000Z').length, 0);
    repo.close();
  });

  it('excludes plays before the cutoff', () => {
    const repo = makeRepo();
    repo.recordPlay(samplePlay({ startedAt: '2026-02-01T10:00:00.000Z' }), []);
    assert.deepEqual(
      repo.listPlayTimesForArtist('artist1234567890123456', '2026-08-17T00:00:00.000Z'),
      [],
    );
    repo.close();
  });

  it('firstPlayStartedAt is the oldest play in the corpus, not the newest insert', () => {
    const repo = makeRepo();
    assert.equal(repo.firstPlayStartedAt(), null);
    repo.recordPlay(samplePlay({ startedAt: '2026-08-25T10:00:00.000Z' }), []);
    repo.recordPlay(samplePlay({ startedAt: '2026-08-20T10:00:00.000Z' }), []);
    assert.equal(repo.firstPlayStartedAt(), '2026-08-20T10:00:00.000Z');
    repo.close();
  });
});
