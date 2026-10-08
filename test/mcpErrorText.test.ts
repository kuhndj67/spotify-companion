/**
 * LC-45 — recognising an MCP error that arrives as text (BR-58.1), and PBT-66: the pattern still matches every
 * error template in the MCP server's SOURCE.
 *
 * ## ⚠️ Why the source scan, and why it fails rather than skips
 *
 * The server is fetched at image build with `MCP_SERVER_REF=main` — it floats — so its wording can change on any
 * rebuild. A rewording the pattern missed would silently put the display back to "Spotify: ok" over broken
 * credentials. Scanning the source makes that a red test instead. If the source is not checked out, the test
 * FAILS with a reason (P-54): a scan of nothing passes vacuously, and that is the failure this exists to prevent.
 * CI fetches the same ref the Dockerfile does.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { isMcpErrorText } from '../src/configuration/mcpErrorText.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_SRC = join(ROOT, '.mcp-server', 'src');

/** Verbatim from probe P-U7-3 (2026-10-08) — real strings, never invented ones. */
const REAL_BROKEN_REFRESH =
  'Error getting current track: Failed to refresh access token. Please run "npm run auth" to re-authenticate.';
const REAL_PLACEHOLDER_CONFIG = 'Error getting current track: Failed to get access token.';
const REAL_NOTHING_PLAYING = 'Nothing is currently playing on Spotify';

describe('isMcpErrorText — the real strings', () => {
  it('matches both broken-credential texts seen live', () => {
    assert.equal(isMcpErrorText(REAL_BROKEN_REFRESH), true);
    assert.equal(isMcpErrorText(REAL_PLACEHOLDER_CONFIG), true);
  });

  it('negative control: nothing playing is not an error', () => {
    assert.equal(isMcpErrorText(REAL_NOTHING_PLAYING), false);
  });

  it('negative control: a now-playing block is not an error, even for a track titled "Error handling: …"', () => {
    const block = '# Currently Playing\n\n**Track**: "Error handling: live"\n**Artist**: Someone';
    assert.equal(isMcpErrorText(block), false);
  });

  it('negative control: "Error" anywhere but the start, or with no colon on the first line, does not match', () => {
    assert.equal(isMcpErrorText('Track: Error getting lost: remix'), false);
    assert.equal(isMcpErrorText('Error happened\nlater: x'), false);
    assert.equal(isMcpErrorText('Errors: plural is a different word'), false);
  });

  it('the input-validation shape `Error: …` IS an error (found by PBT-66 on its first run)', () => {
    assert.equal(isMcpErrorText('Error: No track IDs provided'), true);
  });
});

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsFiles(full) : name.endsWith('.ts') ? [full] : [];
  });
}

/** Every `text: \`Error …\`` / `text: 'Error …'` template, with interpolations replaced by sample text. */
function errorTemplates(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/text:\s*(`|'|")(Error[\s\S]*?)\1/g)) {
    found.push((m[2] ?? '').replace(/\$\{[\s\S]*?\}/g, 'sample message'));
  }
  return found;
}

describe('PBT-66 — every MCP error template matches', () => {
  it('PBT-66: the MCP server source is present (a scan of nothing would pass vacuously)', () => {
    assert.ok(
      existsSync(MCP_SRC),
      `.mcp-server/src is missing — run \`npm run mcp:setup\` (CI fetches it at the Dockerfile's ref). ` +
        'Without it this test cannot see an upstream rewording, and passing would be a lie.',
    );
  });

  it('PBT-66: every error template in the MCP source matches, and there is at least one', () => {
    if (!existsSync(MCP_SRC)) assert.fail('.mcp-server/src is missing — see the test above');
    const templates = tsFiles(MCP_SRC).flatMap((file) =>
      errorTemplates(readFileSync(file, 'utf8')).map((text) => ({ file: file.slice(ROOT.length + 1), text })),
    );
    assert.ok(templates.length >= 1, 'found no error templates — has the server changed how it reports errors?');
    const missed = templates.filter((t) => !isMcpErrorText(t.text));
    assert.deepEqual(missed, [], 'these upstream error texts would read as data, not as failures');
  });
});
