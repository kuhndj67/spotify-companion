/**
 * U11 (LC-91, BR-96.2, BR-97): Diagnostics' *Access* and *WAL* rows. ⚙️ PURE: the facts and `now` are handed in.
 *
 * *Access*: in local mode *Local only*, ok. In server mode the facts (public address, issuer and whether discovery
 * and its keys were fetched, allowed account, session lifetime, certificate names and expiry, settings ignored).
 * **Fails** if the provider could not be discovered or the certificate has expired; **warns** inside 30 days of
 * expiry or if the certificate does not cover the public host. *Not serving*: fails, naming every problem.
 *
 * *WAL*: ok on `wal`; fails naming the mode SQLite chose and the database path; skipped without a database.
 */

export interface RowVerdict {
  readonly status: 'ok' | 'warn' | 'fail' | 'skip';
  readonly detail: string;
}

export type AccessDiagnosticsInput =
  | { readonly mode: 'local' }
  | { readonly mode: 'not-serving'; readonly problems: readonly { readonly setting: string; readonly message: string }[] }
  | {
      readonly mode: 'server';
      readonly publicOrigin: string;
      readonly issuer: string;
      readonly allowedSubject: string;
      readonly sessionLifetimeMs: number;
      readonly providerPortal: string | null;
      readonly certificate: { readonly subject: string; readonly subjectAltName: string; readonly validTo: string };
      readonly coversPublicHost: boolean;
      readonly provider: {
        readonly discoveredAt: number | null;
        readonly lastFailure: { readonly reason: string; readonly detail: string; readonly at: number } | null;
      };
      readonly ignoredSettings: readonly string[];
    };

const DAY_MS = 86_400_000;
export const CERTIFICATE_WARN_DAYS = 30;

export function accessRow(input: AccessDiagnosticsInput, now: number): RowVerdict {
  if (input.mode === 'local') return { status: 'ok', detail: 'Local only: this machine, no sign-in' };
  if (input.mode === 'not-serving') {
    return {
      status: 'fail',
      detail: `Server mode, NOT serving (no port open; recording continues): ${input.problems.map((p) => `${p.setting} ${p.message}`).join('; ')}`,
    };
  }

  const expires = Date.parse(input.certificate.validTo);
  const daysLeft = Math.floor((expires - now) / DAY_MS);
  const facts = [
    `Server mode at ${input.publicOrigin}`,
    `sign-in through ${input.issuer}`,
    input.provider.discoveredAt !== null
      ? `provider discovered ${new Date(input.provider.discoveredAt).toISOString()}`
      : 'provider not yet discovered',
    `allowed account ${JSON.stringify(input.allowedSubject)}`,
    `sessions last ${formatLifetime(input.sessionLifetimeMs)}`,
    ...(input.providerPortal !== null ? [`sign in first at ${input.providerPortal}`] : []),
    `certificate ${input.certificate.subjectAltName || input.certificate.subject}, expires ${Number.isNaN(expires) ? input.certificate.validTo : new Date(expires).toISOString().slice(0, 10)}`,
    ...(input.ignoredSettings.length > 0 ? [`ignored in server mode: ${input.ignoredSettings.join(', ')}`] : []),
  ];

  const failures: string[] = [];
  const warnings: string[] = [];
  if (input.provider.lastFailure !== null && input.provider.discoveredAt === null) {
    failures.push(`the provider cannot be used: ${input.provider.lastFailure.reason} (${input.provider.lastFailure.detail})`);
  }
  if (Number.isNaN(expires) || expires <= now) failures.push('the certificate has expired: renew it (install guide, Renewal)');
  else if (daysLeft < CERTIFICATE_WARN_DAYS) warnings.push(`the certificate expires in ${daysLeft} day(s): renew it soon`);
  if (!input.coversPublicHost) warnings.push("the certificate does not cover the public address's host");

  const status = failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'ok';
  return { status, detail: [...failures, ...warnings, ...facts].join(' · ') };
}

export function walRow(input: { readonly journalMode: string | null; readonly refusal: string | null; readonly dbPath: string }): RowVerdict {
  if (input.refusal !== null) return { status: 'fail', detail: input.refusal };
  if (input.journalMode === null) return { status: 'skip', detail: 'Skipped — no database open' };
  if (input.journalMode === 'wal') return { status: 'ok', detail: `journal mode wal · ${input.dbPath}` };
  return { status: 'fail', detail: `journal mode ${JSON.stringify(input.journalMode)}, not wal · ${input.dbPath}` };
}

function formatLifetime(ms: number): string {
  const hours = ms / 3_600_000;
  return hours % 24 === 0 ? `${hours / 24} day(s)` : `${hours} hour(s)`;
}
