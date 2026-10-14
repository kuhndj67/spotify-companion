# U8 — Team Workflow & Onboarding — HANDOFF

**The single entry point for U8.** Read this, then the current stage's document.

## ▶ Current state (2026-10-14)

✅ **Infrastructure Design APPROVED 2026-10-14** — [`infrastructure-design/`](infrastructure-design/infrastructure-design.md) (IN-U8-1…7). ▶ **Code Generation plan open** — [`u8-code-generation-plan.md`](../plans/u8-code-generation-plan.md), 12 steps, **1 question** (GPL-3.0-only vs -or-later). Plan Q1–Q7 all **A**. FD amended: walk ① on **`kuhndjwin11pro`**, macOS **untested**, BR-61.10 withdrawn. ⚠️ **Owner work on the VM before the walk** (not code): base B1–B7, the inventory, the `clean` checkpoint with its revert control, then the **canary probe** C0–C3 — order at the end of `infrastructure-design.md`. These can run in parallel with Code Generation; walk ① needs both.

### Earlier (2026-10-12)

✅ **Functional Design APPROVED 2026-10-12**, amended the same day: the **agent cold walk runs on the owner's clean MacBook** with a fresh Claude Code session (BR-61.3, 61.10, 62.2, 62.6). ✅ **NFR Design APPROVED 2026-10-13.** ▶ **Infrastructure Design plan open — 7 questions**: [`u8-infrastructure-design-plan.md`](../plans/u8-infrastructure-design-plan.md). ⚠️ The MacBook is too old; the walk machine is **`kuhndjwin11pro`** (Hyper-V Win11 VM — nested virtualization ✅, 16 GB fixed ✅) — the FD's MacBook amendment is replaced there (Q1). Functional Design: `functional-design/` holds BR-61…BR-67, entities, logic model
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
