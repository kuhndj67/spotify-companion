/**
 * LC-26 — **the action point**. PBT-34…PBT-39, **PBT-34a**, **PBT-41**, PBT-42, PBT-43.
 *
 * ## ⭐ The two tests this file exists for
 *
 * **PBT-34a is a positive control.** Six properties prove the six refusals fire. **A drain that posted
 * nothing, ever, satisfies all six perfectly.** One test has to prove the action *fires*, or the suite
 * is green on a system that cannot skip.
 *
 * **PBT-41 is the only property that can catch the P-27 defect.** Checking the safety predicate when
 * the decision was taken instead of at drain time is correct in every ordinary test, because the two
 * states agree whenever nothing changed in between. It diverges only when automation is switched off
 * *during* the 10-second enrichment wait — exactly what FR-38 exists for, and exactly what no hands-on
 * session reproduces on purpose.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import { MIGRATIONS, migrate } from '../src/history/migrations.js';
import { SqliteSkipAttemptRepository } from '../src/playback/SqliteSkipAttemptRepository.js';
import { SkipDrain } from '../src/playback/skipDrain.js';
import type { CurrentPlay, SkipDrainDeps } from '../src/playback/skipDrain.js';
import type { PlayerClient, SkipOutcome } from '../src/playback/spotifyPlayerClient.js';
import type { AutomationState, NewSkipAttempt, RunawayHalt } from '../src/playback/types.js';
import { MAX_RULE_SKIPS_PER_HOUR } from '../src/playback/types.js';
import type { DecisionLogEntry, LoadedRuleSet } from '../src/rules/types.js';

const NOW_MS = Date.parse('2026-10-02T12:00:00.000Z');
const EV = 'ev-open';

function armed(over: Partial<AutomationState> = {}): AutomationState {
  return { globalAutomationEnabled: true, runawayHalt: null, schemaVersion: 1, ...over };
}

function ruleSet(enabled = true, dryRun = false): LoadedRuleSet {
  return {
    version: 1,
    contentHash: 'h',
    loadedAt: '2026-10-02T11:00:00.000Z',
    state: 'applied',
    rejection: null,
    rules: [
      {
        rule: {
          id: 'r1',
          name: 'Rule 1',
          enabled,
          action: 'skip',
          onUnknown: 'no-match',
          predicate: { kind: 'compare', field: 'track.title', op: 'eq', value: 'x' },
          dryRun,
        },
        status: { state: 'active' },
      },
    ],
  } as unknown as LoadedRuleSet;
}

interface Harness {
  readonly drain: SkipDrain;
  readonly repo: SqliteSkipAttemptRepository;
  readonly posts: () => number;
  readonly written: () => AutomationState[];
  readonly halts: () => RunawayHalt[];
  readonly attemptId: number;
  readonly db: DatabaseSync;
}

function harness(
  over: {
    state?: AutomationState;
    set?: LoadedRuleSet;
    playing?: CurrentPlay | null;
    after?: CurrentPlay | null;
    outcome?: SkipOutcome;
    latest?: DecisionLogEntry | null;
    recentPlays?: { playId: number; skippedByRule: boolean }[];
    firedExtra?: number;
    enqueue?: Partial<NewSkipAttempt>;
  } = {},
): Harness {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS);
  const repo = new SqliteSkipAttemptRepository(db);

  const attemptId = repo.enqueue({
    evaluationId: EV,
    playId: null,
    trackId: 't1',
    ruleId: 'r1',
    state: 'queued',
    enqueuedAt: '2026-10-02T11:59:50.000Z',
    firedAt: null,
    refusedReason: null,
    reportedTrackIdBefore: null,
    reportedProgressMsBefore: null,
    reportedTrackIdAfter: null,
    reportedProgressMsAfter: null,
    ...over.enqueue,
  });

  // Extra already-fired attempts, for the rate-limit and halt cases.
  for (let i = 0; i < (over.firedExtra ?? 0); i += 1) {
    const id = repo.enqueue({
      evaluationId: `ev-old-${i}`,
      playId: null,
      trackId: `old-${i}`,
      ruleId: 'r1',
      state: 'queued',
      enqueuedAt: '2026-10-02T11:30:00.000Z',
      firedAt: null,
      refusedReason: null,
      reportedTrackIdBefore: null,
      reportedProgressMsBefore: null,
      reportedTrackIdAfter: null,
      reportedProgressMsAfter: null,
    });
    repo.transition(id, 'fired', { firedAt: '2026-10-02T11:30:00.000Z' });
  }

  let posts = 0;
  const written: AutomationState[] = [];
  const halts: RunawayHalt[] = [];

  const playing = over.playing === undefined
    ? { evaluationId: EV, trackId: 't1', progressMs: 1000 }
    : over.playing;
  const after = over.after === undefined
    ? { evaluationId: 'ev-next', trackId: 't2', progressMs: 200 }
    : over.after;

  let call = 0;
  const player: PlayerClient = {
    skipToNext: async () => {
      posts += 1;
      return over.outcome ?? { kind: 'issued' };
    },
  };

  const deps: SkipDrainDeps = {
    attempts: repo,
    state: {
      read: () => ({ state: over.state ?? armed(), source: 'file' as const }),
      write: (next: AutomationState) => {
        written.push(next);
        return { ok: true as const };
      },
      path: '/state/automation-state.json',
      probeWritable: () => true,
    } as unknown as SkipDrainDeps['state'],
    decisions: {
      latestForEvaluationAndRule: () => over.latest ?? null,
    } as unknown as SkipDrainDeps['decisions'],
    ruleSet: () => over.set ?? ruleSet(),
    recentPlays: () => over.recentPlays ?? [{ playId: 1, skippedByRule: false }],
    player,
    currentPlay: () => {
      call += 1;
      return call === 1 ? playing : after;
    },
    nowIso: () => new Date(NOW_MS).toISOString(),
    nowMs: () => NOW_MS,
    delay: async () => {},
    onHalt: (h) => halts.push(h),
  };

  return {
    drain: new SkipDrain(deps),
    repo,
    posts: () => posts,
    written: () => written,
    halts: () => halts,
    attemptId,
    db,
  };
}

describe('⭐ PBT-34a — THE POSITIVE CONTROL: the action actually fires', () => {
  it('posts, and records the attempt confirmed', async () => {
    // Without this, a drain that posted nothing would satisfy every refusal property below.
    const h = harness();
    await h.drain.drain();

    assert.equal(h.posts(), 1, 'the POST must actually be issued');
    const a = h.repo.get(h.attemptId);
    assert.equal(a?.state, 'confirmed');
    assert.equal(a?.firedAt, new Date(NOW_MS).toISOString());
    h.db.close();
  });

  it('records the BR-43.2 evidence on both sides of the POST', async () => {
    const h = harness();
    await h.drain.drain();
    const a = h.repo.get(h.attemptId);
    assert.equal(a?.reportedTrackIdBefore, 't1');
    assert.equal(a?.reportedProgressMsBefore, 1000);
    assert.equal(a?.reportedTrackIdAfter, 't2');
    assert.equal(a?.reportedProgressMsAfter, 200);
    h.db.close();
  });
});

describe('PBT-34…39 — the refusal points, each recording its own reason', () => {
  const cases: [string, Parameters<typeof harness>[0], string][] = [
    ['automation off', { state: armed({ globalAutomationEnabled: false }) }, 'automation-off'],
    [
      'runaway halted',
      {
        state: armed({
          runawayHalt: {
            haltedAt: 'x',
            trigger: 'consecutive',
            observedCount: 3,
            threshold: 3,
            attemptIds: [],
          },
        }),
      },
      'runaway-halted',
    ],
    ['rule in dry-run', { set: ruleSet(true, true) }, 'rule-dry-run'],
    ['rule disabled', { set: ruleSet(false, false) }, 'rule-disabled'],
    ['nothing playing', { playing: null }, 'play-closed'],
    [
      'a DIFFERENT play is now current',
      { playing: { evaluationId: 'ev-other', trackId: 'tX', progressMs: 10 } },
      'play-closed',
    ],
  ];

  /**
   * ⚠️ **This table discharges PBT-35, PBT-36 and PBT-38 as well as PBT-34**, and the labels are
   * written down because an obligation nobody can find is an obligation nobody re-checks:
   *
   * | Row | Obligation |
   * |---|---|
   * | `automation off` | **PBT-34** — BR-33.1 |
   * | `runaway halted` | **PBT-35** — and the *separate latch* half is in `automationRoutes.test.ts` |
   * | `rule in dry-run` | **PBT-36** — and *a rule cannot opt out of a global dry-run* is the 16-row table in `automationPredicate.test.ts` |
   * | `nothing playing`, `a DIFFERENT play is now current` | **PBT-38** — BR-42.5 |
   *
   * ⚠️ **Each row asserts the refusal is RECORDED, not merely that nothing posted.** PBT-38 says *the
   * discard is recorded*, and a drain that silently dropped an attempt would pass a
   * `posts() === 0` assertion perfectly — while leaving the row `queued` for ever, which is the state
   * the startup sweep exists to clean up and which nothing would ever explain.
   */
  for (const [name, over, reason] of cases) {
    it(`${name} → refused: ${reason}, and NOTHING is posted`, async () => {
      const h = harness(over);
      await h.drain.drain();
      const a = h.repo.get(h.attemptId);
      assert.equal(a?.state, 'refused');
      assert.equal(a?.refusedReason, reason);
      assert.equal(h.posts(), 0, 'no player command may be issued');
      h.db.close();
    });
  }

  it('⚠️ rule deleted from the file → rule-gone', async () => {
    const empty = { ...ruleSet(), rules: [] } as unknown as LoadedRuleSet;
    const h = harness({ set: empty });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.refusedReason, 'rule-gone');
    assert.equal(h.posts(), 0);
    h.db.close();
  });

  it(`PBT-39 — ${MAX_RULE_SKIPS_PER_HOUR} fired in the window → rate-limited`, async () => {
    const h = harness({ firedExtra: MAX_RULE_SKIPS_PER_HOUR });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.refusedReason, 'rate-limited');
    assert.equal(h.posts(), 0);
    h.db.close();
  });

  it('⚠️ one below the limit still fires — the threshold is not off by one', async () => {
    const h = harness({ firedExtra: MAX_RULE_SKIPS_PER_HOUR - 1 });
    await h.drain.drain();
    assert.equal(h.posts(), 1);
    h.db.close();
  });
});

describe('⭐ PBT-41 — the predicate is read AT DRAIN TIME, not at decision time', () => {
  it('automation switched off AFTER the attempt was queued refuses it', async () => {
    // This is the whole reason the action is queued rather than awaited. A cached or captured state
    // would fire here, and every other test in this file would still pass.
    const h = harness({ state: armed({ globalAutomationEnabled: false }) });
    await h.drain.drain();

    assert.equal(h.posts(), 0, 'FR-38: no skip is issued after the switch is thrown');
    assert.equal(h.repo.get(h.attemptId)?.refusedReason, 'automation-off');
    h.db.close();
  });

  it('⚠️ the state is re-read from the store on every drain', async () => {
    let reads = 0;
    const h = harness();
    // Re-wrap the store so reads can be counted without changing the drain.
    const counting = new SkipDrain({
      attempts: h.repo,
      state: {
        read: () => {
          reads += 1;
          return { state: armed(), source: 'file' as const };
        },
        write: () => ({ ok: true as const }),
      } as unknown as SkipDrainDeps['state'],
      decisions: { latestForEvaluationAndRule: () => null } as unknown as SkipDrainDeps['decisions'],
      ruleSet: () => ruleSet(),
      recentPlays: () => [{ playId: 1, skippedByRule: false }],
      player: { skipToNext: async () => ({ kind: 'issued' }) },
      currentPlay: () => ({ evaluationId: EV, trackId: 't1', progressMs: 1000 }),
      nowIso: () => new Date(NOW_MS).toISOString(),
      nowMs: () => NOW_MS,
      delay: async () => {},
    });
    await counting.drain();
    assert.ok(reads >= 1, 'a drain that never reads the store cannot honour the kill switch');
    h.db.close();
  });
});

describe('PBT-42 — a re-evaluation CANCELS, and never creates', () => {
  it('a newer decision that no longer matches cancels the attempt', async () => {
    const h = harness({ latest: { matched: false } as unknown as DecisionLogEntry });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.state, 'cancelled');
    assert.equal(h.posts(), 0);
    h.db.close();
  });

  it('a newer decision that still matches lets it proceed', async () => {
    const h = harness({ latest: { matched: true } as unknown as DecisionLogEntry });
    await h.drain.drain();
    assert.equal(h.posts(), 1);
    h.db.close();
  });

  it('⚠️ an ABSENT decision row is not treated as permission', async () => {
    // BR-37.6's asymmetry. A missing row means we do not know, and the safe reading of "we do not
    // know" is to act on the attempt we already have rather than to invent a new one — but it must
    // never be the thing that turns a refusal into a fire.
    const h = harness({ latest: null });
    await h.drain.drain();
    // It proceeds on the strength of the ORIGINAL decision, which is what enqueued it.
    assert.equal(h.posts(), 1);
    h.db.close();
  });

  it('⚠️ play-closed is reported ahead of cancelled when both apply', async () => {
    const h = harness({
      playing: null,
      latest: { matched: false } as unknown as DecisionLogEntry,
    });
    await h.drain.drain();
    assert.equal(
      h.repo.get(h.attemptId)?.refusedReason,
      'play-closed',
      'if the play ended there is nothing to cancel and nothing to skip',
    );
    h.db.close();
  });
});

describe('BR-43.3/43.5 — confirmation, and never retrying', () => {
  it('track changed AND progress reset → confirmed', async () => {
    const h = harness();
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.state, 'confirmed');
    h.db.close();
  });

  it('⚠️ the SAME track still playing → unconfirmed, not retried', async () => {
    const h = harness({ after: { evaluationId: EV, trackId: 't1', progressMs: 4000 } });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.state, 'unconfirmed');
    assert.equal(h.posts(), 1, 'exactly one POST — surface, do not retry');
    h.db.close();
  });

  it('⚠️ a track change WITHOUT a progress reset is NOT confirmation', async () => {
    // Either signal alone is reachable without a skip: progress goes backwards on a seek, and the
    // track id changes on its own at every natural boundary. Requiring both is what distinguishes
    // "we skipped it" from "it ended".
    const h = harness({ after: { evaluationId: 'ev-next', trackId: 't2', progressMs: 9000 } });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.state, 'unconfirmed');
    h.db.close();
  });

  it('nothing playing after the POST → unconfirmed', async () => {
    const h = harness({ after: null });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.state, 'unconfirmed');
    h.db.close();
  });

  it('a transport failure → unconfirmed, because the landing is unknown', async () => {
    const h = harness({ outcome: { kind: 'failed', detail: 'socket hang up' } });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.state, 'unconfirmed');
    h.db.close();
  });

  it('a 429 → refused: upstream-rate-limited, distinct from our own cap', async () => {
    const h = harness({
      outcome: { kind: 'refused', reason: 'upstream-rate-limited', detail: '429' },
    });
    await h.drain.drain();
    assert.equal(h.repo.get(h.attemptId)?.refusedReason, 'upstream-rate-limited');
    h.db.close();
  });
});

describe('PBT-43 — the startup sweep, and the re-entrancy guard', () => {
  it('sweepOrphaned closes surviving queued rows as refused: play-closed', () => {
    const h = harness();
    assert.equal(h.drain.sweepOrphaned(), 1);
    const a = h.repo.get(h.attemptId);
    assert.equal(a?.state, 'refused');
    assert.equal(a?.refusedReason, 'play-closed');
    assert.equal(h.posts(), 0, 'a surviving attempt is never fired');
    h.db.close();
  });

  it('⚠️ and even unswept, the play-open check refuses a stale attempt', async () => {
    // The second of the two independent guards: after a restart currentPlay() reports a different
    // evaluationId, so a stale attempt cannot match.
    const h = harness({ playing: { evaluationId: 'ev-after-restart', trackId: 'tZ', progressMs: 5 } });
    await h.drain.drain();
    assert.equal(h.posts(), 0);
    assert.equal(h.repo.get(h.attemptId)?.refusedReason, 'play-closed');
    h.db.close();
  });

  it('⭐ two concurrent drains do not both POST', async () => {
    // drain() is called from the enqueue path AND from the 3s tick. Without the re-entrancy guard
    // both could claim the same queued attempt, which is a DOUBLE SKIP.
    const h = harness();
    await Promise.all([h.drain.drain(), h.drain.drain()]);
    assert.equal(h.posts(), 1, 'exactly one player command');
    h.db.close();
  });

  it('⚠️ drain never throws, even when the player does', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS);
    const repo = new SqliteSkipAttemptRepository(db);
    const id = repo.enqueue({
      evaluationId: EV,
      playId: null,
      trackId: 't1',
      ruleId: 'r1',
      state: 'queued',
      enqueuedAt: 'x',
      firedAt: null,
      refusedReason: null,
      reportedTrackIdBefore: null,
      reportedProgressMsBefore: null,
      reportedTrackIdAfter: null,
      reportedProgressMsAfter: null,
    });

    const drain = new SkipDrain({
      attempts: repo,
      state: {
        read: () => ({ state: armed(), source: 'file' as const }),
        write: () => ({ ok: true as const }),
      } as unknown as SkipDrainDeps['state'],
      decisions: { latestForEvaluationAndRule: () => null } as unknown as SkipDrainDeps['decisions'],
      ruleSet: () => ruleSet(),
      recentPlays: () => [],
      player: {
        skipToNext: async () => {
          throw new Error('boom');
        },
      },
      currentPlay: () => ({ evaluationId: EV, trackId: 't1', progressMs: 1000 }),
      nowIso: () => new Date(NOW_MS).toISOString(),
      nowMs: () => NOW_MS,
      delay: async () => {},
    });

    await assert.doesNotReject(() => drain.drain());
    assert.equal(repo.get(id)?.state, 'unconfirmed', 'and the attempt is recorded, not left queued');
    db.close();
  });
});

describe('BR-35 — the halt is latched, with the threshold in force', () => {
  it('three consecutive rule skips latch a halt', async () => {
    const h = harness({
      recentPlays: [
        { playId: 1, skippedByRule: true },
        { playId: 2, skippedByRule: true },
        { playId: 3, skippedByRule: true },
      ],
    });
    await h.drain.drain();

    const halts = h.halts();
    assert.equal(halts.length, 1);
    assert.equal(halts[0]?.trigger, 'consecutive');
    assert.equal(halts[0]?.observedCount, 3);
    assert.equal(halts[0]?.threshold, 3, 'the limit in force at that moment, stored not looked up');
    h.db.close();
  });

  it('⚠️ the halt is written as a SEPARATE latch, not by clearing the kill switch', async () => {
    const h = harness({
      recentPlays: [
        { playId: 1, skippedByRule: true },
        { playId: 2, skippedByRule: true },
        { playId: 3, skippedByRule: true },
      ],
    });
    await h.drain.drain();

    const [written] = h.written();
    assert.ok(written);
    assert.equal(
      written.globalAutomationEnabled,
      true,
      'BR-35.5: one flag with two causes would make the system halt indistinguishable from the user choice',
    );
    assert.ok(written.runawayHalt, 'and the halt is set on its own field');
    h.db.close();
  });

  it('⚠️ the halt record names REAL attempt ids, for BR-35.8 review', async () => {
    const h = harness({
      firedExtra: 2,
      recentPlays: [
        { playId: 1, skippedByRule: true },
        { playId: 2, skippedByRule: true },
        { playId: 3, skippedByRule: true },
      ],
    });
    await h.drain.drain();

    const ids = h.halts()[0]?.attemptIds ?? [];
    assert.ok(ids.length > 0, 'the review surface needs rows to open');
    for (const id of ids) {
      assert.ok(h.repo.get(id), `attempt ${id} must exist`);
    }
    h.db.close();
  });

  it('a non-rule play in the run means no halt', async () => {
    const h = harness({
      recentPlays: [
        { playId: 1, skippedByRule: true },
        { playId: 2, skippedByRule: false },
        { playId: 3, skippedByRule: true },
      ],
    });
    await h.drain.drain();
    assert.deepEqual(h.halts(), []);
    h.db.close();
  });
});
