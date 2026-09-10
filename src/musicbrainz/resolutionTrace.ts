/**
 * The resolution trace — how a verdict was reached (BR-12).
 *
 * ⚙️ **PURE.** Stored rows in, an ordered derivation out. No database, no clock, no network.
 *
 * Added at the Functional Design approval gate by user request: *"include a debug output that
 * shows how the data for a track was collected … showing the rules applied so different rule paths
 * can be tested."*
 *
 * ## Why it is recomputed rather than stored
 *
 * Re-running the **same pure classifier** that produced the verdict is what keeps the trace
 * honest: it cannot drift into a hand-written description of what the code is believed to do.
 * BR-8.7 already made recomputation free, which is also what makes BR-12.4 — a trace for *any*
 * play in history — affordable.
 *
 * ## ⚠️ And why that needs a guard
 *
 * R3 guarantees the classifier will be re-tuned. After that, tracing an old play explains it with
 * **today's** rules and produces a derivation that never actually ran — internally consistent,
 * plausible, and wrong. That is the failure shape this project has met four times, so BR-12.5
 * makes reporting both classifier versions mandatory rather than a nicety.
 *
 * ## What the trace is for
 *
 * The standing precision rule works almost entirely by **exclusion**, and exclusion is invisible
 * in a verdict: `unknown` because MusicBrainz knew nothing and `unknown` because a `Publisher`
 * candidate was found and refused are the same output with opposite meanings. `suppressedBy` is
 * the field that separates them.
 */

import type {
  CandidateDecision,
  Confidence,
  LabelResolution,
  LabelVerdict,
  NarrowingTier,
  SignalVote,
  UnknownReason,
} from './types.js';
import { classify, explainCandidates } from './labelClassifier.js';

/** One label, with the eligibility decision made about it. */
export interface TracedCandidate {
  labelName: string;
  labelType: string | null;
  releaseTitle: string | null;
  releaseDate: string | null;
  eligible: boolean;
  /** The rule ID that refused it, or `null`. The whole point of the trace. */
  suppressedBy: string | null;
  strength: string;
}

export interface ClassifierVersionReport {
  storedOnPlay: number | null;
  running: number;
  /** True when the trace is explaining an old play with newer rules (BR-12.5). */
  diverged: boolean;
}

/**
 * ⚠️ **There is one scope now: the release.** This carried a `scope` of `release | artist` until
 * 2026-09-06, because an artist-level verdict was classified over the artist's release browse.
 * That browse counts releases the artist only *features* on as their own, so the artist trace was
 * a derivation over other people's record deals — see migration 004. The artist level is genres,
 * and genres are looked up rather than derived, so they have nothing to trace.
 */
export interface ResolutionTrace {
  playId: number;
  /** Present unless nothing was ever resolved. */
  join: {
    key: 'isrc';
    value: string;
    matchMethod: string;
    recordingMbid: string | null;
    resolvedAt: string;
    resolutionId: number;
    status: string;
  } | null;
  narrowingTier: NarrowingTier | null;
  releaseCount: number | null;
  candidates: TracedCandidate[];
  votes: SignalVote[];
  fold: {
    verdict: LabelVerdict;
    decidedBy: string | null;
    contested: boolean;
  } | null;
  confidence: {
    band: Confidence;
    capsApplied: string[];
  } | null;
  classifierVersion: ClassifierVersionReport;
  /** Present instead of a derivation when nothing resolved (BR-12.8). */
  unknownReason: UnknownReason | null;
  /** Every rule that fired, in the order it fired. */
  rulesFired: string[];
}

export interface TraceInput {
  playId: number;
  resolution: LabelResolution | null;
  storedClassifierVersion: number | null;
  runningClassifierVersion: number;
  majorRoots: readonly string[];
  isrcVote: SignalVote | null;
  /** Why the verdict was unknown, when there is no resolution to derive from. */
  unknownReason?: UnknownReason | null;
}

/** Rules that only ever cap confidence, so the trace can list them separately from the fold. */
const CONFIDENCE_CAP_RULES = new Set(['BR-5.2', 'BR-5.3', 'BR-5.5', 'BR-6.5']);

/** Rules that decide the verdict itself. */
const FOLD_RULES = new Set(['BR-4.3', 'BR-4.3a', 'BR-4.4', 'BR-4.6']);

function toTracedCandidate(decision: CandidateDecision): TracedCandidate {
  return {
    labelName: decision.candidate.labelName,
    labelType: decision.candidate.labelType,
    releaseTitle: decision.candidate.releaseTitle,
    releaseDate: decision.candidate.releaseDate,
    eligible: decision.eligible,
    suppressedBy: decision.suppressedBy,
    strength: decision.strength,
  };
}

/**
 * Build a trace.
 *
 * Never throws and never returns an empty shell: a play with no resolution traces as its *reason*
 * (BR-12.8), because "we did not look" and "we looked and found nothing" are different facts and
 * only the second is a coverage finding.
 */
export function buildTrace(input: TraceInput): ResolutionTrace {
  const { playId, resolution, storedClassifierVersion, runningClassifierVersion, majorRoots, isrcVote } =
    input;

  const classifierVersion: ClassifierVersionReport = {
    storedOnPlay: storedClassifierVersion,
    running: runningClassifierVersion,
    // Only a version that was actually recorded can diverge; a play that was never classified
    // has nothing to disagree with.
    diverged:
      storedClassifierVersion !== null && storedClassifierVersion !== runningClassifierVersion,
  };

  if (resolution === null) {
    return {
      playId,
      join: null,
      narrowingTier: null,
      releaseCount: null,
      candidates: [],
      votes: isrcVote === null ? [] : [isrcVote],
      fold: null,
      confidence: null,
      classifierVersion,
      unknownReason: input.unknownReason ?? 'noIsrc',
      rulesFired: [],
    };
  }

  const narrowingTier: NarrowingTier = resolution.narrowingTier;

  // The same pure function that produced the verdict, over the candidates THIS VERSION held.
  const classification = classify(resolution.candidates, {
    majorRoots,
    narrowingTier,
    isrcVote,
  });

  const decisions = explainCandidates(resolution.candidates);

  const decidedBy = classification.rulesFired.find((rule) => FOLD_RULES.has(rule)) ?? null;
  const capsApplied = classification.rulesFired.filter((rule) => CONFIDENCE_CAP_RULES.has(rule));

  return {
    playId,
    join: {
      key: 'isrc',
      value: resolution.isrc,
      matchMethod: resolution.matchMethod,
      recordingMbid: resolution.recordingMbid,
      resolvedAt: resolution.resolvedAt,
      resolutionId: resolution.id,
      status: resolution.status,
    },
    narrowingTier,
    releaseCount: resolution.releaseCount,
    candidates: decisions.map(toTracedCandidate),
    votes: classification.votes,
    fold: {
      verdict: classification.verdict,
      decidedBy,
      contested: classification.contested,
    },
    confidence: {
      band: classification.confidence,
      capsApplied,
    },
    classifierVersion,
    unknownReason: classification.unknownReason,
    rulesFired: classification.rulesFired,
  };
}

/**
 * A short human-readable summary of why a verdict is what it is.
 *
 * Used by the UI beside the full derivation. Deliberately mentions **suppression first** when it
 * happened, because that is the part a reader would otherwise never learn: a refused candidate and
 * an absent one look identical in the verdict.
 */
export function summariseTrace(trace: ResolutionTrace): string {
  if (trace.join === null) {
    return `No resolution — ${trace.unknownReason ?? 'unknown'}`;
  }

  const suppressed = trace.candidates.filter((candidate) => !candidate.eligible);
  const parts: string[] = [];

  if (suppressed.length > 0) {
    const names = suppressed
      .map((candidate) => `${candidate.labelName} (${candidate.suppressedBy})`)
      .join(', ');
    parts.push(`refused ${suppressed.length}: ${names}`);
  }

  const eligible = trace.candidates.filter((candidate) => candidate.eligible);
  if (eligible.length > 0) {
    parts.push(`considered ${eligible.map((candidate) => candidate.labelName).join(', ')}`);
  }

  if (trace.fold !== null) {
    parts.push(`${trace.fold.verdict} by ${trace.fold.decidedBy ?? 'no rule'}`);
  }
  if (trace.confidence !== null && trace.confidence.capsApplied.length > 0) {
    parts.push(`capped by ${trace.confidence.capsApplied.join(', ')}`);
  }

  return parts.join(' · ');
}
