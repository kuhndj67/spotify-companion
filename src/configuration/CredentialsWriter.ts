/**
 * Spotify credentials and the MusicBrainz contact, written from Settings (LC-44; BR-56, BR-57). 🔌 IMPURE
 *
 * ## The Spotify save is a fixed sequence (P-49, P-50) — do not "optimise" it
 *
 *   validate → pause the poll (and wait for one in flight) → close the MCP client and WAIT FOR THE CHILD TO EXIT →
 *   write the file in place → make the app forget its own cached credentials → resume → READ BACK and compare
 *
 * The MCP server's refresh is *read → network round trip → write the whole object*. A file written while it is
 * inside that await is overwritten with the OLD credentials plus a fresh token — silently, and working. Probe
 * P-U7-2 measured the child exiting ~2 s AFTER `close()` returns, so waiting for the exit is load-bearing.
 * Write-then-close looks equivalent and leaves the window open.
 *
 * ## What it writes (BR-56.4, confirmed by probe P-U7-1)
 *
 * `{ clientId, clientSecret, redirectUri, refreshToken, accessToken: "placeholder", expiresAt: 0, replacedAt }`.
 * A file with NO `accessToken` makes the server fall back to client-credentials, which cannot read playback (F2);
 * a placeholder with a past expiry makes it refresh on its first call — P-U7-1 showed exactly that.
 *
 * ## Q5 = B: no probe, no previous copy, no undo
 *
 * New credentials replace the old outright; the UI says so first (BR-56.6). If they are wrong, FR-71 shows the
 * Spotify indicator RED — that, not a check here, is how the user finds out.
 *
 * ## ⚠️ Secrets flow one way (P-53)
 *
 * Values go in and are written; nothing returned, logged or recorded for Diagnostics can hold one. Refusals name
 * FIELDS, never values. PBT-61 holds this for generated secrets on every path.
 *
 * Both files are SINGLE-FILE bind mounts, so they are written IN PLACE (same inode) — a temp-then-rename would
 * detach the container's view. That is the pattern the MCP server itself already uses through this very mount.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { validateMusicBrainzContact } from '../config.js';
import { CREDENTIALS_CAP_BYTES } from '../ingest/types.js';
import { maskClientId, maskContact } from './masking.js';

export interface SpotifyCredentialsInput {
  readonly clientId: unknown;
  readonly clientSecret: unknown;
  readonly redirectUri: unknown;
  readonly refreshToken: unknown;
}

/** ⚠️ The ONLY credential shape that leaves the server. No field can carry a secret. */
export interface SpotifyCredentialsView {
  readonly set: boolean;
  readonly clientIdMasked: string | null;
  readonly redirectUri: string | null;
  readonly secretSet: boolean;
  readonly refreshTokenSet: boolean;
  /** When the app last replaced them; `null` for a file written by `npm run auth` (source `file`). */
  readonly replacedAt: string | null;
  readonly source: 'app' | 'file' | 'none';
}

export interface MusicBrainzContactView {
  readonly set: boolean;
  readonly masked: string | null;
}

export type CredentialsRefusalReason =
  | 'invalid'
  | 'too-large'
  | 'mcp-did-not-stop'
  | 'write-failed'
  | 'read-back-mismatch';

export interface CredentialsRefusal {
  readonly ok: false;
  readonly reason: CredentialsRefusalReason;
  readonly message: string;
  /** FIELD NAMES only — never values. */
  readonly fields: readonly string[];
}

export interface LastCredentialsWrite {
  readonly at: string;
  readonly which: 'spotify' | 'musicbrainz';
  readonly outcome: 'saved' | CredentialsRefusalReason;
}

export interface CredentialsWriterDeps {
  readonly spotifyConfigPath: string;
  readonly musicbrainzPath: string;
  /** The poll loop — paused across the write so nothing is inside an MCP call (P-49). */
  readonly poller: { pause(): Promise<void>; resume(): void };
  /** Must resolve only once the child has EXITED, and reject if it does not (P-U7-2). */
  readonly mcp: { close(): Promise<void> };
  /** The app's own Web API client — its cached credentials must be dropped (it caches the whole file). */
  readonly webApi: { forgetCredentials(): void };
  /** BR-57.4: the MusicBrainz client reads its identity through this. */
  readonly onContactChanged: (contact: string) => void;
  readonly now: () => number;
}

const FIELDS = ['clientId', 'clientSecret', 'redirectUri', 'refreshToken'] as const;
const MAX_FIELD_CHARS = 512;
/** P-U7-1 used exactly this; the server refreshes because `expiresAt` is in the past, not because of the word. */
const PLACEHOLDER_TOKEN = 'placeholder';

export class CredentialsWriter {
  readonly #deps: CredentialsWriterDeps;
  #lock: Promise<unknown> = Promise.resolve();
  #last: LastCredentialsWrite | null = null;

  constructor(deps: CredentialsWriterDeps) {
    this.#deps = deps;
  }

  lastWrite(): LastCredentialsWrite | null {
    return this.#last;
  }

  spotifyView(): SpotifyCredentialsView {
    const file = readJson(this.#deps.spotifyConfigPath);
    const str = (k: string) => (file !== null && typeof file[k] === 'string' && file[k] !== '' ? (file[k] as string) : null);
    const clientId = str('clientId');
    const set = FIELDS.every((k) => str(k) !== null);
    const replacedAt = str('replacedAt');
    return {
      set,
      clientIdMasked: clientId === null ? null : maskClientId(clientId),
      redirectUri: str('redirectUri'),
      secretSet: str('clientSecret') !== null,
      refreshTokenSet: str('refreshToken') !== null,
      replacedAt,
      source: file === null ? 'none' : replacedAt !== null ? 'app' : 'file',
    };
  }

  musicbrainzView(): MusicBrainzContactView {
    const file = readJson(this.#deps.musicbrainzPath);
    const checked = validateMusicBrainzContact(file?.['contact']);
    return checked.ok ? { set: true, masked: maskContact(checked.contact) } : { set: false, masked: null };
  }

  /** BR-56 — the Spotify save. Every outcome is returned, never thrown. */
  saveSpotify(input: SpotifyCredentialsInput, bodyBytes = 0): Promise<SpotifyCredentialsView | CredentialsRefusal> {
    if (bodyBytes > CREDENTIALS_CAP_BYTES) return Promise.resolve(this.#refuse('spotify', 'too-large', []));
    const invalid = invalidFields(input);
    if (invalid.length > 0) return Promise.resolve(this.#refuse('spotify', 'invalid', invalid));
    const values = Object.fromEntries(FIELDS.map((k) => [k, (input[k] as string).trim()])) as Record<(typeof FIELDS)[number], string>;

    return this.#withLock(async () => {
      await this.#deps.poller.pause();
      try {
        try {
          await this.#deps.mcp.close();
        } catch {
          // The old server may still be running and could overwrite the file — so nothing is written.
          return this.#refuse('spotify', 'mcp-did-not-stop', []);
        }

        const content = {
          ...values,
          accessToken: PLACEHOLDER_TOKEN,
          expiresAt: 0,
          replacedAt: new Date(this.#deps.now()).toISOString(),
        };
        try {
          // IN PLACE (same inode): a single-file bind mount.
          writeFileSync(this.#deps.spotifyConfigPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
        } catch {
          return this.#refuse('spotify', 'write-failed', []);
        }
        this.#deps.webApi.forgetCredentials();

        // P-50: read back and compare — the only thing that can notice a writer this design did not anticipate.
        const back = readJson(this.#deps.spotifyConfigPath);
        const mismatched = FIELDS.filter((k) => back?.[k] !== values[k]);
        if (mismatched.length > 0) return this.#refuse('spotify', 'read-back-mismatch', mismatched);

        this.#last = { at: new Date(this.#deps.now()).toISOString(), which: 'spotify', outcome: 'saved' };
        return this.spotifyView();
      } finally {
        this.#deps.poller.resume();
      }
    });
  }

  /** BR-57 — the MusicBrainz contact. Only `contact` changes; every other field is preserved. */
  saveMusicBrainzContact(raw: unknown, bodyBytes = 0): Promise<MusicBrainzContactView | CredentialsRefusal> {
    if (bodyBytes > CREDENTIALS_CAP_BYTES) return Promise.resolve(this.#refuse('musicbrainz', 'too-large', []));
    const checked = validateMusicBrainzContact(raw);
    if (!checked.ok) return Promise.resolve(this.#refuse('musicbrainz', 'invalid', ['contact'], checked.message));

    return this.#withLock(async () => {
      // U8 (BR-66.2): a legacy `appVersion` is DROPPED on rewrite -- the version comes from package.json, and a
      // per-install copy is a version no release can reach. Every other field is preserved.
      const { appVersion: _legacyVersion, ...existing } = readJson(this.#deps.musicbrainzPath) ?? { appName: 'SpotifyNowPlaying' };
      try {
        writeFileSync(this.#deps.musicbrainzPath, `${JSON.stringify({ ...existing, contact: checked.contact }, null, 2)}\n`, 'utf8');
      } catch {
        return this.#refuse('musicbrainz', 'write-failed', []);
      }
      if (readJson(this.#deps.musicbrainzPath)?.['contact'] !== checked.contact) {
        return this.#refuse('musicbrainz', 'read-back-mismatch', ['contact']);
      }
      this.#deps.onContactChanged(checked.contact);
      this.#last = { at: new Date(this.#deps.now()).toISOString(), which: 'musicbrainz', outcome: 'saved' };
      return this.musicbrainzView();
    });
  }

  #refuse(which: LastCredentialsWrite['which'], reason: CredentialsRefusalReason, fields: readonly string[], detail?: string): CredentialsRefusal {
    this.#last = { at: new Date(this.#deps.now()).toISOString(), which, outcome: reason };
    return { ok: false, reason, message: detail ?? MESSAGES[reason](fields), fields };
  }

  #withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn, fn);
    this.#lock = run.catch(() => undefined);
    return run;
  }
}

/** Built from FIELD NAMES only (P-53). */
const MESSAGES: Record<CredentialsRefusalReason, (fields: readonly string[]) => string> = {
  invalid: (f) => `Check ${f.join(', ')}: every field is required, without spaces, and the redirect URI must be a full http(s) address. Nothing was changed.`,
  'too-large': () => 'That is too large to be a credentials file. Nothing was changed.',
  'mcp-did-not-stop': () => 'The Spotify connection did not stop in time, so nothing was written. Your current credentials are unchanged — try again.',
  'write-failed': () => 'The credentials file could not be written. Check the Diagnostics Configuration block for whether it is writable.',
  'read-back-mismatch': (f) => `The file did not read back as saved (${f.join(', ')}). Another program may be writing it.`,
};

function invalidFields(input: SpotifyCredentialsInput): string[] {
  return FIELDS.filter((k) => {
    const v = input[k];
    if (typeof v !== 'string') return true;
    const t = v.trim();
    if (t === '' || t.length > MAX_FIELD_CHARS || /\s/.test(t)) return true;
    if (k === 'redirectUri') {
      try {
        const u = new URL(t);
        return u.protocol !== 'http:' && u.protocol !== 'https:';
      } catch {
        return true;
      }
    }
    return false;
  });
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
