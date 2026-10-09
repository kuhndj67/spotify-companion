# U7 Handoff — Configuration Management · U7's single entry point

**Written 2026-10-08.** This is the only entry point for U7 — no parallel status or resume file.

## ▶ CURRENT STATE — ✅ BUILD & TEST COMPLETE (2026-10-09 UTC) — DEPLOYED AND VERIFIED, AWAITING APPROVAL

Record: [`../build-and-test/u7-build-and-test-summary.md`](../build-and-test/u7-build-and-test-summary.md). Live on the U7
image; rollback image `u6-rollback` verified against U7's leftovers. Every exit criterion met, UI clicked and looked at.
1565 tests. ▶ After approval: **U8 Team Workflow & Onboarding** (Requirements Question 18 — app versioning — is open
for it). ⚠️ U8's install routine must agree with the Spotify guidance text in Settings (`ui/credentialsPanel.ts`).

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
