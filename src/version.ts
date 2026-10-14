/**
 * The app's version — the ONE reader of `package.json`'s `version` (U8, LC-49, P-59, BR-66.1).
 *
 * Everything inside the app that names a version takes it from here: the backup manifest, the MusicBrainz
 * User-Agent, the MCP client's name, Settings and `/api/diagnostics`. The compose image tags are literals that
 * `test/versionSources.test.ts` checks equal to it (P-58), because Compose cannot read `package.json`.
 *
 * ⚠️ Anything unreadable or invalid is `'unknown'` — never a throw and **never `'0.1.0'`**. That fallback was a
 * per-install copy of a version no release could reach (BR-66.2), and it reads as a real answer.
 *
 * Not to be confused with the **database schema version** (BR-66.6): that answers *can this database be opened*,
 * this answers *which code is this*. Neither is derived from the other.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UNKNOWN_VERSION = 'unknown';

/** semver.org's recommended pattern (2.0.0), anchored. Build metadata is accepted, as SemVer allows. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isSemVer(value: unknown): value is string {
  return typeof value === 'string' && SEMVER.test(value);
}

/** Pure: the `version` of a `package.json` text, or `'unknown'`. */
export function parseAppVersion(packageJsonText: string): string {
  try {
    const parsed: unknown = JSON.parse(packageJsonText);
    const version = parsed !== null && typeof parsed === 'object' ? (parsed as { version?: unknown }).version : undefined;
    return isSemVer(version) ? version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

/** `src/version.ts` and `dist/version.js` both sit one level below the project root, as in the container. */
const DEFAULT_PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

export function readAppVersion(packageJsonPath: string = DEFAULT_PACKAGE_JSON): string {
  let text: string;
  try {
    text = readFileSync(packageJsonPath, 'utf8');
  } catch {
    return UNKNOWN_VERSION;
  }
  return parseAppVersion(text);
}
