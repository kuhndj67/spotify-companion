/**
 * U11 (LC-87, BR-89, P-99): the sign-ins in progress, held in memory between `/auth/sign-in` and `/auth/callback`.
 *
 * ⚙️ PURE apart from its own bounded state: the clock is a parameter and the random values (`state`, `nonce`, the
 * PKCE verifier) are made by the caller. PBT-99 runs any sequence of creates, consumes and clock advances against it.
 *
 * - **At most {@link MAX_PENDING}** at once, the oldest dropped first, so repeated sign-in attempts cannot grow
 *   memory (BR-89.3).
 * - **Ten minutes** each; an expired one is never returned.
 * - **Single use**: consumed by the first callback that names it, success or failure.
 * - A restart forgets them all, which only forces a new sign-in.
 */

export const MAX_PENDING = 32;
export const PENDING_TTL_MS = 10 * 60_000;

export interface PendingSignIn {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  /** Already passed through `safeReturnPath`. */
  readonly returnPath: string;
  readonly createdAt: number;
}

export class PendingSignIns {
  /** Insertion order is age order: a `Map` iterates in the order keys were first set. */
  private readonly byState = new Map<string, PendingSignIn>();

  add(entry: PendingSignIn, now: number): void {
    this.prune(now);
    // The caller makes `state` from 32 random bytes; a collision is a fault, never a reason to keep both.
    this.byState.delete(entry.state);
    this.byState.set(entry.state, entry);
    while (this.byState.size > MAX_PENDING) {
      const oldest = this.byState.keys().next().value as string;
      this.byState.delete(oldest);
    }
  }

  /** The entry for `state`, removed whatever happens next; `undefined` if unknown, consumed or expired. */
  consume(state: string, now: number): PendingSignIn | undefined {
    this.prune(now);
    const entry = this.byState.get(state);
    if (entry === undefined) return undefined;
    this.byState.delete(state);
    return entry;
  }

  get size(): number {
    return this.byState.size;
  }

  private prune(now: number): void {
    for (const [state, entry] of this.byState) {
      // `now` before `createdAt` (a clock stepped back) counts as fresh; ten minutes later it is gone either way.
      if (now - entry.createdAt >= PENDING_TTL_MS) this.byState.delete(state);
    }
  }
}
