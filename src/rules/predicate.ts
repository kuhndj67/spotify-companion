/**
 * Predicate evaluation — Kleene strong three-valued logic. ⚙️ PURE
 *
 * The most correctness-critical module in U3. Everything downstream rests on the verdicts here,
 * and getting it wrong produces a *systematic* rather than random error.
 *
 * ## This module has no failure mode
 *
 * Everything that could fail was refused by `ruleValidator`. That is deliberate: validation is
 * the only place that says no (P-11), which is what makes "no input throws" a real property
 * rather than a tautology.
 *
 * The one way a total recursive function can still throw is **stack overflow**, and that is
 * closed upstream by `MAX_PREDICATE_DEPTH` at validation (P-10) rather than by making this
 * function iterative. The evaluator stays recursive because it has to read against the truth
 * tables below to be reviewable.
 *
 * ## ⚠️ The asymmetry that looks like a bug and is not
 *
 * `false AND unknown` is `false`. A decisive known operand wins, because no value the unknown
 * could take would change the answer — the data answered the question. That is **not** treating
 * `unknown` as `false`, which BR-14.2 forbids everywhere.
 *
 * A test asserting `and('false', 'unknown') === 'false'` and a test asserting `unknown` behaves
 * as `false` look alike and mean opposite things.
 */

import { findField } from './fieldCatalogue.js';
import type { FieldDefinition, Predicate, TrackFacts, Verdict } from './types.js';

// ---------------------------------------------------------------------------
// Kleene strong tables (BR-14.3, BR-14.4)
// ---------------------------------------------------------------------------

/**
 *        AND | true    false   unknown
 *       -----|-------------------------
 *       true | true    false   unknown
 *      false | false   false   false     <- decisive operand wins
 *    unknown | unknown false   unknown
 */
export function and(a: Verdict, b: Verdict): Verdict {
  if (a === 'false' || b === 'false') return 'false';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  return 'true';
}

/**
 *         OR | true    false   unknown
 *       -----|-------------------------
 *       true | true    true    true      <- decisive operand wins
 *      false | true    false   unknown
 *    unknown | true    unknown unknown
 */
export function or(a: Verdict, b: Verdict): Verdict {
  if (a === 'true' || b === 'true') return 'true';
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  return 'false';
}

/** NOT unknown is unknown, always. This is what makes De Morgan hold (NFR-25). */
export function not(a: Verdict): Verdict {
  if (a === 'true') return 'false';
  if (a === 'false') return 'true';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// String folding (BR-17.1, BR-17.2)
// ---------------------------------------------------------------------------

/**
 * Case-insensitive and punctuation-folded, applied to BOTH sides of every string comparison.
 * `"Def Jam"` ≡ `"def-jam"` ≡ `"defjam"`.
 *
 * ⚠️ **Applied per value, never across a join** (BR-17.2). Joining several values and then
 * folding destroys the separator: `["hip hop", "rapcore"]` becomes `"hiphoprapcore"`, where a
 * match can cross a boundary that exists in the data but not in the string. That is why
 * multi-valued fields are matched per element below.
 */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

/** Tokens of a value, for word-boundary matching. `"hip hop"` -> `["hip", "hop"]`. */
function tokens(s: string): string[] {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Whether `haystack` contains `needle` on a word boundary.
 *
 * ⚠️ **Not a substring test, and the difference is measurable.** Over the corpus's 110 distinct
 * genres, plain substring matching makes `contains "rap"` match `trap`, `trap latino` and
 * `trap metal` — four unintended hits of seven. It reads as a working rule, which is exactly why
 * it would never be noticed.
 *
 * A multi-word needle matches a contiguous run of tokens, so `"pop rap"` matches `"pop rap"` but
 * not `"rap pop"`.
 */
export function containsOnWordBoundary(haystack: string, needle: string): boolean {
  const hay = tokens(haystack);
  const need = tokens(needle);
  if (need.length === 0) return true;
  if (need.length > hay.length) return false;

  for (let i = 0; i + need.length <= hay.length; i++) {
    let matched = true;
    for (let j = 0; j < need.length; j++) {
      if (hay[i + j] !== need[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dates (BR-17.7 – BR-17.9)
// ---------------------------------------------------------------------------

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date we can order. Anything else — `YYYY`, `YYYY-MM`, junk — cannot be ordered. */
function isFullDate(v: string): boolean {
  return FULL_DATE.test(v);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const asVerdict = (b: boolean): Verdict => (b ? 'true' : 'false');

/** Numeric ordering, defined only for finite numbers on both sides. */
function compareNumbers(a: unknown, b: unknown, op: string): Verdict {
  if (typeof a !== 'number' || typeof b !== 'number') return 'unknown';
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'unknown';
  switch (op) {
    case 'lt':
      return asVerdict(a < b);
    case 'lte':
      return asVerdict(a <= b);
    case 'gt':
      return asVerdict(a > b);
    default:
      return asVerdict(a >= b);
  }
}

/**
 * Ordering over dates.
 *
 * ⚠️ A partial date yields `unknown` and is **never widened, coerced or defaulted** (BR-17.9).
 * Coercing `"2022"` to `"2022-01-01"` answers every question plausibly and is wrong at year
 * boundaries — and the wrong answer is indistinguishable from a right one. Only 5 of 428 plays
 * carry a year-only date, which is precisely why nobody would notice.
 *
 * This is the same shape as MusicBrainz returning 200 with `inc` silently ignored.
 */
function compareDates(a: unknown, b: unknown, op: string): Verdict {
  if (typeof a !== 'string' || typeof b !== 'string') return 'unknown';
  if (!isFullDate(a) || !isFullDate(b)) return 'unknown';
  // ISO-8601 full dates sort lexicographically, which is exactly chronological order.
  switch (op) {
    case 'lt':
      return asVerdict(a < b);
    case 'lte':
      return asVerdict(a <= b);
    case 'gt':
      return asVerdict(a > b);
    default:
      return asVerdict(a >= b);
  }
}

/** Equality for a multi-valued field: any element folds equal to the operand (BR-17.4). */
function multiEquals(values: readonly string[], operand: unknown): Verdict {
  if (typeof operand !== 'string') return 'unknown';
  const target = fold(operand);
  return asVerdict(values.some((v) => fold(v) === target));
}

/** `in` for a multi-valued field: any element equals any member of the operand list. */
function multiIn(values: readonly string[], operand: unknown): Verdict {
  if (!Array.isArray(operand)) return 'unknown';
  const targets = operand.filter((o): o is string => typeof o === 'string').map(fold);
  return asVerdict(values.some((v) => targets.includes(fold(v))));
}

/**
 * Compare one field against one operand.
 *
 * Order matters and is the algorithm:
 *   1. `is-unknown` short-circuits before anything else, so absence cannot be turned into
 *      `unknown` first (BR-15.2). This is the ONE place a missing value is decisive.
 *   2. An absent value then yields `unknown` for every other operator (BR-14.2).
 *   3. Only then is the typed comparison reached.
 */
export function compare(
  field: FieldDefinition,
  op: string,
  operand: unknown,
  facts: TrackFacts,
): Verdict {
  const raw = field.read(facts);

  // (1) The single deliberate collapse, and the whole reason this operator exists.
  if (op === 'is-unknown') {
    return asVerdict(raw === null || raw === undefined);
  }

  // (2) No default, no coercion, no zero.
  if (raw === null || raw === undefined) return 'unknown';

  // (3) Multi-valued fields are matched PER ELEMENT, never over a join.
  if (field.multiValued) {
    if (!Array.isArray(raw)) return 'unknown';
    const values = raw.filter((v): v is string => typeof v === 'string');
    // An empty list is `false`, NOT `unknown`: MusicBrainz was asked and lists nothing.
    // Collapsing this into `unknown` repeats the 2026-09-06 merge defect (BR-17.6).
    switch (op) {
      case 'eq':
        return multiEquals(values, operand);
      case 'neq':
        return not(multiEquals(values, operand));
      case 'in':
        return multiIn(values, operand);
      case 'contains':
        if (typeof operand !== 'string') return 'unknown';
        return asVerdict(values.some((v) => containsOnWordBoundary(v, operand)));
      default:
        return 'unknown';
    }
  }

  switch (field.type) {
    case 'string':
    case 'enum': {
      if (typeof raw !== 'string') return 'unknown';
      switch (op) {
        case 'eq':
          return typeof operand === 'string' ? asVerdict(fold(raw) === fold(operand)) : 'unknown';
        case 'neq':
          return typeof operand === 'string' ? asVerdict(fold(raw) !== fold(operand)) : 'unknown';
        case 'in': {
          if (!Array.isArray(operand)) return 'unknown';
          const folded = operand
            .filter((o): o is string => typeof o === 'string')
            .map(fold);
          return asVerdict(folded.includes(fold(raw)));
        }
        case 'contains':
          return typeof operand === 'string'
            ? asVerdict(containsOnWordBoundary(raw, operand))
            : 'unknown';
        default:
          return 'unknown';
      }
    }

    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'unknown';
      switch (op) {
        case 'eq':
          return typeof operand === 'number' ? asVerdict(raw === operand) : 'unknown';
        case 'neq':
          return typeof operand === 'number' ? asVerdict(raw !== operand) : 'unknown';
        case 'in':
          return Array.isArray(operand) ? asVerdict(operand.includes(raw)) : 'unknown';
        default:
          return compareNumbers(raw, operand, op);
      }
    }

    case 'boolean': {
      if (typeof raw !== 'boolean') return 'unknown';
      if (typeof operand !== 'boolean') return 'unknown';
      if (op === 'eq') return asVerdict(raw === operand);
      if (op === 'neq') return asVerdict(raw !== operand);
      return 'unknown';
    }

    case 'date': {
      if (typeof raw !== 'string') return 'unknown';
      switch (op) {
        // Equality is a STRING comparison, so "2022" !== "2022-01-01" (BR-17.8). Two different
        // statements about release timing are two different values.
        case 'eq':
          return typeof operand === 'string' ? asVerdict(raw === operand) : 'unknown';
        case 'neq':
          return typeof operand === 'string' ? asVerdict(raw !== operand) : 'unknown';
        default:
          return compareDates(raw, operand, op);
      }
    }

    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Tree evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a predicate against facts, recording every field read.
 *
 * ⚠️ **Exhaustive, not short-circuiting** (BR-14.7). Every operand is evaluated even when the
 * result is already determined, because `fieldsSeen` must record what the rule actually read —
 * U4's observability depends on it, and short-circuiting would make the explanation depend on
 * operand order, which Q11 = A says is presentational.
 */
export function evaluateWithTrace(
  predicate: Predicate,
  facts: TrackFacts,
  seen: Record<string, unknown>,
): Verdict {
  switch (predicate.kind) {
    case 'compare': {
      const field = findField(predicate.field);
      // A field absent from the catalogue cannot be evaluated. The validator disables such rules
      // (BR-18.4), so this is unreachable in production — but evaluation stays total regardless.
      if (field === undefined) return 'unknown';
      seen[predicate.field] = field.read(facts);
      return compare(field, predicate.op, predicate.value, facts);
    }

    case 'and': {
      // Identity element: an empty AND is true (BR-14.6). Forced by associativity.
      let acc: Verdict = 'true';
      for (const operand of predicate.operands) {
        acc = and(acc, evaluateWithTrace(operand, facts, seen));
      }
      return acc;
    }

    case 'or': {
      // Identity element: an empty OR is false (BR-14.6).
      let acc: Verdict = 'false';
      for (const operand of predicate.operands) {
        acc = or(acc, evaluateWithTrace(operand, facts, seen));
      }
      return acc;
    }

    case 'not':
      return not(evaluateWithTrace(predicate.operand, facts, seen));

    default:
      return 'unknown';
  }
}

/** Tri-state evaluation. NEVER collapses `unknown` to `false` (NFR-25). */
export function evaluate(predicate: Predicate, facts: TrackFacts): Verdict {
  return evaluateWithTrace(predicate, facts, {});
}

/**
 * Depth of a predicate tree, measured ITERATIVELY. A leaf is depth 1.
 *
 * ## ⚠️ This function must not recurse, and that is not a style preference
 *
 * It is the guard that stops `evaluate` from overflowing the stack (P-10). A recursive
 * implementation would overflow **while computing the guard's own input**, on exactly the trees
 * the guard exists to refuse — so the bound could never be enforced, and the `RangeError` would
 * escape from the validator rather than from the evaluator. The protection would be strictly
 * decorative.
 *
 * `limit` lets the walk stop as soon as the bound is exceeded, so a pathological tree costs
 * time proportional to the limit rather than to its own size. The returned value is then
 * "at least `limit + 1`", which is all the caller needs to refuse it.
 */
export function depthOf(predicate: Predicate, limit = Number.MAX_SAFE_INTEGER): number {
  let deepest = 0;
  const stack: { node: Predicate; depth: number }[] = [{ node: predicate, depth: 1 }];

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > deepest) deepest = depth;
    // Early exit: the caller only needs to know the bound was passed.
    if (deepest > limit) return deepest;

    switch (node.kind) {
      case 'not':
        stack.push({ node: node.operand, depth: depth + 1 });
        break;
      case 'and':
      case 'or':
        for (const operand of node.operands) {
          stack.push({ node: operand, depth: depth + 1 });
        }
        break;
      default:
        break;
    }
  }

  return deepest;
}
