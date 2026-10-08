/**
 * Every property obligation the design documents declare is referenced by at least one test.
 *
 * ## ⚠️ Why this is worth a test rather than a careful read
 *
 * The obligations live in `logical-components.md` as a table — **PBT-34 … PBT-50** for U5, and
 * PBT-01 … PBT-33 for the units before it. Nothing connected that table to the suite, so an obligation
 * could be declared, never implemented, and still look discharged: the plan's checkbox gets ticked
 * because the behaviour is covered *somewhere*, and the next person cannot find out which test covers
 * which clause without re-reading everything.
 *
 * ⚠️ **That is exactly what happened in step 12.** PBT-35, PBT-36 and PBT-38 were behaviourally covered
 * by `skipDrain.test.ts`'s refusal table and `automationPredicate.test.ts`'s sixteen-row enumeration, and
 * **named by nothing**. The behaviour was right; the traceability was absent, and an obligation nobody
 * can locate is one nobody re-checks when the code around it changes.
 *
 * ## ⚠️ What this test does NOT claim
 *
 * **It checks a reference exists, not that the reference is honest.** A comment saying `PBT-41` above a
 * test that asserts nothing would satisfy this. That is a real limit and it is stated rather than papered
 * over — the defence against a hollow label is review, and `logical-components.md` records what each
 * obligation has to prove.
 *
 * What it does catch is the thing that actually happens: an obligation written in a design document and
 * then forgotten, which is the `recordSuccessorLag` shape with the paperwork reversed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TEST_DIR = join(ROOT, 'test');

/**
 * Design documents that declare obligations.
 *
 * ⚠️ Listed explicitly rather than globbed over `aidlc-docs/`, because the audit log and the plans
 * *discuss* obligations at length without declaring them — and a test that read those would demand a
 * test for every PBT ever mentioned in a correction.
 */
const SOURCES = [
  'aidlc-docs/construction/u5-automated-skipping/nfr-design/logical-components.md',
  // U6 — PBT-51…PBT-58 (2026-10-07).
  'aidlc-docs/construction/u6-data-lifecycle/nfr-design/logical-components.md',
];

/** Obligations whose home is a document, not a test — each needs a reason. */
const NOT_IN_THE_SUITE: Record<string, string> = {
  // No U5 obligation currently falls in this category. Entries here must say why a property cannot be
  // asserted by code -- a live probe, a human judgement -- never merely that it has not been done yet.
};

function declaredIn(relative: string): string[] {
  const text = readFileSync(join(ROOT, relative), 'utf8');
  // Only the table's own label column: `| **PBT-34** |`. A prose mention is not a declaration.
  return [...text.matchAll(/\|\s*\*\*(PBT-\d+[a-z]?)\*\*\s*\|/g)].map((m) => m[1]!);
}

/**
 * ⚠️ **THIS FILE IS EXCLUDED FROM ITS OWN SEARCH, and that is not tidiness.**
 *
 * The docstring above names PBT-35, PBT-36 and PBT-38 while explaining why they needed labels.
 * Without this exclusion, deleting those labels from the tests that actually discharge them would
 * leave this check **still green**, satisfied by its own prose — a guard that passes by reading itself.
 *
 * Same family as *a guard computed the same way as the thing it guards is not a guard*, and as the lock
 * probe that could not see the container: a check whose input includes its own output reports success
 * exactly when it is useless. The test below proves the exclusion is in force.
 */
const SELF = 'propertyObligations.test.ts';

function suiteFiles(): string[] {
  return readdirSync(TEST_DIR).filter((name) => name.endsWith('.ts') && name !== SELF);
}

function suiteText(): string {
  return suiteFiles()
    .map((name) => readFileSync(join(TEST_DIR, name), 'utf8'))
    .join('\n');
}

describe('⭐ every declared property obligation is named by a test', () => {
  for (const source of SOURCES) {
    it(`${source.split('/').pop()} — all of its PBTs are referenced`, () => {
      const declared = [...new Set(declaredIn(source))];
      assert.ok(declared.length > 0, 'the table must still be parseable — did its format change?');

      const suite = suiteText();
      const missing = declared.filter(
        (id) => !(id in NOT_IN_THE_SUITE) && !referenced(suite, id),
      );

      assert.deepEqual(
        missing,
        [],
        `These obligations are declared in ${source} and named by no test. The behaviour may well ` +
          `be covered — PBT-35, PBT-36 and PBT-38 all were — but an obligation nobody can locate is ` +
          `one nobody re-checks. Add the label to the test that discharges it, or an entry in ` +
          `NOT_IN_THE_SUITE with a reason:\n  ${missing.join('\n  ')}`,
      );
    });
  }

  it('⭐ ⚠️ does not count its OWN prose as a reference', () => {
    // This file names PBT-35, PBT-36 and PBT-38 in its docstring while explaining why they needed
    // labels. If it searched itself, removing those labels from the real tests would leave this check
    // green -- a guard satisfied by its own output. Asserted two ways: the file is excluded, and the
    // labels are genuinely present somewhere else.
    assert.ok(!suiteFiles().includes(SELF), 'the exclusion must be in force');
    const own = readFileSync(join(TEST_DIR, SELF), 'utf8');
    assert.ok(own.includes('PBT-35'), 'this file really does mention it, so the risk is real');

    const suite = suiteText();
    for (const id of ['PBT-35', 'PBT-36', 'PBT-38']) {
      assert.ok(referenced(suite, id), `${id} must be named by a test OTHER than this one`);
    }
  });

  it('⚠️ and the suffixed ones are not satisfied by their prefix', () => {
    // `PBT-34a` is a POSITIVE CONTROL: with all four terms true, the attempt does post. A plain
    // `includes('PBT-34')` would be satisfied by PBT-34 alone -- and PBT-34 through PBT-39 would all
    // pass against a drain that posted nothing, ever, which is the whole reason 34a exists.
    const suite = suiteText();
    for (const id of ['PBT-34a', 'PBT-46a']) {
      assert.ok(referenced(suite, id), `${id} must be named in its own right`);
    }
  });
});

/**
 * ⚠️ Word-boundary matching, not `includes`.
 *
 * `includes('PBT-4')` matches `PBT-41`, and `includes('PBT-34')` matches `PBT-34a` — so a naive check
 * would report an obligation as discharged by a test for a different one. Same family as the genre
 * matcher, where plain substring matching made `contains "rap"` also match `trap latino`.
 */
function referenced(suite: string, id: string): boolean {
  return new RegExp(`\\b${id.replace('-', '-')}\\b(?![0-9a-z])`).test(suite);
}

describe('the obligations table itself stayed readable', () => {
  it('declares the U5 range PBT-34 … PBT-50 with no gaps', () => {
    // A gap would mean a row was deleted rather than discharged -- and the plan's checkbox says
    // "PBT-34 … PBT-50", so a missing number silently narrows what that line covers.
    const declared = new Set(declaredIn(SOURCES[0]!).map((id) => id.replace(/[a-z]$/, '')));
    const gaps: string[] = [];
    for (let n = 34; n <= 50; n += 1) {
      if (!declared.has(`PBT-${n}`)) gaps.push(`PBT-${n}`);
    }
    assert.deepEqual(gaps, [], `declared nowhere in the table: ${gaps.join(', ')}`);
  });
});
