/**
 * LC-70 — the writer lock on real files in a temporary folder (U10, BR-78, P-76…P-78).
 *
 * Timings are shrunk (heartbeat 10 ms, stale window 120 ms) so the suite stays fast; the logic is the same as at
 * 5 s / 30 s. ⚠️ Every guard here is seen to FAIL as well as pass: a held lock refuses, and once released it is
 * acquired.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriterLock, lockPathFor, type WriterLockOptions } from '../src/lock/WriterLock.js';

const HEARTBEAT = 10;
const WINDOW = 120;

let dir: string;
let db: string;
const opened: WriterLock[] = [];

function lock(kind: string, extra: Partial<WriterLockOptions> = {}): WriterLock {
  const l = new WriterLock({ databasePath: db, kind, appVersion: '1.0.0-test', heartbeatMs: HEARTBEAT, staleWindowMs: WINDOW, log: () => {}, ...extra });
  opened.push(l);
  return l;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'writer-lock-'));
  db = join(dir, 'history.db');
});
afterEach(() => {
  for (const l of opened.splice(0)) l.release();
  rmSync(dir, { recursive: true, force: true });
});

describe('WriterLock', () => {
  it('⭐ creates the database folder when it does not exist yet (a first host run)', async () => {
    db = join(dir, 'not-yet', 'data-dev', 'history.db');
    assert.deepEqual(await lock('app').acquire(), { ok: true });
  });

  it('⭐ a lock that cannot be created is a REFUSAL with the reason, never an exception (found on Machine 2, U11)', async () => {
    // The data "folder" is a file, so the lock can be neither created nor its folder made: an error that is not
    // EEXIST, as EACCES was on the NAS. Before the fix this threw out of acquire() and crashed the app.
    writeFileSync(join(dir, 'not-a-folder'), '');
    db = join(dir, 'not-a-folder', 'history.db');
    const outcome = await lock('app').acquire();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.holder, null);
      assert.match(outcome.detail, /cannot create .*history\.db\.lock \((EEXIST|ENOTDIR|EACCES)\)/);
    }
  });

  it('acquires a free lock and records who holds it', async () => {
    const a = lock('app');
    assert.deepEqual(await a.acquire(), { ok: true });
    const record = JSON.parse(readFileSync(lockPathFor(db), 'utf8'));
    assert.equal(record.kind, 'app');
    assert.equal(record.appVersion, '1.0.0-test');
    assert.equal(typeof record.token, 'string');
  });

  it('⭐ a live holder refuses a second process, naming it; released, the second acquires', async () => {
    const a = lock('app');
    await a.acquire();
    a.startHeartbeat();
    const b = lock('script:db-restore');
    const refused = await b.acquire();
    assert.equal(refused.ok, false);
    assert.equal(b.state, 'refused');
    assert.match(b.detail, /in use by app \(pid \d+ on .+, version 1\.0\.0-test/);

    a.release();
    const c = lock('script:db-restore');
    assert.deepEqual(await c.acquire(), { ok: true });
  });

  it('takes over a lock whose heartbeat does not move for a whole window (a killed holder)', async () => {
    writeFileSync(lockPathFor(db), JSON.stringify({ token: 'dead', kind: 'app', pid: 1, hostName: 'gone', appVersion: 'x', acquiredAt: 'then' }));
    // ⚠️ Fresh by the clock: a just-SIGKILLed holder. Age would call it alive; the watch does not.
    const t = new Date();
    utimesSync(lockPathFor(db), t, t);
    const b = lock('app');
    assert.deepEqual(await b.acquire(), { ok: true });
    assert.notEqual(JSON.parse(readFileSync(lockPathFor(db), 'utf8')).token, 'dead');
    assert.equal(existsSync(`${lockPathFor(db)}.takeover`), false, 'the mutex is removed after a takeover');
  });

  it('two processes taking over the same stale lock: exactly one wins', async () => {
    writeFileSync(lockPathFor(db), JSON.stringify({ token: 'dead' }));
    const a = lock('app');
    const b = lock('app');
    // As the app does: a winner starts its heartbeat at once, so the loser's watch sees it alive. (Without one, a
    // silent winner is correctly judged dead and taken over: that is the stale case, not a race.)
    const take = (l: WriterLock) => l.acquire().then((r) => (r.ok && l.startHeartbeat(), r));
    const [ra, rb] = await Promise.all([take(a), take(b)]);
    assert.equal([ra, rb].filter((r) => r.ok).length, 1, 'exactly one holder');
    const [winner, loser] = ra.ok ? [a, b] : [b, a];
    winner.heartbeat();
    assert.equal(winner.state, 'held', 'the winner still owns the lock on disk');
    assert.equal(loser.state, 'refused');
  });

  it('a holder whose lock is replaced is LOST at its next heartbeat and calls onLost once', async () => {
    const lost: string[] = [];
    const a = lock('app', { onLost: (d) => lost.push(d) });
    await a.acquire();
    writeFileSync(lockPathFor(db), JSON.stringify({ token: 'someone-else', kind: 'script:x', pid: 9, hostName: 'h', appVersion: 'y', acquiredAt: 'now' }));
    a.heartbeat();
    assert.equal(a.state, 'lost');
    assert.equal(lost.length, 1);
    assert.match(lost[0]!, /taken by script:x/);
    a.heartbeat();
    assert.equal(lost.length, 1, 'never reported twice, never re-taken');
  });

  it('a removed lock file is lost too', async () => {
    const a = lock('app');
    await a.acquire();
    rmSync(lockPathFor(db));
    a.heartbeat();
    assert.equal(a.state, 'lost');
    assert.match(a.detail, /removed/);
  });

  it('release deletes only its own lock', async () => {
    const a = lock('app');
    await a.acquire();
    writeFileSync(lockPathFor(db), JSON.stringify({ token: 'foreign' }));
    a.release();
    assert.equal(existsSync(lockPathFor(db)), true, 'a foreign lock is left alone');
    const b = lock('app');
    rmSync(lockPathFor(db));
    await b.acquire();
    b.release();
    assert.equal(existsSync(lockPathFor(db)), false);
  });

  it('the heartbeat moves the lock\'s modification time', async () => {
    const a = lock('app');
    await a.acquire();
    const before = new Date(Date.now() - 60_000);
    utimesSync(lockPathFor(db), before, before);
    a.heartbeat();
    const { mtimeMs } = await import('node:fs').then((fs) => fs.statSync(lockPathFor(db)));
    assert.ok(mtimeMs > before.getTime() + 30_000);
  });
});
