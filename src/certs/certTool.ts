/**
 * U11 (IN-U11-4, IN-U11-5): the certificate tool. 🔌 IMPURE: it runs `openssl` and writes files.
 *
 *   makeCa  → `ca-cert.pem`, `ca-key.pem` in a folder the owner names (refused inside a repository or install folder)
 *   issue   → `<name>-cert.pem`, `<name>-key.pem`: a server certificate for the given names, signed by the CA
 *   verify  → after every action, and on its own: the chain verifies, the names are covered, the lifetime is within
 *             825 days, and ⭐ a throwaway certificate for a name OUTSIDE the constraint is issued and must FAIL.
 *             Any failure → not ok; nothing is reported as done.
 *
 * Never overwrites a file: a renewal goes into a new folder. Keys are written with mode 600.
 *
 * ⚠️ The CA key leaves this module only as a file the owner moves offline (IN-U11-5). It is never printed.
 */

import { spawnSync } from 'node:child_process';
import { X509Certificate, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  CA_DAYS,
  caExtensions,
  checkCaKeyDestination,
  checkLeafDays,
  commonName,
  leafExtensions,
  validateNames,
  MAX_LEAF_DAYS,
  type CertNames,
  type FolderFacts,
} from './certPolicy.js';

export type ToolOutcome = { readonly ok: true; readonly lines: readonly string[] } | { readonly ok: false; readonly problems: readonly string[] };

/** The constraint's positive control: never a name anyone would put in a constraint. */
const OUTSIDE_NAME = 'outside-the-constraint.invalid';

export function makeCa(outDir: string, names: CertNames): ToolOutcome {
  const named = validateNames(names);
  if (!named.ok) return named;
  const destination = checkCaKeyDestination(folderFacts(outDir));
  if (!destination.ok) return destination;
  const certPath = join(outDir, 'ca-cert.pem');
  const keyPath = join(outDir, 'ca-key.pem');
  const inTheWay = [certPath, keyPath].filter((p) => existsSync(p));
  if (inTheWay.length > 0) return { ok: false, problems: [`refusing to overwrite ${inTheWay.join(', ')}; use an empty folder`] };

  mkdirSync(outDir, { recursive: true });
  return withScratch((scratch) => {
    const cnf = join(scratch, 'ca.cnf');
    writeFileSync(cnf, `[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = Spotify Companion CA for ${commonName(names)}\n${caExtensions(names)}`);
    const made = openssl(['req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', String(CA_DAYS), '-config', cnf, '-extensions', 'ca_ext', '-keyout', keyPath, '-out', certPath]);
    if (!made.ok) return made;
    protect(keyPath);
    const checked = selfCheckCa(outDir, names);
    if (!checked.ok) {
      rmSync(certPath, { force: true });
      rmSync(keyPath, { force: true });
      return checked;
    }
    return {
      ok: true,
      lines: [
        `CA written: ${certPath} (public: install it on each device, and put it in the server's config/ca/)`,
        `CA KEY written: ${keyPath}`,
        '⚠️ Move ca-key.pem OFFLINE now (password manager attachment, or removable media), then delete this copy.',
        '   It is needed again only to issue or renew a certificate.',
        `CA valid for ${CA_DAYS / 365} years. Self-check with a throwaway one-day certificate:`,
        ...checked.lines.map((l) => `  ${l}`),
      ],
    };
  });
}

export function issue(caDir: string, outDir: string, baseName: string, names: CertNames, days: number = MAX_LEAF_DAYS): ToolOutcome {
  const problems = [...problemsOf(validateNames(names)), ...problemsOf(checkLeafDays(days))];
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(baseName)) problems.push(`--name must be a short lower-case word like "server" or "sso"; got ${JSON.stringify(baseName)}`);
  const caCert = join(caDir, 'ca-cert.pem');
  const caKey = join(caDir, 'ca-key.pem');
  for (const p of [caCert, caKey]) if (!existsSync(p)) problems.push(`${p} not found (the CA key is needed to issue; bring it back from offline for this)`);
  const certPath = join(outDir, `${baseName}-cert.pem`);
  const keyPath = join(outDir, `${baseName}-key.pem`);
  for (const p of [certPath, keyPath]) if (existsSync(p)) problems.push(`refusing to overwrite ${p}; use an empty folder (a renewal goes into a new one)`);
  if (problems.length > 0) return { ok: false, problems };

  mkdirSync(outDir, { recursive: true });
  const signed = signLeaf(caCert, caKey, names, days, certPath, keyPath);
  if (!signed.ok) return signed;
  const checked = verify(caCert, certPath, names, caKey);
  if (!checked.ok) {
    rmSync(certPath, { force: true });
    rmSync(keyPath, { force: true });
    return checked;
  }
  return { ok: true, lines: [`certificate: ${certPath}`, `its key: ${keyPath} (secret; for the server only)`, ...checked.lines] };
}

/**
 * The checks, run after every action. With the CA key (`caKey`), it also runs the positive control: a certificate
 * for a name outside the constraint must be REFUSED. Without the key (verifying later, CA offline), it says so.
 */
export function verify(caCertPath: string, certPath: string, names: CertNames, caKey?: string): ToolOutcome {
  const lines: string[] = [];
  const chain = openssl(['verify', '-x509_strict', '-CAfile', caCertPath, certPath]);
  if (!chain.ok) return { ok: false, problems: [`the certificate does not verify against the CA: ${chain.problems.join(' ')}`] };
  lines.push('✓ verifies against the CA');

  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(readFileSync(certPath));
  } catch {
    return { ok: false, problems: [`${certPath} is not a certificate`] };
  }
  const missing = [
    ...names.dns.filter((d) => x509.checkHost(d, { subject: 'never', wildcards: false }) === undefined),
    ...names.ip.filter((i) => x509.checkIP(i) === undefined),
  ];
  if (missing.length > 0) return { ok: false, problems: [`the certificate does not cover: ${missing.join(', ')}`] };
  lines.push(`✓ covers ${[...names.dns, ...names.ip].join(', ')}`);

  const days = Math.round((Date.parse(x509.validTo) - Date.parse(x509.validFrom)) / 86_400_000);
  if (days > MAX_LEAF_DAYS) return { ok: false, problems: [`the certificate lasts ${days} days, more than ${MAX_LEAF_DAYS}`] };
  lines.push(`✓ valid until ${new Date(x509.validTo).toISOString().slice(0, 10)} (${days} days)`);

  if (caKey === undefined) {
    lines.push('· the constraint control needs the CA key, so it was run when the certificate was issued, not now');
    return { ok: true, lines };
  }
  const control = outsideNameIsRefused(caCertPath, caKey);
  if (!control.ok) return control;
  lines.push(...control.lines);
  return { ok: true, lines };
}

/** ⭐ The positive control: the CA must not be able to vouch for a name it was not constrained to. */
function outsideNameIsRefused(caCert: string, caKey: string): ToolOutcome {
  return withScratch((scratch) => {
    const outsideCert = join(scratch, 'outside-cert.pem');
    const signed = signLeaf(caCert, caKey, { dns: [OUTSIDE_NAME], ip: [] }, 1, outsideCert, join(scratch, 'outside-key.pem'));
    if (!signed.ok) return { ok: false, problems: [`the constraint control could not run: ${signed.problems.join(' ')}`] };
    const result = openssl(['verify', '-x509_strict', '-CAfile', caCert, outsideCert]);
    if (result.ok) {
      return { ok: false, problems: [`⚠️ the CA vouched for ${OUTSIDE_NAME}: its name constraint is NOT working. Do not use this CA.`] };
    }
    return { ok: true, lines: [`✓ positive control: a certificate for ${OUTSIDE_NAME} is refused (name constraint works)`] };
  });
}

/** After making a CA: issue a throwaway certificate for its own names (must pass) and for another (must fail). */
function selfCheckCa(caDir: string, names: CertNames): ToolOutcome {
  return withScratch((scratch) => {
    const caCert = join(caDir, 'ca-cert.pem');
    const caKey = join(caDir, 'ca-key.pem');
    const cert = join(scratch, 'self-cert.pem');
    const signed = signLeaf(caCert, caKey, names, 1, cert, join(scratch, 'self-key.pem'));
    if (!signed.ok) return signed;
    return verify(caCert, cert, names, caKey);
  });
}

function signLeaf(caCert: string, caKey: string, names: CertNames, days: number, certPath: string, keyPath: string): ToolOutcome {
  return withScratch((scratch) => {
    const csr = join(scratch, 'leaf.csr');
    const ext = join(scratch, 'leaf.ext');
    writeFileSync(ext, leafExtensions(names));
    const request = openssl(['req', '-new', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-subj', `/CN=${commonName(names)}`, '-keyout', keyPath, '-out', csr]);
    if (!request.ok) return request;
    protect(keyPath);
    // A random serial, so no `.srl` file is left beside the CA (it may be on removable media).
    const serial = `0x${randomBytes(16).toString('hex')}`;
    const signed = openssl(['x509', '-req', '-sha256', '-in', csr, '-CA', caCert, '-CAkey', caKey, '-set_serial', serial, '-days', String(days), '-extfile', ext, '-out', certPath]);
    if (!signed.ok) rmSync(keyPath, { force: true });
    return signed;
  });
}

function openssl(args: string[]): ToolOutcome {
  const r = spawnSync('openssl', args, { encoding: 'utf8' });
  if (r.error) return { ok: false, problems: [`openssl could not be run (${(r.error as NodeJS.ErrnoException).code}): install it, or use the image's certs command`] };
  if (r.status !== 0) return { ok: false, problems: [(r.stderr || r.stdout || `openssl ${args[0]} exited ${r.status}`).trim().split('\n').slice(0, 3).join(' ')] };
  return { ok: true, lines: [] };
}

function withScratch(fn: (dir: string) => ToolOutcome): ToolOutcome {
  const dir = mkdtempSync(join(tmpdir(), 'companion-certs-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function protect(keyPath: string): void {
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* Windows: permissions are the folder's */
  }
}

function problemsOf(v: { ok: true } | { ok: false; problems: readonly string[] }): string[] {
  return v.ok ? [] : [...v.problems];
}

/** The destination and every folder above it, for `checkCaKeyDestination`. */
function folderFacts(outDir: string): FolderFacts {
  const chain: Array<FolderFacts['chain'][number]> = [];
  let current = resolve(outDir);
  for (;;) {
    chain.push({
      path: current,
      hasGit: existsSync(join(current, '.git')),
      hasCompose: existsSync(join(current, 'compose.yaml')),
      hasSecrets: existsSync(join(current, 'secrets')),
    });
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { chain };
}
