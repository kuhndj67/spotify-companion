/**
 * Content hashing for rules and rule sets. ⚙️ PURE
 *
 * ## What this is for, and what it is not
 *
 * A **stored decision must stay attributable** (BR-23.6/23.7a). A rule can be edited under the
 * same `id`, and a rule set's `version` counter resets to 1 on every restart — so without a
 * content hash on the row, a decision that disagrees with a later recomputation is
 * *unexplainable*, and two different rule sets a month apart are both "v3".
 *
 * ⚠️ **This is an attribution hash, not a security one.** The input is a local single-user
 * config file that only the user writes; there is no adversary to forge a collision, and
 * nothing downstream makes a trust decision from it. It is deliberately **self-contained** —
 * importing `node:crypto` would put this module on the wrong side of `test/purity.test.ts`,
 * and the whole point is that the same rule hashes identically during live evaluation, during a
 * back-test, and during a replay months later.
 *
 * FNV-1a over 64 bits: a hand-written rule set is dozens of rules, where the collision
 * probability is negligible, and the function has no state, no clock and no platform
 * dependence.
 */

import type { Rule } from './types.js';

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * ⚠️ Hashes the UTF-8 bytes, not the code units. A surrogate pair must hash the same way
 * whichever way the file was written, or the same rule set would change identity across an
 * editor that normalises differently.
 */
export function hashString(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Deterministic JSON with sorted object keys.
 *
 * ⚠️ **Key order must not change the hash.** `JSON.stringify` preserves insertion order, so two
 * byte-identical rules written with their fields in a different order would otherwise hash
 * differently — and every decision taken before a cosmetic reordering would look as though it
 * came from a different rule.
 *
 * Exported for U7's `rulesComparison` (LC-40), which must agree with this file about when two rules are
 * the same — one canonicaliser, never two.
 */
export function canonicalise(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // ⚠️ An absent field and a field explicitly set to undefined are the same rule. Dropping
      // undefined here keeps them hashing alike, matching what JSON.stringify would store.
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The hash stamped on every decision row for the rule that produced it.
 *
 * Covers the rule's **behaviour**: predicate, action and `onUnknown`. ⚠️ `name` is deliberately
 * excluded — renaming a rule does not change what it decides, and a decision taken before the
 * rename was taken by the same rule. The name is denormalised onto the row separately so the
 * log reads as it did at the time.
 */
export function hashRule(rule: Rule): string {
  return hashString(
    canonicalise({
      id: rule.id,
      predicate: rule.predicate,
      action: rule.action,
      onUnknown: rule.onUnknown,
      enabled: rule.enabled,
      dryRun: rule.dryRun,
    }),
  );
}

/**
 * The hash that identifies a whole rule set across restarts, when `version` cannot (BR-26.8).
 *
 * Taken over the **file's text**, not over the parsed rules: it must change when anything about
 * the set changes, including a rule being added, removed or reordered.
 */
export function hashRuleSetContent(fileText: string): string {
  return hashString(fileText);
}
