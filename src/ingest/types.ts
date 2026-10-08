/**
 * The vocabulary of FR-64's admission path — the ONE way any file from outside enters the app.
 *
 * U6 uses it for the restore archive; U7 will use it for `rules.json` and credentials. It is written once
 * here and imported, never re-implemented per route: this project has already shipped a policy that was
 * copied and then diverged (the 2026-09-05 WebSocket `403`).
 *
 * ⚠️ PURE. Constants and types only — no clock, no filesystem, no environment. The caps are deliberately
 * NOT environment variables: a cap that can be raised by config is a cap whose first fix is to raise it.
 */

/** The custom header a cross-site page cannot set without a CORS preflight the app never grants (BR-46.3). */
export const INGEST_HEADER = 'x-spotify-companion-ingest';
export const INGEST_HEADER_VALUE = '1';

/**
 * Size caps (Q6 = A, P-46): about 40x the archive as measured on 2026-10-07 (1.6 MB compressed, 5 MB
 * expanded). Diagnostics reports current size against these, so growth is visible long before they bind.
 */
export const UPLOAD_CAP_BYTES = 64 * 1024 * 1024;
export const EXPANDED_CAP_BYTES = 256 * 1024 * 1024;

/**
 * U7's body caps (BR-46.4, BR-60.2), kept beside U6's so every limit on outside input is in one file. A rules
 * file is hand-written text — dozens of rules — so 256 KB is generous; credentials are four short strings.
 */
export const RULES_UPLOAD_CAP_BYTES = 256 * 1024;
export const CREDENTIALS_CAP_BYTES = 16 * 1024;

/**
 * The archive allowlist (BR-45.2, P-45). Keys are the ONLY entry names accepted; values are the fixed
 * names written to disk. ⚠️ The value is never derived from the entry name — P-39's guarantee is that no
 * name from an archive is ever used as a path, and keeping the output name a constant here is what makes
 * that structural rather than a matter of remembering.
 *
 * ⚠️ An allowlist, never "everything except secrets/ and state/". A denylist includes a later-added state
 * file by default and silently; an allowlist misses it visibly.
 */
export const ARCHIVE_ENTRIES = {
  'manifest.json': 'manifest.json',
  'history.db': 'history.db',
  'rules.json': 'rules.json',
} as const;

export type ArchiveEntryName = keyof typeof ARCHIVE_ENTRIES;

/** Entries a backup archive must contain; `rules.json` is optional (BR-45.2). */
export const REQUIRED_ENTRIES: readonly ArchiveEntryName[] = ['manifest.json', 'history.db'];

/**
 * Every refusal names the business rule it enforces, so the UI and the log can say WHY (BR-46.14) and a
 * reader can find the rule. A refusal that does not explain itself gets read as a bug.
 */
export type IngestRule =
  | 'BR-46.1' // method
  | 'BR-46.2' // Origin required and allowed
  | 'BR-46.3' // ingest header
  | 'BR-46.4' // upload size cap
  | 'BR-46.6' // entry not on the allowlist / required entry missing
  | 'BR-46.7' // not a regular file
  | 'BR-46.8' // a path, not a name
  | 'BR-46.9' // duplicate entry
  | 'BR-46.10' // expanded size cap
  | 'BR-46.11'; // content is not what it claims (magic bytes)

export interface IngestRefusal {
  readonly rule: IngestRule;
  readonly detail: string;
}
