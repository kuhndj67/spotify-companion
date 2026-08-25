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

/** Reads `**Label**: value` out of the markdown body. */
function field(text: string, label: string): string | null {
  const pattern = new RegExp(`\\*\\*${label}\\*\\*:\\s*(.+?)\\s*(?:\\||$)`, 'im');
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  // Track names come back wrapped in double quotes; strip them.
  return match[1].trim().replace(/^"(.*)"$/, '$1') || null;
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
    track: field(raw, 'Track'),
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
