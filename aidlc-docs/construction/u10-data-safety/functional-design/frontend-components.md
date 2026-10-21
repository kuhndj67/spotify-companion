# U10 — Data Safety — Frontend Components

Two surfaces change: the **Settings** pop-up and the **status bar**. The primary screen gains nothing permanent: the
update indicator appears only when an update exists. ⚠️ Every new element is checked in **light and dark** (issue #14
hid in light mode), and colour is never the only channel.

---

## 1. Settings → **Version** (new section, BR-86.1–86.2)

Placed after *Export*, before *Diagnostics*. Today the version appears only inside a diagnostics run.

```
Version
  App version 1.0.0-beta.8
  1.0.0-beta.9 is available: what changed ↗          ← only when status = newer
  To update: see "Updating" in the install guide ↗
  ☑ Check GitHub for new versions
    Once a day the app asks GitHub (api.github.com) for this project's list of releases.
    GitHub sees your IP address and this app's version. Nothing else is sent.
  Last checked 14:02 · could not check (13:01)        ← the failure note only after a failure
```

| State | Source | Behaviour |
|---|---|---|
| `version` | the server's version (`src/version.ts`) | text |
| `updateCheck` | `UpdateCheckResult` | `off`: switch unchecked, no status line · `not-yet`: *Not checked yet* · `current`: *Up to date (checked &lt;time&gt;)* · `newer`: the available line |
| switch | `UpdatePreference.enabled` | change → `PUT /api/update-check { enabled }`; the result arrives with the next status update |

The *what changed* link opens the Release page in a new tab; the URL is accepted only under this repository's
`/releases/` (BR-85.6). All text from GitHub is rendered as text.

## 2. Settings → **Backup & restore** (status added, BR-86.4)

Two lines above the existing *Create backup* and *Restore backup* controls:

```
Automatic backups   newest 6 h ago (14 kept)   · before a change: 2026-10-21 (version 1.0.0-beta.8→beta.9)
Kept in data/backups/ — to restore one, choose it with Restore backup.
```

A **warn** or **fail** level (BR-81.2) shows its glyph and words (*Backups have stopped: newest 3 days ago*), not
colour alone. No list and no per-file buttons (Q5 = A).

## 3. Status bar → **Update** indicator (BR-86.3)

| | |
|---|---|
| Shown | only when `updateCheck.status = newer` |
| Level | `ok` (it is news, not a fault) |
| Glyph · label | `↑` · *Update* |
| Detail (on click) | *1.0.0-beta.9 is available (checked 14:02). Settings → Version.* |
| Message line | never (`inMessage: false`) |

Never shown for `off`, `not-yet`, `current` or a failed check (BR-85.7).

## 3a. Status bar → **Status** indicator, and the **Diagnostics** button *(added 2026-10-22, NFR Q3)*

Owner: *"To keep the main screen clean … lets include a "Status" indicator light/text with "check diagnostics page"
as the pop up text. also maybe we should promote "Diagnostics" to a button between settings and rules?"*

| | |
|---|---|
| Shown | **always** |
| Level | the worst of its sources (BR-86.5): backup health, the lock, a failed before-change backup |
| Glyph · label | `ok`: `✓` · *Status* · `warn`: `⚠` · *Status* · `fail`: the existing fail glyph · *Status* |
| Detail (on click) | healthy: *All checks OK*; otherwise the failing sources in words, then **Check the Diagnostics page** |
| Message line | never (`inMessage: false`) |

The header buttons become **Settings · Diagnostics · Rules**. *Diagnostics* opens the same pop-up as today (ids and
`data-testid`s kept, so existing tests follow it); the *Diagnostics* section leaves Settings. Whether today's five
indicators fold into *Status* is the UX/UI unit's decision, not U10's.

## 4. Existing elements whose words change

- Diagnostics step **Snapshots** → **Backups**, with the new **warn** level (BR-81.2, 81.3).
- The **recording** indicator, when history is unavailable because of the lock or a failed before-change backup,
  names that cause in its detail (BR-78.8, 79.3).

## 5. API (for the components above)

| Endpoint | Used by | Notes |
|---|---|---|
| `GET` status (existing WebSocket snapshot) | status bar, Settings | gains `updateCheck` and `backupHealth`, pre-derived, as the indicators already are |
| `PUT /api/update-check` `{ enabled }` | Settings switch | writes `state/update-check.json` (BR-85.9) |
| `POST /api/backups` `{ reason }` | `npm run release` only (BR-82) | keeps a before-change backup; `409` when busy; local-only like every route |
