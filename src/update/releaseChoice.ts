/**
 * LC-78 — which GitHub release, if any, is newer than this app (U10, FR-81, BR-85.5, BR-85.6). ⚙️ PURE.
 *
 * The response is UNTRUSTED: only four fields are read, and a release page URL is shown only if it is this
 * repository's own `/releases/` page.
 */

import { compareSemVer, isSemVer } from '../version.js';

const REPOSITORY = 'kuhndj67/spotify-companion';

export interface ReleaseEntry {
  readonly tag: string;
  readonly prerelease: boolean;
  readonly draft: boolean;
  readonly pageUrl: string | null;
}

/** GitHub's `/releases` array → entries; anything malformed is dropped, never guessed. */
export function parseReleases(json: unknown): ReleaseEntry[] {
  if (!Array.isArray(json)) return [];
  const out: ReleaseEntry[] = [];
  for (const r of json) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o['tag_name'] !== 'string') continue;
    out.push({
      tag: o['tag_name'],
      prerelease: o['prerelease'] === true,
      draft: o['draft'] === true,
      pageUrl: typeof o['html_url'] === 'string' ? o['html_url'] : null,
    });
  }
  return out;
}

function isPreRelease(version: string): boolean {
  return version.split('+')[0]!.includes('-');
}

export interface NewestRelease {
  readonly version: string;
  /** `null` when the URL GitHub gave is not this repository's release page. */
  readonly pageUrl: string | null;
  readonly newer: boolean;
}

/**
 * BR-85.5: not drafts; tag `v<SemVer>`; pre-releases only while the running version is itself one (a stable install
 * is told only of stable releases); the highest by SemVer precedence. `null` when nothing qualifies or the running
 * version is unknown — an unknown version never claims an update.
 */
export function newestRelease(entries: readonly ReleaseEntry[], running: string): NewestRelease | null {
  if (!isSemVer(running)) return null;
  const allowPre = isPreRelease(running);
  let best: { version: string; entry: ReleaseEntry } | null = null;
  for (const e of entries) {
    if (e.draft || !e.tag.startsWith('v')) continue;
    const version = e.tag.slice(1);
    if (!isSemVer(version) || version.includes('+')) continue;
    if (e.prerelease || isPreRelease(version)) {
      if (!allowPre) continue;
    }
    if (best === null || compareSemVer(version, best.version) > 0) best = { version, entry: e };
  }
  if (best === null) return null;
  return {
    version: best.version,
    pageUrl: best.entry.pageUrl !== null && releasePageAccepted(best.entry.pageUrl) ? best.entry.pageUrl : null,
    newer: compareSemVer(best.version, running) > 0,
  };
}

/** BR-85.6: only `https://github.com/kuhndj67/spotify-companion/releases/…`; no other host, port, user-info or path. */
export function releasePageAccepted(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    u.hostname === 'github.com' &&
    u.port === '' &&
    u.username === '' &&
    u.password === '' &&
    u.pathname.startsWith(`/${REPOSITORY}/releases/`) &&
    !u.pathname.includes('..')
  );
}
