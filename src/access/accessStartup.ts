/**
 * U11 (LC-82, LC-85, LC-90; BR-88.4, BR-95, BR-96.1; P-89, P-96): which listener the app opens, if any. 🔌 IMPURE
 * (it reads the server-mode files), but **never throws**: every failure is a problem in the result.
 *
 *   local mode             → `{ mode: 'local' }`: today's HTTP listener and `localGuard`
 *   server mode, complete  → `{ mode: 'server', … }`: one HTTPS listener, `serverGuard`, the sign-in routes
 *   anything else          → `{ mode: 'not-serving', problems }`: NO listener at all (never a fallback to local
 *                            mode, never serving without the sign-in), every problem logged once and summarised
 *                            hourly
 *
 * ⚠️ **Recording is not this module's business** (BR-91.6). `server.ts` starts polling and recording whatever this
 * returns; a structural test pins that. Nothing on the poll and record path imports this folder.
 *
 * ⚠️ The client secret, the certificate key and the session key are read here and handed on as values; none is ever
 * put in a problem's text (BR-95.1).
 */

import { X509Certificate, createPrivateKey, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  parseMode,
  validateServerConfig,
  type ConfigProblem,
  type FileFact,
  type ServerConfig,
} from './accessConfig.js';
import { SessionKeyStore } from './SessionKeyStore.js';

export interface AccessInputs {
  readonly modeRaw: string | undefined;
  readonly publicOriginRaw: string | undefined;
  readonly issuerRaw: string | undefined;
  readonly clientIdRaw: string | undefined;
  readonly allowedSubjectRaw: string | undefined;
  readonly sessionLifetimeRaw: string | undefined;
  readonly providerPortalRaw?: string | undefined;
  readonly clientSecretPath: string;
  readonly certPath: string;
  readonly keyPath: string;
  readonly sessionKeyPath: string;
  /** BR-88.5: set, but without effect in server mode. Reported, never applied. */
  readonly localOnlyRaw: string | undefined;
  readonly trustPublishedPortRaw: string | undefined;
}

export interface ServerAccess {
  readonly mode: 'server';
  readonly config: ServerConfig;
  readonly clientSecret: string;
  readonly tls: { readonly cert: string; readonly key: string };
  readonly certificate: { readonly subject: string; readonly subjectAltName: string; readonly validTo: string };
  readonly sessionKeys: SessionKeyStore;
  /** The key as read at startup; *Sign out everywhere* replaces it through `sessionKeys`. */
  readonly sessionKey: Buffer;
  /** BR-88.5: settings present that server mode ignores, by name. */
  readonly ignoredSettings: readonly string[];
}

export type AccessStartup =
  | { readonly mode: 'local' }
  | ServerAccess
  | { readonly mode: 'not-serving'; readonly problems: readonly ConfigProblem[] };

export function configureAccess(inputs: AccessInputs): AccessStartup {
  try {
    return configure(inputs);
  } catch (error) {
    // Never reached by any known path; if it is, refuse to serve rather than let startup die (and recording with it).
    return { mode: 'not-serving', problems: [{ setting: 'startup', message: `unexpected ${(error as Error)?.name ?? 'error'} while reading the access configuration` }] };
  }
}

function configure(inputs: AccessInputs): AccessStartup {
  const mode = parseMode(inputs.modeRaw);
  if (!mode.ok) return { mode: 'not-serving', problems: [mode.problem] };
  if (mode.mode === 'local') return { mode: 'local' };

  const secret = readText(inputs.clientSecretPath);
  const cert = readText(inputs.certPath);
  const key = readText(inputs.keyPath);

  // Judge the certificate and key only when both were read; a missing one is already its own problem.
  let certFact: FileFact = cert.fact;
  let keyFact: FileFact = key.fact;
  let certificate: ServerAccess['certificate'] | null = null;
  if (cert.fact.state === 'ok') {
    try {
      const x509 = new X509Certificate(cert.text);
      certificate = { subject: x509.subject, subjectAltName: x509.subjectAltName ?? '', validTo: x509.validTo };
      if (key.fact.state === 'ok') {
        try {
          if (!x509.checkPrivateKey(createPrivateKey(key.text))) keyFact = { state: 'invalid', reason: 'does not match the certificate' };
        } catch {
          keyFact = { state: 'invalid', reason: 'is not a private key in PEM format' };
        }
      }
    } catch {
      certFact = { state: 'invalid', reason: 'is not a certificate in PEM format' };
    }
  }

  const validated = validateServerConfig({
    publicOrigin: inputs.publicOriginRaw,
    issuer: inputs.issuerRaw,
    clientId: inputs.clientIdRaw,
    allowedSubject: inputs.allowedSubjectRaw,
    sessionLifetime: inputs.sessionLifetimeRaw,
    providerPortal: inputs.providerPortalRaw,
    clientSecretFile: secret.fact,
    certificateFile: certFact,
    keyFile: keyFact,
  });
  if (!validated.ok) return { mode: 'not-serving', problems: validated.problems };

  // The session key last: it is the one thing this module may WRITE, and only once everything else is in order.
  const sessionKeys = new SessionKeyStore(inputs.sessionKeyPath);
  const loaded = sessionKeys.loadOrCreate();
  if (!loaded.ok) return { mode: 'not-serving', problems: [{ setting: 'secrets/app/session.key', message: loaded.reason }] };

  const ignoredSettings = [
    inputs.localOnlyRaw !== undefined ? 'LOCAL_ONLY' : null,
    inputs.trustPublishedPortRaw !== undefined ? 'TRUST_PUBLISHED_PORT' : null,
  ].filter((s): s is string => s !== null);

  return {
    mode: 'server',
    config: validated.config,
    clientSecret: secret.text,
    tls: { cert: cert.text, key: key.text },
    certificate: certificate!,
    sessionKeys,
    sessionKey: loaded.key,
    ignoredSettings,
  };
}

/** The lines `server.ts` logs at startup and then once an hour while it is not serving (BR-88.4). */
export function notServingLines(problems: readonly ConfigProblem[]): string[] {
  return [
    `[access] NOT SERVING: server mode is configured incompletely (${problems.length} problem${problems.length === 1 ? '' : 's'}). ` +
      'No port is open; recording continues.',
    ...problems.map((p) => `[access]   ${p.setting} ${p.message}`),
  ];
}

export function notServingSummary(problems: readonly ConfigProblem[]): string {
  return `[access] still not serving: ${problems.map((p) => p.setting).join(', ')}. Recording continues.`;
}

/** A session id (BR-91.1): 16 random bytes. */
export function newSessionId(): string {
  return randomBytes(16).toString('base64url');
}

function readText(path: string): { readonly fact: FileFact; readonly text: string } {
  try {
    const text = readFileSync(path, 'utf8').trim();
    return text === '' ? { fact: { state: 'empty' }, text } : { fact: { state: 'ok' }, text };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { fact: code === 'ENOENT' || code === 'ENOTDIR' ? { state: 'missing' } : { state: 'unreadable' }, text: '' };
  }
}
