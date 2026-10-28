/**
 * U11: what the image's HEALTHCHECK asks for, by access mode. ⚙️ PURE: the environment is handed in.
 *
 * - **Local mode**: `GET http://127.0.0.1:<port>/api/health`, as before U11 (loopback passes `localGuard`).
 * - **Server mode**: `GET https://127.0.0.1:<port>/auth/auth.css` with the PUBLIC `Host`, because admission admits
 *   nothing else without a session (BR-92.2, 92.3). The certificate is NOT checked here: this asks only whether the
 *   process is serving, over loopback, and the certificate is for the public name (Diagnostics checks it, BR-96.2).
 * - **Anything else** (`ACCESS_MODE` unknown, or a public origin that does not parse): `null`, so the check FAILS.
 *   The app then opens no listener (BR-88.4), and "unhealthy" is the truth.
 */

export type HealthTarget =
  | { readonly protocol: 'http'; readonly port: number; readonly path: '/api/health' }
  | { readonly protocol: 'https'; readonly port: number; readonly path: '/auth/auth.css'; readonly host: string; readonly servername: string };

export function healthTarget(env: Readonly<Record<string, string | undefined>>): HealthTarget | null {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const mode = env.ACCESS_MODE;
  if (mode === undefined || mode === '' || mode === 'local') return { protocol: 'http', port, path: '/api/health' };
  if (mode !== 'server') return null;
  try {
    const origin = new URL(env.PUBLIC_ORIGIN ?? '');
    if (origin.protocol !== 'https:') return null;
    return { protocol: 'https', port, path: '/auth/auth.css', host: origin.host, servername: origin.hostname };
  } catch {
    return null;
  }
}
