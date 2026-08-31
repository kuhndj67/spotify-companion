/**
 * Label classification — candidates in, verdict out.
 *
 * ⚙️ **PURE, and the purity is load-bearing.** This module decides the independent variable the
 * whole promotion hypothesis rests on. A `Date.now()` or a config read here breaks **FR-42**
 * (back-testing stops replaying live behaviour) and **FR-20** (reclassification stops being
 * reproducible) **while every other test in the suite still passes**. `test/purity.test.ts` is the
 * only thing that catches it — see BR-4.8.
 *
 * Everything it needs arrives in `ClassificationContext`. It reads nothing.
 *
 * ---
 *
 * ## The standing rule for this unit
 *
 * User, U2 Functional Design Q5: *"prioritise accuracy in the 'Artist Is Independent'
 * determination even if it ultimately misses some independent products."*
 *
 * The asymmetry is arithmetic here, not sentiment:
 *
 * - **Any strong `major` vote ⇒ `major`.** One is enough (BR-4.3).
 * - **`independent` requires the *absence* of any `major` vote at *any* strength** (BR-4.4).
 *
 * Missing an independent track costs one row. Calling a major track independent **manufactures
 * support for the hypothesis under test**, invisibly, in a dataset built to test that hypothesis.
 * Those costs are not symmetric, so the rule is not either.
 *
 * ## Everything below was measured, not anticipated
 *
 * | Case | What it forces |
 * |---|---|
 * | **Faouzia** — only label is `Faouzia Music`, type `Publisher`; she records for Atlantic | Publishers are ineligible (BR-3.1) |
 * | **Imminence / Red Leather** — `[no label]`, yet 41 of 66 other releases are named, incl. Virgin (Universal) | `[no label]` ⇒ `unknown` (BR-3.2) |
 * | **Audioslave** — one release carrying Epic *and* Interscope | `contested`, major-vs-major only (BR-6) |
 * | **NF** — `NF Real Music` + Capitol + Caroline | Not contested: an imprint under a major is one arrangement |
 * | **broke** — type `Distributor`, genuinely independent | Distributor votes weak (BR-3.3, Q13) |
 */

import type {
  CandidateDecision,
  ClassificationContext,
  Confidence,
  LabelCandidate,
  LabelClassification,
  SignalVote,
  UnknownReason,
  VoteStrength,
} from './types.js';
import { isNoLabelSentinel, matchMajorRoot } from './majorRootList.js';

/** Ordinal ordering, so "cap at medium" is a comparison rather than a special case. */
const CONFIDENCE_ORDER: readonly Confidence[] = ['low', 'medium', 'high'];

function capConfidence(value: Confidence, cap: Confidence | undefined): Confidence {
  if (cap === undefined) return value;
  return CONFIDENCE_ORDER.indexOf(value) <= CONFIDENCE_ORDER.indexOf(cap) ? value : cap;
}

/**
 * Decide whether a candidate may vote, and how loudly.
 *
 * This is where the precision rule does most of its work, and it works by **exclusion** — which is
 * why every refusal records the rule that made it (BR-12.3). A suppressed candidate and a
 * candidate that never existed produce identical verdicts; only `suppressedBy` tells them apart.
 */
export function decideEligibility(candidate: LabelCandidate): CandidateDecision {
  // BR-3.2 — the sentinel is an absence of data entry, not an assertion of self-release.
  if (isNoLabelSentinel(candidate.labelName)) {
    return { candidate, eligible: false, suppressedBy: 'BR-3.2', strength: 'weak' };
  }

  // BR-3.1 — a publishing entity is not a record label. Faouzia is the proof, and including
  // publishers over-counts independence in the direction that falsely supports the hypothesis.
  if (candidate.labelType === 'Publisher') {
    return { candidate, eligible: false, suppressedBy: 'BR-3.1', strength: 'weak' };
  }

  if (candidate.labelName.trim().length === 0) {
    return { candidate, eligible: false, suppressedBy: 'BR-3.4', strength: 'weak' };
  }

  // BR-3.3 / Q13 — a distributor relationship says nothing about whether a deal sits behind it.
  // `broke` is typed Distributor and is genuinely independent; the type alone does not show that.
  const strength: VoteStrength =
    candidate.labelType === 'Imprint' || candidate.labelType === 'Original Production'
      ? 'strong'
      : 'weak';

  return { candidate, eligible: true, suppressedBy: null, strength };
}

/**
 * Turn one eligible candidate into a vote.
 *
 * A name on the curated root list votes `major`. A name that is *not* on it votes `independent`,
 * because at this point we have a real label name from a real release — but only ever at the
 * strength its type allows, and the fold below still requires no major vote anywhere before
 * `independent` can win.
 */
function candidateVote(decision: CandidateDecision, majorRoots: readonly string[]): SignalVote {
  const { candidate, strength } = decision;
  const matchedRoot = matchMajorRoot(candidate.labelName, majorRoots);

  if (matchedRoot !== null) {
    return {
      signal: 'major-root-list',
      verdict: 'major',
      strength,
      evidence: `${candidate.labelName} matches major root "${matchedRoot}"`,
    };
  }

  return {
    signal: 'major-root-list',
    verdict: 'independent',
    strength,
    evidence: `${candidate.labelName} (${candidate.labelType ?? 'untyped'}) is not a known major imprint`,
  };
}

/** Distinct label names, order preserved, so the trace reads in the order MusicBrainz returned. */
function distinctNames(decisions: CandidateDecision[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const { candidate } of decisions) {
    if (!seen.has(candidate.labelName)) {
      seen.add(candidate.labelName);
      names.push(candidate.labelName);
    }
  }
  return names;
}

/**
 * Are two or more *different majors* present?
 *
 * **Major-vs-major only** (Q2 = A + C). Audioslave's single title+date match carries Epic (Sony)
 * and Interscope (Universal) — two corporate parents on one release, which is a genuine data
 * problem worth flagging and excluding from analysis.
 *
 * An artist imprint distributed by a major is *not* contested: NF Real Music + Capitol + Caroline
 * is one arrangement, and marking it contested would discard a row that is perfectly well
 * understood. Independents disagreeing with each other is likewise not contested — the verdict is
 * `independent` either way.
 */
function isContested(decisions: CandidateDecision[], majorRoots: readonly string[]): boolean {
  const roots = new Set<string>();
  for (const decision of decisions) {
    if (!decision.eligible) continue;
    const root = matchMajorRoot(decision.candidate.labelName, majorRoots);
    if (root !== null) roots.add(root);
  }
  return roots.size > 1;
}

/**
 * Classify.
 *
 * Order matters and follows BR-4: eligibility first, then votes, then the asymmetric fold, then
 * confidence with its caps applied last.
 */
export function classify(
  candidates: LabelCandidate[],
  context: ClassificationContext,
): LabelClassification {
  const rulesFired: string[] = [];
  const { majorRoots, narrowingTier, isrcVote, capConfidenceAt } = context;

  const decisions = candidates.map(decideEligibility);
  for (const decision of decisions) {
    if (decision.suppressedBy !== null && !rulesFired.includes(decision.suppressedBy)) {
      rulesFired.push(decision.suppressedBy);
    }
  }

  const eligible = decisions.filter((decision) => decision.eligible);
  const votes: SignalVote[] = eligible.map((decision) => candidateVote(decision, majorRoots));

  // The ISRC signal votes even when nothing else can — it is the only one with full coverage.
  if (isrcVote !== null) votes.push(isrcVote);

  const labelNames = distinctNames(eligible);

  // -- No eligible candidate -------------------------------------------------
  //
  // BR-4.6. The ISRC signal alone is deliberately NOT enough to produce a verdict: it votes
  // `weak` by design, and BR-4.3 requires a strong vote for `major` while BR-4.4 requires a real
  // label name for `independent`. A registrant prefix is a correlation, and the standing rule
  // does not let a correlation stand in for evidence.
  if (eligible.length === 0) {
    rulesFired.push('BR-4.6');
    const reason: UnknownReason =
      candidates.length === 0 ? 'notFound' : 'noEligibleCandidate';
    return {
      verdict: 'unknown',
      confidence: capConfidence('low', capConfidenceAt),
      contested: false,
      labelNames: [],
      votes,
      unknownReason: reason,
      rulesFired,
    };
  }

  // -- The asymmetric fold ---------------------------------------------------
  const majorVotes = votes.filter((vote) => vote.verdict === 'major');
  const strongMajor = majorVotes.some((vote) => vote.strength === 'strong');
  const anyMajor = majorVotes.length > 0;
  const contested = isContested(decisions, majorRoots);

  let verdict: LabelClassification['verdict'];
  let confidence: Confidence;

  if (strongMajor) {
    // BR-4.3 — one strong major vote is sufficient. No counting, no majority.
    rulesFired.push('BR-4.3');
    verdict = 'major';
    confidence = 'high';
  } else if (anyMajor) {
    // A major name appeared, but only weakly typed (Distributor or untyped). Still `major` —
    // the asymmetry means a major name is never outvoted by independent names — but the
    // confidence says the evidence was thin.
    rulesFired.push('BR-4.3a');
    verdict = 'major';
    confidence = 'medium';
  } else {
    // BR-4.4 — `independent` requires the ABSENCE of any major vote at any strength. This is the
    // rule that makes the whole unit's error budget asymmetric.
    rulesFired.push('BR-4.4');
    verdict = 'independent';
    confidence = eligible.some((decision) => decision.strength === 'strong') ? 'high' : 'medium';
  }

  // -- Confidence caps, applied last so each is visible in the trace ---------
  if (contested) {
    // BR-6.5 — two different majors on one release is a real data problem; the verdict stands
    // (both are majors) but it must be excludable from analysis.
    rulesFired.push('BR-6.5');
    confidence = capConfidence(confidence, 'low');
  }

  if (narrowingTier === 'all') {
    // Q1 = A — voting over every pressing anyone ever made is materially weaker evidence.
    rulesFired.push('BR-5.3');
    confidence = capConfidence(confidence, 'low');
  }

  if (narrowingTier === 'title') {
    rulesFired.push('BR-5.2');
    confidence = capConfidence(confidence, 'medium');
  }

  // Artist-level aggregates a career rather than a release, so it never claims `high`.
  const capped = capConfidence(confidence, capConfidenceAt);
  if (capped !== confidence) rulesFired.push('BR-5.5');

  return {
    verdict,
    confidence: capped,
    contested,
    labelNames,
    votes,
    unknownReason: null,
    rulesFired,
  };
}

/** The eligibility decisions, exposed so the trace can show what was refused (BR-12.3). */
export function explainCandidates(candidates: LabelCandidate[]): CandidateDecision[] {
  return candidates.map(decideEligibility);
}
