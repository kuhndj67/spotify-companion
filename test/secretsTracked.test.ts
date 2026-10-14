/**
 * No credential file is ever tracked, and no scanner exception is ever silent (U8, BR-64.3 / BR-64.4, NFR-28).
 *
 * ## Why a test as well as gitleaks
 *
 * gitleaks finds what its PATTERNS recognise. NFR-28's rule is structural -- *nothing under `secrets/` is tracked
 * except the `*.example.json` templates* -- and a real config with an unusual token shape would pass the scanner
 * and still break that rule. So the rule is checked directly against `git ls-files`, independent of any pattern.
 *
 * ## Why every allow-list entry needs a reason
 *
 * An allow-list entry with no explanation is indistinguishable from someone silencing a real finding. The
 * `ALLOWED_ORPHANS` precedent (noOrphanModules.test.ts): an exception is allowed only WITH its reason.
 *
 * Both checks are pure functions over their input, so each has a positive control below -- a check that could
 * never fail would pass these tests just as well as a correct one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Tracked paths under `secrets/` that are not `*.example.json`. */
function forbiddenTrackedSecrets(trackedPaths: readonly string[]): string[] {
  return trackedPaths.filter((p) => p.startsWith('secrets/') && !/^secrets\/[^/]+\.example\.json$/.test(p));
}

/** Indices (1-based) of `[[allowlists]]` blocks in a gitleaks TOML that have no non-empty `description`. */
function allowlistsWithoutReason(toml: string): number[] {
  const blocks = toml.split(/^\[\[allowlists\]\]\s*$/m).slice(1);
  const missing: number[] = [];
  blocks.forEach((block, i) => {
    const body = block.split(/^\[/m)[0] ?? ''; // stop at the next table
    const m = /^description\s*=\s*(?:"([^"]*)"|'([^']*)')/m.exec(body);
    if (!m || (m[1] ?? m[2] ?? '').trim() === '') missing.push(i + 1);
  });
  return missing;
}

describe('secrets/ holds only example templates in git (BR-64.3)', () => {
  it('no tracked file under secrets/ other than *.example.json', () => {
    const out = execFileSync('git', ['ls-files', '-z', '--', 'secrets'], { cwd: root, encoding: 'utf8' });
    const tracked = out.split('\0').filter(Boolean);
    assert.ok(tracked.length > 0, 'expected the example templates to be tracked -- an empty list proves nothing');
    assert.deepEqual(forbiddenTrackedSecrets(tracked), []);
  });

  it('positive control: a tracked real config is refused', () => {
    assert.deepEqual(
      forbiddenTrackedSecrets([
        'secrets/musicbrainz.example.json',
        'secrets/spotify-config.json',
        'secrets/sub/x.example.json',
        'src/secrets/ok.ts',
      ]),
      ['secrets/spotify-config.json', 'secrets/sub/x.example.json'],
    );
  });
});

describe('every gitleaks allow-list entry states its reason (BR-64.4)', () => {
  it('.gitleaks.toml: no entry without a description', () => {
    const toml = readFileSync(join(root, '.gitleaks.toml'), 'utf8');
    assert.match(toml, /^\[\[allowlists\]\]/m, 'expected at least one entry -- the 2026-10-14 scan allow-listed two');
    assert.deepEqual(allowlistsWithoutReason(toml), []);
  });

  it('positive control: entries with a missing or empty description are reported', () => {
    const toml = [
      '[extend]',
      'useDefault = true',
      '[[allowlists]]',
      'description = "a reason"',
      "regexes = ['''^x$''']",
      '[[allowlists]]',
      "regexes = ['''^y$''']",
      '[[allowlists]]',
      'description = "  "',
      "regexes = ['''^z$''']",
    ].join('\n');
    assert.deepEqual(allowlistsWithoutReason(toml), [2, 3]);
  });
});
