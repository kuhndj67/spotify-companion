/**
 * PROPERTY-BASED tests for the now-playing parser (PBT-02 round-trip, PBT-03 invariants).
 *
 * This parser is the most fragile part of the system: it reads markdown that the upstream
 * MCP server formats for an LLM to read, not for a program to parse. That makes it the
 * highest-value PBT target in the project.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js'; // seed selection and reporting (PBT-08)
import { parseNowPlaying, isNothingPlaying } from '../src/mcp/parseNowPlaying.js';
import {
  nowPlayingArb,
  formatUpstreamNowPlaying,
  formatClock,
  durationSecondsArb,
} from './generators.js';

// Seed is logged on failure by fast-check and can be replayed via { seed } (PBT-08).
// Shrinking is left enabled — it is what turns a random failure into a minimal repro.
const RUNS = { numRuns: 500 };

describe('parseNowPlaying — property-based', () => {
  // PBT-02: format -> parse is the round-trip pair.
  it('round-trips every field through the upstream template', () => {
    fc.assert(
      fc.property(nowPlayingArb, (fixture) => {
        const parsed = parseNowPlaying(formatUpstreamNowPlaying(fixture));

        assert.ok(parsed, 'a formatted track must parse to a result');
        assert.equal(parsed.track, fixture.track);
        assert.equal(parsed.artist, fixture.artist);
        assert.equal(parsed.album, fixture.album);
        assert.equal(parsed.trackId, fixture.trackId);
        assert.equal(parsed.device, fixture.device);
        assert.equal(parsed.volume, fixture.volume);
        assert.equal(parsed.shuffle, fixture.shuffle);
        assert.equal(parsed.repeat, fixture.repeat);
        assert.equal(parsed.isPlaying, fixture.isPlaying);
      }),
      RUNS,
    );
  });

  // PBT-02: the clock formatting/parsing pair is itself invertible.
  it('round-trips progress and duration back to milliseconds', () => {
    fc.assert(
      fc.property(nowPlayingArb, (fixture) => {
        const parsed = parseNowPlaying(formatUpstreamNowPlaying(fixture));

        assert.ok(parsed);
        assert.equal(parsed.progressMs, fixture.progressSeconds * 1000);
        assert.equal(parsed.durationMs, fixture.durationSeconds * 1000);
        assert.equal(parsed.progress, formatClock(fixture.progressSeconds));
        assert.equal(parsed.duration, formatClock(fixture.durationSeconds));
      }),
      RUNS,
    );
  });

  // PBT-03: range invariant — progress can never exceed duration, since the UI divides
  // by duration to size the progress bar.
  it('never reports progress beyond duration', () => {
    fc.assert(
      fc.property(nowPlayingArb, (fixture) => {
        const parsed = parseNowPlaying(formatUpstreamNowPlaying(fixture));
        assert.ok(parsed);
        if (parsed.progressMs !== null && parsed.durationMs !== null) {
          assert.ok(
            parsed.progressMs <= parsed.durationMs,
            `progress ${parsed.progressMs} exceeded duration ${parsed.durationMs}`,
          );
        }
      }),
      RUNS,
    );
  });

  // PBT-03: type invariant — the raw text is always carried through, because the UI falls
  // back to it when a field fails to parse. Losing it would make upstream drift invisible.
  it('always preserves the raw text verbatim', () => {
    fc.assert(
      fc.property(nowPlayingArb, (fixture) => {
        const raw = formatUpstreamNowPlaying(fixture);
        const parsed = parseNowPlaying(raw);
        assert.ok(parsed);
        assert.equal(parsed.raw, raw);
      }),
      RUNS,
    );
  });

  // PBT-04 (advisory in Partial mode, cheap to assert): parsing is pure and repeatable.
  it('is idempotent — parsing the same text twice gives the same result', () => {
    fc.assert(
      fc.property(nowPlayingArb, (fixture) => {
        const raw = formatUpstreamNowPlaying(fixture);
        assert.deepEqual(parseNowPlaying(raw), parseNowPlaying(raw));
      }),
      RUNS,
    );
  });

  // PBT-03: a formatted track must never be misread as "nothing playing", or the UI would
  // blank out mid-song.
  it('never mistakes a playing track for an idle player', () => {
    fc.assert(
      fc.property(nowPlayingArb, (fixture) => {
        assert.equal(isNothingPlaying(formatUpstreamNowPlaying(fixture)), false);
      }),
      RUNS,
    );
  });

  it('converts clock strings to milliseconds monotonically', () => {
    fc.assert(
      fc.property(durationSecondsArb, durationSecondsArb, (a, b) => {
        const parse = (seconds: number) => {
          const parsed = parseNowPlaying(
            `# Currently Playing\n\n**Track**: "x"\n**Progress**: 0:00 / ${formatClock(seconds)}\n`,
          );
          return parsed?.durationMs ?? null;
        };
        const [msA, msB] = [parse(a), parse(b)];
        assert.ok(msA !== null && msB !== null);
        assert.equal(a <= b, msA <= msB, 'ordering must be preserved through conversion');
      }),
      RUNS,
    );
  });
});
