/**
 * U11 (P-94): a throwaway CA and a server certificate, made with `openssl` in a temporary folder, for each test run.
 *
 * ⚠️ Generated, never committed: a private key in the repository would trip the secret scan, and one fixed CA would
 * be trusted by every run forever. Needs `openssl` on the PATH (Git for Windows ships one; CI's Ubuntu has one). If
 * it is missing the tests FAIL, saying so: a skip would be green for the wrong reason.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestCertificates {
  readonly caPem: string;
  readonly certPem: string;
  readonly keyPem: string;
  /** Another key, not the certificate's: a mismatch case. */
  readonly otherKeyPem: string;
}

function openssl(args: string[], cwd: string): void {
  const r = spawnSync('openssl', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`openssl is needed by this test and could not be run (${(r.error as NodeJS.ErrnoException).code}). Install it or put it on the PATH.`);
  if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr}`);
}

export function makeTestCertificates(names: { dns: readonly string[]; ip: readonly string[] } = { dns: ['localhost'], ip: ['127.0.0.1'] }): TestCertificates {
  const dir = mkdtempSync(join(tmpdir(), 'u11-ca-'));
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=U11 test CA',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], dir);
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', `/CN=${names.dns[0] ?? names.ip[0]}`], dir);
    const san = [...names.dns.map((d) => `DNS:${d}`), ...names.ip.map((i) => `IP:${i}`)].join(',');
    writeFileSync(join(dir, 'ext.cnf'), `subjectAltName=${san}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
    openssl(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'ext.cnf'], dir);
    openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', 'other.key'], dir);
    return {
      caPem: readFileSync(join(dir, 'ca.pem'), 'utf8'),
      certPem: readFileSync(join(dir, 'leaf.pem'), 'utf8'),
      keyPem: readFileSync(join(dir, 'leaf.key'), 'utf8'),
      otherKeyPem: readFileSync(join(dir, 'other.key'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
