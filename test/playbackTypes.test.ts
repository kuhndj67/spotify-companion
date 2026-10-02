/**
 * U5's playback vocabulary, and the pre-registered safety limits.
 *
 * ## ⚠️ Why pinning two integers is worth a test
 *
 * `MAX_CONSECUTIVE_RULE_SKIPS` and `MAX_RULE_SKIPS_PER_HOUR` are **pre-registered safety limits, not
 * tuning parameters** (BR-35, Infrastructure Q4). They are constants in source precisely so that
 * changing them cannot be done by editing `compose.yaml` — but a constant in source is still one
 * keystroke from being raised, and the circumstance in which someone would raise it is exactly the
 * circumstance in which the limit is doing its job.
 *
 * ⚠️ **The halt fires during normal listening.** Measured 2026-09-27: the busiest rolling hour in the
 * corpus held **27 plays**, so 10 rule-skips per hour is reached by any rule matching more than **37%**
 * of tracks. When that happens, the tempting fix is to raise the number until it stops firing — after
 * which the halt remains in the code and prevents nothing.
 *
 * So this test exists to make that edit **loud**. If it fails, the question is not "update the test";
 * it is "has the pre-registration been amended, and why". Same discipline as
 * `hypothesis-gate/pre-registration.md`, whose runner comment says to change the thresholds by amending
 * the document rather than by editing the script.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CONSECUTIVE_RULE_SKIPS,
  MAX_RULE_SKIPS_PER_HOUR,
  RULE_SKIP_WINDOW_MS,
  SKIP_CONFIRMATION_GRACE_MS,
} from '../src/playback/types.js';
import type { RefusalReason, SkipAttemptState } from '../src/playback/types.js';

describe('U5 pre-registered safety limits', () => {
  it('halts after 3 consecutive rule-skips — the corpus longest USER run is 2', () => {
    assert.equal(
      MAX_CONSECUTIVE_RULE_SKIPS,
      3,
      'Changing this requires amending the pre-registration, not updating this test (BR-35.1).',
    );
  });

  it('halts at 10 rule-skips in a rolling hour', () => {
    assert.equal(
      MAX_RULE_SKIPS_PER_HOUR,
      10,
      'Changing this requires amending the pre-registration, not updating this test (BR-35.2).',
    );
  });

  it('measures the rate over a ROLLING hour, not a calendar hour', () => {
    assert.equal(RULE_SKIP_WINDOW_MS, 3_600_000);
  });

  it('allows a ~3s grace before judging a skip unconfirmed', () => {
    // BR-43.4. A tolerance, never a compensation: P-U5-1 found the DJ's audio lag changes SIGN
    // between transition types, so no fixed offset may be assumed (P-34).
    assert.equal(SKIP_CONFIRMATION_GRACE_MS, 3_000);
  });

  it('⚠️ the hourly limit is reachable by a legitimate rule, which is the point', () => {
    // Measured 2026-09-27: busiest rolling hour = 27 live plays, median 16.
    const busiestHourPlays = 27;
    const matchRateThatTrips = MAX_RULE_SKIPS_PER_HOUR / busiestHourPlays;
    assert.ok(
      matchRateThatTrips < 0.5,
      'A rule matching under half of all tracks trips the halt at peak listening rate. ' +
        'That is information about the rule, not grounds to raise the limit (BR-35).',
    );
  });
});

describe('U5 state and refusal vocabularies', () => {
  // The project convention: a string union has NO FALSY MEMBER, so `if (state)` cannot silently
  // collapse a meaningful value to false. Same reason `Verdict` is not `boolean | null`.
  const states: readonly SkipAttemptState[] = [
    'queued',
    'cancelled',
    'refused',
    'fired',
    'confirmed',
    'unconfirmed',
  ];

  const reasons: readonly RefusalReason[] = [
    'automation-off',
    'runaway-halted',
    'rule-dry-run',
    'already-attempted',
    'play-closed',
    'rate-limited',
    'upstream-rate-limited',
  ];

  it('no SkipAttemptState is falsy', () => {
    for (const s of states) assert.ok(s, `"${s}" must be truthy`);
  });

  it('no RefusalReason is falsy', () => {
    for (const r of reasons) assert.ok(r, `"${r}" must be truthy`);
  });

  it('⚠️ keeps our own rate limit DISTINCT from Spotify returning 429', () => {
    // P-30. `rate-limited` is BR-35.2's own hourly safety cap; `upstream-rate-limited` is Spotify
    // refusing the request. Conflating them makes the runaway halt's evidence unreadable, and
    // saying what tripped it is the halt's only job.
    assert.notEqual(
      reasons.indexOf('rate-limited'),
      reasons.indexOf('upstream-rate-limited'),
      'these are different facts and must stay separate members',
    );
  });

  it('⚠️ has NO state or reason that expresses a retry', () => {
    // FR-48 and BR-36.4: surface, do not retry. One attempt is the budget, and a failed attempt
    // does not earn another — so there is no retry state and no attempt counter to increment.
    const retryish = [...states, ...reasons].filter((v) => /retry|retrying|attempt-\d/.test(v));
    assert.deepEqual(retryish, []);
  });
});
