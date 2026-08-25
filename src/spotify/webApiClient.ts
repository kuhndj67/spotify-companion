/**
 * Direct Spotify Web API client (hybrid architecture, CQ1 option A).
 *
 * The MCP server exposes no get-track / get-artist / check-following tools, so enrichment
 * has to come from the Web API directly. Both consumers share one credential file.
 *
 * Token handling deliberately **never writes back** to spotify-config.json. The MCP server
 * refreshes and rewrites that file on its own schedule; if this process also wrote to it,
 * the two would race and could clobber each other's refresh token. Spotify's refresh tokens
 * are long-lived and reusable, so holding the access token in memory is sufficient and safe.
 */

import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class SpotifyApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = status;
  }
}

export class SpotifyWebApiClient {
  #credentials: StoredCredentials | null = null;
  #accessToken: string | null = null;
  #expiresAt = 0;
  #refreshing: Promise<string> | null = null;

  async #loadCredentials(): Promise<StoredCredentials> {
    if (this.#credentials) return this.#credentials;

    let raw: string;
    try {
      raw = await readFile(config.spotifyConfigPath, 'utf8');
    } catch {
      throw new Error(
        `No credentials at ${config.spotifyConfigPath}. Run \`npm run auth\` first.`,
      );
    }

    const parsed = JSON.parse(raw);
    if (!parsed.clientId || !parsed.clientSecret || !parsed.refreshToken) {
      throw new Error(
        `${config.spotifyConfigPath} is missing clientId, clientSecret or refreshToken. ` +
          'Run `npm run auth` to regenerate it.',
      );
    }

    this.#credentials = parsed;
    return parsed;
  }

  async #refreshAccessToken(): Promise<string> {
    const { clientId, clientSecret, refreshToken } = await this.#loadCredentials();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });

    const body = (await response.json()) as Record<string, string | number>;

    if (!response.ok) {
      // invalid_grant means the refresh token is genuinely dead — re-auth is the only fix.
      const hint =
        body.error === 'invalid_grant' ? ' Run `npm run auth` to re-authenticate.' : '';
      throw new SpotifyApiError(
        response.status,
        `Token refresh failed: ${body.error_description ?? body.error}.${hint}`,
      );
    }

    this.#accessToken = body.access_token as string;
    // Refresh a minute early so a request never races the expiry boundary.
    this.#expiresAt = Date.now() + (body.expires_in as number) * 1000 - 60_000;
    return this.#accessToken;
  }

  /** Returns a valid access token, refreshing if needed. Concurrent callers share one refresh. */
  async getAccessToken(): Promise<string> {
    if (this.#accessToken && Date.now() < this.#expiresAt) return this.#accessToken;

    this.#refreshing ??= this.#refreshAccessToken().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  /**
   * GETs a Web API path. `path` is relative to /v1, e.g. "/tracks/{id}".
   * Returns null for 204/404 so "no content" is not an error condition.
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T | null> {
    const url = new URL(`https://api.spotify.com/v1${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    const attempt = async (token: string) =>
      fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    let response = await attempt(await this.getAccessToken());

    // A 401 means the token died early (revoked, scope change). One forced refresh, one retry.
    if (response.status === 401) {
      this.#accessToken = null;
      response = await attempt(await this.getAccessToken());
    }

    if (response.status === 204 || response.status === 404) return null;

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') ?? 'unknown';
      throw new SpotifyApiError(429, `Rate limited by Spotify. Retry after ${retryAfter}s.`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const hint =
        response.status === 403
          ? ' This usually means a missing OAuth scope — re-run `npm run auth`.'
          : '';
      throw new SpotifyApiError(
        response.status,
        `GET ${path} failed (${response.status}).${hint} ${detail.slice(0, 300)}`,
      );
    }

    return (await response.json()) as T;
  }
}
