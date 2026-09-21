/**
 * The one-line decision summary written to stdout.
 *
 * This is the line someone reads all day to judge whether their rules are working, so its
 * content is tested rather than assembled inline. Two things it must never do: hide that the
 * deadline fired, and render an unknown as though it were a decisive answer.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDecisionSummary, type DecisionSummaryInput } from '../src/rules/decisionSummary.js';

function input(overrides: Partial<DecisionSummaryInput> = {}): DecisionSummaryInput {
  return {
    trackId: '4cOdK2wGLETKBW3PvgPWqT',
    title: 'Bad Habit',
    artistName: 'Steve Lacy',
    elapsedMs: 4_200,
    partialData: false,
    rules: [
      { name: 'major-label', verdict: 'true', matched: true },
      { name: 'hip-hop', verdict: 'false', matched: false },
      { name: 'old-and-major', verdict: 'unknown', matched: false },
    ],
    ...overrides,
  };
}

describe('formatDecisionSummary', () => {
  it('is one line, always', () => {
    assert.ok(!formatDecisionSummary(input()).includes('\n'));
  });

  it('names the track, the artist and a short id', () => {
    const line = formatDecisionSummary(input());

    assert.match(line, /"Bad Habit" — Steve Lacy/);
    assert.match(line, /4cOdK2wG/, 'enough id to cross-reference a decision_log row');
  });

  it('carries the namespace prefix, so the stream stays greppable', () => {
    assert.ok(formatDecisionSummary(input()).startsWith('[decision] '));
  });

  it('reports every rule with its verdict, matched or not', () => {
    const line = formatDecisionSummary(input());

    assert.match(line, /major-label=true✓/);
    assert.match(line, /hip-hop=false/);
    assert.match(line, /old-and-major=unknown/);
    assert.match(line, /1\/3 matched/);
  });

  /**
   * ⚠️ `matched` is the verdict AFTER `onUnknown` is applied, so it is not simply
   * `verdict === 'true'`. Showing both keeps the mapping visible — otherwise a rule with
   * `onUnknown: 'match'` looks like it fired for no reason.
   */
  it('marks a rule that matched on an unknown, and still shows the raw verdict', () => {
    const line = formatDecisionSummary(
      input({ rules: [{ name: 'cautious', verdict: 'unknown', matched: true }] }),
    );

    assert.match(line, /cautious=unknown✓/);
    assert.match(line, /1\/1 matched/);
  });

  /**
   * ⚠️ The rate of this is the number U4 exists to collect, so it is visually distinct rather
   * than a subtle flag. `partialData` means THE WAIT TIMED OUT — not that a field read null.
   */
  it('makes a deadline decision unmistakable', () => {
    const settled = formatDecisionSummary(input({ partialData: false }));
    const deadline = formatDecisionSummary(input({ partialData: true, elapsedMs: 10_000 }));

    assert.match(settled, /settled 4\.2s/);
    assert.match(deadline, /DEADLINE 10\.0s/);
    assert.ok(!deadline.includes('settled'), 'the two must not be confusable at a glance');
  });

  it('reports the elapsed time, which is the enrichment latency measurement', () => {
    assert.match(formatDecisionSummary(input({ elapsedMs: 250 })), /settled 0\.3s/);
    assert.match(formatDecisionSummary(input({ elapsedMs: 0 })), /settled 0\.0s/);
  });

  /**
   * ⚠️ Still logged. A quiet log is indistinguishable from a broken one, and "no rules
   * evaluated" is exactly what someone expecting matches needs to see.
   */
  it('says so when no rules were evaluated, rather than printing nothing', () => {
    const line = formatDecisionSummary(input({ rules: [] }));

    assert.match(line, /no rules evaluated/);
    assert.ok(!line.includes('0/0'), 'a ratio over nothing reads as a failure to match');
  });

  it('clips a long title and artist so the line stays scannable', () => {
    const line = formatDecisionSummary(
      input({
        title: 'A'.repeat(120),
        artistName: 'B'.repeat(120),
      }),
    );

    assert.ok(line.includes('…'), 'clipped rather than wrapped');
    assert.ok(line.length < 200);
  });

  it('does not produce an empty pair of quotes for a missing title', () => {
    const line = formatDecisionSummary(input({ title: '', artistName: '' }));

    assert.match(line, /"\?" — \?/, 'a blank reads as a rendering bug; a ? reads as missing data');
  });

  /** ⚠️ `docker logs --timestamps` supplies the time, and no other line here carries one. */
  it('carries no timestamp of its own', () => {
    const line = formatDecisionSummary(input());

    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(line), 'consistency with every other line in this app');
  });

  it('is a function of its input alone', () => {
    assert.equal(formatDecisionSummary(input()), formatDecisionSummary(input()));
  });
});
