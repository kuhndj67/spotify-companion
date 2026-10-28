/**
 * U11 (IN-U11-2, IN-U11-3) — the server compose template, `setup --server`, and the image's healthcheck target.
 *
 * ⚠️ The drift check is the point: compose.server.yaml must differ from compose.app.yaml ONLY as IN-U11-2 lists. A
 * setting added to one and forgotten in the other would otherwise reach a server install silently.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { SERVER_SETUP_FILES, decideSetup, runSetup } from '../src/appOnly/setup.js';
import { healthTarget } from '../src/health/healthTarget.js';

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');

/** `KEY: value` lines of the service's `environment:` block. */
function environment(yaml: string): Map<string, string> {
  const block = /\n    environment:\n((?:      .*\n|\s*#.*\n|\n)+)/.exec(yaml)?.[1] ?? '';
  const env = new Map<string, string>();
  for (const m of block.matchAll(/^      ([A-Z_]+):\s*(.*)$/gm)) env.set(m[1]!, m[2]!.trim());
  return env;
}
/** The indented lines under `    <name>:` (entries and comments), or '' when the section is absent. */
const section = (yaml: string, name: string) => new RegExp(`\\n    ${name}:\\n((?:      .*\\n|\\s*#.*\\n)+)`).exec(yaml)?.[1] ?? '';
const entries = (block: string) => [...block.matchAll(/^      - (.*)$/gm)].map((m) => m[1]!.trim());

describe('compose.server.yaml differs from compose.app.yaml only as IN-U11-2 lists', () => {
  const app = read('compose.app.yaml');
  const server = read('compose.server.yaml');
  const SERVER_ONLY = ['ACCESS_MODE', 'PUBLIC_ORIGIN', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_ALLOWED_SUBJECT', 'SESSION_LIFETIME', 'NODE_EXTRA_CA_CERTS'];
  const APP_ONLY = ['LOCAL_ONLY', 'TRUST_PUBLISHED_PORT'];

  it('⭐ environment: the same settings with the same values, except the access settings', () => {
    const a = environment(app);
    const s = environment(server);
    assert.ok(a.size > 10 && s.size > 10, 'both environment blocks parsed');
    for (const k of APP_ONLY) assert.ok(a.has(k) && !s.has(k), `${k}: App only, never in server mode (BR-88.5)`);
    for (const k of SERVER_ONLY) assert.ok(s.has(k) && !a.has(k), `${k}: server only`);
    const shared = [...a.keys()].filter((k) => !APP_ONLY.includes(k));
    assert.deepEqual(shared.map((k) => [k, s.get(k)]), shared.map((k) => [k, a.get(k)]));
    assert.equal(s.get('ACCESS_MODE'), 'server');
    assert.equal(s.get('NODE_EXTRA_CA_CERTS'), '/config/ca/ca-cert.pem');
  });

  it('volumes: the same four; ports: the LAN address on 3443 only; one extra_hosts entry with the same address', () => {
    assert.deepEqual(entries(section(server, 'volumes')), entries(section(app, 'volumes')));
    assert.deepEqual(entries(section(server, 'ports')), ['"<LAN address>:3443:3000"']);
    assert.deepEqual(entries(section(server, 'extra_hosts')), ['"<name>:<LAN address>"']);
    assert.equal(section(app, 'extra_hosts'), '');
  });

  it('the positive control: the parser sees a planted difference', () => {
    const planted = app.replace('      POLL_INTERVAL_MS: 3000', '      POLL_INTERVAL_MS: 9999');
    assert.notEqual(environment(planted).get('POLL_INTERVAL_MS'), environment(app).get('POLL_INTERVAL_MS'));
  });
});

describe('setup --server (IN-U11-3)', () => {
  const templatesFrom = (dir: string) => {
    const t = join(dir, 'templates');
    mkdirSync(t);
    writeFileSync(join(t, 'compose.server.yaml'), readFileSync(join(root, 'compose.server.yaml')));
    writeFileSync(join(t, 'musicbrainz.example.json'), readFileSync(join(root, 'secrets', 'musicbrainz.example.json')));
    writeFileSync(join(t, 'rules.example.json'), readFileSync(join(root, 'config', 'rules.example.json')));
    return t;
  };

  it('decideSetup with the server files: writes nothing if any target exists, and names each one', () => {
    const targets = SERVER_SETUP_FILES.map(([t]) => t);
    fc.assert(
      fc.property(fc.subarray([...targets, 'README.md', 'secrets/app/tls/server-key.pem']), (present) => {
        const d = decideSetup(new Set(present), SERVER_SETUP_FILES);
        const blocking = targets.filter((t) => present.includes(t));
        assert.deepEqual(d, blocking.length > 0 ? { write: false, inTheWay: blocking } : { write: true, files: targets });
      }),
    );
  });

  it('⭐ writes the SERVER template as compose.yaml, the starter files, and empty config/ca/ and secrets/app/tls/; no key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'server-setup-'));
    try {
      const folder = join(dir, 'folder');
      mkdirSync(folder);
      const outcome = runSetup(folder, templatesFrom(dir), 'server');
      assert.ok(outcome.ok, outcome.ok ? '' : outcome.message);
      const compose = readFileSync(join(folder, 'compose.yaml'), 'utf8');
      assert.match(compose, /ACCESS_MODE: server/);
      assert.deepEqual(readdirSync(join(folder, 'config', 'ca')), []);
      assert.deepEqual(readdirSync(join(folder, 'secrets', 'app', 'tls')), []);
      assert.ok(existsSync(join(folder, 'secrets', 'app', 'musicbrainz.json')));
      assert.ok(!existsSync(join(folder, 'secrets', 'app', 'session.key')), 'setup makes no key of any kind');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the App-only setup is unchanged: no server folders, the App-only template', () => {
    const dir = mkdtempSync(join(tmpdir(), 'server-setup-'));
    try {
      const t = templatesFrom(dir);
      writeFileSync(join(t, 'compose.app.yaml'), readFileSync(join(root, 'compose.app.yaml')));
      const folder = join(dir, 'folder');
      mkdirSync(folder);
      assert.ok(runSetup(folder, t).ok);
      assert.doesNotMatch(readFileSync(join(folder, 'compose.yaml'), 'utf8'), /ACCESS_MODE/);
      assert.ok(!existsSync(join(folder, 'config', 'ca')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('healthTarget (the image HEALTHCHECK)', () => {
  it('local (absent, empty, "local"): http /api/health on PORT', () => {
    for (const ACCESS_MODE of [undefined, '', 'local']) {
      assert.deepEqual(healthTarget({ ACCESS_MODE, PORT: '3000' }), { protocol: 'http', port: 3000, path: '/api/health' });
    }
  });

  it('⭐ server: https, an OPEN route, with the PUBLIC Host and SNI name', () => {
    assert.deepEqual(healthTarget({ ACCESS_MODE: 'server', PORT: '3000', PUBLIC_ORIGIN: 'https://machine2.local:3443' }), {
      protocol: 'https',
      port: 3000,
      path: '/auth/auth.css',
      host: 'machine2.local:3443',
      servername: 'machine2.local',
    });
  });

  it('anything the app itself would refuse → null (the check fails: the app is not serving)', () => {
    for (const env of [
      { ACCESS_MODE: 'Server' },
      { ACCESS_MODE: 'server' },
      { ACCESS_MODE: 'server', PUBLIC_ORIGIN: 'http://machine2.local:3443' },
      { ACCESS_MODE: 'server', PUBLIC_ORIGIN: '<name>' },
      { PORT: 'x' },
    ]) {
      assert.equal(healthTarget(env), null, JSON.stringify(env));
    }
  });
});
