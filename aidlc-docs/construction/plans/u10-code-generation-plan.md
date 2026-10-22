# Code Generation Plan — U10: Data Safety

**Date**: 2026-10-22 · **Stage**: CONSTRUCTION — Code Generation (Part 1, planning), Unit U10
**Status**: ✅ approved 2026-10-22 (owner). In progress on `u10-code-generation`. This plan is the single source of truth for U10's Code Generation.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield (modify in place; never duplicate a file)
**Inputs** (all approved 2026-10-22): FD BR-78…BR-87 · NFR P-76…P-87, LC-69…LC-81, PBT-79…PBT-90 · Infrastructure
IN-U10-1…9 · requirements FR-76…82 (FR-56/63/76/79/80 amended) · story **US-33**

---

## Unit context

| | |
|---|---|
| **Story** | US-33 (FR-76, 79, 80, 81, 82). FR-77, FR-78 are developer safety, no story |
| **Depends on** | U1 (history database), U6 (`createBackup`, the restore swap, the busy lock), U8 (release script, `:3011`), U9 (image entrypoint, `setup`) |
| **Owns** | migration **8** (`app_meta`); `data/history.db.lock`; `data/backups/`; `state/update-check.json`, `state/backup-reminder.json`; the `update` command |
| **Interfaces added** | `POST /api/backups` (release script only) · `PUT /api/update-check` · `PUT /api/backup-reminder` · WebSocket snapshot gains `status`, `updateCheck`, `backupHealth`, `backupReminder` |
| **Branch** | `u10-code-generation`, from `main` **after PR #22 (the designs) is merged**; one commit per step; PR to `main`, owner merges |

### ⚠️ What must not move

- `data/` is never written by a test or a step; every test uses a temporary folder. The live container keeps running
  on beta.8 throughout; nothing here deploys (deployment is Build & Test, IN-U10-8).
- *Create backup*'s archive format, *Restore backup* and the local-access guard are unchanged (U6, NFR-01…07).
- Diagnostics' ids and `data-testid`s survive the move to the header (P-86).

## Ordering principle

Pure decisions first, each with its property test and positive control; then the impure shells around them; then
wiring; then UI; then scripts, infrastructure files and documents. Every step ends with `npm run verify` green and its
own commit, so any step can be reviewed or reverted alone.

---

## Steps

### Step 1 — Shared SemVer *(LC-78; BR-83.2, 85.5)* — ✅ DONE · placed in `src/version.ts` beside `isSemVer` (not `src/version/semver.ts`: a folder beside `version.ts` invites confusion); importers point there, no re-export
- [x] Move `compareSemVer` from `scripts/lib/releaseDecision.ts` to `src/version/semver.ts`; `releaseDecision.ts`
      imports it (one copy). Existing `releaseDecision` tests stay green unchanged.

### Step 2 — Writer lock *(BR-78, P-76…P-79, LC-69, LC-70, PBT-79)* — ✅ DONE · verdicts `alive`/`stale`/`changed`/`gone` (the plan's *restart* split in two); heartbeat reads back **before** touching, so it never refreshes another holder's lock; positive control: a verdict mutated to judge by age fails 3 tests
- [x] `src/lock/lockDecision.ts` (⚙️ pure): verdict from two observations; is-ours.
- [x] `src/lock/WriterLock.ts`: acquire by exclusive create; watch for the stale window; takeover under the mutex
      with token re-check; 5 s heartbeat (`unref`) with self-check → `lost`; release-if-ours; injected clock, sleep
      and timings so tests run in milliseconds; one log line per event.
- [x] `test/lockDecision.property.test.ts` (PBT-79 ⭐). `test/writerLock.test.ts`: held → refused (positive control:
      released → acquired); stale → taken over; two takers → exactly one wins; foreign token → `lost`; release leaves
      a foreign lock alone.

### Step 3 — Migration 8 and open/migrate split *(BR-79.4, P-80, LC-71)* — ✅ DONE · ⚠️ deviation: the constructor keeps migrate-on-open as the **default** and takes `{ migrate: false }` (76 test/tool call sites unchanged; `server.ts` is the only opener of the live database, `startupRestorer` only mentions it). Positive control: ignoring the option fails the test
- [x] `src/history/migrations.ts`: migration **8**, `app_meta(key TEXT PRIMARY KEY, value TEXT)`.
- [x] `SqliteHistoryRepository`: the constructor opens only (with `{ migrate: false }`); `pendingMigrations()`, `migrate()`, `lastAppVersion()`,
      `recordAppVersion()`. Every existing caller (tests, `server.ts`) calls `migrate()` explicitly.
- [x] Tests: v7 → v8 on a fixture database; a v8 database opened by v7 code (the U4 rollback check) still opens.

### Step 4 — Backup decisions *(LC-72; PBT-80…84)* — ✅ DONE · ⚠️ the positive control **caught a weak property**: with "none written yet" mutated to `ok`, all tests still passed (the generator rarely produced *uptime < interval, nothing failed*). Strengthened with a targeted property and biased uptime; the mutation now fails 2 tests. Kept names sort by parsed stamp and suffix (`…Z-2` sorts before `…Z` by name). Health has an `off` level for `SNAPSHOTS_ENABLED=false`
- [x] `src/backup/keptBackupDecision.ts` (⚙️ pure): `backupDue`, `scheduledDue`, `enoughSpace`, `rotationDeletes`,
      `backupHealth`.
- [x] `test/keptBackupDecision.property.test.ts`: PBT-80…84, each with its positive control (PBT-84: no input with no
      backup yields `ok`).

### Step 5 — Kept-backup store *(BR-80, P-81, P-82, LC-73)* — ✅ DONE · `MaintenanceService.keepBackup` holds U6's busy lock (busy → 409); `createBackup` gains an optional `label` (default `in-app`, unchanged); same-second backups get `-2`. Positive control: a truncated archive is refused by *Restore backup* (2 tests fail)
- [x] `src/backup/KeptBackupStore.ts`: free-space check (`fs.statfs`), U6's `createBackup` into `.work`, rename into
      `backups/<kind>/`, rotate after arrival, newest-of-each-kind, U6's busy lock.
- [x] Tests: arrival is whole (no partial file after an injected failure); rotation never crosses kinds and never
      touches other files (a planted CSV and an unrelated file survive); short space → no file, reason in words.
      ⭐ **Positive control**: a kept backup is accepted by *Restore backup*'s upload path (BR-80.1).

### Step 6 — Scheduler and settings *(BR-81.1, 81.4, P-83, LC-74, IN-U10-3)* — ✅ DONE · ⚠️ sequencing: `SnapshotScheduler`'s removal and the `SNAPSHOT_DIR` log line move to **Step 7** (its wiring and diagnostics' *Snapshots* step still use it; removing it here would break this step's build). Positive control: scheduling from process start fails 4 of 5 tests
- [x] `src/backup/BackupScheduler.ts`: 15-minute check plus one at startup via `scheduledDue`.
- [x] *(done in Step 7)* `src/export/SnapshotScheduler.ts` **removed** (knip confirms nothing imports it); `src/config.ts`:
      `BEFORE_CHANGE_KEEP` (default 5), `SNAPSHOT_DIR` ignored with one log line, `SNAPSHOT_*` keep their meaning.
- [x] Tests: a restart loop within one interval takes at most one backup; a restart after the interval takes one.

### Step 7 — Startup sequence and `data-dev/` *(BR-78.9, BR-79, BR-84, LC-71, LC-77)* — ✅ DONE · also took from Step 6 `SnapshotScheduler`'s removal and the `SNAPSHOT_DIR` log line, from Step 8 diagnostics' `warn` level and *Backups* step, and from Step 14 the `data-dev/` ignores (each needed for this commit to build or to be safe). The before-change logic is `src/history/prepareHistory.ts` (testable; `server.ts` is not importable). ⚠️ A **lost** lock goes through `shutdown(…, { touchDatabase: false })` and **exits** without flushing or closing (closing checkpoints the WAL: a write); under Docker the restart is then refused and runs display-only. Pins in `maintenanceWiring.test.ts`. Positive control: migrating before the backup fails 2 tests. Not yet run as a process: the `:3011` rehearsal (IN-U10-8) is where startup is first observed
- [x] `src/config.ts`: host run with no `HISTORY_DB_PATH` → `data-dev/history.db`.
- [x] `src/server.ts`: path → lock → restore swap → open → `backupDue` → kept backup → migrate → record version;
      a refusal or failure at any step → display-only with the reason (the existing degraded path); `lost` stops
      writes; shutdown releases the lock.
- [x] Tests: failed before-change backup leaves the database's bytes and schema unchanged ⭐; version change triggers
      a backup, same version does not; the lock is taken before the restore swap.

### Step 8 — Status, diagnostics, reminder *(BR-81.2–81.3, 86.5, 87, P-84, P-85, LC-75, LC-81; PBT-85, PBT-90)* — ✅ DONE · Status uses the existing glyph set (`●` `◐` `✕`), not the FD sketch's `✓`/`⚠`: one geometric set keeps the row from jumping. Sources: history off (lock, failed before-change backup, open failure), backup health, the reminder. The *Update* indicator moves to Step 9 with its checker; the completed-download hook to Step 10 with the route. Positive control: Status taking the first source's level fails PBT-85
- [x] `src/diagnostics.ts`: step type gains `warn` (a run with warnings is not failed); *Snapshots* → *Backups*;
      new *Copy elsewhere* step.
- [x] `src/ui/statusBar.ts`: `status(sources)` and the *Status* indicator; `update` indicator; one sentence per source
      shared with diagnostics.
- [x] `src/backup/backupReminder.ts`: `reminderLevel` (⚙️), `state/backup-reminder.json`, the completed-download hook.
- [x] Tests: PBT-85, PBT-90; an aborted download does not count, a completed one does ⭐.

### Step 9 — Update checker *(BR-85, P-87, LC-80; PBT-88, PBT-89)* — ✅ DONE · pure choice in `src/update/releaseChoice.ts`; the *Update* indicator (`↑`, only when newer) wired here with its checker. Positive controls: `/releases/latest` fails the URL test; a stable install hearing of pre-releases fails PBT-88
- [x] `src/update/UpdateChecker.ts`: preference (absent = on), timing with the one-hour rule, the bounded request
      (10 s, 1 MB, redirects within `api.github.com`, own User-Agent), `newestRelease`, URL acceptance, silent failure.
- [x] Tests: PBT-88, PBT-89; ⭐ with a MusicBrainz contact configured, the captured request does not contain it; the
      URL is the list endpoint, never `/releases/latest`; off → zero requests over a simulated day; a failure keeps
      the last good answer. No test calls the real GitHub.

### Step 10 — API *(frontend-components §5)* — ✅ DONE · ⚠️ adapted: the two switches are plain `POST` (the automation switch's precedent; `localGuard` refuses cross-site), not `PUT`; Settings reads one `GET /api/settings/status` instead of new WebSocket fields (the status bar's *Status* and *Update* already ride the snapshot). `POST /api/backups` is behind `ingestGuard`. Found: Settings already shows the version (U8, `#app-version`), so Step 11 puts the notice beside THAT line. Positive control: firing the reminder hook at the download's start fails the never-finishing-download test
- [x] `src/api.ts`: `POST /api/backups { reason }` (`409` when busy), `PUT /api/update-check { enabled }`,
      `PUT /api/backup-reminder { enabled }`; snapshot fields `status`, `updateCheck`, `backupHealth`,
      `backupReminder`; *Create backup*'s response reports completion to the reminder.
- [x] Tests: each route's success and refusal; cross-site `Origin` refused (inherited guard, checked once per route).

### Step 11 — Frontend *(BR-86, frontend-components §1–§6, LC-76)* — ✅ DONE · checked by running the BUILT app isolated (scratch data, port 3027, Spotify credentials absent) in light and dark: header Settings · Diagnostics · Rules (grouped right); Status `●`/`◐` with its pop-up; Settings → Version (U8's line kept), switch and sentence; Backup & restore status and reminder switch; diagnostics *Backups* ✓ and *Copy elsewhere* `◐` warn. **Running it found a real defect** (fresh installs refused to record; fixed in its own commit, BR-79.1 amended) and observed live: stale-lock takeover after a crash (30 s watch), the scheduled backup at startup, one real anonymous GitHub request answering *current* (`v1.0.0-beta.8`, page accepted), and a completed download clearing the reminder. Not seen: the *newer* state (no newer release exists; covered by tests)
- [x] `public/index.html`, `app.js`, `styles.css`: header **Settings · Diagnostics · Rules** (pop-up moved, ids kept);
      *Status* light; *Update* indicator; Settings → *Version* (line, update notice, switch and sentence); *Backup &
      restore* status lines and reminder switch.
- [x] Checked in the browser on the built app, **light and dark** (screenshots in the code summary).

### Step 12 — `update` command *(BR-83, LC-78, LC-79; PBT-86, PBT-87)* — ✅ DONE · registered as an entry point in `knip.jsonc` and the orphan allow-list (as `setupCli.ts`). CRLF files keep their endings. Positive control: a rewrite that drops the rest of the line fails PBT-87. Not yet run inside the image (Build & Test)
- [x] `src/appOnly/update.ts` (⚙️ `decideUpdate`, the one-line rewrite), `src/appOnly/updateCli.ts`;
      `scripts/docker-entrypoint.sh` dispatches `update`.
- [x] Tests: PBT-86, PBT-87 (every other byte kept; 0 or ≥ 2 lines → refusal); older → refuse ⭐.

### Step 13 — Scripts *(BR-78.7, BR-82, P-79, IN-U10-7)* — ✅ DONE · `holdWriterLock` replaces `assertNobodyElseHoldsIt` in `backup-history.mjs` (one import point kept). ⚠️ Found: `repair-backfill-timestamps.mjs` writes with `--apply` and had **no guard at all**; it now holds the lock and runs under `tsx` (smoke caught the loader change). Spawned-script refusals would cost 30 s each, so the guard test is in-process plus a structural check per script. ⚠️ Transition: the deployed beta.8 container does not take the lock; until beta.9 is live, "container down first" still applies. Positive control: removing one script's lock call fails the structural test
- [x] `db:backup`, `db:restore`, `reclassify`, `repair-*` take `WriterLock` (`script:<name>`); `assertNobodyElseHoldsIt`
      and `--i-have-stopped-the-container` removed.
- [x] `scripts/release.mjs`: `POST /api/backups` before build, `409` retry ≤ 60 s, file visible on the host;
      `--app-is-down`.
- [x] Tests: a held lock refuses **each** writing script ⭐ (released → proceeds).

### Step 14 — Infrastructure files *(IN-U10-3…5)* — ✅ DONE · ignores were done in Step 7
- [x] `compose.yaml`, `compose.app.yaml`: `SNAPSHOT_DIR` removed; `compose.verify.yaml` unchanged.
- [x] `scripts/docker-entrypoint.sh`: `backups/` created and chowned instead of `SNAPSHOT_DIR`.
- [x] `.gitignore`, `.dockerignore`: `data-dev/`; the `data/` note rewritten (backups share its deletion event).

### Step 15 — Documents
- [ ] `docs/INSTALL-APP.md`, `docs/INSTALL-DEV.md`: *Backups* (automatic, where, ⚠️ copy `data/backups/` elsewhere,
      the weekly reminder and when to turn it off), *Updating* (`update`), the update check and its switch;
      INSTALL-DEV: `data-dev/`.
- [ ] `CONTRIBUTING.md` and `CLAUDE.md`: the lock replaces "container down first"; `data-dev/`; no hand-written counts
      (`test/docs.test.ts`).
- [ ] `construction/u10-data-safety/code/code-summary.md`: what changed per step, deviations, screenshots.

### Step 16 — Close
- [ ] `npm run verify` green; ⚠️ the image built as `spotify-companion:candidate` (NOT `docker compose build`, which would overwrite the live `1.0.0-beta.8` tag, the rollback target), exit code checked directly; HANDOFF, state, audit; PR opened.

---

## Story traceability

| US-33 acceptance | Steps |
|---|---|
| Backup before an update or schema change; refuse on failure | 3, 5, 7 |
| Scheduled backups, each restorable | 4, 5, 6 |
| Settings tells the truth; warns when stopped | 8, 10, 11 |
| Reminder to download weekly, unless off | 8, 10, 11 |
| One-command update, never older | 1, 12 |
| Told of newer versions; switch and sentence | 1, 9, 10, 11 |
| *(no story)* one writer; developer data apart | 2, 7, 13 |
