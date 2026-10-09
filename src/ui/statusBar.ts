/**
 * Status-bar state derivation (FC-1). ⚙️ PURE
 *
 * ## ⚠️ Why this is in `src/` and not in `public/app.js`
 *
 * `app.js` has **no tests** and is outside the orphan check, which walks `src/` only. Both real
 * defects ever found in it — the liked-refresh race and the "every axis tick says Aug" bug —
 * were found by *clicking*. The DOM wiring can live there; **the judgement cannot**, because a
 * false green would come from exactly this judgement.
 *
 * ## ⚠️ Four states, not three
 *
 * A dot that is green because nothing has reported yet is this project's central defect wearing
 * a UI hat. `null` means unknown and is never `false` or `0` — end to end, including here. An
 * indicator that has not heard from its subsystem renders **unknown**, never ok.
 *
 * That matters most on **Recording**, where a false green says *"your listening is being saved"*
 * about the one artefact that cannot be regenerated.
 */

/**
 * ⚠️ **WIDENED FOR U5 (FC-U5-1), and the five new members are NOT interchangeable with the four.**
 *
 * The original four describe *subsystem health*: working, degraded, broken, not heard from. FC-U5-1
 * describes something else — **where a play is in the evaluation pipeline** — and the user asked for it
 * as colour on the status line rather than more prose.
 *
 * `passed` maps onto `ok` and `failed` onto `fail`, because those genuinely are health. The other five
 * had no home:
 *
 * | New member | Says | Why not an existing one |
 * |---|---|---|
 * | `idle` | nothing is being evaluated | `ok` would claim a decision was made |
 * | `disabled` | automation is off, or no rule can act | `warn` implies something went wrong; this is the default |
 * | `hold` | a rule is waiting for a fact (BR-38) | `warn` again — holding is the feature working |
 * | `passed-partial` | decided, but on INCOMPLETE facts | ⚠️ `ok` would hide that a fact never arrived |
 * | `halted` | the runaway latch is in force (BR-35.4) | ⚠️ `fail` is *something is broken*; this is *the system protected you* |
 *
 * ⚠️ **There is no `default:` clause anywhere this is switched**, so adding a member is a compile
 * error at every site that must change — the same deliberate pattern as `applyOnUnknown`. **Do not add
 * one to silence the compiler.** `GLYPHS` below is a `Record` over the union for the same reason.
 */
export type IndicatorLevel =
  | 'ok'
  | 'warn'
  | 'fail'
  | 'unknown'
  | 'idle'
  | 'disabled'
  | 'hold'
  | 'passed-partial'
  | 'halted';

export interface Indicator {
  readonly level: IndicatorLevel;
  /** Short text beside the dot. ⚠️ Colour is never the only channel. */
  readonly label: string;
  /** A distinct glyph per level, for the same reason. */
  readonly glyph: string;
  /** Shown on click. Includes the age of the answer where there is one. */
  readonly detail: string;
}

/**
 * ⚠️ **One distinct glyph per level, because colour is never the only channel.**
 *
 * The user's proposed palette included both *Green-passed* and *Yellowgreen-passed with missing info* —
 * **the single hardest pair to tell apart** for anyone with a red–green deficiency, and the pair where
 * being wrong means believing a decision rested on facts that never arrived. `●` against `◎` is
 * readable with no colour at all.
 *
 * ⚠️ Deliberately plain codepoints, not emoji: an emoji renders at a different size and baseline from
 * the others, so a row of dots would visibly jump when a state changed, and colour fonts vary by
 * platform. These all come from the same geometric-shapes neighbourhood as the original four.
 */
const GLYPHS: Record<IndicatorLevel, string> = {
  ok: '●',
  warn: '◐',
  fail: '✕',
  unknown: '○',
  idle: '·',
  disabled: '⊘',
  hold: '…',
  'passed-partial': '◎',
  halted: '‼',
};

function indicator(level: IndicatorLevel, label: string, detail: string): Indicator {
  return { level, label, glyph: GLYPHS[level], detail };
}

export interface RecordingState {
  /** `null` before the first status has been heard — NOT "not recording". */
  readonly repositoryOpen: boolean | null;
  readonly degraded: boolean;
  /** Plays already lost to a write failure. ⚠️ Sticky: they do not come back. */
  readonly gaps: number;
  readonly startupError: string | null;
}

/**
 * ⚠️ `repositoryOpen === true` is **not** sufficient for green.
 *
 * A null repository happens once, at startup, on a failed migration. The likelier fault is a
 * **runtime write failure**, which the observer already tracks as `degraded` and `gaps`. An
 * indicator reading only the constructor's outcome shows green while plays are being dropped.
 *
 * `gaps` is sticky by design: recovery shows as `degraded` going false, but the plays that were
 * lost are gone, and a counter that reset would erase the only record that they existed.
 */
export function recordingIndicator(state: RecordingState): Indicator {
  if (state.repositoryOpen === null) {
    return indicator('unknown', 'Recording', 'Waiting for the first status from the recorder.');
  }

  if (!state.repositoryOpen) {
    return indicator(
      'fail',
      'Recording OFF',
      state.startupError === null
        ? 'History is unavailable — plays are NOT being saved.'
        : `History is unavailable — plays are NOT being saved. ${state.startupError}`,
    );
  }

  if (state.degraded) {
    return indicator(
      'fail',
      'Recording failing',
      `Writes are failing — ${state.gaps} play(s) lost so far. Plays are NOT being saved.`,
    );
  }

  if (state.gaps > 0) {
    return indicator(
      'warn',
      'Recording',
      `Recording now, but ${state.gaps} play(s) were lost earlier and cannot be recovered.`,
    );
  }

  return indicator('ok', 'Recording', 'Writing to history.db.');
}

export interface RulesState {
  /** `null` when the rules engine is not running at all. */
  readonly version: number | null;
  readonly state: 'applied' | 'reloading' | 'rejected' | null;
  readonly activeRules: number;
  readonly disabledRules: number;
  readonly rejectionErrors: readonly string[];
}

/**
 * ⚠️ Red **names the version still in force** (FQ5).
 *
 * A light that only says "something failed" leaves exactly the ambiguity the indicator exists
 * to remove, and a silent last-known-good is indistinguishable from a successful reload — the
 * user would believe an edit is live when it is not.
 */
export function rulesIndicator(state: RulesState): Indicator {
  if (state.state === null || state.version === null) {
    return indicator('unknown', 'Rules', 'The rules engine is not running.');
  }

  // ⚠️ Version 0 means no load has ever been ACCEPTED. Distinct from "v1 with no rules in it",
  // which is a rule set the user wrote and emptied.
  if (state.version === 0 && state.state !== 'rejected') {
    return indicator('unknown', 'Rules', 'No rules file has been loaded yet.');
  }

  if (state.state === 'rejected') {
    const first = state.rejectionErrors[0] ?? 'the file could not be loaded';
    return state.version === 0
      ? indicator('fail', 'Rules rejected', `No rules are active: ${first}`)
      : indicator(
          'fail',
          `Rules v${state.version}`,
          `A newer rules file was rejected: ${first} Still running v${state.version}.`,
        );
  }

  if (state.state === 'reloading') {
    return indicator('warn', `Rules v${state.version}`, 'Re-reading the rules file…');
  }

  const disabled = state.disabledRules > 0 ? `, ${state.disabledRules} disabled` : '';
  return indicator(
    'ok',
    `Rules v${state.version}`,
    `${state.activeRules} active${disabled}.`,
  );
}

export type ConnectionState = 'open' | 'reconnecting' | 'closed' | null;

export function connectionIndicator(state: ConnectionState): Indicator {
  switch (state) {
    case null:
      return indicator('unknown', 'Connection', 'Not yet attempted.');
    case 'open':
      return indicator('ok', 'Connected', 'Live updates are arriving.');
    case 'reconnecting':
      return indicator('warn', 'Reconnecting', 'The live connection dropped and is retrying.');
    case 'closed':
      return indicator('fail', 'Disconnected', 'No live connection. The page is not updating.');
  }
}

export interface SpotifyState {
  /** `null` before the first snapshot. The snapshot's own error field, not a health poll. */
  readonly snapshotError: string | null;
  readonly hasSnapshot: boolean;
}

/**
 * ⚠️ Reads the **WebSocket snapshot**, never a polled `/api/health`.
 *
 * `/api/health` performs a real MCP round-trip per request, and polling it to keep a dot warm
 * would spend upstream budget that label resolution needs — the same reasoning that stopped the
 * liked badge being polled. The snapshot already carries the error state on every tick, free.
 * `/api/health` stays what it is: the thing you open **on click**, once the dot is already red.
 */
export function spotifyIndicator(state: SpotifyState): Indicator {
  if (!state.hasSnapshot) {
    return indicator('unknown', 'Spotify', 'No snapshot received yet.');
  }
  if (state.snapshotError !== null) {
    // U7 (FR-71): a refusal from Spotify already names itself ("Spotify returned an error: …"). Prefixing it with
    // "not answering" read twice and was wrong — Spotify DID answer, and said no. Found in U7 Build & Test.
    const detail = state.snapshotError.startsWith('Spotify returned an error')
      ? state.snapshotError
      : `Spotify is not answering: ${state.snapshotError}`;
    return indicator('fail', 'Spotify', detail);
  }
  return indicator('ok', 'Spotify', 'The last poll succeeded.');
}

/**
 * FC-U5-1's input. ⚠️ **Facts only — the seven states are derived HERE, never sent by the server.**
 *
 * `GET /api/automation` and the WebSocket snapshot both carry these fields and no state name. A
 * server-named state cannot be driven into that state by a test, and it would give the client a second
 * opinion to disagree with.
 */
export interface AutomationIndicatorState {
  /**
   * ⚠️ `null` means **nothing has reported yet** — never *off*. Automation being off is `false`, and
   * the two must not collapse: `false` is FR-47 working, `null` is an app that has not spoken.
   */
  readonly automationEnabled: boolean | null;
  /**
   * Is `SkipExecutor` CONSTRUCTED (`SKIP_EXECUTOR_ENABLED`). ⚠️ A different question from the switch:
   * this one needs a restart to change, so the detail has to name it rather than invite a click that
   * cannot help.
   */
  readonly executorConstructed: boolean;
  /** `null` when not halted. Present ⇒ halted, and only an explicit acknowledgement clears it. */
  readonly halt: HaltSummary | null;
  /**
   * Rules that could actually fire — **active, enabled and NOT dry-run** (BR-33.2).
   *
   * ⚠️ Zero is `disabled`, not `idle`. A rule set of ten dry-run rules looks busy in `Rules v#` and can
   * skip nothing, and the honest word for that is *off*.
   */
  readonly liveRules: number;
  /**
   * The play being evaluated, or `null` when none is. ⚠️ This is `idle`, and `idle` is a legitimate
   * resting state — the listener is between tracks, or not listening.
   */
  readonly evaluation: EvaluationProgress | null;
  /**
   * ⚠️ The MOST RECENT attempt reached the player and could not be confirmed (BR-43.3/43.5).
   *
   * Reflects the latest attempt only, so a later confirmed skip clears it. **Not sticky like
   * `recording.gaps`**, and the difference is real: a dropped play is a permanent hole in the corpus,
   * while an unconfirmed skip is a question about the device that the next skip re-asks. A latch that
   * never cleared would be red for ever after one flaky transition.
   */
  readonly lastAttemptUnconfirmed: boolean;
}

/** What `EvaluationCoordinator.inProgress` exposes, projected onto what the dot needs. */
export interface EvaluationProgress {
  readonly decided: boolean;
  /** ⚠️ The wait TIMED OUT (FQ3) — not that some field read null, which is an ordinary unknown. */
  readonly decidedOnPartialData: boolean;
  /** A loaded rule asks to hold and the play has not decided yet (BR-38.2). */
  readonly holding: boolean;
}

/** The halt, as the bar needs it. Structurally a `RunawayHalt`; narrowed so this module stays pure. */
export interface HaltSummary {
  readonly trigger: 'consecutive' | 'hourly-rate';
  readonly observedCount: number;
  readonly threshold: number;
}

/**
 * FC-U5-1 — the evaluation-state indicator.
 *
 * ## ⚠️ A SECOND dot, never a recolouring of `Rules v#`
 *
 * `rulesIndicator` already maps all four original levels to a different variable: **rules-file load
 * health**, where `fail` *names the version still in force* (FQ5). Recolouring it would make red mean
 * either *your rules file is broken* or *a rule matched and the skip failed* — two independent variables
 * on one light. A user seeing red would not know whether to open their rules file or their decision log.
 *
 * ## The precedence, and why it is this order
 *
 * 1. **`halted`** — the system stopped itself and is waiting to be acknowledged. It outranks everything,
 *    *including* `automationEnabled === false`: a halt sets the switch off, so reporting `disabled`
 *    would show the consequence and hide the cause, leaving automation apparently idle for ever.
 * 2. **`unknown`** — nothing has reported. Ahead of every judgement, because a dot that is green
 *    because no one has spoken yet is this project's central defect wearing a UI hat.
 * 3. **`failed`** — a skip was issued and not confirmed. Outranks `disabled` on purpose: if the user
 *    turns automation off *after* a failed skip, the failure is still the thing worth knowing, and it
 *    is exactly the moment someone would switch off because *"it isn't working"*.
 * 4. **`disabled`** — nothing can act. Three distinct causes, and the detail says WHICH: the machinery
 *    is not built, the switch is off, or every rule is dry-run or disabled.
 * 5. **`hold` / `passed-partial` / `passed`** — where this play got to.
 * 6. **`idle`** — armed, and nothing playing to judge.
 */
export function automationIndicator(state: AutomationIndicatorState): Indicator {
  // 1. The halt, before the switch it turned off.
  if (state.halt !== null) {
    /*
     * ⚠️ **A POINTER, NOT AN EXPLANATION**, and deliberately short (user direction, 2026-10-04).
     *
     * The counts, the trigger, the threshold in force and the attempt ids are all on the Rules pop-up,
     * beside the two buttons that can clear it — the only place any of it is actionable. Repeating them
     * here would put a paragraph on a screen meant to be glanceable, and this text reaches the
     * aria-label too, so it is read aloud in full.
     *
     * ⚠️ The halt is NOT under-reported: the dot has its own label, glyph, colour, badge and pulse.
     * What is withheld is only the prose.
     *
     * ⚠️ It still says what to do and where, because a dot that only says `HALTED` leaves the reader
     * with nowhere to go. One sentence is the budget.
     */
    return indicator(
      'halted',
      'Automation HALTED',
      'Automation stopped itself. Open the Rules panel to review it and clear the halt.',
    );
  }

  // 2. Nothing has reported. ⚠️ Never `idle` — that would assert the pipeline is up and quiet.
  if (state.automationEnabled === null) {
    return indicator('unknown', 'Automation', 'No automation status has been reported yet.');
  }

  // 3. A skip that went out and was never confirmed.
  if (state.lastAttemptUnconfirmed) {
    return indicator(
      'fail',
      'Skip unconfirmed',
      'A skip was sent to Spotify and the track did not change. It may or may not have landed — ' +
        'it is NOT retried, because re-sending it later would skip whatever is playing then. ' +
        'See the decision log.',
    );
  }

  // 4. Nothing can act, and the detail names which of the three reasons applies.
  if (!state.executorConstructed) {
    return indicator(
      'disabled',
      'Automation off',
      'The skip machinery is not built in this deployment (SKIP_EXECUTOR_ENABLED is not set), ' +
        'so no skip can be issued. This needs a restart to change, not the switch on the Rules panel.',
    );
  }
  if (!state.automationEnabled) {
    return indicator(
      'disabled',
      'Automation off',
      'Rules are being evaluated and logged, and no skip will be issued. ' +
        'Turn it on from the Rules panel.',
    );
  }
  if (state.liveRules === 0) {
    return indicator(
      'disabled',
      'Automation off',
      'Automation is on, but no rule can act — every loaded rule is dry-run or disabled. ' +
        'Nothing will be skipped.',
    );
  }

  // 5/6. Where this play got to.
  const play = state.evaluation;
  if (play === null) {
    return indicator(
      'idle',
      'Automation',
      `Armed with ${state.liveRules} live rule(s). Nothing is playing to evaluate.`,
    );
  }

  if (play.holding) {
    return indicator(
      'hold',
      'Rule holding',
      'A rule is waiting for a fact that has not arrived yet. It will decide on what it has if ' +
        'the wait runs out, rather than hold for the rest of the track.',
    );
  }

  if (!play.decided) {
    return indicator(
      'hold',
      'Evaluating',
      'Waiting for enrichment to settle before deciding.',
    );
  }

  if (play.decidedOnPartialData) {
    return indicator(
      'passed-partial',
      'Decided (partial)',
      '⚠️ Decided before all the facts arrived, so a rule that needed one of them did not get it. ' +
        'The decision log records which fields were missing.',
    );
  }

  return indicator('ok', 'Decided', 'Decided on complete facts.');
}

export interface StatusBarState {
  readonly recording: RecordingState;
  readonly rules: RulesState;
  readonly connection: ConnectionState;
  readonly spotify: SpotifyState;
  /** `null` when U5 is not present at all, so the dot is simply absent rather than unknown. */
  readonly automation: AutomationIndicatorState | null;
}

export interface StatusBar {
  readonly indicators: readonly Indicator[];
  /**
   * The single message shown in the error field, or `null`.
   *
   * ⚠️ One message, not a list: a bar that shows three problems at once is read as broken
   * rather than as informative, and the most serious one is what needs acting on.
   */
  readonly message: string | null;
}

export function statusBar(state: StatusBarState): StatusBar {
  const indicators = [
    recordingIndicator(state.recording),
    rulesIndicator(state.rules),
    connectionIndicator(state.connection),
    spotifyIndicator(state.spotify),
    // ⚠️ LAST, and omitted entirely when U5 is absent. The order is read left to right as a
    // priority order, and automation is the only one of the five that cannot lose data.
    ...(state.automation === null ? [] : [automationIndicator(state.automation)]),
  ];

  /*
   * ⚠️ Recording first, always. It is the only subsystem whose failure loses something that cannot be
   * recreated; the others lose a view of data that is still being collected.
   *
   * ⚠️ **`halted` DELIBERATELY DOES NOT TAKE THE MESSAGE SLOT** — changed 2026-10-04 at the user's
   * direction, after the first live halt put a paragraph of prose on the primary screen.
   *
   * It was in here on the reasoning that a halt is the one thing the user must act on. That reasoning
   * holds and the conclusion did not: the DOT already says `Automation HALTED`, with its own glyph,
   * colour, badge and pulse. What belongs beside the two buttons that can clear it is the explanation,
   * and that is the Rules pop-up.
   *
   * ⚠️ **The primary screen is a display, not a console.** It stays visible for hours, and a halt
   * stands until someone acknowledges it — so a halt here would park a paragraph indefinitely, which is
   * both noise and a hiding place for the next real fault.
   */
  const worst = indicators.find((i) => i.level === 'fail') ?? null;

  return {
    indicators,
    message: worst === null ? null : worst.detail,
  };
}
