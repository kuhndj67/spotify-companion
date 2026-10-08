# Build & Test Summary — U6: User-Data Lifecycle

**Date**: 2026-10-08 (UTC; the evening of 2026-10-07 local) · **Stage**: CONSTRUCTION — Build & Test, U6
Code: [`../u6-data-lifecycle/code/code-summary.md`](../u6-data-lifecycle/code/code-summary.md) ·
Plan: [`../plans/u6-code-generation-plan.md`](../plans/u6-code-generation-plan.md)

---

## 1. Status — ✅ U6 IS DEPLOYED AND ITS EXIT CRITERION (LOCAL HALF) IS MET

| | Result |
|---|---|
| Build | `docker compose build` **exit 0** (checked directly, not through a pipe) — Node **22.23** minor, **`npm ci`** |
| Suite | `npm run verify` green — **1401 tests** · typecheck · smoke · knip |
| Deployed | Live on the U6 image since **02:22 UTC**; redeployed at **02:26** with two UI fixes (§4). Schema **v7**, no migration |
| Recording gap | **~61 s** for the pre-deploy backup + deploy, **~10 s** for the redeploy; backfill reported **0 missed plays** both times |
| Exit criterion (U6) | ✅ **Met** — backup from the live app → restore into a second installation on this machine → it runs with identical counts |
| Exit criterion (cross-machine) | → **U9** (P-48): off-machine browsers are refused until NFR-29 is built |

## 2. Deployment steps, as performed (IN-U6)

| # | Step | Evidence |
|---|---|---|
| 1 | `spotify-now-playing:0.1.0` tagged **`u5-rollback`** | same image id `fa9f878363f2` |
| 2 | `docker compose down` → `db:backup --label before-u6` → `--verify-only` | `data/backup-before-u6-20261008T022125Z` — **1057 plays, 1297 decisions**, all **8 checks ✅** |
| 3 | `docker compose build` / `up -d` | exit 0 / healthy in ~6 s |
| 4 | `/api/health`, `/api/maintenance`, `/api/diagnostics` | UI 200 · `backup()` available · **4.4 MB of 256 MB (2%)** · 0 leftovers swept |
| 5 | Verification installation, then removal with the no-impact proof | §3 |
| 6 | BR-52 legacy cleanup | ✅ **Done 2026-10-08** with the user's confirmation: exactly the 10 `unverifiable` directories deleted after re-checking the set; sweep now **4 verified · 0 unverifiable · 1 CORRUPT**; `--self-test` still rejects the corrupt control. The in-app archive kept in the user's Downloads |

### Guards in the real container (localGuard + ingestGuard stacked)

| Request | Result |
|---|---|
| backup — no ingest header / no `Origin` / cross-site `Origin` | **403 / 403 / 403** |
| restore — DNS-rebinding `Host` | **403** |
| WebSocket handshake — local / cross-site | **101 / 403** — the 2026-09-05 surface, still guarded both ways |

### Rollback, verified LIVE (IN-U6-4)

U5's image (`u5-rollback`) was run against a **copy** of the pre-U6 backup with U6's directories planted in it —
`previous/`, a **ready** `restore-pending/`, and `.work/upload-x/`. It started on **schema v7**, served the UI
(**200**), did not restart, and **left all three untouched**. The copy then passed `integrity_check` with
**1057 plays**. ⚠️ Reading U5's code to conclude it ignores them would not have been this.

## 3. The U6 exit test — the verification installation

`npm run verify:up` → `spotify-now-playing-verify` on `:3011`, project **`spotify-verify`**, empty corpus.

| Check | Result |
|---|---|
| ⚠️ **The app starts with NO Spotify credentials** (Build & Test step 1) | ✅ healthy; backfill reports `incomplete: … missing … refreshToken` and carries on — degrades, never crashes |
| *Create backup* on the LIVE app, while it records | **200**, `spotify-backup-20261008T022355Z.tar.gz`, **1.93 MB** |
| Archive contents | **exactly** `manifest.json`, `history.db`, `rules.json` — no `secrets/`, no `state/`; manifest has **no hostname** |
| *Restore backup* into the copy → comparison | backup **1057** plays vs current **0**; rules **differs** (template vs the user's) |
| Wrong confirm word / `RESTORE` | **400** / **202** `{restarting: true}` |
| ⭐ **Restart time** (P-47 asked for it measured) | **3.8 s** from confirm to a new process answering (`restarts=1`) |
| Restored database | `integrity_check: ok`; **all 11 table counts identical to the manifest** |
| Automation in the restored copy | **off** — state file absent, executor not built |
| *Undo* × 2 | 1057 → **0** → **1057** — undo is its own inverse (BR-49.3) |
| *Create backup* from the copy (reverse direction) | **200**, 1.93 MB; the developer verifier says **VERIFIED RESTORABLE**, 1057 plays |
| Leftovers in the copy's `data/` | none — no `.work/` contents, no `restore-pending/` |

### UI, click-tested through the copy (Chrome)

Header **Settings · Rules** (Export and Diagnostics moved in) · Settings shows the last restore, both actions
with what each touches, the undo row with the previous history · the comparison panel, the three-line warning,
the typed word · **no console errors or warnings**.

### `npm run verify:down` — the no-impact proof

✅ *"The live deployment is unchanged — same container, start time, restart count, image and health as before the
install — no `*verify*` container, network or directory remains, and no tracked file changed."*

## 4. Defects found in Build & Test

| # | Defect | Found by | Fixed |
|---|---|---|---|
| 1 | ⚠️ **The disabled *Restore* button looked ENABLED** — solid green, identical to the pressable state; only its accessibility state said disabled. On the one destructive control in the app | Screenshot of the comparison panel | `#settings button[disabled]` — dimmed, greyscale, not-allowed cursor. Redeployed |
| 2 | The after-restore message said plays **"were re-imported from Spotify"** — untrue when the app cannot reach Spotify (the copy had no credentials) | Reading the restored copy's Settings | Now *"are re-imported … when the app can reach it"* |
| 3 | `db:backup` printed a hint (`node scripts/restore-history.mjs …`) that **no longer runs** since the verifier moved to `src/` | Running the pre-deploy backup | Hint is now `npm run db:restore -- <dir> --verify-only`; the usage block says `--import tsx` |

⚠️ **Defect 1 passed every test.** `maintenancePanel.test.ts` asserts the button's `disabled` *state* — which was
correct. Nothing could see that it *looked* enabled. A screenshot did.

## 5. ⚠️ An observation that is NOT U6's, recorded so it is not lost

The credential-less copy's status bar said **"Spotify: ok. The last poll succeeded."** and the card **PAUSED**.
With no valid token, *"nothing is playing"* and *"cannot ask Spotify"* rendered the same — **this project's own
trap: absent data reading as a fact.** It is pre-existing poll/indicator behaviour, untouched by U6, and matters
for U8's install routine (a mis-configured install would look healthy). Logged for triage; not fixed here.

## 6. What is NOT verified

| | Why |
|---|---|
| The cross-machine restore | **U9** (P-48) |
| An upload of a hostile archive **through the browser** | Covered by PBT-51/52/54 against the real parser and verifier; not repeated by hand |
| A restore under `npm start` (no supervisor) | The UI text path is unit-tested; not run live |

## 7. Traceability

| FR | Verified by |
|---|---|
| FR-57 Create backup | live backup while recording; archive verified |
| FR-58 Restore | restore into the copy; counts identical; wrong word refused |
| FR-59 Undo | undo × 2 |
| FR-60 / FR-61 | archive entry list; copy's automation off |
| FR-62 | no leftovers in the copy; `verify:down` proof |
| FR-63 | Settings click-test |
| FR-64 | guards in the real container (§2); PBT-51/52/57/58 |
