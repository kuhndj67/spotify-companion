/**
 * U11 (LC-85, BR-95.2, BR-94.2): the session key, one file in the app's secrets folder. 🔌 IMPURE
 *
 * - **Created** at the first start in server mode if absent: 32 random bytes, written by **exclusive create**
 *   (`wx`, mode `600`), so two starts racing can never both write and end up holding different keys.
 * - **Replaced** only by *Sign out everywhere*: written through `writeFileAtomic` (temp, then rename), which works
 *   because `secrets/app/` is a DIRECTORY mount since U9. Every session signed with the old key then fails.
 * - Deleting the file has the same effect as *Sign out everywhere* (a new key at the next start).
 *
 * ⚠️ The key never leaves this module except as bytes handed to `session.ts`. It is never logged, never in a
 * response, never in a backup (BR-95.1): the backup carries the database only.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../configuration/atomicWrite.js';
import { MIN_SESSION_KEY_BYTES } from './session.js';

export type KeyOutcome = { readonly ok: true; readonly key: Buffer; readonly created: boolean } | { readonly ok: false; readonly reason: string };

/** Stored as hex text with a newline, so a person who opens the file sees a key, not binary noise. */
const KEY_TEXT = /^[0-9a-f]{64,}$/;

export class SessionKeyStore {
  constructor(private readonly path: string) {}

  /** Read the key, creating it first if there is none. A file that exists but is not a key is refused, not replaced. */
  loadOrCreate(): KeyOutcome {
    const created = this.createIfAbsent();
    if (!created.ok) return created;
    const read = this.read();
    return read.ok ? { ok: true, key: read.key, created: created.created } : read;
  }

  /** BR-94.2: a new key. Afterwards nothing signed with the old one verifies. */
  replace(): KeyOutcome {
    // Absent (deleted by hand): create it, so it gets mode 600; a rename would give a new file the default mode.
    const created = this.createIfAbsent();
    if (!created.ok) return created;
    if (created.created) return this.loadOrCreate();
    const key = randomBytes(MIN_SESSION_KEY_BYTES);
    const written = writeFileAtomic(this.path, `${key.toString('hex')}\n`);
    return written.ok ? { ok: true, key, created: false } : { ok: false, reason: `could not replace the session key: ${written.reason}` };
  }

  private createIfAbsent(): { readonly ok: true; readonly created: boolean } | { readonly ok: false; readonly reason: string } {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, `${randomBytes(MIN_SESSION_KEY_BYTES).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
      return { ok: true, created: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { ok: true, created: false };
      return { ok: false, reason: `could not create the session key: ${errorCode(error)}` };
    }
  }

  private read(): { readonly ok: true; readonly key: Buffer } | { readonly ok: false; readonly reason: string } {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8').trim();
    } catch (error) {
      return { ok: false, reason: `could not read the session key: ${errorCode(error)}` };
    }
    // Never quote the content: it is the key, or something meant to be.
    if (!KEY_TEXT.test(text) || text.length % 2 !== 0) return { ok: false, reason: 'the session key file is not a key (expected at least 64 hex characters); delete it to have a new one made' };
    return { ok: true, key: Buffer.from(text, 'hex') };
  }
}

/** `ENOENT`, `EACCES`, …: the kind of failure, never a message that might quote a path's content. */
function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? (error as Error).name ?? 'unknown error';
}
