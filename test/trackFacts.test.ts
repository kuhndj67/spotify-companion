/**
 * Fact assembly — the module whose whole job is to NOT do anything clever.
 *
 * The property under test is mostly negative: nothing is defaulted, nothing is computed, nothing
 * is fetched. That sounds untestable and is not — a `0` substituted for an absent history count
 * would make *"never skipped this track"* silently true for a track never played (US-16), which
 * is the same error as writing `completed` onto a backfilled play row.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import './fc-config.js';
import { assembleFacts, type FactSources } from '../src/rules/trackFacts.js';
import { allFields } from '../src/rules/fieldCatalogue.js';

const EMPTY: FactSources = {
  trackId: 't1',
  title: 'Song',
  durationMs: 200_000,
  explicit: null,
  isrc: null,

  artistId: null,
  artistName: 'Artist',
  following: null,
  genres: null,

  albumName: 'Album',
  releaseDate: null,
  ageYears: null,
  albumType: null,

  labelName: null,
  labelClassification: null,
  labelConfidence: null,

  likedAtStart: null,
  likedTransition: null,

  playsOfTrack: null,
  skipsOfTrack: null,
  playsOfArtist: null,
  skipsOfArtist: null,

  evaluatedAtMs: 1_700_000_000_000,
};

describe('nothing is defaulted (BR-21.5)', () => {
  it('every absent input stays null — never 0, never false, never ""', () => {
    const facts = assembleFacts(EMPTY);

    assert.equal(facts.track.explicit, null);
    assert.equal(facts.track.isrc, null);
    assert.equal(facts.artist.id, null);
    assert.equal(facts.artist.following, null);
    assert.equal(facts.artist.genres, null);
    assert.equal(facts.album.releaseDate, null);
    assert.equal(facts.album.ageYears, null);
    assert.equal(facts.album.type, null);
    assert.equal(facts.label.name, null);
    assert.equal(facts.label.classification, null);
    assert.equal(facts.label.confidence, null);
    assert.equal(facts.liked.atStart, null);
    assert.equal(facts.liked.transition, null);
  });

  it('⚠️ absent history counts are null, NOT zero', () => {
    // A 0 here makes "never skipped this track" true for a track never seen. Zero and unknown
    // are different facts, and this is the module where they would get merged.
    const facts = assembleFacts(EMPTY);
    assert.equal(facts.history.playsOfTrack, null);
    assert.equal(facts.history.skipsOfTrack, null);
    assert.equal(facts.history.playsOfArtist, null);
    assert.equal(facts.history.skipsOfArtist, null);
  });

  it('a genuine zero survives as zero', () => {
    // The mirror of the rule above: 0 must not become null either.
    const facts = assembleFacts({ ...EMPTY, playsOfTrack: 0, skipsOfArtist: 0 });
    assert.equal(facts.history.playsOfTrack, 0);
    assert.equal(facts.history.skipsOfArtist, 0);
  });

  it('⚠️ an empty genre list stays [] and never becomes null', () => {
    // "MusicBrainz was asked and lists none" (131 plays) vs "never asked" (39 plays). Merging
    // them repeats the 2026-09-06 unknown-merge defect.
    const facts = assembleFacts({ ...EMPTY, genres: [] });
    assert.deepEqual(facts.artist.genres, []);
    assert.notEqual(facts.artist.genres, null);
  });

  it('a populated genre list passes through unchanged', () => {
    const facts = assembleFacts({ ...EMPTY, genres: ['hip hop', 'rapcore'] });
    assert.deepEqual(facts.artist.genres, ['hip hop', 'rapcore']);
  });
});

describe('the evaluation instant is data', () => {
  it('is whatever the caller passed, not a clock reading', () => {
    const facts = assembleFacts({ ...EMPTY, evaluatedAtMs: 42 });
    assert.equal(facts.evaluatedAtMs, 42);
  });

  it('assembling the same input twice yields deep-equal facts', () => {
    // If a clock leaked in, this is where it would show.
    assert.deepEqual(assembleFacts(EMPTY), assembleFacts(EMPTY));
  });
});

describe('normalisation is limited to impossible values', () => {
  it('a negative duration is floored at zero', () => {
    // Normalising an impossible value, not defaulting a missing one: a negative duration would
    // make `track.durationMs > x` answerable in a way the data does not support.
    assert.equal(assembleFacts({ ...EMPTY, durationMs: -5 }).track.durationMs, 0);
  });

  it('a valid duration is untouched', () => {
    assert.equal(assembleFacts({ ...EMPTY, durationMs: 123 }).track.durationMs, 123);
  });
});

describe('the catalogue can read everything assembleFacts produces', () => {
  it('every field in the catalogue resolves against assembled facts without throwing', () => {
    // Guards the seam: a field whose `read` walks a path assembleFacts does not populate would
    // silently return undefined and be indistinguishable from absent data.
    const facts = assembleFacts(EMPTY);
    for (const field of allFields()) {
      const value = field.read(facts);
      assert.ok(value === null || value !== undefined, `${field.name} returned undefined`);
    }
  });

  it('every always-available field actually has a value', () => {
    const facts = assembleFacts(EMPTY);
    for (const field of allFields()) {
      if (field.availability === 'always') {
        const value = field.read(facts);
        assert.ok(value !== null && value !== undefined, `${field.name} is declared always`);
      }
    }
  });
});

describe('totality', () => {
  it('never throws, for any well-typed input', () => {
    fc.assert(
      fc.property(
        fc.record({
          durationMs: fc.oneof(fc.integer(), fc.double(), fc.constant(Number.NaN)),
          ageYears: fc.oneof(fc.constant(null), fc.integer()),
          playsOfTrack: fc.oneof(fc.constant(null), fc.integer()),
        }),
        (over) => {
          const facts = assembleFacts({ ...EMPTY, ...over } as FactSources);
          assert.ok(facts.track !== undefined);
        },
      ),
    );
  });
});
