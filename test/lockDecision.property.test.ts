/**
 * PBT-79 — the writer lock's verdict from two observations (U10, LC-69, P-76, BR-78.3).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import { isOurs, lockVerdict, type LockObservation } from '../src/lock/lockDecision.js';

const token = fc.oneof(fc.uuid(), fc.constant('raw:'), fc.string({ maxLength: 8 }));
const present: fc.Arbitrary<LockObservation> = fc.record({ token, mtimeMs: fc.integer({ min: 0, max: 2 ** 40 }) });
const absent: fc.Arbitrary<LockObservation> = fc.constant({ token: null, mtimeMs: null });

describe('PBT-79 — lockVerdict', () => {
  it('alive iff the token is unchanged and the heartbeat moved; stale iff unchanged and it did not', () => {
    fc.assert(
      fc.property(present, fc.oneof(present, absent), (first, second) => {
        const verdict = lockVerdict(first, second);
        if (second.token === null) assert.equal(verdict, 'gone');
        else if (second.token !== first.token) assert.equal(verdict, 'changed');
        else if (second.mtimeMs !== first.mtimeMs) assert.equal(verdict, 'alive');
        else assert.equal(verdict, 'stale');
      }),
    );
  });

  it('⭐ positive control: the same token with the same heartbeat is ALWAYS stale (a takeover is reachable)', () => {
    fc.assert(fc.property(present, (o) => assert.equal(lockVerdict(o, { ...o }), 'stale')));
  });

  it('a moved heartbeat is never stale, however small the move', () => {
    fc.assert(
      fc.property(present, fc.integer({ min: 1, max: 1000 }), (o, d) =>
        assert.equal(lockVerdict(o, { token: o.token, mtimeMs: (o.mtimeMs ?? 0) + d }), 'alive'),
      ),
    );
  });
});

describe('isOurs', () => {
  it('only an identical, present token is ours', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.option(token, { nil: null }), (ours, seen) => {
        assert.equal(isOurs(seen, ours), seen === ours);
      }),
    );
    assert.equal(isOurs(null, 'x'), false);
  });
});
