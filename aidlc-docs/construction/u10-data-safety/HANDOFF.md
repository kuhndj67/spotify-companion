# U10 — Data Safety — HANDOFF

**The single entry point for U10.** Read this, then the current stage's document.

## ▶ Current state (2026-10-21, 23:30Z) — Functional Design plan OPEN (Q1–Q6)

The plan is [`construction/plans/u10-functional-design-plan.md`](../plans/u10-functional-design-plan.md). Its §2 holds
the facts measured for it; three of them reshape the requirements and are why Q1 and Q2 exist:

- The scheduled "snapshots" are **CSV exports** and cannot be restored (Q2).
- No backup is ever **kept** on disk: *Create backup* streams its archive to the browser and deletes it (Q2).
- A throwaway container (FR-79's `update`) is refused by the app's Host check (`403`), and on Linux probably cannot
  reach a `127.0.0.1`-published port at all (Q1).

Measured and settled: a lock file is exclusive across the Rancher bind mount in **both** directions (`EEXIST`), so
FR-77's mechanism stands.

**Next**: the owner answers Q1–Q6; then the four FD documents in `functional-design/`. Business rules start at
**BR-78**. ⚠️ Until U10 ships, no automatic backup is being made: take **Settings → Create backup** by hand.
