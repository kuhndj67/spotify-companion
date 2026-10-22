# U10 — Data Safety — HANDOFF

**The single entry point for U10.** Read this, then the current stage's document.

## ▶ Current state (2026-10-22) — Infrastructure Design WRITTEN, awaiting owner approval

Plan [`construction/plans/u10-infrastructure-design-plan.md`](../plans/u10-infrastructure-design-plan.md): **Q1 B**
backups always in `data/backups/` (⚠️ residual risk accepted: database and backups share one deletion event; the
documents tell users to copy `data/backups/` elsewhere), **Q2 A** rehearse the first deploy on `:3011` with a restored
copy of the owner's backup. Documents: [`infrastructure-design/`](infrastructure-design/), **IN-U10-1…8**.
`SNAPSHOT_DIR` retired (ignored if an old folder sets it); `BEFORE_CHANGE_KEEP` optional (default 5).

**Next**: owner approval → **Code Generation** plan. ⚠️ Until U10 ships, take **Settings → Create backup** by hand.

### Earlier (2026-10-22) — NFR Design written; ✅ approved by the owner the same day

Plan [`construction/plans/u10-nfr-design-plan.md`](../plans/u10-nfr-design-plan.md): Q1 A (heartbeat 5 s, stale window
30 s), Q2 A (free-space check: 2 × database + WAL + 100 MB), Q3 X: an always-visible **Status** light pointing to
Diagnostics, and **Diagnostics** promoted to a header button (Settings · Diagnostics · Rules), amending **FR-63**;
added to the FD as BR-86.5–86.6. Documents: [`nfr-design/`](nfr-design/), **P-76…P-87**, **LC-69…LC-80**,
**PBT-79…PBT-89**. Schema v7 → v8 (one metadata table).

**Next**: owner approval → **Infrastructure Design** (the live cross-mount lock probe, `data-dev/` ignores, the
`update` entrypoint, migration 8 on a copy) → Code Generation. ⚠️ Until U10 ships, take **Settings → Create backup**
by hand.

### Earlier (2026-10-22) — Functional Design written; ✅ approved by the owner the same day

Plan Q1–Q6 answered, **all A** ([`construction/plans/u10-functional-design-plan.md`](../plans/u10-functional-design-plan.md)).
FD documents: [`functional-design/`](functional-design/) — `business-logic-model.md`, `business-rules.md`
(**BR-78…BR-86**), `domain-entities.md`, `frontend-components.md`. Requirements amended to match (FR-56, FR-76,
FR-79, FR-80); story **US-33** added.

What the answers decided:
- **Q1** the updated app backs up before its first run (a version change is a risky change); `update` only rewrites
  the image line.
- **Q2** every automatic backup is the restorable U6 archive, kept in `data/backups/{scheduled,before-change}/`,
  rotated per kind; the CSV timer is retired.
- **Q3** the lock covers the app and every writing script, replacing `docker ps`. **Q4** `data-dev/` for `npm start`
  only. **Q5** backups shown as status in Settings, no list. **Q6** US-33.

Agent decisions in the FD for the owner's review (each named in `audit.md`): the startup lock **watches** the
heartbeat for one stale window rather than judging age (a just-killed container looks fresh); the update check's
startup request is skipped if the last check was under an hour ago (a restart loop would otherwise call GitHub per
restart); `npm run release` refuses when the app is unreachable unless `--app-is-down`; five before-change backups
kept; the last app version is stored in the database by a new migration; a new **Version** section in Settings.

**Next**: owner approval of the FD → **NFR Design** (timings: heartbeat, stale window; PBT numbers) → Infrastructure
Design → Code Generation. ⚠️ Until U10 ships, no automatic backup is being made: take **Settings → Create backup** by
hand.

### Earlier (2026-10-21, 23:30Z) — Functional Design plan OPEN (Q1–Q6)

Measured for the plan: the scheduled snapshots are unrestorable CSV exports; no backup is kept on disk; a throwaway
container is refused by the Host check (`403`); a lock file is exclusive across the bind mount both ways (`EEXIST`).
