# U10 — Data Safety — Code Summary

**Branch**: `u10-code-generation` · **Plan**: [`u10-code-generation-plan.md`](../../plans/u10-code-generation-plan.md)
(approved 2026-10-22) · one commit per step, `npm run verify` green after each.

## What was built, by step

| Step | What | Where |
|---|---|---|
| 1 | One SemVer comparison for the app, `update` and the release script | `src/version.ts` |
| 2 | The writer lock: exclusive create, heartbeat watched for a stale window, takeover under a mutex, self-check, release-if-ours | `src/lock/` |
| 3 | Migration 8 (`app_meta`); the repository can open without migrating | `src/history/migrations.ts`, `SqliteHistoryRepository.ts` |
| 4 | Pure backup decisions (due, scheduled due, free space, rotation, health) | `src/backup/keptBackupDecision.ts` |
| 5 | Kept-backup store in `data/backups/{scheduled,before-change}/`; `MaintenanceService.keepBackup` | `src/backup/KeptBackupStore.ts` |
| 6 | Scheduler from the newest backup on disk | `src/backup/BackupScheduler.ts` |
| 7 | Startup: lock → restore swap → open → before-change backup → migrate → record version; `data-dev/` for host runs; `SnapshotScheduler` removed | `src/server.ts`, `src/history/prepareHistory.ts`, `src/config.ts` |
| 8 | Status light; diagnostics `warn`, *Backups*, *Copy elsewhere*; the weekly download reminder | `src/ui/statusBar.ts`, `src/diagnostics.ts`, `src/backup/backupReminder.ts` |
| 9 | Update checker and the *Update* indicator | `src/update/` |
| 10 | `POST /api/backups`, `GET /api/settings/status`, two switches, the completed-download hook | `src/api.ts` |
| 11 | Header Settings · Diagnostics · Rules; Settings → Version; backup status and reminder switch | `public/` |
| 12 | The image's `update` command | `src/appOnly/update.ts`, `updateCli.ts`, `scripts/docker-entrypoint.sh` |
| 13 | Writing scripts hold the lock; `npm run release` backs up first | `scripts/backup-history.mjs` (`holdWriterLock`), the writers, `scripts/release.mjs` |
| 14 | `SNAPSHOT_DIR` retired; the entrypoint creates `backups/` | `compose.yaml`, `compose.app.yaml`, `scripts/docker-entrypoint.sh` |
| 15 | INSTALL-APP and INSTALL-DEV *Backups* and *Updating*; CONTRIBUTING, CLAUDE.md, ARCHITECTURE | `docs/`, root |

## Defects found by the work itself

- 🔴 **A fresh install would never have recorded** (found running the built app on an empty data folder): migration
  0→8 made a before-change backup due, and a backup of an empty database does not verify. Schema 0 now means
  nothing to protect; BR-79.1 amended. Every unit test had started from an existing v7 database.
- **A weak property** (Step 4): with *none written yet* mutated to `ok`, every test still passed. A targeted property
  now catches it.
- **`repair-backfill-timestamps.mjs` wrote with no guard at all** (Step 13); it now holds the lock.
- **`docker compose build` in the plan would have overwritten the live `1.0.0-beta.8` tag** (the rollback target);
  the image is built as `spotify-companion:candidate` instead.

## Deviations from the plan and designs (each in the plan's step heading)

- `compareSemVer` lives in `src/version.ts` beside `isSemVer`, not `src/version/semver.ts`.
- The repository keeps migrate-on-open as the default and takes `{ migrate: false }` (76 call sites unchanged).
- The lock verdict has four values (`alive`, `stale`, `changed`, `gone`), not three.
- A **lost** lock exits through `shutdown(…, { touchDatabase: false })` without flushing or closing (closing
  checkpoints the WAL, which is a write); under Docker the restart is then refused and runs display-only.
- The two switches are `POST` (the automation switch's precedent), not `PUT`; Settings reads one
  `GET /api/settings/status` rather than new WebSocket fields.
- The Status light uses the existing glyphs (`●` `◐` `✕`), not the FD sketch's `✓`/`⚠`.
- Settings already showed the version (U8); the notice sits beside that line in a new *Version* section.
- The header buttons are grouped at the right (with three, `space-between` spread them across the card).

## Verified, and how

- **Every guard was seen to fail**: each step mutated its rule (judge the lock by age, migrate before the backup,
  *none written* as `ok`, schedule from process start, truncate the archive, Status from the first source, hook at
  the download's start, `/releases/latest`, stable install hearing of pre-releases, rewrite dropping the line's tail,
  a script without its lock call) and watched the tests fail.
- **The built app, run isolated** (scratch data, port 3027, no Spotify credentials), light and dark: stale-lock
  takeover after a real crash (30 s watch); a fresh install migrating 1→8 and recording; the scheduled backup at
  startup; one real anonymous request to GitHub's release list answering *current* (`v1.0.0-beta.8`, page URL
  accepted); a completed download clearing the reminder; every new Settings and status-bar element.

## Not yet verified (Build & Test, IN-U10-8)

- Startup, migration 8 and the before-change backup on a **copy of the owner's real history**, inside the container.
- The lock across the real bind mount between the container and a host run on `D:` (the FD probe used a scratch
  folder on `C:`).
- `update` and the release backup inside and against the real image.
- The *newer version* display (no newer release exists yet; covered by tests).
- ⚠️ **Transition**: the deployed `1.0.0-beta.8` container does not take the lock. Until `1.0.0-beta.9` is live,
  "container down first" still applies to the `db:*` scripts.
