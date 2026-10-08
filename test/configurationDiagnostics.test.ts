/**
 * IN-U7-6 — the Configuration block of `/api/diagnostics`, and the in-place writability probe.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { probeFileWritable } from '../src/configuration/atomicWrite.js';
import { configurationDiagnosticSteps, type ConfigurationDiagnosticsInput } from '../src/configuration/configurationDiagnostics.js';

const BASE: ConfigurationDiagnosticsInput = {
  configWritable: true,
  rulesPath: '/config/rules.json',
  musicbrainzWritable: true,
  musicbrainzPath: '/app/secrets/musicbrainz.json',
  spotifyWritable: true,
  spotifyPath: '/opt/spotify-mcp/spotify-config.json',
  lastRulesWrite: null,
  lastCredentialsWrite: null,
  polls: { total: 0, idle: 0, error: 0, idleShare: null },
};

const byName = (steps: ReturnType<typeof configurationDiagnosticSteps>, name: string) => steps.find((s) => s.name.startsWith(name))!;

describe('configurationDiagnosticSteps (IN-U7-6)', () => {
  it('a fresh, healthy install: writable everywhere, nothing absent reads as a fault', () => {
    const steps = configurationDiagnosticSteps(BASE);
    assert.ok(steps.every((s) => s.status !== 'fail'), JSON.stringify(steps));
    assert.equal(byName(steps, 'Last rules write').status, 'skip');
    assert.equal(byName(steps, 'Last credentials change').status, 'skip');
  });

  it('⚠️ a :ro left in place shows as a FAIL on the first page load, naming the mount', () => {
    const steps = configurationDiagnosticSteps({ ...BASE, configWritable: false, musicbrainzWritable: false });
    assert.equal(byName(steps, 'Rules directory').status, 'fail');
    assert.match(byName(steps, 'Rules directory').detail, /:ro/);
    assert.equal(byName(steps, 'MusicBrainz contact writable').status, 'fail');
  });

  it('a refused rules write is the guard WORKING — not a fault; a failed write is', () => {
    const at = '2026-10-08T14:00:00.000Z';
    assert.equal(byName(configurationDiagnosticSteps({ ...BASE, lastRulesWrite: { at, kind: 'upload', outcome: 'stale-base', version: null } }), 'Last rules write').status, 'ok');
    assert.equal(byName(configurationDiagnosticSteps({ ...BASE, lastRulesWrite: { at, kind: 'upload', outcome: 'write-failed', version: null } }), 'Last rules write').status, 'fail');
    assert.match(byName(configurationDiagnosticSteps({ ...BASE, lastRulesWrite: { at, kind: 'upload', outcome: 'applied', version: 7 } }), 'Last rules write').detail, /rules version 7/);
  });

  it('FR-71 in words: mostly-error polls are a FAIL, and the three counts are shown', () => {
    const steps = configurationDiagnosticSteps({ ...BASE, polls: { total: 10, idle: 2, error: 6, idleShare: 1 } });
    const p = byName(steps, 'Now-playing polls');
    assert.equal(p.status, 'fail');
    assert.match(p.detail, /2 \/ 2 \/ 6 of 10/);
  });

  it('an all-error run reports the idle share as unknown, never 100%', () => {
    const p = byName(configurationDiagnosticSteps({ ...BASE, polls: { total: 4, idle: 0, error: 4, idleShare: null } }), 'Now-playing polls');
    assert.match(p.detail, /unknown/);
  });
});

describe('probeFileWritable — never changes the file it checks', () => {
  it('true for a writable file, and the content and size are untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-file-'));
    try {
      const f = join(dir, 'musicbrainz.json');
      writeFileSync(f, '{"contact":"x"}');
      const before = statSync(f).size;
      assert.equal(probeFileWritable(f), true);
      assert.equal(readFileSync(f, 'utf8'), '{"contact":"x"}');
      assert.equal(statSync(f).size, before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('false for a missing file — and does not create it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-file-'));
    try {
      assert.equal(probeFileWritable(join(dir, 'absent.json')), false);
      assert.throws(() => statSync(join(dir, 'absent.json')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
