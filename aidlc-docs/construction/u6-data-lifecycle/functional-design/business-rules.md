# Business Rules — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Functional Design, U6

Numbered, individually testable. Every rule states its source. Numbering continues from U5, which ended
at **BR-43**. Sources: **FR-57…FR-64** (requirements §3.7, added with this design) and the settled reading,
[`u6-functional-design-plan.md` §10](../../plans/u6-functional-design-plan.md) — cited below as **§10.n**.

> ### The rule that governs the other rules
>
> **U6 is the first unit that accepts a file from outside and lets it replace the corpus.** Every earlier
> unit could at worst write a wrong row; a wrong restore replaces **the only artefact that cannot be
> regenerated**. So every ingest rule is written as an **allowlist**, every check runs **before** anything
> irreversible, and every irreversible step keeps a way back (BR-49).
>
> ⚠️ **And U6 deliberately does not need a writer-guard.** The cross-machine blindness that drove Q1
> exists only because maintenance ran as a *second process*. Here the **one writer** — the app — takes the
> backup on its own connection and applies the restore **before it opens the database**. There is nothing
> to guard against. Any design change that reintroduces a second writer reintroduces Q1.

---

## BR-44: Creating a backup (FR-57)

| # | Rule | Source |
|---|---|---|
| **BR-44.1** | A backup is taken **by the running app, on its own connection**, with `node:sqlite` `backup()`. Recording continues throughout; no quiesce, no restart | §10.3, probe 2026-10-07 |
| **BR-44.2** | The snapshot is written to a fresh temp directory (BR-50), never over an existing file | BR-50 |
| **BR-44.3** | Before it is offered for download, the snapshot passes the **same 8-check verifier** used for restore (BR-47). A snapshot that fails is **not** offered; the user sees the verdict | *"an unverified backup is a belief"* |
| **BR-44.4** | The manifest records: format version, `takenAt` (UTC), schema version, per-table row counts, max ids, sha256 of `history.db`, the app version, and the list of archive entries. **It records no hostname** | Q3 = A |
| **BR-44.5** | The **source** database must pass `integrity_check` before the snapshot is taken. Backing up a corrupt database produces a corrupt backup that looks like insurance | existing `backup-history.mjs` |
| **BR-44.6** | The archive is **streamed** to the browser as a download named `spotify-backup-<UTC stamp>.tar.gz`. When the response ends, **for any reason**, the temp directory is removed | §10.7 |
| **BR-44.7** | Only one maintenance operation runs at a time (BR-51.3) | — |

> ⚠️ **BR-44.1 must not be "simplified" into a file copy.** A `.db`-only copy held **824 of 850** plays
> with `integrity_check: ok` (2026-09-27). `backup()` was probed against **281 interleaved writes on the
> same connection**: 145 ms, `integrity_check: ok`, every play present.

---

## BR-45: Archive format and contents (FR-57, FR-60, FR-61)

| # | Rule | Source |
|---|---|---|
| **BR-45.1** | Format: **gzip-compressed POSIX tar** (`.tar.gz`), written and read with the `tar` package. Node has `zlib` but no multi-file archive writer | S2, measured 2026-10-07 |
| **BR-45.2** | Entries are **exactly** an allowlist: `manifest.json` · `history.db` · `rules.json` (optional). Nothing else is written, and nothing else is accepted (BR-46.6) | §10.8, Q2 = A |
| **BR-45.3** | ⚠️ **Never in an archive**: anything under `secrets/` (refresh token, client secret, contact address) and anything under `state/` (the automation kill switch and halt latch). Enforced by the allowlist, not by an exclusion list | §10.8, S4, Infrastructure Q1 |
| **BR-45.4** | `history.db` is a **single, self-contained file** — no `-wal` / `-shm` siblings — because `backup()` produces a complete database | BR-44.1 |
| **BR-45.5** | `rules.json` is included **as the user authored it**. U6 never applies it (BR-48.7) | §10.9 |
| **BR-45.6** | The manifest carries a `formatVersion`. A reader refuses a `formatVersion` it does not know rather than guessing | — |

> ⚠️ **Why an allowlist (BR-45.2) rather than "everything except secrets and state"**: a denylist includes a
> newly-added state file **by default**, silently. An allowlist misses it, visibly. The one file this
> project most needs never to travel — the kill switch — is exactly the kind of file that gets added later
> beside others.

---

## BR-46: Secure ingest — the ONE admission path for every uploaded file (FR-64)

**Applies to every file the app accepts from outside**: the restore archive in U6, and `rules.json` and
`spotify-config.json` in U7. ⚠️ **One implementation, invoked per kind — never re-implemented per route.**
This project has already shipped a policy that was copied and then diverged (the WebSocket `403`).

### Transport

| # | Rule | Source |
|---|---|---|
| **BR-46.1** | Ingest routes are `POST` only, behind `localGuard` like every route | NFR-01…04 |
| **BR-46.2** | Ingest routes **require** an `Origin` header that `isAllowedOrigin` accepts — **absence is refused**, unlike the general policy which admits a missing `Origin`. Browsers always send it on `POST`; a missing one is not a browser | CSRF |
| **BR-46.3** | Ingest routes also require a custom request header (`X-Spotify-Companion-Ingest: 1`). A cross-site page cannot set it without a CORS preflight, which the app never grants | CSRF, defence in depth |
| **BR-46.4** | The body size cap is enforced **while streaming**, and the request is aborted the moment it is exceeded — never after buffering. Per kind: archive **256 MB**, `rules.json` **256 KB**, credentials **16 KB** | T2 |
| **BR-46.5** | The upload is written **only** into a fresh private temp directory (BR-50). **No name supplied by the client is ever used as a path** | path traversal |

### Archive extraction (restore archive only)

| # | Rule | Source |
|---|---|---|
| **BR-46.6** | Only allowlisted entry names (BR-45.2) are extracted. **Any other entry refuses the whole archive** — it is not skipped | BR-45.2 |
| **BR-46.7** | Only **regular files**. Symlinks, hard links, devices, FIFOs and directories refuse the archive | archive traversal |
| **BR-46.8** | Entry names containing `/`, `\`, `..`, a drive letter or a leading `/` refuse the archive | archive traversal |
| **BR-46.9** | Duplicate entry names refuse the archive — a later duplicate silently replacing an earlier verified one is a known tar trick | — |
| **BR-46.10** | **Decompressed** size is capped per entry and in total (**1 GB**), counted while extracting. Exceeding it aborts | decompression bomb |

### Content

| # | Rule | Source |
|---|---|---|
| **BR-46.11** | The content type is decided by **inspecting bytes**, never by the filename or `Content-Type`: gzip magic `1f 8b` for archives, `SQLite format 3\0` for `history.db`, a JSON parse for `.json` | — |
| **BR-46.12** | Content is **fully validated before it can affect anything**. Validation is kind-specific (BR-47 for the database; U3's validator for rules, in U7). A file that fails validation is deleted with its temp directory, and **nothing outside the temp directory has changed** | T2 |
| **BR-46.13** | Uploaded content is **never executed, imported or `require`d**, and JSON is parsed with plain `JSON.parse` — no reviver, no merge into an existing object | prototype pollution |
| **BR-46.14** | Every ingest outcome — accepted, refused (with the rule number), aborted — is **logged without content** and shown to the user with the reason | *a refusal that does not explain itself* |
| **BR-46.15** | Applying an ingested file is a **separate step from ingesting it**, behind an explicit, typed confirmation where the effect is destructive (BR-48.2) | — |

> ⚠️ **BR-46.2–46.3 are stricter than the rest of the app on purpose.** Every other route is read-only or
> flips a setting the user can flip back. An ingest route **replaces the corpus**. Off-machine exposure of
> these routes is additionally governed by Phase 5 **Q1**, and ⚠️ **they must not be reachable from another
> machine until Q1 is decided.**

---

## BR-47: Verifying a database before it may be restored (FR-58)

| # | Rule | Source |
|---|---|---|
| **BR-47.1** | The **existing 8-check verifier** (today in `scripts/restore-history.mjs`) is used, **moved into `src/` and imported by both the scripts and the app** — never re-implemented | *one rule, invoked twice* |
| **BR-47.2** | The candidate is opened **read-only** for verification, with `PRAGMA trusted_schema = OFF` | SQLite guidance for untrusted DBs |
| **BR-47.3** | `integrity_check` must return `ok` **and** the manifest must match (sha256, per-table counts, schema version). Three-way verdict kept: `corrupt` · `mismatch` · `unverifiable` — and for an upload, **only a fully verified archive is restorable**; `unverifiable` refuses | existing verifier, Q4 |
| **BR-47.4** | ⚠️ **Schema allowlist**: `sqlite_master` may contain only `table` and `index` objects, **every one of whose names exists in the app's own schema**. Any `trigger` or `view` refuses — the app's schema has **none** (measured: 12 tables, 21 indexes) | untrusted SQLite: triggers execute on later writes |
| **BR-47.5** | Schema version **newer** than this app supports refuses, naming both versions. **Older** is accepted; the app migrates it on first open after the swap, exactly as it migrates its own database | migrations |
| **BR-47.6** | The verdict and the manifest's summary — taken at, plays, decisions, schema version — are shown **before** the confirmation (BR-48.2), beside the same figures for the **current** database | so the user sees what they are replacing |

> ⚠️ **BR-47.4 is the rule most likely to be thought paranoid.** A SQLite file is not data, it is a program
> the database engine runs: a trigger defined in an uploaded file fires on the **app's own** later inserts,
> with the app's privileges. The defence is cheap because the app's schema has no triggers or views at all.

---

## BR-48: Applying a restore (FR-58)

| # | Rule | Source |
|---|---|---|
| **BR-48.1** | A restore is applied **only at startup, before `SqliteHistoryRepository` is constructed**. The running app never swaps its open database | §10.4 |
| **BR-48.2** | Staging requires a **typed confirmation** (the user types `RESTORE`). The dialog states that the current database will be **replaced, not merged**, and that it is kept as the one *previous database* (BR-49) | Q3, BR-46.15 |
| **BR-48.3** | Staging writes the verified `history.db` and its manifest into `data/restore-pending/`, then writes a `ready` marker **last**. A pending directory without `ready` is incomplete and is removed by the startup sweep (BR-50.4), never applied | crash safety |
| **BR-48.4** | After staging, the app **exits cleanly** and Docker's `restart: unless-stopped` brings it back (probed: exit 0 → restarted). Under `npm start` nothing restarts it, so the UI says *"Restart the app to finish the restore"* instead of waiting | probe 2026-10-07 |
| **BR-48.5** | At startup, a pending restore is applied in this order: **(1)** re-verify the staged file (BR-47) · **(2)** move the current `history.db` **and its `-wal`/`-shm`** to `data/previous/` (BR-49) · **(3)** move the staged file to `data/history.db` · **(4)** remove `data/restore-pending/` · **(5)** open, migrate, `integrity_check` | — |
| **BR-48.6** | ⚠️ **If any step fails, the app starts on the database it had before** — restoring from `data/previous/` if step 2 had already happened — and reports the failure on the Settings pop-up and in Diagnostics. **It never starts on an empty database** | the corpus cannot be regenerated |
| **BR-48.7** | Restore **never** writes `config/`, `secrets/` or `state/`. A `rules.json` in the archive is **compared, reported and discarded** with the working directory: U6 says *"this backup includes rules (identical / differs from yours)"* and stops there. Applying it is U7's, which will add that option to this same flow | §10.8, §10.9 |
| **BR-48.8** | ⚠️ **The automation kill switch is untouched by restore** — whatever it was before, it is after. A restore can never arm automation | Infrastructure Q1 |
| **BR-48.9** | After a restore the first startup runs the usual `recently-played` backfill, which re-imports up to the last 50 plays as `not-observed` rows. This is expected, and the UI says so | measured 2026-10-07 |

---

## BR-49: The one previous database (FR-59)

| # | Rule | Source |
|---|---|---|
| **BR-49.1** | Exactly **one** previous database is kept, in `data/previous/`. Each restore **replaces** it | T4 = A |
| **BR-49.2** | **Undo last restore** stages `data/previous/` exactly as an upload would be staged — through BR-47's verification and BR-48's confirmation and startup swap. It is a restore whose source happens to be local | one path |
| **BR-49.3** | Undo is offered only while `data/previous/` exists and verifies. After an undo, the database it replaced becomes the new previous — so undo is its own inverse | — |
| **BR-49.4** | The Settings pop-up shows the previous database's date and play count, so it is never a mystery file | — |

---

## BR-50: Temp files and storage (FR-62)

| # | Rule | Source |
|---|---|---|
| **BR-50.1** | All working files live under **`data/.work/<random>/`**, created with `mkdtemp`. Inside `data/` so moves into place are same-filesystem renames | §10.7 |
| **BR-50.2** | A working directory is removed in a `finally` when its operation ends — success, refusal, abort or client disconnect | S5 |
| **BR-50.3** | `data/restore-pending/` is the **one** working location that must survive a restart; it is removed after the swap (BR-48.5) | — |
| **BR-50.4** | At startup, after any pending restore is handled, **everything under `data/.work/`** is removed, and a `restore-pending/` without `ready` is removed. Leftovers are counted in Diagnostics | crash recovery |
| **BR-50.5** | Steady-state storage beyond the live database is therefore **at most one previous database**. Nothing else accumulates from the user path | S5 |
| **BR-50.6** | ⚠️ The startup sweep touches **only** `data/.work/` and `data/restore-pending/`. It never touches `data/backup-*`, `data/snapshots/`, `data/reporting/` or `data/CORRUPT-snapshot-*` | developer data, negative control |

---

## BR-51: The Settings pop-up (FR-63)

| # | Rule | Source |
|---|---|---|
| **BR-51.1** | A **Settings** pop-up, opened from the main screen, holds **Diagnostics** (moved from its own button), **Backup & restore**, and **Export** (moved from its own button) | M1, S1 |
| **BR-51.2** | ⚠️ **Rules and the automation kill switch stay on the main screen.** FR-38's switch must stay one click from where the user hears the skip | S1 |
| **BR-51.3** | One maintenance operation at a time: while a backup or restore is in progress, the other buttons are disabled and the server refuses a second with `409` | — |
| **BR-51.4** | Every destructive control states, beside it, what it replaces and what is kept. Colour is never the only channel | UI rule |

---

## BR-52: One-off legacy cleanup (FQ2 = A)

| # | Rule | Source |
|---|---|---|
| **BR-52.1** | Performed **once, by hand, after BR-44 is live**: take a fresh backup through the app, verify it, **then** delete the 10 `unverifiable` `data/backup-*` directories listed in the plan §6 | FQ2 = A |
| **BR-52.2** | **Kept**: the 3 verified backups and `data/CORRUPT-snapshot-20260921-201444` (`--self-test`'s negative control) | FQ2 |
| **BR-52.3** | The list is re-confirmed with `npm run db:verify-backups` on the day, and shown to the user before anything is deleted | irreversible |
