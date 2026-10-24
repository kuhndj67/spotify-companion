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
  // Decides WHO ended a skip. A clock or a query here would make the judgement depend on when
  // it was asked, and FR-20's whole point is that it can be re-derived from the trail later.
  'history/skipAttribution.ts',
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
  // U5's UI judgement, and the reason is SPECIFIC rather than general: the documented worst case
  // for a kill switch is one that "works in the UI and does not persist". Nothing in here reads
  // client state — every function takes what the server read back from disk.
  'ui/automationPanel.ts',
  // ─── U5 ──────────────────────────────────────────────────────────────────────────────────────
  // The action-point vocabulary. No runtime behaviour beyond two pre-registered constants, and
  // keeping it pure is what stops the safety limits acquiring a config read.
  'playback/types.ts',
  // ⚠️ DECIDES WHETHER A SKIP MAY FIRE. A Date.now() or a file read here would make a SAFETY
  // decision depend on when it was asked, and PBT-40's sixteen-combination table would stop being
  // enumerable — the live path cannot produce "automation on, rule disabled, halt set" on demand.
  'playback/automationPredicate.ts',
  // ⚠️ DECIDES WHETHER AUTOMATION HALTS. `now` is a parameter for the same reason playStats.ts
  // takes one: a rolling window anchored on an ambient clock is untestable at exactly the boundary
  // that goes wrong. A clock here would also make the halt un-reproducible after the fact.
  'playback/safetyCounters.ts',
  // ⚠️ M1–M4's aggregation. It holds mutable records, which is not the same as being impure: every
  // window is a function of `(records, nowMs)` and `nowMs` is a PARAMETER. PBT-50 asserts that the
  // answer moves when the parameter moves; this is what stops a `Date.now()` being added inside, which
  // would make the metric that proves this app is well-behaved untestable at a window boundary.
  'playback/upstreamMetrics.ts',
  // The line a person reads all day to judge their rules. A clock or a lookup here would make
  // the log disagree with the row it reports.
  'rules/decisionSummary.ts',
  // U5. Builds decision-log rows for BOTH executors. A clock or a state read here would make the
  // two disagree about the same decision, and `dryRun` is deliberately a PARAMETER so that the
  // automation state never has to reach this far down (BR-30.2).
  'rules/decisionRows.ts',
  // Calendar bucketing for reports and charts. A system-zone read here would misdate half the
  // corpus by a day (measured: 327 of 662) while every test still passed — so every function
  // takes its zone as an argument and there is no default.
  'reporting/timeBuckets.ts',
  // ─── U6 ──────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ FR-64's admission core. These DECIDE whether a file from outside may be written, and under which
  // name. A filesystem read or a clock here would make the decision depend on something other than the
  // entry, and PBT-51/52/57 could no longer throw generated hostile archives at it.
  'ingest/types.ts',
  'ingest/entryPolicy.ts',
  'ingest/admitIngest.ts',
  // Diagnostics' Maintenance block. Extracted so it is testable at all; pure so it judges only what it is given.
  'maintenance/maintenanceDiagnostics.ts',
  // ─── U7 ──────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ DECIDES what the user is warned about before a rules write — "becomes live", "mass removal". A file
  // read here would make the comparison describe a different set from the one being confirmed.
  'configuration/rulesComparison.ts',
  // Never receives a secret; pure so PBT-62 can bound what it reveals for ANY input.
  'configuration/masking.ts',
  // Decides whether Spotify's answer is a failure (FR-71). Pure so PBT-66 can hold it against the server's source.
  'configuration/mcpErrorText.ts',
  // Diagnostics' Configuration block (IN-U7-6). Pure so a writability answer is judged only as given.
  'configuration/configurationDiagnostics.ts',
  // U7's UI judgement — what a rules change and a credentials section SAY. Decided here because app.js has no tests.
  'ui/rulesFilePanel.ts',
  'ui/credentialsPanel.ts',
  // ⚠️ What the surface that can REPLACE the corpus says. app.js cannot be tested; this can, so it decides.
  'ui/maintenancePanel.ts',
  // ─── U10 ─────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ DECIDES whether another process is alive (P-76). A clock read here would judge the lock by age — the
  // exact mistake the pattern exists to avoid: a just-killed container's lock looks fresh.
  'lock/lockDecision.ts',
  // ─── U11 ─────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ DECIDES whether the app serves at all in server mode (P-89). It is handed what the shell found; a file or
  // environment read here would make PBT-92 test a different configuration from the one judged at startup.
  'access/accessConfig.ts',
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
  // ⚠️ `new Intl.DateTimeFormat(locale)` with no `timeZone` silently uses the SYSTEM zone, so the
  // same play buckets differently on two machines while every test still passes. Added 2026-09-22
  // with reporting/timeBuckets.ts, where the wrong zone misdates 49% of plays by a day.
  {
    pattern: /Intl\.DateTimeFormat\s*\(\s*\)/,
    what: 'Intl.DateTimeFormat() with no options - reads the system time zone',
  },
  {
    pattern: /resolvedOptions\s*\(\s*\)\s*\.\s*timeZone/,
    what: 'resolvedOptions().timeZone - reads the system time zone',
  },
];

/** Strip comments so documentation *about* impurity does not trip the check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Is this the environment module `config.ts`? Matched on the MODULE NAME, not on the substring "config".
 *
 * ⚠️ Changed in U7 (2026-10-08): this was `imported.includes('config')`, which also matched U7's new `configuration/`
 * folder — a type-only import of `../configuration/rulesComparison.js` failed as "imports config". Narrowed to the
 * name so `../config.js` is still refused; `the check itself works` below pins both directions.
 */
function importsConfig(imported: string): boolean {
  return /(^|\/)config(\.[jt]s)?$/.test(imported);
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
          !importsConfig(imported),
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
  it('still refuses the environment module, and no longer mistakes configuration/ for it (U7)', () => {
    assert.equal(importsConfig('../config.js'), true);
    assert.equal(importsConfig('./config.js'), true);
    assert.equal(importsConfig('../config'), true);
    assert.equal(importsConfig('../configuration/rulesComparison.js'), false);
    assert.equal(importsConfig('./configurationDiagnostics.js'), false);
  });

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
