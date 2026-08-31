/**
 * Label classifier — example tests.
 *
 * **Every case here is a real one from the live MusicBrainz probe** (research-findings Parts 5 and
 * 6), not an invented shape. Each exists because it produced a wrong answer, or would have, under
 * a design that seemed reasonable on paper.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classify, decideEligibility } from '../src/musicbrainz/labelClassifier.js';
import { MAJOR_ROOTS, labelRoot, matchMajorRoot } from '../src/musicbrainz/majorRootList.js';
import type { ClassificationContext, LabelCandidate, LabelType } from '../src/musicbrainz/types.js';

function candidate(
  labelName: string,
  labelType: LabelType = 'Imprint',
  releaseId = 'r1',
): LabelCandidate {
  return {
    labelName,
    labelMbid: null,
    labelType,
    catalogNumber: null,
    releaseId,
    releaseTitle: 'An Album',
    releaseDate: '2022-03-14',
    releaseStatus: 'Official',
  };
}

const context = (over: Partial<ClassificationContext> = {}): ClassificationContext => ({
  majorRoots: MAJOR_ROOTS,
  narrowingTier: 'title-date',
  isrcVote: null,
  ...over,
});

describe('the major root list is internally consistent', () => {
  // This invariant fails SILENTLY if broken: labelRoot() trims trailing "records" /
  // "recordings" / "entertainment", so an entry like "legacy recordings" would be compared
  // against candidates already reduced to "legacy" and could never match. Nothing goes red —
  // the label just never registers as major, which is a false `independent` waiting to happen.
  it('every entry is already in labelRoot form', () => {
    for (const root of MAJOR_ROOTS) {
      assert.equal(labelRoot(root), root, `MAJOR_ROOTS entry "${root}" is not in root form`);
    }
  });

  it('has no entry short enough to match unrelated labels', () => {
    for (const root of MAJOR_ROOTS) {
      assert.ok(root.length >= 3, `MAJOR_ROOTS entry "${root}" is dangerously short`);
    }
  });
});

describe('matchMajorRoot respects word boundaries', () => {
  it('matches a major imprint with corporate noise attached', () => {
    assert.equal(matchMajorRoot('Atlantic Records'), 'atlantic');
    assert.equal(matchMajorRoot('Island Records Ltd'), 'island');
    assert.equal(matchMajorRoot('Virgin Music Group'), 'virgin');
  });

  it('does not match an unrelated label that merely starts with the same letters', () => {
    // A bare startsWith would classify these as major. That error runs in the "safe" direction
    // only by luck, and the standing rule is about not being wrong by luck.
    assert.equal(matchMajorRoot('Universalist Sound'), null);
    assert.equal(matchMajorRoot('Epicurean Tapes'), null);
    assert.equal(matchMajorRoot('Islanders Collective'), null);
  });

  it('never reduces a name to nothing', () => {
    // "Records" would otherwise normalise to the empty string and then prefix-match every root.
    assert.equal(labelRoot('Records'), 'records');
    assert.equal(matchMajorRoot('Records'), null);
  });
});

describe('BR-3.1 — Publisher entries are ineligible (Faouzia)', () => {
  // Faouzia's ONLY MusicBrainz label entry is `Faouzia Music`, type Publisher, disambiguation
  // SOCAN. She records for Atlantic. Taken at face value this yields a confident
  // "independent" — wrong, and wrong in the direction that falsely supports the hypothesis,
  // because majors routinely use publishing subsidiaries.
  const faouzia = [candidate('Faouzia Music', 'Publisher')];

  it('suppresses the publisher rather than voting on it', () => {
    const decision = decideEligibility(faouzia[0]!);
    assert.equal(decision.eligible, false);
    assert.equal(decision.suppressedBy, 'BR-3.1');
  });

  it('classifies as unknown, not independent', () => {
    const result = classify(faouzia, context());
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.unknownReason, 'noEligibleCandidate');
  });

  it('records the suppressing rule so the refusal is visible', () => {
    // Without this, "unknown because a Publisher was refused" is indistinguishable from
    // "unknown because MusicBrainz knew nothing" — the same output, opposite meanings.
    const result = classify(faouzia, context());
    assert.ok(result.rulesFired.includes('BR-3.1'));
  });
});

describe('BR-3.2 — [no label] is unknown, never independent (Imminence, Red Leather)', () => {
  // Tested rather than assumed, and the assumption was wrong. Both `[no label]` artists carry
  // real labels on their OTHER releases — Imminence: 41 of 66 named, including Virgin Music
  // Group (Universal). The sentinel means incomplete data entry, not self-release.
  it('suppresses the sentinel', () => {
    const decision = decideEligibility(candidate('[no label]', null));
    assert.equal(decision.eligible, false);
    assert.equal(decision.suppressedBy, 'BR-3.2');
  });

  it('yields unknown for a release carrying only the sentinel', () => {
    const result = classify([candidate('[no label]', null)], context());
    assert.equal(result.verdict, 'unknown');
    assert.notEqual(result.verdict, 'independent');
  });
});

describe('BR-4.3 / BR-4.4 — the fold is deliberately asymmetric', () => {
  it('one strong major vote wins outright', () => {
    const result = classify(
      [candidate('Atlantic'), candidate('Some Indie Label'), candidate('Another Indie')],
      context(),
    );
    assert.equal(result.verdict, 'major');
    assert.ok(result.rulesFired.includes('BR-4.3'));
  });

  it('independent requires the absence of any major vote at any strength', () => {
    // A weakly-typed major (Distributor) still blocks `independent`. Missing an independent
    // costs one row; calling a major independent manufactures support for the hypothesis.
    const result = classify(
      [candidate('Some Indie Label'), candidate('Atlantic', 'Distributor')],
      context(),
    );
    assert.equal(result.verdict, 'major');
    assert.notEqual(result.verdict, 'independent');
  });

  it('returns independent only when no major appears at all', () => {
    const result = classify(
      [candidate('Never Too Different'), candidate('Some Indie Label')],
      context(),
    );
    assert.equal(result.verdict, 'independent');
    assert.ok(result.rulesFired.includes('BR-4.4'));
  });
});

describe('BR-3.3 / Q13 — Distributor votes weakly (broke)', () => {
  // `broke` (Marino, bbno$) is typed Distributor and self-describes as an independent label and
  // distributor. Genuinely independent — but the TYPE alone does not establish that no deal
  // sits behind it, so it classifies independent at reduced confidence.
  it('classifies independent but not at high confidence', () => {
    const result = classify([candidate('broke', 'Distributor')], context());
    assert.equal(result.verdict, 'independent');
    assert.notEqual(result.confidence, 'high');
  });

  it('treats Imprint as a strong signal by contrast', () => {
    const result = classify([candidate('Never Too Different', 'Imprint')], context());
    assert.equal(result.verdict, 'independent');
    assert.equal(result.confidence, 'high');
  });
});

describe('BR-6.5 — contested is major-vs-major only (Audioslave, NF)', () => {
  it('flags two different majors on one release', () => {
    // Audioslave's single title+date match carries Epic (Sony) AND Interscope (Universal).
    const result = classify([candidate('Epic'), candidate('Interscope')], context());
    assert.equal(result.contested, true);
    assert.equal(result.verdict, 'major');
    assert.equal(result.confidence, 'low', 'contested caps confidence at low');
  });

  it('does not flag an artist imprint distributed by a major', () => {
    // NF: `NF Real Music` + Capitol + Caroline is ONE arrangement, not a disagreement.
    // Capitol and Caroline are both Universal, so there is only one major root present.
    const result = classify(
      [candidate('NF Real Music'), candidate('Capitol'), candidate('Capitol Christian')],
      context(),
    );
    assert.equal(result.contested, false);
    assert.equal(result.verdict, 'major');
  });

  it('does not flag independents disagreeing with each other', () => {
    const result = classify([candidate('Indie One'), candidate('Indie Two')], context());
    assert.equal(result.contested, false);
    assert.equal(result.verdict, 'independent');
  });
});

describe('narrowing tier feeds confidence (Q1 = A)', () => {
  it('tier `all` caps confidence at low', () => {
    const result = classify([candidate('Atlantic')], context({ narrowingTier: 'all' }));
    assert.equal(result.verdict, 'major');
    assert.equal(result.confidence, 'low');
    assert.ok(result.rulesFired.includes('BR-5.3'));
  });

  it('tier `title` caps confidence at medium', () => {
    const result = classify([candidate('Atlantic')], context({ narrowingTier: 'title' }));
    assert.equal(result.confidence, 'medium');
  });

  it('tier `title-date` allows high', () => {
    const result = classify([candidate('Atlantic')], context({ narrowingTier: 'title-date' }));
    assert.equal(result.confidence, 'high');
  });
});

describe('artist-level confidence is capped at medium', () => {
  // It aggregates a career rather than a release — Audioslave alone spans five labels.
  it('never returns high even on a strong match', () => {
    const result = classify(
      [candidate('Atlantic')],
      context({ capConfidenceAt: 'medium' }),
    );
    assert.equal(result.verdict, 'major');
    assert.equal(result.confidence, 'medium');
    assert.ok(result.rulesFired.includes('BR-5.5'));
  });
});

describe('the ISRC signal votes but cannot carry a verdict alone', () => {
  it('is recorded as a vote when there are no eligible candidates', () => {
    const result = classify(
      [],
      context({
        isrcVote: {
          signal: 'isrc-prefix',
          verdict: 'major',
          strength: 'weak',
          evidence: 'ISRC registrant USUM — Universal Music Group (US)',
        },
      }),
    );
    // The vote is retained as evidence...
    assert.equal(result.votes.length, 1);
    assert.equal(result.votes[0]!.verdict, 'major');
    // ...but a registrant prefix is a correlation, not evidence of a signing, so it does not
    // get to produce a verdict on its own.
    assert.equal(result.verdict, 'unknown');
  });

  it('does not turn an independent verdict into major on its own', () => {
    const result = classify(
      [candidate('Never Too Different')],
      context({
        isrcVote: {
          signal: 'isrc-prefix',
          verdict: 'major',
          strength: 'weak',
          evidence: 'ISRC registrant USUM',
        },
      }),
    );
    // BR-4.4 is absolute: any major vote at any strength blocks `independent`.
    assert.equal(result.verdict, 'major');
    assert.equal(result.confidence, 'medium', 'thin evidence, so not high');
  });
});

describe('unknown reasons are distinguished (BR-10.2)', () => {
  it('reports notFound when there were no candidates at all', () => {
    const result = classify([], context());
    assert.equal(result.unknownReason, 'notFound');
  });

  it('reports noEligibleCandidate when candidates existed but all were refused', () => {
    const result = classify([candidate('Faouzia Music', 'Publisher')], context());
    assert.equal(result.unknownReason, 'noEligibleCandidate');
  });
});
