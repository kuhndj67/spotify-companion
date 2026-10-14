#!/usr/bin/env node
/**
 * One-command Spotify authentication, run on the host (Requirements Q6 → Option A).
 *
 * This implements the OAuth flow itself rather than delegating to the MCP server's
 * `npm run auth`, for two reasons:
 *
 *   1. Upstream does not request `user-follow-read`, so its tokens cannot answer
 *      "is this artist in my followed list" — a stated requirement. We request the union.
 *   2. It removes the need to clone and build the MCP server just to authenticate.
 *
 * The output file is byte-compatible with what the MCP server expects, so one credential
 * set serves both the MCP server and this app's direct Web API calls.
 */

import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = join(projectRoot, 'secrets');
const configPath = join(secretsDir, 'spotify-config.json');

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

/**
 * Upstream's 14 scopes, plus `user-follow-read`.
 * The upstream set is kept intact so the MCP server's own tools still work when playback
 * control is enabled later (Q4 = B). A least-privilege trim is possible once the final
 * tool surface is settled.
 */
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-playback-position',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
  'user-top-read',
  'user-follow-read', // added — required for GET /me/following/contains
].join(' ');

function openBrowser(url) {
  const commands = {
    win32: ['cmd', ['/c', 'start', '""', url]],
    darwin: ['open', [url]],
  };
  const [command, args] = commands[process.platform] ?? ['xdg-open', [url]];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Falls through to the printed URL below.
  }
}

async function promptCredentials() {
  if (existsSync(configPath)) {
    const existing = JSON.parse(readFileSync(configPath, 'utf8'));
    if (existing.clientId && existing.clientSecret) {
      console.log('✓ Using existing credentials from secrets/spotify-config.json');
      return existing;
    }
  }

  console.log('\nCreate an app at https://developer.spotify.com/dashboard');
  console.log(`Add exactly this redirect URI:  ${REDIRECT_URI}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const clientId = (await rl.question('Client ID: ')).trim();
  const clientSecret = (await rl.question('Client Secret: ')).trim();
  rl.close();

  if (!clientId || !clientSecret) throw new Error('Client ID and Client Secret are required.');
  return { clientId, clientSecret, redirectUri: REDIRECT_URI };
}

/** Runs the local callback listener and resolves with the authorisation code. */
function awaitCallback(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      const finish = (message) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><meta charset="utf-8">
          <body style="font:16px system-ui;padding:3rem;text-align:center">
          <h1>${message}</h1><p>You can close this tab and return to the terminal.</p>`);
        server.close();
      };

      if (error) {
        finish('Authorisation denied');
        reject(new Error(`Spotify returned: ${error}`));
      } else if (state !== expectedState) {
        finish('State mismatch');
        reject(new Error('OAuth state mismatch — possible interference. Aborted.'));
      } else if (!code) {
        finish('No authorisation code');
        reject(new Error('Callback contained no authorisation code.'));
      } else {
        finish('Authorised');
        resolve(code);
      }
    });

    server.on('error', reject);
    server.listen(PORT, '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out after 5 minutes waiting for authorisation.'));
    }, 5 * 60_000).unref();
  });
}

async function exchangeCode(config, code) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri ?? REDIRECT_URI,
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${body.error_description ?? body.error}`);
  }
  return body;
}

try {
  const config = await promptCredentials();
  const state = randomBytes(16).toString('hex');

  const authorizeUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri ?? REDIRECT_URI,
    scope: SCOPES,
    state,
    show_dialog: 'true',
  })}`;

  const pending = awaitCallback(state);

  console.log('\nOpening your browser to authorise. If it does not open, paste this URL:\n');
  console.log(`${authorizeUrl}\n`);
  openBrowser(authorizeUrl);

  const code = await pending;
  const tokens = await exchangeCode(config, code);

  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri ?? REDIRECT_URI,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
      null,
      2,
    )}\n`,
  );

  console.log('✓ Tokens written to secrets/spotify-config.json (gitignored)');
  console.log(`✓ Scopes granted include user-follow-read`);
  console.log('\nNext: continue with docs/INSTALL.md (S5).');
} catch (error) {
  console.error(`\n✗ Authentication failed: ${error.message}`);
  process.exit(1);
}
