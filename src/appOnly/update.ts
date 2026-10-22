/**
 * *App only* update: the image rewrites ONE line of the user's `compose.yaml` (U10, FR-79 as amended, BR-83, LC-78).
 *
 *   docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:<new> update
 *   docker compose up -d
 *
 * It changes the version on the one `image: ghcr.io/kuhndj67/spotify-companion:<version>` line and nothing else
 * (every other byte, comment and line ending kept), and never moves to an older version. It touches nothing in
 * `data/`, `config/`, `state/` or `secrets/`, and needs neither the running app nor its network.
 *
 * ⚠️ It takes NO backup itself, by design (FD Q1 = A): a throwaway container cannot reach the running app (its Host
 * check answers 403, measured 2026-10-21). The UPDATED app backs up before its first run, because a version change
 * is a risky change (BR-79).
 *
 * The decisions are ⚙️ PURE (PBT-86, PBT-87); the writer around them is one read and one atomic write.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { writeFileAtomic } from '../configuration/atomicWrite.js';
import { compareSemVer, isSemVer } from '../version.js';

const IMAGE = 'ghcr.io/kuhndj67/spotify-companion';
/** `image: ghcr.io/kuhndj67/spotify-companion:<tag>`, optionally quoted, with anything after it kept. */
const IMAGE_LINE = /^(\s*image:\s*["']?ghcr\.io\/kuhndj67\/spotify-companion:)([^\s"'#]+)(.*)$/;

export type UpdateDecision = 'refuse-older' | 'same' | 'rewrite';

/** ⚙️ BR-83.2, by SemVer precedence (a pre-release ranks below its release). */
export function decideUpdate(current: string, own: string): UpdateDecision {
  const c = compareSemVer(own, current);
  return c < 0 ? 'refuse-older' : c === 0 ? 'same' : 'rewrite';
}

export type Rewrite =
  | { readonly ok: true; readonly text: string; readonly from: string }
  | { readonly ok: false; readonly reason: 'no-image-line' | 'several-image-lines' };

/** ⚙️ BR-83.1, 83.3: exactly one matching line, and only its version changes. Line endings survive (`\r\n` kept). */
export function rewriteImageLine(text: string, version: string): Rewrite {
  const lines = text.split('\n');
  const hits = lines.map((line, i) => [i, IMAGE_LINE.exec(line.replace(/\r$/, ''))] as const).filter(([, m]) => m !== null);
  if (hits.length === 0) return { ok: false, reason: 'no-image-line' };
  if (hits.length > 1) return { ok: false, reason: 'several-image-lines' };
  const [index, match] = hits[0]!;
  const line = lines[index]!;
  const cr = line.endsWith('\r') ? '\r' : '';
  lines[index] = `${match![1]}${version}${match![3]}${cr}`;
  return { ok: true, text: lines.join('\n'), from: match![2]! };
}

export type UpdateOutcome =
  | { readonly ok: true; readonly changed: boolean; readonly from: string; readonly to: string }
  | { readonly ok: false; readonly message: string };

export function runUpdate(folder: string, ownVersion: string): UpdateOutcome {
  const path = join(folder, 'compose.yaml');
  if (!existsSync(path)) {
    return { ok: false, message: 'no compose.yaml in this folder. Run update in the folder that setup wrote. Nothing was changed.' };
  }
  if (!isSemVer(ownVersion)) return { ok: false, message: `this image does not know its own version (${ownVersion}). Nothing was changed.` };
  const rewrite = rewriteImageLine(readFileSync(path, 'utf8'), ownVersion);
  if (!rewrite.ok) {
    return {
      ok: false,
      message:
        rewrite.reason === 'no-image-line'
          ? `compose.yaml has no "image: ${IMAGE}:<version>" line, so there is nothing to update. Nothing was changed.`
          : `compose.yaml has more than one "image: ${IMAGE}:" line; update cannot tell which to change. Nothing was changed.`,
    };
  }
  if (!isSemVer(rewrite.from)) {
    return { ok: false, message: `the image line names "${rewrite.from}", which is not a version update can compare. Nothing was changed.` };
  }
  switch (decideUpdate(rewrite.from, ownVersion)) {
    case 'refuse-older':
      return {
        ok: false,
        message: `this image is ${ownVersion}, OLDER than the ${rewrite.from} your compose.yaml runs. update never moves backwards. Nothing was changed.`,
      };
    case 'same':
      return { ok: true, changed: false, from: rewrite.from, to: ownVersion };
    case 'rewrite': {
      const written = writeFileAtomic(path, rewrite.text);
      if (!written.ok) return { ok: false, message: `could not write compose.yaml (${written.reason}). Nothing was changed.` };
      return { ok: true, changed: true, from: rewrite.from, to: ownVersion };
    }
  }
}
