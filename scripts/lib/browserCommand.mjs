/**
 * How `npm run auth` asks the operating system to open a URL in the default browser. Pure: returns the spawn
 * arguments, runs nothing.
 *
 * ⚠️ Windows goes through `cmd /c start`, and **cmd treats an unquoted `&` as a command separator**. The Spotify
 * authorize URL is full of `&`, so the old `['cmd', ['/c', 'start', '""', url]]` handed the browser only
 * `…/authorize?client_id=…`, and Spotify answered *"response_type must be code"*. Found by the U8 cold walk on a clean
 * Windows 11 machine (2026-10-16), reproduced with `echo` in place of `start`. So the URL is **quoted**, and the
 * arguments are passed **verbatim**, or Node would re-quote the already-quoted string.
 *
 * A double quote cannot appear inside the URL: every value goes through `URLSearchParams`, which encodes it as `%22`.
 */

export function browserCommand(platform, url) {
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '""', `"${url}"`], options: { windowsVerbatimArguments: true } };
  }
  if (platform === 'darwin') return { command: 'open', args: [url], options: {} };
  return { command: 'xdg-open', args: [url], options: {} };
}
