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

describe('the U1 FD Q6 short-track limitation — CLOSED by classifier v2', () => {
  /*
   * Under v1 a fully-played track cleared the threshold only when
   * `duration >= poll / (1 - threshold)` — 30 s at 0.90 and a 3 s poll. Below that the verdict
   * depended on where the final poll happened to land, so the same short track could be recorded
   * differently on different plays. That was *accepted* in U1 (FD Q6), not desired, and
   * `reclassify` existed partly so it could be corrected later.
   *
   * ⚠️ v2 closes it, as a SIDE EFFECT rather than a goal. A track played in full has an
   * unobserved tail of about one poll interval, which the tail rule admits regardless of duration.
   * The tests below now pin the *absence* of the limitation. They are kept under the original
   * heading on purpose: if a future classifier reintroduces poll-alignment sensitivity for short
   * tracks, this is the block that should fail.
   */

  it('a short track played in full is completed even when the final poll lands badly', () => {
    // v1 recorded this as `skipped` — a 20 s track observed to 17 s, ratio 0.85.
    assert.equal(verdict(worstCaseTrail(20_000), 'track-change'), 'completed');
  });

  it('poll alignment no longer changes the verdict for the same short track', () => {
    // The inconsistency itself was the worst part of the limitation: same duration, same
    // listening, different record.
    assert.equal(verdict(worstCaseTrail(20_000), 'track-change'), 'completed');
    assert.equal(verdict(completeTrail(20_000, 3000, 100), 'track-change'), 'completed');
  });

  it('longer tracks are unaffected, as they were before', () => {
    assert.equal(verdict(worstCaseTrail(30_000), 'track-change'), 'completed');
    assert.equal(verdict(worstCaseTrail(240_000), 'track-change'), 'completed');
  });

  it('the position rail still refuses a genuine short-track skip', () => {
    // 60 s track abandoned at 40 s: a 20 s tail, inside the overlap range, but position 0.67.
    // This is the case the 0.50 rail would have fabricated into a completion.
    const trail = buildTrail({
      trackId: 'short-track-genuine-skip',
      durationMs: 60_000,
      startProgressMs: 0,
      steps: Array.from({ length: 13 }, () => ({ kind: 'play' as const })),
      pollIntervalMs: 3000,
    });
    const evidence = reclassify(trail, 'track-change', T);
    assert.ok(
      evidence.evidence.maxProgressMs / 60_000 < T.minObservedPositionRatio,
      `expected position below the rail, got ${evidence.evidence.maxProgressMs / 60_000}`,
    );
    assert.equal(evidence.outcome, 'skipped');
  });

  it('reclassification from the retained trail is still what makes this correctable', () => {
    // The mechanism that closed the limitation is the same one that can reopen or re-answer it.
    const trail = worstCaseTrail(20_000);
    assert.equal(reclassify(trail, 'track-change', T).outcome, 'completed');
    // A stricter tail budget models a classifier that declines to make this inference at all.
    const strict = reclassify(trail, 'track-change', { ...T, maxUnobservedTailMs: 0 });
    assert.equal(strict.outcome, 'skipped');
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
