/**
 * The execution trace (LC-19, BR-32). ⚙️ PURE
 *
 * Renders a decision the engine already took, so someone can read *why* it went the way it
 * did during hands-on evaluation.
 *
 * ## ⚠️ It renders. It never evaluates. (BR-32.3)
 *
 * The trace is a function of the stored rows alone — no facts, no engine, no predicate walk.
 *
 * ## ⚠️ Per-node verdicts are out of scope, and the reason is a defect this project shipped
 *
 * U3's `RuleOutcome` carries a rule-level verdict and a flat `fieldsSeen` map, not a tree.
 * Tracing each node would need a **second walk** of the predicate, and a second walk is a
 * second implementation of the evaluator. That is the WebSocket `403` exactly: the admission
 * rule was re-implemented rather than reused, the copies diverged, and all 411 tests passed
 * while every handshake failed.
 *
 * **A trace that drifts from the evaluator explains a decision that did not happen** — worse
 * than no trace. If per-node tracing is ever wanted it must come from the same walk that
 * produces the verdict, one function returning both, never a parallel `explain`.
 */

import type { DecisionLogEntry, Maybe } from './types.js';

export interface TracedField {
  readonly name: string;
  readonly value: unknown;
  /** ⚠️ Rendered as the literal token `unknown`, never blank and never `false`. */
  readonly display: string;
  readonly wasUnknown: boolean;
}

export interface TracedRule {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly verdict: string;
  readonly matched: boolean;
  readonly restedOnUnknown: boolean;
  readonly fields: readonly TracedField[];
}

export interface DecisionTrace {
  readonly evaluationId: string;
  readonly trackId: string;
  /**
   * The track's title, for the trace header. ⚠️ `null` when no play row carries this `track_id` yet,
   * which means **the first time this track has been heard** — not a missing field.
   */
  readonly title: Maybe<string>;
  readonly decidedAt: string;
  /** How the decision came to be taken — BR-32.2's trigger timeline. */
  readonly trigger: TriggerSummary;
  readonly ruleSetVersion: number;
  readonly ruleSetContentHash: string;
  readonly playLink: string;
  readonly rules: readonly TracedRule[];
}

export interface TriggerSummary {
  /** `settled` — enrichment finished in time. `deadline` — the wait timed out. */
  readonly kind: 'settled' | 'deadline';
  readonly description: string;
}

/**
 * ⚠️ The two trigger kinds are what `partialData` means, spelled out.
 *
 * `partialData` is **the wait timing out**, not "some field read null" (FQ3). A field that read
 * null is an ordinary unknown and appears per-field below; conflating the two would make the
 * cap-firing rate — the one number U4 exists to measure — unreadable.
 */
function summariseTrigger(partialData: boolean): TriggerSummary {
  return partialData
    ? {
        kind: 'deadline',
        description:
          'Decided on the deadline: enrichment had not finished when the wait expired, so the ' +
          'decision was taken on whatever had arrived.',
      }
    : {
        kind: 'settled',
        description: 'Decided once enrichment had settled for this track, before the wait expired.',
      };
}

/**
 * `null` renders as `unknown`, never as a blank and never as `false`.
 *
 * A blank cell hides a bias instead of showing it, and missing data here correlates with what
 * is being measured (R2).
 */
export function renderFieldValue(value: unknown): string {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.join(', ');
  return String(value);
}

/**
 * Build the trace for one decision, from the rows that decision wrote.
 *
 * `rows` must share an `evaluationId`; they are the complete record of one evaluation, because
 * the log writes one row per rule evaluated rather than per rule matched.
 */
export function buildTrace(rows: readonly DecisionLogEntry[]): DecisionTrace | null {
  const first = rows[0];
  if (first === undefined) return null;

  const unknown = new Set(first.unknownFields);

  return {
    evaluationId: first.evaluationId,
    trackId: first.trackId,
    // ⚠️ Taken from the FIRST row, like every other per-evaluation field here. Every row in a group
    // shares one `evaluation_id`, so they describe one play and one track.
    title: first.title,
    decidedAt: first.decidedAt,
    trigger: summariseTrigger(first.partialData),
    ruleSetVersion: first.ruleSetVersion,
    ruleSetContentHash: first.ruleSetContentHash,
    playLink: first.playLink,
    rules: rows.map((row) => ({
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      verdict: row.verdict,
      matched: row.matched,
      // ⚠️ Copied from the row, which copied it from the `Decision` verbatim. A predicate can
      // contain an unknown and still resolve decisively — `false AND unknown` is `false`,
      // because the data answered it (BR-23.5).
      restedOnUnknown: row.restedOnUnknown,
      fields: Object.keys(row.fieldsSeen)
        .sort()
        .map((name) => {
          const value = row.fieldsSeen[name];
          return {
            name,
            value: value === undefined ? null : value,
            display: renderFieldValue(value),
            wasUnknown: value === null || value === undefined || unknown.has(name),
          };
        }),
    })),
  };
}

/** Group a flat page of log rows into one trace per decision, newest first. */
export function groupIntoTraces(rows: readonly DecisionLogEntry[]): DecisionTrace[] {
  const groups = new Map<string, DecisionLogEntry[]>();
  for (const row of rows) {
    const existing = groups.get(row.evaluationId);
    if (existing === undefined) groups.set(row.evaluationId, [row]);
    else existing.push(row);
  }

  const traces: DecisionTrace[] = [];
  for (const group of groups.values()) {
    const trace = buildTrace(group);
    if (trace !== null) traces.push(trace);
  }
  return traces;
}
