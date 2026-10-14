# Security

## Reporting a vulnerability

Email **kuhndj67@hotmail.com**. **Please do not open a public issue** for a vulnerability.

Say what you found, how to reproduce it, and which version (Settings shows it, as does `/api/diagnostics`). You will
get an acknowledgement; this is a one-person project, so there is no response-time promise.

Reporting will move to GitHub's private vulnerability reporting when the repository becomes public.

## What is in scope

The app is a **single-user, local** web app: each person runs their own copy with their own Spotify account. These
are the parts where a flaw matters most:

- **The local-only guard.** Every page and WebSocket request must come from this machine: a loopback `Host`, and a
  same-origin `Origin` on anything that changes state. One policy (`decideAccess` in `src/localGuard.ts`) serves
  both HTTP and the WebSocket upgrade. A way to reach the app from another machine or another site is in scope.
- **The upload path.** *Restore backup* and *rules upload* accept files. Every uploaded file goes through one
  admission path: allow-listed archive entries, regular files only, streaming size caps, magic-byte typing, and a
  schema allow-list for an uploaded SQLite database. A file that gets past it, or that makes the app write outside
  its own directories, is in scope.
- **Credential handling.** Spotify and MusicBrainz credentials live in `secrets/`. They are never sent back by any
  route, never logged, and never included in a backup. Any way to read them out is in scope.
- **Automated skipping.** It is off by default and must stay off after a restore. Anything that arms it without
  the user is in scope.

## Out of scope

- Running the app off-machine or behind a reverse proxy you configured yourself. Off-machine access is not
  supported yet.
- Spotify's or MusicBrainz's own services.
- The bundled `spotify-mcp-server`, which is a separate upstream project. Report its issues there.

## Secrets in this repository

No credential is ever committed. CI scans every push and pull request with gitleaks, and the whole history weekly. A
test fails if anything under `secrets/` other than an `*.example.json` template is tracked. If you find a credential
anyway, report it as above: the fix is to **revoke it at its source**, and deleting it from git is not enough.
