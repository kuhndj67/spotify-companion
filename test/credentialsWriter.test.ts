/**
 * LC-44 — Spotify credentials and the MusicBrainz contact (BR-56, BR-57; P-49, P-50, P-53).
 *
 * The ORDER test is the one that matters most: P-49's whole point is that the file is written only after the MCP
 * child has gone, and that ordering is exactly what a later "simplification" would break while every outcome test
 * still passed.
 *
 * PBT-61: for generated secrets, no response, log line or Diagnostics record contains any 8-character piece of a
 * submitted secret — on success and on every refusal. With its POSITIVE control: a valid save does write them.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import fc from 'fast-check';
import './fc-config.js';

import { CredentialsWriter, type CredentialsWriterDeps } from '../src/configuration/CredentialsWriter.js';
import { waitForProcessExit } from '../src/mcp/processExit.js';

const NOW = Date.parse('2026-10-08T14:02:00.000Z');

let dir: string;
let spotifyPath: string;
let mbPath: string;

const ORIGINAL_SPOTIFY = {
  clientId: 'oldclientid0000000000000000000000',
  clientSecret: 'oldsecret',
  redirectUri: 'http://127.0.0.1:8888/callback',
  refreshToken: 'oldrefresh',
  accessToken: 'oldaccess',
  expiresAt: 999,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'credentials-'));
  spotifyPath = join(dir, 'spotify-config.json');
  mbPath = join(dir, 'musicbrainz.json');
  writeFileSync(spotifyPath, JSON.stringify(ORIGINAL_SPOTIFY));
  writeFileSync(mbPath, JSON.stringify({ _comment: 'keep me', contact: 'old@mail.org', appName: 'SpotifyNowPlaying', appVersion: '0.1.0' }));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writer(overrides: Partial<CredentialsWriterDeps> = {}, events: string[] = []) {
  return new CredentialsWriter({
    spotifyConfigPath: spotifyPath,
    musicbrainzPath: mbPath,
    poller: { pause: async () => void events.push('pause'), resume: () => void events.push('resume') },
    mcp: { close: async () => void events.push('close') },
    webApi: { forgetCredentials: () => void events.push('forget') },
    onContactChanged: (c) => void events.push(`contact:${c}`),
    now: () => NOW,
    ...overrides,
  });
}

const VALID = {
  clientId: 'newclientid1111111111111111111111',
  clientSecret: 'newsecretvalue1234567890',
  redirectUri: 'http://127.0.0.1:8888/callback',
  refreshToken: 'newrefreshtokenvalue1234567890',
};

describe('the Spotify save sequence (P-49) — ORDER', () => {
  it('pause → close (file still OLD) → write → forget (file NEW) → resume', async () => {
    const events: string[] = [];
    const w = writer(
      {
        mcp: {
          close: async () => {
            events.push('close');
            assert.equal(JSON.parse(readFileSync(spotifyPath, 'utf8')).clientSecret, 'oldsecret', 'nothing written before the child is gone');
          },
        },
        webApi: {
          forgetCredentials: () => {
            events.push('forget');
            assert.equal(JSON.parse(readFileSync(spotifyPath, 'utf8')).clientSecret, VALID.clientSecret);
          },
        },
      },
      events,
    );
    const r = await w.saveSpotify(VALID);
    assert.ok(!('ok' in r), JSON.stringify(r));
    assert.deepEqual(events, ['pause', 'close', 'forget', 'resume']);
  });

  it('writes exactly the BR-56.4 shape — the one probe P-U7-1 proved works', async () => {
    await writer().saveSpotify(VALID);
    const file = JSON.parse(readFileSync(spotifyPath, 'utf8'));
    assert.deepEqual(file, { ...VALID, accessToken: 'placeholder', expiresAt: 0, replacedAt: '2026-10-08T14:02:00.000Z' });
  });

  it('⚠️ if the MCP child does not stop, NOTHING is written and polling resumes', async () => {
    const events: string[] = [];
    const before = readFileSync(spotifyPath, 'utf8');
    const w = writer({ mcp: { close: async () => Promise.reject(new Error('still running')) } }, events);
    const r = await w.saveSpotify(VALID);
    assert.ok('ok' in r && !r.ok && r.reason === 'mcp-did-not-stop');
    assert.equal(readFileSync(spotifyPath, 'utf8'), before);
    assert.deepEqual(events, ['pause', 'resume']);
  });

  it('Q5 = B: nothing is carried over from the old file — no old token, no previous copy', async () => {
    await writer().saveSpotify(VALID);
    const text = readFileSync(spotifyPath, 'utf8');
    for (const old of ['oldclientid', 'oldsecret', 'oldrefresh', 'oldaccess', '999']) assert.ok(!text.includes(old), `${old} survived`);
  });
});

describe('validation (BR-56.2) — refusals name FIELDS and touch nothing', () => {
  it('every field is required; the refusal lists the missing ones and never pauses the poll', async () => {
    const events: string[] = [];
    const r = await writer({}, events).saveSpotify({ ...VALID, clientSecret: '', refreshToken: 'has space' });
    assert.ok('ok' in r && !r.ok && r.reason === 'invalid');
    assert.deepEqual('ok' in r && !r.ok ? r.fields : [], ['clientSecret', 'refreshToken']);
    assert.deepEqual(events, []);
    assert.equal(JSON.parse(readFileSync(spotifyPath, 'utf8')).clientSecret, 'oldsecret');
  });

  it('the redirect URI must be a full http(s) address', async () => {
    for (const bad of ['127.0.0.1:8888/callback', 'ftp://x/callback', 'not a url']) {
      const r = await writer().saveSpotify({ ...VALID, redirectUri: bad });
      assert.ok('ok' in r && !r.ok && r.fields.includes('redirectUri'), bad);
    }
  });

  it('an oversized body is refused before anything else', async () => {
    const r = await writer().saveSpotify(VALID, 16 * 1024 + 1);
    assert.ok('ok' in r && !r.ok && r.reason === 'too-large');
  });
});

describe('spotifyView (BR-56.7) — no field can carry a secret', () => {
  it('a file written by npm run auth reads as source "file"; after a save, "app" with the time', async () => {
    const w = writer();
    assert.equal(w.spotifyView().source, 'file');
    await w.saveSpotify(VALID);
    const v = w.spotifyView();
    assert.deepEqual(v, {
      set: true,
      clientIdMasked: 'newc…1111',
      redirectUri: VALID.redirectUri,
      secretSet: true,
      refreshTokenSet: true,
      replacedAt: '2026-10-08T14:02:00.000Z',
      source: 'app',
    });
  });

  it('no file at all reads as not set, source "none"', () => {
    rmSync(spotifyPath);
    assert.deepEqual(writer().spotifyView(), {
      set: false, clientIdMasked: null, redirectUri: null, secretSet: false, refreshTokenSet: false, replacedAt: null, source: 'none',
    });
  });
});

describe('PBT-61 — secrets flow one way (P-53)', () => {
  const secret = fc.stringMatching(/^[A-Za-z0-9]{16,48}$/);

  function leaks(haystack: string, needle: string): boolean {
    for (let i = 0; i + 8 <= needle.length; i += 1) if (haystack.includes(needle.slice(i, i + 8))) return true;
    return false;
  }

  it('PBT-61: no response, log line or Diagnostics record contains 8 characters of a secret — on any path', async () => {
    await fc.assert(
      fc.asyncProperty(
        secret,
        secret,
        fc.constantFrom('valid', 'bad-redirect', 'mcp-fails', 'bad-client'),
        async (clientSecret, refreshToken, path) => {
          writeFileSync(spotifyPath, JSON.stringify(ORIGINAL_SPOTIFY));
          const logged: string[] = [];
          const saved = { log: console.log, warn: console.warn, error: console.error };
          console.log = console.warn = console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
          try {
            const w = writer(path === 'mcp-fails' ? { mcp: { close: async () => Promise.reject(new Error('x')) } } : {});
            const r = await w.saveSpotify({
              ...VALID,
              clientSecret,
              refreshToken,
              redirectUri: path === 'bad-redirect' ? 'nope' : VALID.redirectUri,
              clientId: path === 'bad-client' ? '' : VALID.clientId,
            });
            const outputs = [JSON.stringify(r), JSON.stringify(w.lastWrite()), JSON.stringify(w.spotifyView()), ...logged].join('\n');
            assert.ok(!leaks(outputs, clientSecret), 'client secret leaked');
            assert.ok(!leaks(outputs, refreshToken), 'refresh token leaked');

            // POSITIVE control: a valid save really does write them — a writer that wrote nothing would pass above.
            if (path === 'valid') {
              const file = JSON.parse(readFileSync(spotifyPath, 'utf8'));
              assert.equal(file.clientSecret, clientSecret);
              assert.equal(file.refreshToken, refreshToken);
            }
          } finally {
            Object.assign(console, saved);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('MusicBrainz contact (BR-57)', () => {
  it('uses the SAME rule as startup: the example placeholder is refused, with its message', async () => {
    const r = await writer().saveMusicBrainzContact('you@example.com');
    assert.ok('ok' in r && !r.ok && r.reason === 'invalid');
    assert.match('ok' in r && !r.ok ? r.message : '', /placeholder/);
    assert.equal(JSON.parse(readFileSync(mbPath, 'utf8')).contact, 'old@mail.org');
  });

  // U8 (BR-66.2): the one exception to "every other field" is the legacy `appVersion`, which is dropped -- the
  // version comes from package.json now. The fixture still carries it, so this proves an OLD file is cleaned.
  it('changes ONLY contact, preserves every other field except the legacy appVersion, and tells the client (no restart)', async () => {
    const events: string[] = [];
    const r = await writer({}, events).saveMusicBrainzContact('  kuhndj67@gmail.com ');
    assert.deepEqual(r, { set: true, masked: 'k…7@gmail.com' });
    assert.deepEqual(JSON.parse(readFileSync(mbPath, 'utf8')), {
      _comment: 'keep me', contact: 'kuhndj67@gmail.com', appName: 'SpotifyNowPlaying',
    });
    assert.deepEqual(events, ['contact:kuhndj67@gmail.com']);
  });
});

describe('waitForProcessExit (P-49, probe P-U7-2)', () => {
  it('resolves once a real child has exited', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
    await waitForProcessExit(child.pid!, 5_000);
    assert.notEqual(child.exitCode ?? child.signalCode, undefined);
  });

  it('rejects past the bound — the caller must then NOT write', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
    try {
      await assert.rejects(waitForProcessExit(child.pid!, 200), /still running/);
    } finally {
      child.kill();
    }
  });
});
