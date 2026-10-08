/**
 * LC-39 — the Settings pop-up's Backup & restore section, derived on the server (FR-63, BR-51.4, P-47).
 *
 * ## ⭐ The judgements worth pinning
 *
 *   1. **A disabled button always says why.** A greyed-out *Create backup* with no reason reads as broken.
 *   2. **The destructive warning says REPLACES, not merges, and names the undo** (BR-48.2).
 *   3. **Under `npm start` the restart text tells the user to restart** — waiting for a restart nothing will
 *      perform is the 2026-09-05 *reconnecting for ever* shape.
 *   4. Times are absolute UTC, never the host's zone.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Comparison, MaintenanceStatus } from '../src/maintenance/MaintenanceService.js';
import { RESTART_TIMEOUT_MS, comparisonView, statusView } from '../src/ui/maintenancePanel.js';

const base: MaintenanceStatus = {
  busy: null,
  backup: { available: true },
  lastRestore: null,
  previous: null,
  sweptAtStartup: 0,
  sizes: { databaseBytes: 1, uploadCapBytes: 2, expandedCapBytes: 3 },
  supervised: true,
  startedAt: '2026-10-07T12:00:00.000Z',
};

describe('statusView', () => {
  it('idle: both actions offered, no undo, notes say what each touches', () => {
    const v = statusView(base);
    assert.equal(v.backup.disabled, false);
    assert.equal(v.restore.disabled, false);
    assert.equal(v.undo, null);
    assert.match(v.backupNote, /never included/);
    assert.match(v.restoreNote, /does not merge/);
  });

  it('⭐ a disabled button ALWAYS carries a reason', () => {
    for (const busy of ['backup', 'restore-verify', 'restore-stage', 'restarting'] as const) {
      const v = statusView({ ...base, busy, previous: { movedAt: '2026-10-07T18:22:00Z', plays: 951, reason: 'restore' } });
      for (const b of [v.backup, v.restore, v.undo!]) {
        assert.equal(b.disabled, true);
        assert.ok(b.reason && b.reason.length > 0, `${busy}: ${b.label} has no reason`);
      }
    }
    const noCapability = statusView({ ...base, backup: { available: false, reason: 'Node too old' } });
    assert.equal(noCapability.backup.disabled, true);
    assert.equal(noCapability.backup.reason, 'Node too old');
  });

  it('offers undo only when a previous history exists, and describes it', () => {
    const v = statusView({ ...base, previous: { movedAt: '2026-10-07T18:22:00Z', plays: 951, reason: 'restore' } });
    assert.equal(v.undo?.label, 'Undo last restore…');
    assert.equal(v.undo?.detail, 'Previous history: 2026-10-07 18:22 UTC · 951 plays');
  });

  it('reports the restore applied at this start — and a failed one says the history is unchanged', () => {
    const ok = statusView({ ...base, lastRestore: { kind: 'applied', plays: 951, takenAt: '2026-10-02T21:14:00Z' } });
    assert.equal(ok.lastRestore?.tone, 'ok');
    assert.match(ok.lastRestore!.text, /Restored 951 plays from a backup taken 2026-10-02 21:14 UTC/);
    const bad = statusView({ ...base, lastRestore: { kind: 'failed', reason: 'did not verify' } });
    assert.equal(bad.lastRestore?.tone, 'fail');
    assert.match(bad.lastRestore!.text, /unchanged/);
  });

  it('⭐ P-47: supervised waits with a 60 s "not back" message; unsupervised tells the user to restart', () => {
    const docker = statusView(base).restart;
    assert.equal(docker.automatic, true);
    assert.equal(docker.timeoutMs, RESTART_TIMEOUT_MS);
    assert.match(docker.notBack, /has not come back/);
    const host = statusView({ ...base, supervised: false }).restart;
    assert.equal(host.automatic, false);
    assert.match(host.restarting, /Restart the app/);
  });
});

describe('comparisonView (BR-47.6, BR-48.2)', () => {
  const c: Comparison = {
    backup: { takenAt: '2026-10-02T21:14:00Z', plays: 951, decisions: 1120, schemaVersion: 7 },
    current: { takenAt: null, plays: 977, decisions: 1214, schemaVersion: 7 },
    rules: 'differs',
    rulesComparison: null,
    rulesInvalid: null,
  };

  it('shows the backup beside the current history, row by row', () => {
    const v = comparisonView(c, 'RESTORE');
    assert.deepEqual(v.rows[1], { label: 'Plays', backup: '951', current: '977' });
    assert.deepEqual(v.rows[3], { label: 'Schema', backup: 'v7', current: 'v7' });
    assert.equal(v.rows[0]!.backup, '2026-10-02 21:14 UTC');
  });

  it('⭐ the warning says REPLACES and names the one undo; rules that differ are reported, not applied', () => {
    const v = comparisonView(c, 'RESTORE');
    assert.match(v.warning[0]!, /REPLACES.*does not merge/);
    assert.match(v.warning[1]!, /undo this once/);
    assert.match(v.rulesNote, /not applied/);
    assert.equal(v.confirmWord, 'RESTORE');
  });

  it('unknown is shown as "unknown", never 0', () => {
    const v = comparisonView({ ...c, backup: { ...c.backup, plays: null } }, 'RESTORE');
    assert.equal(v.rows[1]!.backup, 'unknown');
  });
});
