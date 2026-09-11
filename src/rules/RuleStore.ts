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
 * ## `watch()` is deliberately absent
 *
 * Deferred to U4, where the UI gives live reload something to trigger it (NFR Q3 = D). Two
 * consequences, both intended: BR-20.8 (last-known-good on reload) cannot fire here because there
 * is no reload, and the half-written-file race — a text editor's save is frequently not atomic —
 * does not exist in U3 because nothing is watching. Both return with the watcher.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { validateRuleSet } from './ruleValidator.js';
import { MAX_RULES_FILE_BYTES, type LoadedRule } from './types.js';

/** How the load ended. The app's behaviour is identical for every failure; the report is not. */
export type LoadOutcome =
  /** File read and valid. `rules` may still be empty — an empty rule set is a valid rule set. */
  | { readonly kind: 'loaded'; readonly rules: readonly LoadedRule[] }
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

export class RuleStore {
  readonly #path: string;
  readonly #log: RuleStoreLogger;
  #rules: readonly LoadedRule[] = [];

  constructor(path: string, logger: RuleStoreLogger = defaultLogger) {
    this.#path = path;
    this.#log = logger;
  }

  /** The current rule set. Empty until a successful `load()`. */
  current(): readonly LoadedRule[] {
    return this.#rules;
  }

  /**
   * Read and validate the rules file.
   *
   * Total: every failure is returned as a `LoadOutcome`, never thrown. The caller cannot be
   * required to wrap this in a try/catch, because a caller that forgets would take down the poll
   * loop over a malformed config file.
   */
  async load(): Promise<LoadOutcome> {
    const outcome = await this.#read();

    switch (outcome.kind) {
      case 'loaded': {
        this.#rules = outcome.rules;
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

      // Normal on a fresh install. Quiet, but names the path so a typo is still diagnosable.
      case 'absent':
        this.#rules = [];
        this.#log.info(`no rules file at ${this.#path} — no rules active`);
        break;

      // NOT the same fact as an absent file: the mount did not happen. Louder for that reason.
      case 'no-directory':
        this.#rules = [];
        this.#log.warn(
          `rules directory ${dirname(this.#path)} does not exist — no rules active. ` +
            `Is the config volume mounted?`,
        );
        break;

      case 'failed':
        // ⚠️ The previous set is NOT retained here. On cold start there is nothing to retain
        // (BR-20.7); last-known-good on reload is BR-20.8, which arrives with watch() in U4.
        this.#rules = [];
        this.#log.error(`rules file at ${this.#path} could not be loaded — no rules active:`);
        for (const e of outcome.errors) this.#log.error(`  ${e}`);
        break;
    }

    return outcome;
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

    return { kind: 'loaded', rules: result.value };
  }
}
