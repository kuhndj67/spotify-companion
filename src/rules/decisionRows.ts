/**
 * Turn a `Decision` into decision-log rows. ⚙️ PURE
 *
 * ## ⚠️ Why this is a module rather than a method on one of the executors
 *
 * Both `LoggingExecutor` and `SkipExecutor` have to write exactly the same rows. The two ways of
 * arranging that were both worse:
 *
 *   - **Duplicate it.** Forty lines of denormalisation and three deliberate subtleties (verbatim
 *     `restedOnUnknown`, the content hash rather than the version counter, one row per rule
 *     *evaluated*) copied into a second file. This project has already shipped that defect once: the
 *     local-access policy was written twice, the copies diverged, and every page load returned `200`
 *     while every WebSocket handshake returned `403` — with all 411 tests passing.
 *   - **Have `SkipExecutor` call `LoggingExecutor`.** That puts an import edge from the skipping
 *     executor to the logging one, which says the opposite of BR-30 to anyone reading the graph —
 *     *added alongside, never grown out of*.
 *
 * A pure function both import is neither. ⚠️ **One rule, invoked twice, never written twice.**
 *
 * ## ⚠️ `dryRun` is a PARAMETER, and that is the whole of U5's change here
 *
 * U4 hardcoded `dryRun: true` because nothing could act. U5 does not replace that constant with a
 * state lookup *in this module*: the value depends on which executor is running.
 *
 *   - `LoggingExecutor` passes **`true`**, and that is accurate rather than a leftover. If it is the
 *     selected executor, no action is possible at all.
 *   - `SkipExecutor` passes **BR-33.2's computed value**, because it is the one with an
 *     `AutomationStateStore` to ask.
 *
 * ⚠️ **This is what keeps BR-30.2 intact.** Computing it here would require giving this module — and
 * therefore `LoggingExecutor` — access to the automation state, which is a collaborator BR-30 exists
 * to keep away from it.
 */

import { hashRule } from './ruleHash.js';
import type { DecisionTrigger, ExecutionContext, NewDecisionLogEntry } from './types.js';
import { RULE_ENGINE_VERSION } from './types.js';

/**
 * One row per rule **evaluated**, matched or not (BR-23.1).
 *
 * A matched-only log cannot answer *"why did my rule not fire?"*, which is the question the log exists
 * for.
 *
 * @param dryRun whether this decision may act — see the note above on why it is a parameter
 */
export function buildDecisionRows(
  context: ExecutionContext,
  dryRun: boolean,
): NewDecisionLogEntry[] {
  const { decision, ruleSet, trackId, evaluationId, decidedAt, partialData, trigger } = context;

  // `RuleOutcome` carries only the rule's ID, so the name and hash come from the set that was in
  // force at the moment of the decision — never from the file as it reads later.
  const byId = new Map(ruleSet.rules.map((loaded) => [loaded.rule.id, loaded.rule]));

  return decision.outcomes.map((outcome) => {
    const rule = byId.get(outcome.ruleId);
    return {
      evaluationId,
      decidedAt,
      // Nullable and stays nullable: the play row does not exist yet (BR-24.1). ⚠️ The same fact that
      // forced `skip_attempt.play_id` to be nullable — PlayObserver writes the row at close.
      playId: null,
      playLink: 'pending' as const,
      trackId,
      ruleId: outcome.ruleId,
      // Denormalised, so a rename or a deletion does not orphan this row's history.
      // ⚠️ A rule absent from the set cannot happen — the outcomes came FROM it — but the fallbacks
      // say so plainly rather than crashing the poll loop over a logging concern.
      ruleName: rule?.name ?? outcome.ruleId,
      ruleHash: rule === undefined ? 'unknown' : hashRule(rule),
      verdict: outcome.verdict,
      matched: decision.matchedRuleIds.includes(outcome.ruleId),
      fieldsSeen: outcome.fieldsSeen,
      unknownFields: decision.unknownFields,
      // ⚠️ Copied verbatim, never accumulated (BR-23.5). Under Kleene logic a predicate can contain an
      // unknown and still resolve decisively — `false AND unknown` is `false`, because the data
      // answered it. A flag raised during the walk implements the option that was offered and
      // rejected.
      restedOnUnknown: outcome.restedOnUnknown,
      partialData,
      dryRun,
      // ⚠️ Still `false` here, and that is not a leftover. `executed` means *a skip was issued*, which
      // only the drain can know — it happens up to ENRICHMENT_WAIT_MS after this row is written. The
      // outcome of the action lives on `skip_attempt`, which joins by `evaluationId`.
      executed: false,
      error: null,
      // ⚠️ U5. Which pass wrote this row (BR-37.3). Without it, FR-34's second decision for a play is
      // indistinguishable from the first, and BR-22.1a deliberately created no constraint that would
      // have made the duplicate visible.
      trigger,
      engineVersion: RULE_ENGINE_VERSION,
      ruleSetVersion: ruleSet.version,
      // ⚠️ The version counter resets on restart, so on a permanent table it identifies nothing. The
      // hash is what makes this row attributable months later (BR-23.7a).
      ruleSetContentHash: ruleSet.contentHash,
    };
  });
}

/** Re-exported so callers do not have to reach into `types.js` for one union. */
/*
 * ⚠️ A `export type { DecisionTrigger }` re-export sat here for compatibility after the U5 move and
 * **nothing ever imported it** — every caller takes it from `./types.js` directly. Removed 2026-10-03
 * (found by `knip`). A compatibility shim with no consumer is just a second place the name can be
 * reached from, which is how two copies of a type start.
 */
