/**
 * LC-48 — what Settings' *Spotify* and *MusicBrainz* sections SAY (frontend-components §2, §3; BR-56.6–56.8, BR-57).
 * ⚙️ PURE, derived on the server and attached to `GET /api/settings/credentials`, because app.js cannot be tested.
 *
 * ⚠️ These take only the VIEWS — which have no field able to hold a secret (P-53). Nothing here can leak one.
 */

import type { MusicBrainzContactView, SpotifyCredentialsView } from '../configuration/CredentialsWriter.js';

export interface SpotifySectionView {
  readonly status: string;
  /** BR-56.6 — shown in the confirmation dialog BEFORE saving. */
  readonly saveWarning: readonly string[];
  /** BR-56.8 — collapsed by default. ⚠️ U8's install routine must agree with this text (it names `npm run auth`). */
  readonly guidance: readonly string[];
  /** The text beside each button, one button per row (user, 2026-10-11). `save` depends on whether all four
   *  fields are filled — a fact only the page knows — so both wordings are sent and the page picks. */
  readonly rowNotes: { readonly fill: string; readonly saveReady: string; readonly saveIncomplete: string };
}

export function spotifySectionView(v: SpotifyCredentialsView): SpotifySectionView {
  const when = v.replacedAt === null ? null : `${v.replacedAt.replace('T', ' ').slice(0, 16)} UTC`;
  const status = !v.set
    ? 'Not set — the app cannot read what is playing until these are entered.'
    : `Set · client ${v.clientIdMasked ?? 'set'} · ${when === null ? 'from a file on disk' : `replaced ${when}`}`;
  return {
    status,
    saveWarning: [
      'Your current Spotify credentials will be REPLACED and not kept anywhere — backups never include them.',
      'If the new ones are wrong, the Spotify indicator turns red and recording stops until working ones are entered.',
      'Keep your own copy if you might want the current ones back.',
    ],
    rowNotes: {
      fill: 'Fills the four fields from the file “npm run auth” wrote. Nothing is sent until you save.',
      saveReady: 'Replaces your current credentials — you will see a warning first.',
      saveIncomplete: 'Fill in all four fields to save.',
    },
    guidance: [
      'Each person uses their own Spotify app — create one at developer.spotify.com (Dashboard → Create app).',
      'In the app’s settings, add the redirect URI http://127.0.0.1:8888/callback, and copy the Client ID and Client secret.',
      'Spotify apps start in Development Mode: only the accounts you add under User Management can use it.',
      'The refresh token needs a browser sign-in: on a computer with a browser, run “npm run auth” in this project. It writes secrets/app/spotify-config.json.',
      'Upload that file here with “Fill from spotify-config.json…” — it fills all four fields — then Save.',
    ],
  };
}

export interface MusicBrainzSectionView {
  readonly status: string;
  /** Present when a saved contact will only take effect after a restart (labels were off at startup). */
  readonly note: string | null;
}

export function musicbrainzSectionView(v: MusicBrainzContactView, labelsActive: boolean): MusicBrainzSectionView {
  return {
    status: v.set ? `Contact: ${v.masked}` : 'Not set — label lookups are off until a contact is entered.',
    note: labelsActive
      ? null
      : 'Label lookups did not start with the app (no valid contact then). A contact saved now takes effect after the next restart.',
  };
}
