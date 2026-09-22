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
export const CLASSIFIER_VERSION = 2;

export const DEFAULT_TOLERANCES: ClassifierTolerances = {
  /** U1 Functional Design Q1 + Q5. */
  completionThreshold: 0.9,
  /** Half a poll interval at the 3 s default: enough for jitter, short enough to spot a seek. */
  jitterToleranceMs: 1500,
  /** v2. See THE UNOBSERVED TAIL below for why this is milliseconds and why it is 55 000. */
  maxUnobservedTailMs: 55_000,
  /** v2. A rail, not a discriminator. See WHY THE RAIL IS 0.75 below. */
  minObservedPositionRatio: 0.75,
};

/*
 * ────────────────────────────── THE UNOBSERVED TAIL (v2) ──────────────────────────────
 *
 * In some playback contexts Spotify **stops reporting a track before that track stops
 * playing**: the next track's id appears while the current one is still audible. The play then
 * closes on `track-change` at 81–90% and v1 called it `skipped`. The listener heard it finish.
 *
 * Measured 2026-09-22 (`u5-automated-skipping/probes/r11-queue-lookahead-2026-09-22.md`):
 *
 *   - 12 plays in the AI DJ context     -> 3 recorded as skips, tails 18–30 s
 *   - 20 plays on an album / autoplay   -> 0 recorded as skips, tails 0–2 s
 *   - 16 plays on a radio station       -> 0 recorded as skips, tails 0–3 s
 *
 * Corroborated on an axis not used to draw the partition: no user skip in the corpus has a
 * successor that was already more than 3.0 s in when first observed; 17 of 24 of these do, up to
 * 31 s. The successor is *evidence*, not the discriminator — a large head start proves overlap, a
 * small one proves nothing, because the poll can land exactly at the switch.
 *
 * ⚠️ WHY MILLISECONDS AND NOT A RATIO. The effect removes a near-constant number of seconds. A
 * ratio divides by duration, so `ratio < 0.75` whenever `duration < 4 x tail`: at a 41 s tail
 * every track under 164 s is misfiled, and the corpus's p10 duration is 146 s. `Mascara` is the
 * proof — 136 s long, 35 s tail, ratio 0.743, filed as a user skip purely for being short. No
 * ratio separates a constant-time effect across a 146–271 s duration spread.
 *
 * ⚠️ WHY 55 000. Observed tails split into two populations with an EMPTY BAND between them:
 *
 *   overlap closes :  18 19 21 22 22 22 22 22 23 23 23 23 24 24 25 30 30 30 33 34 34 34 40 41
 *   user skips     :  35 · 66 93 93 95 103 110 114 116 129 145 145 147 152 153 167 189 194 …
 *                        ↑ Mascara, above
 *
 * Any value in 42 000–65 000 partitions the corpus identically. 55 000 sits inside that band with
 * 14 s of margin above the largest observed tail and 11 s below the nearest user skip. The margin
 * is deliberately weighted toward the tail side, because that is the population whose upper end is
 * unknown — the same lesson as `ENRICHMENT_WAIT_MS`, where the tail moved and the median did not.
 *
 * ⚠️ IT IS NOT A TUNED PARAMETER, AND IT WAS CHOSEN AFTER SEEING THE DISTRIBUTION. It is therefore
 * not pre-registered and must not be cited as though it were. If plays ever appear in the
 * 41–66 s band, **the question reopens rather than the number moving** — the same standing
 * instruction as `USER_SKIP_RATIO_CEILING`, whose own empty band stopped being empty on
 * 2026-09-22 (`Mascara`, again) exactly as its comment warned it might.
 *
 * ⚠️ WHY THE RAIL IS 0.75, AND WHY IT IS A RATIO WHEN THE THRESHOLD IS NOT. The two do different
 * jobs. The tail threshold is the discriminator. The rail exists only to stop the tail rule firing
 * on a track so short that a genuine skip also leaves a small tail — a 60 s track abandoned at
 * 40 s has a 20 s tail, squarely inside the overlap range, but only 0.67 of position. Tracks are
 * finite, so a constant-time discriminator needs a proportional guard; that is not the confound
 * above, it is the reason the confound has a floor.
 *
 * An earlier draft used 0.50 and was caught by the test suite: it reclassified `Mascara`
 * (0.743) — desirable — but would also accept any track under 110 s abandoned at its midpoint.
 * Both rails capture all 24 measured rows; 0.75 is strictly the stricter of the two and its only
 * cost on real data is that `Mascara` stays `skipped`.
 *
 * ⚠️ `Mascara` IS THEREFORE KNOWINGLY LEFT WRONG, and that is the conservative direction: leaving
 * one over-counted skip is recoverable from the retained trail, whereas inventing a completion is
 * the error CLAUDE.md singles out as reaching R1. It is the single ambiguous row in the corpus.
 *
 * ⚠️ A SIDE EFFECT: THIS CLOSES THE U1 FD Q6 SHORT-TRACK LIMITATION. A short track played in full
 * has a tail of about one poll interval, so it now reads `completed` regardless of where the final
 * poll lands. That limitation was *accepted* in U1, not desired, and the tests that pinned it now
 * pin its absence. It was not the goal of this change and is recorded so it is not mistaken for one.
 *
 * ⚠️ THIS DOES NOT NAME A CAUSE. The overlap is confined to the DJ context in everything measured,
 * crossfade is disabled on the machine, and Automix is on globally while album and radio playback
 * show no overlap. That is consistent with DJ segues and is **not** a probed mechanism. The rule
 * keys on the observable — an unobserved tail — not on a context or a feature, so it stays correct
 * if the cause turns out to be something else.
 * ──────────────────────────────────────────────────────────────────────────────────────
 */

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
    // v2: the track was still running when the API stopped reporting it, so the close says
    // nothing about rejection. See THE UNOBSERVED TAIL above.
    const unobservedTailMs = evidence.durationMs - evidence.maxProgressMs;
    const observedPositionRatio = evidence.maxProgressMs / evidence.durationMs;
    if (
      unobservedTailMs <= tolerances.maxUnobservedTailMs &&
      observedPositionRatio >= tolerances.minObservedPositionRatio
    ) {
      return {
        outcome: 'completed',
        rationale:
          `track changed with only ${(unobservedTailMs / 1000).toFixed(1)}s unobserved ` +
          `(<= ${(tolerances.maxUnobservedTailMs / 1000).toFixed(0)}s) at position ` +
          `${observedPositionRatio.toFixed(3)}; reporting stopped, playback did not`,
      };
    }

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
