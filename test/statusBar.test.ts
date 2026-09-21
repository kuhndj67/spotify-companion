/**
 * Status-bar state derivation (FC-1).
 *
 * ⚠️ This file exists because **a false green is the failure mode**, and it is this project's
 * central defect wearing a UI hat. Most of what follows asserts that something is NOT green.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  connectionIndicator,
  recordingIndicator,
  rulesIndicator,
  spotifyIndicator,
  statusBar,
  type RecordingState,
  type RulesState,
} from '../src/ui/statusBar.js';

function recording(overrides: Partial<RecordingState> = {}): RecordingState {
  return { repositoryOpen: true, degraded: false, gaps: 0, startupError: null, ...overrides };
}

function rules(overrides: Partial<RulesState> = {}): RulesState {
  return {
    version: 6,
    state: 'applied',
    activeRules: 4,
    disabledRules: 1,
    rejectionErrors: [],
    ...overrides,
  };
}

describe('Recording — the indicator a false green would matter most on', () => {
  it('is unknown, never ok, before the first status', () => {
    const i = recordingIndicator(recording({ repositoryOpen: null }));

    assert.equal(i.level, 'unknown');
    assert.notEqual(i.level, 'ok', 'green before anything reported is the defect this prevents');
  });

  it('is ok when writing cleanly', () => {
    assert.equal(recordingIndicator(recording()).level, 'ok');
  });

  it('fails when the repository never opened, and says plays are not being saved', () => {
    const i = recordingIndicator(recording({ repositoryOpen: false, startupError: 'disk is read-only' }));

    assert.equal(i.level, 'fail');
    assert.match(i.detail, /NOT being saved/);
    assert.match(i.detail, /read-only/, 'the reason must reach the person');
  });

  /**
   * ⚠️ The correction the design review found. A null repository happens once, at startup; the
   * likelier fault is a runtime write failure, which the observer already tracks. An indicator
   * reading only `repository !== null` shows green while plays are being dropped.
   */
  it('FAILS while writes are failing, even though the repository is open', () => {
    const i = recordingIndicator(recording({ repositoryOpen: true, degraded: true, gaps: 3 }));

    assert.equal(i.level, 'fail');
    assert.notEqual(i.level, 'ok', 'an open handle is not a working write path');
    assert.match(i.detail, /3 play/);
  });

  /**
   * ⚠️ `gaps` is sticky. Recovery shows as `degraded` going false, but the plays that were
   * lost are gone — a counter that reset would erase the only record they existed.
   */
  it('warns after a recovery, because the lost plays do not come back', () => {
    const i = recordingIndicator(recording({ degraded: false, gaps: 2 }));

    assert.equal(i.level, 'warn');
    assert.match(i.detail, /cannot be recovered/);
  });
});

describe('Rules', () => {
  it('is unknown when the engine is not running', () => {
    assert.equal(rulesIndicator(rules({ version: null, state: null })).level, 'unknown');
  });

  it('is unknown at version 0 — no load has ever been accepted', () => {
    const i = rulesIndicator(rules({ version: 0 }));

    assert.equal(i.level, 'unknown');
    assert.notEqual(i.level, 'ok', 'v0 is not "a rule set with nothing in it"');
  });

  it('names the version and the active count when applied', () => {
    const i = rulesIndicator(rules());

    assert.equal(i.level, 'ok');
    assert.equal(i.label, 'Rules v6');
    assert.match(i.detail, /4 active, 1 disabled/);
  });

  /**
   * ⚠️ FQ5, and the reason the whole indicator exists. A red light that only says "something
   * failed" leaves the ambiguity it was meant to remove: a silent last-known-good is
   * indistinguishable from a successful reload, and the user believes an edit is live.
   */
  it('names the version STILL IN FORCE when a reload is rejected', () => {
    const i = rulesIndicator(
      rules({ state: 'rejected', rejectionErrors: ["unknown field 'album.kind'"] }),
    );

    assert.equal(i.level, 'fail');
    assert.equal(i.label, 'Rules v6', 'the running version must be on the dot itself');
    assert.match(i.detail, /Still running v6/);
    assert.match(i.detail, /album\.kind/);
  });

  it('says no rules are active when the very first load was rejected', () => {
    const i = rulesIndicator(rules({ version: 0, state: 'rejected', rejectionErrors: ['bad JSON'] }));

    assert.equal(i.level, 'fail');
    assert.match(i.detail, /No rules are active/, 'there is no earlier version to fall back to');
  });

  it('warns rather than fails while reloading', () => {
    assert.equal(rulesIndicator(rules({ state: 'reloading' })).level, 'warn');
  });
});

describe('Connection and Spotify', () => {
  it('connection is unknown before the first attempt', () => {
    assert.equal(connectionIndicator(null).level, 'unknown');
  });

  it('distinguishes reconnecting from closed', () => {
    assert.equal(connectionIndicator('reconnecting').level, 'warn');
    assert.equal(connectionIndicator('closed').level, 'fail');
  });

  it('spotify is unknown before the first snapshot, not ok', () => {
    const i = spotifyIndicator({ snapshotError: null, hasSnapshot: false });

    assert.equal(i.level, 'unknown');
  });

  it('spotify fails when the snapshot carries an error, and quotes it', () => {
    const i = spotifyIndicator({ snapshotError: 'token refresh failed', hasSnapshot: true });

    assert.equal(i.level, 'fail');
    assert.match(i.detail, /token refresh failed/);
  });
});

describe('the bar as a whole', () => {
  it('renders four indicators', () => {
    const bar = statusBar({
      recording: recording(),
      rules: rules(),
      connection: 'open',
      spotify: { snapshotError: null, hasSnapshot: true },
    });

    assert.equal(bar.indicators.length, 4);
    assert.equal(bar.message, null, 'no message when everything is fine');
  });

  /**
   * ⚠️ Recording comes first in the list, so when several things fail at once the message is
   * about the only subsystem whose failure loses something that cannot be recreated.
   */
  it('surfaces the recording failure when several things fail at once', () => {
    const bar = statusBar({
      recording: recording({ repositoryOpen: false }),
      rules: rules({ state: 'rejected', rejectionErrors: ['bad'] }),
      connection: 'closed',
      spotify: { snapshotError: 'down', hasSnapshot: true },
    });

    assert.match(bar.message!, /NOT being saved/);
  });

  it('shows one message, not a list', () => {
    const bar = statusBar({
      recording: recording(),
      rules: rules(),
      connection: 'closed',
      spotify: { snapshotError: 'down', hasSnapshot: true },
    });

    assert.equal(typeof bar.message, 'string');
    assert.ok(!bar.message!.includes('\n'), 'a bar showing three problems reads as broken');
  });

  /** ⚠️ Colour is never the only channel — ~8% of men have red-green colour deficiency. */
  it('gives every level a distinct glyph as well as a colour', () => {
    const bar = statusBar({
      recording: recording({ repositoryOpen: null }),
      rules: rules({ state: 'reloading' }),
      connection: 'closed',
      spotify: { snapshotError: null, hasSnapshot: true },
    });

    const glyphs = bar.indicators.map((i) => i.glyph);
    assert.equal(new Set(glyphs).size, 4, 'four states, four glyphs');
  });

  it('gives every indicator a text label beside its dot', () => {
    const bar = statusBar({
      recording: recording(),
      rules: rules(),
      connection: 'open',
      spotify: { snapshotError: null, hasSnapshot: true },
    });

    for (const i of bar.indicators) {
      assert.ok(i.label.length > 0);
      assert.ok(i.detail.length > 0, 'and a detail worth opening');
    }
  });
});
