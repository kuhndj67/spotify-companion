/**
 * U11 (LC-94, BR-93.3) — PBT-97: what the page does when its live connection closes. It tests the very file the page
 * imports (`public/connectionDecision.js`), not a copy.
 *
 * ⚠️ Positive control: an ordinary close with a live session DOES reconnect; a decision that always said *signed out*
 * would pass the 4401 property.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import { needsSessionCheck, onClose } from '../public/connectionDecision.js';

const code = fc.oneof(fc.constantFrom(1000, 1001, 1005, 1006, 1011, 1012, 4400, 4401, 4402), fc.integer({ min: 1000, max: 4999 }));
const status = fc.oneof(fc.constant(null), fc.constantFrom(200, 401, 403, 404, 500, 502), fc.integer({ min: 100, max: 599 }));

describe('onClose (PBT-97)', () => {
  it('4401 → signedOut, whatever the session check says (and it is not asked)', () => {
    fc.assert(
      fc.property(status, (s) => {
        assert.equal(onClose(4401, s), 'signedOut');
      }),
    );
    assert.equal(needsSessionCheck(4401), false);
  });

  it('any other code: signedOut iff the session check answered 401; otherwise reconnect', () => {
    fc.assert(
      fc.property(code, status, (c, s) => {
        fc.pre(c !== 4401);
        assert.equal(needsSessionCheck(c), true);
        assert.equal(onClose(c, s), s === 401 ? 'signedOut' : 'reconnect');
      }),
    );
  });

  it('⭐ the common cases: a dropped connection with a live session reconnects; local mode (404) always reconnects', () => {
    assert.equal(onClose(1006, 200), 'reconnect');
    assert.equal(onClose(1006, 404), 'reconnect');
    assert.equal(onClose(1001, null), 'reconnect', 'the server restarting: the check cannot be asked');
    assert.equal(onClose(1006, 401), 'signedOut', 'a refused handshake the browser reports as 1006');
  });
});
