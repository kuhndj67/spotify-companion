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
| `GET /api/explain/:playId` | **Why a track got its label** — the full derivation, local reads only |
| `GET /api/history/recent` | The last 50 plays, so the trace UI has something to offer |

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

## Tests

```bash
npm test              # 100 tests
npm run test:coverage # with coverage
npm run typecheck     # src and test
```

Node's built-in test runner, plus [fast-check](https://github.com/dubzzz/fast-check) for
property-based testing (PBT-09). Per the Q10 "Partial" opt-in, PBT covers pure functions and
round-trips; example-based tests cover concrete behaviour alongside them (PBT-10).

### Reproducing a property failure

Every run prints its seed:

```
[fast-check] seed=1266874889 — replay with: FC_SEED=1266874889 npm test
```

Pass that seed back to replay the exact run, shrunk counterexample included. CI uses the
run ID as its seed and surfaces it in the job summary, so a red build is replayable locally
or re-runnable via **workflow_dispatch** with the same seed.

The seed varies per run rather than being frozen — a fixed seed would only ever explore the
same inputs, which defeats the purpose. Logging it keeps failures reproducible without
freezing the search space.

| Module | Line | Branch | Notes |
|---|---:|---:|---|
| `localGuard.ts` | 100% | 97% | Security-critical — predicates, middleware, and PBT |
| `parseNowPlaying.ts` | 100% | 86% | Round-trip property against a model of upstream's template |
| `enrichment.ts` | 100% | 83% | Includes followed-artists pagination and TTL cache |
| `webApiClient.ts` | 100% | 95% | Token refresh, 401 retry, 403/429 handling — `fetch` stubbed |
| `nowPlayingService.ts` | 98% | 91% | Poll loop and change detection |
| `config.ts` | 100% | 67% | Branches are host-vs-container path selection |

**Not covered, deliberately:** `server.ts` (Express/WebSocket wiring), `diagnostics.ts`, and
`mcp/spotifyMcpClient.ts` (spawns a real subprocess). These are I/O composition rather than
logic, and are exercised end to end by `GET /api/diagnostics` against a live account —
which is a better test of them than a mock would be. `public/app.js` has no tests either.

### Bugs the tests found

Writing these was not a formality — the property tests found four real defects:

1. **A `|` in a track title truncated it.** The parser cut at any pipe, because upstream
   packs `**Shuffle**: Off | **Repeat**: off` onto one line. Shrunk to the title `"|a"`.
2. **Quotes were stripped from every field.** Upstream only quotes the Track, so an album
   genuinely titled `"Heroes"` (Bowie's, quotes included) lost them.
3. **`[::1].a.com` and `[::1]evil.com` passed the Host check.** The bracketed-IPv6 branch
   took everything up to `]` and ignored the remainder — a real bypass in the one control
   that enforces local-only access.
4. **Future release dates produced a negative age.** Spotify returns them for pre-releases;
   `ageYears: -1` would have been unsafe input to the planned auto-skip rule.

Each is now pinned by an example-based regression test naming the shrunk case.

## Listening history (U1)

Every track that plays is recorded automatically: what it was, when, and whether you let it play
or skipped it. This is the dataset the project exists to build — it is what makes the
"is Spotify pushing promoted tracks at me?" question answerable later.

### Where it lives

```
data/
├── history.db          SQLite; also -wal and -shm alongside it
└── snapshots/          dated CSV backups, newest 14 kept
```

`data/` is gitignored and bind-mounted into the container, so `compose up --build` never destroys
it.

> ⚠️ **This is the only data here that cannot be regenerated.** Code comes back from git,
> enrichment from Spotify, labels from MusicBrainz — months of play records come back from
> nowhere. Snapshots live in the same directory, so the database and its backups share a single
> deletion event, and being gitignored makes them *more* exposed to `git clean -xdf`, not less.
> Set `SNAPSHOT_DIR` to somewhere outside the project if that bothers you.

### Outcomes

Three values: `completed`, `skipped`, `unknown`.

A play counts as **completed** when listened time reaches **90%** of the track's duration.
Listened time is the sum of forward progress, so rewinding to re-hear something adds to it — and
a track played twice in a row produces one record with a ratio near 2.0. The ratio is deliberately
not capped at 1.0; that is the repeat-listen signal.

Anything else that is not a below-threshold track change — paused and never resumed, device
switched off, app restarted mid-track — is `unknown` rather than a guess.

> **Known limitation.** The final poll of a play lands up to one interval before the track ends,
> so a fully-played track is only guaranteed to clear 90% when it is at least ~30 seconds long.
> Shorter tracks are *sometimes* recorded as skipped, depending on where that last poll falls —
> the same interlude can resolve either way on different plays. Every play keeps its raw
> observation trail, so these records can be recomputed later without re-collecting anything.

### Export

The **Export** button downloads the full history as CSV or JSON, or:

```
curl -OJ 'http://127.0.0.1:3000/api/history/export?format=csv'
curl -OJ 'http://127.0.0.1:3000/api/history/export?format=json&since=2026-08-01T00:00:00Z'
```

Analysis happens in whatever tool you prefer — this app collects and exports, it does not analyse.
Exports carry every recorded field plus coverage counts, and **unknown values render as the literal
token `unknown`**, never as blanks or zeros. That matters: missing data here is correlated with
what is being measured, so an unknown that looks like an empty cell would hide a bias rather than
show it.

There is deliberately no data API. Serving a containerised dashboard would mean widening the
local-only guard that the no-password setup depends on — see `aidlc-docs` §5.1 (W-1). A dashboard
installed *on the host* reaches `127.0.0.1` and works today with no change.

## Label enrichment (U2)

Resolves each track's record label from MusicBrainz and classifies it major / independent /
unknown, so the promotion hypothesis has an independent variable to test.

### Setup — one file, and the app will not start without it

MusicBrainz policy requires every request to identify the application and carry a contact
address. Copy the template and put a real address in:

```bash
cp secrets/musicbrainz.example.json secrets/musicbrainz.json
# edit "contact"
```

**This fails closed on purpose.** There is no anonymous fallback: sending unidentified traffic
while believing you are compliant is worse than a loud refusal at startup. To run without label
enrichment entirely, set `LABELS_ENABLED=false`.

`secrets/` is gitignored, which is why the contact address lives there rather than in
`compose.yaml` — that file is tracked and this repository is public.

### What leaves the machine

This is the first thing the app sends anywhere other than Spotify. Per **distinct** track, once:

- the **ISRC**, or the Spotify **artist ID**, to `musicbrainz.org`
- a `User-Agent` naming the app and your contact address

Because resolutions are cached, what is exposed is closer to *your distinct library* than *your
listening timeline*. Everything is serialised through a single queue at **1 request/second** —
that spacing and the retry policy are constants in code, not settings, because there is no
legitimate value other than one per second.

### Reading the output

| State | Meaning |
|---|---|
| `pending` | The lookup has not happened yet. **Not** the same as `unknown` |
| `unknown` | We looked and could not tell — with a reason: `noIsrc`, `notFound`, `noEligibleCandidate`, `error` |
| `major` / `independent` | A verdict, with an ordinal confidence and the per-signal votes behind it |

Two levels are recorded **side by side and never merged**: the *release* label (a fact about a
past pressing) and the *artist* label (a fact about now). They can legitimately disagree — an
artist signed to a major releasing one track independently is both at once.

### Coverage is a measurement, and it is reported as one

Open **Diagnostics** for a coverage panel broken down **by release year**. That breakdown is not
decoration: measured against real listening, MusicBrainz resolved **100% of pre-2022 releases and
43% of 2022-onward ones**. The gaps concentrate on recent independent releases — exactly the
population the hypothesis is about — so an analysis that quietly drops `unknown` rows drops the
newest independent music first.

The panel carries an **as-of timestamp**, because the same query run twice can legitimately
differ: resolutions are re-checked over time and a previously-unknown track may have resolved.

### "Why this label?"

The Diagnostics dialog has a **Why this label?** section that shows the full derivation for any
play in history — the join, which narrowing tier fired, every candidate label, and **which rule
refused each one it rejected**.

That last part is the point. The classifier is deliberately biased toward *not* calling something
independent, and it works by exclusion: `unknown` because MusicBrainz knew nothing and `unknown`
because a publishing entity was found and discarded are the same verdict with opposite meanings.
The trace is what tells them apart.

It also warns when it is explaining an old play with newer rules, rather than presenting today's
reasoning as history.

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `LABELS_ENABLED` | `true` | Set `false` to run without MusicBrainz entirely |
| `LABEL_TTL_UNKNOWN_DAYS` | `30` | How long before an `unknown` is retried |
| `LABEL_TTL_RESOLVED_DAYS` | `90` | How long before a success is re-checked |
| `LABEL_BACKFILL_INTERVAL_HOURS` | `6` | Scheduled sweep cadence |
| `LABEL_BACKFILL_BATCH` | `25` | Bounds one sweep |
| `MUSICBRAINZ_BASE_URL` | MusicBrainz | Overridable for testing against a stub |

The two TTLs are **measurement parameters**, not tuning knobs — they shape what the dataset
contains. They differ because they answer different questions: an `unknown` is retried because
MusicBrainz's *completeness* changes, a success because the underlying *fact* can change when an
artist signs.

## Known gaps

- **No integration test** for the Express/WebSocket layer or the MCP subprocess spawn.
- **U1 not yet verified against live playback.** The classifier and repository are covered by
  tests, but recording during a real listening session — and the `./data` bind mount working
  under Rancher Desktop — are on the Build and Test checklist.
- **Not yet built** (requirements agreed 2026-08-25, see
  `aidlc-docs/inception/requirements/requirements.md`): MusicBrainz label resolution (FR-12–16,
  U2), the **rules engine** (FR-24–45, U3/U4) — user-authored rules over any known track field —
  and playback control (FR-46–48, U5).
- **`node:sqlite` is experimental** in Node 22. Contained behind `HistoryRepository`, so
  swapping to `better-sqlite3` or Postgres is one file.
- **`MCP_SERVER_REF: main` is unpinned** in `compose.yaml`. Pin to a commit SHA once verified.
- **Upstream declares no license** — accepted for personal use, but it blocks open-sourcing
  this project later (Q8).
- The MCP server's `getAlbums` tool calls a **batch endpoint removed in Feb 2026** and is
  already broken in Development Mode. This app doesn't use it.
