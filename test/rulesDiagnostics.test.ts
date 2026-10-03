/**
 * The rules subsystem's diagnostics (LC-20).
 *
 * ⚠️ The test that matters most here is the **denominator**. A play that ends before the
 * enrichment wait expires produces no decision row at all — 2.8% of plays and 4 of 31 skips at
 * a 10 s cap — so dividing cap-firings by the play count would quietly understate the one
 * number this unit exists to collect. Same family as the coverage rate that read 28%→12%
 * where the truth was 86%→44%.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rulesDiagnostics } from '../src/rules/rulesDiagnostics.js';
import { validateRuleSet } from '../src/rules/ruleValidator.js';
import type { LoadedRule, LoadedRuleSet } from '../src/rules/types.js';

function rules(...specs: { id: string; field: string }[]): readonly LoadedRule[] {
  const result = validateRuleSet({
    rules: specs.map((s) => ({
      id: s.id,
      name: s.id,
      enabled: true,
      action: 'skip',
      onUnknown: 'no-match',
      predicate: { kind: 'compare', field: s.field, op: 'eq', value: 'x' },
    })),
  });
  assert.ok(result.ok);
  return result.value;
}

function ruleSet(overrides: Partial<LoadedRuleSet> = {}): LoadedRuleSet {
  return {
    version: 3,
    contentHash: 'set-hash',
    loadedAt: '2026-09-20T10:00:00.000Z',
    rules: rules({ id: 'a', field: 'track.title' }),
    state: 'applied',
    rejection: null,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof rulesDiagnostics>[0]> = {}) {
  return {
    ruleSet: ruleSet(),
    decisions: 0,
    partialData: 0,
    evaluationErrors: 0,
    loggedRows: 0,
    lastChangeCheck: null,
    cap: 100_000,
    ...overrides,
  };
}

describe('rulesDiagnostics', () => {
  it('reports the running set by hash as well as by version', () => {
    const report = rulesDiagnostics(input());

    assert.equal(report.ruleSetVersion, 3);
    assert.equal(report.ruleSetContentHash, 'set-hash');
  });

  it('separates active rules from disabled ones', () => {
    const withDisabled = validateRuleSet({
      rules: [
        {
          id: 'live', name: 'live', enabled: true, action: 'skip', onUnknown: 'no-match',
          predicate: { kind: 'compare', field: 'track.title', op: 'eq', value: 'x' },
        },
        {
          // ⚠️ Was `onUnknown: 'hold'` until 2026-10-02, when FR-33 completed and that began loading
          // ACTIVE. The fixture needs a rule that is genuinely disabled, so it now uses an unknown
          // field -- the DisabledReason migration 004 made real.
          id: 'held', name: 'held', enabled: true, action: 'skip', onUnknown: 'no-match',
          predicate: { kind: 'compare', field: 'artist.labelVerdict', op: 'eq', value: 'major' },
        },
      ],
    });
    assert.ok(withDisabled.ok);

    const report = rulesDiagnostics(input({ ruleSet: ruleSet({ rules: withDisabled.value }) }));

    assert.equal(report.activeRules, 1);
    assert.equal(report.disabledRules, 1);
  });

  describe('the partialData rate', () => {
    /** ⚠️ The denominator is decisions, never plays. */
    it('divides cap firings by DECISIONS', () => {
      const report = rulesDiagnostics(input({ decisions: 40, partialData: 10 }));

      assert.equal(report.partialDataRate, 0.25);
    });

    /** ⚠️ A rate over zero decisions is not 0% — it is unknown, and 0% reads as a finding. */
    it('is null, not zero, before anything has been decided', () => {
      const report = rulesDiagnostics(input({ decisions: 0, partialData: 0 }));

      assert.equal(report.partialDataRate, null);
    });
  });

  describe('ok', () => {
    it('is true for a healthy applied set', () => {
      assert.equal(rulesDiagnostics(input()).ok, true);
    });

    /** Running last-known-good is not a broken app, but it must not read as healthy either. */
    it('is false while a reload is rejected, and names the reason', () => {
      const report = rulesDiagnostics(
        input({
          ruleSet: ruleSet({
            state: 'rejected',
            rejection: { attemptedAt: '2026-09-20T10:05:00.000Z', errors: ['bad field'] },
          }),
        }),
      );

      assert.equal(report.ok, false);
      assert.deepEqual(report.rejection!.errors, ['bad field']);
      assert.equal(report.ruleSetVersion, 3, 'and the version still in force is sayable');
    });

    it('is false when evaluations have been failing', () => {
      assert.equal(rulesDiagnostics(input({ evaluationErrors: 2 })).ok, false);
    });
  });

  it('reports how much of the retention cap is used', () => {
    const report = rulesDiagnostics(input({ loggedRows: 25_000, cap: 100_000 }));

    assert.equal(report.capacityUsed, 0.25);
  });

  it('does not divide by a zero cap', () => {
    assert.equal(rulesDiagnostics(input({ loggedRows: 5, cap: 0 })).capacityUsed, 0);
  });

  it('carries the last change check, so a dead poll is visible', () => {
    const report = rulesDiagnostics(input({ lastChangeCheck: '2026-09-20T10:04:55.000Z' }));

    assert.equal(report.lastChangeCheck, '2026-09-20T10:04:55.000Z');
  });
});
