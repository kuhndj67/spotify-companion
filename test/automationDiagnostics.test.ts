/**
 * `automationDiagnosticSteps` — the U5 entries on `/api/diagnostics`.
 *
 * ## ⚠️ Why this file exists at all
 *
 * `runDiagnostics` reaches for the MCP client, the Web API and the credentials file, so `diagnostics.ts`
 * is one of three modules this project knowingly leaves untested — `ALLOWED_ORPHANS` records that, with
 * a reason. Leaving the automation entries inside it would have put **the halt banner, the
 * unwritable-`/state` fault and the stale-queue threshold** in that untested region: live, reachable
 * code covered by nothing, which is the `recordSuccessorLag` shape.
 *
 * ## ⭐ The distinctions worth asserting
 *
 *   - **`off` is not a fault.** `globalAutomationEnabled: false` is FR-47's default and the correct
 *     state of a fresh install. A red cross for it trains the reader to ignore red crosses on the one
 *     page where the unit that can cause harm reports itself.
 *   - **A standing halt IS a fault**, because it clears only on an explicit acknowledgement — so a
 *     green tick would hide the one condition the user must act on.
 *   - **An unwritable `/state` is a fault only when the executor exists**, otherwise `skip`.
 *   - **Queue DEPTH is not the signal; the oldest entry's AGE is.** A depth of 1 is normal for the
 *     second between a decision and the `POST`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { automationDiagnosticSteps, type AutomationDiagnosticsInput } from '../src/diagnostics.js';
import type { DiagnosticStep } from '../src/diagnostics.js';
import { UpstreamMetrics } from '../src/playback/upstreamMetrics.js';
import type { RunawayHalt, SkipAttempt } from '../src/playback/types.js';

const HALT: RunawayHalt = {
  haltedAt: '2026-10-02T11:00:00.000Z',
  trigger: 'hourly-rate',
  observedCount: 10,
  threshold: 10,
  attemptIds: [41, 42],
};

function input(overrides: Partial<AutomationDiagnosticsInput> = {}): AutomationDiagnosticsInput {
  return {
    state: { enabled: false, halt: null, source: 'file' },
    executorEnabled: false,
    statePath: '/state/automation-state.json',
    stateWritable: true,
    queue: { depth: 0, oldestQueuedAgeMs: null },
    unlinkedFiredAttempts: 0,
    lastAttempt: null,
    metrics: new UpstreamMetrics().snapshot(0),
    ...overrides,
  };
}

function byName(steps: DiagnosticStep[], name: string): DiagnosticStep {
  const step = steps.find((s) => s.name === name);
  assert.ok(step !== undefined, `no step named '${name}'`);
  return step;
}

function attempt(overrides: Partial<SkipAttempt> = {}): SkipAttempt {
  return {
    id: 7,
    evaluationId: 'eval-7',
    playId: null,
    trackId: 'track-7',
    ruleId: 'no-majors',
    state: 'refused',
    enqueuedAt: '2026-10-02T11:59:30.000Z',
    firedAt: null,
    refusedReason: 'automation-off',
    reportedTrackIdBefore: null,
    reportedProgressMsBefore: null,
    reportedTrackIdAfter: null,
    reportedProgressMsAfter: null,
    ...overrides,
  };
}

describe('⭐ off is not a fault', () => {
  it('a fresh, disarmed install reports no failures at all', async () => {
    const steps = await automationDiagnosticSteps(input({ state: { enabled: false, halt: null, source: 'absent' } }));
    assert.equal(
      steps.filter((s) => s.status === 'fail').length,
      0,
      'FR-47 default state must not render as broken',
    );
  });

  it('says the machinery is not constructed, rather than drawing a switch that does nothing', async () => {
    const steps = await automationDiagnosticSteps(input({ executorEnabled: false }));
    assert.match(byName(steps, 'Automation posture').detail, /NOT constructed/);
    assert.match(byName(steps, 'Automation posture').detail, /no skip can be issued/);
  });

  it('⚠️ reports the state SOURCE beside the value', async () => {
    // `absent` and `unreadable` both read as off and are different facts. The second is where a switch
    // thrown in the UI appears to work and does not persist.
    const steps = await automationDiagnosticSteps(
      input({ state: { enabled: false, halt: null, source: 'unreadable', detail: 'bad JSON at line 3' } }),
    );
    const detail = byName(steps, 'Automation posture').detail;
    assert.match(detail, /unreadable/);
    assert.match(detail, /bad JSON at line 3/, 'the reason travels with the verdict');
  });

  it('reports the switch as on when it is on', async () => {
    const steps = await automationDiagnosticSteps(
      input({ state: { enabled: true, halt: null, source: 'file' }, executorEnabled: true }),
    );
    const detail = byName(steps, 'Automation posture').detail;
    assert.match(detail, /kill switch ON/);
    assert.match(detail, /SkipExecutor constructed/);
    assert.equal(byName(steps, 'Automation posture').status, 'ok');
  });
});

describe('⭐ a standing halt IS a fault', () => {
  it('fails, and names the trigger, the counts and the real attempt ids', async () => {
    const steps = await automationDiagnosticSteps(input({ state: { enabled: false, halt: HALT, source: 'file' } }));
    const step = byName(steps, 'Runaway halt');
    assert.equal(step.status, 'fail', 'a green tick would hide the one thing the user must act on');
    assert.match(step.detail, /hourly-rate/);
    assert.match(step.detail, /10 against a threshold of 10/);
    // BR-35.8 — the acknowledgement surface must be able to show WHICH skips counted, so these have
    // to be real row ids. An earlier draft synthesised them from array indices.
    assert.match(step.detail, /41, 42/);
  });

  it('is ok when nothing is halted', async () => {
    const steps = await automationDiagnosticSteps(input());
    assert.equal(byName(steps, 'Runaway halt').status, 'ok');
    assert.match(byName(steps, 'Runaway halt').detail, /Not halted/);
  });
});

describe('the state file is PROBED, and the verdict depends on whether anything can write it', () => {
  it('ok when writable', async () => {
    const steps = await automationDiagnosticSteps(input({ stateWritable: true }));
    assert.equal(byName(steps, 'Automation state file').status, 'ok');
  });

  it('⚠️ FAILS when the executor exists and the file is not writable', async () => {
    const steps = await automationDiagnosticSteps(input({ stateWritable: false, executorEnabled: true }));
    const step = byName(steps, 'Automation state file');
    assert.equal(step.status, 'fail');
    assert.match(step.detail, /not writable/i);
    // The remedy has to name the container, because the host path is writable and checking there is
    // how this gets misdiagnosed.
    assert.match(step.detail, /THROUGH THE CONTAINER/);
    assert.match(step.detail, /Recording is unaffected/, 'NFR-13: this must not read as data loss');
  });

  it('⚠️ SKIPS when the executor was never constructed', async () => {
    // An unwritable mount is harmless if nothing can write it, and a red cross for a mount not yet in
    // use is noise that devalues the real one above.
    const steps = await automationDiagnosticSteps(input({ stateWritable: false, executorEnabled: false }));
    assert.equal(byName(steps, 'Automation state file').status, 'skip');
  });
});

describe('⭐ an UNLINKED fired attempt is a fault, because it weakens the halt', () => {
  /**
   * ⚠️ The consecutive counter joins `skip_attempt` on `play_id`. An attempt that reached the player and
   * was never linked is invisible to it — and a halt that under-counts is a halt that does not fire.
   *
   * The previous design tried to make the key immune to a missing link and broke on an 11–14 ms race
   * instead. **A visible failure beats a clever key**, which is what this step is.
   */
  it('zero is ok, and says so positively', async () => {
    const steps = await automationDiagnosticSteps(input({ unlinkedFiredAttempts: 0 }));
    const step = byName(steps, 'Skip attempts linked to plays');
    assert.equal(step.status, 'ok');
    assert.match(step.detail, /All issued skips are linked/);
  });

  it('⚠️ non-zero FAILS, and says the halt is under-counting by that many', async () => {
    const steps = await automationDiagnosticSteps(input({ unlinkedFiredAttempts: 2 }));
    const step = byName(steps, 'Skip attempts linked to plays');
    assert.equal(step.status, 'fail');
    assert.match(step.detail, /2 issued skip/);
    assert.match(step.detail, /UNDER-COUNTING/);
    assert.match(step.detail, /could not link/, 'and points at the log line that explains why');
  });
});

describe('⭐ the queue: AGE is the signal, not depth', () => {
  it('an empty queue is ok', async () => {
    const steps = await automationDiagnosticSteps(input());
    assert.equal(byName(steps, 'Skip attempt queue').status, 'ok');
    assert.match(byName(steps, 'Skip attempt queue').detail, /Empty/);
  });

  it('⚠️ a fresh attempt in the queue is ok — that is the normal mid-decision state', async () => {
    const steps = await automationDiagnosticSteps(input({ queue: { depth: 1, oldestQueuedAgeMs: 400 } }));
    assert.equal(byName(steps, 'Skip attempt queue').status, 'ok');
  });

  it('⚠️ fails once the oldest entry is past the threshold, and says what that implies', async () => {
    // The drain runs from the 3 s tick as well as on enqueue, so a minute in the queue means the drain
    // is not running — the attempt will neither fire nor close, and a depth count alone cannot show it.
    const steps = await automationDiagnosticSteps(input({ queue: { depth: 2, oldestQueuedAgeMs: 120_000 } }));
    const step = byName(steps, 'Skip attempt queue');
    assert.equal(step.status, 'fail');
    assert.match(step.detail, /drain appears not to/);
    assert.match(step.detail, /40 ticks/, 'states the magnitude, not just that a limit was crossed');
  });

  it('⚠️ a depth with an unknown age does not fail', async () => {
    // `null` is unknown and must never be treated as a large number. An unparseable timestamp is a
    // reason to say so, not a reason to raise a fault that cannot be acted on.
    const steps = await automationDiagnosticSteps(input({ queue: { depth: 3, oldestQueuedAgeMs: null } }));
    const step = byName(steps, 'Skip attempt queue');
    assert.equal(step.status, 'ok');
    assert.match(step.detail, /age unknown/);
  });
});

describe('⭐ the last attempt is reported in ANY state, and is never a fault', () => {
  it('none recorded reads as none recorded', async () => {
    const steps = await automationDiagnosticSteps(input());
    assert.match(byName(steps, 'Last skip attempt').detail, /None recorded/);
  });

  it('⚠️ a REFUSED attempt is shown with its reason, and does not fail', async () => {
    // A view that showed only the ones that fired would answer *when did automation last act* while
    // appearing to answer *is automation working* — and a rule matching repeatedly and being refused
    // every time looks, from outside, identical to no matches at all.
    const steps = await automationDiagnosticSteps(
      input({ lastAttempt: attempt({ state: 'refused', refusedReason: 'already-attempted' }) }),
    );
    const step = byName(steps, 'Last skip attempt');
    assert.equal(step.status, 'ok', 'most refusals ARE the system working');
    assert.match(step.detail, /refused/);
    assert.match(step.detail, /already-attempted/);
  });

  for (const reason of ['automation-off', 'no-active-device', 'play-closed', 'rule-dry-run'] as const) {
    it(`does not fail on '${reason}'`, async () => {
      const steps = await automationDiagnosticSteps(input({ lastAttempt: attempt({ refusedReason: reason }) }));
      assert.equal(byName(steps, 'Last skip attempt').status, 'ok');
    });
  }

  it('⚠️ says the play row is not yet linked rather than printing a bare null', async () => {
    // `play_id` is nullable because a skip happens mid-play and the row is written at close. An empty
    // field here would read as a broken link rather than as a timing fact.
    const steps = await automationDiagnosticSteps(input({ lastAttempt: attempt({ playId: null }) }));
    assert.match(byName(steps, 'Last skip attempt').detail, /play row not yet linked/);
  });

  it('names the play once it is linked', async () => {
    const steps = await automationDiagnosticSteps(input({ lastAttempt: attempt({ playId: 913 }) }));
    assert.match(byName(steps, 'Last skip attempt').detail, /play 913/);
  });

  it('a confirmed attempt reports as confirmed with no refusal reason', async () => {
    const steps = await automationDiagnosticSteps(
      input({ lastAttempt: attempt({ state: 'confirmed', refusedReason: null, firedAt: '2026-10-02T11:59:31.000Z' }) }),
    );
    const detail = byName(steps, 'Last skip attempt').detail;
    assert.match(detail, /confirmed/);
    assert.doesNotMatch(detail, /\(null\)/);
  });
});

describe('every step carries a name, a status and a duration', () => {
  it('and there are five of them', async () => {
    const steps = await automationDiagnosticSteps(input());
    // SIX since 2026-10-04: the unlinked-attempt fault was added when a missing `play_id` turned out
    // to be the thing that would quietly weaken the halt.
    assert.equal(steps.length, 6);
    for (const step of steps) {
      assert.ok(step.name.length > 0);
      assert.ok(['ok', 'fail', 'skip'].includes(step.status));
      assert.ok(Number.isFinite(step.durationMs));
    }
  });
});
