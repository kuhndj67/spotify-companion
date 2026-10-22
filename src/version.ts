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

/**
 * U10 (LC-78): one comparison for the release script, the image's `update` and the update check. Moved here from
 * `scripts/lib/releaseDecision.ts`, unchanged.
 *
 * SemVer 2.0.0 precedence (§11). Both arguments must be valid SemVer; build metadata is ignored. */
export function compareSemVer(a: string, b: string): number {
  const [aMain = '', aPre] = splitPre(a);
  const [bMain = '', bPre] = splitPre(b);
  const am = aMain.split('.').map(Number);
  const bm = bMain.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (am[i] ?? 0) - (bm[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (aPre === undefined && bPre === undefined) return 0;
  if (aPre === undefined) return 1; // a release outranks its pre-releases
  if (bPre === undefined) return -1;
  const ai = aPre.split('.');
  const bi = bPre.split('.');
  for (let i = 0; i < Math.max(ai.length, bi.length); i += 1) {
    const x = ai[i];
    const y = bi[i];
    if (x === undefined) return -1; // fewer identifiers = lower, when all before are equal
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return Math.sign(d);
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric identifiers rank below alphanumeric ones
    } else if (x !== y) {
      return x < y ? -1 : 1; // ASCII order
    }
  }
  return 0;
}

function splitPre(v: string): [string, string | undefined] {
  const noBuild = v.split('+')[0] ?? '';
  const dash = noBuild.indexOf('-');
  return dash < 0 ? [noBuild, undefined] : [noBuild.slice(0, dash), noBuild.slice(dash + 1)];
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
