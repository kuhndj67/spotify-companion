# U10 Functional Design Plan — Data Safety

**Date**: 2026-10-21 · **Stage**: CONSTRUCTION — Functional Design, Unit **U10** (Phase 5)
**Status**: Q1–Q6 **OPEN**.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: `unit-of-work.md` §U10 · requirements **FR-76…81** · Requirements Questions 29–36 · U6 as built (in-app
backup, the one writer, restore at startup) · U8 (release script) · U9 (the *App only* image and its `setup`)

> **The scope is one promise**: a user's listening history survives every update, and nobody (a developer, a second
> copy, a restart loop) can lose it by accident. FR-81 rides along: it tells a user that an update exists. The probes
> below settle most of the mechanics. What is left is where the requirements, written before these measurements, meet
> how the app actually stores backups and reaches itself.

---

## 1. Unit context

| | |
|---|---|
| **Phase** | 5 — build order U6 → U7 → U8 → U9 → **U10** → U11 → U12 |
| **Settled already** | FR-76…80 (Q29–33, all A) · FR-81 (Q34 = A, Q35 = B, Q36 = A) · no sample database (owner, 2026-10-18) |
| **Gates** | **U11** — the NAS is the second running copy where these risks become real |
| **Not U10's** | The NAS's CPU architecture (U11, `unit-of-work.md`) · issues as backlog (NFR-35, U12) |
| **Stories** | None yet — Q6 |

---

## 2. Facts measured for this plan — 2026-10-21

The live deployment (`spotify-companion:1.0.0-beta.8`, healthy) was only read: two GET requests to it, no writes.
Lock probes ran in a throwaway container on a scratch folder, never on `data/`.

| | |
|---|---|
| 🔴 **The scheduled "snapshots" cannot be restored** | `SnapshotScheduler` (`src/export/SnapshotScheduler.ts`) writes a **CSV export**, one flattened row per play (`data/snapshots/…2026-10-03….csv`: header *total_plays: 879*). It holds **no** `decision_log`, `skip_attempt`, observation trails or rules, and *Restore backup* accepts only the `.tar.gz` archive. So FR-80, written as "snapshots run", would restore nothing if it were built as worded — Q2 |
| 🔴 **No backup is ever kept on disk** | *Create backup* (`MaintenanceService.backup` → `createBackup`, `src/maintenance/onlineBackup.ts`) builds the verified archive in `data/.work/`, **streams it to the browser, and deletes it**. FR-76's "a bounded number kept" therefore needs a new place for backups to live — Q2 |
| **Migration runs inside the repository constructor** | `new SqliteHistoryRepository(path)` opens the database and calls `migrate()` at once (`src/history/SqliteHistoryRepository.ts:203`). FR-76(a) needs that split: open → *is a migration pending?* → back up → migrate. `createBackup` already takes the copy through the app's own connection, so the backup can use the same connection **before** migrating, with no second writer |
| ⚠️ **A throwaway container cannot reach the app by its name** | From `docker run --rm … spotify-companion:1.0.0-beta.8`, `GET http://host.docker.internal:3010/api/health` → **`403 Invalid Host or Origin`** (the Host-header check). The same request from the host → `200`. This is what FR-79's `update` would face when it "asks the running app for a backup" — Q1 |
| ⚠️ **…but it can with a loopback Host header** | The same request with `Host: localhost:3010` → **`200`** (and `/` → `200`, 23,009 bytes). Not a defect: the container deployment turns the peer-address check off on purpose (`TRUST_PUBLISHED_PORT`, chosen 2026-09-05, `src/localGuard.ts:89`), and the `127.0.0.1` publish is the boundary. That boundary admits **any process on this machine, containers included**, which `localGuard.ts` calls *host-local processes*. Recorded so nobody rediscovers it as a breach. **Not probed**: whether a Linux Docker host (the NAS, U11) lets a container reach a `127.0.0.1`-published port at all; usually it does not |
| ✅ **A lock file works across the Rancher bind mount** | Probed both directions with `open(…, 'wx')` (exclusive create): container holds → host gets **`EEXIST`**; host holds → container gets **`EEXIST`** (the guard *seen to fail*). The holder's content is readable from the other side; a 1 s `utimes` heartbeat is visible across the mount; the two clocks agreed to within 1 s (age read 431 ms and 711 ms). Stale takeover by `unlink` + `wx` works, but ⚠️ two takers at once can race: the business rules must close that (BR) |
| **What else opens `history.db`** | `src/config.ts:113` (`HISTORY_DB_PATH` or `data/history.db`) and **eight** `scripts/` entry points with the same default. The writers (`restore-history`, `reclassify-unobserved-tails`, `repair-*`) and `backup-history` guard with **`docker ps`** (`scripts/backup-history.mjs:81`), which is blind to a host `npm start` and to another machine — the U6 shape FR-77 exists to fix — Q3, Q4 |
| **Where a switch can live** | Runtime-written state lives in `state/` (`state/automation-state.json`, the kill switch). FR-81's on/off switch goes beside it: not `data/` (backed up and restored with the history), not `config/` (written only by `RulesWriter`) |
| ⚠️ **The MusicBrainz User-Agent carries the user's contact address** | NFR-14 (`src/config.ts:215`). FR-81's request to GitHub must build **its own** User-Agent (app name and version only); reusing the MusicBrainz one would send the address to GitHub. A rule with a test that fails if it leaks (BR) |
| Sizes | `history.db` 6.9 MB; four CSV snapshots 1.2 MB in all. A verified archive is compressed, so keeping about twenty is in the tens of MB |

---

## 3. Questions

### Q1 — How FR-79's `update` gets its backup (the `403` above)

FR-79 says `update` "asks the running app for a backup". It runs in its own container, which reaches the app only by
sending a Host header that claims to be `localhost`, and probably not at all on Linux.

| | Option |
|---|---|
| **A** | ⭐ **The new version backs up on its first start.** Generalise FR-76(a): at startup, before migrating **and** whenever the database was last opened by a **different app version**, the app takes a kept backup (Q2) through its own connection, and refuses to migrate or record if that fails. `update` then only rewrites the image line of `compose.yaml` and prints `docker compose up -d`. No cross-container call; works on any Docker host. FR-76(b), the release script's backup from the **running** app, is unchanged (the host reaches the app normally). ⚠️ Rewords FR-79: *"asks the running app for a backup"* becomes *"the updated app backs up before its first run"*. The old data is untouched until then, so the guarantee is the same |
| **B** | **`update` calls the running app** through `host.docker.internal` with a `localhost` Host header. Works on this machine (measured); expected to fail on Linux (not probed); and it relies on a request deliberately sending a header the guard exists to judge |
| **C** | **`update` requires the app stopped**, proves it with FR-77's lock, and takes the backup itself through the folder's `data/` mount. Works anywhere; one more step for the user (stop, update, start) |

[Answer]:

---

### Q2 — What a kept backup is, and what FR-80's scheduled snapshot becomes

| | Option |
|---|---|
| **A** | ⭐ **One kind of backup: the verified archive.** Every automatic backup (scheduled, FR-80; before a change, FR-76/Q1) is the **same archive *Create backup* downloads**, so *Restore backup* accepts any of them, kept in **`data/backups/`**. Each kind rotates **separately**, so daily backups can never push out a before-change one: **14 scheduled** (today's `SNAPSHOT_KEEP`) and **5 before-change**, both configurable. The CSV timer is **retired**; *Export* (CSV, on demand) stays. FR-56's wording moves to the archive. The existing CSV files are left where they are, never deleted |
| **B** | **Both**: the CSV timer is fixed as FR-80 says, **and** before-change archives are kept. Two folders, two schedules; the daily one still cannot be restored |
| **C** | **FR-80 as worded**: fix the CSV timer and its diagnostics only. Before-change archives are kept; no scheduled restorable backup |

[Answer]:

---

### Q3 — Which processes take FR-77's lock

| | Option |
|---|---|
| **A** | ⭐ **Every process that writes `history.db`**: the app (container or host) and the writing scripts (`db:restore`, `reclassify -- --apply`, the `repair-*` scripts, `db:backup`). The lock **replaces** their `docker ps` guard, which cannot see a host run or another machine. Read-only scripts (`hypothesis-gate`, `measure-confound`, `build-reporting-db`, `db:verify-backups`) take no lock |
| **B** | **The app only.** Scripts keep `docker ps`, so a script run beside a host `npm start` stays unguarded |

[Answer]:

---

### Q4 — How far FR-78's `data-dev/` default reaches

| | Option |
|---|---|
| **A** | ⭐ **`npm start` only** (FR-78 as worded). Scripts keep `data/history.db`: they are deliberate owner tools that act on the real history (e.g. `db:backup` with the container down), and FR-77's lock (Q3) now refuses them while anything holds the database |
| **B** | **Every host entry point** defaults to `data-dev/`; acting on `data/history.db` always needs `HISTORY_DB_PATH` set on purpose. Safest default; every owner command in CLAUDE.md and CONTRIBUTING gains a variable |

[Answer]:

---

### Q5 — Do kept backups appear in Settings?

| | Option |
|---|---|
| **A** | ⭐ **Status, not a manager.** Settings shows the newest kept backup of each kind, its age and the folder path (`data/backups/`); diagnostics warns and fails as FR-80 says. Restoring stays *Restore backup* (choose the file from that folder). No new restore path |
| **B** | **A list in Settings** with *Download* and *Restore* beside each kept backup. Easier for an *App only* user; a second restore entry point to design and test |

[Answer]:

---

### Q6 — Does U10 add a user story?

| | Option |
|---|---|
| **A** | ⭐ **One story, US-33**: *"As someone running the app (P1), an update never loses my listening history, and the app tells me when a newer version exists."* Acceptance = FR-76, FR-79, FR-80, FR-81. FR-77 and FR-78 are developer safety and get no story |
| **B** | No story: U10 is tracked by FR-76…81 only |

[Answer]:

---

## 4. Plan — after the answers

- [ ] Collect answers; ask follow-ups for anything ambiguous (rule Step 5). Amend FR-79/FR-56/FR-80 wording if Q1/Q2 change them (`requirements.md`, `audit.md`)
- [ ] `construction/u10-data-safety/functional-design/business-logic-model.md`: startup order (lock → restore swap → backup if needed → migrate), the kept-backup store and its rotations, `update`, the release backup, the update check
- [ ] `…/functional-design/business-rules.md`: BR-78… (lock acquisition, heartbeat, stale takeover without a race, the holder losing its lock; backup-before-change; retention per kind; `data-dev/`; `update` refusals; snapshot diagnostics; the update check's version comparison, its own User-Agent, silence on failure, the opt-out switch)
- [ ] `…/functional-design/domain-entities.md`: lock record, kept backup (kind, version, time), update-check result, update preference
- [ ] `…/functional-design/frontend-components.md`: Settings (version line and update notice, the opt-out switch and its sentence, kept-backup status), the status-bar update indicator (light and dark; colour never the only channel)
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md` updated; completion message; owner approval
