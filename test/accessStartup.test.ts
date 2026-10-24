/**
 * U11 (LC-90; BR-88.4, BR-88.5, BR-95; P-89) — which listener the app opens, against real files in a temporary
 * folder. Plus the structural pin on `server.ts`: recording starts unconditionally, before any listener (P-96).
 *
 * ⚠️ Positive control: a complete server configuration IS `server`, with the session key created; a function that
 * always answered `not-serving` would pass every refusal here.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureAccess, notServingLines, notServingSummary, type AccessInputs } from '../src/access/accessStartup.js';
import { makeTestCertificates, type TestCertificates } from './support/testCa.js';

const SECRET = 'client-secret-must-never-appear-ZQ81';
let dir: string;
let certs: TestCertificates;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'u11-startup-'));
  certs = makeTestCertificates({ dns: ['machine2.local'], ip: [] });
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** A fresh secrets folder for each case, with every file present unless told otherwise. */
function inputs(over: Partial<AccessInputs> = {}, files: { secret?: string | null; cert?: string | null; key?: string | null } = {}): AccessInputs {
  const folder = mkdtempSync(join(dir, 'case-'));
  mkdirSync(join(folder, 'tls'));
  const put = (name: string, content: string | null | undefined, fallback: string) => {
    const value = content === undefined ? fallback : content;
    if (value !== null) writeFileSync(join(folder, name), value);
  };
  put('oidc-client-secret', files.secret, `${SECRET}\n`);
  put('tls/server-cert.pem', files.cert, certs.certPem);
  put('tls/server-key.pem', files.key, certs.keyPem);
  return {
    modeRaw: 'server',
    publicOriginRaw: 'https://machine2.local:3443',
    issuerRaw: 'https://machine2.local:9443/webman/sso',
    clientIdRaw: 'abc123',
    allowedSubjectRaw: 'owner',
    sessionLifetimeRaw: undefined,
    clientSecretPath: join(folder, 'oidc-client-secret'),
    certPath: join(folder, 'tls/server-cert.pem'),
    keyPath: join(folder, 'tls/server-key.pem'),
    sessionKeyPath: join(folder, 'session.key'),
    localOnlyRaw: undefined,
    trustPublishedPortRaw: undefined,
    ...over,
  };
}

const settingsOf = (r: ReturnType<typeof configureAccess>) => (r.mode === 'not-serving' ? r.problems.map((p) => p.setting) : []);

describe('configureAccess', () => {
  it('⭐ a complete server configuration → server, with the secret trimmed and the session key created (600)', () => {
    const i = inputs();
    const r = configureAccess(i);
    assert.equal(r.mode, 'server', JSON.stringify(settingsOf(r)));
    if (r.mode !== 'server') return;
    assert.equal(r.clientSecret, SECRET);
    assert.equal(r.config.redirectUri, 'https://machine2.local:3443/auth/callback');
    assert.ok(r.certificate.subjectAltName.includes('machine2.local'));
    assert.equal(r.sessionKey.length, 32);
    assert.ok(existsSync(i.sessionKeyPath));
    assert.deepEqual(r.ignoredSettings, []);
  });

  it('absent or "local" → local, and no file is read or written', () => {
    for (const modeRaw of [undefined, '', 'local']) {
      const i = inputs({ modeRaw });
      assert.deepEqual(configureAccess(i), { mode: 'local' });
      assert.ok(!existsSync(i.sessionKeyPath));
    }
  });

  it('an unknown mode → not serving, naming ACCESS_MODE (never local by guess)', () => {
    assert.deepEqual(settingsOf(configureAccess(inputs({ modeRaw: 'Server' }))), ['ACCESS_MODE']);
  });

  it('each required value removed in turn → not serving, naming exactly that value, and no session key is made', () => {
    const cases: Array<[Partial<AccessInputs>, Parameters<typeof inputs>[1], string]> = [
      [{ publicOriginRaw: undefined }, {}, 'PUBLIC_ORIGIN'],
      [{ publicOriginRaw: 'http://machine2.local:3443' }, {}, 'PUBLIC_ORIGIN'],
      [{ issuerRaw: undefined }, {}, 'OIDC_ISSUER'],
      [{ clientIdRaw: undefined }, {}, 'OIDC_CLIENT_ID'],
      [{ allowedSubjectRaw: undefined }, {}, 'OIDC_ALLOWED_SUBJECT'],
      [{ sessionLifetimeRaw: '30m' }, {}, 'SESSION_LIFETIME'],
      [{}, { secret: null }, 'secrets/app/oidc-client-secret'],
      [{}, { secret: '  \n' }, 'secrets/app/oidc-client-secret'],
      [{}, { cert: null }, 'secrets/app/tls/server-cert.pem'],
      [{}, { cert: 'not a certificate' }, 'secrets/app/tls/server-cert.pem'],
      [{}, { key: null }, 'secrets/app/tls/server-key.pem'],
      [{}, { key: 'not a key' }, 'secrets/app/tls/server-key.pem'],
    ];
    for (const [over, files, setting] of cases) {
      const i = inputs(over, files);
      const r = configureAccess(i);
      assert.deepEqual(settingsOf(r), [setting], `${setting}: ${JSON.stringify(settingsOf(r))}`);
      assert.ok(!existsSync(i.sessionKeyPath), `${setting}: no session key before the configuration is complete`);
    }
  });

  it('a key that does not match the certificate is named, as a mismatch', () => {
    const r = configureAccess(inputs({}, { key: certs.otherKeyPem }));
    assert.equal(r.mode, 'not-serving');
    if (r.mode === 'not-serving') assert.match(r.problems[0]!.message, /does not match the certificate/);
  });

  it('everything missing at once → every problem listed, not only the first', () => {
    const r = configureAccess(inputs({ publicOriginRaw: undefined, issuerRaw: undefined, clientIdRaw: undefined, allowedSubjectRaw: undefined }, { secret: null, cert: null, key: null }));
    assert.equal(settingsOf(r).length, 7);
  });

  it('BR-88.5: LOCAL_ONLY and TRUST_PUBLISHED_PORT set in server mode are reported as ignored', () => {
    const r = configureAccess(inputs({ localOnlyRaw: 'false', trustPublishedPortRaw: 'true' }));
    assert.equal(r.mode, 'server');
    if (r.mode === 'server') assert.deepEqual(r.ignoredSettings, ['LOCAL_ONLY', 'TRUST_PUBLISHED_PORT']);
  });

  it('BR-95.1: no problem or log line ever contains the client secret', () => {
    const r = configureAccess(inputs({ publicOriginRaw: undefined, clientIdRaw: 'abc 123' }, { cert: null }));
    assert.equal(r.mode, 'not-serving');
    if (r.mode !== 'not-serving') return;
    const text = [...notServingLines(r.problems), notServingSummary(r.problems)].join('\n');
    assert.ok(!text.includes(SECRET));
    assert.match(text, /NOT SERVING/);
    assert.match(text, /recording continues/i);
  });
});

/** `server.ts` cannot be imported (it starts the process), so its order is pinned on its text, as U6 does. */
const SERVER = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CODE = SERVER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const at = (needle: string) => {
  const i = CODE.indexOf(needle);
  assert.notEqual(i, -1, `server.ts no longer contains \`${needle}\`; update this pin deliberately, never silently`);
  return i;
};

describe('server.ts: recording is independent of access (P-96, BR-91.6)', () => {
  it('⭐ startRecording() is called once, at top level, unconditionally, before any listener', () => {
    const calls = [...CODE.matchAll(/^startRecording\(\);$/gm)];
    assert.equal(calls.length, 1, 'exactly one top-level, unindented call');
    assert.equal([...CODE.matchAll(/startRecording\(\)/g)].length, 2, 'the definition and that call; no other caller');
    assert.ok(at('\nstartRecording();') < at('server.listen('));
  });

  it('the poll loop starts in startRecording, not in the listen callback', () => {
    const body = CODE.slice(at('function startRecording(): void {'), at('\nstartRecording();'));
    assert.ok(body.includes('nowPlaying.start();'));
    assert.ok(body.includes('backupScheduler?.start();'));
    assert.equal([...CODE.matchAll(/nowPlaying\.start\(\)/g)].length, 1);
  });

  it('not-serving opens no listener: server.listen is only in the branch where access is not "not-serving"', () => {
    const branch = at("if (access.mode === 'not-serving') {");
    const elseAt = at('} else {\n  server.listen(');
    assert.ok(branch < elseAt);
    assert.equal([...CODE.matchAll(/\.listen\(/g)].length, 1, 'one listen call in server.ts');
  });

  it('server mode serves HTTPS only: the server is https when the mode is server', () => {
    assert.ok(CODE.includes("const server = access.mode === 'server' ? createHttpsServer({ cert: access.tls.cert, key: access.tls.key }, app) : createServer(app);"));
  });

  it('the upgrade handler uses the shared builder and the same session step, and reads no cookie itself (P-88)', () => {
    const upgrade = CODE.slice(at("server.on('upgrade'"), at("wss.handleUpgrade("));
    assert.ok(upgrade.includes('accessRequestFrom(request)'));
    assert.ok(upgrade.includes('verifyRequestSession'));
    assert.ok(!/headers\.(cookie|host|origin)/.test(upgrade), 'no header read in the upgrade handler');
  });
});
