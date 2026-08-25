#!/usr/bin/env node
/**
 * Prepares the MCP server for running the app directly on the host (`npm start`).
 *
 * The container image builds the MCP server itself (see Dockerfile), so this is only needed
 * for host runs. It clones and builds marcelmarais/spotify-mcp-server into `.mcp-server/`,
 * then places a copy of the credentials where that server expects them.
 *
 * On the credential copy: the MCP server resolves its config relative to its own script
 * location (`__dirname/../spotify-config.json`), not the working directory, so the file must
 * live at `.mcp-server/spotify-config.json`. `secrets/spotify-config.json` remains the
 * canonical copy — it is what `npm run auth` writes and what compose.yaml mounts.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mcpDir = join(projectRoot, '.mcp-server');
const canonicalConfig = join(projectRoot, 'secrets', 'spotify-config.json');
const mcpConfig = join(mcpDir, 'spotify-config.json');

const REPO = 'https://github.com/marcelmarais/spotify-mcp-server.git';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(' ')}\` failed with exit code ${result.status}`);
  }
}

try {
  if (existsSync(join(mcpDir, 'build', 'index.js'))) {
    console.log('✓ MCP server already built at .mcp-server/');
  } else {
    if (!existsSync(mcpDir)) {
      console.log(`Cloning ${REPO} ...`);
      run('git', ['clone', '--depth', '1', REPO, mcpDir], projectRoot);
    }
    console.log('Installing and building the MCP server (one time) ...');
    run('npm', ['install'], mcpDir);
    run('npm', ['run', 'build'], mcpDir);
  }

  if (!existsSync(canonicalConfig)) {
    console.error('\n✗ secrets/spotify-config.json not found. Run `npm run auth` first.');
    process.exit(1);
  }

  copyFileSync(canonicalConfig, mcpConfig);
  console.log('✓ Credentials copied to .mcp-server/spotify-config.json');
  console.log('\nReady. Run:  npm start        then open http://127.0.0.1:3000');
} catch (error) {
  console.error(`\n✗ Setup failed: ${error.message}`);
  process.exit(1);
}
