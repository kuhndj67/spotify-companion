/**
 * Status-bar state derivation (FC-1).
 *
 * ⚠️ This file exists because **a false green is the failure mode**, and it is this project's
 * central defect wearing a UI hat. Most of what follows asserts that something is NOT green.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  automationIndicator,
  connectionIndicator,
  recordingIndicator,
  rulesIndicator,
  spotifyIndicator,
  statusBar,
  type AutomationIndicatorState,
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
      automation: null,
    });

    // ⚠️ FOUR, not five: `automation: null` omits the U5 dot entirely rather than drawing it as
    // `unknown`. A deployment without U5 has no automation to be unknown about.
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
      automation: null,
    });

    assert.match(bar.message!, /NOT being saved/);
  });

  it('shows one message, not a list', () => {
    const bar = statusBar({
      recording: recording(),
      rules: rules(),
      connection: 'closed',
      spotify: { snapshotError: 'down', hasSnapshot: true },
      automation: null,
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
      automation: null,
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
      automation: null,
    });

    for (const i of bar.indicators) {
      assert.ok(i.label.length > 0);
      assert.ok(i.detail.length > 0, 'and a detail worth opening');
    }
  });
});

// ── FC-U5-1: the evaluation-state indicator (U5) ────────────────────────────────────────────────

function automation(
  overrides: Partial<AutomationIndicatorState> = {},
): AutomationIndicatorState {
  return {
    automationEnabled: true,
    executorConstructed: true,
    halt: null,
    liveRules: 2,
    evaluation: null,
    lastAttemptUnconfirmed: false,
    ...overrides,
  };
}

describe('FC-U5-1 — seven states, each with its own glyph', () => {
  it('⭐ every state has a DISTINCT glyph, so colour is never the only channel', () => {
    // The user's proposed palette had both Green-passed and Yellowgreen-passed-with-missing-info --
    // the hardest pair to tell apart for ~8% of men, and the pair where being wrong means believing a
    // decision rested on facts that never arrived.
    const states: AutomationIndicatorState[] = [
      automation({ evaluation: null }), // idle
      automation({ automationEnabled: false }), // disabled
      automation({ evaluation: { decided: false, decidedOnPartialData: false, holding: true } }),
      automation({ evaluation: { decided: true, decidedOnPartialData: true, holding: false } }),
      automation({ evaluation: { decided: true, decidedOnPartialData: false, holding: false } }),
      automation({ lastAttemptUnconfirmed: true }), // failed
      automation({ halt: { trigger: 'consecutive', observedCount: 3, threshold: 3 } }),
    ];

    const seen = states.map((s) => automationIndicator(s));
    assert.equal(new Set(seen.map((i) => i.level)).size, 7, 'seven distinct levels');
    assert.equal(new Set(seen.map((i) => i.glyph)).size, 7, 'and seven distinct glyphs');
    for (const i of seen) {
      assert.ok(i.label.length > 0, 'and a text label, because the glyph alone is not enough');
      assert.ok(i.detail.length > 0);
    }
  });

  it('⚠️ no glyph is an emoji, so the row does not jump when a state changes', () => {
    // An emoji renders at a different size and baseline from the geometric shapes, and colour fonts
    // vary by platform -- so a state change would visibly shift the whole bar.
    const states = [
      automation(),
      automation({ automationEnabled: false }),
      automation({ lastAttemptUnconfirmed: true }),
      automation({ halt: { trigger: 'hourly-rate', observedCount: 10, threshold: 10 } }),
      automation({ evaluation: { decided: false, decidedOnPartialData: false, holding: true } }),
      automation({ evaluation: { decided: true, decidedOnPartialData: true, holding: false } }),
      automation({ evaluation: { decided: true, decidedOnPartialData: false, holding: false } }),
    ];
    for (const i of states.map(automationIndicator)) {
      assert.equal([...i.glyph].length, 1, `${i.label}: one codepoint`);
      assert.ok(i.glyph.codePointAt(0)! < 0x1f000, `${i.label}: not an emoji plane codepoint`);
    }
  });
});

describe('⭐ FC-U5-1 — the halt outranks the switch it turned off', () => {
  it('reports halted even though automation is also off', () => {
    // A halt sets the switch off, so reporting `disabled` would show the consequence and hide the
    // cause -- leaving automation apparently idle for ever, since only an acknowledgement clears it.
    const i = automationIndicator(
      automation({
        automationEnabled: false,
        halt: { trigger: 'consecutive', observedCount: 3, threshold: 3 },
      }),
    );
    assert.equal(i.level, 'halted');
    assert.match(i.label, /HALTED/);
  });

  it('says what tripped it and that only an acknowledgement clears it', () => {
    const i = automationIndicator(
      automation({ halt: { trigger: 'hourly-rate', observedCount: 10, threshold: 10 } }),
    );
    assert.match(i.detail, /10 rule-skips in one hour/);
    assert.match(i.detail, /limit of 10/);
    assert.match(i.detail, /acknowledge/i);
  });

  it('⚠️ halted is NOT `fail` — the system protecting you is not the system breaking', () => {
    const halted = automationIndicator(
      automation({ halt: { trigger: 'consecutive', observedCount: 3, threshold: 3 } }),
    );
    const failed = automationIndicator(automation({ lastAttemptUnconfirmed: true }));
    assert.equal(halted.level, 'halted');
    assert.equal(failed.level, 'fail');
    assert.notEqual(halted.glyph, failed.glyph);
  });
});

describe('⭐ FC-U5-1 — unknown is never idle', () => {
  it('automationEnabled null is unknown, not idle and certainly not ok', () => {
    // A dot that is green, or calmly idle, because nothing has reported yet is this project's central
    // defect wearing a UI hat.
    const i = automationIndicator(automation({ automationEnabled: null }));
    assert.equal(i.level, 'unknown');
    assert.match(i.detail, /No automation status/i);
  });

  it('⚠️ unknown outranks disabled, so a silent app is not read as a deliberate off', () => {
    const i = automationIndicator(automation({ automationEnabled: null, liveRules: 0 }));
    assert.equal(i.level, 'unknown');
  });
});

describe('⭐ FC-U5-1 — the `failed` state, which a test MUST be able to reach', () => {
  it('an unconfirmed attempt reads as fail, and says it is not retried', () => {
    // A state no test can enter is the `recordSuccessorLag` trap in UI form -- a method that was dead
    // for its whole life inside a live, heavily-executed file.
    const i = automationIndicator(automation({ lastAttemptUnconfirmed: true }));
    assert.equal(i.level, 'fail');
    assert.match(i.label, /unconfirmed/i);
    // P-30: re-sending it later would skip whatever is playing then, which is not the action decided.
    assert.match(i.detail, /NOT retried/);
  });

  it('⚠️ outranks disabled, because switching off is what someone does when it seems broken', () => {
    const i = automationIndicator(
      automation({ automationEnabled: false, lastAttemptUnconfirmed: true }),
    );
    assert.equal(i.level, 'fail');
  });

  it('⚠️ is NOT sticky — a later confirmed attempt clears it', () => {
    // Unlike `recording.gaps`, which is sticky because a dropped play is a permanent hole in the
    // corpus. An unconfirmed skip is a question about the device that the next skip re-asks, and a
    // latch that never cleared would be red for ever after one flaky transition.
    assert.equal(automationIndicator(automation({ lastAttemptUnconfirmed: false })).level, 'idle');
  });

  it('but the halt still outranks it', () => {
    const i = automationIndicator(
      automation({
        lastAttemptUnconfirmed: true,
        halt: { trigger: 'consecutive', observedCount: 3, threshold: 3 },
      }),
    );
    assert.equal(i.level, 'halted');
  });
});

describe('FC-U5-1 — `disabled` has three causes, and the detail names which', () => {
  it('the machinery is not built, and it names the restart rather than the switch', () => {
    const i = automationIndicator(automation({ executorConstructed: false }));
    assert.equal(i.level, 'disabled');
    assert.match(i.detail, /SKIP_EXECUTOR_ENABLED/);
    assert.match(i.detail, /restart/);
  });

  it('the switch is off, and it says rules are still logged', () => {
    const i = automationIndicator(automation({ automationEnabled: false }));
    assert.equal(i.level, 'disabled');
    assert.match(i.detail, /evaluated and logged/);
    assert.match(i.detail, /Rules panel/);
  });

  it('⚠️ every rule is dry-run or disabled — on, and still unable to act', () => {
    // A rule set of ten dry-run rules looks busy in `Rules v#` and can skip nothing. The honest word
    // for that is off, and `idle` would wrongly suggest it is armed and waiting.
    const i = automationIndicator(automation({ automationEnabled: true, liveRules: 0 }));
    assert.equal(i.level, 'disabled');
    assert.match(i.detail, /no rule can act/);
    assert.match(i.detail, /dry-run or disabled/);
  });

  it('⚠️ the three causes give three DIFFERENT details, not one generic off', () => {
    const details = [
      automation({ executorConstructed: false }),
      automation({ automationEnabled: false }),
      automation({ liveRules: 0 }),
    ].map((s) => automationIndicator(s).detail);
    assert.equal(new Set(details).size, 3);
  });
});

describe('FC-U5-1 — where this play got to', () => {
  it('idle when armed with nothing playing, and says how many rules are live', () => {
    const i = automationIndicator(automation({ evaluation: null, liveRules: 3 }));
    assert.equal(i.level, 'idle');
    assert.match(i.detail, /3 live rule/);
  });

  it('hold while a rule waits for a fact, and says it will not hold for ever', () => {
    const i = automationIndicator(
      automation({ evaluation: { decided: false, decidedOnPartialData: false, holding: true } }),
    );
    assert.equal(i.level, 'hold');
    assert.match(i.label, /holding/i);
    assert.match(i.detail, /rest of the track/);
  });

  it('also hold while merely waiting for enrichment, with a different label', () => {
    const i = automationIndicator(
      automation({ evaluation: { decided: false, decidedOnPartialData: false, holding: false } }),
    );
    assert.equal(i.level, 'hold');
    assert.match(i.label, /Evaluating/);
  });

  it('⭐ passed-partial when the decision was taken before the facts arrived', () => {
    // ⚠️ `ok` here would hide that a fact never arrived, and this is the pair the glyph test exists
    // for: green and yellowgreen are the hardest two to tell apart.
    const i = automationIndicator(
      automation({ evaluation: { decided: true, decidedOnPartialData: true, holding: false } }),
    );
    assert.equal(i.level, 'passed-partial');
    assert.match(i.detail, /before all the facts/);
    assert.match(i.detail, /decision log/);
  });

  it('ok when it decided on complete facts', () => {
    const i = automationIndicator(
      automation({ evaluation: { decided: true, decidedOnPartialData: false, holding: false } }),
    );
    assert.equal(i.level, 'ok');
    assert.match(i.detail, /complete facts/);
  });
});

describe('⭐ the bar with automation present', () => {
  it('renders five indicators, with automation last', () => {
    const bar = statusBar({
      recording: recording(),
      rules: rules(),
      connection: 'open',
      spotify: { snapshotError: null, hasSnapshot: true },
      automation: automation(),
    });
    assert.equal(bar.indicators.length, 5);
    assert.match(bar.indicators[4]!.label, /Automation/);
  });

  it('⚠️ a standing halt DOES produce the one message when nothing has failed', () => {
    const bar = statusBar({
      recording: recording(),
      rules: rules(),
      connection: 'open',
      spotify: { snapshotError: null, hasSnapshot: true },
      automation: automation({ halt: { trigger: 'consecutive', observedCount: 3, threshold: 3 } }),
    });
    assert.match(bar.message!, /Stopped itself/);
  });

  it('⭐ ⚠️ but a `fail` OUTRANKS a halt regardless of position', () => {
    // A halt can stand for days, since only an acknowledgement clears it. A single pass accepting
    // either level would let it permanently occupy the one message slot and hide every later fault --
    // and `automation` sits last, so position alone would not save it.
    const bar = statusBar({
      recording: recording({ repositoryOpen: false }),
      rules: rules(),
      connection: 'open',
      spotify: { snapshotError: null, hasSnapshot: true },
      automation: automation({ halt: { trigger: 'consecutive', observedCount: 3, threshold: 3 } }),
    });
    assert.match(bar.message!, /NOT being saved/, 'recording loses what cannot be recreated');
  });

  it('an idle automation dot produces no message', () => {
    const bar = statusBar({
      recording: recording(),
      rules: rules(),
      connection: 'open',
      spotify: { snapshotError: null, hasSnapshot: true },
      automation: automation(),
    });
    assert.equal(bar.message, null);
  });
});
