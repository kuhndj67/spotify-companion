/**
 * The persisted latches — the FR-38 kill switch and the BR-35 runaway halt. 🔌 IMPURE (LC-29)
 *
 * Lives at **`/state/automation-state.json`**, on a mount that exists only for app-written state.
 *
 * ## ⚠️ Why not `config/`, which the Functional Design originally specified
 *
 * `config/` holds `rules.json`, the user's hand-authored rule set, and making that directory writable
 * would grant this app permission to overwrite it — a permission **no code in U5 would ever use**.
 * BR-30 rejects the same shape one level down: it forbids giving `LoggingExecutor` a playback
 * collaborator it never calls, because an unused capability leaves one line of code preventing its use.
 *
 * ⚠️ **And BR-20.8 would not have caught a truncation.** Its last-known-good path reloads the previous
 * rule set when a new file **fails to parse**; a file truncated to valid-but-empty JSON parses
 * successfully and would be accepted as a deliberate empty rule set.
 *
 * ⚠️ **`data/` was rejected because of RESTORE.** Once W-5's full-inventory backup exists, restoring a
 * week-old backup would also restore the week-old latch — **re-arming automation with nothing saying
 * so.** A kill switch recoverable from an archive is not reliably off. Settled Infrastructure Q1 = C.
 *
 * ## ⚠️ `./state` must be a DIRECTORY mount
 *
 * A single-file bind mount binds an **inode**, and `write` replaces the inode by renaming a temp file
 * over the target. Through a single-file mount that rename either fails outright or silently detaches
 * the container's view from the host file — so the switch would appear to work and not persist.
 */

import { existsSync, readFileSync } from 'node:fs';

import { probeDirectoryWritable, writeFileAtomic } from '../configuration/atomicWrite.js';
import type { AutomationState, RunawayHalt, WriteOutcome } from './types.js';

export const AUTOMATION_STATE_SCHEMA = 1;

/**
 * ⚠️ **The fail-closed answer** (BR-34.5, FR-47). A fresh install, a missing file, an unparseable file
 * and a half-written file all mean **off**. A corrupt file must never be a path to *on*.
 */
const CLOSED: AutomationState = {
  globalAutomationEnabled: false,
  runawayHalt: null,
  schemaVersion: AUTOMATION_STATE_SCHEMA,
};

/**
 * Where the answer came from.
 *
 * ⚠️ **This exists because "off" and "we could not tell" are different facts**, and diagnostics has to
 * report which (Infrastructure Q6/Q8). Both produce automation **off**, which is correct — but a user
 * shown a plain "off" while the file is corrupt would believe they had turned it off themselves, and
 * would not know the system had lost their halt acknowledgement. Reporting a halt we cannot read would
 * be fabrication; reporting *unreadable* is the honest third answer.
 */
export type StateSource = 'file' | 'absent' | 'unreadable';

export interface ReadResult {
  readonly state: AutomationState;
  readonly source: StateSource;
  /** Present only when `source` is `unreadable`. */
  readonly detail?: string;
}

export class AutomationStateStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  /** The file this store reads and writes, for diagnostics. */
  get path(): string {
    return this.#path;
  }

  /**
   * ⚠️ **Never throws.** A store that threw on a corrupt file would take the poll loop down with it,
   * and NFR-13 says this subsystem degrades rather than crashing: an unreadable state file means
   * automation cannot be **armed**, not that the app stops **recording**. Recording is the
   * irreplaceable function.
   */
  read(): ReadResult {
    if (!existsSync(this.#path)) return { state: CLOSED, source: 'absent' };

    let raw: string;
    try {
      raw = readFileSync(this.#path, 'utf8');
    } catch (error) {
      return { state: CLOSED, source: 'unreadable', detail: describe(error) };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // ⚠️ A HALF-WRITTEN file lands here, and that is the case the atomic rename in `write` exists to
      // prevent us ever producing. It can still happen if someone edits the file by hand.
      return { state: CLOSED, source: 'unreadable', detail: `invalid JSON: ${describe(error)}` };
    }

    const state = validate(parsed);
    return state === null
      ? { state: CLOSED, source: 'unreadable', detail: 'state file did not match the expected shape' }
      : { state, source: 'file' };
  }

  /**
   * Persist state by **write-temp-then-rename** (BR-34.2).
   *
   * ⚠️ **Returns an outcome; never throws into the caller's lap.** The caller has to apply P-31's
   * asymmetry — *a write failure never blocks disarming, and always blocks arming* — and it cannot do
   * that from an exception it has to remember to catch.
   *
   * ⚠️ **Writing in place is what this avoids.** A reader polling the file can see a partial write, and
   * the one control that must never be misread is this one. Rename is atomic within a filesystem, so a
   * reader sees either the old file or the new one.
   */
  write(next: AutomationState): WriteOutcome {
    // U7 (LC-42): the mechanism now lives in ONE shared helper, so `RulesWriter` cannot grow a second copy.
    return writeFileAtomic(this.#path, `${JSON.stringify(next, null, 2)}\n`);
  }

  /**
   * Can this process actually write to the state directory?
   *
   * ⚠️ **A PROBE, not an inference from `compose.yaml`** — the project's standing rule applied to the
   * filesystem rather than to an API. The directory is a new mount; if it is missing Docker creates it,
   * and on this host a Docker-created bind-mount directory came out `rwxrwxrwx root:root` and was
   * **readable** by the app (measured 2026-09-11). That measurement covered reads, and this needs a
   * write.
   *
   * ⚠️ **It must NOT prevent startup.** NFR-13: an unwritable `/state` means automation cannot be
   * armed, not that the app stops recording. The failure it exists to catch presents as *a kill switch
   * that works in the UI and does not persist* — the worst failure mode this control could have — so
   * the answer is surfaced in diagnostics and the arming path refuses, while the poll loop carries on.
   *
   * ⚠️ **Verify through the container, never on the host**, where the write succeeds and the bug is
   * invisible.
   */
  probeWritable(): boolean {
    return probeDirectoryWritable(this.#path);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ⚠️ **Validates the shape rather than trusting it**, and returns `null` on anything unexpected so the
 * caller falls back to CLOSED.
 *
 * A partially-correct file is the dangerous input: `{ "globalAutomationEnabled": true }` with no
 * `schemaVersion` would, under a permissive parse with defaults, **arm automation** from a file that
 * was never written by this code. That is the one direction a corrupt file must not be able to go.
 */
function validate(value: unknown): AutomationState | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;

  if (typeof o['globalAutomationEnabled'] !== 'boolean') return null;
  if (typeof o['schemaVersion'] !== 'number') return null;

  // ⚠️ An unknown schema version is NOT read optimistically. A future format could mean the opposite
  // of what this code assumes, and the safe reading of "I do not understand this file" is off.
  if (o['schemaVersion'] !== AUTOMATION_STATE_SCHEMA) return null;

  const haltRaw = o['runawayHalt'];
  let halt: RunawayHalt | null = null;
  if (haltRaw !== null && haltRaw !== undefined) {
    halt = validateHalt(haltRaw);
    // ⚠️ A halt field present but malformed is NOT treated as "no halt". That would clear a latch the
    // system set for its own protection, which BR-35.6 reserves for an explicit acknowledgement.
    if (halt === null) return null;
  }

  return {
    globalAutomationEnabled: o['globalAutomationEnabled'],
    runawayHalt: halt,
    schemaVersion: AUTOMATION_STATE_SCHEMA,
  };
}

function validateHalt(value: unknown): RunawayHalt | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;

  if (typeof o['haltedAt'] !== 'string') return null;
  if (o['trigger'] !== 'consecutive' && o['trigger'] !== 'hourly-rate') return null;
  if (typeof o['observedCount'] !== 'number') return null;
  if (typeof o['threshold'] !== 'number') return null;
  if (!Array.isArray(o['attemptIds']) || o['attemptIds'].some((n) => typeof n !== 'number')) {
    return null;
  }

  return {
    haltedAt: o['haltedAt'],
    trigger: o['trigger'],
    observedCount: o['observedCount'],
    threshold: o['threshold'],
    attemptIds: o['attemptIds'] as number[],
  };
}
