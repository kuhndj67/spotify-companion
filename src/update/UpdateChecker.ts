/**
 * LC-80 — tells the user a newer version exists (U10, FR-81, BR-85, P-87). It never updates anything.
 *
 * ⚠️ **The app's first outbound call to a service that is neither Spotify nor MusicBrainz.** GitHub learns the
 * user's IP address and, from the timing, that they run the app. On by default (owner, Q35 = B); the Settings switch
 * and its sentence are the user's notice. Off means NO request at all, including the startup one.
 *
 * - ONE anonymous `GET …/releases?per_page=10`. ⚠️ Never `/releases/latest`: measured 404 while every release is a
 *   pre-release, so a check built on it would always say *up to date*.
 * - Its OWN User-Agent, `spotify-companion/<version>`. ⚠️ Never the MusicBrainz one: it carries the user's contact
 *   address (NFR-14).
 * - Bounded: 10 s timeout, 1 MB of response, redirects followed only within `api.github.com`, no token or cookie.
 * - Shortly after start (unless the last check was under an hour ago: a restart loop must not become a request per
 *   restart), then every 24 hours. Its own timer; never the Spotify client, queue or budget.
 * - A failure is a value: the last good answer stays, and Settings says *could not check (time)*.
 */

import { existsSync, readFileSync } from 'node:fs';

import { writeFileAtomic } from '../configuration/atomicWrite.js';
import { newestRelease, parseReleases } from './releaseChoice.js';

export const RELEASES_URL = 'https://api.github.com/repos/kuhndj67/spotify-companion/releases?per_page=10';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const FIRST_CHECK_AFTER_MS = 60_000;
const MIN_GAP_MS = 60 * 60 * 1000;
const EVERY_MS = 24 * 60 * 60 * 1000;

export type UpdateStatus = 'off' | 'not-yet' | 'current' | 'newer';

export interface UpdateCheckResult {
  readonly status: UpdateStatus;
  readonly newest: { readonly version: string; readonly pageUrl: string | null } | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
}

interface Preference {
  readonly enabled: boolean;
  readonly lastCheckedAt: string | null;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal }) => Promise<Response>;

export interface UpdateCheckerDeps {
  /** `state/update-check.json`. */
  readonly path: string;
  readonly runningVersion: string;
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

export class UpdateChecker {
  readonly #deps: UpdateCheckerDeps;
  readonly #now: () => Date;
  readonly #fetch: FetchLike;
  readonly #log: (line: string) => void;
  #pref: Preference;
  #result: Omit<UpdateCheckResult, 'status'> & { checked: boolean; newer: boolean } = {
    newest: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    checked: false,
    newer: false,
  };
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(deps: UpdateCheckerDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => new Date());
    this.#fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.#log = deps.log ?? ((line) => console.log(line));
    this.#pref = this.#load();
  }

  get enabled(): boolean {
    return this.#pref.enabled;
  }

  result(): UpdateCheckResult {
    const r = this.#result;
    const status: UpdateStatus = !this.#pref.enabled ? 'off' : !r.checked ? 'not-yet' : r.newer ? 'newer' : 'current';
    return { status, newest: r.newest, lastSuccessAt: r.lastSuccessAt, lastFailureAt: r.lastFailureAt };
  }

  /** Schedules the first check (BR-85.2), then one every 24 hours. Disabled → nothing at all. */
  start(): void {
    this.stop();
    if (!this.#pref.enabled) return;
    this.#timer = setTimeout(() => {
      void this.check();
      this.#timer = setInterval(() => void this.check(), EVERY_MS);
      this.#timer.unref();
    }, this.firstDelayMs());
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** ≈1 minute after start, or later if the last check (kept across restarts) was under an hour ago. */
  firstDelayMs(): number {
    const last = this.#pref.lastCheckedAt === null ? null : Date.parse(this.#pref.lastCheckedAt);
    const sinceLast = last === null ? Infinity : this.#now().getTime() - last;
    return Math.max(FIRST_CHECK_AFTER_MS, MIN_GAP_MS - sinceLast);
  }

  /** The Settings switch. Turning it on schedules a check under the same one-hour rule. */
  setEnabled(enabled: boolean): void {
    this.#save({ ...this.#pref, enabled });
    if (enabled) this.start();
    else this.stop();
  }

  /** One check. Never throws; never runs while disabled. */
  async check(): Promise<UpdateCheckResult> {
    if (!this.#pref.enabled || this.#running) return this.result();
    this.#running = true;
    const at = this.#now().toISOString();
    this.#save({ ...this.#pref, lastCheckedAt: at });
    try {
      const body = await this.#get(RELEASES_URL);
      const newest = newestRelease(parseReleases(JSON.parse(body)), this.#deps.runningVersion);
      this.#result = {
        newest: newest === null ? null : { version: newest.version, pageUrl: newest.pageUrl },
        newer: newest?.newer ?? false,
        lastSuccessAt: at,
        lastFailureAt: this.#result.lastFailureAt,
        checked: true,
      };
    } catch (error) {
      // BR-85.7: silent. The last good answer stays.
      this.#result = { ...this.#result, lastFailureAt: at };
      this.#log(`[update] could not check for a newer version: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.#running = false;
    }
    return this.result();
  }

  async #get(start: string): Promise<string> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const res = await this.#fetch(url, {
        headers: { 'User-Agent': `spotify-companion/${this.#deps.runningVersion}`, Accept: 'application/vnd.github+json' },
        redirect: 'manual',
        signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error(`redirect ${res.status} without a location`);
        const next = new URL(location, url);
        if (next.protocol !== 'https:' || next.hostname !== 'api.github.com') throw new Error(`redirect to ${next.hostname} refused`);
        url = next.toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await readCapped(res, MAX_BYTES);
    }
    throw new Error('too many redirects');
  }

  #load(): Preference {
    if (existsSync(this.#deps.path)) {
      try {
        const raw = JSON.parse(readFileSync(this.#deps.path, 'utf8')) as Partial<Preference>;
        return { enabled: raw.enabled !== false, lastCheckedAt: typeof raw.lastCheckedAt === 'string' ? raw.lastCheckedAt : null };
      } catch {
        // An unreadable file: default (on), and it is rewritten at the next change.
      }
    }
    return { enabled: true, lastCheckedAt: null };
  }

  #save(next: Preference): void {
    this.#pref = next;
    const outcome = writeFileAtomic(this.#deps.path, `${JSON.stringify(next, null, 2)}\n`);
    if (!outcome.ok) this.#log(`[update] could not save the update-check preference (${outcome.reason})`);
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`response larger than ${max} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
