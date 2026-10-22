/**
 * PBT-80…PBT-84 — the kept-backup decisions (U10, LC-72). Each has a positive control: a rule that refused (or
 * deleted, or warned) everything could not pass.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import {
  SPACE_MARGIN_BYTES,
  backupDue,
  backupHealth,
  enoughSpace,
  parseKeptName,
  rotationDeletes,
  scheduledDue,
  sortKept,
  stampToMs,
} from '../src/backup/keptBackupDecision.js';

const version = fc.constantFrom('1.0.0-beta.8', '1.0.0-beta.9', '1.0.0', 'unknown');
const HOUR = 3_600_000;

describe('PBT-80 — backupDue', () => {
  it('due iff a migration is pending, or the last version is absent or differs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.array(fc.integer({ min: 1, max: 30 }), { maxLength: 3 }),
        fc.option(version, { nil: null }),
        version,
        (schemaVersion, pending, last, running) => {
          const d = backupDue({ schemaVersion, pendingMigrations: pending, lastAppVersion: last, runningVersion: running });
          assert.equal(d.due, schemaVersion > 0 && (pending.length > 0 || last === null || last !== running));
          if (d.due) assert.ok(d.reason.length > 0);
        },
      ),
    );
  });

  it('⭐ positive control: same version, nothing pending → never due', () => {
    fc.assert(
      fc.property(version, fc.integer({ min: 0, max: 20 }), (v, s) =>
        assert.deepEqual(backupDue({ schemaVersion: s, pendingMigrations: [], lastAppVersion: v, runningVersion: v }), { due: false }),
      ),
    );
  });

  it('⚠️ a brand-new empty database (schema 0) is never due: nothing to protect, and its backup would not verify', () => {
    assert.deepEqual(backupDue({ schemaVersion: 0, pendingMigrations: [1, 2, 3, 4, 5, 6, 7, 8], lastAppVersion: null, runningVersion: '1.0.0-beta.9' }), { due: false });
  });

  it('names the migration and the version change in words', () => {
    const d = backupDue({ schemaVersion: 7, pendingMigrations: [8], lastAppVersion: '1.0.0-beta.8', runningVersion: '1.0.0-beta.9' });
    assert.deepEqual(d, { due: true, reason: 'migration 7→8 · version 1.0.0-beta.8→1.0.0-beta.9' });
  });
});

describe('PBT-81 — scheduledDue', () => {
  it('due iff none exists or the newest is at least one interval old', () => {
    fc.assert(
      fc.property(fc.option(fc.integer({ min: 0, max: 1e12 }), { nil: null }), fc.integer({ min: 0, max: 1e12 }), fc.integer({ min: 1, max: 1e9 }), (newest, now, interval) => {
        assert.equal(scheduledDue(newest, now, interval), newest === null || now - newest >= interval);
      }),
    );
  });

  it('a restart loop within one interval takes at most one backup', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 24 * HOUR - 1 }), { minLength: 1, maxLength: 50 }), (restartOffsets) => {
        const interval = 24 * HOUR;
        let newest: number | null = null;
        let taken = 0;
        for (const t of [...restartOffsets].sort((a, b) => a - b)) {
          if (scheduledDue(newest, t, interval)) {
            newest = t;
            taken += 1;
          }
        }
        assert.equal(taken, 1);
      }),
    );
  });
});

describe('PBT-82 — rotationDeletes', () => {
  const stamp = fc
    .date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-01-01T00:00:00Z'), noInvalidDate: true })
    .map((d) => `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')}Z`);
  const kept = fc.tuple(stamp, fc.integer({ min: 1, max: 3 })).map(([s, n]) => `spotify-backup-${s}${n === 1 ? '' : `-${n}`}.tar.gz`);
  const other = fc.constantFrom('history-snapshot-2026-10-03T01-11-20-888.csv', 'notes.txt', 'spotify-backup-x.tar.gz', 'manifest.json');

  it('deletes only kept-pattern names, never the newest `keep`, and leaves min(keep, n) of them', () => {
    fc.assert(
      fc.property(fc.uniqueArray(kept, { maxLength: 30 }), fc.array(other, { maxLength: 5 }), fc.integer({ min: 1, max: 20 }), (names, others, keep) => {
        const all = [...names, ...others];
        const del = rotationDeletes(all, keep);
        for (const d of del) assert.ok(parseKeptName(d), `${d} is not a kept backup`);
        const newest = sortKept(names).slice(-keep).map((k) => k.name);
        for (const n of newest) assert.ok(!del.includes(n), `${n} is among the newest ${keep}`);
        assert.equal(names.length - del.length, Math.min(keep, names.length));
      }),
    );
  });

  it('⭐ positive control: over the limit, something IS deleted (the oldest)', () => {
    const names = ['spotify-backup-20261001T000000Z.tar.gz', 'spotify-backup-20261002T000000Z.tar.gz', 'spotify-backup-20261002T000000Z-2.tar.gz'];
    assert.deepEqual(rotationDeletes(names, 2), ['spotify-backup-20261001T000000Z.tar.gz']);
    assert.deepEqual(rotationDeletes(names, 1), ['spotify-backup-20261001T000000Z.tar.gz', 'spotify-backup-20261002T000000Z.tar.gz']);
  });

  it('stamps parse back to their instant', () => {
    assert.equal(stampToMs('20261022T031500Z'), Date.UTC(2026, 9, 22, 3, 15, 0));
  });
});

describe('PBT-83 — enoughSpace', () => {
  it('true iff free ≥ 2 × (db + wal) + 100 MB, and monotone in free space', () => {
    fc.assert(
      fc.property(fc.nat(2 ** 40), fc.nat(2 ** 32), fc.nat(2 ** 32), fc.nat(2 ** 32), (free, db, wal, more) => {
        const ok = enoughSpace(free, db, wal);
        assert.equal(ok, free >= 2 * (db + wal) + SPACE_MARGIN_BYTES);
        if (ok) assert.ok(enoughSpace(free + more, db, wal));
      }),
    );
  });
});

describe('PBT-84 — backupHealth', () => {
  const facts = fc.record({
    scheduledEnabled: fc.constant(true),
    newestScheduledAtMs: fc.option(fc.integer({ min: 0, max: 1e12 }), { nil: null }),
    nowMs: fc.integer({ min: 0, max: 2e12 }),
    // Biased around the interval: "none yet, within the first interval" must be generated often, not by luck.
    uptimeMs: fc.integer({ min: 0, max: 96 * HOUR }),
    intervalMs: fc.integer({ min: HOUR, max: 48 * HOUR }),
    lastError: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: null }),
    spaceShort: fc.option(fc.record({ freeBytes: fc.nat(), neededBytes: fc.nat() }), { nil: null }),
  });

  it('⚠️ never ok when no scheduled backup exists', () => {
    fc.assert(fc.property(facts, (f) => assert.notEqual(backupHealth({ ...f, newestScheduledAtMs: null }).level, 'ok')));
  });

  it('⚠️ none written and nothing failed: warn within the first interval, fail after it — never ok', () => {
    fc.assert(
      fc.property(facts, (f) => {
        const level = backupHealth({ ...f, newestScheduledAtMs: null, lastError: null, spaceShort: null }).level;
        assert.equal(level, f.uptimeMs >= f.intervalMs ? 'fail' : 'warn');
      }),
    );
  });

  it('fail whenever the last attempt failed or space was short', () => {
    fc.assert(
      fc.property(facts, (f) => {
        if (f.lastError || f.spaceShort) assert.equal(backupHealth(f).level, 'fail');
      }),
    );
  });

  it('ok iff the newest is within two intervals and nothing failed', () => {
    fc.assert(
      fc.property(facts, (f) => {
        const level = backupHealth(f).level;
        const fresh = f.newestScheduledAtMs !== null && f.nowMs - f.newestScheduledAtMs <= 2 * f.intervalMs;
        assert.equal(level === 'ok', fresh && !f.lastError && !f.spaceShort);
      }),
    );
  });

  it('⭐ positive control: a fresh backup with no error is ok; scheduled off is off, not a fault', () => {
    const base = { scheduledEnabled: true, newestScheduledAtMs: 0, nowMs: HOUR, uptimeMs: HOUR, intervalMs: 24 * HOUR, lastError: null, spaceShort: null };
    assert.equal(backupHealth(base).level, 'ok');
    assert.equal(backupHealth({ ...base, scheduledEnabled: false }).level, 'off');
  });
});
