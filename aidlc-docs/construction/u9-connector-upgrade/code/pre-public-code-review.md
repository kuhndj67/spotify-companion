# Pre-public code review — 2026-10-21 (public-readiness §6 step 2)

**Reviewer**: a different model from the one that built the project (Claude Fable 5.1), at the owner's request:
*"get a different model looking at the project"*. Tree at `fefd768` (branch `install-docs-split`, PR #12 open).
**This review changed no file** other than writing this record.

**Verdict in one line**: nothing was found that must block going public. There is **no credential in the tree or in any
of the 239 commits** by independent checks (§1). The security-critical paths are well built; the findings below are
hardening (one of them worth doing before a second person has write access), one real bug with a concrete input, and
a handful of document lines a newcomer would trip on, most of them the private-repository wording the switch already
plans to remove.

Severity words: **High** = fix before the switch · **Medium** = fix in the next beta · **Low** = note or backlog.
Confidence words: **certain** (shown by a command or by reading the exact lines) · **likely** (mechanism read, not
exercised) · **unverified** (stated, not checked).

Order follows the request: must-not-be-public → security → correctness → documents.

---

## 0. What was checked, and how

| Area | Method |
|---|---|
| Secrets in files and history | `git log --all -p` grepped for: `client_secret` / `refresh_token` / `access_token` / camel-case equivalents followed by a value; Spotify token shapes (`BQ…` access, `AQ…` refresh); GitHub token prefixes (`ghp_`, `gho_`, …); standalone 32-hex strings (a Spotify client id); email addresses; private IPv4 ranges; Windows and Unix user paths; every path ever committed under `secrets/`, `data/`, `config/`, `state/`. ⚠️ **gitleaks itself was not run in this session** (not on this machine's PATH); the owner's 2026-10-21 run over all 238 commits (*no leaks*) is taken as read, and the greps above are independent of its rule set |
| Local-access guard | `src/localGuard.ts`, its callers in `src/server.ts` (HTTP and the WebSocket upgrade), `test/localGuard.test.ts` |
| Upload / restore admission | `src/ingest/*`, `src/maintenance/MaintenanceService.ts`, `src/maintenance/startupRestorer.ts`, `src/backup/verifier.ts`, `src/backup/manifest.ts`, every route in `src/api.ts` |
| Credential handling | `src/configuration/*`, `src/config.ts`, `scripts/auth.mjs`, `src/mcp/spotifyMcpClient.ts` (what the child gets), `src/diagnostics.ts` (what leaves) |
| Container | `Dockerfile`, `scripts/docker-entrypoint.sh`, `scripts/check-image.sh`, `.dockerignore`, `compose.yaml`, `compose.app.yaml`, `src/appOnly/*` |
| CI | `.github/workflows/ci.yml`, `secret-history.yml`, `.gitleaks.toml`, `.github/rulesets/main.json`, the live ruleset and Actions permissions via `gh api` |
| Browser code | `public/app.js` for unescaped HTML insertion (`innerHTML` at lines 134, 454, 460, 1363 only, all constants or numeric SVG); `public/index.html` for external loads (none: one data-URI icon, local CSS and JS) |
| Documents | `README.md`, `docs/INSTALL-APP.md`, `docs/INSTALL-DEV.md`, `docs/claude-start.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `aidlc-docs/aidlc-state.md` |
| Probes run | `node:sqlite` behaviour for a negative `LIMIT` and a `NaN` bind (finding 3.1); GitHub API for rulesets, default workflow permissions and fork-PR approval |

---

## 1. Anything that must not be public

### 1.1 Credentials, tokens, client ids — ✅ none found (certain, within the methods above)

- Every "secret-ish key = value" hit in all 239 commits is a placeholder: `refresh_token=test-refresh-token`,
  `clientSecret": "your-spotify-client-secret`, `accessToken: PLACEHOLDER_TOKEN`.
- No `ghp_`/`gho_`… token, no `AQ…` refresh token, **no standalone 32-hex string** anywhere in history.
- One `BQ…` (Spotify access-token shape) hit: `package-lock.json:1546`, a substring of a `sha512-…` integrity
  hash (`…KIN/nDJBQRcXw0M…`). Not a token. Worth knowing because a future scanner may flag it too.
- Files ever tracked under the four protected directories: only the three `*.example.json` templates and
  `state/.gitkeep`. `test/secretsTracked.test.ts` holds this going forward.
- The working tree's `secrets/app/spotify-config.json`, `secrets/app/musicbrainz.json`, `secrets/metabase.json`
  and `.boot-check-baseline.json` are all ignored and untracked (checked with `git ls-files`).

### 1.2 Personal data in history — already decided by the owner; restated so the decision is made with the numbers (certain)

| What | Where | Count |
|---|---|---|
| The owner's hotmail address | commit **author and committer metadata** | 205 of 239 commits |
| The same address | diff lines in history | ~226 lines |
| The owner's gmail address | diff lines in history | 18 lines |
| NAS address `192.168.0.223` | diff lines in history | 23 lines; still in the tree (accepted) |

Current files are redacted (`<email address>`, `Machine 1`/`Machine 2`). **A public repository shows commit author
emails to anyone** (`git log`, the API, and GitHub's UI link the commits to the account). GitHub's *Keep my email
addresses private* setting does not alter past commits. The owner accepted this on 2026-10-18 (*"no rewrite"*). This
review only notes that **the switch is the last moment a `git filter-repo --mailmap` rewrite is cheap**; afterwards
every clone has the history. No action unless the owner reconsiders.

### 1.3 Internal details in the tree — Low, no action needed (certain)

- The GitHub handle appears in ~30 design files, the Dockerfile label, both compose files and the install docs. It is
  the repository owner's name; inherent to a public repository.
- Local paths quoted in `audit.md` (`D:\Software\Spotify-SavedWorkingItems`, `D:\walk-results`, `U:`) reveal drive
  letters and nothing else.
- Listening history in probe files and prose: accepted by the owner 2026-10-21.
- `.github/copilot-instructions.md` and `.github/instructions/mermaid.instructions.md` are tool stubs, harmless.

### 1.4 Not a disclosure, but a newcomer's first stop is stale — **Medium**, fix before the switch (certain)

`aidlc-docs/aidlc-state.md:204` says the current stage is *"`1.0.0-beta.5` LIVE … Remaining: the App-only cold walk"*.
`audit.md`'s last four entries (2026-10-21) record beta.6, beta.7, two failed walks and the go-public decision.
`CLAUDE.md` tells every reader to start at `aidlc-state.md`. **Fix**: one new *Current Stage* line (the file's own
convention) naming beta.7, PR #12, this review and the switch sequence in `public-readiness-review.md` §6.

---

## 2. Security weaknesses in the parts that matter most

### 2.1 Local-access guard (`src/localGuard.ts`) — sound; one gap

**2.1.1 `isAllowedOrigin` compares the hostname only, never the port or scheme** — **Medium-Low** (certain)

`src/localGuard.ts:76`: `LOOPBACK_HOSTNAMES.has(new URL(origin).hostname)`. So `http://localhost:3000`,
`http://localhost:3020` (Metabase), `http://127.0.0.1:8080` (any dev server) and `http://localhost:3010` (this app) are
all "allowed origins". `test/localGuard.test.ts:164` asserts exactly that for `:3000`; no test covers a *different*
loopback port.

What a page served from **another local port** can then do (a page on the LAN or the internet cannot, its Origin is
refused):

- **Open the WebSocket** `ws://localhost:3010/ws` and read every snapshot: track, artist, label, liked state, status
  bar. WebSocket handshakes are not covered by the same-origin policy; this Origin check is the only thing standing
  between a local page and the stream (`src/server.ts:1112-1130`).
- **Send simple-request POSTs** to the two state-changing routes that take no body: `POST /api/liked/refresh`
  (`src/api.ts:428`) and `POST /api/rules/reload` (`src/api.ts:551`). A plain `<form method=post>` does this with no
  preflight. Impact: a Spotify call and a file re-read on demand; nuisance, not damage.
- It **cannot** reach the ingest routes (the custom header forces a CORS preflight the app never answers), the
  JSON-body routes (`application/json` forces a preflight), or read any GET (same-origin policy).

Why it matters more on a public release than it did here: the owner's machine already runs another app on `:3000`;
other people's machines run arbitrary local dev servers, and "a page on localhost" is a common foothold (any
`npm start` of anything).

**Fix** (one rule, in `decideAccess`): when an `Origin` is present, require `new URL(origin).host` to equal the
request's `Host` header (both are what the browser saw, so the container's internal `3000` vs the published `3010`
is not a problem), in addition to the loopback check. Add the property *"an Origin on a different port than Host is
refused"* to `test/localGuard.test.ts`, and a positive control that `http://localhost:3010` with `Host:
localhost:3010` still passes.

**2.1.2 State-changing POSTs that are not behind `ingestGuard`** — **Low-Medium**, defence in depth (certain)

`POST /api/automation` (`src/api.ts:682`, arms automation), `POST /api/automation/acknowledge-halt` (`:743`),
`POST /api/backtest` (`:521`), `/api/liked/refresh` (`:428`), `/api/rules/reload` (`:551`) are admitted by
`localGuard` alone, where `Origin` is **optional** (`src/localGuard.ts:74`). Today the first three are protected
cross-site only *incidentally*: `express.json` accepts `application/json` only, which forces a preflight. If anyone
ever adds `express.urlencoded()` or widens the JSON type, arming automation becomes a cross-site form post from any
loopback-origin page. `SECURITY.md:20` already promises *"a same-origin `Origin` on anything that changes state"*, which
is not literally what the code does.

**Fix**: mount `ingestGuard` on every `router.post(...)`. `public/app.js:695` already sends the header on the ingest
routes; it would need to send it on these five too. This is the FR-64 *one admission path* principle applied uniformly.

**2.1.3 No response security headers** — **Low-Medium** (certain that none are set; exploitability likely)

`src/server.ts:946` disables `x-powered-by` and sets nothing else. No `Content-Security-Policy`, no
`frame-ancestors`, no `X-Content-Type-Options`. A page on any site can `<iframe src="http://localhost:3010">` and
clickjack the one-click controls (the automation switch; the restore flow is protected by its typed word).
`public/app.js` never inserts untrusted HTML (checked: `innerHTML` only with constants at 134, 454, 460 and the numeric
SVG at 1363; everything else is `textContent`/`replaceChildren`), and `index.html` loads only `./app.js` and
`./styles.css`, so a strict CSP is feasible.

**Fix**: one middleware after `app.disable('x-powered-by')`:
`Content-Security-Policy: default-src 'self'; img-src 'self' data: https://i.scdn.co; frame-ancestors 'none'`
(adjust `img-src` to wherever album art comes from, and `style-src` if `index.html` has inline styles), plus
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The WebSocket upgrade's hand-written 403
needs no headers.

**Reviewed and found right** (recorded so the next reviewer need not repeat it): the Host parser refuses
`[::1]evil.com`, `localhost.evil.com`, `Origin: null`, malformed ports, and `0.0.0.0`; `req.socket.remoteAddress` is
used, never `X-Forwarded-For`; `trust proxy` is off; the WebSocket upgrade calls the same `decideAccess`; the Dockerfile
default (`LOCAL_ONLY` on, `TRUST_PUBLISHED_PORT` off) makes a bare `docker run -p 3000:3000` refuse everything rather
than expose everything. Residual, documented and accepted: with `TRUST_PUBLISHED_PORT`, any *host-local* process and
any container on the same compose network that forges `Host: localhost` is admitted.

### 2.2 Upload and restore admission — ✅ no defect found

Read in full: `admitIngest` (method, required Origin, custom header), `readArchive` (gzip magic, `tar` as a parser
only, allow-listed fixed output names, regular files only, no `/` `\` `..` drive letters or NUL in names, duplicate
refusal, expanded-size cap by header *and* stream, `source.destroy()` on the first refusal so a bomb is not
decompressed), the SQLite magic check, `verifyBackup` with `PRAGMA trusted_schema = OFF`, refusal of triggers and
views, an allow-list of schema names **replayed from the real migrations**, a *newer than this app* refusal, the
manifest's sha256/counts/max-id cross-checks, the upload cap counted as bytes arrive (`MaintenanceService.ts:391`),
`mkdtemp` work directories under `data/.work/`, a second request with a random token plus a typed word to apply, the
`ready`-marker-last staging, and the journaled, idempotent startup swap that puts the previous database back on any
failure. The archive writer never includes `secrets/` or `state/` (allow-list, `portable: true`).

One observation, not a defect: `MaintenanceService.ts:313-316` moves files with `renameSync` within `data/`, which
is correct only because the work directory and `restore-pending/` share a filesystem. They do (both under `data/`);
a future `WORK_DIR` on another mount would break it loudly, not silently.

### 2.3 Credential handling (`src/configuration/`, `scripts/auth.mjs`)

**2.3.1 The credentials file is created world-readable on Linux** — **Medium on Linux, none on Windows** (certain)

- `scripts/auth.mjs:195` writes `spotify-config.json` (client secret + refresh token) with `writeFileSync` and no
  `mode`: `0644` under the usual umask. This is the file every install creates, on the host (`npm run auth`) or
  through the image's `auth` command into `/work/secrets/app/`.
- `src/configuration/atomicWrite.ts:59` keeps an existing file's mode but defaults to `0o666` (→ `0644`) for a new
  one, so a Settings save of credentials onto a missing file is also world-readable.
- Upstream's own writer uses **`0o600`** for a new file (`.mcp-server/src/utils.ts:111`), so a token refresh keeps
  whatever mode `auth.mjs` set: `0644` stays `0644`.

On a multi-user Linux host (the NAS target, U11; any shared box) every local account can read the refresh token.
Windows ignores POSIX modes, which is why no walk has seen it. **Fix**: `{ mode: 0o600 }` in `auth.mjs:195`, and let
`writeFileAtomic` take a default mode so `CredentialsWriter` passes `0o600` while rules and state keep `0o666`. Add a
test on Linux-like platforms only (`process.platform !== 'win32'`).

**2.3.2 The stored refresh token carries write scopes the app never uses** — **Low-Medium hardening** (certain on the
list; *likely* on what the connector's used tools need)

`scripts/auth.mjs:46-62` requests `playlist-modify-public`, `playlist-modify-private`, `user-library-modify`,
`user-read-email`, `user-read-private`, `user-top-read`, `user-read-playback-position` in addition to what the app
uses (read playback / currently playing / recently played, library read, follow read, and modify-playback for
skipping). A leaked `spotify-config.json` therefore lets its holder edit the user's playlists and library. The comment
at line 40-45 already calls this *"a least-privilege trim is possible"*. Going public is when the trim pays: every new
user grants the union. **Fix**: trim to the used set (verify by probe which scopes `getNowPlaying` needs: it is
`user-read-playback-state` / `user-read-currently-playing`); document that existing installs re-run `auth` to shrink
their grant (an old token keeps working either way).

**2.3.3 Reviewed and found right**: secrets flow one way. The only routes that read the file return a masked client
id, the redirect URI and set/not-set flags (`CredentialsWriter.ts:119-134`); refusals name fields; diagnostics reads the
file only to report *which fields are missing* (`src/diagnostics.ts:376`); no `console.*` in `webApiClient.ts`,
`spotifyMcpClient.ts` or `spotifyPlayerClient.ts` prints a token; the connector child gets `getDefaultEnvironment()`
plus `SPOTIFY_CONFIG_PATH`, not the whole environment; the Spotify save pauses the poller and waits for the child to
exit before writing, then reads back (P-49/P-50). The MusicBrainz contact (an email) does appear in
`/api/diagnostics` as the `User-Agent` text and the Spotify display name as *Authenticated as …*: not secrets, same
origin only; it matters for the install log (finding 4.4).

### 2.4 Container entrypoint and image

**2.4.1 `chown` of the user's directories on every start** — **Low**, document it (certain)

`scripts/docker-entrypoint.sh:66, 73, 80-84` chown the mount points of `data/`, `secrets/app/`, `config/` and
`state/` to uid 1000 on every start, non-recursively. On a Linux host whose user is not uid 1000, the user's own
folders change owner the first time the container runs: correct for the app, surprising for the person. Neither
install document says so (INSTALL-DEV S6's Linux note asks the user to `chown -R 1000:1000` by hand, which is now
partly redundant and still says *to be confirmed on Linux*). **Fix**: one sentence in both documents' Linux notes.

**2.4.2 `check-image.sh:40` can refuse a good image on a third-party file name** — **Low**, operational (likely)

`(^|/)rules\.json$` and `(^|/)(spotify-config|musicbrainz)\.json$` match anywhere in the archive, including
`app/node_modules/<package>/rules.json`. No such file exists today (beta.4 to beta.7 passed), but a dependency
update could stop publishing with *user-owned files in the image* for a file that is not. Fails safe; worth anchoring
the two patterns to `^(app/)?(secrets|data|config|state)/` like the directory pattern, or excluding `node_modules/`.

**Reviewed and found right**: root is used only to fix mount ownership and `setpriv` drops to `node` with PID 1
kept; `setup`/`auth` run as `/work`'s owner; `.dockerignore` excludes `secrets`, `config`, `state`, `data`,
`verify-install`, `.mcp-server` and every `.md` but README (the two example templates are re-included by name); the
image check is run on what *ships*, from an exported filesystem; both licences are checked twice (build and ship);
the connector is fetched by SHA and its one patch fails the build if upstream's line moves; the upstream test suite
runs in the build stage only; `HEALTHCHECK` is a real MCP round trip; OCI labels name source, revision, version and
base digest; the Trivy binary is pinned by SHA-256 and the scan is report-only by a recorded owner decision.

### 2.5 CI publishing (`.github/workflows/ci.yml`)

**2.5.1 Release tags are unprotected** — **Medium once a second person has write access; none today** (certain)

The only ruleset targets `refs/heads/main` (`.github/rulesets/main.json:7`; confirmed live: one ruleset,
`main`). `publish` runs on any pushed `v*` tag with `packages: write` (`ci.yml:177-184`). Any account with **write**
access can push a tag and publish an image under the project's name, with no review: `publishDecision` checks only
that the tag equals `package.json`'s version and is not already published. The owner intends to add a developer soon
(*"send a link to one of my dev's"*); a collaborator added with write access gets this at once. **Fix**: a second
ruleset for `refs/tags/v*` (creation and update restricted to the owner, deletion and non-fast-forward blocked),
committed beside `main.json` and applied by `npm run protect`, with `test/rulesetMatchesWorkflow.test.ts` extended to
assert it exists. Alternatively grant collaborators **triage/read** and take their work by PR, which the standard flow
already assumes.

**2.5.2 Fork pull requests after the switch** — **Low**, a setting to confirm (unverified: the API refuses the query
while the repository is private)

On a public repository `pull_request` from a fork runs `test`, `container` (a `docker build` of the fork's
`Dockerfile`) and `secrets` with a read-only token and no repository secrets, which is safe. Confirm after the switch
that *Settings → Actions → Fork pull request workflows* is at GitHub's default (*Require approval for first-time
contributors*), and keep `default_workflow_permissions: read` (confirmed set). `publish` cannot run from a PR.

**Reviewed and found right**: `permissions: contents: read` at the top; `packages: write` only on `publish`;
`persist-credentials: false` and a full-SHA pin on the one action in that job; the token goes to `docker login` on
stdin; the decision runs in a clean `node:22.23` container with `scripts/lib` mounted read-only at `/publish` (the
`/lib` mistake is guarded by a test); no floating image tag is pushed; `concurrency` never cancels a publish;
gitleaks is pinned by SHA-256, `--redact` always, allow-list entries are exact values with a reason; `shell: bash`
gives `pipefail` everywhere; the weekly full-history scan exists. The floating `@v4` on `checkout`/`setup-node`/
`upload-artifact` in the non-publishing jobs is an accepted trade (no secrets there).

---

## 3. Correctness bugs shown with a concrete input

### 3.1 `GET /api/decisions?limit=-1` returns the entire decision log — **Low** (certain, probed)

`src/api.ts:493`: `const limit = Math.min(Number(req.query['limit'] ?? 100) || 100, 500)`. A negative number passes
`Math.min` unchanged and reaches `SqliteDecisionLogRepository.list` (`:262`) as the bound `LIMIT`. SQLite treats a
negative `LIMIT` as *no limit* (probed with `node:sqlite`: `LIMIT ?` bound to `-1` returned every row). The route then
builds `groupIntoTraces` over up to `DECISION_LOG_CAP` (100,000) rows and serialises them in one response. Also:
`limit=0` becomes 100 (`0 || 100`), and `cursor=abc` binds `NaN`, which SQLite compares as no row (`0` rows, probed),
so a mistyped cursor silently returns an empty page rather than a 400. Local-only, so a nuisance rather than a risk.
**Fix**: `Number.isInteger(n) && n >= 1 ? Math.min(n, 500) : 100`, and `400` on a non-integer `cursor`.

### 3.2 The credentials body cap is checked against a header the client controls — **Low** (certain)

`src/api.ts:997` passes `Number(req.get('content-length') ?? 0)` to `saveSpotify`, which refuses above
`CREDENTIALS_CAP_BYTES` (16 KB). A chunked request carries no `Content-Length`, so `bodyBytes` is `0` and the 16 KB cap
never applies; the real bound is `express.json`'s 64 KB (`api.ts:184`) plus the 512-character per-field check. Nothing
exploitable, but the cap is partly decorative, which `CLAUDE.md` names as a trap. **Fix**: give the two `/api/settings`
routes their own `express.json({ limit: CREDENTIALS_CAP_BYTES })` and drop the header argument.

### 3.3 Minor, no action required

- `src/api.ts:293`: `/api/explain/12abc` parses to `12` (`parseInt`) and answers for play 12 instead of `400`.
- `src/api.ts:1013`: an oversized JSON body to `/api/backtest` or `/api/automation` gets Express's HTML 413 rather than
  the JSON shape the U7 routes return; cosmetic.
- `scripts/auth.mjs:139-142`: after a successful callback, the five-minute timer still fires `server.close()` on a
  closed server, which emits `ERR_SERVER_NOT_RUNNING` into `reject`; the promise is already settled, so nothing
  happens. Harmless; `clearTimeout` in `finish` would be tidier.

Nothing else reproducible was found in the paths read. The restorer's journal and the writer locks were read against
the crash orderings their comments describe and hold.

---

## 4. Documents a newcomer would trip on

### 4.1 Wording that becomes false at the switch — the complete list (certain)

`public-readiness-review.md` §6 step 3 says these change; here is every line so none is missed. `test/docs.test.ts`
requires every `## A<n>`/`## S<n>` step to keep its four parts, so removing A2 means renumbering or leaving a one-line
*A2 — (no longer needed)* with the parts.

| File:line | Says | After the switch |
|---|---|---|
| `README.md:30-32` | *Not a public image yet … private while this repository is* | remove the bullet |
| `README.md:44-45` | *⚠️ Coming soon: its steps are being walked cold* | stays until walk 3 passes (owner's call) |
| `docs/INSTALL-APP.md:21` | *While the repository is private, pulling the image needs read access (A2)* | remove |
| `docs/INSTALL-APP.md:112-138` | the whole of A2 (classic token, `docker login`) | remove or stub |
| `docs/INSTALL-APP.md:156` | *denied or 403 while downloading: back to A2* | reword (image not found / typo in tag) |
| `docs/INSTALL-DEV.md:133-145` | *If the repository is private … S2 sign-in* box | remove the box; keep the `git ls-remote` step |
| `docs/INSTALL-DEV.md:173-176` | the two sign-in *If it differs* bullets | remove |
| `SECURITY.md:11-12` | *Private reporting is switched on when the repository becomes public. Until then…* | remove; turn the setting on |
| `compose.app.yaml:5` | *Pull access: while the repository is private, docker login…* | remove (the image carries this file into every App-only folder) |
| `CLAUDE.md:93` | *(private while the repository is)* | remove |

### 4.2 `docs/INSTALL-DEV.md:390-391` — a false statement — **Medium** (certain)

S7 *Purpose*: *"No pre-built image is published, so every install builds its own."* An image has been published for
every tag since `1.0.0-beta.4`, and `INSTALL-APP.md` is built on it. A developer reading S7 after README's *Just the
app* line is told two opposite things. **Fix**: *"This route builds the image from your checkout so that your changes
run; the App-only route uses the published image instead."*

### 4.3 `docs/INSTALL-DEV.md:396-407, 431-432` — a check for a problem that no longer occurs, with a wrong path — **Low-Medium** (certain)

S7 opens with *"check the two secrets are **files**, not folders. If either was missing when the container started,
Docker creates a **folder** in its place"*. That was true of the single-file mounts up to `1.0.0-beta.2`; since U9 the
mount is the `secrets/app` **directory** (`compose.yaml:201`), so Docker creates nothing in place of a missing file:
the app starts, reports *credentials* or *MusicBrainz contact* missing, and the S7 *If it differs* bullets for
`docker logs` already cover that. The remedy at 431-432 also names `rm -r secrets/<name>`, a path from before the
subfolder. **Fix**: replace the check with *both files exist in `secrets/app/`* (`Test-Path secrets\app\spotify-config.json, secrets\app\musicbrainz.json`) and drop the folder bullet.

### 4.4 `docs/INSTALL-APP.md:322-331` (A8) asks an agent to print an email address it is told never to log — **Low** (certain)

A8's *Commands* include `curl.exe -s http://localhost:3010/api/diagnostics`. Its output contains `User-Agent:
SpotifyNowPlaying/<version> ( <contact address> )` (`src/diagnostics.ts:527`) and `Authenticated as <display name>`
(`:397`). `docs/claude-start.md:30-31` says *"Never write a secret, token, client id, client secret or email address
into the log"*, and rule 4 says to record observed output. Walk 2's agent kept the log; whether it trimmed this line is
not recorded. **Fix**: either filter the command to the two steps A8 reads (PowerShell:
`(curl.exe -s …/api/diagnostics | ConvertFrom-Json).steps | Where-Object name -match 'Automation state file|Rules directory' | Select-Object name,status`),
or add to A8: *record only the two step names and their status, not the whole output*.

### 4.5 `docs/INSTALL-DEV.md:382-384` — Linux note partly superseded, still marked unconfirmed — **Low** (certain)

Says *"Run `sudo chown -R 1000:1000 config state secrets/app`. (Not yet walked; to be confirmed on Linux.)"* Since
`1.0.0-beta.6` the entrypoint chowns those mount points itself (`docker-entrypoint.sh:80-84`), so the manual step is
needed only for files *inside* them that `node` must rewrite (the two credential files). Keep it, but say what the
entrypoint now does and what it does not (finding 2.4.1), and keep the *not yet walked* flag honest.

### 4.6 `docs/INSTALL-APP.md:7` and `:148, :236` — the version is written three times — **Low** (certain)

`test/versionSources.test.ts:63` holds them equal to `package.json`, so they cannot drift; noted only because a
reader of the raw file sees `1.0.0-beta.7` and may assume it is the latest when a newer tag exists. A line *"newer
releases: see the Releases page"* would help once the repository is public and the tag list is visible.

### 4.7 Small things a first reader notices (Low, certain)

- `README.md:3`: *"you need to have a paid subscription for api access"* is stated without a source. If it is
  Spotify's 2025 Development-Mode rule (Premium required to create a developer app), say so and link it; a free-tier
  reader otherwise stops at line 3 without knowing whether it applies to them.
- `README.md:18-22`: the *Secondary* paragraph names the model and tooling used. Fine, and it is the owner's voice;
  just be aware it will be quoted.
- `docs/INSTALL-DEV.md:567`: the plain update path (`git checkout <new tag>` then `up --build`) does not say
  *take a backup first* until the next bullet; move *Take Settings → Create backup first* to the front of the bullet,
  as `INSTALL-APP.md:344` already does.
- `CONTRIBUTING.md:7`: *"run `npm ci` once in the `spotify-companion` folder"*: true for the dev route; the App-only
  route has no `npm`. Add *(development install only)*.
- `SECURITY.md:20`: *"a same-origin `Origin` on anything that changes state"* overstates the code until 2.1.2 is
  done; make the words and the code agree in whichever direction is chosen.

---

## 5. Summary table

| # | Finding | Severity | Confidence | Where |
|---|---|---|---|---|
| 1.1 | No credential in tree or history (independent greps; gitleaks not re-run here) | — | certain | — |
| 1.2 | Owner's email in 205 commits' metadata and ~244 diff lines; accepted; last cheap moment to rewrite | owner's call | certain | history |
| 1.4 | `aidlc-state.md` current-stage line is two betas stale | Medium | certain | `aidlc-docs/aidlc-state.md:204` |
| 2.1.1 | Origin check ignores port: any loopback-port page can read the WebSocket and fire two body-less POSTs | Medium-Low | certain | `src/localGuard.ts:76` |
| 2.1.2 | Five state-changing POSTs not behind `ingestGuard`; arming automation is cross-site-safe only by the JSON preflight | Low-Medium | certain | `src/api.ts:428,521,551,682,743` |
| 2.1.3 | No CSP / `frame-ancestors` / `nosniff`; the kill switch can be clickjacked | Low-Medium | likely | `src/server.ts:946` |
| 2.3.1 | Credentials file created `0644` on Linux; upstream uses `0600` | Medium (Linux) | certain | `scripts/auth.mjs:195`, `src/configuration/atomicWrite.ts:59` |
| 2.3.2 | Refresh token carries playlist/library write scopes the app never uses | Low-Medium | certain | `scripts/auth.mjs:46-62` |
| 2.4.1 | Entrypoint chowns the user's folders to uid 1000; undocumented for Linux | Low | certain | `scripts/docker-entrypoint.sh:66-84` |
| 2.4.2 | Image check's name patterns can false-positive on a dependency's `rules.json` | Low | likely | `scripts/check-image.sh:40` |
| 2.5.1 | No tag ruleset: any write-access account can publish an image by pushing `v*` | Medium (once collaborators exist) | certain | `.github/rulesets/main.json:7`, `ci.yml:177` |
| 2.5.2 | Confirm fork-PR approval setting after the switch | Low | unverified | GitHub settings |
| 3.1 | `limit=-1` returns the whole decision log; `limit=0` → 100; `cursor=abc` → empty page | Low | certain (probed) | `src/api.ts:493-503` |
| 3.2 | Credentials cap reads `Content-Length`; chunked bodies skip it (64 KB parser cap holds) | Low | certain | `src/api.ts:997` |
| 4.1 | Ten lines of private-repository wording to remove at the switch | at the switch | certain | table in 4.1 |
| 4.2 | INSTALL-DEV S7 says no image is published | Medium | certain | `docs/INSTALL-DEV.md:390` |
| 4.3 | INSTALL-DEV S7 file-vs-folder check is pre-U9, remedy path wrong | Low-Medium | certain | `docs/INSTALL-DEV.md:396-407,431` |
| 4.4 | INSTALL-APP A8 prints the contact email an agent must not log | Low | certain | `docs/INSTALL-APP.md:322` |
| 4.5-4.7 | Linux chown note, version repeated, README premium claim, backup-first ordering, CONTRIBUTING `npm ci`, SECURITY wording | Low | certain | as listed |

**Recommended before the switch**: 1.4, 4.1, 4.2 (documents only). **Recommended in the next beta**: 2.1.1, 2.1.2,
2.3.1, 3.1, 4.3, 4.4. **Before a collaborator gets write access**: 2.5.1. The rest is backlog.

---

## 6. What this review did not do

- Did not run `gitleaks`; relied on the owner's same-day record plus the independent greps in §0.
- Did not run the test suite, build the image or start the app; every claim about behaviour is from reading the
  exact lines cited, except the two `node:sqlite` probes in 3.1.
- Did not review `src/history/`, `src/rules/`, `src/playback/`, `src/musicbrainz/` or `scripts/` beyond what the
  named areas import; the request scoped the security review to the listed parts.
- Did not assess the hypothesis gate, the classifier or any threshold.
