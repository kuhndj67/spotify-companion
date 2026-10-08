/**
 * LC-33a — decide, for ONE archive entry, whether it may be written and under which fixed name.
 *
 * The archive reader (LC-33) asks this before writing a single byte of each entry, and aborts the whole
 * archive on the first refusal (BR-46.6). Keeping the decision pure is what lets PBT-51/52 throw generated
 * hostile archives at it by the thousand: path traversal, absolute paths, drive letters, links, devices,
 * duplicates and size bombs.
 *
 * ⚠️ PURE — no filesystem, no clock. `test/purity.test.ts` enforces it.
 *
 * ⚠️ The order of checks is deliberate: TYPE and SHAPE are refused before the allowlist is consulted, so a
 * `../history.db` is reported as a path (BR-46.8) rather than as an unknown name. Both refuse; the rule
 * named is the one a reader needs in order to understand what the archive tried to do.
 */

import {
  ARCHIVE_ENTRIES,
  REQUIRED_ENTRIES,
  type ArchiveEntryName,
  type IngestRefusal,
} from './types.js';

/** The subset of a tar entry header the policy reads. `type` uses the `tar` package's names. */
export interface EntryHeader {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export interface EntryCaps {
  readonly totalExpandedBytes: number;
}

export type EntryVerdict =
  | { readonly kind: 'accept'; readonly fixedName: string; readonly entry: ArchiveEntryName; readonly expandedTotal: number }
  | ({ readonly kind: 'refuse' } & IngestRefusal);

/**
 * Regular-file types only (BR-46.7). Every other type — `SymbolicLink`, `Link` (hard link), `Directory`,
 * `CharacterDevice`, `BlockDevice`, `FIFO`, pax and GNU extension headers that reach the policy as entries —
 * refuses the archive. ⚠️ Allowlisted, so a type added to the format later is refused, not admitted.
 */
const REGULAR_FILE_TYPES: ReadonlySet<string> = new Set(['File', 'OldFile', 'ContiguousFile']);

/** Anything that makes a name a path (BR-46.8). Checked on the raw name, before any normalisation. */
function pathShape(name: string): string | null {
  if (name.length === 0) return 'empty name';
  if (name.includes('\0')) return 'contains a NUL byte';
  if (name.includes('/')) return "contains '/'";
  if (name.includes('\\')) return "contains '\\'";
  if (name === '.' || name === '..' || name.includes('..')) return "contains '..'";
  if (/^[A-Za-z]:/.test(name)) return 'starts with a drive letter';
  return null;
}

function isArchiveEntryName(name: string): name is ArchiveEntryName {
  return Object.prototype.hasOwnProperty.call(ARCHIVE_ENTRIES, name);
}

/**
 * Decide one entry.
 *
 * @param seen   names already accepted from this archive (BR-46.9 — a later duplicate silently replacing an
 *               earlier, already-checked entry is a known tar trick)
 * @param expandedSoFar  bytes already accepted from this archive, before this entry
 */
export function decideEntry(
  header: EntryHeader,
  seen: ReadonlySet<string>,
  expandedSoFar: number,
  caps: EntryCaps,
): EntryVerdict {
  if (!REGULAR_FILE_TYPES.has(header.type)) {
    return { kind: 'refuse', rule: 'BR-46.7', detail: `entry "${header.name}" is a ${header.type}, not a regular file` };
  }
  const shape = pathShape(header.name);
  if (shape !== null) {
    return { kind: 'refuse', rule: 'BR-46.8', detail: `entry name ${JSON.stringify(header.name)} ${shape}` };
  }
  if (!isArchiveEntryName(header.name)) {
    return { kind: 'refuse', rule: 'BR-46.6', detail: `entry "${header.name}" is not part of a backup` };
  }
  if (seen.has(header.name)) {
    return { kind: 'refuse', rule: 'BR-46.9', detail: `entry "${header.name}" appears more than once` };
  }
  if (!Number.isSafeInteger(header.size) || header.size < 0) {
    return { kind: 'refuse', rule: 'BR-46.10', detail: `entry "${header.name}" declares an invalid size` };
  }
  const expandedTotal = expandedSoFar + header.size;
  if (expandedTotal > caps.totalExpandedBytes) {
    return {
      kind: 'refuse',
      rule: 'BR-46.10',
      detail: `archive expands past the ${caps.totalExpandedBytes}-byte limit`,
    };
  }
  return { kind: 'accept', fixedName: ARCHIVE_ENTRIES[header.name], entry: header.name, expandedTotal };
}

/** After the last entry: a backup must contain the required entries (BR-45.2). */
export function missingRequired(seen: ReadonlySet<string>): IngestRefusal | null {
  const missing = REQUIRED_ENTRIES.filter((name) => !seen.has(name));
  if (missing.length === 0) return null;
  return { rule: 'BR-46.6', detail: `not a backup made by this app: missing ${missing.join(', ')}` };
}
