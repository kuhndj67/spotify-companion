/**
 * Live reload of the rule set (LC-16, BR-26). 🔌 IMPURE
 *
 * ## ⚠️ Polling, because the event never arrives (P-19)
 *
 * `fs.watch` was the obvious mechanism and it **does not work on this deployment**. Probed
 * 2026-09-20 over the Rancher Desktop bind mount: **0 events in 12 s** for both an in-place
 * write and a rename, while the container read the new content within 1 s. `watch()` registers,
 * throws nothing, and never calls back.
 *
 * ⚠️ **A unit test of a watcher on a normal filesystem proves nothing**, because the defect
 * exists only over the bind mount — which is the only place this app runs.
 *
 * So: `stat` every `intervalMs`, hash only when `mtime`/`size` move, plus a `reloadNow()` the UI
 * button calls. **Both enter the same loader.** Re-implementing one of them is the WebSocket
 * `403` shape: the admission rule was re-implemented rather than reused, the copies diverged,
 * and all 411 tests passed while every handshake failed.
 *
 * ## ⚠️ This module owns the rule set (BR-26.3b)
 *
 * `RuleStore` is a parser. It used to hold `#rules` and wipe them on every non-`loaded`
 * outcome, which was right when nothing could reload — and would violate BR-26.3 the first
 * time a bad file landed here.
 */

import type { LoadOutcome, RuleStore } from './RuleStore.js';
import type { LoadedRule, LoadedRuleSet, RuleSetState } from './types.js';

export interface RuleSetWatcherLogger {
  info(message: string): void;
  warn(message: string): void;
}

const defaultLogger: RuleSetWatcherLogger = {
  info: (m) => console.log(`[rules] ${m}`),
  warn: (m) => console.warn(`[rules] ${m}`),
};

export interface RuleSetWatcherOptions {
  readonly store: RuleStore;
  /** ⚠️ The poll interval **is** the debounce — there is no separate one (BR-26.1, revised). */
  readonly intervalMs: number;
  /** Injected, so the `loadedAt` and `attemptedAt` stamps are testable. */
  readonly now: () => string;
  readonly logger?: RuleSetWatcherLogger;
  /**
   * How long `reloading` stays visible (BR-26.9). A reload that completes in 3 ms is
   * indistinguishable from one that never happened, and the user is standing at the UI having
   * just pressed the button.
   */
  readonly reloadingMinMs?: number;
}

const DEFAULT_RELOADING_MIN_MS = 1_000;

/** The empty set a cold start runs with until a file appears. */
const EMPTY: readonly LoadedRule[] = [];

export class RuleSetWatcher {
  readonly #store: RuleStore;
  readonly #intervalMs: number;
  readonly #now: () => string;
  readonly #log: RuleSetWatcherLogger;
  readonly #reloadingMinMs: number;

  #timer: NodeJS.Timeout | null = null;
  #signature: string | null = null;
  #polling = false;

  /**
   * ⚠️ **`version` counts accepted loads, not attempts** (BR-26.5/26.6). *"v7 rejected, still
   * running v6"* is only sayable if 7 was never taken — a counter that advanced on attempts
   * would leave the running set unnameable at exactly the moment the user needs to know it.
   *
   * It starts at 0 and becomes 1 on the first accepted load, so "never successfully loaded" is
   * distinguishable from "loaded once".
   */
  #version = 0;
  #rules: readonly LoadedRule[] = EMPTY;
  #contentHash = '';
  #loadedAt: string;
  #state: RuleSetState = 'applied';
  #rejection: { attemptedAt: string; errors: readonly string[] } | null = null;
  #reloadingUntilMs = 0;
  /** False until the first load of any kind completes. Cold start and reload differ (BR-26.3a). */
  #hasLoadedOnce = false;

  constructor(options: RuleSetWatcherOptions) {
    this.#store = options.store;
    this.#intervalMs = options.intervalMs;
    this.#now = options.now;
    this.#log = options.logger ?? defaultLogger;
    this.#reloadingMinMs = options.reloadingMinMs ?? DEFAULT_RELOADING_MIN_MS;
    this.#loadedAt = options.now();
  }

  /**
   * The set in force. ⚠️ **This is the only `current()` in the system** — `RuleStore` has none,
   * deliberately, so a collaborator cannot be wired to a wiped one while every indicator reads
   * green.
   */
  current(): LoadedRuleSet {
    return {
      version: this.#version,
      contentHash: this.#contentHash,
      loadedAt: this.#loadedAt,
      rules: this.#rules,
      state: this.#displayState(),
      rejection: this.#rejection,
    };
  }

  /** Just the rules, for the evaluation path. */
  rules(): readonly LoadedRule[] {
    return this.#rules;
  }

  /** Read once and start polling. Returns the outcome of the initial read. */
  async start(): Promise<LoadOutcome> {
    const outcome = await this.#loadOnce();
    this.#timer = setInterval(() => {
      void this.#poll();
    }, this.#intervalMs);
    // Never hold the process open for a config poll: the recorder is the reason to be running.
    this.#timer.unref?.();
    return outcome;
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * What the reload button calls (`POST /api/rules/reload`).
   *
   * ⚠️ **The same loader as the poll**, and it bypasses the signature check on purpose: the
   * point of pressing the button is to say *"look again anyway"*, and a save that preserved
   * `mtime` and `size` is exactly the case the button exists for.
   */
  async reloadNow(): Promise<LoadOutcome> {
    this.#state = 'reloading';
    this.#reloadingUntilMs = Date.parse(this.#now()) + this.#reloadingMinMs;
    return this.#loadOnce();
  }

  /** The cheap tick. Reads the file only when its signature moved. */
  async #poll(): Promise<void> {
    // A slow read must not overlap the next tick — two loaders racing could apply an older
    // file after a newer one.
    if (this.#polling) return;
    this.#polling = true;
    try {
      const signature = await this.#store.signature();
      const encoded = signature === null ? null : `${signature.mtimeMs}:${signature.size}`;
      if (encoded === this.#signature) return;
      await this.#loadOnce();
    } finally {
      this.#polling = false;
    }
  }

  async #loadOnce(): Promise<LoadOutcome> {
    const outcome = await this.#store.read();
    const signature = await this.#store.signature();
    this.#signature = signature === null ? null : `${signature.mtimeMs}:${signature.size}`;

    const isReload = this.#hasLoadedOnce;
    this.#hasLoadedOnce = true;

    switch (outcome.kind) {
      case 'loaded':
        this.#apply(outcome.rules, outcome.contentHash);
        this.#store.describe(outcome);
        break;

      case 'failed':
        // BR-26.3 / BR-20.8, reachable for the first time here.
        this.#reject(outcome.errors, isReload);
        this.#store.describe(outcome);
        break;

      // ⚠️ BR-26.3a. On a COLD START an absent file is normal — `npm run rules:init` creates
      // it. On a RELOAD it is the save race: write-temp-then-rename is momentarily ENOENT, and
      // accepting it as an empty set would advance the version and silently drop every rule
      // for one poll interval, showing a version bump and no error.
      case 'absent':
        if (isReload) {
          this.#reject([`rules file disappeared at ${this.#store.path}`], true);
        } else {
          this.#store.describe(outcome);
        }
        break;

      case 'no-directory':
        if (isReload) {
          this.#reject([`rules directory disappeared for ${this.#store.path}`], true);
        } else {
          this.#store.describe(outcome);
        }
        break;
    }

    return outcome;
  }

  /** ⚠️ The swap is a reference assignment, which is why it cannot land mid-evaluation (P-23). */
  #apply(rules: readonly LoadedRule[], contentHash: string): void {
    this.#rules = rules;
    this.#contentHash = contentHash;
    this.#version += 1;
    this.#loadedAt = this.#now();
    this.#state = 'applied';
    this.#rejection = null;
  }

  /**
   * ⚠️ **The running set is untouched and `version` does not advance** (BR-26.3, BR-26.6).
   *
   * On a cold start there is nothing to retain, so the app runs with no rules and a surfaced
   * reason (BR-20.7/26.4) — which is the safe direction for something that will eventually
   * control playback.
   */
  #reject(errors: readonly string[], isReload: boolean): void {
    this.#state = 'rejected';
    this.#rejection = { attemptedAt: this.#now(), errors };
    if (isReload) {
      this.#log.warn(
        `reload rejected — still running v${this.#version} (${this.#rules.length} rule(s))`,
      );
    }
  }

  /**
   * ⚠️ `reloading` is held for a minimum so an instant reload is still *seen* (BR-26.9), but it
   * never masks a rejection: a red light that a spinner hides is worse than no light.
   */
  #displayState(): RuleSetState {
    if (this.#state === 'rejected') return 'rejected';
    if (Date.parse(this.#now()) < this.#reloadingUntilMs) return 'reloading';
    return this.#state;
  }
}
