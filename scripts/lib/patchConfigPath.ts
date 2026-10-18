/**
 * The connector's config-path patch (U9, LC-58, P-65, BR-69.1). ⚙️ PURE, plus a thin CLI at the bottom.
 *
 * ## Why a patch exists at all
 *
 * Upstream `spotify-mcp-server` (pinned `6065ce5c`, MIT) writes `spotify-config.json` by temp-file + `rename`
 * (upstream `b56bb07`), at a path FIXED next to its own build: `<package root>/spotify-config.json`. A rename onto a
 * single-file bind mount fails with `EBUSY` (probed 2026-10-18), so the credentials must live in a DIRECTORY mount,
 * which the connector can only reach if its path can be set. This replaces the one line that fixes it, so the path
 * comes from `SPOTIFY_CONFIG_PATH`, falling back to upstream's own path when the variable is unset.
 *
 * ## Why it counts twice
 *
 * A patch that silently stops applying puts `EBUSY` back on every token refresh, and nobody notices until the app
 * stops working an hour after a deploy. So the original line must occur EXACTLY ONCE before, and the patched line
 * exactly once after; anything else refuses, and the Dockerfile step that runs this FAILS THE BUILD with the reason.
 *
 * ⚠️ This is the only divergence from upstream (BR-69.2). It goes when upstream accepts an equivalent override and
 * the pin moves to that commit. CONTRIBUTING.md lists it under the traps.
 */

/** Upstream's line at `6065ce5c`, `src/utils.ts:12`. Matched exactly, ignoring only surrounding whitespace. */
export const ORIGINAL_LINE = "const CONFIG_FILE = path.join(__dirname, '../spotify-config.json');";

/** Its replacement: the same default, overridable. */
export const PATCHED_LINE =
  "const CONFIG_FILE = process.env.SPOTIFY_CONFIG_PATH ?? path.join(__dirname, '../spotify-config.json');";

export type PatchResult =
  | { readonly ok: true; readonly patched: string }
  | { readonly ok: false; readonly reason: string };

function countLines(lines: readonly string[], wanted: string): number {
  return lines.filter((line) => line.trim() === wanted).length;
}

export function patchConfigPath(source: string): PatchResult {
  // Split on \n only and keep any \r, so a CRLF file round-trips byte-for-byte outside the patched line.
  const lines = source.split('\n');
  const trimmedEnd = (line: string): string => line.replace(/\r$/, '');

  const before = countLines(lines.map(trimmedEnd), ORIGINAL_LINE);
  if (before !== 1) {
    return {
      ok: false,
      reason:
        `expected the connector's CONFIG_FILE line exactly once, found it ${before} time(s). ` +
        'Upstream changed it: re-read upstream src/utils.ts and update scripts/lib/patchConfigPath.ts (BR-69.1).',
    };
  }

  const out = lines.map((line) => {
    if (trimmedEnd(line).trim() !== ORIGINAL_LINE) return line;
    const indent = line.slice(0, line.length - line.trimStart().length);
    const cr = line.endsWith('\r') ? '\r' : '';
    return `${indent}${PATCHED_LINE}${cr}`;
  });

  const after = countLines(out.map(trimmedEnd), PATCHED_LINE);
  const left = countLines(out.map(trimmedEnd), ORIGINAL_LINE);
  if (after !== 1 || left !== 0) {
    return { ok: false, reason: `patch did not apply cleanly: ${after} patched line(s), ${left} original line(s) left` };
  }
  return { ok: true, patched: out.join('\n') };
}

// ---------------------------------------------------------------------------------------------------------------
// CLI: `node scripts/lib/patchConfigPath.ts --file <path>`, run by the Dockerfile's connector stage. Node 22.23
// runs this .ts file directly (type stripping, probed 2026-10-18). Exit 1 with the reason on a refusal.
// ---------------------------------------------------------------------------------------------------------------

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('patchConfigPath.ts');
if (isMain && process.argv.includes('--file')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const file = process.argv[process.argv.indexOf('--file') + 1];
  if (!file) {
    console.error('patchConfigPath: --file needs a path');
    process.exit(1);
  }
  const result = patchConfigPath(readFileSync(file, 'utf8'));
  if (!result.ok) {
    console.error(`patchConfigPath: REFUSED: ${result.reason}`);
    process.exit(1);
  }
  writeFileSync(file, result.patched, 'utf8');
  console.log(`patchConfigPath: patched ${file} (CONFIG_FILE now honours SPOTIFY_CONFIG_PATH)`);
}
