/**
 * The connector acceptance record (U9, IN-U9-3, P-74). ⚙️ PURE.
 *
 * `scripts/connector-acceptance.json` lists every connector pin that was put through U9's acceptance (BR-70) on the
 * verification install, with the outcome and the readable record. `npm run release` refuses to deploy a pin that
 * differs from the last release's unless an entry here says `pass`: moving the connector is a deliberate, recorded
 * act (NFR-40), never a side effect of releasing something else.
 *
 * Code Generation Q2 = A: the structural test checks this file's SHAPE only (every entry well-formed, every record
 * file present). Whether the CURRENT pin is accepted is the release's question, because the entry can only be
 * written after the acceptance runs, in Build & Test.
 */

export interface AcceptanceEntry {
  /** Full 40-character commit SHA of upstream `spotify-mcp-server`. */
  readonly pin: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly result: 'pass' | 'fail';
  /** Repository path of the readable record (a Build & Test document). */
  readonly record: string;
}

export type ParsedAcceptance =
  | { readonly ok: true; readonly entries: readonly AcceptanceEntry[] }
  | { readonly ok: false; readonly problems: readonly string[] };

const SHA = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAcceptance(text: string): ParsedAcceptance {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!Array.isArray(data)) return { ok: false, problems: ['must be a JSON array of entries'] };

  const problems: string[] = [];
  data.forEach((entry: unknown, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (typeof e.pin !== 'string' || !SHA.test(e.pin)) problems.push(`entry ${i}: pin must be a full 40-character SHA`);
    if (typeof e.date !== 'string' || !DATE.test(e.date)) problems.push(`entry ${i}: date must be YYYY-MM-DD`);
    if (e.result !== 'pass' && e.result !== 'fail') problems.push(`entry ${i}: result must be "pass" or "fail"`);
    if (typeof e.record !== 'string' || e.record.trim() === '') problems.push(`entry ${i}: record must name the readable record`);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, entries: data as AcceptanceEntry[] };
}

/** Pins with a `pass`. A later `fail` for the same pin withdraws it: the LAST entry for a pin decides. */
export function acceptedPins(entries: readonly AcceptanceEntry[]): string[] {
  const last = new Map<string, AcceptanceEntry['result']>();
  for (const e of entries) last.set(e.pin, e.result);
  return [...last].filter(([, result]) => result === 'pass').map(([pin]) => pin);
}

/** compose.yaml's `MCP_SERVER_REF`, or `null`. */
export function pinFromCompose(yaml: string): string | null {
  return yaml.match(/^\s*MCP_SERVER_REF:\s*([0-9a-f]{40})\s*$/m)?.[1] ?? null;
}
