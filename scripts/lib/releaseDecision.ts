/**
 * Release decision — accept or refuse a candidate version (U8, LC-50, P-60, BR-66.4 / BR-66.7). ⚙️ PURE.
 *
 * `npm run release` (scripts/release.mjs) gathers the facts and calls this; nothing here touches git, Docker or
 * the disk, so every rule is property-tested (PBT-68…PBT-71).
 *
 * The rules, in the order they are checked (the FIRST failing one is the reason reported):
 *
 *   1. `npm run verify` passed, and the working tree is clean -- a release is a COMMIT, and a dirty tree's image
 *      would not match the tag put on it (BR-66.4);
 *   2. the candidate is valid SemVer **without build metadata** -- `+` is not allowed in a Docker tag, and SemVer
 *      precedence ignores it anyway, so two "different" releases could compare equal;
 *   3. ⚠️ neither the image tag `spotify-companion:X.Y.Z` nor the git tag `vX.Y.Z` exists -- **a tag is never
 *      overwritten** (BR-66.7). This used to happen on every build, which is why rollback needed hand-made tags;
 *   4. the candidate is **strictly greater**, by SemVer precedence, than every existing `v*` tag. So
 *      `1.0.0-beta.2 < 1.0.0`, and a release can never move backwards.
 */

import { isSemVer } from '../../src/version.js';

export interface ReleaseFacts {
  readonly candidate: string;
  /** Every git tag in the repository; non-`v<semver>` tags are ignored. */
  readonly gitTags: readonly string[];
  /** Every tag of the `spotify-companion` image (U9; `spotify-now-playing` until 1.0.0-beta.2). */
  readonly imageTags: readonly string[];
  readonly verifyPassed: boolean;
  readonly treeClean: boolean;
}

export type RefusalReason =
  | 'verify-failed'
  | 'tree-dirty'
  | 'invalid-version'
  | 'build-metadata'
  | 'image-tag-exists'
  | 'git-tag-exists'
  | 'not-greater';

export type ReleaseDecision =
  | { readonly accept: true; readonly gitTag: string; readonly imageTag: string; readonly previous: string | null }
  | { readonly accept: false; readonly reason: RefusalReason; readonly detail: string };

/** SemVer 2.0.0 precedence (§11). Both arguments must be valid SemVer; build metadata is ignored. */
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

export function decide(f: ReleaseFacts): ReleaseDecision {
  if (!f.verifyPassed) return refuse('verify-failed', '`npm run verify` did not pass');
  if (!f.treeClean) return refuse('tree-dirty', 'the working tree has uncommitted changes; a release is a commit');
  if (!isSemVer(f.candidate)) return refuse('invalid-version', `"${f.candidate}" is not SemVer 2.0.0`);
  if (f.candidate.includes('+')) return refuse('build-metadata', 'build metadata (+…) is not allowed in a Docker tag');
  if (f.imageTags.includes(f.candidate)) {
    return refuse('image-tag-exists', `image spotify-companion:${f.candidate} exists; tags are never overwritten`);
  }
  if (f.gitTags.includes(`v${f.candidate}`)) return refuse('git-tag-exists', `git tag v${f.candidate} exists`);

  const released = f.gitTags
    .filter((t) => t.startsWith('v') && isSemVer(t.slice(1)))
    .map((t) => t.slice(1))
    .sort(compareSemVer);
  const previous = released.at(-1) ?? null;
  if (previous !== null && compareSemVer(f.candidate, previous) <= 0) {
    return refuse('not-greater', `${f.candidate} is not greater than the latest release ${previous}`);
  }
  return { accept: true, gitTag: `v${f.candidate}`, imageTag: `spotify-companion:${f.candidate}`, previous };
}

function refuse(reason: RefusalReason, detail: string): ReleaseDecision {
  return { accept: false, reason, detail };
}
