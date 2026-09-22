/**
 * Skip attribution — who ended a skipped play.
 *
 * ⚠️ This module exists because of a defect **no test could have caught**: the observer asserted
 * `skipSource: 'user'` for every skip, and did exactly what it said. It was found by a listener
 * noticing the panel showed skips of an artist they never skip.
 *
 * So the tests below are about the *boundary* and about what the module refuses to claim, not
 * about arithmetic.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';

import {
  LATE_SUCCESSOR_MS,
  USER_SKIP_RATIO_CEILING,
  attributeSkip,
  successorLooksLate,
} from '../src/history/skipAttribution.js';
import type { OutcomeEvidence } from '../src/history/types.js';

function evidence(completionRatio: number): OutcomeEvidence {
  return {
    listenedMs: Math.round(180_000 * completionRatio),
    durationMs: 180_000,
    completionRatio,
    maxProgressMs: Math.round(180_000 * completionRatio),
    maxObservationGapMs: 3_000,
    observationCount: 40,
    sawPause: false,
    rewound: false,
    endedWithIdle: false,
  };
}

describe('attributeSkip', () => {
  it('says nothing about a play that was not a skip', () => {
    assert.equal(attributeSkip('completed', evidence(1)), null);
    assert.equal(attributeSkip('unknown', evidence(0.3)), null);
  });

  it('attributes a decisive early abandonment to the listener', () => {
    for (const ratio of [0, 0.01, 0.08, 0.3, 0.49]) {
      assert.equal(attributeSkip('skipped', evidence(ratio)), 'user', `ratio ${ratio}`);
    }
  });

  /**
   * ⚠️ The cluster this exists for. Measured on the live corpus: 18 of 35 live skips sat between
   * 0.807 and 0.895, each losing 21–41 s, each replaced seamlessly by a track the listener did
   * not choose.
   */
  it('refuses to blame the listener for a track that played nearly to the end', () => {
    for (const ratio of [0.807, 0.85, 0.871, 0.895]) {
      assert.equal(attributeSkip('skipped', evidence(ratio)), 'unattributed', `ratio ${ratio}`);
    }
  });

  it('puts the boundary exactly where the constant says', () => {
    assert.equal(attributeSkip('skipped', evidence(USER_SKIP_RATIO_CEILING - 0.001)), 'user');
    assert.equal(attributeSkip('skipped', evidence(USER_SKIP_RATIO_CEILING)), 'unattributed');
  });

  /**
   * ⚠️ The boundary sits inside an **empty measured band** — nothing in the corpus falls between
   * 0.489 and 0.807. This pins that the constant stays in that band, so a future edit that
   * "tunes" it into occupied territory has to be a deliberate act rather than a nudge.
   */
  it('keeps the threshold inside the band the corpus left empty', () => {
    assert.ok(USER_SKIP_RATIO_CEILING > 0.489, 'below this it would start excusing real skips');
    assert.ok(USER_SKIP_RATIO_CEILING < 0.807, 'above this it would start blaming the listener');
  });

  /** ⚠️ Not the completion threshold. Tying them means a change to one re-answers the other. */
  it('is a different number from the 0.90 completion threshold', () => {
    assert.notEqual(USER_SKIP_RATIO_CEILING, 0.9);
  });

  it('is total — every ratio yields an answer and nothing throws', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 5, noNaN: true }), (ratio) => {
        const result = attributeSkip('skipped', evidence(ratio));
        assert.ok(result === 'user' || result === 'unattributed');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * ⚠️ `completionRatio` is never clamped to 1.0 — it measures listened time, so a replay
   * legitimately exceeds it. An over-1.0 ratio is emphatically not a user skip.
   */
  it('handles a ratio above 1.0, which a repeat listen produces', () => {
    assert.equal(attributeSkip('skipped', evidence(1.4)), 'unattributed');
  });
});

describe('successorLooksLate', () => {
  it('is unknown-safe: no successor measured is not evidence of anything', () => {
    assert.equal(successorLooksLate(null), false);
  });

  it('flags a successor already well into itself when first seen', () => {
    assert.equal(successorLooksLate(31_000), true);
    assert.equal(successorLooksLate(LATE_SUCCESSOR_MS), true);
  });

  it('does not flag a successor seen within a poll or two', () => {
    // Every one of the 17 genuine skips had a successor first seen at 3 s or less.
    assert.equal(successorLooksLate(0), false);
    assert.equal(successorLooksLate(3_000), false);
  });

  /**
   * ⚠️ **Evidence, never a condition.** One hand-checked play sat at ratio 0.858 — squarely in
   * the upper cluster — with a successor lag of just 2 s. Had the lag been required, that play
   * would have been blamed on the listener. This test exists so a future "improvement" that
   * ANDs the two signals together fails here first.
   */
  it('is not consulted by attributeSkip', () => {
    const lateCluster = evidence(0.858);

    // No successor information is available to this call at all, by construction.
    assert.equal(attributeSkip('skipped', lateCluster), 'unattributed');
    assert.equal(attributeSkip.length, 2, 'attributeSkip takes outcome and evidence, nothing else');
  });
});
