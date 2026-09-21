/**
 * The evaluation trigger (LC-14, BR-22) and the logging executor (LC-15, BR-23, BR-30).
 *
 * ⚠️ Three properties here have no observable failure mode in production and would pass under
 * a wrong implementation without these tests:
 *   - `partialData` means the **wait timed out**, not "a field read null" (FQ3).
 *   - `not-attemptable` settles **immediately**, so a keyless track is not stamped as a
 *     timeout (BR-22.5b).
 *   - `restedOnUnknown` is copied **verbatim**, never accumulated (BR-23.5).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EvaluationCoordinator, type EvaluationSample } from '../src/rules/EvaluationCoordinator.js';
import { LoggingExecutor } from '../src/rules/LoggingExecutor.js';
import { LiveFactSource, isSettled } from '../src/rules/liveFactSource.js';
import { validateRuleSet } from '../src/rules/ruleValidator.js';
import type { DecisionLogRepository } from '../src/rules/DecisionLogRepository.js';
import type { DecisionSummaryInput } from '../src/rules/decisionSummary.js';
import type { HistoryCounts } from '../src/history/types.js';
import type { LoadedRule, NewDecisionLogEntry } from '../src/rules/types.js';

const NO_COUNTS: HistoryCounts = {
  playsOfTrack: null,
  skipsOfTrack: null,
  playsOfArtist: null,
  skipsOfArtist: null,
};

function loadedRules(...predicates: { id: string; field: string; value: unknown }[]): readonly LoadedRule[] {
  const result = validateRuleSet({
    rules: predicates.map((p) => ({
      id: p.id,
      name: p.id,
      enabled: true,
      action: 'skip',
      onUnknown: 'no-match',
      predicate: { kind: 'compare', field: p.field, op: 'eq', value: p.value },
    })),
  });
  assert.ok(result.ok, 'fixture rule set must be valid');
  return result.value;
}

/** Captures what the executor wrote, without a database. */
function spyLog(): { repo: DecisionLogRepository; rows: NewDecisionLogEntry[]; linked: string[]; failed: string[] } {
  const rows: NewDecisionLogEntry[] = [];
  const linked: string[] = [];
  const failed: string[] = [];
  return {
    rows,
    linked,
    failed,
    repo: {
      record: (entries) => void rows.push(...entries),
      attachPlayId: (id) => void linked.push(id),
      markLinkFailed: (id) => void failed.push(id),
      list: () => [],
      countSince: () => 0,
      count: () => rows.length,
      pruneToCap: () => 0,
    },
  };
}

function sample(overrides: Partial<EvaluationSample> = {}): EvaluationSample {
  return {
    trackId: 'track-1',
    title: 'A Track',
    durationMs: 180_000,
    explicit: false,
    isrc: 'USUM71703861',
    artistId: 'artist-1',
    artistName: 'An Artist',
    following: true,
    albumName: 'An Album',
    releaseDate: '2019-05-17',
    ageYears: 7,
    albumType: 'album',
    enrichmentLanded: true,
    ...overrides,
  };
}

function setup(options: { rules?: readonly LoadedRule[]; labelEnabled?: boolean; waitMs?: number } = {}) {
  const log = spyLog();
  const liveFacts = new LiveFactSource(options.labelEnabled ?? true);
  const rules = options.rules ?? loadedRules({ id: 'r1', field: 'track.explicit', value: false });
  let ids = 0;

  const coordinator = new EvaluationCoordinator({
    rules: () => rules,
    ruleSet: () => ({ version: 3, contentHash: 'set-hash', rules }),
    liveFacts,
    executor: new LoggingExecutor(log.repo),
    historyCounts: () => NO_COUNTS,
    attachPlayId: log.repo.attachPlayId,
    markLinkFailed: log.repo.markLinkFailed,
    nowMs: () => 0,
    newEvaluationId: () => `ev-${++ids}`,
    enrichmentWaitMs: options.waitMs ?? 10_000,
    onError: () => {},
  });

  return { coordinator, log, liveFacts };
}

describe('the trigger (BR-22)', () => {
  it('decides once enrichment has settled', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 1_000);

    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0]!.partialData, false, 'settling early is not a timeout');
  });

  /** ⚠️ BR-22.1. Enforced by the `decided` flag, deliberately NOT by a schema constraint. */
  it('takes exactly one decision per play, however many ticks arrive', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    for (const t of [1_000, 2_000, 3_000, 60_000]) coordinator.onTick(sample(), t);

    assert.equal(log.rows.length, 1);
  });

  it('waits while the label lookup is still pending', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelPending('track-1');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 1_000);

    assert.equal(log.rows.length, 0);
  });

  it('decides anyway when the cap fires, and marks it partialData', () => {
    const { coordinator, log, liveFacts } = setup({ waitMs: 10_000 });
    liveFacts.noteLabelPending('track-1');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 9_999);
    assert.equal(log.rows.length, 0, 'not yet');

    coordinator.onTick(sample(), 10_000);

    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0]!.partialData, true);
  });

  /**
   * ⚠️ BR-22.7's measured blind spot: a play that ENDS before the cap produces no row at all
   * — 2.8% of plays and 4 of 31 skips. Bounded and accepted, but anything counting decisions
   * must use its own denominator rather than the play count.
   */
  it('logs NOTHING for a play that ends before the cap fires', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelPending('track-1');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 3_000);
    coordinator.onPlayStarted('track-2', 4_000); // the observer moved on

    assert.equal(log.rows.length, 0, 'an absent row is not a "no match"');
  });

  it('ignores a tick for a track the observer is no longer on', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample({ trackId: 'some-other-track' }), 1_000);

    assert.equal(log.rows.length, 0, 'the observer owns the boundary, not the coordinator');
  });

  it('does nothing before a play has started', () => {
    const { coordinator, log } = setup();

    coordinator.onTick(sample(), 1_000);

    assert.equal(log.rows.length, 0);
  });

  it('counts decisions and cap firings separately, for the partialData measurement', () => {
    const { coordinator, log, liveFacts } = setup({ waitMs: 5_000 });

    liveFacts.noteLabelResult('a', 'completed');
    coordinator.onPlayStarted('a', 0);
    coordinator.onTick(sample({ trackId: 'a' }), 100);

    liveFacts.noteLabelPending('b');
    coordinator.onPlayStarted('b', 1_000);
    coordinator.onTick(sample({ trackId: 'b' }), 6_001);

    assert.equal(coordinator.stats.decisions, 2);
    assert.equal(coordinator.stats.partialData, 1);
    assert.equal(log.rows.length, 2);
  });
});

describe('⚠️ enrichmentSettled and the four confusable exits (BR-22.5)', () => {
  it('is pending only while enrichment has genuinely not landed', () => {
    assert.equal(
      isSettled({
        enrichmentLanded: false,
        labelEnrichmentEnabled: true,
        isrc: 'x',
        primaryArtistId: 'y',
        labelState: null,
      }),
      false,
    );
  });

  /**
   * ⚠️ The defect this whole module exists to prevent. Under a naive
   * not-cached-and-not-in-flight test this track waits the full cap and is stamped
   * `partialData` — recording **permanent absence as a timeout**, and corrupting the one
   * number U4 was built to measure, in the direction that reads as "the wait is too short".
   */
  it('settles IMMEDIATELY when there is no ISRC and no artist id', () => {
    assert.equal(
      isSettled({
        enrichmentLanded: true,
        labelEnrichmentEnabled: true,
        isrc: null,
        primaryArtistId: null,
        labelState: null,
      }),
      true,
    );
  });

  it('settles immediately when label enrichment is disabled entirely', () => {
    assert.equal(
      isSettled({
        enrichmentLanded: true,
        labelEnrichmentEnabled: false,
        isrc: 'x',
        primaryArtistId: 'y',
        labelState: null,
      }),
      true,
    );
  });

  it('treats a failed lookup as settled — failed is an answer, not a wait', () => {
    assert.equal(
      isSettled({
        enrichmentLanded: true,
        labelEnrichmentEnabled: true,
        isrc: 'x',
        primaryArtistId: 'y',
        labelState: 'failed',
      }),
      true,
    );
  });

  it('a keyless track is NOT recorded as a timeout', () => {
    const { coordinator, log } = setup({ waitMs: 10_000 });

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample({ isrc: null, artistId: null }), 500);

    assert.equal(log.rows.length, 1, 'decided at once, not after the cap');
    assert.equal(log.rows[0]!.partialData, false, 'permanent absence is not a timeout');
  });
});

describe('what gets logged (BR-23)', () => {
  it('writes one row per rule evaluated, matched or not', () => {
    const rules = loadedRules(
      { id: 'matches', field: 'track.explicit', value: false },
      { id: 'does-not', field: 'track.explicit', value: true },
    );
    const { coordinator, log, liveFacts } = setup({ rules });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);

    assert.equal(log.rows.length, 2, 'a matched-only log cannot answer "why did it not fire?"');
    assert.deepEqual(log.rows.map((r) => r.ruleId).sort(), ['does-not', 'matches']);
    assert.equal(log.rows.find((r) => r.ruleId === 'matches')!.matched, true);
    assert.equal(log.rows.find((r) => r.ruleId === 'does-not')!.matched, false);
  });

  it('shares one evaluationId across the rows of a decision', () => {
    const rules = loadedRules(
      { id: 'a', field: 'track.explicit', value: false },
      { id: 'b', field: 'album.type', value: 'album' },
    );
    const { coordinator, log, liveFacts } = setup({ rules });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);

    assert.equal(new Set(log.rows.map((r) => r.evaluationId)).size, 1);
  });

  it('stamps the rule set hash, not only its resettable version number', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);

    assert.equal(log.rows[0]!.ruleSetVersion, 3);
    assert.equal(log.rows[0]!.ruleSetContentHash, 'set-hash');
  });

  it('records every field the rule read, including those that read null', () => {
    const rules = loadedRules({ id: 'label', field: 'label.classification', value: 'major' });
    const { coordinator, log, liveFacts } = setup({ rules });
    liveFacts.noteLabelResult('track-1', 'failed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);

    assert.ok('label.classification' in log.rows[0]!.fieldsSeen);
    assert.equal(log.rows[0]!.fieldsSeen['label.classification'], null);
  });

  it('is always dry-run, never executed, with no error (BR-23.8)', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);

    assert.equal(log.rows[0]!.dryRun, true);
    assert.equal(log.rows[0]!.executed, false);
    assert.equal(log.rows[0]!.error, null);
  });

  /**
   * ⚠️ BR-23.5. Under Kleene logic a predicate can contain an unknown and still resolve
   * decisively — the tempting implementation, a flag raised anywhere during the walk, silently
   * implements the option that was offered and rejected.
   */
  it('copies restedOnUnknown verbatim rather than accumulating it', () => {
    const rules = loadedRules({ id: 'decisive', field: 'track.explicit', value: true });
    const { coordinator, log, liveFacts } = setup({ rules });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    // explicit is false, so the predicate resolves FALSE decisively even though other fields
    // in the facts are unknown.
    coordinator.onTick(sample({ explicit: false }), 100);

    assert.equal(log.rows[0]!.verdict, 'false');
    assert.equal(log.rows[0]!.restedOnUnknown, false, 'the data answered it');
  });
});

describe('the play link (BR-24)', () => {
  it('links when the play is recorded', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);
    coordinator.onPlayRecorded('track-1', 42);

    assert.deepEqual(log.linked, ['ev-1']);
    assert.deepEqual(log.failed, []);
  });

  /** ⚠️ The distinction `playLink` exists for. */
  it('marks link-failed when the play row could not be written', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);
    coordinator.onPlayDropped('track-1');

    assert.deepEqual(log.failed, ['ev-1']);
    assert.deepEqual(log.linked, []);
  });

  it('does not link a play that was never decided', () => {
    const { coordinator, log, liveFacts } = setup();
    liveFacts.noteLabelPending('track-1');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onPlayRecorded('track-1', 42);

    assert.deepEqual(log.linked, [], 'no decision, nothing to link');
  });
});

describe('failures never stop the poll loop', () => {
  /**
   * ⚠️ BR-20.10 applied to the trigger: rules are text that can be retyped, and the play
   * records are the artefact that cannot be regenerated. A logging fault must not take the
   * recorder down with it.
   */
  it('counts a logging failure and carries on', () => {
    const liveFacts = new LiveFactSource(true);
    const rules = loadedRules({ id: 'r1', field: 'track.explicit', value: false });
    const coordinator = new EvaluationCoordinator({
      rules: () => rules,
      ruleSet: () => ({ version: 1, contentHash: 'h', rules }),
      liveFacts,
      executor: {
        execute: () => {
          throw new Error('disk full');
        },
      },
      historyCounts: () => NO_COUNTS,
      attachPlayId: () => {},
      markLinkFailed: () => {},
      nowMs: () => 0,
      newEvaluationId: () => 'ev-1',
      enrichmentWaitMs: 10_000,
      onError: () => {},
    });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    assert.doesNotThrow(() => coordinator.onTick(sample(), 100));

    assert.equal(coordinator.stats.errors, 1);
    assert.equal(coordinator.stats.decisions, 0, 'a failed write is not a decision');
  });

  it('does not retry a decision that threw, which would double-log the play', () => {
    let calls = 0;
    const liveFacts = new LiveFactSource(true);
    const rules = loadedRules({ id: 'r1', field: 'track.explicit', value: false });
    const coordinator = new EvaluationCoordinator({
      rules: () => rules,
      ruleSet: () => ({ version: 1, contentHash: 'h', rules }),
      liveFacts,
      executor: {
        execute: () => {
          calls += 1;
          throw new Error('disk full');
        },
      },
      historyCounts: () => NO_COUNTS,
      attachPlayId: () => {},
      markLinkFailed: () => {},
      nowMs: () => 0,
      newEvaluationId: () => 'ev-1',
      enrichmentWaitMs: 10_000,
      onError: () => {},
    });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);
    coordinator.onTick(sample(), 200);

    assert.equal(calls, 1);
  });
});

describe('the decision summary hook', () => {
  it('fires once per decision, with the elapsed time and every rule', () => {
    const summaries: DecisionSummaryInput[] = [];
    const log = spyLog();
    const liveFacts = new LiveFactSource(true);
    const rules = loadedRules(
      { id: 'a', field: 'track.explicit', value: false },
      { id: 'b', field: 'track.explicit', value: true },
    );
    const coordinator = new EvaluationCoordinator({
      rules: () => rules,
      ruleSet: () => ({ version: 1, contentHash: 'h', rules }),
      liveFacts,
      executor: new LoggingExecutor(log.repo),
      historyCounts: () => NO_COUNTS,
      attachPlayId: () => {},
      markLinkFailed: () => {},
      nowMs: () => 0,
      newEvaluationId: () => 'ev-1',
      enrichmentWaitMs: 10_000,
      onDecision: (s) => void summaries.push(s),
    });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 1_000);
    coordinator.onTick(sample(), 5_200);

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]!.elapsedMs, 4_200, 'measured from the play start, not from zero');
    assert.equal(summaries[0]!.partialData, false);
    assert.deepEqual(summaries[0]!.rules.map((r) => r.name).sort(), ['a', 'b']);
  });

  /** It fires AFTER the rows are written, so a line on screen always means a row in the log. */
  it('does not fire when the write failed', () => {
    const summaries: DecisionSummaryInput[] = [];
    const liveFacts = new LiveFactSource(true);
    const rules = loadedRules({ id: 'a', field: 'track.explicit', value: false });
    const coordinator = new EvaluationCoordinator({
      rules: () => rules,
      ruleSet: () => ({ version: 1, contentHash: 'h', rules }),
      liveFacts,
      executor: {
        execute: () => {
          throw new Error('disk full');
        },
      },
      historyCounts: () => NO_COUNTS,
      attachPlayId: () => {},
      markLinkFailed: () => {},
      nowMs: () => 0,
      newEvaluationId: () => 'ev-1',
      enrichmentWaitMs: 10_000,
      onError: () => {},
      onDecision: (s) => void summaries.push(s),
    });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    coordinator.onTick(sample(), 100);

    assert.deepEqual(summaries, [], 'a log line implying a row that does not exist is worse than silence');
  });

  /** ⚠️ Logging is the least important thing here and must never reach the poll loop. */
  it('survives a hook that throws', () => {
    const log = spyLog();
    const liveFacts = new LiveFactSource(true);
    const rules = loadedRules({ id: 'a', field: 'track.explicit', value: false });
    const coordinator = new EvaluationCoordinator({
      rules: () => rules,
      ruleSet: () => ({ version: 1, contentHash: 'h', rules }),
      liveFacts,
      executor: new LoggingExecutor(log.repo),
      historyCounts: () => NO_COUNTS,
      attachPlayId: () => {},
      markLinkFailed: () => {},
      nowMs: () => 0,
      newEvaluationId: () => 'ev-1',
      enrichmentWaitMs: 10_000,
      onError: () => {},
      onDecision: () => {
        throw new Error('stdout is gone');
      },
    });
    liveFacts.noteLabelResult('track-1', 'completed');

    coordinator.onPlayStarted('track-1', 0);
    assert.doesNotThrow(() => coordinator.onTick(sample(), 100));
    assert.equal(log.rows.length, 1, 'the decision was still recorded');
  });
});

describe('⚠️ the phase boundary (BR-30)', () => {
  /**
   * An injected-but-uncalled `PlaybackController` would reduce the boundary to one line of
   * restraint. This asserts the constructor's arity structurally, so adding a second
   * collaborator breaks a test rather than passing review.
   */
  it('LoggingExecutor takes the decision log and nothing else', () => {
    assert.equal(LoggingExecutor.length, 1, 'no second collaborator, not even an unused one');
  });
});
