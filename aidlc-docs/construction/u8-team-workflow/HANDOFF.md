# U8 — Team Workflow & Onboarding — HANDOFF

**The single entry point for U8.** Read this, then the current stage's document.

## ▶ Current state (2026-10-12)

✅ **Functional Design APPROVED 2026-10-12.** ▶ **NFR Design plan open — 7 questions**: [`u8-nfr-design-plan.md`](../plans/u8-nfr-design-plan.md). Functional Design: `functional-design/` holds BR-61…BR-67, entities, logic model
and the one UI change (version display). Settled answers: [`u8-functional-design-plan.md`](../plans/u8-functional-design-plan.md) §3.
Requirements: FR-65, NFR-28, NFR-30–34 (NFR-34 = Q18, ratified 2026-10-12) · Stories US-30, US-31, persona P4
(Requirements Question 20, ratified 2026-10-12).

**Next stages** (as U5–U7): NFR Design → Infrastructure Design → Code Generation → Build & Test.

## What U8 is

A second person can install, review and contribute **without this project's tacit knowledge**. Its exit criterion
is an **agent cold walk** of `docs/INSTALL.md` (→ `1.0.0-beta.1`); a person's walk is the `1.0.0` trigger.

## Facts to know before touching it

- ✅ **GitHub Pro** since 2026-10-12: branch protection and rulesets are available (re-probed: 404 *not protected*,
  `[]`). Before Pro they returned 403.
- ⚠️ CI has **no** `smoke`, `knip` or secret scan yet.
- ⚠️ The app **refuses to start** without `secrets/musicbrainz.json` — a fresh install creates it by hand (BR-61.5).
- ⚠️ The MCP server has **no licence** — never publish an image (NFR-32).
- `SECURITY.md` channel: **kuhndj67@hotmail.com** until **W-14** (go public → GitHub reporting).
- Version is `0.1.0` in four places today; U8 makes `package.json` the only one and starts at **`0.8.0`**.
