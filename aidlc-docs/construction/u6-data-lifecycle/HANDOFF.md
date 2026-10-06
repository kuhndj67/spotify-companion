# U6 Handoff — User-Data Lifecycle · U6's single entry point

**Written 2026-10-06** at the U5/U6 boundary, as Phase 5 opened. **This is the only entry point for U6** —
there is no parallel status, resume or progress file, and one should not be created.

---

## ▶ CURRENT STATE — NOT STARTED. Functional Design is the next step.

**Nothing is built.** `src/` and `scripts/` are untouched by this unit. If `git status` shows otherwise,
something was started that this file does not know about.

▶ **Next: answer the questions in
[`../plans/u6-functional-design-plan.md`](../plans/u6-functional-design-plan.md).** Nothing is designed
until they are.

---

## Why this unit exists

⚠️ **It was promoted from backlog to prerequisite by one question** (user, 2026-10-06): *"does this raise a
required prerequisite? … we could backup the data on Rancher Desktop, start up the NAS hosted app and once
connected restore the data to that environment?"*

The answer is **yes, and the gap is narrower than it looks but sharper**. U7 cannot responsibly deploy
off-machine until a corpus can be moved and moved back.

**This is W-5**, which has existed in the backlog since 2026-09-27 and is now the gating item for a phase.

---

## ⚠️ What already works — do NOT rebuild it

| Command | Since | Status |
|---|---|---|
| `npm run db:backup -- --label x` | 2026-09-27 | Checkpoints the WAL, writes a manifest, sha256, per-table counts |
| `npm run db:restore -- <dir> --verify-only` | 2026-09-27 | **8 checks**, read-only, safe any time |
| `npm run db:restore -- <dir> --apply` | 2026-09-27 | Backs up what is there first |
| `npm run db:restore -- --self-test` | 2026-09-27 | Proves the verifier can **fail**, against a kept-corrupt snapshot |
| `npm run db:verify-backups` | 2026-09-27 | Read-only sweep over `data/` |

✅ **The round trip is rehearsed**: 850 plays → damaged to 0 → restored to 850, `integrity_check: ok`.
✅ **Used in anger twice**: before migration 007, and before the `skip_source` repair.

⚠️ **So U6 EXTENDS a working pair.** Starting over would discard a verifier that has caught a real corrupt
snapshot and a self-test that proves it can fail.

---

## ⚠️ The three gaps, measured 2026-10-06

### 1. ⭐ The guard goes blind across machines — this is the dangerous one

`assertNobodyElseHoldsIt` runs `docker ps` against the **local** daemon. Run a restore on this laptop
against a NAS-mounted path and local `docker ps` reports *"not running"* while **the NAS container is
running and holding that database open**.

> ⚠️ **This is the exact shape of the U4 corruption, one layer out.** The original guard was an exclusive-
> lock probe, which could not see the container because **SQLite's locks do not cross the Rancher Desktop
> bind mount** — it returned green precisely when the danger was present, and *"mechanically explains the
> U4 incident"*. `docker ps` fixed that. **Crossing machines reintroduces the same blindness**, because
> `docker ps` can only ever interrogate one daemon and it must be the one that owns the file.

⚠️ `SPOTIFY_CONTAINER_NAME` is configurable and does **not** help: the question is *which daemon*, not
which name.

### 2. The backup covers `history.db` and nothing else

| Not backed up | Why it matters |
|---|---|
| `config/rules.json` | **User-authored.** Retypeable, but theirs |
| `secrets/spotify-config.json` | ⚠️ A **refresh token**, and the MCP server **rewrites it** on refresh |
| `data/artist-credits.json`, `data/snapshots/`, `data/reporting/` | Regenerable |
| `metabase-app-db` **named Docker volume** | ⚠️ **No tree-walking backup would find it** |
| `state/automation-state.json` | ⚠️ **MUST NOT TRAVEL — see below** |

> ⚠️⚠️ **`state/` IS DELIBERATELY EXCLUDED, and this is the trap W-5 was written to flag.** Infrastructure
> Q1 put the kill switch on its own mount *specifically* because *"restoring a week-old backup would
> restore the week-old latch and **silently re-arm automation**"*. **A backup that helpfully includes
> `state/` is a backup that can re-arm playback control.** Any "back up everything" instinct must stop here.

### 3. ⚠️ There is no merge, and restore is one-way

Dedup is keyed on `played_at` **within one database** (`hasPlayNearEnd`). Two deployments recording the
same Spotify account produce overlapping plays **and colliding `observation`, `decision_log` and
`skip_attempt` ids**. No merge tooling exists and none is designed.

⚠️ **So *migrate to the NAS* and *run both* are different decisions, and the second forecloses going
back.** That coupling is why Phase 5's Q2 and Q5 both depend on this unit.

---

## Constraints inherited from the project

⚠️ **A backup is NOT a file copy.** The WAL can be **larger** than the `.db` (3673 KB vs 3396 KB,
measured), and a `.db`-only copy held **824 of 850 plays** — **3%, confined to the newest rows**, and it
reports `integrity_check: ok`. ⚠️ **The corrected reading is MORE dangerous than the original wrong one**:
a 50% loss announces itself, 3% of the most recent plays does not. **Checkpoint first.**

⚠️ **Row counts are not verification.** `data/CORRUPT-snapshot-20260921-201444` reports a plausible 586
plays and **fails `integrity_check`**. The converse also holds: a backup with one play deleted returns
`integrity_check: ok`. **Integrity sees damage, the manifest sees incompleteness, and neither sees the
other's failure** — which is why verification is both plus a three-way verdict.

⚠️ **Do not delete `data/CORRUPT-snapshot-20260921-201444`.** It is the load-bearing negative control for
`--self-test`, and the script errors out if it is missing.

⚠️ **`data/` holds the only artefact here that cannot be regenerated**, and being gitignored makes it
**more** exposed to `git clean -xdf`, not less.

---

## Exit criteria (proposed — the FD may sharpen these)

- [ ] ⚠️ **A corpus is backed up on one machine and restored on another, and the restored app runs** —
      the unit's whole point, and not provable by any test
- [ ] ⚠️ **The guard refuses a cross-machine restore while the far-end container is running** —
      demonstrated, not asserted. A guard that has never been seen to refuse is decorative
- [ ] Everything that should travel, travels; **`state/` does not**
- [ ] `--verify-only` passes on the moved backup **before** it is applied
- [ ] The one-way nature of restore is documented where someone about to run it will see it

---

## Before running anything that touches a database

⚠️ **`docker compose down` first**, and ⚠️ **on the machine that owns the file** — which is the whole
subject of gap 1.
