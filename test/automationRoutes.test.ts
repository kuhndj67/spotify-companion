/**
 * `GET/POST /api/automation` and `POST /api/automation/acknowledge-halt` — U5's control surface.
 *
 * ## ⚠️ Why this file is separate from `api.test.ts`
 *
 * These are **the first routes in this app that write anything**. Every other route reads, and the one
 * apparent exception — `POST /api/rules/reload` — re-*reads* a file. So the failure modes here are not
 * the ones `api.test.ts` was built around: a write that silently did not land, a response that reports
 * the request's intent rather than the disk's state, and a safety latch cleared as a side effect.
 *
 * ## ⭐ The three tests that justify the whole file
 *
 *   1. **A failed write must not report success**, and must report the value still on disk. An
 *      optimistic response would draw the switch as *on* when `/state` is read-only — the one case
 *      where the user most needs to know it did not take.
 *   2. **Arming cannot clear a halt.** If `POST /api/automation {enabled:true}` cleared the latch as a
 *      side effect, BR-35.6's "explicit acknowledgement" would be decorative.
 *   3. **Acknowledging when nothing is halted is refused**, because otherwise that route is a second
 *      way to arm automation that skips the check the first one makes.
 *
 * Run over real HTTP on an ephemeral port, like `api.test.ts`, and for the same reason: the worst
 * defect in this file's history was a wiring bug, not a logic one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApi, type ApiDeps, type AutomationControl } from '../src/api.js';
import type { ReadResult } from '../src/playback/AutomationStateStore.js';
import type { SkipAttemptRepository } from '../src/playback/SkipAttemptRepository.js';
import type { AutomationState, RunawayHalt, SkipAttempt, WriteOutcome } from '../src/playback/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const NOW = '2026-10-02T12:00:00.000Z';

const OFF: AutomationState = { globalAutomationEnabled: false, runawayHalt: null, schemaVersion: 1 };

const HALT: RunawayHalt = {
  haltedAt: '2026-10-02T11:00:00.000Z',
  trigger: 'consecutive',
  observedCount: 3,
  threshold: 3,
  attemptIds: [11, 12, 13],
};

/**
 * An in-memory `AutomationControl`.
 *
 * ⚠️ `writes` is recorded so a test can assert on **what was asked of the disk**, not only on what came
 * back. The defect worth catching is a response that looks right over a write that never happened.
 */
function control(
  initial: AutomationState = OFF,
  opts: { writeFails?: string; writable?: boolean; source?: ReadResult['source'] } = {},
) {
  let state = initial;
  const writes: AutomationState[] = [];
  const api: AutomationControl = {
    read: () => ({ state, source: opts.source ?? 'file' }),
    write: (next) => {
      writes.push(next);
      if (opts.writeFails !== undefined) {
        // ⚠️ The state does NOT change. A write that reports failure and mutates anyway is the shape
        // that makes a read-back meaningless.
        return { ok: false, reason: opts.writeFails } satisfies WriteOutcome;
      }
      state = next;
      return { ok: true };
    },
    probeWritable: () => opts.writable ?? true,
  };
  return { api, writes, current: () => state };
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

function attempts(rows: { queued?: SkipAttempt[]; latest?: SkipAttempt | null }): SkipAttemptRepository {
  return {
    enqueue: () => 0,
    transition: () => undefined,
    queued: () => rows.queued ?? [],
    attemptedForPlay: () => false,
    attachPlayId: () => undefined,
    firedSince: () => [],
    get: () => null,
    latest: () => rows.latest ?? null,
    reachedPlayerForEvaluation: () => false,
    unlinkedFiredCount: () => 0,
    firedForPlays: () => [],
  };
}

function serve(overrides: Partial<ApiDeps> = {}) {
  const deps: ApiDeps = {
    repository: null,
    historyStartupError: null,
    exportService: null,
    likedSet: null,
    labelStartupError: null,
    observerStats: null,
    nowPlaying: { current: { playing: false } as never },
    listToolNames: async () => [],
    diagnostics: async () => ({ ok: true, steps: [] }) as never,
    likedFor: () => undefined,
    ruleSet: null,
    decisionLog: null,
    backTest: null,
    reloadRules: null,
    automation: null,
    skipExecutorEnabled: false,
    skipAttempts: null,
    now: () => NOW,
    reportTimeZone: 'America/New_York',
    ...overrides,
  };
  const app = express();
  app.use(createApi(deps));
  return createServer(app);
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Run `fn` against a freshly-served app and always close the server. */
async function withServer(
  overrides: Partial<ApiDeps>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = serve(overrides);
  try {
    await fn(await listen(server));
  } finally {
    await close(server);
  }
}

describe('not deployed — every route degrades to 503 rather than throwing', () => {
  // The U4 routes established this: a missing collaborator must answer, not crash. A 500 from an
  // unhandled read of `null` would take the whole diagnostics page down with it.
  for (const [method, path] of [
    ['GET', '/api/automation'],
    ['POST', '/api/automation'],
    ['POST', '/api/automation/acknowledge-halt'],
  ] as const) {
    it(`${method} ${path} is 503 when automation is null`, async () => {
      await withServer({ automation: null }, async (base) => {
        const response =
          method === 'GET' ? await fetch(`${base}${path}`) : await post(base, path, { enabled: true });
        assert.equal(response.status, 503);
      });
    });
  }
});

describe('GET /api/automation', () => {
  it('reports the switch, the halt, the posture and where the state was read from', async () => {
    const c = control({ ...OFF, globalAutomationEnabled: true });
    await withServer({ automation: c.api, skipExecutorEnabled: true }, async (base) => {
      const body: Body = await (await fetch(`${base}/api/automation`)).json();
      assert.equal(body.enabled, true);
      assert.equal(body.halt, null);
      assert.equal(body.source, 'file');
      assert.equal(body.executorEnabled, true);
      assert.equal(body.writable, true);
    });
  });

  it('⚠️ reports `executorEnabled: false` separately from `enabled`', async () => {
    // Two different questions. With the executor unbuilt, a UI that only read `enabled` would draw an
    // off switch that does nothing when thrown — which is worse than saying the machinery is absent.
    const c = control({ ...OFF, globalAutomationEnabled: true });
    await withServer({ automation: c.api, skipExecutorEnabled: false }, async (base) => {
      const body: Body = await (await fetch(`${base}/api/automation`)).json();
      assert.equal(body.enabled, true, 'the switch is on');
      assert.equal(body.executorEnabled, false, 'and nothing can act on it');
    });
  });

  it('⚠️ `source: unreadable` is reported, not flattened into "off"', async () => {
    // `absent` and `unreadable` both read as off and are different facts: a fresh install behaving
    // correctly, versus a file this app could not parse. The second is where a thrown switch would
    // appear to work and not persist.
    const c = control(OFF, { source: 'unreadable' });
    await withServer({ automation: c.api }, async (base) => {
      const body: Body = await (await fetch(`${base}/api/automation`)).json();
      assert.equal(body.enabled, false);
      assert.equal(body.source, 'unreadable');
    });
  });

  it('⚠️ `oldestQueuedAgeMs` is null for an empty queue, never 0', async () => {
    // "Nothing waiting" and "something waiting for no time at all" are different facts.
    await withServer({ automation: control().api, skipAttempts: attempts({}) }, async (base) => {
      const body: Body = await (await fetch(`${base}/api/automation`)).json();
      assert.equal(body.queue.depth, 0);
      assert.equal(body.queue.oldestQueuedAgeMs, null);
    });
  });

  it('measures the oldest queued attempt against the injected clock', async () => {
    const rows = [
      attempt({ id: 1, state: 'queued', enqueuedAt: '2026-10-02T11:59:30.000Z' }),
      attempt({ id: 2, state: 'queued', enqueuedAt: '2026-10-02T11:59:55.000Z' }),
    ];
    await withServer(
      { automation: control().api, skipAttempts: attempts({ queued: rows }) },
      async (base) => {
        const body: Body = await (await fetch(`${base}/api/automation`)).json();
        assert.equal(body.queue.depth, 2);
        assert.equal(body.queue.oldestQueuedAgeMs, 30_000, 'the OLDEST, not the newest');
      },
    );
  });

  it('⚠️ reports the last attempt even when it was REFUSED', async () => {
    // A "last attempt" that showed only the ones that fired would answer *when did automation last
    // act* while appearing to answer *is automation working* — and a rule matching repeatedly and
    // being refused every time looks, from outside, identical to no matches at all.
    const last = attempt({ state: 'refused', refusedReason: 'already-attempted' });
    await withServer(
      { automation: control().api, skipAttempts: attempts({ latest: last }) },
      async (base) => {
        const body: Body = await (await fetch(`${base}/api/automation`)).json();
        assert.equal(body.lastAttempt.state, 'refused');
        assert.equal(body.lastAttempt.refusedReason, 'already-attempted');
      },
    );
  });

  it('does not name FC-U5-1 state — that indicator travels on the snapshot, not here', async () => {
    // The seven-state indicator belongs to the status bar and is derived by `automationIndicator`.
    // This route carries the PANEL's view instead, so the two surfaces cannot disagree about which
    // module owns which judgement.
    await withServer({ automation: control().api }, async (base) => {
      const body: Body = await (await fetch(`${base}/api/automation`)).json();
      assert.equal(body.level, undefined);
      assert.equal(body.indicator, undefined);
    });
  });

  it('⭐ carries the DERIVED button view, because app.js cannot import from src/', async () => {
    // `app.js` has no tests and no bundler. If it derived the button state itself, the documented worst
    // case -- a kill switch that works in the UI and does not persist -- would live in the one file
    // nothing can test.
    await withServer({ automation: control().api, skipExecutorEnabled: true }, async (base) => {
      const body: Body = await (await fetch(`${base}/api/automation`)).json();
      assert.match(body.view.label, /Turn automation on/);
      assert.equal(body.view.disabled, false);
      assert.equal(body.view.on, false);
      assert.ok(body.view.explanation.length > 0);
      assert.equal(body.haltPanel, null, 'no halt, no panel');
    });
  });

  it('⭐ carries the halt PANEL when halted, naming what tripped it', async () => {
    await withServer(
      { automation: control({ ...OFF, runawayHalt: HALT }).api, skipExecutorEnabled: true },
      async (base) => {
        const body: Body = await (await fetch(`${base}/api/automation`)).json();
        assert.match(body.haltPanel.detail, /3 rule-skips in a row/);
        assert.deepEqual(body.haltPanel.attemptIds, [11, 12, 13]);
        // BR-35.5 -- two statements, two buttons.
        assert.notEqual(body.haltPanel.acknowledgeLabel, body.haltPanel.reArmLabel);
      },
    );
  });
});

describe('POST /api/automation', () => {
  it('arms automation and persists it', async () => {
    const c = control();
    await withServer({ automation: c.api }, async (base) => {
      const response = await post(base, '/api/automation', { enabled: true });
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as Body).enabled, true);
      assert.equal(c.current().globalAutomationEnabled, true);
    });
  });

  it('disarms automation', async () => {
    const c = control({ ...OFF, globalAutomationEnabled: true });
    await withServer({ automation: c.api }, async (base) => {
      const body: Body = await (await post(base, '/api/automation', { enabled: false })).json();
      assert.equal(body.enabled, false);
      assert.equal(c.current().globalAutomationEnabled, false);
    });
  });

  it('⭐ ⚠️ a FAILED write is 503 and reports the value still on disk', async () => {
    // The response must reflect what persisted. An optimistic echo would draw the switch as ON over an
    // unwritable /state — the one case where the user most needs to know it did not take.
    const c = control(OFF, { writeFails: 'EROFS: read-only file system', writable: false });
    await withServer({ automation: c.api }, async (base) => {
      const response = await post(base, '/api/automation', { enabled: true });
      assert.equal(response.status, 503);
      const body: Body = await response.json();
      assert.equal(body.enabled, false, 'the PREVIOUS value, read back from disk');
      assert.equal(body.writable, false);
      // ⚠️ `writeError`, NOT `detail` — `detail` already means "why the state file could not be read",
      // and one key for both facts would report a parse problem as a save problem.
      assert.match(body.writeError, /read-only/);
      assert.match(body.view.warning, /read-only/, 'and the button says so too');
      assert.equal(c.current().globalAutomationEnabled, false);
    });
  });

  it('⭐ ⚠️ refuses to ARM while a halt stands, and does not clear it', async () => {
    // BR-35.6: a latch cleared as a side effect of flipping a switch is not an acknowledgement.
    const c = control({ ...OFF, runawayHalt: HALT });
    await withServer({ automation: c.api }, async (base) => {
      const response = await post(base, '/api/automation', { enabled: true });
      assert.equal(response.status, 409);
      const body: Body = await response.json();
      assert.deepEqual(body.halt, HALT, 'the halt is reported back, not silently dropped');
      assert.equal(c.writes.length, 0, 'nothing was written at all');
      assert.notEqual(c.current().runawayHalt, null);
      assert.equal(c.current().globalAutomationEnabled, false);
    });
  });

  it('⚠️ DISARMING while halted still works', async () => {
    // Turning automation off must succeed in every state the app can reach. The halt is left standing:
    // only an acknowledgement clears it, and disarming is not one.
    const c = control({ globalAutomationEnabled: true, runawayHalt: HALT, schemaVersion: 1 });
    await withServer({ automation: c.api }, async (base) => {
      const response = await post(base, '/api/automation', { enabled: false });
      assert.equal(response.status, 200);
      assert.equal(c.current().globalAutomationEnabled, false);
      assert.deepEqual(c.current().runawayHalt, HALT, 'still halted — disarming is not acknowledging');
    });
  });

  it('⚠️ rejects anything that is not a boolean, and writes nothing', async () => {
    // `'false'`, `0`, `null` and a missing field are all falsy or coercible, and this is the surface
    // that decides whether the app touches playback.
    const c = control();
    await withServer({ automation: c.api }, async (base) => {
      for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }]) {
        const response = await post(base, '/api/automation', body);
        assert.equal(response.status, 400, JSON.stringify(body));
      }
      assert.equal(c.writes.length, 0);
    });
  });

  it('⚠️ preserves schemaVersion rather than rewriting the file from scratch', async () => {
    // A write that dropped fields it did not know about would turn a forward-compatible file into one
    // this version happens to understand.
    const c = control({ ...OFF, schemaVersion: 1 });
    await withServer({ automation: c.api }, async (base) => {
      await post(base, '/api/automation', { enabled: true });
      assert.equal(c.writes[0]?.schemaVersion, 1);
      assert.equal(c.writes[0]?.runawayHalt, null);
    });
  });
});

/**
 * **PBT-35, second half — BR-33.4/BR-35.5: the halt is a SEPARATE LATCH from the kill switch.**
 *
 * ⚠️ Two fields, never collapsed into one. *The user turned automation off* and *the system halted
 * itself* are different facts, and clearing them are different acts — so neither operation may clear the
 * other as a side effect. The two tests below are the two directions of that.
 */
describe('⭐ PBT-35 — the halt and the switch are two latches, not one', () => {
  it('disarming does NOT clear the halt', async () => {
    const c = control({ globalAutomationEnabled: true, runawayHalt: HALT, schemaVersion: 1 });
    await withServer({ automation: c.api }, async (base) => {
      await post(base, '/api/automation', { enabled: false });
      assert.deepEqual(c.current().runawayHalt, HALT, 'a halt is not cleared by a switch');
    });
  });

  it('⭐ acknowledging NEVER arms automation — even when it was armed before', async () => {
    // Revised 2026-10-04: there is no `reArm` any more, so this is unconditional rather than a choice.
    // ⚠️ The `enabled: true` case is the one that matters: the halt leaves the switch ON (BR-33.4), so
    // clearing the latch WITHOUT disarming would resume skipping the instant the halt went away -- the
    // compound action BR-35.5 forbids, just implicit instead of explicit.
    for (const wasEnabled of [true, false]) {
      const c = control({ globalAutomationEnabled: wasEnabled, runawayHalt: HALT, schemaVersion: 1 });
      await withServer({ automation: c.api }, async (base) => {
        const r = await post(base, '/api/automation/acknowledge-halt', {});
        assert.equal(r.status, 200, `wasEnabled=${wasEnabled}`);
        assert.equal(c.current().runawayHalt, null, 'latch cleared');
        assert.equal(c.current().globalAutomationEnabled, false, 'and ALWAYS disarmed');
      });
    }
  });
});

describe('POST /api/automation/acknowledge-halt — one action, no variations', () => {
  it('⭐ clears the halt and leaves automation OFF, with no parameters', async () => {
    const c = control({ ...OFF, runawayHalt: HALT });
    await withServer({ automation: c.api }, async (base) => {
      const response = await post(base, '/api/automation/acknowledge-halt', {});
      assert.equal(response.status, 200);
      const body: Body = await response.json();
      assert.equal(body.halt, null);
      assert.equal(body.acknowledged, true);
      assert.equal(body.enabled, false);
      assert.equal(c.current().runawayHalt, null);
      assert.equal(c.current().globalAutomationEnabled, false);
    });
  });

  it('⭐ ⚠️ `reArm` is REFUSED, not ignored', async () => {
    // A stale client sending `reArm: true` and receiving a 200 would believe it had resumed automation.
    // Silently doing less than asked is the worst of the three options -- the failure is invisible.
    const c = control({ ...OFF, runawayHalt: HALT });
    await withServer({ automation: c.api }, async (base) => {
      for (const body of [{ reArm: true }, { reArm: false }]) {
        const r = await post(base, '/api/automation/acknowledge-halt', body);
        assert.equal(r.status, 400, JSON.stringify(body));
        const j: Body = await r.json();
        assert.match(j.detail, /always leaves automation OFF/);
        assert.match(j.detail, /POST \/api\/automation/, 'and it names where resuming happens');
      }
      assert.equal(c.writes.length, 0, 'and nothing was written');
      assert.deepEqual(c.current().runawayHalt, HALT, 'the latch still stands');
    });
  });

  it('⭐ ⚠️ is 409 when nothing is halted, so it cannot touch the switch', async () => {
    // Without this it would be a second route that writes `globalAutomationEnabled` -- now always to
    // `false`, which would be a way to disarm by calling the acknowledgement endpoint.
    const c = control(OFF);
    await withServer({ automation: c.api }, async (base) => {
      const response = await post(base, '/api/automation/acknowledge-halt', {});
      assert.equal(response.status, 409);
      const body: Body = await response.json();
      assert.equal(body.enabled, false, 'the body carries the real state so the UI re-renders');
      assert.equal(c.writes.length, 0);
    });
  });

  it('⚠️ 409 even when automation is ON, rather than disarming it', async () => {
    const c = control({ ...OFF, globalAutomationEnabled: true });
    await withServer({ automation: c.api }, async (base) => {
      assert.equal((await post(base, '/api/automation/acknowledge-halt', {})).status, 409);
      assert.equal(c.current().globalAutomationEnabled, true, 'untouched');
    });
  });

  it('⚠️ a failed write reports 503 and does not claim the halt was acknowledged', async () => {
    const c = control({ ...OFF, runawayHalt: HALT }, { writeFails: 'EACCES' });
    await withServer({ automation: c.api }, async (base) => {
      const response = await post(base, '/api/automation/acknowledge-halt', {});
      assert.equal(response.status, 503);
      const body: Body = await response.json();
      assert.equal(body.acknowledged, false);
      assert.deepEqual(body.halt, HALT, 'still halted, because the write did not land');
    });
  });

  it('⭐ the halted response hands over to a switch that reads `Turn automation on`', async () => {
    // The whole linear path in one assertion: acknowledge -> halt gone, disarmed, switch back and
    // offering the one remaining action.
    const c = control({ globalAutomationEnabled: true, runawayHalt: HALT, schemaVersion: 1 });
    await withServer({ automation: c.api, skipExecutorEnabled: true }, async (base) => {
      const body: Body = await (await post(base, '/api/automation/acknowledge-halt', {})).json();
      assert.equal(body.haltPanel, null, 'the panel is gone');
      assert.equal(body.view.rendered, true, 'and the switch is back');
      assert.match(body.view.label, /Turn automation on/);
      assert.equal(body.view.nextEnabled, true);
    });
  });
});
