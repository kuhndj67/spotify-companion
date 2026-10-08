# U7 Handoff — Configuration Management · U7's single entry point

**Written 2026-10-08.** This is the only entry point for U7 — no parallel status or resume file.

## ▶ CURRENT STATE — ✅ FUNCTIONAL DESIGN APPROVED (2026-10-08) · ✅ NFR DESIGN APPROVED · ✅ INFRASTRUCTURE DESIGN APPROVED · ▶ CODE GENERATION PLAN OPEN — 2 scoping questions, then approval: [`../plans/u7-code-generation-plan.md`](../plans/u7-code-generation-plan.md)

✅ Requirements ratified (Question 19 = A, 19a = A): **FR-66…FR-72, US-29** in `requirements.md` §3.8.
▶ **Review [`functional-design/`](functional-design/)** — `business-rules.md` (**BR-53…BR-60**, facts F1–F8, probes
P-U7-1…3), `domain-entities.md`, `business-logic-model.md`, `frontend-components.md`. Both decisions flagged for review were
**accepted** (2026-10-08): **BR-54.4** (an upload with no known base needs `REPLACE` rather than being refused) and
**BR-59.3** (one typed `RESTORE` covers database and rules).

⚠️ **Found while designing — read before code:**
- **A credentials file with no `accessToken` does not work** with the MCP server (falls back to client
  credentials). BR-56.4 writes a placeholder token with `expiresAt: 0` to force a refresh — **probe P-U7-1 on the
  `:3011` copy before writing that code**.
- **The plan's M4 claim was wrong**: text errors counted as *playing*, thrown errors as *idle*. FR-71 needs
  three-way poll outcomes (BR-58.3), not just the text-error fix.
- Evidence that a refresh token **survives reuse**: the MCP server has refreshed hourly for weeks with the same
  one (F3).

✅ Post-reboot checks passed 2026-10-08 (Docker CLI restored, `docker.log` fresh) — the `:3011` probes can run.

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
