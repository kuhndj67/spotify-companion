/**
 * Content hashing (BR-23.6, BR-23.7a).
 *
 * The property that matters is **stability**: the same rule must hash identically during live
 * evaluation, during a back-test, and during a replay months later, on any machine. Everything
 * here is about what must and must not change the hash.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';

import { hashRule, hashRuleSetContent, hashString } from '../src/rules/ruleHash.js';
import type { Rule } from '../src/rules/types.js';

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'skip-majors',
    name: 'Skip majors',
    enabled: true,
    action: 'skip',
    onUnknown: 'no-match',
    predicate: { kind: 'compare', field: 'label.classification', op: 'eq', value: 'major' },
    ...overrides,
  } as Rule;
}

describe('hashRule', () => {
  it('is stable for the same rule', () => {
    assert.equal(hashRule(rule()), hashRule(rule()));
  });

  it('changes when the predicate changes', () => {
    const a = hashRule(rule());
    const b = hashRule(
      rule({ predicate: { kind: 'compare', field: 'label.classification', op: 'eq', value: 'independent' } } as Partial<Rule>),
    );

    assert.notEqual(a, b);
  });

  it('changes when onUnknown changes — it changes what the rule decides', () => {
    assert.notEqual(hashRule(rule()), hashRule(rule({ onUnknown: 'match' })));
  });

  it('changes when the rule is disabled', () => {
    assert.notEqual(hashRule(rule()), hashRule(rule({ enabled: false })));
  });

  /**
   * ⚠️ A rename does not change what a rule decides, and a decision taken before the rename was
   * taken by the same rule. The display name is denormalised onto the log row separately, so
   * the log still reads as it did at the time.
   */
  it('does NOT change when only the name changes', () => {
    assert.equal(hashRule(rule()), hashRule(rule({ name: 'Skip the majors' })));
  });

  /**
   * ⚠️ `JSON.stringify` preserves insertion order, so without canonicalisation two
   * byte-identical rules written with their fields in a different order would hash
   * differently — and every decision taken before a cosmetic reordering would look as though
   * it came from a different rule.
   */
  it('does NOT change when object keys are written in a different order', () => {
    const forward = {
      id: 'r', name: 'R', enabled: true, action: 'skip', onUnknown: 'no-match',
      predicate: { kind: 'compare', field: 'track.title', op: 'contains', value: 'x' },
    } as unknown as Rule;
    const reversed = {
      predicate: { value: 'x', op: 'contains', field: 'track.title', kind: 'compare' },
      onUnknown: 'no-match', action: 'skip', enabled: true, name: 'R', id: 'r',
    } as unknown as Rule;

    assert.equal(hashRule(forward), hashRule(reversed));
  });

  it('treats an absent dryRun and an explicit undefined as the same rule', () => {
    const absent = rule();
    const explicit = { ...rule(), dryRun: undefined } as Rule;

    assert.equal(hashRule(absent), hashRule(explicit));
  });

  it('distinguishes a dry-run rule from a live one', () => {
    assert.notEqual(hashRule(rule({ dryRun: true })), hashRule(rule({ dryRun: false })));
  });
});

describe('hashString', () => {
  it('is deterministic and fixed-width', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h = hashString(s);
        assert.equal(h, hashString(s));
        assert.equal(h.length, 16);
        assert.match(h, /^[0-9a-f]{16}$/);
      }),
      { numRuns: 200 },
    );
  });

  it('separates different inputs', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        // Not a guarantee for all inputs — FNV-1a is an attribution hash, not a cryptographic
        // one — but a collision on two short strings would indicate a broken mix step.
        assert.notEqual(hashString(a), hashString(b));
      }),
      { numRuns: 300 },
    );
  });

  /** ⚠️ Hashes UTF-8 bytes, so the result cannot depend on how the file encoded a surrogate. */
  it('handles non-BMP characters without throwing or truncating', () => {
    assert.match(hashString('🎵 Björk — Jóga'), /^[0-9a-f]{16}$/);
    assert.notEqual(hashString('🎵'), hashString('🎶'));
  });

  it('hashes the empty string to a stable value rather than failing', () => {
    assert.equal(hashString(''), hashString(''));
    assert.match(hashString(''), /^[0-9a-f]{16}$/);
  });
});

describe('hashRuleSetContent', () => {
  /**
   * ⚠️ Over the file's text, not the parsed rules: it must change when a rule is added,
   * removed or reordered, because that is a different rule set even if every rule survives.
   */
  it('changes when rules are reordered in the file', () => {
    const a = '{"rules":[{"id":"a"},{"id":"b"}]}';
    const b = '{"rules":[{"id":"b"},{"id":"a"}]}';

    assert.notEqual(hashRuleSetContent(a), hashRuleSetContent(b));
  });

  it('is what distinguishes two rule sets that both call themselves v1', () => {
    // BR-26.8: `version` resets to 1 on every restart, so on a durable row it identifies
    // nothing. The hash is what makes an old decision attributable.
    assert.notEqual(hashRuleSetContent('{"rules":[]}'), hashRuleSetContent('{"rules":[{"id":"a"}]}'));
  });
});
