/**
 * Back-testing a rule against stored history (LC-18, FR-42, US-24).
 * 🔌 IMPURE shell, ⚙️ pure fold.
 *
 * ## ⚠️ The same engine, never a variant
 *
 * `decide` is U3's, unmodified. A back-testing variant would drift from the live path silently,
 * and NFR-26's determinism is the only thing that makes the comparison mean anything.
 *
 * ## ⚠️ It writes NOTHING (BR-28.6)
 *
 * Not a decision row, not a play row, not a cached report. *"The back-test endpoint started
 * logging its own decisions"* is a plausible future change that would contaminate the decision
 * log with hypothetical decisions and, through it, every later analysis. The prohibition is a
 * business rule, not a convention — which is why the service takes no `DecisionLogRepository`
 * at all rather than taking one and declining to use it.
 */

import { reconstruct, unanswerableFields } from './factReconstructor.js';
import { decide } from './RuleEngine.js';
import { hashRule } from './ruleHash.js';
import type { HistoryCounts, PlayRecord } from '../history/types.js';
import {
  BACK_TEST_MAX_PLAYS,
  type BackTestReport,
  type DateRange,
  type LoadedRule,
} from './types.js';

export interface BackTestDeps {
  /** Every play in range, oldest first. ⚠️ Not only live ones — see the note in `run`. */
  readonly playsInRange: (range: DateRange) => Iterable<PlayRecord>;
  readonly historyCountsBefore: (
    trackId: string,
    artistId: string | null,
    beforeIso: string,
  ) => HistoryCounts;
  readonly v5Watermark: () => number | null;
  /** ⚠️ For the report's own timestamp only, never for an evaluation. */
  readonly now: () => string;
}

export class BackTestService {
  readonly #deps: BackTestDeps;

  constructor(deps: BackTestDeps) {
    this.#deps = deps;
  }

  run(loaded: LoadedRule, range: DateRange): BackTestReport {
    const watermark = this.#deps.v5Watermark();
    const referenced = referencedFields(loaded);

    let evaluated = 0;
    let wouldMatch = 0;
    let wouldNotMatch = 0;
    let undecidable = 0;
    let agreedWithUserSkip = 0;
    let disagreedWithUserKeep = 0;
    let missedUserSkip = 0;
    let notObserved = 0;
    let inconclusive = 0;
    let excludedRuleInitiated = 0;
    let truncated = false;

    const unknownFieldCounts: Record<string, number> = {};
    const unanswerableCounts: Record<string, number> = {};

    for (const row of this.#deps.playsInRange(range)) {
      if (evaluated >= BACK_TEST_MAX_PLAYS) {
        // ⚠️ P-24. The cap is disclosed, never silently applied: a browse capped at 100 with
        // the 100 stored as the count is how 18 of 56 resolutions recorded an arbitrary
        // sample as a complete figure.
        truncated = true;
        break;
      }

      // ⚠️ EVERY row in range, not only live or only eligible ones (BR-28.3a). An earlier
      // draft selected "live plays in range" while reporting `notObserved` for backfilled
      // rows, which made that counter permanently zero — the back-test reporting that the app
      // never missed anything, over a corpus where 86 of 543 rows are backfilled and seven of
      // its ten early days exist ONLY as backfilled rows.
      evaluated += 1;

      // FR-23. 0 until U5 is armed, and built now because the first row it must exclude
      // appears the moment automation runs — by which time the back-test is already trusted.
      if (row.skipSource === 'rule') {
        excludedRuleInitiated += 1;
        continue;
      }

      const cannotAnswer = unanswerableFields(row, watermark);
      for (const field of cannotAnswer) {
        if (referenced.has(field)) {
          unanswerableCounts[field] = (unanswerableCounts[field] ?? 0) + 1;
        }
      }

      const counts = this.#deps.historyCountsBefore(row.trackId, row.artistId, row.startedAt);
      const facts = reconstruct(row, counts);
      const decision = decide([loaded], facts, false);
      const outcome = decision.outcomes[0];

      // A disabled rule produces no outcome. Nothing to say about this row.
      if (outcome === undefined) continue;

      for (const field of decision.unknownFields) {
        unknownFieldCounts[field] = (unknownFieldCounts[field] ?? 0) + 1;
      }

      // ⚠️ `undecidable` is NOT `wouldNotMatch` (BR-28.1). Reporting "could not be answered"
      // as "matched nothing" is the `Label detail` dash and the `inc=releases` 200 in a new
      // place — a wrong answer that reads as a finding.
      const matched = decision.matchedRuleIds.length > 0;
      if (outcome.verdict === 'unknown') undecidable += 1;
      else if (matched) wouldMatch += 1;
      else wouldNotMatch += 1;

      // ⚠️ `notObserved` (the app was down) stays separate from `inconclusive` (the app
      // watched and could not judge). Merging them is the 2026-09-06 defect exactly: the
      // instrument's downtime rendered as the classifier's uncertainty.
      if (row.outcome === 'unknown') {
        if (row.provenance === 'backfilled') notObserved += 1;
        else inconclusive += 1;
        continue;
      }

      // Three-way agreement (§5.2). "Did not match, and the user completed" is agreement by
      // omission and is deliberately not counted.
      if (matched && row.outcome === 'skipped') agreedWithUserSkip += 1;
      else if (matched && row.outcome === 'completed') disagreedWithUserKeep += 1;
      else if (!matched && row.outcome === 'skipped') missedUserSkip += 1;
    }

    return {
      ruleId: loaded.rule.id,
      ruleName: loaded.rule.name,
      ruleHash: hashRule(loaded.rule),
      range,
      evaluated,
      wouldMatch,
      wouldNotMatch,
      undecidable,
      unknownFieldCounts,
      unanswerableFields: unanswerableCounts,
      agreedWithUserSkip,
      disagreedWithUserKeep,
      missedUserSkip,
      notObserved,
      inconclusive,
      excludedRuleInitiated,
      truncated,
      computedAt: this.#deps.now(),
    };
  }
}

/** Every catalogue field this rule's predicate mentions. Used to scope the unanswerable report. */
function referencedFields(loaded: LoadedRule): Set<string> {
  const fields = new Set<string>();
  const stack: unknown[] = [loaded.rule.predicate];

  // Iterative, matching `depthOf`: a guard or a walk that recurses over a user-supplied tree
  // can overflow on exactly the input it exists to handle.
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    if (typeof record['field'] === 'string') fields.add(record['field']);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) stack.push(...value);
      else if (value !== null && typeof value === 'object') stack.push(value);
    }
  }

  return fields;
}
