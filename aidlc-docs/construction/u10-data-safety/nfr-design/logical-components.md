# U10 Logical Components — Data Safety

**Unit**: U10 · **Date**: 2026-10-22 · Patterns: [`nfr-design-patterns.md`](nfr-design-patterns.md)
**Allocates**: **LC-69…LC-80** · **PBT-79…PBT-89**

The project's shape holds: a **pure decision module**, property-tested, inside a thin **impure shell**. Paths are
where each component is expected to live; Infrastructure Design and Code Generation may refine paths, not the split.

---

## Components

| ID | Component | Where | Kind | Patterns / rules |
|---|---|---|---|---|
| **LC-69** | **Lock decisions**: the verdict from two observations; whether a held lock is ours | `src/lock/lockDecision.ts` | ⚙️ pure | P-76 · BR-78.3, 78.5 |
| **LC-70** | **Writer lock**: acquire (exclusive create), watch, takeover under the mutex, heartbeat with self-check, release-if-ours; `kind` = `app` or `script:<name>`; outcome events for logging and *Status* | `src/lock/WriterLock.ts` | impure | P-76…P-79 · BR-78 |
| **LC-71** | **Startup sequence**: path (LC-77) → LC-70 → restore swap → open → LC-72 → kept backup → migrate → record version; failure at any step → display-only with the reason | `src/server.ts`, `src/history/SqliteHistoryRepository.ts` (open split from migrate), `src/history/migrations.ts` (migration 8) | impure | P-80 · BR-79, 78.9 |
| **LC-72** | **Backup decisions**: `backupDue`, `scheduledDue`, `enoughSpace`, `rotationDeletes`, `backupHealth` | `src/backup/keptBackupDecision.ts` | ⚙️ pure | P-80…P-84 · BR-79.1, 80.4, 81.1–81.2 |
| **LC-73** | **Kept-backup store**: free-space check, `createBackup` into `.work`, rename into `data/backups/<kind>/`, rotate; newest-of-each-kind for Settings and diagnostics; takes U6's busy lock | `src/backup/KeptBackupStore.ts` (beside U6's `onlineBackup.ts`, reusing it) | impure | P-81, P-82 · BR-80 |
| **LC-74** | **Backup scheduler**: 15-minute check plus one at startup, asking LC-72; replaces `SnapshotScheduler`'s CSV timer | `src/backup/BackupScheduler.ts`; `src/export/SnapshotScheduler.ts` retired | impure | P-83 · BR-81 |
| **LC-75** | **Status**: `status(sources)` (⚙️ pure) and the *Status* indicator; diagnostics' `warn` level and *Backups* step; one sentence per source shared by both | `src/ui/statusBar.ts`, `src/diagnostics.ts` | ⚙️ pure + wiring | P-84…P-86 · BR-81.2–81.3, 86.5 |
| **LC-76** | **Header and Settings UI**: *Diagnostics* header button (pop-up moved, ids kept); Settings → *Version* (version, update line, switch and its sentence); Settings → *Backup & restore* status; *Update* indicator | `public/index.html`, `public/app.js`, `public/styles.css` | UI | P-86 · BR-86 |
| **LC-77** | **Developer database path**: host run with no `HISTORY_DB_PATH` → `data-dev/history.db`; `.gitignore` and `.dockerignore` | `src/config.ts` | config | BR-84 |
| **LC-78** | **SemVer**: `compareSemVer` moved to `src/` and shared by the app, `update` and the release script; `decideUpdate`, `newestRelease`, the image-line rewrite, the release-URL acceptance | `src/version/semver.ts`, `src/appOnly/update.ts` | ⚙️ pure | BR-83.2–83.3, 85.5–85.6 |
| **LC-79** | **`update` command**: entrypoint dispatch, read `/work/compose.yaml`, LC-78, write temp-then-rename, print the next step | `scripts/docker-entrypoint.sh`, `src/appOnly/updateCli.ts` | impure | BR-83 |
| **LC-80** | **Update checker**: preference in `state/update-check.json`; timing with the one-hour rule; the bounded request; result for the snapshot; `PUT /api/update-check` | `src/update/UpdateChecker.ts`, `src/api.ts` | impure | P-87 · BR-85 |

**Release script** (`scripts/release.mjs`, BR-82): asks the running app (`POST /api/backups`), checks the file is
visible on the host, `--app-is-down` override. A change inside the existing script, not a component.

**Writing scripts** (`db:backup`, `db:restore`, `reclassify -- --apply`, `repair-*`): take LC-70 with
`kind = script:<name>`; the `docker ps` guard (`assertNobodyElseHoldsIt`) is removed (P-79).

## Guard tests (example-based, each seen to fail once)

| Guard | Positive control |
|---|---|
| A held lock refuses the app and **each** writing script (LC-70, P-79) | A test holds the lock; each script exits non-zero naming the holder; released, each proceeds |
| A lost lock stops writes (P-78) | Replace the lock's token under a running holder; its next write is refused and history goes unavailable |
| A failed before-change backup refuses the migration (P-80) | Inject a backup failure; the database's schema version and bytes are unchanged |
| A kept backup restores (BR-80.1) | A file from the store is fed to *Restore backup*'s upload path and accepted |
| The update request carries no contact address (P-87) | With a MusicBrainz contact configured, the captured request's headers do not contain it |
| `/releases/latest` is never requested (BR-85.3) | The captured URL is the list endpoint |
| Disabled means no request (BR-85.1) | Preference off: zero requests over a simulated day, including startup |
| ⚠️ Cross-mount lock, live | Re-run the plan's probe through the **real** container and a host `npm start` on a copy of the data folder (Infrastructure Design shapes it) |

## Property-based tests (NFR-20/21: seeds logged)

| ID | Property | Covers |
|---|---|---|
| **PBT-79** | LC-69: for any pair of observations, the verdict is *alive* iff the token is unchanged and the time moved, *stale* iff unchanged and not moved, *restart* iff the token changed. ⭐ Positive control: an unchanged token with an unchanged time is always *stale* | LC-69 · P-76 |
| **PBT-80** | `backupDue`: due iff a migration is pending **or** the last version is absent or differs from the running one; never due when neither holds (positive control) | LC-72 · BR-79.1 |
| **PBT-81** | `scheduledDue`: for any newest time and now, due iff none exists or now − newest ≥ interval; across any sequence of restarts within one interval, at most one backup is due | LC-72 · P-83 |
| **PBT-82** | `rotationDeletes`: for any file list and keep ≥ 1, deletes only names of that kind's pattern, never the newest `keep`, and leaves exactly `min(keep, n)` of the kind | LC-72 · BR-80.4 |
| **PBT-83** | `enoughSpace`: true iff free ≥ 2 × (db + wal) + 100 MB; monotone in free space | LC-72 · P-82 |
| **PBT-84** | `backupHealth`: never `ok` when no scheduled backup exists; `fail` whenever the last attempt failed or space was short; `ok` iff the newest is within two intervals and nothing failed | LC-72 · P-84 |
| **PBT-85** | `status(sources)`: the level is the worst of the sources (`fail` > `warn` > `ok`); any non-`ok` level's detail ends with *Check the Diagnostics page*; all-`ok` yields `ok` (positive control) | LC-75 · P-85 |
| **PBT-86** | `decideUpdate`: refuse iff own < current, same iff equal, rewrite iff own > current, by SemVer precedence | LC-78 · BR-83.2 |
| **PBT-87** | The image-line rewrite: for any compose text with exactly one matching line, the output differs from the input **only** in that line's version (every other byte, line ending and comment kept); zero or ≥ 2 matches → refusal | LC-78 · BR-83.1, 83.3 |
| **PBT-88** | `newestRelease`: never returns a draft or a non-`v<SemVer>` tag; returns a pre-release only when the running version is one; the result is ≥ every other candidate; *newer* iff strictly above the running version | LC-78 · BR-85.5 |
| **PBT-89** | The release-URL acceptance: true only for `https://github.com/kuhndj67/spotify-companion/releases/…`; false for look-alikes (other hosts, user-info, other paths) | LC-78 · BR-85.6 |

## What is not a component

- No retry loop to reopen history after a refusal: recovery is a restart (FD), and *Status* says so.
- No list of kept backups and no second restore path (FD Q5 = A).
- No change to *Create backup* (the download), *Export* or the local-access guard.
