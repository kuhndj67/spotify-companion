/**
 * U11 (P-97, BR-95.3) — secrets never reach an output.
 *
 * A full sign-in, the session read, a sign-out and a failed sign-in, through the real routes against the fake
 * provider. Then every log line, every console line and every response BODY is searched for each secret: the
 * authorization codes, the ID and access tokens, the session cookie value, the PKCE verifier, `state`, `nonce`, the
 * client secret and the session key.
 *
 * Headers are not searched: `Set-Cookie` carries the cookie by design, and `Location` carries `state` to the provider
 * by design (BR-89.1). What must never carry them is a log line or a page.
 *
 * ⚠️ Positive control: the scanner is seen to find a planted secret, in a log line and in a body.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PendingSignIns, type PendingSignIn } from '../src/access/pendingSignIns.js';
import { INGEST_HEADER } from '../src/ingest/types.js';
import { SESSION_COOKIE } from '../src/localGuard.js';
import { startFakeOidcProvider, type FakeOidcProvider } from './support/fakeOidcProvider.js';
import { Browser, startApp, type Harness } from './support/signInHarness.js';

/** Every secret that appears in `haystack`, by name. */
function leaks(haystack: string, secrets: ReadonlyMap<string, string>): string[] {
  return [...secrets].filter(([, value]) => value.length >= 8 && haystack.includes(value)).map(([name]) => name);
}

/** A store that remembers what it was given, so the test knows the verifier, state and nonce it must look for. */
class RecordingPending extends PendingSignIns {
  readonly seen: PendingSignIn[] = [];
  override add(entry: PendingSignIn, now: number): void {
    this.seen.push(entry);
    super.add(entry, now);
  }
}

let provider: FakeOidcProvider;
let app: Harness;
const pending = new RecordingPending();
const consoleLines: string[] = [];
const original = { log: console.log, error: console.error, warn: console.warn };

before(async () => {
  for (const level of ['log', 'error', 'warn'] as const) {
    console[level] = (...args: unknown[]) => {
      consoleLines.push(args.map(String).join(' '));
      original[level](...args);
    };
  }
  provider = await startFakeOidcProvider();
  app = await startApp(provider, { pending });
});
after(async () => {
  Object.assign(console, original);
  await app.close();
  await provider.close();
});

describe('secrets never reach a log line or a page (P-97)', () => {
  it('⭐ the scanner finds a planted secret (positive control)', () => {
    const secrets = new Map([['client secret', 'fake-client-secret-0123456789']]);
    assert.deepEqual(leaks('[access] oops fake-client-secret-0123456789', secrets), ['client secret']);
    assert.deepEqual(leaks('<p>nothing here</p>', secrets), []);
  });

  it('a sign-in, a session read, a sign-out and a failed sign-in leak nothing', async () => {
    const browser = new Browser(app);
    assert.equal((await browser.signIn(provider)).status, 302);
    const cookie = browser.jar.get(SESSION_COOKIE)!;
    assert.equal((await browser.get('/auth/session')).status, 200);
    assert.equal((await browser.get('/auth/sign-out', { origin: 'https://app.test:3443', [INGEST_HEADER]: '1' }, 'POST')).status, 200);

    provider.subject = 'someone-else';
    const refused = new Browser(app);
    assert.equal((await refused.signIn(provider)).status, 403);
    provider.subject = 'owner';
    provider.misbehave = { tamperedSignature: true };
    const failed = new Browser(app);
    assert.equal((await failed.signIn(provider)).status, 400);
    provider.misbehave = {};

    const secrets = new Map<string, string>([
      ['client secret', provider.clientSecret],
      ['session key (hex)', app.keyNow().toString('hex')],
      ['session cookie', cookie],
      ...provider.issuedCodes.map((c, i) => [`code ${i}`, c] as [string, string]),
      ...provider.issuedIdTokens.map((t, i) => [`ID token ${i}`, t] as [string, string]),
      ...provider.issuedAccessTokens.map((t, i) => [`access token ${i}`, t] as [string, string]),
      ...pending.seen.flatMap((p, i) => [
        [`verifier ${i}`, p.codeVerifier],
        [`state ${i}`, p.state],
        [`nonce ${i}`, p.nonce],
      ] as [string, string][]),
    ]);
    assert.ok(provider.issuedIdTokens.length >= 3 && pending.seen.length >= 3, 'the flows above actually ran');

    const bodies = [...browser.replies, ...refused.replies, ...failed.replies].map((r) => r.body).join('\n');
    assert.deepEqual(leaks(app.logs.join('\n'), secrets), [], 'the app log');
    assert.deepEqual(leaks(consoleLines.join('\n'), secrets), [], 'the console');
    assert.deepEqual(leaks(bodies, secrets), [], 'the response bodies');
    // And the log does say what happened, with the subject where BR-95.3 allows it.
    assert.ok(app.logs.some((l) => l.includes('sign-in completed for "owner"')));
    assert.ok(app.logs.some((l) => l.includes('wrong-account') && l.includes('"someone-else"')));
    assert.ok(app.logs.some((l) => l.startsWith('[access] sign-in refused: verification')));
  });
});
