/**
 * `package.json` is the one source of the app version (U8, P-58, BR-66.1 / BR-66.2).
 *
 * Compose cannot read `package.json`, and a fresh clone must run a plain `docker compose up --build` with no
 * generated file. So the image tag stays a LITERAL in `compose.yaml` and `compose.verify.yaml`, and this test fails
 * unless it equals `package.json`'s version. **A copy CI refuses to let drift is not a second source.**
 *
 * The other half: nothing in `src/` or the committed `secrets/*.example.json` may hold a version literal of its
 * own. That is how `0.1.0` came to live in four places, one of them copied into every install's
 * `musicbrainz.json`, where no release could ever reach it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { isSemVer, readAppVersion } from '../src/version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every `image: spotify-companion:<tag>` in a compose file: local, `ghcr.io/kuhndj67/…`, or as the DEFAULT of a
 * `${VAR:-…}` substitution (U9: compose.verify.yaml's `--candidate` override). The default is what an install runs.
 */
function composeTags(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*image:\s*(?:\$\{[A-Z_]+:-)?(?:ghcr\.io\/kuhndj67\/)?spotify-companion:([^\s}]+)\}?\s*$/gm)].map((m) => m[1] ?? '');
}

/** Quoted `X.Y.Z[-pre]` literals in code, after removing comments (which may legitimately quote one). */
function versionLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...code.matchAll(/(['"`])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\1/g)].map((m) => m[2] ?? '');
}

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

const version = readAppVersion();

describe('the compose image tags equal package.json (P-58)', () => {
  it('package.json holds a valid SemVer', () => {
    assert.ok(isSemVer(version), `package.json version is ${version}`);
  });

  for (const file of ['compose.yaml', 'compose.verify.yaml', 'compose.app.yaml']) {
    it(`${file}: image tag is ${version}`, () => {
      const tags = composeTags(readFileSync(join(root, file), 'utf8'));
      assert.ok(tags.length > 0, `no spotify-companion image line found in ${file} -- did its format change?`);
      assert.deepEqual(tags, tags.map(() => version));
    });
  }

  it('U9: the default of a ${VERIFY_IMAGE:-…} substitution is read, and a stale default is caught', () => {
    assert.deepEqual(composeTags('    image: ${VERIFY_IMAGE:-spotify-companion:0.1.0}\n'), ['0.1.0']);
  });

  it('positive control: a stale tag is caught', () => {
    const stale = 'services:\n  app:\n    image: spotify-companion:0.1.0\n';
    assert.deepEqual(composeTags(stale), ['0.1.0']);
    assert.notEqual(composeTags(stale)[0], version);
  });
});

describe('no second copy of the version (BR-66.2)', () => {
  it('src/ holds no version literal in code', () => {
    const found = filesUnder(join(root, 'src'), '.ts').flatMap((f) =>
      versionLiterals(readFileSync(f, 'utf8')).map((v) => `${relative(root, f)}: ${v}`),
    );
    assert.deepEqual(found, []);
  });

  it('secrets/*.example.json carries no appVersion', () => {
    for (const name of readdirSync(join(root, 'secrets')).filter((n) => n.endsWith('.example.json'))) {
      const parsed = JSON.parse(readFileSync(join(root, 'secrets', name), 'utf8')) as Record<string, unknown>;
      assert.ok(!('appVersion' in parsed), `${name} still has appVersion`);
    }
  });

  it('positive control: a literal in code is found, one in a comment is not', () => {
    const src = [
      "const v = '0.1.0';",
      '/** never `0.1.0` */',
      "// was '0.1.0'",
      "const url = 'http://127.0.0.1:3000';",
      'const pre = "1.0.0-beta.1";',
    ].join('\n');
    assert.deepEqual(versionLiterals(src), ['0.1.0', '1.0.0-beta.1']);
  });
});
