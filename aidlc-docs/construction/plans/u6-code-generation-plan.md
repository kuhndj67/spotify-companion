# Code Generation Plan — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Code Generation (Part 1: Planning), Unit U6
**Status**: ✅ **ALL 13 STEPS DONE 2026-10-07** — `npm run verify` green, 1400 tests. Awaiting review. **Nothing deployed.**
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield — *generate* means modify existing files
where they exist, never duplicate them.

> ⚠️ **This plan is the single source of truth for U6 Code Generation.** Each step is checked off here as it
> completes, with any deviation recorded beside it — the U5 precedent.

**Inputs (all approved 2026-10-07)**: FD — `business-rules.md` **BR-44…BR-52**, `business-logic-model.md`,
`domain-entities.md`, `frontend-components.md` · NFR Design — **P-38…P-48**, **LC-32…LC-39**, **PBT-51…PBT-58** ·
Infrastructure Design — **IN-U6-1…6**, `deployment-architecture.md` · Requirements **FR-57…FR-64** · Story **US-28**

---

## Unit context

| | |
|---|---|
| **Story** | **US-28** — move my listening history to another machine, and back |
| **Requirements** | FR-57 create backup · FR-58 restore · FR-59 undo · FR-60/61 credentials and state never travel · FR-62 nothing left behind · FR-63 Settings pop-up · FR-64 one admission path |
| **Depends on** | U1 (`SqliteHistoryRepository` — its connection is what `backup()` reads) · U0 (`server.ts`, `api.ts`, `localGuard`, the UI) · ↝ U5 (`state/`, which U6 must never carry) |
| **Consumed by** | **U7** reuses `ingestGuard` and the admission path for rules and credentials · **U9** runs the cross-machine restore |
| **Owns** | No database entities. ⚠️ **No migration** — schema stays **v7**. Files only: `data/previous/`, `data/restore-pending/`, `data/.work/` |
| **New runtime dependency** | `tar` 7.5.22 (BlueOak-1.0.0, 5 transitive) — the first since U0 |

### ⚠️ What must not move

- **`decideAccess` is not edited.** `ingestGuard` composes after it (P-42); `localGuard.test.ts`'s structural pin
  must pass unchanged.
- **The startup restorer runs before `new SqliteHistoryRepository(...)`** (P-38, LC-37) — pinned structurally,
  the way the upgrade handler is pinned.
- **`npm run smoke` must still pass** after Step 3 — this unit edits scripts the smoke runner loads.
- **The live deployment is not touched by code generation.** No `docker compose` command runs in Part 2; deploying
  is Build & Test (IN-U6 deployment steps).

---

## Structure

```
src/ingest/entryPolicy.ts        LC-33a ⚙️ PURE   allowlist, file type, names, duplicates, caps
src/ingest/admitIngest.ts        LC-32  ⚙️ PURE   Origin required + ingest header + POST
src/ingest/ingestGuard.ts        LC-32  🔌        Express middleware over admitIngest
src/ingest/archive.ts            LC-33  🔌        tar stream PARSER (never extract) + writer
src/backup/manifest.ts           LC-34  🔌        tableCounts, maxIds, sha256, schemaVersionOf — MOVED from scripts/backup-history.mjs
src/backup/verifier.ts           LC-34  🔌        the 8 checks — MOVED from scripts/restore-history.mjs — + BR-47.2/47.4/47.5
src/maintenance/onlineBackup.ts  LC-35  🔌        backup() on the live connection, manifest from the copy
src/maintenance/MaintenanceService.ts LC-36 🔌    lock, staging tokens, stage/undo, status
src/maintenance/startupRestorer.ts    LC-37 🔌    journaled, idempotent swap
src/maintenance/workDirSweeper.ts     LC-38 🔌    .work/ and incomplete restore-pending/
src/ui/maintenancePanel.ts       LC-39  ⚙️ PURE   button states, comparison panel, restart/timeout text
src/api.ts                       (modified)       /api/maintenance/* routes; ApiDeps.maintenance
src/server.ts                    (modified)       restorer + sweeper before the repository; restart path; diagnostics block
public/index.html, app.js, styles.css (modified)  Settings pop-up; Export + Diagnostics move into it
scripts/backup-history.mjs, restore-history.mjs, verify-all-backups.mjs (modified)  import from src/backup via tsx
scripts/verify-install.mjs       (new)            verify:up / verify:down with the no-impact proof
compose.verify.yaml              (new)            name: spotify-verify — isolated verification installation
Dockerfile, package.json, package-lock.json, .gitignore, knip.jsonc (modified)
```

## Ordering principle

**Pure before impure, and the guard before the thing it guards** — the U5 order. Every pure module ships with its
property tests in the same step. Steps that move existing code (3) run the existing tests **unchanged** first, so a
move that alters behaviour shows up as a red test rather than a rewritten one.

---

## Steps

### Step 1 — Dependency and build — ✅ DONE 2026-10-07 *(IN-U6-1, IN-U6-2)*
- [x] `npm install tar@7.5.22` → `dependencies`; `package-lock.json` updated
- [x] `Dockerfile`: `ARG NODE_VERSION=22` → **`22.23`**; `RUN npm install` → **`RUN npm ci`**
- [x] `knip.jsonc` clean with the new dependency
- [x] ⚠️ No image is built in this step — Build & Test builds it
- ⚠️ **Finding, not U6's to fix**: `npm audit --omit=dev` reports **6 vulnerabilities (3 moderate, 2 high, 1 critical)** — `proxy-addr`, `qs`, `fast-uri`, `hono`, `ip-address`, `@modelcontextprotocol/sdk`. **Identical on the committed lockfile before `tar` was added**, and none is `tar`. Recorded for U8 (CI / dependency hygiene) rather than `npm audit fix`ed mid-unit.
- `Dockerfile` also names `package-lock.json` explicitly (no glob), so a missing lockfile fails `npm ci` rather than skipping it.

### Step 2 — Pure admission core ⚙️ — ✅ DONE 2026-10-07 *(LC-32, LC-33a · BR-46.1–46.10 · FR-64)*
- [x] `entryPolicy(header, seen, totals, caps)` → `accept(fixedName)` | `refuse(rule)` — allowlist (`manifest.json`, `history.db`, `rules.json`), regular files only, no `/` `\` `..` drive letters or leading `/`, no duplicates, per-entry and total expanded caps (**64 MB / 256 MB**, P-46)
- [x] `admitIngest({method, origin, ingestHeader})` — `POST` only, `Origin` **required** and loopback, `X-Spotify-Companion-Ingest: 1`
- [x] `test/purity.test.ts` extended to both modules
- [x] **PBT-51** (policy level), **PBT-52**, **PBT-57** (with its **positive** control)
- `src/ingest/types.ts` (constants, allowlist, rule vocabulary), `entryPolicy.ts`, `admitIngest.ts`; `test/ingestPolicy.test.ts` — **83 tests green** with `purity.test.ts`.
- `admitIngest` takes the origin rule **as a parameter** (`localGuard.isAllowedOrigin`), so the loopback-origin policy is still written exactly once and the module stays free of Express.

### Step 3 — Move the verifier into `src/backup/` — ✅ DONE 2026-10-07 *(LC-34 · BR-47 · Q4 = A)*
- [x] `src/backup/manifest.ts` ← `tableCounts`, `maxIds`, `sha256`, `schemaVersionOf`, `MANIFEST_NAME`, `MANIFEST_SCHEMA` from `backup-history.mjs`
- [x] `src/backup/verifier.ts` ← `verifyBackup` and the three-way classifier from `restore-history.mjs`, **unchanged first**
- [x] Scripts import from `src/backup/`; `package.json` `db:backup`/`db:restore`/`db:verify-backups` → `node --import tsx`; smoke entries gain `tsx: true`
- [x] ⚠️ `assertNobodyElseHoldsIt` **stays in `scripts/`** — it guards the developer path, which is still a second process (P-38)
- [x] ✅ checkpoint: `npm run db:restore -- --self-test` still **fails the CORRUPT snapshot**, `npm run db:verify-backups` reports the same 3 / 10 / 1, `npm run smoke` green
- [x] **Then** add BR-47.2 (`trusted_schema = OFF`, read-only), **BR-47.4 schema allowlist** (only `table`/`index` objects whose names exist in the app's own schema), BR-47.5 (schema not newer than supported); verdict `refused-schema`
- [x] **PBT-53**, **PBT-54**
- ✅ **Checkpoint met**: `--self-test` still rejects the CORRUPT snapshot; `db:verify-backups` still **3 verified · 10 unverifiable · 0 mismatch · 1 CORRUPT**; `smoke` green; typecheck clean. `test/backupVerifier.test.ts` — **12 green**.
- ⚠️ **Deviation — TWO classifiers found and unified.** `restore-history.mjs`'s `classify()` and `verify-all-backups.mjs`'s inline logic disagreed about a manifest with no `history.db` (`mismatch` vs "other"). Both now call **`verdictOf`**, which adds `incomplete` and `refused-schema`. No existing backup is in either new state, so the checkpoint numbers are unchanged.
- ⚠️ **Deviation — the schema allowlist is a UNION across versions**, computed by replaying the real migrations into memory. Migration **004 dropped** `artist_label`/`artist_label_signal_vote` and **renamed** `artist_label_resolution`, so today's names alone would refuse a legitimate v3 backup. A test asserts its v3 fixture really contains a dropped table.
- ⚠️ **Defect found and fixed — a damaged file THREW.** Moved unchanged, the verifier raised an exception on a file with a SQLite header and garbage pages: survivable in a script, a **crash path reachable by upload** in the app (NFR-13). Now a `corrupt` verdict. Fixing it surfaced a second defect: the early return left the handle open and Windows refused to delete the temp copy (**`EBUSY`**) — caught by the test, fixed by closing on that path.
- BR-47.2 *"opened read-only"* is met by the existing design — the verifier only ever opens a **temp copy** — with `PRAGMA trusted_schema = OFF` on it when `untrusted: true`. The developer scripts leave `untrusted` off so a legacy backup stays inspectable.
- ⚠️ **Manifest field names**: the app uses the developer manifest's existing names (`counts`, `maxIds`, `sha256['history.db']`, `schemaVersion`), as `domain-entities.md` §2 required; its example used other names and is corrected.

### Step 4 — Archive reader and writer 🔌 — ✅ DONE 2026-10-07 *(LC-33 · P-39, P-45 · BR-45, BR-46.6–46.11)*
- [x] Reader: `tar` **stream parser only**; each entry through `entryPolicy`; accepted bodies written to **fixed names** in the work dir; first refusal aborts the whole archive; gzip magic-byte check first, SQLite magic check on `history.db`
- [x] Writer: exactly the allowlisted entries, gzip-compressed, to a stream
- [x] **PBT-51** end to end (generated hostile archives: `../x`, absolute paths, symlinks, hard links → nothing written outside the work dir), **PBT-56** (planted `secrets/` and `state/` files never appear)
- `test/archive.test.ts` — **11 green**, against hand-built raw tar (`tarFixtures.ts`) so fixtures can hold what the `tar` writer refuses to.
- ✅ **Probed before writing**: `tar`'s `Parser` reports names and types exactly as the archive carries them (`../history.db`, `/history.db`, `SymbolicLink`, `Link`) — so the policy judges what an attacker sent, not a cleaned-up copy.

### Step 5 — Online backup 🔌 — ✅ DONE 2026-10-07 *(LC-35 · BR-44 · FR-57)*
- [x] Capability check: `typeof backup === 'function'`, else *unavailable* with the reason (IN-U6-1)
- [x] `integrity_check` on the live DB → `backup(liveConnection, work/history.db)` → manifest **from the copy** → verify → writer → stream; `finally` removes the work dir
- [x] `SqliteHistoryRepository` gains nothing beyond what `backup()` needs (its existing `database` accessor)
- [x] Test: a backup taken **while rows are being inserted** verifies (the 2026-10-07 probe, as a test)
- `test/onlineBackup.test.ts` — **4 green**, including a backup taken while the same connection inserts rows (the probe, as a test).
- ⚠️ **Addition**: the copy is switched to `journal_mode = DELETE` before the manifest, so the archive's `history.db` is **self-contained** — a `-wal` left beside the copy would have been silently missing from the archive (the 824-of-850 shape).
- ⚠️ **Defect found in Step 7 and fixed here**: the archive is now **built in full in memory and the work dir removed before the download starts** — see Step 7.

### Step 6 — Startup restorer and sweeper 🔌 — ✅ DONE 2026-10-07 *(LC-37, LC-38 · P-43, P-44 · BR-48.5–48.6, BR-50)*
- [x] Journal `{step, at}` written **before** each step; each step idempotent; failure restores `previous/`; **never an empty database**
- [x] The sweep touches **only** `data/.work/` and `restore-pending/` without `ready`; counts what it removed
- [x] `-wal`/`-shm` move with the `.db`
- [x] **PBT-55** — fault injected at **every** step (including a deleted journal) → the next start opens a database passing `integrity_check`
- [x] Negative test: `backup-*`, `snapshots/`, `reporting/`, `CORRUPT-snapshot-*` untouched by the sweep (BR-50.6)
- `test/startupRestorer.test.ts` — **48 green**: fault points **counted from a clean run** (not hand-listed), a simulated crash at each, with and without the journal, plus an ordinary error at each.
- ⚠️ **Defect found by walking the fault points**: a journal lost after step 2 would have **replaced `previous/` with an empty one — deleting the old database**. Rule added: never replace a `previous/` that holds a database with one that does not.
- ⚠️ **Defect found by PBT-55's error sweep**: an error between moving `history.db` and its `-wal` made the revert **discard that `-wal`** — the old database's newest committed rows. Fixed: with no live `.db`, stray siblings belong to the database being put back.
- ⚠️ **Addition**: `-wal`/`-shm` move with the `.db` as a set, and any stray sibling is moved aside before the new file goes in — a WAL beside a DIFFERENT database would be replayed into it. The test's old database carries a live `-wal` so this is exercised.

### Step 7 — `MaintenanceService` 🔌 — ✅ DONE 2026-10-07 *(LC-36 · BR-48.1–48.4, BR-49, BR-51.3)*
- [x] One-operation lock → `409`; staging tokens with a **10-minute TTL**; comparison summary (backup vs current; rules none / identical / differs)
- [x] Confirm requires the typed word `RESTORE`; staging writes `ready` **last**; then `requestRestart()` — **injected**, so tests never exit the process
- [x] Undo stages `previous/` through the same path (BR-49.2)
- [x] `MaintenanceStatus` for Settings and Diagnostics
- `test/maintenanceService.test.ts` — **9 green**, including the **whole round trip in-process**: A backs up, B restores, B undoes.
- ⚠️ **Defect found and fixed**: a download interrupted mid-stream raised an **uncaught `ENOENT`** — `tar` reads entries lazily and the work dir was deleted under it; destroying the stream first did not stop tar's readers. The archive is now built before sending.
- ⚠️ **Addition**: `startedAt` in the status — the UI recognises a restart by it CHANGING, because the app is back in ~0.5 s, faster than a poll would notice it was down.

### Step 8 — Routes and `ingestGuard` 🔌 — ✅ DONE 2026-10-07 *(P-41, P-42 · BR-46.1–46.5)*
- [x] `ingestGuard` middleware over `admitIngest`, mounted **after** `decideAccess` on ingest routes only
- [x] `POST /api/maintenance/backup` (streams the archive) · `POST /api/maintenance/restore` (raw `application/gzip` body, cap counted while streaming) · `POST /api/maintenance/restore/confirm` · `POST /api/maintenance/restore/undo` · `GET /api/maintenance/status`
- [x] ⚠️ The upload route must not pass through `express.json` (it does not — content type differs); asserted by test
- [x] `ApiDeps.maintenance` injected; route tests in `test/maintenanceRoutes.test.ts`
- [x] **PBT-58** — cap aborts at the first byte over; a body exactly at the cap is accepted
- [x] `localGuard.test.ts` passes **unchanged**
- `test/maintenanceRoutes.test.ts` — every maintenance POST × three bad-header shapes refused; the flow over real HTTP; **`localGuard.test.ts` passes unchanged** (58 green together).
- ⚠️ **Interpretation**: `ingestGuard` is on **every** maintenance POST, backup included — backup ingests nothing, but a cross-site page must not be able to make the app do maintenance on its behalf.

### Step 9 — `server.ts` wiring 🔌 — ✅ DONE 2026-10-07 *(P-38, P-47 · IN-U6-6)*
- [x] `StartupRestorer` → `WorkDirSweeper` → **then** `new SqliteHistoryRepository(...)`; structural test pins the order
- [x] The SIGINT/SIGTERM shutdown body extracted into one `shutdown(reason)` so a staged restore **reuses** it before `exit(0)` (no second shutdown path)
- [x] Diagnostics gains a **Maintenance** block: `backup()` capability, size against caps, startup sweep count, last restore outcome, previous database
- [x] Restart message chooses *Restarting…* in a container and *Restart the app to finish* otherwise (existing `inContainer`)
- `test/maintenanceWiring.test.ts` pins the order, the single exit and the wiring (CRLF-normalised — the first draft's line-anchored patterns failed on Windows line endings).
- Diagnostics' Maintenance block extracted to `src/maintenance/maintenanceDiagnostics.ts` (pure, tested) — the U5 pattern, because `diagnostics.ts` is untested.
- The restart request is deferred 250 ms so the `202` reaches the browser before the server closes.

### Step 10 — Settings pop-up — ✅ DONE 2026-10-07 *(LC-39 · FR-63 · `frontend-components.md`)*
- [x] `src/ui/maintenancePanel.ts` ⚙️ — pure derivations: button states and reasons, comparison panel, typed-confirm enablement, *Restarting…* / **60 s not-back** text; purity test; unit tests
- [x] `index.html` / `app.js`: header becomes **Settings · Rules**; Export and Diagnostics move into Settings, **keeping their `data-testid`s**; raw-body upload with the ingest header
- [x] ⚠️ Rules and the automation switch stay on the main screen (BR-51.2)
- `test/maintenancePanel.test.ts`; routes attach `view` objects (the U5 precedent — app.js cannot import `src/`).
- ⚠️ **Interpretation**: Diagnostics "moves into Settings" as a button there that opens the existing Diagnostics pop-up (same id and `data-testid`) — not by re-plumbing its content.
- ⚠️ **Defect avoided before it shipped**: the first draft detected the restart by watching the server go DOWN, which a ~0.5 s restart would slip between 2 s polls — showing *"has not come back"* after a successful restore. It now waits for `startedAt` to change.
- ⚠️ **Not click-tested yet** — Build & Test.

### Step 11 — Verification installation — ✅ DONE 2026-10-07 *(IN-U6-3 · `deployment-architecture.md` §2)*
- [x] `compose.verify.yaml`: **`name: spotify-verify`**, `image:` the live tag, **no `build:`**, port `127.0.0.1:3011`, mounts only under `verify-install/`, env `LABELS_ENABLED=false`, `SNAPSHOTS_ENABLED=false`, `SKIP_EXECUTOR_ENABLED=false`, `POLL_INTERVAL_MS=3600000`
- [x] `scripts/verify-install.mjs` with `up` / `down` / **`--plan`** (prints what it would do, touches nothing — the safe mode `smoke` runs): refuses unless the project resolves to `spotify-verify`; records the live baseline; proves the five live properties and a clean `git status` after removal
- [x] `verify:up` / `verify:down` in `package.json`; `verify-install/` in `.gitignore`; smoke entry
- [x] ⚠️ Not run in this step — it is Build & Test
- `docker compose -f compose.verify.yaml config` resolves the project to **`spotify-verify`** ✅; `--plan` runs in smoke. **Not run** — Build & Test.

### Step 12 — Documentation and code summary — ✅ DONE 2026-10-07
- [x] `construction/u6-data-lifecycle/code/code-summary.md` — files, LC/PBT mapping, deviations
- [x] `CLAUDE.md` *Commands*: in-app backup/restore, `verify:up`/`verify:down`, the `--import tsx` change to `db:*`
- [x] ⚠️ No README rewrite — that is **U8** (NFR-33)
- `construction/u6-data-lifecycle/code/code-summary.md`; `CLAUDE.md` commands updated.

### Step 13 — Gate — ✅ DONE 2026-10-07
- [x] `npm run verify` green — typecheck, tests, smoke, knip
- [x] `test/noOrphanModules.test.ts` passes with no new `ALLOWED_ORPHANS` entry (everything new is test-executed)
- [x] Update `HANDOFF.md`, `aidlc-state.md`; log in `audit.md`
- ✅ **`npm run verify` green — 1400 tests**, typecheck, smoke, knip. `propertyObligations.test.ts` now reads U6's table: **PBT-51…58 all referenced**. No new `ALLOWED_ORPHANS` entry.

---

## Story and requirement traceability

| Step | FR | PBT |
|---|---|---|
| 2 | FR-64 | 51, 52, 57 |
| 3 | FR-58 | 53, 54 |
| 4 | FR-58, FR-60, FR-61, FR-64 | 51, 56 |
| 5 | FR-57, FR-62 | — |
| 6 | FR-58, FR-62 | 55 |
| 7 | FR-58, FR-59 | — |
| 8 | FR-57, FR-58, FR-59, FR-64 | 58 |
| 9 | FR-58, FR-62 | — |
| 10 | FR-63 | — |
| 11 | US-28 exit criterion (local half) | — |

**All of FR-57…FR-64 and PBT-51…PBT-58 are covered.** US-28's remaining criterion — the real cross-machine
restore — is **U9's**.

## Scope estimate

13 steps · ~11 new source modules · ~8 new test files · modifications to `api.ts`, `server.ts`, three scripts,
the UI, `Dockerfile`, `package.json`. The largest steps are 4 (archive parsing with hostile-input tests), 6 (the
journaled swap with fault injection at every step) and 10 (the UI move).
