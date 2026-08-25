/**
 * Parser for the `getNowPlaying` tool's response.
 *
 * The MCP server returns markdown intended for an LLM to read, not JSON. See
 * https://github.com/marcelmarais/spotify-mcp-server `src/read.ts`, which builds:
 *
 *   # Currently Playing
 *
 *   **Track**: "Song Name"
 *   **Artist**: Artist One, Artist Two
 *   **Album**: Album Name
 *   **Progress**: 1:23 / 3:45
 *   **ID**: 4cOdK2wGLETKBW3PvgPWqT
 *
 *   **Device**: MacBook Pro (Computer)
 *   **Volume**: 75%
 *   **Shuffle**: Off | **Repeat**: off
 *
 * This is the brittle seam in the whole design: an upstream template change breaks parsing
 * silently. Everything that depends on the exact wording lives in this one file, and the
 * raw text is always carried through on the result so the UI can fall back to displaying it.
 */

export interface NowPlaying {
  isPlaying: boolean;
  track: string | null;
  artist: string | null;
  album: string | null;
  trackId: string | null;
  progress: string | null;
  duration: string | null;
  progressMs: number | null;
  durationMs: number | null;
  device: string | null;
  volume: string | null;
  shuffle: string | null;
  repeat: string | null;
  /** Unparsed tool output, always present, for debugging and as a UI fallback. */
  raw: string;
}

/**
 * Reads `**Label**: value` out of the markdown body.
 *
 * Upstream packs two fields onto one line — `**Shuffle**: Off | **Repeat**: off` — so a
 * value has to be cut at that separator. The cut must be made at a pipe that introduces
 * *another field marker*, not at any pipe: track titles legitimately contain `|`
 * ("Tom Sawyer | Live"), and cutting on those truncated the title.
 *
 * Found by the round-trip property test, which shrank it to the title `"|a"`.
 *
 * Known limitation: a title containing the literal sequence ` | **word**: ` is ambiguous in
 * this wire format and would still be cut. That is unresolvable without a structured
 * response from upstream, and does not occur in real track titles.
 */
function field(text: string, label: string, quoted = false): string | null {
  // `.` excludes newlines, so this captures through to the end of the line.
  const pattern = new RegExp(`\\*\\*${label}\\*\\*:[ \\t]*(.*)`, 'i');
  const match = pattern.exec(text);
  if (!match) return null;

  let value = (match[1] ?? '').trim();

  const nextFieldMarker = value.search(/\|\s*\*\*[^*]+\*\*:/);
  if (nextFieldMarker !== -1) value = value.slice(0, nextFieldMarker).trim();

  // Only the Track field is wrapped in quotes by upstream, so only it may be unwrapped.
  // Stripping quotes everywhere corrupted names that legitimately contain them — Bowie's
  // album «"Heroes"» is titled with the quotation marks. Found by the round-trip property.
  if (quoted && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }

  return value || null;
}

/** "1:23" or "1:02:03" to milliseconds. Returns null for anything unrecognised. */
function timeToMs(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 2) return (parts[0]! * 60 + parts[1]!) * 1000;
  if (parts.length === 3) return (parts[0]! * 3600 + parts[1]! * 60 + parts[2]!) * 1000;
  return null;
}

/**
 * `getNowPlaying` reports nothing playing with a short message rather than the full
 * template. Detect that before attempting to parse fields.
 */
export function isNothingPlaying(text: string): boolean {
  return /nothing.*(playing|currently)|no.*(track|content).*playing|not.*playing/i.test(text)
    && !/\*\*Track\*\*:/i.test(text);
}

export function parseNowPlaying(raw: string): NowPlaying | null {
  if (isNothingPlaying(raw)) return null;

  const progressField = field(raw, 'Progress');
  const [progress = null, duration = null] = progressField
    ? progressField.split('/').map((s) => s.trim())
    : [];

  return {
    // The heading reads "# Currently Playing" or "# Currently Paused".
    isPlaying: /#\s*Currently\s+Playing/i.test(raw),
    track: field(raw, 'Track', true),
    artist: field(raw, 'Artist'),
    album: field(raw, 'Album'),
    trackId: field(raw, 'ID'),
    progress,
    duration,
    progressMs: timeToMs(progress),
    durationMs: timeToMs(duration),
    device: field(raw, 'Device'),
    volume: field(raw, 'Volume'),
    shuffle: field(raw, 'Shuffle'),
    repeat: field(raw, 'Repeat'),
    raw,
  };
}
