/**
 * *App only* setup (U9, LC-68, BR-74.2) — PBT-78, and the writer against a real folder.
 *
 * ⚠️ PBT-78's positive control: a setup that refused everything would satisfy "never overwrites" perfectly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { decideSetup, runSetup, SETUP_FILES } from '../src/appOnly/setup.js';

const TARGETS = SETUP_FILES.map(([t]) => t);

describe('decideSetup (PBT-78)', () => {
  it('for any set of files already present: writes NOTHING if any target exists, and names each one', () => {
    fc.assert(
      fc.property(fc.subarray([...TARGETS, 'README.md', 'data/history.db']), (present) => {
        const d = decideSetup(new Set(present));
        const blocking = TARGETS.filter((t) => present.includes(t));
        if (blocking.length > 0) assert.deepEqual(d, { write: false, inTheWay: blocking });
        else assert.deepEqual(d, { write: true, files: TARGETS });
      }),
    );
  });

  it('⭐ positive control: with none of its targets present, it writes ALL of them', () => {
    assert.deepEqual(decideSetup(new Set(['notes.txt'])), { write: true, files: TARGETS });
  });
});

describe('runSetup against a real folder', () => {
  const templatesFrom = (dir: string) => {
    const root = process.cwd();
    const t = join(dir, 'templates');
    mkdirSync(t);
    writeFileSync(join(t, 'compose.app.yaml'), readFileSync(join(root, 'compose.app.yaml')));
    writeFileSync(join(t, 'musicbrainz.example.json'), readFileSync(join(root, 'secrets', 'musicbrainz.example.json')));
    writeFileSync(join(t, 'rules.example.json'), readFileSync(join(root, 'config', 'rules.example.json')));
    return t;
  };

  it('writes compose.yaml, secrets/musicbrainz.json, config/rules.json and empty data/, state/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-only-'));
    try {
      const folder = join(dir, 'folder');
      mkdirSync(folder);
      const outcome = runSetup(folder, templatesFrom(dir));
      assert.ok(outcome.ok, outcome.ok ? '' : outcome.message);
      assert.match(readFileSync(join(folder, 'compose.yaml'), 'utf8'), /image: ghcr\.io\/kuhndj67\/spotify-companion:/);
      assert.ok(existsSync(join(folder, 'secrets', 'musicbrainz.json')));
      assert.ok(existsSync(join(folder, 'config', 'rules.json')));
      assert.deepEqual(readdirSync(join(folder, 'data')), []);
      assert.deepEqual(readdirSync(join(folder, 'state')), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a second run refuses, names the file in the way, and changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-only-'));
    try {
      const folder = join(dir, 'folder');
      mkdirSync(join(folder, 'secrets'), { recursive: true });
      writeFileSync(join(folder, 'secrets', 'musicbrainz.json'), '{"contact":"mine@example.org"}');
      const outcome = runSetup(folder, templatesFrom(dir));
      assert.ok(!outcome.ok && outcome.message.includes('secrets/musicbrainz.json'));
      assert.equal(existsSync(join(folder, 'compose.yaml')), false, 'nothing written');
      assert.equal(readFileSync(join(folder, 'secrets', 'musicbrainz.json'), 'utf8'), '{"contact":"mine@example.org"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a missing template is a build fault, reported, and nothing is written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-only-'));
    try {
      mkdirSync(join(dir, 'empty-templates'));
      mkdirSync(join(dir, 'folder'));
      const outcome = runSetup(join(dir, 'folder'), join(dir, 'empty-templates'));
      assert.ok(!outcome.ok && /build fault/.test(outcome.message));
      assert.deepEqual(readdirSync(join(dir, 'folder')), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
