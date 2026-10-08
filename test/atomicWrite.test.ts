/**
 * LC-42 — the ONE write-temp-then-rename (P-51), extracted from `AutomationStateStore` in U7.
 *
 * The store's own suite is the regression check that the move changed nothing; this file pins the helper's
 * contract directly, because `RulesWriter` now depends on it too.
 */

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { probeDirectoryWritable, tempPathFor, writeFileAtomic } from '../src/configuration/atomicWrite.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atomic-write-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('creates the file with exactly the content given', () => {
    const target = join(dir, 'rules.json');
    assert.deepEqual(writeFileAtomic(target, '{"a":1}\n'), { ok: true });
    assert.equal(readFileSync(target, 'utf8'), '{"a":1}\n');
  });

  it('replaces an existing file and leaves no temp file behind', () => {
    const target = join(dir, 'rules.json');
    writeFileSync(target, 'old');
    assert.deepEqual(writeFileAtomic(target, 'new'), { ok: true });
    assert.equal(readFileSync(target, 'utf8'), 'new');
    assert.deepEqual(readdirSync(dir), ['rules.json']);
  });

  it('writes its temp file in the SAME directory as the target (rename is only atomic within one filesystem)', () => {
    const target = join(dir, 'sub', 'rules.json');
    assert.equal(tempPathFor(target), join(dir, 'sub', '.rules.json.tmp'));
  });

  it('creates a missing parent directory', () => {
    const target = join(dir, 'missing', 'rules.json');
    assert.deepEqual(writeFileAtomic(target, 'x'), { ok: true });
    assert.equal(readFileSync(target, 'utf8'), 'x');
  });

  it('returns a failure outcome instead of throwing, and removes its temp file', () => {
    // The target is a DIRECTORY, so the rename must fail after the temp file was written.
    const target = join(dir, 'occupied');
    mkdirSync(target);
    writeFileSync(join(target, 'keep'), 'k');
    const outcome = writeFileAtomic(target, 'x');
    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.reason.length > 0);
    assert.equal(existsSync(tempPathFor(target)), false);
    assert.equal(readFileSync(join(target, 'keep'), 'utf8'), 'k', 'the occupant is untouched');
  });
});

describe('probeDirectoryWritable', () => {
  it('is true for a writable directory and leaves nothing behind', () => {
    assert.equal(probeDirectoryWritable(join(dir, 'rules.json')), true);
    assert.deepEqual(readdirSync(dir), []);
  });

  it('is false, without throwing, when the parent cannot be created', () => {
    const blocker = join(dir, 'file');
    writeFileSync(blocker, 'not a directory');
    assert.equal(probeDirectoryWritable(join(blocker, 'rules.json')), false);
  });

  it('never modifies the target file itself', () => {
    const target = join(dir, 'rules.json');
    writeFileSync(target, 'untouched');
    chmodSync(target, 0o644);
    assert.equal(probeDirectoryWritable(target), true);
    assert.equal(readFileSync(target, 'utf8'), 'untouched');
  });
});
