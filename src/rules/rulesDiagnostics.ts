/**
 * The rules subsystem's contribution to the diagnostics report (LC-20). ⚙️ PURE
 *
 * A pure function from subsystem state to a report, so it is testable without constructing the
 * server. `diagnostics.ts` composes it and stays an allowed orphan at its current size.
 */

import type { LoadedRuleSet } from './types.js';

export interface RulesDiagnosticsInput {
  readonly ruleSet: LoadedRuleSet;
  /** From `EvaluationCoordinator.stats`. */
  readonly decisions: number;
  readonly partialData: number;
  readonly evaluationErrors: number;
  readonly loggedRows: number;
  /** When the poll last checked the file for changes (P-19). */
  readonly lastChangeCheck: string | null;
  readonly cap: number;
}

export interface RulesDiagnosticsReport {
  readonly ok: boolean;
  readonly ruleSetVersion: number;
  readonly ruleSetContentHash: string;
  readonly state: string;
  readonly activeRules: number;
  readonly disabledRules: number;
  readonly rejection: { readonly attemptedAt: string; readonly errors: readonly string[] } | null;
  readonly decisions: number;
  readonly partialData: number;
  /**
   * ⚠️ **Denominator is `decisions`, never the play count** (BR-22.7).
   *
   * A play that ENDS before the enrichment wait expires produces no decision row at all —
   * measured 2.8% of plays and 4 of 31 skips at a 10 s cap. Dividing by plays would quietly
   * understate how often the cap fires, which is the one number this unit exists to collect.
   * `null` when nothing has been decided yet: a rate over zero decisions is not 0%.
   */
  readonly partialDataRate: number | null;
  readonly evaluationErrors: number;
  readonly loggedRows: number;
  readonly capacityUsed: number;
  readonly lastChangeCheck: string | null;
}

export function rulesDiagnostics(input: RulesDiagnosticsInput): RulesDiagnosticsReport {
  const disabled = input.ruleSet.rules.filter((r) => r.status.state === 'disabled').length;

  return {
    // A rejected rule set is not "broken app" — it is running the last known good one — but it
    // is the state a person should be told about without having to ask.
    ok: input.ruleSet.state !== 'rejected' && input.evaluationErrors === 0,
    ruleSetVersion: input.ruleSet.version,
    ruleSetContentHash: input.ruleSet.contentHash,
    state: input.ruleSet.state,
    activeRules: input.ruleSet.rules.length - disabled,
    disabledRules: disabled,
    rejection: input.ruleSet.rejection,
    decisions: input.decisions,
    partialData: input.partialData,
    partialDataRate: input.decisions === 0 ? null : input.partialData / input.decisions,
    evaluationErrors: input.evaluationErrors,
    loggedRows: input.loggedRows,
    capacityUsed: input.cap === 0 ? 0 : input.loggedRows / input.cap,
    lastChangeCheck: input.lastChangeCheck,
  };
}
