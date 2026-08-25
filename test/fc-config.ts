/**
 * Global fast-check configuration — seed selection and reporting (PBT-08).
 *
 * PBT-08 requires every property run to be reproducible, with the seed either fixed or
 * logged on every run. This does both: CI passes a per-run seed via FC_SEED so a failing
 * run is exactly replayable, and a local run without FC_SEED picks a random seed and
 * prints the command to replay it.
 *
 * A varying seed across CI runs is deliberate. A fixed seed would only ever explore the
 * same inputs, which defeats the point of property testing; logging the seed keeps every
 * failure reproducible without freezing the search space.
 *
 * Shrinking is left at its default (enabled). PBT-08 forbids disabling it, and it is what
 * turned each defect this suite found into a one-line reproduction.
 *
 * node:test runs each test file in its own process, so this module is imported by every
 * suite that uses fast-check rather than configured once centrally.
 */

import fc from 'fast-check';

function resolveSeed(): number {
  const fromEnv = process.env.FC_SEED;
  if (fromEnv === undefined || fromEnv === '') return Date.now() >>> 0;

  const parsed = Number.parseInt(fromEnv, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`FC_SEED must be an integer, got "${fromEnv}"`);
  }
  // CI passes github.run_id, which exceeds 32 bits. Normalising keeps the seed in range,
  // and the value logged below is the normalised one — so replaying with it is exact.
  return parsed >>> 0;
}

export const seed = resolveSeed();

fc.configureGlobal({ seed });

// Reported once per test process. In TAP output this appears as a diagnostic line.
console.log(`[fast-check] seed=${seed} — replay with: FC_SEED=${seed} npm test`);
