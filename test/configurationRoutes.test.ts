/**
 * U7 routes over HTTP (BR-60) — real `RulesWriter` on a real store + watcher, real `CredentialsWriter` with the
 * poll loop, MCP client and Web API client faked at their ports.
 *
 * ⚠️ `ingestGuard` is asserted on EVERY new POST, with U6's three refusals — a write route that forgot the guard is
 * reachable from any page a browser on this machine visits.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';

import { createApi, type ApiDeps } from '../src/api.js';
import { CredentialsWriter } from '../src/configuration/CredentialsWriter.js';
import { RulesWriter } from '../src/configuration/RulesWriter.js';
import { INGEST_HEADER, INGEST_HEADER_VALUE } from '../src/ingest/types.js';
import { RuleSetWatcher } from '../src/rules/RuleSetWatcher.js';
import { RuleStore } from '../src/rules/RuleStore.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const ORIGIN = 'http://localhost:3010';
const GOOD = { origin: ORIGIN, [INGEST_HEADER]: INGEST_HEADER_VALUE };

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const ruleFile = (ids: string[]) =>
  JSON.stringify({
    version: 1,
    rules: ids.map((id) => ({ id, name: id, enabled: true, action: 'skip', onUnknown: 'no-match', dryRun: true, predicate: { kind: 'compare', field: 'album.ageYears', op: 'gt', value: 40 } })),
  });

const SECRET = 'TopSecretClientValue9876543210';
const REFRESH = 'RefreshTokenValueZYXWVUTSRQ1234';

interface Served {
  base: string;
  rulesPath: string;
  spotifyPath: string;
}

async function serve(overrides: Partial<ApiDeps> = {}): Promise<Served> {
  const root = mkdtempSync(join(tmpdir(), 'u7-routes-'));
  const rulesPath = join(root, 'rules.json');
  const spotifyPath = join(root, 'spotify-config.json');
  const mbPath = join(root, 'musicbrainz.json');
  writeFileSync(rulesPath, ruleFile(['a', 'b', 'c']));
  writeFileSync(spotifyPath, JSON.stringify({ clientId: 'x', clientSecret: 'y', redirectUri: 'http://127.0.0.1:8888/callback', refreshToken: 'z' }));
  writeFileSync(mbPath, JSON.stringify({ contact: 'old@mail.org', appName: 'SpotifyNowPlaying', appVersion: '0.1.0' }));

  const watcher = new RuleSetWatcher({
    store: new RuleStore(rulesPath, { info: () => {}, warn: () => {}, error: () => {} }),
    intervalMs: 60_000,
    now: () => '2026-10-08T12:00:00.000Z',
    logger: { info: () => {}, warn: () => {} },
    reloadingMinMs: 0,
  });
  await watcher.start();
  watcher.stop();
  const rulesWriter = new RulesWriter({ rulesPath, watcher, now: () => Date.parse('2026-10-08T12:00:00Z') });
  const credentials = new CredentialsWriter({
    spotifyConfigPath: spotifyPath,
    musicbrainzPath: mbPath,
    poller: { pause: async () => {}, resume: () => {} },
    mcp: { close: async () => {} },
    webApi: { forgetCredentials: () => {} },
    onContactChanged: () => {},
    now: () => Date.parse('2026-10-08T14:02:00Z'),
  });

  const deps = {
    repository: null,
    historyStartupError: null,
    exportService: null,
    likedSet: null,
    labelStartupError: null,
    observerStats: null,
    nowPlaying: { current: { playing: false } as never },
    listToolNames: async () => [],
    diagnostics: async () => ({ ok: true, steps: [] }) as never,
    likedFor: () => undefined,
    ruleSet: null,
    decisionLog: null,
    backTest: null,
    reloadRules: null,
    automation: null,
    skipExecutorEnabled: false,
    skipAttempts: null,
    now: () => '2026-10-08T12:00:00.000Z',
    reportTimeZone: 'America/New_York',
    rulesWriter,
    credentials,
    labelsActive: true,
    ...overrides,
  } as unknown as ApiDeps;
  const app = express();
  app.use(createApi(deps));
  const server: Server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, rulesPath, spotifyPath };
}

describe('ingestGuard on every U7 POST (BR-60.1)', () => {
  const routes = ['/api/rules/upload', '/api/rules/undo', '/api/rules/confirm', '/api/settings/spotify', '/api/settings/musicbrainz'];
  const bad: [string, Record<string, string>][] = [
    ['no Origin', { [INGEST_HEADER]: INGEST_HEADER_VALUE }],
    ['a cross-site Origin', { origin: 'https://evil.example', [INGEST_HEADER]: INGEST_HEADER_VALUE }],
    ['no ingest header', { origin: ORIGIN }],
  ];
  for (const route of routes) {
    for (const [why, headers] of bad) {
      it(`${route} — refused with ${why}, and nothing is written`, async () => {
        const s = await serve();
        const before = readFileSync(s.rulesPath, 'utf8') + readFileSync(s.spotifyPath, 'utf8');
        const r = await fetch(`${s.base}${route}`, { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: ruleFile([]) });
        assert.equal(r.status, 403);
        assert.equal(readFileSync(s.rulesPath, 'utf8') + readFileSync(s.spotifyPath, 'utf8'), before);
      });
    }
  }
});

describe('rules over HTTP (FR-66, FR-67, FR-68)', () => {
  it('download → upload with the base → confirm: the running version moves', async () => {
    const s = await serve();
    const d = await fetch(`${s.base}/api/rules/file`);
    assert.equal(d.status, 200);
    assert.match(d.headers.get('content-disposition') ?? '', /attachment; filename="rules-20261008T120000Z\.json"/);
    const hash = d.headers.get('x-rules-hash')!;
    assert.equal(await d.text(), readFileSync(s.rulesPath, 'utf8'));

    const up = await fetch(`${s.base}/api/rules/upload`, {
      method: 'POST',
      headers: { ...GOOD, 'content-type': 'text/plain', 'x-rules-base-hash': hash },
      body: ruleFile(['a', 'b', 'c', 'd']),
    });
    assert.equal(up.status, 200);
    const staged: Body = await up.json();
    assert.deepEqual(staged.comparison.added.map((r: Body) => r.id), ['d']);
    assert.equal(staged.typedConfirmationRequired, false);

    const ok = await fetch(`${s.base}/api/rules/confirm`, { method: 'POST', headers: { ...GOOD, 'content-type': 'application/json' }, body: JSON.stringify({ token: staged.token }) });
    assert.equal(ok.status, 200);
    const applied: Body = await ok.json();
    assert.ok(applied.version >= 2);
    assert.equal(readFileSync(s.rulesPath, 'utf8'), ruleFile(['a', 'b', 'c', 'd']));

    const status: Body = await (await fetch(`${s.base}/api/rules/file/status`)).json();
    assert.equal(status.hasPrevious, true);
    assert.equal(status.lastWrite.outcome, 'applied');
  });

  it('a stale base is 409; an invalid file is 422 with the validator’s errors; JSON content type is 415', async () => {
    const s = await serve();
    const stale = await fetch(`${s.base}/api/rules/upload`, { method: 'POST', headers: { ...GOOD, 'content-type': 'text/plain', 'x-rules-base-hash': 'deadbeef' }, body: ruleFile(['a']) });
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as Body).reason, 'stale-base');

    const invalid = await fetch(`${s.base}/api/rules/upload`, { method: 'POST', headers: { ...GOOD, 'content-type': 'text/plain' }, body: '{"rules":[{"id":"x"}]}' });
    assert.equal(invalid.status, 422);
    assert.ok(((await invalid.json()) as Body).errors.length > 0);

    const asJson = await fetch(`${s.base}/api/rules/upload`, { method: 'POST', headers: { ...GOOD, 'content-type': 'application/json' }, body: ruleFile(['a']) });
    assert.equal(asJson.status, 415);
  });

  it('an oversized upload is a JSON 413, not an HTML error page — and nothing changes', async () => {
    const s = await serve();
    const before = readFileSync(s.rulesPath, 'utf8');
    const r = await fetch(`${s.base}/api/rules/upload`, { method: 'POST', headers: { ...GOOD, 'content-type': 'text/plain' }, body: ' '.repeat(256 * 1024 + 10) });
    assert.equal(r.status, 413);
    assert.equal(((await r.json()) as Body).reason, 'too-large');
    assert.equal(readFileSync(s.rulesPath, 'utf8'), before);
  });

  it('the valid-but-empty upload needs REPLACE over HTTP too', async () => {
    const s = await serve();
    const hash = (await fetch(`${s.base}/api/rules/file`)).headers.get('x-rules-hash')!;
    const staged: Body = await (await fetch(`${s.base}/api/rules/upload`, { method: 'POST', headers: { ...GOOD, 'content-type': 'text/plain', 'x-rules-base-hash': hash }, body: ruleFile([]) })).json();
    assert.equal(staged.typedConfirmationRequired, true);
    const no = await fetch(`${s.base}/api/rules/confirm`, { method: 'POST', headers: { ...GOOD, 'content-type': 'application/json' }, body: JSON.stringify({ token: staged.token }) });
    assert.equal(no.status, 400);
    const yes = await fetch(`${s.base}/api/rules/confirm`, { method: 'POST', headers: { ...GOOD, 'content-type': 'application/json' }, body: JSON.stringify({ token: staged.token, typed: 'REPLACE' }) });
    assert.equal(yes.status, 200);
  });

  it('undo with nothing to undo is a 409 that says so', async () => {
    const s = await serve();
    const r = await fetch(`${s.base}/api/rules/undo`, { method: 'POST', headers: GOOD });
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as Body).error, 'Nothing to undo yet.');
  });
});

describe('credentials over HTTP (FR-69, FR-70; P-53)', () => {
  it('a save returns the VIEW — the secret and refresh token appear in no response', async () => {
    const s = await serve();
    const r = await fetch(`${s.base}/api/settings/spotify`, {
      method: 'POST',
      headers: { ...GOOD, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'abcdefghijklmnopqrstuvwxyz012345', clientSecret: SECRET, redirectUri: 'http://127.0.0.1:8888/callback', refreshToken: REFRESH }),
    });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!text.includes(SECRET.slice(0, 8)) && !text.includes(REFRESH.slice(0, 8)), text);
    assert.equal(JSON.parse(text).clientIdMasked, 'abcd…2345');

    const view = await (await fetch(`${s.base}/api/settings/credentials`)).text();
    assert.ok(!view.includes(SECRET.slice(0, 8)) && !view.includes(REFRESH.slice(0, 8)), view);
    assert.equal(JSON.parse(readFileSync(s.spotifyPath, 'utf8')).clientSecret, SECRET, 'positive control: it WAS written');
  });

  it('an invalid save is 400 naming FIELDS, never echoing a value', async () => {
    const s = await serve();
    const r = await fetch(`${s.base}/api/settings/spotify`, {
      method: 'POST',
      headers: { ...GOOD, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'x', clientSecret: SECRET, redirectUri: 'nope', refreshToken: REFRESH }),
    });
    assert.equal(r.status, 400);
    const text = await r.text();
    assert.deepEqual(JSON.parse(text).fields, ['redirectUri']);
    assert.ok(!text.includes(SECRET.slice(0, 8)) && !text.includes(REFRESH.slice(0, 8)));
  });

  it('the MusicBrainz contact saves and returns the masked view', async () => {
    const s = await serve();
    const r = await fetch(`${s.base}/api/settings/musicbrainz`, { method: 'POST', headers: { ...GOOD, 'content-type': 'application/json' }, body: JSON.stringify({ contact: 'listener@example.org' }) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { set: true, masked: 'l…r@example.org', restartNeeded: false });
  });
});

/**
 * U8 (LC-57, frontend-components §1/§3): the version rides on the Settings payload -- no new route -- and is
 * never blank. ⚠️ Including on the 503: Settings shows the version even when credential settings are unavailable.
 */
describe('app version on the Settings payload (LC-57)', () => {
  it('200 carries the injected version', async () => {
    const s = await serve({ appVersion: '0.8.0' });
    const body = (await (await fetch(`${s.base}/api/settings/credentials`)).json()) as { appVersion: string };
    assert.equal(body.appVersion, '0.8.0');
  });

  it('a pre-release is passed through whole', async () => {
    const s = await serve({ appVersion: '1.0.0-beta.1' });
    const body = (await (await fetch(`${s.base}/api/settings/credentials`)).json()) as { appVersion: string };
    assert.equal(body.appVersion, '1.0.0-beta.1');
  });

  it('absent reads as `unknown`, never blank and never 0.1.0', async () => {
    const s = await serve({ appVersion: undefined });
    const body = (await (await fetch(`${s.base}/api/settings/credentials`)).json()) as { appVersion: string };
    assert.equal(body.appVersion, 'unknown');
  });

  it('the 503 (credentials unavailable) still carries it', async () => {
    const s = await serve({ credentials: null, appVersion: '0.8.0' });
    const r = await fetch(`${s.base}/api/settings/credentials`);
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { appVersion: string }).appVersion, '0.8.0');
  });
});
