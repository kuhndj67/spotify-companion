/**
 * Export serialisation tests (BR-6, property P-10).
 *
 * The centre of gravity here is `renderMaybe`. Everything else is formatting; that one function
 * is the difference between an export in which missing data is visible and one in which it
 * silently biases every downstream conclusion.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import {
  CSV_COLUMNS,
  UNKNOWN_TOKEN,
  coverageAsCsvComments,
  csvEscape,
  renderMaybe,
  toCsvHeader,
  toCsvRow,
  toJsonObject,
} from '../src/export/serialisers.js';
import type { CoverageStats, PlayRecord } from '../src/history/types.js';

function play(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    id: 1,
    trackId: 'abcdefghijklmnopqrstuv',
    isrc: 'USUM71703861',
    title: 'A Track',
    artistName: 'An Artist',
    artistId: 'artist1',
    albumName: 'An Album',
    releaseDate: '2019-05-17',
    ageYears: 7,
    following: true,
    startedAt: '2026-08-25T10:00:00.000Z',
    endedAt: '2026-08-25T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    provenance: 'live',
    skipSource: null,
    contextType: 'playlist',
    classifierVersion: 1,
    evidence: {
      listenedMs: 180_000,
      durationMs: 180_000,
      completionRatio: 1,
      maxProgressMs: 180_000,
      maxObservationGapMs: 3000,
      observationCount: 60,
      sawPause: false,
      rewound: false,
      endedWithIdle: false,
    },
    ...overrides,
  };
}

describe('renderMaybe — the rule that carries the analytical weight', () => {
  it('renders null and undefined as the unknown token', () => {
    assert.equal(renderMaybe(null), UNKNOWN_TOKEN);
    assert.equal(renderMaybe(undefined), UNKNOWN_TOKEN);
  });

  it('does NOT render false or zero as unknown', () => {
    // The specific defect this function exists to prevent. `false` and `0` are values; conflating
    // them with absence makes R2's missing-data bias invisible downstream.
    assert.equal(renderMaybe(false), 'false');
    assert.equal(renderMaybe(0), '0');
    assert.equal(renderMaybe(''), '');
  });

  it('the unknown token is not something a value could collide with', () => {
    assert.notEqual(UNKNOWN_TOKEN, '');
    assert.notEqual(UNKNOWN_TOKEN, 'false');
    assert.notEqual(UNKNOWN_TOKEN, '0');
  });
});

describe('CSV', () => {
  it('the header and every row have the same field count', () => {
    const header = toCsvHeader().split(',');
    assert.equal(header.length, CSV_COLUMNS.length);
  });

  it('escapes commas, quotes and newlines', () => {
    assert.equal(csvEscape('plain'), 'plain');
    assert.equal(csvEscape('a,b'), '"a,b"');
    assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
    assert.equal(csvEscape('line\nbreak'), '"line\nbreak"');
  });

  it('a title containing a comma does not shift the columns', () => {
    const row = toCsvRow(play({ title: 'Hello, Goodbye' }));
    // Naive splitting would show an extra field; proper parsing keeps the count.
    const fields = parseCsvLine(row);
    assert.equal(fields.length, CSV_COLUMNS.length);
    assert.equal(fields[CSV_COLUMNS.indexOf('title')], 'Hello, Goodbye');
  });

  it('unknown fields render as the token, not as blanks', () => {
    const row = parseCsvLine(toCsvRow(play({ isrc: null, following: null, ageYears: null })));
    assert.equal(row[CSV_COLUMNS.indexOf('isrc')], UNKNOWN_TOKEN);
    assert.equal(row[CSV_COLUMNS.indexOf('following')], UNKNOWN_TOKEN);
    assert.equal(row[CSV_COLUMNS.indexOf('age_years')], UNKNOWN_TOKEN);
  });

  it('following=false is distinguishable from following=unknown', () => {
    const asFalse = parseCsvLine(toCsvRow(play({ following: false })));
    const asUnknown = parseCsvLine(toCsvRow(play({ following: null })));
    assert.equal(asFalse[CSV_COLUMNS.indexOf('following')], 'false');
    assert.equal(asUnknown[CSV_COLUMNS.indexOf('following')], UNKNOWN_TOKEN);
  });

  it('exports a ratio above 1.0 unclamped', () => {
    const row = parseCsvLine(
      toCsvRow(play({ evidence: { ...play().evidence, completionRatio: 2.4 } })),
    );
    assert.equal(row[CSV_COLUMNS.indexOf('completion_ratio')], '2.4');
  });
});

describe('JSON', () => {
  it('renders unknown as the token so CSV and JSON agree', () => {
    const object = toJsonObject(play({ isrc: null }));
    assert.equal(object.isrc, UNKNOWN_TOKEN);
  });

  it('includes the full evidence block (FR-50)', () => {
    const object = toJsonObject(play()) as { evidence: Record<string, unknown> };
    for (const key of [
      'listened_ms',
      'duration_ms',
      'completion_ratio',
      'max_progress_ms',
      'max_observation_gap_ms',
      'observation_count',
      'saw_pause',
      'rewound',
      'ended_with_idle',
    ]) {
      assert.ok(key in object.evidence, `evidence.${key} missing from export`);
    }
  });
});

describe('coverage comments', () => {
  it('includes counts and explains the unknown token', () => {
    const coverage: CoverageStats = {
      totalPlays: 10,
      byOutcome: { completed: 5, skipped: 4, unknown: 1 },
      byProvenance: { live: 9, backfilled: 1 },
      unknownIsrc: 2,
      unknownFollowing: 3,
      unknownReleaseDate: 0,
      unknownSkipSource: 6,
      countedGaps: 0,
    };
    const text = coverageAsCsvComments(coverage);
    assert.match(text, /# total_plays: 10/);
    assert.match(text, /# unknown_isrc: 2/);
    assert.match(text, /not the same as false or zero/);
    for (const line of text.split('\n')) assert.ok(line.startsWith('#'));
  });
});

describe('P-10: unknown is always distinguishable', () => {
  it('holds for every nullable field, for any value', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ maxLength: 20 }), { nil: null }),
        fc.option(fc.boolean(), { nil: null }),
        fc.option(fc.integer({ min: -5, max: 100 }), { nil: null }),
        (isrc, following, ageYears) => {
          const row = parseCsvLine(toCsvRow(play({ isrc, following, ageYears })));

          const check = (index: number, value: unknown): void => {
            if (value === null) assert.equal(row[index], UNKNOWN_TOKEN);
            else assert.notEqual(row[index], UNKNOWN_TOKEN);
          };

          check(CSV_COLUMNS.indexOf('following'), following);
          check(CSV_COLUMNS.indexOf('age_years'), ageYears);
          // A string field could legitimately *contain* the token; only null must render as it.
          if (isrc === null) assert.equal(row[CSV_COLUMNS.indexOf('isrc')], UNKNOWN_TOKEN);
        },
      ),
    );
  });

  it('every row has exactly the header field count, for any title', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (title) => {
        assert.equal(parseCsvLine(toCsvRow(play({ title }))).length, CSV_COLUMNS.length);
      }),
    );
  });
});

/** Minimal RFC 4180 reader, so the tests parse rather than split on commas. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = false;
      } else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return fields;
}
