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

import { buildDecisionRows } from './decisionRows.js';
import type { DecisionLogRepository } from './DecisionLogRepository.js';
import type { DecisionExecutor, ExecutionContext } from './types.js';

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

  /**
   * ⚠️ **`dryRun` is `true`, and that is accurate rather than a leftover.** If this executor is the
   * one wired, no action is possible at all, so every decision it records genuinely is a dry run.
   *
   * `SkipExecutor` passes BR-33.2's computed value instead, because it is the one holding an
   * `AutomationStateStore` to ask. Computing it here would mean giving this class that collaborator —
   * which is exactly what BR-30.2 exists to prevent.
   *
   * ⚠️ **The row building moved to `decisionRows.ts` and is NOT duplicated.** Both executors write
   * identical rows, and a second copy of forty lines carrying three deliberate subtleties is how the
   * WebSocket `403` happened.
   */
  execute(context: ExecutionContext): string {
    this.#log.record(buildDecisionRows(context, true));
    return context.evaluationId;
  }
}
