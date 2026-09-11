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
