# Business Logic Model — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Functional Design, U6
Rules: [`business-rules.md`](business-rules.md) (BR-44…BR-52) · Entities: [`domain-entities.md`](domain-entities.md)

Technology-agnostic where it can be; names below are logical, not final module names — those are
allocated in NFR Design (LC-\*) as in every earlier unit.

---

## 1. The shape, and why it needs no guard

```
                 ┌──────────── the ONE writer (the app process) ────────────┐
 Create backup   │  live connection ──backup()──▶ .work/x/history.db         │──▶ verify ──▶ tar.gz ──▶ download
                 │                                                           │                         (then .work/x removed)
 Restore backup  │  upload ──▶ secure ingest ──▶ .work/y/ ──▶ verify ──▶ confirm ──▶ restore-pending/ + ready
                 │                                                           │                         ──▶ exit(0)
                 └───────────────────────────────────────────────────────────┘
                                         Docker restarts the container
                 ┌──────────── startup, BEFORE the database is opened ───────┐
                 │  restore-pending/ready?  ──▶ re-verify ──▶ current → previous/ ──▶ pending → history.db
                 │  sweep .work/                                             │
                 │  open + migrate + integrity_check ──▶ normal startup       │
                 └───────────────────────────────────────────────────────────┘
```

⚠️ **Every write to `history.db` is made by the process that owns it, at a moment it is the only thing
touching it.** The backup reads through the app's own connection; the swap happens before any connection
exists. That is why BR-44…BR-48 contain no writer-guard: the Q1 cross-machine problem is not solved, it is
**made impossible**.

---

## 2. Create backup (FR-57)

1. `POST /api/maintenance/backup` → acquire the maintenance lock (BR-51.3), else `409`.
2. `integrity_check` the **live** database (BR-44.5). Fail → refuse with the result.
3. `mkdtemp data/.work/` (BR-50.1). `backup(liveConnection, work/history.db)` (BR-44.1).
4. Build the manifest from the **copy**, not the live DB (counts, max ids, schema version, sha256)
   (BR-44.4). Copy `config/rules.json` into the work dir if it exists (BR-45.5).
5. Run the **shared verifier** against the copy + manifest (BR-44.3). Not `verified` → refuse, show verdict.
6. Stream `tar.gz` of exactly the allowlisted entries (BR-45.2) as the response body (BR-44.6).
7. `finally`: remove the work dir; release the lock (BR-50.2).

⚠️ The manifest is built from the **copy** because the live database keeps changing during the copy; a
manifest built from the live DB would mismatch its own backup on a busy evening.

---

## 3. Restore backup (FR-58)

### 3a. Ingest and verify — nothing outside `.work/` changes

1. `POST /api/maintenance/restore/upload` → BR-46.1–46.4 transport checks; maintenance lock.
2. Stream the body into `data/.work/<r>/upload` with the size cap enforced as bytes arrive (BR-46.4).
3. Magic bytes = gzip (BR-46.11). Extract with BR-46.6–46.10 enforced **entry by entry**; any violation
   refuses the whole archive.
4. Manifest `formatVersion` known (BR-45.6); `history.db` magic bytes = SQLite.
5. Verify (BR-47): read-only + `trusted_schema=OFF` → `integrity_check` → manifest match → schema allowlist
   (no triggers/views; only known table/index names) → schema version ≤ supported.
6. Respond with a **staging token** for this work dir plus the comparison (BR-47.6): backup vs current —
   taken at, plays, decisions, schema version; and *rules: none / identical / differs*.

The lock is **released** after 3a; the work dir is kept for a short window (**10 minutes**) awaiting
confirmation, then swept. Abandoning the dialog therefore leaves nothing behind.

### 3b. Confirm and stage

7. `POST /api/maintenance/restore/confirm` with the token and the typed word `RESTORE` (BR-48.2).
   Re-acquire the lock; the token must name an existing, verified work dir.
8. Move `work/history.db` + `manifest.json` → `data/restore-pending/`; write `ready` **last** (BR-48.3).
   Remove the work dir (including the archive's `rules.json` — BR-48.7).
9. Respond `202 { restarting: true }`; broadcast a *restarting* status over the WebSocket; then close
   cleanly (stop timers, close the DB) and `exit(0)` (BR-48.4).
10. The UI shows *Restarting…* and reconnects as it already does after any restart. Under `npm start` it
    shows *Restart the app to finish the restore* instead.

---

## 4. Startup: apply a pending restore (BR-48.5–48.6)

Runs in `server.ts`'s startup, **before** `new SqliteHistoryRepository(...)`.

```
if restore-pending/ready exists:
    verify(restore-pending/history.db)                          # BR-47 again — the file sat on disk
      fail → remove restore-pending/, record failure, continue on the CURRENT db
    move history.db{,-wal,-shm} → previous/   (replacing previous/)  # BR-49.1
    move restore-pending/history.db → history.db
      fail → move previous/ back, record failure, continue           # BR-48.6
    remove restore-pending/
    record success (from manifest: takenAt, plays) for Settings + Diagnostics
sweep: remove data/.work/*, and restore-pending/ without ready    # BR-50.4
open + migrate + integrity_check (as today)
    restored db fails here → close, move previous/ back, reopen, record failure   # BR-48.6
```

⚠️ **Moving the current database aside is the only irreversible-looking step, and it is the one that is
always reversible**: `previous/` is written *before* the new file takes its place, and every failure path
moves it back. A failure can cost the restore; it can never cost the corpus.

⚠️ **The `-wal`/`-shm` siblings move with the `.db`**. A `.db` moved without its WAL is the "824 of 850"
truncation, and a stale WAL left beside a *different* `.db` is worse — SQLite would try to apply it.

---

## 5. Undo last restore (FR-59)

`POST /api/maintenance/restore/undo` → verifies `data/previous/history.db` (BR-47, with integrity +
schema allowlist; it has no manifest of its own, so the manifest step is replaced by the counts recorded
when it was moved aside) → same confirmation → stages it exactly as 3b. The swap at startup puts the
replaced database into `previous/`, so undo is its own inverse (BR-49.3).

---

## 6. What happens to everything else during these flows

| | During backup | During restore (stage → restart) |
|---|---|---|
| Play recording | ✅ continues | Seconds of downtime; `recently-played` backfill recovers them as `not-observed` (BR-48.9) |
| Automation / kill switch | ✅ unaffected | ⚠️ **Untouched** — not in the archive, not written (BR-48.8) |
| Rules | unaffected | unaffected; archive copy compared and discarded (BR-48.7) |
| Credentials | never read into the archive | never written (BR-45.3) |

---

## 7. Developer facility — unchanged in purpose, rewired underneath

`npm run db:backup` / `db:restore` / `db:verify-backups` remain, with `data/backup-*` directories, for
developers. ⚠️ They **import** the verifier from `src/` after BR-47.1 moves it, rather than keeping a
second copy. They still require `docker compose down`, because they are still a second process — that is
now a documented property of the developer path, not of backup and restore in general.
