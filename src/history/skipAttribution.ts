/**
 * Who — or what — ended a skipped play. ⚙️ PURE
 *
 * ## The problem this exists for
 *
 * `outcomeClassifier` answers *"did this track change before it finished?"*. Until 2026-09-21
 * the observer then asserted that every such change was the **user's** doing:
 *
 * ```ts
 * skipSource: outcome === 'skipped' ? 'user' : null,   // "every live-observed skip is the user's"
 * ```
 *
 * ⚠️ **That was an assumption written as an observation, and it is false.** It was caught by a
 * listener saying *"I never skip Ren"* while the statistics panel showed multiple Ren skips —
 * no test could have found it, because the code did exactly what it said.
 *
 * ## What the corpus shows
 *
 * Over 35 live skips the completion ratio is **bimodal, with an empty band**:
 *
 * ```
 * 0.01 0.01 0.08 0.09 0.12 0.12 0.14 0.15 0.23 0.24 0.25 0.25 0.27 0.30 0.44 0.49 0.49
 *                          <- nothing between 0.49 and 0.81 ->
 * 0.81 0.82 0.84 0.85 0.85 0.85 0.85 0.85 0.86 0.86 0.86 0.87 0.87 0.87 0.88 0.89 0.89 0.90
 * ```
 *
 * A second, independent measurement agrees. Taking how far into the *next* track the app was
 * when it first saw it:
 *
 * | group | median | max |
 * |---|---|---|
 * | ratio < 0.75 | 2 s | **3 s — not one exceeds a single poll** |
 * | ratio ≥ 0.75 | 7 s | **31 s** |
 *
 * The upper cluster's successors had **already been playing for up to half a minute** when the
 * app first noticed them, while the old track's progress was still advancing smoothly (Spotify
 * interpolates it from a timestamp). The tracks did not end early; the app was told late, and
 * charged the missing 21–41 s to the previous track.
 *
 * ⚠️ **The mechanism is indicated, not proven.** Successor lag (7–31 s) and unplayed time
 * (21–41 s) are both elevated but do not match one-for-one. Crossfade is ruled out — Spotify
 * caps it at 12 s. Wrong duration metadata is ruled out: the same tracks reach their full
 * length on other plays (Ren's *Humble* stopped at 175 s of 176 s once, and 142 s another time).
 *
 * ## What this module claims, and what it does not
 *
 * It says **"not attributable to the listener"**. It does *not* name a cause, because none has
 * been established — calling these `transition` or `crossfade` would repeat the original
 * mistake of writing an assumption where an observation belongs.
 */

import type { OutcomeEvidence, PlayOutcome } from './types.js';

/**
 * Below this, a skip is the listener's.
 *
 * ⚠️ **It sits inside an empty band.** Measured over 35 live skips, nothing falls between
 * 0.489 and 0.807, so any value in that range partitions the corpus identically and the exact
 * figure carries no information. It is **not** a tuned parameter, and it must not be treated as
 * one: if plays ever appear in the gap, this constant stops being arbitrary and the question
 * has to be reopened rather than the number nudged.
 *
 * ⚠️ It is deliberately **not** the completion threshold (0.90). That one decides
 * `completed` vs `skipped`; this one decides *who did it*, and tying them together would mean a
 * change to one silently re-answers the other.
 */
export const USER_SKIP_RATIO_CEILING = 0.75;

/**
 * Corroborating evidence only. A successor already this far in when first observed means the
 * app learned of the change late.
 *
 * ⚠️ **Not part of the decision**, and that is deliberate: one of the six plays examined by hand
 * had a successor lag of 2 s while sitting squarely in the upper cluster at ratio 0.858. Making
 * it a conjunct would have mis-attributed that play, so it is recorded and not tested.
 */
export const LATE_SUCCESSOR_MS = 4_000;

/**
 * Who ended a skipped play.
 *
 * `null` for anything that is not a skip, exactly as `skip_source` has always been.
 */
export type SkipAttribution =
  /** The listener. A decisive, early abandonment. */
  | 'user'
  /**
   * Something else, and **we do not know what**. The track played nearly to the end and was
   * then replaced. Not a rejection, and it must not be counted as one.
   */
  | 'unattributed';

/**
 * Decide attribution from the play's own evidence.
 *
 * ⚠️ **Decided at close, from the ratio alone**, so it needs nothing that has not happened yet.
 * The successor lag is better evidence in most cases but is only knowable once the *next* play
 * starts; recording it separately keeps this function total and keeps the judgement available
 * immediately.
 */
export function attributeSkip(
  outcome: PlayOutcome,
  evidence: OutcomeEvidence,
): SkipAttribution | null {
  if (outcome !== 'skipped') return null;
  return evidence.completionRatio < USER_SKIP_RATIO_CEILING ? 'user' : 'unattributed';
}

/**
 * Whether the successor's first observed progress corroborates a late-learned transition.
 *
 * Reported for analysis; **never** fed back into `attributeSkip`. See the note on
 * `LATE_SUCCESSOR_MS`.
 */
export function successorLooksLate(successorFirstProgressMs: number | null): boolean {
  return successorFirstProgressMs !== null && successorFirstProgressMs >= LATE_SUCCESSOR_MS;
}
