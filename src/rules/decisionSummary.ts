/**
 * The one-line decision summary written to stdout. ⚙️ PURE
 *
 * ## Why this is a module and not a `console.log` in the coordinator
 *
 * It is the line a person reads all day to judge whether their rules are working, so its
 * content is a decision rather than a detail — and a format assembled inline is a format
 * nothing tests. The coordinator hands over the facts; `server.ts` does the writing.
 *
 * ## ⚠️ One line per DECISION, not per rule row
 *
 * A decision is per **play**, so this is ~50–100 lines a day, not the 1,200 an hour that
 * BR-3.8 forbids — that rule is about per-*tick* logging, and the distinction is the whole
 * reason this is acceptable on the same stream as the fault log.
 *
 * ## ⚠️ Log the event, not the payload
 *
 * Every field value the engine read is already durable in `decision_log` and served by
 * `GET /api/decisions`. Reprinting it here would duplicate a queryable record into a stream
 * that scrolls away, and would bury the `[history] recording failed` lines that BR-3.8 keeps
 * rare precisely so they get noticed.
 *
 * ## ⚠️ No timestamp
 *
 * `docker logs --timestamps` supplies it, and no other line in this app carries one.
 * Consistency beats the redundancy.
 */

import type { Verdict } from './types.js';

export interface SummarisedRule {
  readonly name: string;
  readonly verdict: Verdict;
  /** After `onUnknown` was applied — which is why this is not simply `verdict === 'true'`. */
  readonly matched: boolean;
}

export interface DecisionSummaryInput {
  readonly trackId: string;
  readonly title: string;
  readonly artistName: string;
  /** From play start to the decision. **This is the enrichment latency measurement.** */
  readonly elapsedMs: number;
  /** ⚠️ The wait TIMED OUT — not "a field read null" (FQ3). */
  readonly partialData: boolean;
  readonly rules: readonly SummarisedRule[];
}

/** Long enough to recognise a track, short enough to keep the line scannable. */
const MAX_TITLE = 40;
const MAX_ARTIST = 28;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function formatDecisionSummary(input: DecisionSummaryInput): string {
  // Short id: enough to cross-reference a row in `decision_log` without eating the line.
  const id = input.trackId.slice(0, 8);
  const track = `"${clip(input.title, MAX_TITLE)}" — ${clip(input.artistName, MAX_ARTIST)}`;

  // ⚠️ The two trigger kinds are visually distinct because the rate of the second one is the
  // number this unit exists to collect. A deadline decision is not a worse decision, but it
  // is a decision taken on less than the engine wanted.
  const trigger = input.partialData
    ? `DEADLINE ${seconds(input.elapsedMs)}`
    : `settled ${seconds(input.elapsedMs)}`;

  if (input.rules.length === 0) {
    // ⚠️ Still logged. "No rules are loaded" is a thing worth seeing once per play when you
    // are expecting matches and getting silence — the alternative is a quiet log that looks
    // identical to a broken one.
    return `[decision] ${id} ${track} · ${trigger} · no rules evaluated`;
  }

  const matched = input.rules.filter((r) => r.matched).length;
  // `✓` marks CONTRIBUTED TO THE ACTION, which is not the same as `verdict === 'true'` once
  // `onUnknown: 'match'` is in play. Both are shown so the mapping stays visible.
  const verdicts = input.rules
    .map((r) => `${r.name}=${r.verdict}${r.matched ? '✓' : ''}`)
    .join(' ');

  return `[decision] ${id} ${track} · ${trigger} · ${matched}/${input.rules.length} matched · ${verdicts}`;
}
