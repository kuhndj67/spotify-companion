/**
 * Rule model types — the vocabulary of the rules engine. ⚙️ PURE
 *
 * ## Why `Verdict` is a string union and not `boolean | null`
 *
 * `null` in a boolean position is the exact shape that invites `if (v)` and collapses `unknown`
 * to `false` — the failure NFR-25 exists to prevent, and the one this project has already made
 * three times in other clothes (`error` recorded as `unknown`, backfilled plays merged into
 * `completed`, two causes of a missing label averaged into one rate).
 *
 * A string union has **no falsy member**. `if (verdict)` is always true, so the collapse cannot
 * be written by accident; it has to be spelled out, at which point it is visible in review.
 *
 * ## The one asymmetry worth knowing about
 *
 * `false AND unknown` is `false` (BR-14.3) — a decisive known operand wins, because no value the
 * unknown could take would change the answer. That is *not* the same as treating `unknown` as
 * `false`, which BR-14.2 forbids. A test asserting `false AND unknown === 'false'` and a test
 * asserting `unknown === 'false'` look alike and mean opposite things.
 */

/** Three-valued result. Never `boolean | null` — see the header. */
export type Verdict = 'true' | 'false' | 'unknown';

/**
 * A value that may be absent. `null` means **unknown** and is never `false` or `0`.
 *
 * Project-wide convention, unchanged since U1. History counts are `Maybe<number>` precisely so
 * that "never seen" is distinguishable from "seen zero times": a `0` default would make
 * "never skipped this track" silently true for a track never played (US-16).
 */
export type Maybe<T> = T | null;

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum';

/** How often a field carries a value. About PRESENCE — see `FieldDefinition.note` for standing. */
export type Availability = 'always' | 'usually' | 'often-unknown';

/**
 * Comparison operators.
 *
 * ⚠️ **`exists` is deliberately absent** (BR-15.5). Under tri-state semantics it had only two
 * reachable results — `true` for a present field, `unknown` for a missing one — so it could never
 * return `false`, and `not(exists(f))` evaluated to `not(unknown)` = `unknown`: exactly the
 * question it was meant to answer, unanswered. `is-unknown` returns a clean `true`/`false` and
 * `not(is-unknown(f))` is the other direction. One obvious way to write each.
 */
export type Operator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'contains'
  | 'is-unknown';

/**
 * One referenceable field.
 *
 * `availability` and `note` answer different questions and are never merged (BR-16.3):
 * availability says how often the field is *there*; `note` says what it is *worth*.
 */
export interface FieldDefinition {
  /** Dotted path, e.g. "label.classification". Stable — rules persist across restarts. */
  readonly name: string;
  readonly type: FieldType;
  readonly description: string;
  readonly enumValues?: readonly string[];
  readonly availability: Availability;
  /** Evidential standing, surfaced wherever the field is offered (BR-16.4, BR-16.5). */
  readonly note?: string;
  /** True only for `artist.genres`. The author still sees a string field (BR-17.3). */
  readonly multiValued?: boolean;
  readonly read: (facts: TrackFacts) => Maybe<unknown>;
}

/**
 * A predicate tree (FR-43).
 *
 * **There is no expression string anywhere in this type**, which is how FR-44 is satisfied:
 * structurally, not by discipline. There is nothing to `eval` because a predicate is never text.
 *
 * `value` is optional because `is-unknown` takes none; every other operator requires one and the
 * validator enforces it.
 */
export type Predicate =
  | { readonly kind: 'compare'; readonly field: string; readonly op: Operator; readonly value?: unknown }
  | { readonly kind: 'and'; readonly operands: readonly Predicate[] }
  | { readonly kind: 'or'; readonly operands: readonly Predicate[] }
  | { readonly kind: 'not'; readonly operand: Predicate };

/** Enumerated, never a boolean (FR-26). `skip` is the only member at U3. */
export type RuleAction = 'skip';

/**
 * What a rule does when its predicate returns `unknown` (FR-33).
 *
 * ⚠️ `'hold'` is **accepted and stored but not implemented here**. It needs a deadline and a
 * re-evaluation trigger, neither of which exists in a pure synchronous module. A rule declaring
 * it loads, is disabled with reason `unsupported-on-unknown`, and begins working when U5 lands —
 * without being re-authored. **FR-33 is discharged by U5, not U3.**
 */
export type OnUnknown = 'no-match' | 'match' | 'hold';

export interface Rule {
  readonly id: string;
  readonly name: string;
  /** The USER's switch (FR-25, FR-31). Never written by the system — see `RuleStatus`. */
  readonly enabled: boolean;
  readonly action: RuleAction;
  readonly onUnknown: OnUnknown;
  readonly predicate: Predicate;
  /**
   * U4, BR-25.1. Per-rule dry-run: evaluate and record, never act.
   *
   * ⚠️ **Optional, defaulting to `false`, and inert in U4** — `globalAutomationEnabled` is a
   * constant `false`, so every decision is dry-run regardless of what this says. It exists now
   * for the same reason `onUnknown: 'hold'` is stored and disabled rather than rejected: a rule
   * authored today keeps working when U5 arms automation, instead of needing to be rewritten
   * at the moment the stakes become real.
   *
   * ⚠️ **A rule cannot opt OUT of a global dry-run** (BR-25.2). `false` here means "this rule
   * does not add a dry-run of its own", never "run this one for real".
   */
  readonly dryRun?: boolean;
}

export type DisabledReason =
  /** The field no longer exists in the catalogue. Migration 004 made this real (BR-18.4). */
  | 'unknown-field'
  /** Operator not valid for the field's type, or a missing/ill-typed operand. */
  | 'type-mismatch'
  /** Tree deeper than MAX_PREDICATE_DEPTH (BR-18.6a). */
  | 'too-deep'
  /** `onUnknown: 'hold'` — deferred to U5 (BR-18.6). */
  | 'unsupported-on-unknown';

/**
 * The SYSTEM's determination, kept separate from the user's `enabled` switch (BR-18.2).
 *
 * ⚠️ **Merging these two loses the reason.** `enabled: false` means *the user turned this off*;
 * `disabled` means *the system cannot evaluate this*. If the system quietly cleared the user's
 * flag, they would see their own toggle switched off with no explanation — the "empty state that
 * does not explain itself" failure, with consequences once U5 can act.
 */
export type RuleStatus =
  | { readonly state: 'active' }
  | { readonly state: 'disabled'; readonly reason: DisabledReason; readonly detail: string };

export interface LoadedRule {
  readonly rule: Rule;
  readonly status: RuleStatus;
}

export type LabelClass = 'major' | 'independent' | 'unknown';

export type LikedTransition =
  | 'kept-liked'
  | 'kept-unliked'
  | 'liked-during'
  | 'unliked-during'
  | 'unknown';

/**
 * Everything a rule may read about the track being evaluated.
 *
 * ## `context` is deliberately absent (BR-16.6)
 *
 * `context_type` is NULL on all 342 live plays and populated on all 85 backfilled ones — the MCP
 * `getNowPlaying` returns no context field, while `recently-played` does. A rule evaluates on the
 * live path, so the field would be `unknown` 100% of the time in production while back-testing
 * (FR-42) as richly populated. **A field that back-tests as available and is never available live
 * is worse than an absent one**: it would validate a rule that cannot work.
 *
 * `context.deviceName` is absent for a different reason — its live availability has never been
 * probed, and this project does not add fields on the assumption that an upstream returns them.
 * That assumption has been wrong four times.
 */
export interface TrackFacts {
  readonly track: {
    readonly id: string;
    readonly title: string;
    readonly durationMs: number;
    readonly explicit: Maybe<boolean>;
    readonly isrc: Maybe<string>;
  };
  readonly artist: {
    readonly id: Maybe<string>;
    readonly name: string;
    readonly following: Maybe<boolean>;
    /**
     * ⚠️ Three distinguishable states, and the distinction is load-bearing (BR-17.6):
     *   `null` — MusicBrainz has not been asked, or the artist is uncatalogued (39 plays)
     *   `[]`   — MusicBrainz WAS asked and lists no genres (131 plays)
     *   [...]  — genres known (258 plays)
     * Collapsing `[]` into `null` repeats the 2026-09-06 `unknown`-merge defect.
     */
    readonly genres: Maybe<readonly string[]>;
  };
  readonly album: {
    readonly name: string;
    /** `YYYY-MM-DD` on 423 plays, bare `YYYY` on 5. Partial dates are rare but real. */
    readonly releaseDate: Maybe<string>;
    readonly ageYears: Maybe<number>;
    readonly type: Maybe<string>;
  };
  readonly label: {
    readonly name: Maybe<string>;
    readonly classification: Maybe<LabelClass>;
    readonly confidence: Maybe<string>;
  };
  readonly liked: {
    readonly atStart: Maybe<boolean>;
    readonly transition: Maybe<LikedTransition>;
  };
  readonly history: {
    readonly playsOfTrack: Maybe<number>;
    readonly skipsOfTrack: Maybe<number>;
    readonly playsOfArtist: Maybe<number>;
    readonly skipsOfArtist: Maybe<number>;
  };
  /**
   * Evaluation instant, passed IN as data. Not a catalogue field and never readable by a rule.
   *
   * This is what makes FR-20 recomputation and FR-42 back-testing reproduce live decisions
   * exactly (NFR-26). A `Date.now()` in this unit would break both **while every other test
   * passed** — `test/purity.test.ts` is the only thing that catches it.
   */
  readonly evaluatedAtMs: number;
}

export interface RuleOutcome {
  readonly ruleId: string;
  /** The raw predicate result, before `onUnknown` is applied. */
  readonly verdict: Verdict;
  /** After the `onUnknown` mapping. */
  readonly applied: Verdict;
  /**
   * ⚠️ True **iff `verdict === 'unknown'`** — never accumulated while walking the tree (BR-19.6).
   *
   * Q1 chose Kleene semantics AND Kleene reporting. Option C — raising the flag whenever an
   * unknown appeared anywhere in the tree — was offered and NOT chosen. A rule that read one
   * unknown field but still resolved decisively is not resting on unknown: the data answered it.
   * The tempting implementation, a flag accumulated during the walk, silently produces option C.
   */
  readonly restedOnUnknown: boolean;
  /** What this rule actually read. Complete, because evaluation is exhaustive (BR-14.7). */
  readonly fieldsSeen: Readonly<Record<string, unknown>>;
}

export interface DisabledRuleReport {
  readonly ruleId: string;
  readonly reason: DisabledReason;
  readonly detail: string;
}

export interface Decision {
  readonly action: RuleAction | 'none';
  readonly matchedRuleIds: readonly string[];
  /** EVERY evaluated rule, matched or not — U4's observability needs the complete record. */
  readonly outcomes: readonly RuleOutcome[];
  readonly disabledRules: readonly DisabledRuleReport[];
  /** Scoped to the MATCHED rules: did the action we are about to take rest on absent data? */
  readonly restedOnUnknown: boolean;
  /** Union of catalogue fields that read `unknown` on this evaluation (NFR Q4 = B). */
  readonly unknownFields: readonly string[];
  /**
   * FR-35. ⚠️ **Supplied by the caller, never inferred** (P-17).
   *
   * Inferring it from `often-unknown` fields reading `unknown` cannot distinguish "not yet
   * resolved" from "resolved, and the answer is nothing" — the distinction that has caught this
   * project three times. The caller knows what it was waiting for; this unit does not, and does
   * not guess. R11 makes this the common case, not the edge.
   */
  readonly partialData: boolean;
}

/** Result of validation. `ok` carries the value; otherwise `errors` says why, usably. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Bounds. ⚠️ **Constants, not settings.**
 *
 * Following the precedent `compose.yaml` sets for the MusicBrainz request spacing: a knob here
 * would exist only to violate the policy — most likely while debugging, and then forgotten. A
 * depth limit that can be raised from the environment will be raised at the moment it first
 * refuses something, which is the moment it is doing its job.
 */

/** Deep enough for any hand-written rule, far below any stack limit (P-10). */
export const MAX_PREDICATE_DEPTH = 32;

/** Generous by orders of magnitude against any real rule set. */
export const MAX_RULES = 1000;

/** 1 MiB. */
export const MAX_RULES_FILE_BYTES = 1_048_576;

/** Bumped when evaluation semantics change in a way that could alter a `Decision`. */
export const RULE_ENGINE_VERSION = 1;

// ---------------------------------------------------------------------------
// U4 — observability. The types that make a `Decision` durable, attributable
// and replayable. `Decision` itself is UNMODIFIED: U3 built it for this.
// ---------------------------------------------------------------------------

/**
 * Why a decision row has no `playId` (BR-24.3a).
 *
 * ⚠️ **Without this, a permanent `null` would mean two incompatible things.** `PlayObserver`
 * fires `onPlayRecorded` *only after* `recordPlay` succeeds; when the write throws it counts a
 * gap, sets `degraded`, and the hook never runs — leaving `playId` null for ever, exactly as if
 * the play had never closed. One of those is an expected W-3 case; the other is the database
 * refusing a write to the one artefact here that cannot be regenerated.
 *
 * Same family as `error` is not `unknown`, which produced three U2 defects that all passed the
 * full suite.
 */
export type PlayLinkState =
  /** The play has not closed yet. Normal for seconds to minutes after the decision. */
  | 'pending'
  /** `playId` is set. */
  | 'linked'
  /** The play closed and its row could not be written. The link will never arrive. */
  | 'link-failed';

/**
 * One row per **rule evaluated**, not per decision (BR-23.1, Q3 = A). A decision over ten rules
 * writes ten rows sharing an `evaluationId` — which is what lets the log answer "why did my
 * rule **not** fire?".
 */
export interface DecisionLogEntry {
  readonly id: number;
  /** Groups the rows of one decision. Without it, "what did the engine see at 14:32" is unanswerable. */
  readonly evaluationId: string;
  /** When the decision was taken — not when the play started. ISO 8601. */
  readonly decidedAt: string;
  /** ⚠️ Nullable and stays nullable: a decision precedes its play row (BR-24.1). */
  readonly playId: number | null;
  readonly playLink: PlayLinkState;
  /** Recorded independently of `playId`, so a decision is attributable even if the play never closes. */
  readonly trackId: string;
  readonly ruleId: string;
  /** Denormalised: a renamed or deleted rule must not orphan its history (BR-23.6). */
  readonly ruleName: string;
  /** Content hash of the rule's normalised predicate + action + `onUnknown`. */
  readonly ruleHash: string;
  readonly verdict: Verdict;
  /** Whether this rule contributed to the action after `onUnknown` was applied. */
  readonly matched: boolean;
  /** ⚠️ Nulls appear explicitly, never by omission (BR-23.4). */
  readonly fieldsSeen: Readonly<Record<string, unknown>>;
  readonly unknownFields: readonly string[];
  /** Copied from the `Decision` verbatim, never accumulated (BR-23.5). */
  readonly restedOnUnknown: boolean;
  readonly partialData: boolean;
  /**
   * Whether this decision may act.
   *
   * ⚠️ Always `true` in U4, and still always `true` whenever `LoggingExecutor` is the selected
   * executor — which is accurate rather than a leftover: if it is running, no action is possible.
   * `SkipExecutor` writes BR-33.2's computed value instead.
   */
  readonly dryRun: boolean;
  /**
   * ⚠️ U5, migration 007. Which evaluation pass wrote this row (BR-37.3).
   *
   * Without it, FR-34's second decision for a play is indistinguishable from the first — and BR-22.1a
   * deliberately created no uniqueness constraint that would have made the duplicate visible.
   */
  readonly trigger: DecisionTrigger;
  /** Always `false` in U4. */
  readonly executed: boolean;
  /** Always `null` in U4. */
  readonly error: string | null;
  readonly engineVersion: number;
  /**
   * The rule-set counter **for the UI**. ⚠️ It resets to 1 on restart (BR-26.8), so on a durable
   * table a repeating small integer identifies nothing: today's `v3` and next month's `v3` are
   * different rule sets wearing the same number. `ruleSetContentHash` is the identifier.
   */
  readonly ruleSetVersion: number;
  /** ⚠️ What actually attributes this row to a rule set across restarts (BR-23.7a). */
  readonly ruleSetContentHash: string;
}

/** A row before it has an id — what the executor hands the log. */
export type NewDecisionLogEntry = Omit<DecisionLogEntry, 'id'>;

/** Half-open `[from, to)`, so adjacent ranges partition history without double-counting. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface DecisionFilter {
  readonly from?: string;
  readonly to?: string;
  readonly ruleId?: string;
  readonly trackId?: string;
  readonly matchedOnly?: boolean;
  readonly limit: number;
  readonly cursor?: number;
}

/**
 * What a rule **would have done** over stored history (FR-42, US-24).
 *
 * ⚠️ Three distinctions here are load-bearing and must never be merged. Each is a mistake this
 * project has already made once and paid for:
 *   - `undecidable` is not `wouldNotMatch` — "could not be answered" reported as "matched
 *     nothing" is the `Label detail` dash and the `inc=releases` 200 in a new place.
 *   - `notObserved` is not `inconclusive` — the 2026-09-06 merge exactly: the app's **downtime**
 *     rendered as the classifier's **uncertainty**.
 *   - `unanswerable` is not `unknown` — see `unanswerableFields`.
 */
export interface BackTestReport {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ruleHash: string;
  readonly range: DateRange;
  /** Plays the rule was evaluated against. ⚠️ Every row in range, not only eligible ones (BR-28.3a). */
  readonly evaluated: number;
  readonly wouldMatch: number;
  readonly wouldNotMatch: number;
  /** ⚠️ Predicate resolved `unknown`. **Distinct from `wouldNotMatch`.** */
  readonly undecidable: number;
  /** Per field, how many plays read it absent. */
  readonly unknownFieldCounts: Readonly<Record<string, number>>;
  /**
   * Fields some row in the range could not answer **at all**, with the count of such rows.
   *
   * ⚠️ Computed from the row, never from a value coming back null (BR-27.5). Two eras reach
   * this: pre-v5 `track.explicit` / `album.type` (schema), and `label.*` on a row that was never
   * asked (`isrc IS NULL AND label_unknown_reason IS NULL`). A back-test reporting 0 matches on
   * an unanswerable field reads as "this rule matches nothing" — a wrong answer that looks
   * like a finding.
   */
  readonly unanswerableFields: Readonly<Record<string, number>>;
  readonly agreedWithUserSkip: number;
  readonly disagreedWithUserKeep: number;
  readonly missedUserSkip: number;
  /** Backfilled plays — the app was not running. */
  readonly notObserved: number;
  /** Live plays the classifier could not judge. */
  readonly inconclusive: number;
  /** FR-23. **0 until U5 is armed** — a design guard, not a repair (BR-28.4). */
  readonly excludedRuleInitiated: number;
  /**
   * ⚠️ **Required, never optional and never defaulted** (P-24). This is the
   * `release_count = 100` bug pre-empted: a browse capped at 100 with no paging had the 100
   * stored as the count, and 18 of 56 resolutions recorded an arbitrary sample as a complete
   * figure with nothing marking it partial.
   */
  readonly truncated: boolean;
  /** For the report, never for the evaluation. */
  readonly computedAt: string;
}

/** Drives the version indicator (FQ5). */
export type RuleSetState = 'applied' | 'reloading' | 'rejected';

/**
 * The rule set as an identifiable thing — BR-20.8's last-known-good is only observable if you
 * can say *which* set is running.
 *
 * ⚠️ Owned by `RuleSetWatcher`, never by `RuleStore` (BR-26.3b). The store is a parser.
 */
export interface LoadedRuleSet {
  /**
   * ⚠️ Counts **accepted loads**, not file writes (BR-26.5/26.6). "v7 rejected, still running
   * v6" is only sayable if 7 was never taken. Not persisted: it resets on restart.
   */
  readonly version: number;
  /** Hash of the file's normalised content. Carries identity across restarts. */
  readonly contentHash: string;
  readonly loadedAt: string;
  readonly rules: readonly LoadedRule[];
  readonly state: RuleSetState;
  /** Present only in `rejected`. Names the errors; the running version is `version`. */
  readonly rejection: { readonly attemptedAt: string; readonly errors: readonly string[] } | null;
}

/**
 * Whether label resolution for a track has finished, in the only sense the trigger can act on
 * (BR-22.5a/5b).
 *
 * ⚠️ **`not-attemptable` is terminal and immediate**, and it is the whole reason this type
 * exists. The resolver exposes no per-track pending state, and the maps that do have four exits
 * leaving a track uncached — three of which a naive not-cached-and-not-in-flight test reads as
 * "still working". A keyless track would then wait the full cap and be stamped `partialData`,
 * recording **permanent absence as a timeout**: exactly the distinction FQ3 exists to draw, in
 * the one number U4 was built to measure.
 */
export type LabelResolutionState =
  | 'pending'
  | 'completed'
  | 'failed'
  /** No ISRC *and* no artist id, or label enrichment is disabled. Never answerable for this track. */
  | 'not-attemptable';

/** ⚠️ The decision log is capped, and the cap is a **constant, not a setting** (BR-29.2). */
export const DECISION_LOG_CAP = 100_000;

/** ⚠️ A bound, not a setting. `truncated` discloses when it fires (P-24). */
export const BACK_TEST_MAX_PLAYS = 50_000;

// ─── U5 ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Act on a decision. 🔌 Implemented by `LoggingExecutor` (records only) and, from U5,
 * `SkipExecutor` (records, then enqueues an attempt).
 *
 * Returns the `evaluationId` so the caller can complete the `playId` link when the play closes —
 * or mark it failed if the play row could not be written.
 *
 * ## ⚠️ `execute` is SYNCHRONOUS, and that is load-bearing (BR-42.1)
 *
 * `SkipExecutor` has to issue an HTTP `POST`, which is asynchronous, so making this
 * `Promise<string>` is the obvious move. It was rejected three times over:
 *
 * 1. It would change `LoggingExecutor`'s signature to serve a collaborator it does not have —
 *    which is what **BR-30** exists to prevent.
 * 2. `EvaluationCoordinator` calls this **unawaited from a timer**. An unawaited promise in a
 *    timer is how a swallowed rejection becomes a skip that silently never happened.
 * 3. ⚠️ **It would put the safety check in the wrong place.** An awaited `execute` checks the kill
 *    switch where the *decision* is taken; BR-33.5 requires it where the *action* fires, up to
 *    `ENRICHMENT_WAIT_MS` later.
 *
 * So `SkipExecutor.execute` enqueues and returns, and a separate drain performs the `POST`.
 *
 * ## ⚠️ There is deliberately no `cancel`
 *
 * BR-37.5 lets a re-evaluation withdraw a pending skip. It is **not** implemented as a method
 * here: that would widen this interface to serve one implementation and force `LoggingExecutor` to
 * carry a no-op, which is BR-30's objection one level up from the constructor parameter it already
 * forbids. Instead the **drain reads the latest decision for the play** and withdraws the attempt
 * itself — a pull, not a push, which also keeps the dependency direction `playback → rules`.
 * Settled 2026-10-02.
 */
export interface DecisionExecutor {
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
  /**
   * ⚠️ U5. Which pass produced this decision (BR-37.3).
   *
   * `initial` is the decision taken when enrichment settles or the wait caps out.
   * `enrichment-arrived` is FR-34's second pass, which may resolve an `unknown` into a decision —
   * and may **withdraw** a pending skip, but may **never** fire one an earlier pass declined
   * (BR-37.6). The asymmetry is the point: the direction that errs toward *not acting* is safe.
   */
  readonly trigger: DecisionTrigger;
}

/**
 * Which evaluation pass wrote a decision row (BR-37.3, migration 007).
 *
 * ⚠️ Existing rows are `initial` **by construction**, not by a judgement about them — U4 took
 * exactly one decision per play, so the column's DEFAULT supplies the value and no `UPDATE`
 * decides it retroactively.
 */
export type DecisionTrigger = 'initial' | 'enrichment-arrived';
