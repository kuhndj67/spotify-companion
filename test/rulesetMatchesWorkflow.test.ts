/**
 * The `main` ruleset's required checks must be jobs CI actually runs (U8, P-62, BR-63.3 / BR-63.4).
 *
 * GitHub matches a required status check to a job by its display NAME. Rename a job in `ci.yml` without updating
 * `.github/rulesets/main.json` and `main` waits for a check that never reports: every PR blocks for ever, and the
 * obvious "fix" is to remove the requirement. This test makes the rename fail CI first.
 *
 * It also pins the owner bypass, because BR-63.3 states it as a rule. A ruleset that silently lost it would lock
 * the owner out of direct pushes, and one that silently gained other actors would widen the exception.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Job display names from a workflow file -- the `name:` four spaces under a two-space job key inside `jobs:`.
 * A deliberately narrow reader of the project's own layout rather than a YAML dependency; the positive control
 * below proves it finds what it should.
 */
function jobNames(workflowYaml: string): string[] {
  const jobsAt = workflowYaml.search(/^jobs:\s*$/m);
  assert.ok(jobsAt >= 0, 'no top-level jobs: key');
  const names: string[] = [];
  const re = /^ {2}[A-Za-z0-9_-]+:\s*\n {4}name:\s*(.+?)\s*$/gm;
  re.lastIndex = jobsAt;
  for (let m = re.exec(workflowYaml); m; m = re.exec(workflowYaml)) {
    names.push((m[1] ?? '').replace(/^(['"])(.*)\1$/, '$2'));
  }
  return names;
}

interface Ruleset {
  bypass_actors: { actor_id: number; actor_type: string; bypass_mode: string }[];
  rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[];
}

function requiredChecks(rs: Ruleset): string[] {
  const rule = rs.rules.find((r) => r.type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []).map((c) => c.context);
}

function missingChecks(rs: Ruleset, workflowYaml: string): string[] {
  const jobs = new Set(jobNames(workflowYaml));
  return requiredChecks(rs).filter((c) => !jobs.has(c));
}

/** U9: runs only on release tags, so it must never be required (see below). */
const PUBLISH_JOB = 'Publish image (release tags only)';
const NOT_REQUIRED: readonly string[] = [PUBLISH_JOB];

const ruleset = JSON.parse(readFileSync(join(root, '.github', 'rulesets', 'main.json'), 'utf8')) as Ruleset;
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

describe('main ruleset ↔ ci.yml (BR-63.4)', () => {
  it('every required check is a job name in ci.yml', () => {
    assert.ok(requiredChecks(ruleset).length >= 3, 'expected the three CI jobs to be required');
    assert.deepEqual(missingChecks(ruleset, ci), []);
  });

  it('every ci.yml job is required -- a job added later must be a deliberate choice either way', () => {
    assert.deepEqual(jobNames(ci).filter((n) => !NOT_REQUIRED.includes(n)).sort(), requiredChecks(ruleset).sort());
  });

  // U9 (P-70): `publish` runs ONLY on a pushed release tag. Required on main, it would never report on a pull
  // request, and every PR would wait for it for ever -- the same failure as a renamed job.
  it('the publish job exists and is NOT a required check', () => {
    assert.ok(jobNames(ci).includes(PUBLISH_JOB), `no "${PUBLISH_JOB}" job in ci.yml`);
    assert.ok(!requiredChecks(ruleset).includes(PUBLISH_JOB));
  });

  it('positive control: a ruleset that requires publish is reported', () => {
    const requiring: Ruleset = JSON.parse(JSON.stringify(ruleset));
    requiring.rules.find((r) => r.type === 'required_status_checks')!.parameters!.required_status_checks!.push({ context: PUBLISH_JOB });
    assert.ok(requiredChecks(requiring).includes(PUBLISH_JOB));
  });

  it('a pull request is required on main', () => {
    assert.ok(ruleset.rules.some((r) => r.type === 'pull_request'));
  });

  it('positive control: a renamed job is reported', () => {
    const renamed = ci.replace('name: Secret scan', 'name: Secrets');
    assert.deepEqual(missingChecks(ruleset, renamed), ['Secret scan']);
  });
});

describe('the owner bypass is present and is the only one (BR-63.3)', () => {
  it('exactly the repository-admin role, always', () => {
    assert.deepEqual(ruleset.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]);
  });
});

/**
 * Release tags (2026-10-21, pre-public code review 2.5.1). A pushed `v*` tag runs `publish`, which writes the image
 * under the project's name with no review. Without this ruleset any account with WRITE access could do that. So:
 * the ruleset must exist, cover every tag CI publishes from, forbid creating, moving and deleting them, and let only
 * the owner (the admin-role bypass) through.
 */
interface TagRuleset {
  target: string;
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  bypass_actors: Ruleset['bypass_actors'];
  rules: { type: string }[];
}

const REQUIRED_TAG_RULES = ['creation', 'update', 'deletion'] as const;

function tagRulesetProblems(rs: TagRuleset, workflowYaml: string): string[] {
  const problems: string[] = [];
  if (rs.target !== 'tag') problems.push(`target is ${rs.target}, not tag`);
  if (rs.enforcement !== 'active') problems.push(`enforcement is ${rs.enforcement}, not active`);
  // What CI publishes from: the push trigger's tag filter and the publish job's `if`. Both must be `v`-prefixed
  // tags, and the ruleset must cover exactly that prefix -- a ruleset on `release-*` would protect nothing.
  if (!/^ {4}tags: \['v\*'\]\s*$/m.test(workflowYaml)) problems.push("ci.yml no longer triggers on tags: ['v*']");
  if (!workflowYaml.includes("if: startsWith(github.ref, 'refs/tags/v')")) problems.push('publish is no longer gated on refs/tags/v');
  const { include, exclude } = rs.conditions.ref_name;
  if (include.length !== 1 || include[0] !== 'refs/tags/v*') problems.push(`includes ${JSON.stringify(include)}, not ["refs/tags/v*"]`);
  if (exclude.length > 0) problems.push(`excludes ${JSON.stringify(exclude)}`);
  const types = new Set(rs.rules.map((r) => r.type));
  for (const t of REQUIRED_TAG_RULES) if (!types.has(t)) problems.push(`no ${t} rule`);
  return problems;
}

const tagRuleset = JSON.parse(readFileSync(join(root, '.github', 'rulesets', 'release-tags.json'), 'utf8')) as TagRuleset;

describe('release tags are protected (code review 2.5.1)', () => {
  it('the release-tags ruleset covers what CI publishes from and forbids creating, moving and deleting it', () => {
    assert.deepEqual(tagRulesetProblems(tagRuleset, ci), []);
  });

  it('the bypass is exactly the repository-admin role, always (the owner pushes release tags)', () => {
    assert.deepEqual(tagRuleset.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]);
  });

  it('positive control: a ruleset that misses creation, targets branches or protects another prefix is reported', () => {
    const weakened: TagRuleset = JSON.parse(JSON.stringify(tagRuleset));
    weakened.rules = weakened.rules.filter((r) => r.type !== 'creation');
    weakened.target = 'branch';
    weakened.conditions.ref_name.include = ['refs/tags/release-*'];
    assert.deepEqual(tagRulesetProblems(weakened, ci), [
      'target is branch, not tag',
      'includes ["refs/tags/release-*"], not ["refs/tags/v*"]',
      'no creation rule',
    ]);
  });

  it('positive control: a CI trigger that moved to another tag prefix is reported', () => {
    const moved = ci.replace("tags: ['v*']", "tags: ['release-*']");
    assert.deepEqual(tagRulesetProblems(tagRuleset, moved), ["ci.yml no longer triggers on tags: ['v*']"]);
  });
});

/**
 * `main` needs one approval (2026-10-21, owner: *"we should follow sound practice with regards to public projects"*).
 * "The owner merges" was a convention: with 0 approvals any write-access account could merge its own pull request.
 * The owner's own pull requests still merge through the admin bypass pinned above.
 */
interface PullRequestRule {
  type: 'pull_request';
  parameters: { required_approving_review_count: number; dismiss_stale_reviews_on_push: boolean; require_last_push_approval: boolean };
}

function reviewProblems(rs: { rules: { type: string }[] }): string[] {
  const pr = rs.rules.find((r) => r.type === 'pull_request') as PullRequestRule | undefined;
  if (!pr) return ['no pull_request rule'];
  const problems: string[] = [];
  if (pr.parameters.required_approving_review_count < 1) problems.push('no approving review required');
  if (!pr.parameters.dismiss_stale_reviews_on_push) problems.push('a push after approval keeps the approval');
  if (!pr.parameters.require_last_push_approval) problems.push('the last pusher can approve their own push');
  return problems;
}

describe('a pull request into main needs an approval', () => {
  it('one approval, re-required after any later push', () => {
    assert.deepEqual(reviewProblems(ruleset), []);
  });
  it('positive control: the 0-approval ruleset of 2026-10-14 is reported', () => {
    const old = JSON.parse(JSON.stringify(ruleset)) as { rules: PullRequestRule[] };
    const pr = old.rules.find((r) => r.type === 'pull_request')!;
    pr.parameters = { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_last_push_approval: false };
    assert.deepEqual(reviewProblems(old), [
      'no approving review required',
      'a push after approval keeps the approval',
      'the last pusher can approve their own push',
    ]);
  });
});

/**
 * The publish credential (2026-10-21, code review 2.5.1 hardened). The tag ruleset stops a collaborator pushing a
 * `v*` tag, but on a push to ANY branch GitHub runs that branch's own `ci.yml`. If the workflow token could write
 * the package, an edited `ci.yml` could publish. So the only credential that can push lives in the `release`
 * environment, which GitHub hands only to `v*` tags, and no job asks the workflow token for `packages: write`.
 * (The package's own setting, *no Actions write for this repository*, is outside the repo: recorded, not testable.)
 */
interface Environment {
  name: string;
  deployment_branch_policy: { protected_branches: boolean; custom_branch_policies: boolean };
  policies: { name: string; type: string }[];
}

/** Workflow lines that are not comments: a comment may (and does) explain what is forbidden. */
const codeLines = (yaml: string) => yaml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

function publishCredentialProblems(workflowYaml: string, env: Environment): string[] {
  const code = codeLines(workflowYaml);
  const problems: string[] = [];
  if (/packages:\s*write/.test(code)) problems.push('a job asks for packages: write');
  if (/secrets\.GITHUB_TOKEN/.test(code)) problems.push('a step uses the workflow token as a secret');
  const publish = code.slice(code.indexOf('  publish:'));
  if (!/^ {4}environment: release\s*$/m.test(publish)) problems.push('publish does not run in the release environment');
  if (!publish.includes('secrets.GHCR_PUBLISH_TOKEN')) problems.push('publish does not log in with GHCR_PUBLISH_TOKEN');
  if (env.name !== 'release') problems.push(`environment file names ${env.name}`);
  if (!env.deployment_branch_policy.custom_branch_policies || env.deployment_branch_policy.protected_branches) {
    problems.push('the environment is not limited to its own ref list');
  }
  if (JSON.stringify(env.policies) !== JSON.stringify([{ name: 'v*', type: 'tag' }])) {
    problems.push(`the environment admits ${JSON.stringify(env.policies)}, not only v* tags`);
  }
  return problems;
}

const releaseEnv = JSON.parse(readFileSync(join(root, '.github', 'environments', 'release.json'), 'utf8')) as Environment;

describe('only a release tag can reach the publish credential', () => {
  it('publish uses the release environment token; no job asks for packages: write', () => {
    assert.deepEqual(publishCredentialProblems(ci, releaseEnv), []);
  });
  it('positive control: the pre-2026-10-21 publish job (workflow token, packages: write) is reported', () => {
    const old = ci
      .replace('    environment: release\n', '')
      .replace('      contents: read\n    # Serialise per tag', '      contents: read\n      packages: write\n    # Serialise per tag')
      .replace('secrets.GHCR_PUBLISH_TOKEN', 'secrets.GITHUB_TOKEN');
    assert.deepEqual(publishCredentialProblems(old, releaseEnv), [
      'a job asks for packages: write',
      'a step uses the workflow token as a secret',
      'publish does not run in the release environment',
      'publish does not log in with GHCR_PUBLISH_TOKEN',
    ]);
  });
  it('positive control: an environment that also admits a branch is reported', () => {
    const wide: Environment = { ...releaseEnv, policies: [...releaseEnv.policies, { name: 'main', type: 'branch' }] };
    assert.equal(publishCredentialProblems(ci, wide).length, 1);
  });
});

/**
 * ⚠️ A required check that cannot FAIL is not a check (found 2026-10-14 by the BR-63.5 positive control).
 *
 * GitHub's default shell is `bash -e` with no `pipefail`, so `npm run test:coverage | tee …` reported `tee`'s exit
 * code and a failing test left the job green. `defaults.run.shell: bash` turns on `-eo pipefail` for every step.
 */
function pipefailDefault(workflowYaml: string): boolean {
  return /^defaults:[ \t]*\r?\n {2}run:[ \t]*\r?\n {4}shell:[ \t]*bash[ \t]*$/m.test(workflowYaml);
}

describe('every workflow runs its steps with pipefail', () => {
  for (const file of ['ci.yml', 'secret-history.yml']) {
    it(`${file}: defaults.run.shell is bash (bash -eo pipefail)`, () => {
      assert.ok(pipefailDefault(readFileSync(join(root, '.github', 'workflows', file), 'utf8')));
    });
  }
  it('positive control: a workflow without it is reported', () => {
    assert.equal(pipefailDefault('name: x\npermissions:\n  contents: read\njobs:\n'), false);
    assert.equal(pipefailDefault('defaults:\n  run:\n    shell: bash\n'), true);
  });
});
