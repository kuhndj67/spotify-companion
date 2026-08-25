# Spotify Now Playing

A local containerised web app that displays the track you're currently listening to, reading
it from a Spotify **MCP server** rather than the Spotify Web API directly.

> **Status: walking skeleton, requirements in progress.**
> Round-1 requirements are answered and applied. A clarification round is open — please see
> [`aidlc-docs/inception/requirements/requirements-clarification-questions.md`](aidlc-docs/inception/requirements/requirements-clarification-questions.md).
> The enrichment layer (genre, release date, follow status) is **not built yet**, pending
> those answers.

> ⚠️ **Spotify Premium is required.** Since 9 March 2026, Development Mode API access
> requires the app owner to hold an active Premium subscription. Extended access is not an
> option — it requires a registered business with 250,000 monthly active users.

---

## Architecture (current assumption)

```
+------------------------------------------------------------------+
|  Container: spotify-now-playing        (published to 127.0.0.1)  |
|                                                                  |
|   [ Browser ] <--WebSocket-- [ Express + ws ]  (src/server.ts)   |
|                                     ^                            |
|                                     | poll every 3s              |
|                              [ NowPlayingService ]               |
|                                     |                            |
|                                     | MCP over stdio (child proc)|
|                                     v                            |
|                    [ spotify-mcp-server ]  --HTTPS--> Spotify    |
|                     (marcelmarais, /opt/spotify-mcp)             |
+------------------------------------------------------------------+
```

The backend polls; the browser never does. One poll loop serves every open tab, which keeps
load against Spotify's Development Mode rate limits proportional to time rather than to
viewers.

One container, because the chosen MCP server speaks **stdio only** — the MCP client must be
able to spawn the server process. A two-container split needs a stdio↔HTTP bridge; that's
Question 3.

## The MCP server

[`marcelmarais/spotify-mcp-server`](https://github.com/marcelmarais/spotify-mcp-server) —
TypeScript, 435 stars, last pushed 2026-08-21, exposes `getNowPlaying` as a first-class tool.
Full evaluation of seven candidates in
[`aidlc-docs/inception/research/research-findings.md`](aidlc-docs/inception/research/research-findings.md).

**Two things to know up front:**

1. **`getNowPlaying` returns markdown, not JSON.** MCP tools are designed for LLMs to read.
   [`src/mcp/parseNowPlaying.ts`](src/mcp/parseNowPlaying.ts) parses it, and the raw text is
   always passed through to the UI so a template change upstream is visible rather than silent.
2. **No album artwork.** The tool returns no image URL. Getting art means calling the
   Spotify Web API directly with the returned track ID — a second auth path. That's Question 2a.

---

## Setup

### 1. Create a Spotify app

At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), create an app
and add `http://127.0.0.1:8888/callback` as a redirect URI. Note the Client ID and Secret.

### 2. Authenticate

```bash
npm install
npm run auth
```

That one command clones and builds the MCP server into `.mcp-auth/`, prompts for your
Client ID and Secret, opens your browser for the Spotify consent screen, and writes the
resulting tokens to `secrets/spotify-config.json` for the container to mount.

**Why authentication happens on the host rather than in the container:** the upstream OAuth
callback listener binds `127.0.0.1` *inside* the container, which a published Docker port
cannot reach, and the flow shells out to open a browser that doesn't exist there. Host-side
auth is the only approach that works without patching upstream.

`secrets/` is gitignored — see [`secrets/spotify-config.example.json`](secrets/spotify-config.example.json)
for the file shape.

### 3a. Run directly on the host (fastest iteration)

```bash
npm run mcp:setup     # clones + builds the MCP server into .mcp-server/ (one time)
npm run build
npm start
```

Then open <http://127.0.0.1:3000> and click **Diagnostics** in the top-right of the card.

Re-run `npm run mcp:setup` after `npm run auth` — it refreshes the credential copy the MCP
server reads. (It needs its own copy because it resolves `spotify-config.json` relative to
its script location, not the working directory.)

### 3b. Run on Rancher Desktop

```bash
docker compose up --build     # dockerd (moby) engine
nerdctl compose up --build    # containerd engine
```

Open <http://127.0.0.1:3000>.

### Running without a container (faster iteration)

```bash
npm install
npm run build

MCP_SERVER_ENTRYPOINT=/tmp/spotify-mcp/build/index.js \
MCP_SERVER_CWD=/tmp/spotify-mcp \
npm start
```

---

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | The now-playing display |
| `WS /ws` | Push channel — the UI's actual data source |
| `GET /api/now-playing` | Current snapshot as JSON, for scripting and debugging |
| `GET /api/diagnostics` | **Full connect / auth / query cycle check**, step by step |
| `GET /api/health` | Liveness + a real MCP round-trip (lists tools) |

## Testing the connect / auth / query cycle

Click **Diagnostics** in the UI, or `curl localhost:3000/api/diagnostics`. It runs nine steps
in order and reports each independently with timing, so a failure localises instead of just
saying "it doesn't work":

```
[ok]   Credentials file
[ok]   Spotify auth (token refresh)
[ok]   Web API query (GET /me)
[ok]   MCP server connect
[ok]   MCP getNowPlaying
[ok]   Track lookup (GET /tracks/{id})
[ok]   Artist genres (GET /artists/{id})
[ok]   Follow status (GET /me/following/contains)
[ok]   Full enrichment chain
```

Steps needing a currently-playing track report `skip`, not `fail`, when nothing is playing.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Web app listen port |
| `HOST` | `127.0.0.1` | Bind interface. Compose overrides to `0.0.0.0` inside the container |
| `MCP_SERVER_ENTRYPOINT` | `/opt/spotify-mcp/build/index.js` | MCP server to spawn |
| `MCP_SERVER_CWD` | `/opt/spotify-mcp` | Where the server resolves `spotify-config.json` |
| `POLL_INTERVAL_MS` | `3000` | How often the backend asks the MCP server |
| `LOCAL_ONLY` | `true` | Reject non-loopback requests. Set `false` only for deliberate LAN exposure |

## Access control

Local-only, enforced in three layers ([`src/localGuard.ts`](src/localGuard.ts)):

1. Compose publishes to `127.0.0.1` only, so the port isn't on the LAN.
2. Requests from non-loopback peer addresses are rejected — a backstop if the binding is
   ever changed carelessly.
3. `Host` and `Origin` are validated, so another site can't drive this app through your
   browser via DNS rebinding.

No authentication system, by design — it's a single-user tool on your own machine.

---

## Project layout

```
src/
  config.ts                  environment configuration
  server.ts                  Express + WebSocket, routes, shutdown
  nowPlayingService.ts       backend poll loop, change detection, broadcast
  diagnostics.ts             connect/auth/query cycle check
  localGuard.ts              local-only access enforcement
  mcp/
    spotifyMcpClient.ts      spawns and talks to the MCP server over stdio
    parseNowPlaying.ts       markdown -> structured data (the brittle seam)
  spotify/
    webApiClient.ts          direct Web API access, token refresh, retry
    enrichment.ts            per-track lookup chain, cached by track ID
public/                      static frontend (no build step)
scripts/auth.mjs             one-command host-side OAuth
Dockerfile                   3 stages: MCP server, app, runtime
compose.yaml                 Rancher Desktop deployment
secrets/                     OAuth credentials (gitignored)
aidlc-docs/                  AI-DLC documentation — start at aidlc-state.md
```

## What Spotify's API can and cannot do here

Spotify restricted its Web API twice since 2024. Full audit in
[`research-findings.md`](aidlc-docs/inception/research/research-findings.md) Part 2.

**Verified working** (live calls, 2026-08-24): track/artist/album names · **album artwork**
(3 sizes) · release date and precision · age in years · album type · track number ·
explicit flag · follow status · full playback control.

**Not available:** artist genre (`GET /artists/{id}` returns **no `genres` field** at all) ·
independent-vs-signed (`label` removed from Album) · play counts (`popularity` removed) ·
audio features for preference scoring (deprecated Nov 2024, no replacement).

**`GET /me/following/contains` returns 403** even with `user-follow-read` granted — the
endpoint is restricted regardless of scope. Follow status is derived instead from
`GET /me/following`, cached for 10 minutes and checked locally.

**The auto-skip-by-release-age feature is fully achievable** — every endpoint it needs survives.

## Known gaps

- **Not yet run against a live Spotify account.** The parser is written against the upstream
  source template. It needs verification with real output, particularly the *nothing playing*
  case, which the upstream code paths suggest but which hasn't been observed.
- **Enrichment layer not built** — pending clarification questions CQ1 and CQ2.
- **No automated test suite yet.** Q10 scoped PBT to pure functions; `parseNowPlaying` and the
  `localGuard` predicates are the targets. Both have been verified manually, not yet committed
  as tests.
- **`MCP_SERVER_REF: main` is unpinned** in `compose.yaml`. Pin to a commit SHA once verified.
- **Upstream declares no license** — accepted for personal use, but it blocks open-sourcing
  this project later (Q8).
- The MCP server's `getAlbums` tool calls a **batch endpoint removed in Feb 2026** and is
  already broken in Development Mode. This app doesn't use it.
