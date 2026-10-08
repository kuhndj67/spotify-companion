/**
 * LC-40 — the ONE rules comparison (BR-53.6, BR-53.7) and BR-54.1's mass-removal rule.
 *
 * PBT-59: the comparison PARTITIONS ids, and a set compared with itself is identical.
 * PBT-60: mass removal is exactly "all, or more than half" — at the boundary, exactly half is NOT.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';
import './fc-config.js';

import { canAct, compareRuleSets, isMassRemoval } from '../src/configuration/rulesComparison.js';
import type { LoadedRule, Rule, RuleStatus } from '../src/rules/types.js';
import { rule } from './ruleGenerators.js';

const ACTIVE: RuleStatus = { state: 'active' };

function loaded(r: Rule, status: RuleStatus = ACTIVE): LoadedRule {
  return { rule: r, status };
}

const status: fc.Arbitrary<RuleStatus> = fc.oneof(
  fc.constant(ACTIVE),
  fc.record({
    state: fc.constant('disabled' as const),
    reason: fc.constantFrom('unknown-field' as const, 'type-mismatch' as const, 'too-deep' as const, 'unsupported-on-unknown' as const),
    detail: fc.string(),
  }),
);

const loadedRule: fc.Arbitrary<LoadedRule> = fc
  .tuple(rule(), status, fc.option(fc.boolean(), { nil: undefined }))
  .map(([r, s, dryRun]) => loaded(dryRun === undefined ? r : { ...r, dryRun }, s));

const ruleSet = fc.uniqueArray(loadedRule, { selector: (l) => l.rule.id, maxLength: 8 });

const BASE: Rule = {
  id: 'r1',
  name: 'Majors',
  enabled: true,
  action: 'skip',
  onUnknown: 'no-match',
  predicate: { field: 'label.classification', op: 'eq', value: 'major' } as unknown as Rule['predicate'],
};

describe('compareRuleSets — PBT-59', () => {
  it('PBT-59: every id lands in exactly one of added / removed / changed / unchanged', () => {
    fc.assert(
      fc.property(ruleSet, ruleSet, (a, b) => {
        const c = compareRuleSets(a, b);
        const buckets = [c.added, c.removed, c.changed, c.unchanged].map((list) => list.map((r) => r.id));
        const all = buckets.flat();
        assert.equal(new Set(all).size, all.length, 'no id in two buckets');
        const ids = new Set([...a, ...b].map((l) => l.rule.id));
        assert.deepEqual(new Set(all), ids, 'every id in some bucket');
        assert.equal(c.currentCount, a.length);
        assert.equal(c.nextCount, b.length);
      }),
    );
  });

  it('PBT-59: a set compared with itself is identical, with nothing becoming live', () => {
    fc.assert(
      fc.property(ruleSet, (a) => {
        const c = compareRuleSets(a, a);
        assert.equal(c.identical, true);
        assert.equal(c.added.length + c.removed.length + c.changed.length, 0);
        assert.equal(c.becomesLive.length, 0);
        assert.equal(c.massRemoval, false);
      }),
    );
  });

  it('negative control: rule ORDER and object KEY order are not changes', () => {
    const a = loaded(BASE);
    const b = loaded({ ...BASE, id: 'r2', name: 'Other' });
    const reordered = loaded(Object.fromEntries(Object.entries(BASE).reverse()) as unknown as Rule);
    assert.equal(compareRuleSets([a, b], [b, reordered]).identical, true);
  });

  it('dryRun absent and dryRun false are the same rule — no phantom change', () => {
    const c = compareRuleSets([loaded(BASE)], [loaded({ ...BASE, dryRun: false })]);
    assert.equal(c.identical, true);
  });

  it('names the fields that changed', () => {
    const c = compareRuleSets([loaded(BASE)], [loaded({ ...BASE, name: 'Renamed', onUnknown: 'match' })]);
    assert.deepEqual(c.changed, [{ id: 'r1', name: 'Renamed', fields: ['name', 'onUnknown'] }]);
  });

  it('lists rules that would load disabled, with the reason', () => {
    const disabled: RuleStatus = { state: 'disabled', reason: 'unknown-field', detail: 'artist.label is gone' };
    const c = compareRuleSets([], [loaded(BASE, disabled)]);
    assert.deepEqual(c.wouldDisable, [{ id: 'r1', name: 'Majors', reason: 'unknown-field', detail: 'artist.label is gone' }]);
  });
});

describe('becomesLive — the warning shown first (BR-53.6)', () => {
  it('the dry-run flip makes a rule live', () => {
    const c = compareRuleSets([loaded({ ...BASE, dryRun: true })], [loaded({ ...BASE, dryRun: false })]);
    assert.deepEqual(c.becomesLive.map((r) => r.id), ['r1']);
  });

  it('an ADDED rule that can act is live — the same risk with a different diff', () => {
    assert.deepEqual(compareRuleSets([], [loaded(BASE)]).becomesLive.map((r) => r.id), ['r1']);
  });

  it('re-enabling a rule makes it live', () => {
    const c = compareRuleSets([loaded({ ...BASE, enabled: false })], [loaded(BASE)]);
    assert.deepEqual(c.becomesLive.map((r) => r.id), ['r1']);
  });

  it('negative controls: a dry-run addition, a disabled addition, and an already-live rule are not', () => {
    const disabled: RuleStatus = { state: 'disabled', reason: 'type-mismatch', detail: 'x' };
    assert.equal(compareRuleSets([], [loaded({ ...BASE, dryRun: true })]).becomesLive.length, 0);
    assert.equal(compareRuleSets([], [loaded(BASE, disabled)]).becomesLive.length, 0);
    assert.equal(compareRuleSets([loaded(BASE)], [loaded({ ...BASE, name: 'x' })]).becomesLive.length, 0);
  });

  it('property: every becomesLive rule can act in the new set and could not before', () => {
    fc.assert(
      fc.property(ruleSet, ruleSet, (a, b) => {
        const before = new Map(a.map((l) => [l.rule.id, l]));
        const after = new Map(b.map((l) => [l.rule.id, l]));
        for (const { id } of compareRuleSets(a, b).becomesLive) {
          assert.ok(canAct(after.get(id)!));
          const old = before.get(id);
          assert.ok(old === undefined || !canAct(old));
        }
      }),
    );
  });
});

describe('isMassRemoval — PBT-60', () => {
  it('PBT-60: true iff current >= 1 and (all removed, or more than half)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 }), (current, raw) => {
        const removed = Math.min(raw, current);
        const expected = current >= 1 && (removed === current || 2 * removed > current);
        assert.equal(isMassRemoval(current, removed), expected);
      }),
    );
  });

  it('PBT-60 boundary: exactly half is NOT mass removal; one more is', () => {
    assert.equal(isMassRemoval(4, 2), false);
    assert.equal(isMassRemoval(4, 3), true);
    assert.equal(isMassRemoval(1, 1), true, 'removing the only rule is "all"');
    assert.equal(isMassRemoval(0, 0), false, 'nothing to lose from an empty set');
  });

  it('the valid-but-empty upload against a populated set is mass removal', () => {
    const c = compareRuleSets([loaded(BASE), loaded({ ...BASE, id: 'r2' })], []);
    assert.equal(c.massRemoval, true);
  });
});
