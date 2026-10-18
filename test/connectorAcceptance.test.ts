/**
 * The connector acceptance record (U9, IN-U9-3 as amended by Code Generation Q2 = A).
 *
 * The committed file is checked for SHAPE here; whether the current pin is accepted is the release's refusal
 * (`pin-not-accepted`, test/releaseDecision.property.test.ts), because the entry is written in Build & Test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptedPins, parseAcceptance, pinFromCompose } from '../scripts/lib/connectorAcceptance.js';

const ROOT = process.cwd();
const PIN = '6065ce5cdef13ffeb43042e295bb788ce7ad00df';
const good = { pin: PIN, date: '2026-10-19', result: 'pass', record: 'aidlc-docs/x.md' };

describe('scripts/connector-acceptance.json', () => {
  it('is well-formed, and every record it names exists', () => {
    const parsed = parseAcceptance(readFileSync(join(ROOT, 'scripts', 'connector-acceptance.json'), 'utf8'));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.problems.join('; '));
    if (parsed.ok) assert.deepEqual(parsed.entries.filter((e) => !existsSync(join(ROOT, e.record))).map((e) => e.record), []);
  });
});

describe('parseAcceptance', () => {
  it('accepts well-formed entries', () => {
    assert.deepEqual(parseAcceptance(JSON.stringify([good])), { ok: true, entries: [good] });
  });

  it('positive control: each malformed field is named', () => {
    const bad = parseAcceptance(JSON.stringify([{ pin: '6065ce5c', date: '18 Oct', result: 'ok', record: '' }]));
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.problems.length, 4);
    assert.equal(parseAcceptance('{}').ok, false);
    assert.equal(parseAcceptance('not json').ok, false);
  });
});

describe('acceptedPins', () => {
  it('the LAST entry for a pin decides: a later fail withdraws an earlier pass', () => {
    assert.deepEqual(acceptedPins([good as never]), [PIN]);
    assert.deepEqual(acceptedPins([good as never, { ...good, result: 'fail' } as never]), []);
    assert.deepEqual(acceptedPins([{ ...good, result: 'fail' } as never, good as never]), [PIN]);
  });
});

describe('pinFromCompose', () => {
  it("reads compose.yaml's full-SHA pin, and nothing shorter", () => {
    assert.equal(pinFromCompose(readFileSync(join(ROOT, 'compose.yaml'), 'utf8')), PIN);
    assert.equal(pinFromCompose('    MCP_SERVER_REF: 6065ce5c\n'), null);
  });
});
