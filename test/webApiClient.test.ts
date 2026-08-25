/**
 * Tests for the Spotify Web API client's token and error handling.
 *
 * These are example-based (PBT-10): this module is I/O orchestration, not a pure
 * transformation, so its properties are about *sequences* of calls rather than invariants
 * over generated inputs. `fetch` is stubbed so no network or real credentials are involved.
 */

import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'spotify-test-'));
const configPath = join(scratch, 'spotify-config.json');

writeFileSync(
  configPath,
  JSON.stringify({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
  }),
);

// config.ts reads the environment at import time, so this must be set before importing it.
process.env.SPOTIFY_CONFIG_PATH = configPath;

const { SpotifyWebApiClient, SpotifyApiError } = await import('../src/spotify/webApiClient.js');

interface StubCall {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: StubCall[] = [];

function stubFetch(responder: (call: StubCall, index: number) => Response) {
  calls = [];
  // Derive the parameter types from fetch itself — the DOM lib's RequestInfo is not in
  // scope under @types/node.
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as typeof fetch;
}

function tokenResponse(token = 'access-1', expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const isTokenCall = (call: StubCall) => call.url.includes('accounts.spotify.com');

afterEach(() => {
  globalThis.fetch = realFetch;
});

after(() => rmSync(scratch, { recursive: true, force: true }));

describe('SpotifyWebApiClient', () => {
  it('exchanges the refresh token for an access token', async () => {
    stubFetch(() => tokenResponse('access-1'));
    const client = new SpotifyWebApiClient();

    assert.equal(await client.getAccessToken(), 'access-1');

    const body = String(calls[0]?.init?.body);
    assert.match(body, /grant_type=refresh_token/);
    assert.match(body, /refresh_token=test-refresh-token/);
    // Credentials go in the Basic auth header, never the body.
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.match(headers.Authorization ?? '', /^Basic /);
  });

  it('caches the access token instead of refreshing on every call', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenResponse() : jsonResponse({ ok: true })));
    const client = new SpotifyWebApiClient();

    await client.get('/me');
    await client.get('/me');
    await client.get('/me');

    assert.equal(calls.filter(isTokenCall).length, 1, 'should refresh exactly once');
  });

  it('shares a single refresh between concurrent callers', async () => {
    stubFetch(() => tokenResponse());
    const client = new SpotifyWebApiClient();

    await Promise.all([client.getAccessToken(), client.getAccessToken(), client.getAccessToken()]);

    assert.equal(calls.filter(isTokenCall).length, 1, 'concurrent callers must not each refresh');
  });

  it('refreshes once and retries after a 401', async () => {
    let apiCalls = 0;
    stubFetch((call) => {
      if (isTokenCall(call)) return tokenResponse(`access-${calls.filter(isTokenCall).length}`);
      apiCalls++;
      return apiCalls === 1 ? jsonResponse({}, 401) : jsonResponse({ recovered: true });
    });

    const client = new SpotifyWebApiClient();
    const result = await client.get<{ recovered: boolean }>('/me');

    assert.deepEqual(result, { recovered: true });
    assert.equal(calls.filter(isTokenCall).length, 2, 'should have refreshed after the 401');
    assert.equal(apiCalls, 2, 'should have retried the request exactly once');
  });

  it('does not retry a second 401 indefinitely', async () => {
    let apiCalls = 0;
    stubFetch((call) => {
      if (isTokenCall(call)) return tokenResponse();
      apiCalls++;
      return jsonResponse({}, 401);
    });

    const client = new SpotifyWebApiClient();
    await assert.rejects(() => client.get('/me'), SpotifyApiError);
    assert.equal(apiCalls, 2, 'should stop after one retry');
  });

  it('returns null for 204 and 404 rather than throwing', async () => {
    stubFetch((call) =>
      isTokenCall(call) ? tokenResponse() : new Response(null, { status: 404 }),
    );
    const client = new SpotifyWebApiClient();
    assert.equal(await client.get('/tracks/missing'), null);
  });

  it('surfaces a scope hint on 403', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenResponse() : jsonResponse({}, 403)));
    const client = new SpotifyWebApiClient();

    await assert.rejects(
      () => client.get('/me/following/contains'),
      (error: Error) => {
        assert.match(error.message, /scope/i, 'should hint at a missing scope');
        assert.equal((error as InstanceType<typeof SpotifyApiError>).status, 403);
        return true;
      },
    );
  });

  it('reports the retry-after value on 429', async () => {
    stubFetch((call) =>
      isTokenCall(call)
        ? tokenResponse()
        : new Response('{}', { status: 429, headers: { 'retry-after': '30' } }),
    );
    const client = new SpotifyWebApiClient();

    await assert.rejects(
      () => client.get('/me'),
      (error: Error) => {
        assert.match(error.message, /30/);
        assert.match(error.message, /rate limit/i);
        return true;
      },
    );
  });

  it('tells the user to re-authenticate when the refresh token is dead', async () => {
    stubFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));
    const client = new SpotifyWebApiClient();

    await assert.rejects(
      () => client.getAccessToken(),
      (error: Error) => {
        assert.match(error.message, /npm run auth/);
        return true;
      },
    );
  });

  it('appends query parameters to the request URL', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenResponse() : jsonResponse([true])));
    const client = new SpotifyWebApiClient();

    await client.get('/me/following', { type: 'artist', limit: '50' });

    const apiCall = calls.find((call) => !isTokenCall(call));
    assert.match(apiCall!.url, /type=artist/);
    assert.match(apiCall!.url, /limit=50/);
  });

  it('sends the access token as a bearer credential', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenResponse('tok-abc') : jsonResponse({})));
    const client = new SpotifyWebApiClient();

    await client.get('/me');

    const apiCall = calls.find((call) => !isTokenCall(call));
    const headers = apiCall!.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer tok-abc');
  });
});

describe('SpotifyWebApiClient — credential file problems', () => {
  const validConfig = JSON.stringify({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
  });

  /**
   * Swaps the credential file's contents for the duration of one test. The config module
   * resolves its path once at import, so the file is manipulated rather than the env var.
   * fetch stays stubbed throughout — a credentials test must never reach the network.
   */
  async function withConfigContents(contents: string | null, assertion: () => Promise<void>) {
    stubFetch(() => tokenResponse());
    if (contents === null) rmSync(configPath, { force: true });
    else writeFileSync(configPath, contents);

    try {
      await assertion();
    } finally {
      writeFileSync(configPath, validConfig);
    }
  }

  it('names the auth command when the config file is absent', async () => {
    await withConfigContents(null, async () => {
      const client = new SpotifyWebApiClient();
      await assert.rejects(() => client.getAccessToken(), /npm run auth/);
      assert.equal(calls.length, 0, 'must not attempt a network call without credentials');
    });
  });

  it('names the missing fields when the config is incomplete', async () => {
    await withConfigContents(JSON.stringify({ clientId: 'only-this' }), async () => {
      const client = new SpotifyWebApiClient();
      await assert.rejects(
        () => client.getAccessToken(),
        (error: Error) => {
          assert.match(error.message, /clientSecret/);
          assert.match(error.message, /refreshToken/);
          return true;
        },
      );
    });
  });
});
