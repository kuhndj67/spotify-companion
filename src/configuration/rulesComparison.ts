/**
 * What a rules change would do, before anything is written (LC-40, BR-53.6, BR-54.1). ⚙️ PURE
 *
 * ONE comparison, used by upload, undo and restore (BR-53.7) — a second copy is how the U6 restore dialog and
 * the rules pop-up would come to disagree about what "removed" means.
 *
 * Both inputs are **validated** rule sets (`validateRuleSet`'s output), so ids are unique and every rule has a
 * status. Equality goes through `ruleHash`'s canonicaliser: field order in the file is not a change.
 *
 * ## ⚠️ "Becomes live" is wider than `dryRun: true → false`
 *
 * BR-53.6 names the dry-run flip. What the user needs warning about is the broader fact — *after this, the rule
 * can skip tracks once automation is on and it was not able to before* — so a rule counts when it **can act**
 * afterwards (enabled, not dry-run, loads active) and **could not** before: the flip itself, a dry-run rule
 * being re-enabled, a previously disabled-by-the-system rule now loading, and a NEW rule that can act. Narrower
 * would miss an added live rule, which is the same risk with a different diff.
 */

import { canonicalise } from '../rules/ruleHash.js';
import type { DisabledReason, LoadedRule, Rule } from '../rules/types.js';

export interface RuleRef {
  readonly id: string;
  readonly name: string;
}

export interface RulesComparison {
  readonly added: readonly RuleRef[];
  readonly removed: readonly RuleRef[];
  readonly changed: readonly (RuleRef & { readonly fields: readonly string[] })[];
  readonly unchanged: readonly RuleRef[];
  /** Rules in the NEW set that would load disabled, with the system's reason (BR-18.2). */
  readonly wouldDisable: readonly (RuleRef & { readonly reason: DisabledReason; readonly detail: string })[];
  /** ⚠️ Shown first in the UI: rules that can skip after this change and could not before. */
  readonly becomesLive: readonly RuleRef[];
  readonly currentCount: number;
  readonly nextCount: number;
  /** BR-54.1 — the valid-but-empty case and its neighbours. */
  readonly massRemoval: boolean;
  readonly identical: boolean;
}

/** The fields a user edits. `id` is the key, so it is never a "changed field". */
const COMPARED_FIELDS = ['name', 'enabled', 'action', 'onUnknown', 'predicate', 'dryRun'] as const;

/**
 * BR-54.1: removing **all** rules, or **more than half**, needs a typed confirmation.
 * ⚠️ Exactly half is NOT mass removal — the boundary PBT-60 pins.
 */
export function isMassRemoval(currentCount: number, removedCount: number): boolean {
  if (currentCount < 1) return false;
  return removedCount === currentCount || removedCount > currentCount / 2;
}

/** Can this rule skip a track once automation is on? */
export function canAct(loaded: LoadedRule): boolean {
  return loaded.rule.enabled && loaded.rule.dryRun !== true && loaded.status.state === 'active';
}

export function compareRuleSets(current: readonly LoadedRule[], next: readonly LoadedRule[]): RulesComparison {
  const before = new Map(current.map((l) => [l.rule.id, l]));
  const after = new Map(next.map((l) => [l.rule.id, l]));

  const added: RuleRef[] = [];
  const removed: RuleRef[] = [];
  const changed: (RuleRef & { fields: string[] })[] = [];
  const unchanged: RuleRef[] = [];
  const wouldDisable: (RuleRef & { reason: DisabledReason; detail: string })[] = [];
  const becomesLive: RuleRef[] = [];

  for (const [id, old] of before) {
    if (!after.has(id)) removed.push(ref(old.rule));
  }
  for (const [id, now] of after) {
    const old = before.get(id);
    if (old === undefined) {
      added.push(ref(now.rule));
    } else {
      const fields = changedFields(old.rule, now.rule);
      if (fields.length > 0) changed.push({ ...ref(now.rule), fields });
      else unchanged.push(ref(now.rule));
    }
    if (now.status.state === 'disabled') {
      wouldDisable.push({ ...ref(now.rule), reason: now.status.reason, detail: now.status.detail });
    }
    if (canAct(now) && !(old !== undefined && canAct(old))) becomesLive.push(ref(now.rule));
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    wouldDisable,
    becomesLive,
    currentCount: current.length,
    nextCount: next.length,
    massRemoval: isMassRemoval(current.length, removed.length),
    identical: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

function ref(rule: Rule): RuleRef {
  return { id: rule.id, name: rule.name };
}

/**
 * ⚠️ `dryRun` absent and `dryRun: false` are the SAME rule (types.ts: optional, defaulting to false) — so they
 * are normalised before comparing, or every hand-written file would show a phantom change on first upload.
 */
function changedFields(a: Rule, b: Rule): string[] {
  return COMPARED_FIELDS.filter((field) => {
    const x = field === 'dryRun' ? a.dryRun === true : a[field];
    const y = field === 'dryRun' ? b.dryRun === true : b[field];
    return canonicalise(x) !== canonicalise(y);
  });
}
