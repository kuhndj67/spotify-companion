/**
 * Resolution trace (BR-12).
 *
 * Added at the Functional Design gate by user request. Two things it must do that are easy to
 * omit, and both are tested here rather than assumed:
 *
 *  1. show what the rules **refused**, not only what they found — the precision rule works by
 *     exclusion, which leaves no mark in a verdict;
 *  2. flag when it is explaining an old play with **newer rules**, because R3 guarantees the
 *     classifier gets re-tuned and a recomputed trace would otherwise present today's reasoning
 *     as history.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrace, summariseTrace } from '../src/musicbrainz/resolutionTrace.js';
import { MAJOR_ROOTS } from '../src/musicbrainz/majorRootList.js';
import type {
  ArtistLabelResolution,
  LabelCandidate,
  LabelResolution,
  LabelType,
} from '../src/musicbrainz/types.js';

function candidate(labelName: string, labelType: LabelType = 'Imprint'): LabelCandidate {
  return {
    labelName,
    labelMbid: null,
    labelType,
    catalogNumber: null,
    releaseId: 'r1',
    releaseTitle: 'An Album',
    releaseDate: '2022-03-14',
    releaseStatus: 'Official',
  };
}

function resolution(candidates: LabelCandidate[], over: Partial<LabelResolution> = {}): LabelResolution {
  return {
    id: 7,
    isrc: 'USUM71903783',
    recordingMbid: 'mbid-1',
    matchMethod: 'isrc',
    narrowingTier: 'title-date',
    releaseCount: 44,
    resolvedAt: '2026-08-31T00:00:00.000Z',
    status: 'resolved',
    supersedesId: null,
    candidates,
    votes: [],
    ...over,
  };
}

const base = {
  playId: 1,
  scope: 'release' as const,
  storedClassifierVersion: 1,
  runningClassifierVersion: 1,
  majorRoots: MAJOR_ROOTS,
  isrcVote: null,
};

describe('BR-12.3 — the trace shows what the rules refused', () => {
  it('names the rule that suppressed a Publisher candidate', () => {
    // Faouzia: her only label is `Faouzia Music`, type Publisher; she records for Atlantic.
    // The verdict is `unknown`, which is correct — but without this field it is
    // indistinguishable from "MusicBrainz knew nothing".
    const trace = buildTrace({
      ...base,
      resolution: resolution([candidate('Faouzia Music', 'Publisher')]),
    });

    const refused = trace.candidates.filter((c) => !c.eligible);
    assert.equal(refused.length, 1);
    assert.equal(refused[0]?.labelName, 'Faouzia Music');
    assert.equal(refused[0]?.suppressedBy, 'BR-3.1');
  });

  it('distinguishes a refused candidate from an absent one', () => {
    const refusedTrace = buildTrace({
      ...base,
      resolution: resolution([candidate('Faouzia Music', 'Publisher')]),
    });
    const emptyTrace = buildTrace({ ...base, resolution: resolution([]) });

    // Same verdict...
    assert.equal(refusedTrace.fold?.verdict, 'unknown');
    assert.equal(emptyTrace.fold?.verdict, 'unknown');
    // ...entirely different accounts of why.
    assert.equal(refusedTrace.candidates.length, 1);
    assert.equal(emptyTrace.candidates.length, 0);
    assert.notEqual(refusedTrace.unknownReason, emptyTrace.unknownReason);
  });

  it('names the rule that suppressed the [no label] sentinel', () => {
    const trace = buildTrace({ ...base, resolution: resolution([candidate('[no label]', null)]) });
    assert.equal(trace.candidates[0]?.suppressedBy, 'BR-3.2');
  });

  it('marks eligible candidates as eligible with no suppressing rule', () => {
    const trace = buildTrace({ ...base, resolution: resolution([candidate('Sub Pop')]) });
    assert.equal(trace.candidates[0]?.eligible, true);
    assert.equal(trace.candidates[0]?.suppressedBy, null);
  });
});

describe('BR-12.5 — classifier divergence is flagged', () => {
  it('reports no divergence when the versions match', () => {
    const trace = buildTrace({ ...base, resolution: resolution([candidate('Sub Pop')]) });
    assert.equal(trace.classifierVersion.diverged, false);
  });

  it('flags divergence when the play was classified by older rules', () => {
    // R3 guarantees the classifier is re-tuned. Without this flag the trace would present
    // today's reasoning as the historical record — self-consistent, plausible, never run.
    const trace = buildTrace({
      ...base,
      resolution: resolution([candidate('Sub Pop')]),
      storedClassifierVersion: 1,
      runningClassifierVersion: 2,
    });

    assert.equal(trace.classifierVersion.diverged, true);
    assert.equal(trace.classifierVersion.storedOnPlay, 1);
    assert.equal(trace.classifierVersion.running, 2);
  });

  it('does not claim divergence for a play that was never classified', () => {
    // Nothing to disagree with. Reporting divergence here would be a false alarm on every
    // pending row.
    const trace = buildTrace({
      ...base,
      resolution: null,
      storedClassifierVersion: null,
      runningClassifierVersion: 2,
    });
    assert.equal(trace.classifierVersion.diverged, false);
  });
});

describe('BR-12.8 — no resolution traces as a reason, not an empty shell', () => {
  it('reports the unknown reason instead of a derivation', () => {
    const trace = buildTrace({
      ...base,
      resolution: null,
      unknownReason: 'notFound',
    });
    assert.equal(trace.unknownReason, 'notFound');
    assert.equal(trace.join, null);
    assert.equal(trace.fold, null);
  });

  it('defaults to noIsrc when no reason was recorded', () => {
    const trace = buildTrace({ ...base, resolution: null });
    assert.equal(trace.unknownReason, 'noIsrc');
  });

  it('still carries the ISRC vote when there is no resolution', () => {
    // The registrant signal is the only one with full coverage, so it is exactly the case
    // where it has something to say.
    const trace = buildTrace({
      ...base,
      resolution: null,
      isrcVote: { signal: 'isrc-prefix', verdict: 'major', strength: 'weak', evidence: 'USUM' },
    });
    assert.equal(trace.votes.length, 1);
  });
});

describe('BR-12.6 — a derivation, not a health check', () => {
  it('exposes the ordered stages of the derivation', () => {
    const trace = buildTrace({
      ...base,
      resolution: resolution([candidate('Epic'), candidate('Interscope')]),
    });

    assert.equal(trace.join?.key, 'isrc');
    assert.equal(trace.join?.matchMethod, 'isrc');
    assert.equal(trace.narrowingTier, 'title-date');
    assert.equal(trace.releaseCount, 44);
    assert.equal(trace.fold?.verdict, 'major');
    assert.equal(trace.fold?.contested, true, 'Epic and Interscope are two different majors');
    assert.equal(trace.confidence?.band, 'low', 'contested caps confidence');
  });

  it('has no ok/fail status anywhere', () => {
    // U2's failure mode is a verdict that is confidently wrong while every step "succeeded".
    // Rendering this as pass/fail would hide exactly that.
    const trace = buildTrace({ ...base, resolution: resolution([candidate('Sub Pop')]) });
    const serialised = JSON.stringify(trace);
    assert.equal(/"status":"(ok|fail|skip)"/.test(serialised), false);
  });

  it('separates the rule that decided the verdict from the rules that capped confidence', () => {
    const trace = buildTrace({
      ...base,
      resolution: resolution([candidate('Atlantic')], { narrowingTier: 'all' }),
    });
    assert.equal(trace.fold?.decidedBy, 'BR-4.3');
    assert.deepEqual(trace.confidence?.capsApplied, ['BR-5.3']);
  });
});

describe('BR-12.2 — the trace runs the same classifier that produced the verdict', () => {
  it('derives from the candidates the traced version actually held', () => {
    // A version-scoped trace is why re-resolving a track cannot silently change the
    // explanation of an older play.
    const old = resolution([candidate('Never Too Different')], { id: 1 });
    const recent = resolution([candidate('Atlantic')], { id: 2 });

    assert.equal(buildTrace({ ...base, resolution: old }).fold?.verdict, 'independent');
    assert.equal(buildTrace({ ...base, resolution: recent }).fold?.verdict, 'major');
  });

  it('is deterministic', () => {
    const input = { ...base, resolution: resolution([candidate('Sub Pop')]) };
    assert.deepEqual(buildTrace(input), buildTrace(input));
  });
});

describe('artist-level traces', () => {
  const artistResolution: ArtistLabelResolution = {
    id: 3,
    spotifyArtistId: '4Ws4bnyoc0Q8FQvpBoRvIz',
    artistMbid: 'artist-mbid',
    releaseCount: 66,
    namedLabelCount: 41,
    resolvedAt: '2026-08-31T00:00:00.000Z',
    status: 'resolved',
    supersedesId: null,
    candidates: [candidate('Atlantic')],
    votes: [],
  };

  it('uses the exact Spotify-URL join as its key', () => {
    const trace = buildTrace({
      ...base,
      scope: 'artist',
      resolution: artistResolution,
      capConfidenceAt: 'medium',
    });
    assert.equal(trace.join?.key, 'spotify-url');
    assert.equal(trace.join?.value, '4Ws4bnyoc0Q8FQvpBoRvIz');
  });

  it('never claims high confidence, because it aggregates a career', () => {
    const trace = buildTrace({
      ...base,
      scope: 'artist',
      resolution: artistResolution,
      capConfidenceAt: 'medium',
    });
    assert.equal(trace.confidence?.band, 'medium');
    assert.ok(trace.confidence?.capsApplied.includes('BR-5.5'));
  });
});

describe('the summary leads with what was refused', () => {
  it('mentions suppression before anything else', () => {
    // It is the part a reader would otherwise never learn.
    const trace = buildTrace({
      ...base,
      resolution: resolution([candidate('Faouzia Music', 'Publisher')]),
    });
    const summary = summariseTrace(trace);
    assert.match(summary, /^refused 1: Faouzia Music \(BR-3\.1\)/);
  });

  it('reports the deciding rule for a normal verdict', () => {
    const trace = buildTrace({ ...base, resolution: resolution([candidate('Atlantic')]) });
    assert.match(summariseTrace(trace), /major by BR-4\.3/);
  });

  it('says so plainly when there is no resolution', () => {
    const trace = buildTrace({ ...base, resolution: null, unknownReason: 'notFound' });
    assert.match(summariseTrace(trace), /No resolution — notFound/);
  });
});
