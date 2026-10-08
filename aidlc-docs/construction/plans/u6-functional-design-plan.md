# U6 Functional Design Plan — User-Data Lifecycle

**Date**: 2026-10-06 · **Stage**: CONSTRUCTION — Functional Design, Unit **U6** (Phase 5)
**Status**: ✅ **FD APPROVED by the user 2026-10-07.** ✅ **ALL QUESTIONS ANSWERED (2026-10-07).** Settled reading in §10. FD artifacts in `../u6-data-lifecycle/functional-design/` — awaiting approval. FR-57…FR-64 ratified 2026-10-07 (Requirements Question 12 = A).
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: `requirements.md` **W-5** · [`../u6-data-lifecycle/HANDOFF.md`](../u6-data-lifecycle/HANDOFF.md)
· Phase 5's plan · the shipped `db:backup` / `db:restore` pair (2026-09-27)

> ⚠️ **U6 is a PREREQUISITE, not a feature.** Phase 5's off-machine deployment cannot responsibly touch a
> corpus that cannot be moved back. It was promoted from backlog W-5 by the user's question on 2026-10-06.
>
> ⚠️ **And it extends a working pair rather than replacing one.** `db:backup` / `db:restore` have a
> rehearsed round trip and have been used in anger twice. **Starting over would discard a verifier that has
> already caught a real corrupt snapshot, and a self-test that proves it can fail.**

---

## 1. Unit context

| | |
|---|---|
| **Phase** | 5 — *Share* |
| **Type** | **Infrastructure** — its output is a *property* (the corpus can move), not a screen |
| **Stories** | ⚠️ **None.** U9 is the consumer. Recorded so nobody invents one later to justify it |
| **Requirements** | **W-5** (promoted). ⚠️ No FR covers this — see **Q6** |
| **Blocks** | **U9** (off-machine deployment), and Phase 5's **Q2** and **Q5** |
| **Schema** | ⚠️ **None expected.** If a migration appears in this unit, something has gone wrong |

---

## 2. Facts measured for this plan — 2026-10-06

| | |
|---|---|
| Corpus | **977 plays** · 1,214 decision rows · 42 skip attempts · schema v7 |
| `history.db` | 3.6 MB · ⚠️ `-wal` has been **larger** than the `.db` (3673 vs 3396 KB) |
| Backups in `data/` | 13 directories, 5 naming conventions · **1 deliberately CORRUPT** |
| Verified-restorable | ⚠️ Only those with a manifest; the pre-2026-09-27 ones are **intact-but-unknown** |
| What the backup covers | **`history.db` only** |
| Mounts that hold state | `./data:rw` · `./config:ro` · `./state:rw` · `./secrets/*` · + the `metabase-app-db` **named volume** |

---

## 3. Questions

### Q1 — ⭐ How does the guard know whether the far end holds the database?

**This is the unit's central problem.** `assertNobodyElseHoldsIt` queries the **local** `docker ps`, so a
cross-machine restore gets a confident *"nothing is running"* about the wrong computer.

> ⚠️ **This is the U4 corruption's shape, one layer out.** The original lock probe could not see the
> container because SQLite's locks do not cross the bind mount — **green exactly when the danger was
> present**. `docker ps` fixed it. Across machines, `docker ps` is blind again.

| | Option | How it fails |
|---|---|---|
| **A** | ⭐ **Refuse cross-machine operation entirely.** Require the restore to run **on the machine that owns the file** | Safe by construction; inconvenient |
| **B** | `DOCKER_HOST` pointed at the far end | ⚠️ Then it cannot see the **local** container. One daemon at a time, either way |
| **C** | A **liveness marker in the database**, written by the running app and checked by the script | Works across machines and filesystems — but ⚠️ is a **heartbeat**, and a stale one reads as *dead*. The WAL-mtime finding is the cautionary tale |
| **D** | Ask the app: `GET /api/health` on the far end before writing | ⚠️ Requires reachability, which Phase 5 Q1 has not settled, and an unreachable app reads as *stopped* |

⚠️ **A is the recommendation and it is deliberately the boring one.** Every other option replaces a guard
that is *blind* with one that can be *wrong*, and this project has shipped two decorative guards already.
A refusal that is occasionally annoying is strictly better than a check that returns green at the worst
moment.

⚠️ **Whatever is chosen, it must be DEMONSTRATED REFUSING**, not asserted. A guard nobody has watched say
no is decorative.

[Answer]:
A - I'm assuming this means a separate "Upload" to stage the restore file locally then a restore using that file?
---

### Q2 — What travels, and what must not?

| | Travels? |
|---|---|
| `data/history.db` | ✅ the point |
| `config/rules.json` | user-authored — **Q2a: copy, or re-author?** |
| `secrets/spotify-config.json` | ⚠️ a **refresh token**, rewritten by the MCP server — **Q2b** |
| `secrets/musicbrainz.json` | NFR-14 contact address — user data, not config |
| `data/artist-credits.json`, `snapshots/`, `reporting/` | regenerable |
| `metabase-app-db` volume | ⚠️ regenerable, and **no tree-walking backup would find it** |
| **`state/automation-state.json`** | ⚠️⚠️ **NO — see below** |

> ⚠️⚠️ **`state/` MUST NOT TRAVEL, and the reason is the whole of Infrastructure Q1.** The kill switch is on
> its own mount *specifically* because *"restoring a week-old backup would restore the week-old latch and
> **silently re-arm automation**"*. **A backup that helpfully includes `state/` is a backup that can re-arm
> playback control.** The *"back up everything"* instinct must stop here, and the exclusion needs to be
> enforced in code rather than remembered.

| | Option |
|---|---|
| **A** | ⭐ **Tiers**: `corpus` (history.db) · `user-authored` (rules, contact) · `credentials` (opt-in, explicit) · `derived` (never) · **`state` (never, enforced)** |
| **B** | One archive of everything except an exclusion list |

⚠️ **B's failure mode is a quiet one**: an exclusion list is a denylist, and a new state file added later is
included **by default**. A tiered allowlist fails the other way — a new file is missed, which is visible.

[Answer]:
A
---

### Q3 — ⚠️ Restore is ONE-WAY. Is that enforced, or just documented?

Dedup is keyed on `played_at` **within one database**. Two deployments recording the same account produce
overlapping plays **and colliding `observation` / `decision_log` / `skip_attempt` ids**. **No merge exists
and none is designed.**

So *migrate* and *run both* are different decisions, and the second forecloses going back.

| | Option |
|---|---|
| **A** | Document it loudly |
| **B** | ⭐ **Record provenance in the restored database** — which machine, when, from which backup — so a later reader can tell a migrated corpus from a native one |
| **C** | Build merge tooling |

⚠️ **C is out of scope and should be refused explicitly**, or it will be attempted when two corpora have
already diverged — the worst moment. ⚠️ **B's value is R2-shaped**: a corpus that cannot say where it came
from will eventually be analysed as though it had always been there.

[Answer]:
A - the hostname is not relevant information and a restore never merges it just replaces whatever is currently on the host (with the exception of credentials if the user does not opt-in)
---

### Q4 — The 12 unverifiable legacy backups

`data/` holds 13 backup directories in **5 naming conventions**; only the post-2026-09-27 ones carry a
manifest. The first sweep found **0 of 11 fully verified and 1 CORRUPT**.

| | Option |
|---|---|
| **A** | ⭐ Leave them, keep reporting `unverifiable` as its own verdict \u2014 **not** a failure |
| **B** | Retrofit manifests by computing them now |
| **C** | Delete the unverifiable ones |

⚠️ **B is actively harmful**: a manifest computed *now* records what the file says today, so it certifies a
possibly-already-damaged backup as intact. **It converts "unknown" into a false "verified"** — the exact
confusion the three-way verdict exists to prevent. ⚠️ **C deletes the only copies of some corpus states.**

[Answer]:
C - just make sure you don't delete the current verfied db.
---

### Q5 — Does U6 own the `metabase-app-db` volume?

W-5 names it because **no tree-walking backup would find it**. But it holds *dashboards and questions* —
derived from `history.db`, and recreated by `npm run reporting:metabase`.

| | Option |
|---|---|
| **A** | ⭐ Out of scope. It is **derived**; document how to recreate it |
| **B** | In scope — `docker run --volumes-from` to tar it out |

⚠️ **A has a cost that should be stated rather than discovered**: hand-authored Metabase questions are
**not** in `reporting:metabase` and would be lost. If the user has any, A is wrong.
**Q5a: are there hand-authored questions?**

> ✅ **Q5a MEASURED 2026-10-06 — no.** `GET /api/card` and `/api/dashboard` (read-only, via the API key in
> `secrets/metabase.json`) return **32 cards and 3 dashboards**. **6 cards + 2 dashboards** are the
> Spotify ones, and every one is built by **`npm run reporting:report`** (`scripts/metabase-report.mjs`).
> The other **26 cards + "E-commerce insights"** are Metabase's bundled **sample content**, not user work.
>
> ⚠️ **Corrects this question's premise**: `npm run reporting:metabase` creates **no** questions — it only
> registers `reporting.db` and syncs the schema. **Recreating the volume is two commands**:
> `reporting:metabase` then `reporting:report`. Option A stands on the corrected premise.

[Answer]:
A
---

### Q6 — Does this unit get FRs, or stay a W-item?

⚠️ Every previous unit traced to numbered **FR**s. U6 has **none** — W-5 is a wishlist entry, and the
wishlist is explicitly *not* requirements.

| | Option |
|---|---|
| **A** | ⭐ Promote to **FR-57…FR-6x** under a new *Operations* heading |
| **B** | Leave it as W-5; let the FD stand alone |

⚠️ **B breaks traceability**: the build-and-test summaries all close by mapping FRs to status, and a unit
with nothing to map cannot be *shown* complete — only asserted complete. ⚠️ **A's cost is that
`requirements.md` grows a category it was not designed for**, and FR numbering has so far meant
*user-visible behaviour*. Worth being deliberate about rather than drifting into.

[Answer]:
A - We're promoting this work to a first class unit of work... follow the same process for prior units.
---

## 4. What this unit will NOT do

| | Why |
|---|---|
| Merge two corpora | **Q3.** Refused explicitly so it is not attempted after divergence |
| Any schema migration | ⚠️ If one appears here, the design is wrong |
| Back up `state/` | ⚠️ Would make a restore able to re-arm automation |
| Retrofit manifests onto legacy backups | **Q4** — converts *unknown* into a false *verified* |
| Scheduled/automatic backups | ⚠️ A writer on a timer is a second writer. Out of scope until the guard question is settled |
| Decide Phase 5's security posture | Phase 5 **Q1**. U6 must not smuggle a reachability decision in |

---

## 5. Exit criteria (draft — the FD may sharpen these)

- [ ] ⚠️ **A corpus backed up on one machine, restored on another, and the restored app runs.** Not provable
      by any test
- [ ] ⚠️ **The guard DEMONSTRATED refusing**, with the far end live
- [ ] Everything in Q2's travel tiers travels; **`state/` provably does not**
- [ ] `--verify-only` passes on the moved backup **before** `--apply`
- [ ] One-way-ness surfaced where someone about to run it will see it
- [ ] `npm run smoke` still passes — ⚠️ it invokes these scripts, so this unit can break the guard that
      guards it

---

## 6. Follow-up questions — raised by the answers, 2026-10-06

Q2 = A, Q5 = A and Q3 = A are unambiguous. ⚠️ Q3's answer **declines provenance** and fixes the semantics:
*a restore never merges; it replaces what is on the host, except credentials unless the user opts in.*
The three below are where an answer leaves a design-shaping choice open.

### FQ1 — ⭐ (from Q1) Who performs the restore on the target, and how does the backup get there?

The Q1 answer reads it correctly: **stage the backup on the target machine, then restore there**, so the
guard's `docker ps` interrogates the daemon that owns the file. ⚠️ **But that moves the problem rather than
removing it**: the restore script needs **Node and the repo on the target host**. A Synology host does not
normally have Node — ⚠️ **not checked**, and the target may not be a NAS for every user. And a restore run
*inside* a container cannot call `docker ps` at all.

| | Option | Consequence |
|---|---|---|
| **A** | Copy the backup directory to the target; run `npm run db:restore` **on the target host** | Needs Node + checkout there. Guard unchanged and correct |
| **B** | ⭐ **The app restores itself at startup.** Copy the backup into `data/restore-pending/`, restart the container; the app runs the **existing verifier**, swaps `history.db` in **before it opens the database**, and moves the staged copy aside | ✅ **No second writer exists by construction** — the one writer does it before writing, so the cross-machine guard question disappears. Works on any Docker host. ⚠️ Moves restore code into `src/` (the verifier must become importable by the app), and a failed verify must **refuse loudly and start on the old database** — never start empty |
| **C** | Upload through the UI | ⚠️ A write endpoint on an app whose access model is undecided (Phase 5 Q1). Rejected |

⚠️ **Under B the app can restore `history.db` only.** `config/` is `:ro` to the app (deliberately —
Infrastructure Q1) and must stay so, so **rules, contact address and opted-in credentials are copied as
plain files by the operator, with the container down** (the MCP server rewrites `spotify-config.json`, so
copying it live is a race). That copy belongs in the install/restore routine — see Phase 5 Q8.

[Answer]:
I'm confused by this question so maybe a research task needs to be executed? I don't think we should have to take application completely down to backup and restore the history and user data. We may need a 'quiesce' feature that tells the app to stop using the database while the two steps are performed (if we don't already have that) but why would we need to take the whole environment down? 


### FQ2 — (from Q4 = C) Exactly what is deleted?

`npm run db:verify-backups`, run 2026-10-06:

| Verdict | Count | Directories |
|---|---|---|
| ✅ `verified` | 3 | `before-migration-007-20260929T172027Z` · `before-migration-007-deploy-20261003T135418Z` · `before-skip-source-repair-20261004T144411Z` (901 plays) |
| ⚠️ `unverifiable` | 10 | every `backup-*` directory without a manifest |
| ✖ `corrupt` | 1 | `CORRUPT-snapshot-20260921-201444` |

⚠️ **The corrupt snapshot is NOT a backup — it is the negative control `db:restore -- --self-test` runs
against, and the script errors if it is missing.** Deleting it removes the only proof the verifier can fail.

⚠️ And the newest verified backup holds **901 plays against 977 live** — it is the *latest verified*, not
*current*.

| | Option |
|---|---|
| **A** | ⭐ Delete the **10 unverifiable** only. Keep the 3 verified, keep the corrupt control, and **take a fresh verified backup first** (needs a brief `docker compose down`) so the newest verified copy is current before anything is removed |
| **B** | A, without the fresh backup |
| **C** | Also delete the corrupt snapshot, and replace `--self-test`'s fixture with a synthesised corrupt file |

⚠️ Deletion is a one-off housekeeping action, not U6 code. **It will be done only after you confirm the
list**, and it is irreversible.

[Answer]:
A - and the fact that you need 'docker compose down' before taking a backup tells me we don't currently have the ability to quiesce the app so database operations can execute cleanly. Please take a look at the work/risk of implementing an app quiesce function that safely allows database maintenance. If it will be expensive/risky then I'll reconsider the database maintenance approach I was assuming we'd use.

### FQ3 — (from Q6 = A, *"follow the same process as prior units"*) Does that include a user story and every stage?

Prior units each had **stories** and ran **FD → NFR Requirements → NFR Design → Infrastructure Design →
Code Generation → Build & Test**. This plan recorded U6 as *"the first unit with NO user story"* —
deliberately, so nobody invented one.

| | Option |
|---|---|
| **A** | ⭐ **Full process**: FRs under a new *Operations* heading, **one story** for the owner persona (*"move my corpus to a new machine without losing or re-arming anything"*), and every stage including NFR and Infrastructure Design |
| **B** | FRs and every stage, but **no story** — the *"no story"* note stands |

⚠️ **A's story is not invented to justify the unit**: Q6's answer is that this is now first-class user
work, and the user's own NAS question (2026-10-06) is the story's source.

[Answer]:
A - upgrading the wish list to a first class unit so we should follow the entire unit process.
---

## 7. Database maintenance without taking the app down — findings and questions (2026-10-07)

The FQ1/FQ2 answers ask the right question: **why does maintenance need `docker compose down` at all?**
Answer: **because the scripts run as a second process, on the host.** SQLite's locks do not cross the
Rancher bind mount, so a host process cannot coordinate with the app — the only safe move was to remove
the app. ⚠️ **That is a property of *where the scripts run*, not of SQLite.** Move the work into the app's
own process and most of the constraint disappears.

### 7.1 Measured 2026-10-07

| | Finding |
|---|---|
| ✅ **Online backup works in-process** | `node:sqlite` exports `backup()` on **Node 22.17** (the image is `node:22`). Probed on a **scratch copy** of the verified 901-play backup: **281 writes on the same connection interleaved with the backup**, copy finished in **145 ms**, `integrity_check: ok`, **901/901 plays**, and the copy is a clean point-in-time (280 of 281 probe rows — the last landed after it finished). **No quiesce, no downtime.** |
| One connection | All writes go through **3 repository classes sharing one `DatabaseSync`** (`SqliteHistoryRepository`, `SqliteDecisionLogRepository`, `SqliteSkipAttemptRepository`). So "the app's database" is one handle — which is what makes in-process backup trivially consistent |
| Writers that a *live* quiesce would have to pause | poll tick → `PlayObserver` (holds an **open play in memory**) · 6-hourly backfill timer · label/MusicBrainz queue · decision log · `SkipExecutor` drain · liked refresh. ⚠️ Six independent drivers, each would need a *paused* branch, and a write that races the close would throw inside the poll loop |
| Restart recovers gaps | On start the app imports `recently-played` (`[backfill] 1 inserted, 49 already known`), so plays during a short outage come back as `not-observed` rows. ⚠️ **Restart duration NOT measured** — the live container was not restarted for this |
| ⚠️ A restore discards recent plays **by definition** | Q3 = *replace, never merge*. Anything recorded between the backup and the restore is gone either way — **so a live quiesce protects nothing during a restore**. The only plays it would save are the seconds of the restore itself, and the backfill recovers those |

### 7.2 Proposed plan of attack (for reaction, not yet design)

| Operation | Today | Proposed | Downtime |
|---|---|---|---|
| **Backup** | `compose down` → host script → `compose up` | ⭐ **The app backs itself up** via `backup()`; manifest + verification as today | **None** |
| **Restore** | `compose down` → host script → `compose up` | ⭐ **Stage, then restart**: drop the backup in `data/restore-pending/`, `docker restart` (not `down`); the app verifies and swaps **before opening the database** — FQ1 option B | A restart (seconds — to be measured) |
| **Live quiesce** (pause all writers, close the handle, reopen) | — | ⚠️ **Do not build.** Six drivers to pause, a new failure mode in the recording path, and §7.1's last row says it buys nothing for restore | — |
| Repair / reclassify scripts | `compose down` | Unchanged — rare, developer-only. See M3 | Unchanged |

⚠️ **Why restart is not "the whole environment down"**: `compose down` removes the container and network;
a restart keeps both and is the same event as the reboot path that `restart: unless-stopped` already
survives daily. And **the one writer does the swap before it writes**, so no guard is needed — there is
no second process to guard against. That also dissolves Q1's cross-machine blindness rather than
working around it.

### M1 — How is a backup triggered?

| | Option | Note |
|---|---|---|
| **A** | ⭐ `npm run db:backup` stays the command, but **asks the running app** over HTTP (`POST /api/maintenance/backup`, behind `localGuard`) and falls back to today's offline path only when the app is down | Same muscle memory; one implementation of the copy. Precedent: `POST /api/liked/refresh` |
| **B** | A button in the UI (on a pop-up, per the clean-primary-screen rule) | Needs A's route anyway |
| **C** | `docker exec` a script **inside** the container | ⚠️ A second process on the same mount — whether SQLite locks work between two processes **inside** the VM is **unprobed**. Avoid unless probed |

[Answer]:
Backup/Restore and any other setting/maintenance tasks should be an app integrated process. Perhaps we need a "Settings" page linked from the main page (if we add a settings page we should move any diagnostics/debug pages to that location) 

### M2 — Now that backup is in-process, do you want SCHEDULED backups?

§4 excluded them because *"a writer on a timer is a second writer"*. **That reason no longer holds** if the
app does it on its own connection. Daily, keep N, verify each the day it is taken?

⚠️ But **`data/backups` on the same disk is not protection against losing the disk** — the
`--verify-only` lesson (*an unverified backup is a belief*) has a twin: *a backup on the same drive is a
copy*. Copying off-machine is **M4**.

[Answer]:
The only value I'd see in scheduled backup for this app (once it's 'in production') would be if those backups were then uploaded to an offsite location, and that would mean implementing a share drive or object store interface. I'm currently thinking that's not necessary so lets put that as a "we thought about it but decided not to do it now" item.

### M3 — Do the repair/reclassify scripts get the same treatment?

`reclassify-unobserved-tails`, `repair-*` rewrite rows. They are rare and developer-run. ⭐ Recommend
**leave them requiring `compose down`** — moving every maintenance write into the app is the *live
quiesce* by another name. Say so if you see them as user-facing maintenance.

[Answer]:
I think if we DO implement any sort of "clean up and repair" tasks that are user executed they'll need more thought than what we've put into the offline scripts... so lets leave them as developer only activities.

### M4 — Where should backups live?

| | Option |
|---|---|
| **A** | ⭐ `data/backups/` on the machine, **plus** a documented copy to somewhere else (the NAS, a cloud folder) — the copy is a file copy of a finished, verified backup, which is safe |
| **B** | The app writes directly to a second configured path (e.g. a NAS share) | ⚠️ A network path inside the container, and the WAL-on-network-filesystem advice applies to the **copy's** verification step |
| **C** | Out of scope for U6 |

[Answer]:
Save the backups to a backup folder and support a "zip and download" (let the user store them) 
---

## 8. What M1–M4 settled, what it changes, and what is still open (2026-10-07)

### 8.1 Settled

| | Decision |
|---|---|
| **M1** | **Backup, restore and any other user-facing maintenance are in-app.** A **Settings** surface linked from the main screen; ⚠️ the **Diagnostics** pop-up moves there |
| **M2** | **No scheduled backups.** Recorded as backlog **W-9** (*considered, not now*) — their only value is off-site, which needs a share/object-store interface |
| **M3** | Repair/reclassify **stay developer-only scripts** requiring `compose down`. User-run repair would need more thought than the scripts got |
| **M4** | Backups go to a **backups folder**, and the UI offers **zip and download** — the user decides where they live |
| FQ1 | ⇒ **B (staged restore at startup)**, now driven from the UI rather than a file drop |
| FQ2 | **A**, sequenced after the in-app backup exists: take a fresh verified backup **in-app**, then delete the 10 `unverifiable`. Corrupt control **kept** |
| FQ3 | **A** — full unit process, one story |

### 8.2 Measured for these answers

| | Finding |
|---|---|
| ✅ **The app can restart itself** | A throwaway container with `restart: unless-stopped` that **exits 0** was restarted **5 times in 20 s** (probed 2026-10-07). So *stage → `process.exit` → Docker restarts → swap before open* needs no user action. ⚠️ **Under `npm start` (host) nothing restarts it** — there the UI must say *"restart the app to finish"* |
| ⚠️ **`config/` is `:ro` to the app** (`compose.yaml:256`), deliberately (Infrastructure Q1) | **The app cannot restore `rules.json`** — see **S3** |
| ⚠️ **`secrets/spotify-config.json` is a SINGLE-FILE `:rw` bind mount** (`compose.yaml:188`) | The inode hazard: write-temp-then-rename **detaches** the container's view. Anything that restores it must write **in place**. `musicbrainz.json` is `:ro` (`:200`) |
| Existing primary-screen controls | **Export · Diagnostics · Rules** (`public/index.html:19–35`). Rules holds the **automation kill switch** |
| No archive dependency | Node has no built-in zip *writer*; zip means **one new dependency** (or `tar.gz`, built in via `zlib` + a small tar writer) |
| Download precedent | `GET /api/history/export` already streams a file to the browser |

### S1 — Settings: a page, or a pop-up like the others? And what moves into it?

You wrote *"page"*; the standing UI rule is *controls on pop-ups, the primary screen stays clean*. A
pop-up keeps the live now-playing view behind it; a separate page (`/settings`) needs its own WebSocket
or loses live status while open.

| What | Proposal |
|---|---|
| Diagnostics | ➜ **Moves to Settings** (your answer) |
| Backup / restore / backup list | ➜ **Settings** |
| Export (CSV/JSON of history) | ➜ ⭐ **Settings** — it is a data-out operation, the sibling of backup |
| **Rules + the automation kill switch** | ⚠️ ⭐ **Stays on the main screen.** FR-38's switch must stay **one click** from where the user hears the skip |

[Answer]:
Agree with the proposal and use the same pattern (pop-up) rather than adding a separate page.

### S2 — Restore: pick from the backups folder only, or also upload a zip?

Download makes a zip leave the machine; bringing it back to **another** machine (your NAS case) means
either uploading it or copying it into that machine's backups folder by hand.

| | Option |
|---|---|
| **A** | Restore **only from the backups folder** — cross-machine = copy the zip into the target's folder |
| **B** | ⭐ **Both**: pick from the folder, **or upload a zip** in Settings |

⚠️ **Either way, upload or not, restore is the highest-impact action in the app** — it replaces the whole
corpus. Proposed flow regardless of A/B: **verify the backup (existing 8 checks) → show its manifest
(date, plays, schema, source) → typed confirmation → automatic safety backup of the current DB → stage →
restart**. A backup that fails verification cannot be selected.
⚠️ **B adds a large-file write endpoint.** Fine behind today's loopback-only guard; **off-machine it
depends on Phase 5 Q1**, and must not ship ahead of it on a reachable host.

[Answer]:
I think adding a backup folder that's user managed is adding unnecessary complexity. In the future we may want to add a fully managed backup folder and management tools but for now please simplify the backup/restore process so to the user it looks as a simple "Create backup" that creates and downloads a backup and "Restore backup" that uploads and replaces the active database. Under the skin we can continue to have a backup folder and even have multiple backups in there but those would only be usable by developers. the use accessible backup and restore should not leave any files in the backup folder (it would be used as a temp storage point if needed) to avoid uncontrolled storage consumption. Also regarding zip... if there's another packaging tool that node does support (tar maybe?) use that. If not then go ahead and design in another package.

### S3 — ⚠️ What happens to `rules.json` on restore, given the app cannot write `config/`?

| | Option |
|---|---|
| **A** | ⭐ **The zip carries it; restore does not apply it.** Settings shows *"this backup includes rules — differs from yours / identical"* and the file stays for the user to place. `config/` stays `:ro` |
| **B** | Make `config/` `:rw` so restore writes it | ⚠️ Reverses Infrastructure Q1 — grants every route write access to hand-authored rules, and BR-20.8 does not protect against a valid-but-empty file |
| **C** | Rules are not in the backup at all |

[Answer]:
So if we move the app to an external appliance (synology nas or other) won't we need to be able to update the rules.json file from the app? so there will need to be: a upload/download process for rules.json updates similar to the backup process so that users can edit the file locally then upload it... OR a built in editor that users can run in the app to edit the file... or both?

### S4 — ⚠️ Credentials in the downloadable zip?

Q3's answer: credentials are replaced **only if the user opts in**. But a downloaded zip **leaves the
machine by design** — a Downloads folder, a cloud sync, an email. `spotify-config.json` holds a **refresh
token**, and `musicbrainz.json` your **email address**.

| | Option |
|---|---|
| **A** | ⭐ **Never in the zip.** A new machine gets credentials from the **install routine** (`npm run auth`, Phase 5 Q8). Restore never touches `secrets/` |
| **B** | Opt-in checkbox at backup time, with a warning; restore writes it **in place** (single-file mount) |

⚠️ A also removes the only restore path that would have to write through the single-file `:rw` mount.

[Answer]:
Again now that we're looking at an non-local deployment I think we need to consider how credentials are set/updated. I think we need settings fields for this stuff in addition to install time prompts for them. Perhaps since this is sensitive data we exclude it completely from the backup/restore process and the user needs to manage them separately for each installation of the app?

### S5 — The backups folder: who prunes it?

Each backup is ~4–8 MB today and grows with the corpus. With no scheduled backups (M2) it grows only when
the user acts — plus one **automatic safety backup per restore**.

| | Option |
|---|---|
| **A** | ⭐ **User-managed**: Settings lists backups (date, plays, size, verdict) with a **delete** button; nothing is deleted automatically |
| **B** | Keep the newest N automatically |

⚠️ B is a deleter on a timer — the one kind of automation this project has avoided pointing at user data.

[Answer]:
Refer to my comments above... if we treat the backup/restore as simple and self contained then any temp files used as part of the two processes are removed once the process is complete?
---

## 9. S1–S5 settled the backup/restore shape — and S3/S4 opened a second subject (2026-10-07)

### 9.1 Settled — the user-facing backup/restore is SIMPLE AND SELF-CONTAINED

| | Decision |
|---|---|
| **S1** | **Settings is a pop-up**, same pattern as Diagnostics and Rules. Holds Diagnostics, Backup/Restore, Export. **Rules + kill switch stay on the main screen** |
| **S2** | ⭐ **Two buttons, no folder in the user's model.** **Create backup** → builds and **downloads** one file. **Restore backup** → **uploads** one file and **replaces** the active database. ⚠️ A user-managed backups folder is **rejected as unnecessary complexity**; a *managed* folder with tools is a possible future item |
| S2 | `data/` backup directories remain a **developer-only** facility (the scripts). The user path uses disk only as **temp**, and leaves nothing behind |
| S2 | Archive: **use what Node supports, else a package.** ⚠️ Measured: Node has `zlib` (gzip) but **no multi-file archive writer** — neither zip nor tar. So a package is required either way; proposal in 9.2 |
| **S4** (partial) | ⭐ **Credentials are EXCLUDED from backup/restore entirely.** Each installation manages its own. Q3's *"credentials if the user opts in"* is **withdrawn** by this answer |
| **S5** | **Temp files are removed when the operation completes** — no uncontrolled storage growth |

### 9.2 Consequences carried into the design (stated, not asked)

- **Archive = `.tar.gz` via the `tar` package** (npm's own archiver, maintained by the npm team). Contents:
  `history.db` + `manifest.json` (+ `rules.json` per T1). ⚠️ **Upload is untrusted input**: extract only the
  expected entry names into a fresh temp directory, reject links, absolute paths and `..`, cap the size —
  archive path-traversal is the classic hole in exactly this feature.
- **Cleanup includes the failure paths**: temp removed in a `finally`, **and a startup sweep** removes
  leftovers from a crash mid-operation. ⚠️ The staged restore is the one temp file that **must survive** a
  restart — it is deleted **after** the swap, not before.
- **Restore flow**: upload → extract → **existing 8-check verifier** → show manifest (date, plays,
  schema) → typed confirmation → stage → exit → Docker restarts (probed) → swap **before the DB opens**.
  A backup that fails verification is refused with the verdict; the live DB is untouched.

### T1 — ⭐ Rules and credentials management: part of U6, or its own unit?

S3 and S4 both say the same thing: **on an appliance (NAS) the user cannot edit files on the host**, so
rules and credentials need in-app management. That is real and necessary for U9 — but it is a **different
subject** from moving a corpus, and it reopens decisions U6 was not built to carry (Infrastructure Q1's
`:ro` config; secrets as host-only files).

| | Option |
|---|---|
| **A** | ⭐ **New unit, "Configuration management"** (rules + credentials in-app), **also gating U9**. U6 stays *data lifecycle* and can finish first |
| **B** | Fold it into U6 |

⚠️ B makes U6 large and couples the corpus work to the two most security-sensitive decisions in the phase.

[Answer]:
A

### T2 — (if A, or for U6's backup contents) Rules: what does the user get?

Your S3 options, with what each costs:

| | Option | Cost |
|---|---|---|
| **A** | **Download / upload `rules.json`** | Small. Reuses the **U3 validator** — validate **before** writing, so a bad upload never replaces a good file |
| **B** | **Built-in editor** | Larger: an editing UI over a predicate tree, plus the same validate-before-write |
| **C** | ⭐ **A now, B later** | A is enough to make an appliance usable |

⚠️ **Either way the app must write rules, which Infrastructure Q1 refused** (`config/` is `:ro`). Where the
app-written rules live is a design decision: **not `state/`** — *"a kill switch stored in the same writable
directory as the file an AI agent edits is a kill switch that agent can disable"*. Likely a separate
`./rules:rw` mount, or `config/` becomes `:rw` with validate-before-write as the guard. That decision
belongs to the unit T1 places it in.

⚠️ And **is `rules.json` in the U6 backup archive?** ⭐ Recommend **yes, included; restore offers to apply
it only once the app can write rules** (i.e. after the T2 work exists). Until then it rides along unused.

[Answer]:
C - and yes that means the app now needs to be able to write rules... if there are secure patterns for doing this please use them (avoid creating security gaps). This same ask is true of ALL file ingest activities (db restore, rules, etc).

### T3 — Credentials in-app: settings fields + install-time prompts

Agreed in principle (S4). ⚠️ **One fact decides how hard this is, and it is UNPROBED**:

- Today's OAuth runs **host-side** (`npm run auth`) with redirect URI **`http://127.0.0.1:8888/callback`**
  (`secrets/spotify-config.example.json`). On a NAS, a browser following that redirect lands on **the
  browser's own machine**, not the NAS — **the in-app flow cannot reuse it.**
- Spotify's documentation says non-loopback redirect URIs must be **HTTPS**. ⚠️ **This project has been
  wrong about Spotify's docs six times — probe before designing**, because if true, in-app re-auth on a NAS
  needs TLS, which ties straight to Phase 5 Q1.

| | Option |
|---|---|
| **A** | ⭐ **Install-time only for the OAuth grant** (run the auth step on any machine with a browser, copy the result in); **in-app fields for the non-OAuth values** (MusicBrainz contact, client id) — write-only, never echoed back |
| **B** | Full in-app OAuth on the appliance — **gated on the HTTPS probe and Phase 5 Q1** |

[Answer]:
What are the implications of install time only... does that mean if for some reasons credentials change that the app will need to be re-installed? I think that's OK for now (adding full TLS in the future might be something we'd do but I recognize that adds more work)

### T4 — The pre-restore safety copy

Restore *replaces* (Q3). Without a copy of what it replaced, a wrong upload is unrecoverable — and S5 says
nothing should accumulate.

| | Option |
|---|---|
| **A** | ⭐ **Keep exactly ONE "previous database"**, overwritten by each restore. Bounded storage (one DB), and an **undo** for the most recent restore. Settings offers *"Undo last restore"* |
| **B** | Offer a download of the current DB before restoring, keep nothing |
| **C** | No safety copy |

⚠️ C means a mis-click on the wrong file loses the corpus — **the one artefact that cannot be regenerated**.

[Answer]:
A
---

## 10. ✅ Settled reading — the authoritative summary of §3–§9 (2026-10-07)

**Read this, not the raw answers above.** Where a later answer overrode an earlier one, the later wins.

| # | Settled | Overrides |
|---|---|---|
| 1 | **U6 = data lifecycle only.** Rules and credentials management is a **new unit, U7 Configuration Management**, which also gates U9 (T1 = A) | — |
| 2 | User-facing **backup and restore are in-app**, in a **Settings pop-up** with Diagnostics and Export. Rules + kill switch stay on the main screen (M1, S1) | Q1's *"run the script on the target"* |
| 3 | **Create backup** = the running app snapshots itself (`node:sqlite` `backup()`, no downtime) and **downloads one `.tar.gz`**. **Restore backup** = **upload** one archive, verify, confirm, **replace** (S2) | FQ1 file-drop staging |
| 4 | Restore is applied **at startup, before the database opens**: stage → exit → Docker restarts (probed) → swap. No second writer exists, so the cross-machine guard problem **dissolves** (FQ1 = B) | Q1's guard design |
| 5 | **Replace, never merge. No provenance recorded** (Q3) | — |
| 6 | **Exactly one "previous database"** kept, overwritten per restore — *Undo last restore* (T4 = A) | — |
| 7 | **Nothing else accumulates**: temp removed on completion, on failure, and by a startup sweep (S5) | M4's *"backups folder"* as a user concept |
| 8 | **Never in an archive**: credentials (`secrets/*`) and automation state (`state/*`) (S4, Q2) | Q3's *credentials if opted in* |
| 9 | **`rules.json` rides in the archive but is NOT applied by U6** — U7 makes the app able to write rules (T2) | — |
| 10 | **Every file ingest goes through ONE secure admission path**, reused by U7 for rules (T2's *"ALL file ingest"*) | — |
| 11 | `data/` backup directories and the `db:*` scripts stay a **developer-only** facility, as do repair/reclassify (S2, M3) | — |
| 12 | Legacy cleanup (FQ2 = A): after in-app backup exists, take a fresh one, then delete the **10 unverifiable**; keep the 3 verified and the CORRUPT control | Q4 = C's scope |
| 13 | Full unit process with **one story** and **FR-57+** under a new *Operations* heading (Q6, FQ3) | *"first unit with no story"* |
| 14 | No scheduled backups — **W-9** (M2). TLS for in-app OAuth — **W-10** (T3) | — |

### T3 — what "install-time only" means (the user asked)

**It does not mean reinstalling.** Normal operation never needs the user: the app refreshes its access
token itself. Credentials only change when the user **revokes the app's access, rotates the client secret,
or switches Spotify account**. Then the fix is: **re-run the auth step** (`npm run auth`) on any machine with
a browser, and put the resulting `spotify-config.json` in place on the deployment — under U7, by **uploading
it through the same secure ingest path**; until U7, by copying the file with the container down. One
command and a restart, not a reinstall. ⚠️ The redirect URI stays `http://127.0.0.1:8888/callback`, which is
why the auth step must run where the browser is. Full in-app OAuth needs TLS → **W-10**, accepted as later.
