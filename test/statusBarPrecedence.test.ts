/**
 * The one judgement `public/app.js` is allowed to duplicate — pinned so it cannot drift.
 *
 * ## ⚠️ Why a copy exists at all
 *
 * Every status-bar indicator arrives pre-derived from `src/ui/statusBar.ts`, except **Connection**, whose
 * input is the browser's own socket state and which no server can know. So `app.js` has to assemble the
 * indicator array itself — and therefore has to pick the one message out of it.
 *
 * That makes the *message precedence* the single piece of status-bar judgement that exists twice.
 *
 * ## ⭐ And a rule implemented twice is this project's worst defect
 *
 * The WebSocket `403` that left the UI on *"Disconnected — reconnecting…"* for the life of a deployment
 * was one admission rule written twice, where `TRUST_PUBLISHED_PORT` was added to one copy only. **All
 * 411 tests passed**, because the tests exercised the policy function and nothing exercised the second
 * copy. `attachPlayId` repeated it in U5 (found 2026-10-02 in review, not by a test).
 *
 * So: this test reads **both files** and fails if the two orderings disagree. It is not checking that the
 * precedence is correct — `statusBar.test.ts` does that — only that there is one of it.
 *
 * ⚠️ **Reads the files as text rather than importing them.** `app.js` is a browser script with no
 * exports, served statically with no bundler; there is nothing to import. Which is also precisely why
 * the duplication exists.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP_JS = new URL('../public/app.js', import.meta.url);
const STATUS_BAR = new URL('../src/ui/statusBar.ts', import.meta.url);

/** The levels `app.js` consults, in order, from its `MESSAGE_LEVELS` constant. */
function clientOrder(): string[] {
  const source = readFileSync(APP_JS, 'utf8');
  const match = /const MESSAGE_LEVELS = \[([^\]]*)\]/.exec(source);
  assert.ok(match !== null, 'app.js must declare MESSAGE_LEVELS — see renderStatusBar');
  return [...match[1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
}

/**
 * The levels `statusBar()` consults, in order, from its chain of `indicators.find(...)` calls.
 *
 * ⚠️ Read from the function body rather than from a constant, deliberately. The server version is
 * written as an explicit `??` chain because that is what makes the two-pass behaviour obvious at the
 * call site; extracting it into a shared constant purely to make this test easier would make the
 * precedence less legible where it actually runs.
 */
function serverOrder(): string[] {
  const source = readFileSync(STATUS_BAR, 'utf8');
  const start = source.indexOf('export function statusBar(');
  assert.ok(start > -1, 'statusBar() must still exist');
  const body = source.slice(start);
  const chain = /const worst =([\s\S]*?);/.exec(body);
  assert.ok(chain !== null, 'statusBar() must still select one message');
  return [...chain[1]!.matchAll(/i\.level === '([a-z-]+)'/g)].map((m) => m[1]!);
}

describe('⭐ the status message precedence exists exactly once, in two places', () => {
  it('app.js and statusBar.ts consult the same levels in the same order', () => {
    assert.deepEqual(
      clientOrder(),
      serverOrder(),
      'The client and server disagree about which indicator owns the one message slot. ' +
        'This is the WebSocket 403 shape: one rule, two copies, one of them updated. ' +
        'Fix public/app.js MESSAGE_LEVELS and src/ui/statusBar.ts statusBar() together.',
    );
  });

  it('⭐ ⚠️ `fail` is the ONLY level that takes the message slot', () => {
    // `halted` was in here until 2026-10-04, on the reasoning that a halt is the one thing the user must
    // act on. The reasoning held and the conclusion did not: the DOT already says `Automation HALTED`,
    // and the explanation belongs on the Rules pop-up beside the buttons that can clear it. The primary
    // screen stays visible for hours and a halt stands until acknowledged, so it would have parked a
    // paragraph there indefinitely.
    assert.deepEqual(serverOrder(), ['fail']);
  });

  it('every level named in the precedence is a real IndicatorLevel', () => {
    // A typo in either copy would silently never match, which is a precedence that looks implemented
    // and does nothing -- the decorative-guard shape.
    const union = readFileSync(STATUS_BAR, 'utf8');
    const declared = new Set(
      // The last member of the union carries a trailing `;`, so it must be optional here.
      [...union.matchAll(/^\s*\|?\s*'([a-z-]+)';?$/gm)].map((m) => m[1]!),
    );
    for (const level of [...serverOrder(), ...clientOrder()]) {
      assert.ok(declared.has(level), `'${level}' is not a declared IndicatorLevel`);
    }
  });
});

describe('⚠️ app.js still derives nothing else about the bar', () => {
  const app = () => readFileSync(APP_JS, 'utf8');

  it('the automation dot is taken from the server, never computed', () => {
    // FC-U5-1's seven states are derived by `automationIndicator`. If app.js started deciding any of
    // them, a false green would come from the one file nothing can test.
    const source = app();
    assert.ok(source.includes('server?.automation'), 'it reads the pre-derived indicator');
    assert.ok(!source.includes('passed-partial'), 'and names none of the seven states itself');
    assert.ok(!source.includes('lastAttemptUnconfirmed'), 'nor any of their inputs');
  });

  it('⭐ the kill switch takes its label, disabled state and warning from the server view', () => {
    // The documented worst case is a kill switch that works in the UI and does not persist. These
    // three are what `switchView` returns, and app.js must not second-guess any of them.
    const source = app();
    for (const field of ['view.label', 'view.disabled', 'view.warning', 'view.explanation', 'view.rendered']) {
      assert.ok(source.includes(field), `${field} must come from the server`);
    }
    // ⚠️ ONE halt button, and app.js must not invent a second. Three controls on screen at once is
    // what made recovery combinatorial (2026-10-04).
    assert.ok(!source.includes('automation-rearm'), 'the re-arm button is gone, not merely unused');
    assert.equal(
      (source.match(/data\.haltPanel/g) ?? []).length >= 1,
      true,
      'the panel is still rendered from the server view',
    );
  });

  it('⭐ ⚠️ app.js keeps NO optimistic enabled state', () => {
    // The failure mode this prevents: the button flips from a local variable, the page looks right, and
    // a restart silently re-arms automation because nothing reached the file. Every render comes from a
    // response body the server read back from disk.
    const source = app();
    assert.ok(
      !/\b(?:let|var)\s+automationEnabled\b/.test(source),
      'no local mirror of the switch state',
    );
    assert.ok(
      !/button\.dataset\.on\s*=\s*String\(!/.test(source),
      'and nothing toggles the rendered state without a round trip',
    );
  });
});
