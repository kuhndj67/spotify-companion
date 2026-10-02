/**
 * The runaway-halt counters. ⚙️ PURE — `now` is a parameter, never a clock.
 *
 * LC-27, implementing **BR-35.1, BR-35.2 and BR-35.9**.
 *
 * ## ⚠️ Derived, never stored — and that is a decision with a cost
 *
 * A stored counter is a second source of truth that drifts from the rows it summarises, and the drift
 * is invisible because the counter reads plausible either way. *Store observations; derive judgements*
 * — the same rule that keeps observation trails so verdicts can be recomputed under FR-20.
 *
 * ⚠️ **The consequence to accept: the counters reset on restart.** `consecutiveRuleSkips` is derived
 * from a run of recent plays, and a restart interrupts the sequence. **The halt itself persists**
 * (BR-35.7), which is the part that matters — a restart cannot clear a halt, only the count that
 * would have led to one.
 *
 * ## ⚠️ Why `now` is a parameter
 *
 * A rolling window anchored on an ambient clock is untestable, and this project has the scar:
 * `playStats.ts` takes `now` for exactly this reason, and the week-seam bug is what taught it. A
 * `Date.now()` here would also break `test/purity.test.ts` — which is the only thing that catches it.
 *
 * ## ⚠️ What is NOT this module's job
 *
 * **Filtering to rule-caused skips.** Only `skip_source = 'rule'` counts toward either threshold
 * (BR-35.3) — a user's own skips never trip a halt, and there are 31 of those in the corpus against 0
 * rule skips. That filter belongs to the repository query that supplies these inputs. The input types
 * below are shaped so that passing the wrong rows is a visible mistake rather than a silent one:
 * neither function accepts anything it could mistake for a user skip.
 */

import type { Maybe } from '../rules/types.js';
import {
  MAX_CONSECUTIVE_RULE_SKIPS,
  MAX_RULE_SKIPS_PER_HOUR,
  RULE_SKIP_WINDOW_MS,
} from './types.js';

/**
 * One play, reduced to the only fact the consecutive counter needs.
 *
 * ⚠️ **`skippedByRule`, not `skipped`.** The distinction is the whole of BR-35.3, and naming the
 * field after the narrower fact is what stops a caller passing every skip.
 */
export interface PlayForCounting {
  readonly playId: number;
  readonly skippedByRule: boolean;
}

/**
 * How many plays in a row were skipped by a rule, counting back from the most recent.
 *
 * @param playsOldestFirst recent plays in time order. ⚠️ **Oldest first** — the run is counted from
 *        the END, so a reversed array silently returns a different number.
 *
 * ⚠️ **Any play not skipped by a rule resets the count to zero** (BR-35.9). It does not merely fail to
 * increment it: a listener hearing one track through between two rule-skips means the system is not
 * running away, and that is the signal the threshold is trying to separate itself from. The corpus's
 * longest run of consecutive *user* skips is **2**, which is why the limit is 3.
 */
export function consecutiveRuleSkips(playsOldestFirst: readonly PlayForCounting[]): number {
  let run = 0;
  for (let i = playsOldestFirst.length - 1; i >= 0; i -= 1) {
    const play = playsOldestFirst[i];
    if (play === undefined || !play.skippedByRule) break;
    run += 1;
  }
  return run;
}

/**
 * How many rule-skips fired inside the rolling window ending at `nowMs`.
 *
 * @param firedAtMs epoch milliseconds of each **fired** rule-skip. Order does not matter.
 * @param nowMs     the instant the window ends
 * @param windowMs  defaults to one hour (`RULE_SKIP_WINDOW_MS`)
 *
 * ⚠️ **A ROLLING window, not a calendar hour** (BR-35.9). A calendar hour resets at the top of the
 * hour, so ten skips at 10:55 and ten more at 11:05 would never trip a limit of ten — twenty skips in
 * ten minutes, read as two compliant hours.
 *
 * The window is **half-open**: `(nowMs - windowMs, nowMs]`. An attempt exactly `windowMs` old has
 * aged out, so a skip cannot be counted twice by two adjacent evaluations.
 */
export function ruleSkipsInWindow(
  firedAtMs: readonly number[],
  nowMs: number,
  windowMs: number = RULE_SKIP_WINDOW_MS,
): number {
  const floor = nowMs - windowMs;
  let count = 0;
  for (const at of firedAtMs) {
    if (at > floor && at <= nowMs) count += 1;
  }
  return count;
}

/** Which threshold tripped, and what it was measured against. */
export interface HaltTrigger {
  readonly trigger: 'consecutive' | 'hourly-rate';
  readonly observedCount: number;
  /** ⚠️ The limit in force **at this moment**, carried so the record cannot be rewritten later. */
  readonly threshold: number;
}

/**
 * Should automation halt? `null` means no.
 *
 * ⚠️ **Consecutive is reported ahead of the hourly rate when both trip.** Three skips in a row is the
 * sharper signal — it says the system is acting on consecutive plays, which no observed user
 * behaviour matches — whereas the hourly count can be reached by a merely broad rule.
 *
 * > ⚠️ **The hourly limit is reachable by a LEGITIMATE rule, and that is not a reason to raise it.**
 * > The busiest rolling hour in the corpus held **27 plays**, so 10 rule-skips per hour is reached by
 * > any rule matching more than **37%** of tracks. BR-35: *"If a legitimate rule trips the halt, that
 * > is information about the rule."* Raising the number to make a favourite rule work is the failure
 * > mode, and the number living in source rather than in `compose.yaml` is what makes that edit
 * > visible.
 */
export function evaluateHalt(
  consecutive: number,
  inWindow: number,
  limits: {
    readonly maxConsecutive?: number;
    readonly maxPerWindow?: number;
  } = {},
): Maybe<HaltTrigger> {
  const maxConsecutive = limits.maxConsecutive ?? MAX_CONSECUTIVE_RULE_SKIPS;
  const maxPerWindow = limits.maxPerWindow ?? MAX_RULE_SKIPS_PER_HOUR;

  if (consecutive >= maxConsecutive) {
    return { trigger: 'consecutive', observedCount: consecutive, threshold: maxConsecutive };
  }
  if (inWindow >= maxPerWindow) {
    return { trigger: 'hourly-rate', observedCount: inWindow, threshold: maxPerWindow };
  }
  return null;
}
