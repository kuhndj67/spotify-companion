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
 *
 * U9 (NFR-40): the checkout follows compose.yaml's MCP_SERVER_REF, the ONE pin. Until 2026-10-18 this cloned
 * upstream's moving `main` and never updated an existing checkout, so a host run (and PBT-66 run locally) could see
 * a different connector from the one the image builds. The host checkout is NOT patched: with no bind mount here,
 * upstream's rename-based write works as is.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mcpDir = join(projectRoot, '.mcp-server');
const canonicalConfig = join(projectRoot, 'secrets', 'spotify-config.json');
const mcpConfig = join(mcpDir, 'spotify-config.json');

const REPO = 'https://github.com/marcelmarais/spotify-mcp-server.git';

/** compose.yaml's pin. Refuse rather than fall back to `main`: a moving default is what this replaced. */
function pinnedRef() {
  const match = readFileSync(join(projectRoot, 'compose.yaml'), 'utf8').match(/^\s*MCP_SERVER_REF:\s*([0-9a-f]{40})\s*$/m);
  if (!match) throw new Error('compose.yaml has no full-SHA MCP_SERVER_REF -- the one pin (NFR-40)');
  return match[1];
}

function headOf(dir) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

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
  const ref = pinnedRef();
  const head = existsSync(mcpDir) ? headOf(mcpDir) : null;
  if (head === ref && existsSync(join(mcpDir, 'build', 'index.js'))) {
    console.log(`✓ MCP server already built at .mcp-server/ (pin ${ref.slice(0, 8)})`);
  } else {
    if (!existsSync(mcpDir)) {
      run('git', ['init', '-q', mcpDir], projectRoot);
      run('git', ['remote', 'add', 'origin', REPO], mcpDir);
    }
    console.log(`Fetching the pinned MCP server ${ref.slice(0, 8)}${head ? ` (was ${head.slice(0, 8)})` : ''} ...`);
    run('git', ['fetch', '--depth', '1', 'origin', ref], mcpDir);
    run('git', ['checkout', '-q', 'FETCH_HEAD'], mcpDir);
    console.log('Installing and building the MCP server ...');
    run('npm', ['ci'], mcpDir);
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
