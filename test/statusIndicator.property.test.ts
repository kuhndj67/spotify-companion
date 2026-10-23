/**
 * PBT-85 (Status light) and PBT-90 (backup reminder) — U10, LC-75, LC-81.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { CHECK_DIAGNOSTICS, statusIndicator, type StatusSource } from '../src/ui/statusBar.js';
import { BackupReminder, REMINDER_DAYS, reminderLevel } from '../src/backup/backupReminder.js';

const DAY = 86_400_000;
const source: fc.Arbitrary<StatusSource> = fc.record({
  level: fc.constantFrom('ok', 'warn', 'fail'),
  sentence: fc.string({ minLength: 1, maxLength: 20 }),
});
const rank = { ok: 0, warn: 1, fail: 2 } as const;

describe('PBT-85 — statusIndicator', () => {
  it('the level is the worst of its sources; a non-ok detail names each problem and ends with the pointer', () => {
    fc.assert(
      fc.property(fc.array(source, { maxLength: 6 }), (sources) => {
        const ind = statusIndicator(sources);
        const worst = sources.reduce<StatusSource['level']>((w, s) => (rank[s.level] > rank[w] ? s.level : w), 'ok');
        assert.equal(ind.level, worst);
        assert.equal(ind.label, 'Status');
        if (worst !== 'ok') {
          assert.ok(ind.detail.endsWith(CHECK_DIAGNOSTICS));
          for (const s of sources.filter((x) => x.level !== 'ok')) assert.ok(ind.detail.includes(s.sentence));
        }
      }),
    );
  });

  it('⭐ positive control: all ok (or none) is ok, with a distinct glyph from warn and fail', () => {
    assert.equal(statusIndicator([]).level, 'ok');
    assert.equal(statusIndicator([{ level: 'ok', sentence: 'fine' }]).detail, 'All checks OK.');
    const glyphs = new Set(['ok', 'warn', 'fail'].map((l) => statusIndicator([{ level: l as StatusSource['level'], sentence: 'x' }]).glyph));
    assert.equal(glyphs.size, 3, 'colour is never the only channel');
  });
});

describe('PBT-90 — reminderLevel', () => {
  const iso = fc.integer({ min: Date.parse('2026-01-01'), max: Date.parse('2027-01-01') }).map((t) => new Date(t).toISOString());

  it('never fail; off → off; on → warn iff more than 7 days since the later of the last download and the first run', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.option(iso, { nil: null }), iso, fc.integer({ min: 0, max: 40 * DAY }), (enabled, last, first, after) => {
        const since = Math.max(last === null ? -Infinity : Date.parse(last), Date.parse(first));
        const now = since + after;
        const v = reminderLevel({ enabled, lastDownloadAt: last, firstRunAt: first }, now);
        assert.notEqual(v.level as string, 'fail');
        if (!enabled) assert.equal(v.level, 'off');
        else assert.equal(v.level, after > REMINDER_DAYS * DAY ? 'warn' : 'ok');
      }),
    );
  });

  it('⭐ positive control: a download resets an overdue reminder to ok', () => {
    const first = '2026-10-01T00:00:00.000Z';
    const now = Date.parse('2026-10-20T00:00:00Z');
    assert.equal(reminderLevel({ enabled: true, lastDownloadAt: null, firstRunAt: first }, now).level, 'warn');
    assert.equal(reminderLevel({ enabled: true, lastDownloadAt: '2026-10-19T00:00:00.000Z', firstRunAt: first }, now).level, 'ok');
  });
});

describe('BackupReminder (state/backup-reminder.json)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const fresh = () => {
    const d = mkdtempSync(join(tmpdir(), 'u10-reminder-'));
    dirs.push(d);
    return join(d, 'backup-reminder.json');
  };

  it('a fresh install writes its first-run date once and is ok for a week', () => {
    const path = fresh();
    const clock = { t: Date.parse('2026-10-22T00:00:00Z') };
    const r = new BackupReminder(path, () => new Date(clock.t));
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).firstRunAt, '2026-10-22T00:00:00.000Z');
    clock.t += 6 * DAY;
    assert.equal(new BackupReminder(path, () => new Date(clock.t)).verdict().level, 'ok', 'reopening keeps the first-run date');
    clock.t += 2 * DAY;
    assert.equal(r.verdict().level, 'warn');
    r.recordDownload();
    assert.equal(r.verdict().level, 'ok');
    r.setEnabled(false);
    assert.equal(new BackupReminder(path, () => new Date(clock.t)).verdict().level, 'off', 'the switch survives a restart');
  });

  it('an unreadable file keeps the reminder ON', () => {
    const path = fresh();
    writeFileSync(path, '{not json');
    assert.equal(new BackupReminder(path).state.enabled, true);
  });
});

describe('updateIndicator (BR-86.3)', () => {
  it('appears only for a newer version', async () => {
    const { updateIndicator } = await import('../src/ui/statusBar.js');
    for (const status of ['off', 'not-yet', 'current'] as const) {
      assert.equal(updateIndicator({ status, newest: { version: '9.9.9' }, lastSuccessAt: null }), null, status);
    }
    const shown = updateIndicator({ status: 'newer', newest: { version: '1.0.0-beta.9' }, lastSuccessAt: '2026-10-22T14:02:00.000Z' });
    assert.ok(shown);
    assert.equal(shown.label, 'Update');
    assert.match(shown.detail, /^1\.0\.0-beta\.9 is available \(checked 2026-10-22 14:02 UTC\)\. Settings → Version\.$/);
  });
});
