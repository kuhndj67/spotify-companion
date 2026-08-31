/**
 * ISRC registrant signal.
 *
 * This is the only signal with 100% coverage — it reads from the play row and needs no request,
 * so it still speaks for the six probe ISRCs MusicBrainz has never heard of. That makes its
 * *restraint* the thing worth testing: it must vote, and it must never be enough on its own.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isValidIsrc, isrcPrefixVote, normaliseIsrc, registrantPrefix } from '../src/musicbrainz/isrcPrefix.js';

describe('ISRC parsing', () => {
  it('accepts a well-formed ISRC', () => {
    assert.ok(isValidIsrc('USUM71903783'));
  });

  it('accepts the hyphenated presentation form', () => {
    // Spotify and MusicBrainz disagree about formatting; both must resolve to the same key.
    assert.equal(normaliseIsrc('US-UM7-19-03783'), 'USUM71903783');
    assert.ok(isValidIsrc('US-UM7-19-03783'));
  });

  it('rejects strings that are not ISRCs', () => {
    assert.equal(isValidIsrc('NOT-AN-ISRC'), false);
    assert.equal(isValidIsrc('USUM7190378'), false, 'too short');
    assert.equal(isValidIsrc('USUM719037834'), false, 'too long');
    assert.equal(isValidIsrc(''), false);
  });

  it('returns null rather than a truncated guess for a malformed ISRC', () => {
    // A malformed ISRC producing a plausible-looking prefix is exactly the "confident wrong
    // data" failure this unit exists to avoid.
    assert.equal(registrantPrefix('NOPE'), null);
    assert.equal(registrantPrefix('USUM7190378'), null);
  });
});

describe('registrant votes', () => {
  it('votes major for a Universal registrant', () => {
    const vote = isrcPrefixVote('USUM71903783');
    assert.equal(vote?.verdict, 'major');
    assert.match(vote!.evidence!, /Universal/);
  });

  it('votes major for Sony and Warner registrants', () => {
    assert.equal(isrcPrefixVote('USSM12000001')?.verdict, 'major');
    assert.equal(isrcPrefixVote('USAT21900001')?.verdict, 'major');
  });

  it('votes independent for a DIY distribution block', () => {
    // All five QZ* ISRCs in the probe missed MusicBrainz entirely, consistent with recent
    // self-released material.
    const vote = isrcPrefixVote('QZK6P2312345');
    assert.equal(vote?.verdict, 'independent');
  });

  it('votes unknown for an unrecognised registrant', () => {
    const vote = isrcPrefixVote('SEBBB1900001');
    assert.equal(vote?.verdict, 'unknown');
  });

  it('always votes weak, never strong', () => {
    // A registrant code says who REGISTERED the recording, not who the artist is signed to.
    // Majors register on behalf of distributed independents. Under the standing precision rule
    // a correlation does not get to outvote a label name.
    for (const isrc of ['USUM71903783', 'QZK6P2312345', 'SEBBB1900001']) {
      assert.equal(isrcPrefixVote(isrc)?.strength, 'weak', isrc);
    }
  });
});

describe('no vote is different from a vote of unknown', () => {
  // "This signal looked and had no opinion" and "this signal could not run" are different
  // facts, and only the first should appear in a trace.
  it('returns null when there is no ISRC at all', () => {
    assert.equal(isrcPrefixVote(null), null);
  });

  it('returns null when the ISRC is malformed', () => {
    assert.equal(isrcPrefixVote('GARBAGE'), null);
  });

  it('returns a vote of unknown when the ISRC is valid but unrecognised', () => {
    const vote = isrcPrefixVote('SEBBB1900001');
    assert.notEqual(vote, null);
    assert.equal(vote?.verdict, 'unknown');
  });
});

describe('longest-prefix matching', () => {
  it('prefers a specific registrant over a broader block', () => {
    // USUM (Universal) must not be shadowed by a broader entry, and adding a broader block
    // later must not silently change verdicts that already exist in the database.
    const vote = isrcPrefixVote('USUM71903783');
    assert.equal(vote?.verdict, 'major');
    assert.match(vote!.evidence!, /USUM/);
  });
});
