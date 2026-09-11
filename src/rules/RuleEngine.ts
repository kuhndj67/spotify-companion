/**
 * The rule engine — apply `onUnknown`, fold outcomes into a `Decision`. ⚙️ PURE
 *
 * ## This unit's only output, and nothing consumes it
 *
 * `Decision` values go nowhere at U3. There is no executor, no log, no route. That containment is
 * the point of the phase: the largest and least-certain component in the project is proven correct
 * before anything depends on its behaviour, and being wrong here currently costs nothing.
 *
 * ## Determinism
 *
 * No clock, no randomness, no I/O. The same `(rules, facts)` pair yields an identical `Decision`
 * on every call, on any machine, on any day (BR-21.4). That is what lets FR-42 back-testing
 * replay live decisions exactly rather than approximately.
 */

import { evaluateWithTrace } from './predicate.js';
import type {
  Decision,
  DisabledRuleReport,
  LoadedRule,
  OnUnknown,
  RuleOutcome,
  TrackFacts,
  Verdict,
} from './types.js';

/**
 * Evaluate every rule that is both user-enabled and system-active (BR-18.3).
 *
 * A user-disabled rule produces no outcome and no report — it is simply off. A system-disabled
 * rule produces no outcome but IS reported, because the reason has to survive (BR-18.7).
 */
export function evaluateRules(
  rules: readonly LoadedRule[],
  facts: TrackFacts,
): { outcomes: RuleOutcome[]; disabled: DisabledRuleReport[] } {
  const outcomes: RuleOutcome[] = [];
  const disabled: DisabledRuleReport[] = [];

  for (const loaded of rules) {
    if (loaded.status.state === 'disabled') {
      disabled.push({
        ruleId: loaded.rule.id,
        reason: loaded.status.reason,
        detail: loaded.status.detail,
      });
      continue;
    }

    if (!loaded.rule.enabled) continue;

    const fieldsSeen: Record<string, unknown> = {};
    const verdict = evaluateWithTrace(loaded.rule.predicate, facts, fieldsSeen);

    outcomes.push({
      ruleId: loaded.rule.id,
      verdict,
      applied: applyOnUnknown(verdict, loaded.rule.onUnknown),
      // ⚠️ From the RAW VERDICT, never accumulated while walking the tree (BR-19.6).
      // See the note on RuleOutcome.restedOnUnknown — the accumulator silently implements the
      // option that was offered and rejected.
      restedOnUnknown: verdict === 'unknown',
      fieldsSeen,
    });
  }

  return { outcomes, disabled };
}

/**
 * Map an `unknown` verdict through the rule's declared behaviour (BR-19.5).
 *
 * ## The switch has no `default:`, and that is the U5 tripwire
 *
 * Every member of `OnUnknown` is handled explicitly, so adding a member in U5 is a **compile
 * error here** rather than a silent fallthrough. A `default:` clause would swallow the new case
 * and let it behave as `no-match` — the "stored setting that does nothing" trap.
 *
 * ## ⚠️ `'hold'` returns rather than throwing, deliberately
 *
 * It is unreachable in practice: `semanticStatus` disables such rules before evaluation
 * (BR-18.6), which is where the real guarantee lives and where it is tested. But **BR-21.1 says
 * every pure function is total**, and PBT-13 asserts no input throws — a test that constructs a
 * `LoadedRule` directly, bypassing the validator, must still get an answer rather than an
 * exception. Totality wins over a loud failure on an unreachable branch.
 *
 * `'false'` is the conservative direction: a rule whose waiting behaviour does not exist yet
 * should not match.
 */
function applyOnUnknown(verdict: Verdict, onUnknown: OnUnknown): Verdict {
  if (verdict !== 'unknown') return verdict;

  switch (onUnknown) {
    case 'match':
      return 'true';
    case 'no-match':
      return 'false';
    case 'hold':
      return 'false';
  }
}

/**
 * The OR-fold (FR-30, BR-19.1).
 *
 * ## Deliberately one named function
 *
 * This is the seam. Exemptions, priorities, additional actions — every plausible future change to
 * how rules combine replaces **this function and nothing else**. The evaluator, the catalogue and
 * the validator are all unaffected by a different combination policy, and that is why the fold is
 * not inlined into `evaluateRules`.
 *
 * `partialData` is a parameter, never inferred. The caller knows what it was still waiting for;
 * this unit does not, and guessing cannot distinguish "not yet resolved" from "resolved, and the
 * answer is nothing" (P-17).
 */
export function foldDecisions(
  outcomes: readonly RuleOutcome[],
  disabled: readonly DisabledRuleReport[] = [],
  partialData = false,
): Decision {
  const matched = outcomes.filter((o) => o.applied === 'true');

  // Order affects which rule is named first and nothing else — OR is commutative, so it cannot
  // change WHETHER the action fires (BR-19.3, Q11 = A).
  const matchedRuleIds = matched.map((o) => o.ruleId);

  // Scoped to the MATCHED rules: the question is whether the action we are about to take rests on
  // absent data, not whether any rule anywhere saw an unknown (BR-19.7, US-17).
  const restedOnUnknown = matched.some((o) => o.restedOnUnknown);

  const unknownFields = collectUnknownFields(outcomes);

  return {
    action: matched.length > 0 ? 'skip' : 'none',
    matchedRuleIds,
    outcomes,
    disabledRules: disabled,
    restedOnUnknown,
    unknownFields,
    partialData,
  };
}

/**
 * Union of catalogue fields that read `unknown` on this evaluation (NFR Q4 = B).
 *
 * Lets U4 answer "would waiting have helped?" without this unit speculating about it. Sorted so
 * the `Decision` is deterministic regardless of rule or field ordering — `Object.keys` order is
 * insertion order, which would otherwise leak evaluation sequence into the output and break
 * deep-equality comparisons in PBT-15.
 */
function collectUnknownFields(outcomes: readonly RuleOutcome[]): string[] {
  const unknown = new Set<string>();
  for (const outcome of outcomes) {
    for (const [name, value] of Object.entries(outcome.fieldsSeen)) {
      if (value === null || value === undefined) unknown.add(name);
    }
  }
  return [...unknown].sort();
}

/** Evaluate and fold in one call — the entry point a caller will use from U4 onward. */
export function decide(
  rules: readonly LoadedRule[],
  facts: TrackFacts,
  partialData = false,
): Decision {
  const { outcomes, disabled } = evaluateRules(rules, facts);
  return foldDecisions(outcomes, disabled, partialData);
}
