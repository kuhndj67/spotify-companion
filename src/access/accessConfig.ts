/**
 * U11 (LC-82, BR-88, P-89): which access mode the app runs in, and whether a server configuration is complete.
 *
 * ⚙️ PURE. The shell (`server.ts`) reads the environment and the files, then hands this module only what it found:
 * strings, and for each file a {@link FileFact}. Nothing here reads a file, the clock or the environment, so
 * PBT-91 and PBT-92 can throw any configuration at it.
 *
 * ⚠️ **Fail closed, recording unaffected** (BR-88.4, BR-91.6). A refused configuration means the app opens **no
 * listener**; it never falls back to local mode and never serves without the sign-in. Polling and recording are not
 * this module's concern and never wait on it.
 *
 * ⚠️ Every problem is reported, never only the first (P-89): the person fixing the compose file should see the whole
 * list after one restart, not one item per restart.
 *
 * ⚠️ Nothing a problem says may contain a secret. The client secret, the session key and the certificate key never
 * reach this module at all: only the fact that each file is there.
 */

/** BR-88.1: the one setting. */
export type AccessMode = 'local' | 'server';

/**
 * BR-88.1. Absent (or empty: compose writes `ACCESS_MODE:` with no value as an empty string) → `local`. Exactly
 * `local` or `server` → that mode. Anything else is refused, naming the setting.
 *
 * ⚠️ Deliberately exact: no trimming, no case folding. `Server` or `server ` is a typo, and guessing what a typo
 * meant is how a deployment ends up in a mode nobody chose (BR-88.5).
 */
export function parseMode(
  raw: string | undefined,
): { readonly ok: true; readonly mode: AccessMode } | { readonly ok: false; readonly problem: ConfigProblem } {
  if (raw === undefined || raw === '') return { ok: true, mode: 'local' };
  if (raw === 'local' || raw === 'server') return { ok: true, mode: raw };
  return {
    ok: false,
    problem: { setting: 'ACCESS_MODE', message: `must be "local" or "server" (exactly); got ${quote(raw)}` },
  };
}

/** What the shell found when it looked for one of the server-mode files. Its content never comes here. */
export type FileFact =
  | { readonly state: 'ok' }
  | { readonly state: 'missing' }
  | { readonly state: 'unreadable' }
  | { readonly state: 'empty' }
  /** The shell read it and judged it (a certificate that does not parse, a key that does not match). */
  | { readonly state: 'invalid'; readonly reason: string };

/** BR-88.3: everything server mode needs, as found. */
export interface ServerConfigInput {
  readonly publicOrigin: string | undefined;
  readonly issuer: string | undefined;
  readonly clientId: string | undefined;
  readonly allowedSubject: string | undefined;
  /** Absent → the default (BR-91.3). */
  readonly sessionLifetime: string | undefined;
  readonly clientSecretFile: FileFact;
  readonly certificateFile: FileFact;
  readonly keyFile: FileFact;
}

export interface ConfigProblem {
  /** The setting or file the owner has to change, by the name they see in the compose file or the folder. */
  readonly setting: string;
  readonly message: string;
}

/** A complete, valid server configuration. */
export interface ServerConfig {
  /** `https://host[:port]`, as `URL.origin` normalises it (the default port omitted). */
  readonly publicOrigin: string;
  /** The `Host` header a browser sends to that origin (BR-92.2's comparison). */
  readonly publicHost: string;
  /** Exact, as configured: discovery's `issuer` must equal it character for character (BR-88.6). */
  readonly issuer: string;
  readonly clientId: string;
  readonly allowedSubject: string;
  readonly sessionLifetimeMs: number;
  /** Derived, never configured: one place it can be wrong (IN-U11-6). */
  readonly redirectUri: string;
}

export const DEFAULT_SESSION_LIFETIME = '7d';
const HOUR_MS = 3_600_000;
export const MIN_SESSION_LIFETIME_MS = HOUR_MS;
export const MAX_SESSION_LIFETIME_MS = 90 * 24 * HOUR_MS;

/**
 * BR-91.3: `<whole number>h` or `<whole number>d`, from 1 hour to 90 days. No minutes, no seconds: a lifetime under
 * an hour is not a session anyone wants, and a unit that small is an easy slip (`7m` for `7d`).
 */
export function parseSessionLifetime(raw: string): { readonly ok: true; readonly ms: number } | { readonly ok: false; readonly message: string } {
  const match = /^([1-9]\d{0,4})([hd])$/.exec(raw);
  if (!match) return { ok: false, message: `must be a whole number of hours or days, like "12h" or "7d"; got ${quote(raw)}` };
  const ms = Number(match[1]) * (match[2] === 'd' ? 24 : 1) * HOUR_MS;
  if (ms < MIN_SESSION_LIFETIME_MS || ms > MAX_SESSION_LIFETIME_MS) {
    return { ok: false, message: `must be from 1h to 90d; got ${quote(raw)}` };
  }
  return { ok: true, ms };
}

/**
 * BR-88.3 and 88.4: `ok` with the configuration, or every problem found.
 *
 * ⚠️ `ok` is the ONLY path to an HTTPS listener (P-89). There is no partial result.
 */
export function validateServerConfig(
  input: ServerConfigInput,
): { readonly ok: true; readonly config: ServerConfig } | { readonly ok: false; readonly problems: readonly ConfigProblem[] } {
  const problems: ConfigProblem[] = [];

  const origin = checkPublicOrigin(input.publicOrigin);
  if (!origin.ok) problems.push({ setting: 'PUBLIC_ORIGIN', message: origin.message });

  const issuer = input.issuer;
  if (issuer === undefined || issuer === '') {
    problems.push({ setting: 'OIDC_ISSUER', message: 'is required: the provider\'s issuer, exactly as its discovery document gives it' });
  } else if (!isHttpsUrl(issuer)) {
    problems.push({ setting: 'OIDC_ISSUER', message: `must be an https:// address; got ${quote(issuer)}` });
  }

  const clientId = input.clientId;
  if (clientId === undefined || clientId === '') {
    problems.push({ setting: 'OIDC_CLIENT_ID', message: 'is required: the client ID the provider gave when the app was registered' });
  } else if (/\s|^</.test(clientId)) {
    problems.push({ setting: 'OIDC_CLIENT_ID', message: `contains a space or is still a placeholder; got ${quote(clientId)}` });
  }

  const subject = input.allowedSubject;
  if (subject === undefined || subject === '') {
    problems.push({ setting: 'OIDC_ALLOWED_SUBJECT', message: 'is required: your account\'s subject at the provider' });
  } else if (subject !== subject.trim() || subject.startsWith('<')) {
    // Compared exactly (BR-90.5): a stray space would refuse the owner forever, so refuse it here, where it is visible.
    problems.push({ setting: 'OIDC_ALLOWED_SUBJECT', message: `has a leading or trailing space or is still a placeholder; got ${quote(subject)}` });
  }

  const lifetime = parseSessionLifetime(input.sessionLifetime === undefined || input.sessionLifetime === '' ? DEFAULT_SESSION_LIFETIME : input.sessionLifetime);
  if (!lifetime.ok) problems.push({ setting: 'SESSION_LIFETIME', message: lifetime.message });

  for (const [setting, fact] of [
    ['secrets/app/oidc-client-secret', input.clientSecretFile],
    ['secrets/app/tls/server-cert.pem', input.certificateFile],
    ['secrets/app/tls/server-key.pem', input.keyFile],
  ] as const) {
    const message = fileProblem(fact);
    if (message !== null) problems.push({ setting, message });
  }

  if (problems.length > 0 || !origin.ok || !lifetime.ok) return { ok: false, problems };
  return {
    ok: true,
    config: {
      publicOrigin: origin.origin,
      publicHost: origin.host,
      issuer: issuer as string,
      clientId: clientId as string,
      allowedSubject: subject as string,
      sessionLifetimeMs: lifetime.ms,
      redirectUri: `${origin.origin}/auth/callback`,
    },
  };
}

/**
 * BR-88.3: an `https://` origin (scheme, host, optional port) and nothing else. A trailing `/` is tolerated, because
 * people type it; a path, query, fragment or user name is refused, because the cookie (`__Host-`, path `/`) and every
 * redirect assume the app is at the root.
 */
function checkPublicOrigin(raw: string | undefined):
  | { readonly ok: true; readonly origin: string; readonly host: string }
  | { readonly ok: false; readonly message: string } {
  if (raw === undefined || raw === '') return { ok: false, message: 'is required: the https:// address your devices open, like https://<name>:3443' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: `is not an address; got ${quote(raw)}` };
  }
  if (url.protocol !== 'https:') return { ok: false, message: `must start with https:// (server mode serves HTTPS only); got ${quote(raw)}` };
  if (url.username !== '' || url.password !== '') return { ok: false, message: 'must not contain a user name or password' };
  // Judged on the TEXT as well as the parsed URL: `URL` quietly drops an empty `?` or `#`, and normalises `\` to `/`.
  const afterScheme = raw.slice(raw.indexOf('//') + 2).replace(/\/$/, '');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[/?#\\]/.test(afterScheme)) {
    return { ok: false, message: `must be only scheme, name and port, with no path, query or fragment; got ${quote(raw)}` };
  }
  return { ok: true, origin: url.origin, host: url.host };
}

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

function fileProblem(fact: FileFact): string | null {
  switch (fact.state) {
    case 'ok':
      return null;
    case 'missing':
      return 'is missing';
    case 'unreadable':
      return 'cannot be read by the app';
    case 'empty':
      return 'is empty';
    case 'invalid':
      return fact.reason;
  }
}

/** Shown in a log line, so bounded and with control characters made visible. */
function quote(raw: string): string {
  const shown = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  return JSON.stringify(shown);
}
