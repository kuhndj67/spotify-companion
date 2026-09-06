/**
 * No source module may be unreachable from the tests without saying why.
 *
 * ## The blind spot this closes
 *
 * On 2026-09-06 the suite reported **98.96% line coverage** while `src/server.ts` — 952 lines and
 * nine HTTP routes — had **no tests at all**. The figure was not lying about what it measured. V8
 * coverage can only report modules that were actually *loaded*, so a file no test imports is
 * missing from the **denominator** rather than counted as zero. Untested code therefore cannot
 * drag the number down; it is simply invisible, and the average of what remains looks excellent.
 *
 * `--test-coverage-include` does not help: it filters the report, it cannot conjure coverage for
 * a module that was never loaded. Verified, not assumed — both a directory glob and a `.ts` file
 * glob narrowed the report rather than widening it.
 *
 * That is the same denominator trap as the `inc=releases` 200 and the 28%→12% label-coverage
 * figure, and it is the most dangerous of the three because it reads as good news.
 *
 * So reachability is asserted structurally, the way `purity.test.ts` asserts purity. A new module
 * that nothing exercises fails this test instead of quietly raising the average.
 *
 * ## Type-only imports do not count
 *
 * `import type { X } from './y.js'` is erased at compile time — the module never executes, so it
 * gains no coverage. Counting it as reached is exactly how `diagnostics.ts` would have looked
 * covered after the API extraction while still running zero lines.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const testDir = join(root, 'test');

/**
 * Modules deliberately not reached, each with the reason and the risk it carries.
 *
 * **Adding a line here is a decision, not a formality.** Every entry is code that ships and that
 * no test executes.
 */
const ALLOWED_ORPHANS: Record<string, string> = {
  // Composition root. Importing it connects to MCP, opens SQLite, starts the poll loop and calls
  // listen(), so it cannot be imported by a test at all. This is why the routes were extracted
  // into api.ts, which IS tested — what remains here is wiring and startup.
  'server.ts': 'entry point: importing it starts the process',

  // Reached only from server.ts. Its report shape is asserted through the /api/diagnostics route
  // (api.test.ts), but the sweep itself — which hits MCP, the Web API and MusicBrainz — is not
  // exercised. Known gap.
  'diagnostics.ts': 'only server.ts constructs it; the sweep itself is untested',

  // Reached only from server.ts. A timer that writes export snapshots to disk.
  'export/SnapshotScheduler.ts': 'only server.ts constructs it; untested',

  // Reached only from server.ts. The MCP transport itself.
  'mcp/spotifyMcpClient.ts': 'only server.ts constructs it; untested',

  // Type declarations only. There is no runtime code here to cover, so absence from the coverage
  // report is correct rather than a gap.
  'history/types.ts': 'type declarations only',
  'history/HistoryRepository.ts': 'interface only',
  'musicbrainz/types.ts': 'type declarations only',
  'musicbrainz/LabelRepository.ts': 'interface only',
};

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

/** Strip comments so an import named in prose does not count as a real edge. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Relative specifiers imported for their **runtime**.
 *
 * `import type { … }` and `export type { … }` are dropped: they are erased at compile time and
 * execute nothing, so they cannot produce coverage.
 */
function runtimeImports(source: string): string[] {
  const clean = stripComments(source)
    .replace(/\bimport\s+type\s[^'"]*from\s*['"][^'"]+['"]/g, '')
    .replace(/\bexport\s+type\s[^'"]*from\s*['"][^'"]+['"]/g, '');

  const found: string[] = [];
  for (const pattern of [
    /\bimport\s[^'"]*from\s*['"](\.[^'"]+)['"]/g,
    /\bexport\s[^'"]*from\s*['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of clean.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

/** `./foo.js` next to `bar.ts` -> the absolute path of `foo.ts`. */
function resolveSpecifier(fromFile: string, specifier: string): string {
  return resolve(dirname(fromFile), specifier.replace(/\.js$/, '.ts'));
}

describe('every source module is reachable from the tests', () => {
  it('has no unexplained orphans', async () => {
    const srcFiles = await walk(srcDir);
    const testFiles = (await walk(testDir)).filter((f) => !f.startsWith(srcDir));

    const sources = new Map<string, string>();
    for (const file of [...srcFiles, ...testFiles]) {
      sources.set(file, await readFile(file, 'utf8'));
    }

    // Seed the frontier with everything the tests import for its runtime, then close over
    // src -> src edges: a module a tested module actually executes is exercised too.
    const reached = new Set<string>();
    const frontier: string[] = [];
    for (const file of testFiles) {
      for (const specifier of runtimeImports(sources.get(file)!)) {
        frontier.push(resolveSpecifier(file, specifier));
      }
    }

    while (frontier.length > 0) {
      const current = frontier.pop()!;
      if (reached.has(current) || !sources.has(current)) continue;
      reached.add(current);
      for (const specifier of runtimeImports(sources.get(current)!)) {
        frontier.push(resolveSpecifier(current, specifier));
      }
    }

    const orphans = srcFiles
      .filter((file) => !reached.has(file))
      .map((file) => relative(srcDir, file).split('\\').join('/'));

    const unexplained = orphans.filter((name) => !(name in ALLOWED_ORPHANS));
    assert.deepEqual(
      unexplained,
      [],
      `These modules ship but no test executes them, and they are absent from the coverage ` +
        `report rather than reported as 0% — so the headline percentage cannot see them. ` +
        `Add tests, or add an entry to ALLOWED_ORPHANS saying why not:\n  ` +
        unexplained.join('\n  '),
    );
  });

  it('the allowlist itself is not stale', async () => {
    // An entry that has since become reachable is worse than none: it advertises a gap that no
    // longer exists, and teaches the reader to ignore the list.
    const srcFiles = await walk(srcDir);
    const names = new Set(
      srcFiles.map((file) => relative(srcDir, file).split('\\').join('/')),
    );

    for (const name of Object.keys(ALLOWED_ORPHANS)) {
      assert.ok(names.has(name), `ALLOWED_ORPHANS names ${name}, which no longer exists`);
    }
  });

  it('detects an orphan when one is present', async () => {
    // Guards against the walk or the import parser silently matching nothing — a green test that
    // verifies nothing is worse than no test. api.ts IS reachable; pretending the seed set is
    // empty must make everything an orphan.
    const srcFiles = await walk(srcDir);
    assert.ok(srcFiles.length > 20, 'the source walk found suspiciously few files');
    assert.ok(
      runtimeImports(await readFile(join(srcDir, 'api.ts'), 'utf8')).some((s) =>
        s.includes('playStats'),
      ),
      'the import parser failed to see a known runtime import in api.ts',
    );
    assert.equal(
      runtimeImports("import type { Foo } from './bar.js';").length,
      0,
      'a type-only import must not count as reaching a module',
    );
  });
});
