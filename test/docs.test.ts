/**
 * The documents make no claim this can check and find false (U8, P-63, BR-67.5).
 *
 * ## What it checks
 *
 *   1. every `npm run <x>` in README, INSTALL, CONTRIBUTING and CLAUDE.md is a script in `package.json`;
 *   2. every relative markdown link, and every backticked repository path, resolves (gitignored paths such as
 *      `secrets/spotify-config.json` are skipped: they exist only on an install, never in a checkout);
 *   3. `README.md` holds no hand-written counts (tests, plays, units…). The old 463-line README is the proof of how
 *      those decay: it described a "walking skeleton" for an app with five delivered units;
 *   4. `CLAUDE.md` is at most 200 lines (BR-67.3);
 *   5. every INSTALL step has BR-61.1's four parts: **Purpose**, **Commands**, **Expected**, **If it differs**.
 *
 * ## ⚠️ What it CANNOT check
 *
 * Whether a command's **output** still matches what a document says it prints. That is the cold walk's job
 * (BR-62): an agent with only `docs/INSTALL.md` and a clean machine. A green run of this test says the documents
 * are internally consistent with the repository; it does not say the install works. A docs test that claimed more
 * would be the decorative guard this project keeps warning about.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['README.md', 'docs/INSTALL.md', 'CONTRIBUTING.md', 'CLAUDE.md'] as const;
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const scripts = new Set(Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts));

function npmRunNames(text: string): string[] {
  return [...text.matchAll(/npm run ([a-z0-9][a-z0-9:_-]*)/g)].map((m) => m[1] ?? '');
}

/** Relative link targets, without `#anchor`. External, mailto and pure-anchor links are not ours to resolve. */
function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1] ?? '')
    .filter((t) => !/^(https?:|mailto:|#)/.test(t))
    .map((t) => t.split('#')[0] ?? '')
    .filter(Boolean);
}

const REPO_ROOTS = /^(?:src|scripts|test|docs|aidlc-docs|public|config|secrets|state|data|reporting|\.github)\//;

/** Backticked tokens that name a concrete repository path. Placeholders (`<x>`, `uN-*`, `…`) are not concrete. */
function backtickedPaths(text: string): string[] {
  return [...text.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1] ?? '')
    .filter((t) => REPO_ROOTS.test(t) && !/[<>*{}…]/.test(t));
}

function gitIgnored(rel: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: root, stdio: 'ignore' });
    return true; // exit 0 = ignored
  } catch {
    return false;
  }
}

function handWrittenCounts(text: string): string[] {
  return [...text.matchAll(/\b\d[\d,]*\s+(?:tests?|plays?|units?|commits?|FRs?|NFRs?|stories|rules|requirements)\b/gi)].map(
    (m) => m[0],
  );
}

/** INSTALL steps (`## S<n> — …`) missing any of the four parts. */
function stepsMissingParts(install: string): string[] {
  const parts = ['**Purpose**', '**Commands**', '**Expected**', '**If it differs**'];
  const steps = install.split(/^## (?=S\d+\b)/m).slice(1);
  return steps.flatMap((body) => {
    const id = body.match(/^S\d+/)?.[0] ?? '?';
    const section = body.split(/^## /m)[0] ?? '';
    return parts.filter((p) => !section.includes(p)).map((p) => `${id}: ${p}`);
  });
}

describe('documents name only commands that exist (P-63 ①)', () => {
  for (const doc of DOCS) {
    it(`${doc}: every npm run is in package.json`, () => {
      assert.deepEqual(npmRunNames(read(doc)).filter((n) => !scripts.has(n)), []);
    });
  }
  it('positive control: an invented script is reported', () => {
    assert.deepEqual(npmRunNames('run `npm run verify` then `npm run deploy:prod`').filter((n) => !scripts.has(n)), ['deploy:prod']);
  });
});

describe('documents link only to things that exist (P-63 ②)', () => {
  for (const doc of DOCS) {
    it(`${doc}: relative links resolve`, () => {
      const base = dirname(join(root, doc));
      assert.deepEqual(relativeLinks(read(doc)).filter((t) => !existsSync(resolve(base, t))), []);
    });
    it(`${doc}: backticked repository paths resolve (gitignored ones skipped)`, () => {
      const missing = backtickedPaths(read(doc)).filter((p) => !existsSync(join(root, p)) && !gitIgnored(p.replace(/\/$/, '')));
      assert.deepEqual(missing, []);
    });
  }
  it('positive control: a dead link and a dead path are reported; placeholders and ignored paths are not', () => {
    const text = 'see [x](docs/NOPE.md) and [y](https://example.org) and `src/nope.ts` and `secrets/<name>` and `uN-*`';
    assert.deepEqual(relativeLinks(text), ['docs/NOPE.md']);
    assert.deepEqual(backtickedPaths(text), ['src/nope.ts']);
    assert.equal(gitIgnored('secrets/spotify-config.json'), true);
    assert.equal(gitIgnored('src/version.ts'), false);
  });
});

describe('README holds no hand-written counts (P-63 ③)', () => {
  it('README.md', () => {
    assert.deepEqual(handWrittenCounts(read('README.md')), []);
  });
  it('positive control: the old README shape is caught', () => {
    assert.deepEqual(handWrittenCounts('1,565 tests passing · 977 plays · five units, 7 units'), ['1,565 tests', '977 plays', '7 units']);
  });
});

describe('CLAUDE.md is short (P-63 ④, BR-67.3)', () => {
  it('at most 200 lines', () => {
    const lines = read('CLAUDE.md').split('\n').length;
    assert.ok(lines <= 200, `CLAUDE.md is ${lines} lines`);
  });
});

describe('every INSTALL step has its four parts (P-63 ⑤, BR-61.1)', () => {
  it('docs/INSTALL.md', () => {
    const install = read('docs/INSTALL.md');
    assert.ok((install.match(/^## S\d+/gm) ?? []).length >= 10, 'expected S1…S10');
    assert.deepEqual(stepsMissingParts(install), []);
  });
  it('positive control: a step without "If it differs" is reported', () => {
    const doc = '## S1 — A\n**Purpose** x **Commands** y **Expected** z **If it differs** w\n## S2 — B\n**Purpose** **Commands** **Expected**\n## Updating\n**If it differs**';
    assert.deepEqual(stepsMissingParts(doc), ['S2: **If it differs**']);
  });
});
