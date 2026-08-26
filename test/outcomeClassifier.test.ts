/**
 * Example tests for outcome classification (BR-1, BR-2 and the documented edge cases).
 *
 * These sit alongside the property tests (PBT-10). The properties prove invariants hold for all
 * trails; these pin the specific behaviours the functional design argued for, so a change of
 * intent shows up as a named failure rather than as a shrunk counterexample.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classify, reclassify, summarise, DEFAULT_TOLERANCES } from '../src/history/outcomeClassifier.js';
import type { Observation } from '../src/history/types.js';
import { buildTrail, completeTrail, replayTrail, worstCaseTrail } from './historyGenerators.js';

const T = DEFAULT_TOLERANCES;

function verdict(trail: Observation[], closeReason: Parameters<typeof classify>[2]) {
  return reclassify(trail, closeReason, T).outcome;
}

describe('summarise — listened time', () => {
  it('counts forward progress, seeded with the first sample position', () => {
    // First poll lands 2s in; three more polls of 3s each.
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 200_000,
      startProgressMs: 2000,
      steps: [{ kind: 'play' }, { kind: 'play' }, { kind: 'play' }],
      pollIntervalMs: 3000,
    });
    // 2000 seed + 3 x 3000 forward = 11000.
    assert.equal(summarise(trail, T).listenedMs, 11_000);
  });

  it('seeding matters: without it every play is undercounted by up to one interval', () => {
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 100_000,
      startProgressMs: 2900,
      steps: [{ kind: 'play' }],
      pollIntervalMs: 3000,
    });
    assert.equal(summarise(trail, T).listenedMs, 5900);
  });

  it('a rewind contributes no listening time but is recorded as evidence', () => {
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 200_000,
      startProgressMs: 0,
      steps: [{ kind: 'play' }, { kind: 'rewind', byMs: 30_000 }],
      pollIntervalMs: 3000,
    });
    const evidence = summarise(trail, T);
    assert.equal(evidence.rewound, true);
    assert.equal(evidence.listenedMs, 3000, 'the backward step adds nothing, and subtracts nothing');
  });

  it('re-listening after a rewind adds time again — the mechanism replacing the rewind rule', () => {
    const withoutRewind = summarise(
      buildTrail({
        trackId: 'x'.repeat(22),
        durationMs: 200_000,
        startProgressMs: 0,
        steps: [{ kind: 'play' }, { kind: 'play' }],
        pollIntervalMs: 3000,
      }),
      T,
    );
    const withRewind = summarise(
      buildTrail({
        trackId: 'x'.repeat(22),
        durationMs: 200_000,
        startProgressMs: 0,
        steps: [
          { kind: 'play' },
          { kind: 'play' },
          { kind: 'rewind', byMs: 6000 },
          { kind: 'play' },
          { kind: 'play' },
        ],
        pollIntervalMs: 3000,
      }),
      T,
    );
    assert.ok(
      withRewind.listenedMs > withoutRewind.listenedMs,
      'engagement must raise the ratio, or the deleted rewind rule was load-bearing after all',
    );
  });

  it('a forward seek cannot add more listening than time elapsed (BR-2.10)', () => {
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 600_000,
      startProgressMs: 0,
      steps: [{ kind: 'seekForward', byMs: 300_000 }],
      pollIntervalMs: 3000,
    });
    const evidence = summarise(trail, T);
    // One 3s interval elapsed, plus jitter tolerance. Not 300,000.
    assert.ok(evidence.listenedMs <= 3000 + T.jitterToleranceMs);
  });

  it('the ratio is not clamped — repeat listening exceeds 1.0', () => {
    // Progress can never exceed duration, so a repeat listen shows up as a reset followed by
    // fresh forward movement. That is what pushes listened time past the track length.
    const ratio = summarise(replayTrail(60_000, 3), T).completionRatio;
    assert.ok(ratio > 2, `expected roughly 3, got ${ratio}`);
  });

  it('is total for an empty trail', () => {
    const evidence = summarise([], T);
    assert.equal(evidence.observationCount, 0);
    assert.equal(evidence.completionRatio, 0);
  });
});

describe('classify — the four branches', () => {
  it('reaching 90% is completed', () => {
    assert.equal(verdict(completeTrail(240_000), 'track-change'), 'completed');
  });

  it('below 90% at a track change is skipped', () => {
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 240_000,
      startProgressMs: 0,
      steps: [{ kind: 'play' }, { kind: 'play' }],
      pollIntervalMs: 3000,
    });
    assert.equal(verdict(trail, 'track-change'), 'skipped');
  });

  it('completion takes precedence over a later pause', () => {
    // Reached the end, then paused. The threshold was met; pausing afterwards does not retract it.
    const trail = [
      ...completeTrail(60_000),
      { atMs: 1_700_000_100_000, trackId: 'x', progressMs: 60_000, durationMs: 60_000, isPlaying: false },
    ];
    assert.equal(verdict(trail, 'pause-idle'), 'completed');
  });

  it('paused below threshold and never resumed is unknown, not skipped', () => {
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 240_000,
      startProgressMs: 0,
      steps: [{ kind: 'play' }, { kind: 'pause' }, { kind: 'pause' }],
      pollIntervalMs: 3000,
    });
    assert.equal(verdict(trail, 'pause-idle'), 'unknown');
  });

  it('playback stopping below threshold is unknown', () => {
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 240_000,
      startProgressMs: 0,
      steps: [{ kind: 'play' }],
      pollIntervalMs: 3000,
    });
    assert.equal(verdict(trail, 'playback-stopped'), 'unknown');
  });

  it('shutdown mid-play is unknown', () => {
    const trail = buildTrail({
      trackId: 'x'.repeat(22),
      durationMs: 240_000,
      startProgressMs: 0,
      steps: [{ kind: 'play' }],
      pollIntervalMs: 3000,
    });
    assert.equal(verdict(trail, 'app-shutdown'), 'unknown');
  });

  it('zero duration is unknown — the ratio is undefined and must not be computed', () => {
    const trail: Observation[] = [
      { atMs: 1, trackId: 'x', progressMs: 0, durationMs: 0, isPlaying: true },
    ];
    assert.equal(verdict(trail, 'track-change'), 'unknown');
  });
});

describe('the accepted short-track limitation (U1 FD Q6)', () => {
  // A fully-played track clears the threshold only when duration >= poll / (1 - threshold),
  // i.e. 30 s at 0.90 and a 3 s poll. Below that it depends on where the final poll lands —
  // so the limitation is *intermittent*, not deterministic. That is worse in one way (the same
  // track can be recorded differently on different plays) and better in another (not every
  // short track is mislabelled).

  it('a short track can be recorded as skipped when the final poll lands badly', () => {
    assert.equal(verdict(worstCaseTrail(20_000), 'track-change'), 'skipped');
  });

  it('the same short track is recorded as completed when the poll lands well', () => {
    // Same duration, same listening — only the sampling alignment differs. This inconsistency
    // is the honest shape of the accepted limitation.
    assert.equal(verdict(completeTrail(20_000, 3000, 100), 'track-change'), 'completed');
  });

  it('a track of 30 s or more is unaffected regardless of alignment', () => {
    assert.equal(verdict(worstCaseTrail(30_000), 'track-change'), 'completed');
    assert.equal(verdict(worstCaseTrail(240_000), 'track-change'), 'completed');
  });

  it('the limitation is correctable by reclassification from the retained trail', () => {
    const trail = worstCaseTrail(20_000);
    assert.equal(reclassify(trail, 'track-change', T).outcome, 'skipped');
    // A future classifier with a poll-interval floor, modelled here as a lower threshold.
    const corrected = reclassify(trail, 'track-change', { ...T, completionThreshold: 0.8 });
    assert.equal(corrected.outcome, 'completed');
  });
});

describe('purity', () => {
  it('is deterministic across repeated calls', () => {
    const trail = completeTrail(180_000);
    const first = reclassify(trail, 'track-change', T);
    const second = reclassify(trail, 'track-change', T);
    assert.deepEqual(first, second);
  });

  it('does not mutate the trail it is given', () => {
    const trail = completeTrail(120_000);
    const snapshot = structuredClone(trail);
    summarise(trail, T);
    reclassify(trail, 'track-change', T);
    assert.deepEqual(trail, snapshot);
  });
});
