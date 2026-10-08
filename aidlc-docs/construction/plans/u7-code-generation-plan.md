# Code Generation Plan — U7: Configuration Management

**Date**: 2026-10-08 · **Stage**: CONSTRUCTION — Code Generation (Part 1: Planning), Unit U7
**Status**: ✅ **APPROVED 2026-10-08** (Q1 = A, Q2 = A). ▶ Part 2 in progress.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield — *generate* means modify existing files
where they exist, never duplicate them.

> ⚠️ **This plan is the single source of truth for U7 Code Generation.** Each step is checked off here as it
> completes, with any deviation recorded beside it — the U5/U6 precedent.

**Inputs (all approved 2026-10-08)**: FD — **BR-53…BR-60** (facts F1–F8, probes P-U7-1…3) · NFR Design —
**P-49…P-57**, **LC-40…LC-48**, **PBT-59…PBT-67** · Infrastructure Design — **IN-U7-1…6** · Requirements
**FR-66…FR-72** · Story **US-29**

---

## Unit context

| | |
|---|---|
| **Story** | **US-29** — change my rules and credentials from inside the app, without silently losing rules or breaking recording |
| **Requirements** | FR-66 rules download/upload · FR-67 write guards · FR-68 undo · FR-69 Spotify credentials · FR-70 MusicBrainz contact · FR-71 a Spotify failure is a failure · FR-72 restore can restore rules |
| **Depends on** | U3/U4 (`validateRuleSet`, `RuleSetWatcher.reloadNow`) · U5 (`AutomationStateStore`'s atomic write, extracted) · U6 (`ingestGuard`, `admitIngest`, `MaintenanceService`, `StartupRestorer`, the Settings pop-up, `verify:up`/`down`) |
| **Consumed by** | **U8** (the install routine documents these steps) · **U9** (an appliance needs them) |
| **Owns** | No database entities. ⚠️ **No migration** — schema stays **v7**. Files: `config/rules.previous.json`, `config/.rules.*.tmp` |

### ⚠️ What must not move

- **`decideAccess` is not edited**; every new state-changing route sits behind `ingestGuard` after it.
  `localGuard.test.ts` must pass **unchanged**.
- **`src/rules/` stays a reader.** `RuleStore` remains a parser; nothing in `src/rules/` gains a write.
- **`RulesWriter` imports nothing from `src/playback/`** (BR-54.5) — pinned by a structural test.
- **`AutomationStateStore`'s behaviour does not change** when its write is extracted (Step 2) — its existing tests
  run **unchanged** first.
- **The live deployment is not touched by code generation**, except Step 1's probes, which use only the `:3011`
  verification installation. Deploying is Build & Test (IN-U7 deployment steps).

---

## Structure

```
scripts/verify-install.mjs              (modified)  --probe-credentials: the reduced real-credential copy (IN-U7-3), removed by down
src/configuration/atomicWrite.ts        LC-42 🔌    EXTRACTED from AutomationStateStore — temp in same dir -> renameSync
src/configuration/rulesComparison.ts    LC-40 ⚙️    compare(current, next): added/removed/changed/wouldDisable/becomesLive/massRemoval
src/configuration/masking.ts            LC-41 ⚙️    maskClientId, maskContact
src/configuration/RulesWriter.ts        LC-43 🔌    staging, mutex, hash checks, REPLACE rule, previous copy, undo, reloadNow
src/configuration/CredentialsWriter.ts  LC-44 🔌    Spotify (P-49 stop-write-resume, P-50 read-back) + MusicBrainz contact
src/configuration/mcpErrorText.ts       LC-45 ⚙️    the BR-58.1 pattern, isolated so PBT-66 can test it against the MCP source
src/mcp/spotifyMcpClient.ts             (modified)  text errors throw (LC-45); close() resolves when the child has exited
src/playback/upstreamMetrics.ts         (modified)  three-way poll outcome; pollsIdle / pollsError / idleShare (P-55)
src/config.ts                           (modified)  the MusicBrainz contact validator extracted and shared (BR-57.2); identity getter
src/maintenance/MaintenanceService.ts   (modified)  archive rules validated + compared, applyRules staged (LC-46)
src/maintenance/startupRestorer.ts      (modified)  rules applied only after step 5 succeeds and the hash matches (BR-59.5/59.6)
src/ui/rulesFilePanel.ts                LC-48 ⚙️    comparison panel, REPLACE state, undo state
src/ui/credentialsPanel.ts              LC-48 ⚙️    Spotify / MusicBrainz section states, masking display, save gating
src/api.ts                              (modified)  /api/rules/file|upload|confirm|undo/*, /api/settings/spotify|musicbrainz; restore confirm accepts applyRules
src/server.ts                           (modified)  wiring; recordPollMetrics three-way; Configuration diagnostics block
public/index.html, app.js, styles.css   (modified)  Rules pop-up "Rules file" section; Settings Spotify + MusicBrainz; restore checkbox
compose.yaml, compose.verify.yaml       (modified)  ./config :rw, musicbrainz.json :rw, comments REWRITTEN (IN-U7-1/2)
```

## Ordering principle

**Probe before the code that depends on the probe; pure before impure; the guard before the thing it guards.**
FR-71 (Step 4) comes before FR-69 (Step 6) because FR-69's *"let the user find out"* only works once a bad
credential shows red. Steps that move existing code (2) run the existing tests **unchanged** first.

---

## Steps

### Step 1 — Probes P-U7-1…3 on the verification installation — ✅ DONE 2026-10-08 *(P-57, IN-U7-3)*
- [x] `verify-install.mjs`: `up --probe-credentials` writes `verify-install/secrets/spotify-config.json` as the
      **reduced** copy (four values, `accessToken: "placeholder"`, `expiresAt: 0`) — never mounts `secrets/`; prints
      that it did; `--plan` describes it; `down` removes it and **records that it is gone**
- [x] **P-U7-1**: on the copy (current U6 image), does the first poll refresh and report playback? Record the
      file before and after (token fields only as *present / absent*, never values)
- [x] **P-U7-2**: does closing the MCP client end the child process? Count `node` processes in the copy's container
      before and after a close
- [x] **P-U7-3**: `up` **without** the flag plus a deliberately invalid config — record the **exact** text reaching
      the app (`/api/now-playing` `raw`), and whether BR-58.1's pattern matches it
- [x] `verify:down` with the no-impact proof; probe record written to
      `construction/u7-configuration-management/probes/p-u7-1-3-2026-10-08.md`
- [x] ⚠️ **Gate**: if P-U7-1 fails, apply Question 1's answer before Step 6. If P-U7-2 fails, P-49 needs another way
      to stop the writer — **stop and return to NFR Design**
- ✅ **All three pass** — [`probes/p-u7-1-3-2026-10-08.md`](../u7-configuration-management/probes/p-u7-1-3-2026-10-08.md). P-U7-1: placeholder token refreshed on the first poll → **Q1's fallback not needed**. P-U7-2: child exits after `close()`, but **~2 s later** — `close()` must await the exit (bound ≥ 5 s). P-U7-3: both broken-credential texts match BR-58.1; F5 confirmed live. `verify:down` no-impact proof passed.

### Step 2 — Extract the atomic write — ✅ DONE 2026-10-08 *(LC-42, P-51)*
- [x] `configuration/atomicWrite.ts` from `AutomationStateStore.write`; the store imports it
- [x] `automationStateStore.test.ts` passes **unchanged**; new tests for the helper (temp in same dir, no temp left on failure)
- ✅ `automationStateStore.test.ts` **19/19 unchanged**; `atomicWrite.test.ts` 8 new. `probeWritable` extracted too (`probeDirectoryWritable`), for IN-U7-6. ⚠️ **Deviation**: the temp name is the fixed sibling `.rules.json.tmp`, as U5 already did, not `domain-entities.md`'s `.rules.<random>.tmp` — safe because every caller serialises (P-52), and a crash then leaves at most one stray file per target.

### Step 3 — Pure cores ⚙️ — ✅ DONE 2026-10-08 *(LC-40, LC-41, LC-45 text)*
- [x] `rulesComparison.ts` — **PBT-59** (partition; `compare(a, a)` empty), **PBT-60** (mass-removal boundary)
- [x] `masking.ts` — **PBT-62**
- [x] `mcpErrorText.ts` — **PBT-66** scans `.mcp-server/src/**/*.ts`, every `Error …` template matches; nothing-playing
      and now-playing texts do not; source absent → **fails with a reason**
- [x] `test/purity.test.ts` extended to all three
- ✅ 28 tests (rulesComparison, masking, mcpErrorText); purity 80/80. Deviations, each recorded:
  - ⚠️ **PBT-66 failed on its first run and was RIGHT.** F7 (*"20 templates, all `Error <verb>ing`"*) came from a grep that matched backtick templates only. The source has **25**: 19 `Error <verb>ing …:`, **6 single-quoted `Error: …`**, one with an interpolated verb. Pattern widened to `^Error[^
]*:`; no non-error server text starts with `Error`. F7′ added to `business-rules.md`.
  - ⚠️ **CI gained a step** fetching `.mcp-server/` at the Dockerfile's `MCP_SERVER_REF` (read from the Dockerfile) — without it PBT-66 fails in CI by design. `MCP_SERVER_REF=main` **floats**, so this checks what the next image build will get.
  - `becomesLive` is wider than BR-53.6's *dryRun true → false*: any rule that **can act** after and could not before (an added live rule, a re-enabled rule). Narrower would miss an added live rule.
  - `maskClientId` reveals 4+4 only from **16** characters (domain-entities said 9): 8 of 9 characters is not masking. Email reveals ≤ 2 of the local part.
  - `ruleHash.canonicalise` is now exported — one canonicaliser, used by the comparison.

### Step 4 — FR-71: a Spotify failure is a failure — ✅ DONE 2026-10-08 *(LC-45, LC-47, P-55, BR-58)*
- [x] `SpotifyMcpClient.#callToolText` throws on a matching text result, as for `isError`
- [x] `upstreamMetrics.recordPoll(outcome)`; `pollsIdle`, `pollsError`, `idleShare`; `pollsReturningNothingPlaying`
      **removed** (P-55 — it read as a count); every reader updated (Diagnostics UI included)
- [x] `recordPollMetrics` derives the three-way outcome — **PBT-65**, using the server's real strings (P-U7-3's text added
      as a fixture)
- [x] `upstreamMetrics.ts` header notes that historic M4 figures mixed F5 and F6 (BR-58.6)
- ✅ Full suite **1450/1450**. `McpToolError` (does **not** drop the connection — the server is fine, Spotify refused); the snapshot says *"Spotify returned an error: …"* (≤ 200 chars) rather than *"could not reach the MCP server"*, which would point at the wrong component. `pollOutcomeOf` lives in the pure `upstreamMetrics` so PBT-65 can test it; `idleShare` is **null** for an all-error run (unknown, not 100% idle).
- ⚠️ Found while testing: a **static** import of `spotifyMcpClient` in a test loads `config.ts` before the test sets `POLL_INTERVAL_MS`, and two change-detection tests then failed. Dynamic import, with a comment saying why.

### Step 5 — `RulesWriter` 🔌 — ✅ DONE 2026-10-08 *(LC-43, P-52, BR-53/54/55)*
- [x] Download (hash header) · stage (admission → parse → validate → compare) · confirm (token, hash, `REPLACE` rule,
      mutex, previous via atomicWrite, current via atomicWrite, `reloadNow()`) · undo (swap, same path)
- [x] Returns the **watcher's** outcome; refusal reasons each with their own message
- [x] **PBT-63** (positive control: the running set changes), **PBT-64** (concurrent confirms: exactly one applies)
- [x] Structural test: `RulesWriter` imports nothing from `src/playback/`
- ✅ 21 tests over a **real** `RuleStore` + `RuleSetWatcher` (no stub watcher). Deviations, each recorded:
  - **One parser**: `parseRuleSetText` (pure, in `ruleValidator.ts`) is now what `RuleStore` uses for the file and `RulesWriter` for an upload — an upload is judged by exactly the code that will load it. Store/watcher/validator tests unchanged (132).
  - **Stagings are per token** (bounded at 8, TTL 10 min), not *"one at a time"* (`domain-entities.md`): with one slot, PBT-64's two-tab case could not occur. The lock plus BR-54.3's hash make exactly one of N concurrent confirms apply.
  - Two refusal reasons added beyond the design's six: `write-failed`, `reload-rejected` (the watcher's verdict, so *"applied"* is never claimed on the write alone); `too-large` split from `invalid`.
  - `compareCandidate` (compare without staging) and `applyAtStartup` added for Step 7, so restore uses this class rather than a second write path.
  - Caps `RULES_UPLOAD_CAP_BYTES` / `CREDENTIALS_CAP_BYTES` live in `ingest/types.ts` beside U6's.

### Step 6 — `CredentialsWriter` 🔌 — ✅ DONE 2026-10-08 *(LC-44, LC-45 close, P-49, P-50, P-53, BR-56/57)*
- [x] MusicBrainz validator extracted from `loadMusicBrainzIdentity` and shared; client identity behind a getter
- [x] `SpotifyMcpClient.close()` resolves when the child has exited (per P-U7-2)
- [x] Spotify save: validate → pause poll → close MCP and await exit → write in place (BR-56.4 shape, or Question 1's
      fallback) → drop Web API token → resume → **read back and compare**
- [x] Views only; error text from field names only — **PBT-61** (leak property + positive control)
- ✅ Full suite **1486/1486**. The ORDER test pins P-49 (pause → close with the file still old → write → forget → resume); PBT-61 runs four paths × generated secrets with its positive control.
- ⚠️ **Found while building — the app-side twin of F1**: `SpotifyWebApiClient` caches the **whole credentials file** (`#credentials`) for the process lifetime. The plan's *"drop the Web API token"* would have kept refreshing with the OLD client id, secret and refresh token. Added `forgetCredentials()`; `CredentialsWriter` calls that, not `invalidateAccessToken`.
- `NowPlayingService.pause()` awaits polls **in flight** (tracked set), not just the timer; `SpotifyMcpClient.close()` awaits the child's exit via `mcp/processExit.ts` (bound 6 s, P-U7-2 measured ~2 s) and rejects past it — then nothing is written (`mcp-did-not-stop`).
- `validateMusicBrainzContact` extracted from `loadMusicBrainzIdentity` — one rule for startup and Settings. `MusicBrainzClient` takes a User-Agent **getter** (BR-57.4).
- ⚠️ **Limit, stated**: if labels were DISABLED at startup because the contact was missing, saving one in Settings does not enable them until a restart — the label pipeline is not constructed. Settings must say so (Step 11).

### Step 7 — Restore with rules — ✅ DONE 2026-10-08 *(LC-46, BR-59)*
- [x] Staging validates and compares the archive's `rules.json`; confirm records `applyRules`, `rulesHashAtConfirm`
- [x] `StartupRestorer` applies rules via `RulesWriter` only after step 5 succeeds and the hash matches, before the
      watcher starts; a U6-era `stage.json` reads as `applyRules: false`
- [x] **PBT-67** — fault at each startup step leaves current rules untouched
- ✅ Full suite **1508/1508**. PBT-67 runs at **every counted fault point** of the restorer (reusing U6's PBT-55 harness) and asserts backup rules only ever arrive **with** the backup's history.
- Shape, recorded: the restorer **never writes `config/`** — before cleanup deletes `restore-pending/`, it carries an opted-in `rules.json` OUT in its outcome; `finishRestoreRules` (tested, in `startupRestorer.ts`) applies it via `RulesWriter.applyAtStartup` only when `server.ts` reports the restored database **opened** (BR-48.6's fallback → not applied). ⚠️ Consequence: a crash between cleanup and that call loses the rules choice — the current rules stay, which is the safe direction.
- `MaintenanceService` gains `rulesCandidate` / `currentRulesHash` deps (→ `RulesWriter`, one comparison) and `confirm(token, word, applyRules = false)`; the archive's rules are kept in the work dir until confirm decides. U6's tests pass with one fixture gaining the two new `Comparison` fields.

### Step 8 — Routes 🔌 — ✅ DONE 2026-10-08 *(BR-60)*
- [x] `GET /api/rules/file` · `POST /api/rules/upload` · `POST /api/rules/confirm` · `POST /api/rules/undo/stage` ·
      `POST /api/rules/undo/confirm` · `GET`/`POST /api/settings/spotify` · `GET`/`POST /api/settings/musicbrainz` ·
      `POST /api/maintenance/restore/confirm` accepts `applyRules`
- [x] Every `POST` behind `ingestGuard`; body caps 256 KB / 16 KB; route tests; `localGuard.test.ts` **unchanged**
- ✅ 15 route tests + `localGuard.test.ts` **unchanged** (60 pass). `ingestGuard` asserted on all five new POSTs × U6's three refusals, each also proving nothing was written. Deviations: undo is `POST /api/rules/undo` and confirms through the **same** `/api/rules/confirm` (one confirm path, not `undo/stage` + `undo/confirm`); `GET /api/rules/file/status` added (base hash, `hasPrevious`, last write) and `GET /api/settings/credentials` returns both views. The rules upload travels as **`text/plain`** with the base in `X-Rules-Base-Hash`, because the router's JSON parser caps at 64 KB — under the 256 KB rules cap; an oversized body is a JSON 413, never Express's HTML page.

### Step 9 — Diagnostics *(IN-U7-6)* — ✅ DONE 2026-10-08
- [x] *Configuration* block: `config/` and `musicbrainz.json` writable (probed at startup), last rules write, last
      credentials write (never values), poll counts
- ✅ `configuration/configurationDiagnostics.ts` (pure) + `probeFileWritable` (opens `r+` and closes — never writes, never creates). A refused rules write is NOT a fault (the guard working); only `write-failed` / `reload-rejected` are. Mostly-error polls FAIL in words, beside the red indicator.

### Step 10 — `server.ts` wiring — ✅ DONE 2026-10-08
- [x] Construct the writers; inject into `createApi`; restorer gets `RulesWriter` before the watcher starts
- ✅ Full suite **1540/1540**. `RulesWriter` is built right after `RULES_PATH`, before the watcher; `finishRestoreRules` runs there (the restored database has already opened — `openHistory` turns a fallback into `failed`); the watcher is attached once built. `CredentialsWriter` gets the poll loop, the MCP client and the Web API client as ports. The MusicBrainz client reads `labelUserAgent` through a getter.
- ⚠️ **Found while wiring**: shutdown did `spotify.close().then(() => process.exit(0))`. With `close()` now awaiting the child's exit and rejecting past its bound, a child that would not die would have turned shutdown into a **hang**. Now exits regardless. ⚠️ It also adds ~2 s (P-U7-2) to every restart, including U6's restore restart — measure in Build & Test.

### Step 11 — UI *(LC-48, frontend-components.md)*
- [ ] Pure panel modules with tests (`rulesFilePanel.ts`, `credentialsPanel.ts`)
- [ ] Rules pop-up *Rules file* section · Settings *Spotify* (with guidance) and *MusicBrainz* · restore dialog checkbox
- [ ] ⚠️ The disabled-looking-enabled lesson: each destructive control's disabled state has a **visible** style, not
      only the attribute

### Step 12 — Infrastructure files *(IN-U7-1, IN-U7-2)*
- [ ] `compose.yaml`: `./config` `:rw`, `musicbrainz.json` `:rw`, both comment blocks **rewritten** as IN-U7-1/2 specify
- [ ] `compose.verify.yaml`: `./verify-install/config` `:rw`

### Step 13 — Verify and document
- [ ] `npm run verify` green — typecheck, tests, smoke, knip
- [ ] `propertyObligations.test.ts` reads U7's table: **PBT-59…67 all referenced**
- [ ] `test/noOrphanModules.test.ts` passes with no new `ALLOWED_ORPHANS` entry
- [ ] `code/code-summary.md`; update `HANDOFF.md`, `aidlc-state.md`; log in `audit.md`

---

## Scoping questions

### Question 1 — If P-U7-1 fails (the placeholder token does not trigger a refresh)

A) ⭐ **The app refreshes once itself, immediately after writing** — one request to Spotify's token endpoint with the
new refresh token, writing the real `accessToken` and `expiresAt` into the file before the MCP server restarts. This
is **write-then-refresh, not a check-before-write**: the old credentials are already gone (FD Q5 = B), and a failed
refresh shows red through FR-71 like any other bad credential

B) Stop and return to Functional Design

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 2 — Ship FR-71 early?

FR-71 fixes a defect live **today** (broken credentials read *"Spotify: ok"*). It is Step 4 and independent of the
rest.

A) ⭐ **One deployment at Build & Test.** Credentials do not change between now and then, so the defect cannot bite
in the interval; one deploy keeps one rollback point (`u6-rollback`)

B) Deploy Step 4 on its own as soon as it passes, then the rest of U7 later. ⚠️ Two deploys, two rollback points

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

## Story and requirement traceability

| Step | FR | PBT |
|---|---|---|
| 1 | FR-69, FR-71 (premises) | — |
| 2 | FR-66 | — |
| 3 | FR-66, FR-67, FR-69, FR-71 | 59, 60, 62, 66 |
| 4 | FR-71 | 65 |
| 5 | FR-66, FR-67, FR-68 | 63, 64 |
| 6 | FR-69, FR-70 | 61 |
| 7 | FR-72 | 67 |
| 8–11 | FR-66…FR-72 | — |
| 12 | FR-66, FR-70 (mounts) | — |

**All of FR-66…FR-72 and PBT-59…PBT-67 are covered.**

## Scope estimate

13 steps · ~7 new source modules · ~9 new test files · modifications to `spotifyMcpClient.ts`, `upstreamMetrics.ts`,
`config.ts`, two maintenance modules, `api.ts`, `server.ts`, the UI, both compose files and `verify-install.mjs`.
The largest steps are 5 (`RulesWriter`'s staging and guards), 6 (the stop-write-resume sequence) and 11 (the UI).
