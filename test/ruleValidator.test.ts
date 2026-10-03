/**
 * Rule validation — the failure table from the functional design, one case per row.
 *
 * The split under test is the design's central claim: a **structural** problem means the file is
 * not a rule set and rejects everything; a **semantic** problem means one rule is currently
 * unevaluable and is disabled with a reason.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import './fc-config.js';
import { validateRule, validateRuleSet } from '../src/rules/ruleValidator.js';
import { MAX_PREDICATE_DEPTH, MAX_RULES, type Predicate } from '../src/rules/types.js';
import { predicateTree, rule, treeOfDepth } from './ruleGenerators.js';

const ok = <T>(r: { ok: boolean }): r is { ok: true; value: T } => r.ok;

function ruleWith(predicate: Predicate, overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'a rule',
    enabled: true,
    action: 'skip',
    onUnknown: 'no-match',
    predicate,
    ...overrides,
  };
}

const titleIs = (value: string): Predicate => ({
  kind: 'compare',
  field: 'track.title',
  op: 'eq',
  value,
});

describe('structural failures reject the WHOLE set', () => {
  it('rejects a non-array, non-{rules} payload', () => {
    const r = validateRuleSet(42);
    assert.equal(r.ok, false);
  });

  it('rejects a rule missing its id', () => {
    const r = validateRuleSet([ruleWith(titleIs('x'), { id: undefined })]);
    assert.equal(r.ok, false);
  });

  it('rejects a malformed predicate tree', () => {
    const r = validateRuleSet([ruleWith({ kind: 'nonsense' } as unknown as Predicate)]);
    assert.equal(r.ok, false);
  });

  it('rejects an action other than skip', () => {
    const r = validateRuleSet([ruleWith(titleIs('x'), { action: 'delete' })]);
    assert.equal(r.ok, false);
  });

  it('rejects a duplicate id — an ambiguous identity makes reports unattributable', () => {
    const r = validateRuleSet([ruleWith(titleIs('a')), ruleWith(titleIs('b'))]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes('duplicate rule id')));
  });

  it('rejects an empty operand list', () => {
    const r = validateRuleSet([ruleWith({ kind: 'and', operands: [] })]);
    assert.equal(r.ok, false);
  });

  it("rejects 'is-unknown' carrying a value", () => {
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'track.title', op: 'is-unknown', value: 'x' }),
    ]);
    assert.equal(r.ok, false);
  });

  it('rejects an operator that requires a value and has none', () => {
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'track.title', op: 'eq' } as Predicate),
    ]);
    assert.equal(r.ok, false);
  });

  it('rejects more than MAX_RULES', () => {
    const many = Array.from({ length: MAX_RULES + 1 }, (_, i) =>
      ruleWith(titleIs('x'), { id: `r${i}` }),
    );
    const r = validateRuleSet(many);
    assert.equal(r.ok, false);
  });

  it('⚠️ NEVER loads partially — one bad rule takes the whole set down', () => {
    // BR-20.6. A partial load silently arms a rule set the user never wrote.
    const r = validateRuleSet([
      ruleWith(titleIs('fine'), { id: 'good' }),
      ruleWith({ kind: 'nonsense' } as unknown as Predicate, { id: 'bad' }),
    ]);
    assert.equal(r.ok, false, 'a valid rule alongside an invalid one must not survive');
  });
});

describe('semantic failures disable ONE rule and never reject the set', () => {
  it('a field that no longer exists → unknown-field', () => {
    // Not hypothetical: migration 004 deleted the artist-level label verdict on 2026-09-06.
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'artist.labelVerdict', op: 'eq', value: 'major' }),
    ]);
    assert.ok(ok(r));
    if (r.ok) {
      assert.equal(r.value[0]!.status.state, 'disabled');
      if (r.value[0]!.status.state === 'disabled') {
        assert.equal(r.value[0]!.status.reason, 'unknown-field');
        assert.ok(r.value[0]!.status.detail.includes('artist.labelVerdict'));
      }
    }
  });

  it('an operator that does not fit the type → type-mismatch', () => {
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'track.title', op: 'gt', value: 'x' }),
    ]);
    assert.ok(ok(r));
    if (r.ok && r.value[0]!.status.state === 'disabled') {
      assert.equal(r.value[0]!.status.reason, 'type-mismatch');
    }
  });

  it('an ill-typed operand → type-mismatch', () => {
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'album.ageYears', op: 'gt', value: 'five' }),
    ]);
    assert.ok(ok(r));
    if (r.ok && r.value[0]!.status.state === 'disabled') {
      assert.equal(r.value[0]!.status.reason, 'type-mismatch');
    }
  });

  it('a non-finite number operand → type-mismatch', () => {
    // Rejecting NaN here is what lets predicate.ts be total with no failure mode.
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'album.ageYears', op: 'gt', value: Number.NaN }),
    ]);
    assert.ok(ok(r));
    if (r.ok && r.value[0]!.status.state === 'disabled') {
      assert.equal(r.value[0]!.status.reason, 'type-mismatch');
    }
  });

  it('an enum operand outside the declared set → type-mismatch', () => {
    // A rule that can never fire should say so at creation, not at 3am.
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'label.classification', op: 'eq', value: 'indie' }),
    ]);
    assert.ok(ok(r));
    if (r.ok && r.value[0]!.status.state === 'disabled') {
      assert.equal(r.value[0]!.status.reason, 'type-mismatch');
    }
  });

  it("✅ onUnknown 'hold' loads ACTIVE as of U5 — FR-33 is complete", () => {
    // This test asserted `disabled: unsupported-on-unknown` from U3 until 2026-10-02. The rule was
    // stored rather than refused precisely so it would start working when U5 landed WITHOUT being
    // re-authored (FQ3 = C, BR-18.6, BR-38.1) -- and that is what this change demonstrates: no rule
    // file needed editing, only the validator.
    //
    // ⚠️ The deadline it was waiting for is EvaluationCoordinator's hold window,
    // min(label resolved, 30s, 50% of duration) -- BR-38.2.
    const r = validateRuleSet([ruleWith(titleIs('x'), { onUnknown: 'hold' })]);
    assert.ok(ok(r));
    if (r.ok) {
      assert.equal(r.value.length, 1, 'the rule must be present, not dropped');
      assert.equal(
        r.value[0]!.status.state,
        'active',
        "FR-33 is complete: 'hold' is supported and the rule must now load enabled",
      );
    }
  });

  it("⚠️ 'unsupported-on-unknown' is retained as a DisabledReason even though nothing emits it", () => {
    // Nothing produces this reason today. It is kept because removing it would delete the vocabulary
    // for "stored and disabled with a reason" -- the pattern that made FR-33's completion free -- and
    // because rulesDiagnostics can still be asked to render a historical row carrying it.
    const reason: import('../src/rules/types.js').DisabledReason = 'unsupported-on-unknown';
    assert.equal(reason, 'unsupported-on-unknown');
  });

  it('a valid rule alongside a disabled one stays active', () => {
    const r = validateRuleSet([
      ruleWith(titleIs('fine'), { id: 'good' }),
      ruleWith({ kind: 'compare', field: 'no.such', op: 'eq', value: 1 }, { id: 'dead' }),
    ]);
    assert.ok(ok(r));
    if (r.ok) {
      assert.equal(r.value[0]!.status.state, 'active');
      assert.equal(r.value[1]!.status.state, 'disabled');
    }
  });

  it('⚠️ a vanished field NEVER becomes unknown — the reason survives', () => {
    // BR-18.8. "We could not resolve this" and "this field no longer exists" are two facts, and
    // routing the second through onUnknown would merge them.
    const r = validateRuleSet([
      ruleWith({ kind: 'compare', field: 'gone.away', op: 'eq', value: 1 }),
    ]);
    assert.ok(ok(r));
    if (r.ok && r.value[0]!.status.state === 'disabled') {
      assert.equal(r.value[0]!.status.reason, 'unknown-field');
    }
  });
});

describe('PBT-14 — the depth bound', () => {
  it(`a tree at exactly ${MAX_PREDICATE_DEPTH} validates`, () => {
    fc.assert(
      fc.property(treeOfDepth(MAX_PREDICATE_DEPTH), (predicate) => {
        const r = validateRuleSet([ruleWith(predicate)]);
        assert.ok(r.ok);
        if (r.ok) assert.equal(r.value[0]!.status.state, 'active');
      }),
      { numRuns: 20 },
    );
  });

  it(`a tree at ${MAX_PREDICATE_DEPTH + 1} is disabled with reason too-deep`, () => {
    fc.assert(
      fc.property(treeOfDepth(MAX_PREDICATE_DEPTH + 1), (predicate) => {
        const r = validateRuleSet([ruleWith(predicate)]);
        assert.ok(r.ok, 'depth is semantic, so the set still loads');
        if (r.ok && r.value[0]!.status.state === 'disabled') {
          assert.equal(r.value[0]!.status.reason, 'too-deep');
        } else {
          assert.fail('expected the rule to be disabled');
        }
      }),
      { numRuns: 20 },
    );
  });

  it('neither validation nor measurement throws on a pathologically deep tree', () => {
    let deep: Predicate = titleIs('x');
    for (let i = 0; i < 50_000; i++) deep = { kind: 'not', operand: deep };

    const r = validateRuleSet([ruleWith(deep)]);
    assert.ok(r.ok);
    if (r.ok && r.value[0]!.status.state === 'disabled') {
      assert.equal(r.value[0]!.status.reason, 'too-deep');
    }
  });

  it('too-deep is NOT reported as type-mismatch — a wrong reason is worse than a generic one', () => {
    let deep: Predicate = titleIs('x');
    for (let i = 0; i < MAX_PREDICATE_DEPTH + 5; i++) deep = { kind: 'not', operand: deep };
    const r = validateRuleSet([ruleWith(deep)]);
    if (r.ok && r.value[0]!.status.state === 'disabled') {
      assert.notEqual(r.value[0]!.status.reason, 'type-mismatch');
    }
  });
});

describe('shape', () => {
  it('accepts both a bare array and { version, rules }', () => {
    const bare = validateRuleSet([ruleWith(titleIs('x'))]);
    const wrapped = validateRuleSet({ version: 1, rules: [ruleWith(titleIs('x'))] });
    assert.ok(bare.ok);
    assert.ok(wrapped.ok);
  });

  it('an empty rule set is valid — it is a rule set with no rules', () => {
    const r = validateRuleSet({ version: 1, rules: [] });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.length, 0);
  });

  it('never throws, for any input', () => {
    fc.assert(
      fc.property(fc.anything(), (anything) => {
        validateRuleSet(anything);
      }),
    );
  });

  it('generated well-formed rules validate structurally', () => {
    fc.assert(
      fc.property(rule(predicateTree(3)), (generated) => {
        const r = validateRule(generated);
        assert.equal(r.ok, true);
      }),
    );
  });
});
