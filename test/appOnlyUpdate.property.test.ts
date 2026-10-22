/**
 * PBT-86 (decideUpdate) and PBT-87 (the one-line rewrite) — U10, LC-78, BR-83. Plus `runUpdate` on real files.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { decideUpdate, rewriteImageLine, runUpdate } from '../src/appOnly/update.js';
import { compareSemVer } from '../src/version.js';

const core = fc.tuple(fc.nat(3), fc.nat(3), fc.nat(3)).map(([a, b, c]) => `${a}.${b}.${c}`);
const version = fc.oneof(core, fc.tuple(core, fc.nat(12)).map(([c, n]) => `${c}-beta.${n}`));

describe('PBT-86 — decideUpdate', () => {
  it('refuse iff own < current, same iff equal, rewrite iff own > current', () => {
    fc.assert(
      fc.property(version, version, (current, own) => {
        const c = compareSemVer(own, current);
        assert.equal(decideUpdate(current, own), c < 0 ? 'refuse-older' : c === 0 ? 'same' : 'rewrite');
      }),
    );
  });

  it('⭐ positive control: a newer release is a rewrite; its own pre-release is older', () => {
    assert.equal(decideUpdate('1.0.0-beta.8', '1.0.0-beta.9'), 'rewrite');
    assert.equal(decideUpdate('1.0.0-beta.8', '1.0.0'), 'rewrite');
    assert.equal(decideUpdate('1.0.0', '1.0.0-beta.9'), 'refuse-older');
  });
});

describe('PBT-87 — rewriteImageLine', () => {
  const otherLine = fc
    .string({ maxLength: 40 })
    .map((s) => s.replace(/[\r\n]/g, ' '))
    .filter((s) => !/ghcr\.io\/kuhndj67\/spotify-companion:/.test(s));
  const eol = fc.constantFrom('\n', '\r\n');

  it('only the version on the one image line changes; every other byte, comment and line ending is kept', () => {
    fc.assert(
      fc.property(
        fc.array(otherLine, { maxLength: 8 }),
        fc.array(otherLine, { maxLength: 8 }),
        fc.constantFrom('    image: ', '  image: "', "image: '"),
        version,
        version,
        fc.constantFrom('', '  # pinned', ' # comment: keep me'),
        eol,
        (before, after, prefix, from, to, tail, nl) => {
          const quote = prefix.endsWith('"') ? '"' : prefix.endsWith("'") ? "'" : '';
          const image = `${prefix}ghcr.io/kuhndj67/spotify-companion:${from}${quote}${tail}`;
          const text = [...before, image, ...after].join(nl) + nl;
          const r = rewriteImageLine(text, to);
          assert.ok(r.ok);
          assert.equal(r.from, from);
          assert.equal(r.text, [...before, image.replace(`:${from}`, `:${to}`), ...after].join(nl) + nl);
        },
      ),
    );
  });

  it('⭐ refuses 0 or ≥ 2 image lines', () => {
    assert.deepEqual(rewriteImageLine('services:\n  app:\n    build: .\n', '1.0.0'), { ok: false, reason: 'no-image-line' });
    const two = '    image: ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.8\n    image: ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.7\n';
    assert.deepEqual(rewriteImageLine(two, '1.0.0'), { ok: false, reason: 'several-image-lines' });
  });
});

describe('runUpdate on a real folder', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const folder = (compose: string | null) => {
    const d = mkdtempSync(join(tmpdir(), 'u10-update-'));
    dirs.push(d);
    if (compose !== null) writeFileSync(join(d, 'compose.yaml'), compose);
    return d;
  };
  const COMPOSE = 'services:\r\n  spotify-companion:\r\n    image: ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.8\r\n    ports:\r\n      - "127.0.0.1:3010:3000"  # mine\r\n';

  it('rewrites one line of a CRLF file and keeps the rest byte for byte', () => {
    const d = folder(COMPOSE);
    assert.deepEqual(runUpdate(d, '1.0.0-beta.9'), { ok: true, changed: true, from: '1.0.0-beta.8', to: '1.0.0-beta.9' });
    assert.equal(readFileSync(join(d, 'compose.yaml'), 'utf8'), COMPOSE.replace('beta.8', 'beta.9'));
  });

  it('⭐ an older image refuses and changes nothing', () => {
    const d = folder(COMPOSE);
    const r = runUpdate(d, '1.0.0-beta.7');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /OLDER than the 1\.0\.0-beta\.8.*Nothing was changed/);
    assert.equal(readFileSync(join(d, 'compose.yaml'), 'utf8'), COMPOSE);
  });

  it('the same version: nothing to do; no compose.yaml: a clear refusal', () => {
    assert.deepEqual(runUpdate(folder(COMPOSE), '1.0.0-beta.8'), { ok: true, changed: false, from: '1.0.0-beta.8', to: '1.0.0-beta.8' });
    const r = runUpdate(folder(null), '1.0.0-beta.9');
    assert.equal(r.ok, false);
  });
});
