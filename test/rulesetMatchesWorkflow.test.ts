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
