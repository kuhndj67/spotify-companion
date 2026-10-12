/**
 * The Maintenance block of `/api/diagnostics` (IN-U6-6, P-46).
 *
 * ⚠️ EXTRACTED and PURE for the same reason as U5's `automationDiagnosticSteps`: `diagnostics.ts` is reached
 * only from `server.ts` and is not exercised by any test, so anything decided inline there would be decided
 * where nothing can check it. This takes the plain `MaintenanceStatus` and returns steps.
 *
 * ⚠️ Nothing that is merely ABSENT is a fault: no restore yet, no previous database, no leftovers are all
 * `skip` or `ok`. A red cross for "you have never restored" would train the reader to ignore red crosses.
 */

import type { DiagnosticStep } from '../diagnostics.js';
import type { MaintenanceStatus } from './MaintenanceService.js';

/** P-46: past this share of a cap, say so before it binds. */
export const HEADROOM_WARN_RATIO = 0.8;

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const s = (name: string, status: DiagnosticStep['status'], detail: string): DiagnosticStep => ({ name, status, detail, durationMs: 0 });

export function maintenanceDiagnosticSteps(m: MaintenanceStatus): DiagnosticStep[] {
  const steps: DiagnosticStep[] = [];

  steps.push(
    m.backup.available
      ? s('Backup available (node:sqlite backup())', 'ok', 'Create backup works without stopping the app')
      : s('Backup available (node:sqlite backup())', 'fail', m.backup.reason),
  );

  const { databaseBytes, expandedCapBytes } = m.sizes;
  if (databaseBytes === null) {
    steps.push(s('Backup size headroom', 'skip', 'no database to measure'));
  } else {
    const ratio = databaseBytes / expandedCapBytes;
    const detail = `${mb(databaseBytes)} of the ${mb(expandedCapBytes)} restore limit (${Math.round(ratio * 100)}%)`;
    steps.push(
      ratio >= HEADROOM_WARN_RATIO
        ? s('Backup size headroom', 'fail', `${detail} — a backup will soon be too large to restore; raise the cap in a release`)
        : s('Backup size headroom', 'ok', detail),
    );
  }

  const last = m.lastRestore;
  if (last === null) steps.push(s('Last restore', 'skip', 'no restore has been applied since this start'));
  else if (last.kind === 'applied')
    steps.push(
      s(
        'Last restore',
        'ok',
        last.reason === 'undo'
          ? `undo applied at startup — ${last.plays ?? 'unknown'} plays, set aside ${last.takenAt ?? 'at an unknown time'}`
          : `applied at startup — ${last.plays ?? 'unknown'} plays, backup taken ${last.takenAt ?? 'at an unknown time'}`,
      ),
    );
  else if (last.kind === 'failed') steps.push(s('Last restore', 'fail', `${last.reason}`));

  steps.push(
    m.previous === null
      ? s('Previous history (undo)', 'skip', 'none kept')
      : s('Previous history (undo)', 'ok', `kept from ${m.previous.movedAt} — ${m.previous.plays ?? 'unknown'} plays (${m.previous.reason})`),
  );

  steps.push(
    m.sweptAtStartup === 0
      ? s('Leftover working files at startup', 'ok', 'none')
      : s('Leftover working files at startup', 'ok', `${m.sweptAtStartup} removed — an operation was interrupted before this start`),
  );

  return steps;
}
