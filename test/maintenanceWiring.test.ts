/**
 * U6's wiring in `server.ts`, pinned STRUCTURALLY — the same technique `localGuard.test.ts` uses for the
 * WebSocket upgrade handler, and for the same reason: `server.ts` cannot be imported by a test (importing it
 * starts the process), so the order of its statements is otherwise checked by nothing.
 *
 * ## ⭐ What is pinned
 *
 *   1. **The startup restore and the sweep run BEFORE any `new SqliteHistoryRepository(...)`** (P-38, LC-37).
 *      This order is the whole of U6's "no second writer" guarantee: moved below the repository, the swap
 *      would rename a file the app is already writing.
 *   2. **There is ONE shutdown path, and the restart request goes through it.** A restore that called
 *      `process.exit` directly would skip flushing the in-progress play and closing the database.
 *   3. **The maintenance service is handed to the routes and to diagnostics** — a service built and never
 *      wired is the `recordSuccessorLag` shape.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Line endings normalised: the file is CRLF on Windows checkouts, and the pins below anchor on line breaks.
const SERVER = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Code only: comments may (and do) mention these names while explaining them. */
const CODE = SERVER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const at = (needle: string) => {
  const i = CODE.indexOf(needle);
  assert.notEqual(i, -1, `server.ts no longer contains \`${needle}\` — update this pin deliberately, never silently`);
  return i;
};

describe('server.ts — U6 wiring', () => {
  it('⭐ applies a pending restore, then sweeps, BEFORE the history database is constructed', () => {
    const restore = at('applyPendingRestore(historyDataDir)');
    const sweep = at('sweepLeftovers(historyDataDir)');
    const firstOpen = at('new SqliteHistoryRepository(');
    assert.ok(restore < sweep, 'restore first, then sweep — the sweep must not remove an applicable restore');
    assert.ok(sweep < firstOpen, 'both before the database is opened');
    for (const m of CODE.matchAll(/new SqliteHistoryRepository\(/g)) {
      assert.ok(m.index! > sweep, 'EVERY construction of the repository comes after the restore and the sweep');
    }
  });

  it('⭐ has exactly one process exit, inside the one shutdown function, and the restart request uses it', () => {
    const exits = [...CODE.matchAll(/process\.exit\(/g)];
    assert.equal(exits.length, 1, 'one exit path');
    const fn = at('function shutdown(');
    const end = CODE.indexOf('\n}\n', fn);
    assert.ok(exits[0]!.index! > fn && exits[0]!.index! < end, 'the exit lives inside shutdown()');
    assert.match(CODE, /requestRestart:[^\n]*shutdown\(/, 'the restore restart goes through shutdown()');
  });

  it('hands the maintenance service to the routes and to diagnostics', () => {
    assert.match(CODE, /\n\s*maintenance,\n/, 'createApi({ ... maintenance, ... })');
    assert.match(CODE, /maintenance\?\.status\(\)/, 'runDiagnostics(..., maintenance?.status())');
  });
});
