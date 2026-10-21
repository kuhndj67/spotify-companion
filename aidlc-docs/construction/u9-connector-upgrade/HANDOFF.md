# U9 — Connector Upgrade & Publishable Image — HANDOFF

**The single entry point for U9.** Read this, then the current stage's document.

## ▶ Current state (2026-10-21, 17:30Z) — ✅ public; ✅ `1.0.0-beta.7` live and published

Repository and image public (PR #13 merged with the switch); beta.7 released and published by the `release`
environment's token (`audit.md`, 17:30Z). **Next: App-only walk ③** of `docs/INSTALL-APP.md` on a clean machine, no
token; on a pass, README's *coming soon* comes off and U9 closes. Owed: the collaborator's `v*` tag push refused.

### Earlier (2026-10-21) — PR #12 merged; the switch is PR `go-public`

PR #12 merged by the owner (install split, review triage, tag ruleset, release-environment publishing, one approval
on `main`; controls in `audit.md`). **PR `go-public`** holds the public-repository wording; the owner flips
visibility when merging it. Then: settings after the switch (private vulnerability reporting, package visibility,
fork-PR approval), release `1.0.0-beta.7` (the publish token's first real push), App-only walk ③.

### Earlier (2026-10-21) — going public: review done, the switch is next

`1.0.0-beta.6` live and published. **PR #12** (branch `install-docs-split`, open): the install documents split into
`docs/INSTALL-APP.md` / `docs/INSTALL-DEV.md`, version `1.0.0-beta.7` (**not yet tagged**), walk ② gaps, and the
pre-public review: [`code/pre-public-code-review.md`](code/pre-public-code-review.md) and
[`code/pre-public-solution-review.md`](code/pre-public-solution-review.md), **no blocker**, triaged into pre-switch
fixes and backlog **W-17…W-19** (`requirements.md` §5.1). Sequence and what is left:
[`code/public-readiness-review.md`](code/public-readiness-review.md) §6: merge PR #12 → the switch (owner's go-ahead,
with review 4.1's wording list) → next beta → App-only walk ③. U9 closes when walk ③ passes.

### Earlier (2026-10-18) — ✅ Code Generation COMPLETE (13 steps), awaiting approval → Build & Test

Read [`code/code-summary.md`](code/code-summary.md): files, deviations, controls seen to fail, and the **ordered list
owed to Build & Test** (version bump → acceptance on `:3011` → startup check → rehearsed crossing and rollback → live
crossing → first tag push → token probe and walk). Branch `u9-connector-upgrade`, **draft PR #3**, CI green. ⚠️
**Nothing deployed**: live is still `spotify-now-playing` on `1.0.0-beta.2` at the old pin. Public readiness:
[`code/public-readiness-review.md`](code/public-readiness-review.md), **not yet** (owner's disclosure choices).

### Earlier (2026-10-18) — Code Generation plan
[`u9-code-generation-plan.md`](../plans/u9-code-generation-plan.md): approved (Q1 = A branch + PR flow, Q2 = A).

### Earlier (2026-10-18) — Infrastructure Design

[`infrastructure-design/`](infrastructure-design/infrastructure-design.md): IN-U9-1…7, incl. the Build & Test order (IN-U9-7). Plan [`u9-infrastructure-design-plan.md`](../plans/u9-infrastructure-design-plan.md), all A.

### Earlier (2026-10-18) — NFR Design

[`nfr-design/`](nfr-design/nfr-design-patterns.md): P-65…P-75, LC-58…LC-68, PBT-73…PBT-78. Plan [`u9-nfr-design-plan.md`](../plans/u9-nfr-design-plan.md), all A. Upstream's suite passes 113/113 on Node 22.23 (probed).

### Earlier (2026-10-18) — Functional Design

[`functional-design/`](functional-design/business-rules.md): BR-68…BR-75, entities, logic model; story **US-32**. Answers: [`u9-functional-design-plan.md`](../plans/u9-functional-design-plan.md) (Q5 withdrawn as U10's). Nothing built. Inception round
approved by the owner 2026-10-18 (Requirements Q26–28, Units Q7; FR-73…75, NFR-40).

**Next stages** (as U5–U8): Functional Design → NFR Design → Infrastructure Design → Code Generation → Build & Test.

## What U9 is

Move the bundled `spotify-mcp-server` from `7b5fde63` (unlicensed) to **`6065ce5c`** (MIT), accounting for every
upstream change that reaches this app, **without adopting upstream's new features**. Then CI publishes
`ghcr.io/kuhndj67/spotify-companion:<version>` on release tags, and README *App only* gets walked steps. Everything is
named **`spotify-companion`**. U10 (the NAS) pulls this image.

## Facts to know before touching it (measured 2026-10-18; details in the plan's §2)

- 🔴 **Token refresh breaks at the new pin as mounted today.** Upstream writes `spotify-config.json` by temp + `rename`;
  on our single-file bind mount that is **`EBUSY`** (probed). Never deploy the new pin to the live install before
  the config-write fix is in and seen working on `:3011`.
- ✅ `getNowPlaying`'s output text is byte-identical across the move, and it is the only tool the app calls.
- ✅ The MCP v2 server handshakes with our v1 client (`2025-11-25`) and runs on Node 22.23, although upstream
  declares Node `>=26.8.1`.
- ⚠️ Renaming the container or service makes Compose start a **second** container: stop `spotify-now-playing` first,
  or two pollers write `data/history.db`.
- ⚠️ The image does not yet carry the connector's MIT `LICENSE`. Nothing may be published until it does (FR-74).
- ⚠️ U8's BR-66.5 says the `u4/u5/u6-rollback` tags go "when U9 completes". That was the **old** U9 (the NAS, now
  U10). U9 does not remove them.
- Code comments in `src/api.ts` and `compose.verify.yaml` still call the NAS "U9" (renumbered 2026-10-18; it is U10).
