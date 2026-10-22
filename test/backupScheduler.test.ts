/**
 * LC-74 — the backup scheduler (U10, BR-81.1, P-83): scheduled from the newest on disk, so restarts can neither
 * postpone a backup (the 2026-10-03 defect) nor multiply it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BackupScheduler, type BackupSchedulerDeps } from '../src/backup/BackupScheduler.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A fake disk: the scheduler sees only `newestAtMs`, as it does in production. */
function world() {
  const w = { now: 0, newest: null as number | null, kept: 0, next: { ok: true } as Awaited<ReturnType<BackupSchedulerDeps['keep']>> };
  return w;
}

function scheduler(w: ReturnType<typeof world>, startedAtMs = w.now, enabled = true): BackupScheduler {
  return new BackupScheduler({
    enabled,
    intervalMs: DAY,
    newestAtMs: () => w.newest,
    keep: async () => {
      if (w.next.ok) {
        w.newest = w.now;
        w.kept += 1;
      }
      return w.next;
    },
    now: () => w.now,
    startedAtMs,
  });
}

describe('BackupScheduler', () => {
  it('⭐ takes one at startup when none exists (the old scheduler never ran at startup)', async () => {
    const w = world();
    assert.equal(await scheduler(w).check(), true);
    assert.equal(w.kept, 1);
  });

  it('a restart loop within one interval keeps exactly one', async () => {
    const w = world();
    for (let i = 0; i < 30; i++) {
      w.now += HOUR / 2;
      await scheduler(w).check(); // a fresh process each time
    }
    assert.equal(w.kept, 1);
  });

  it('⚠️ restarts more often than the interval can no longer postpone a backup forever', async () => {
    const w = world();
    await scheduler(w).check();
    for (let i = 0; i < 10 * 24; i++) {
      w.now += HOUR; // restart every hour for ten days
      await scheduler(w, w.now).check();
    }
    assert.equal(w.kept, 11, 'one at the start, then one per day');
  });

  it('busy (409) is not a failure; a failed backup is reported; short space is reported as such', async () => {
    const w = world();
    const s = scheduler(w);
    w.next = { ok: false, status: 409, reason: 'busy' };
    assert.equal(await s.check(), false);
    assert.equal(s.status.lastError, null);

    w.next = { ok: false, reason: 'disk I/O error' };
    await s.check();
    assert.equal(s.status.lastError, 'disk I/O error');
    assert.equal(s.health().level, 'fail');

    w.next = { ok: false, reason: 'not enough disk space', spaceShort: { freeBytes: 1, neededBytes: 2 } };
    await s.check();
    assert.equal(s.status.lastError, null);
    assert.deepEqual(s.status.spaceShort, { freeBytes: 1, neededBytes: 2 });
    assert.match(s.health().detail, /Not enough disk space/);

    w.next = { ok: true } as never;
    await s.check();
    assert.equal(s.health().level, 'ok');
  });

  it('disabled: never keeps, health is off', async () => {
    const w = world();
    const s = scheduler(w, 0, false);
    assert.equal(await s.check(), false);
    assert.equal(w.kept, 0);
    assert.equal(s.health().level, 'off');
  });
});
