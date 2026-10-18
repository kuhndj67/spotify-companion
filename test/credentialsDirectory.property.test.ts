/**
 * The credentials-directory check (U9, LC-61, P-68) — PBT-76, plus the mount-table parser, the wording, the
 * diagnostics step and the refusal to spawn.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import {
  classifyCredentialsDirectory,
  credentialsDirectoryMessage,
  mountPointsFrom,
  type CredentialsDirectoryClass,
  type CredentialsDirectoryProbes,
} from '../src/configuration/credentialsDirectory.js';
import { configurationDiagnosticSteps, type ConfigurationDiagnosticsInput } from '../src/configuration/configurationDiagnostics.js';
import { CredentialsDirectoryError, SpotifyMcpClient } from '../src/mcp/spotifyMcpClient.js';

const triState = fc.constantFrom(true, false, null);
const probes: fc.Arbitrary<CredentialsDirectoryProbes> = fc.record({
  inContainer: fc.boolean(),
  directoryExists: fc.boolean(),
  directoryIsMount: triState,
  fileIsMount: triState,
  directoryWritable: fc.boolean(),
});
const CLASSES: readonly CredentialsDirectoryClass[] = ['ok', 'not-mounted', 'not-writable', 'single-file'];

describe('classifyCredentialsDirectory (LC-61)', () => {
  it('PBT-76: every combination maps to exactly one class, and only a mounted, writable directory is `ok`', () => {
    fc.assert(
      fc.property(probes, (p) => {
        const cls = classifyCredentialsDirectory(p);
        assert.ok(CLASSES.includes(cls));
        const healthyInContainer =
          p.directoryExists && p.directoryIsMount !== false && p.fileIsMount !== true && p.directoryWritable;
        assert.equal(cls === 'ok', !p.inContainer || healthyInContainer);
      }),
    );
  });

  it('PBT-76 ⭐ positive control: a mounted, writable directory in a container IS `ok`', () => {
    assert.equal(
      classifyCredentialsDirectory({ inContainer: true, directoryExists: true, directoryIsMount: true, fileIsMount: false, directoryWritable: true }),
      'ok',
    );
  });

  it('the pre-U9 compose file (a single-file mount) is `single-file`, whatever else holds', () => {
    fc.assert(
      fc.property(probes, (p) => {
        assert.equal(classifyCredentialsDirectory({ ...p, inContainer: true, fileIsMount: true }), 'single-file');
      }),
    );
  });

  it('an unreadable mount table does not block a writable directory (a false `not-mounted` would stop Spotify)', () => {
    assert.equal(
      classifyCredentialsDirectory({ inContainer: true, directoryExists: true, directoryIsMount: null, fileIsMount: null, directoryWritable: true }),
      'ok',
    );
  });
});

describe('credentialsDirectoryMessage', () => {
  it('names the directory and the fix for every non-ok class, within the indicator\'s 200-character bound', () => {
    for (const cls of CLASSES) {
      const text = credentialsDirectoryMessage(cls, '/app/secrets');
      if (cls === 'ok') {
        assert.equal(text, null);
        continue;
      }
      assert.ok(text !== null && text.includes('/app/secrets') && text.includes('./secrets'), cls);
      assert.ok(text.length <= 200, `${cls}: ${text.length} characters`);
    }
  });
});

describe('mountPointsFrom', () => {
  it('reads field 5 of /proc/self/mountinfo and decodes octal escapes', () => {
    const text = [
      '1290 1199 0:123 / / rw,relatime - overlay overlay rw',
      '1310 1290 8:32 /mnt/c/x/secrets /app/secrets rw,relatime - 9p drvfs rw',
      '1311 1290 8:32 /mnt/c/x/secrets/spotify-config.json /opt/spotify-mcp/spotify-config.json rw - 9p drvfs rw',
      '1312 1290 8:32 /a /data\\040dir rw - ext4 /dev/sdc rw',
      '',
    ].join('\n');
    const points = mountPointsFrom(text);
    assert.ok(points.has('/app/secrets'));
    assert.ok(points.has('/opt/spotify-mcp/spotify-config.json'));
    assert.ok(points.has('/data dir'));
    assert.ok(!points.has('/app'));
  });
});

describe('the diagnostics step', () => {
  const base: ConfigurationDiagnosticsInput = {
    configWritable: true,
    rulesPath: '/config/rules.json',
    musicbrainzWritable: true,
    musicbrainzPath: '/app/secrets/musicbrainz.json',
    spotifyWritable: true,
    spotifyPath: '/app/secrets/spotify-config.json',
    credentialsDirectory: { class: 'ok', message: null },
    lastRulesWrite: null,
    lastCredentialsWrite: null,
    polls: { total: 0, idle: 0, error: 0, idleShare: null },
  };
  const credentialsStep = (input: ConfigurationDiagnosticsInput) =>
    configurationDiagnosticSteps(input).find((s) => s.name === 'Credentials directory')!;

  it('is ok for an ok directory and FAILS, with the class and words, otherwise', () => {
    assert.equal(credentialsStep(base).status, 'ok');
    const message = credentialsDirectoryMessage('single-file', '/app/secrets');
    const failed = credentialsStep({ ...base, credentialsDirectory: { class: 'single-file', message } });
    assert.equal(failed.status, 'fail');
    assert.match(failed.detail, /^single-file: Credentials are mounted as single files/);
  });
});

describe('SpotifyMcpClient refuses to spawn when blocked (P-68)', () => {
  it('throws CredentialsDirectoryError with the reason, and never starts the connector', async () => {
    const client = new SpotifyMcpClient({ blockedBecause: () => 'mount ./secrets as a directory' });
    await assert.rejects(client.getNowPlaying(), (error: unknown) => {
      assert.ok(error instanceof CredentialsDirectoryError);
      assert.equal((error as Error).message, 'mount ./secrets as a directory');
      return true;
    });
  });
});
