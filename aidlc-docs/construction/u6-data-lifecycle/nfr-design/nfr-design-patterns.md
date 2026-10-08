# NFR Design Patterns — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — NFR Design, U6
**Answers**: Q1–Q10 all **A**, as recommended (Q10 given in conversation).
Authoritative reading: [`../../plans/u6-nfr-design-plan.md`](../../plans/u6-nfr-design-plan.md) §5.1.
**Numbering** continues from U5, which ended at **P-37**.

> ### The pattern that governs the other patterns
>
> U5 asked *"when this is wrong, what cannot be undone?"* about a skipped track. U6 asks it about **the
> corpus** — the only artefact here that cannot be regenerated:
>
> > **Nothing irreversible happens until everything checkable has been checked, and the irreversible step
> > keeps a way back.**
>
> A refused restore can be retried. A restore that should have been refused can only be rescued by BR-49's
> one previous database — which is the last line of defence, never the plan.

---

## P-38: One writer does maintenance *(FD §10.3–10.4)*

The app takes a backup **on its own connection** (`node:sqlite` `backup()`), and applies a restore **at
startup, before the database is opened**. No other process ever writes `history.db` on the user path.

⚠️ **This replaces a guard rather than implementing one.** The script-side guard (`docker ps` + lock probe)
exists because the scripts are a second process across a mount SQLite's locks do not cross, and it goes blind
across machines. With one writer there is nothing to guard against. **Any future design that introduces a
second writer — a sidecar, a `docker exec` script, a live quiesce-and-reopen — reintroduces the U4 corruption
shape**, and must be rejected on that ground alone.

The developer `db:*` scripts are still a second process; they keep their guard and their `compose down`
requirement. That is now a documented property of the **developer** path only.

## P-39: Parse, never extract *(Q1 = A, Q2 = A)*

The `tar` package is used **only as a stream parser**. For each entry our code decides — name on the
allowlist, type is a regular file, not a duplicate, size within cap — and writes the body to a **fixed name
it chooses**. The library never writes to the filesystem, and **no name from the archive is ever used as a
path**.

⚠️ `tar`'s published advisories (2021) are in its **extract-to-disk** path — path traversal and symlink
tricks. P-39 removes that class **structurally**: a `../x` or symlink entry has nowhere to land, so the
defence does not depend on the library's own checks being right.

**Dependency record**: `tar` **7.5.22**, licence **BlueOak-1.0.0** (OSI-approved 2024; the Blue Oak Council
states it can be combined and distributed with GPLv3 software — so compatible with NFR-32), **5** transitive
dependencies. The first new runtime dependency since U0.

## P-40: Validate fully, then act — ingest and apply are separate steps *(BR-46.12, BR-46.15)*

```
upload → work dir → parse (P-39) → verify (LC-34) → show comparison → typed confirm → stage → restart → swap
          └──────────── nothing outside data/.work/<id>/ has changed ────────────┘
```

Every check that can fail runs **before** the first write outside the work directory. Confirmation is a
**second request** carrying a staging token, so a failed or abandoned dialog has nothing to undo.

## P-41: The body is the file *(Q3 = A)*

Uploads are sent as the raw request body (`Content-Type: application/gzip`, via `fetch`) and streamed
straight into the work directory, with the size cap **counted as bytes arrive** and the request aborted the
moment it is exceeded. **No multipart parser** — so no second parser of untrusted input, and no dependency.

## P-42: A stricter guard composed after the general one *(Q8 = A)*

Every ingest route passes `decideAccess` (unchanged — still the one rule HTTP and the WebSocket share), **then**
`ingestGuard`: `Origin` **required** and allowed (BR-46.2), the `X-Spotify-Companion-Ingest: 1` header
present (BR-46.3), method `POST`. One implementation, used by every ingest route — U7 included.

⚠️ `decideAccess` is deliberately **not** given an *ingest* flag. It is the function the 2026-09-05 WebSocket
incident taught this project to change least, and `localGuard.test.ts` pins its structure.

## P-43: Journal before each irreversible step *(Q5 = A)*

The startup swap writes `data/restore-pending/journal.json` — `{ step, at }` — **before** each step of
BR-48.5, and every step is **idempotent** (re-running a completed step is a no-op):

| Step | Re-run safe because |
|---|---|
| `verify` | read-only |
| `move-current-aside` | skips if `history.db` already absent **and** `previous/` matches the journal's recorded counts |
| `move-staged-in` | skips if the staged file is absent and `history.db` matches the manifest's sha256 |
| `cleanup` | removing what is already gone is a no-op |
| `open` | the normal startup path |

At startup, a journal names exactly where the swap stopped. ⚠️ **Inferring the state from which files exist
is rejected**: after step 2, *"`history.db` missing, `previous/` present"* reads the same whether the swap is
half done or a file was deleted by hand. A journal turns *guess* into *read*.

## P-44: Cleanup is a property of every path *(BR-50, FR-62)*

Every working directory is removed in a `finally` — success, refusal, abort or client disconnect — and the
startup sweep removes anything a crash left in `data/.work/`, plus a `restore-pending/` with no `ready`
marker. The only thing that survives a restart is **an applicable, journaled restore**. The sweep's count is
reported in Diagnostics: **non-zero means an operation was interrupted**, which is worth seeing.

## P-45: Allowlist what travels *(BR-45.2, FR-60/61)*

Archive contents and accepted entries are **named**: `manifest.json`, `history.db`, `rules.json`. Never
"everything except". A denylist would include a later-added state file **by default and silently**; an
allowlist misses it **visibly**. This is what keeps `secrets/` and `state/` out by construction rather than
by memory.

## P-46: Headroom you can see *(Q6 = A)*

Caps: upload **64 MB**, expanded **256 MB** — about 40× today's archive (1.6 MB compressed, 5 MB expanded).
Diagnostics shows **current size against each cap**, so growth is visible long before a cap binds and the
first sign is never a refused backup.

## P-47: A restart that does not come back says so *(Q7 = A)*

After staging, the app `exit(0)`s and Docker's `unless-stopped` restarts it (probed). The UI shows
*Restarting…* and reconnects as it does after any restart. ⚠️ **If the app has not returned within 60 s**, it
says so plainly — *"The app has not come back. Check that its container is running."* — instead of spinning.
Under `npm start` (no supervisor) the UI says *"Restart the app to finish the restore"* from the start.
The real restart time is **measured in Build & Test**; 0.5 s to *listening* is known, Docker's overhead is not.

## P-48: Split verification, local then remote *(Q10 = A)*

U6's exit criterion is proven on **a second installation on this machine** — its own Compose project,
`data/`, port and empty corpus — restored from a live *Create backup*. The **cross-machine** half is **U9's**
exit criterion, because until U9 builds NFR-29 a browser on another machine is refused by `localGuard`.
⚠️ The second installation must **not poll Spotify** while the live app does (one registration — the U9-b
question): stop one, or never start the second's poller during the test.
