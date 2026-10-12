/**
 * The ONE path by which the app writes `rules.json` (LC-43; BR-53, BR-54, BR-55). 🔌 IMPURE
 *
 * U3–U6 kept `config/` read-only so that no route could overwrite the hand-authored rules — and BR-20.8's
 * last-known-good does NOT protect against a valid-but-EMPTY file, which parses fine. U7 makes the app a writer
 * on purpose (FD Q1 = A), so this class is what replaces the read-only mount as protection. Every write is:
 *
 *   validated (the store's own parser) → compared → staged → confirmed (typed word when it would lose rules or
 *   its base is unknown) → hash-checked under a lock → previous kept → atomically renamed → reloaded
 *
 * and the answer reported is the **watcher's**, never "applied" on the strength of the write alone.
 *
 * ## ⚠️ What it may never touch
 *
 * `state/` — the automation switch and halt latch (BR-54.5, FR-61). This module imports nothing from
 * `src/playback/`, and a structural test pins that: an agent that edits rules must not be able to reach the kill
 * switch.
 *
 * ## Two writers, two defences (P-49's second half, P-52)
 *
 * The app's own writers (two tabs, an undo, a startup restore) are serialised by a lock around the whole
 * check-and-write. A person editing the file by hand is a writer the lock cannot see; that is what the hash
 * checks are for — at upload (BR-54.2) and again at confirm (BR-54.3).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { RULES_UPLOAD_CAP_BYTES } from '../ingest/types.js';
import { hashRuleSetContent } from '../rules/ruleHash.js';
import { parseRuleSetText } from '../rules/ruleValidator.js';
import type { LoadOutcome } from '../rules/RuleStore.js';
import type { LoadedRule, LoadedRuleSet } from '../rules/types.js';
import { writeFileAtomic } from './atomicWrite.js';
import { compareRuleSets, type RulesComparison } from './rulesComparison.js';

/** The word typed to confirm a write that would lose rules, arm a rule, or whose base is unknown (BR-54.1, 54.6, 54.4). */
export const REPLACE_WORD = 'REPLACE';

/** As U6's restore staging (BR-51.3): long enough to read a comparison, short enough not to linger. */
export const RULES_STAGING_TTL_MS = 10 * 60 * 1000;

/** Bounded so abandoned tabs cannot grow the map; the oldest staging is dropped first. */
const MAX_STAGINGS = 8;

export type RulesRefusalReason =
  | 'invalid'
  | 'too-large'
  | 'stale-base'
  | 'changed-since-staging'
  | 'confirmation-required'
  | 'staging-expired'
  | 'nothing-to-undo'
  | 'write-failed'
  | 'reload-rejected';

/** Every refusal has its own words — never one generic "failed" (domain-entities §2). */
const MESSAGES: Record<RulesRefusalReason, string> = {
  invalid: 'The file is not a valid rule set. Nothing was changed.',
  'too-large': `The file is larger than ${RULES_UPLOAD_CAP_BYTES / 1024} KB. Nothing was changed.`,
  'stale-base':
    'Your rules changed since you downloaded them (by hand, or in another tab). Download them again and redo your edit.',
  'changed-since-staging':
    'The rules file changed after the comparison was shown. Nothing was written — upload again to see the new comparison.',
  'confirmation-required': `Type ${REPLACE_WORD} to confirm this change.`,
  'staging-expired': 'This upload has expired or was already applied. Upload the file again.',
  'nothing-to-undo': 'Nothing to undo yet.',
  'write-failed': 'The rules file could not be written. Nothing was changed.',
  'reload-rejected': 'The file was written but the rules engine did not accept it; the previous rules are still running.',
};

export interface RulesRefusal {
  readonly ok: false;
  readonly reason: RulesRefusalReason;
  readonly message: string;
  /** The validator's errors (rule and field), for `invalid` and `reload-rejected`. */
  readonly errors: readonly string[];
}

export interface RulesStaged {
  readonly ok: true;
  readonly token: string;
  readonly kind: 'upload' | 'undo' | 'restore';
  readonly comparison: RulesComparison;
  /** True when confirm must carry `REPLACE` (BR-54.1 mass removal, BR-54.6 a rule becomes live, or BR-54.4 unknown base). */
  readonly typedConfirmationRequired: boolean;
  /** Why it is required — shown beside the box. `null` when it is not. */
  readonly typedConfirmationReason: string | null;
  readonly expiresAt: string;
}

export interface RulesApplied {
  readonly ok: true;
  /** The watcher's version after the reload — evidence the running set changed, not just the file. */
  readonly version: number;
  readonly comparison: RulesComparison;
}

export interface RulesFile {
  readonly content: string;
  readonly hash: string;
}

export interface LastRulesWrite {
  readonly at: string;
  readonly kind: 'upload' | 'undo' | 'restore';
  readonly outcome: 'applied' | RulesRefusalReason;
  readonly version: number | null;
}

/** The two things this class needs from the watcher — and nothing that could reach `state/`. */
export interface RulesWatcherPort {
  current(): LoadedRuleSet;
  reloadNow(): Promise<LoadOutcome>;
}

export interface RulesWriterDeps {
  readonly rulesPath: string;
  /** `null` at startup (BR-59.5 runs before the watcher exists); required for any interactive write. */
  readonly watcher: RulesWatcherPort | null;
  readonly now: () => number;
  readonly newToken?: () => string;
}

interface Staging {
  readonly token: string;
  readonly kind: 'upload' | 'undo' | 'restore';
  readonly content: string;
  readonly diskHashAtStaging: string | null;
  readonly comparison: RulesComparison;
  readonly typedConfirmationRequired: boolean;
  readonly expiresAtMs: number;
}

export class RulesWriter {
  readonly #path: string;
  readonly #previousPath: string;
  #watcher: RulesWatcherPort | null;
  readonly #now: () => number;
  readonly #newToken: () => string;
  readonly #stagings = new Map<string, Staging>();
  /** P-52: one chain; every check-and-write runs inside it. */
  #lock: Promise<unknown> = Promise.resolve();
  #last: LastRulesWrite | null = null;

  constructor(deps: RulesWriterDeps) {
    this.#path = deps.rulesPath;
    this.#previousPath = join(dirname(deps.rulesPath), 'rules.previous.json');
    this.#watcher = deps.watcher;
    this.#now = deps.now;
    this.#newToken = deps.newToken ?? randomUUID;
  }

  /** Wired after construction, because BR-59.5 needs the writer before the watcher starts. */
  attachWatcher(watcher: RulesWatcherPort): void {
    this.#watcher = watcher;
  }

  get previousPath(): string {
    return this.#previousPath;
  }

  /** For Diagnostics (IN-U7-6). */
  lastWrite(): LastRulesWrite | null {
    return this.#last;
  }

  hasPrevious(): boolean {
    return existsSync(this.#previousPath);
  }

  /** BR-53.2: the file's bytes unchanged, and its hash — the base the UI sends back with an upload. */
  download(): RulesFile | null {
    const content = this.#readText(this.#path);
    return content === null ? null : { content, hash: hashRuleSetContent(content) };
  }

  /**
   * Stage an upload (BR-53.3, BR-54.2, BR-54.4). Never writes.
   *
   * @param baseHash the hash of the version the user downloaded or was shown, or `null` when unknown (another
   *   browser, a file kept from last month). Unknown is NOT refused — it needs `REPLACE` instead (BR-54.4).
   */
  stageUpload(text: string, baseHash: string | null): RulesStaged | RulesRefusal {
    if (Buffer.byteLength(text, 'utf8') > RULES_UPLOAD_CAP_BYTES) return refusal('too-large');
    const parsed = parseRuleSetText(text);
    if (!parsed.ok) return refusal('invalid', parsed.errors);

    const disk = this.download();
    if (baseHash !== null && baseHash !== (disk?.hash ?? null)) return refusal('stale-base');

    return this.#stage('upload', text, parsed.rules, disk, baseHash === null ? 'unknown-base' : null);
  }

  /** Stage *Undo last rules change* (BR-55): the previous file, RE-validated, through the same path. */
  stageUndo(): RulesStaged | RulesRefusal {
    const previous = this.#readText(this.#previousPath);
    if (previous === null) return refusal('nothing-to-undo');
    const parsed = parseRuleSetText(previous);
    if (!parsed.ok) return refusal('invalid', parsed.errors);
    return this.#stage('undo', previous, parsed.rules, this.download(), null);
  }

  /**
   * Compare a backup's rules with the current ones for the restore dialog (BR-59.1). Never stages and never
   * writes: the restore flow owns that decision and applies it at startup via `applyAtStartup`.
   */
  compareCandidate(text: string): { ok: true; comparison: RulesComparison; currentHash: string | null } | RulesRefusal {
    if (Buffer.byteLength(text, 'utf8') > RULES_UPLOAD_CAP_BYTES) return refusal('too-large');
    const parsed = parseRuleSetText(text);
    if (!parsed.ok) return refusal('invalid', parsed.errors);
    const disk = this.download();
    return { ok: true, comparison: compareRuleSets(this.#currentRules(disk), parsed.rules), currentHash: disk?.hash ?? null };
  }

  /** Confirm a staging (BR-53.4). Runs entirely inside the lock (P-52). */
  confirm(token: string, typedWord: string | null): Promise<RulesApplied | RulesRefusal> {
    return this.#withLock(async () => {
      this.#prune();
      const staging = this.#stagings.get(token);
      if (staging === undefined) return refusal('staging-expired');

      if (staging.typedConfirmationRequired && typedWord !== REPLACE_WORD) {
        // Kept: the user can type the word and try again without re-uploading.
        return this.#record(staging.kind, refusal('confirmation-required'), null);
      }

      // BR-54.3: the file must be exactly what the comparison was computed against.
      const diskNow = this.download()?.hash ?? null;
      if (diskNow !== staging.diskHashAtStaging) {
        this.#stagings.delete(token);
        return this.#record(staging.kind, refusal('changed-since-staging'), null);
      }
      this.#stagings.delete(token);

      const written = this.#swapIn(staging.content);
      if (!written.ok) return this.#record(staging.kind, refusal('write-failed', [written.reason]), null);

      if (this.#watcher === null) return this.#record(staging.kind, refusal('reload-rejected', ['no rules watcher']), null);
      const outcome = await this.#watcher.reloadNow();
      if (outcome.kind !== 'loaded') {
        const errors = outcome.kind === 'failed' ? outcome.errors : [`rules file ${outcome.kind} after the write`];
        return this.#record(staging.kind, refusal('reload-rejected', errors), null);
      }
      const version = this.#watcher.current().version;
      this.#last = { at: new Date(this.#now()).toISOString(), kind: staging.kind, outcome: 'applied', version };
      return { ok: true, version, comparison: staging.comparison };
    });
  }

  /**
   * BR-59.5/59.6 — apply a restored backup's rules at STARTUP, before the watcher starts (so its first load is
   * already the restored set). Only if the current file is still what the user confirmed against.
   */
  applyAtStartup(content: string, expectedCurrentHash: string | null): { applied: true } | { applied: false; reason: string } {
    const parsed = parseRuleSetText(content);
    if (!parsed.ok) return { applied: false, reason: `the backup's rules are not valid: ${parsed.errors.join('; ')}` };
    const current = this.download()?.hash ?? null;
    if (current !== expectedCurrentHash) {
      return { applied: false, reason: 'your rules changed after you confirmed the restore, so the backup’s rules were not applied' };
    }
    const written = this.#swapIn(content);
    if (!written.ok) return { applied: false, reason: `the rules file could not be written: ${written.reason}` };
    this.#last = { at: new Date(this.#now()).toISOString(), kind: 'restore', outcome: 'applied', version: null };
    return { applied: true };
  }

  // ─── internals ────────────────────────────────────────────────────────────────────────────────

  #stage(
    kind: Staging['kind'],
    content: string,
    next: readonly LoadedRule[],
    disk: RulesFile | null,
    extra: 'unknown-base' | null,
  ): RulesStaged {
    this.#prune();
    const comparison = compareRuleSets(this.#currentRules(disk), next);
    const reasons: string[] = [];
    if (comparison.massRemoval) {
      reasons.push(`This removes ${comparison.removed.length} of your ${comparison.currentCount} rules.`);
    }
    // BR-54.6: arming is the one change here that can act on the player, so it is not a plain click. Asked
    // whether automation is on or off — this module may not read `state/` (BR-54.5), and the switch can be
    // turned on a moment later anyway.
    if (comparison.becomesLive.length > 0) {
      const n = comparison.becomesLive.length;
      reasons.push(`This lets ${n === 1 ? '1 rule' : `${n} rules`} skip tracks when automation is on — ${n === 1 ? 'it' : 'they'} could not before.`);
    }
    if (extra === 'unknown-base') {
      reasons.push("This file wasn't downloaded in this session, so changes made since cannot be detected — check what it removes.");
    }
    const token = this.#newToken();
    const expiresAtMs = this.#now() + RULES_STAGING_TTL_MS;
    const staging: Staging = {
      token,
      kind,
      content,
      diskHashAtStaging: disk?.hash ?? null,
      comparison,
      typedConfirmationRequired: reasons.length > 0,
      expiresAtMs,
    };
    this.#stagings.set(token, staging);
    while (this.#stagings.size > MAX_STAGINGS) this.#stagings.delete(this.#stagings.keys().next().value!);
    return {
      ok: true,
      token,
      kind,
      comparison,
      typedConfirmationRequired: staging.typedConfirmationRequired,
      typedConfirmationReason: reasons.length > 0 ? reasons.join(' ') : null,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * The rules the comparison is computed against: the file on disk when it parses — that is what is being
   * replaced — else the set actually running (a hand edit that broke the file leaves last-known-good in force).
   */
  #currentRules(disk: RulesFile | null): readonly LoadedRule[] {
    if (disk !== null) {
      const parsed = parseRuleSetText(disk.content);
      if (parsed.ok) return parsed.rules;
    }
    return this.#watcher?.current().rules ?? [];
  }

  /** Previous ← current (when there is one), then current ← content. Both atomic (P-51). */
  #swapIn(content: string): { ok: true } | { ok: false; reason: string } {
    const current = this.#readText(this.#path);
    if (current !== null) {
      const kept = writeFileAtomic(this.#previousPath, current);
      if (!kept.ok) return kept;
    }
    return writeFileAtomic(this.#path, content);
  }

  #readText(path: string): string | null {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }

  #prune(): void {
    const now = this.#now();
    for (const [token, s] of this.#stagings) if (s.expiresAtMs <= now) this.#stagings.delete(token);
  }

  #record<T extends RulesRefusal>(kind: Staging['kind'], result: T, version: number | null): T {
    this.#last = { at: new Date(this.#now()).toISOString(), kind, outcome: result.reason, version };
    return result;
  }

  #withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn, fn);
    this.#lock = run.catch(() => undefined);
    return run;
  }
}

function refusal(reason: RulesRefusalReason, errors: readonly string[] = []): RulesRefusal {
  return { ok: false, reason, message: MESSAGES[reason], errors };
}
