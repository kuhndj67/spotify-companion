# U10 — Data Safety — Business Logic Model

**Inputs**: FR-76…81 (FR-56/76/79/80 as amended 2026-10-21) · FD plan Q1–Q6 (all A) · US-33 · the facts in the plan's §2
**Rules**: `business-rules.md` (BR-78…BR-86) · **Entities**: `domain-entities.md` · **UI**: `frontend-components.md`

Technology-agnostic where it can be; where the mechanism *is* the decision (an exclusive file create, the order of
startup steps), it is named, because the probes measured exactly that mechanism.

---

## 1. Startup, in order

Today: restore swap → open (which migrates at once) → listen → timers. U10 inserts three steps and splits *open* from
*migrate*. Every numbered step below happens before the next begins.

```
 1. resolve the database path            FR-78  host run with no HISTORY_DB_PATH → data-dev/history.db
 2. acquire the writer lock              FR-77  BR-78     refused → history unavailable (display-only), stop here
 3. apply a pending restore              U6     unchanged, now under the lock
 4. open the database WITHOUT migrating
 5. decide: is a backup due before change?      BR-79     migration pending, or last opened by another app version
 6.   yes → take a before-change backup  FR-76a BR-80     failed → close, history unavailable, database untouched
 7. migrate                                     (as today)
 8. record this app version as the last to open the database
 9. listen; start the poll                      (as today)
10. scheduled-backup check               FR-80  BR-81     newest scheduled backup older than the interval → take one
11. update check, shortly after start    FR-81  BR-85     only if enabled, and not checked in the last hour
```

**Why the lock is first.** The restore swap (step 3) renames `history.db`: it is a write, so it must happen under the
lock. A swap that ran while another process held the database is exactly the two-writer corruption FR-77 exists to
prevent.

**Why open and migrate split.** `SqliteHistoryRepository`'s constructor migrates the moment it opens
(`src/history/SqliteHistoryRepository.ts:203`). The backup must see the database **before** the migration and must
be taken through the app's **own** connection (U6's one-writer rule, `onlineBackup.ts`), so the constructor becomes
*open*, and *migrate* becomes a separate call after step 6.

**What step 5 catches** (Q1 = A). A migration changes the schema; a version change can change what the code writes
without changing the schema. Either is a "risky change". The first start of an updated *App only* install is a
version change, so FR-79's `update` needs no backup of its own: the updated app takes it before it touches anything.
A restore from an older backup (step 3) usually lands on an older schema or version too, and so is backed up again
before it migrates; that copy is cheap and harmless.

**Failure at step 2 or 6** follows the app's existing degraded mode (`server.ts`, *"history unavailable; running
display-only"*): the now-playing display still works, nothing is recorded, and diagnostics and the status bar say why.
A refusal never deletes or edits the database.

**The wait in step 2.** A lock that looks fresh may belong to a process that has just died, typically the previous
container that `docker compose up -d` stopped with SIGKILL after its grace period. Age alone cannot tell "alive" from
"just died", so step 2 **watches** the heartbeat for one stale window (BR-78.3): if it moves, the holder is alive and
the lock is refused; if not, it is taken over. This can delay recording by up to that window; the container's health
check (start period 10 s, three 30 s retries) tolerates it. NFR Design sets the exact timings.

---

## 2. The writer lock (FR-77; Q3 = A)

```
 acquire ──▶ exclusive create <db>.lock ──ok──▶ HELD ──every heartbeat──▶ touch, then re-read:
                    │                              │                         still my token? ── no ──▶ LOST
                    │ EEXIST                       │ shutdown                                          │
                    ▼                              ▼                                                   ▼
          read holder; watch heartbeat      delete only if my token            stop writing; close; history unavailable
          for one stale window
           ├─ moved     → REFUSED (name the holder)
           └─ not moved → take over under the takeover mutex (BR-78.4), then exclusive create again
```

**Measured** (plan §2): the exclusive create is refused with `EEXIST` in both directions across the Rancher bind
mount, the heartbeat is visible from the other side, and the clocks agreed to within a second. Staleness is judged by
**watching the heartbeat move**, never by comparing one clock with another, so clock skew between a host and a
container (or, in U11, two machines) cannot make a live holder look dead.

**Who takes it**: the app (container or host), and every script that writes `history.db`. It **replaces** the
scripts' `docker ps` guard, which cannot see a host `npm start` or another machine. Read-only scripts take no lock.

**Lost lock.** A laptop that sleeps past the stale window can wake to find its lock taken. Each heartbeat re-reads
the lock; a different token means another process now owns the database, so this one stops writing at once. It
never takes the lock back; a restart is the way back.

---

## 3. Kept backups (FR-76, FR-80; Q2 = A, Q5 = A)

One kind of file: the **verified archive** that *Create backup* already makes (U6, `createBackup`). It is built in
`data/.work/` exactly as today, then **moved** into the store instead of streamed and deleted. So everything U6
proved about it holds: integrity-checked source, self-contained copy, manifest from the copy, verified as an upload
would be, and *Restore backup* accepts it.

```
data/backups/
  scheduled/      spotify-backup-<UTC stamp>.tar.gz      FR-80, kept: SNAPSHOT_KEEP (default 14)
  before-change/  spotify-backup-<UTC stamp>.tar.gz      FR-76, kept: 5 (configurable)
```

The folder sits beside the database, derived from `HISTORY_DB_PATH`, so it is inside the `./data` mount on every
install and needs **no new setting** in an existing user's `compose.yaml` (`update` rewrites only the image line).
Each kind rotates on its own, so a month of daily backups can never push out the copy taken before a migration.

*Create backup* (the download) is unchanged and is not kept: the user asked for a file, and has it.

The old CSV snapshots in `data/snapshots/` are **left where they are**. The CSV timer is retired; *Export* (CSV, on
demand) stays. `SNAPSHOT_DIR` is then unused; `SNAPSHOT_INTERVAL_HOURS` and `SNAPSHOT_KEEP` keep their meaning for
the scheduled kind.

### Scheduled backups (FR-80)

Scheduled from the **newest scheduled backup on disk**, not from process start: a periodic check (every 15 minutes)
asks *is the newest older than the interval?* and takes one if so, and the same question is asked once at startup. A
restart loop therefore cannot rotate history out (at most one per interval), and a restart can no longer postpone a
backup forever, which is the live defect: the 24-hour timer restarted with every container restart, and nothing was
written after 2026-10-03.

---

## 4. Backup before a release (FR-76b)

`npm run release -- --apply`, before it builds, asks the **running** app to keep a before-change backup
(reason: *release &lt;version&gt;*), from the host, where the app is reachable normally. It goes on only when the app
answers that the backup is kept **and** the host can see that file in `data/backups/before-change/`. A backup the
host cannot see is not counted. If the app is unreachable, the release refuses; `--app-is-down` overrides that one
refusal, and the plan then says that the new version will still back up before its first run (§1 step 6).

---

## 5. `update` (FR-79, as amended)

```
docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:<new> update
```

1. Read `/work/compose.yaml`; find the **one** `image: ghcr.io/kuhndj67/spotify-companion:<v>` line. None, or more
   than one → refuse, change nothing.
2. Compare `<v>` with this image's own version (SemVer precedence, the existing `compareSemVer`):
   - this image is **older** → refuse (*never moves to an older version*);
   - the **same** → say so, change nothing;
   - **newer** → rewrite that line only (every other byte kept, line endings included), written to a temporary file
     in `/work` and renamed over the original.
3. Print the next step: `docker compose up -d`, then: *"the new version backs up your history before its first
   run"*, and the Release page for the version.

`update` never touches `data/`, needs no access to the running app, and does not need the app stopped: `docker compose
up -d` replaces the container, and the new one takes the lock (§2) and backs up (§1) before anything else.

---

## 6. Developer data apart (FR-78; Q4 = A)

A **host** run of the app (`npm start`, `config.inContainer` false) with no `HISTORY_DB_PATH` uses
**`data-dev/history.db`**, created on first start and gitignored. The container is unaffected (`compose.yaml` sets
`HISTORY_DB_PATH: /data/history.db`). Scripts keep `data/history.db`: they are deliberate tools for the real history,
and the lock now refuses them while anything holds it. A developer who means to run the app on the real history sets
`HISTORY_DB_PATH=data/history.db`, with the container down; the lock enforces the second half.

---

## 7. Update check (FR-81)

```
enabled?  (state/update-check.json; absent = enabled, Q35 = B)
   │ no → no request, ever; Settings says "off"
   ▼ yes
due?  shortly after start (≈1 min) unless the last check was < 1 h ago; then every 24 h
   ▼
GET https://api.github.com/repos/kuhndj67/spotify-companion/releases?per_page=10
    User-Agent: spotify-companion/<version>   (never the MusicBrainz one: it carries the contact address)
   ▼
candidates = releases that are not drafts, whose tag is v<SemVer>,
             and (if this version is a pre-release) pre-releases too; otherwise stable only
newest = the highest by SemVer precedence
   ▼
newer than this version? → status "newer", with the version and its Release page
otherwise                → status "current"
any failure              → keep the last good answer; record "could not check (time)"; never an error indicator
```

**The one-hour rule.** FR-81 says *once shortly after start*. A restart loop would turn that into a request per
restart, a disclosure each time and a risk to the 60-per-hour anonymous limit. So the startup check is skipped when
the last check (kept in `state/update-check.json`) is under an hour old. This refines FR-81; the owner reviews it.

**Why `/releases`, not `/releases/latest`**: measured 2026-10-21, `/latest` returns **404** while every release is a
pre-release, so a check built on it would always say *up to date*.

**Why it can never slow the poll**: it has its own timer and its own request, and never shares the Spotify client,
its queue or its budget.
