# Frontend Components — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Functional Design, U6

Follows the standing UI rule: **controls on pop-ups, the primary screen stays clean; colour is never the
only channel.** Same `<dialog class="diag">` pattern as Diagnostics and Rules.

---

## 1. Main screen header — before and after

| Before | After |
|---|---|
| **Export** · **Diagnostics** · **Rules** | **Settings** · **Rules** |

⚠️ **Rules stays** — it holds the automation kill switch, which must be one click from where the skip is
heard (BR-51.2). Export and Diagnostics move **into** Settings (BR-51.1).

⚠️ `data-testid`s of moved controls (`history-export-button`, `diagnostics-open-button`) are **kept** on the
controls inside Settings, so existing tests still find them after the move.

## 2. Settings pop-up (`<dialog id="settings">`)

Three sections, in this order:

### 2.1 Backup & restore

```
Backup & restore
  [ Create backup ]   Downloads your listening history (977 plays) and rules.
                      Credentials and the automation switch are never included.

  [ Restore backup… ] Replaces your current history with one from a backup file.

  Previous database: 2026-10-07 18:22 · 951 plays     [ Undo last restore… ]
  (shown only when one exists)
```

- **Create backup**: button shows *Creating backup…* and is disabled; the download starts when the
  server streams. A refusal shows its verdict inline (BR-44.3).
- **Restore backup…** opens a file picker (`accept=".tar.gz,.tgz"` — a hint only; the server decides by
  bytes, BR-46.11), uploads with the ingest header (BR-46.3), then shows **the comparison panel**:

```
  This backup                     Your current history
  Taken     2026-10-02 21:14 UTC   —
  Plays     951                    977
  Decisions 1,120                  1,214
  Schema    v7                     v7
  Rules     differs from yours — not applied (rules can't be restored yet)

  ⚠️ Restoring REPLACES your current history. It does not merge.
     Your current history is kept as the previous database, so you can undo this once.
     The app will restart; recording pauses for a few seconds.

  Type RESTORE to continue: [________]   [ Cancel ]  [ Restore ] (enabled only when typed)
```

- After confirming: *Restarting…*, then the normal reconnect. On reconnect the section reports the
  outcome from `lastRestore` (BR-48.6), e.g. *Restored 951 plays from 2026-10-02 · 3 recent plays
  re-imported from Spotify* — or *Restore failed: <reason>. Your history is unchanged.*
- Under `npm start`: *Restart the app to finish the restore.*
- **Undo last restore…** uses the same comparison panel and confirmation (BR-49.2).

### 2.2 Export

The existing export control, unchanged in behaviour, moved here.

### 2.3 Diagnostics

The existing Diagnostics content, moved here. Gains a **Maintenance** block: busy state, last restore
outcome, previous database, and startup sweep count (non-zero means an interrupted operation).

## 3. States and accessibility

| State | Text (never colour alone) |
|---|---|
| Busy | Button label changes and `aria-busy="true"`; other maintenance buttons `disabled` with a reason |
| Refused | Inline message naming the rule in plain words (*"This file isn't a backup made by this app"*), plus the technical reason in a `<details>` |
| Restarting | Status text + the existing disconnected/reconnecting indicator |
| Destructive confirm | Typed word; the confirm button stays disabled until it matches exactly |

## 4. What is NOT on the screen

- No list of backups and no backups folder (S2 — rejected as unnecessary complexity).
- No credentials fields, no rules upload — those are **U7**.
- No scheduled-backup control (W-9).
