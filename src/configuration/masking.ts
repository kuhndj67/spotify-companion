/**
 * How configuration values are shown back (LC-41, BR-56.7, BR-57.1). ⚙️ PURE
 *
 * ⚠️ **These functions never receive a secret.** The client secret and the refresh token are not masked — they
 * are never shown at all, only *set / not set* (P-53). What is masked here is identifying, not secret: the
 * client id and the MusicBrainz contact.
 *
 * Reveal budget (PBT-62): a client id shows at most **8** of its characters; an email shows at most **2** of its
 * local part (the domain is shown — it says which mailbox, not whose); any other contact at most 8.
 */

/** Below this length, revealing 4+4 would expose most of the value, so it is shown only as set. */
const MIN_REVEAL_LENGTH = 16;

export function maskClientId(clientId: string): string {
  if (clientId.length < MIN_REVEAL_LENGTH) return 'set';
  return `${clientId.slice(0, 4)}…${clientId.slice(-4)}`;
}

export function maskContact(contact: string): string {
  const email = /^([^@\s]+)@([^@\s]+)$/.exec(contact);
  if (email !== null) {
    const [, local = '', domain = ''] = email;
    const shown = local.length > 2 ? `${local[0]}…${local[local.length - 1]}` : '…';
    return `${shown}@${domain}`;
  }
  if (contact.length <= MIN_REVEAL_LENGTH) return 'set';
  return `${contact.slice(0, 8)}…`;
}
