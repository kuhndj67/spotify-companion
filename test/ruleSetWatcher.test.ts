/**
 * RuleSetWatcher — live reload, and **BR-20.8's last-known-good path reaching code for the
 * first time**.
 *
 * BR-20.8 has been specified since U3 and had no implementation, because U3 had no reload. It
 * is the reason this file exists, and the reason the deployment checklist still asks for it to
 * be exercised by hand: a test can prove the retention logic, but only a real session proves
 * that the indicator says *which version is still in force*.
 *
 * ⚠️ **Nothing here tests `fs.watch`, because `fs.watch` is not used.** Probed 2026-09-20: 0
 * events in 12 s over the Rancher Desktop bind mount, for both an in-place write and a rename,
 * while the container read the new content within 1 s. A unit test of a watcher on a normal
 * filesystem would have passed and proved nothing about the only place this app runs.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { RuleStore } from '../src/rules/RuleStore.js';
import { RuleSetWatcher } from '../src/rules/RuleSetWatcher.js';

let dir: string;
let path: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rulewatcher-'));
  path = join(dir, 'rules.json');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(path, { force: true });
});

const silent = { info: () => {}, warn: () => {}, error: () => {} };

function ruleSet(id: string, ageYears = 40): string {
  return JSON.stringify({
    version: 1,
    rules: [
      {
        id,
        name: id,
        enabled: true,
        action: 'skip',
        onUnknown: 'no-match',
        predicate: { kind: 'compare', field: 'album.ageYears', op: 'gt', value: ageYears },
      },
    ],
  });
}

/** A clock the test drives, so `reloading`'s minimum display is testable without sleeping. */
function clock(startIso = '2026-09-20T10:00:00.000Z') {
  let ms = Date.parse(startIso);
  return {
    now: () => new Date(ms).toISOString(),
    advance: (by: number) => {
      ms += by;
    },
  };
}

/**
 * ⚠️ `reloadingMinMs: 0` on purpose. These tests are about **retention**, and the minimum
 * display window would otherwise leave every post-reload state reading `reloading` under a
 * frozen clock — hiding the very thing being asserted. The window has its own tests below,
 * with a clock the test drives.
 */
function makeWatcher(now: () => string = () => '2026-09-20T10:00:00.000Z') {
  return new RuleSetWatcher({
    store: new RuleStore(path, silent),
    intervalMs: 60_000,
    now,
    logger: { info: () => {}, warn: () => {} },
    reloadingMinMs: 0,
  });
}

describe('cold start (BR-20.7, BR-26.4)', () => {
  it('runs with an empty set before anything has been loaded', () => {
    const watcher = makeWatcher();

    const set = watcher.current();

    assert.deepEqual(set.rules, []);
    assert.equal(set.version, 0, 'version 0 means "never successfully loaded"');
  });

  it('accepts a valid file and becomes v1', async () => {
    await writeFile(path, ruleSet('a'), 'utf8');
    const watcher = makeWatcher();

    await watcher.start();
    watcher.stop();

    const set = watcher.current();
    assert.equal(set.version, 1);
    assert.equal(set.state, 'applied');
    assert.equal(set.rules.length, 1);
    assert.notEqual(set.contentHash, '');
  });

  /** ⚠️ Inert, not fatal: the app runs, and the reason is surfaced rather than swallowed. */
  it('leaves the app running with no rules when the file is invalid at startup', async () => {
    await writeFile(path, '{ not json', 'utf8');
    const watcher = makeWatcher();

    await watcher.start();
    watcher.stop();

    const set = watcher.current();
    assert.deepEqual(set.rules, []);
    assert.equal(set.version, 0, 'a rejected load never advances the version');
    assert.equal(set.state, 'rejected');
    assert.ok(set.rejection!.errors.length > 0, 'the reason must be surfaced');
  });

  /** An absent file on a fresh install is normal — `npm run rules:init` creates it. */
  it('treats an absent file at startup as normal, not as a rejection', async () => {
    const watcher = makeWatcher();

    await watcher.start();
    watcher.stop();

    assert.equal(watcher.current().state, 'applied');
    assert.equal(watcher.current().rejection, null);
  });
});

describe('⚠️ last-known-good on reload (BR-20.8, BR-26.3) — first implementation', () => {
  it('keeps the running rules when a reload brings an invalid file', async () => {
    await writeFile(path, ruleSet('good'), 'utf8');
    const watcher = makeWatcher();
    await watcher.start();

    await writeFile(path, '{ broken', 'utf8');
    await watcher.reloadNow();
    watcher.stop();

    const set = watcher.current();
    assert.equal(set.rules.length, 1, 'the good set must survive');
    assert.equal(set.rules[0]!.rule.id, 'good');
    assert.equal(set.state, 'rejected');
  });

  /**
   * ⚠️ BR-26.6. *"v7 rejected, still running v6"* is only sayable if 7 was never taken. A
   * counter that advanced on attempts would leave the running set unnameable at exactly the
   * moment the user needs to know it — and a silent last-known-good is indistinguishable from
   * a successful reload.
   */
  it('does NOT advance the version on a rejected reload', async () => {
    await writeFile(path, ruleSet('v1'), 'utf8');
    const watcher = makeWatcher();
    await watcher.start();
    assert.equal(watcher.current().version, 1);

    await writeFile(path, '{ broken', 'utf8');
    await watcher.reloadNow();
    watcher.stop();

    assert.equal(watcher.current().version, 1, 'still v1, and it must be sayable');
  });

  it('advances the version and swaps the rules on an accepted reload', async () => {
    await writeFile(path, ruleSet('first'), 'utf8');
    const watcher = makeWatcher();
    await watcher.start();
    const firstHash = watcher.current().contentHash;

    await writeFile(path, ruleSet('second'), 'utf8');
    await watcher.reloadNow();
    watcher.stop();

    const set = watcher.current();
    assert.equal(set.version, 2);
    assert.equal(set.rules[0]!.rule.id, 'second');
    assert.equal(set.state, 'applied');
    assert.notEqual(set.contentHash, firstHash);
    assert.equal(set.rejection, null, 'a success clears the previous rejection');
  });

  /**
   * ⚠️ BR-26.3a — the save race, and the reason `absent` is not one fact but two.
   *
   * A write-temp-then-rename save is momentarily `ENOENT`. Treated as an accepted empty set,
   * the version would advance, every rule would silently drop for one poll interval, and the
   * user would see a version bump with no error — having briefly run no rules at all.
   */
  it('treats a file that DISAPPEARS on reload as a rejection, not an empty set', async () => {
    await writeFile(path, ruleSet('alive'), 'utf8');
    const watcher = makeWatcher();
    await watcher.start();

    await rm(path, { force: true });
    await watcher.reloadNow();
    watcher.stop();

    const set = watcher.current();
    assert.equal(set.rules.length, 1, 'the rules must not vanish for a poll interval');
    assert.equal(set.version, 1);
    assert.equal(set.state, 'rejected');
  });

  it('recovers when the rename completes on the next read', async () => {
    await writeFile(path, ruleSet('alive'), 'utf8');
    const watcher = makeWatcher();
    await watcher.start();

    await rm(path, { force: true });
    await watcher.reloadNow();
    assert.equal(watcher.current().state, 'rejected');

    await writeFile(path, ruleSet('renamed'), 'utf8');
    await watcher.reloadNow();
    watcher.stop();

    const set = watcher.current();
    assert.equal(set.state, 'applied');
    assert.equal(set.rules[0]!.rule.id, 'renamed');
    assert.equal(set.version, 2);
  });
});

describe('the reloading indicator (BR-26.9)', () => {
  /** A reload that completes in 3 ms is indistinguishable from one that never happened. */
  it('shows reloading for a minimum, then settles to applied', async () => {
    await writeFile(path, ruleSet('a'), 'utf8');
    const c = clock();
    const watcher = new RuleSetWatcher({
      store: new RuleStore(path, silent),
      intervalMs: 60_000,
      now: c.now,
      logger: { info: () => {}, warn: () => {} },
      reloadingMinMs: 1_000,
    });
    await watcher.start();

    await watcher.reloadNow();
    assert.equal(watcher.current().state, 'reloading', 'an instant reload must still be seen');

    c.advance(1_500);
    assert.equal(watcher.current().state, 'applied');
    watcher.stop();
  });

  /** ⚠️ A red light that a spinner hides is worse than no light at all. */
  it('never lets the reloading minimum mask a rejection', async () => {
    await writeFile(path, ruleSet('a'), 'utf8');
    const c = clock();
    const watcher = new RuleSetWatcher({
      store: new RuleStore(path, silent),
      intervalMs: 60_000,
      now: c.now,
      logger: { info: () => {}, warn: () => {} },
      reloadingMinMs: 5_000,
    });
    await watcher.start();

    await writeFile(path, '{ broken', 'utf8');
    await watcher.reloadNow();

    assert.equal(watcher.current().state, 'rejected', 'the failure outranks the spinner');
    watcher.stop();
  });
});

describe('the reload button and the poll enter the same loader', () => {
  /**
   * ⚠️ Re-implementing one of the two entry points is the WebSocket `403` shape: the admission
   * rule was re-implemented rather than reused, the copies diverged, and all 411 tests passed
   * while every handshake failed.
   *
   * `reloadNow()` also bypasses the signature check deliberately — a save that preserved
   * `mtime` and `size` is exactly the case the button exists for.
   */
  it('reloadNow re-reads even when mtime and size are unchanged', async () => {
    await writeFile(path, ruleSet('a', 40), 'utf8');
    const watcher = makeWatcher();
    await watcher.start();

    // Same byte length, different content: the cheap signature cannot see this.
    await writeFile(path, ruleSet('a', 41), 'utf8');
    await watcher.reloadNow();
    watcher.stop();

    assert.equal(watcher.current().version, 2, 'the button means "look again anyway"');
  });
});
