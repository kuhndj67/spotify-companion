/**
 * Back-testing (LC-18, FR-42, US-24) and the execution trace (LC-19, BR-32).
 *
 * ⚠️ The counters here encode three distinctions this project has already paid for once each,
 * and every one of them reads as a plausible number when merged:
 *   - `undecidable` is not `wouldNotMatch` — "could not be answered" vs "matched nothing".
 *   - `notObserved` is not `inconclusive` — the app's downtime vs the classifier's uncertainty.
 *   - `unanswerableFields` is not `unknownFieldCounts` — no column vs no data.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BackTestService } from '../src/rules/BackTestService.js';
import { buildTrace, groupIntoTraces, renderFieldValue } from '../src/rules/decisionTrace.js';
import { validateRuleSet } from '../src/rules/ruleValidator.js';
import type { HistoryCounts, LabelFields, PlayRecord } from '../src/history/types.js';
import type { DecisionLogEntry, LoadedRule } from '../src/rules/types.js';

const NO_COUNTS: HistoryCounts = {
  playsOfTrack: null,
  skipsOfTrack: null,
  playsOfArtist: null,
  skipsOfArtist: null,
};

const RANGE = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

function ruleOn(field: string, value: unknown): LoadedRule {
  const result = validateRuleSet({
    rules: [
      {
        id: 'r1',
        name: 'Rule one',
        enabled: true,
        action: 'skip',
        onUnknown: 'no-match',
        predicate: { kind: 'compare', field, op: 'eq', value },
      },
    ],
  });
  assert.ok(result.ok);
  return result.value[0]!;
}

function label(overrides: Partial<LabelFields> = {}): LabelFields {
  return {
    verdict: 'major', confidence: 'high', contested: false, names: ['Atlantic'],
    matchMethod: null, narrowingTier: null, unknownReason: null, resolutionId: 1,
    classifierVersion: 1, artistResolutionId: null, likedAtStart: null, likedAtEnd: null,
    likedAddedAt: null, likedTransition: null, artistGenres: null,
    ...overrides,
  };
}

function play(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    id: 500,
    trackId: 'track-1',
    isrc: 'USUM71703861',
    title: 'A Track',
    artistName: 'An Artist',
    artistId: 'artist-1',
    albumName: 'An Album',
    releaseDate: '2019-05-17',
    ageYears: 7,
    following: true,
    explicit: false,
    albumType: 'album',
    skipAttribution: null,
    successorLagMs: null,
    attributionVersion: null,
    startedAt: '2026-09-10T10:00:00.000Z',
    endedAt: '2026-09-10T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    provenance: 'live',
    skipSource: null,
    contextType: null,
    classifierVersion: 1,
    evidence: {
      listenedMs: 180_000, durationMs: 180_000, completionRatio: 1, maxProgressMs: 180_000,
      maxObservationGapMs: 5_000, observationCount: 30, sawPause: false, rewound: false,
      endedWithIdle: false,
    },
    label: label(),
    ...overrides,
  };
}

function service(rows: PlayRecord[], watermark: number | null = 100) {
  return new BackTestService({
    playsInRange: () => rows,
    historyCountsBefore: () => NO_COUNTS,
    v5Watermark: () => watermark,
    now: () => '2026-09-20T12:00:00.000Z',
  });
}

describe('back-test counters', () => {
  it('counts a match against a user skip as agreement', () => {
    const report = service([play({ outcome: 'skipped' })]).run(
      ruleOn('label.classification', 'major'),
      RANGE,
    );

    assert.equal(report.wouldMatch, 1);
    assert.equal(report.agreedWithUserSkip, 1);
    assert.equal(report.disagreedWithUserKeep, 0);
  });

  it('counts a match against a completion as disagreement', () => {
    const report = service([play({ outcome: 'completed' })]).run(
      ruleOn('label.classification', 'major'),
      RANGE,
    );

    assert.equal(report.disagreedWithUserKeep, 1);
  });

  it('counts a skip the rule did not predict as a miss', () => {
    const report = service([play({ outcome: 'skipped' })]).run(
      ruleOn('label.classification', 'independent'),
      RANGE,
    );

    assert.equal(report.wouldNotMatch, 1);
    assert.equal(report.missedUserSkip, 1);
  });

  it('does not count agreement by omission', () => {
    const report = service([play({ outcome: 'completed' })]).run(
      ruleOn('label.classification', 'independent'),
      RANGE,
    );

    assert.equal(report.agreedWithUserSkip, 0);
    assert.equal(report.disagreedWithUserKeep, 0);
    assert.equal(report.missedUserSkip, 0);
  });

  /**
   * ⚠️ BR-28.1. Folding this into `wouldNotMatch` reports "your rule matched nothing" when the
   * truth is "your rule could not be answered" — the `Label detail` dash in a new place.
   */
  it('reports undecidable separately from wouldNotMatch', () => {
    const noLabel = play({ label: label({ verdict: null, unknownReason: 'notFound' }) });

    const report = service([noLabel]).run(ruleOn('label.classification', 'major'), RANGE);

    assert.equal(report.undecidable, 1);
    assert.equal(report.wouldNotMatch, 0, 'unanswered is not answered-no');
  });

  /**
   * ⚠️ BR-28.2 and BR-28.3a together. This counter was permanently zero in the design draft,
   * because the selection was "live plays in range" while the counter reports backfilled rows.
   */
  it('reports notObserved for a backfilled row, separately from inconclusive', () => {
    const rows = [
      play({ id: 1, outcome: 'unknown', provenance: 'backfilled' }),
      play({ id: 2, outcome: 'unknown', provenance: 'live' }),
    ];

    const report = service(rows).run(ruleOn('label.classification', 'major'), RANGE);

    assert.equal(report.notObserved, 1, 'the app was not running');
    assert.equal(report.inconclusive, 1, 'the app watched and could not judge');
  });

  it('iterates every row in range, not only the eligible ones', () => {
    const rows = [
      play({ id: 1, outcome: 'completed' }),
      play({ id: 2, outcome: 'unknown', provenance: 'backfilled' }),
      play({ id: 3, outcome: 'skipped' }),
    ];

    const report = service(rows).run(ruleOn('label.classification', 'major'), RANGE);

    assert.equal(report.evaluated, 3, 'eligibility selects what is COMPARED, not what is read');
  });

  /** FR-23. Zero until U5 is armed, and built now because by then it is already trusted. */
  it('excludes rule-initiated skips from the comparison', () => {
    const rows = [play({ outcome: 'skipped', skipSource: 'rule' })];

    const report = service(rows).run(ruleOn('label.classification', 'major'), RANGE);

    assert.equal(report.excludedRuleInitiated, 1);
    assert.equal(report.agreedWithUserSkip, 0, 'the rule agreeing with itself is not evidence');
  });
});

describe('answerability in the report', () => {
  /** ⚠️ No column is not no data. Reported separately, and only for fields the rule reads. */
  it('reports an unanswerable field the rule references', () => {
    const preV5 = play({ id: 10 });

    const report = service([preV5], 100).run(ruleOn('track.explicit', true), RANGE);

    assert.equal(report.unanswerableFields['track.explicit'], 1);
  });

  it('does not report unanswerable fields the rule never mentions', () => {
    const preV5 = play({ id: 10 });

    const report = service([preV5], 100).run(ruleOn('artist.name', 'An Artist'), RANGE);

    assert.deepEqual(report.unanswerableFields, {});
  });

  it('counts a field that read null as unknown, distinctly from unanswerable', () => {
    const asked = play({ id: 500, label: label({ verdict: null, unknownReason: 'notFound' }) });

    const report = service([asked], 100).run(ruleOn('label.classification', 'major'), RANGE);

    assert.equal(report.unknownFieldCounts['label.classification'], 1, 'asked, and no answer');
    assert.equal(report.unanswerableFields['label.classification'], undefined, 'not "never asked"');
  });
});

describe('determinism and disclosure', () => {
  /** US-24 / NFR-26: the same rule over the same history, twice, must be identical. */
  it('is identical on repeated runs', () => {
    const rows = [play({ id: 1 }), play({ id: 2, outcome: 'skipped' })];
    const svc = service(rows);

    const first = svc.run(ruleOn('label.classification', 'major'), RANGE);
    const second = svc.run(ruleOn('label.classification', 'major'), RANGE);

    assert.deepEqual(second, first);
  });

  /**
   * ⚠️ P-24. The `release_count = 100` bug pre-empted: a cap applied without disclosure
   * records an arbitrary sample as a complete figure.
   */
  it('reports truncated as false when the cap did not fire', () => {
    const report = service([play()]).run(ruleOn('label.classification', 'major'), RANGE);

    assert.equal(report.truncated, false, 'required, never optional and never defaulted');
  });

  it('stamps the rule hash so the report is attributable to what was tested', () => {
    const report = service([play()]).run(ruleOn('label.classification', 'major'), RANGE);

    assert.match(report.ruleHash, /^[0-9a-f]{16}$/);
  });
});

describe('the execution trace (BR-32)', () => {
  function row(overrides: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
    return {
      id: 1,
      evaluationId: 'ev-1',
      decidedAt: '2026-09-20T10:00:00.000Z',
      playId: null,
      playLink: 'pending',
      trackId: 'track-1',
      ruleId: 'r1',
      ruleName: 'Rule one',
      ruleHash: 'abc',
      verdict: 'true',
      matched: true,
      fieldsSeen: { 'label.classification': 'major', 'artist.genres': null },
      unknownFields: ['artist.genres'],
      restedOnUnknown: false,
      partialData: false,
      dryRun: true,
      executed: false,
      error: null,
      engineVersion: 1,
      ruleSetVersion: 2,
      ruleSetContentHash: 'set-hash',
      ...overrides,
    };
  }

  it('renders the trigger as settled when the wait did not expire', () => {
    const trace = buildTrace([row({ partialData: false })])!;

    assert.equal(trace.trigger.kind, 'settled');
  });

  /** ⚠️ `partialData` means the WAIT TIMED OUT, not that a field read null (FQ3). */
  it('renders the trigger as a deadline when the cap fired', () => {
    const trace = buildTrace([row({ partialData: true })])!;

    assert.equal(trace.trigger.kind, 'deadline');
    assert.match(trace.trigger.description, /wait expired/);
  });

  it('shows every field the rule read, nulls as the literal token', () => {
    const trace = buildTrace([row()])!;
    const fields = trace.rules[0]!.fields;

    assert.deepEqual(fields.map((f) => f.name), ['artist.genres', 'label.classification']);
    assert.equal(fields.find((f) => f.name === 'artist.genres')!.display, 'unknown');
    assert.equal(fields.find((f) => f.name === 'label.classification')!.display, 'major');
  });

  it('groups the rows of one decision, and separates two decisions', () => {
    const traces = groupIntoTraces([
      row({ evaluationId: 'ev-1', ruleId: 'a' }),
      row({ evaluationId: 'ev-1', ruleId: 'b' }),
      row({ evaluationId: 'ev-2', ruleId: 'a' }),
    ]);

    assert.equal(traces.length, 2);
    assert.equal(traces[0]!.rules.length, 2);
  });

  it('returns null rather than a hollow trace when there are no rows', () => {
    assert.equal(buildTrace([]), null);
  });

  describe('renderFieldValue', () => {
    it('never renders unknown as blank or false', () => {
      assert.equal(renderFieldValue(null), 'unknown');
      assert.equal(renderFieldValue(undefined), 'unknown');
      assert.notEqual(renderFieldValue(null), renderFieldValue(false));
    });

    /** `[]` means "asked, and there are none" — a different fact from "never asked". */
    it('distinguishes an empty list from unknown', () => {
      assert.equal(renderFieldValue([]), '(none)');
      assert.notEqual(renderFieldValue([]), renderFieldValue(null));
    });

    it('renders false as false', () => {
      assert.equal(renderFieldValue(false), 'false');
    });
  });
});
