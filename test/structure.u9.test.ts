/**
 * U9's structural guards (LC-63, P-69): one name, one pin, no upstream features switched on.
 *
 * Each claim is the kind that decays silently: an old container name left in a script that then checks the wrong
 * container; a second copy of the connector pin that drifts (the Dockerfile's default said `main` until 2026-10-18,
 * so CI built a different connector from the deployment); an upstream feature variable that turns the connector into
 * an HTTP server. Every guard here has a positive control that feeds it a planted violation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OLD_NAME = 'spotify-now-playing';
const SELF = 'test/structure.u9.test.ts';

/**
 * Where the old name may still appear, and EXACTLY how often. A count, not a yes/no: a new occurrence in an allowed
 * file fails too, so it is looked at rather than waved through.
 */
const OLD_NAME_ALLOWED: Record<string, { readonly count: number; readonly why: string }> = {
  'compose.yaml': { count: 1, why: 'the comment warning that the pre-U9 container is an orphan Compose leaves running' },
  'scripts/verify-install.mjs': { count: 2, why: 'the no-impact proof recognises the live container on either side of the crossing' },
  'scripts/lib/releaseDecision.ts': { count: 6, why: 'names the image it replaced, and the crossing guard refuses while the old container runs' },
  'scripts/release.mjs': { count: 2, why: 'the crossing guard asks Docker whether the old container is running, and says so' },
  'scripts/backup-history.mjs': { count: 1, why: 'history: the 2026-09-27 incident, as it happened' },
  'scripts/reclassify-unobserved-tails.mjs': { count: 1, why: 'history: the 2026-09-27 incident, as it happened' },
};

/** Tracked files, outside the design records (which are history and keep the names they were written with). */
function trackedTextFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f !== '' && !f.startsWith('aidlc-docs/') && f !== SELF)
    .filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?|db|sqlite)$/i.test(f));
}

function oldNameViolations(files: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    const count = text.split(OLD_NAME).length - 1;
    const allowed = OLD_NAME_ALLOWED[file]?.count ?? 0;
    if (count !== allowed) problems.push(`${file}: ${count} occurrence(s) of ${OLD_NAME}, allowed ${allowed}`);
  }
  return problems;
}

const FULL_SHA = /^[0-9a-f]{40}$/;
function composePin(yaml: string): string | null {
  return yaml.match(/^\s*MCP_SERVER_REF:\s*(\S+)\s*$/m)?.[1] ?? null;
}
function dockerfilePin(dockerfile: string): string | null {
  return dockerfile.match(/^ARG MCP_SERVER_REF=(\S+)\s*$/m)?.[1] ?? null;
}

/** Upstream's new feature switches at 6065ce5c (read from its source, 2026-10-18). None may be set (BR-68.2). */
const UPSTREAM_FEATURE_VARIABLES = [
  'MCP_AUTH',
  'MCP_TRANSPORT',
  'MCP_HTTP_HOST',
  'MCP_HTTP_PORT',
  'SPOTIFY_AUTHORIZATION_SERVERS',
  'SPOTIFY_RESOURCE_URL',
];
function featureVariablesIn(text: string): string[] {
  return UPSTREAM_FEATURE_VARIABLES.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
}

const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('one name: spotify-companion (BR-71.1)', () => {
  it(`no tracked file outside the allow-list says ${OLD_NAME}, and allowed files say it exactly as often as listed`, () => {
    const files = Object.fromEntries(trackedTextFiles().map((f) => [f, read(f)]));
    assert.deepEqual(oldNameViolations(files), []);
  });

  it('every allow-listed file still exists (an entry for a deleted file is a stale exemption)', () => {
    const tracked = new Set(trackedTextFiles());
    assert.deepEqual(Object.keys(OLD_NAME_ALLOWED).filter((f) => !tracked.has(f)), []);
  });

  it('positive control: a planted occurrence is caught, in a new file and as an extra in an allowed one', () => {
    assert.equal(oldNameViolations({ 'scripts/new.mjs': `docker logs ${OLD_NAME}` }).length, 1);
    assert.equal(oldNameViolations({ 'compose.yaml': `${OLD_NAME} ${OLD_NAME}` }).length, 1);
    assert.deepEqual(oldNameViolations({ 'compose.yaml': `# ${OLD_NAME}` }), []);
  });
});

describe('one connector pin (NFR-40, BR-68.1)', () => {
  it('compose.yaml pins a full 40-character SHA', () => {
    assert.match(composePin(read('compose.yaml')) ?? '', FULL_SHA);
  });

  it("the Dockerfile's default is the same SHA (a checked copy: `docker build .` in CI uses it)", () => {
    assert.equal(dockerfilePin(read('Dockerfile')), composePin(read('compose.yaml')));
  });

  it('positive control: a moving default and a short SHA are caught', () => {
    assert.equal(dockerfilePin('ARG MCP_SERVER_REF=main\n'), 'main');
    assert.notEqual(dockerfilePin('ARG MCP_SERVER_REF=main\n'), composePin(read('compose.yaml')));
    assert.doesNotMatch(composePin('    MCP_SERVER_REF: 6065ce5c\n') ?? '', FULL_SHA);
  });
});

describe("none of upstream's new features is switched on (BR-68.2)", () => {
  for (const file of ['compose.yaml', 'compose.verify.yaml', 'compose.app.yaml', 'Dockerfile']) {
    it(`${file} sets none of ${UPSTREAM_FEATURE_VARIABLES.join(', ')}`, () => {
      assert.deepEqual(featureVariablesIn(read(file)), []);
    });
  }

  it('positive control: a planted MCP_TRANSPORT is caught', () => {
    assert.deepEqual(featureVariablesIn('      MCP_TRANSPORT: http\n'), ['MCP_TRANSPORT']);
  });
});
