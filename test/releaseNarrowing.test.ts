/**
 * Release narrowing cascade.
 *
 * The measured problem: a recording maps to every pressing anyone ever released.
 * **Audioslave → 44 releases → 10 labels spanning two different majors. Slipknot → 50 → 12.**
 * Voting over all of them answers "who has ever pressed this?", which is not the question.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  type ReleaseSummary,
  datesMatch,
  narrowReleases,
  normaliseTitle,
} from '../src/musicbrainz/releaseNarrowing.js';

function release(
  releaseId: string,
  title: string | null,
  date: string | null,
  labelNames: string[],
): ReleaseSummary {
  return {
    releaseId,
    title,
    date,
    status: 'Official',
    labels: labelNames.map((labelName) => ({
      labelName,
      labelMbid: null,
      labelType: 'Imprint' as const,
      catalogNumber: null,
    })),
  };
}

describe('date matching compares at the coarser precision', () => {
  it('treats a year-only date as matching a full date in that year', () => {
    // Spotify reports release_date at varying precision; MusicBrainz is equally variable.
    // String comparison would fail on data that actually agrees.
    assert.ok(datesMatch('2022', '2022-03-14'));
    assert.ok(datesMatch('2022-03', '2022-03-14'));
  });

  it('ignores zero-padding differences', () => {
    assert.ok(datesMatch('2022-3-14', '2022-03-14'));
  });

  it('rejects genuinely different dates', () => {
    assert.equal(datesMatch('2021', '2022-03-14'), false);
    assert.equal(datesMatch('2022-04', '2022-03-14'), false);
  });

  it('treats a missing date as no match rather than a wildcard', () => {
    assert.equal(datesMatch(null, '2022-03-14'), false);
    assert.equal(datesMatch('2022', null), false);
  });
});

describe('title normalisation', () => {
  it('ignores punctuation and case', () => {
    assert.equal(normaliseTitle('Wake Up!'), normaliseTitle('wake up'));
  });

  it('keeps parenthetical suffixes distinct', () => {
    // `(Deluxe Edition)` and the standard edition are different releases that genuinely can
    // carry different labels. Collapsing them is the over-matching that puts two majors on one
    // verdict.
    assert.notEqual(normaliseTitle('Iowa'), normaliseTitle('Iowa (Deluxe Edition)'));
  });
});

describe('the cascade', () => {
  // Modelled on the Audioslave case: many releases, several labels, two corporate parents.
  const audioslave = [
    release('r1', 'Audioslave', '2002-11-19', ['Epic', 'Interscope']),
    release('r2', 'Audioslave', '2002', ['Epic']),
    release('r3', 'Audioslave (Deluxe)', '2010-06-01', ['Epic', 'Legacy']),
    release('r4', 'Revelations', '2006-09-05', ['Epic']),
  ];

  it('tier 1 narrows on title AND exact date', () => {
    const result = narrowReleases(audioslave, 'Audioslave', '2002-11-19');
    assert.equal(result.tier, 'title-date');
    assert.deepEqual(
      result.candidates.map((c) => c.releaseId),
      ['r1', 'r1', 'r2'],
      'the year-only r2 also matches at coarse precision, which is correct',
    );
  });

  it('tier 2 falls back to title only when the date does not match', () => {
    // Year-only dates and deluxe reissues are why title+date fired on only 8 of 13.
    const result = narrowReleases(audioslave, 'Audioslave', '1999-01-01');
    assert.equal(result.tier, 'title');
    assert.ok(result.candidates.every((c) => c.releaseTitle === 'Audioslave'));
  });

  it('tier 3 falls back to every release when the title does not match', () => {
    const result = narrowReleases(audioslave, 'Some Other Album', '2002-11-19');
    assert.equal(result.tier, 'all');
    assert.equal(result.candidates.length, 6);
  });

  it('always reports the pre-narrowing release count as the ambiguity measure', () => {
    for (const albumTitle of ['Audioslave', 'Some Other Album', null]) {
      const result = narrowReleases(audioslave, albumTitle, '2002-11-19');
      assert.equal(result.releaseCount, 4);
    }
  });

  it('reports tier `none` when there are no releases at all', () => {
    const result = narrowReleases([], 'Anything', '2022-01-01');
    assert.equal(result.tier, 'none');
    assert.deepEqual(result.candidates, []);
  });
});

describe('a tier only fires if it produced usable labels', () => {
  // A tier that matches a release carrying no label information has found a row and learned
  // nothing. Stopping there would record a misleadingly precise tier alongside an empty
  // candidate set — a high-confidence verdict resting on no evidence.
  const releases = [
    release('r1', 'An Album', '2022-03-14', []),
    release('r2', 'An Album', '2019-01-01', ['Sub Pop']),
    release('r3', 'Other', '2020-01-01', ['Epitaph']),
  ];

  it('falls through when the exact match carries no labels', () => {
    const result = narrowReleases(releases, 'An Album', '2022-03-14');
    assert.equal(result.tier, 'title', 'title-date matched r1, which has no labels');
    assert.deepEqual(
      result.candidates.map((c) => c.labelName),
      ['Sub Pop'],
    );
  });

  it('falls through to `all` when no title match carries labels', () => {
    const unlabelled = [release('r1', 'An Album', '2022-03-14', []), release('r2', 'Other', '2020-01-01', ['Epitaph'])];
    const result = narrowReleases(unlabelled, 'An Album', '2022-03-14');
    assert.equal(result.tier, 'all');
    assert.deepEqual(
      result.candidates.map((c) => c.labelName),
      ['Epitaph'],
    );
  });
});

describe('Slipknot — the case title-only narrowing gets right', () => {
  // 50 releases, 12 labels. Narrowing by album title alone cut it to the single correct label.
  it('reduces a wide release set to one label', () => {
    const slipknot = [
      release('r1', 'Iowa', '2001-08-28', ['Roadrunner Records']),
      release('r2', 'Iowa (Deluxe Edition)', '2011-01-01', ['Roadrunner Records', 'Jigu Records']),
      release('r3', 'All Hope Is Gone', '2008-08-20', ['Roadrunner Records', 'Smokin Cactus']),
    ];
    const result = narrowReleases(slipknot, 'Iowa', null);
    assert.equal(result.tier, 'title');
    assert.deepEqual(
      result.candidates.map((c) => c.labelName),
      ['Roadrunner Records'],
    );
  });
});
