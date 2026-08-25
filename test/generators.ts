/**
 * Reusable domain generators for property-based tests (PBT-07).
 *
 * These deliberately produce *realistic* values rather than raw primitives: track titles
 * that look like track titles, Spotify base-62 IDs of the correct length, device names in
 * Spotify's "Name (Type)" shape. Raw `fc.string()` in these positions would generate
 * meaningless cases and miss real bugs.
 *
 * Edge cases are folded into the generators rather than bolted on: Unicode, punctuation
 * that collides with the markdown template (quotes, asterisks, pipes, colons), empty
 * collections, and boundary numerics.
 */

import fc from 'fast-check';

/**
 * Characters that appear in real track titles and also stress the markdown parser —
 * quotes, colons and pipes all collide with the upstream template.
 *
 * `*` is deliberately excluded. A title containing `**` could form a literal field marker
 * (`| **x**: `), which the wire format cannot disambiguate from a real field. That is an
 * upstream format limitation rather than a parser defect, and generating it would make the
 * round-trip property fail for a case that cannot occur in practice.
 */
const TITLE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \'-.,!?&()[]+/#:|"éüñøÅ日本語';

/**
 * A plausible music title. Newlines are excluded deliberately: the upstream MCP server
 * formats one field per line, so a newline in a title is unrepresentable in that format —
 * it is a limitation of the wire format, not of the parser.
 */
export const titleArb = fc
  .string({ unit: fc.constantFrom(...TITLE_CHARS), minLength: 1, maxLength: 60 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** Spotify IDs are 22-character base-62 strings. */
export const spotifyIdArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
  minLength: 22,
  maxLength: 22,
});

/** One or more artists, joined as upstream does. */
export const artistsArb = fc
  .array(titleArb, { minLength: 1, maxLength: 4 })
  .map((names) => names.join(', '));

/** "DESKTOP-ABC (Computer)", "Living Room (Speaker)". */
export const deviceArb = fc
  .tuple(
    fc
      .string({
        unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- '),
        minLength: 1,
        maxLength: 20,
      })
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    fc.constantFrom('Computer', 'Smartphone', 'Speaker', 'TV', 'Automobile'),
  )
  .map(([name, type]) => `${name} (${type})`);

export const volumeArb = fc.integer({ min: 0, max: 100 }).map((v) => `${v}%`);
export const shuffleArb = fc.constantFrom('On', 'Off');
export const repeatArb = fc.constantFrom('off', 'track', 'context');

/** Durations up to ~3 hours, in whole seconds — the resolution the template carries. */
export const durationSecondsArb = fc.integer({ min: 0, max: 3 * 60 * 60 });

export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export interface NowPlayingFixture {
  isPlaying: boolean;
  track: string;
  artist: string;
  album: string;
  trackId: string;
  progressSeconds: number;
  durationSeconds: number;
  device: string;
  volume: string;
  shuffle: string;
  repeat: string;
}

export const nowPlayingArb: fc.Arbitrary<NowPlayingFixture> = fc
  .record({
    isPlaying: fc.boolean(),
    track: titleArb,
    artist: artistsArb,
    album: titleArb,
    trackId: spotifyIdArb,
    durationSeconds: durationSecondsArb,
    progressRatio: fc.double({ min: 0, max: 1, noNaN: true }),
    device: deviceArb,
    volume: volumeArb,
    shuffle: shuffleArb,
    repeat: repeatArb,
  })
  .map(({ progressRatio, durationSeconds, ...rest }) => ({
    ...rest,
    durationSeconds,
    progressSeconds: Math.floor(durationSeconds * progressRatio),
  }));

/**
 * Models the upstream MCP server's `getNowPlaying` output format.
 *
 * This is a test-only reproduction of the template in marcelmarais/spotify-mcp-server
 * `src/read.ts`. It is the "formatting" half of the round-trip property (PBT-02): the
 * parser is the inverse, and parse(format(x)) must recover x.
 *
 * Keeping it here also makes upstream drift visible — if the real server changes its
 * template, this model and the parser will agree with each other but not with reality,
 * which is exactly why the diagnostics endpoint exercises the live server too.
 */
export function formatUpstreamNowPlaying(fixture: NowPlayingFixture): string {
  return (
    `# Currently ${fixture.isPlaying ? 'Playing' : 'Paused'}\n\n` +
    `**Track**: "${fixture.track}"\n` +
    `**Artist**: ${fixture.artist}\n` +
    `**Album**: ${fixture.album}\n` +
    `**Progress**: ${formatClock(fixture.progressSeconds)} / ${formatClock(fixture.durationSeconds)}\n` +
    `**ID**: ${fixture.trackId}\n\n` +
    `**Device**: ${fixture.device}\n` +
    `**Volume**: ${fixture.volume}\n` +
    `**Shuffle**: ${fixture.shuffle} | **Repeat**: ${fixture.repeat}`
  );
}

/** Spotify image sets: usually 3 sizes, occasionally fewer, occasionally none. */
export const imageSetArb = fc
  .array(
    fc.record({
      url: spotifyIdArb.map((id) => `https://i.scdn.co/image/${id}`),
      width: fc.constantFrom(64, 160, 300, 320, 640, 1000),
      height: fc.constantFrom(64, 160, 300, 320, 640, 1000),
    }),
    { minLength: 0, maxLength: 4 },
  )
  // Spotify never repeats a size within one album's image set.
  .map((images) => {
    const seen = new Set<number>();
    return images.filter((image) => {
      if (seen.has(image.width)) return false;
      seen.add(image.width);
      return true;
    });
  });

/** ISO-ish release dates at each of Spotify's three precisions. */
export const releaseDateArb = fc.oneof(
  fc
    .integer({ min: 1900, max: 2026 })
    .map((year) => ({ date: String(year), precision: 'year' as const })),
  fc
    .tuple(fc.integer({ min: 1900, max: 2026 }), fc.integer({ min: 1, max: 12 }))
    .map(([year, month]) => ({
      date: `${year}-${String(month).padStart(2, '0')}`,
      precision: 'month' as const,
    })),
  fc
    .tuple(
      fc.integer({ min: 1900, max: 2026 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
    )
    .map(([year, month, day]) => ({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      precision: 'day' as const,
    })),
);
