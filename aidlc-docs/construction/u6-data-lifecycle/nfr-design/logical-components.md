# Logical Components — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — NFR Design, U6
Patterns: [`nfr-design-patterns.md`](nfr-design-patterns.md) (P-38…P-48). **Numbering** continues from U5,
which ended at **LC-31** and **PBT-50**.

⚙️ PURE = no I/O, no clock, testable by property · 🔌 IMPURE = touches files, the database or the network.

---

## The boundary

```
browser ──POST──▶ decideAccess ─▶ ingestGuard (LC-32) ─▶ MaintenanceService (LC-36)
                                                           ├─ ArchiveReader (LC-33) ─▶ entryPolicy (LC-33a)
                                                           ├─ BackupVerifier (LC-34)
                                                           └─ OnlineBackup (LC-35) ─▶ ArchiveWriter (LC-33)
server.ts startup ─▶ StartupRestorer (LC-37) ─▶ WorkDirSweeper (LC-38) ─▶ new SqliteHistoryRepository(...)
public/ ─▶ Settings pop-up (LC-39)
scripts/db:* ─(node --import tsx)─▶ BackupVerifier (LC-34)
```

⚠️ **LC-37 runs before the repository is constructed.** That ordering is P-38's whole guarantee and is
pinned by a structural test, as `localGuard.test.ts` pins the upgrade handler.

---

## LC-32 · `ingest/ingestGuard` 🔌 thin middleware over ⚙️ PURE `admitIngest`

`admitIngest({ method, origin, ingestHeader }) → ok | refused(rule)` — pure, so BR-46.1–46.3 are testable by
property. Applied **after** `decideAccess` on every ingest route (P-42). Reused unchanged by **U7**.

## LC-33 · `ingest/archive` — reader and writer 🔌 over ⚙️ PURE `entryPolicy` (LC-33a)

- **LC-33a `entryPolicy`** ⚙️ PURE: `(entryHeader, seenNames, runningTotals, caps) → accept(fixedName) | refuse(rule)`. Encodes BR-46.6–46.10 — allowlist, regular files only, no separators/`..`/drive letters, no duplicates, per-entry and total expanded caps.
- **Reader** 🔌: `tar` as a **stream parser only** (P-39); asks `entryPolicy` per entry, writes accepted bodies to the fixed names in the work dir, aborts the whole archive on the first refusal.
- **Writer** 🔌: emits exactly the allowlisted entries (P-45), gzip-compressed, streamed to the response.

## LC-34 · `backup/BackupVerifier` 🔌 *(moved from `scripts/restore-history.mjs`)*

The existing 8 checks, plus BR-47.2 (`trusted_schema = OFF`, read-only), BR-47.4 (**schema allowlist** — only
`table`/`index` objects whose names exist in the app's own schema; any trigger or view refuses) and BR-47.5
(schema version not newer than supported). Verdicts: `verified · corrupt · mismatch · unverifiable ·
refused-schema`. **Imported by the app and by the `db:*` scripts** — one copy (BR-47.1, Q4 = A).

## LC-35 · `maintenance/OnlineBackup` 🔌

`integrity_check` on the live DB → `backup(liveConnection, work/history.db)` → manifest built **from the copy**
→ LC-34 verifies → LC-33 writer streams the archive. Holds the maintenance lock throughout.

## LC-36 · `maintenance/MaintenanceService` 🔌

Owns the **maintenance lock** (one operation at a time, `409` otherwise — BR-51.3), the **staging tokens**
(work dir id + verified summary, **10-minute TTL**), and the routes' orchestration: backup (LC-35), restore
upload → verify → comparison, restore confirm → stage (`ready` written last) → `exit(0)`, and undo (BR-49.2 —
stages `previous/` through the same path). Exposes `MaintenanceStatus` to Diagnostics and Settings.

## LC-37 · `maintenance/StartupRestorer` 🔌

Runs in `server.ts` **before** `new SqliteHistoryRepository(...)`. Applies a `ready` restore through the
**journaled, idempotent** steps of P-43; on any failure restores `previous/` and records the reason
(BR-48.6). ⚠️ **Never leaves the app to start on an empty database.**

## LC-38 · `maintenance/WorkDirSweeper` 🔌

After LC-37: removes `data/.work/*` and any `restore-pending/` without `ready`. Touches **only** those two
paths — never `backup-*`, `snapshots/`, `reporting/` or `CORRUPT-snapshot-*` (BR-50.6). Reports its count.

## LC-39 · `ui/settings` — the Settings pop-up

FC per `frontend-components.md`: Backup & restore · Export (moved) · Diagnostics (moved, gains a Maintenance
block with size-vs-cap headroom — P-46). Restore flow: file → raw-body upload with the ingest header (P-41,
P-42) → comparison panel → typed `RESTORE` → *Restarting…* with the **60 s** not-back message (P-47).

---

## Components deliberately NOT built

| | Why |
|---|---|
| A live quiesce / reopen | Six writer drivers to pause, and restore replaces anyway (FD §7). P-38 |
| A multipart parser | P-41 — the body is the file |
| A cross-machine writer-guard | Dissolved by P-38, not solved |
| A user-visible backups folder | FD S2 — rejected as unnecessary complexity |
| Scheduled backups | W-9 |

---

## Property obligations — PBT-51 onward

Each has a **negative control** proving the property can fail (W-6.3).

| | Property | Negative control | Source |
|---|---|---|---|
| **PBT-51** | ⭐ For **any** generated archive, nothing is written outside the work directory | Archive with `../x`, an absolute path, a symlink and a hard link → all refused, nothing written | P-39, BR-46.7–46.8 |
| **PBT-52** | Any entry not on the allowlist refuses the **whole** archive; duplicates refuse | Valid backup + one extra file → refused | P-45, BR-46.6/46.9 |
| **PBT-53** | `backup → restore` round-trips: table counts and sha256 identical | One row deleted from the copy → `mismatch` | FR-57/58, LC-34 |
| **PBT-54** | ⭐ The verifier refuses any database containing a trigger or view | A real backup with one `CREATE TRIGGER` added → `refused-schema` | BR-47.4 |
| **PBT-55** | ⭐ Killing the startup swap **at every step** leaves an app that opens a database passing `integrity_check` — **never an empty one** | Journal deleted mid-swap → still recovers to a valid database | P-43, BR-48.6 |
| **PBT-56** | `secrets/` and `state/` never appear in an archive, whatever files exist | Files planted in both beside `config/` → absent from the archive | P-45, FR-60/61 |
| **PBT-57** | `admitIngest` refuses a missing `Origin`, a disallowed `Origin`, a missing ingest header, and any non-`POST` | **Positive control**: all present and correct → admitted (a guard that refuses everything passes the refusals) | P-42, BR-46.1–46.3 |
| **PBT-58** | The upload size cap aborts at the first byte over, never after buffering the whole body | A body exactly at the cap → accepted | P-41, BR-46.4 |
