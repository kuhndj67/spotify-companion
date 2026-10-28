/**
 * U11 (LC-89, BR-93, P-93): the live connections, by session, so none outlives its session. 🔌 IMPURE (timers)
 *
 * - Each admitted socket is registered with the session admission verified for it, and gets a timer for that
 *   session's `exp`.
 * - It is closed with **4401** (*signed out*) at expiry, when its session signs out (BR-94.1), or when every session
 *   ends (*Sign out everywhere*, BR-94.2). The page reads 4401 as *signed out* and stops reconnecting (BR-93.3).
 * - A socket's timer is cleared when it closes for any reason, so the registry holds only open sockets (P-93).
 *
 * In local mode nothing is registered (there is no session); this module is then unused.
 *
 * The clock and the timers are injected, so the tests run in milliseconds and see every boundary.
 */

export const SIGNED_OUT_CLOSE_CODE = 4401;
const SIGNED_OUT_REASON = 'signed out';
/** `setTimeout` holds at most ~24.8 days; a longer session (up to 90 d) re-arms on the way. */
const MAX_TIMER_MS = 2_147_483_647;

/** What this needs from a `ws` WebSocket. */
export interface ClosableSocket {
  close(code: number, reason: string): void;
  once(event: 'close', listener: () => void): unknown;
}

export interface LiveConnectionsOptions {
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

interface Entry {
  readonly sid: string;
  readonly exp: number;
  timer: unknown;
}

export class LiveConnections {
  readonly #sockets = new Map<ClosableSocket, Entry>();
  readonly #now: () => number;
  readonly #setTimer: (fn: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;

  constructor(options: LiveConnectionsOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#setTimer =
      options.setTimer ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return t;
      });
    this.#clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  }

  /** A socket admission let in, with its session's id and expiry. Already expired → closed at once. */
  register(socket: ClosableSocket, session: { readonly sid: string; readonly exp: number }): void {
    const entry: Entry = { sid: session.sid, exp: session.exp, timer: undefined };
    this.#sockets.set(socket, entry);
    socket.once('close', () => this.#forget(socket));
    this.#arm(socket, entry);
  }

  /** BR-94.1: every socket of one session. */
  closeSession(sid: string): number {
    let closed = 0;
    for (const [socket, entry] of [...this.#sockets]) {
      if (entry.sid === sid) {
        this.#close(socket);
        closed += 1;
      }
    }
    return closed;
  }

  /** BR-94.2: every socket. */
  closeAll(): number {
    const sockets = [...this.#sockets.keys()];
    for (const socket of sockets) this.#close(socket);
    return sockets.length;
  }

  get size(): number {
    return this.#sockets.size;
  }

  #arm(socket: ClosableSocket, entry: Entry): void {
    const remaining = entry.exp - this.#now();
    if (remaining <= 0) {
      this.#close(socket);
      return;
    }
    entry.timer = this.#setTimer(() => {
      if (!this.#sockets.has(socket)) return;
      this.#arm(socket, entry); // re-checks the clock: closes if due, else waits the rest
    }, Math.min(remaining, MAX_TIMER_MS));
  }

  #close(socket: ClosableSocket): void {
    this.#forget(socket);
    try {
      socket.close(SIGNED_OUT_CLOSE_CODE, SIGNED_OUT_REASON);
    } catch {
      // A socket already gone has nothing left to close.
    }
  }

  #forget(socket: ClosableSocket): void {
    const entry = this.#sockets.get(socket);
    if (entry === undefined) return;
    if (entry.timer !== undefined) this.#clearTimer(entry.timer);
    this.#sockets.delete(socket);
  }
}

/**
 * BR-94.1: session ids signed out on this run, each kept only until its own expiry (P-99: bounded by live sessions).
 * A restart forgets them, which is why *Sign out everywhere* (a new key) is the sign-out that survives one.
 */
export class RevokedSessions {
  readonly #until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  add(sid: string, exp: number): void {
    this.#prune();
    if (exp > this.now()) this.#until.set(sid, exp);
  }

  has(sid: string): boolean {
    this.#prune();
    return this.#until.has(sid);
  }

  clear(): void {
    this.#until.clear();
  }

  get size(): number {
    return this.#until.size;
  }

  #prune(): void {
    const now = this.now();
    for (const [sid, exp] of this.#until) if (exp <= now) this.#until.delete(sid);
  }
}
