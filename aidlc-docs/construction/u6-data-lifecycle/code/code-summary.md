# Code Summary — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Code Generation (Part 2), U6
Plan: [`../../plans/u6-code-generation-plan.md`](../../plans/u6-code-generation-plan.md) — the single source of
truth, with every deviation recorded beside its step.

**Gate**: `npm run verify` green — typecheck · **1400 tests** (was 1256) · smoke · knip. Schema still **v7**; no
migration. **Nothing was deployed** — the live container still runs U5's image; deploying is Build & Test.

---

## Created

| File | LC | Purity | Purpose |
|---|---|---|---|
| `src/ingest/types.ts` | — | ⚙️ | Caps (64 MB / 256 MB), the archive allowlist, the ingest header, rule vocabulary |
| `src/ingest/entryPolicy.ts` | LC-33a | ⚙️ | Decide one archive entry: allowlist, regular files only, no paths, no duplicates, caps |
| `src/ingest/admitIngest.ts` | LC-32 | ⚙️ | POST + Origin **required** + ingest header; origin rule passed in |
| `src/ingest/ingestGuard.ts` | LC-32 | 🔌 | Express face of `admitIngest`, composed **after** `localGuard` |
| `src/ingest/archive.ts` | LC-33 | 🔌 | `tar` as a **parser only**; fixed output names; never throws |
| `src/backup/manifest.ts` | LC-34 | 🔌 | Manifest helpers — **moved** from `scripts/backup-history.mjs` |
| `src/backup/verifier.ts` | LC-34 | 🔌 | The 8 checks — **moved** from `scripts/restore-history.mjs` — + untrusted-input checks; ONE `verdictOf` |
| `src/maintenance/onlineBackup.ts` | LC-35 | 🔌 | `backup()` on the live connection; self-contained copy; manifest from the copy |
| `src/maintenance/startupRestorer.ts` | LC-37/38 | 🔌 | Journaled, idempotent startup swap; `revertToPrevious`; the leftovers sweep |
| `src/maintenance/MaintenanceService.ts` | LC-36 | 🔌 | Lock, staging tokens (10 min), upload with streaming cap, confirm, undo, status |
| `src/maintenance/maintenanceDiagnostics.ts` | — | ⚙️ | Diagnostics' Maintenance block |
| `src/ui/maintenancePanel.ts` | LC-39 | ⚙️ | What the Settings pop-up says — derived on the server |
| `compose.verify.yaml` | — | — | The isolated verification installation (`name: spotify-verify`) |
| `scripts/verify-install.mjs` | — | — | `verify:up` / `verify:down` / `--plan`, with the no-impact proof |
| Tests | — | — | `ingestPolicy`, `backupVerifier`, `archive` (+ `tarFixtures.ts`), `onlineBackup`, `startupRestorer`, `maintenanceService`, `maintenanceRoutes`, `maintenanceDiagnostics`, `maintenancePanel`, `maintenanceWiring` |

## Modified

| File | Change |
|---|---|
| `src/api.ts` | `/api/maintenance` (GET) and five POSTs behind `ingestGuard`; `ApiDeps.maintenance` (optional) |
| `src/server.ts` | Restore + sweep **before** the repository opens (pinned); `openHistory()` reverts a restore that will not open; **one** `shutdown()`; the service wired to routes and diagnostics |
| `src/diagnostics.ts` | Optional maintenance input → the Maintenance steps |
| `public/index.html`, `app.js`, `styles.css` | Header **Settings · Rules**; Settings pop-up; Export and Diagnostics moved in with their `data-testid`s |
| `scripts/backup-history.mjs`, `restore-history.mjs`, `verify-all-backups.mjs` | Import from `src/backup/`; one classifier |
| `scripts/smoke-entry-points.mjs` | `tsx: true` for the moved-verifier scripts; `verify-install.mjs --plan` entry |
| `package.json`, `package-lock.json` | `tar` 7.5.22 (exact); `db:*` and `repair:skip-source` under `--import tsx`; `verify:up` / `verify:down` |
| `Dockerfile` | `NODE_VERSION=22.23`; `npm ci` with the lockfile named explicitly |
| `.gitignore` | `verify-install/` |
| `test/purity.test.ts`, `test/propertyObligations.test.ts` | U6's pure modules and obligations registered |
| `localGuard.ts` / `decideAccess` | **Unchanged** — `localGuard.test.ts` passes untouched |

## Property obligations

| | Discharged in |
|---|---|
| PBT-51 | `ingestPolicy.test.ts` (decision) + `archive.test.ts` (end to end, real parser) |
| PBT-52 | `ingestPolicy.test.ts` |
| PBT-53, PBT-54 | `backupVerifier.test.ts` |
| PBT-55 | `startupRestorer.test.ts` — a crash at **every counted** fault point, with and without the journal |
| PBT-56 | `archive.test.ts` |
| PBT-57 | `ingestPolicy.test.ts` (with a positive control) |
| PBT-58 | `maintenanceService.test.ts` (with an **endless** body) and `maintenanceRoutes.test.ts` |

## ⚠️ Defects found during generation — five, all by tests or by walking a fault point, none in production

1. **A damaged backup THREW** in the moved verifier — survivable in a script, a crash path by upload. Now a
   `corrupt` verdict. Fixing it surfaced (2).
2. **An unclosed handle made the temp copy undeletable on Windows (`EBUSY`)** on that early-return path.
3. **A lost journal after step 2 would have deleted the old database**: `previous/` replaced by an empty one.
   Found by walking the fault points; rule: never replace a `previous/` holding a database with one that does not.
4. **A failed swap could discard the old database's `-wal`** — its newest committed rows — when the error fell
   between moving the `.db` and its siblings. Found by PBT-55's ordinary-error sweep.
5. **A download interrupted mid-stream raised an UNCAUGHT `ENOENT`**: `tar` reads entries lazily, and the work dir
   was deleted under it. Destroying the stream first did not stop tar's readers; the archive is now built in full
   before sending, and nothing is left on disk to race.

And two **design** findings: the verifier had **two classifiers that disagreed** (unified into `verdictOf`), and
the schema allowlist must be a **union across versions** (migration 004 dropped tables a legitimate v3 backup has).

## Not done here — Build & Test

The UI is **not click-tested** · the verification installation has **not been run** · ⚠️ that the app starts
**without Spotify credentials** is **not yet seen** (step 1 of the U6 test) · the restart time is **not measured**
· the rollback image is **not tagged** · the pre-deploy backup is **not taken** · BR-52's legacy cleanup is
**not done**. Also recorded for U8: `npm audit` reports **6 pre-existing vulnerabilities** in the Express/MCP SDK
chain — identical before `tar` was added, none in `tar`.
