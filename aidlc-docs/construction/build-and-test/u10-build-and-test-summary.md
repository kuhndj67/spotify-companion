# U10 Build & Test — Data Safety

**Started**: 2026-10-22 (PR #23, Code Generation, merged by the owner) · **Status**: ▶ IN PROGRESS — ✅ the `:3011`
rehearsal on a copy of the owner's real history PASSED (IN-U10-8 steps 1–4); the release (version bump to
`1.0.0-beta.9`, `npm run release -- --apply`, tag, publish) remains, and is the owner's · Branch `u10-build-and-test`

---

## 1. CI — ✅

PR #23 merged to `main` with every required check green (`5b3d640`).

## 2. Rehearsal on `:3011` with the owner's real history (IN-U10-8) — ✅ PASSED (2026-10-22, 23:00Z → 23:06Z)

The owner took **Settings → Create backup** on the live app (`spotify-backup-20261022T230017Z.tar.gz`, 3.0 MB).
`npm run verify:up -- --candidate` built the merged tree as `spotify-companion:candidate` and ran it on `:3011` with
its own `verify-install/` folders and a placeholder Spotify config. The live deployment was never touched (§5).

| # | Check | Result |
|---|---|---|
| 1 | **Fresh install in the container** | ✅ Lock acquired on `/data` (the real Rancher mount, `D:`); empty database migrated 1→8; **no** backup attempted (the fixed fresh-install defect, BR-79.1); the entrypoint created `backups/` |
| 2 | **The owner's backup restores** through `:3011`'s own *Restore backup* | ✅ Verified as an upload: **1,594 plays, 1,853 decisions, schema v7** (taken 23:00:17Z) |
| 3 | **The startup sequence on real data** | ✅ After the confirm: orderly shutdown *released* the lock → restart *acquired* it → restore swap applied (1,594 plays) → **before-change backup kept** (`migration 7→8 · first run with version tracking`, 2.9 MB, 1.6 s) → migrated 8. In that order, from the log |
| 4 | **The before-change backup itself restores** | ✅ Uploaded to *Restore backup*: accepted; **1,594 plays, 1,853 decisions, v7**, while the live database read **1,594 / 1,853, v8**. Cancelled; nothing changed |
| 5 | **Lock, host refused by the container** (the real mount, host → container direction) | ✅ `db:backup` on the host against `verify-install/data/history.db`: watched **31 s**, **REFUSED**, naming `app (pid 1 on <container id>)`, *heartbeat is moving*. Exit 2; nothing written |
| 6 | **Lock, takeover after a crash** | ✅ `docker kill` (Docker treats it as a manual stop: no restart; the lock stayed). A host run on the same database watched the frozen heartbeat **30 s**, then took over |
| 7 | **Lock, container refused by the host** (container → host direction) | ✅ `docker start` while the host held it: watched 30 s, **REFUSED**, naming the host process; *History: DISABLED*, display-only |
| 8 | **What the user sees** while refused | ✅ The WebSocket status: **Status `fail` ✕** — *"Recording is off: the database is in use by app (…), whose heartbeat is moving. Check the Diagnostics page."*; Recording `fail`, *"plays are NOT being saved"* |

Observed earlier in Code Generation (Step 11 and 16, the built app and the image): the Status light, Settings and
diagnostics in light and dark; one real request to GitHub's release list answering *current*; a completed download
clearing the reminder; the image's `update` rewriting from beta.7, doing nothing at beta.8, refusing from beta.9.

## 3. Not covered by the rehearsal

- **The *newer version* display**: no newer release exists until beta.9 is published. After the release, an install
  still on beta.8 cannot show it (beta.8 has no checker); the first real *newer* notice will be beta.9 seeing beta.10.
  Covered by tests (PBT-88, the checker's tests).
- **`npm run release`'s backup request** (BR-82): exercised by the release itself, next.

## 4. Release — ⏳ the owner's

Version bump to `1.0.0-beta.9` (`package.json` and its checked copies) on branch `release-1.0.0-beta.9`, which also
carries PR #25's fixes (poll backoff, host credentials isolation, lock folder) → PR → merge → owner's backup
(`npm run db:backup -- --label before-beta9`, safe with the container down) → **`npm run release -- --apply
--app-is-down`**: the live container is stopped on purpose since the 2026-10-23 rate-limit incident, so the release's
own backup request cannot run; the new container backs up before its first run and migrates the live database 7→8 →
tag push → CI publishes → GitHub Release with notes.

⚠️ Until beta.9 is live, the running container does not take the writer lock: `docker compose down` before any
`db:*` script.

## 5. The live deployment — untouched ✅

`npm run verify:down`: *"The live deployment is unchanged — same container, start time, restart count, image and
health as before the install — no \*verify\* container, network or directory remains, and no tracked file changed."*
`spotify-companion:1.0.0-beta.8`, healthy throughout.
