/**
 * LC-69 — the writer lock's decisions (U10, BR-78.3, BR-78.5, P-76). ⚙️ PURE.
 *
 * ## Watch, never judge by age
 *
 * A lock left by a process that was just killed (the previous container, SIGKILLed by `docker compose up -d` after
 * its grace period) looks exactly as fresh as a live one. So a process that finds the lock held does not compare
 * the lock's time with its own clock: it reads the lock, waits one stale window, reads it again, and asks *did the
 * heartbeat move?* Only two times written by the HOLDER's clock are compared with each other, so clock skew between
 * a host and a container (or two machines, U11) cannot make a live holder look dead.
 */

/** One reading of the lock file. `token: null` means the file was absent. */
export interface LockObservation {
  readonly token: string | null;
  readonly mtimeMs: number | null;
}

/**
 * - `alive`: same token, heartbeat moved — the holder is running; refuse.
 * - `stale`: same token, heartbeat did not move for a whole window — the holder is gone; take over.
 * - `changed`: a different token — someone else acquired meanwhile; start again.
 * - `gone`: the lock was released meanwhile; start again.
 */
export type LockVerdict = 'alive' | 'stale' | 'changed' | 'gone';

export function lockVerdict(first: LockObservation, second: LockObservation): LockVerdict {
  if (second.token === null) return 'gone';
  if (first.token !== second.token) return 'changed';
  return first.mtimeMs === second.mtimeMs ? 'stale' : 'alive';
}

/** BR-78.5 / 78.6 — does the lock on disk still carry this process's token? An absent lock is not ours. */
export function isOurs(observedToken: string | null, ourToken: string): boolean {
  return observedToken !== null && observedToken === ourToken;
}
