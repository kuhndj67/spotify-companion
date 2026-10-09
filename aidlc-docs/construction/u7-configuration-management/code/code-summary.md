# U7 Code Summary — Configuration Management

**Date**: 2026-10-08 · **Stage**: Code Generation complete (13 steps) · **Status**: awaiting review · **Nothing deployed**
**Plan (with every deviation beside its step)**: [`../../plans/u7-code-generation-plan.md`](../../plans/u7-code-generation-plan.md)
**Probes**: [`../probes/p-u7-1-3-2026-10-08.md`](../probes/p-u7-1-3-2026-10-08.md) — all three pass.

`npm run verify` green — typecheck · **1563 tests** (1401 at the end of U6) · smoke · knip. Schema **v7**, no migration.
`propertyObligations.test.ts` reads U7's table: **PBT-59…67 all referenced**. No new `ALLOWED_ORPHANS` entry.

---

## What was built

| Requirement | Where |
|---|---|
| FR-66 rules download / upload, comparison, no restart | `configuration/RulesWriter.ts` (LC-43), `configuration/rulesComparison.ts` (LC-40, pure), `rules/ruleValidator.ts` `parseRuleSetText` (the ONE parser — `RuleStore` uses it too), routes `/api/rules/file`, `/api/rules/upload`, `/api/rules/confirm`, UI *Rules file* section |
| FR-67 guards | `RulesWriter`: `REPLACE` for mass removal or unknown base; stale base refused; changed-since-staging refused under a lock (P-52); imports nothing from `src/playback/` (structural test) |
| FR-68 undo | `RulesWriter.stageUndo` — swaps through the same path; previous re-validated |
| FR-69 Spotify credentials | `configuration/CredentialsWriter.ts` (LC-44): pause poll → close MCP and **await the child's exit** (`mcp/processExit.ts`) → write in place (BR-56.4 shape, proven by P-U7-1) → `webApi.forgetCredentials()` → resume → read back. Routes `/api/settings/*`; UI Settings *Spotify* |
| FR-70 MusicBrainz contact | `CredentialsWriter.saveMusicBrainzContact`; `validateMusicBrainzContact` shared with startup; `MusicBrainzClient` takes a User-Agent getter |
| FR-71 a Spotify failure is a failure | `configuration/mcpErrorText.ts` (pure) at the one MCP call site → `McpToolError`; `upstreamMetrics` three-way polls, `idleShare` (renamed from a share that read as a count) |
| FR-72 restore can restore rules | `MaintenanceService` keeps and compares the archive's rules; `confirm(…, applyRules)`; the restorer carries them out of `restore-pending/` (never writes `config/`); `finishRestoreRules` applies them only after the restored database opens |
| IN-U7-1/2 | `compose.yaml`: `./config` `:rw`, `musicbrainz.json` `:rw`, both comments rewritten; `compose.verify.yaml` `config` `:rw` |
| IN-U7-6 | `configuration/configurationDiagnostics.ts` (pure) + `probeFileWritable` / `probeDirectoryWritable` |

## Found by building it — none of these were in the design

1. ⚠️ **PBT-66 corrected FD fact F7 on its first run.** 25 MCP error templates, not 20; six are single-quoted `Error: …`.
   A pattern built on F7 would have read them as data. Widened to `^Error\b[^\n]*:`.
2. ⚠️ **`SpotifyWebApiClient` caches the whole credentials file**, so "drop the token" would have kept refreshing with
   the OLD credentials — the app-side twin of F1. `forgetCredentials()` added.
3. ⚠️ **Shutdown would have hung** on an MCP child that would not exit, once `close()` awaits the exit. Exits regardless
   now; ⚠️ every restart (U6's restore included) is ~2 s longer — measure in Build & Test.
4. **The purity test's `includes('config')` matched the new `configuration/` folder.** Narrowed to the module name,
   with a two-way self-test.
5. **A static import in a test loaded `config.ts` before the test set its env**, silently making two change-detection
   tests see one poll. Dynamic import, commented.
6. **BR-54.2's "or displayed" would defeat the stale check** — the base is the last DOWNLOAD only.
7. **CI could not run PBT-66** (no MCP source) — CI now fetches it at the **pinned** ref from `compose.yaml`.
   ⚠️ Corrected 2026-10-09: this first said the ref *"floats"* on `main` and CI read the Dockerfile's default — but
   `compose.yaml` has PINNED the server since 2026-08-25 (R7). The scan guards the day the pin moves.

## ⚠️ Not yet verified — Build & Test

- **The UI has not been seen in a browser.** Click and LOOK at every destructive control (U6's lesson).
- `/config` rename through the real bind mount (verified for `/state` only, P-51).
- In-place writes to `musicbrainz.json` through the container.
- FR-71 live: a broken credential shows **RED** (P-U7-3's exact case) — and back to green after a good save.
- Restart duration with the ~2 s child-exit wait.
- Rollback: the U6 image against U7's leftovers (IN-U7-4).
