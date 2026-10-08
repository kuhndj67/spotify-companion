/**
 * LC-33 — read and write a backup archive (`.tar.gz`) — P-39 *parse, never extract*; P-45 *allowlist what
 * travels*.
 *
 * ## Reading: the library parses; THIS code writes
 *
 * `tar` is used only as a stream PARSER. For each entry, `decideEntry` (LC-33a) decides; an accepted entry's
 * body is written by this code to a FIXED name it chooses (`ARCHIVE_ENTRIES`). The library never touches the
 * filesystem, and **no name from the archive is ever used as a path**.
 *
 * ⚠️ That is what removes `tar`'s published advisory class (2021: path traversal and symlink tricks in the
 * extract-to-disk path) STRUCTURALLY. A `../x` or symlink entry has nowhere to land — and probed 2026-10-07:
 * the parser reports entry names and types exactly as the archive carries them (`../history.db`,
 * `/history.db`, `SymbolicLink`, `Link`), so the policy judges what an attacker sent, not a cleaned-up copy.
 *
 * ## Never throws
 *
 * Every failure — not gzip, not tar, a refused entry, a missing entry, the wrong content — is returned as an
 * `IngestRefusal` naming its rule (BR-46.14). An exception here would be a crash path reachable by upload.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { Parser, create, type ReadEntry } from 'tar';

import { decideEntry, missingRequired } from './entryPolicy.js';
import {
  ARCHIVE_ENTRIES,
  EXPANDED_CAP_BYTES,
  type ArchiveEntryName,
  type IngestRefusal,
} from './types.js';

export type ReadArchiveResult =
  | { readonly ok: true; readonly entries: ReadonlySet<ArchiveEntryName> }
  | { readonly ok: false; readonly refusal: IngestRefusal };

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

async function startsWith(path: string, magic: Buffer): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(magic.length);
    const { bytesRead } = await handle.read(buf, 0, magic.length, 0);
    return bytesRead === magic.length && buf.equals(magic);
  } finally {
    await handle.close();
  }
}

/**
 * Read `archivePath` into `workDir` (an empty directory the caller created with `mkdtemp`).
 *
 * On refusal the caller deletes `workDir`; nothing outside it has been touched.
 */
export async function readArchive(
  archivePath: string,
  workDir: string,
  caps: { totalExpandedBytes: number } = { totalExpandedBytes: EXPANDED_CAP_BYTES },
): Promise<ReadArchiveResult> {
  // BR-46.11 — decided by the bytes, never by the filename or the Content-Type.
  if (!(await startsWith(archivePath, GZIP_MAGIC))) {
    return { ok: false, refusal: { rule: 'BR-46.11', detail: 'not a backup made by this app (not a gzip archive)' } };
  }

  const seen = new Set<ArchiveEntryName>();
  const writes: Promise<void>[] = [];
  let expanded = 0;
  let refusal: IngestRefusal | null = null;

  const source = createReadStream(archivePath);
  const parser = new Parser({
    strict: true,
    onReadEntry: (entry: ReadEntry) => {
      if (refusal !== null) {
        entry.resume();
        return;
      }
      const verdict = decideEntry({ name: entry.path, type: entry.type, size: entry.size }, seen, expanded, caps);
      if (verdict.kind === 'refuse') {
        refusal = { rule: verdict.rule, detail: verdict.detail };
        entry.resume();
        // Stop reading: a refused archive is refused WHOLE (BR-46.6), so decompressing the rest is wasted
        // work at best and a decompression bomb at worst.
        source.destroy();
        return;
      }
      seen.add(verdict.entry);
      expanded = verdict.expandedTotal;
      // ⚠️ `wx` — fail rather than overwrite. The work dir is fresh and duplicates are refused above, so this
      // can only fire if something else wrote there; it is defence in depth, not the defence.
      const out = createWriteStream(join(workDir, verdict.fixedName), { flags: 'wx' });
      writes.push(
        new Promise<void>((resolve, reject) => {
          out.on('close', resolve);
          out.on('error', reject);
        }),
      );
      entry.pipe(out);
    },
  });

  const parsed = await new Promise<IngestRefusal | null>((resolve) => {
    let settled = false;
    const done = (r: IngestRefusal | null) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    parser.on('error', (e: Error) => done({ rule: 'BR-46.11', detail: `not a valid backup archive: ${e.message}` }));
    parser.on('end', () => done(null));
    parser.on('close', () => done(null));
    source.on('error', (e) => done({ rule: 'BR-46.11', detail: `could not read the upload: ${e.message}` }));
    // A destroyed source (after a refusal) never ends the parser — settle on the source closing.
    source.on('close', () => {
      if (refusal !== null) done(null);
    });
    source.pipe(parser);
  });

  try {
    await Promise.all(writes);
  } catch (e) {
    return { ok: false, refusal: { rule: 'BR-46.11', detail: `could not stage the upload: ${(e as Error).message}` } };
  }
  if (refusal !== null) return { ok: false, refusal };
  if (parsed !== null) return { ok: false, refusal: parsed };

  const missing = missingRequired(seen);
  if (missing !== null) return { ok: false, refusal: missing };

  // BR-46.11 — the database is decided by its bytes too.
  if (!(await startsWith(join(workDir, ARCHIVE_ENTRIES['history.db']), SQLITE_MAGIC))) {
    return { ok: false, refusal: { rule: 'BR-46.11', detail: 'history.db in this archive is not a SQLite database' } };
  }
  return { ok: true, entries: seen };
}

/**
 * Write exactly the allowlisted entries present in `workDir` as a gzip-compressed tar stream (P-45).
 *
 * ⚠️ The entry list is the allowlist filtered by the caller's `present` set — never a directory listing. A
 * stray file in the work dir (or a future one) cannot ride along.
 */
export function writeArchive(workDir: string, present: ReadonlySet<ArchiveEntryName>): Readable {
  const names = (Object.keys(ARCHIVE_ENTRIES) as ArchiveEntryName[]).filter((n) => present.has(n));
  // `portable` drops uid/gid/uname/mtime-of-the-machine; no host-identifying metadata travels (FD Q3 = A).
  return create({ gzip: true, cwd: workDir, portable: true, noDirRecurse: true }, names) as unknown as Readable;
}
