/**
 * FC-U5-2 (the kill switch) and FC-U5-3 (the runaway acknowledgement) — the pure derivation.
 *
 * ## ⚠️ The documented worst case, and what these tests are defending
 *
 * *"A kill switch that works in the UI and does not persist"*: the button flips, the page re-renders from
 * client state, and a restart silently re-arms automation. Every function under test takes **what the
 * server read back from disk** and returns what the control should say about it — so the defence is
 * structural, and these tests pin the places where an implementation would be tempted to be helpful
 * instead of honest.
 *
 * ## ⭐ The four that would be got wrong
 *
 *   1. **`enabled: null` is not pressable.** A button reading *Turn on* over an unknown state invites a
 *      click whose effect nobody can predict.
 *   2. **An unwritable state file leaves the switch PRESSABLE.** The obvious *"don't offer a control that
 *      will fail"* means the user presses stop and the system keeps going.
 *   3. **Arming is refused while halted; disarming is not.** One direction always has to work.
 *   4. **An empty `attemptIds` list is a defect report, not an empty state.** BR-35.8 requires the
 *      surface to name which skips counted, in the one place the user reviews evidence before clearing a
 *      safety latch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { haltPanel, switchView } from '../src/ui/automationPanel.js';
import type { AutomationView, HaltView } from '../src/ui/automationPanel.js';

function view(overrides: Partial<AutomationView> = {}): AutomationView {
  return {
    enabled: false,
    halt: null,
    source: 'file',
    writable: true,
    executorEnabled: true,
    lastWriteError: null,
    ...overrides,
  };
}

const HALT: HaltView = {
  haltedAt: '2026-10-02T11:00:00.000Z',
  trigger: 'consecutive',
  observedCount: 3,
  threshold: 3,
  attemptIds: [41, 42, 43],
};

describe('FC-U5-2 — the ordinary two states', () => {
  it('offers to turn it on when it is off, and says what off means', () => {
    const s = switchView(view({ enabled: false }));
    assert.equal(s.on, false);
    assert.equal(s.nextEnabled, true);
    assert.equal(s.disabled, false);
    assert.match(s.label, /Turn automation on/);
    // ⚠️ "Off" is not "doing nothing" — rules are still evaluated and logged, which is the whole of
    // U4. A label that implied the engine was stopped would be wrong.
    assert.match(s.explanation, /evaluated and logged/);
  });

  it('offers to turn it off when it is on, and says what on means', () => {
    const s = switchView(view({ enabled: true }));
    assert.equal(s.on, true);
    assert.equal(s.nextEnabled, false);
    assert.equal(s.disabled, false);
    assert.match(s.label, /Turn automation off/);
    assert.match(s.explanation, /will skip the track/);
  });

  it('⚠️ every state carries a non-empty explanation', () => {
    // A greyed control with no explanation is the `Label detail` dash again: an empty state that does
    // not explain itself gets reported as broken, and eventually removed by someone who assumes it is.
    for (const v of [
      view({ enabled: null }),
      view({ enabled: false }),
      view({ enabled: true }),
      view({ executorEnabled: false }),
      view({ halt: HALT }),
      view({ enabled: true, halt: HALT }),
    ]) {
      assert.ok(switchView(v).explanation.length > 0, JSON.stringify(v));
    }
  });
});

describe('⭐ unknown is not off', () => {
  it('⚠️ `enabled: null` is NOT pressable and does not claim a direction', () => {
    const s = switchView(view({ enabled: null }));
    assert.equal(s.disabled, true);
    assert.equal(s.nextEnabled, null, 'no direction, because the current state is unknown');
    assert.equal(s.on, false, 'and it is certainly not drawn as armed');
    assert.doesNotMatch(s.label, /Turn/);
  });
});

describe('the executor not being built is a different fact from the switch', () => {
  it('⚠️ is not pressable, and names the RESTART rather than inviting a click', () => {
    const s = switchView(view({ enabled: false, executorEnabled: false }));
    assert.equal(s.disabled, true);
    assert.equal(s.nextEnabled, null);
    assert.match(s.explanation, /SKIP_EXECUTOR_ENABLED/);
    assert.match(s.explanation, /restart/);
  });

  it('⭐ ⚠️ STILL surfaces a failed write, because warning and explanation are separate channels', () => {
    // Found 2026-10-02: this branch hard-coded `warning: null`, so a save failure vanished behind the
    // greyed control. `explanation` says why the button is dead; `warning` says something went wrong,
    // and the user had just caused the second one.
    const s = switchView(
      view({ executorEnabled: false, lastWriteError: 'EROFS: read-only file system.' }),
    );
    assert.equal(s.disabled, true);
    assert.match(s.warning!, /EROFS/);
    assert.match(s.explanation, /not built/, 'and both channels still say their own thing');
  });

  it('outranks the halt, because neither can be fixed from this button', () => {
    const s = switchView(view({ executorEnabled: false, halt: HALT }));
    assert.equal(s.disabled, true);
    assert.match(s.explanation, /not built/);
  });
});

describe('⭐ the asymmetry: an unwritable state file does NOT disable the switch', () => {
  it('⚠️ stays pressable, and warns that the write will probably fail', () => {
    // NFR Q5. The obvious "don't change state if you couldn't persist it" means the user pressed stop
    // and the system kept going. Turning automation OFF must always be attemptable.
    const s = switchView(view({ enabled: true, writable: false }));
    assert.equal(s.disabled, false, 'the user must still be able to try to turn it off');
    assert.equal(s.nextEnabled, false);
    assert.match(s.warning!, /not writable/);
    assert.match(s.warning!, /through the container/, 'on the host the write succeeds and hides it');
  });

  it('warns the same way when it is off, because arming would also not persist', () => {
    const s = switchView(view({ enabled: false, writable: false }));
    assert.equal(s.disabled, false);
    assert.match(s.warning!, /not persist/);
  });

  it('⚠️ a FAILED WRITE outranks the writability warning and quotes the real error', () => {
    // The probe says "probably"; a failed write says "did". The second is the more specific fact and
    // the one the user just caused.
    const s = switchView(view({ writable: false, lastWriteError: 'EROFS: read-only file system.' }));
    assert.match(s.warning!, /EROFS/);
    assert.match(s.warning!, /what is on disk/, 'and the state shown is disk, not the attempt');
  });

  it('⚠️ `source: unreadable` warns even though it reads as off', () => {
    // `absent` and `unreadable` both give enabled:false and are different facts. The first is a fresh
    // install behaving correctly; the second is where a thrown switch appears to work and does not
    // persist -- the documented worst case for this control.
    const s = switchView(view({ source: 'unreadable' }));
    assert.match(s.warning!, /could not be read/);
    assert.match(s.warning!, /safe reading, not a confirmed setting/);
  });

  it('a fresh install (`source: absent`) warns about nothing', () => {
    assert.equal(switchView(view({ source: 'absent' })).warning, null);
  });

  it('nothing wrong means no warning at all', () => {
    assert.equal(switchView(view()).warning, null);
    assert.equal(switchView(view({ enabled: true })).warning, null);
  });
});

describe('⭐ arming is refused while halted; disarming never is', () => {
  it('⚠️ the ARM button is not offered while a halt stands', () => {
    // BR-35.6: a latch cleared as a side effect of flipping a switch is not an acknowledgement. The API
    // returns 409 for this, and offering a button that gets a 409 is offering a broken control.
    const s = switchView(view({ enabled: false, halt: HALT }));
    assert.equal(s.disabled, true);
    assert.match(s.explanation, /Acknowledge the halt/);
  });

  it('⚠️ but DISARMING stays live even while halted', () => {
    // Turning automation off must work in every state the app can reach. (A halt normally sets the
    // switch off, so this is the state reached by a write that half-landed -- which is exactly when a
    // user would most want to press stop.)
    const s = switchView(view({ enabled: true, halt: HALT }));
    assert.equal(s.disabled, false);
    assert.equal(s.nextEnabled, false);
    assert.match(s.label, /Turn automation off/);
  });
});

describe('FC-U5-3 — the acknowledgement panel', () => {
  it('is null when nothing is halted, so the panel is absent rather than empty', () => {
    assert.equal(haltPanel(null), null);
  });

  it('⭐ states WHAT TRIPPED IT, not merely that something did', () => {
    // BR-35.8. A panel saying "automation halted" leaves the user with nothing to review.
    const p = haltPanel(HALT)!;
    assert.match(p.detail, /3 rule-skips in a row/);
    assert.match(p.detail, /limit of 3/);
    assert.match(p.detail, /2026-10-02T11:00:00.000Z/);
  });

  it('⭐ ⚠️ states the count plainly — an earlier version claimed the NEXT skip latched it', () => {
    // That claim was WRONG and was reverted 2026-10-04. Measured live: three skips happened and the
    // FOURTH track was refused `runaway-halted`. BR-43.4's confirmation grace means the play has closed
    // by the time the halt is checked, so the counter sees the skip it is checking. 3 means 3.
    const p = haltPanel(HALT)!;
    assert.match(p.detail, /3 rule-skips in a row/);
    assert.doesNotMatch(p.detail, /4th/, 'no off-by-one claim');
    assert.doesNotMatch(p.detail, /trails the skip/);
  });

  it('distinguishes the two triggers in words, not just by a field', () => {
    assert.match(haltPanel(HALT)!.detail, /in a row/);
    assert.match(
      haltPanel({ ...HALT, trigger: 'hourly-rate', observedCount: 10, threshold: 10 })!.detail,
      /within one hour/,
    );
  });

  it('⚠️ says the limit is a safety bound rather than a setting', () => {
    // The moment it reads as a setting, the obvious fix is to raise it and the guard becomes
    // decorative -- which is why the thresholds are constants and not env values.
    assert.match(haltPanel(HALT)!.detail, /safety bound, not a setting/);
  });

  it('⭐ ⚠️ two buttons, and the labels are two different statements', () => {
    // BR-35.5. A single button would make the system's halt indistinguishable from the user's own
    // choice -- which is the distinction the halt exists to create.
    const p = haltPanel(HALT)!;
    assert.match(p.acknowledgeLabel, /reviewed/);
    assert.match(p.reArmLabel, /back on/);
    assert.notEqual(p.acknowledgeLabel, p.reArmLabel);
  });

  it('names the real attempt ids', () => {
    const p = haltPanel(HALT)!;
    assert.deepEqual(p.attemptIds, [41, 42, 43]);
    assert.match(p.attemptsNote, /41, 42, 43/);
    assert.match(p.attemptsNote, /ids:/, 'plural when there are several');
  });

  it('says "id" for one', () => {
    assert.match(haltPanel({ ...HALT, attemptIds: [7] })!.attemptsNote, /attempt id: 7\./);
  });

  it('⭐ ⚠️ an EMPTY id list is reported as a defect, not rendered as nothing', () => {
    // An earlier draft synthesised these ids from array indices, which would have pointed the user at
    // attempts that do not exist -- in the one place they are asked to review evidence before clearing
    // a safety latch. If the list is empty the honest answer is that the evidence is missing, because
    // silence here reads as "there was nothing to show".
    const p = haltPanel({ ...HALT, attemptIds: [] })!;
    assert.deepEqual(p.attemptIds, []);
    assert.match(p.attemptsNote, /should not happen/);
    assert.match(p.attemptsNote, /halt is real/, 'the halt is not dismissed along with its evidence');
    assert.match(p.attemptsNote, /before re-arming/);
  });
});
