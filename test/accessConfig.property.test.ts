/**
 * U11 (LC-82, BR-88) — PBT-91 (`parseMode`) and PBT-92 (`validateServerConfig`).
 *
 * ⚠️ PBT-92's positive control is the valid case: a validator that refused everything would satisfy "every
 * incomplete configuration is refused" perfectly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import {
  parseMode,
  parseSessionLifetime,
  validateServerConfig,
  MAX_SESSION_LIFETIME_MS,
  MIN_SESSION_LIFETIME_MS,
  type FileFact,
  type ServerConfigInput,
} from '../src/access/accessConfig.js';

describe('parseMode (PBT-91)', () => {
  it('absent or empty → local; exactly "local" or "server" → that mode', () => {
    assert.deepEqual(parseMode(undefined), { ok: true, mode: 'local' });
    assert.deepEqual(parseMode(''), { ok: true, mode: 'local' });
    assert.deepEqual(parseMode('local'), { ok: true, mode: 'local' });
    assert.deepEqual(parseMode('server'), { ok: true, mode: 'server' });
  });

  it('every other string is refused, naming ACCESS_MODE (no trimming, no case folding)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.constantFrom('Server', 'SERVER', 'server ', ' local', 'remote', 'true', 'off'),
        ),
        (raw) => {
          fc.pre(raw !== '' && raw !== 'local' && raw !== 'server');
          const r = parseMode(raw);
          assert.equal(r.ok, false);
          if (!r.ok) assert.equal(r.problem.setting, 'ACCESS_MODE');
        },
      ),
    );
  });
});

const OK: FileFact = { state: 'ok' };

const VALID: ServerConfigInput = {
  publicOrigin: 'https://machine2.local:3443',
  issuer: 'https://machine2.local:9443/webman/sso',
  clientId: 'abc123',
  allowedSubject: 'owner',
  sessionLifetime: '7d',
  clientSecretFile: OK,
  certificateFile: OK,
  keyFile: OK,
};

/** The fields `validateServerConfig` requires, each with the setting name its problem must carry. */
const REQUIRED: ReadonlyArray<readonly [keyof ServerConfigInput, string]> = [
  ['publicOrigin', 'PUBLIC_ORIGIN'],
  ['issuer', 'OIDC_ISSUER'],
  ['clientId', 'OIDC_CLIENT_ID'],
  ['allowedSubject', 'OIDC_ALLOWED_SUBJECT'],
  ['clientSecretFile', 'secrets/app/oidc-client-secret'],
  ['certificateFile', 'secrets/app/tls/server-cert.pem'],
  ['keyFile', 'secrets/app/tls/server-key.pem'],
];

const badFile: fc.Arbitrary<FileFact> = fc.oneof(
  fc.constant<FileFact>({ state: 'missing' }),
  fc.constant<FileFact>({ state: 'unreadable' }),
  fc.constant<FileFact>({ state: 'empty' }),
  fc.constant<FileFact>({ state: 'invalid', reason: 'does not match the certificate' }),
);

/** A broken value for each required field: absent, empty, or invalid in a way the rule names. */
function brokenValue(field: keyof ServerConfigInput): fc.Arbitrary<unknown> {
  switch (field) {
    case 'clientSecretFile':
    case 'certificateFile':
    case 'keyFile':
      return badFile;
    case 'publicOrigin':
      return fc.constantFrom(
        undefined,
        '',
        'http://machine2.local:3443',
        'https://machine2.local:3443/app',
        'https://machine2.local:3443/?x=1',
        'https://u:p@machine2.local:3443',
        'machine2.local:3443',
        'not a url',
        'https://machine2.local:3443?',
        'https://machine2.local:3443#',
        'https://machine2.local:3443\\app',
      );
    case 'issuer':
      return fc.constantFrom(undefined, '', 'http://machine2.local:9443/webman/sso', 'nope');
    case 'clientId':
      return fc.constantFrom(undefined, '', '<from the provider>', 'abc 123');
    case 'allowedSubject':
      return fc.constantFrom(undefined, '', ' owner', 'owner ', '<your account>');
    default:
      return fc.constant(undefined);
  }
}

describe('validateServerConfig (PBT-92)', () => {
  it('⭐ positive control: a complete, valid configuration is ok, with the redirect derived from the origin', () => {
    const r = validateServerConfig(VALID);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.config.publicOrigin, 'https://machine2.local:3443');
      assert.equal(r.config.publicHost, 'machine2.local:3443');
      assert.equal(r.config.redirectUri, 'https://machine2.local:3443/auth/callback');
      assert.equal(r.config.sessionLifetimeMs, 7 * 24 * 3_600_000);
      assert.equal(r.config.issuer, VALID.issuer);
    }
  });

  it('for ANY non-empty set of broken required fields: refused, and EVERY broken one is named', () => {
    fc.assert(
      fc.property(
        fc.subarray([...REQUIRED], { minLength: 1 }).chain((fields) =>
          fc.tuple(fc.constant(fields), fc.tuple(...fields.map(([f]) => brokenValue(f)))),
        ),
        ([fields, values]) => {
          const input: Record<string, unknown> = { ...VALID };
          fields.forEach(([f], i) => (input[f] = values[i]));
          const r = validateServerConfig(input as unknown as ServerConfigInput);
          assert.equal(r.ok, false);
          if (!r.ok) {
            const named = new Set(r.problems.map((p) => p.setting));
            for (const [, setting] of fields) assert.ok(named.has(setting), `${setting} not named in ${[...named].join(', ')}`);
            // Nothing that was fine is blamed.
            for (const [f, setting] of REQUIRED) {
              if (!fields.some(([g]) => g === f)) assert.ok(!named.has(setting), `${setting} blamed but was valid`);
            }
          }
        },
      ),
    );
  });

  it('a trailing slash and an explicit default port are tolerated; the origin is normalised', () => {
    for (const [raw, origin, host] of [
      ['https://machine2.local:3443/', 'https://machine2.local:3443', 'machine2.local:3443'],
      ['https://machine2.local:443', 'https://machine2.local', 'machine2.local'],
    ] as const) {
      const r = validateServerConfig({ ...VALID, publicOrigin: raw });
      assert.equal(r.ok, true, raw);
      if (r.ok) {
        assert.equal(r.config.publicOrigin, origin);
        assert.equal(r.config.publicHost, host);
      }
    }
  });

  it('the session lifetime defaults to 7d when absent, and an out-of-range one is named', () => {
    const r = validateServerConfig({ ...VALID, sessionLifetime: undefined });
    assert.equal(r.ok && r.config.sessionLifetimeMs, 7 * 24 * 3_600_000);
    const bad = validateServerConfig({ ...VALID, sessionLifetime: '91d' });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.deepEqual(bad.problems.map((p) => p.setting), ['SESSION_LIFETIME']);
  });
});

describe('parseSessionLifetime (BR-91.3)', () => {
  it('for any whole number of hours or days: ok iff from 1h to 90d, and the value is exact', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999 }), fc.constantFrom('h', 'd'), (n, unit) => {
        const ms = n * (unit === 'd' ? 24 : 1) * 3_600_000;
        const r = parseSessionLifetime(`${n}${unit}`);
        if (ms >= MIN_SESSION_LIFETIME_MS && ms <= MAX_SESSION_LIFETIME_MS) assert.deepEqual(r, { ok: true, ms });
        else assert.equal(r.ok, false);
      }),
    );
  });

  it('anything not <whole number><h|d> is refused', () => {
    for (const raw of ['7', '7m', '7 d', '07d', '1.5d', '-1d', '0h', 'd', '7D', '']) {
      assert.equal(parseSessionLifetime(raw).ok, false, raw);
    }
  });
});
