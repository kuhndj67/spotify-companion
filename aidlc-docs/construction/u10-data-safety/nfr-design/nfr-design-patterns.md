# U10 NFR Design Patterns — Data Safety

**Unit**: U10 · **Date**: 2026-10-22 · **Plan**: [`u10-nfr-design-plan.md`](../../plans/u10-nfr-design-plan.md) — Q1 A ·
Q2 A · Q3 X (Status indicator and Diagnostics button; follow-ups Q3a–c all A)
**Allocates**: **P-76…P-87** · components and properties in [`logical-components.md`](logical-components.md)

The common thread: **each guard is seen to fail on a bad input, and each failure is visible where the user looks.**
Every guard U10 adds replaces or repairs one that was green for the wrong reason: `docker ps`, blind to a host run;
a snapshot step reporting `ok` for 18 days with nothing written.

Scalability: **not applicable** (one user, one database; the backup store is bounded by rotation and P-82). Performance:
one kept backup at startup when a change is due, one a day; no new latency target.

---

## P-76 — Watch the heartbeat, never judge by age (BR-78.3; Q1 = A)

**Problem**: a lock left by a process that was just killed looks exactly as fresh as a live one, and comparing the
lock's time with this machine's clock trusts two clocks to agree (true here within a second; not promised for U11).

**Pattern**: a holder touches the lock every **5 s**. A process that finds the lock held reads its token and
modification time, waits the **stale window (30 s)**, and reads them again. ⚙️ Verdict from the two observations:
**same token, time moved → alive (refuse)**; **same token, time unchanged → stale (take over, P-77)**; **token
changed → someone else acquired meanwhile (start again)**. Only times written by the holder's clock are compared with
each other. Six missed heartbeats before a verdict of *stale*, so a briefly slow disk or paused VM is not death.

**Cost**: an orderly stop deletes the lock (P-78), so a normal restart, a release or an `update` waits for nothing;
only an unclean stop costs up to 30 s before recording resumes, inside the health check's tolerance (start period
10 s, three 30 s retries).

## P-77 — Takeover under a mutex, re-checked (BR-78.4)

The race the probe exposed (two takers both deleting, or one deleting a lock that just changed hands) is closed by an
exclusive-create **takeover mutex**: only its holder may delete, and only after re-reading the lock and finding the
**same token** it watched. Then it creates its own lock by exclusive create (which can still lose to a third process,
harmlessly) and deletes the mutex. A mutex older than the stale window is itself stale.

## P-78 — The holder checks itself, and releases only its own (BR-78.5, 78.6)

Each heartbeat touches the lock, then reads it back. A missing file or a foreign token means the database has been
taken: stop writing **at once**, close, mark history unavailable, feed *Status* (P-85). Never re-take. On orderly
shutdown (SIGTERM, SIGINT, the restore restart, `tsx watch`'s restart) delete the lock **only if** it still holds this
process's token. The heartbeat timer is `unref`'d so it never holds a dying process open.

## P-79 — One lock module for the app and the scripts (BR-78.7)

The lock lives in `src/`; the writing scripts already import `src/` under `tsx`, so they take the **same** lock by the
**same** code, with `kind = script:<name>`. The `docker ps` guard and its `--i-have-stopped-the-container` flag are
removed, not kept beside it: two guards answering the same question differently is the trap CONTRIBUTING.md names.

## P-80 — Open, decide, back up, then migrate (BR-79)

The repository's constructor stops migrating. Startup calls *open*, then the ⚙️ decision `backupDue(pendingMigration,
lastAppVersion, runningVersion)`, then (if due) U6's `createBackup` through the **same** connection into the store,
then *migrate*, then writes the last app version. Any failure before *migrate* closes the connection with the file
untouched. The schema goes v7 → v8 for the one-row metadata table, so the first U10 start exercises the whole path
on the owner's own database: a backup is due because a migration is pending.

## P-81 — Kept backups arrive whole, rotate per kind (BR-80)

Built and verified in `data/.work/` exactly as *Create backup*, then **renamed** into `data/backups/<kind>/` (same
mount, so the rename is atomic and the store never holds a partial file). ⚙️ Rotation's delete list is a function of
the kind's file names and its keep count, run only **after** the new file has arrived, and it can only name files
matching that kind's own pattern. Nothing outside the two kind folders is ever deleted.

## P-82 — Free space before writing (Q2 = A)

Before a kept backup: free space on the database's disk must be at least **2 × (database + WAL) + 100 MB**. Short
→ no file is written: a scheduled backup is skipped and reported **fail** (*not enough disk space: N MB free, M MB
needed*); a before-change backup counts as failed, so the change is refused (BR-79.3). Nothing is deleted to make
room: the user decides what goes. ⚙️ `enoughSpace(free, dbBytes, walBytes)`.

## P-83 — Scheduled from disk (BR-81.1)

A 15-minute check and one at startup ask the ⚙️ question `scheduledDue(newestAt, now, interval)`. The answer depends
only on the files on disk, so no restart can postpone or multiply backups (the 2026-10-03 defect was a timer reset by
every restart).

## P-84 — Truthful health, with a warn level (BR-81.2, 81.3)

⚙️ `backupHealth(newestScheduled, uptime, interval, lastError, spaceShort)` → `ok | warn | fail` with the reason in
words. Diagnostics' step type gains `warn`; a run with warnings and no failure is not a failed run. ⚠️ Positive
control: no input with *no backup* yields `ok`.

## P-85 — One always-visible *Status* light (BR-86.5; Q3a–b)

⚙️ `status(sources)` → the **worst** level of its sources, with each failing source's sentence; U10's sources are
backup health (P-84), the lock outcome (P-76, P-78) and the before-change backup outcome (P-80). It is computed on the
server and arrives **pre-derived** on the WebSocket snapshot, as every indicator does. Always shown, a glyph and the
word *Status* at every level; at warn or fail its pop-up ends *Check the Diagnostics page*. A new source is one entry
in a list, so later units extend it without touching its rule.

## P-86 — Diagnostics one click away (BR-86.6; Q3c)

The diagnostics pop-up moves to a header button, **Settings · Diagnostics · Rules**, keeping its ids and test ids so
existing tests follow it. The *Status* pop-up and diagnostics name the same causes in the same words (one sentence per
source, used by both), so the light and the page can never disagree.

## P-87 — A bounded, anonymous outbound call (BR-85)

The update check's request: HTTPS with certificate verification (the runtime default; never disabled); **10 s**
timeout; response read to at most **1 MB**; redirects followed only to `api.github.com`; no token, cookie or contact
address; its own User-Agent `spotify-companion/<version>`. Only `tag_name`, `prerelease`, `draft` and `html_url` are
read; the URL is shown only under this repository's `/releases/`. Its own timer and its own `fetch`, never the Spotify
client's queue or budget. A failure is a value (*could not check, time*), never an exception that reaches the poll.
Writes of `state/update-check.json` go temp-then-rename in the `state/` directory mount.
