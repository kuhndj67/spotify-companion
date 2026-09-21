/**
 * Purity enforcement (NFR Design P-9 / LC-6).
 *
 * ## Why this test exists
 *
 * A `Date.now()` inside `outcomeClassifier` would break **FR-20** (reclassification stops being
 * reproducible — the same trail could yield different verdicts on different days) and **FR-42**
 * (back-testing stops replaying live behaviour) **while passing every other test in this suite**.
 *
 * It is the design's most likely silent failure: nothing goes red, and the damage only becomes
 * visible when someone tries to re-analyse a year of history and the numbers disagree with what
 * was originally recorded.
 *
 * A static import check is the only thing that actually catches it, and it is cheap.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Modules whose correctness is a property of their inputs alone. Every one of these is either
 * property-tested, replayed during reclassification, or both.
 */
const PURE_MODULES = [
  'history/outcomeClassifier.ts',
  'history/types.ts',
  // The trend window is a function of `now` — passed in, never read. A Date.now() here would
  // make the chart untestable at exactly the boundary that goes wrong, the week seam.
  'history/playStats.ts',
  'export/serialisers.ts',
  'mcp/parseNowPlaying.ts',
  // U2. labelClassifier decides the independent variable the promotion hypothesis rests on:
  // a Date.now() here breaks FR-42 while every other test still passes (BR-4.8).
  'musicbrainz/types.ts',
  'musicbrainz/majorRootList.ts',
  'musicbrainz/isrcPrefix.ts',
  'musicbrainz/releaseNarrowing.ts',
  'musicbrainz/labelClassifier.ts',
  'musicbrainz/resolutionTrace.ts',
  // U3. The rules core. A Date.now() or a database read in any of these would break FR-20
  // recomputation and FR-42 back-testing while every other test still passed — the same silent
  // failure this file was written for. RuleStore.ts is deliberately absent: it is the unit's
  // impure boundary, and it reads a file on purpose (P-12).
  'rules/types.ts',
  'rules/fieldCatalogue.ts',
  'rules/trackFacts.ts',
  'rules/predicate.ts',
  'rules/ruleValidator.ts',
  'rules/RuleEngine.ts',
  // U4. `factReconstructor` decides what a back-test SEES, so a clock or a query here would
  // break NFR-26's determinism while every other test passed — and the drift would appear
  // months later as unexplained back-test movement, not as a failure.
  'rules/factReconstructor.ts',
  // Renders a decision that already happened. A clock or a lookup here would let the trace
  // disagree with the row it claims to explain — which is worse than no trace.
  'rules/decisionTrace.ts',
  'rules/rulesDiagnostics.ts',
  'rules/ruleHash.ts',
  // U4's UI judgement. ⚠️ This is where a false green would come from, so it lives in src/
  // and is tested; `public/app.js` has no tests and is outside the orphan check.
  'ui/statusBar.ts',
];

/**
 * Node builtins that reach the world. A pure module importing any of these has stopped being a
 * function of its arguments.
 */
const IMPURE_MODULES = [
  'node:fs',
  'node:fs/promises',
  'node:sqlite',
  'node:net',
  'node:http',
  'node:https',
  'node:child_process',
  'node:os',
  'node:process',
  'node:crypto',
  'node:timers',
  'node:stream',
  'express',
  'ws',
];

/** Ambient sources of non-determinism, used without an import. */
const IMPURE_GLOBALS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bDate\.now\s*\(/, what: 'Date.now()' },
  { pattern: /\bnew\s+Date\s*\(\s*\)/, what: 'new Date() with no argument' },
  { pattern: /\bMath\.random\s*\(/, what: 'Math.random()' },
  { pattern: /\bprocess\.env\b/, what: 'process.env' },
  { pattern: /\bfetch\s*\(/, what: 'fetch()' },
  { pattern: /\bsetTimeout\s*\(|\bsetInterval\s*\(/, what: 'timers' },
];

/** Strip comments so documentation *about* impurity does not trip the check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function importedModules(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s[^'"]*from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

describe('pure modules import nothing impure', () => {
  for (const relative of PURE_MODULES) {
    it(`${relative} has no impure imports`, async () => {
      const source = stripComments(await readFile(join(srcDir, relative), 'utf8'));

      for (const imported of importedModules(source)) {
        assert.ok(
          !IMPURE_MODULES.includes(imported),
          `${relative} imports "${imported}". Pure modules must be functions of their arguments — ` +
            `see FR-20 and FR-42, which this would break silently.`,
        );
        assert.ok(
          !imported.includes('config'),
          `${relative} imports config. Parameters must be passed in, not read: reclassification ` +
            `must not depend on deployment state.`,
        );
      }
    });

    it(`${relative} uses no ambient impurity`, async () => {
      const source = stripComments(await readFile(join(srcDir, relative), 'utf8'));

      for (const { pattern, what } of IMPURE_GLOBALS) {
        assert.ok(
          !pattern.test(source),
          `${relative} uses ${what}. The same input must always produce the same output, or ` +
            `FR-20's reclassification is not reproducible.`,
        );
      }
    });
  }
});

describe('the check itself works', () => {
  it('detects an impure import when one is present', async () => {
    // Guards against the check silently passing because its patterns stopped matching — a green
    // test that verifies nothing is worse than no test.
    const impure = stripComments(await readFile(join(srcDir, 'history/SqliteHistoryRepository.ts'), 'utf8'));
    const imports = importedModules(impure);
    assert.ok(
      imports.some((name) => IMPURE_MODULES.includes(name)),
      'the detector failed to see node:sqlite in the SQLite repository',
    );
  });

  it('detects ambient impurity when it is present', async () => {
    // `SqliteHistoryRepository.recordGap` calls `new Date()` with no argument, which is exactly
    // the kind of ambient non-determinism the pure modules must not contain.
    const impure = stripComments(
      await readFile(join(srcDir, 'history/SqliteHistoryRepository.ts'), 'utf8'),
    );
    assert.ok(
      IMPURE_GLOBALS.some(({ pattern }) => pattern.test(impure)),
      'the detector failed to see new Date() in the repository',
    );
  });
});
