/**
 * LC-33 — reading and writing backup archives, end to end against the real `tar` parser.
 *
 * ## ⭐ What these tests defend
 *
 *   - **PBT-51 (end to end)**: for any mix of valid and hostile entries, NOTHING is written outside the work
 *     directory, and an archive containing any hostile entry is refused whole. `ingestPolicy.test.ts` proves
 *     the decision; this proves the bytes never reach the disk, through the real parser.
 *   - **PBT-56**: credentials and automation state never appear in an archive the app writes, whatever files
 *     sit beside the allowlisted ones.
 *   - Content is decided by bytes (BR-46.11): not gzip, not tar, and a `history.db` that is not SQLite are all
 *     refused with a reason — never thrown.
 *
 * Fixtures are hand-built raw tar (`tarFixtures.ts`), so they can contain what the `tar` writer refuses to.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import fc from 'fast-check';
import './fc-config.js';
import { Parser } from 'tar';

import { readArchive, writeArchive } from '../src/ingest/archive.js';
import type { ArchiveEntryName } from '../src/ingest/types.js';
import { tarGz, type RawEntry } from './tarFixtures.js';

const SQLITE = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(84, 1)]);
const sandboxes: string[] = [];
afterEach(() => {
  for (const d of sandboxes.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A sandbox holding the archive and an empty work dir — so "outside the work dir" is observable. */
function sandbox(archive: Buffer): { root: string; archive: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), 'u6-archive-'));
  sandboxes.push(root);
  const work = join(root, 'work');
  mkdirSync(work);
  const path = join(root, 'upload.tar.gz');
  writeFileSync(path, archive);
  return { root, archive: path, work };
}

const VALID: RawEntry[] = [
  { name: 'manifest.json', body: '{"manifestSchema":1}' },
  { name: 'history.db', body: SQLITE },
];

describe('readArchive — a valid backup', () => {
  it('stages exactly the allowlisted entries under their fixed names', async () => {
    const s = sandbox(tarGz([...VALID, { name: 'rules.json', body: '{"rules":[]}' }]));
    const r = await readArchive(s.archive, s.work);
    assert.equal(r.ok, true);
    assert.deepEqual(readdirSync(s.work).sort(), ['history.db', 'manifest.json', 'rules.json']);
    assert.deepEqual(readFileSync(join(s.work, 'history.db')), SQLITE);
  });

  it('rules.json is optional; manifest.json and history.db are not (BR-45.2)', async () => {
    const withoutRules = sandbox(tarGz(VALID));
    assert.equal((await readArchive(withoutRules.archive, withoutRules.work)).ok, true);
    const s = sandbox(tarGz([VALID[1]!]));
    const r = await readArchive(s.archive, s.work);
    assert.equal(r.ok === false && r.refusal.rule, 'BR-46.6');
  });
});

describe('readArchive — PBT-51 end to end: nothing lands outside the work directory', () => {
  const hostile = fc.constantFrom<RawEntry>(
    { name: '../history.db', body: 'x' },
    { name: '../../escape.txt', body: 'x' },
    { name: '/history.db', body: 'x' },
    { name: 'C:history.db', body: 'x' },
    { name: 'sub/history.db', body: 'x' },
    { name: 'history.db', typeflag: '2', linkname: '/etc/passwd' },
    { name: 'history.db', typeflag: '1', linkname: 'manifest.json' },
    { name: 'manifest.json', typeflag: '2', linkname: '../../outside' },
    { name: 'secrets', typeflag: '5' },
    { name: 'spotify-config.json', body: '{"refreshToken":"x"}' },
    { name: 'automation-state.json', body: '{"globalAutomationEnabled":true}' },
    { name: 'history.db', typeflag: '6' },
  );

  it('refuses any archive containing a hostile entry, and writes nothing outside the work dir', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(hostile, { minLength: 1, maxLength: 3 }), fc.nat(5), async (bad, at) => {
        const entries = [...VALID];
        entries.splice(Math.min(at, entries.length), 0, ...bad);
        const s = sandbox(tarGz(entries));
        const r = await readArchive(s.archive, s.work);
        const outside = readdirSync(s.root).sort();
        const inside = readdirSync(s.work);
        return (
          r.ok === false &&
          JSON.stringify(outside) === JSON.stringify(['upload.tar.gz', 'work']) &&
          inside.every((n) => ['history.db', 'manifest.json', 'rules.json'].includes(n)) &&
          !existsSync(join(s.root, '..', 'escape.txt'))
        );
      }),
      { numRuns: 60 },
    );
  });

  it('PBT-51 negative control: the same harness ACCEPTS a clean archive — it is not "refuse everything"', async () => {
    const s = sandbox(tarGz(VALID));
    assert.equal((await readArchive(s.archive, s.work)).ok, true);
  });

  it('a duplicate entry refuses the whole archive (BR-46.9)', async () => {
    const s = sandbox(tarGz([...VALID, { name: 'history.db', body: SQLITE }]));
    const r = await readArchive(s.archive, s.work);
    assert.equal(r.ok === false && r.refusal.rule, 'BR-46.9');
  });
});

describe('readArchive — content is decided by bytes (BR-46.11), and never throws', () => {
  it('a file that is not gzip is refused', async () => {
    const s = sandbox(Buffer.from('PK\u0003\u0004 this is a zip'));
    const r = await readArchive(s.archive, s.work);
    assert.equal(r.ok === false && r.refusal.rule, 'BR-46.11');
  });

  it('gzip that is not a tar is refused, not thrown', async () => {
    const s = sandbox(gzipSync(Buffer.from('definitely not a tar archive'.repeat(40))));
    const r = await readArchive(s.archive, s.work);
    assert.equal(r.ok, false);
  });

  it('a history.db that is not SQLite is refused', async () => {
    const s = sandbox(tarGz([VALID[0]!, { name: 'history.db', body: 'just some text' }]));
    const r = await readArchive(s.archive, s.work);
    assert.equal(r.ok === false && r.refusal.rule, 'BR-46.11');
  });

  it('an archive expanding past the cap is refused (BR-46.10)', async () => {
    const s = sandbox(tarGz(VALID));
    const r = await readArchive(s.archive, s.work, { totalExpandedBytes: 50 });
    assert.equal(r.ok === false && r.refusal.rule, 'BR-46.10');
  });
});

async function entryNames(stream: NodeJS.ReadableStream): Promise<string[]> {
  const names: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const p = new Parser({ onReadEntry: (e) => { names.push(e.path); e.resume(); } });
    p.on('end', resolve);
    p.on('error', reject);
    stream.pipe(p);
  });
  return names;
}

describe('writeArchive — PBT-56: only the allowlist travels', () => {
  it('planted credentials and state beside the allowlisted files never enter the archive', async () => {
    const extras = ['spotify-config.json', 'musicbrainz.json', 'automation-state.json', 'notes.txt', '.env'];
    await fc.assert(
      fc.asyncProperty(fc.subarray(extras, { minLength: 1 }), fc.boolean(), async (planted, withRules) => {
        const dir = mkdtempSync(join(tmpdir(), 'u6-write-'));
        sandboxes.push(dir);
        writeFileSync(join(dir, 'manifest.json'), '{}');
        writeFileSync(join(dir, 'history.db'), SQLITE);
        if (withRules) writeFileSync(join(dir, 'rules.json'), '{}');
        for (const p of planted) writeFileSync(join(dir, p), 'SECRET');
        mkdirSync(join(dir, 'secrets'));
        writeFileSync(join(dir, 'secrets', 'spotify-config.json'), 'SECRET');
        mkdirSync(join(dir, 'state'));
        writeFileSync(join(dir, 'state', 'automation-state.json'), 'SECRET');

        const present = new Set<ArchiveEntryName>(['manifest.json', 'history.db', ...(withRules ? (['rules.json'] as const) : [])]);
        const names = await entryNames(writeArchive(dir, present));
        const expected = withRules ? ['manifest.json', 'history.db', 'rules.json'] : ['manifest.json', 'history.db'];
        return JSON.stringify(names) === JSON.stringify(expected);
      }),
      { numRuns: 20 },
    );
  });

  it('round trip: what writeArchive produces, readArchive accepts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'u6-rt-'));
    sandboxes.push(dir);
    writeFileSync(join(dir, 'manifest.json'), '{"manifestSchema":1}');
    writeFileSync(join(dir, 'history.db'), SQLITE);
    const chunks: Buffer[] = [];
    for await (const c of writeArchive(dir, new Set(['manifest.json', 'history.db']))) chunks.push(c as Buffer);
    const s = sandbox(Buffer.concat(chunks));
    const r = await readArchive(s.archive, s.work);
    assert.equal(r.ok, true);
    assert.deepEqual(readFileSync(join(s.work, 'history.db')), SQLITE);
  });
});
