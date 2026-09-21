/**
 * Rule storage — reads `config/rules.json`. 🔌 IMPURE
 *
 * The only module in U3 that touches the world, and it does exactly one thing: turn a file into
 * `LoadedRule[]`. No evaluation, no verdict logic. The boundary is a file boundary so it can be
 * checked by eye as well as by `test/purity.test.ts`, which deliberately does NOT list this file.
 *
 * ## Fail inert (P-14)
 *
 * Every failure ends in the same place — **no rules** — and they differ only in how loudly they
 * are reported. A rules engine that cannot read its rules skips nothing, which is the safe
 * direction for a component that will eventually control playback.
 *
 * ⚠️ **Never a partial load** (BR-20.6). Loading the rules that parsed and dropping the rest
 * silently arms a rule set the user never wrote. It is the most dangerous thing this file could
 * do, and it is the reason structural validation rejects the whole set.
 *
 * ⚠️ **A bad rules file never stops the app recording** (BR-20.10). Recording is the artefact
 * that cannot be regenerated; rules are text that can be retyped.
 *
 * ## ⚠️ U4: this is a PARSER. It holds no rule set (BR-26.3b)
 *
 * In U3 it held `#rules` and wiped them on **every** non-`loaded` outcome — `failed`, `absent`
 * *and* `no-directory` — which was correct when there was no reload and nothing to retain.
 * `RuleSetWatcher` now owns the current set, because last-known-good is a decision about
 * *whether this load replaces the running set*, and only the watcher knows whether this is a
 * cold start or a reload.
 *
 * ⚠️ **Two `current()` methods was the trap avoided.** Had the store kept its state, it and the
 * watcher would each expose one returning different things, and a coordinator wired to the
 * store would evaluate against a wiped set **while every indicator read green**.
 *
 * Change detection lives in the watcher too, and it is **polling, not `fs.watch`** — probed
 * 2026-09-20, `watch()` registers, throws nothing and delivers 0 events in 12 s over the
 * Rancher Desktop bind mount, which is the only place this app runs.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { hashRuleSetContent } from './ruleHash.js';
import { validateRuleSet } from './ruleValidator.js';
import { MAX_RULES_FILE_BYTES, type LoadedRule } from './types.js';

/**
 * How the read ended.
 *
 * ⚠️ **The store does not decide what these MEAN.** `absent` is a normal cold start and a
 * *rejection* on reload (BR-26.3a): a write-temp-then-rename save is momentarily `ENOENT`, and
 * treating that as an accepted empty set would advance the version and silently drop every rule
 * for a poll interval, showing the user a version bump and no error.
 */
export type LoadOutcome =
  /** File read and valid. `rules` may still be empty — an empty rule set is a valid rule set. */
  | {
      readonly kind: 'loaded';
      readonly rules: readonly LoadedRule[];
      /** Identity across restarts, when `version` cannot provide it (BR-23.7a). */
      readonly contentHash: string;
    }
  /** No file. Normal on a fresh install — `npm run rules:init` creates it. */
  | { readonly kind: 'absent' }
  /** No directory. The mount did not happen; quiet would be exactly wrong. */
  | { readonly kind: 'no-directory' }
  /** Unreadable, too large, too many rules, unparseable, or structurally invalid. */
  | { readonly kind: 'failed'; readonly errors: readonly string[] };

export interface RuleStoreLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const defaultLogger: RuleStoreLogger = {
  info: (m) => console.log(`[rules] ${m}`),
  warn: (m) => console.warn(`[rules] ${m}`),
  error: (m) => console.error(`[rules] ${m}`),
};

/** Enough to tell cheaply whether the file could have changed, without reading it. */
export interface FileSignature {
  readonly mtimeMs: number;
  readonly size: number;
}

export class RuleStore {
  readonly #path: string;
  readonly #log: RuleStoreLogger;

  constructor(path: string, logger: RuleStoreLogger = defaultLogger) {
    this.#path = path;
    this.#log = logger;
  }

  get path(): string {
    return this.#path;
  }

  /**
   * The cheap change check the watcher polls with (P-19). `null` when the file is not there —
   * which is a **change** if it was there a moment ago.
   */
  async signature(): Promise<FileSignature | null> {
    try {
      const info = await stat(this.#path);
      if (!info.isFile()) return null;
      return { mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      return null;
    }
  }

  /**
   * Read, validate and hash the rules file.
   *
   * Total: every failure is returned as a `LoadOutcome`, never thrown. A caller that forgot a
   * try/catch would take down the poll loop over a malformed config file.
   *
   * ⚠️ **It holds nothing and decides nothing.** The watcher applies the outcome.
   */
  async read(): Promise<LoadOutcome> {
    return this.#read();
  }

  /** Report an outcome. Kept here so the wording stays with the module that knows the path. */
  describe(outcome: LoadOutcome): void {
    switch (outcome.kind) {
      case 'loaded': {
        const disabled = outcome.rules.filter((r) => r.status.state === 'disabled');
        this.#log.info(
          `loaded ${outcome.rules.length} rule(s) from ${this.#path}` +
            (disabled.length > 0 ? `, ${disabled.length} disabled` : ''),
        );
        // Per-rule, so the reason survives to somewhere a person will see it (BR-18.7).
        for (const r of disabled) {
          if (r.status.state === 'disabled') {
            this.#log.warn(`rule "${r.rule.id}" disabled (${r.status.reason}): ${r.status.detail}`);
          }
        }
        break;
      }
      case 'absent':
        this.#log.info(`no rules file at ${this.#path} — no rules active`);
        break;
      // NOT the same fact as an absent file: the mount did not happen. Louder for that reason.
      case 'no-directory':
        this.#log.warn(
          `rules directory ${dirname(this.#path)} does not exist — no rules active. ` +
            `Is the config volume mounted?`,
        );
        break;
      case 'failed':
        this.#log.error(`rules file at ${this.#path} could not be loaded:`);
        for (const e of outcome.errors) this.#log.error(`  ${e}`);
        break;
    }
  }

  async #read(): Promise<LoadOutcome> {
    // Size is checked BEFORE reading, so a pathological file is refused rather than loaded into
    // memory first. The bound is a constant, not a setting (Q5 = A).
    let size: number;
    try {
      const info = await stat(this.#path);
      if (!info.isFile()) {
        return { kind: 'failed', errors: [`${this.#path} is not a regular file`] };
      }
      size = info.size;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Distinguish "no file" from "no directory" — two facts, two reports.
        try {
          await stat(dirname(this.#path));
          return { kind: 'absent' };
        } catch {
          return { kind: 'no-directory' };
        }
      }
      return { kind: 'failed', errors: [`cannot stat ${this.#path}: ${code ?? String(error)}`] };
    }

    if (size > MAX_RULES_FILE_BYTES) {
      return {
        kind: 'failed',
        errors: [`file is ${size} bytes, over the ${MAX_RULES_FILE_BYTES}-byte limit`],
      };
    }

    let text: string;
    try {
      text = await readFile(this.#path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return { kind: 'failed', errors: [`cannot read ${this.#path}: ${code ?? String(error)}`] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      // JSON.parse can also throw RangeError on pathologically nested input. Caught here, which
      // is why a deep file is a structural failure rather than an unhandled crash.
      return { kind: 'failed', errors: [`invalid JSON: ${(error as Error).message}`] };
    }

    const result = validateRuleSet(parsed);
    if (!result.ok) return { kind: 'failed', errors: result.errors };

    // Hashed over the file's TEXT, so adding, removing or reordering a rule changes the set's
    // identity even when every individual rule survives unchanged.
    return { kind: 'loaded', rules: result.value, contentHash: hashRuleSetContent(text) };
  }
}
