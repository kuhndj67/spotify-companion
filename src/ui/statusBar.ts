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

export type IndicatorLevel = 'ok' | 'warn' | 'fail' | 'unknown';

export interface Indicator {
  readonly level: IndicatorLevel;
  /** Short text beside the dot. ⚠️ Colour is never the only channel. */
  readonly label: string;
  /** A distinct glyph per level, for the same reason. */
  readonly glyph: string;
  /** Shown on click. Includes the age of the answer where there is one. */
  readonly detail: string;
}

const GLYPHS: Record<IndicatorLevel, string> = {
  ok: '●',
  warn: '◐',
  fail: '✕',
  unknown: '○',
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
    return indicator('fail', 'Spotify', `Spotify is not answering: ${state.snapshotError}`);
  }
  return indicator('ok', 'Spotify', 'The last poll succeeded.');
}

export interface StatusBarState {
  readonly recording: RecordingState;
  readonly rules: RulesState;
  readonly connection: ConnectionState;
  readonly spotify: SpotifyState;
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
  ];

  // ⚠️ Recording first, always. It is the only subsystem whose failure loses something that
  // cannot be recreated; the others lose a view of data that is still being collected.
  const worst = indicators.find((i) => i.level === 'fail') ?? null;

  return {
    indicators,
    message: worst === null ? null : worst.detail,
  };
}
