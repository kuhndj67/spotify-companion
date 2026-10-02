/**
 * May this rule's decision actually fire? ⚙️ PURE — no I/O, no clock, no defaults.
 *
 * LC-23, implementing **BR-33.2**:
 *
 * ```
 * live(rule) := globalAutomationEnabled
 *               AND NOT runawayHalted
 *               AND rule.enabled
 *               AND NOT rule.dryRun
 * ```
 *
 * ## ⚠️ This is evaluated AT THE ACTION POINT, not when the decision was taken
 *
 * `LoggingExecutor.ts` hardcoded `dryRun: true` because in U4 everything was dry-run. U5 replaces
 * that constant with this predicate's answer — **but a decision is taken up to
 * `ENRICHMENT_WAIT_MS` (10 s) before anything could act on it**, and FR-38 requires that *no skip is
 * issued after the switch is thrown*. Checking at decision time would let a skip fire from a decision
 * taken while automation was still on, which is precisely the guarantee the kill switch makes
 * (BR-33.5, P-27).
 *
 * That 10-second window is also why `enabled` and `dryRun` are checked here at all, even though
 * `RuleEngine` never evaluates a disabled rule (`RuleEngine.ts:51`): `RuleSetWatcher` can reload the
 * rules file in between, so the rule that produced the decision may have changed or vanished.
 *
 * ## ⚠️ Why this returns a REASON rather than a boolean
 *
 * A skip that did not happen has several plausible causes — some correct behaviour, some defects —
 * and `firedAt === null` cannot distinguish them (P-28). A predicate returning `false` would force
 * every caller to re-derive *why*, and that is where two copies of one rule drift apart. This project
 * has shipped exactly that defect: the local-access policy was implemented twice, the copies
 * diverged, and every page load returned `200` while every WebSocket handshake returned `403` with
 * all 411 tests passing.
 *
 * ## ⚠️ Why it is pure
 *
 * All eight combinations of BR-33.2's four terms have to be testable (PBT-40), and the live path has
 * no way to produce *automation on, rule disabled, halt set* on demand. A `Date.now()` in here would
 * make a safety decision time-dependent and untestable **while every other test passed** — the same
 * trap as a clock in the classifier, in the place where it costs most.
 */

import type { Maybe, Rule } from '../rules/types.js';
import type { AutomationState, RefusalReason } from './types.js';

/** Decisive either way. ⚠️ There is no third state: a predicate that cannot answer is a defect. */
export type LiveVerdict =
  | { readonly live: true }
  | { readonly live: false; readonly reason: RefusalReason };

/**
 * Whether `rule`'s decision may fire, given the automation state **as read at the action point**.
 *
 * @param state the latches, re-read from disk at drain time — never a value captured earlier
 * @param rule  the rule as it stands **now**. `null` when it is no longer in the loaded set
 *
 * ⚠️ **The term order is BR-33.2's order, and it decides which reason a caller sees when more than
 * one term fails.** Automation being off is reported ahead of a rule-level reason because it is the
 * broader fact and the one the user acted on most recently; a reader told `rule-dry-run` while the
 * master switch was also off would go and investigate the wrong control.
 */
export function live(state: AutomationState, rule: Maybe<Rule>): LiveVerdict {
  if (!state.globalAutomationEnabled) return { live: false, reason: 'automation-off' };

  // ⚠️ A SEPARATE LATCH from the kill switch (BR-33.4, BR-35.5), never a write to it. Collapsing
  // them would make the system's own halt indistinguishable from the user's choice, and would make
  // clearing it read as re-arming rather than as acknowledging.
  if (state.runawayHalt !== null) return { live: false, reason: 'runaway-halted' };

  // The rule was deleted from the file between the decision and the action.
  if (rule === null) return { live: false, reason: 'rule-gone' };

  // The user switched it off in that window.
  if (!rule.enabled) return { live: false, reason: 'rule-disabled' };

  // ⚠️ `dryRun` is OPTIONAL and absent means "adds no dry-run of its own" (BR-25.2) — it never means
  // "run this one for real". A rule cannot opt OUT of a global dry-run, and the only way to opt out
  // of this check is for `globalAutomationEnabled` to be true, which is the first term above.
  if (rule.dryRun === true) return { live: false, reason: 'rule-dry-run' };

  return { live: true };
}
