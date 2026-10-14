/**
 * The one version reader (U8, LC-49, P-59) — PBT-72, plus its positive control.
 *
 * ⚠️ A reader that returned `'unknown'` for EVERYTHING would satisfy PBT-72 perfectly. So the positive control is
 * not optional: every valid SemVer, pre-releases included, must come back unchanged (the PBT-34a lesson).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { UNKNOWN_VERSION, isSemVer, parseAppVersion, readAppVersion } from '../src/version.js';

const num = fc.nat({ max: 9999 }).map(String);
const identifier = fc.oneof(
  num,
  fc.stringMatching(/^[0-9A-Za-z-]{0,6}[A-Za-z-][0-9A-Za-z-]{0,6}$/),
);
/** Valid SemVer 2.0.0: core, optional pre-release, optional build metadata. */
const validSemVer = fc
  .tuple(num, num, num, fc.option(fc.array(identifier, { minLength: 1, maxLength: 3 })), fc.option(fc.array(fc.stringMatching(/^[0-9A-Za-z-]{1,8}$/), { minLength: 1, maxLength: 2 })))
  .map(([a, b, c, pre, build]) => `${a}.${b}.${c}${pre ? `-${pre.join('.')}` : ''}${build ? `+${build.join('.')}` : ''}`);

describe('PBT-72 — anything that is not a valid version reads as `unknown`, never a throw, never 0.1.0', () => {
  it('arbitrary text in place of package.json', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const v = parseAppVersion(text);
        assert.ok(v === UNKNOWN_VERSION || isSemVer(v));
      }),
    );
  });

  it('valid JSON whose `version` is missing, not a string, or not SemVer', () => {
    const notAVersion = fc.oneof(
      fc.constant(undefined),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.string(), { maxLength: 2 }),
      fc.string().filter((s) => !isSemVer(s)),
    );
    fc.assert(
      fc.property(notAVersion, fc.dictionary(fc.string({ maxLength: 6 }), fc.string({ maxLength: 6 }), { maxKeys: 3 }), (version, rest) => {
        const doc = version === undefined ? { ...rest, version: undefined } : { ...rest, version };
        assert.equal(parseAppVersion(JSON.stringify(doc)), UNKNOWN_VERSION);
      }),
    );
  });

  it('non-object JSON (array, number, string, null)', () => {
    for (const text of ['[]', '42', '"0.8.0"', 'null', 'true']) assert.equal(parseAppVersion(text), UNKNOWN_VERSION);
  });

  it('a missing or unreadable file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'u8-version-'));
    try {
      assert.equal(readAppVersion(join(dir, 'nope.json')), UNKNOWN_VERSION);
      assert.equal(readAppVersion(dir), UNKNOWN_VERSION); // a directory: readFileSync throws EISDIR
      writeFileSync(join(dir, 'package.json'), '{ "version": "0.1.0" ');
      assert.equal(readAppVersion(join(dir, 'package.json')), UNKNOWN_VERSION, 'malformed -- and NOT 0.1.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('near misses are refused (leading zeros, v-prefix, missing parts, empty pre-release)', () => {
    for (const v of ['01.2.3', '1.02.3', 'v1.2.3', '1.2', '1.2.3-', '1.2.3-01', '1.2.3+', ' 1.2.3', '1.2.3 ']) {
      assert.equal(parseAppVersion(JSON.stringify({ version: v })), UNKNOWN_VERSION, v);
    }
  });
});

describe('⭐ positive control — every valid version is returned unchanged', () => {
  it('generated SemVer, including pre-releases and build metadata', () => {
    fc.assert(
      fc.property(validSemVer, (v) => {
        assert.equal(parseAppVersion(JSON.stringify({ name: 'x', version: v })), v);
      }),
    );
  });

  it('the versions this project will actually ship', () => {
    for (const v of ['0.8.0', '1.0.0-beta.1', '1.0.0', '10.20.30-rc.1+build.5']) {
      assert.equal(parseAppVersion(JSON.stringify({ version: v })), v);
    }
  });

  it("the repository's own package.json is readable and valid", () => {
    assert.ok(isSemVer(readAppVersion()), 'the default path must resolve to the project root');
  });
});
