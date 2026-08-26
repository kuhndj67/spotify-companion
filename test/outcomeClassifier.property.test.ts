/**
 * Properties P-1 … P-11 for outcome classification (NFR-22, PBT-02/03).
 *
 * These are the invariants that must hold for *every* trail, not just the ones anyone thought to
 * write down. The classifier is pure and total, which is what makes exhaustive generation viable
 * here — and is itself the reason the purity rule matters.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import {
  CLASSIFIER_VERSION,
  classify,
  reclassify,
  summarise,
  DEFAULT_TOLERANCES,
} from '../src/history/outcomeClassifier.js';
import type { CloseReason } from '../src/history/types.js';
import { buildTrail, replayTrail, trailArb, trailSpecArb } from './historyGenerators.js';

const T = DEFAULT_TOLERANCES;

const closeReasonArb = fc.constantFrom<CloseReason>(
  'track-change',
  'pause-idle',
  'playback-stopped',
  'app-shutdown',
);

describe('P-1: classify is total', () => {
  it('never throws, for any trail and any close reason', () => {
    fc.assert(
      fc.property(trailArb, closeReasonArb, (trail, reason) => {
        reclassify(trail, reason, T);
      }),
    );
  });

  it('never throws on degenerate trails', () => {
    fc.assert(
      fc.property(closeReasonArb, (reason) => {
        reclassify([], reason, T);
      }),
    );
  });
});

describe('P-2: the outcome is always one of exactly three values', () => {
  it('holds for every trail', () => {
    fc.assert(
      fc.property(trailArb, closeReasonArb, (trail, reason) => {
        const { outcome } = reclassify(trail, reason, T);
        assert.ok(outcome === 'completed' || outcome === 'skipped' || outcome === 'unknown');
      }),
    );
  });
});

describe('P-3: completionRatio >= 0 and is NOT bounded above', () => {
  it('is never negative and never NaN', () => {
    fc.assert(
      fc.property(trailArb, (trail) => {
        const { completionRatio } = summarise(trail, T);
        assert.ok(completionRatio >= 0, `ratio was ${completionRatio}`);
        assert.ok(Number.isFinite(completionRatio));
      }),
    );
  });

  it('exceeds 1.0 when a track is listened through more than once', () => {
    // Guards the property most likely to be broken by "defensive" clamping. A clamp would make
    // this fail, which is the point: the difference between hearing a track once and four times
    // is exactly what the unclamped ratio carries.
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (times) => {
        const ratio = summarise(replayTrail(90_000, times), T).completionRatio;
        assert.ok(ratio > times - 1, `${times} listens produced a ratio of only ${ratio}`);
      }),
    );
  });
});

describe('P-3b: listened time never exceeds the play wall-clock span (BR-2.10)', () => {
  it('holds even when the trail contains forward seeks', () => {
    fc.assert(
      fc.property(trailArb, (trail) => {
        if (trail.length < 2) return;
        const { listenedMs } = summarise(trail, T);
        const span = trail[trail.length - 1]!.atMs - trail[0]!.atMs;
        const allowance = trail[0]!.progressMs + trail.length * T.jitterToleranceMs;
        assert.ok(
          listenedMs <= span + allowance,
          `listened ${listenedMs} exceeded span ${span} plus allowance ${allowance}`,
        );
      }),
    );
  });
});

describe('P-4: classification is deterministic', () => {
  it('the same trail and parameters always give the same verdict', () => {
    fc.assert(
      fc.property(trailArb, closeReasonArb, (trail, reason) => {
        assert.deepEqual(reclassify(trail, reason, T), reclassify(trail, reason, T));
      }),
    );
  });
});

describe('P-5: listened time counts only forward movement', () => {
  it('appending a rewind never decreases listened time', () => {
    fc.assert(
      fc.property(trailSpecArb, fc.integer({ min: 5000, max: 60_000 }), (spec, byMs) => {
        const base = buildTrail(spec);
        const rewound = buildTrail({ ...spec, steps: [...spec.steps, { kind: 'rewind', byMs }] });
        assert.ok(summarise(rewound, T).listenedMs >= summarise(base, T).listenedMs);
      }),
    );
  });
});

describe('P-6: reaching the threshold is never a skip', () => {
  it('holds for any close reason', () => {
    fc.assert(
      fc.property(trailArb, closeReasonArb, (trail, reason) => {
        const evidence = summarise(trail, T);
        if (evidence.durationMs <= 0) return;
        if (evidence.completionRatio < T.completionThreshold) return;
        assert.equal(classify(evidence, T, reason).outcome, 'completed');
      }),
    );
  });
});

describe('P-7: never reaching the threshold is never a completion', () => {
  it('a below-threshold trail ending in a track change is skipped', () => {
    fc.assert(
      fc.property(trailArb, (trail) => {
        const evidence = summarise(trail, T);
        if (evidence.durationMs <= 0) return;
        if (evidence.completionRatio >= T.completionThreshold) return;
        assert.equal(classify(evidence, T, 'track-change').outcome, 'skipped');
      }),
    );
  });
});

describe('P-8: reclassification is idempotent', () => {
  it('re-running with unchanged parameters changes nothing', () => {
    fc.assert(
      fc.property(trailArb, closeReasonArb, (trail, reason) => {
        const first = reclassify(trail, reason, T);
        const second = reclassify(trail, reason, T);
        assert.deepEqual(first.evidence, second.evidence);
        assert.equal(first.outcome, second.outcome);
      }),
    );
  });
});

describe('P-9: classification mutates nothing', () => {
  it('the trail is unchanged afterwards', () => {
    fc.assert(
      fc.property(trailArb, closeReasonArb, (trail, reason) => {
        const before = structuredClone(trail);
        reclassify(trail, reason, T);
        assert.deepEqual(trail, before);
      }),
    );
  });
});

describe('P-11: engagement never lowers the ratio', () => {
  it('a rewind followed by re-listening never decreases completionRatio', () => {
    // The formal statement of why no rewind rule is needed. If this ever fails, the
    // simplification is unsound and explicit rewind handling has to come back.
    fc.assert(
      fc.property(
        trailSpecArb,
        fc.integer({ min: 5000, max: 60_000 }),
        fc.integer({ min: 1, max: 10 }),
        (spec, byMs, replays) => {
          const base = buildTrail(spec);
          const engaged = buildTrail({
            ...spec,
            steps: [
              ...spec.steps,
              { kind: 'rewind', byMs },
              ...Array.from({ length: replays }, () => ({ kind: 'play' }) as const),
            ],
          });
          assert.ok(
            summarise(engaged, T).completionRatio >= summarise(base, T).completionRatio,
            'engagement must never reduce the ratio',
          );
        },
      ),
    );
  });
});

describe('classifier version', () => {
  it('is a positive integer, so a partially reclassified database is auditable', () => {
    assert.ok(Number.isInteger(CLASSIFIER_VERSION) && CLASSIFIER_VERSION > 0);
  });
});
