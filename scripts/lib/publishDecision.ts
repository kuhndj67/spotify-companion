/**
 * Publish decision — may CI push this image? (U9, LC-64, P-70/P-71, BR-72.2/72.3). ⚙️ PURE, plus a thin CLI.
 *
 * Run by `ci.yml`'s `publish` job (on a pushed `v*` tag) inside the `node:22.23` image, which runs this `.ts` file
 * directly, so the job needs no action beside `actions/checkout` (NFR Design Q2 = A).
 *
 * ⚠️ It imports NOTHING, deliberately: Node 22.23 strips types but does not map `../../src/version.js` to `.ts`, and
 * installing `tsx` in the publishing job would run third-party install scripts beside the write token. That
 * `package.json`'s version is valid SemVer is already enforced by `test/versionSources.test.ts` in the `test` job,
 * which `publish` needs; this checks only what Docker itself would reject (`+` build metadata, a non-version shape).
 *
 * The rules, in order (the FIRST failing one is reported):
 *   1. the tag is exactly `v` + `package.json`'s version (BR-72.2) -- the image tag IS that version (NFR-34);
 *   2. the registry was asked and does NOT already hold that version (BR-72.3: a published tag is never
 *      overwritten). ⚠️ "Could not ask" is a refusal: an unknown cannot prove the tag is free.
 */

/** `X.Y.Z` with an optional pre-release: the shape a version tag must have. Full SemVer is versionSources' job. */
const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export type RegistryAnswer = 'absent' | 'present' | 'unknown';

export interface PublishFacts {
  /** `GITHUB_REF_NAME` of the pushed tag, e.g. `v1.0.0-beta.3`. */
  readonly tag: string;
  /** `package.json`'s version at that tag. */
  readonly version: string;
  /** Does the registry already hold `<image>:<version>`? */
  readonly registry: RegistryAnswer;
}

export type PublishDecision =
  | { readonly publish: true; readonly imageTag: string }
  | { readonly publish: false; readonly reason: 'invalid-version' | 'tag-mismatch' | 'already-published' | 'registry-unknown'; readonly detail: string };

export function decidePublish(f: PublishFacts): PublishDecision {
  if (!VERSION_SHAPE.test(f.version)) {
    return { publish: false, reason: 'invalid-version', detail: `package.json version "${f.version}" is not a publishable SemVer` };
  }
  if (f.tag !== `v${f.version}`) {
    return { publish: false, reason: 'tag-mismatch', detail: `tag "${f.tag}" is not v${f.version} (package.json at that commit)` };
  }
  if (f.registry === 'unknown') {
    return { publish: false, reason: 'registry-unknown', detail: 'the registry could not be asked whether this version exists; refusing rather than risk an overwrite' };
  }
  if (f.registry === 'present') {
    return { publish: false, reason: 'already-published', detail: `${f.version} is already in the registry; a published tag is never overwritten` };
  }
  return { publish: true, imageTag: f.version };
}

// CLI: node scripts/lib/publishDecision.ts --tag <tag> --version <version> --registry absent|present|unknown
const isMain = process.argv[1]?.endsWith('publishDecision.ts') ?? false;
if (isMain && process.argv.includes('--tag')) {
  const arg = (name: string): string => process.argv[process.argv.indexOf(name) + 1] ?? '';
  const registry = arg('--registry');
  if (registry !== 'absent' && registry !== 'present' && registry !== 'unknown') {
    console.error(`publishDecision: --registry must be absent|present|unknown, got "${registry}"`);
    process.exit(2);
  }
  const d = decidePublish({ tag: arg('--tag'), version: arg('--version'), registry });
  if (!d.publish) {
    console.error(`publishDecision: REFUSED (${d.reason}): ${d.detail}`);
    process.exit(1);
  }
  console.log(`publishDecision: publish ${d.imageTag}`);
}
