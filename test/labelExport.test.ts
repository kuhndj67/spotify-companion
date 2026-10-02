/**
 * Label fields in exports (FR-50, FR-51, BR-7.7, BR-13.7).
 *
 * The export is where the dataset leaves the app, so the distinctions the design worked to
 * preserve have to survive here or they were never preserved at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CSV_COLUMNS,
  PENDING_TOKEN,
  UNKNOWN_TOKEN,
  toCsvHeader,
  toCsvRow,
  toJsonObject,
} from '../src/export/serialisers.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import type { LabelFields, NewPlayRecord, PlayRecord } from '../src/history/types.js';

function play(over: Partial<PlayRecord> = {}): PlayRecord {
  return {
    id: 1,
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
    contextUri: null,
    explicit: null,
    albumType: null,
    successorLagMs: null,
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

function labels(over: Partial<LabelFields> = {}): LabelFields {
  return {
    verdict: null,
    confidence: null,
    contested: null,
    names: null,
    matchMethod: null,
    narrowingTier: null,
    unknownReason: null,
    resolutionId: null,
    classifierVersion: null,
    artistResolutionId: null,
    likedAtStart: null,
    likedAtEnd: null,
    likedAddedAt: null,
    likedTransition: null,
    artistGenres: null,
    ...over,
  };
}

function csvCell(row: string, column: string): string {
  const index = (CSV_COLUMNS as readonly string[]).indexOf(column);
  assert.ok(index >= 0, `unknown column ${column}`);
  // The generated rows here contain no embedded commas, so a plain split is sufficient and
  // keeps the test from re-implementing a CSV parser.
  return row.split(',')[index] ?? '';
}

describe('pending is not unknown (BR-7.7)', () => {
  it('exports a never-resolved play as pending', () => {
    // A lookup that has not happened and a lookup that came back empty are different facts.
    // Counting in-flight rows as absent data would corrupt the coverage metric R2 is measured
    // with, and an analysis dropping `unknown` rows would drop them for the wrong reason.
    const row = toCsvRow(play({ label: labels() }));
    assert.equal(csvCell(row, 'label_verdict'), PENDING_TOKEN);
  });

  it('exports a resolved-but-not-known play as unknown', () => {
    const row = toCsvRow(
      play({ label: labels({ verdict: 'unknown', unknownReason: 'notFound' }) }),
    );
    assert.equal(csvCell(row, 'label_verdict'), UNKNOWN_TOKEN);
    assert.equal(csvCell(row, 'label_unknown_reason'), 'notFound');
  });

  it('keeps the two distinguishable in JSON too', () => {
    const pending = toJsonObject(play({ label: labels() })) as Record<string, Record<string, unknown>>;
    const resolved = toJsonObject(
      play({ label: labels({ verdict: 'unknown', unknownReason: 'error' }) }),
    ) as Record<string, Record<string, unknown>>;

    assert.equal(pending.label!.verdict, PENDING_TOKEN);
    assert.equal(resolved.label!.verdict, UNKNOWN_TOKEN);
    // `error` and `notFound` say opposite things about coverage: one is a fact about
    // MusicBrainz's catalogue, the other about the network on a Tuesday.
    assert.equal(resolved.label!.unknown_reason, 'error');
  });
});

describe('one label verdict is exported, and it is the release-level one (BR-13.7)', () => {
  it('exports the label the track was released under', () => {
    const row = toCsvRow(
      play({ label: labels({ verdict: 'independent', names: ['Never Too Different'] }) }),
    );

    assert.equal(csvCell(row, 'label_verdict'), 'independent');
    assert.equal(csvCell(row, 'label_names'), 'Never Too Different');
  });

  /**
   * ⚠️ Pins the removal, because a re-added artist-level verdict would be a regression rather
   * than a feature. It was classified over `browse /release?artist=`, which counts releases the
   * artist only features on: Bad Bunny returned 92 lead releases against 109 guest spots, and
   * 49 of 64 label names came only from other people's deals. An analysis reading a column
   * called `artist_label_verdict` would be reading who its guests are signed to.
   */
  it('exports no artist-level label verdict at all', () => {
    const header = toCsvHeader();
    assert.ok(!header.includes('artist_label_verdict'), header);
    assert.ok(!header.includes('artist_label_names'), header);
    assert.ok(!header.includes('artist_label_confidence'), header);
  });

  it('carries the resolution ids so a reader can see which version produced what', () => {
    const row = toCsvRow(
      play({ label: labels({ verdict: 'major', resolutionId: 7, artistResolutionId: 9 }) }),
    );
    assert.equal(csvCell(row, 'label_resolution_id'), '7');
    assert.equal(csvCell(row, 'artist_resolution_id'), '9');
  });
});

describe('null is never false in exports', () => {
  it('renders an unknown liked status as the token, not as false', () => {
    // A play where the saved-track set was unavailable is not a play where the user chose not
    // to like the track.
    const row = toCsvRow(play({ label: labels({ likedAtStart: null, likedAtEnd: null }) }));
    assert.equal(csvCell(row, 'liked_at_start'), UNKNOWN_TOKEN);
    assert.equal(csvCell(row, 'liked_at_end'), UNKNOWN_TOKEN);
  });

  it('renders an observed false as false', () => {
    const row = toCsvRow(
      play({ label: labels({ likedAtStart: false, likedAtEnd: false, likedTransition: 'kept-unliked' }) }),
    );
    assert.equal(csvCell(row, 'liked_at_start'), 'false');
    assert.equal(csvCell(row, 'liked_transition'), 'kept-unliked');
  });

  it('renders an empty label list as unknown rather than as an empty cell', () => {
    // A blank cell disappears into a spreadsheet; the token does not. Missing data here is
    // correlated with the variable being measured (R2).
    const row = toCsvRow(play({ label: labels({ verdict: 'unknown', names: [] }) }));
    assert.equal(csvCell(row, 'label_names'), UNKNOWN_TOKEN);
  });
});

describe('the header and row stay in step', () => {
  it('emits exactly as many cells as there are columns', () => {
    const row = toCsvRow(play({ label: labels({ verdict: 'major', names: ['Atlantic'] }) }));
    assert.equal(row.split(',').length, CSV_COLUMNS.length);
    assert.equal(toCsvHeader().split(',').length, CSV_COLUMNS.length);
  });

  it('joins multiple label names into one cell', () => {
    const row = toCsvRow(play({ label: labels({ verdict: 'major', names: ['Epic', 'Interscope'] }) }));
    assert.equal(csvCell(row, 'label_names'), 'Epic; Interscope');
  });
});

describe('round-trip through the database', () => {
  it('reads back what was written, including the pending distinction', () => {
    const store = new SqliteHistoryRepository(':memory:');
    const record: NewPlayRecord = { ...play(), evidence: play().evidence } as NewPlayRecord;
    const playId = store.recordPlay(record, []);

    const before = store.getPlay(playId);
    assert.equal(before?.label?.verdict, null, 'a fresh play has no verdict — it is pending');

    const resolutionId = store.insertLabelResolution({
      isrc: 'USUM71903783',
      recordingMbid: 'mbid-1',
      matchMethod: 'isrc',
      narrowingTier: 'title-date',
      releaseCount: 44,
      resolvedAt: '2026-08-31T00:00:00.000Z',
      status: 'resolved',
      candidates: [],
      votes: [],
    });

    store.applyLabelSnapshot(playId, {
      verdict: 'major',
      confidence: 'high',
      contested: true,
      labelNames: ['Epic', 'Interscope'],
      matchMethod: 'isrc',
      narrowingTier: 'title-date',
      unknownReason: null,
      resolutionId,
      classifierVersion: 1,
    });

    const after = store.getPlay(playId);
    assert.equal(after?.label?.verdict, 'major');
    assert.equal(after?.label?.contested, true);
    assert.deepEqual(after?.label?.names, ['Epic', 'Interscope']);
    assert.equal(after?.label?.resolutionId, resolutionId);
    store.close();
  });

  it('refuses a snapshot pointing at a resolution that does not exist', () => {
    // The pointer is a real foreign key, so a play can never claim to have been derived from a
    // version that was never written. Without the constraint the trace would look up a missing
    // id and silently fall back to "no resolution" — a plausible wrong answer rather than a
    // loud one, which is the shape this project keeps being caught by.
    const store = new SqliteHistoryRepository(':memory:');
    const playId = store.recordPlay(play() as NewPlayRecord, []);

    assert.throws(() =>
      store.applyLabelSnapshot(playId, {
        verdict: 'major',
        confidence: 'high',
        contested: false,
        labelNames: ['Epic'],
        matchMethod: 'isrc',
        narrowingTier: 'title-date',
        unknownReason: null,
        resolutionId: 9999,
        classifierVersion: 1,
      }),
    );
    store.close();
  });

  it('survives a label name containing a comma', () => {
    // Names are stored as JSON precisely so this round-trips; a delimiter-joined column would
    // silently split the name and produce a plausible-looking wrong label list.
    const store = new SqliteHistoryRepository(':memory:');
    const playId = store.recordPlay(play() as NewPlayRecord, []);

    store.applyLabelSnapshot(playId, {
      verdict: 'independent',
      confidence: 'high',
      contested: false,
      labelNames: ['Smith, Jones & Co', 'Sub Pop'],
      matchMethod: 'isrc',
      narrowingTier: 'title',
      unknownReason: null,
      resolutionId: null,
      classifierVersion: 1,
    });

    assert.deepEqual(store.getPlay(playId)?.label?.names, ['Smith, Jones & Co', 'Sub Pop']);
    store.close();
  });

  it('derives the liked transition rather than storing a second copy of it', () => {
    const store = new SqliteHistoryRepository(':memory:');
    const playId = store.recordPlay(play() as NewPlayRecord, []);

    store.updateLikedEvidence(playId, {
      likedAtStart: false,
      likedAtEnd: true,
      likedAddedAt: '2026-08-31T10:03:10.000Z',
    });

    const after = store.getPlay(playId);
    assert.equal(after?.label?.likedTransition, 'liked-during');
    assert.equal(after?.label?.likedAddedAt, '2026-08-31T10:03:10.000Z');
    store.close();
  });

  it('derives unknown when either end is null', () => {
    const store = new SqliteHistoryRepository(':memory:');
    const playId = store.recordPlay(play() as NewPlayRecord, []);

    store.updateLikedEvidence(playId, {
      likedAtStart: null,
      likedAtEnd: true,
      likedAddedAt: null,
    });

    assert.equal(store.getPlay(playId)?.label?.likedTransition, 'unknown');
    store.close();
  });
});
