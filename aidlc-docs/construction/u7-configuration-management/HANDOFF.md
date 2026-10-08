# U7 Handoff — Configuration Management · U7's single entry point

**Written 2026-10-08.** This is the only entry point for U7 — no parallel status or resume file.

## ▶ CURRENT STATE — ✅ CODE GENERATION COMPLETE (2026-10-08), AWAITING REVIEW. NOTHING DEPLOYED.

All 13 steps done — [`code/code-summary.md`](code/code-summary.md); deviations beside each step in the
[plan](../plans/u7-code-generation-plan.md). `npm run verify` green, **1563 tests**. Probes P-U7-1…3 passed
([record](probes/p-u7-1-3-2026-10-08.md)). ▶ Next: **Build & Test** — deploy per `infrastructure-design/`
(IN-U7 deployment steps), then click and LOOK at every new control.

⚠️ **The UI has not been seen in a browser yet.** ⚠️ Restarts are ~2 s longer (the MCP child's exit is awaited).

## Why this unit exists

On an appliance (U9's NAS) the user cannot edit host files, so **rules and credentials must be manageable from
inside the app**. Split out of U6 on 2026-10-07 (U6 FD T1 = A). Gates U8 and U9.

## ⚠️ Read before designing anything

- **It reverses a deliberate posture.** `config/` was made `:ro` (U5 Infra Q1) so no route could overwrite the
  hand-authored rules; BR-20.8's last-known-good does **not** protect against a valid-but-empty file.
- **Never `state/`.** The kill switch must not share a writable directory with a file an agent edits.
- **`spotify-config.json` is a single-file mount the MCP server rewrites in place**, at a hard-coded path.
- ⚠️ **Defect found while planning (2026-10-08):** a failed MCP `getNowPlaying` is returned as **plain text without
  `isError`**, so the app reads broken credentials as **"nothing playing"** and shows **"Spotify: ok"** — observed
  live on U6's credential-less copy. M4 counts these as idle polls. Plan Q6.
- **Reuse U6's admission path** (`ingestGuard`, `admitIngest`, caps) — never a second copy.
