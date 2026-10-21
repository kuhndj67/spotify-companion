# U10 — Data Safety — HANDOFF

**The single entry point for U10.** Read this, then the current stage's document.

## ▶ Current state (2026-10-22) — Functional Design WRITTEN, awaiting owner approval

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
