/**
 * Label classifier — property tests (NFR-20, NFR-22).
 *
 * The example suite pins the *measured* cases. These pin the **asymmetry**, which is the property
 * the standing rule actually asks for and the one an innocent-looking refactor is most likely to
 * break:
 *
 * > User, Q5: *"prioritise accuracy in the 'Artist Is Independent' determination even if it
 * > ultimately misses some independent products."*
 *
 * Stated as arithmetic: **any major vote at any strength blocks `independent`**, while a single
 * strong major vote is enough to produce `major`. A majority rule, a vote count, or a "most
 * frequent label wins" tiebreak would all pass the example tests and fail these.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import './fc-config.js';
import { classify } from '../src/musicbrainz/labelClassifier.js';
import { MAJOR_ROOTS, matchMajorRoot } from '../src/musicbrainz/majorRootList.js';
import type { ClassificationContext } from '../src/musicbrainz/types.js';
import {
  INDIE_LABEL_NAMES,
  anyCandidateArb,
  eligibleLabelTypeArb,
  indieCandidateArb,
  majorCandidateArb,
  narrowingTierArb,
  strongLabelTypeArb,
} from './labelGenerators.js';

const baseContext = (tier: ContextTier = 'title-date'): ClassificationContext => ({
  majorRoots: MAJOR_ROOTS,
  narrowingTier: tier,
  isrcVote: null,
});

type ContextTier = ClassificationContext['narrowingTier'];

describe('the generators themselves are sound', () => {
  // A generated "independent" name that happened to normalise to a major root would make every
  // asymmetry property below pass for the wrong reason. A green test that verifies nothing is
  // worse than no test, so the pool is checked rather than trusted.
  it('no independent label name accidentally matches a major root', () => {
    for (const name of INDIE_LABEL_NAMES) {
      assert.equal(
        matchMajorRoot(name),
        null,
        `"${name}" is in the independent pool but matches a major root`,
      );
    }
  });
});

describe('P-1 — a strong major vote always yields major', () => {
  it('holds however many independents accompany it', () => {
    fc.assert(
      fc.property(
        majorCandidateArb(strongLabelTypeArb),
        fc.array(indieCandidateArb(), { maxLength: 12 }),
        narrowingTierArb,
        (major, indies, tier) => {
          const result = classify([major, ...indies], baseContext(tier));
          assert.equal(result.verdict, 'major');
        },
      ),
    );
  });

  it('holds regardless of where the major appears in the list', () => {
    fc.assert(
      fc.property(
        fc.array(indieCandidateArb(), { maxLength: 8 }),
        majorCandidateArb(strongLabelTypeArb),
        fc.array(indieCandidateArb(), { maxLength: 8 }),
        (before, major, after) => {
          const result = classify([...before, major, ...after], baseContext());
          assert.equal(result.verdict, 'major');
        },
      ),
    );
  });
});

describe('P-2 — independent requires the absence of any major vote', () => {
  it('never returns independent when a major name is present at any strength', () => {
    fc.assert(
      fc.property(
        majorCandidateArb(eligibleLabelTypeArb),
        fc.array(indieCandidateArb(), { maxLength: 12 }),
        narrowingTierArb,
        (major, indies, tier) => {
          const result = classify([major, ...indies], baseContext(tier));
          assert.notEqual(
            result.verdict,
            'independent',
            'a major vote must block independent — this is the rule that keeps the error budget asymmetric',
          );
        },
      ),
    );
  });

  it('never returns independent when the ISRC signal votes major', () => {
    fc.assert(
      fc.property(fc.array(indieCandidateArb(), { minLength: 1, maxLength: 8 }), (indies) => {
        const result = classify(indies, {
          ...baseContext(),
          isrcVote: {
            signal: 'isrc-prefix',
            verdict: 'major',
            strength: 'weak',
            evidence: 'generated',
          },
        });
        assert.notEqual(result.verdict, 'independent');
      }),
    );
  });
});

describe('P-3 — unknown never becomes independent', () => {
  it('an empty candidate set is always unknown, whatever the ISRC says', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('major' as const, 'independent' as const, 'unknown' as const),
        narrowingTierArb,
        (isrcVerdict, tier) => {
          const result = classify([], {
            ...baseContext(tier),
            isrcVote: {
              signal: 'isrc-prefix',
              verdict: isrcVerdict,
              strength: 'weak',
              evidence: 'generated',
            },
          });
          // The registrant prefix is a correlation, not evidence of a signing. It is retained as
          // a vote but must never carry a verdict on its own.
          assert.equal(result.verdict, 'unknown');
        },
      ),
    );
  });

  it('candidates that are all suppressed yield unknown, never independent', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            indieCandidateArb(fc.constant('Publisher')),
            majorCandidateArb(fc.constant('Publisher')),
          ),
          { minLength: 1, maxLength: 8 },
        ),
        (publishers) => {
          const result = classify(publishers, baseContext());
          assert.equal(result.verdict, 'unknown');
          assert.equal(result.unknownReason, 'noEligibleCandidate');
        },
      ),
    );
  });
});

describe('P-4 — the classifier is a function of its arguments', () => {
  it('is deterministic: the same input always yields the same verdict', () => {
    // FR-20 and FR-42 both depend on this. A Date.now() here would break reclassification and
    // back-testing while every example test still passed.
    fc.assert(
      fc.property(
        fc.array(anyCandidateArb, { maxLength: 10 }),
        narrowingTierArb,
        (candidates, tier) => {
          const first = classify(candidates, baseContext(tier));
          const second = classify(candidates, baseContext(tier));
          assert.deepEqual(first, second);
        },
      ),
    );
  });

  it('never mutates the candidates it is given', () => {
    fc.assert(
      fc.property(fc.array(anyCandidateArb, { maxLength: 10 }), (candidates) => {
        const snapshot = structuredClone(candidates);
        classify(candidates, baseContext());
        assert.deepEqual(candidates, snapshot);
      }),
    );
  });
});

describe('P-5 — confidence caps are honoured', () => {
  it('tier `all` never produces a confidence above low', () => {
    fc.assert(
      fc.property(fc.array(anyCandidateArb, { maxLength: 10 }), (candidates) => {
        const result = classify(candidates, baseContext('all'));
        assert.equal(result.confidence, 'low');
      }),
    );
  });

  it('an artist-level cap is never exceeded', () => {
    fc.assert(
      fc.property(
        fc.array(anyCandidateArb, { maxLength: 10 }),
        narrowingTierArb,
        (candidates, tier) => {
          const result = classify(candidates, {
            ...baseContext(tier),
            capConfidenceAt: 'medium',
          });
          assert.notEqual(result.confidence, 'high');
        },
      ),
    );
  });
});

describe('P-6 — every verdict carries its evidence', () => {
  it('always reports at least one rule that fired', () => {
    fc.assert(
      fc.property(
        fc.array(anyCandidateArb, { maxLength: 10 }),
        narrowingTierArb,
        (candidates, tier) => {
          const result = classify(candidates, baseContext(tier));
          assert.ok(
            result.rulesFired.length > 0,
            'a verdict with no rule attached cannot be explained (BR-12.3)',
          );
        },
      ),
    );
  });

  it('reports an unknownReason exactly when the verdict is unknown', () => {
    fc.assert(
      fc.property(
        fc.array(anyCandidateArb, { maxLength: 10 }),
        narrowingTierArb,
        (candidates, tier) => {
          const result = classify(candidates, baseContext(tier));
          assert.equal(
            result.unknownReason !== null,
            result.verdict === 'unknown',
            'unknown must always say why, and a known verdict must never claim a reason',
          );
        },
      ),
    );
  });

  it('lists only eligible labels in labelNames', () => {
    // Suppressed candidates must not leak into the names shown to a reader — a Publisher
    // appearing in the label list would suggest it contributed to the verdict.
    fc.assert(
      fc.property(fc.array(anyCandidateArb, { maxLength: 10 }), (candidates) => {
        const result = classify(candidates, baseContext());
        for (const name of result.labelNames) {
          assert.notEqual(name, '[no label]');
          assert.notEqual(name, '');
        }
      }),
    );
  });
});
