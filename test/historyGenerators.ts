/**
 * Domain generators for listening-history property tests (PBT-07).
 *
 * These produce *plausible poll traces*, not random numbers. A trail is a time series with real
 * structure — progress advances at roughly wall-clock rate, polls arrive at roughly the poll
 * interval, pauses hold position, rewinds jump backwards. Raw `fc.array(fc.integer())` in this
 * position would generate traces that could never occur and miss the bugs that actually happen.
 */

import fc from 'fast-check';
import type { Observation } from '../src/history/types.js';
import { spotifyIdArb } from './generators.js';

const POLL_MS = 3000;

/** What the listener did between two polls. */
export type TrailStep =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'rewind'; byMs: number }
  | { kind: 'seekForward'; byMs: number };

export const trailStepArb: fc.Arbitrary<TrailStep> = fc.oneof(
  { weight: 8, arbitrary: fc.constant<TrailStep>({ kind: 'play' }) },
  { weight: 1, arbitrary: fc.constant<TrailStep>({ kind: 'pause' }) },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 5_000, max: 90_000 })
      .map((byMs) => ({ kind: 'rewind', byMs }) as TrailStep),
  },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 5_000, max: 90_000 })
      .map((byMs) => ({ kind: 'seekForward', byMs }) as TrailStep),
  },
);

export interface TrailSpec {
  trackId: string;
  durationMs: number;
  startProgressMs: number;
  steps: TrailStep[];
  pollIntervalMs: number;
}

/**
 * Build a trail from a spec.
 *
 * Exported so tests can construct specific traces by hand as well as generate them — the
 * example tests and the property tests then exercise identical construction logic, and a
 * counterexample from a property can be pasted into an example test unchanged.
 */
export function buildTrail(spec: TrailSpec): Observation[] {
  const trail: Observation[] = [];
  let atMs = 1_700_000_000_000;
  let progressMs = spec.startProgressMs;

  trail.push({
    atMs,
    trackId: spec.trackId,
    progressMs,
    durationMs: spec.durationMs,
    isPlaying: true,
  });

  for (const step of spec.steps) {
    atMs += spec.pollIntervalMs;
    let isPlaying = true;

    switch (step.kind) {
      case 'play':
        progressMs += spec.pollIntervalMs;
        break;
      case 'pause':
        isPlaying = false; // position holds
        break;
      case 'rewind':
        progressMs = Math.max(0, progressMs - step.byMs);
        break;
      case 'seekForward':
        progressMs += step.byMs;
        break;
    }

    progressMs = Math.min(progressMs, spec.durationMs);
    trail.push({
      atMs,
      trackId: spec.trackId,
      progressMs,
      durationMs: spec.durationMs,
      isPlaying,
    });
  }

  return trail;
}

/**
 * Durations spanning what actually appears in a library, including the short end where the
 * accepted 30-second limitation lives. Generating only 3-minute pop songs would hide it.
 */
export const durationMsArb = fc.oneof(
  { weight: 1, arbitrary: fc.integer({ min: 1_000, max: 29_000 }) }, // interludes, skits
  { weight: 6, arbitrary: fc.integer({ min: 60_000, max: 420_000 }) }, // ordinary tracks
  { weight: 1, arbitrary: fc.integer({ min: 420_000, max: 1_800_000 }) }, // long-form
);

export const trailSpecArb: fc.Arbitrary<TrailSpec> = fc
  .record({
    trackId: spotifyIdArb,
    durationMs: durationMsArb,
    startProgressMs: fc.integer({ min: 0, max: 5_000 }),
    steps: fc.array(trailStepArb, { minLength: 0, maxLength: 120 }),
    pollIntervalMs: fc.constantFrom(1000, 3000, 5000),
  })
  .map((spec) => ({ ...spec, startProgressMs: Math.min(spec.startProgressMs, spec.durationMs) }));

export const trailArb: fc.Arbitrary<Observation[]> = trailSpecArb.map(buildTrail);

/**
 * A track played straight through, as it is actually *observed*.
 *
 * The final sample lands one poll interval before the end, not exactly on it. That is the real
 * shape of the data: polls do not coincide with track endings, so the last observation of a play
 * is always slightly stale, and the next poll already shows the following track.
 *
 * `lastGapMs` controls how stale — where in the final interval the last poll happened to fall.
 * That alignment is what decides the fate of short tracks (see `worstCaseTrail`), so it is a
 * parameter rather than an assumption.
 */
export function completeTrail(
  durationMs: number,
  pollIntervalMs = POLL_MS,
  lastGapMs = 1,
): Observation[] {
  const lastProgress = Math.max(0, durationMs - Math.min(lastGapMs, durationMs));
  const steps: TrailStep[] = Array.from(
    { length: Math.max(0, Math.floor(lastProgress / pollIntervalMs)) },
    () => ({ kind: 'play' }) as TrailStep,
  );
  return buildTrail({
    trackId: 'abcdefghijklmnopqrstuv',
    durationMs,
    startProgressMs: lastProgress - steps.length * pollIntervalMs,
    steps,
    pollIntervalMs,
  });
}

/**
 * The unluckiest possible poll alignment: the last observation lands a full interval before the
 * end, so the observed ratio is as low as it can be for a track played in full.
 *
 * This is the case that produces the accepted short-track limitation. For a threshold R and poll
 * interval p, a fully-played track clears the threshold only when `duration >= p / (1 - R)` —
 * 30 seconds at R = 0.90 and p = 3 s.
 */
export function worstCaseTrail(durationMs: number, pollIntervalMs = POLL_MS): Observation[] {
  return completeTrail(durationMs, pollIntervalMs, pollIntervalMs);
}

/**
 * A track played through `times` times in a row, with progress resetting each time.
 *
 * This is what actually pushes the ratio above 1.0: progress cannot exceed duration, so repeat
 * listening shows up as a reset followed by fresh forward movement — not as a progress value
 * larger than the track.
 */
export function replayTrail(
  durationMs: number,
  times: number,
  pollIntervalMs = POLL_MS,
): Observation[] {
  const perPass = Math.max(1, Math.floor((durationMs - 1) / pollIntervalMs));
  const steps: TrailStep[] = [];

  for (let pass = 0; pass < times; pass++) {
    for (let i = 0; i < perPass; i++) steps.push({ kind: 'play' });
    // Back to the start for the next pass.
    if (pass < times - 1) steps.push({ kind: 'rewind', byMs: durationMs });
  }

  return buildTrail({
    trackId: 'abcdefghijklmnopqrstuv',
    durationMs,
    startProgressMs: 0,
    steps,
    pollIntervalMs,
  });
}
