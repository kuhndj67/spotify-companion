/**
 * Runtime configuration, read from the environment.
 *
 * Reflects the answered requirements: WebSocket push (Q5), localhost-only access (Q7),
 * minimal-but-enforced local security (Q9).
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Defaults differ between the container and a host `npm start`, and getting this wrong
 * produces confusing "credentials not found" errors, so it is detected rather than assumed.
 *
 * Note the MCP server resolves its own spotify-config.json relative to its *script location*
 * (`__dirname/../spotify-config.json`), not the working directory — so the file must sit at
 * the root of the MCP server's own directory. compose.yaml mounts it there; on the host,
 * `npm run mcp:setup` places a copy there.
 */
const CONTAINER_MCP_DIR = '/opt/spotify-mcp';
const inContainer = existsSync(CONTAINER_MCP_DIR);
const mcpDir = inContainer ? CONTAINER_MCP_DIR : join(projectRoot, '.mcp-server');

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  /** Port the web app listens on. */
  port: int('PORT', 3000),

  /**
   * Bind interface. Inside a container this must be 0.0.0.0 to receive published traffic;
   * compose.yaml publishes only to 127.0.0.1 on the host, and the loopback guard below
   * rejects anything that still arrives from off-box. Outside a container, default to
   * loopback so `npm start` is never exposed by accident.
   */
  host: process.env.HOST ?? '127.0.0.1',

  /** Path to the built spotify-mcp-server entrypoint that we spawn over stdio. */
  mcpServerEntrypoint:
    process.env.MCP_SERVER_ENTRYPOINT ?? join(mcpDir, 'build', 'index.js'),

  /** Working directory for the spawned MCP server process. */
  mcpServerCwd: process.env.MCP_SERVER_CWD ?? mcpDir,

  /**
   * The credential file this app reads. In the container it is the same file the MCP server
   * uses (mounted). On the host it is `secrets/spotify-config.json`, the canonical output of
   * `npm run auth`, while the MCP server gets its own copy under `.mcp-server/`.
   *
   * Divergence between the two copies is harmless: this app only ever reads clientId,
   * clientSecret and refreshToken, none of which change when an access token is refreshed.
   */
  spotifyConfigPath:
    process.env.SPOTIFY_CONFIG_PATH ??
    (inContainer
      ? join(CONTAINER_MCP_DIR, 'spotify-config.json')
      : join(projectRoot, 'secrets', 'spotify-config.json')),

  /** True when running inside the container image. Surfaced in diagnostics. */
  inContainer,

  /**
   * How often the backend asks the MCP server for the current track. The browser no longer
   * polls at all — this is the only thing that drives load against Spotify, regardless of
   * how many tabs are open.
   */
  pollIntervalMs: int('POLL_INTERVAL_MS', 3000),

  /**
   * Reject requests that did not originate from this machine (Q7/Q9). Kept deliberately
   * simple: a loopback check on the socket address, plus Host/Origin validation to blunt
   * DNS-rebinding. Disable only for deliberate LAN exposure.
   */
  localOnly: process.env.LOCAL_ONLY !== 'false',
} as const;
