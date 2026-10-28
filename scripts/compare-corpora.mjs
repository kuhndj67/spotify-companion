#!/usr/bin/env node
/**
 * U11 (BR-98, LC-93): the exit test's comparison. Read-only.
 *
 *   npm run corpus:compare -- <first.json> <second.json>
 *
 * Each file is a Diagnostics report (`/api/diagnostics`, saved from each deployment) or just its `fingerprint`.
 * Passes only if both have the same tables, equal row counts and the same rules-file hash; otherwise lists every
 * difference and exits 1. Take the server's report right after *Restore backup* and BEFORE adding its Spotify
 * credentials (BR-98.3): after that it records, and the counts move on their own.
 */

import { readFileSync } from 'node:fs';
import { compareCorpora } from '../src/maintenance/corpusFingerprint.js';

function fingerprintFrom(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const f = json.fingerprint ?? json;
  if (typeof f?.counts !== 'object' || f.counts === null) {
    throw new Error(`${path} has no fingerprint (is it a Diagnostics report from U11 or later, with a database open?)`);
  }
  return { counts: f.counts, rulesSha256: f.rulesSha256 ?? null };
}

const [first, second] = process.argv.slice(2);
if (!first || !second) {
  console.error('usage: npm run corpus:compare -- <first.json> <second.json>   (Diagnostics reports, or their fingerprints)');
  process.exit(2);
}

let result;
try {
  result = compareCorpora(fingerprintFrom(first), fingerprintFrom(second));
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (result.pass) {
  console.log('✓ pass: the same tables, equal row counts, the same rules file');
  process.exit(0);
}
console.error(`✗ fail: ${result.differences.length} difference(s)`);
for (const d of result.differences) console.error(`  ${d}`);
process.exit(1);
