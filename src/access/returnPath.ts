/**
 * U11 (LC-87, BR-89.5): where a completed sign-in returns to. The open-redirect defence.
 *
 * ⚙️ PURE. Accepted only if it starts with a single `/` (not `//`, not `/\`), carries no scheme, no control
 * character and no backslash, and is at most 512 characters. Anything else becomes `/`. PBT-95: whatever comes in,
 * the result resolved against the public origin has the public origin.
 *
 * Also `/`: a return into `/auth/` itself. Sending a completed sign-in back to `/auth/sign-in` would start another,
 * which is the loop P-95 tests for.
 */

const MAX_RETURN_PATH = 512;

export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RETURN_PATH) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  // A backslash is read as `/` by browsers (`/\evil.com` is `//evil.com`); control characters can be dropped by
  // them, turning `/\t/evil.com` into `//evil.com`. Neither has a use in a path this app serves.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return '/';
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return '/';
  if (raw === '/auth' || raw.startsWith('/auth/') || raw.startsWith('/auth?')) return '/';
  return raw;
}
