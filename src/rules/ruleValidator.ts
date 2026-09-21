/**
 * Rule validation — the only component in U3 that says no. ⚙️ PURE
 *
 * ## Two kinds of failure, and the split is the design
 *
 * **Structural** — invalid JSON shape, a missing `id`, a malformed tree, a duplicate id. The file
 * is not a rule set at all, and guessing at the author's intent would run something they did not
 * write. The **whole set** is rejected (BR-20.3, BR-20.4).
 *
 * **Semantic** — a field that no longer exists, an operator that does not fit, a tree that is too
 * deep, `onUnknown: 'hold'`. The rule is well-formed but currently unevaluable. It **loads,
 * disabled, with a reason** (BR-20.5) — never deleted, and never silently treated as `unknown`.
 *
 * ⚠️ **Never a partial structural load** (BR-20.6). Taking the rules that parsed and dropping the
 * rest silently arms a rule set the user never wrote, in the component that eventually controls
 * playback. It is the most dangerous thing this file could do.
 *
 * ## Why this runs at load and not only at creation
 *
 * FR-45 specifies creation-time validation, which cannot catch a field that disappears
 * *afterwards*. One did: migration 004 removed the artist-level label verdict on 2026-09-06. A
 * rule written the week before would now reference a field that does not exist. So
 * `validateRuleSet` runs on every load too (BR-18.1), and `LoadedRule.status` carries the answer.
 */

import { findField, operatorAllowed } from './fieldCatalogue.js';
import { depthOf } from './predicate.js';
import {
  MAX_PREDICATE_DEPTH,
  MAX_RULES,
  type LoadedRule,
  type OnUnknown,
  type Operator,
  type Predicate,
  type Rule,
  type RuleStatus,
  type ValidationResult,
} from './types.js';

const OPERATORS: readonly Operator[] = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'contains',
  'is-unknown',
];

const ON_UNKNOWN: readonly OnUnknown[] = ['no-match', 'match', 'hold'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Structural check of a predicate tree, iterative for the same reason `depthOf` is: a recursive
 * walk would overflow on exactly the trees we are trying to refuse.
 *
 * Returns an error string, or `null` when the shape is sound. Semantics — whether the field
 * exists, whether the operator fits — are checked separately, because they disable one rule
 * rather than rejecting the set.
 */
function structuralPredicateError(root: unknown, path = 'predicate'): string | null {
  const stack: { node: unknown; path: string }[] = [{ node: root, path }];

  while (stack.length > 0) {
    const { node, path: at } = stack.pop()!;

    if (!isRecord(node)) return `${at}: expected an object`;
    const kind = node['kind'];

    switch (kind) {
      case 'compare': {
        if (typeof node['field'] !== 'string' || node['field'] === '') {
          return `${at}: 'field' must be a non-empty string`;
        }
        const op = node['op'];
        if (typeof op !== 'string' || !OPERATORS.includes(op as Operator)) {
          return `${at}: 'op' must be one of ${OPERATORS.join(', ')}`;
        }
        // `is-unknown` takes no operand; everything else requires one (BR-15.4).
        const hasValue = 'value' in node && node['value'] !== undefined;
        if (op === 'is-unknown' && hasValue) {
          return `${at}: 'is-unknown' takes no value`;
        }
        if (op !== 'is-unknown' && !hasValue) {
          return `${at}: '${op}' requires a value`;
        }
        break;
      }

      case 'and':
      case 'or': {
        const operands = node['operands'];
        if (!Array.isArray(operands)) return `${at}: '${kind}' requires an operands array`;
        // An empty list evaluates to its identity element, but a rule containing one is almost
        // certainly a mistake — and the validator is a better place to object than an evaluator
        // that invents an answer (BR-14.6).
        if (operands.length === 0) return `${at}: '${kind}' operands must not be empty`;
        operands.forEach((operand, i) => {
          stack.push({ node: operand, path: `${at}.operands[${i}]` });
        });
        break;
      }

      case 'not': {
        if (!('operand' in node)) return `${at}: 'not' requires an operand`;
        stack.push({ node: node['operand'], path: `${at}.operand` });
        break;
      }

      default:
        return `${at}: unknown predicate kind ${JSON.stringify(kind)}`;
    }
  }

  return null;
}

/**
 * Semantic check. Returns the status a well-formed rule should carry.
 *
 * Order matters only in that the FIRST problem found is the reported reason — a rule can be both
 * too deep and reference a dead field, and reporting one clearly beats reporting both vaguely.
 */
function semanticStatus(rule: Rule): RuleStatus {
  // Depth first: it is the cheapest check and the one that protects the others from pathological
  // input. `depthOf` is bounded, so this costs O(limit) even on a hostile tree.
  const depth = depthOf(rule.predicate, MAX_PREDICATE_DEPTH);
  if (depth > MAX_PREDICATE_DEPTH) {
    return {
      state: 'disabled',
      reason: 'too-deep',
      detail: `predicate nests deeper than ${MAX_PREDICATE_DEPTH} levels`,
    };
  }

  // `hold` needs a deadline and a re-evaluation trigger, neither of which exists in a pure
  // synchronous module. Stored rather than refused, so rules written now begin working when U5
  // lands without being re-authored (BR-18.6).
  if (rule.onUnknown === 'hold') {
    return {
      state: 'disabled',
      reason: 'unsupported-on-unknown',
      detail: "onUnknown: 'hold' is not available until automated skipping (U5) is built",
    };
  }

  const stack: Predicate[] = [rule.predicate];
  while (stack.length > 0) {
    const node = stack.pop()!;

    if (node.kind === 'compare') {
      const field = findField(node.field);
      if (field === undefined) {
        return {
          state: 'disabled',
          reason: 'unknown-field',
          detail: `no such field: ${node.field}`,
        };
      }
      if (!operatorAllowed(field.type, node.op)) {
        return {
          state: 'disabled',
          reason: 'type-mismatch',
          detail: `operator '${node.op}' is not valid for ${node.field} (${field.type})`,
        };
      }
      const operandError = operandProblem(field.type, node.op, node.value, field.enumValues);
      if (operandError !== null) {
        return { state: 'disabled', reason: 'type-mismatch', detail: `${node.field}: ${operandError}` };
      }
    } else if (node.kind === 'not') {
      stack.push(node.operand);
    } else {
      for (const operand of node.operands) stack.push(operand);
    }
  }

  return { state: 'active' };
}

/**
 * Whether an operand is usable for this field and operator.
 *
 * Rejecting `NaN`, `Infinity` and ill-typed operands here is what lets `predicate.ts` be a total
 * function with no failure mode (P-11).
 */
function operandProblem(
  type: string,
  op: Operator,
  value: unknown,
  enumValues: readonly string[] | undefined,
): string | null {
  if (op === 'is-unknown') return null;

  if (op === 'in') {
    if (!Array.isArray(value)) return `'in' requires an array`;
    if (value.length === 0) return `'in' requires a non-empty array`;
    for (const v of value) {
      const problem = scalarProblem(type, v, enumValues);
      if (problem !== null) return problem;
    }
    return null;
  }

  return scalarProblem(type, value, enumValues);
}

function scalarProblem(
  type: string,
  value: unknown,
  enumValues: readonly string[] | undefined,
): string | null {
  switch (type) {
    case 'number':
      if (typeof value !== 'number') return 'expected a number';
      if (!Number.isFinite(value)) return 'number must be finite';
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected true or false';
    case 'string':
    case 'date':
      return typeof value === 'string' ? null : 'expected a string';
    case 'enum': {
      if (typeof value !== 'string') return 'expected a string';
      // An enum operand outside the declared set is refused rather than silently never matching
      // — a rule that can never fire should say so at creation, not at 3am.
      if (enumValues !== undefined && !enumValues.includes(value)) {
        return `must be one of ${enumValues.join(', ')}`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Structural validation of one rule. Semantics are applied by `validateRuleSet`. */
export function validateRule(raw: unknown, at = 'rule'): ValidationResult<Rule> {
  const errors: string[] = [];

  if (!isRecord(raw)) return { ok: false, errors: [`${at}: expected an object`] };

  if (typeof raw['id'] !== 'string' || raw['id'] === '') errors.push(`${at}: 'id' must be a non-empty string`);
  if (typeof raw['name'] !== 'string') errors.push(`${at}: 'name' must be a string`);
  if (typeof raw['enabled'] !== 'boolean') errors.push(`${at}: 'enabled' must be true or false`);
  if (raw['action'] !== 'skip') errors.push(`${at}: 'action' must be 'skip'`);
  // Optional and inert in U4 (BR-25.1). Absent means "adds no dry-run of its own"; it is
  // validated now so a rule written today is not silently accepted with a typo'd flag that
  // starts mattering the moment U5 arms automation.
  if ('dryRun' in raw && typeof raw['dryRun'] !== 'boolean') {
    errors.push(`${at}: 'dryRun' must be true or false when present`);
  }

  const onUnknown = raw['onUnknown'];
  if (typeof onUnknown !== 'string' || !ON_UNKNOWN.includes(onUnknown as OnUnknown)) {
    errors.push(`${at}: 'onUnknown' must be one of ${ON_UNKNOWN.join(', ')}`);
  }

  if (!('predicate' in raw)) {
    errors.push(`${at}: 'predicate' is required`);
  } else {
    const problem = structuralPredicateError(raw['predicate'], `${at}.predicate`);
    if (problem !== null) errors.push(problem);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id: raw['id'] as string,
      name: raw['name'] as string,
      enabled: raw['enabled'] as boolean,
      action: 'skip',
      onUnknown: onUnknown as OnUnknown,
      predicate: raw['predicate'] as Predicate,
      dryRun: 'dryRun' in raw ? (raw['dryRun'] as boolean) : false,
    },
  };
}

/**
 * Validate a whole rule set.
 *
 * Accepts either a bare array or `{ version, rules }`. Structural failure anywhere rejects
 * everything; semantic failure disables the individual rule.
 */
export function validateRuleSet(raw: unknown): ValidationResult<LoadedRule[]> {
  let list: unknown;

  if (Array.isArray(raw)) {
    list = raw;
  } else if (isRecord(raw) && Array.isArray(raw['rules'])) {
    list = raw['rules'];
  } else {
    return {
      ok: false,
      errors: ["expected an array of rules, or an object with a 'rules' array"],
    };
  }

  const rules = list as unknown[];

  if (rules.length > MAX_RULES) {
    return { ok: false, errors: [`too many rules: ${rules.length} exceeds the limit of ${MAX_RULES}`] };
  }

  const errors: string[] = [];
  const parsed: Rule[] = [];

  rules.forEach((entry, i) => {
    const result = validateRule(entry, `rules[${i}]`);
    if (result.ok) parsed.push(result.value);
    else errors.push(...result.errors);
  });

  // A duplicate id makes every report unattributable — which rule matched? — so it rejects the
  // set rather than disabling one arbitrary member of the pair (BR-20.4).
  const seen = new Set<string>();
  for (const rule of parsed) {
    if (seen.has(rule.id)) errors.push(`duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: parsed.map((rule) => ({ rule, status: semanticStatus(rule) })) };
}
