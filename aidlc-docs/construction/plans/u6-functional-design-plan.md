# U6 Functional Design Plan — User-Data Lifecycle

**Date**: 2026-10-06 · **Stage**: CONSTRUCTION — Functional Design, Unit **U6** (Phase 5)
**Status**: 📋 **PLAN — 6 questions open.** Nothing is designed until they are answered.
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
| **Stories** | ⚠️ **None.** U7 is the consumer. Recorded so nobody invents one later to justify it |
| **Requirements** | **W-5** (promoted). ⚠️ No FR covers this — see **Q6** |
| **Blocks** | **U7** (off-machine deployment), and Phase 5's **Q2** and **Q5** |
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

[Answer]:

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
