/**
 * Playback action types — the vocabulary of U5. ⚙️ PURE
 *
 * ## ⚠️ Why these live here and not in `src/rules/types.ts`
 *
 * The code-generation plan originally listed them beside the moved `DecisionExecutor`. That is
 * wrong for everything in this file: these are **action** entities, and `src/rules/` is the module
 * group that is *forbidden from knowing about actions*.
 *
 * `src/playback/` → `src/rules/` is allowed. `src/rules/` → `src/playback/` is what the phase-boundary
 * test refuses (P-33), because it is what replaced U4's *`src/playback/` does not exist* guard.
 * Declaring `SkipAttempt` in `src/rules/types.ts` would not have broken that test — it would have
 * removed the signal that tells the next person adding a field which side of the boundary they are on.
 *
 * ## The shape of everything here follows from one asymmetry
 *
 * A skip that should have happened and did not is recoverable — the listener presses a button. A skip
 * that should not have happened is **not recoverable at all**. So every type below can express
 * *refused*, and none of them can express *retried*.
 */

import type { Maybe } from '../rules/types.js';

/**
 * A skip, as a record rather than a side effect.
 *
 * ⚠️ This entity exists because `DecisionExecutor.execute` is **synchronous** and is called unawaited
 * from a timer, so an HTTP `POST` cannot live there (BR-42). `SkipExecutor.execute` enqueues one of
 * these and returns; a separate drain performs the request.
 */
export interface SkipAttempt {
  readonly id: number;
  /**
   * ⚠️ **THE ONE-ATTEMPT-PER-PLAY GUARD KEYS ON THIS** (BR-36.1), not on `playId`.
   *
   * `evaluationId` is created once per play in `PlayObserver`'s `onPlayStarted` and is shared by both
   * decision passes (`initial` and `enrichment-arrived`). It is the per-play identifier that exists
   * **while the play is open**, which is when a skip has to happen.
   *
   * Also joins to `DecisionLogEntry`, which uses the same key for the same reason.
   */
  readonly evaluationId: string;
  /**
   * ⚠️ **NULLABLE, and the Functional Design said the opposite — corrected 2026-10-02.**
   *
   * `domain-entities.md` §1 specified non-nullable, reasoning that *"an attempt without a play has
   * nothing to be one-per"*. The reasoning is sound and the conclusion was **impossible**:
   * `PlayObserver` writes the play row in `recordPlay`, which runs when the play **closes**. A skip
   * must happen **while the play is still playing**, so at the action point there is no `playId`.
   *
   * ⚠️ **Non-nullable would have thrown a constraint violation on the first real skip** — in the one
   * unit whose failures are audible. Found while writing the drain, before migration 007 had run.
   *
   * The guard keys on **`evaluationId`** instead (see below). This is backfilled when the play closes,
   * exactly as `DecisionLogEntry.playId` already is. `null` means *the play had not been written yet*,
   * never *there was no play*.
   */
  readonly playId: Maybe<number>;
  /** The track the **rule matched** — not necessarily the one playing when the drain runs. */
  readonly trackId: string;
  readonly ruleId: string;
  readonly state: SkipAttemptState;
  readonly enqueuedAt: string;
  /** When the `POST` was issued. `null` while queued, or if the attempt never fired. */
  readonly firedAt: Maybe<string>;
  /**
   * ⚠️ **Why nothing happened.** Never inferred from `firedAt` being null.
   *
   * A skip that did not happen has several plausible causes, some of them correct behaviour and some
   * of them defects, and `firedAt === null` cannot tell them apart. This is U4's `playLink` lesson at
   * higher stakes: *why is this absent* must never be inferred from the absence itself.
   */
  readonly refusedReason: Maybe<RefusalReason>;
  /** Evidence: what the API reported immediately before the `POST` (BR-43.2). */
  readonly reportedTrackIdBefore: Maybe<string>;
  readonly reportedProgressMsBefore: Maybe<number>;
  /** Evidence: and immediately after, for the BR-43.3 confirmation. */
  readonly reportedTrackIdAfter: Maybe<string>;
  readonly reportedProgressMsAfter: Maybe<number>;
}

/** A `SkipAttempt` before it has an id. */
export type NewSkipAttempt = Omit<SkipAttempt, 'id'>;

/**
 * ⚠️ There is no `retrying` member, and there is no attempt counter. **Surface, do not retry**
 * (FR-48, BR-36.4): one attempt is the budget, and a failed attempt does not earn another.
 */
export type SkipAttemptState =
  /** Enqueued, not yet drained. */
  | 'queued'
  /**
   * A re-evaluation withdrew it before it fired (BR-37.5).
   *
   * ⚠️ Reached by the drain **reading the latest decision for the play**, not by anything calling a
   * `cancel` method — see the note on `DecisionExecutor`. A pull, not a push.
   */
  | 'cancelled'
  /** The action point declined it. `refusedReason` says why. */
  | 'refused'
  /** The `POST` was issued. */
  | 'fired'
  /** `progress_ms` reset **and** the track id changed, within the BR-43.4 grace (BR-43.3). */
  | 'confirmed'
  /** Fired, and the confirmation did not hold. **Failed and surfaced, never retried** (BR-43.5). */
  | 'unconfirmed';

/**
 * Why an attempt did not fire. ⚠️ Most are correct behaviour and two are defect signals, which is why
 * the reason is stored rather than derived from `firedAt` being null.
 *
 * ## ⚠️ TWO FAMILIES, and the FD's list only covered the first
 *
 * **We declined** — an internal check at the action point said no. These are the six refusal points
 * the Functional Design enumerated, plus the two rule-level cases its list had no member for.
 *
 * **The edge declined** — the request never reached the device. These came from **P-30**, which
 * resolved the conflict between NFR-17's *retry a 429* and BR-43.5's *never retry a skip*. The FD's
 * reason list was derived from the refusal **points** and did not contemplate **transport**, which is
 * why three members were added during Step 3 and Step 5 rather than designed up front.
 */
export type RefusalReason =
  /** Correct — FR-47's default. */
  | 'automation-off'
  /** Correct — the system protecting the listener (BR-35.4). */
  | 'runaway-halted'
  /** Correct — the arming gate working (BR-33.2). */
  | 'rule-dry-run'
  /**
   * ⚠️ **The user disabled the rule between the decision and the action** (BR-33.2's
   * `rule.enabled` term).
   *
   * ⚠️ **Added 2026-10-02; the FD's reason list had no member for this.** `RuleEngine` skips
   * disabled rules entirely (`RuleEngine.ts:51`), so it looks unreachable — but the predicate is
   * evaluated **at the action point**, up to `ENRICHMENT_WAIT_MS` after the decision, and
   * `RuleSetWatcher` can reload the file in that window. A rule enabled when the decision was taken
   * and disabled when the attempt drained is exactly the case the action-point check exists for.
   */
  | 'rule-disabled'
  /**
   * ⚠️ **The rule was removed from the rules file between the decision and the action.**
   *
   * Distinct from `rule-disabled` on purpose: *the user switched this off* and *the user deleted
   * this* are different facts, and a reader reconstructing why a skip did not happen needs to know
   * which. Same reasoning as `RuleStatus` keeping the system's determination separate from the
   * user's `enabled` switch.
   */
  | 'rule-gone'
  /** Correct — BR-36's loop guard. One attempt per **play row**. */
  | 'already-attempted'
  /** ⚠️ Either: normal for a short play, a signal if frequent (BR-42.5). */
  | 'play-closed'
  /** ⚠️ Probably a defect somewhere — 10/hour is below the median *play* rate (BR-35.2). */
  | 'rate-limited'
  // ─── the edge declined: nothing reached the device (P-30) ────────────────────────────────────
  /**
   * ⚠️ **Spotify reports no active device** — HTTP 404. The listener stopped playing between the
   * drain's play-open check and the `POST`.
   *
   * ⚠️ **Added 2026-10-02, and classified as a REFUSAL rather than a failure on purpose.** It is
   * benign and provable: nothing happened, and the cause is the user's own action. In the `failed`
   * bucket it would read as a defect every time someone pressed stop — which is the *empty state that
   * does not explain itself* failure, in a column meant to explain things.
   */
  | 'no-active-device'
  /**
   * ⚠️ **Spotify returned 429.** Deliberately distinct from `rate-limited`, which is *our own*
   * hourly safety cap — a completely different fact. Conflating them would make the runaway halt's
   * evidence unreadable, and the halt's only job is to say what tripped it.
   *
   * ⚠️ The request provably never reached the device, but the `Retry-After` is **not honoured**:
   * waiting 30 s and then posting `next` is *"skip whatever is playing in 30 seconds"*, which is not
   * the action that was decided (P-30).
   */
  | 'upstream-rate-limited';

/**
 * The persisted latches. ⚠️ **Two independent fields, never collapsed into one** (BR-35.5): the user
 * turning automation off and the system halting itself are different facts, and clearing them are
 * different acts.
 */
export interface AutomationState {
  /** FR-47. **Defaults to `false`** — a fresh install, a missing file and an unreadable file all mean off. */
  readonly globalAutomationEnabled: boolean;
  /** `null` when not halted. Present ⇒ halted, and only an explicit acknowledgement clears it. */
  readonly runawayHalt: Maybe<RunawayHalt>;
  /** So a future format change is detectable rather than silently misread. */
  readonly schemaVersion: number;
}

/** The third latch, distinct from the FR-38 kill switch (BR-35.5). */
export interface RunawayHalt {
  readonly haltedAt: string;
  readonly trigger: 'consecutive' | 'hourly-rate';
  readonly observedCount: number;
  /**
   * The limit in force **at that moment** — denormalised on purpose.
   *
   * ⚠️ The thresholds are pre-registered safety limits, not tuning parameters. Storing the value that
   * was in force means a later change to the constant cannot silently rewrite history, and if someone
   * does raise the number after a halt, the record shows the halt was against the old one.
   */
  readonly threshold: number;
  /** The attempts that counted, so BR-35.8's review has something to open. */
  readonly attemptIds: readonly number[];
}

/** The outcome of persisting state. ⚠️ Returned rather than thrown — see `AutomationStateStore`. */
export type WriteOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * ⚠️ **Pre-registered safety limits, NOT tuning parameters, and deliberately NOT environment
 * variables** (Infrastructure Q4).
 *
 * `compose.yaml` already holds `POLL_INTERVAL_MS`, `RULES_POLL_INTERVAL_MS` and
 * `ENRICHMENT_WAIT_MS`, so putting a number there is the habit in this project — which is exactly
 * why this exception is stated rather than assumed.
 *
 * ⚠️ **The halt fires during normal listening, not only when something is broken.** The busiest hour
 * in the corpus held **27 plays**, so 10 rule-skips per hour is reached by any rule matching more than
 * **37%** of tracks. If these lived in `compose.yaml`, the easy response to a halt would be to raise
 * the number until it stopped firing — after which the halt remains in the code and prevents nothing.
 *
 * BR-35: *"If a legitimate rule trips the halt, that is information about the rule."* Change them by
 * amending the pre-registration, never by editing code to make a favourite rule work.
 */
/**
 * BR-35.1. ⚠️ **THE FOURTH CONSECUTIVE SKIP IS THE ONE THAT LATCHES THE HALT, not the third.**
 *
 * The counter reads **closed** plays, and the skip that triggers the check has not closed yet — the
 * track change it causes is what closes it. So at the check following skip N the counter sees at most
 * N−1 closed rule-skips:
 *
 * | skip | counter sees | halt? |
 * |---|---|---|
 * | 1 | 0 | no |
 * | 2 | 1 | no |
 * | 3 | 2 | no |
 * | **4** | **3** | ⚠️ **yes** |
 *
 * **Four tracks are skipped before automation stops.** Measured and pinned by
 * `ruleSkipAgreement.test.ts`.
 *
 * ⚠️ **This is inherent to counting closed plays**, not an implementation slip, and it is **accepted**
 * (user, 2026-10-04) on the condition that it is stated **wherever the threshold is stated**. Anything
 * that says "3" without saying "the 4th skip latches it" under-describes the behaviour by one track.
 *
 * ⚠️ A pre-registered constant, not a setting — see `safety-thresholds/pre-registration.md`.
 */
export const MAX_CONSECUTIVE_RULE_SKIPS = 3;
export const MAX_RULE_SKIPS_PER_HOUR = 10;

/** The rolling window `MAX_RULE_SKIPS_PER_HOUR` is measured over. ⚠️ Rolling, not a calendar hour. */
export const RULE_SKIP_WINDOW_MS = 60 * 60 * 1000;

/**
 * How long after the `POST` a skip may still be confirmed (BR-43.4).
 *
 * ⚠️ **A tolerance, never a compensation.** Probe P-U5-1 found the DJ has at least three transition
 * behaviours and that `dj-talk`'s audio lag is **negative** — so even the *sign* of the offset varies,
 * and nothing in the API predicts which is coming. A check at +1.5 s can precede the audio, which is
 * what this grace absorbs. **No fixed offset may be assumed anywhere** (P-34).
 */
export const SKIP_CONFIRMATION_GRACE_MS = 3_000;
