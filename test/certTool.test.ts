/**
 * U11 (IN-U11-4, IN-U11-5) — the certificate tool: its pure checks, and the tool itself run against `openssl` in a
 * temporary folder.
 *
 * ⚠️ Positive controls: a CA for the given names IS made and a certificate for them DOES verify; the tool's own
 * control (a name outside the constraint is refused) is run by every action, and here it is also seen to FAIL the
 * action when the constraint is missing.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import fc from 'fast-check';
import './fc-config.js';
import { caExtensions, checkCaKeyDestination, checkLeafDays, leafExtensions, validateNames, MAX_LEAF_DAYS } from '../src/certs/certPolicy.js';
import { issue, makeCa, verify } from '../src/certs/certTool.js';

describe('certPolicy', () => {
  it('names: lower-case LDH names and IPv4 addresses pass; wildcards, upper case, IPv6, junk, repeats and none are refused', () => {
    assert.deepEqual(validateNames({ dns: ['machine2.local', 'a-b.c'], ip: ['192.168.0.223'] }), { ok: true });
    for (const bad of [
      { dns: [], ip: [] },
      { dns: ['*.local'], ip: [] },
      { dns: ['Machine2.local'], ip: [] },
      { dns: ['-x.local'], ip: [] },
      { dns: ['a..b'], ip: [] },
      { dns: ['x.local', 'x.local'], ip: [] },
      { dns: [], ip: ['fd00::1'] },
      { dns: [], ip: ['192.168.0.256'] },
      { dns: [], ip: ['01.2.3.4'] },
    ]) {
      assert.equal(validateNames(bad).ok, false, JSON.stringify(bad));
    }
  });

  it('lifetime: 1…825 days pass, anything else is refused', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10, max: 5000 }), (days) => {
        assert.equal(checkLeafDays(days).ok, days >= 1 && days <= MAX_LEAF_DAYS);
      }),
    );
    assert.equal(checkLeafDays(1.5).ok, false);
  });

  it('IN-U11-5: the CA key is refused anywhere at or under a git repository or an install folder', () => {
    const f = (o: Partial<{ hasGit: boolean; hasCompose: boolean; hasSecrets: boolean }>, depth: number) => ({
      chain: Array.from({ length: 3 }, (_, i) => ({ path: `/p${i}`, hasGit: false, hasCompose: false, hasSecrets: false, ...(i === depth ? o : {}) })),
    });
    assert.deepEqual(checkCaKeyDestination(f({}, 0)), { ok: true });
    for (const facts of [{ hasGit: true }, { hasCompose: true }, { hasSecrets: true }]) {
      for (const depth of [0, 1, 2]) assert.equal(checkCaKeyDestination(f(facts, depth)).ok, false, `${JSON.stringify(facts)} at ${depth}`);
    }
  });

  it('the CA is name-constrained, critically, to exactly the names; the leaf is serverAuth, never a CA', () => {
    const ca = caExtensions({ dns: ['machine2.local'], ip: ['192.168.0.223'] });
    assert.match(ca, /nameConstraints = critical, permitted;DNS:machine2\.local, permitted;IP:192\.168\.0\.223\/255\.255\.255\.255/);
    assert.match(ca, /pathlen:0/);
    const leaf = leafExtensions({ dns: ['machine2.local'], ip: [] });
    assert.match(leaf, /CA:FALSE/);
    assert.match(leaf, /extendedKeyUsage = serverAuth/);
    assert.match(leaf, /subjectAltName = DNS:machine2\.local/);
  });
});

describe('the tool, against openssl', () => {
  let root: string;
  const names = { dns: ['machine2.local'], ip: ['192.168.0.223'] };
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'u11-certs-'));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('⭐ makes a constrained CA, issues a certificate that verifies, and the constraint refuses another name', () => {
    const caDir = join(root, 'ca');
    const made = makeCa(caDir, names);
    assert.equal(made.ok, true, made.ok ? '' : made.problems.join('\n'));
    if (!made.ok) return;
    assert.ok(made.lines.some((l) => l.includes('positive control') && l.includes('refused')));
    const ca = new X509Certificate(readFileSync(join(caDir, 'ca-cert.pem')));
    assert.equal(ca.ca, true);
    if (process.platform !== 'win32') assert.equal(statSync(join(caDir, 'ca-key.pem')).mode & 0o777, 0o600);

    const out = join(root, 'issued');
    const issued = issue(caDir, out, 'server', names);
    assert.equal(issued.ok, true, issued.ok ? '' : issued.problems.join('\n'));
    const cert = new X509Certificate(readFileSync(join(out, 'server-cert.pem')));
    assert.equal(cert.checkHost('machine2.local'), 'machine2.local');
    assert.equal(cert.checkIP('192.168.0.223'), '192.168.0.223');
    assert.ok(cert.verify(ca.publicKey));
    const days = Math.round((Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86_400_000);
    assert.equal(days, MAX_LEAF_DAYS);
    // No serial file is left beside the CA (it may be on removable media).
    assert.deepEqual(['ca-cert.pem', 'ca-key.pem'].every((f) => existsSync(join(caDir, f))), true);
    assert.equal(existsSync(join(caDir, 'ca-cert.srl')), false);

    // verify on its own, without the CA key: passes, and says the control ran at issue time.
    const later = verify(join(caDir, 'ca-cert.pem'), join(out, 'server-cert.pem'), names);
    assert.equal(later.ok, true);
    if (later.ok) assert.ok(later.lines.some((l) => l.includes('needs the CA key')));
  });

  it('refuses: overwriting, more than 825 days, a name the certificate does not cover, a CA in an install folder', () => {
    const caDir = join(root, 'ca');
    assert.equal(makeCa(caDir, names).ok, false, 'the CA folder from the first test is not overwritten');
    assert.equal(issue(caDir, join(root, 'long'), 'server', names, 826).ok, false);
    const mismatch = verify(join(caDir, 'ca-cert.pem'), join(root, 'issued', 'server-cert.pem'), { dns: ['other.local'], ip: [] });
    assert.equal(mismatch.ok, false);
    const install = join(root, 'install');
    mkdirSync(join(install, 'secrets'), { recursive: true });
    const refused = makeCa(join(install, 'ca'), names);
    assert.equal(refused.ok, false);
    assert.ok(!existsSync(join(install, 'ca', 'ca-key.pem')));
  });

  it('⭐ the control itself: a CA WITHOUT a name constraint vouches for any name, and verify FAILS the action', () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    const run = (args: string[]) => assert.equal(spawnSync('openssl', args, { cwd: plain, encoding: 'utf8' }).status, 0);
    writeFileSync(join(plain, 'ca.cnf'), '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=unconstrained\n[ca_ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n');
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-config', 'ca.cnf', '-extensions', 'ca_ext', '-keyout', 'ca-key.pem', '-out', 'ca-cert.pem']);
    const out = join(root, 'plain-issued');
    const r = issue(plain, out, 'server', names, 30);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.problems.join(' '), /name constraint is NOT working/);
    assert.ok(!existsSync(join(out, 'server-key.pem')), 'nothing is left reported as done');
  });
});
