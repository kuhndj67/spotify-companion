/**
 * LC-39 — what the Settings pop-up's *Backup & restore* section SAYS (FR-63, `frontend-components.md` §2).
 *
 * ⚠️ PURE, and derived on the SERVER, for U5's reason: `public/app.js` has no tests and cannot import from
 * `src/`. If the button states and the destructive-confirmation text were decided in app.js, the one surface
 * that can replace the corpus would be decided in the one file nothing can test. The routes attach these views;
 * app.js renders them.
 *
 * Colour is never the only channel (BR-51.4): every state carries words.
 */

import type { Comparison, MaintenanceStatus } from '../maintenance/MaintenanceService.js';

export interface ButtonView {
  label: string;
  disabled: boolean;
  /** Shown beside a disabled button — never a bare greyed-out control. */
  reason: string | null;
}

export interface StatusView {
  backup: ButtonView;
  restore: ButtonView;
  /** `null` when there is no previous history to go back to. */
  undo: (ButtonView & { detail: string }) | null;
  /** What each action touches, stated beside it (BR-51.4). */
  backupNote: string;
  restoreNote: string;
  /** The outcome of the restore applied at this start, if any — shown once after the restart. */
  lastRestore: { tone: 'ok' | 'fail'; text: string } | null;
  restart: RestartView;
}

export interface RestartView {
  /** Shown while the app restarts to apply a restore. */
  restarting: string;
  /** Shown if the app has not come back within `timeoutMs` (P-47) — instead of spinning for ever. */
  notBack: string;
  timeoutMs: number;
  /** `false` under `npm start`: nothing restarts the app, so the user must. */
  automatic: boolean;
}

/** P-47 — how long the UI waits for the app to come back before saying it has not. */
export const RESTART_TIMEOUT_MS = 60_000;

const busyText: Record<Exclude<MaintenanceStatus['busy'], null>, string> = {
  backup: 'A backup is being made.',
  'restore-verify': 'A backup file is being checked.',
  'restore-stage': 'A restore is being prepared.',
  restarting: 'The app is restarting to finish a restore.',
};

export function restartView(supervised: boolean): RestartView {
  return supervised
    ? {
        restarting: 'Restarting to finish the restore — recording pauses for a few seconds…',
        notBack: 'The app has not come back. Check that its container is running.',
        timeoutMs: RESTART_TIMEOUT_MS,
        automatic: true,
      }
    : {
        restarting: 'Restart the app to finish the restore. Nothing changes until it restarts.',
        notBack: 'Restart the app to finish the restore. Nothing changes until it restarts.',
        timeoutMs: RESTART_TIMEOUT_MS,
        automatic: false,
      };
}

export function statusView(s: MaintenanceStatus): StatusView {
  const busy = s.busy === null ? null : busyText[s.busy];
  const backup: ButtonView = !s.backup.available
    ? { label: 'Create backup', disabled: true, reason: s.backup.reason }
    : { label: s.busy === 'backup' ? 'Creating backup…' : 'Create backup', disabled: busy !== null, reason: busy };
  const restore: ButtonView = { label: 'Restore backup…', disabled: busy !== null, reason: busy };

  const undo =
    s.previous === null
      ? null
      : {
          label: 'Undo last restore…',
          disabled: busy !== null,
          reason: busy,
          detail: `Previous history: ${formatWhen(s.previous.movedAt)} · ${s.previous.plays ?? 'unknown number of'} plays`,
        };

  let lastRestore: StatusView['lastRestore'] = null;
  if (s.lastRestore?.kind === 'applied') {
    lastRestore = {
      tone: 'ok',
      text:
        `Restored ${s.lastRestore.plays ?? 'an unknown number of'} plays from a backup taken ${formatWhen(s.lastRestore.takenAt)}. ` +
        'Plays since that backup are re-imported from Spotify (as not-observed) when the app can reach it.',
    };
  } else if (s.lastRestore?.kind === 'failed') {
    lastRestore = { tone: 'fail', text: `Restore failed: ${s.lastRestore.reason}. Your history is unchanged.` };
  }

  return {
    backup,
    restore,
    undo,
    backupNote: 'Downloads your listening history and rules. Credentials and the automation switch are never included.',
    restoreNote: 'Replaces your current history with one from a backup file. It does not merge.',
    lastRestore,
    restart: restartView(s.supervised),
  };
}

export interface ComparisonView {
  rows: { label: string; backup: string; current: string }[];
  rulesNote: string;
  /** The destructive warning, in full (BR-48.2). */
  warning: string[];
  confirmWord: string;
}

export function comparisonView(c: Comparison, confirmWord: string, kind: 'restore' | 'undo' = 'restore'): ComparisonView {
  const n = (v: number | null) => (v === null ? 'unknown' : v.toLocaleString('en-US'));
  const v = (x: number | null) => (x === null ? 'unknown' : `v${x}`);
  const rulesNote =
    c.rules === 'none'
      ? 'This backup includes no rules.'
      : c.rules === 'identical'
        ? 'This backup’s rules are identical to yours.'
        : 'This backup’s rules differ from yours — they are not applied (rules cannot be restored yet).';
  return {
    rows: [
      { label: kind === 'undo' ? 'Set aside' : 'Taken', backup: formatWhen(c.backup.takenAt), current: '—' },
      { label: 'Plays', backup: n(c.backup.plays), current: n(c.current.plays) },
      { label: 'Decisions', backup: n(c.backup.decisions), current: n(c.current.decisions) },
      { label: 'Schema', backup: v(c.backup.schemaVersion), current: v(c.current.schemaVersion) },
    ],
    rulesNote,
    warning: [
      `${kind === 'undo' ? 'Undoing' : 'Restoring'} REPLACES your current history. It does not merge.`,
      'Your current history is kept as the previous history, so you can undo this once.',
      'The app will restart; recording pauses for a few seconds.',
    ],
    confirmWord,
  };
}

/** `2026-10-02 21:14 UTC` — an absolute UTC time, never a host-zone one (the timeBuckets lesson). */
function formatWhen(iso: string | null): string {
  if (iso === null) return 'at an unknown time';
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}
