/**
 * P-33 — the U5 phase boundary, asserted STRUCTURALLY over the source text.
 *
 * ## ⚠️ Why a source-text test rather than a behavioural one
 *
 * U3's containment guarantee was *"`git status src/` shows only `src/rules/`"*. U4's was
 * *"`src/playback/` does not exist"*. Both were facts about the repository, and both are now spent —
 * `src/playback/` exists and `SkipExecutor` can issue a `POST`. What replaces them has to be checkable
 * by something other than a human reading a diff, because the thing being prevented is a future edit.
 *
 * ## ⭐ The three things pinned here, and the defect each one is about
 *
 *   1. **Nothing in `src/rules/` imports `src/playback/`.** The rules engine is the large, uncertain
 *      component; playback control is the only part that can cause harm. They are in different phases
 *      so the risky one ships where being wrong costs nothing. An import in that direction collapses
 *      the separation silently — the tests would all still pass.
 *   2. **The player client exposes exactly one method.** `skipToNext` and nothing else. A client that
 *      grew `pause`, `seek` or `addToQueue` would widen what a defect in the drain could do, and a
 *      reviewer reading the drain would have no reason to notice.
 *   3. **`skipAttempts.attachPlayId` is called from exactly ONE place.** Found 2026-10-02 in review: a
 *      second call sat on `PlayObserver`'s `onPlayRecorded` hook, where the coordinator's *"is this
 *      still the play that was decided"* guard does not apply — so on a fast track change it would
 *      have attached the closing play's id to the NEXT play's attempt. One rule implemented twice,
 *      with the second copy missing a term: the WebSocket `403`, exactly.
 *
 * ⚠️ These read files from disk rather than importing them. That is deliberate: an import proves a
 * module loads, and what is being asserted here is what the source *says*.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SpotifyPlayerClient } from '../src/playback/spotifyPlayerClient.js';

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Import specifiers only — never a substring match over the whole file.
 *
 * ⚠️ `src/rules/LoggingExecutor.ts` and `src/rules/DecisionLogRepository.ts` both DISCUSS
 * `src/playback/` at length in their docstrings, explaining the boundary this test enforces. A naive
 * `includes('playback/')` fails on the comments that document the rule, which is the kind of failure
 * that gets a test deleted rather than fixed.
 */
function importSpecifiers(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  const pattern = /\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stripped)) !== null) {
    out.push(match[1] ?? match[2] ?? '');
  }
  return out;
}

describe('⭐ P-33 — src/rules/ imports nothing from src/playback/', () => {
  it('holds for every module under src/rules/', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(join(SRC, 'rules'))) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier.includes('playback/')) offenders.push(`${file} -> ${specifier}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'The rules engine must not reach into playback control. The phases are separate so the ' +
        'uncertain component ships where being wrong costs nothing, and is back-tested before it ' +
        'is armed. These imports collapse that, and every other test would still pass:\n  ' +
        offenders.join('\n  '),
    );
  });

  it('⚠️ and the check is not fooled by the docstrings that EXPLAIN the boundary', () => {
    // Two files under src/rules/ discuss src/playback/ in prose. A substring match over the raw text
    // would fail on them, and the natural "fix" is to delete the sentences rather than the import.
    const discussing = filesUnder(join(SRC, 'rules')).filter((f) =>
      readFileSync(f, 'utf8').includes('playback/'),
    );
    assert.ok(discussing.length > 0, 'if nothing mentions it any more, this test lost its point');
    for (const file of discussing) {
      assert.deepEqual(
        importSpecifiers(readFileSync(file, 'utf8')).filter((s) => s.includes('playback/')),
        [],
        file,
      );
    }
  });

  it('the direction that IS allowed is exercised — src/playback/ reads src/rules/ types', () => {
    // Asserted so the test above cannot be satisfied by the two trees simply never meeting, which
    // would mean the boundary was enforced by accident rather than by design.
    const reaching = filesUnder(join(SRC, 'playback')).filter((f) =>
      importSpecifiers(readFileSync(f, 'utf8')).some((s) => s.includes('rules/')),
    );
    assert.ok(reaching.length > 0, 'playback depends on rules types; that direction is fine');
  });
});

describe('⭐ the player client exposes exactly one method', () => {
  it('skipToNext, and nothing else', () => {
    // A client that grew pause, seek or addToQueue would widen what a defect in the drain could do,
    // and a reviewer reading the drain would have no reason to notice the client had changed.
    const methods = Object.getOwnPropertyNames(SpotifyPlayerClient.prototype).filter(
      (name) => name !== 'constructor',
    );
    assert.deepEqual(methods, ['skipToNext']);
  });

  it('⚠️ and the module names no other player endpoint', () => {
    // The method count above would not catch a second endpoint reached from inside skipToNext.
    const source = readFileSync(join(SRC, 'playback', 'spotifyPlayerClient.ts'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    for (const endpoint of ['/me/player/pause', '/me/player/play', '/me/player/seek', '/me/player/previous', '/me/player/queue', '/me/player/volume']) {
      assert.ok(!source.includes(endpoint), `${endpoint} must not be reachable from this client`);
    }
    assert.ok(source.includes('/me/player/next'), 'and the one it does use is still there');
  });
});

describe('⭐ one rule, one call site', () => {
  const server = () => readFileSync(join(SRC, 'server.ts'), 'utf8');

  it('skipAttempts.attachPlayId is called exactly once', () => {
    // Found in review 2026-10-02: a second call sat on PlayObserver's onPlayRecorded hook, where the
    // coordinator's "is this still the play that was decided" guard does not apply. On a fast track
    // change it would have attached the closing play's id to the NEXT play's attempt. The guard lives
    // in EvaluationCoordinator.onPlayRecorded, so the link has to travel through the callback it
    // gates -- not alongside it.
    const calls = server().match(/skipAttempts\?*\.attachPlayId\(/g) ?? [];
    assert.equal(
      calls.length,
      1,
      'A second call site cannot inherit the coordinator guard. Add it inside the attachPlayId ' +
        'callback passed to EvaluationCoordinator, never beside onPlayRecorded.',
    );
  });

  it('and that one call is inside the attachPlayId callback, not on the hook', () => {
    const source = server();
    const callback = source.indexOf('attachPlayId: (evaluationId, playId) =>');
    const hook = source.indexOf('onPlayRecorded: (playId, record) =>');
    assert.ok(callback > -1 && hook > -1, 'both wiring points still exist');

    const call = source.indexOf('skipAttempts?.attachPlayId(');
    assert.ok(call > callback, 'the call belongs to the coordinator callback');

    // The hook's body must not CALL it. Bounded to the hook's own arrow body so this does not depend
    // on where the callback happens to sit in the file — and comments stripped first, because the hook
    // carries a note POINTING AT the callback, which is the thing that keeps the next reader from
    // re-adding the call. A check that failed on its own warning would get the warning deleted.
    const hookBody = source
      .slice(hook, source.indexOf('onPlayDropped:', hook))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!hookBody.includes('attachPlayId'), 'onPlayRecorded must not link the attempt itself');
  });
});

describe('the drain has one implementation and two entry points', () => {
  it('⚠️ server.ts calls drain() from the tick and from scheduleDrain — never builds a second drain', () => {
    // One drain function, two entry points. The 3 s tick is the backstop for an attempt whose
    // scheduled run was lost; a second SkipDrain would give the two paths separate queues and
    // separate re-entrancy guards, which is how an attempt fires twice.
    const source = server();
    assert.equal((source.match(/new SkipDrain\(/g) ?? []).length, 1, 'exactly one SkipDrain');
    assert.ok(source.includes('skipDrain?.drain()'), 'the tick backstop');
    assert.ok(source.includes('void drain.drain()'), 'the scheduled entry point');
  });

  it('the startup sweep runs before the drain is handed to the executor', () => {
    // P-29. A queued row surviving a restart would otherwise fire into whatever is playing when the
    // app returns. Ordering is the guarantee, so ordering is what is pinned.
    const source = server();
    const sweep = source.indexOf('drain.sweepOrphaned()');
    const handOff = source.indexOf('new SkipExecutor(');
    assert.ok(sweep > -1 && handOff > -1);
    assert.ok(sweep < handOff, 'sweepOrphaned() must precede the executor that can enqueue');
  });

  function server() {
    return readFileSync(join(SRC, 'server.ts'), 'utf8');
  }
});
