/**
 * The sign-in listener's `Host` check (U9, P-73) is a COPY of `localGuard`'s, for a dependency-free script. A copied
 * policy that diverges is how the WebSocket `403` happened, so this asserts the two agree on every input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
// @ts-expect-error -- plain .mjs helper with no type declarations (as browserCommand.mjs); its behaviour is asserted below
import { isLoopbackHostHeader as guardCopy } from '../scripts/lib/loopbackHost.mjs';
import { isLoopbackHostHeader as guard } from '../src/localGuard.js';

const name = fc.constantFrom('localhost', 'LOCALHOST', '127.0.0.1', '[::1]', '::1', '192.168.0.223', 'evil.com', '[::1].a.com', '');
const tail = fc.oneof(fc.constant(''), fc.nat({ max: 99999 }).map((p) => `:${p}`), fc.string({ maxLength: 8 }));

describe('scripts/lib/loopbackHost.mjs ≡ src/localGuard.ts', () => {
  it('agree on host-like inputs (names × ports × junk)', () => {
    fc.assert(fc.property(name, tail, (n, t) => assert.equal(guardCopy(n + t), guard(n + t), JSON.stringify(n + t))));
  });

  it('agree on arbitrary strings and on absence', () => {
    fc.assert(fc.property(fc.option(fc.string({ maxLength: 30 }), { nil: undefined }), (v) => assert.equal(guardCopy(v), guard(v))));
  });

  it('positive control: the listener refuses a LAN host and accepts the documented one', () => {
    assert.equal(guardCopy('192.168.0.223:8888'), false);
    assert.equal(guardCopy('127.0.0.1:8888'), true);
  });
});
