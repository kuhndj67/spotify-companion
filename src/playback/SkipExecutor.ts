/**
 * The second `DecisionExecutor` (LC-25). 🔌 IMPURE
 *
 * **Added alongside `LoggingExecutor`, never grown out of it** (BR-30, BR-33.6). Two implementations of
 * one interface, selected by configuration — `SKIP_EXECUTOR_ENABLED`. The test asserting
 * `LoggingExecutor.length === 1` must still pass with this file present; if it fails, the phase
 * boundary was collapsed rather than crossed.
 *
 * ## ⚠️ `execute` is SYNCHRONOUS and does NOT post
 *
 * It records the decision rows, enqueues a `SkipAttempt`, schedules a drain, and returns the
 * `evaluationId`. The `POST` happens in `skipDrain`, later and elsewhere (BR-42.2/42.3).
 *
 * Making `execute` async was rejected three times over: it would change `LoggingExecutor`'s signature
 * to serve a collaborator it does not have, it would put an unawaited promise inside a **timer** —
 * which is how a swallowed rejection becomes a skip that silently never happened — and ⚠️ **it would
 * put the safety check in the wrong place.** An awaited `execute` checks the kill switch where the
 * *decision* is taken; BR-33.5 requires it where the *action* fires, up to `ENRICHMENT_WAIT_MS` later.
 *
 * ## ⚠️ This is where the one-attempt-per-play budget is spent
 *
 * The guard lives here rather than in the drain, and the reason is not stylistic: **the row being
 * drained is itself an attempt for that play**, so a drain-time check would refuse every attempt as a
 * duplicate of itself. Settled during Step 6.
 *
 * A second attempt is still **recorded** — as a `refused` row with `already-attempted` — because
 * BR-36.3 requires the refusal to be visible. *Why is this absent* is never inferred from the absence.
 */

import { buildDecisionRows } from '../rules/decisionRows.js';
import type { DecisionLogRepository } from '../rules/DecisionLogRepository.js';
import type { DecisionExecutor, ExecutionContext, LoadedRuleSet, Maybe, Rule } from '../rules/types.js';
import type { AutomationStateStore } from './AutomationStateStore.js';
import { live } from './automationPredicate.js';
import type { SkipAttemptRepository } from './SkipAttemptRepository.js';
import type { NewSkipAttempt } from './types.js';

export interface SkipExecutorDeps {
  readonly log: DecisionLogRepository;
  readonly attempts: SkipAttemptRepository;
  readonly state: AutomationStateStore;
  readonly nowIso: () => string;
  /**
   * Ask the drain to run.
   *
   * ⚠️ **Fire-and-forget on purpose, and the drain is contracted never to throw.** `execute` is
   * synchronous and is itself called unawaited from a timer, so there is nowhere here to await a
   * promise or handle a rejection. The 3 s tick calls the same drain as a backstop, so an attempt whose
   * scheduled run is lost still reaches a terminal state rather than sitting `queued` for ever.
   *
   * ⚠️ **One drain function, two entry points — never two drains.** The WebSocket `403` happened
   * because one admission rule was implemented twice and the copies diverged.
   */
  readonly scheduleDrain: () => void;
}

export class SkipExecutor implements DecisionExecutor {
  readonly #deps: SkipExecutorDeps;

  constructor(deps: SkipExecutorDeps) {
    this.#deps = deps;
  }

  execute(context: ExecutionContext): string {
    const { log, attempts, state, nowIso, scheduleDrain } = this.#deps;
    const { decision, ruleSet, trackId, evaluationId } = context;

    // ── the decision rows ───────────────────────────────────────────────────────────────────────
    //
    // ⚠️ `dryRun` is computed here, which is the one thing this executor does that `LoggingExecutor`
    // cannot: it holds the state store. The value is advisory on the row — the authoritative check
    // happens again at the action point (BR-33.5), because the state can change in the 10 s between.
    //
    // ⚠️ Recorded even when nothing will be enqueued. Throwing the kill switch never cancels the
    // decision log (BR-34.8): evaluation and recording continue, and only action stops.
    const { state: automation } = state.read();
    const matched = this.#firstMatchedRule(decision, ruleSet);
    const anyLive = matched !== null && live(automation, matched).live;

    log.record(buildDecisionRows(context, !anyLive));

    if (matched === null) return evaluationId;

    // ⚠️ BR-37.6 — A RE-EVALUATION MAY CANCEL, AND MAY NEVER CREATE.
    //
    // FR-34's second pass records its rows (above) and stops here. The asymmetry is the point: the
    // direction that errs toward *not acting* is the safe one.
    //
    // Enforced by the trigger rather than by comparing verdicts, because the two cases this must
    // separate are already distinguishable by it:
    //
    //   - the first pass MATCHED  -> an attempt exists, and `already-attempted` below would refuse a
    //                               second one anyway. Cancellation is the drain's job: it reads the
    //                               latest decision for this evaluationId and withdraws the attempt.
    //   - the first pass DECLINED -> no attempt exists, and this must NOT create one. A newly-matching
    //                               re-evaluation is exactly the escalation BR-37.6 forbids.
    //
    // ⚠️ A HELD play is neither of those: it was never decided, so its decision arrives with
    // trigger `initial` even when it is taken late. That is what makes FR-33's hold useful rather than
    // inert — see EvaluationCoordinator.
    if (context.trigger === 'enrichment-arrived') return evaluationId;

    // ── the attempt ─────────────────────────────────────────────────────────────────────────────
    //
    // ⚠️ An attempt row is written whether or not it will fire, so that every matched decision has a
    // visible outcome. A matched rule that produced no row at all would be indistinguishable from a
    // rule that never matched.
    const base: Omit<NewSkipAttempt, 'state'> = {
      evaluationId,
      // ⚠️ NULL, and necessarily so: PlayObserver writes the play row when the play CLOSES, and this
      // runs while it is still playing. Backfilled later via `attachPlayId`.
      playId: null,
      trackId,
      ruleId: matched.id,
      enqueuedAt: nowIso(),
      firedAt: null,
      refusedReason: null,
      reportedTrackIdBefore: null,
      reportedProgressMsBefore: null,
      reportedTrackIdAfter: null,
      reportedProgressMsAfter: null,
    };

    // ⚠️ THE BUDGET. One attempt per play, keyed on `evaluationId` because `playId` does not exist
    // yet. A second attempt is RECORDED as refused rather than dropped (BR-36.3), and it is refused
    // whatever the first attempt's outcome was — one attempt is the budget, and a failed attempt does
    // not earn a retry (BR-36.4).
    if (attempts.attemptedForPlay(evaluationId)) {
      attempts.enqueue({ ...base, state: 'refused', refusedReason: 'already-attempted' });
      return evaluationId;
    }

    attempts.enqueue({ ...base, state: 'queued' });

    // ⚠️ Scheduled, not awaited. See `scheduleDrain`.
    scheduleDrain();
    return evaluationId;
  }

  /**
   * The first matched rule, in rule-set order.
   *
   * ⚠️ **One attempt per play means one RULE per play acts**, and rule precedence is explicitly out of
   * scope for U5 (Q-B, revisited after Phase 4). Set order is the only ordering that exists, so it is
   * the one used — stated here rather than left for a reader to infer from a `[0]`.
   */
  #firstMatchedRule(
    decision: ExecutionContext['decision'],
    ruleSet: LoadedRuleSet,
  ): Maybe<Rule> {
    for (const loaded of ruleSet.rules) {
      if (decision.matchedRuleIds.includes(loaded.rule.id)) return loaded.rule;
    }
    return null;
  }
}
