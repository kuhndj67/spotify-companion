/**
 * Property tests for tri-state evaluation — PBT-11, 12, 13, 17, 18, 19.
 *
 * These discharge NFR-25 and three of U3's exit criteria. The truth-table tests live in
 * `predicate.test.ts`; these are the ones that quantify over arbitrary trees and facts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import './fc-config.js';
import {
  and,
  compare,
  containsOnWordBoundary,
  depthOf,
  evaluate,
  fold,
  not,
  or,
} from '../src/rules/predicate.js';
import { findField } from '../src/rules/fieldCatalogue.js';
import type { Predicate, TrackFacts, Verdict } from '../src/rules/types.js';
import {
  ALL_FIELD_NAMES,
  hostilePredicate,
  predicateTree,
  trackFacts,
  treeOfDepth,
} from './ruleGenerators.js';

const VERDICTS: Verdict[] = ['true', 'false', 'unknown'];
const verdict = () => fc.constantFrom<Verdict>(...VERDICTS);

describe('PBT-11 — tri-state never collapses unknown to false', () => {
  it('every evaluation returns one of exactly three values', () => {
    fc.assert(
      fc.property(predicateTree(4), trackFacts(), (p, facts) => {
        assert.ok(VERDICTS.includes(evaluate(p, facts)));
      }),
    );
  });

  it('NOT unknown is unknown — never true, never false', () => {
    assert.equal(not('unknown'), 'unknown');
  });

  it('unknown survives OR with false, and AND with true', () => {
    // These are the two places a careless implementation silently turns unknown into a boolean.
    assert.equal(or('unknown', 'false'), 'unknown');
    assert.equal(and('unknown', 'true'), 'unknown');
  });

  it('an absent value is unknown for every operator except is-unknown', () => {
    // Conditioned on whether the field ACTUALLY reads null, because `availability: 'always'`
    // fields (track.title, artist.name, album.name…) are never absent — asserting otherwise
    // would be testing the generator rather than the rule.
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FIELD_NAMES), trackFacts(), (name, facts) => {
        const field = findField(name);
        assert.ok(field, `catalogue should contain ${name}`);

        const raw = field!.read(facts);
        const isAbsent = raw === null || raw === undefined;

        // is-unknown is decisive either way, and agrees with the field's actual state (BR-15.1).
        assert.equal(compare(field!, 'is-unknown', undefined, facts), isAbsent ? 'true' : 'false');

        if (isAbsent) {
          // BR-14.2: no default, no coercion, no zero.
          assert.equal(compare(field!, 'eq', 'anything', facts), 'unknown');
          assert.equal(compare(field!, 'neq', 'anything', facts), 'unknown');
        }
      }),
    );
  });

  it('every catalogue field reads null on blank facts, or is declared always-present', () => {
    // The complement of the property above: a field that can never be absent must say so, or the
    // tri-state guarantees are quietly narrower than the catalogue claims.
    for (const name of ALL_FIELD_NAMES) {
      const field = findField(name)!;
      const raw = field.read(blankFacts());
      if (raw !== null && raw !== undefined) {
        assert.equal(
          field.availability,
          'always',
          `${name} is never absent but is not declared 'always'`,
        );
      }
    }
  });
});

describe('PBT-12 — composition obeys De Morgan', () => {
  it('NOT(a AND b) === (NOT a) OR (NOT b), over all nine pairs', () => {
    fc.assert(
      fc.property(verdict(), verdict(), (a, b) => {
        assert.equal(not(and(a, b)), or(not(a), not(b)));
      }),
    );
  });

  it('NOT(a OR b) === (NOT a) AND (NOT b), over all nine pairs', () => {
    fc.assert(
      fc.property(verdict(), verdict(), (a, b) => {
        assert.equal(not(or(a, b)), and(not(a), not(b)));
      }),
    );
  });

  it('holds for whole generated trees, not just the operators', () => {
    fc.assert(
      fc.property(predicateTree(3), predicateTree(3), trackFacts(), (a, b, facts) => {
        const left: Predicate = { kind: 'not', operand: { kind: 'and', operands: [a, b] } };
        const right: Predicate = {
          kind: 'or',
          operands: [
            { kind: 'not', operand: a },
            { kind: 'not', operand: b },
          ],
        };
        assert.equal(evaluate(left, facts), evaluate(right, facts));
      }),
    );
  });

  it('double negation is identity', () => {
    fc.assert(
      fc.property(verdict(), (v) => {
        assert.equal(not(not(v)), v);
      }),
    );
  });
});

describe('PBT-13 — no field value causes a throw', () => {
  it('hostile operands never throw', () => {
    fc.assert(
      fc.property(hostilePredicate(), trackFacts(), (p, facts) => {
        // The assertion is that this line returns at all.
        const v = evaluate(p, facts);
        assert.ok(VERDICTS.includes(v));
      }),
    );
  });

  it('a predicate naming a field that does not exist evaluates to unknown, not a throw', () => {
    const p: Predicate = { kind: 'compare', field: 'no.such.field', op: 'eq', value: 1 };
    assert.equal(evaluate(p, blankFacts()), 'unknown');
  });

  it('empty operand lists return their identity element', () => {
    // Forced by associativity (BR-14.6). The validator refuses these, but the evaluator must
    // still answer rather than throw.
    assert.equal(evaluate({ kind: 'and', operands: [] }, blankFacts()), 'true');
    assert.equal(evaluate({ kind: 'or', operands: [] }, blankFacts()), 'false');
  });
});

describe('PBT-14 — the depth bound is measured without recursing', () => {
  it('depthOf reports exact depth for generated trees', () => {
    for (const depth of [1, 2, 5, 17, 32, 33]) {
      fc.assert(
        fc.property(treeOfDepth(depth), (tree) => {
          assert.equal(depthOf(tree), depth);
        }),
        { numRuns: 10 },
      );
    }
  });

  it('depthOf does not overflow on a tree far deeper than the stack would allow', () => {
    // ⚠️ This is the test that matters. A recursive depthOf would throw RangeError here — while
    // computing the guard that exists to prevent exactly this. The guard would be decorative.
    // V8 overflows somewhere around 10k frames, so 50k is comfortably past it.
    const deep = nest(50_000);
    assert.ok(depthOf(deep, 32) > 32, 'should report that the bound was exceeded');
  });

  it('early exit makes a pathological tree cheap', () => {
    const deep = nest(50_000);

    const started = process.hrtime.bigint();
    depthOf(deep, 32);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    // The point is O(limit), not O(tree). Without early exit this walks all 50k nodes.
    assert.ok(elapsedMs < 50, `expected early exit, took ${elapsedMs.toFixed(1)}ms`);
  });
});

describe('PBT-17 — is-unknown is total and decisive', () => {
  it('returns true or false for every field and every facts value, never unknown', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FIELD_NAMES), trackFacts(), (name, facts) => {
        const field = findField(name)!;
        const v = compare(field, 'is-unknown', undefined, facts);
        assert.notEqual(v, 'unknown', `${name} is-unknown must be decisive`);
        assert.ok(v === 'true' || v === 'false');
      }),
    );
  });

  it('not(is-unknown) is the other direction, and is also decisive', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_FIELD_NAMES), trackFacts(), (name, facts) => {
        const p: Predicate = {
          kind: 'not',
          operand: { kind: 'compare', field: name, op: 'is-unknown' },
        };
        assert.notEqual(evaluate(p, facts), 'unknown');
      }),
    );
  });
});

describe('PBT-18 — genre matching is per element, on word boundaries', () => {
  const genresField = findField('artist.genres')!;

  const withGenres = (genres: readonly string[] | null): TrackFacts => ({
    ...blankFacts(),
    artist: { id: null, name: '', following: null, genres },
  });

  it('"rap" matches "pop rap" but NOT "trap"', () => {
    // The measured case: over the corpus's 110 genres, substring matching makes `contains "rap"`
    // match trap, trap latino and trap metal — 4 unintended hits of 7. It reads as a working rule.
    assert.equal(compare(genresField, 'contains', 'rap', withGenres(['pop rap'])), 'true');
    assert.equal(compare(genresField, 'contains', 'rap', withGenres(['trap'])), 'false');
    assert.equal(compare(genresField, 'contains', 'rap', withGenres(['trap latino'])), 'false');
    assert.equal(compare(genresField, 'contains', 'rap', withGenres(['trap metal'])), 'false');
    assert.equal(compare(genresField, 'contains', 'rap', withGenres(['rapcore'])), 'false');
  });

  it('no match crosses two genre elements', () => {
    // Joining and folding would produce "hiphoprapcore", where "hoprap" matches across the seam.
    assert.equal(
      compare(genresField, 'contains', 'hop rap', withGenres(['hip hop', 'rapcore'])),
      'false',
    );
  });

  it('null is unknown and [] is false — never merged', () => {
    assert.equal(compare(genresField, 'contains', 'rock', withGenres(null)), 'unknown');
    assert.equal(compare(genresField, 'contains', 'rock', withGenres([])), 'false');
  });

  it('word-boundary containment is order-sensitive for multi-word needles', () => {
    assert.equal(containsOnWordBoundary('pop rap', 'pop rap'), true);
    assert.equal(containsOnWordBoundary('pop rap', 'rap pop'), false);
  });

  it('folding is case- and punctuation-insensitive', () => {
    assert.equal(fold('Def Jam'), fold('def-jam'));
    assert.equal(fold('Def Jam'), 'defjam');
  });
});

describe('PBT-19 — partial dates are unknown for ordering', () => {
  const dateField = findField('album.releaseDate')!;

  const withDate = (releaseDate: string | null): TrackFacts => ({
    ...blankFacts(),
    album: { name: '', releaseDate, ageYears: null, type: null },
  });

  it('a year-only date yields unknown for every ordering operator', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('lt', 'lte', 'gt', 'gte'),
        fc.constantFrom('2021-12-31', '2022-06-01', '2023-01-01'),
        (op, operand) => {
          assert.equal(compare(dateField, op, operand, withDate('2022')), 'unknown');
        },
      ),
    );
  });

  it('a full date orders normally', () => {
    assert.equal(compare(dateField, 'gt', '2022-06-01', withDate('2024-11-30')), 'true');
    assert.equal(compare(dateField, 'lt', '2022-06-01', withDate('2019-04-01')), 'true');
  });

  it('equality is a string comparison, so "2022" is not "2022-01-01"', () => {
    assert.equal(compare(dateField, 'eq', '2022-01-01', withDate('2022')), 'false');
    assert.equal(compare(dateField, 'eq', '2022', withDate('2022')), 'true');
  });

  it('an ordering operand that is itself partial is also unknown', () => {
    assert.equal(compare(dateField, 'gt', '2022', withDate('2024-11-30')), 'unknown');
  });
});

/** A predicate nested `depth` levels deep, built iteratively so the builder itself cannot blow up. */
function nest(depth: number): Predicate {
  let node: Predicate = { kind: 'compare', field: 'track.title', op: 'eq', value: 'x' };
  for (let i = 0; i < depth; i++) node = { kind: 'not', operand: node };
  return node;
}

/** Facts with every optional value absent. The tri-state worst case. */
function blankFacts(): TrackFacts {
  return {
    track: { id: 't', title: '', durationMs: 0, explicit: null, isrc: null },
    artist: { id: null, name: '', following: null, genres: null },
    album: { name: '', releaseDate: null, ageYears: null, type: null },
    label: { name: null, classification: null, confidence: null },
    liked: { atStart: null, transition: null },
    history: {
      playsOfTrack: null,
      skipsOfTrack: null,
      playsOfArtist: null,
      skipsOfArtist: null,
    },
    evaluatedAtMs: 0,
  };
}
