/**
 * Fact reconstruction and per-row answerability (LC-17, BR-27.4/27.5).
 *
 * ⚠️ The answerability tests carry most of this file's weight. `unanswerable` and `unknown`
 * both read as `null` in the column and they are **not the same fact**: one says the row could
 * never answer, the other says it was asked and the answer was nothing. Merging them turns
 * *"your rule could not be asked"* into *"your rule matched nothing"* — a wrong answer that
 * reads as a finding, and the family that produced the 28%→12%-where-the-truth-was-86%→44%
 * coverage bug.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reconstruct, unanswerableFields } from '../src/rules/factReconstructor.js';
import type { HistoryCounts, LabelFields, PlayRecord } from '../src/history/types.js';

const NO_COUNTS: HistoryCounts = {
  playsOfTrack: null,
  skipsOfTrack: null,
  playsOfArtist: null,
  skipsOfArtist: null,
};

function label(overrides: Partial<LabelFields> = {}): LabelFields {
  return {
    verdict: null,
    confidence: null,
    contested: null,
    names: null,
    matchMethod: null,
    narrowingTier: null,
    unknownReason: null,
    resolutionId: null,
    classifierVersion: null,
    artistResolutionId: null,
    likedAtStart: null,
    likedAtEnd: null,
    likedAddedAt: null,
    likedTransition: null,
    artistGenres: null,
    ...overrides,
  };
}

function row(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    id: 100,
    trackId: 'abcdefghijklmnopqrstuv',
    isrc: 'USUM71703861',
    title: 'A Track',
    artistName: 'An Artist',
    artistId: 'artist1234567890123456',
    albumName: 'An Album',
    releaseDate: '2019-05-17',
    ageYears: 7,
    following: true,
    explicit: false,
    albumType: 'album',
    startedAt: '2026-09-20T10:00:00.000Z',
    endedAt: '2026-09-20T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    provenance: 'live',
    skipSource: null,
    contextType: null,
    classifierVersion: 1,
    evidence: {
      listenedMs: 180_000,
      durationMs: 180_000,
      completionRatio: 1,
      maxProgressMs: 180_000,
      maxObservationGapMs: 5_000,
      observationCount: 30,
      sawPause: false,
      rewound: false,
      endedWithIdle: false,
    },
    label: label({ verdict: 'major', confidence: 'high', names: ['Atlantic'] }),
    ...overrides,
  };
}

describe('reconstruct', () => {
  it('maps a stored row onto the facts a rule reads', () => {
    const facts = reconstruct(row(), NO_COUNTS);

    assert.equal(facts.track.title, 'A Track');
    assert.equal(facts.track.explicit, false);
    assert.equal(facts.album.type, 'album');
    assert.equal(facts.label.classification, 'major');
    assert.equal(facts.label.name, 'Atlantic');
  });

  /**
   * ⚠️ NFR-26. The evaluation instant is the play's **start**, not the wall clock — a
   * reconstruction is *of* a past play, and a clock here would make two back-tests of the same
   * range differ.
   */
  it('evaluates as of the play start, not now', () => {
    const facts = reconstruct(row({ startedAt: '2020-01-01T00:00:00.000Z' }), NO_COUNTS);

    assert.equal(facts.evaluatedAtMs, Date.parse('2020-01-01T00:00:00.000Z'));
  });

  it('is deterministic — the same row twice gives the same facts', () => {
    assert.deepEqual(reconstruct(row(), NO_COUNTS), reconstruct(row(), NO_COUNTS));
  });

  /**
   * ⚠️ `null` (never asked) and `[]` (asked, none) must stay distinct — collapsing them is the
   * 2026-09-06 unknown-merge in a new place.
   */
  it('keeps "no genres known" distinct from "asked, and there are none"', () => {
    const never = reconstruct(row({ label: label({ artistGenres: null }) }), NO_COUNTS);
    const none = reconstruct(row({ label: label({ artistGenres: [] }) }), NO_COUNTS);

    assert.equal(never.artist.genres, null);
    assert.deepEqual(none.artist.genres, []);
  });

  it('passes history counts straight through, nulls included', () => {
    const facts = reconstruct(row(), {
      playsOfTrack: 4,
      skipsOfTrack: 0,
      playsOfArtist: null,
      skipsOfArtist: null,
    });

    assert.equal(facts.history.playsOfTrack, 4);
    assert.equal(facts.history.skipsOfTrack, 0, 'asked and answered');
    assert.equal(facts.history.playsOfArtist, null, 'never asked is not zero');
  });

  /** An unrecognised stored string is unknown, never coerced into a member of the union. */
  it('narrows an unrecognised verdict to unknown rather than trusting it', () => {
    const facts = reconstruct(row({ label: label({ verdict: 'something-else' }) }), NO_COUNTS);

    assert.equal(facts.label.classification, null);
  });

  it('survives a row with no label block at all', () => {
    assert.doesNotThrow(() => reconstruct(row({ label: undefined }), NO_COUNTS));
  });
});

describe('unanswerableFields — schema era (BR-27.5a/5c)', () => {
  it('marks explicit and album.type unanswerable at or below the watermark', () => {
    const fields = unanswerableFields(row({ id: 50 }), 120);

    assert.ok(fields.includes('track.explicit'));
    assert.ok(fields.includes('album.type'));
  });

  it('leaves them answerable above the watermark', () => {
    const fields = unanswerableFields(row({ id: 200 }), 120);

    assert.ok(!fields.includes('track.explicit'));
    assert.ok(!fields.includes('album.type'));
  });

  /**
   * ⚠️ The reason the watermark is an id and not a date. The backfill inserts rows dated in the
   * past, so a row written after migration 005 for an older play genuinely carries both values.
   */
  it('judges by row id, so an OLD play recorded recently is still answerable', () => {
    const backfilledLater = row({ id: 300, startedAt: '2026-08-01T10:00:00.000Z' });

    const fields = unanswerableFields(backfilledLater, 120);

    assert.ok(
      !fields.includes('track.explicit'),
      'a date-based rule would wrongly call this unanswerable',
    );
  });

  /** A missing watermark makes era undecidable, and the safe guess is the cautious one. */
  it('treats a missing watermark as unanswerable rather than assuming answerable', () => {
    const fields = unanswerableFields(row({ id: 999 }), null);

    assert.ok(fields.includes('track.explicit'));
  });
});

describe('unanswerableFields — the label provenance gap (BR-27.5b/5d)', () => {
  /**
   * ⚠️ Measured on the live corpus 2026-09-20: 82 backfilled rows dated 2026-08-20 → 08-31
   * carry no ISRC, and on every one both `verdict` and `unknownReason` are null — never asked.
   * No `ALTER TABLE` marks that boundary, so no schema watermark can find it.
   */
  it('marks label.* unanswerable on a row that was never asked', () => {
    const neverAsked = row({
      id: 300,
      isrc: null,
      label: label({ verdict: null, unknownReason: null }),
    });

    const fields = unanswerableFields(neverAsked, 120);

    assert.ok(fields.includes('label.classification'));
    assert.ok(fields.includes('label.name'));
    assert.ok(fields.includes('label.confidence'));
  });

  /**
   * ⚠️ The distinction the whole design rests on. `notFound` means MusicBrainz was asked and
   * has no label — that is a **finding**, and R2 is about exactly this. Reporting it as
   * unanswerable would erase the measurement.
   */
  it('does NOT mark label.* unanswerable when the lookup ran and found nothing', () => {
    const asked = row({ id: 300, label: label({ verdict: null, unknownReason: 'notFound' }) });

    const fields = unanswerableFields(asked, 120);

    assert.ok(!fields.includes('label.classification'), 'notFound is a finding, not an absence of asking');
  });

  it('does not mark label.* unanswerable when there is a verdict', () => {
    const fields = unanswerableFields(row({ id: 300 }), 120);

    assert.ok(!fields.includes('label.classification'));
  });

  /**
   * ⚠️ The **pair** of nulls is the discriminator. `verdict === null` alone would also catch a
   * row whose lookup failed transiently and may yet resolve — that row is unknown, not
   * unanswerable.
   */
  it('uses the pair of nulls, not the verdict alone', () => {
    const transientlyFailed = row({
      id: 300,
      label: label({ verdict: null, unknownReason: 'noEligibleCandidate' }),
    });

    assert.ok(!unanswerableFields(transientlyFailed, 120).includes('label.classification'));
  });

  it('treats a row with no label block as never asked', () => {
    const fields = unanswerableFields(row({ id: 300, label: undefined }), 120);

    assert.ok(fields.includes('label.classification'));
  });

  /** Both eras can apply to one row, and they are independent. */
  it('reports both eras on an old, never-asked row', () => {
    const fields = unanswerableFields(
      row({ id: 10, isrc: null, label: label({ verdict: null, unknownReason: null }) }),
      120,
    );

    assert.deepEqual(new Set(fields), new Set([
      'track.explicit',
      'album.type',
      'label.name',
      'label.classification',
      'label.confidence',
    ]));
  });

  it('reports nothing for a fully answerable modern row', () => {
    assert.deepEqual(unanswerableFields(row({ id: 500 }), 120), []);
  });
});
