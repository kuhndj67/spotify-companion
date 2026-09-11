/**
 * The engine: onUnknown mapping, the OR-fold, and the Decision — PBT-15, PBT-20.
 *
 * Also carries the Kleene truth tables asserted cell by cell. They live here rather than in the
 * property suite because the two assertions that matter most look alike and mean opposite things,
 * and a table makes the difference visible:
 *
 *     and('false', 'unknown') === 'false'   ← a decisive operand won. Correct.
 *     unknown treated as false              ← the collapse NFR-25 forbids.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import './fc-config.js';
import { and, not, or } from '../src/rules/predicate.js';
import { decide, evaluateRules, foldDecisions } from '../src/rules/RuleEngine.js';
import { validateRuleSet } from '../src/rules/ruleValidator.js';
import type { LoadedRule, Predicate, Rule, TrackFacts, Verdict } from '../src/rules/types.js';
import { predicateTree, trackFacts } from './ruleGenerators.js';

// ---------------------------------------------------------------------------

const facts = (over: Partial<TrackFacts> = {}): TrackFacts => ({
  track: { id: 't1', title: 'Song', durationMs: 200_000, explicit: null, isrc: null },
  artist: { id: 'a1', name: 'Artist', following: null, genres: null },
  album: { name: 'Album', releaseDate: null, ageYears: null, type: null },
  label: { name: null, classification: null, confidence: null },
  liked: { atStart: null, transition: null },
  history: { playsOfTrack: null, skipsOfTrack: null, playsOfArtist: null, skipsOfArtist: null },
  evaluatedAtMs: 1_700_000_000_000,
  ...over,
});

const asLoaded = (rule: Rule): LoadedRule => ({ rule, status: { state: 'active' } });

const mk = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  name: 'rule',
  enabled: true,
  action: 'skip',
  onUnknown: 'no-match',
  predicate: { kind: 'compare', field: 'track.title', op: 'eq', value: 'Song' },
  ...over,
});

/** A predicate that is always unknown: the label is null in the default facts. */
const UNKNOWN_PREDICATE: Predicate = {
  kind: 'compare',
  field: 'label.classification',
  op: 'eq',
  value: 'major',
};

// ---------------------------------------------------------------------------

describe('Kleene truth tables, cell by cell', () => {
  it('AND', () => {
    assert.equal(and('true', 'true'), 'true');
    assert.equal(and('true', 'false'), 'false');
    assert.equal(and('true', 'unknown'), 'unknown');
    assert.equal(and('false', 'true'), 'false');
    assert.equal(and('false', 'false'), 'false');
    // ⚠️ The decisive operand wins. This is NOT the unknown→false collapse.
    assert.equal(and('false', 'unknown'), 'false');
    assert.equal(and('unknown', 'true'), 'unknown');
    assert.equal(and('unknown', 'false'), 'false');
    assert.equal(and('unknown', 'unknown'), 'unknown');
  });

  it('OR', () => {
    assert.equal(or('true', 'true'), 'true');
    assert.equal(or('true', 'false'), 'true');
    // ⚠️ Mirror of the above: nothing the unknown could be would change the answer.
    assert.equal(or('true', 'unknown'), 'true');
    assert.equal(or('false', 'true'), 'true');
    assert.equal(or('false', 'false'), 'false');
    assert.equal(or('false', 'unknown'), 'unknown');
    assert.equal(or('unknown', 'true'), 'true');
    assert.equal(or('unknown', 'false'), 'unknown');
    assert.equal(or('unknown', 'unknown'), 'unknown');
  });

  it('NOT', () => {
    assert.equal(not('true'), 'false');
    assert.equal(not('false'), 'true');
    assert.equal(not('unknown'), 'unknown');
  });

  it('AND and OR are commutative and associative', () => {
    const vs: Verdict[] = ['true', 'false', 'unknown'];
    for (const a of vs)
      for (const b of vs) {
        assert.equal(and(a, b), and(b, a));
        assert.equal(or(a, b), or(b, a));
        for (const c of vs) {
          assert.equal(and(and(a, b), c), and(a, and(b, c)));
          assert.equal(or(or(a, b), c), or(a, or(b, c)));
        }
      }
  });
});

describe('onUnknown mapping (BR-19.5)', () => {
  it("'no-match' maps unknown to false", () => {
    const { outcomes } = evaluateRules(
      [asLoaded(mk({ predicate: UNKNOWN_PREDICATE, onUnknown: 'no-match' }))],
      facts(),
    );
    assert.equal(outcomes[0]!.verdict, 'unknown');
    assert.equal(outcomes[0]!.applied, 'false');
  });

  it("'match' maps unknown to true", () => {
    const { outcomes } = evaluateRules(
      [asLoaded(mk({ predicate: UNKNOWN_PREDICATE, onUnknown: 'match' }))],
      facts(),
    );
    assert.equal(outcomes[0]!.verdict, 'unknown');
    assert.equal(outcomes[0]!.applied, 'true');
  });

  it('a decisive verdict is passed through untouched', () => {
    const { outcomes } = evaluateRules([asLoaded(mk({ onUnknown: 'match' }))], facts());
    assert.equal(outcomes[0]!.verdict, 'true');
    assert.equal(outcomes[0]!.applied, 'true');
  });
});

describe('PBT-20 — restedOnUnknown iff the RAW verdict was unknown', () => {
  it('true when the predicate itself was unknown', () => {
    const { outcomes } = evaluateRules([asLoaded(mk({ predicate: UNKNOWN_PREDICATE }))], facts());
    assert.equal(outcomes[0]!.restedOnUnknown, true);
  });

  it('⚠️ FALSE when the tree contained an unknown but still resolved decisively', () => {
    // This is the distinction. Q1 offered option C — flag any unknown anywhere in the tree — and
    // it was NOT chosen. The data answered this predicate; it did not rest on absent data.
    const decisiveDespiteUnknown: Predicate = {
      kind: 'and',
      operands: [
        UNKNOWN_PREDICATE, // unknown
        { kind: 'compare', field: 'track.title', op: 'eq', value: 'Nope' }, // false
      ],
    };
    const { outcomes } = evaluateRules(
      [asLoaded(mk({ predicate: decisiveDespiteUnknown }))],
      facts(),
    );
    assert.equal(outcomes[0]!.verdict, 'false', 'Kleene: false AND unknown is false');
    assert.equal(
      outcomes[0]!.restedOnUnknown,
      false,
      'an accumulated flag would report true here — that is option C',
    );
  });

  it('holds as a property over generated trees', () => {
    fc.assert(
      fc.property(predicateTree(3), trackFacts(), (predicate, f) => {
        const { outcomes } = evaluateRules([asLoaded(mk({ predicate }))], f);
        if (outcomes.length === 0) return;
        assert.equal(outcomes[0]!.restedOnUnknown, outcomes[0]!.verdict === 'unknown');
      }),
    );
  });
});

describe('the fold (FR-30, BR-19)', () => {
  it('any matching rule yields skip', () => {
    const d = decide([asLoaded(mk({ id: 'a' })), asLoaded(mk({ id: 'b', predicate: UNKNOWN_PREDICATE }))], facts());
    assert.equal(d.action, 'skip');
    assert.deepEqual(d.matchedRuleIds, ['a']);
  });

  it('no match yields none', () => {
    const d = decide([asLoaded(mk({ predicate: UNKNOWN_PREDICATE }))], facts());
    assert.equal(d.action, 'none');
    assert.deepEqual(d.matchedRuleIds, []);
  });

  it('order does not change WHETHER the action fires (BR-19.3)', () => {
    const a = asLoaded(mk({ id: 'a' }));
    const b = asLoaded(mk({ id: 'b', predicate: UNKNOWN_PREDICATE }));
    assert.equal(decide([a, b], facts()).action, decide([b, a], facts()).action);
  });

  it('outcomes records EVERY evaluated rule, matched or not (BR-19.4)', () => {
    const d = decide(
      [asLoaded(mk({ id: 'a' })), asLoaded(mk({ id: 'b', predicate: UNKNOWN_PREDICATE }))],
      facts(),
    );
    assert.equal(d.outcomes.length, 2, 'evaluation must not stop at the first match');
  });

  it('restedOnUnknown is scoped to the MATCHED rules (BR-19.7)', () => {
    // A non-matching rule that rested on unknown must not make the decision look uncertain.
    const d = decide(
      [asLoaded(mk({ id: 'match' })), asLoaded(mk({ id: 'uncertain', predicate: UNKNOWN_PREDICATE }))],
      facts(),
    );
    assert.equal(d.action, 'skip');
    assert.equal(d.restedOnUnknown, false);
    assert.equal(d.outcomes.find((o) => o.ruleId === 'uncertain')!.restedOnUnknown, true);
  });

  it('a matched rule that rested on unknown sets the flag', () => {
    const d = decide([asLoaded(mk({ predicate: UNKNOWN_PREDICATE, onUnknown: 'match' }))], facts());
    assert.equal(d.action, 'skip');
    assert.equal(d.restedOnUnknown, true);
  });

  it('partialData is an INPUT and is never inferred (P-17)', () => {
    // Every label field is unknown here, which option C of the NFR question would have treated as
    // evidence of incompleteness. It is not: unknown may mean "resolved, and the answer is
    // nothing".
    const untouched = decide([asLoaded(mk({ predicate: UNKNOWN_PREDICATE }))], facts());
    assert.equal(untouched.partialData, false);

    const declared = decide([asLoaded(mk({ predicate: UNKNOWN_PREDICATE }))], facts(), true);
    assert.equal(declared.partialData, true);
  });

  it('unknownFields lists the fields that read unknown, sorted', () => {
    const d = decide(
      [
        asLoaded(mk({ id: 'a', predicate: UNKNOWN_PREDICATE })),
        asLoaded(
          mk({
            id: 'b',
            predicate: { kind: 'compare', field: 'artist.following', op: 'eq', value: true },
          }),
        ),
      ],
      facts(),
    );
    assert.deepEqual(d.unknownFields, ['artist.following', 'label.classification']);
  });

  it('an empty rule set decides none and rests on nothing', () => {
    const d = decide([], facts());
    assert.equal(d.action, 'none');
    assert.equal(d.restedOnUnknown, false);
    assert.deepEqual(d.unknownFields, []);
  });
});

describe('enabled and status are two independent facts (BR-18.2, BR-18.3)', () => {
  it('a user-disabled rule is not evaluated and is not reported', () => {
    const d = decide([asLoaded(mk({ enabled: false }))], facts());
    assert.equal(d.outcomes.length, 0);
    assert.equal(d.disabledRules.length, 0, 'the user turning it off is not a system report');
  });

  it('a system-disabled rule is not evaluated but IS reported, with its reason', () => {
    const loaded: LoadedRule = {
      rule: mk(),
      status: { state: 'disabled', reason: 'unknown-field', detail: 'no such field: gone' },
    };
    const d = decide([loaded], facts());
    assert.equal(d.outcomes.length, 0);
    assert.equal(d.disabledRules.length, 1);
    assert.equal(d.disabledRules[0]!.reason, 'unknown-field');
  });

  it("a 'hold' rule is disabled by the validator and never reaches evaluation", () => {
    const r = validateRuleSet([mk({ onUnknown: 'hold' })]);
    assert.ok(r.ok);
    if (r.ok) {
      const d = decide(r.value, facts());
      assert.equal(d.outcomes.length, 0);
      assert.equal(d.disabledRules[0]!.reason, 'unsupported-on-unknown');
      assert.equal(d.action, 'none');
    }
  });
});

describe('PBT-15 — determinism (NFR-26)', () => {
  it('the same inputs yield a deep-equal Decision every time', () => {
    fc.assert(
      fc.property(predicateTree(3), trackFacts(), (predicate, f) => {
        const rules = [asLoaded(mk({ predicate }))];
        assert.deepEqual(decide(rules, f), decide(rules, f));
      }),
    );
  });

  it('unknownFields ordering does not depend on rule order', () => {
    // Object.keys is insertion-ordered, so an unsorted implementation would leak evaluation
    // sequence into the output and break deep-equality comparison.
    const a = asLoaded(mk({ id: 'a', predicate: UNKNOWN_PREDICATE }));
    const b = asLoaded(
      mk({ id: 'b', predicate: { kind: 'compare', field: 'artist.following', op: 'eq', value: true } }),
    );
    assert.deepEqual(decide([a, b], facts()).unknownFields, decide([b, a], facts()).unknownFields);
  });

  it('evaluation has no side effect on the facts it is given', () => {
    const f = facts();
    const snapshot = JSON.stringify(f);
    decide([asLoaded(mk())], f);
    assert.equal(JSON.stringify(f), snapshot);
  });

  it('foldDecisions is total for an empty outcome list', () => {
    const d = foldDecisions([]);
    assert.equal(d.action, 'none');
  });
});
