/**
 * U11 (LC-95, P-94): a fake OIDC provider that can misbehave on purpose.
 *
 * HTTPS on a random local port, with a CA made for this run (`testCa.ts`). It serves discovery, a key set (one RSA
 * key, and a second it can switch to), an authorization endpoint that redirects straight back (no sign-in page), and
 * a token endpoint that checks client authentication, PKCE and single use of each code.
 *
 * Each switch in {@link Misbehaviour} breaks exactly one thing, so each refusal in BR-89 and BR-90 is one switch and
 * one test. The app's REAL routes and admission run against it; the provider client is driven through HTTP, never
 * through the library's API (P-90).
 *
 * ID tokens are signed here with `node:crypto` (RS256 is RSA-SHA256, PKCS #1 v1.5), not with a JOSE library, so a
 * fault in the library under test cannot also be a fault in the fake.
 */

import { createHash, createHmac, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { createServer, request as httpsRequest, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { makeTestCertificates, type TestCertificates } from './testCa.js';

export interface Misbehaviour {
  wrongIss?: boolean;
  wrongAud?: boolean;
  /** `aud` an array of the client and another, with no `azp`. */
  audArrayWithoutAzp?: boolean;
  /** `aud` an array of the client and another, with `azp` the client: ACCEPTED (BR-90.3). */
  audArrayWithAzp?: boolean;
  expired?: boolean;
  futureIat?: boolean;
  algNone?: boolean;
  /** HS256, keyed with the public key's PEM: the classic algorithm confusion. */
  hs256WithPublicKey?: boolean;
  /** Signed by a key whose `kid` the key set never publishes. */
  unknownKid?: boolean;
  /** Signed by the second key, which the key set publishes only after {@link FakeOidcProvider.rotate}. */
  signWithSecondKey?: boolean;
  tamperedSignature?: boolean;
  wrongNonce?: boolean;
  /** The authorization endpoint answers `error=access_denied` instead of a code. */
  errorCallback?: boolean;
  /** Discovery's `issuer` differs from the address it was fetched from. */
  discoveryIssuerMismatch?: boolean;
  /** Discovery does not offer PKCE S256. */
  noS256?: boolean;
  /** The token endpoint answers 500. */
  tokenEndpointFails?: boolean;
}

export interface FakeOidcProvider {
  readonly issuer: string;
  readonly caPem: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Who signs in at the authorization endpoint. */
  subject: string;
  misbehave: Misbehaviour;
  /** Publish the second key as well (key rotation). */
  rotate(): void;
  /** A `fetch` that trusts this run's CA, for the provider client. */
  readonly fetch: typeof fetch;
  /** Every request the provider received, as `METHOD path`. */
  readonly requests: string[];
  /** Each ID token issued, so a secrets test can search output for them. */
  readonly issuedIdTokens: string[];
  readonly issuedAccessTokens: string[];
  readonly issuedCodes: string[];
  close(): Promise<void>;
}

interface IssuedCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly nonce: string | undefined;
  used: boolean;
}

let shared: TestCertificates | undefined;
/** One CA per test process: generating RSA keys is the slow part. */
export function testCertificates(): TestCertificates {
  return (shared ??= makeTestCertificates());
}

export async function startFakeOidcProvider(options: { clientId?: string; clientSecret?: string; subject?: string } = {}): Promise<FakeOidcProvider> {
  const certs = testCertificates();
  const clientId = options.clientId ?? 'companion-test-client';
  const clientSecret = options.clientSecret ?? 'fake-client-secret-0123456789';
  const keys = [rsaKey('key-1'), rsaKey('key-2')];
  const strayKey = rsaKey('key-never-published');
  const codes = new Map<string, IssuedCode>();
  let rotated = false;
  let counter = 0;

  const state = {
    subject: options.subject ?? 'owner',
    misbehave: {} as Misbehaviour,
  };
  const requests: string[] = [];
  const issuedIdTokens: string[] = [];
  const issuedAccessTokens: string[] = [];
  const issuedCodes: string[] = [];

  let issuer = '';
  const server: Server = createServer({ key: certs.keyPem, cert: certs.certPem }, (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    requests.push(`${req.method} ${url.pathname}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/sso/.well-known/openid-configuration') {
      json(200, {
        issuer: state.misbehave.discoveryIssuerMismatch ? `${issuer}-other` : issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: state.misbehave.noS256 ? ['plain'] : ['S256', 'plain'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        scopes_supported: ['openid'],
      });
      return;
    }
    if (url.pathname === '/sso/jwks') {
      json(200, { keys: (rotated ? keys : keys.slice(0, 1)).map((k) => k.jwk) });
      return;
    }
    if (url.pathname === '/sso/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const back = new URL(redirectUri);
      const st = url.searchParams.get('state');
      if (st !== null) back.searchParams.set('state', st);
      if (url.searchParams.get('client_id') !== clientId || url.searchParams.get('code_challenge_method') !== 'S256') {
        back.searchParams.set('error', 'invalid_request');
      } else if (state.misbehave.errorCallback) {
        back.searchParams.set('error', 'access_denied');
      } else {
        const code = `code-${++counter}-${Math.random().toString(36).slice(2)}`;
        codes.set(code, {
          clientId,
          redirectUri,
          codeChallenge: url.searchParams.get('code_challenge') ?? '',
          nonce: url.searchParams.get('nonce') ?? undefined,
          used: false,
        });
        issuedCodes.push(code);
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.href });
      res.end();
      return;
    }
    if (url.pathname === '/sso/token' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (state.misbehave.tokenEndpointFails) return json(500, { error: 'server_error' });
        const form = new URLSearchParams(body);
        // RFC 6749 §2.3.1: each part form-urlencoded, then joined by ':' and base64-encoded. openid-client encodes
        // even '-' (as %2D), so compare after decoding, as a real provider must.
        const basic = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization ?? '')?.[1];
        const decoded = basic === undefined ? '' : Buffer.from(basic, 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        const formDecode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
        if (colon === -1 || formDecode(decoded.slice(0, colon)) !== clientId || formDecode(decoded.slice(colon + 1)) !== clientSecret) {
          return json(401, { error: 'invalid_client' });
        }
        const code = form.get('code') ?? '';
        const issued = codes.get(code);
        if (issued === undefined || issued.used) return json(400, { error: 'invalid_grant' });
        issued.used = true;
        if (form.get('redirect_uri') !== issued.redirectUri) return json(400, { error: 'invalid_grant' });
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (challenge !== issued.codeChallenge) return json(400, { error: 'invalid_grant' });
        const idToken = makeIdToken(issued);
        const accessToken = `access-${counter}-${Math.random().toString(36).slice(2)}`;
        issuedIdTokens.push(idToken);
        issuedAccessTokens.push(accessToken);
        json(200, { access_token: accessToken, token_type: 'Bearer', expires_in: 180, id_token: idToken });
      });
      return;
    }
    json(404, { error: 'unknown endpoint' });
  });

  function makeIdToken(issued: IssuedCode): string {
    const m = state.misbehave;
    const now = Math.floor(Date.now() / 1000);
    const key = m.unknownKid ? strayKey : m.signWithSecondKey ? keys[1]! : keys[0]!;
    const claims: Record<string, unknown> = {
      iss: m.wrongIss ? 'https://evil.example/sso' : issuer,
      sub: state.subject,
      aud: m.wrongAud ? 'someone-else' : m.audArrayWithoutAzp || m.audArrayWithAzp ? [clientId, 'another-client'] : clientId,
      iat: m.futureIat ? now + 600 : m.expired ? now - 600 : now,
      exp: m.expired ? now - 300 : now + 180,
      nonce: m.wrongNonce ? 'not-the-nonce' : issued.nonce,
    };
    if (m.audArrayWithAzp) claims.azp = clientId;
    if (m.algNone) return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
    if (m.hs256WithPublicKey) {
      const input = `${b64({ alg: 'HS256', typ: 'JWT', kid: key.kid })}.${b64(claims)}`;
      return `${input}.${createHmac('sha256', key.publicPem).update(input).digest('base64url')}`;
    }
    const input = `${b64({ alg: 'RS256', typ: 'JWT', kid: key.kid })}.${b64(claims)}`;
    let signature = cryptoSign('sha256', Buffer.from(input), key.privateKey).toString('base64url');
    if (m.tamperedSignature) signature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    return `${input}.${signature}`;
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `https://localhost:${(server.address() as AddressInfo).port}/sso`;

  return {
    issuer,
    caPem: certs.caPem,
    clientId,
    clientSecret,
    get subject() {
      return state.subject;
    },
    set subject(v: string) {
      state.subject = v;
    },
    get misbehave() {
      return state.misbehave;
    },
    set misbehave(v: Misbehaviour) {
      state.misbehave = v;
    },
    rotate: () => {
      rotated = true;
    },
    fetch: fetchTrusting(certs.caPem),
    requests,
    issuedIdTokens,
    issuedAccessTokens,
    issuedCodes,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

function rsaKey(kid: string): { kid: string; privateKey: KeyObject; publicPem: string; jwk: Record<string, unknown> } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * A minimal `fetch` over `node:https` that trusts `caPem`: Node's built-in `fetch` reads extra CAs only at process
 * start (`NODE_EXTRA_CA_CERTS`), and a test cannot set that for itself.
 */
export function fetchTrusting(caPem: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    let body: Buffer | undefined;
    if (init?.body !== undefined && init.body !== null) {
      body =
        typeof init.body === 'string' || init.body instanceof URLSearchParams
          ? Buffer.from(init.body.toString())
          : Buffer.from(await new Response(init.body).arrayBuffer());
      if (init.body instanceof URLSearchParams && !headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
    }
    return new Promise<Response>((resolve, reject) => {
      const req = httpsRequest(url, { method: init?.method ?? 'GET', headers: Object.fromEntries(headers), ca: caPem, signal: init?.signal ?? undefined }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') h.set(k, v);
          const status = res.statusCode ?? 0;
          resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers: h }));
        });
      });
      req.on('error', (e) => reject(new TypeError('fetch failed', { cause: e })));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }) as typeof fetch;
}
