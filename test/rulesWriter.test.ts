/**
 * LC-43 — the ONE path by which the app writes `rules.json` (BR-53, BR-54, BR-55, BR-59.5).
 *
 * ⚠️ Built on a REAL `RuleStore` and `RuleSetWatcher` over a temp directory, never a stub watcher. A stub that
 * "reloads" whatever it is told would confirm the model of reloading, not the reload — the U5 lesson that a
 * fixture built around a mental model confirms the model.
 *
 * PBT-63 is the positive control: an accepted write CHANGES THE RUNNING SET. A writer that never wrote would pass
 * every refusal test in this file perfectly.
 * PBT-64: concurrent confirms on the same base — exactly one applies, the rest are refused, none is lost silently.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import fc from 'fast-check';
import './fc-config.js';

import { REPLACE_WORD, RULES_STAGING_TTL_MS, RulesWriter } from '../src/configuration/RulesWriter.js';
import { hashRuleSetContent } from '../src/rules/ruleHash.js';
import { RuleSetWatcher } from '../src/rules/RuleSetWatcher.js';
import { RuleStore } from '../src/rules/RuleStore.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

function rule(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Rule ${id}`,
    enabled: true,
    action: 'skip',
    onUnknown: 'no-match',
    dryRun: true,
    predicate: { kind: 'compare', field: 'album.ageYears', op: 'gt', value: 40 },
    ...extra,
  };
}

function file(ids: string[], extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ version: 1, rules: ids.map((id) => rule(id, extra)) }, null, 2)}\n`;
}

interface Fixture {
  dir: string;
  path: string;
  watcher: RuleSetWatcher;
  writer: RulesWriter;
  clock: { ms: number };
}

async function fixture(initial: string | null = file(['a', 'b', 'c', 'd'])): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'rules-writer-'));
  const path = join(dir, 'rules.json');
  if (initial !== null) writeFileSync(path, initial);
  const clock = { ms: Date.parse('2026-10-08T12:00:00.000Z') };
  const watcher = new RuleSetWatcher({
    store: new RuleStore(path, silent),
    intervalMs: 60_000,
    now: () => new Date(clock.ms).toISOString(),
    logger: { info: () => {}, warn: () => {} },
    reloadingMinMs: 0,
  });
  await watcher.start();
  watcher.stop();
  const writer = new RulesWriter({ rulesPath: path, watcher, now: () => clock.ms });
  return { dir, path, watcher, writer, clock };
}

let f: Fixture;

beforeEach(async () => {
  f = await fixture();
});

afterEach(() => {
  rmSync(f.dir, { recursive: true, force: true });
});

describe('download (BR-53.2)', () => {
  it('returns the bytes unchanged with their hash', () => {
    const d = f.writer.download();
    assert.equal(d?.content, readFileSync(f.path, 'utf8'));
    assert.equal(d?.hash, hashRuleSetContent(readFileSync(f.path, 'utf8')));
  });

  it('is null when there is no rules file yet', async () => {
    const g = await fixture(null);
    try {
      assert.equal(g.writer.download(), null);
    } finally {
      rmSync(g.dir, { recursive: true, force: true });
    }
  });
});

describe('stageUpload — refusals change nothing (BR-53.3, BR-54.2)', () => {
  it('an invalid file is refused, names the rule and field, and the file is untouched', () => {
    const before = readFileSync(f.path, 'utf8');
    const bad = JSON.stringify({ rules: [{ ...rule('x'), onUnknown: 'maybe' }] });
    const r = f.writer.stageUpload(bad, f.writer.download()!.hash);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.reason === 'invalid');
    assert.ok(!r.ok && r.errors.some((e) => e.includes('rules[0]') && e.includes('onUnknown')), JSON.stringify(!r.ok && r.errors));
    assert.equal(readFileSync(f.path, 'utf8'), before);
  });

  it('a file over the cap is refused before parsing', () => {
    const r = f.writer.stageUpload(' '.repeat(256 * 1024 + 1), null);
    assert.ok(!r.ok && r.reason === 'too-large');
  });

  it('BR-54.2: a STALE base is refused — the rules changed since that download', () => {
    const r = f.writer.stageUpload(file(['a', 'b', 'c', 'd', 'e']), hashRuleSetContent('some older version'));
    assert.ok(!r.ok && r.reason === 'stale-base');
  });

  it('a matching base stages an ordinary change with no typed confirmation', () => {
    const r = f.writer.stageUpload(file(['a', 'b', 'c', 'd', 'e']), f.writer.download()!.hash);
    assert.ok(r.ok);
    assert.equal(r.ok && r.typedConfirmationRequired, false);
    assert.deepEqual(r.ok && r.comparison.added.map((x) => x.id), ['e']);
  });
});

describe('typed confirmation (BR-54.1, BR-54.4)', () => {
  it('BR-54.4: an UNKNOWN base is not refused, but needs REPLACE, with the reason stated', () => {
    const r = f.writer.stageUpload(file(['a', 'b', 'c', 'd', 'e']), null);
    assert.ok(r.ok && r.typedConfirmationRequired);
    assert.match((r.ok && r.typedConfirmationReason) || '', /wasn't downloaded in this session/);
  });

  it('BR-54.1: the valid-but-EMPTY file needs REPLACE — and without it nothing is written', async () => {
    const before = readFileSync(f.path, 'utf8');
    const r = f.writer.stageUpload(file([]), f.writer.download()!.hash);
    assert.ok(r.ok && r.typedConfirmationRequired && r.comparison.massRemoval);
    assert.match((r.ok && r.typedConfirmationReason) || '', /removes 4 of your 4 rules/);

    const refused = await f.writer.confirm(r.ok ? r.token : '', null);
    assert.ok(!refused.ok && refused.reason === 'confirmation-required');
    assert.equal(readFileSync(f.path, 'utf8'), before, 'the case config/ was read-only for');

    const wrongWord = await f.writer.confirm(r.ok ? r.token : '', 'replace');
    assert.ok(!wrongWord.ok && wrongWord.reason === 'confirmation-required', 'the word is exact');

    const applied = await f.writer.confirm(r.ok ? r.token : '', REPLACE_WORD);
    assert.ok(applied.ok);
    assert.equal(f.watcher.current().rules.length, 0);
  });

  it('removing exactly half needs no typed word (the PBT-60 boundary, end to end)', () => {
    const r = f.writer.stageUpload(file(['a', 'b']), f.writer.download()!.hash);
    assert.ok(r.ok && !r.typedConfirmationRequired);
  });
});

describe('PBT-63 — positive control: an accepted write changes the RUNNING set', () => {
  it('PBT-63: confirm writes the file, keeps the previous, and the watcher version moves to the new rules', async () => {
    const original = readFileSync(f.path, 'utf8');
    const v0 = f.watcher.current().version;
    const upload = file(['a', 'b', 'c', 'd', 'e']);

    const staged = f.writer.stageUpload(upload, f.writer.download()!.hash);
    assert.ok(staged.ok);
    const applied = await f.writer.confirm(staged.ok ? staged.token : '', null);

    assert.ok(applied.ok, JSON.stringify(applied));
    assert.equal(readFileSync(f.path, 'utf8'), upload);
    assert.equal(readFileSync(f.writer.previousPath, 'utf8'), original);
    assert.ok(applied.ok && applied.version > v0, 'the version reported is the watcher’s, after the reload');
    assert.deepEqual(f.watcher.current().rules.map((l) => l.rule.id), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(f.writer.lastWrite()?.outcome, 'applied');
  });

  it('a confirmed token cannot be replayed', async () => {
    const staged = f.writer.stageUpload(file(['a']), null);
    const token = staged.ok ? staged.token : '';
    assert.ok((await f.writer.confirm(token, REPLACE_WORD)).ok);
    const again = await f.writer.confirm(token, REPLACE_WORD);
    assert.ok(!again.ok && again.reason === 'staging-expired');
  });
});

describe('BR-54.3 — the file changed between comparison and confirm', () => {
  it('a hand edit after staging refuses the confirm and survives untouched', async () => {
    const staged = f.writer.stageUpload(file(['a', 'b', 'c', 'd', 'e']), f.writer.download()!.hash);
    const handEdit = file(['a', 'z']);
    writeFileSync(f.path, handEdit);

    const r = await f.writer.confirm(staged.ok ? staged.token : '', null);
    assert.ok(!r.ok && r.reason === 'changed-since-staging');
    assert.equal(readFileSync(f.path, 'utf8'), handEdit, 'the person’s edit is never overwritten');
  });

  it('a staging expires after the TTL', async () => {
    const staged = f.writer.stageUpload(file(['a', 'b', 'c', 'd', 'e']), f.writer.download()!.hash);
    f.clock.ms += RULES_STAGING_TTL_MS;
    const r = await f.writer.confirm(staged.ok ? staged.token : '', null);
    assert.ok(!r.ok && r.reason === 'staging-expired');
  });
});

describe('PBT-64 — concurrent confirms on the same base', () => {
  it('PBT-64: exactly one applies; every other is refused changed-since-staging; nothing is lost silently', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (tabs) => {
        const g = await fixture();
        try {
          const base = g.writer.download()!.hash;
          const stagings = Array.from({ length: tabs }, (_, i) => g.writer.stageUpload(file(['a', 'b', 'c', 'd', `tab${i}`]), base));
          const results = await Promise.all(stagings.map((s) => g.writer.confirm(s.ok ? s.token : '', null)));
          const applied = results.filter((r) => r.ok);
          assert.equal(applied.length, 1);
          for (const r of results.filter((x) => !x.ok)) assert.ok(!r.ok && r.reason === 'changed-since-staging');
          const winner = results.findIndex((r) => r.ok);
          assert.equal(readFileSync(g.path, 'utf8'), file(['a', 'b', 'c', 'd', `tab${winner}`]));
        } finally {
          rmSync(g.dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 15 },
    );
  });
});

describe('undo (BR-55)', () => {
  it('is refused with "Nothing to undo yet" before any write', () => {
    const r = f.writer.stageUndo();
    assert.ok(!r.ok && r.reason === 'nothing-to-undo' && r.message === 'Nothing to undo yet.');
  });

  it('SWAPS: undo restores the previous set, and undoing the undo restores the newer one', async () => {
    const original = readFileSync(f.path, 'utf8');
    const newer = file(['a', 'b', 'c', 'd', 'e']);
    const s = f.writer.stageUpload(newer, f.writer.download()!.hash);
    await f.writer.confirm(s.ok ? s.token : '', null);

    const u1 = f.writer.stageUndo();
    assert.ok(u1.ok);
    assert.ok((await f.writer.confirm(u1.ok ? u1.token : '', null)).ok);
    assert.equal(readFileSync(f.path, 'utf8'), original);

    const u2 = f.writer.stageUndo();
    assert.ok((await f.writer.confirm(u2.ok ? u2.token : '', null)).ok);
    assert.equal(readFileSync(f.path, 'utf8'), newer);
  });

  it('the previous file is RE-validated, never trusted for having once been valid', () => {
    writeFileSync(f.writer.previousPath, '{ not json');
    const r = f.writer.stageUndo();
    assert.ok(!r.ok && r.reason === 'invalid');
  });
});

describe('applyAtStartup (BR-59.5, BR-59.6)', () => {
  it('applies when the current file is what the user confirmed against, keeping the previous', () => {
    const original = readFileSync(f.path, 'utf8');
    const r = f.writer.applyAtStartup(file(['restored']), hashRuleSetContent(original));
    assert.deepEqual(r, { applied: true });
    assert.equal(readFileSync(f.path, 'utf8'), file(['restored']));
    assert.equal(readFileSync(f.writer.previousPath, 'utf8'), original);
  });

  it('BR-59.6: does NOT apply when the rules changed after the confirm, and says why', () => {
    const before = readFileSync(f.path, 'utf8');
    const r = f.writer.applyAtStartup(file(['restored']), hashRuleSetContent('what it was at confirm'));
    assert.equal(r.applied, false);
    assert.match(!r.applied ? r.reason : '', /changed after you confirmed/);
    assert.equal(readFileSync(f.path, 'utf8'), before);
    assert.equal(existsSync(f.writer.previousPath), false);
  });

  it('never applies an invalid backup rules file', () => {
    const r = f.writer.applyAtStartup('{ broken', f.writer.download()!.hash);
    assert.equal(r.applied, false);
  });
});

describe('BR-54.5 — a rules write can never reach the kill switch', () => {
  it('RulesWriter imports nothing from src/playback/ (structural)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'configuration', 'RulesWriter.ts'), 'utf8');
    const imports = [...src.matchAll(/^import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1] ?? '');
    assert.ok(imports.length > 0, 'parsed the imports');
    assert.deepEqual(imports.filter((i) => i.includes('playback')), []);
  });
});
