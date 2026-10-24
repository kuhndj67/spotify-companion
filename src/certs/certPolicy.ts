/**
 * U11 (IN-U11-4, IN-U11-5): the rules the certificate tool applies before it runs `openssl`.
 *
 * ⚙️ PURE. Names in, verdicts and `openssl` configuration text out; the facts about folders are passed in. The tool
 * (`certTool.ts`) is the impure shell around this.
 *
 * - **Names**: DNS names in the usual letters-digits-hyphens form, lower case, no wildcard; IPv4 addresses. At least
 *   one. IPv6 is refused with a reason: not needed for Machine 2, and a constraint written wrong is worse than none.
 * - **Lifetime**: a server certificate at most **825 days** (the limit browsers enforce); the CA ten years.
 * - **Where the CA key goes**: never into the repository, never into an install folder (one holding `compose.yaml`
 *   or a `secrets` folder), so it cannot be committed or copied to the server with the rest (IN-U11-5).
 */

export const MAX_LEAF_DAYS = 825;
export const CA_DAYS = 3650;

export interface CertNames {
  readonly dns: readonly string[];
  readonly ip: readonly string[];
}

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateNames(names: CertNames): Verdict {
  const problems: string[] = [];
  if (names.dns.length + names.ip.length === 0) problems.push('give at least one --dns name or --ip address');
  for (const name of names.dns) {
    if (name !== name.toLowerCase()) problems.push(`DNS name ${JSON.stringify(name)} must be lower case`);
    else if (name.includes('*')) problems.push(`DNS name ${JSON.stringify(name)}: wildcards are not issued`);
    else if (name.length > 253 || !name.split('.').every((l) => LABEL.test(l))) problems.push(`DNS name ${JSON.stringify(name)} is not a valid name`);
  }
  for (const ip of names.ip) {
    if (ip.includes(':')) problems.push(`IP address ${JSON.stringify(ip)}: IPv6 is not supported by this tool`);
    else if (!isIPv4(ip)) problems.push(`IP address ${JSON.stringify(ip)} is not an IPv4 address`);
  }
  if (new Set(names.dns).size !== names.dns.length || new Set(names.ip).size !== names.ip.length) problems.push('a name or address is given twice');
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

export function checkLeafDays(days: number): Verdict {
  if (!Number.isInteger(days) || days < 1) return { ok: false, problems: [`--days must be a whole number of days, at least 1; got ${days}`] };
  if (days > MAX_LEAF_DAYS) return { ok: false, problems: [`--days must be at most ${MAX_LEAF_DAYS} (browsers refuse longer server certificates); got ${days}`] };
  return { ok: true };
}

/** What the tool found about the destination folder and each folder above it. */
export interface FolderFacts {
  /** For the destination and each ancestor: does it hold `.git`, `compose.yaml`, or a `secrets` folder? */
  readonly chain: ReadonlyArray<{ readonly path: string; readonly hasGit: boolean; readonly hasCompose: boolean; readonly hasSecrets: boolean }>;
}

/** IN-U11-5: where the CA key may be written. */
export function checkCaKeyDestination(facts: FolderFacts): Verdict {
  for (const folder of facts.chain) {
    if (folder.hasGit) return { ok: false, problems: [`${folder.path} is (inside) a git repository: the CA key must never be where it can be committed`] };
    if (folder.hasCompose || folder.hasSecrets) {
      return { ok: false, problems: [`${folder.path} is (inside) an install folder: the CA key must never be copied to a server with the rest`] };
    }
  }
  return { ok: true };
}

/**
 * The CA's extensions. **Name-constrained** (critical) to exactly the names given: whoever holds the CA key can make
 * certificates for those names only, and every other name is refused by a verifier that honours the constraint
 * (seen to, by the tool's positive control). `pathlen:0`: it signs server certificates, never another CA.
 */
export function caExtensions(names: CertNames): string {
  const permitted = [
    ...names.dns.map((d) => `permitted;DNS:${d}`),
    ...names.ip.map((i) => `permitted;IP:${i}/255.255.255.255`),
  ];
  return [
    '[ca_ext]',
    'basicConstraints = critical, CA:TRUE, pathlen:0',
    'keyUsage = critical, keyCertSign, cRLSign',
    'subjectKeyIdentifier = hash',
    `nameConstraints = critical, ${permitted.join(', ')}`,
    '',
  ].join('\n');
}

/** A server certificate's extensions: these names, `serverAuth`, never a CA. */
export function leafExtensions(names: CertNames): string {
  const san = [...names.dns.map((d) => `DNS:${d}`), ...names.ip.map((i) => `IP:${i}`)];
  return [
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    `subjectAltName = ${san.join(', ')}`,
    'authorityKeyIdentifier = keyid',
    'subjectKeyIdentifier = hash',
    '',
  ].join('\n');
}

/** A Common Name for the certificate's subject: the first name. Browsers read the alternative names, not this. */
export function commonName(names: CertNames): string {
  return names.dns[0] ?? names.ip[0] ?? 'server';
}

function isIPv4(raw: string): boolean {
  const parts = raw.split('.');
  return parts.length === 4 && parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}
