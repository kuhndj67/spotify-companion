/**
 * Streams listening history out as a download (FR-49–54, BR-6).
 *
 * ## It streams rather than buffers
 *
 * A year of history is ~73k play rows. Building that into a string before responding would stall
 * the event loop, and with it the now-playing display — the one thing U1 must never do.
 *
 * ## Validation happens before the first byte
 *
 * Once output has begun there is no status code left to change: a failure mid-stream can only
 * terminate the connection and log. So the filter is validated and the repository confirmed
 * readable up front (BR-6.10), while an error can still be reported properly.
 */

import type { Writable } from 'node:stream';
import type { HistoryRepository } from '../history/HistoryRepository.js';
import type { HistoryFilter } from '../history/types.js';
import {
  coverageAsCsvComments,
  toCsvHeader,
  toCsvRow,
  toJsonObject,
} from './serialisers.js';

export type ExportFormat = 'csv' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  filter?: HistoryFilter;
}

export class ExportValidationError extends Error {}

/** Rejects a bad filter while a proper error response is still possible. */
export function validateFilter(raw: Record<string, unknown>): HistoryFilter {
  const filter: HistoryFilter = {};

  for (const key of ['since', 'until'] as const) {
    const value = raw[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new ExportValidationError(`${key} must be an ISO 8601 timestamp, got "${String(value)}"`);
    }
    filter[key] = new Date(value).toISOString();
  }

  const outcome = raw.outcome;
  if (outcome !== undefined && outcome !== '') {
    if (outcome !== 'completed' && outcome !== 'skipped' && outcome !== 'unknown') {
      throw new ExportValidationError(
        `outcome must be completed, skipped or unknown, got "${String(outcome)}"`,
      );
    }
    filter.outcome = outcome;
  }

  const limit = raw.limit;
  if (limit !== undefined && limit !== '') {
    const parsed = Number.parseInt(String(limit), 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new ExportValidationError(`limit must be a positive integer, got "${String(limit)}"`);
    }
    filter.limit = parsed;
  }

  return filter;
}

export function parseFormat(raw: unknown): ExportFormat {
  if (raw === undefined || raw === '' || raw === 'csv') return 'csv';
  if (raw === 'json') return 'json';
  throw new ExportValidationError(`format must be csv or json, got "${String(raw)}"`);
}

export function suggestedFilename(format: ExportFormat, nowIso: string): string {
  const stamp = nowIso.replace(/[:.]/g, '-').replace(/Z$/, '');
  return `listening-history-${stamp}.${format}`;
}

export class ExportService {
  #repo: HistoryRepository;

  constructor(repo: HistoryRepository) {
    this.#repo = repo;
  }

  contentType(format: ExportFormat): string {
    return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
  }

  /**
   * Write an export to any sink — an HTTP response, or a file for the FR-56 snapshot.
   *
   * Returns the number of rows written, which is what the snapshot scheduler reports and what
   * makes an empty export distinguishable from a failed one.
   */
  async writeTo(target: Writable, options: ExportOptions): Promise<number> {
    // Read coverage first: it is a cheap query, and doing it before any output means a failure
    // here is still reportable as an error rather than a truncated download.
    const coverage = this.#repo.coverage();
    let rows = 0;

    const write = (chunk: string): Promise<void> =>
      new Promise((resolve, reject) => {
        if (target.write(chunk)) {
          resolve();
          return;
        }
        // Respect backpressure: a slow consumer must not cause unbounded buffering.
        target.once('drain', resolve);
        target.once('error', reject);
      });

    if (options.format === 'csv') {
      await write(`${coverageAsCsvComments(coverage)}\n${toCsvHeader()}\n`);
      for (const play of this.#repo.listPlays(options.filter)) {
        await write(`${toCsvRow(play)}\n`);
        rows++;
      }
    } else {
      await write(`{"coverage":${JSON.stringify(coverage)},"plays":[`);
      let first = true;
      for (const play of this.#repo.listPlays(options.filter)) {
        await write(`${first ? '' : ','}${JSON.stringify(toJsonObject(play))}`);
        first = false;
        rows++;
      }
      await write(`],"exported_count":${rows}}`);
    }

    return rows;
  }
}
