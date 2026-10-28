/**
 * U11 (LC-89, BR-93, BR-94; P-93) — the live connection never outlives its session.
 *
 * Two layers. The registry and the revoked set, with an injected clock and timers, see every boundary. Then real
 * WebSockets (`ws`) through an upgrade handler made of the SAME calls `server.ts` makes (`decideAccess` on
 * `accessRequestFrom(request)`, then `LiveConnections.register` with the admitted session); the structural pins in
 * `test/localGuard.test.ts` and `test/accessStartup.test.ts` hold `server.ts` to those calls.
 *
 * ⚠️ Positive controls: a valid session's socket IS admitted and stays open until its expiry; a socket of ANOTHER
 * session survives one session's sign-out.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { LiveConnections, RevokedSessions, SIGNED_OUT_CLOSE_CODE } from '../src/access/liveConnections.js';
import { SESSION_COOKIE, accessRequestFrom, decideAccess, type ServerAccessPolicy } from '../src/localGuard.js';
import { signSession, verifySession, type Session } from '../src/access/session.js';

class FakeSocket extends EventEmitter {
  closed: { code: number; reason: string } | null = null;
  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = { code, reason };
    this.emit('close');
  }
}

/** Read through a function, so an earlier `assert.equal(s.closed, null)` does not narrow later reads to `null`. */
const codeOf = (s: FakeSocket) => s.closed?.code;

function fakeClock(start = 1_000_000) {
  let now = start;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

describe('LiveConnections (P-93)', () => {
  it('⭐ open until expiry, then closed with 4401; its timer is gone', () => {
    const clock = fakeClock();
    const live = new LiveConnections(clock);
    const s = new FakeSocket();
    live.register(s, { sid: 'a', exp: clock.now() + 5_000 });
    clock.advance(4_999);
    assert.equal(s.closed, null);
    clock.advance(1);
    assert.deepEqual(s.closed, { code: SIGNED_OUT_CLOSE_CODE, reason: 'signed out' });
    assert.equal(live.size, 0);
    assert.equal(clock.pending, 0);
  });

  it('an already-expired session is closed at once', () => {
    const clock = fakeClock();
    const live = new LiveConnections(clock);
    const s = new FakeSocket();
    live.register(s, { sid: 'a', exp: clock.now() });
    assert.equal(s.closed?.code, SIGNED_OUT_CLOSE_CODE);
  });

  it('⭐ closeSession closes that session\'s sockets only; closeAll closes the rest', () => {
    const clock = fakeClock();
    const live = new LiveConnections(clock);
    const [a1, a2, b] = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
    live.register(a1, { sid: 'a', exp: clock.now() + 60_000 });
    live.register(a2, { sid: 'a', exp: clock.now() + 60_000 });
    live.register(b, { sid: 'b', exp: clock.now() + 60_000 });
    assert.equal(live.closeSession('a'), 2);
    assert.equal(a1.closed?.code, SIGNED_OUT_CLOSE_CODE);
    assert.equal(a2.closed?.code, SIGNED_OUT_CLOSE_CODE);
    assert.equal(b.closed, null);
    assert.equal(live.closeAll(), 1);
    assert.equal(codeOf(b), SIGNED_OUT_CLOSE_CODE);
    assert.equal(clock.pending, 0);
  });

  it('a socket that closes by itself is forgotten, and its timer cleared (the registry holds only open sockets)', () => {
    const clock = fakeClock();
    const live = new LiveConnections(clock);
    const s = new FakeSocket();
    live.register(s, { sid: 'a', exp: clock.now() + 60_000 });
    s.emit('close');
    assert.equal(live.size, 0);
    assert.equal(clock.pending, 0);
  });

  it('a 90-day session is longer than one timer can wait: it re-arms, and still closes exactly at expiry', () => {
    const clock = fakeClock();
    const live = new LiveConnections(clock);
    const s = new FakeSocket();
    const ninety = 90 * 24 * 3_600_000;
    live.register(s, { sid: 'a', exp: clock.now() + ninety });
    clock.advance(2_147_483_647);
    assert.equal(s.closed, null, 'not closed when the first timer fires');
    clock.advance(ninety - 2_147_483_647 - 1);
    assert.equal(s.closed, null);
    clock.advance(1);
    assert.equal(codeOf(s), SIGNED_OUT_CLOSE_CODE);
  });
});

describe('RevokedSessions (BR-94.1, P-99)', () => {
  it('holds an id until its own expiry, then forgets it; an already-expired one is never held', () => {
    let now = 0;
    const r = new RevokedSessions(() => now);
    r.add('a', 100);
    r.add('old', 0);
    assert.equal(r.has('a'), true);
    assert.equal(r.has('old'), false);
    now = 100;
    assert.equal(r.has('a'), false);
    assert.equal(r.size, 0);
  });
});

describe('real WebSockets through the upgrade rule (BR-93, P-88)', () => {
  const POLICY: ServerAccessPolicy = { mode: 'server', publicHost: 'app.test:3443', publicOrigin: 'https://app.test:3443' };
  const KEY = Buffer.alloc(32, 3);

  async function harness() {
    const revoked = new RevokedSessions();
    const live = new LiveConnections();
    const verify = (cookie: string | undefined) => verifySession(cookie, { key: KEY, now: Date.now(), allowedSubject: 'owner', revoked });
    const wss = new WebSocketServer({ noServer: true });
    const server = createServer((_req, res) => res.end());
    // The same calls as server.ts's upgrade handler.
    server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      const decision = decideAccess(accessRequestFrom(request), POLICY, verify);
      if (!decision.ok || request.url !== '/ws') {
        const unauthenticated = !decision.ok && (decision.reason === 'no-session' || decision.reason === 'session-expired');
        socket.write(unauthenticated ? 'HTTP/1.1 401 Unauthorized\r\n\r\n' : 'HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (decision.ok && decision.session !== undefined) live.register(ws, decision.session);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const open = (cookie: string | null) =>
      new Promise<{ ws: WebSocket | null; status: number | null }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { host: POLICY.publicHost, ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) } });
        ws.once('open', () => resolve({ ws, status: null }));
        ws.once('unexpected-response', (_req, res) => resolve({ ws: null, status: res.statusCode ?? 0 }));
        ws.once('error', () => resolve({ ws: null, status: -1 }));
      });
    const closeCode = (ws: WebSocket) => new Promise<number>((r) => ws.once('close', (code) => r(code)));
    return {
      revoked,
      live,
      open,
      closeCode,
      session: (sid: string, lifeMs: number): [string, Session] => {
        const s: Session = { sub: 'owner', iat: Date.now(), exp: Date.now() + lifeMs, sid };
        return [signSession(s, KEY), s];
      },
      close: () => new Promise<void>((r) => { wss.close(); server.closeAllConnections(); server.close(() => r()); }),
    };
  }

  it('⭐ a valid session is admitted; none, a forged one, or another key\'s is refused with 401 before the handshake', async () => {
    const h = await harness();
    try {
      const [cookie] = h.session('s1', 60_000);
      const ok = await h.open(cookie);
      assert.ok(ok.ws, 'admitted');
      ok.ws!.close();
      assert.equal((await h.open(null)).status, 401);
      assert.equal((await h.open('v1.e30.AAAA')).status, 401);
      const other = signSession({ sub: 'owner', iat: Date.now(), exp: Date.now() + 60_000, sid: 'x' }, Buffer.alloc(32, 9));
      assert.equal((await h.open(other)).status, 401);
    } finally {
      await h.close();
    }
  });

  it('the socket closes with 4401 when its session expires (a short lifetime)', async () => {
    const h = await harness();
    try {
      const [cookie] = h.session('s2', 300);
      const { ws } = await h.open(cookie);
      assert.ok(ws);
      assert.equal(await h.closeCode(ws!), SIGNED_OUT_CLOSE_CODE);
      // And reconnecting with it is refused: the page reads that 401 as signed out (BR-93.3).
      assert.equal((await h.open(cookie)).status, 401);
    } finally {
      await h.close();
    }
  });

  it('sign out of one session closes ITS socket (4401) and refuses it again; another session\'s socket stays open', async () => {
    const h = await harness();
    try {
      const [c1, s1] = h.session('s3', 60_000);
      const [c2] = h.session('s4', 60_000);
      const a = (await h.open(c1)).ws!;
      const b = (await h.open(c2)).ws!;
      const closedA = h.closeCode(a);
      // What the sign-out route's signOut does in server.ts.
      h.revoked.add(s1.sid, s1.exp);
      h.live.closeSession(s1.sid);
      assert.equal(await closedA, SIGNED_OUT_CLOSE_CODE);
      assert.equal(b.readyState, WebSocket.OPEN);
      assert.equal((await h.open(c1)).status, 401);
      b.close();
    } finally {
      await h.close();
    }
  });
});
