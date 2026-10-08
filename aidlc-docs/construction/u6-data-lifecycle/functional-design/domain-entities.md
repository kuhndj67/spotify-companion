# Domain Entities — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Functional Design, U6

⚠️ **No schema change.** Nothing in U6 is stored in `history.db`. If a migration appears in this unit, the
design is wrong (plan §1). Everything below lives in files under `data/` or in memory.

---

## 1. BackupArchive — the user-facing artefact

A gzip-compressed tar, `spotify-backup-<YYYYMMDDTHHMMSSZ>.tar.gz`.

| Entry | Required | Content |
|---|---|---|
| `manifest.json` | ✅ | `BackupManifest` |
| `history.db` | ✅ | Single self-contained SQLite file (no `-wal`/`-shm`) |
| `rules.json` | optional | `config/rules.json` as authored |

**Nothing else, ever** (BR-45.2). Not `secrets/*`, not `state/*`.

## 2. BackupManifest

```jsonc
{
  "formatVersion": 1,
  "takenAt": "2026-10-07T18:22:04Z",       // UTC
  "appVersion": "0.1.0",
  "schemaVersion": 7,
  "historyDb": { "bytes": 3784704, "sha256": "…" },
  "tableCounts": { "play": 977, "decision_log": 1214, "skip_attempt": 42, /* … */ },
  "maxIds": { "play": 1051, /* … */ },
  "entries": ["manifest.json", "history.db", "rules.json"]
}
```

⚠️ **No hostname, machine id or user name** (Q3 = A). ⚠️ **Field names match the existing developer
manifest** where they overlap, so one verifier reads both (BR-47.1).

## 3. VerificationVerdict

`verified` · `corrupt` (integrity fails) · `mismatch` (manifest disagrees) · `unverifiable` (no manifest) ·
`refused-schema` (trigger/view/unknown object, or schema too new). Only `verified` is restorable from an
upload (BR-47.3). Kept as distinct values because conflating them is its own bug (existing verifier).

## 4. StagedRestore — `data/restore-pending/`

| File | Written |
|---|---|
| `history.db` | first |
| `manifest.json` | second |
| `ready` | **last** — its presence is the only thing that makes the directory applicable (BR-48.3) |

## 5. PreviousDatabase — `data/previous/`

`history.db` (+ `-wal`/`-shm` if present at swap time) and `moved.json`: `{ movedAt, reason: "restore" |
"undo", tableCounts }` — the counts let Settings describe it and stand in for a manifest on undo
(business-logic-model §5). **Exactly one** exists at a time (BR-49.1).

## 6. WorkDir — `data/.work/<random>/`

Ephemeral. Created per operation, removed in `finally`, swept at startup (BR-50). A restore's work dir
lives at most **10 minutes** awaiting confirmation.

## 7. MaintenanceStatus — in memory, shown on Settings and Diagnostics

```ts
{
  busy: null | 'backup' | 'restore-verify' | 'restore-stage',
  lastRestore: null | { at: string; outcome: 'applied' | 'failed'; reason?: string; plays?: number },
  previous: null | { movedAt: string; plays: number },
  sweptAtStartup: number          // leftover work dirs removed (BR-50.4) — non-zero means a crash
}
```

`lastRestore` is reported from startup, because the outcome of a restore is only known **after** the
restart that applies it.

## 8. Directory map after U6

```
data/
  history.db, -wal, -shm      live (unchanged)
  previous/                   ≤ 1 database (BR-49)          ← NEW, user path
  restore-pending/            transient across one restart  ← NEW, user path
  .work/                      transient, swept              ← NEW, user path
  backup-*/                   developer facility (unchanged)
  CORRUPT-snapshot-*/         --self-test negative control  (never touched)
  snapshots/, reporting/      unchanged
state/                        never read or written by U6
config/                       read only (rules.json copied INTO an archive; never written)
secrets/                      never read or written by U6
```
