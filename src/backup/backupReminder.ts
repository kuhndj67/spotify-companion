/**
 * LC-81 — a reminder to keep a copy elsewhere (U10, FR-82, BR-87).
 *
 * Owner, 2026-10-22, after deciding that backups always live beside the database (IN-U10-2): *"I'd like to add a
 * diagnostic warning (yellow) that asserts if the user has not downloaded a backup in more than a week. (unless
 * they opt-out by shutting it off, which would make sense if the entire hosting environment is automatically backed
 * up for instance)."*
 *
 * - Only a *Create backup* download that **completed** counts: kept backups share the database's disk, and a
 *   click is not a file. The app cannot know the file was kept, so the words say *downloaded*, never *saved*.
 * - A fresh install's week starts at its first run, so nobody is warned on day one.
 * - **warn**, never fail: a missing off-machine copy is a risk, not a fault.
 * - Kept in `state/`, NOT `data/`: restoring an older database must not roll the date back.
 */

import { existsSync, readFileSync } from 'node:fs';

import { writeFileAtomic } from '../configuration/atomicWrite.js';

export const REMINDER_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ReminderState {
  readonly enabled: boolean;
  readonly lastDownloadAt: string | null;
  readonly firstRunAt: string;
}

export type ReminderVerdict = { readonly level: 'ok' | 'warn' | 'off'; readonly detail: string };

/** ⚙️ PURE (PBT-90). */
export function reminderLevel(state: ReminderState, nowMs: number): ReminderVerdict {
  if (!state.enabled) return { level: 'off', detail: 'The weekly backup reminder is off.' };
  const last = state.lastDownloadAt === null ? null : Date.parse(state.lastDownloadAt);
  const since = Math.max(last ?? Number.NEGATIVE_INFINITY, Date.parse(state.firstRunAt));
  const days = Math.floor((nowMs - since) / DAY_MS);
  if (nowMs - since > REMINDER_DAYS * DAY_MS) {
    return {
      level: 'warn',
      detail:
        last === null
          ? `No backup has been downloaded since this app was first run, ${days} days ago. Settings → Create backup, and keep the file somewhere other than this computer's data folder.`
          : `No backup downloaded since ${state.lastDownloadAt!.slice(0, 10)} (${days} days). Settings → Create backup, and keep the file somewhere other than this computer's data folder.`,
    };
  }
  return {
    level: 'ok',
    detail: last === null ? 'No backup downloaded yet; the reminder starts after the first week.' : `Backup last downloaded ${state.lastDownloadAt!.slice(0, 10)}.`,
  };
}

/** The reminder's file, `state/backup-reminder.json`. One writer: this process. */
export class BackupReminder {
  readonly #path: string;
  readonly #now: () => Date;
  #state: ReminderState;

  constructor(path: string, now: () => Date = () => new Date()) {
    this.#path = path;
    this.#now = now;
    this.#state = this.#load();
  }

  get state(): ReminderState {
    return this.#state;
  }

  verdict(): ReminderVerdict {
    return reminderLevel(this.#state, this.#now().getTime());
  }

  setEnabled(enabled: boolean): void {
    this.#save({ ...this.#state, enabled });
  }

  /** BR-87.1: call only when a download's last byte has been sent. */
  recordDownload(): void {
    this.#save({ ...this.#state, lastDownloadAt: this.#now().toISOString() });
  }

  #load(): ReminderState {
    if (existsSync(this.#path)) {
      try {
        const raw = JSON.parse(readFileSync(this.#path, 'utf8')) as Partial<ReminderState>;
        if (typeof raw.firstRunAt === 'string') {
          return {
            enabled: raw.enabled !== false,
            lastDownloadAt: typeof raw.lastDownloadAt === 'string' ? raw.lastDownloadAt : null,
            firstRunAt: raw.firstRunAt,
          };
        }
      } catch {
        // An unreadable file is replaced below, keeping the reminder ON: a broken switch must not silence it.
      }
    }
    const fresh: ReminderState = { enabled: true, lastDownloadAt: null, firstRunAt: this.#now().toISOString() };
    this.#write(fresh);
    return fresh;
  }

  #save(next: ReminderState): void {
    this.#state = next;
    this.#write(next);
  }

  #write(state: ReminderState): void {
    const outcome = writeFileAtomic(this.#path, `${JSON.stringify(state, null, 2)}\n`);
    if (!outcome.ok) console.warn(`[backup] could not save the reminder state (${outcome.reason}); it applies until restart`);
  }
}
