# U7 Frontend Components — Configuration Management

**Stage**: Functional Design · **Written**: 2026-10-08 · Rules: [`business-rules.md`](business-rules.md)

Placement is **Q19a = A**: rules actions in the **Rules pop-up**, credentials in **Settings**, the
restore-rules choice inside **Settings → Restore**. The primary screen gains **nothing** — only the existing
Spotify status dot changes colour more truthfully (BR-58).

⚠️ **U6 B&T lesson applies to every control here**: tests assert state, and a disabled destructive button once
*looked* enabled while every test passed. **Each destructive control is click-tested and LOOKED AT** (screenshot)
in Build & Test.

---

## 1. Rules pop-up — new *Rules file* section

| Control | Behaviour |
|---|---|
| **Download rules** | Saves `rules-<stamp>.json`; remembers the hash as `baseHash` for this page |
| **Upload rules…** | File picker (`.json`) → comparison panel. Invalid → inline error naming rule id and field; nothing else changes |
| Comparison panel | ⚠️ **Becomes live** first, in words · then *removed* · *added* · *changed (fields)* · *would load disabled (reason)*. Counts in the heading (*"3 added, 1 removed, 2 changed"*) |
| Confirmation | Plain **Apply** — or, on mass removal or unknown base, a text box requiring `REPLACE` with the reason stated (*"This removes 7 of your 9 rules"* / *"This file wasn't downloaded in this session"*). The Apply button is **visibly** disabled until the word matches |
| **Undo last rules change** | Same comparison and confirmation. Disabled with *"Nothing to undo yet"* when there is no previous file |
| Result | *"Applied — rules version 12"* from the watcher's outcome, or the refusal's own message (stale base, changed since, expired) |

## 2. Settings → Spotify

| Element | Behaviour |
|---|---|
| Status line | *Set · client 3f2a…91c0 · replaced 8 Oct 14:02* / *Set · from a file on disk* / *Not set* |
| Four fields | client id · client secret (`type=password`, never pre-filled) · redirect URI · refresh token (`type=password`, never pre-filled). Client id and redirect URI are **not** pre-filled either — Save replaces the whole set, so every field is entered fresh |
| **Fill from spotify-config.json…** | Reads the file in the browser, fills all four; a missing value is highlighted |
| **Save** | Disabled until all four are filled → warning dialog (BR-56.6) → *Replace credentials*. After save: *"Saved. Checking with Spotify on the next poll…"* then reflects the Spotify dot |
| *How do I get these?* | Collapsed guidance (BR-56.8) |

## 3. Settings → MusicBrainz

| Element | Behaviour |
|---|---|
| Status line | *Contact: k…7@gmail.com* / *Not set* |
| Field + **Save** | Not pre-filled; refused with the startup rule's message (BR-57.2) |

## 4. Settings → Restore (U6 dialog, extended)

| Element | Behaviour |
|---|---|
| Rules line | *"This backup includes rules — identical to yours"* (no checkbox) / *"… — they differ"* |
| ☐ **Also replace my rules with the backup's** | **Unchecked by default.** Ticking expands the comparison (§1's panel, same component). Disabled with the validator's reason when the backup's rules are invalid |
| `RESTORE` confirmation | Unchanged word; its text gains *"and your rules"* when ticked |
| After restart | States separately whether the database was restored and whether rules were applied, skipped (*"your rules changed after you confirmed"*) or not requested |

## 5. Status bar — Spotify dot (BR-58)

| Poll outcome | Dot | Text |
|---|---|---|
| playing / idle | green | unchanged |
| **error** (incl. text errors) | **red** | *Spotify: error — Failed to refresh access token…* (≤ 200 characters) |

The dot already has an error state and an aria-label; U7 changes **what reaches it**, not the component. Colour
is never the only channel (the text and aria-label carry the word *error*).
