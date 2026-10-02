/**
 * One of two `DecisionExecutor`s (LC-15, BR-30.1/30.2). 🔌 IMPURE
 *
 * **It records a decision and never acts on one.** `SkipExecutor` is the other, added
 * **alongside** this class in U5 and selected by configuration — this one was never grown into it.
 *
 * ## ⚠️ The phase boundary MOVED in U5, and the old guarantee is gone
 *
 * This docstring used to say the boundary rested on *"`src/playback/` does not exist"*. **That
 * directory now exists** — U5 necessarily ends that guard, as U3's *"`git status src/` shows only
 * `src/rules/`"* ended at U4. Corrected 2026-10-02.
 *
 * The replacement is an **import-graph property** plus a **method count** (P-33), both asserted by
 * structural tests rather than left to review:
 *
 * ```
 * nothing in src/rules/  imports  src/playback/      <- the direction that is refused
 * only SkipExecutor      imports  src/playback/
 * the player client exposes EXACTLY ONE method: skipToNext()
 * ```
 *
 * ⚠️ **The one-method rule is asserted on the client's exported shape, not via the orphan check**,
 * which walks modules rather than methods — two dead methods lived inside a heavily-executed file
 * for their entire lives and that check was satisfied throughout.
 *
 * ## ⚠️ What has NOT changed: this constructor takes no playback collaborator
 *
 * **Not an unused one. Not an optional one. Not a null one.** An injected-but-uncalled
 * `PlaybackController` is one line away from being called, and the boundary would then be a
 * runtime flag rather than a structural fact — something a reviewer has to *remember* instead of
 * something the type system refuses. `LoggingExecutor.length === 1` still pins it.
 *
 * ⚠️ **The same argument is why the player client has one method**, and why `DecisionExecutor` has
 * no `cancel`: an unused capability on a live device is indistinguishable from an intended one the
 * day someone calls it.
 */

import type { DecisionLogRepository } from './DecisionLogRepository.js';
import { hashRule } from './ruleHash.js';
import type {
  Decision,
  DecisionExecutor,
  ExecutionContext,
  LoadedRuleSet,
  NewDecisionLogEntry,
} from './types.js';
import { RULE_ENGINE_VERSION } from './types.js';

/**
 * ⚠️ `DecisionExecutor` and `ExecutionContext` MOVED to `./types.js` in U5 (code-gen Q1).
 *
 * They were declared here while this was the only implementation. U5 adds `SkipExecutor`
 * **alongside** it (BR-30), and leaving the interface here would have made the skipping executor
 * import from the logging executor's module — an import edge that says the opposite of BR-30 to
 * anyone reading the graph, including the structural test that enforces the phase boundary.
 *
 * Re-exported for one release so existing importers do not break. ⚠️ **New code imports from
 * `./types.js`.**
 */
export type { DecisionExecutor, ExecutionContext } from './types.js';

export class LoggingExecutor implements DecisionExecutor {
  readonly #log: DecisionLogRepository;

  /** ⚠️ The decision log and nothing else. See the note at the top of this file. */
  constructor(log: DecisionLogRepository) {
    this.#log = log;
  }

  execute(context: ExecutionContext): string {
    const { decision, ruleSet, trackId, evaluationId, decidedAt, partialData } = context;

    // `RuleOutcome` carries only the rule's ID, so the name and hash come from the set that
    // was in force at the moment of the decision — never from the file as it reads later.
    const byId = new Map(ruleSet.rules.map((loaded) => [loaded.rule.id, loaded.rule]));

    // One row per rule EVALUATED, matched or not (BR-23.1). A matched-only log cannot answer
    // "why did my rule not fire?", which is the question the log exists for.
    const entries: NewDecisionLogEntry[] = decision.outcomes.map((outcome) => {
      const rule = byId.get(outcome.ruleId);
      return {
        evaluationId,
        decidedAt,
        // Nullable and stays nullable: the play row does not exist yet (BR-24.1).
        playId: null,
        playLink: 'pending' as const,
        trackId,
        ruleId: outcome.ruleId,
        // Denormalised, so a rename or a deletion does not orphan this row's history.
        // ⚠️ A rule absent from the set cannot happen — the outcomes came FROM it — but the
        // fallbacks say so plainly rather than crashing the poll loop over a logging concern.
        ruleName: rule?.name ?? outcome.ruleId,
        ruleHash: rule === undefined ? 'unknown' : hashRule(rule),
        verdict: outcome.verdict,
        matched: decision.matchedRuleIds.includes(outcome.ruleId),
        fieldsSeen: outcome.fieldsSeen,
        unknownFields: decision.unknownFields,
        // ⚠️ Copied verbatim, never accumulated (BR-23.5). Under Kleene logic a predicate can
        // contain an unknown and still resolve decisively — `false AND unknown` is `false`,
        // because the data answered it. A flag raised during the walk implements the option
        // that was offered and rejected.
        restedOnUnknown: outcome.restedOnUnknown,
        partialData,
        // ⚠️ Constants in U4, and they are columns rather than assumptions so that U5 changes
        // behaviour instead of changing the schema (BR-23.8, BR-25.3).
        dryRun: true,
        executed: false,
        error: null,
        engineVersion: RULE_ENGINE_VERSION,
        ruleSetVersion: ruleSet.version,
        // ⚠️ The version counter resets on restart, so on a permanent table it identifies
        // nothing. The hash is what makes this row attributable months later (BR-23.7a).
        ruleSetContentHash: ruleSet.contentHash,
      };
    });

    this.#log.record(entries);
    return evaluationId;
  }
}
