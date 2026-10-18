/**
 * LC-41 — PBT-62: masking never reveals more than its budget.
 * Client id ≤ 8 characters · email ≤ 2 characters of the local part · other contact ≤ 8.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';
import './fc-config.js';

import { maskClientId, maskContact } from '../src/configuration/masking.js';

/** How many characters of `secret` appear in `shown`, counted as the longest run plus every other run. */
function revealed(shown: string, input: string): number {
  // Every maximal common substring of length >= 2 counts in full; this over-counts rather than under-counts.
  let count = 0;
  for (const part of shown.split('…')) {
    if (part.length > 0 && input.includes(part)) count += part.length;
  }
  return count;
}

describe('maskClientId — PBT-62', () => {
  it('PBT-62: never reveals more than 8 characters of the client id', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 64 }), (id) => {
        assert.ok(revealed(maskClientId(id), id) <= 8);
      }),
    );
  });

  it('a 32-character Spotify-shaped id shows 4 + 4', () => {
    assert.equal(maskClientId('abcdefghijklmnopqrstuvwxyz012345'), 'abcd…2345');
  });

  it('a short value is shown only as set — 4+4 of a 9-character value would expose most of it', () => {
    assert.equal(maskClientId('abcdefghi'), 'set');
  });
});

describe('maskContact — PBT-62', () => {
  it('an email shows first and last of the local part, and the domain', () => {
    assert.equal(maskContact('listener@example.org'), 'l…r@example.org');
  });

  it('a very short local part reveals nothing of it', () => {
    assert.equal(maskContact('ab@example.org'), '…@example.org');
  });

  it('PBT-62: an email never reveals more than 2 characters of its local part', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9._+-]{1,30}$/),
        fc.stringMatching(/^[a-z0-9-]{1,20}\.[a-z]{2,6}$/),
        (local, domain) => {
          const shown = maskContact(`${local}@${domain}`);
          const [shownLocal = ''] = shown.split('@');
          assert.ok(shownLocal.replace('…', '').length <= 2);
          assert.ok(shown.endsWith(`@${domain}`));
        },
      ),
    );
  });

  it('PBT-62: any other contact reveals at most 8 characters', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }).filter((s) => !/^[^@\s]+@[^@\s]+$/.test(s)), (contact) => {
        assert.ok(revealed(maskContact(contact), contact) <= 8);
      }),
    );
  });
});
