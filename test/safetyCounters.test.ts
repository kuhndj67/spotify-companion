/**
 * LC-27 — the runaway-halt counters. **PBT-46** (reset and rolling window) and **PBT-47** (only
 * rule-caused skips count).
 *
 * ## ⚠️ The two tests that exist because of a specific failure mode
 *
 *   - **A calendar hour instead of a rolling one** would let ten skips at 10:55 and ten more at 11:05
 *     pass a limit of ten — twenty skips in ten minutes, read as two compliant hours.
 *   - **A counter that merely fails to increment** on a non-rule play, rather than resetting to zero,
 *     turns "three in a row" into "three ever", which halts automation on a listener who skipped three
 *     tracks across an afternoon.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  consecutiveRuleSkips,
  evaluateHalt,
  ruleSkipsInWindow,
} from '../src/playback/safetyCounters.js';
import type { PlayForCounting } from '../src/playback/safetyCounters.js';
import {
  MAX_CONSECUTIVE_RULE_SKIPS,
  MAX_RULE_SKIPS_PER_HOUR,
  RULE_SKIP_WINDOW_MS,
} from '../src/playback/types.js';

const plays = (...flags: boolean[]): PlayForCounting[] =>
  flags.map((skippedByRule, i) => ({ playId: i + 1, skippedByRule }));

const MIN = 60_000;

describe('PBT-46a — consecutiveRuleSkips counts the trailing run', () => {
  it('is zero for no plays', () => {
    assert.equal(consecutiveRuleSkips([]), 0);
  });

  it('is zero when the most recent play was not a rule skip', () => {
    assert.equal(consecutiveRuleSkips(plays(true, true, false)), 0);
  });

  it('counts only the trailing run, not the total', () => {
    // Two rule skips, a completion, then one rule skip. "Three ever" would be wrong.
    assert.equal(consecutiveRuleSkips(plays(true, true, false, true)), 1);
  });

  it('counts a full run', () => {
    assert.equal(consecutiveRuleSkips(plays(false, true, true, true)), 3);
  });

  it('⚠️ ANY non-rule play RESETS to zero — it does not merely fail to increment', () => {
    // BR-35.9. A listener hearing one track through between rule-skips means the system is not
    // running away, and that is the signal the threshold separates itself from.
    assert.equal(consecutiveRuleSkips(plays(true, true, true, true, false)), 0);
  });

  it('⚠️ is ORDER SENSITIVE, and the contract is oldest-first', () => {
    const oldestFirst = plays(false, true, true);
    const reversed = [...oldestFirst].reverse();
    assert.equal(consecutiveRuleSkips(oldestFirst), 2);
    assert.equal(consecutiveRuleSkips(reversed), 0, 'a reversed array must not silently agree');
  });
});

describe('PBT-47 — only rule-caused skips count', () => {
  it('a user skip is not counted and resets the run', () => {
    // The input type names the narrower fact (`skippedByRule`), so passing a user skip means
    // explicitly asserting a rule caused it. The repository query is what filters on
    // skip_source = 'rule' (BR-35.3); there are 31 user skips in the corpus and 0 rule skips.
    assert.equal(consecutiveRuleSkips(plays(true, true, false)), 0);
  });

  it('an empty window counts nothing', () => {
    assert.equal(ruleSkipsInWindow([], 1_000_000), 0);
  });
});

describe('PBT-46b — the window is ROLLING, not a calendar hour', () => {
  const now = Date.parse('2026-10-02T11:00:00.000Z');

  it('counts attempts inside the window', () => {
    const fired = [now - 5 * MIN, now - 30 * MIN, now - 59 * MIN];
    assert.equal(ruleSkipsInWindow(fired, now), 3);
  });

  it('excludes attempts older than the window', () => {
    const fired = [now - 61 * MIN, now - 120 * MIN];
    assert.equal(ruleSkipsInWindow(fired, now), 0);
  });

  it('⚠️ the window is half-open: exactly windowMs old has aged OUT', () => {
    // Otherwise two adjacent evaluations can both count the same attempt.
    assert.equal(ruleSkipsInWindow([now - RULE_SKIP_WINDOW_MS], now), 0);
    assert.equal(ruleSkipsInWindow([now - RULE_SKIP_WINDOW_MS + 1], now), 1);
  });

  it('includes an attempt at exactly now', () => {
    assert.equal(ruleSkipsInWindow([now], now), 1);
  });

  it('ignores attempts in the future', () => {
    assert.equal(ruleSkipsInWindow([now + MIN], now), 0);
  });

  it('⚠️ catches the burst a CALENDAR hour would miss', () => {
    // Ten at 10:55 and ten at 11:05. A calendar-hour counter sees two compliant hours; a rolling
    // window at 11:05 sees twenty in ten minutes.
    const at1055 = Date.parse('2026-10-02T10:55:00.000Z');
    const at1105 = Date.parse('2026-10-02T11:05:00.000Z');
    const fired = [
      ...Array.from({ length: 10 }, () => at1055),
      ...Array.from({ length: 10 }, () => at1105),
    ];
    assert.equal(ruleSkipsInWindow(fired, at1105), 20);
    assert.ok(20 >= MAX_RULE_SKIPS_PER_HOUR, 'and that must trip the limit');
  });

  it('is order independent', () => {
    const fired = [now - 30 * MIN, now - 5 * MIN, now - 59 * MIN];
    assert.equal(ruleSkipsInWindow(fired, now), ruleSkipsInWindow([...fired].reverse(), now));
  });
});

describe('evaluateHalt', () => {
  it('does not halt below both thresholds', () => {
    assert.equal(evaluateHalt(MAX_CONSECUTIVE_RULE_SKIPS - 1, MAX_RULE_SKIPS_PER_HOUR - 1), null);
  });

  it('halts at the consecutive threshold, carrying the limit in force', () => {
    const halt = evaluateHalt(MAX_CONSECUTIVE_RULE_SKIPS, 0);
    assert.deepEqual(halt, {
      trigger: 'consecutive',
      observedCount: MAX_CONSECUTIVE_RULE_SKIPS,
      threshold: MAX_CONSECUTIVE_RULE_SKIPS,
    });
  });

  it('halts at the hourly threshold', () => {
    const halt = evaluateHalt(0, MAX_RULE_SKIPS_PER_HOUR);
    assert.equal(halt?.trigger, 'hourly-rate');
    assert.equal(halt?.threshold, MAX_RULE_SKIPS_PER_HOUR);
  });

  it('halts ABOVE a threshold too, not only exactly at it', () => {
    assert.equal(evaluateHalt(99, 0)?.trigger, 'consecutive');
    assert.equal(evaluateHalt(0, 99)?.trigger, 'hourly-rate');
  });

  it('⚠️ reports CONSECUTIVE first when both trip — it is the sharper signal', () => {
    const halt = evaluateHalt(MAX_CONSECUTIVE_RULE_SKIPS, MAX_RULE_SKIPS_PER_HOUR);
    assert.equal(halt?.trigger, 'consecutive');
  });

  it('⚠️ records the threshold so a later change cannot rewrite history', () => {
    // The thresholds are pre-registered. If someone raises the constant after a halt, the stored
    // record must still show the halt was against the old number.
    const halt = evaluateHalt(5, 0, { maxConsecutive: 5 });
    assert.equal(halt?.threshold, 5);
    assert.equal(halt?.observedCount, 5);
  });

  it('⚠️ the hourly limit is reachable by a broad-but-legitimate rule', () => {
    // Busiest rolling hour measured at 27 plays. A rule matching 40% of tracks fires ~11 times.
    const firedInBusiestHour = Math.round(27 * 0.4);
    assert.ok(firedInBusiestHour >= MAX_RULE_SKIPS_PER_HOUR);
    assert.equal(evaluateHalt(0, firedInBusiestHour)?.trigger, 'hourly-rate');
    // That is information about the rule, not grounds to raise the limit (BR-35).
  });
});
