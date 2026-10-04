/**
 * FC-U5-2 (the kill switch) and FC-U5-3 (the runaway acknowledgement). ⚙️ PURE
 *
 * ## ⚠️ Why the judgement is here and not in `public/app.js`
 *
 * Same reason as `statusBar.ts`: `app.js` has **no tests** and is outside the orphan check, which walks
 * `src/` only. Both real defects ever found in it — the liked-refresh race and the *"every axis tick
 * says Aug"* bug — were found **by clicking**.
 *
 * For this component that is not a general principle but a specific hazard. The documented failure mode
 * is *"a kill switch that works in the UI and does not persist"*: the button flips, the page re-renders
 * from client state, and a restart silently re-arms automation. The defence is that **nothing here reads
 * client state** — every function below takes what the server read back from disk and returns what the
 * button should say about it. `app.js` sets `textContent` and `disabled`, and decides nothing.
 *
 * ## ⚠️ Two buttons for the halt, never one
 *
 * BR-35.5: *"I have reviewed this"* and *"turn automation back on"* are different statements. A single
 * button would make the system's halt indistinguishable from the user's own choice — and the halt exists
 * precisely so the two can be told apart.
 */

/** `GET /api/automation`, as the panel needs it. ⚠️ Every field comes from disk, none from the client. */
export interface AutomationView {
  /** ⚠️ `null` before the first read. Never rendered as *off* — see `switchView`. */
  readonly enabled: boolean | null;
  readonly halt: HaltView | null;
  /** `file` | `absent` | `unreadable`. ⚠️ Part of the answer, not debug detail. */
  readonly source: 'file' | 'absent' | 'unreadable' | null;
  /** ⚠️ A probe through the container, not an inference from `compose.yaml`. */
  readonly writable: boolean | null;
  /** Is `SkipExecutor` constructed. Needs a restart to change. */
  readonly executorEnabled: boolean;
  /** The last write this UI attempted, if it failed. ⚠️ Surfaced, never swallowed. */
  readonly lastWriteError: string | null;
}

export interface HaltView {
  readonly haltedAt: string;
  readonly trigger: 'consecutive' | 'hourly-rate';
  readonly observedCount: number;
  readonly threshold: number;
  readonly attemptIds: readonly number[];
}

export interface SwitchView {
  /** What the button says. */
  readonly label: string;
  /** What pressing it would ask for. `null` when the button must not be pressable. */
  readonly nextEnabled: boolean | null;
  readonly disabled: boolean;
  /**
   * Why it is disabled, or what the current state means. ⚠️ Never empty: a greyed control with no
   * explanation is the `Label detail` dash again, and gets reported as broken.
   */
  readonly explanation: string;
  /** ⚠️ A problem the user must see, not a state. `null` when there is nothing wrong. */
  readonly warning: string | null;
  /** `true` only when automation is confirmed armed, from disk. */
  readonly on: boolean;
}

/**
 * FC-U5-2 — what the kill switch should say and whether it may be pressed.
 *
 * ## The precedence, and the one that matters
 *
 * 1. **`enabled === null` → not pressable.** Nothing has been read yet. A button rendered *Turn on*
 *    over an unknown state invites a click whose effect nobody can predict.
 * 2. **`executorEnabled === false` → not pressable, and the reason names the restart.** The switch
 *    cannot help: with the machinery unbuilt, arming would persist a `true` that nothing reads. Offering
 *    a control that appears to work and changes nothing is the exact failure this component exists to
 *    avoid, one layer up.
 * 3. **⚠️ `writable === false` → STILL PRESSABLE, with a warning.** This is the asymmetry, and it is
 *    deliberate (NFR Q5): refusing the press would mean *the user pressed stop and the system kept
 *    going*. Turning automation **off** must always be attemptable. The warning says the write will
 *    probably fail; the response, read back from disk, says whether it did.
 * 4. Otherwise the ordinary two states.
 */
export function switchView(view: AutomationView): SwitchView {
  const on = view.enabled === true;

  if (view.enabled === null) {
    return {
      label: 'Automation',
      nextEnabled: null,
      disabled: true,
      explanation: 'The automation state has not been read yet.',
      warning: warningFor(view),
      on: false,
    };
  }

  if (!view.executorEnabled) {
    return {
      label: 'Automation unavailable',
      nextEnabled: null,
      disabled: true,
      explanation:
        'The skip machinery is not built in this deployment, so this switch would change nothing. ' +
        'Set SKIP_EXECUTOR_ENABLED and restart the container.',
      // ⚠️ NOT `null`. `explanation` says why the button is dead; `warning` says something went
      // wrong — two separate channels, and a failed write must surface whichever branch is taken.
      // Hard-coding `null` here hid a real save failure behind a greyed control.
      warning: warningFor(view),
      on,
    };
  }

  // ⚠️ The halt is not handled here. It is a separate control (FC-U5-3), and the API refuses to ARM
  // while it stands — so the switch stays pressable for the direction that always has to work: off.
  const halted = view.halt !== null;

  return {
    label: on ? 'Turn automation off' : 'Turn automation on',
    nextEnabled: !on,
    // ⚠️ Arming is refused while halted, so the button that would arm must not be offered. Disarming
    // is never refused, so it stays live even then.
    disabled: halted && !on,
    explanation: halted
      ? 'Automation is halted. Acknowledge the halt below before turning it back on.'
      : on
        ? 'Rules that match will skip the track.'
        : 'Rules are evaluated and logged. Nothing will be skipped.',
    warning: warningFor(view),
    on,
  };
}

/**
 * The problems worth interrupting the user about.
 *
 * ⚠️ **`unreadable` is reported even though it reads as *off*.** `absent` and `unreadable` both produce
 * `enabled: false`, and they are different facts: the first is a fresh install behaving correctly, the
 * second is a file this app could not parse — where a switch thrown here would appear to work and not
 * persist, which is the documented worst case for this control.
 */
function warningFor(view: AutomationView): string | null {
  if (view.lastWriteError !== null) {
    return `The last change could not be saved: ${view.lastWriteError} The state shown is what is on disk.`;
  }
  if (view.writable === false) {
    return (
      'The automation state file is not writable, so a change here will probably not persist. ' +
      'Check that ./state is mounted :rw — and verify through the container, not on the host.'
    );
  }
  if (view.source === 'unreadable') {
    return (
      'The automation state file could not be read, so automation is off by default. ' +
      'That is the safe reading, not a confirmed setting.'
    );
  }
  return null;
}

export interface HaltPanel {
  /** The headline. States WHAT TRIPPED IT (BR-35.8), never just that something did. */
  readonly heading: string;
  readonly detail: string;
  /** ⚠️ Real `skip_attempt` ids. An empty list is itself worth showing — see `attemptsNote`. */
  readonly attemptIds: readonly number[];
  readonly attemptsNote: string;
  /** BR-35.5 — two statements, two buttons. */
  readonly acknowledgeLabel: string;
  readonly reArmLabel: string;
}

/**
 * FC-U5-3 — the acknowledgement panel. `null` when nothing is halted.
 *
 * ⚠️ **This must not be the only place the halt is visible.** A user who never opens the Rules pop-up
 * would see automation silently doing nothing; that is what FC-U5-1's `halted` state is for.
 */
export function haltPanel(halt: HaltView | null): HaltPanel | null {
  if (halt === null) return null;

  // ⚠️ The CONSECUTIVE wording names the skip that latched it, which is one MORE than the threshold:
  // the counter reads closed plays, so the skip being checked has not closed yet. Saying only "3" would
  // under-describe what the listener just heard by one track.
  const what =
    halt.trigger === 'consecutive'
      ? `${halt.observedCount} rule-skips in a row (the ${halt.observedCount + 1}th skip is what latched this — the count reads completed plays, so it trails the skip being checked by one)`
      : `${halt.observedCount} rule-skips within one hour`;

  return {
    heading: 'Automation stopped itself',
    detail:
      `${what}, against a limit of ${halt.threshold}, at ${halt.haltedAt}. ` +
      'Automation has been off since then and will stay off until you act on this. ' +
      '⚠️ The limit is a safety bound, not a setting — if it was reached legitimately, the rule is ' +
      'matching far more than expected and is worth reading before it is re-armed.',
    attemptIds: halt.attemptIds,
    attemptsNote: attemptsNote(halt.attemptIds),
    // ⚠️ Two statements, and the labels say which is which. Neither is the default.
    acknowledgeLabel: 'I have reviewed this',
    reArmLabel: 'Turn automation back on',
  };
}

/**
 * ⚠️ **An empty id list is a DEFECT REPORT, not an empty state.**
 *
 * BR-35.8 requires the surface to say which rule-skips counted, and `firedSince` returns real row ids
 * for exactly that reason — an earlier draft synthesised them from array indices, which would have
 * pointed the user at attempts that do not exist in the one place they are asked to review evidence
 * before clearing a safety latch. If the list arrives empty, the honest thing is to say the evidence is
 * missing rather than render nothing and let it read as *there was nothing to show*.
 */
function attemptsNote(ids: readonly number[]): string {
  if (ids.length === 0) {
    return (
      '⚠️ No attempt ids were recorded with this halt, which should not happen — the halt is real, ' +
      'but the evidence for it is missing. Read the decision log before re-arming.'
    );
  }
  return `Skip attempt ${ids.length === 1 ? 'id' : 'ids'}: ${ids.join(', ')}.`;
}
