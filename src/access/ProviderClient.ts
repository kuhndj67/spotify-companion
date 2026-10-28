/**
 * U11 (LC-86, BR-88.6, BR-89, BR-90, P-90, P-92): the sign-in provider, seen through `openid-client`. 🔌 IMPURE
 *
 * ⚠️ **The ONLY importer of `openid-client`** (a structural test pins it, P-90). The library does discovery, the
 * authorization URL (PKCE S256, `state`, `nonce`), code redemption and the ID token's checks: signature with the
 * published key whose `kid` matches (only with `enableNonRepudiationChecks`, below), `RS256` only, `iss`,
 * `aud`/`azp`, `nonce`, `exp` with 60 s tolerance. This module adds what is ours: `iat` not in the future (BR-90.4),
 * the discovery document must offer `code`, `S256` and `RS256` (BR-88.6), and every
 * outcome is a {@link SignInOutcome} value, never an exception that reaches a route (P-92). The allowed-account check
 * (BR-90.5) is the routes', after this.
 *
 * ⚠️ **Never log a library error whole** (P-97): it may carry the provider's response. Only its `name` and `code`
 * leave here, and `code` is one of the library's own constants.
 *
 * Swappable (P-90): the tests drive this through HTTP against a fake provider, not through the library's API, so
 * replacing the library changes this module and no test.
 */

import * as oidc from 'openid-client';
import type { PendingSignIn } from './pendingSignIns.js';

/** Why a sign-in did not complete: the problem page's reasons (frontend-components §2). */
export type SignInRefusal =
  | 'expired'
  | 'state'
  | 'provider-error'
  | 'provider-unreachable'
  | 'provider-mismatch'
  | 'verification'
  | 'wrong-account';

export type SignInOutcome =
  | { readonly ok: true; readonly subject: string }
  | {
      readonly ok: false;
      readonly reason: SignInRefusal;
      /** For the log only: an error name and a library code, never a message or a response body. */
      readonly detail?: string;
      /** `provider-error` only: the provider's `error` value, shown on the page (a token-safe identifier). */
      readonly providerError?: string;
    };

export interface ProviderSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** Tests pass one that trusts their per-run CA. Absent → `fetch`, which trusts `NODE_EXTRA_CA_CERTS`. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** BR-88.6: discovery is retried at most this often after a failure. */
  readonly retryIntervalMs?: number;
}

export interface ProviderStatus {
  /** When discovery (and with it the key-set address) last succeeded, as epoch ms. */
  readonly discoveredAt: number | null;
  /** The last discovery failure, as a reason and a log detail. */
  readonly lastFailure: { readonly reason: 'provider-unreachable' | 'provider-mismatch'; readonly detail: string; readonly at: number } | null;
}

const REQUEST_TIMEOUT_MS = 10_000;
const CLOCK_TOLERANCE_S = 60;

export class ProviderClient {
  private configuration: oidc.Configuration | null = null;
  private discovering: Promise<oidc.Configuration | SignInOutcome> | null = null;
  private lastFailure: ProviderStatus['lastFailure'] = null;
  private discoveredAt: number | null = null;
  private readonly now: () => number;
  private readonly retryIntervalMs: number;

  constructor(private readonly settings: ProviderSettings) {
    this.now = settings.now ?? Date.now;
    this.retryIntervalMs = settings.retryIntervalMs ?? 60_000;
  }

  status(): ProviderStatus {
    return { discoveredAt: this.discoveredAt, lastFailure: this.lastFailure };
  }

  /** Discovery, once; after a failure, again only when {@link retryIntervalMs} has passed (BR-88.6). */
  async discover(): Promise<{ readonly ok: true } | Extract<SignInOutcome, { ok: false }>> {
    const result = await this.configurationOrFailure();
    return result instanceof oidc.Configuration ? { ok: true } : (result as Extract<SignInOutcome, { ok: false }>);
  }

  /**
   * The start of a sign-in (BR-89.1): fresh `state`, `nonce` and PKCE verifier, and the provider's address to send
   * the browser to. The caller keeps the {@link PendingSignIn}.
   */
  async begin(returnPath: string): Promise<
    | { readonly ok: true; readonly url: string; readonly pending: PendingSignIn }
    | Extract<SignInOutcome, { ok: false }>
  > {
    const config = await this.configurationOrFailure();
    if (!(config instanceof oidc.Configuration)) return config as Extract<SignInOutcome, { ok: false }>;
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const pending: PendingSignIn = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier,
      returnPath,
      createdAt: this.now(),
    };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.settings.redirectUri,
      scope: 'openid',
      response_type: 'code',
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state: pending.state,
      nonce: pending.nonce,
    });
    return { ok: true, url: url.href, pending };
  }

  /**
   * The callback (BR-89.4, BR-90): redeem the code and verify the ID token. `callbackUrl` is the full URL the
   * browser arrived at, on the public origin. The ID and access tokens are dropped here (BR-90.7): only the subject
   * leaves.
   */
  async complete(callbackUrl: URL, pending: PendingSignIn): Promise<SignInOutcome> {
    const config = await this.configurationOrFailure();
    if (!(config instanceof oidc.Configuration)) return config as SignInOutcome;

    const providerError = callbackUrl.searchParams.get('error');
    if (providerError !== null) {
      return { ok: false, reason: 'provider-error', providerError: safeIdentifier(providerError), detail: 'authorization response error' };
    }

    try {
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      const subject = claims?.sub;
      if (typeof subject !== 'string' || subject === '') return { ok: false, reason: 'verification', detail: 'no subject' };
      // BR-90.4: `iat` < now + skew. The library checks `exp` but not an `iat` in the future (found by the fake
      // provider's switch, 2026-10-24).
      if (typeof claims?.iat !== 'number' || claims.iat > this.now() / 1000 + CLOCK_TOLERANCE_S) {
        return { ok: false, reason: 'verification', detail: 'iat in the future' };
      }
      return { ok: true, subject };
    } catch (error) {
      return { ok: false, reason: isUnreachable(error) ? 'provider-unreachable' : 'verification', detail: describe(error) };
    }
  }

  private async configurationOrFailure(): Promise<oidc.Configuration | Extract<SignInOutcome, { ok: false }>> {
    if (this.configuration !== null) return this.configuration;
    if (this.lastFailure !== null && this.now() - this.lastFailure.at < this.retryIntervalMs) {
      return { ok: false, reason: this.lastFailure.reason, detail: this.lastFailure.detail };
    }
    // One discovery at a time: concurrent sign-ins share it.
    this.discovering ??= this.runDiscovery().finally(() => (this.discovering = null));
    const result = await this.discovering;
    return result as oidc.Configuration | Extract<SignInOutcome, { ok: false }>;
  }

  private async runDiscovery(): Promise<oidc.Configuration | SignInOutcome> {
    const outerFetch = this.settings.fetch ?? fetch;
    const timedFetch: oidc.CustomFetch = (url, options) =>
      outerFetch(url, { ...(options as RequestInit), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    try {
      const config = await oidc.discovery(
        new URL(this.settings.issuer),
        this.settings.clientId,
        {
          id_token_signed_response_alg: 'RS256',
          [oidc.clockTolerance]: CLOCK_TOLERANCE_S,
        },
        oidc.ClientSecretBasic(this.settings.clientSecret),
        {
          [oidc.customFetch]: timedFetch,
          // ⚠️ BR-90.1: verify the ID token's SIGNATURE. Without this the library skips it for a token from the token
          // endpoint (OIDC Core allows trusting TLS instead), and a tampered signature or an unpublished key was
          // ADMITTED: found by the fake provider's switches, 2026-10-24.
          execute: [oidc.enableNonRepudiationChecks],
        },
      );
      const missing = missingCapabilities(config.serverMetadata());
      if (missing.length > 0) return this.fail('provider-mismatch', `does not offer ${missing.join(', ')}`);
      this.configuration = config;
      this.discoveredAt = this.now();
      this.lastFailure = null;
      return config;
    } catch (error) {
      return this.fail(isUnreachable(error) ? 'provider-unreachable' : 'provider-mismatch', describe(error));
    }
  }

  private fail(reason: 'provider-unreachable' | 'provider-mismatch', detail: string): SignInOutcome {
    this.lastFailure = { reason, detail, at: this.now() };
    return { ok: false, reason, detail };
  }
}

/** BR-88.6: `code`, `S256` and `RS256` must be on offer. An absent list is not an offer. */
function missingCapabilities(meta: oidc.ServerMetadata): string[] {
  const missing: string[] = [];
  if (!(meta.response_types_supported ?? []).includes('code')) missing.push('response type "code"');
  if (!(meta.code_challenge_methods_supported ?? []).includes('S256')) missing.push('PKCE S256');
  if (!(meta.id_token_signing_alg_values_supported ?? []).includes('RS256')) missing.push('RS256 ID tokens');
  return missing;
}

/** A network failure (refused, timed out, TLS) rather than an answer that failed a check. */
function isUnreachable(error: unknown): boolean {
  const e = error as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return true;
  if (e?.code === 'OAUTH_RESPONSE_IS_NOT_CONFORM' || e?.code === 'OAUTH_INVALID_RESPONSE') return false;
  const causeName = e?.cause?.name;
  return e instanceof TypeError || causeName === 'TimeoutError' || causeName === 'AbortError' || /^(ECONN|ENOTFOUND|EAI_|CERT_|UNABLE_TO|SELF_SIGNED|DEPTH_ZERO|ERR_TLS)/.test(e?.cause?.code ?? '');
}

/** Error name and library code only: never `message`, which can quote a response (P-97). */
function describe(error: unknown): string {
  const e = error as { name?: string; code?: string; cause?: { code?: string } };
  const parts = [e?.name ?? 'Error', e?.code, e?.cause?.code].filter((p): p is string => typeof p === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(p));
  return parts.join(':');
}

/** The provider's `error` value, if it is the identifier RFC 6749 says it is; anything else is not repeated. */
function safeIdentifier(raw: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(raw) ? raw : 'unspecified';
}
