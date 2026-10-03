/**
 * LC-25 — the second `DecisionExecutor`, and where the one-attempt budget is spent.
 *
 * ## ⚠️ What these tests are guarding
 *
 *   - **`execute` stays synchronous and never posts.** If it ever returns a promise, the safety check
 *     moves to the wrong place (BR-33.5) and an unawaited rejection inside the poll timer becomes a
 *     skip that silently never happened.
 *   - **The budget is spent here, not in the drain.** The row being drained is itself an attempt for
 *     that play, so a drain-time check would refuse every attempt as a duplicate of itself.
 *   - **A second attempt is RECORDED, not dropped** (BR-36.3). *Why is this absent* must never be
 *     inferred from the absence.
 *   - **`LoggingExecutor` is unchanged structurally.** `length === 1` is U4's phase guard and must
 *     survive this file existing.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { MIGRATIONS, migrate } from '../src/history/migrations.js';
import { SkipExecutor } from '../src/playback/SkipExecutor.js';
import { SqliteSkipAttemptRepository } from '../src/playback/SqliteSkipAttemptRepository.js';
import type { AutomationState } from '../src/playback/types.js';
import { LoggingExecutor } from '../src/rules/LoggingExecutor.js';
import type {
  Decision,
  ExecutionContext,
  LoadedRuleSet,
  NewDecisionLogEntry,
} from '../src/rules/types.js';

const EV = 'ev-1';

function armed(over: Partial<AutomationState> = {}): AutomationState {
  return { globalAutomationEnabled: true, runawayHalt: null, schemaVersion: 1, ...over };
}

function ruleSet(ids: string[] = ['r1'], enabled = true, dryRun = false): LoadedRuleSet {
  return {
    version: 1,
    contentHash: 'h',
    loadedAt: 'x',
    state: 'applied',
    rejection: null,
    rules: ids.map((id) => ({
      rule: {
        id,
        name: `Rule ${id}`,
        enabled,
        action: 'skip',
        onUnknown: 'no-match',
        predicate: { kind: 'compare', field: 'track.title', op: 'eq', value: 'x' },
        dryRun,
      },
      status: { state: 'active' },
    })),
  } as unknown as LoadedRuleSet;
}

function context(matchedIds: string[], set = ruleSet()): ExecutionContext {
  const decision = {
    outcomes: set.rules.map((l) => ({
      ruleId: l.rule.id,
      verdict: matchedIds.includes(l.rule.id) ? 'true' : 'false',
      applied: matchedIds.includes(l.rule.id),
      restedOnUnknown: false,
      fieldsSeen: {},
    })),
    matchedRuleIds: matchedIds,
    unknownFields: [],
  } as unknown as Decision;

  return {
    decision,
    ruleSet: set,
    trackId: 't1',
    evaluationId: EV,
    decidedAt: '2026-10-02T12:00:00.000Z',
    partialData: false,
    trigger: 'initial',
  };
}

function harness(over: { state?: AutomationState } = {}) {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS);
  const attempts = new SqliteSkipAttemptRepository(db);

  const recorded: NewDecisionLogEntry[][] = [];
  let drains = 0;

  const executor = new SkipExecutor({
    log: { record: (e: readonly NewDecisionLogEntry[]) => recorded.push([...e]) } as never,
    attempts,
    state: {
      read: () => ({ state: over.state ?? armed(), source: 'file' as const }),
      write: () => ({ ok: true as const }),
    } as never,
    nowIso: () => '2026-10-02T12:00:00.000Z',
    scheduleDrain: () => {
      drains += 1;
    },
  });

  return { executor, attempts, recorded, drains: () => drains, db };
}

describe('⚠️ execute is SYNCHRONOUS and issues no player command', () => {
  it('returns the evaluationId, not a promise', () => {
    const h = harness();
    const result = h.executor.execute(context(['r1']));
    assert.equal(result, EV);
    assert.equal(
      typeof (result as unknown as { then?: unknown }).then,
      'undefined',
      'an async execute would move the safety check to the wrong place (BR-33.5)',
    );
    h.db.close();
  });

  it('enqueues a queued attempt and schedules a drain', () => {
    const h = harness();
    h.executor.execute(context(['r1']));

    const queued = h.attempts.queued();
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.state, 'queued');
    assert.equal(queued[0]?.ruleId, 'r1');
    assert.equal(h.drains(), 1, 'the drain is scheduled, never awaited');
    h.db.close();
  });

  it('⚠️ writes playId as NULL, because the play row does not exist yet', () => {
    const h = harness();
    h.executor.execute(context(['r1']));
    assert.equal(h.attempts.queued()[0]?.playId, null);
    h.db.close();
  });
});

describe('the decision log is written either way (BR-34.8)', () => {
  it('records one row per rule EVALUATED, matched or not', () => {
    const h = harness();
    h.executor.execute(context(['r1'], ruleSet(['r1', 'r2'])));
    assert.equal(h.recorded[0]?.length, 2, 'a matched-only log cannot answer "why did my rule not fire?"');
    h.db.close();
  });

  it('⚠️ records even when automation is OFF — only action stops', () => {
    const h = harness({ state: armed({ globalAutomationEnabled: false }) });
    h.executor.execute(context(['r1']));
    assert.equal(h.recorded.length, 1, 'throwing the kill switch never cancels the decision log');
    assert.equal(h.recorded[0]?.[0]?.dryRun, true, 'and the row says it was a dry run');
    h.db.close();
  });

  it('marks dryRun FALSE when the rule is genuinely live', () => {
    const h = harness();
    h.executor.execute(context(['r1']));
    assert.equal(h.recorded[0]?.[0]?.dryRun, false);
    h.db.close();
  });

  it('marks dryRun TRUE when the rule itself is in dry-run', () => {
    const h = harness();
    h.executor.execute(context(['r1'], ruleSet(['r1'], true, true)));
    assert.equal(h.recorded[0]?.[0]?.dryRun, true);
    h.db.close();
  });

  it('carries the trigger through to the row', () => {
    const h = harness();
    h.executor.execute({ ...context(['r1']), trigger: 'enrichment-arrived' });
    assert.equal(h.recorded[0]?.[0]?.trigger, 'enrichment-arrived');
    h.db.close();
  });
});

describe('no match means no attempt', () => {
  it('records the decision and enqueues nothing', () => {
    const h = harness();
    h.executor.execute(context([]));
    assert.equal(h.recorded.length, 1);
    assert.equal(h.attempts.queued().length, 0);
    assert.equal(h.drains(), 0);
    h.db.close();
  });
});

describe('⭐ the one-attempt budget is spent HERE', () => {
  it('a second execute for the same play is refused as already-attempted', () => {
    const h = harness();
    h.executor.execute(context(['r1']));
    h.executor.execute(context(['r1']));

    // ⚠️ RECORDED, not dropped (BR-36.3).
    const all = [1, 2].map((id) => h.attempts.get(id));
    assert.equal(all[0]?.state, 'queued');
    assert.equal(all[1]?.state, 'refused');
    assert.equal(all[1]?.refusedReason, 'already-attempted');
    assert.equal(h.drains(), 1, 'and no second drain is scheduled');
    h.db.close();
  });

  it('⚠️ refused whatever the first attempt outcome was', () => {
    // BR-36.4: one attempt is the budget; a failed attempt does not earn a retry.
    const h = harness();
    h.executor.execute(context(['r1']));
    h.attempts.transition(1, 'unconfirmed', { firedAt: 'x' });

    h.executor.execute(context(['r1']));
    assert.equal(h.attempts.get(2)?.refusedReason, 'already-attempted');
    h.db.close();
  });

  it('a DIFFERENT play is not blocked', () => {
    const h = harness();
    h.executor.execute(context(['r1']));
    h.executor.execute({ ...context(['r1']), evaluationId: 'ev-2' });

    assert.equal(h.attempts.get(2)?.state, 'queued', 'a new play gets its own budget');
    assert.equal(h.drains(), 2);
    h.db.close();
  });
});

describe('⚠️ rule selection, stated rather than inferred', () => {
  it('takes the first matched rule in RULE-SET order', () => {
    // One attempt per play means one rule acts, and precedence is out of scope for U5 (Q-B). Set
    // order is the only ordering that exists.
    const h = harness();
    h.executor.execute(context(['r2', 'r1'], ruleSet(['r1', 'r2'])));
    assert.equal(h.attempts.queued()[0]?.ruleId, 'r1', 'set order, not matchedRuleIds order');
    h.db.close();
  });
});

describe('⚠️ BR-30: LoggingExecutor is unchanged, and still takes one collaborator', () => {
  it('LoggingExecutor.length === 1 — U4s phase guard survives', () => {
    assert.equal(
      LoggingExecutor.length,
      1,
      'An injected-but-uncalled playback collaborator is one line away from being called, and the ' +
        'boundary would then be a runtime flag rather than a structural fact.',
    );
  });

  it('⚠️ and SkipExecutor is a SEPARATE class, not a subclass', () => {
    assert.ok(
      !(SkipExecutor.prototype instanceof LoggingExecutor),
      'BR-30: added alongside, never grown out of',
    );
  });

  it('both write identical rows, from one shared builder', () => {
    // If the row building were duplicated, these would drift. The WebSocket 403 is what that looks
    // like once the copies disagree.
    const h = harness();
    const logged: NewDecisionLogEntry[][] = [];
    const logging = new LoggingExecutor({
      record: (e: readonly NewDecisionLogEntry[]) => logged.push([...e]),
    } as never);

    const ctx = context(['r1']);
    logging.execute(ctx);
    h.executor.execute(ctx);

    const fromLogging = { ...logged[0]?.[0] } as Record<string, unknown>;
    const fromSkip = { ...h.recorded[0]?.[0] } as Record<string, unknown>;
    // dryRun is the ONE field that legitimately differs between them.
    delete fromLogging['dryRun'];
    delete fromSkip['dryRun'];
    assert.deepEqual(fromSkip, fromLogging);
    h.db.close();
  });
});
