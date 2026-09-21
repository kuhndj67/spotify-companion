/**
 * The only `DecisionExecutor` in U4 (LC-15, BR-30.1/30.2). 🔌 IMPURE
 *
 * ## ⚠️ This class is the phase boundary
 *
 * U3's containment guarantee was *"`git status src/` shows only `src/rules/`"*. U4 necessarily
 * changes the poll loop, `api.ts`, the schema and the UI, so that guarantee cannot survive this
 * unit. From here the boundary rests on two structural facts: **`src/playback/` does not
 * exist**, and **this constructor takes no playback collaborator**.
 *
 * ⚠️ **Not an unused one. Not an optional one. Not a null one.** An injected-but-uncalled
 * `PlaybackController` is one line away from being called, and the boundary would then be a
 * runtime flag rather than a structural fact — something a reviewer has to *remember* instead
 * of something the type system refuses.
 *
 * U5 adds `SkipExecutor` **alongside** this class. It does not grow this one into it.
 */

import type { DecisionLogRepository } from './DecisionLogRepository.js';
import { hashRule } from './ruleHash.js';
import type { Decision, LoadedRuleSet, NewDecisionLogEntry } from './types.js';
import { RULE_ENGINE_VERSION } from './types.js';

export interface DecisionExecutor {
  /**
   * Act on a decision. ⚠️ In U4 the only available action is **recording it**.
   *
   * Returns the `evaluationId` so the caller can complete the `playId` link when the play
   * closes — or mark it failed if the play row could not be written.
   */
  execute(context: ExecutionContext): string;
}

export interface ExecutionContext {
  readonly decision: Decision;
  readonly ruleSet: LoadedRuleSet;
  readonly trackId: string;
  readonly evaluationId: string;
  readonly decidedAt: string;
  /** ⚠️ Whether the enrichment wait TIMED OUT — not whether any field read null (FQ3). */
  readonly partialData: boolean;
}

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
