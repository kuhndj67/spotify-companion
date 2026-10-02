/**
 * LC-29 — the persisted latches, and **PBT-45**'s storage half.
 *
 * ## ⚠️ Every test here is about a way "off" can be got wrong
 *
 * This file is the one control that must never be misread. A corrupt file that reads as *on* arms
 * automation from bytes this code never wrote; a corrupt file that reads as *plain off* tells the user
 * they turned it off themselves and silently discards a halt the system set for its own protection.
 * The honest third answer is `unreadable`, which is why `read` returns a source.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AutomationStateStore, AUTOMATION_STATE_SCHEMA } from '../src/playback/AutomationStateStore.js';
import type { AutomationState, RunawayHalt } from '../src/playback/types.js';

let dir: string;
let store: AutomationStateStore;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'automation-state-'));
  statePath = join(dir, 'automation-state.json');
  store = new AutomationStateStore(statePath);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const HALT: RunawayHalt = {
  haltedAt: '2026-10-02T10:00:00.000Z',
  trigger: 'consecutive',
  observedCount: 3,
  threshold: 3,
  attemptIds: [7, 8, 9],
};

const ARMED: AutomationState = {
  globalAutomationEnabled: true,
  runawayHalt: null,
  schemaVersion: AUTOMATION_STATE_SCHEMA,
};

describe('fails closed — every unreadable input means OFF (BR-34.5, FR-47)', () => {
  it('a missing file means off, reported as absent', () => {
    const result = store.read();
    assert.equal(result.state.globalAutomationEnabled, false);
    assert.equal(result.source, 'absent');
  });

  it('⚠️ invalid JSON means off, reported as unreadable — not as absent', () => {
    writeFileSync(statePath, '{ this is not json', 'utf8');
    const result = store.read();
    assert.equal(result.state.globalAutomationEnabled, false);
    assert.equal(result.source, 'unreadable');
    assert.ok(result.detail);
  });

  it('⚠️ a HALF-WRITTEN file means off', () => {
    // This is what the atomic rename exists to prevent us producing. It can still arrive by hand.
    writeFileSync(statePath, '{"globalAutomationEnabled": tr', 'utf8');
    assert.equal(store.read().state.globalAutomationEnabled, false);
    assert.equal(store.read().source, 'unreadable');
  });

  it('⚠️ a partially-correct file does NOT arm automation', () => {
    // The dangerous input: `enabled: true` with no schemaVersion. A permissive parse with defaults
    // would arm automation from a file this code never wrote.
    writeFileSync(statePath, JSON.stringify({ globalAutomationEnabled: true }), 'utf8');
    const result = store.read();
    assert.equal(result.state.globalAutomationEnabled, false, 'a corrupt file must never be a path to ON');
    assert.equal(result.source, 'unreadable');
  });

  it('⚠️ an UNKNOWN schema version is not read optimistically', () => {
    // A future format could mean the opposite of what this code assumes.
    writeFileSync(
      statePath,
      JSON.stringify({ globalAutomationEnabled: true, runawayHalt: null, schemaVersion: 99 }),
      'utf8',
    );
    assert.equal(store.read().state.globalAutomationEnabled, false);
    assert.equal(store.read().source, 'unreadable');
  });

  it('a non-object means off', () => {
    writeFileSync(statePath, '"a string"', 'utf8');
    assert.equal(store.read().state.globalAutomationEnabled, false);
  });

  it('⚠️ never throws, so the poll loop cannot be taken down by a bad file', () => {
    writeFileSync(statePath, '\u0000\u0001 binary garbage', 'utf8');
    assert.doesNotThrow(() => store.read());
  });
});

describe('⚠️ a malformed halt does not silently clear the latch', () => {
  it('a halt field present but wrong-shaped reads as unreadable, not as "no halt"', () => {
    // Clearing a halt is reserved for an explicit acknowledgement (BR-35.6). A parser that dropped a
    // malformed halt would clear it on the system's behalf.
    writeFileSync(
      statePath,
      JSON.stringify({
        globalAutomationEnabled: true,
        runawayHalt: { haltedAt: '2026-10-02T10:00:00.000Z', trigger: 'nonsense' },
        schemaVersion: AUTOMATION_STATE_SCHEMA,
      }),
      'utf8',
    );
    const result = store.read();
    assert.equal(result.source, 'unreadable');
    assert.equal(result.state.globalAutomationEnabled, false);
  });

  it('attemptIds must be numbers', () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        globalAutomationEnabled: false,
        runawayHalt: { ...HALT, attemptIds: ['seven'] },
        schemaVersion: AUTOMATION_STATE_SCHEMA,
      }),
      'utf8',
    );
    assert.equal(store.read().source, 'unreadable');
  });
});

describe('round-trips what it wrote', () => {
  it('armed state', () => {
    assert.deepEqual(store.write(ARMED), { ok: true });
    const result = store.read();
    assert.equal(result.source, 'file');
    assert.equal(result.state.globalAutomationEnabled, true);
    assert.equal(result.state.runawayHalt, null);
  });

  it('a halt, with the threshold that was in force', () => {
    store.write({ ...ARMED, runawayHalt: HALT });
    const read = store.read().state;
    assert.deepEqual(read.runawayHalt, HALT);
    // The stored threshold is what makes a later change to the constant unable to rewrite history.
    assert.equal(read.runawayHalt?.threshold, 3);
  });

  it('disarmed state', () => {
    store.write(ARMED);
    store.write({ ...ARMED, globalAutomationEnabled: false });
    assert.equal(store.read().state.globalAutomationEnabled, false);
    assert.equal(store.read().source, 'file', 'off-by-choice is distinguishable from unreadable');
  });
});

describe('⚠️ write-temp-then-rename (BR-34.2)', () => {
  it('leaves no temp file behind on success', () => {
    store.write(ARMED);
    const strays = readdirSync(dir).filter((f) => f.includes('.tmp'));
    assert.deepEqual(strays, []);
  });

  it('writes valid JSON a reader can parse', () => {
    store.write(ARMED);
    assert.doesNotThrow(() => JSON.parse(readFileSync(statePath, 'utf8')));
  });

  it('⚠️ returns an outcome rather than throwing, so the caller can apply P-31', () => {
    // A failure must not arrive as an exception the caller has to remember to catch: the asymmetric
    // rule — never block disarming, always block arming — cannot be applied from a throw.
    const unwritable = new AutomationStateStore(join(dir, 'nested', '\u0000bad', 'state.json'));
    const outcome = unwritable.write(ARMED);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.ok === false && outcome.reason);
  });

  it('creates the directory if it is missing', () => {
    const nested = new AutomationStateStore(join(dir, 'deep', 'state.json'));
    assert.equal(nested.write(ARMED).ok, true);
    assert.equal(nested.read().state.globalAutomationEnabled, true);
  });
});

describe('probeWritable — a PROBE, not an inference from compose.yaml', () => {
  it('is true for a writable directory and leaves nothing behind', () => {
    assert.equal(store.probeWritable(), true);
    const strays = readdirSync(dir).filter((f) => f.includes('.probe'));
    assert.deepEqual(strays, [], 'the probe file must be removed');
  });

  it('is false for a path that cannot be written', () => {
    const bad = new AutomationStateStore(join(dir, '\u0000nope', 'state.json'));
    assert.equal(bad.probeWritable(), false);
  });

  it('⚠️ never throws — an unwritable mount must not prevent startup (NFR-13)', () => {
    const bad = new AutomationStateStore(join(dir, '\u0000nope', 'state.json'));
    assert.doesNotThrow(() => bad.probeWritable());
    // Recording is the irreplaceable function; automation is not.
  });
});
