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
  /**
   * ⚠️ **Whether the switch is shown AT ALL.** `false` while halted.
   *
   * ## ⚠️ ONE CONTROL AT A TIME, because three buttons is a state machine
   *
   * Until 2026-10-04 a halt rendered **three** controls together: the kill switch, *"I have reviewed
   * this"* and *"turn automation back on"*. That turns a linear recovery into a combinatorial one —
   * every ordering has to be defined and defended, and none of the variations adds anything.
   *
   * ⚠️ **And the switch LIED.** `globalAutomationEnabled` stays `true` through a halt (BR-33.4 — the
   * halt is a third latch, never a write to the switch), so it read *"Turn automation off"* while nothing
   * could be skipped. A control that describes a state the system is not in is worse than no control.
   *
   * While halted there is exactly one thing to do, so exactly one button is offered. The switch returns
   * once the halt is cleared, and it then reads `Turn automation on` — because acknowledging lands in the
   * off state by construction.
   */
  readonly rendered: boolean;
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
      rendered: true,
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
      rendered: true,
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

  /*
   * ⚠️ **WHILE HALTED, THE SWITCH IS NOT RENDERED AT ALL** (2026-10-04, user direction).
   *
   * Nothing is being skipped — the halt guarantees that — so the switch has no safety role here, and
   * showing it alongside the halt panel's button was the whole source of the combinatorial mess. The
   * single action on the panel lands in the off state, which is the only destination the switch could
   * have offered anyway.
   */
  if (view.halt !== null) {
    return {
      rendered: false,
      label: '',
      nextEnabled: null,
      disabled: true,
      explanation:
        'Automation stopped itself and nothing is being skipped. Review the halt below to continue.',
      warning: warningFor(view),
      on,
    };
  }

  return {
    rendered: true,
    label: on ? 'Turn automation off' : 'Turn automation on',
    nextEnabled: !on,
    disabled: false,
    explanation: on
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
  /**
   * ⚠️ **ONE button, and it clears the halt AND leaves automation OFF.**
   *
   * ## Why not two
   *
   * FC-U5-3 originally specified two — *"I have reviewed this"* and *"turn automation back on"* — to keep
   * acknowledging distinct from resuming (BR-35.5). **The distinction is right and the mechanism was
   * wrong**: shown together, with the kill switch beside them, three controls made a linear recovery
   * into a state machine whose orderings all had to be defined and none of which added anything.
   *
   * ⚠️ **Sequencing separates the two acts more cleanly than juxtaposing them.** Acknowledging forces
   * `globalAutomationEnabled: false`, so resuming is unavoidably a **second, deliberate** act performed
   * on the ordinary switch — which is exactly what BR-35.5 is protecting, and it can no longer be done
   * by accident while reaching for the other button.
   */
  readonly acknowledgeLabel: string;
}

/**
 * FC-U5-3 — the acknowledgement panel. `null` when nothing is halted.
 *
 * ⚠️ **This must not be the only place the halt is visible.** A user who never opens the Rules pop-up
 * would see automation silently doing nothing; that is what FC-U5-1's `halted` state is for.
 */
export function haltPanel(halt: HaltView | null): HaltPanel | null {
  if (halt === null) return null;

  // ⚠️ This briefly claimed the NEXT skip was what latched it. Wrong — measured 2026-10-04: three
  // skips happened and the fourth track was refused. BR-43.4's confirmation grace means the play has
  // closed by the time the halt is checked. See `MAX_CONSECUTIVE_RULE_SKIPS`.
  const what =
    halt.trigger === 'consecutive'
      ? `${halt.observedCount} rule-skips in a row`
      : `${halt.observedCount} rule-skips within one hour`;

  return {
    heading: 'Automation stopped itself',
    detail:
      `${what}, against a limit of ${halt.threshold}, at ${halt.haltedAt}. ` +
      'Nothing has been skipped since. ' +
      '⚠️ The limit is a safety bound, not a setting — if it was reached legitimately, the rule is ' +
      'matching far more than expected and is worth reading before automation is turned back on. ' +
      'Clearing this halt leaves automation OFF; turn it back on from the switch above when you are ready.',
    attemptIds: halt.attemptIds,
    attemptsNote: attemptsNote(halt.attemptIds),
    // ⚠️ The label states BOTH effects, because the button does both: it clears the latch and leaves
    // automation off. A label reading only "I have reviewed this" would hide the second half.
    acknowledgeLabel: 'I have reviewed this — clear the halt and leave automation off',
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
