/**
 * The Maintenance block of `/api/diagnostics` (IN-U6-6, P-46) — pure, so it can be tested even though
 * `diagnostics.ts` itself is not.
 *
 * ⭐ The judgement worth pinning: ABSENCE is never a fault. No restore yet, no previous history and no
 * leftovers are `skip`/`ok`. Only a missing capability, a failed restore and a cap about to bind are red.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MaintenanceStatus } from '../src/maintenance/MaintenanceService.js';
import { HEADROOM_WARN_RATIO, maintenanceDiagnosticSteps } from '../src/maintenance/maintenanceDiagnostics.js';

const CAP = 256 * 1024 * 1024;
const base: MaintenanceStatus = {
  busy: null,
  backup: { available: true },
  lastRestore: null,
  previous: null,
  sweptAtStartup: 0,
  sizes: { databaseBytes: 4_542_464, uploadCapBytes: 64 * 1024 * 1024, expandedCapBytes: CAP },
  supervised: true,
  startedAt: '2026-10-07T12:00:00.000Z',
};
const byName = (m: MaintenanceStatus, name: string) => maintenanceDiagnosticSteps(m).find((x) => x.name === name)!;

describe('maintenanceDiagnosticSteps', () => {
  it('⭐ a fresh install with nothing ever restored has NO failures', () => {
    assert.equal(maintenanceDiagnosticSteps(base).filter((s) => s.status === 'fail').length, 0);
  });

  it('a missing backup() capability is a failure that says why (IN-U6-1)', () => {
    const step = byName({ ...base, backup: { available: false, reason: 'Node too old' } }, 'Backup available (node:sqlite backup())');
    assert.equal(step.status, 'fail');
    assert.match(step.detail, /Node too old/);
  });

  it('P-46: headroom turns red at the warning ratio, not at the cap', () => {
    const at = (bytes: number) => byName({ ...base, sizes: { ...base.sizes, databaseBytes: bytes } }, 'Backup size headroom').status;
    assert.equal(at(Math.floor(CAP * HEADROOM_WARN_RATIO) - 1), 'ok');
    assert.equal(at(Math.ceil(CAP * HEADROOM_WARN_RATIO)), 'fail');
    assert.match(byName(base, 'Backup size headroom').detail, /4\.3 MB of the 256\.0 MB restore limit \(2%\)/);
  });

  it('a failed restore is red and carries its reason; an applied one is green', () => {
    assert.equal(byName({ ...base, lastRestore: { kind: 'failed', reason: 'did not verify' } }, 'Last restore').status, 'fail');
    const ok = byName({ ...base, lastRestore: { kind: 'applied', plays: 951, takenAt: '2026-10-02T21:14:00Z' } }, 'Last restore');
    assert.equal(ok.status, 'ok');
    assert.match(ok.detail, /951 plays/);
  });

  it('leftovers at startup are reported, not failed — an interrupted operation is worth SEEING', () => {
    const step = byName({ ...base, sweptAtStartup: 2 }, 'Leftover working files at startup');
    assert.equal(step.status, 'ok');
    assert.match(step.detail, /2 removed — an operation was interrupted/);
  });
});
