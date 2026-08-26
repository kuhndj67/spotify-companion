/**
 * Play segmentation tests (BR-1, BR-3).
 *
 * The observer decides *where a play ends*; the classifier decides what it meant. These tests
 * cover the boundary decisions and the failure behaviour, not the verdicts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlayObserver, type PlaybackSample } from '../src/history/PlayObserver.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import type { HistoryRepository } from '../src/history/HistoryRepository.js';
import { DEFAULT_TOLERANCES } from '../src/history/outcomeClassifier.js';
import type { NewPlayRecord, Observation } from '../src/history/types.js';

const T = DEFAULT_TOLERANCES;

function sample(overrides: Partial<PlaybackSample> = {}): PlaybackSample {
  return {
    trackId: 'track1',
    title: 'Song',
    artistName: 'Artist',
    albumName: 'Album',
    progressMs: 0,
    durationMs: 240_000,
    isPlaying: true,
    isrc: 'USUM71703861',
    artistId: 'artist1',
    releaseDate: '2020-01-01',
    ageYears: 6,
    following: true,
    contextType: null,
    ...overrides,
  };
}

describe('segmentation', () => {
  it('a track change closes the play and opens a new one', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ trackId: 'a', progressMs: 0 }), 1000);
    observer.observe(sample({ trackId: 'a', progressMs: 3000 }), 4000);
    observer.observe(sample({ trackId: 'b', progressMs: 0 }), 7000);

    const plays = [...repo.listPlays()];
    assert.equal(plays.length, 1, 'closing "a" writes exactly one record');
    assert.equal(plays[0]!.trackId, 'a');
    repo.close();
  });

  it('nothing playing closes the play', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ progressMs: 0 }), 1000);
    observer.observe(null, 4000);

    assert.equal([...repo.listPlays()].length, 1);
    repo.close();
  });

  it('a backward jump does NOT split the play — one record, not two', () => {
    // The design deliberately has no replay-versus-rewind branch. A track heard twice in a row
    // is one record with a high ratio.
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ progressMs: 200_000 }), 1000);
    observer.observe(sample({ progressMs: 0 }), 4000); // restarted
    observer.observe(sample({ progressMs: 3000 }), 7000);
    observer.observe(null, 10_000);

    const plays = [...repo.listPlays()];
    assert.equal(plays.length, 1);
    assert.equal(plays[0]!.evidence.rewound, true, 'recorded as evidence');
    repo.close();
  });

  it('a play with no observations is never recorded', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);
    observer.observe(null, 1000);
    assert.equal([...repo.listPlays()].length, 0);
    repo.close();
  });

  it('pausing then idling records endedWithIdle and sawPause', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ progressMs: 0 }), 1000);
    observer.observe(sample({ progressMs: 3000, isPlaying: false }), 4000);
    observer.observe(null, 7000);

    const play = [...repo.listPlays()][0]!;
    assert.equal(play.evidence.sawPause, true);
    assert.equal(play.evidence.endedWithIdle, true);
    assert.equal(play.closeReason, 'pause-idle');
    repo.close();
  });
});

describe('recording', () => {
  it('records ISRC — without it, U2 label backfill is impossible', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ isrc: 'GBAYE0601498' }), 1000);
    observer.observe(null, 4000);

    assert.equal([...repo.listPlays()][0]!.isrc, 'GBAYE0601498');
    repo.close();
  });

  it('attributes a skip to the user from the very first play (US-13 split)', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ progressMs: 0, durationMs: 240_000 }), 1000);
    observer.observe(sample({ trackId: 'other' }), 4000);

    const play = [...repo.listPlays()][0]!;
    assert.equal(play.outcome, 'skipped');
    assert.equal(play.skipSource, 'user', 'unattributed history would need a later guess');
    repo.close();
  });

  it('picks up enrichment that arrives after the track started', () => {
    // The first sample of a play usually has null enrichment; it lands a moment later.
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ isrc: null, following: null }), 1000);
    observer.observe(sample({ isrc: 'USUM71703861', following: true, progressMs: 3000 }), 4000);
    observer.observe(null, 7000);

    const play = [...repo.listPlays()][0]!;
    assert.equal(play.isrc, 'USUM71703861');
    assert.equal(play.following, true);
    repo.close();
  });

  it('flush records the in-progress play as unknown rather than discarding it', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ progressMs: 0 }), 1000);
    observer.observe(sample({ progressMs: 3000 }), 4000);
    observer.flush();

    const plays = [...repo.listPlays()];
    assert.equal(plays.length, 1, 'a real listening event must not be lost');
    assert.equal(plays[0]!.outcome, 'unknown', 'and must not claim an unobserved ending');
    assert.equal(plays[0]!.closeReason, 'app-shutdown');
    repo.close();
  });
});

describe('degraded operation (BR-3.8, BR-3.9)', () => {
  /** A repository whose writes always fail. */
  function failingRepo(): { repo: HistoryRepository; gaps: () => number } {
    let gaps = 0;
    const repo: HistoryRepository = {
      recordPlay(_play: NewPlayRecord, _trail: readonly Observation[]): number {
        throw new Error('disk full');
      },
      getPlay: () => null,
      listPlays: function* () {},
      getTrail: () => [],
      updateOutcome: () => {},
      hasPlayNear: () => false,
      coverage: () => {
        throw new Error('unused');
      },
      recordGap: () => {
        gaps++;
      },
      close: () => {},
    };
    return { repo, gaps: () => gaps };
  }

  it('counts a gap instead of dropping the play silently', () => {
    const { repo, gaps } = failingRepo();
    const observer = new PlayObserver(repo, T);

    observer.observe(sample({ progressMs: 0 }), 1000);
    observer.observe(null, 4000);

    assert.equal(gaps(), 1, 'a silent drop is indistinguishable from "nothing was playing"');
    assert.equal(observer.stats.gaps, 1);
    assert.equal(observer.stats.degraded, true);
  });

  it('does not throw — the display must survive a broken database', () => {
    const { repo } = failingRepo();
    const observer = new PlayObserver(repo, T);

    assert.doesNotThrow(() => {
      observer.observe(sample({ progressMs: 0 }), 1000);
      observer.observe(null, 4000);
      observer.observe(sample({ progressMs: 0 }), 7000);
      observer.flush();
    });
  });
});

describe('trail bounding', () => {
  it('a stuck play does not grow the buffer without bound', () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const observer = new PlayObserver(repo, T);

    for (let i = 0; i < 9000; i++) {
      observer.observe(sample({ progressMs: 1000 }), 1000 + i * 3000);
    }
    observer.flush();

    const play = [...repo.listPlays()][0]!;
    assert.ok(play.evidence.observationCount < 9000, 'thinning must bound memory');
    assert.ok(play.evidence.observationCount > 0);
    repo.close();
  });
});
