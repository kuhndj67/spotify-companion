/**
 * Domain generators for the rules-engine property tests.
 *
 * These produce *plausible rule shapes*, not random objects. Two design choices matter:
 *
 * 1. **The tree generator is DEPTH-PARAMETERISED.** fast-check's recursive combinators bound size
 *    probabilistically, which is fine for "does it throw" but useless for PBT-14, where the whole
 *    point is the boundary at exactly 32 and 33. A test that hopes a random generator reaches a
 *    depth it never reaches passes for the wrong reason — the same failure shape as a coverage
 *    number that cannot see a file no test imports.
 *
 * 2. **`TrackFacts` generators emit `null` freely**, and emit `[]` as well as `null` for genres.
 *    A generator that always produced values would make every tri-state property vacuous, and one
 *    that merged `[]` into `null` would hide the distinction BR-17.6 exists to protect.
 */

import fc from 'fast-check';

import type {
  LabelClass,
  LikedTransition,
  Maybe,
  Operator,
  Predicate,
  Rule,
  TrackFacts,
} from '../src/rules/types.js';

/** Field names that exist in the catalogue, by type, so generated rules are mostly valid. */
export const STRING_FIELDS = ['track.title', 'artist.name', 'album.name', 'label.name'] as const;
export const NUMBER_FIELDS = [
  'track.durationMs',
  'album.ageYears',
  'history.playsOfTrack',
  'history.skipsOfTrack',
  'history.playsOfArtist',
  'history.skipsOfArtist',
] as const;
export const BOOLEAN_FIELDS = ['track.explicit', 'artist.following', 'liked.atStart'] as const;
export const DATE_FIELDS = ['album.releaseDate'] as const;
export const ENUM_FIELDS = ['label.classification', 'liked.transition'] as const;
export const MULTI_FIELDS = ['artist.genres'] as const;

export const ALL_FIELD_NAMES = [
  ...STRING_FIELDS,
  ...NUMBER_FIELDS,
  ...BOOLEAN_FIELDS,
  ...DATE_FIELDS,
  ...ENUM_FIELDS,
  ...MULTI_FIELDS,
];

/** Genres drawn from the real corpus, including the pairs that make word boundaries matter. */
export const CORPUS_GENRES = [
  'hip hop',
  'rap',
  'pop rap',
  'punk rap',
  'cloud rap',
  'trap',
  'trap latino',
  'trap metal',
  'rapcore',
  'rock',
  'indie rock',
  'hard rock',
  'acoustic rock',
  'punk rock',
  'pop',
  'britpop',
  'dream pop',
  'instrumental',
  'world fusion',
];

const maybe = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<Maybe<T>> =>
  fc.oneof({ arbitrary: fc.constant(null), weight: 1 }, { arbitrary: arb, weight: 3 });

/** A leaf comparison. Valid field/operator pairings, so the validator mostly accepts them. */
export function comparison(): fc.Arbitrary<Predicate> {
  return fc.oneof(
    fc.record({
      kind: fc.constant('compare' as const),
      field: fc.constantFrom(...STRING_FIELDS),
      op: fc.constantFrom<Operator>('eq', 'neq', 'contains'),
      value: fc.string(),
    }),
    fc.record({
      kind: fc.constant('compare' as const),
      field: fc.constantFrom(...NUMBER_FIELDS),
      op: fc.constantFrom<Operator>('eq', 'neq', 'lt', 'lte', 'gt', 'gte'),
      value: fc.integer({ min: -1000, max: 1_000_000 }),
    }),
    fc.record({
      kind: fc.constant('compare' as const),
      field: fc.constantFrom(...BOOLEAN_FIELDS),
      op: fc.constantFrom<Operator>('eq', 'neq'),
      value: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant('compare' as const),
      field: fc.constantFrom(...MULTI_FIELDS),
      op: fc.constantFrom<Operator>('eq', 'contains'),
      value: fc.constantFrom(...CORPUS_GENRES),
    }),
    // `is-unknown` on any field, with no value.
    fc.record({
      kind: fc.constant('compare' as const),
      field: fc.constantFrom(...ALL_FIELD_NAMES),
      op: fc.constant('is-unknown' as Operator),
    }),
  ) as fc.Arbitrary<Predicate>;
}

/**
 * A predicate tree of **exactly** `depth` levels — a leaf is depth 1.
 *
 * Deterministic in shape, so PBT-14 can assert that 32 validates and 33 does not. `fc.letrec`
 * and `fc.memo` cannot promise an exact depth; this can.
 */
export function treeOfDepth(depth: number): fc.Arbitrary<Predicate> {
  if (depth <= 1) return comparison();

  // ⚠️ The child arbitrary is built ONCE and reused. Calling treeOfDepth(depth - 1) separately in
  // each branch below makes construction exponential — 3^depth arbitraries — which exhausts the
  // heap somewhere around depth 20 and kills the test process with no useful message. The bug
  // looks like "property testing is slow" rather than "the generator is wrong".
  const child = treeOfDepth(depth - 1);

  return fc.oneof(
    child.map((operand) => ({ kind: 'not' as const, operand })),
    child.map((operand) => ({ kind: 'and' as const, operands: [operand] })),
    child.map((operand) => ({ kind: 'or' as const, operands: [operand] })),
  ) as fc.Arbitrary<Predicate>;
}

/** A tree of arbitrary shape up to `maxDepth`. For properties that do not care about the bound. */
export function predicateTree(maxDepth = 4): fc.Arbitrary<Predicate> {
  if (maxDepth <= 1) return comparison();

  // Built once, for the same reason as treeOfDepth above.
  const child = predicateTree(maxDepth - 1);

  return fc.oneof(
    { arbitrary: comparison(), weight: 3 },
    { arbitrary: child.map((operand) => ({ kind: 'not' as const, operand })), weight: 1 },
    {
      arbitrary: fc
        .array(child, { minLength: 1, maxLength: 3 })
        .map((operands) => ({ kind: 'and' as const, operands })),
      weight: 1,
    },
    {
      arbitrary: fc
        .array(child, { minLength: 1, maxLength: 3 })
        .map((operands) => ({ kind: 'or' as const, operands })),
      weight: 1,
    },
  ) as fc.Arbitrary<Predicate>;
}

/**
 * Arbitrary JSON-ish values for the `value` slot, including the ones that break naive
 * comparisons: `NaN`, `Infinity`, nested objects, huge numbers.
 *
 * Used by PBT-13 to show that no operand can make evaluation throw.
 */
export function hostileValue(): fc.Arbitrary<unknown> {
  return fc.oneof(
    fc.constant(NaN),
    fc.constant(Infinity),
    fc.constant(-Infinity),
    fc.constant(null),
    fc.constant(undefined),
    fc.double(),
    fc.integer(),
    fc.string(),
    fc.boolean(),
    fc.array(fc.string(), { maxLength: 5 }),
    fc.array(fc.integer(), { maxLength: 5 }),
    fc.object({ maxDepth: 2 }),
    fc.constant({}),
    fc.constant([]),
  );
}

/** A predicate whose operands are hostile. Structurally sound, semantically absurd. */
export function hostilePredicate(): fc.Arbitrary<Predicate> {
  return fc.record({
    kind: fc.constant('compare' as const),
    field: fc.oneof(fc.constantFrom(...ALL_FIELD_NAMES), fc.string()),
    op: fc.constantFrom<Operator>(
      'eq',
      'neq',
      'lt',
      'lte',
      'gt',
      'gte',
      'in',
      'contains',
      'is-unknown',
    ),
    value: hostileValue(),
  }) as fc.Arbitrary<Predicate>;
}

/** `TrackFacts` with every `Maybe` field genuinely optional, and genres tri-state. */
export function trackFacts(): fc.Arbitrary<TrackFacts> {
  return fc.record({
    track: fc.record({
      id: fc.string({ minLength: 1 }),
      title: fc.string(),
      durationMs: fc.integer({ min: 0, max: 900_000 }),
      explicit: maybe(fc.boolean()),
      isrc: maybe(fc.string({ minLength: 12, maxLength: 12 })),
    }),
    artist: fc.record({
      id: maybe(fc.string({ minLength: 1 })),
      name: fc.string(),
      following: maybe(fc.boolean()),
      // null (never asked), [] (asked, none), and populated — all three reachable.
      genres: fc.oneof(
        fc.constant(null),
        fc.constant([] as readonly string[]),
        fc.array(fc.constantFrom(...CORPUS_GENRES), { maxLength: 4 }),
      ),
    }),
    album: fc.record({
      name: fc.string(),
      // Full dates AND year-only, so the partial-date rule is actually exercised.
      releaseDate: maybe(
        fc.oneof(
          fc.constantFrom('2019-04-01', '2022-06-15', '2024-11-30', '1974-02-02'),
          fc.constantFrom('2022', '2016', '1998'),
        ),
      ),
      ageYears: maybe(fc.integer({ min: 0, max: 60 })),
      type: maybe(fc.constantFrom('album', 'single', 'compilation')),
    }),
    label: fc.record({
      name: maybe(fc.string()),
      classification: maybe(fc.constantFrom<LabelClass>('major', 'independent', 'unknown')),
      confidence: maybe(fc.constantFrom('high', 'medium', 'low')),
    }),
    liked: fc.record({
      atStart: maybe(fc.boolean()),
      transition: maybe(
        fc.constantFrom<LikedTransition>(
          'kept-liked',
          'kept-unliked',
          'liked-during',
          'unliked-during',
          'unknown',
        ),
      ),
    }),
    history: fc.record({
      playsOfTrack: maybe(fc.integer({ min: 0, max: 500 })),
      skipsOfTrack: maybe(fc.integer({ min: 0, max: 500 })),
      playsOfArtist: maybe(fc.integer({ min: 0, max: 5000 })),
      skipsOfArtist: maybe(fc.integer({ min: 0, max: 5000 })),
    }),
    evaluatedAtMs: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  }) as fc.Arbitrary<TrackFacts>;
}

/** A rule wrapping a generated predicate. `onUnknown` excludes 'hold' unless asked for. */
export function rule(
  predicate: fc.Arbitrary<Predicate> = predicateTree(3),
  includeHold = false,
): fc.Arbitrary<Rule> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
    name: fc.string(),
    enabled: fc.boolean(),
    action: fc.constant('skip' as const),
    onUnknown: includeHold
      ? fc.constantFrom('no-match' as const, 'match' as const, 'hold' as const)
      : fc.constantFrom('no-match' as const, 'match' as const),
    predicate,
  }) as fc.Arbitrary<Rule>;
}
