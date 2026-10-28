/**
 * LC-70 — one writer per database (U10, FR-77, BR-78, P-76…P-79).
 *
 * `<database>.lock` sits beside the database, on the same mount as what it guards. It is taken by **exclusive
 * create** (`wx`): measured 2026-10-21 to be refused with `EEXIST` in both directions across the Rancher bind mount
 * (host holds → container refused; container holds → host refused).
 *
 *   acquire ─▶ exclusive create ──ok──▶ HELD ─ every heartbeat: read back, still mine? then touch ─ no ─▶ LOST
 *                    │ EEXIST
 *                    ▼
 *          observe; wait one stale window; observe again (lockDecision.ts)
 *           ├─ alive   → REFUSED, naming the holder
 *           ├─ changed / gone → start again
 *           └─ stale   → take over under the takeover mutex, re-checking the token, then exclusive create again
 *
 * ⚠️ **Never judge by age.** A lock left by a process SIGKILLed a second ago looks exactly as fresh as a live one.
 *
 * ⚠️ **A lost lock is never re-taken.** A laptop that sleeps past the stale window wakes to find another process
 * writing; this one stops at once (`onLost`) and a restart is the way back (BR-78.5).
 *
 * The app and every WRITING script take this same lock (`kind` = `app` or `script:<name>`); it replaces the
 * scripts' `docker ps` guard, which could not see a host run or another machine (P-79).
 */

import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

import { isOurs, lockVerdict, type LockObservation } from './lockDecision.js';

/** NFR Q1 = A. */
export const HEARTBEAT_MS = 5_000;
export const STALE_WINDOW_MS = 30_000;

/** Bounds the acquire loop; each round that does not end in held/refused costs at most one stale window. */
const MAX_ROUNDS = 5;

export interface LockRecord {
  readonly token: string;
  readonly kind: string;
  readonly pid: number;
  readonly hostName: string;
  readonly appVersion: string;
  readonly acquiredAt: string;
}

export type LockState = 'none' | 'held' | 'refused' | 'lost';

export type AcquireOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly holder: LockRecord | null; readonly detail: string };

export interface WriterLockOptions {
  readonly databasePath: string;
  readonly kind: string;
  readonly appVersion: string;
  readonly heartbeatMs?: number;
  readonly staleWindowMs?: number;
  /** Injected for tests; the real one is `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
  /** Called once when the lock is found taken by another process (BR-78.5). */
  readonly onLost?: (detail: string) => void;
}

export function lockPathFor(databasePath: string): string {
  return `${databasePath}.lock`;
}

export class WriterLock {
  readonly #path: string;
  readonly #mutexPath: string;
  readonly #kind: string;
  readonly #appVersion: string;
  readonly #heartbeatMs: number;
  readonly #staleWindowMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => Date;
  readonly #log: (line: string) => void;
  readonly #onLost: (detail: string) => void;
  #token: string | null = null;
  #state: LockState = 'none';
  #timer: NodeJS.Timeout | null = null;
  #lastMutex: LockObservation | null = null;
  #detail = '';

  constructor(options: WriterLockOptions) {
    this.#path = lockPathFor(options.databasePath);
    this.#mutexPath = `${this.#path}.takeover`;
    this.#kind = options.kind;
    this.#appVersion = options.appVersion;
    this.#heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.#staleWindowMs = options.staleWindowMs ?? STALE_WINDOW_MS;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? (() => new Date());
    this.#log = options.log ?? ((line) => console.log(line));
    this.#onLost = options.onLost ?? (() => {});
  }

  get state(): LockState {
    return this.#state;
  }

  /** Why the lock is refused or lost, in words; empty while held. */
  get detail(): string {
    return this.#detail;
  }

  get path(): string {
    return this.#path;
  }

  async acquire(): Promise<AcquireOutcome> {
    // Found on Machine 2 (U11, 2026-10-24): a lock that cannot be CREATED (`EACCES`: the data folder is not writable
    // by the app's user) threw out of here, and nothing caught it, so the app crashed into a restart loop instead of
    // running display-only with the reason. Any failure that is not "someone holds it" is now a refusal, said once.
    try {
      return await this.#acquire();
    } catch (error) {
      this.#state = 'refused';
      this.#detail = `cannot create ${this.#path} (${codeOf(error) ?? 'error'}): the app's user cannot write to the data folder`;
      this.#log(`[lock] ${this.#detail}`);
      return { ok: false, holder: null, detail: this.#detail };
    }
  }

  async #acquire(): Promise<AcquireOutcome> {
    // The database's folder may not exist yet (a first host run's `data-dev/`): the repository used to create it on
    // open, and the lock now comes first. Found 2026-10-23 running the built app on a fresh folder.
    mkdirSync(dirname(this.#path), { recursive: true });
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      if (this.#tryCreate()) {
        this.#state = 'held';
        this.#detail = '';
        this.#log(`[lock] acquired ${this.#path} (${this.#kind})`);
        return { ok: true };
      }

      const first = this.#observe(this.#path);
      if (first.token === null) continue; // released between our create and our read
      const holder = this.#readRecord();
      this.#log(`[lock] held by ${describe(holder)}; watching its heartbeat for ${this.#staleWindowMs / 1000} s`);
      await this.#sleep(this.#staleWindowMs);
      const second = this.#observe(this.#path);

      switch (lockVerdict(first, second)) {
        case 'alive':
          return this.#refuse(holder);
        case 'stale':
          this.#takeOver(first.token);
          break;
        case 'changed':
        case 'gone':
          break;
      }
    }
    return this.#refuse(this.#readRecord(), 'the lock kept changing hands; another process is starting at the same time');
  }

  /** Starts the heartbeat. `unref`'d, so it never holds a dying process open (P-78). */
  startHeartbeat(): void {
    if (this.#state !== 'held' || this.#timer) return;
    this.#timer = setInterval(() => this.heartbeat(), this.#heartbeatMs);
    this.#timer.unref();
  }

  /**
   * One beat: read back first, then touch. Touching first could refresh ANOTHER holder's lock and make a
   * takeover look alive to a third process. Exposed for tests; the timer calls it.
   */
  heartbeat(): void {
    if (this.#state !== 'held' || this.#token === null) return;
    const now = this.#observe(this.#path);
    if (!isOurs(now.token, this.#token)) {
      const by = now.token === null ? 'the lock file was removed' : `taken by ${describe(this.#readRecord())}`;
      this.#lose(by);
      return;
    }
    try {
      const t = this.#now();
      utimesSync(this.#path, t, t);
    } catch (error) {
      this.#lose(`the heartbeat could not be written (${message(error)})`);
    }
  }

  /** Orderly shutdown: delete the lock only if it is still ours (BR-78.6). Safe to call more than once. */
  release(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#state !== 'held' || this.#token === null) return;
    if (isOurs(this.#observe(this.#path).token, this.#token)) {
      try {
        unlinkSync(this.#path);
        this.#log(`[lock] released ${this.#path}`);
      } catch {
        // Already gone: nothing to release.
      }
    }
    this.#state = 'none';
  }

  #tryCreate(): boolean {
    const token = randomUUID();
    const record: LockRecord = {
      token,
      kind: this.#kind,
      pid: process.pid,
      hostName: hostname(),
      appVersion: this.#appVersion,
      acquiredAt: this.#now().toISOString(),
    };
    let fd: number;
    try {
      fd = openSync(this.#path, 'wx');
    } catch (error) {
      if (codeOf(error) === 'EEXIST') return false;
      throw error;
    }
    try {
      writeSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    this.#token = token;
    return true;
  }

  /**
   * BR-78.4 — only the holder of the takeover mutex may delete a stale lock, and only after re-reading it and
   * finding the SAME token it watched. So two takers cannot both win, and nobody deletes a lock that changed hands.
   */
  #takeOver(staleToken: string): void {
    let fd: number;
    try {
      fd = openSync(this.#mutexPath, 'wx');
    } catch (error) {
      if (codeOf(error) !== 'EEXIST') throw error;
      // Another taker is mid-takeover, or crashed in one. A mutex unchanged across a whole stale window is itself
      // stale; it is judged by the same watch, never by age.
      const seen = this.#observe(this.#mutexPath);
      if (this.#lastMutex && lockVerdict(this.#lastMutex, seen) === 'stale') {
        this.#log('[lock] removing a stale takeover mutex left by an interrupted takeover');
        tryUnlink(this.#mutexPath);
        this.#lastMutex = null;
      } else {
        this.#lastMutex = seen;
      }
      return;
    }
    try {
      writeSync(fd, JSON.stringify({ token: randomUUID(), createdAt: this.#now().toISOString() }));
      closeSync(fd);
      if (this.#observe(this.#path).token === staleToken) {
        this.#log(`[lock] taking over a stale lock (no heartbeat for ${this.#staleWindowMs / 1000} s)`);
        tryUnlink(this.#path);
      }
    } finally {
      tryUnlink(this.#mutexPath);
    }
  }

  #refuse(holder: LockRecord | null, why?: string): AcquireOutcome {
    this.#state = 'refused';
    this.#detail = why ?? `the database is in use by ${describe(holder)}, whose heartbeat is moving`;
    this.#log(`[lock] REFUSED: ${this.#detail}`);
    return { ok: false, holder, detail: this.#detail };
  }

  #lose(why: string): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#state = 'lost';
    this.#detail = `this process lost the database: ${why}. Restart once the other process has stopped`;
    this.#log(`[lock] LOST: ${why}`);
    this.#onLost(this.#detail);
  }

  #observe(path: string): LockObservation {
    try {
      const mtimeMs = statSync(path).mtimeMs;
      return { token: tokenOf(readFileSync(path, 'utf8')), mtimeMs };
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { token: null, mtimeMs: null };
      throw error;
    }
  }

  #readRecord(): LockRecord | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#path, 'utf8'));
      return parsed !== null && typeof parsed === 'object' ? (parsed as LockRecord) : null;
    } catch {
      return null;
    }
  }
}

/**
 * The token of a lock file's text. A file caught mid-write (created, not yet written) has no parsable token; its
 * raw text stands in, so a second reading after the write differs and reads as `changed`, never as `stale`.
 */
function tokenOf(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { token?: unknown }).token === 'string') {
      return (parsed as { token: string }).token;
    }
  } catch {
    // fall through
  }
  return `raw:${text}`;
}

function describe(holder: LockRecord | null): string {
  if (holder === null) return 'another process (its lock file could not be read)';
  return `${holder.kind} (pid ${holder.pid} on ${holder.hostName}, version ${holder.appVersion}, since ${holder.acquiredAt})`;
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}
