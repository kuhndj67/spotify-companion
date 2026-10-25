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
 * (BR-62): an agent with only `docs/INSTALL-DEV.md` (or `docs/INSTALL-APP.md`) and a clean machine. A green run of this test says the documents
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
const DOCS = ['README.md', 'docs/INSTALL-DEV.md', 'docs/INSTALL-APP.md', 'docs/INSTALL-SERVER.md', 'docs/claude-start.md', 'docs/ARCHITECTURE.md', 'CONTRIBUTING.md', 'CLAUDE.md'] as const;
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
  const steps = install.split(/^## (?=[SAN]\d+\b)/m).slice(1);
  return steps.flatMap((body) => {
    const id = body.match(/^[SAN]\d+/)?.[0] ?? '?';
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
      // ⚠️ The trailing slash is KEPT: `.gitignore`'s `data/` matches only what git knows is a directory, and in a
      // fresh checkout (CI) `data/` does not exist. Stripping it passed here and failed on CI (2026-10-14).
      const missing = backtickedPaths(read(doc)).filter((p) => !existsSync(join(root, p)) && !gitIgnored(p));
      assert.deepEqual(missing, []);
    });
  }
  it('positive control: a dead link and a dead path are reported; placeholders and ignored paths are not', () => {
    const text = 'see [x](docs/NOPE.md) and [y](https://example.org) and `src/nope.ts` and `secrets/<name>` and `uN-*`';
    assert.deepEqual(relativeLinks(text), ['docs/NOPE.md']);
    assert.deepEqual(backtickedPaths(text), ['src/nope.ts']);
    assert.equal(gitIgnored('secrets/spotify-config.json'), true);
    assert.equal(gitIgnored('src/version.ts'), false);
    assert.equal(gitIgnored('data/'), true, 'a directory pattern must match whether or not data/ exists here');
  });
});

describe('README holds no hand-written counts (P-63 ③)', () => {
  it('README.md', () => {
    assert.deepEqual(handWrittenCounts(read('README.md')), []);
  });
  it('docs/ARCHITECTURE.md', () => {
    assert.deepEqual(handWrittenCounts(read('docs/ARCHITECTURE.md')), []);
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

/**
 * 👤 boxes (added after the U8 cold walk, 2026-10-16): a step only a person can do is a blockquote starting
 * `👤 **YOU DO THIS**`, and an agent shows it word for word. So every box must say what the person should see and what
 * to tell the agent, or the hand-back is improvised, which is what the walk found.
 */
function personBoxesMissingParts(install: string): string[] {
  const lines = install.split(/\r?\n/);
  const problems: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes('👤 **YOU DO THIS**')) return;
    const box: string[] = [];
    for (let j = i; j < lines.length && /^\s*>/.test(lines[j] ?? ''); j += 1) box.push(lines[j] ?? '');
    const text = box.join('\n');
    const title = (line.split('—')[1] ?? line).trim().slice(0, 40);
    if (!text.includes('**You should see:**')) problems.push(`${title}: no "You should see"`);
    if (!text.includes('**When done, tell the agent:**')) problems.push(`${title}: no "When done, tell the agent"`);
  });
  return problems;
}

/**
 * Inside a 👤 box (a blockquote), consecutive lines that are each just a `command` are joined by Markdown into ONE
 * paragraph, so every rendered view shows one unrunnable line. Attempt 3 of the U8 cold walk hit exactly this with
 * the three `winget` lines. Several commands in a box must sit in a fenced block.
 */
function unfencedCommandRuns(install: string): string[] {
  const lines = install.split(/\r?\n/);
  const found: string[] = [];
  let inFence = false;
  const isCmd = (l: string) => /^\s*>\s+`[^`]+`\s*$/.test(l);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i] ?? '';
    if (/^\s*>?\s*```/.test(l)) inFence = !inFence;
    if (!inFence && isCmd(l) && isCmd(lines[i + 1] ?? '')) found.push(`line ${i + 1}: ${l.trim().slice(0, 50)}`);
  }
  return found;
}

describe('no 👤 box holds consecutive commands outside a code block', () => {
  for (const doc of ['docs/INSTALL-DEV.md', 'docs/INSTALL-APP.md', 'docs/INSTALL-SERVER.md']) {
    it(doc, () => {
      assert.deepEqual(unfencedCommandRuns(read(doc)), []);
    });
  }
  it('positive control: the attempt-3 shape is reported, the fenced shape is not', () => {
    const bad = '> 4. install:\n>    `winget install a`\n>    `winget install b`\n';
    const good = '> 4. install:\n>\n>    ```powershell\n>    winget install a\n>    winget install b\n>    ```\n';
    assert.equal(unfencedCommandRuns(bad).length, 1);
    assert.deepEqual(unfencedCommandRuns(good), []);
  });
});

describe('every 👤 box in INSTALL says what to see and what to report', () => {
  it('docs/INSTALL-DEV.md', () => {
    const install = read('docs/INSTALL-DEV.md');
    // 2026-10-21 (going public): S2's sign-in box is gone -- a public repository needs no sign-in.
    assert.ok((install.match(/👤 \*\*YOU DO THIS\*\*/g) ?? []).length >= 7, 'expected the S1, S3–S5, S8 person boxes');
    assert.deepEqual(personBoxesMissingParts(install), []);
  });
  it('docs/INSTALL-SERVER.md', () => {
    const install = read('docs/INSTALL-SERVER.md');
    assert.ok((install.match(/👤 \*\*YOU DO THIS\*\*/g) ?? []).length >= 3, 'expected the N1, N2, N6 person boxes');
    assert.deepEqual(personBoxesMissingParts(install), []);
  });
  it('docs/INSTALL-APP.md', () => {
    const install = read('docs/INSTALL-APP.md');
    // 2026-10-21 (going public): A2 is now a plain download, with no token box.
    assert.ok((install.match(/👤 \*\*YOU DO THIS\*\*/g) ?? []).length >= 5, 'expected the A1, A4–A7 person boxes');
    assert.deepEqual(personBoxesMissingParts(install), []);
  });
  it('positive control: a box without its hand-back line is reported', () => {
    const doc = '> 👤 **YOU DO THIS** — S9 x · needs: y\n> 1. do it\n> **You should see:** z\n\ntext';
    assert.deepEqual(personBoxesMissingParts(doc), ['S9 x · needs: y: no "When done, tell the agent"']);
  });
});

describe('every INSTALL step has its four parts (P-63 ⑤, BR-61.1)', () => {
  it('docs/INSTALL-DEV.md', () => {
    const install = read('docs/INSTALL-DEV.md');
    assert.ok((install.match(/^## S\d+/gm) ?? []).length >= 10, 'expected S1…S10');
    assert.deepEqual(stepsMissingParts(install), []);
  });
  it('docs/INSTALL-APP.md', () => {
    const install = read('docs/INSTALL-APP.md');
    assert.ok((install.match(/^## A\d+/gm) ?? []).length >= 8, 'expected A1…A8');
    assert.deepEqual(stepsMissingParts(install), []);
  });
  it('docs/INSTALL-SERVER.md', () => {
    const install = read('docs/INSTALL-SERVER.md');
    assert.ok((install.match(/^## N\d+/gm) ?? []).length >= 6, 'expected N1…N6');
    assert.deepEqual(stepsMissingParts(install), []);
  });
  it('positive control: a step without "If it differs" is reported', () => {
    const doc = '## S1 — A\n**Purpose** x **Commands** y **Expected** z **If it differs** w\n## S2 — B\n**Purpose** **Commands** **Expected**\n## Updating\n**If it differs**';
    assert.deepEqual(stepsMissingParts(doc), ['S2: **If it differs**']);
  });
});

/**
 * Each install document stands alone (owner, 2026-10-21), so two passages exist in both: the Rancher Desktop install
 * and the Spotify app registration. These lines must stay IDENTICAL, or one document drifts from what was walked.
 */
const SHARED_LINES = [
  'winget install --id SUSE.RancherDesktop -e --source winget --accept-source-agreements --accept-package-agreements',
  'wsl --install --no-distribution',
  'rdctl list-settings | ConvertFrom-Json | ForEach-Object { "engine=$($_.containerEngine.name) kubernetes=$($_.kubernetes.enabled)" }',
  '**Redirect URIs**: exactly `http://127.0.0.1:8888/callback`. Type it, then click **Add**. **Which API/SDKs are',
  'Open <https://developer.spotify.com/dashboard> and sign in. Accept the developer terms if asked.',
];

describe('the passages shared by INSTALL-DEV and INSTALL-APP are identical', () => {
  for (const line of SHARED_LINES) {
    it(`both contain: ${line.slice(0, 60)}…`, () => {
      assert.ok(read('docs/INSTALL-DEV.md').includes(line), 'missing from INSTALL-DEV.md');
      assert.ok(read('docs/INSTALL-APP.md').includes(line), 'missing from INSTALL-APP.md');
    });
  }

  it('INSTALL-APP needs neither Node.js nor git (the walk-1 finding F2)', () => {
    assert.doesNotMatch(read('docs/INSTALL-APP.md'), /OpenJS\.NodeJS|Git\.Git|node --version|git --version/);
  });
});

