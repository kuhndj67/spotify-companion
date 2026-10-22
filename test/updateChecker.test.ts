/**
 * LC-80 — the update checker (U10, FR-81, BR-85, P-87). No test calls the real GitHub: `fetch` is injected and
 * every request it receives is recorded.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { RELEASES_URL, UpdateChecker, type FetchLike } from '../src/update/UpdateChecker.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function prefPath(): string {
  const d = mkdtempSync(join(tmpdir(), 'u10-update-'));
  dirs.push(d);
  return join(d, 'update-check.json');
}

const RELEASES = JSON.stringify([
  { tag_name: 'v1.0.0-beta.9', prerelease: true, draft: false, html_url: 'https://github.com/kuhndj67/spotify-companion/releases/tag/v1.0.0-beta.9' },
  { tag_name: 'v1.0.0-beta.8', prerelease: true, draft: false, html_url: 'https://github.com/kuhndj67/spotify-companion/releases/tag/v1.0.0-beta.8' },
]);

function fakeFetch(responses: Array<() => Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  };
  return { fn, calls };
}

describe('UpdateChecker', () => {
  it('reports a newer version with its release page, from the LIST endpoint', async () => {
    const f = fakeFetch([() => new Response(RELEASES, { status: 200 })]);
    const c = new UpdateChecker({ path: prefPath(), runningVersion: '1.0.0-beta.8', fetch: f.fn, log: () => {} });
    const r = await c.check();
    assert.equal(r.status, 'newer');
    assert.deepEqual(r.newest, { version: '1.0.0-beta.9', pageUrl: 'https://github.com/kuhndj67/spotify-companion/releases/tag/v1.0.0-beta.9' });
    assert.equal(f.calls[0]!.url, RELEASES_URL);
    assert.doesNotMatch(f.calls[0]!.url, /\/releases\/latest/, '⚠️ /latest is 404 while every release is a pre-release');
  });

  it('⭐ sends its own User-Agent and nothing that identifies the user (no contact address, no token, no cookie)', async () => {
    const f = fakeFetch([() => new Response('[]', { status: 200 })]);
    await new UpdateChecker({ path: prefPath(), runningVersion: '1.0.0-beta.8', fetch: f.fn, log: () => {} }).check();
    const headers = f.calls[0]!.headers;
    assert.deepEqual(Object.keys(headers).sort(), ['Accept', 'User-Agent']);
    assert.equal(headers['User-Agent'], 'spotify-companion/1.0.0-beta.8');
    assert.doesNotMatch(JSON.stringify(headers), /@|mailto|Authorization|Cookie/i);
  });

  it('off: no request at all, and the status says off', async () => {
    const path = prefPath();
    writeFileSync(path, JSON.stringify({ enabled: false, lastCheckedAt: null }));
    const f = fakeFetch([]);
    const c = new UpdateChecker({ path, runningVersion: '1.0.0-beta.8', fetch: f.fn, log: () => {} });
    c.start();
    await c.check();
    c.stop();
    assert.equal(f.calls.length, 0);
    assert.equal(c.result().status, 'off');
  });

  it('absent preference = on (opt-out, Q35 = B); the switch is saved', () => {
    const path = prefPath();
    const c = new UpdateChecker({ path, runningVersion: '1.0.0-beta.8', fetch: fakeFetch([]).fn, log: () => {} });
    assert.equal(c.enabled, true);
    c.setEnabled(false);
    c.stop();
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).enabled, false);
  });

  it('a failure keeps the last good answer and records when it failed; never throws', async () => {
    const f = fakeFetch([() => new Response(RELEASES, { status: 200 }), () => new Response('', { status: 503 }), () => { throw new Error('ENOTFOUND'); }]);
    const c = new UpdateChecker({ path: prefPath(), runningVersion: '1.0.0-beta.8', fetch: f.fn, log: () => {} });
    await c.check();
    const second = await c.check();
    assert.equal(second.status, 'newer', 'still newer after a failed check');
    assert.ok(second.lastFailureAt);
    const third = await c.check();
    assert.equal(third.status, 'newer');
  });

  it('redirects: followed within api.github.com, refused elsewhere', async () => {
    const ok = fakeFetch([
      () => new Response(null, { status: 301, headers: { location: 'https://api.github.com/repositories/1/releases?per_page=10' } }),
      () => new Response('[]', { status: 200 }),
    ]);
    const c1 = new UpdateChecker({ path: prefPath(), runningVersion: '1.0.0-beta.8', fetch: ok.fn, log: () => {} });
    assert.equal((await c1.check()).status, 'current');
    const evil = fakeFetch([() => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } })]);
    const c2 = new UpdateChecker({ path: prefPath(), runningVersion: '1.0.0-beta.8', fetch: evil.fn, log: () => {} });
    const r = await c2.check();
    assert.equal(r.status, 'not-yet');
    assert.ok(r.lastFailureAt);
    assert.equal(evil.calls.length, 1, 'the foreign location is never requested');
  });

  it('a response over 1 MB is refused', async () => {
    const f = fakeFetch([() => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 })]);
    const c = new UpdateChecker({ path: prefPath(), runningVersion: '1.0.0-beta.8', fetch: f.fn, log: () => {} });
    const r = await c.check();
    assert.equal(r.status, 'not-yet');
    assert.ok(r.lastFailureAt);
  });

  it('the one-hour rule: a restart soon after a check waits; otherwise about a minute', async () => {
    const path = prefPath();
    const now = Date.parse('2026-10-22T12:00:00Z');
    writeFileSync(path, JSON.stringify({ enabled: true, lastCheckedAt: new Date(now - 10 * 60_000).toISOString() }));
    const soon = new UpdateChecker({ path, runningVersion: '1.0.0-beta.8', fetch: fakeFetch([]).fn, now: () => new Date(now), log: () => {} });
    assert.equal(soon.firstDelayMs(), 50 * 60_000);
    const fresh = new UpdateChecker({ path: prefPath(), runningVersion: '1.0.0-beta.8', fetch: fakeFetch([]).fn, now: () => new Date(now), log: () => {} });
    assert.equal(fresh.firstDelayMs(), 60_000);
  });
});
