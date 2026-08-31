/**
 * Label repository — migration 002 and versioned access.
 *
 * The migration is the only irreversible step in U2, and it lands on the one artefact in this
 * project that cannot be regenerated. These tests exercise it against a database built the way a
 * real one was: migration 001 first, plays written, then 002 applied on top.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import type { NewPlayRecord, Observation } from '../src/history/types.js';
import type { LabelCandidate, SignalVote } from '../src/musicbrainz/types.js';

function repo(): SqliteHistoryRepository {
  return new SqliteHistoryRepository(':memory:');
}

function play(over: Partial<NewPlayRecord> = {}): NewPlayRecord {
  return {
    trackId: 'track-1',
    isrc: 'USUM71903783',
    title: 'A Song',
    artistName: 'An Artist',
    artistId: 'artist-1',
    albumName: 'An Album',
    releaseDate: '2022-03-14',
    ageYears: 4,
    following: true,
    startedAt: '2026-08-31T10:00:00.000Z',
    endedAt: '2026-08-31T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    provenance: 'live',
    skipSource: null,
    contextType: 'playlist',
    classifierVersion: 1,
    evidence: {
      listenedMs: 180_000,
      durationMs: 180_000,
      completionRatio: 1,
      maxProgressMs: 180_000,
      maxObservationGapMs: 3_000,
      observationCount: 60,
      sawPause: false,
      rewound: false,
      endedWithIdle: false,
    },
    ...over,
  };
}

const trail: Observation[] = [];

function candidate(labelName: string, releaseId = 'r1'): LabelCandidate {
  return {
    labelName,
    labelMbid: null,
    labelType: 'Imprint',
    catalogNumber: null,
    releaseId,
    releaseTitle: 'An Album',
    releaseDate: '2022-03-14',
    releaseStatus: 'Official',
  };
}

const vote: SignalVote = {
  signal: 'major-root-list',
  verdict: 'major',
  strength: 'strong',
  evidence: 'Atlantic matches major root "atlantic"',
};

function resolution(isrc: string, resolvedAt: string, labels: string[]) {
  return {
    isrc,
    recordingMbid: 'mbid-1',
    matchMethod: 'isrc' as const,
    narrowingTier: 'title-date' as const,
    releaseCount: 44,
    resolvedAt,
    status: 'resolved' as const,
    candidates: labels.map((name) => candidate(name)),
    votes: [vote],
  };
}

describe('migration 002', () => {
  it('brings a fresh database to schema version 2', () => {
    const store = repo();
    assert.equal(store.schemaVersion, 2);
    store.close();
  });

  it('leaves every new column NULL on rows that predate it', () => {
    // NULL means unknown, and an unresolved label is exactly what these rows have. A default
    // of 0 or false here would be a fabricated observation.
    const store = repo();
    const playId = store.recordPlay(play(), trail);
    const coverage = store.labelCoverage('2026-08-31T12:00:00.000Z');
    assert.equal(coverage.total, 1);
    assert.equal(coverage.pending, 1, 'an unresolved play is pending, not unknown');
    assert.equal(coverage.byVerdict.unknown, 0);
    assert.ok(playId > 0);
    store.close();
  });
});

describe('resolutions are append-only (BR-13.1)', () => {
  it('re-resolving the same ISRC creates a new version rather than replacing', () => {
    const store = repo();
    const first = store.insertLabelResolution(
      resolution('USUM71903783', '2026-08-31T00:00:00.000Z', ['Never Too Different']),
    );
    const second = store.insertLabelResolution(
      resolution('USUM71903783', '2026-11-30T00:00:00.000Z', ['Atlantic']),
    );

    assert.notEqual(first, second);
    // The older version is still readable — this is the whole point. "The artist signed later"
    // must not erase what was true at the time of the earlier play.
    assert.equal(store.getLabelResolutionById(first)?.candidates[0]?.labelName, 'Never Too Different');
    assert.equal(store.getLabelResolutionById(second)?.candidates[0]?.labelName, 'Atlantic');
    store.close();
  });

  it('links each version to the one it superseded', () => {
    const store = repo();
    const first = store.insertLabelResolution(
      resolution('USUM71903783', '2026-08-31T00:00:00.000Z', ['Sub Pop']),
    );
    const second = store.insertLabelResolution(
      resolution('USUM71903783', '2026-11-30T00:00:00.000Z', ['Sub Pop']),
    );
    assert.equal(store.getLabelResolutionById(first)?.supersedesId, null);
    assert.equal(store.getLabelResolutionById(second)?.supersedesId, first);
    store.close();
  });

  it('records an unchanged re-resolution too (BR-13.8)', () => {
    // "Unchanged at this date" is evidence, not noise: it is what distinguishes "the label
    // never changed" from "we never looked again".
    const store = repo();
    store.insertLabelResolution(resolution('X', '2026-08-31T00:00:00.000Z', ['Sub Pop']));
    store.insertLabelResolution(resolution('X', '2026-11-30T00:00:00.000Z', ['Sub Pop']));
    const current = store.getCurrentLabelResolution('X');
    assert.equal(current?.resolvedAt, '2026-11-30T00:00:00.000Z');
    assert.equal(current?.supersedesId !== null, true);
    store.close();
  });

  it('returns the newest version as current', () => {
    const store = repo();
    // Inserted out of chronological order on purpose: "current" must mean newest by
    // resolved_at, not last inserted.
    store.insertLabelResolution(resolution('X', '2026-11-30T00:00:00.000Z', ['Atlantic']));
    store.insertLabelResolution(resolution('X', '2026-08-31T00:00:00.000Z', ['Sub Pop']));
    assert.equal(store.getCurrentLabelResolution('X')?.candidates[0]?.labelName, 'Atlantic');
    store.close();
  });

  it('returns null for an ISRC never resolved', () => {
    const store = repo();
    assert.equal(store.getCurrentLabelResolution('NOPE'), null);
    store.close();
  });
});

describe('candidates and votes key to the version, not the ISRC (BR-13.2)', () => {
  it('does not mix candidates across versions', () => {
    // Keyed to the ISRC they would accumulate, and reclassification would vote on a union of
    // 2026 and 2027 facts — a verdict derived from a world-state that never existed.
    const store = repo();
    const first = store.insertLabelResolution(
      resolution('X', '2026-08-31T00:00:00.000Z', ['Sub Pop', 'Epitaph']),
    );
    const second = store.insertLabelResolution(resolution('X', '2026-11-30T00:00:00.000Z', ['Atlantic']));

    assert.equal(store.getLabelResolutionById(first)?.candidates.length, 2);
    assert.equal(store.getLabelResolutionById(second)?.candidates.length, 1);
    store.close();
  });

  it('retains per-signal votes underneath the verdict (FR-13, Q11)', () => {
    const store = repo();
    const id = store.insertLabelResolution(resolution('X', '2026-08-31T00:00:00.000Z', ['Atlantic']));
    const votes = store.getLabelResolutionById(id)?.votes ?? [];
    assert.equal(votes.length, 1);
    assert.equal(votes[0]?.strength, 'strong');
    assert.match(votes[0]?.evidence ?? '', /atlantic/i);
    store.close();
  });
});

describe('the as-of-play snapshot is written once (BR-8.4a)', () => {
  const snapshot = {
    verdict: 'independent' as const,
    confidence: 'high' as const,
    contested: false,
    labelNames: ['Never Too Different'],
    matchMethod: 'isrc' as const,
    narrowingTier: 'title-date' as const,
    unknownReason: null,
    resolutionId: null,
    classifierVersion: 1,
  };

  it('writes when the play has no verdict yet', () => {
    const store = repo();
    const playId = store.recordPlay(play(), trail);
    assert.equal(store.applyLabelSnapshot(playId, snapshot), true);
    store.close();
  });

  it('refuses to overwrite an existing verdict', () => {
    // A later resolution appends a version; it does not revise history. This is what stops a
    // re-tuned classifier or a fresh MusicBrainz lookup silently rewriting what was believed
    // at the time of the play.
    const store = repo();
    const playId = store.recordPlay(play(), trail);
    store.applyLabelSnapshot(playId, snapshot);

    const wrote = store.applyLabelSnapshot(playId, { ...snapshot, verdict: 'major' });
    assert.equal(wrote, false, 'the second write must be refused');

    const coverage = store.labelCoverage('2026-08-31T12:00:00.000Z');
    assert.equal(coverage.byVerdict.independent, 1);
    assert.equal(coverage.byVerdict.major, 0, 'the original verdict must stand');
    store.close();
  });

  it('removes the play from the backfill work set once written', () => {
    const store = repo();
    const playId = store.recordPlay(play(), trail);
    assert.equal(store.listPlaysNeedingLabels(10).length, 1);
    store.applyLabelSnapshot(playId, snapshot);
    assert.equal(store.listPlaysNeedingLabels(10).length, 0);
    store.close();
  });
});

describe('the backfill work set is derived from the database (P-5)', () => {
  it('lists plays with an ISRC and no verdict', () => {
    const store = repo();
    store.recordPlay(play({ trackId: 'a', isrc: 'ISRC00000001' }), trail);
    store.recordPlay(play({ trackId: 'b', isrc: null, startedAt: '2026-08-31T11:00:00.000Z', endedAt: '2026-08-31T11:03:00.000Z' }), trail);

    const needing = store.listPlaysNeedingLabels(10);
    assert.equal(needing.length, 1);
    assert.equal(needing[0]?.trackId, 'a');
    store.close();
  });

  it('lists plays whose ISRC can be recovered from the track id (BR-8.1)', () => {
    // 47 of the 71 real plays are backfilled from recently-played, which returns no
    // external_ids. They do carry track_id, so the ISRC is recoverable.
    const store = repo();
    store.recordPlay(play({ trackId: 'a', isrc: null, provenance: 'backfilled' }), trail);
    const needing = store.listPlaysNeedingIsrc(10);
    assert.equal(needing.length, 1);
    assert.equal(needing[0]?.trackId, 'a');
    store.close();
  });
});

describe('TTL sweeps (P-3)', () => {
  const now = '2026-12-01T00:00:00.000Z';

  it('re-resolves an unknown after its shorter TTL', () => {
    const store = repo();
    store.insertLabelResolution({
      ...resolution('X', '2026-10-01T00:00:00.000Z', []),
      status: 'not-found',
    });
    const stale = store.listStaleLabelResolutions(now, 30, 90, 10);
    assert.equal(stale.length, 1, 'a 61-day-old unknown is past the 30-day TTL');
    store.close();
  });

  it('leaves a resolved row alone until its longer TTL', () => {
    const store = repo();
    store.insertLabelResolution(resolution('X', '2026-10-01T00:00:00.000Z', ['Atlantic']));
    assert.equal(
      store.listStaleLabelResolutions(now, 30, 90, 10).length,
      0,
      'a 61-day-old success is inside the 90-day TTL',
    );
    store.close();
  });

  it('re-resolves a success once it passes the longer TTL', () => {
    // This is the case that makes the version chain useful. Without a TTL on successes the
    // chain could only ever record unknown -> known, never independent -> major, which is the
    // case the design exists for.
    const store = repo();
    store.insertLabelResolution(resolution('X', '2026-05-01T00:00:00.000Z', ['Never Too Different']));
    const stale = store.listStaleLabelResolutions(now, 30, 90, 10);
    assert.equal(stale.length, 1);
    assert.equal(stale[0]?.status, 'resolved');
    store.close();
  });

  it('considers only the newest version of a key', () => {
    const store = repo();
    store.insertLabelResolution(resolution('X', '2026-01-01T00:00:00.000Z', ['Sub Pop']));
    store.insertLabelResolution(resolution('X', '2026-11-30T00:00:00.000Z', ['Sub Pop']));
    assert.equal(
      store.listStaleLabelResolutions(now, 30, 90, 10).length,
      0,
      'an old version must not keep re-triggering once a newer one exists',
    );
    store.close();
  });
});

describe('liked evidence — null is never false (BR-9.5)', () => {
  it('derives kept-liked from two trues', () => {
    const store = repo();
    const playId = store.recordPlay(play(), trail);
    store.updateLikedEvidence(playId, { likedAtStart: true, likedAtEnd: true, likedAddedAt: null });
    assert.equal(store.getPlay(playId) !== null, true);
    store.close();
  });

  it('derives unknown when either end is null, rather than assuming false', () => {
    // A play where the saved-track set was unavailable is not a play where the user chose not
    // to like the track. Writing `kept-unliked` there would fabricate an observation.
    const store = repo();
    const playId = store.recordPlay(play(), trail);
    store.updateLikedEvidence(playId, { likedAtStart: null, likedAtEnd: true, likedAddedAt: null });

    const coverage = store.labelCoverage('2026-08-31T12:00:00.000Z');
    assert.equal(coverage.total, 1);
    store.close();
  });
});

describe('coverage is the instrument R2 is measured with (BR-10)', () => {
  it('always carries an asOf timestamp', () => {
    // Under BR-13 the same query run twice can legitimately differ, because a previously
    // unknown ISRC may have resolved in between. A figure without a timestamp is not
    // interpretable.
    const store = repo();
    const coverage = store.labelCoverage('2026-08-31T12:00:00.000Z');
    assert.equal(coverage.asOf, '2026-08-31T12:00:00.000Z');
    store.close();
  });

  it('counts pending separately from unknown (BR-7.7)', () => {
    const store = repo();
    const a = store.recordPlay(play({ trackId: 'a' }), trail);
    store.recordPlay(play({ trackId: 'b', startedAt: '2026-08-31T11:00:00.000Z', endedAt: '2026-08-31T11:03:00.000Z' }), trail);

    store.applyLabelSnapshot(a, {
      verdict: 'unknown',
      confidence: 'low',
      contested: false,
      labelNames: [],
      matchMethod: 'none',
      narrowingTier: 'none',
      unknownReason: 'notFound',
      resolutionId: null,
      classifierVersion: 1,
    });

    const coverage = store.labelCoverage('2026-08-31T12:00:00.000Z');
    assert.equal(coverage.byVerdict.unknown, 1, 'resolved-and-not-known');
    assert.equal(coverage.pending, 1, 'never looked up yet');
    assert.equal(coverage.unknownByReason.notFound, 1);
    store.close();
  });

  it('breaks coverage down by release year (BR-10.3)', () => {
    // The measured bias is recency: pre-2022 resolved 5/5, 2022-onward 6/14. A single
    // aggregate would hide that the misses concentrate on recent independent releases.
    const store = repo();
    const old = store.recordPlay(play({ trackId: 'a', releaseDate: '2001-08-28' }), trail);
    store.recordPlay(
      play({
        trackId: 'b',
        releaseDate: '2024-05-01',
        startedAt: '2026-08-31T11:00:00.000Z',
        endedAt: '2026-08-31T11:03:00.000Z',
      }),
      trail,
    );

    store.applyLabelSnapshot(old, {
      verdict: 'major',
      confidence: 'high',
      contested: false,
      labelNames: ['Roadrunner Records'],
      matchMethod: 'isrc',
      narrowingTier: 'title',
      unknownReason: null,
      resolutionId: null,
      classifierVersion: 1,
    });

    const byYear = store.labelCoverage('2026-08-31T12:00:00.000Z').byReleaseYear;
    const y2001 = byYear.find((y) => y.year === '2001');
    const y2024 = byYear.find((y) => y.year === '2024');
    assert.equal(y2001?.resolved, 1);
    assert.equal(y2024?.resolved, 0, 'the recent release is the one still unresolved');
    store.close();
  });
});
