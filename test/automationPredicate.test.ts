/**
 * LC-23 — the action-point predicate, and **PBT-40**: all eight combinations of BR-33.2's four terms.
 *
 * ## Why the exhaustive table rather than a few examples
 *
 * The live path cannot produce *automation on, rule disabled, halt set* on demand, so the only way to
 * know the conjunction is actually a conjunction is to enumerate it. A predicate that ignored one term
 * would pass every hand-written example that happened not to exercise it — and the term most likely to
 * be dropped is `enabled`, because `RuleEngine` already filters disabled rules and the check therefore
 * looks redundant. It is not: the rules file can reload in the 10 s between decision and action.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { live } from '../src/playback/automationPredicate.js';
import type { AutomationState, RunawayHalt } from '../src/playback/types.js';
import type { Rule } from '../src/rules/types.js';

const HALT: RunawayHalt = {
  haltedAt: '2026-10-02T00:00:00.000Z',
  trigger: 'consecutive',
  observedCount: 3,
  threshold: 3,
  attemptIds: [1, 2, 3],
};

function state(enabled: boolean, halted: boolean): AutomationState {
  return {
    globalAutomationEnabled: enabled,
    runawayHalt: halted ? HALT : null,
    schemaVersion: 1,
  };
}

function rule(enabled: boolean, dryRun: boolean): Rule {
  return {
    id: 'r1',
    name: 'Rule 1',
    enabled,
    action: 'skip',
    onUnknown: 'no-match',
    predicate: { kind: 'compare', field: 'track.title', op: 'eq', value: 'x' },
    dryRun,
  };
}

describe('PBT-40 — the full BR-33.2 truth table', () => {
  // live := globalAutomationEnabled AND NOT halted AND rule.enabled AND NOT rule.dryRun
  const cases: {
    automation: boolean;
    halted: boolean;
    ruleEnabled: boolean;
    dryRun: boolean;
  }[] = [];
  for (const automation of [true, false])
    for (const halted of [true, false])
      for (const ruleEnabled of [true, false])
        for (const dryRun of [true, false]) cases.push({ automation, halted, ruleEnabled, dryRun });

  it('enumerates all 16 states of the four terms', () => {
    assert.equal(cases.length, 16);
  });

  it('is live if and ONLY if all four terms hold', () => {
    for (const c of cases) {
      const expected = c.automation && !c.halted && c.ruleEnabled && !c.dryRun;
      const verdict = live(state(c.automation, c.halted), rule(c.ruleEnabled, c.dryRun));
      assert.equal(
        verdict.live,
        expected,
        `automation=${c.automation} halted=${c.halted} enabled=${c.ruleEnabled} dryRun=${c.dryRun}`,
      );
    }
  });

  it('exactly one combination is live', () => {
    const liveCount = cases.filter(
      (c) => live(state(c.automation, c.halted), rule(c.ruleEnabled, c.dryRun)).live,
    ).length;
    assert.equal(liveCount, 1, 'only all-four-hold may fire');
  });

  it('every refusal carries a reason — never a bare false', () => {
    for (const c of cases) {
      const verdict = live(state(c.automation, c.halted), rule(c.ruleEnabled, c.dryRun));
      if (verdict.live) continue;
      assert.ok(verdict.reason, 'a refusal with no reason is the defect P-28 exists to prevent');
      assert.equal(typeof verdict.reason, 'string');
    }
  });
});

describe('each term reports its OWN reason', () => {
  it('automation off', () => {
    const v = live(state(false, false), rule(true, false));
    assert.deepEqual(v, { live: false, reason: 'automation-off' });
  });

  it('runaway halted', () => {
    const v = live(state(true, true), rule(true, false));
    assert.deepEqual(v, { live: false, reason: 'runaway-halted' });
  });

  it('⚠️ rule disabled between the decision and the action', () => {
    const v = live(state(true, false), rule(false, false));
    assert.deepEqual(v, { live: false, reason: 'rule-disabled' });
  });

  it('rule in dry-run', () => {
    const v = live(state(true, false), rule(true, true));
    assert.deepEqual(v, { live: false, reason: 'rule-dry-run' });
  });

  it('⚠️ rule deleted from the file between the decision and the action', () => {
    const v = live(state(true, false), null);
    assert.deepEqual(v, { live: false, reason: 'rule-gone' });
  });
});

describe('⚠️ precedence when more than one term fails', () => {
  it('automation-off wins over every rule-level reason', () => {
    // A reader told `rule-dry-run` while the master switch was also off would go and investigate
    // the wrong control.
    const v = live(state(false, true), rule(false, true));
    assert.deepEqual(v, { live: false, reason: 'automation-off' });
  });

  it('runaway-halted wins over rule-level reasons', () => {
    const v = live(state(true, true), rule(false, true));
    assert.deepEqual(v, { live: false, reason: 'runaway-halted' });
  });

  it('rule-gone wins over dry-run, because there is no rule to read dryRun from', () => {
    const v = live(state(true, false), null);
    assert.equal(v.live, false);
    assert.equal(v.live === false && v.reason, 'rule-gone');
  });
});

describe('⚠️ BR-25.2 — a rule cannot opt OUT of a global dry-run', () => {
  it('an absent dryRun means "adds no dry-run of its own", not "run this for real"', () => {
    const withoutFlag = { ...rule(true, false) } as Record<string, unknown>;
    delete withoutFlag['dryRun'];
    const v = live(state(true, false), withoutFlag as unknown as Rule);
    assert.equal(v.live, true, 'absent dryRun must behave exactly like false');
  });

  it('dryRun: false does NOT override automation being off', () => {
    const v = live(state(false, false), rule(true, false));
    assert.equal(v.live, false, 'the rule level can only ever ADD restriction');
  });

  it('⚠️ a halt is not clearable by a rule setting', () => {
    const v = live(state(true, true), rule(true, false));
    assert.equal(v.live, false);
  });
});

describe('the halt latch is separate from the kill switch (BR-33.4, BR-35.5)', () => {
  it('automation ON + halt set is still refused', () => {
    assert.equal(live(state(true, true), rule(true, false)).live, false);
  });

  it('automation OFF + no halt is refused for a DIFFERENT reason', () => {
    const halted = live(state(true, true), rule(true, false));
    const off = live(state(false, false), rule(true, false));
    assert.notDeepEqual(halted, off, 'one flag, two causes is what BR-35.5 refuses');
  });
});
