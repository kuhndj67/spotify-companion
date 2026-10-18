/**
 * How the connector is spawned (U9, LC-60, BR-69.5).
 *
 * The SDK's stdio transport does not pass the parent's environment through, so the config path must be in the
 * spawn's own `env`, or the patched connector falls back to its own directory and the rename-based write never
 * reaches the mounted credentials.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connectorSpawnParams } from '../src/mcp/spotifyMcpClient.js';
import { CONTAINER_SECRETS_DIR } from '../src/config.js';

const cfg = {
  mcpServerEntrypoint: '/opt/spotify-mcp/build/index.js',
  mcpServerCwd: '/opt/spotify-mcp',
  spotifyConfigPath: `${CONTAINER_SECRETS_DIR}/spotify-config.json`,
};

describe('connectorSpawnParams (LC-60)', () => {
  it('passes SPOTIFY_CONFIG_PATH explicitly, equal to the path the app itself uses', () => {
    const params = connectorSpawnParams(cfg);
    assert.equal(params.env?.SPOTIFY_CONFIG_PATH, '/app/secrets/spotify-config.json');
  });

  it('keeps the SDK default environment (PATH, HOME, ...) rather than replacing it', () => {
    const params = connectorSpawnParams(cfg);
    for (const [key, value] of Object.entries(getDefaultEnvironment())) assert.equal(params.env?.[key], value);
  });

  it('spawns the configured entrypoint with this Node, in the connector directory', () => {
    const params = connectorSpawnParams(cfg);
    assert.equal(params.command, process.execPath);
    assert.deepEqual(params.args, [cfg.mcpServerEntrypoint]);
    assert.equal(params.cwd, cfg.mcpServerCwd);
  });

  it('positive control: a different config path is passed through, not a constant', () => {
    const params = connectorSpawnParams({ ...cfg, spotifyConfigPath: '/elsewhere/x.json' });
    assert.equal(params.env?.SPOTIFY_CONFIG_PATH, '/elsewhere/x.json');
  });
});
