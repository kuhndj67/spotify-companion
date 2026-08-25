/**
 * EXAMPLE-BASED tests for the now-playing parser (PBT-10).
 *
 * These pin concrete expected behaviour for the scenarios that actually matter, and serve
 * as executable documentation of the upstream wire format. The property tests prove general
 * rules; these prove specific ones, including regressions found by PBT.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseNowPlaying, isNothingPlaying } from '../src/mcp/parseNowPlaying.js';

/** Captured from the real MCP server on 2026-08-24. */
const LIVE_SAMPLE = `# Currently Playing

**Track**: "Tangerine"
**Artist**: Kublaii
**Album**: Tangerine
**Progress**: 1:34 / 2:49
**ID**: 4cOdK2wGLETKBW3PvgPWqT

**Device**: DAVESAURORA (Computer)
**Volume**: 74%
**Shuffle**: Off | **Repeat**: off`;

describe('parseNowPlaying — example-based', () => {
  it('parses a real captured response', () => {
    const parsed = parseNowPlaying(LIVE_SAMPLE);
    assert.ok(parsed);

    assert.equal(parsed.isPlaying, true);
    assert.equal(parsed.track, 'Tangerine');
    assert.equal(parsed.artist, 'Kublaii');
    assert.equal(parsed.album, 'Tangerine');
    assert.equal(parsed.trackId, '4cOdK2wGLETKBW3PvgPWqT');
    assert.equal(parsed.progress, '1:34');
    assert.equal(parsed.duration, '2:49');
    assert.equal(parsed.progressMs, 94_000);
    assert.equal(parsed.durationMs, 169_000);
    assert.equal(parsed.device, 'DAVESAURORA (Computer)');
    assert.equal(parsed.volume, '74%');
    assert.equal(parsed.shuffle, 'Off');
    assert.equal(parsed.repeat, 'off');
  });

  it('distinguishes paused from playing via the heading', () => {
    const paused = parseNowPlaying(LIVE_SAMPLE.replace('Currently Playing', 'Currently Paused'));
    assert.ok(paused);
    assert.equal(paused.isPlaying, false);
    // Everything else must still parse — pausing is not an error state.
    assert.equal(paused.track, 'Tangerine');
  });

  it('splits multiple artists as a single joined string', () => {
    const parsed = parseNowPlaying(
      LIVE_SAMPLE.replace('**Artist**: Kublaii', '**Artist**: Inpatient, Ren, Chris Webby'),
    );
    assert.equal(parsed?.artist, 'Inpatient, Ren, Chris Webby');
  });

  // REGRESSION: found by the round-trip property test, shrunk to the title "|a".
  // A pipe in a title was truncating it, because the parser cut at any pipe.
  it('preserves a pipe inside a track title', () => {
    const parsed = parseNowPlaying(
      LIVE_SAMPLE.replace('**Track**: "Tangerine"', '**Track**: "Tom Sawyer | Live"'),
    );
    assert.equal(parsed?.track, 'Tom Sawyer | Live');
    // The Shuffle/Repeat split must still work.
    assert.equal(parsed?.shuffle, 'Off');
    assert.equal(parsed?.repeat, 'off');
  });

  // REGRESSION: found by the round-trip property test, shrunk to an album named `""`.
  // Quotes were stripped from every field, but upstream only quotes the Track — so a name
  // legitimately containing quotes was corrupted.
  it('preserves quotes in names that genuinely contain them', () => {
    const parsed = parseNowPlaying(
      LIVE_SAMPLE.replace('**Album**: Tangerine', '**Album**: "Heroes"').replace(
        '**Track**: "Tangerine"',
        '**Track**: ""Heroes""',
      ),
    );
    // Bowie's album is titled with the quotation marks.
    assert.equal(parsed?.album, '"Heroes"');
    // The Track field IS quoted by upstream, so exactly one layer comes off.
    assert.equal(parsed?.track, '"Heroes"');
  });

  it('handles an hours-long duration', () => {
    const parsed = parseNowPlaying(
      LIVE_SAMPLE.replace('**Progress**: 1:34 / 2:49', '**Progress**: 1:02:03 / 2:30:00'),
    );
    assert.equal(parsed?.progressMs, (1 * 3600 + 2 * 60 + 3) * 1000);
    assert.equal(parsed?.durationMs, (2 * 3600 + 30 * 60) * 1000);
  });

  it('returns null fields rather than throwing on a truncated response', () => {
    const parsed = parseNowPlaying('# Currently Playing\n\n**Track**: "Half A Response"');
    assert.ok(parsed);
    assert.equal(parsed.track, 'Half A Response');
    assert.equal(parsed.artist, null);
    assert.equal(parsed.durationMs, null);
  });

  it('treats unparseable clock values as null instead of NaN', () => {
    const parsed = parseNowPlaying(
      LIVE_SAMPLE.replace('**Progress**: 1:34 / 2:49', '**Progress**: unknown / unknown'),
    );
    assert.equal(parsed?.progressMs, null);
    assert.equal(parsed?.durationMs, null);
  });

  describe('isNothingPlaying', () => {
    it('detects idle messages', () => {
      for (const message of [
        'Nothing is currently playing',
        'No track is currently playing',
        "You're not playing anything right now",
      ]) {
        assert.equal(isNothingPlaying(message), true, `should be idle: ${message}`);
      }
    });

    it('does not treat a real track as idle', () => {
      assert.equal(isNothingPlaying(LIVE_SAMPLE), false);
    });

    // A song whose title contains "not playing" must not be mistaken for an idle player.
    it('does not misfire on a track whose title mentions playing', () => {
      const parsed = parseNowPlaying(
        LIVE_SAMPLE.replace('**Track**: "Tangerine"', '**Track**: "Not Playing Games"'),
      );
      assert.equal(parsed?.track, 'Not Playing Games');
    });
  });
});
