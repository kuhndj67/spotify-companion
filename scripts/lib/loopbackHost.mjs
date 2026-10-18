/**
 * Is this `Host` header a loopback name? For the Spotify sign-in listener (U9, P-73, BR-74.3).
 *
 * In the image, `auth.mjs` must bind all interfaces INSIDE the container, and only the documented
 * `-p 127.0.0.1:8888:8888` keeps it off the network. A user who drops that prefix would expose it, so the listener
 * also refuses any request whose `Host` is not loopback -- `decideAccess`'s principle.
 *
 * ⚠️ A COPY of `isLoopbackHostHeader` in `src/localGuard.ts`, deliberately: `npm run auth` runs on plain Node with no
 * dependencies (an install runs it before `npm ci`), so it cannot import TypeScript. A copied policy is how this
 * project once shipped a WebSocket `403`, so `test/loopbackHost.property.test.ts` asserts the two AGREE on every
 * input. Change one, and that test fails until the other matches.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isLoopbackHostHeader(value) {
  if (!value) return false;

  let hostname;
  let remainder;
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return false;
    hostname = value.slice(0, close + 1);
    remainder = value.slice(close + 1);
  } else {
    const colon = value.indexOf(':');
    hostname = colon === -1 ? value : value.slice(0, colon);
    remainder = colon === -1 ? '' : value.slice(colon);
  }

  // Only an optional ":port" may follow the hostname (an attacker controls this header).
  if (remainder !== '' && !/^:\d{1,5}$/.test(remainder)) return false;

  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());
}
