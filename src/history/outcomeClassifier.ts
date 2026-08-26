/**
 * Outcome classification — the most correctness-critical module in the project. ⚙️ PURE
 *
 * Everything downstream of U1 rests on the verdicts produced here: the promotion hypothesis is
 * tested against them, and rules are back-tested against them. Getting this wrong produces a
 * *systematic* rather than random bias, which no amount of later analysis repairs.
 *
 * ## This module must import nothing impure
 *
 * No clock, no config, no filesystem, no database. Every input is an argument.
 *
 * That is not a style preference — it is the mechanism by which FR-20 works. Reclassification
 * only means something if the same trail produces the same verdict on any day, on any machine,
 * under any configuration. A single `Date.now()` in here would break FR-20 (recomputation stops
 * being reproducible) and FR-42 (back-testing stops replaying live behaviour) **while passing
 * every existing test**. `test/purity.test.ts` exists specifically to catch that.
 *
 * ## Why the ratio measures time rather than position
 *
 * An earlier draft defined the ratio as furthest position reached (`max(progress) / duration`)
 * and needed three extra rules to cope: a replay-versus-rewind segmentation branch, a rule
 * forcing rewound plays to `completed`, and forward-seek detection.
 *
 * Measuring *listened time* removed all three. Re-hearing a passage adds to the numerator
 * directly, so engagement raises the ratio by itself and the replay-versus-rewind question stops
 * existing. All the subtlety now lives in `summarise`, which is arithmetic over a trail and can
 * be property-tested exhaustively — a better home than a branch in `classify`, which would be a
 * judgement requiring an argument.
 */

import type {
  ClassifierTolerances,
  CloseReason,
  Observation,
  OutcomeEvidence,
  PlayOutcome,
} from './types.js';

/**
 * Bumped whenever the logic below changes in a way that could alter a verdict.
 *
 * Stored on every play so a partially reclassified database is distinguishable from a consistent
 * one. Without it, "recompute the outcomes" would be an operation you could not audit.
 */
export const CLASSIFIER_VERSION = 1;

export const DEFAULT_TOLERANCES: ClassifierTolerances = {
  /** U1 Functional Design Q1 + Q5. */
  completionThreshold: 0.9,
  /** Half a poll interval at the 3 s default: enough for jitter, short enough to spot a seek. */
  jitterToleranceMs: 1500,
};

/**
 * Reduce a trail to the evidence a verdict rests on.
 *
 * Total: any trail, including a single observation, produces a well-formed result.
 */
export function summarise(
  trail: readonly Observation[],
  tolerances: ClassifierTolerances,
  endedWithIdle = false,
): OutcomeEvidence {
  const empty: OutcomeEvidence = {
    listenedMs: 0,
    durationMs: 0,
    completionRatio: 0,
    maxProgressMs: 0,
    maxObservationGapMs: 0,
    observationCount: 0,
    sawPause: false,
    rewound: false,
    endedWithIdle,
  };
  if (trail.length === 0) return empty;

  const first = trail[0]!;

  // Seeded with the first sample's position: the listener heard everything up to the first poll,
  // typically a second or two. Starting at zero would undercount every play by up to one
  // interval — small per play, systematic across a dataset.
  let listenedMs = Math.max(0, first.progressMs);
  let maxProgressMs = Math.max(0, first.progressMs);
  let maxGapMs = 0;
  let sawPause = !first.isPlaying;
  let rewound = false;

  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1]!;
    const cur = trail[i]!;

    const gap = Math.max(0, cur.atMs - prev.atMs);
    if (gap > maxGapMs) maxGapMs = gap;
    if (!cur.isPlaying) sawPause = true;
    if (cur.progressMs > maxProgressMs) maxProgressMs = cur.progressMs;

    const step = cur.progressMs - prev.progressMs;

    if (step < -tolerances.jitterToleranceMs) {
      // A backward jump. Recorded as evidence, but it contributes no listening time and —
      // deliberately — has no effect on the verdict. Re-listening from here adds time again,
      // which is the entire mechanism that replaced the deleted rewind rule.
      rewound = true;
      continue;
    }

    // Lower bound: a negative step never subtracts. Upper bound: you cannot listen to more audio
    // than time has passed, which makes an undetected forward seek harmless without any
    // seek-detection logic. Accounting, not detection.
    listenedMs += Math.min(Math.max(step, 0), gap + tolerances.jitterToleranceMs);
  }

  // The last sample's duration wins: if Spotify revised it mid-play, the latest is the best
  // available answer, and the per-observation values remain in the trail either way.
  const durationMs = Math.max(0, trail[trail.length - 1]!.durationMs);

  return {
    listenedMs,
    durationMs,
    // Never clamped above. Repeat listening legitimately exceeds 1.0 and that is signal.
    completionRatio: durationMs > 0 ? listenedMs / durationMs : 0,
    maxProgressMs,
    maxObservationGapMs: maxGapMs,
    observationCount: trail.length,
    sawPause,
    rewound,
    endedWithIdle,
  };
}

/**
 * The verdict. Four branches, no special cases.
 *
 * Ordering is the algorithm:
 *
 *  - `completed` is tested **before** any interruption reason. A track that reached the
 *    threshold and was then paused or stopped is completed — the threshold was met, and what
 *    happened afterwards does not retract it. Reversing these would downgrade genuine
 *    completions to `unknown` whenever playback was paused after a track effectively ended,
 *    which is ordinary behaviour.
 *  - Only a *track change* below threshold is a skip. Everything else that is not a completion
 *    is `unknown`: a deliberately wide net, and the conservative direction, because `unknown`
 *    costs analytical power whereas a wrong `skipped` actively misleads.
 */
export function classify(
  evidence: OutcomeEvidence,
  tolerances: ClassifierTolerances,
  closeReason: CloseReason,
): { outcome: PlayOutcome; rationale: string } {
  if (evidence.durationMs <= 0) {
    return { outcome: 'unknown', rationale: 'duration unknown; ratio undefined' };
  }

  if (evidence.completionRatio >= tolerances.completionThreshold) {
    return {
      outcome: 'completed',
      rationale: `listened ratio ${evidence.completionRatio.toFixed(3)} >= ${tolerances.completionThreshold}`,
    };
  }

  if (closeReason === 'track-change') {
    return {
      outcome: 'skipped',
      rationale: `track changed at ratio ${evidence.completionRatio.toFixed(3)}`,
    };
  }

  return { outcome: 'unknown', rationale: `ended by ${closeReason} below threshold` };
}

/**
 * Recompute a stored verdict from its retained trail (FR-20).
 *
 * This is what makes the accepted short-track limitation recoverable. At a 0.90 threshold and a
 * 3 s poll, the highest observable ratio is about `(duration - 3s) / duration`, so clearing the
 * threshold requires a track of at least ~30 seconds. Shorter tracks played in full are recorded
 * as `skipped` — systematically, not randomly (accepted: U1 FD Q6).
 *
 * Because the trail is kept, a later classifier can correct every one of those records without
 * re-collecting anything.
 */
export function reclassify(
  trail: readonly Observation[],
  closeReason: CloseReason,
  tolerances: ClassifierTolerances,
  endedWithIdle = false,
): { outcome: PlayOutcome; evidence: OutcomeEvidence; rationale: string } {
  const evidence = summarise(trail, tolerances, endedWithIdle);
  const { outcome, rationale } = classify(evidence, tolerances, closeReason);
  return { outcome, evidence, rationale };
}
