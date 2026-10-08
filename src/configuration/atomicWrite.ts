/**
 * Write-temp-then-rename, and the writability probe — ONE copy (LC-42, P-51). 🔌 IMPURE
 *
 * Extracted from `AutomationStateStore` (U5) so that U7's `RulesWriter` uses the same mechanism rather than a
 * second implementation of it. This project has shipped a policy that was copied and then diverged (the
 * WebSocket `403`), so the rule is: **import it, never re-write it.**
 *
 * ## ⚠️ Only for files on a DIRECTORY mount
 *
 * Rename replaces the inode. Through a **single-file** bind mount that either fails or silently detaches the
 * container's view from the host file — so `spotify-config.json` and `musicbrainz.json`, which are single-file
 * mounts, are written in place by `CredentialsWriter` and must never come through here.
 *
 * ⚠️ The temp file is a fixed sibling name (`.<base>.tmp`), not a random one. That is safe because every caller
 * serialises its own writes (U5's store has one writer; `RulesWriter` holds a mutex, P-52), and it means a crash
 * can leave at most ONE stray temp file per target rather than an unbounded number.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type AtomicWriteOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Replace `path` with `content` atomically: a reader sees the old file or the new one, never a partial write.
 *
 * ⚠️ **Returns an outcome; never throws.** Callers apply their own policy to a failure (U5's P-31 asymmetry,
 * U7's refusal reasons) and cannot do that from an exception they have to remember to catch.
 */
export function writeFileAtomic(path: string, content: string): AtomicWriteOutcome {
  const temp = tempPathFor(path);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, path);
    return { ok: true };
  } catch (error) {
    // Best effort: a stray temp file is harmless, but leaving one behind on every failed write would slowly
    // fill the mount.
    try {
      rmSync(temp, { force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, reason: describe(error) };
  }
}

/** The sibling temp file `writeFileAtomic` uses for `path`. Exposed so a sweep or a test can name it. */
export function tempPathFor(path: string): string {
  return join(dirname(path), `.${basename(path)}.tmp`);
}

/**
 * Can this process actually create files beside `path`?
 *
 * ⚠️ **A PROBE, not an inference from `compose.yaml`** — a `:ro` left in place reads fine and fails only on the
 * first write. Verify through the container, never on the host, where the write succeeds and the bug is
 * invisible.
 */
export function probeDirectoryWritable(path: string): boolean {
  const probe = join(dirname(path), `.${basename(path)}.probe`);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(probe, 'probe', 'utf8');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
