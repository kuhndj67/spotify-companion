# Logical Components — U7: Configuration Management

**Date**: 2026-10-08 · **Stage**: CONSTRUCTION — NFR Design, U7 · **Status**: ✅ approved 2026-10-08
**Answers**: Q6 = A (placement), Q7 = A (properties). Numbering continues from U6: **LC-40 …**, **PBT-59 …**.
⚙️ = pure (listed in `test/purity.test.ts`) · 🔌 = touches the world.

## The boundary

`src/rules/` **stays a reader** — `RuleStore` remains a parser and `RuleSetWatcher` the only loader. Everything
that writes configuration lives in a new **`src/configuration/`**. Routes stay in `api.ts`, built from injected
dependencies as in U4–U6; `server.ts` only wires.

| Rule | Enforced by |
|---|---|
| `RulesWriter` imports nothing from `src/playback/` (BR-54.5 — a rules write can never reach the kill switch) | a structural test |
| Pure modules import nothing impure | `test/purity.test.ts` |
| One atomic-write helper, one comparison, one rules write path | `knip` + review; no second implementation exists to drift |

---

## LC-40 · `configuration/rulesComparison` ⚙️

`compare(current, next): RulesComparison` — added / removed / changed (fields) / would-load-disabled (reason) /
**becomes-live** (`dryRun` true → false) / `massRemoval`. Both inputs are **validated** rule sets. Used by
upload, undo and restore (BR-53.7). PBT-59, PBT-60.

## LC-41 · `configuration/masking` ⚙️

`maskClientId`, `maskContact`. Never receives a secret (P-53). PBT-62.

## LC-42 · `configuration/atomicWrite` 🔌 *(extracted from `AutomationStateStore`)*

`writeFileAtomic(path, content)` — temp file in the same directory → `renameSync`. `AutomationStateStore` is
changed to import it; its behaviour must not change (its existing tests are the regression check). P-51.

## LC-43 · `configuration/RulesWriter` 🔌

Owns staging (one at a time, 10-minute TTL), the mutex (P-52), the hash checks (BR-54.2/54.3), the typed
confirmation rule (BR-54.1/54.4), `rules.previous.json`, undo (BR-55), and `watcher.reloadNow()`. Returns the
**watcher's** outcome, never *"applied"* on the strength of the write alone. Also called by `StartupRestorer`
(LC-46) for BR-59.5, before the watcher starts.

## LC-44 · `configuration/CredentialsWriter` 🔌

Spotify: validate four fields → **P-49's sequence** (pause poll, close MCP and await exit, write in place with
placeholder token + `expiresAt: 0` + `replacedAt`, drop Web API token, resume) → **P-50 read-back**. MusicBrainz:
validate with the **shared** startup validator (extracted from `loadMusicBrainzIdentity`), write `contact` in
place, update the client's identity getter. Own mutex. Returns views only (P-53).

## LC-45 · `mcp/SpotifyMcpClient` *(changed)* 🔌

`#callToolText` throws `McpToolError` on a text result matching BR-58.1's pattern, as it does for `isError`. Gains
`close()` that **resolves when the child process has exited** (P-49; confirmed by P-U7-2).

## LC-46 · `maintenance/*` *(changed)* 🔌

`MaintenanceService` staging validates and compares the archive's `rules.json` instead of discarding it; confirm
records `applyRules` and `rulesHashAtConfirm` in `stage.json`. `StartupRestorer` applies the rules via LC-43
**only after** BR-48.5 step 5 succeeds and the hash still matches (BR-59.5/59.6). A U6-era `stage.json` without
the fields reads as `applyRules: false`.

## LC-47 · `playback/upstreamMetrics` *(changed)* 🔌

`recordPoll(outcome: 'playing' | 'idle' | 'error')`; exposes `pollsTotal`, `pollsIdle`, `pollsError`, `idleShare`
(P-55). `recordPollMetrics` in `server.ts` derives the outcome from the snapshot.

## LC-48 · UI *(changed)*

Rules pop-up: *Rules file* section (download, upload, comparison panel, `REPLACE` confirmation, undo). Settings:
*Spotify* and *MusicBrainz* sections, and the restore dialog's opt-in rules checkbox (reusing the comparison
panel component). Per `frontend-components.md`. ⚠️ **Every destructive control is click-tested and looked at** in
Build & Test (U6's lesson).

---

## Components deliberately NOT built

| | Why |
|---|---|
| A rules editor | Later (U6 T2 = C) |
| A second rules file / precedence rule | FD Q1 = A — one source of truth |
| A credentials probe before saving | FD Q5 = B — replaced outright; FR-71 makes failure visible |
| A previous-credentials copy | FD Q5 = B; and `secrets/` never enters a backup |
| A lock across processes for `rules.json` | Impossible across the bind mount (SQLite's locks did not cross it either); the hash check detects instead |

## Property obligations — PBT-59 onward

| ID | Property | Negative / positive control | Pins |
|---|---|---|---|
| **PBT-59** | `compare` **partitions** ids: every id in either set is in exactly one of added / removed / changed / unchanged; `compare(a, a)` is empty | Two sets differing only in rule order → empty | LC-40, BR-53.6 |
| **PBT-60** | `massRemoval` is true **iff** current ≥ 1 and removed is all or `> current / 2` — tested **at the boundary** (exactly half → false) | Removing exactly 2 of 4 → no `REPLACE` required | BR-54.1 |
| **PBT-61** | ⭐ For generated secrets, **no response body, log line or Diagnostics output** contains any 8-character substring of a submitted secret — on success and on **every refusal path** | **Positive control**: a valid save does write the file with those values | P-53, BR-56.9 |
| **PBT-62** | Masking never outputs more than 8 characters of its input | A 9-character client id → `abcd…fghi` | LC-41 |
| **PBT-63** | ⭐ **Positive control**: an accepted, confirmed upload changes the running set — the watcher's version moves and the new rules evaluate | (it *is* the control for the refusal properties) | P-56 |
| **PBT-64** | Concurrent confirms on the same base: **exactly one** applies, the rest are refused `changed-since-staging`; no confirm is lost silently | A single confirm → applied | P-52 |
| **PBT-65** | Poll outcome: an error snapshot is never counted as playing or idle; `idleShare` = idle ÷ (playing + idle) | Real server strings: nothing-playing → idle, a now-playing block → playing | P-55, BR-58.3/58.4 |
| **PBT-66** | Every `Error …` template in the MCP source matches BR-58.1's pattern; the nothing-playing and now-playing texts do **not** | Source checkout absent → the test **fails with a reason**, never passes vacuously | P-54 |
| **PBT-67** | A restore with `applyRules` writes the backup's rules **only** when the database step succeeds and the hash is unchanged; a fault at any startup step leaves the current rules untouched | `applyRules: false` → rules untouched | BR-59.5/59.6 |
