/**
 * Recognising an MCP tool error that arrives as ordinary text (LC-45, BR-58.1, P-54). ⚙️ PURE
 *
 * The bundled `spotify-mcp-server` reports failures as a normal text result — `Error getting current track:
 * Failed to refresh access token…` — **without** `isError`. Read as data, that became a now-playing snapshot with
 * every field null: the card showed PAUSED and the status *"Spotify: ok"* over broken credentials (F5, confirmed
 * live by probe P-U7-3 on 2026-10-08).
 *
 * The server has **25** error templates in two shapes — `Error <verb>ing …: <message>` (19) and `Error: <message>`
 * (6, input validation) — and an interpolated verb (`Error ${action} albums:`). So the pattern is *starts with the
 * word `Error`, with a colon on the first line*. **No non-error text the server produces starts with `Error`**
 * (checked across all its templates, 2026-10-08), and a now-playing block begins `# Currently`, so a track titled
 * "Error handling: …" can never match.
 *
 * ⚠️ **Corrected on first run of PBT-66, 2026-10-08.** The design said *"all 20 templates are `Error <verb>ing`"*,
 * from a grep that matched only backtick templates. The source scan found the single-quoted `Error:` ones on its
 * first run — which is the case it exists for.
 *
 * ⚠️ **The upstream wording can change on any image build** (`MCP_SERVER_REF=main` floats). PBT-66 scans the
 * server's source for every error template and fails the test run if one stops matching — so a rewording breaks
 * the build, not the display.
 */

export const MCP_ERROR_TEXT = /^Error\b[^\n]*:/;

export function isMcpErrorText(text: string): boolean {
  return MCP_ERROR_TEXT.test(text);
}
