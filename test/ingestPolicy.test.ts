/**
 * FR-64's pure admission core — LC-33a `decideEntry` and LC-32 `admitIngest`.
 *
 * ## ⭐ What these tests defend
 *
 * U6 is the first unit that accepts a file from outside and lets it replace the corpus. The archive reader
 * writes nothing until `decideEntry` says yes, so every hostile shape an archive can carry has to be refused
 * HERE — and refused for the right rule, because the refusal is shown to the user (BR-46.14).
 *
 * PBT-51 has two halves: this file proves the DECISION refuses every path-shaped name and every non-file
 * type; `archive.test.ts` proves end to end that nothing reaches the disk outside the work directory.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fc from 'fast-check';
import './fc-config.js';

import { admitIngest } from '../src/ingest/admitIngest.js';
import { decideEntry, missingRequired, type EntryHeader } from '../src/ingest/entryPolicy.js';
import { ARCHIVE_ENTRIES, EXPANDED_CAP_BYTES, INGEST_HEADER_VALUE } from '../src/ingest/types.js';

const caps = { totalExpandedBytes: EXPANDED_CAP_BYTES };
const NAMES = Object.keys(ARCHIVE_ENTRIES);
const file = (name: string, size = 10): EntryHeader => ({ name, type: 'File', size });

describe('decideEntry — the allowlist (BR-46.6, P-45)', () => {
  it('accepts each allowlisted name and writes it under the FIXED name, never the entry name', () => {
    for (const name of NAMES) {
      const verdict = decideEntry(file(name), new Set(), 0, caps);
      assert.equal(verdict.kind, 'accept');
      if (verdict.kind === 'accept') assert.equal(verdict.fixedName, ARCHIVE_ENTRIES[name as keyof typeof ARCHIVE_ENTRIES]);
    }
  });

  it('PBT-52: any name not on the allowlist refuses', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((n) => !NAMES.includes(n)),
        (name) => decideEntry(file(name), new Set(), 0, caps).kind === 'refuse',
      ),
    );
  });

  it('PBT-52: a duplicate of an accepted entry refuses (BR-46.9)', () => {
    for (const name of NAMES) {
      const verdict = decideEntry(file(name), new Set([name]), 0, caps);
      assert.equal(verdict.kind, 'refuse');
      if (verdict.kind === 'refuse') assert.equal(verdict.rule, 'BR-46.9');
    }
  });

  it('PBT-52 negative control: a valid backup plus one extra file is refused at the extra file', () => {
    const seen = new Set<string>();
    let total = 0;
    for (const name of ['manifest.json', 'history.db']) {
      const v = decideEntry(file(name), seen, total, caps);
      assert.equal(v.kind, 'accept');
      if (v.kind === 'accept') {
        seen.add(name);
        total = v.expandedTotal;
      }
    }
    const extra = decideEntry(file('notes.txt'), seen, total, caps);
    assert.equal(extra.kind, 'refuse');
    if (extra.kind === 'refuse') assert.equal(extra.rule, 'BR-46.6');
  });

  it('a backup missing a required entry is not a backup', () => {
    assert.equal(missingRequired(new Set(['manifest.json', 'history.db'])), null);
    assert.equal(missingRequired(new Set(['manifest.json', 'history.db', 'rules.json'])), null);
    assert.equal(missingRequired(new Set(['history.db']))?.rule, 'BR-46.6');
    assert.match(missingRequired(new Set())?.detail ?? '', /manifest\.json, history\.db/);
  });
});

describe('decideEntry — PBT-51: no path-shaped name and no non-file is ever accepted', () => {
  // Generated names that carry a path: every allowlisted name wrapped in traversal, separators, absolute
  // prefixes and drive letters, plus arbitrary strings containing them.
  const pathy = fc.oneof(
    fc.constantFrom(...NAMES).chain((n) =>
      fc.constantFrom(`../${n}`, `./${n}`, `/${n}`, `..\\${n}`, `C:${n}`, `c:\\${n}`, `x/${n}`, `${n}/`, `..${n}`, `${n}\0`),
    ),
    fc.tuple(fc.string({ maxLength: 10 }), fc.constantFrom('/', '\\', '..', '\0'), fc.string({ maxLength: 10 })).map(
      ([a, sep, b]) => `${a}${sep}${b}`,
    ),
  );

  it('refuses every generated path-shaped name, for the PATH rule rather than the allowlist', () => {
    fc.assert(
      fc.property(pathy, (name) => {
        const v = decideEntry(file(name), new Set(), 0, caps);
        return v.kind === 'refuse' && (v.rule === 'BR-46.8' || v.rule === 'BR-46.6');
      }),
    );
    // The rule named matters (BR-46.14): `../history.db` is a path, not an unknown name.
    const v = decideEntry(file('../history.db'), new Set(), 0, caps);
    assert.equal(v.kind === 'refuse' && v.rule, 'BR-46.8');
  });

  it('refuses every non-regular type even under an allowlisted name (BR-46.7)', () => {
    const types = ['SymbolicLink', 'Link', 'Directory', 'CharacterDevice', 'BlockDevice', 'FIFO', 'ExtendedHeader', 'GlobalExtendedHeader', 'NextFileHasLongPath', 'SomethingNew'];
    fc.assert(
      fc.property(fc.constantFrom(...types), fc.constantFrom(...NAMES), (type, name) => {
        const v = decideEntry({ name, type, size: 1 }, new Set(), 0, caps);
        return v.kind === 'refuse' && v.rule === 'BR-46.7';
      }),
    );
  });

  it('PBT-51 negative control: the decision is not "refuse everything" — a plain allowlisted file is accepted', () => {
    assert.equal(decideEntry(file('history.db'), new Set(), 0, caps).kind, 'accept');
  });
});

describe('decideEntry — expanded size cap (BR-46.10)', () => {
  it('refuses the entry that takes the running total past the cap, and accepts one landing exactly on it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: EXPANDED_CAP_BYTES }), (soFar) => {
        const room = EXPANDED_CAP_BYTES - soFar;
        const fits = decideEntry(file('history.db', room), new Set(), soFar, caps);
        const over = decideEntry(file('history.db', room + 1), new Set(), soFar, caps);
        return fits.kind === 'accept' && over.kind === 'refuse' && over.rule === 'BR-46.10';
      }),
    );
  });

  it('refuses a negative or non-integer declared size', () => {
    for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(decideEntry(file('history.db', size), new Set(), 0, caps).kind, 'refuse');
    }
  });
});

describe('admitIngest — PBT-57 (BR-46.1–46.3, P-42)', () => {
  const loopback = (o: string) => o === 'http://localhost:3010' || o === 'http://127.0.0.1:3010';

  it('admits exactly when POST + a present, allowed Origin + the ingest header all hold', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('POST', 'GET', 'PUT', 'DELETE', 'post'),
        fc.option(fc.constantFrom('http://localhost:3010', 'http://127.0.0.1:3010', 'https://evil.example', ''), { nil: undefined }),
        fc.option(fc.constantFrom(INGEST_HEADER_VALUE, '0', 'true', ''), { nil: undefined }),
        (method, origin, ingestHeader) => {
          const admitted = admitIngest({ method, origin, ingestHeader }, loopback).ok;
          const expected =
            method === 'POST' && origin !== undefined && origin !== '' && loopback(origin) && ingestHeader === INGEST_HEADER_VALUE;
          return admitted === expected;
        },
      ),
    );
  });

  it('⚠️ refuses a MISSING Origin — stricter than the app-wide policy, which admits one', () => {
    const v = admitIngest({ method: 'POST', origin: undefined, ingestHeader: INGEST_HEADER_VALUE }, () => true);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.rule, 'BR-46.2');
  });

  it('PBT-57 POSITIVE control: a correct request IS admitted (a guard refusing everything would pass the refusals)', () => {
    assert.deepEqual(
      admitIngest({ method: 'POST', origin: 'http://localhost:3010', ingestHeader: INGEST_HEADER_VALUE }, loopback),
      { ok: true },
    );
  });
});
