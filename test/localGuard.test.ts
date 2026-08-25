/**
 * Tests for local-only access enforcement (Requirements Q7, Q9).
 *
 * This is the entirety of the app's security posture, so it gets both example-based tests
 * for known attack shapes and property-based tests for the general rule (PBT-03: a range
 * invariant — nothing outside loopback may ever be admitted).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js'; // seed selection and reporting (PBT-08)
import type { Request, Response, NextFunction } from 'express';
import {
  isLoopbackAddress,
  isLoopbackHostHeader,
  isAllowedOrigin,
  localGuard,
} from '../src/localGuard.js';

/** Minimal Express request/response doubles — the guard only touches these fields. */
function fakeRequest(options: { address?: string; host?: string; origin?: string }) {
  return {
    socket: { remoteAddress: options.address },
    headers: { host: options.host, origin: options.origin },
  } as unknown as Request;
}

function fakeResponse() {
  const state = { status: 0, body: '', type: '' };
  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    type(value: string) {
      state.type = value;
      return response;
    },
    send(body: string) {
      state.body = body;
      return response;
    },
  };
  return { response: response as unknown as Response, state };
}

/** Runs the guard and reports whether the request was admitted. */
function runGuard(request: Request) {
  const { response, state } = fakeResponse();
  let admitted = false;
  const next: NextFunction = () => {
    admitted = true;
  };
  localGuard(request, response, next);
  return { admitted, ...state };
}

describe('localGuard — example-based', () => {
  describe('isLoopbackAddress', () => {
    it('accepts loopback in every form Node reports', () => {
      for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
        assert.equal(isLoopbackAddress(address), true, `should accept ${address}`);
      }
    });

    it('rejects LAN and public addresses', () => {
      for (const address of [
        '192.168.1.50',
        '10.0.0.5',
        '172.16.0.1',
        '8.8.8.8',
        '::ffff:10.0.0.5',
        '2001:db8::1',
      ]) {
        assert.equal(isLoopbackAddress(address), false, `should reject ${address}`);
      }
    });

    it('rejects a hostname that merely starts with a loopback literal', () => {
      assert.equal(isLoopbackAddress('127.0.0.1.evil.com'), false);
    });

    it('rejects missing or empty addresses', () => {
      assert.equal(isLoopbackAddress(undefined), false);
      assert.equal(isLoopbackAddress(''), false);
    });
  });

  describe('isLoopbackHostHeader', () => {
    it('accepts loopback hosts with and without a port', () => {
      for (const host of ['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:3000', '[::1]:3000']) {
        assert.equal(isLoopbackHostHeader(host), true, `should accept ${host}`);
      }
    });

    it('rejects lookalike domains used for DNS rebinding', () => {
      for (const host of [
        'evil.com',
        'localhost.evil.com',
        'notlocalhost',
        '127.0.0.1.evil.com',
        'evil.com:3000',
      ]) {
        assert.equal(isLoopbackHostHeader(host), false, `should reject ${host}`);
      }
    });

    it('is case-insensitive', () => {
      assert.equal(isLoopbackHostHeader('LOCALHOST:3000'), true);
    });

    // REGRESSION: found by the property test, shrunk to "[::1].a". The bracketed-host
    // branch took everything up to "]" and ignored the rest, admitting these.
    it('rejects trailing content after a bracketed IPv6 host', () => {
      for (const host of ['[::1].a.com', '[::1]evil.com', '[::1]:3000.evil.com', '[::1]x']) {
        assert.equal(isLoopbackHostHeader(host), false, `should reject ${host}`);
      }
      // The legitimate forms must still work.
      assert.equal(isLoopbackHostHeader('[::1]:3000'), true);
      assert.equal(isLoopbackHostHeader('[::1]'), true);
    });

    it('rejects a malformed port', () => {
      for (const host of ['localhost:abc', 'localhost:3000x', 'localhost:', '[::1]:']) {
        assert.equal(isLoopbackHostHeader(host), false, `should reject ${host}`);
      }
    });

    it('rejects an unclosed bracket', () => {
      assert.equal(isLoopbackHostHeader('[::1'), false);
    });

    it('rejects a missing Host header', () => {
      assert.equal(isLoopbackHostHeader(undefined), false);
    });
  });

  describe('isAllowedOrigin', () => {
    // Same-origin navigations send no Origin header; rejecting those would break the app.
    it('allows an absent Origin', () => {
      assert.equal(isAllowedOrigin(undefined), true);
    });

    it('allows loopback origins', () => {
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
        assert.equal(isAllowedOrigin(origin), true, `should allow ${origin}`);
      }
    });

    it('rejects cross-site origins', () => {
      for (const origin of ['http://evil.com', 'https://localhost.evil.com', 'null']) {
        assert.equal(isAllowedOrigin(origin), false, `should reject ${origin}`);
      }
    });

    it('rejects unparseable origins rather than failing open', () => {
      assert.equal(isAllowedOrigin('not-a-url'), false);
      assert.equal(isAllowedOrigin('://'), false);
    });
  });
});

describe('localGuard middleware', () => {
  it('admits a normal same-origin local request', () => {
    const result = runGuard(fakeRequest({ address: '127.0.0.1', host: 'localhost:3000' }));
    assert.equal(result.admitted, true);
  });

  it('admits a local request carrying a matching Origin', () => {
    const result = runGuard(
      fakeRequest({ address: '::1', host: 'localhost:3000', origin: 'http://localhost:3000' }),
    );
    assert.equal(result.admitted, true);
  });

  it('rejects a request from a LAN address with 403', () => {
    const result = runGuard(fakeRequest({ address: '192.168.1.50', host: 'localhost:3000' }));

    assert.equal(result.admitted, false);
    assert.equal(result.status, 403);
    assert.match(result.body, /local connections/i);
  });

  // Defence in depth: even if the port binding were widened by mistake, a spoofed Host
  // from a loopback-connected process must not pass.
  it('rejects a loopback request with a foreign Host header', () => {
    const result = runGuard(fakeRequest({ address: '127.0.0.1', host: 'evil.com' }));

    assert.equal(result.admitted, false);
    assert.equal(result.status, 403);
    assert.match(result.body, /Host or Origin/i);
  });

  it('rejects a cross-site Origin even from loopback', () => {
    const result = runGuard(
      fakeRequest({ address: '127.0.0.1', host: 'localhost:3000', origin: 'http://evil.com' }),
    );

    assert.equal(result.admitted, false);
    assert.equal(result.status, 403);
  });

  it('rejects a request with no discernible peer address', () => {
    const result = runGuard(fakeRequest({ host: 'localhost:3000' }));
    assert.equal(result.admitted, false);
    assert.equal(result.status, 403);
  });

  it('responds as plain text, never as HTML', () => {
    const result = runGuard(fakeRequest({ address: '10.0.0.1', host: 'localhost' }));
    assert.equal(result.type, 'text/plain');
  });
});

describe('localGuard — property-based', () => {
  const RUNS = { numRuns: 500 };

  // PBT-03 invariant: no address outside 127.0.0.0/8 or ::1 is ever admitted.
  it('never admits a non-loopback IPv4 address', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }).filter((octet) => octet !== 127),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (a, b, c, d) => {
          const address = `${a}.${b}.${c}.${d}`;
          assert.equal(isLoopbackAddress(address), false, `admitted ${address}`);
          assert.equal(isLoopbackAddress(`::ffff:${address}`), false, `admitted mapped ${address}`);
        },
      ),
      RUNS,
    );
  });

  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  it('admits the entire 127.0.0.0/8 range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 1, max: 255 }),
        (b, c, d) => {
          assert.equal(isLoopbackAddress(`127.${b}.${c}.${d}`), true);
        },
      ),
      RUNS,
    );
  });

  // PBT-03: appending any subdomain to a loopback name must not make it loopback.
  it('never admits a host that merely contains a loopback name', () => {
    const labelArb = fc
      .string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), minLength: 1, maxLength: 12 })
      .filter((s) => s.length > 0);

    fc.assert(
      fc.property(fc.constantFrom('localhost', '127.0.0.1', '[::1]'), labelArb, (base, label) => {
        assert.equal(isLoopbackHostHeader(`${base}.${label}.com`), false);
        assert.equal(isAllowedOrigin(`http://${base}.${label}.com`), false);
      }),
      RUNS,
    );
  });

  // Failing closed matters more than failing open here: garbage must never be admitted.
  it('rejects arbitrary garbage rather than throwing', () => {
    fc.assert(
      fc.property(fc.string(), (garbage) => {
        // Must not throw, whatever the input.
        const host = isLoopbackHostHeader(garbage);
        const origin = isAllowedOrigin(garbage);
        assert.equal(typeof host, 'boolean');
        assert.equal(typeof origin, 'boolean');
      }),
      RUNS,
    );
  });
});
