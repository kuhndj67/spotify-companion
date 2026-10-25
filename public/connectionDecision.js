/**
 * U11 (LC-94, BR-93.3; PBT-97): what the page does when its live connection closes. ⚙️ PURE, and plain JavaScript
 * so the page imports it as it is and the property test imports the same file.
 *
 *   4401, the server's *signed out* close (BR-93.2)  → 'signedOut': stop reconnecting, show *Signed out*
 *   any other close, then the session check answers 401 → 'signedOut' (a browser cannot see the 401 a refused
 *                                                       WebSocket handshake gets; it reports 1006, so the page asks)
 *   anything else                                    → 'reconnect', as before U11
 *
 * In local mode the session check is a 404 (no sign-in route exists), so the page always reconnects there.
 *
 * @param {number} code the close event's code
 * @param {number | null} sessionStatus the session check's HTTP status, or null when it was not asked or failed
 * @returns {'signedOut' | 'reconnect'}
 */
export function onClose(code, sessionStatus) {
  if (code === 4401) return 'signedOut';
  if (sessionStatus === 401) return 'signedOut';
  return 'reconnect';
}

/** Whether a close needs the session check before deciding: every close but the server's own 4401. */
export function needsSessionCheck(code) {
  return code !== 4401;
}
