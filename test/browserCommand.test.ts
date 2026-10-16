/**
 * `npm run auth` must hand the browser the WHOLE authorize URL (scripts/lib/browserCommand.mjs).
 *
 * Found by the U8 cold walk (2026-10-16): on Windows the URL went through `cmd /c start` unquoted, `cmd` split it at the
 * first `&`, and Spotify said *"response_type must be code"*. The shape tests run everywhere. The **behaviour** test
 * runs only on Windows, because only there does `cmd` exist to do the splitting. It swaps `start ""` for `echo`, so
 * nothing opens, and it has a positive control: the old, unquoted form must still be cut short. A test whose control
 * never fails would prove nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// @ts-expect-error -- plain .mjs helper with no type declarations; its shape is asserted below
import { browserCommand } from '../scripts/lib/browserCommand.mjs';

const URL_WITH_AMPERSANDS =
  'https://accounts.spotify.com/authorize?client_id=abc&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback&state=s1';

interface Cmd {
  command: string;
  args: string[];
  options: { windowsVerbatimArguments?: boolean };
}

describe('browserCommand — shape', () => {
  it('win32: cmd start with the URL quoted and passed verbatim', () => {
    const c = browserCommand('win32', URL_WITH_AMPERSANDS) as Cmd;
    assert.equal(c.command, 'cmd');
    assert.deepEqual(c.args, ['/c', 'start', '""', `"${URL_WITH_AMPERSANDS}"`]);
    assert.equal(c.options.windowsVerbatimArguments, true);
  });

  it('darwin and linux: the URL is one argument, untouched', () => {
    assert.deepEqual((browserCommand('darwin', URL_WITH_AMPERSANDS) as Cmd).args, [URL_WITH_AMPERSANDS]);
    assert.deepEqual((browserCommand('linux', URL_WITH_AMPERSANDS) as Cmd).args, [URL_WITH_AMPERSANDS]);
  });
});

describe('browserCommand — Windows behaviour (echo in place of start)', { skip: process.platform !== 'win32' }, () => {
  const echoOf = (args: string[], verbatim: boolean) =>
    spawnSync('cmd', ['/c', 'echo', ...args], { encoding: 'utf8', windowsVerbatimArguments: verbatim }).stdout.trim();

  it('the fixed form reaches the command whole, every & included', () => {
    const c = browserCommand('win32', URL_WITH_AMPERSANDS) as Cmd;
    const urlArg = c.args[c.args.length - 1] ?? '';
    assert.equal(echoOf([urlArg], true), `"${URL_WITH_AMPERSANDS}"`);
  });

  it('positive control: the old unquoted form is cut at the first &', () => {
    assert.equal(echoOf([URL_WITH_AMPERSANDS], false), 'https://accounts.spotify.com/authorize?client_id=abc');
  });
});
