/**
 * Automatic dated export snapshots (FR-56).
 *
 * ## Why this exists
 *
 * Listening history is the only artefact in this project that cannot be regenerated. Code comes
 * back from git, enrichment from Spotify, labels from MusicBrainz — months of play records come
 * back from nowhere.
 *
 * Relying on the user to remember to export has a specific failure mode: discovering months later
 * that no export was ever made. The export pipeline already exists in this unit, so the marginal
 * cost of pointing it at a file on a timer is small.
 *
 * ## What it does not protect against
 *
 * Snapshots live in the same `./data/` directory as the database, inside the project tree, and
 * that directory is gitignored — which makes it *more* exposed to `git clean -xdf`, not less.
 *
 * **This guards against corruption, not against losing the directory.** Recorded as an accepted
 * residual risk in the infrastructure design; `SNAPSHOT_DIR` can be pointed outside the project
 * tree at any time without code changes if that trade stops feeling right.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import type { ExportService } from './ExportService.js';

export interface SnapshotStatus {
  lastRunAt: string | null;
  lastRowCount: number | null;
  lastError: string | null;
  runs: number;
}

const PREFIX = 'history-snapshot-';

export class SnapshotScheduler {
  #exportService: ExportService;
  #directory: string;
  #intervalMs: number;
  #keep: number;
  #timer: NodeJS.Timeout | null = null;
  #status: SnapshotStatus = { lastRunAt: null, lastRowCount: null, lastError: null, runs: 0 };

  constructor(exportService: ExportService, directory: string, intervalHours: number, keep: number) {
    this.#exportService = exportService;
    this.#directory = directory;
    this.#intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
    this.#keep = Math.max(1, keep);
  }

  get status(): SnapshotStatus {
    return { ...this.#status };
  }

  start(): void {
    if (this.#timer) return;
    // Deliberately not run at startup: a restart loop would otherwise produce a snapshot per
    // restart and rotate the useful history out of the retention window.
    this.#timer = setInterval(() => void this.run(), this.#intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async run(): Promise<SnapshotStatus> {
    const startedAt = new Date().toISOString();
    this.#status.runs++;

    try {
      await mkdir(this.#directory, { recursive: true });

      const filename = `${PREFIX}${startedAt.replace(/[:.]/g, '-').replace(/Z$/, '')}.csv`;
      const path = join(this.#directory, filename);
      const stream = createWriteStream(path, { encoding: 'utf8' });

      const rows = await this.#exportService.writeTo(stream, { format: 'csv' });
      stream.end();
      await once(stream, 'finish');

      await this.#rotate();

      this.#status.lastRunAt = startedAt;
      this.#status.lastRowCount = rows;
      this.#status.lastError = null;
    } catch (error) {
      // Non-fatal by design: a failed backup must never take down the app it is backing up.
      this.#status.lastError = error instanceof Error ? error.message : String(error);
      console.error('[snapshot] failed:', this.#status.lastError);
    }

    return this.status;
  }

  /**
   * Keep the most recent N.
   *
   * Snapshots rotate freely because they are *derived* — regenerable from the database at any
   * time. Observation trails are not, which is why W-2 defers their pruning to a considered
   * routine rather than a timer. That asymmetry is the whole retention policy.
   */
  async #rotate(): Promise<void> {
    const entries = (await readdir(this.#directory))
      .filter((name) => name.startsWith(PREFIX))
      .sort();

    for (const stale of entries.slice(0, Math.max(0, entries.length - this.#keep))) {
      await unlink(join(this.#directory, stale)).catch(() => {});
    }
  }
}
