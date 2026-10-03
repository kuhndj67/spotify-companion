/**
 * FR-33's `hold` and FR-34's re-evaluation. **PBT-48**, and BR-37's asymmetry.
 *
 * ## ⚠️ The asymmetry these tests exist to pin
 *
 * A re-evaluation **may cancel a pending skip and may never create one** (BR-37.5/37.6). The permissive
 * direction is the dangerous one: a rule that declined a track on incomplete facts and then matched it
 * once the label arrived would skip a track the first pass had already cleared — acting on a judgement
 * the listener never saw being made.
 *
 * ## ⚠️ And the distinction that makes `hold` useful rather than inert
 *
 * A **held** play was never decided, so when its decision finally arrives it is `initial` and may act.
 * A **decided-then-revisited** play is `enrichment-arrived` and may only cancel. Collapsing those two
 * would either make `hold` unable to ever skip, or make BR-37.6 unenforceable.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EvaluationCoordinator,
  HOLD_MAX_MS,
} from '../src/rules/EvaluationCoordinator.js';
import type {
  EvaluationCoordinatorDeps,
  EvaluationSample,
} from '../src/rules/EvaluationCoordinator.js';
import type { ExecutionContext, LoadedRuleSet, OnUnknown } from '../src/rules/types.js';

const START = 1_000_000;

function sample(over: Partial<EvaluationSample> = {}): EvaluationSample {
  return {
    trackId: 't1',
    title: 'T',
    durationMs: 240_000,
    explicit: null,
    isrc: 'ISRC1',
    artistId: 'a1',
    artistName: 'A',
    following: null,
    albumName: 'Al',
    releaseDate: null,
    ageYears: null,
    albumType: null,
    enrichmentLanded: true,
    ...over,
  };
}

function ruleSet(onUnknown: OnUnknown, active = true): LoadedRuleSet {
  return {
    version: 1,
    contentHash: 'h',
    loadedAt: 'x',
    state: 'applied',
    rejection: null,
    rules: [
      {
        rule: {
          id: 'r1',
          name: 'Rule 1',
          enabled: true,
          action: 'skip',
          onUnknown,
          predicate: { kind: 'compare', field: 'track.title', op: 'eq', value: 'T' },
        },
        status: active ? { state: 'active' } : { state: 'disabled', reason: 'too-deep', detail: 'x' },
      },
    ],
  } as unknown as LoadedRuleSet;
}

function harness(over: { onUnknown?: OnUnknown; settled?: () => boolean } = {}) {
  const executed: ExecutionContext[] = [];
  let settledNow = false;

  const deps: EvaluationCoordinatorDeps = {
    executor: {
      execute: (ctx: ExecutionContext) => {
        executed.push(ctx);
        return ctx.evaluationId;
      },
    },
    ruleSet: () => ruleSet(over.onUnknown ?? 'no-match'),
    liveFacts: {
      isSettled: () => (over.settled ? over.settled() : settledNow),
      factSources: () => ({}) as never,
    } as unknown as EvaluationCoordinatorDeps['liveFacts'],
    historyCounts: () => ({
      playsOfTrack: 0,
      skipsOfTrack: 0,
      playsOfArtist: 0,
      skipsOfArtist: 0,
    }),
    newEvaluationId: () => 'ev-1',
    attachPlayId: () => {},
    markLinkFailed: () => {},
    enrichmentWaitMs: 10_000,
  } as unknown as EvaluationCoordinatorDeps;

  const coordinator = new EvaluationCoordinator(deps);
  return {
    coordinator,
    executed,
    settle: (v: boolean) => {
      settledNow = v;
    },
  };
}

describe('PBT-48 — the hold window is min(settled, 30s, 50% of duration)', () => {
  it('a non-holding rule still decides at ENRICHMENT_WAIT_MS', () => {
    const h = harness({ onUnknown: 'no-match' });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 5_000);
    assert.equal(h.executed.length, 0, 'not yet');
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 10_000);
    assert.equal(h.executed.length, 1, 'the 10s cap still governs rules that do not hold');
  });

  it('⚠️ a HOLDING rule waits PAST ENRICHMENT_WAIT_MS', () => {
    // BR-38.5. Reusing the 10s constant would make `hold` behave exactly like `no-match`, because the
    // rule would always time out before the label it was waiting for arrived.
    const h = harness({ onUnknown: 'hold' });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 10_000);
    assert.equal(h.executed.length, 0, 'the 10s cap must NOT end a hold');
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 29_000);
    assert.equal(h.executed.length, 0);
  });

  it(`decides at the ${HOLD_MAX_MS}ms absolute bound on a long track`, () => {
    const h = harness({ onUnknown: 'hold' });
    h.coordinator.onPlayStarted('t1', START);
    // 240s track: 50% is 120s, so the 30s cap is the lesser bound.
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + HOLD_MAX_MS);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0]?.partialData, true, 'BR-38.4: it takes the FR-35 partial-data path');
  });

  it('⭐ decides at 50% on a SHORT track, where the duration bound is the lesser one', () => {
    // BR-38.3: the duration term is a SECOND, INDEPENDENT bound. On a 40s track 50% is 20s, so taking
    // only the 30s figure would hold the rule past the track's own end — which BR-38.7 forbids.
    const h = harness({ onUnknown: 'hold' });
    h.coordinator.onPlayStarted('t1', START);
    const short = sample({ durationMs: 40_000, enrichmentLanded: false });

    h.coordinator.onTick(short, START + 19_000);
    assert.equal(h.executed.length, 0, 'still inside 50% of 40s');
    h.coordinator.onTick(short, START + 20_000);
    assert.equal(h.executed.length, 1, 'decided at half the track, not at 30s');
  });

  it('⚠️ the label arriving ends the hold immediately, ahead of either bound', () => {
    const h = harness({ onUnknown: 'hold' });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 5_000);
    assert.equal(h.executed.length, 0);

    h.settle(true);
    h.coordinator.onTick(sample(), START + 6_000);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0]?.partialData, false, 'settled, so not partial');
  });

  it('⚠️ a held decision is `initial`, not `enrichment-arrived`', () => {
    // A held play was never decided, so there is nothing to re-evaluate. This is what lets a holding
    // rule actually skip — if its late decision were tagged `enrichment-arrived`, BR-37.6 would forbid
    // it from ever acting and `hold` would be inert.
    const h = harness({ onUnknown: 'hold' });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + HOLD_MAX_MS);
    assert.equal(h.executed[0]?.trigger, 'initial');
  });

  it('a DISABLED holding rule does not extend the window', () => {
    // Only an active rule can hold. A system-disabled one is not evaluated at all.
    const executed: ExecutionContext[] = [];
    const coordinator = new EvaluationCoordinator({
      executor: { execute: (c: ExecutionContext) => (executed.push(c), c.evaluationId) },
      ruleSet: () => ruleSet('hold', false),
      liveFacts: { isSettled: () => false, factSources: () => ({}) },
      historyCounts: () => ({ playsOfTrack: 0, skipsOfTrack: 0, playsOfArtist: 0, skipsOfArtist: 0 }),
      newEvaluationId: () => 'ev-1',
      attachPlayId: () => {},
      markLinkFailed: () => {},
      enrichmentWaitMs: 10_000,
    } as unknown as EvaluationCoordinatorDeps);

    coordinator.onPlayStarted('t1', START);
    coordinator.onTick(sample({ enrichmentLanded: false }), START + 10_000);
    assert.equal(executed.length, 1, 'the ordinary 10s cap applies');
  });
});

describe('FR-34 — the second pass', () => {
  it('re-evaluates once when enrichment lands after a partial-data decision', () => {
    const h = harness({ onUnknown: 'no-match' });
    h.coordinator.onPlayStarted('t1', START);

    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 10_000);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0]?.trigger, 'initial');
    assert.equal(h.executed[0]?.partialData, true);

    h.settle(true);
    h.coordinator.onTick(sample(), START + 15_000);
    assert.equal(h.executed.length, 2);
    assert.equal(h.executed[1]?.trigger, 'enrichment-arrived');
    assert.equal(h.executed[1]?.partialData, false);
  });

  it('⭐ re-evaluates AT MOST ONCE, not on every subsequent tick', () => {
    // Without the flag this would write a decision group every 3 seconds for the rest of the track —
    // and BR-22.1a deliberately created no uniqueness constraint that would make that visible.
    const h = harness({ onUnknown: 'no-match' });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 10_000);
    h.settle(true);

    for (let t = 15_000; t <= 60_000; t += 3_000) {
      h.coordinator.onTick(sample(), START + t);
    }
    assert.equal(h.executed.length, 2, 'one initial, one re-evaluation, and no more');
  });

  it('⚠️ does NOT re-evaluate a decision that was taken on SETTLED facts', () => {
    // There is nothing left to learn, so a second pass would write an identical decision group and
    // burn a historyCountsBefore query for no information. (This is the case FactCache was specified
    // for, and the reason it stays declined.)
    const h = harness({ onUnknown: 'no-match', settled: () => true });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample(), START + 1_000);
    assert.equal(h.executed.length, 1);

    for (let t = 5_000; t <= 30_000; t += 3_000) {
      h.coordinator.onTick(sample(), START + t);
    }
    assert.equal(h.executed.length, 1, 'no second pass');
  });

  it('does not re-evaluate while enrichment is STILL missing', () => {
    const h = harness({ onUnknown: 'no-match' });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 10_000);

    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 20_000);
    assert.equal(h.executed.length, 1, 'the trigger is enrichment ARRIVING, not time passing');
  });

  it('a new play resets the re-evaluation budget', () => {
    const h = harness({ onUnknown: 'no-match' });
    h.coordinator.onPlayStarted('t1', START);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 10_000);
    h.settle(true);
    h.coordinator.onTick(sample(), START + 15_000);
    assert.equal(h.executed.length, 2);

    h.settle(false);
    h.coordinator.onPlayStarted('t1', START + 100_000);
    h.coordinator.onTick(sample({ enrichmentLanded: false }), START + 110_000);
    h.settle(true);
    h.coordinator.onTick(sample(), START + 115_000);
    assert.equal(h.executed.length, 4, 'the second play gets its own initial + re-evaluation');
  });
});
