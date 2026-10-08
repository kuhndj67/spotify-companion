# NFR Design Plan — U7: Configuration Management

**Date**: 2026-10-08 · **Stage**: CONSTRUCTION — NFR Design, Unit U7
**Status**: ✅ **ALL 7 ANSWERED (2026-10-08), every one A.** Deliverables: `nfr-design/nfr-design-patterns.md` (**P-49…P-57**) and `nfr-design/logical-components.md` (**LC-40…LC-48**, **PBT-59…PBT-67**) — ✅ **APPROVED 2026-10-08**.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U7 Functional Design (approved 2026-10-08) — `business-rules.md` **BR-53…BR-60** (facts F1–F8, probes
P-U7-1…3), `domain-entities.md`, `business-logic-model.md`, `frontend-components.md` · requirements **FR-66…FR-72**

**NFR Requirements: SKIPPED**, as for U1–U6.

> **U7 is the first unit in which the app writes files that another process also writes.** `rules.json` has a
> second writer (the user, by hand); `spotify-config.json` has a second writer **inside the image** (the MCP
> server, hourly). U6 dissolved its writer problem by having one writer do everything; U7 cannot, so its NFR
> bias is **ordering and detection**: never write while the other writer may be mid-write, and detect — never
> assume — that nobody changed the file underneath.

---

## 1. Unit context

| | |
|---|---|
| **Requirements** | FR-66 … FR-72 |
| **NFRs in play** | **NFR-01…04** (local-only) · **NFR-05** (credentials never in logs/UI/DB) · **NFR-13** (degrade, never crash) · **NFR-14** (MusicBrainz identity) · **NFR-20/21** (property tests, logged seeds) · **NFR-24** (diagnostics authoritative) · **NFR-28** (no credentials in the repo) |
| **Adds** | rules write path, comparison, credential and contact writers, masking, the three-way poll outcome |
| **Allocates** | **P-49 …** · **LC-40 …** · **PBT-59 …** (U6 ended at P-48, LC-39, PBT-58) |
| **Schema** | ⚠️ **None** — schema stays v7 |

## 2. Facts measured for this plan — 2026-10-08

| | |
|---|---|
| Atomic write already in the codebase | `AutomationStateStore.write` — `writeFileSync(temp)` → `renameSync` into the **directory** mount `/state`; **verified live through the bind mount** (U5, 2026-10-03) |
| ⚠️ The MCP server's save is **read → network → write whole object** | `createSpotifyApi`: `loadSpotifyConfig()` → `await refreshAccessToken()` (a Spotify round trip) → `saveSpotifyConfig(config)`. **A file the app writes during that await is overwritten with the OLD credentials plus a fresh token** — and the result works, so nothing would look wrong until the old refresh token is revoked |
| MCP process lifetime | Spawned by `SpotifyMcpClient`; dropped (`#client = null`) on a call failure, respawned on the next call |
| Error texts | 20 `Error <verb>ing …:` templates across `albums.ts`, `play.ts`, `playlist.ts`, `read.ts` in `.mcp-server/src/` — fetched at **image build** time, so they can change with any rebuild |
| ⚠️ Docker CLI on Windows | `docker ps` currently fails *"timed out dialing Hyper-V socket"* after the 2026-10-08 reboot; the engine inside the VM is healthy. **The `:3011` probes (P-U7-1…3) cannot run until it is restored** |

## 3. What this stage must produce

- `construction/u7-configuration-management/nfr-design/nfr-design-patterns.md` — **P-49 …**
- `construction/u7-configuration-management/nfr-design/logical-components.md` — **LC-40 …**, **PBT-59 …**

---

## 4. Questions

### Question 1 — ⭐ Resilience — The MCP server's read-refresh-write race on `spotify-config.json`

§2: if the app writes new credentials while the MCP server is inside a refresh, the server's save puts the **old**
credentials back. Silent, and it *works* — the worst shape.

A) ⭐ **Stop the other writer first.** Saving credentials: pause the poll loop → close the MCP client and **wait for
the child process to exit** → write the file → drop the Web API token → resume the poll (which spawns a fresh
server). Nothing else can be inside a refresh, because nothing else is running. Then **read the file back** and
compare the four values; a mismatch is reported as a failure (P-U7-2 also confirms the process really exits)

B) Write, then close the MCP client. ⚠️ Leaves the race window open for the length of one refresh round trip

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 2 — Resilience — Writing `rules.json`

A) ⭐ **Extract one atomic-write helper** from `AutomationStateStore` (temp in the same directory → `renameSync`) and
use it for `rules.json` and `rules.previous.json`. One helper, imported — never a second copy (the WebSocket `403`
lesson). ⚠️ Verified for `/state`; **`/config` is verified live in Build & Test** (host and container see the same
content after a write), not assumed from `/state`

B) A rules-specific write in the new module

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 3 — Concurrency — Two writes from the app at once

Upload-confirm, undo, and the startup restore all write `rules.json`; two tabs can confirm at once.

A) ⭐ **One in-process mutex** around the whole *check hash → write previous → write current → reload* sequence.
The second confirm then sees the first's hash and is refused `changed-since-staging` (BR-54.3) — a refusal, never
a lost update. Credential and contact saves get their own mutex

B) No lock; rely on the hash check alone. ⚠️ Check-then-write without a lock is a race between the check and the write

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 4 — Security — Keeping secrets out of every output

The credentials route is the first that receives secrets in a request body.

A) ⭐ **Secrets flow one way.** The route handler reads the four fields, passes them to the writer, and returns
only `SpotifyCredentialsView` (which has no field able to hold a secret). Error responses and log lines are built
from **field names**, never values. Pinned by a **property test**: for generated secrets, no response body, log
line or Diagnostics output contains any 8-character substring of a submitted secret — including on every
refusal path

B) A, without the property test (code review only)

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 5 — Maintainability — Recognising MCP error text when the upstream can change

The server is fetched at image build, so its wording can change on any rebuild — and a changed wording would
silently send us back to *"Spotify: ok"*.

A) ⭐ **Anchored pattern plus a source-scanning test.** BR-58.1's `^Error [a-z]+ing\b.*:` at the call site, **and**
a test that scans `.mcp-server/src/**/*.ts` for every `text: \`Error …` template and asserts each one matches.
If upstream adds or rewords one, the **build's test run** fails rather than the display lying. Negative controls:
the nothing-playing and now-playing texts must **not** match

B) An exact list of the 20 known prefixes. ⚠️ A new or reworded one is missed silently

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 6 — Logical components — Where does U7's code live?

A) ⭐ A new **`src/configuration/`**: `rulesComparison.ts` (**pure**) · `masking.ts` (**pure**) · `RulesWriter.ts`
(the one rules write path, BR-53.7) · `CredentialsWriter.ts` (Spotify + MusicBrainz, the stop-write-verify
sequence) · the shared atomic-write helper moves to a neutral module both it and `AutomationStateStore` import.
Routes in `api.ts` by injection, as U4–U6. `src/rules/` stays a reader — `RuleStore` remains a parser. Pure
modules listed in `test/purity.test.ts`; `RulesWriter` may not import `src/playback/` (BR-54.5, a structural test)

B) Put the rules writer in `src/rules/` beside the store

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 7 — Testing and verification — Property obligations and when the probes run

**Properties proposed** (PBT-59 …): comparison partitions ids exactly (every id is in exactly one of
added / removed / changed / unchanged) · `compare(a, a)` is empty · the mass-removal boundary at exactly half ·
masking never reveals more than 8 characters · the secret-leak property (Q4) · the three-way poll outcome
(M4 = idle ÷ (playing + idle), never counts an error) · ⚠️ **positive control**: an accepted upload *does* change
the running set (a writer that never wrote would pass every refusal property — U5's PBT-34a lesson).

**Probes P-U7-1…3** need the `:3011` verification installation, which needs the Docker CLI working (§2).

A) ⭐ The properties above; probes run as **Code Generation step 1**, before any credentials code — and the Docker
CLI restored first (likely a Rancher Desktop restart, which **briefly restarts the live container**; your call when)

B) Run the probes now, before NFR Design is finalised

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

## 5. Out of scope for U7 NFR Design

| | |
|---|---|
| Off-machine reachability of the new routes | NFR-29 / U9 |
| The app version in the User-Agent | Requirements Question 18 / U8 |
| Infrastructure (`config/` → `:rw`, `musicbrainz.json` → `:rw`) | Infrastructure Design, next |
