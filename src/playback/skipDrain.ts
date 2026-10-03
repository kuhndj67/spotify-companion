/**
 * **THE ACTION POINT.** 🔌 IMPURE (LC-26)
 *
 * The only code path in this project that causes a player command to be issued. Everything else in
 * U5 exists to decide whether this may run.
 *
 * ## ⚠️ Every safety check happens HERE, not when the decision was taken
 *
 * A decision is taken up to `ENRICHMENT_WAIT_MS` (10 s) before anything can act on it, and FR-38
 * requires that *no skip is issued after the switch is thrown*. Checking at decision time would let a
 * skip fire from a decision taken while automation was still on — which is exactly the guarantee the
 * kill switch makes (BR-33.5, P-27).
 *
 * ⚠️ **PBT-41 is the only property that can catch a violation of this**, because checking at decision
 * time is correct in every ordinary test: the two states agree whenever nothing changed in between.
 *
 * ## ⚠️ The queue is the `skip_attempt` table, and that needs TWO guards
 *
 * P-29 specified an in-memory queue, on the grounds that *a skip surviving a restart would fire into
 * whatever happens to be playing when the app returns*. This reads `queued()` from the database
 * instead, which is one source of truth rather than two that can disagree — an in-memory entry lost
 * between the `INSERT` and the push would leave a row queued forever.
 *
 * The risk P-29 named is covered twice over:
 *
 *   1. **The startup sweep** closes surviving `queued` rows as `refused: play-closed` before the first
 *      drain runs (`sweepOrphaned`).
 *   2. ⚠️ **And the play-open check would refuse them anyway.** After a restart `currentPlay()` reports
 *      a different `evaluationId`, so a stale attempt cannot match.
 *
 * Neither guard alone would be enough to drop the other: the sweep could be mis-wired, and a sweep
 * that never ran would still leave rows that the drain declines.
 *
 * ## ⚠️ `drain` never throws, and never runs concurrently
 *
 * An escaped rejection inside a timer is how a swallowed error becomes a skip that silently never
 * happened. And `drain` is called from two places — on enqueue, and from the 3 s tick as a backstop —
 * so without a re-entrancy guard two overlapping runs could both claim the same queued attempt and
 * both `POST`. **That would be a double skip, which is the harm this unit was sequenced into its own
 * phase to avoid.**
 */

import type { DecisionLogRepository } from '../rules/DecisionLogRepository.js';
import type { LoadedRuleSet, Maybe, Rule } from '../rules/types.js';
import type { AutomationStateStore } from './AutomationStateStore.js';
import { live } from './automationPredicate.js';
import { consecutiveRuleSkips, evaluateHalt, ruleSkipsInWindow } from './safetyCounters.js';
import type { PlayForCounting } from './safetyCounters.js';
import type { SkipAttemptRepository } from './SkipAttemptRepository.js';
import type { PlayerClient } from './spotifyPlayerClient.js';
import type { RefusalReason, RunawayHalt, SkipAttempt } from './types.js';
import {
  MAX_RULE_SKIPS_PER_HOUR,
  RULE_SKIP_WINDOW_MS,
  SKIP_CONFIRMATION_GRACE_MS,
} from './types.js';

/** What the player is reporting right now, as the drain needs it. */
export interface CurrentPlay {
  /** ⚠️ The per-play key the attempt is matched against — see `SkipAttempt.evaluationId`. */
  readonly evaluationId: string;
  readonly trackId: string;
  readonly progressMs: number;
}

export interface SkipDrainDeps {
  readonly attempts: SkipAttemptRepository;
  readonly state: AutomationStateStore;
  readonly decisions: DecisionLogRepository;
  readonly ruleSet: () => LoadedRuleSet;
  /** `HistoryRepository.recentPlaysForCounting` only — the drain has no business with the rest. */
  readonly recentPlays: (limit: number) => readonly PlayForCounting[];
  readonly player: PlayerClient;
  /** `null` when nothing is playing. */
  readonly currentPlay: () => CurrentPlay | null;
  readonly nowIso: () => string;
  readonly nowMs: () => number;
  /** Injected so the BR-43.4 grace does not make tests wait three seconds. */
  readonly delay: (ms: number) => Promise<void>;
  /** Called when a halt is latched, so the UI can be told without the drain knowing about the UI. */
  readonly onHalt?: (halt: RunawayHalt) => void;
}

/** How many recent plays the consecutive counter looks back over. */
const CONSECUTIVE_LOOKBACK = 20;

export class SkipDrain {
  readonly #deps: SkipDrainDeps;
  #draining = false;

  constructor(deps: SkipDrainDeps) {
    this.#deps = deps;
  }

  /**
   * Close every `queued` row left over from a previous process.
   *
   * ⚠️ **Must run before the first `drain`** (wiring constraint, Step 10). A surviving `queued` row is
   * one whose drain never ran, and firing it would skip whatever happens to be playing now rather than
   * the track the rule matched.
   *
   * ⚠️ **Closed as `refused: play-closed`, not deleted.** An attempt that never fired because the app
   * restarted must stay distinguishable from one that never existed (P-28) — *why is this absent* is
   * never inferred from the absence.
   */
  sweepOrphaned(): number {
    const orphans = this.#deps.attempts.queued();
    for (const attempt of orphans) {
      this.#deps.attempts.transition(attempt.id, 'refused', { refusedReason: 'play-closed' });
    }
    return orphans.length;
  }

  /**
   * Drain the queue. Safe to call from the enqueue path and from the tick.
   *
   * ⚠️ Returns without doing anything if a drain is already in flight.
   */
  async drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      for (const attempt of this.#deps.attempts.queued()) {
        // ⚠️ Each attempt is isolated. One attempt's failure must not abandon the rest of the queue,
        // and it must never escape into the timer that called this.
        try {
          await this.#process(attempt);
        } catch (error) {
          this.#deps.attempts.transition(attempt.id, 'unconfirmed', {
            firedAt: this.#deps.nowIso(),
          });
          console.error(
            `[skip] attempt ${attempt.id} failed unexpectedly: ${describe(error)}. ` +
              `Recorded unconfirmed and NOT retried (BR-43.5).`,
          );
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  async #process(attempt: SkipAttempt): Promise<void> {
    const { attempts, state, decisions, ruleSet, player, currentPlay, nowIso, nowMs, delay } =
      this.#deps;

    const refuse = (reason: RefusalReason): void => {
      attempts.transition(attempt.id, 'refused', { refusedReason: reason });
    };

    // ── ① automation, halt, and the rule as it stands NOW ────────────────────────────────────────
    //
    // ⚠️ Re-read from disk. NOT a value captured when the decision was taken, and not a cached copy —
    // the whole point of the action point is that this may have changed in the last 10 seconds. P-32:
    // a guard that cannot observe the condition it guards is worse than no guard.
    const { state: automation } = state.read();
    const rule = findRule(ruleSet(), attempt.ruleId);
    const verdict = live(automation, rule);
    if (!verdict.live) {
      refuse(verdict.reason);
      return;
    }

    // ── ② is this still the play the rule matched? ───────────────────────────────────────────────
    //
    // ⚠️ Checked BEFORE cancellation: if the play has ended there is nothing to cancel and nothing to
    // skip, and `play-closed` is the primary fact. ⚠️ Normal for a short play; a signal if frequent.
    const playing = currentPlay();
    if (playing === null || playing.evaluationId !== attempt.evaluationId) {
      refuse('play-closed');
      return;
    }

    // ── ③ did a re-evaluation withdraw it? (BR-37.5) ─────────────────────────────────────────────
    //
    // ⚠️ A PULL, not a push. Nothing calls `cancel` — see `DecisionLogRepository`. A re-evaluation
    // writes a new row for the same `evaluationId`, and if the newest one no longer matches, the
    // attempt is withdrawn here.
    //
    // ⚠️ And the asymmetry is the point (BR-37.6): a re-evaluation may CANCEL, and may never CREATE.
    // The direction that errs toward not acting is the safe one, so an absent decision row is not
    // treated as permission.
    const latest = decisions.latestForEvaluationAndRule(attempt.evaluationId, attempt.ruleId);
    if (latest !== null && !latest.matched) {
      attempts.transition(attempt.id, 'cancelled');
      return;
    }

    // ── ④ the hourly safety limit (BR-35.2) ─────────────────────────────────────────────────────
    const windowStart = new Date(nowMs() - RULE_SKIP_WINDOW_MS).toISOString();
    const fired = attempts.firedSince(windowStart);
    const inWindow = ruleSkipsInWindow(
      fired.map((f) => f.firedAtMs),
      nowMs(),
    );
    // ⚠️ THE CONSTANT, never a literal. An earlier draft of this line wrote `>= 10`, which is a second
    // copy of a pre-registered safety threshold -- the defect `attribute-skips.mjs` shipped with its own
    // copy of USER_SKIP_RATIO_CEILING, where the two could drift apart silently.
    if (inWindow >= MAX_RULE_SKIPS_PER_HOUR) {
      // ⚠️ Our own cap, deliberately distinct from Spotify returning 429 (`upstream-rate-limited`).
      refuse('rate-limited');
      return;
    }

    // ── ⑤ evidence BEFORE the POST (BR-43.2) ────────────────────────────────────────────────────
    //
    // ⚠️ Written before the request, not after, so a crash mid-request still leaves a record of what
    // was true when we decided to act.
    attempts.transition(attempt.id, 'queued', {
      reportedTrackIdBefore: playing.trackId,
      reportedProgressMsBefore: playing.progressMs,
    });

    // ── ⑥ THE ONLY PLAYER COMMAND IN THIS PROJECT ───────────────────────────────────────────────
    //
    // ⚠️ Fires on the reported track boundary, with NO lag guard and NO compensating delay (BR-43.1).
    // Probe P-U5-1 measured the audio following the reported boundary within ~2 s, so a skip there
    // costs 2–3 s — not the 18–41 s the design plan predicted. And no fixed offset is applied
    // anywhere (P-34): the DJ has at least three transition behaviours and one of them has a NEGATIVE
    // audio lag, so even the sign varies.
    const outcome = await player.skipToNext();

    if (outcome.kind === 'refused') {
      // The edge declined and nothing reached the device (P-30). Not an attempt, not retried.
      refuse(outcome.reason);
      return;
    }

    const firedAt = nowIso();

    if (outcome.kind === 'failed') {
      // ⚠️ Landing UNKNOWN, so it counts as having landed: surfaced, never retried (P-30, BR-43.5).
      attempts.transition(attempt.id, 'unconfirmed', { firedAt });
      console.error(`[skip] attempt ${attempt.id} may or may not have landed: ${outcome.detail}`);
      return;
    }

    attempts.transition(attempt.id, 'fired', { firedAt });

    // ── ⑦/⑧ confirmation, after the BR-43.4 grace ───────────────────────────────────────────────
    //
    // ⚠️ The grace is a TOLERANCE, never a compensation. A check at +1.5 s can precede the audio, and
    // nothing in the API predicts which transition behaviour is coming.
    await delay(SKIP_CONFIRMATION_GRACE_MS);
    const after = currentPlay();

    const didConfirm = confirmed(playing, after);
    attempts.transition(attempt.id, didConfirm ? 'confirmed' : 'unconfirmed', {
      reportedTrackIdAfter: after?.trackId ?? null,
      reportedProgressMsAfter: after?.progressMs ?? null,
    });

    if (!didConfirm) {
      // ⚠️ Surfaced, never retried (BR-43.5). The UI's `failed` indicator reads this state.
      console.warn(
        `[skip] attempt ${attempt.id} was NOT confirmed — reported track ` +
          `${after?.trackId ?? 'none'} at ${after?.progressMs ?? '—'}ms. Not retried.`,
      );
    }

    // ── ⑨ did that trip a halt? (BR-35.1/35.2) ──────────────────────────────────────────────────
    this.#checkHalt(automation);
  }

  /**
   * ⚠️ The halt is a **separate latch**, written alongside the kill switch but never *as* it
   * (BR-33.4, BR-35.5). One flag with two causes would make the system's halt indistinguishable from
   * the user's own choice, and clearing it would read as re-arming rather than acknowledging.
   */
  #checkHalt(automationAtStart: { globalAutomationEnabled: boolean }): void {
    const { attempts, recentPlays, state, nowMs, onHalt } = this.#deps;

    const consecutive = consecutiveRuleSkips(recentPlays(CONSECUTIVE_LOOKBACK));
    const windowStart = new Date(nowMs() - RULE_SKIP_WINDOW_MS).toISOString();
    const fired = attempts.firedSince(windowStart);
    const inWindow = ruleSkipsInWindow(
      fired.map((f) => f.firedAtMs),
      nowMs(),
    );

    const trigger = evaluateHalt(consecutive, inWindow);
    if (trigger === null) return;

    const halt: RunawayHalt = {
      haltedAt: new Date(nowMs()).toISOString(),
      trigger: trigger.trigger,
      observedCount: trigger.observedCount,
      // ⚠️ The limit in force AT THIS MOMENT, denormalised so a later change to the constant cannot
      // silently rewrite history.
      threshold: trigger.threshold,
      // ⚠️ REAL attempt ids, so BR-35.8's review has rows to open. An earlier draft synthesised these
      // from array indices, which would have pointed the user at attempts that do not exist -- in the
      // one place they are asked to review evidence before clearing a safety latch.
      attemptIds: fired.map((f) => f.id),
    };

    // ⚠️ Written, not merely reported. BR-35.7: the halt persists across restart and fails closed.
    const written = state.write({
      globalAutomationEnabled: automationAtStart.globalAutomationEnabled,
      runawayHalt: halt,
      schemaVersion: 1,
    });

    if (!written.ok) {
      // ⚠️ A halt that could not be persisted is still in force for this process, and saying so is
      // the honest report. It will be lost on restart — but on restart the counters reset too, and an
      // unreadable state file means automation is off anyway (BR-34.5).
      console.error(
        `[skip] RUNAWAY HALT latched but could NOT be persisted: ${written.reason}. ` +
          `It will not survive a restart.`,
      );
    }
    console.error(
      `[skip] RUNAWAY HALT: ${halt.trigger}, observed ${halt.observedCount} against a ` +
        `threshold of ${halt.threshold}. Automation is halted until acknowledged (BR-35.6).`,
    );
    onHalt?.(halt);
  }
}

/**
 * ⚠️ BR-43.3: `progress_ms` **reset** AND a track-id change. Both, not either.
 *
 * Either alone is reachable without a skip: `progress_ms` goes backwards when the listener seeks, and
 * the track id changes on its own at every natural boundary. Requiring both is what distinguishes
 * *we skipped it* from *it ended*.
 *
 * ⚠️ **Takes the `CurrentPlay` captured before the POST, NOT the `SkipAttempt` row.** An earlier
 * draft read `attempt.reportedTrackIdBefore`, which is loaded from the database *before* the evidence
 * transition writes it — so both comparisons were against `null` and **every skip confirmed**. The
 * failure mode was a permanently green light: `confirmed` asserting something nobody had checked, which
 * is exactly what `frontend-components.md` §5 warns is worse than no indicator at all. Caught by the
 * "track change without a progress reset" test, 2026-10-02.
 */
function confirmed(before: CurrentPlay, after: Maybe<CurrentPlay>): boolean {
  if (after === null) return false;
  const trackChanged = after.trackId !== before.trackId;
  const progressReset = after.progressMs < before.progressMs;
  return trackChanged && progressReset;
}

function findRule(set: LoadedRuleSet, ruleId: string): Maybe<Rule> {
  for (const loaded of set.rules) {
    if (loaded.rule.id === ruleId) return loaded.rule;
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
