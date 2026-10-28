/**
 * U11 (LC-93, BR-98): the exit test's comparison. ⚙️ PURE.
 *
 * Each side's Diagnostics gives a fingerprint: every table's row count (the same introspected table list a backup
 * manifest carries) and the rules file's content hash. The move passes only if both have **the same table names**,
 * **equal counts** and **equal hashes**; otherwise every difference is listed (BR-98.2).
 *
 * Taken on the server immediately after *Restore backup* and **before** its Spotify credentials are added (BR-98.3):
 * after that, the server records, and the counts move on their own.
 */

export interface CorpusFingerprint {
  /** Every table's row count. */
  readonly counts: Readonly<Record<string, number>>;
  /** SHA-256 of the rules file's bytes, hex; null when there is no rules file. */
  readonly rulesSha256: string | null;
}

export type CorpusComparison = { readonly pass: true } | { readonly pass: false; readonly differences: readonly string[] };

export function compareCorpora(a: CorpusFingerprint, b: CorpusFingerprint): CorpusComparison {
  const differences: string[] = [];
  const tables = [...new Set([...Object.keys(a.counts), ...Object.keys(b.counts)])].sort();
  for (const t of tables) {
    const inA = Object.hasOwn(a.counts, t);
    const inB = Object.hasOwn(b.counts, t);
    if (!inA) differences.push(`table ${t}: only on the second side (${b.counts[t]} rows)`);
    else if (!inB) differences.push(`table ${t}: only on the first side (${a.counts[t]} rows)`);
    else if (a.counts[t] !== b.counts[t]) differences.push(`table ${t}: ${a.counts[t]} rows vs ${b.counts[t]}`);
  }
  if (a.rulesSha256 !== b.rulesSha256) {
    differences.push(`rules file: ${a.rulesSha256 ?? 'none'} vs ${b.rulesSha256 ?? 'none'}`);
  }
  return differences.length === 0 ? { pass: true } : { pass: false, differences };
}
