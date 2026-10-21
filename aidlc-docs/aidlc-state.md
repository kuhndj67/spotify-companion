# AI-DLC State Tracking

## Project Information
- **Project Name**: Spotify Now Playing
- **Project Type**: Greenfield
- **Start Date**: 2026-08-24T13:17:23Z
- **Current Stage** (2026-10-21): CONSTRUCTION — **▶ U9 — going public.** `1.0.0-beta.6` live and published; **PR #12** (open) splits the install documents into `docs/INSTALL-APP.md` and `docs/INSTALL-DEV.md` and sets the version to `1.0.0-beta.7` (**not yet released**). App-only walks ① and ② **not passed**; their gaps are fixed in PR #12. ✅ Pre-public review by another model done (`construction/u9-connector-upgrade/code/pre-public-code-review.md`, `pre-public-solution-review.md`): **no blocker**; pre-switch document fixes made, the rest logged as **W-17…W-19**. ✅ PR #12 merged 2026-10-21 (publish hardened, controls passed). Next (`public-readiness-review.md` §6): **the switch**, at the owner's merge of PR `go-public` → release `1.0.0-beta.7` → walk ③, with no token. U9 closes when walk ③ passes. ✅ U10 Data Safety round approved; its FD follows U9. ⚠️ Snapshots stopped 2026-10-03 (FR-80).
  *(superseded 2026-10-21)* CONSTRUCTION — **▶ U9 — Build & Test: ✅ `1.0.0-beta.5` LIVE and PUBLISHED** (MIT connector; credentials in `secrets/app/`, the only folder mounted). **Remaining: the App-only cold walk** on Machine 1 (`construction/build-and-test/u9-app-only-walk.md`, the owner's time); on a pass, README's *coming soon* comes off and U9 closes. ✅ U10 Data Safety round approved; its FD follows U9. ⚠️ Snapshots stopped 2026-10-03 (FR-80). Public readiness: not yet.
  *(superseded 2026-10-18 23:55Z)* CONSTRUCTION — **▶ U9 — Build & Test: ✅ acceptance PASSED, ✅ `1.0.0-beta.3` LIVE (19:45Z)**, `spotify-companion` at the MIT pin; `spotify-now-playing` 1.0.0-beta.2 stopped and kept for rollback. Next: the owner's push of tag `v1.0.0-beta.3` (publishes the image), then the token probe and the App-only walk (`construction/build-and-test/u9-build-and-test-summary.md`). ✅ U10 Data Safety round approved; its FD follows U9. ⚠️ Snapshots stopped 2026-10-03 (FR-80). Public readiness: not yet.
  *(superseded 2026-10-18 19:50Z)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ Code Generation APPROVED (merged, PR #3); Build & Test IN PROGRESS** (order: `construction/u9-connector-upgrade/code/code-summary.md`; nothing deployed yet: live is `spotify-now-playing` 1.0.0-beta.2 at the old pin). ✅ **U10 Data Safety round APPROVED** (FR-76…80; NAS → **U11**, Team Operations → **U12**); its Functional Design follows U9. ⚠️ Snapshots stopped 2026-10-03 (FR-80); owner backup 2026-10-18 kept outside the repo. Public readiness: not yet.
  *(superseded 2026-10-19)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ Code Generation COMPLETE, **merged to `main` (PR #3)**, awaiting approval → Build & Test** (owed list: `construction/u9-connector-upgrade/code/code-summary.md`; nothing deployed: live is `spotify-now-playing` 1.0.0-beta.2 at the old pin). ▶ **INCEPTION, in parallel: U10 Data Safety declared** (FR-76…80; Requirements Q29–33 = A, Units Q8 = A; NAS → **U11**, Team Operations → **U12**), awaiting approval of the round. ⚠️ Automatic snapshots silently stopped 2026-10-03 (FR-80). Public readiness: not yet (`u9-connector-upgrade/code/public-readiness-review.md`). Work on branch `inception-data-safety`.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ FD, NFR, Infrastructure Design APPROVED; ✅ Code Generation COMPLETE (13 steps, 1701 tests, `npm run verify` green), awaiting approval → Build & Test.** Branch `u9-connector-upgrade`, draft PR #3 (standard branch + PR flow since 2026-10-18). Entry point `construction/u9-connector-upgrade/HANDOFF.md`; owed list in `code/code-summary.md`. ⚠️ Nothing deployed: live is `spotify-now-playing` 1.0.0-beta.2 at the old pin. Public readiness reviewed: **not yet**, owner disclosure choices (`code/public-readiness-review.md`). ▶ **Also open: Inception round for a new Data Safety unit before the NAS**: Requirements Q29–33, Units Q8 (owner, 2026-10-18; ⚠️ automatic snapshots silently stopped 2026-10-03).
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ FD, NFR Design, ✅ Infrastructure Design APPROVED 2026-10-18; Code Generation plan AWAITING APPROVAL (12 steps, 2 questions)**, [`construction/plans/u9-code-generation-plan.md`](construction/plans/u9-code-generation-plan.md). Entry point `construction/u9-connector-upgrade/HANDOFF.md`. Nothing built. 🔴 At the new pin the connector's atomic config write fails with `EBUSY` on today's single-file mount: BR-69 must be in before the pin reaches live.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ FD APPROVED; NFR Requirements SKIPPED; ✅ NFR Design APPROVED; Infrastructure Design WRITTEN, awaiting owner approval** (`construction/u9-connector-upgrade/infrastructure-design/`: IN-U9-1…7; plan all A). Entry point `construction/u9-connector-upgrade/HANDOFF.md`. 🔴 At the new pin the connector's atomic config write fails with `EBUSY` on today's single-file mount: BR-69 must be in before the pin reaches live.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ FD APPROVED; NFR Requirements SKIPPED; ✅ NFR Design APPROVED 2026-10-18; Infrastructure Design plan OPEN (5 questions)**, [`construction/plans/u9-infrastructure-design-plan.md`](construction/plans/u9-infrastructure-design-plan.md). Entry point `construction/u9-connector-upgrade/HANDOFF.md`. 🔴 At the new pin the connector's atomic config write fails with `EBUSY` on today's single-file mount: BR-69 must be in before the pin reaches live.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ Functional Design APPROVED; NFR Requirements SKIPPED; NFR Design WRITTEN, awaiting owner approval** (`construction/u9-connector-upgrade/nfr-design/`: P-65…75, LC-58…68, PBT-73…78; plan all A). Entry point `construction/u9-connector-upgrade/HANDOFF.md`. 🔴 At the new pin the connector's atomic config write fails with `EBUSY` on today's single-file mount: BR-69 must be in before the pin reaches live.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — ✅ Functional Design APPROVED 2026-10-18; NFR Requirements SKIPPED (as U1–U8); NFR Design plan OPEN (6 questions)**, [`construction/plans/u9-nfr-design-plan.md`](construction/plans/u9-nfr-design-plan.md). Entry point `construction/u9-connector-upgrade/HANDOFF.md`. 🔴 At the new pin the connector's atomic config write fails with `EBUSY` on today's single-file mount: BR-69 must be in before the pin reaches live.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — Functional Design WRITTEN, awaiting owner approval** (`construction/u9-connector-upgrade/functional-design/`: BR-68…BR-75, US-32). Entry point `construction/u9-connector-upgrade/HANDOFF.md`. FD answers: Q1–Q4, Q6–Q11 = A; Q5 withdrawn (architecture is U10's; U9 publishes amd64). 🔴 At the new pin the connector's atomic config write fails with `EBUSY` on today's single-file mount: the fix (BR-69) must be in before the pin reaches live.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE — Functional Design plan OPEN (9 questions)**, [`construction/plans/u9-functional-design-plan.md`](construction/plans/u9-functional-design-plan.md); entry point `construction/u9-connector-upgrade/HANDOFF.md`. ✅ Inception round **approved** by the owner (FR-73…75, NFR-40; U9 inserted, NAS → U10, Team Operations → U11; naming `spotify-companion`). 🔴 Measured: at the new pin the connector's atomic config write fails with **`EBUSY`** on our single-file mount, so token refresh breaks until Q2/Q3 are built.
  *(superseded 2026-10-18)* INCEPTION — **▶ U9 CONNECTOR UPGRADE & PUBLISHABLE IMAGE declared; awaiting owner approval of the requirements and units round.** Answered 2026-10-18: Requirements **Q26 = X** (the pin move only, every upstream change accounted for; no new features), **Q27 = A** (CI publishes to GHCR on release tags), **Q28 = A** (keep pinning); Units **Q7 = A** (new **U9**; NAS → **U10**, Team Operations → **U11**). New requirements **FR-73…75**, **NFR-40** (`requirements.md` §3.9, §4.1a); U9 in [`inception/application-design/unit-of-work.md`](inception/application-design/unit-of-work.md). Target pin **`6065ce5c`** = upstream `main`, probed 2026-10-18. **Next, after approval**: U9 Functional Design plan (`construction/plans/u9-functional-design-plan.md`) and U9's `HANDOFF.md`. Nothing designed or built yet.
  *(superseded 2026-10-18)* ✅ **U8 APPROVED** (walk ① passed; `1.0.0-beta.2` live). ▶ **INCEPTION RE-ENTERED** for a new unit *before* the NAS deployment: move the bundled MCP connector to its MIT-licensed commit and make a publishable image (backlog **W-15**). **Open now**: Requirements **Questions 26–28** in [`inception/requirements/requirement-verification-questions.md`](inception/requirements/requirement-verification-questions.md) and Units **Question 7** in [`inception/plans/unit-of-work-plan.md`](inception/plans/unit-of-work-plan.md) (recommended: the new unit becomes **U9**, NAS deployment **U10**, Team Operations **U11**). Nothing is designed until they are answered. Context: `audit.md` 2026-10-16…18, `requirements.md` W-15.
  *(superseded 2026-10-18)* CONSTRUCTION — **▶ U8 TEAM WORKFLOW & ONBOARDING — ✅ Functional Design APPROVED (2026-10-12); NFR Requirements SKIPPED (as U1–U7); ✅ NFR Design APPROVED 2026-10-13 (P-58…64, LC-49…57, PBT-68…72). ✅ **Infrastructure Design APPROVED 2026-10-14** (`construction/u8-team-workflow/infrastructure-design/`, IN-U8-1…7; FD amended: walk on `Machine 1`, macOS untested, BR-61.10 withdrawn). ✅ **Code Generation COMPLETE 2026-10-14** (12 steps, 1631 tests, `npm run verify` green; `construction/u8-team-workflow/code/code-summary.md`). Nothing pushed or deployed. ✅ **Build & Test (2026-10-14)**: `0.8.1` deployed, pushed, `main` protected and seen to refuse (`build-and-test/u8-build-and-test-summary.md`; ⚠️ CI's test step could never fail until the pipefail fix). ✅ MCP licence issue posted (upstream #106, 2026-10-16). ✅ **Walk ① PASSED 2026-10-18** (attempt 4, v0.8.5) → **`1.0.0-beta.1` released**. ✅ **U8 APPROVED 2026-10-18.** ▶ **INCEPTION RE-ENTERED**: a unit to move the MCP connector to its MIT-licensed version (W-15) **before U9**. Requirements Questions 26–28 + Units Question 7 open — walk machine now **`Machine 1`** (MacBook too old), nested virtualization probed ✅. FD amended 2026-10-12: agent cold walk on the owner's clean **MacBook** (macOS now supported); Linux walked in U9** — `construction/u8-team-workflow/` (entry: `HANDOFF.md`; BR-61…BR-67). All 10 plan questions answered; Requirements **Q20** ratified (P4, US-30, US-31); backlog **W-14** logged. GitHub Pro → branch protection available. ✅ **Team-operations round complete (2026-10-12)**: Requirements Q21–25 → **NFR-35…39**; Units Q6 = A → **U10 Team Operations**, built **after U9** (order U8 → U9 → U10).
  *(superseded 2026-10-12)* U8 FD plan open (10 questions), [`construction/plans/u8-functional-design-plan.md`](construction/plans/u8-functional-design-plan.md). ✅ **U7 APPROVED 2026-10-12** (user), after the hands-on list completed (O-1 reboot, U5-3/U5-4 live). ✅ Requirements **Q18 = A → NFR-34** (SemVer pre-1.0). ⚠️ Measured: **branch protection is unavailable** on a private free-plan repo (403) — U8 FD Q1.
  *(superseded 2026-10-12)* CONSTRUCTION — **▶ U7 CONFIGURATION MANAGEMENT — ✅ Functional Design APPROVED (2026-10-08); ✅ NFR Design APPROVED; ✅ Infrastructure Design APPROVED; ✅ Code Generation COMPLETE; ✅ **Build & Test COMPLETE (2026-10-09 UTC) — deployed and verified**, 1565 tests, rollback `u6-rollback` verified; awaiting approval. ▶ Next unit: U8**: `construction/u7-configuration-management/functional-design/` (BR-53…BR-60, probes P-U7-1…3). Requirements FR-66…FR-72 + US-29 ratified (Q19/19a = A). Q18 (app versioning) open for U8.
  *(superseded 2026-10-08)* CONSTRUCTION — **▶ U7 CONFIGURATION MANAGEMENT — Functional Design plan open (9 questions)**, [`construction/plans/u7-functional-design-plan.md`](construction/plans/u7-functional-design-plan.md); entry point `construction/u7-configuration-management/HANDOFF.md`. ⚠️ Defect found while planning: broken Spotify credentials read as "nothing playing" / "Spotify: ok" (MCP returns errors as text without `isError`). U6 complete.
  *(superseded 2026-10-08)* CONSTRUCTION — **✅ U6 BUILD & TEST COMPLETE (2026-10-08 UTC) — DEPLOYED AND VERIFIED.** Live on the U6 image; rollback image `u5-rollback` verified live; exit test passed on a second installation (restart **3.8 s**, counts identical, undo ×2, no-impact proof ✅). 1401 tests. Three B&T defects fixed and redeployed. Open: **BR-52 cleanup** (awaiting confirmation). ▶ Next unit: **U7 Configuration Management**. Summary: `construction/build-and-test/u6-build-and-test-summary.md`.
  *(superseded 2026-10-08)* CONSTRUCTION — **✅ U6 CODE GENERATION COMPLETE (2026-10-07), awaiting review.** All 13 steps; `npm run verify` green, **1400 tests**; schema v7, no migration; **nothing deployed** (the container still runs U5). Five defects found by tests during generation, all fixed — `construction/u6-data-lifecycle/code/code-summary.md`. ▶ Next: **Build & Test**.
  *(superseded 2026-10-07)* **INCEPTION RE-ENTERED for Phase 5 (2026-10-07) — Requirements Analysis, then Units Generation.** ⚠️ Process correction: Phase 5's questions had been put in a non-standard `inception/plans/phase-5-plan.md` (now a pointer). ✅ Answered 2026-10-07: Q12 (FR-57…64 **ratified**), Q13 B, Q14 A, Q15 A, Q17 C, Q17a A; Units Q4 A (**U8 Team Workflow & Onboarding** added). ✅ **Requirements round COMPLETE**: Q11a B (delegated auth, NFR-29), Q16 C (GPL-3.0, NFR-32), Q17b B (NFR-28); also FR-65, NFR-30/31/33. ⚠️ The bundled MCP server has **no licence** — no built image may be published, ~~Units Q5a~~ ✅ **answered: build order U6 → U7 Configuration → U8 Team Workflow & Onboarding → U9 Off-machine Deployment, renumbered to match** (old U8→U7, U9→U8, U7→U9). Units Generation for Phase 5 is complete. Originally open: **Requirements Questions 11–17a** ([`inception/requirements/requirement-verification-questions.md`](inception/requirements/requirement-verification-questions.md)) — Question 12 ratifies U6's FR-57…FR-64 — then **Units Questions 4–5** ([`inception/plans/unit-of-work-plan.md`](inception/plans/unit-of-work-plan.md)). ✅ **U6 FUNCTIONAL DESIGN APPROVED 2026-10-07.** NFR Requirements **SKIPPED** as for U1–U5. ✅ **U6 NFR Design APPROVED** · ✅ **Infrastructure Design APPROVED.** ▶ **Code Generation plan awaiting approval** (`construction/plans/u6-code-generation-plan.md`, 13 steps). Previously: U6 NFR Design written — `construction/u6-data-lifecycle/nfr-design/` (P-38…P-48, LC-32…LC-39, PBT-51…PBT-58); all 10 plan questions answered A. ▶ Next: Infrastructure Design.
  *(superseded 2026-10-07)* CONSTRUCTION — **▶ U6 FUNCTIONAL DESIGN WRITTEN, AWAITING APPROVAL (2026-10-07).** Backup and restore are now **in-app** (Settings pop-up: *Create backup* downloads one `.tar.gz` taken live via `node:sqlite` `backup()` with no downtime; *Restore backup* uploads, verifies, confirms and replaces, applied at startup before the database opens). ⚠️ That design **dissolves** the cross-machine writer-guard problem — one writer does both. **FR-57…FR-64**, **US-28**, **BR-44…BR-52**, backlog **W-9**/**W-10**. ⚠️ **FR-64: one secure admission path for every uploaded file.** **New unit U7 — Configuration Management** (rules + credentials in-app) split out, also gating U9. Read [`construction/u6-data-lifecycle/HANDOFF.md`](construction/u6-data-lifecycle/HANDOFF.md). Phase 5 plan Q1–Q8 still open; ⚠️ Q1 must be decided before upload routes are reachable off-machine.
  *(superseded 2026-10-07)* **✅ U5 IS COMPLETE AND LIVE-VERIFIED (2026-10-06). All five units delivered.** Seven live sessions, 29 real skips, 6 runaway halts including the `hourly-rate` trigger. A skip costs **1–9 s** of the outgoing track, not the 18–41 s the design feared — and the figure tracks **enrichment latency**, not the skip mechanism. ⚠️ **Eight defects were found live and NONE by the test suite**; two of them I had documented wrongly first, with passing tests whose fixtures encoded the belief rather than the behaviour. Record: [`construction/u5-automated-skipping/live-verification.md`](construction/u5-automated-skipping/live-verification.md). **Next: ▶ PHASE 5 — "Share": off this machine, and off one developer.** Added 2026-10-06. ⚠️ The single-USER assumption does NOT change — each developer runs their own deployment with their own Spotify account and corpus; this is not multi-tenancy. What changes is single-DEVELOPER and single-MACHINE. **Seven questions open in [`inception/plans/phase-5-plan.md`](inception/plans/phase-5-plan.md); nothing is designed until they are answered.**
  ▶ **FIRST UNIT: [U6 — User-Data Lifecycle](construction/u6-data-lifecycle/HANDOFF.md)** — promoted from backlog W-5 on 2026-10-06 and **it gates the whole phase**. Six FD questions open in [`construction/plans/u6-functional-design-plan.md`](construction/plans/u6-functional-design-plan.md). ⚠️ **The `db:backup`/`db:restore` pair already works** — U6 EXTENDS it; starting over would discard a verifier that has caught a real corrupt snapshot. ⚠️ **The central problem is that the writer-guard asks the LOCAL `docker ps` and is blind across machines** — the U4 corruption's shape one layer out. ⚠️ **And `state/automation-state.json` must NOT travel**, or a restore can silently re-arm automation. ⚠️ **Q1 blocks the phase**: `localGuard.ts` requires a loopback `Host`, so every off-machine request 403s — page and WebSocket alike. That is option B working as specified, and replacing it is a security-posture decision. ⚠️ **This is the first phase whose failure mode is EXPOSURE rather than a wrong number**, so its miss is not recoverable by recomputing.
  *(superseded) U5 was built and deployed INERT on 2026-10-03.* All 13 code-generation steps done, migration 007 ran, schema v7, container live on the new image. `SKIP_EXECUTOR_ENABLED` is `false`, so `SkipExecutor` is never constructed and nothing can skip a track. Next: THE DRY-RUN REVIEW — user judgement, not code.**
  ⚠️ **Two of the three non-CI exit criteria are now closed.** `probeWritable` is verified against the
  real `/state` mount **through the container**, and the kill switch was written and read back in both
  directions with host and container seeing identical content — so the write-temp-then-rename survived
  the bind mount. **Still open: the dry-run review that arms the first rule, and the first real skip
  heard by the user.** Neither is a test.
  ⚠️ **The BR-35 thresholds are PRE-REGISTERED** (`construction/u5-automated-skipping/safety-thresholds/pre-registration.md`),
  committed in its own commit while `skip_attempt` held 0 rows. Read it before arming anything.
  ⚠️ **Rollback is verified LIVE**: U4's image (tagged `spotify-now-playing:u4-rollback`) reports
  `{from: 7, to: 7, applied: []}` against a v7 copy, and **a U4 INSERT into a v7 `decision_log`
  succeeds** with `trigger` defaulting to `'initial'`. Reading the skip line alone would have proved
  only that 007 is skipped.
  1228 tests · typecheck clean · `npm run smoke` green · `npm run knip` clean · **885 plays** ·
  `integrity_check: ok`. `npm run verify` runs all four.
  ▶ **READ [`construction/u5-automated-skipping/HANDOFF.md`](construction/u5-automated-skipping/HANDOFF.md) FIRST** — U5's single entry point.
  ✅ The FD is `construction/u5-automated-skipping/functional-design/`: `business-rules.md`
  (**BR-33…BR-43**), `domain-entities.md`, `business-logic-model.md`, `frontend-components.md`.
  The settled answers are [`construction/plans/u5-functional-design-plan.md`](construction/plans/u5-functional-design-plan.md) §5.1.
  `src/` untouched, no migration, container healthy and recording. **Corpus: 850 plays, 900 decision
  rows** (2026-09-27; this said 662/664 until then).

  ⚠️ **STAGE SEQUENCE CORRECTED 2026-09-27.** Every U5 document said *"next: the Code Generation
  plan"*, which **skips two stages** that U1–U4 each ran — and those are where **LC-\*/P-\*/PBT-\***
  numbers are allocated, which the code-generation plan then references as inputs. U5 also has real
  infrastructure content (`config/` `:ro` → `:rw`, migration 007). **User chose the full sequence**
  (2026-09-27): NFR Design → Infrastructure Design → Code Generation.

  ✅ **The migration-007 prerequisite is BUILT AND DISCHARGED** (plan §4):
  `scripts/backup-history.mjs`, `restore-history.mjs`, `verify-all-backups.mjs` —
  `npm run db:backup` / `db:restore` / `db:verify-backups`. Round trip rehearsed on a scratch copy:
  850 plays → damaged to 0 → restored to 850, `integrity_check: ok`.

  ✅ **THE BACKUP IS TAKEN AND VERIFIED (2026-09-29)** —
  `data/backup-before-migration-007-20260929T172027Z`, schema v6, **all eight checks pass**, 850 plays /
  900 decision rows. Container down for it, back up and healthy afterwards, corpus identical either side.
  **Migration 007 is no longer blocked.** Sweep: **1 fully verified · 10 intact but unverifiable ·
  1 CORRUPT.**

  ✅ **The blind guard is FIXED (2026-09-29)** — `reclassify-unobserved-tails.mjs` now delegates to
  `assertNobodyElseHoldsIt` (`docker ps` + the lock probe, failing closed), **imported rather than
  re-implemented**. Verified to refuse with the container up.

  ⚠️ **AND `npm run reclassify` HAD BEEN DEAD SINCE `f864e4e` (2026-09-22)** — classifier v2 removed
  `ATTRIBUTION_VERSION`/`attributeSkip` from `src/` and left the script importing them, so the **FR-20
  re-derivation tool could not start at all**. Seven days; **891 tests stayed green**, because
  `noOrphanModules` walks `src/` and `scripts/` is outside every guard. **Third instance of that shape in
  eight days.** Repaired by removing the attribution half. ✅ **762 of 762 live plays re-derive identical
  under v2 — 0 changes**, so the deadness cost nothing.

  ⚠️ **TWO RECORDED CLAIMS WERE MEASURED WRONG.** ① *"copying the `.db` alone loses over half the
  corpus"* is **false** — a `.db`-only copy held **824 of 850** plays. WAL size tracks **page churn**,
  not row count. The correction makes the hazard **worse**: 3% lost, newest rows only,
  `integrity_check: ok`. ② ⚠️ **A LIVE SAFETY DEFECT** — **SQLite's locks do not cross the Rancher
  Desktop bind mount**, so `reclassify-unobserved-tails.mjs`'s exclusive-lock guard **cannot see the
  container** and returns green exactly when the danger is present. This **mechanically explains the
  U4 corruption incident**. `docker compose down` is the only real protection. **Not yet fixed in that
  script** — left for a decision. See `audit.md` 2026-09-27 (later).

  ⚠️ **0 of 11 existing backups are fully verified; 1 is CORRUPT.** `CORRUPT-snapshot-20260921-201444`
  reports a plausible 586 plays and **fails `integrity_check`** — it is the **load-bearing negative
  control** for `npm run db:restore -- --self-test` and **must not be tidied away**. Conversely a
  backup with one play deleted returns `integrity_check: ok`: **integrity sees damage, the manifest
  sees incompleteness, and neither sees the other's failure.**

  ✅ **PROBE P-U5-1: THE PREDICTED HAZARD IS FALSE.** Audio follows the reported track boundary within
  **~2 s** in the AI DJ and essentially simultaneously in radio and album, so a skip at that boundary
  costs **2–3 s** of the outgoing track — not the 18–41 s the design plan predicted. **FR-46 needs no
  lag guard** (BR-43.1) and FR-48's confirmation is validated (`progress_ms` reset **+** track-id
  change, **~3 s grace**). Record:
  [`construction/u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md`](construction/u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md).

  ⚠️ **AND CLASSIFIER V2'S STATED MECHANISM WAS BACKWARDS.** It said *"the API stops reporting a
  track 18–41 s before it stops playing"*. The API never lagged: **the DJ stops *playing* 18–50 s
  before nominal end and reports that accurately.** Proof is **`B@first`** — how far into the incoming
  track the API already is when it first names it: **~1 s in radio and album, up to 23.6 s in the DJ**.
  So `progress_ms` is accurate in pre-determined contexts and the DJ's tails are **real edits**.
  ✅ **v2's FIX STANDS UNCHANGED** — `maxUnobservedTailMs` thresholds the right quantity for the wrong
  stated reason, the 24 re-derived rows stay correct, **no re-derivation is needed, and BR-11.7 is
  untouched by a change of explanation.**

  ✅ **The discriminator is PRE-DETERMINED vs PRODUCED-LIVE** — the user's observation, and *not*
  "algorithmic": radio is algorithmic and behaves exactly like an album. Radio's tracks are chosen
  ahead of time, the DJ's as it goes. **This explains R11 with the same cause** — a pre-determined list
  can be exposed to the queue endpoint, a live mix has nothing to expose yet. ⚠️ **So the queue probe
  FR-36 already performs is ALSO the transition-regime probe**, and `context.type` cannot do it (DJ and
  radio share the `37i9dQZF1E` prefix). **No new field is needed**; `context_type` stays evidence only.

  ⚠️ **New API fact: DJ commentary returns HTTP `200` with `item: null`** — not a 204 — for 6.5–7.2 s,
  on 3 of 8 DJ transitions. **Open question, deliberately NOT concluded**: the live path parses MCP
  *text*, not this endpoint, so if a gap there reads as *nothing playing*, a commentary gap would close
  the play and fall through to **`unknown`** — meaning part of the `unknown` population would be
  commentary rather than app downtime, which reaches R2 and open item 8. **Probe the MCP surface; it
  must not be asserted from P-U5-1.**

  ⚠️ **The crossfade argument has failed a THIRD time.** CLAUDE.md ruled crossfade out partly because
  *"the feature was disabled"*. The setting **is** off — and **the DJ crossfades anyway, ~5 s, on 3 of 8
  transitions.** The setting was never the relevant fact in the DJ context, the only context where the
  anomaly appears.

  ⚠️ **n is small**: 8 DJ / 3 radio / 4 album, one machine, one evening. Enough to separate ~2 s from
  ~25 s; **not** enough to characterise the distribution of DJ trim lengths. Eight instrument failures
  are recorded in the probe document, two of them this project's own recurring traps — commentary-gap
  transitions were **invisible** to the flip detector (absent data reading as *"no transition
  happened"*), and context was inferred from a uri prefix **that radio also matches**, which is R11's
  own finding reproduced as a defect in the tool built to test it. See `audit.md` 2026-09-27.

- **2026-09-23 — U5 FUNCTIONAL DESIGN PLAN WRITTEN, awaiting answers.**
  [`construction/plans/u5-functional-design-plan.md`](construction/plans/u5-functional-design-plan.md)
  — 9 questions, each with a recommendation, and a checklist.
  ⚠️ **THE HAZARD BELOW WAS PROBED 2026-09-27 AND IS FALSE**, and its mechanism was backwards — see
  the current-state block above. Kept as written because it is what was believed at the time.
  ⚠️ **It raises a hazard the U5 handoff did not contain, and it gates FR-46.** In the DJ context
  the API reports track B while A is still audible for 18–41 s (classifier v2's finding), and
  `EvaluationCoordinator` takes its play boundary from that reported state. If
  `POST /me/player/next` acts on the *player's* real state, a rule matching B would **truncate A**
  — an unmatched track the listener was enjoying — and B would then play unskipped, in the context
  used 50–70% of the time. **The last step is unproven**: whether the lag is in Spotify's reporting
  or in its state store is not inferable from what we have. **Probe P-U5-1 before designing FR-46**,
  on the R11 precedent. ⚠️ The same lag makes the obvious FR-48 skip-confirmation check
  (*"is a different track reported now?"*) one that can pass when nothing audible happened.
  ✅ **U5 handoff item 1 is CLOSED, not inherited** — classifier v2 fixed the outcome itself.
  All **22** remaining skips are `skip_source = 'user'`. ⚠️ But 22 events is the *entire* evidence
  base for arming a rule, and the 2026-09-10 gate's n=17 precedent says what that can and cannot
  decide. Corpus facts measured for the plan: longest consecutive user-skip run **2**
  (18 runs of 1, 2 of 2) · **median 12 plays/hr**, p90 21 · `context_type` **NULL on all 577 live
  plays** (open item 7, re-raised because it is now load-bearing for a *safety* question).
  Also recorded 2026-09-23, **noted not built**: wishlist **W-4** — group aliases (`Inpatient` =
  Ren + Chris Webby) rank as independent artists in the reporting DB, and a `", "` inside an artist
  name would split silently. ⚠️ `Inpatient` **is a real artist**, probed — do not "fix" the
  splitter on that example. Two new API traps in CLAUDE.md. See `audit.md` 2026-09-23.

- **Previously**: CONSTRUCTION — **U4 COMPLETE, DEPLOYED AND VERIFIED 2026-09-22.
  All three exit criteria CI could not close are CLOSED. U5 is next.**
  866 tests · typecheck clean · schema **v6** · 613 plays · `src/playback/` absent.
  ✅ Dry-run agreement gate (65 decisions, user agreed) · `partialData` **0 of 65**, max settle
  **9.0 s** · **BR-20.8 exercised live for the first time since U3 specified it**.
  Summary: [`construction/build-and-test/u4-build-and-test-summary.md`](construction/build-and-test/u4-build-and-test-summary.md).
  Handoff: [`construction/u5-automated-skipping/HANDOFF.md`](construction/u5-automated-skipping/HANDOFF.md).
  ⚠️ **U5 inherits a half-noisy outcome variable**: `skip_attribution` splits skips 22 user /
  21 unattributed, and `BackTestService` counts both. U5 must decide in writing whether an
  `unattributed` skip counts as agreement before arming anything.
  The 2026-09-20 design review's four decisions (watcher owns the rule set · BR-22.1 scoped to
  U4 with no `UNIQUE` · `PlayObserver` owns segmentation · answerability is per row over two
  eras) are all **built and shipped**. See `audit.md` 2026-09-20 and
  [`u4-rule-observability/HANDOFF.md`](construction/u4-rule-observability/HANDOFF.md).
  ✅ **CLAUDE.md open item 3 corrected 2026-09-20** (+ item 3a): `recently-played` *does* return
  `external_ids.isrc`; recovery is **72 distinct tracks**, not 47 calls; and the cause of the
  82-row gap is **unestablished and not the code**. The zero-gate-eligible conclusion stands.
  *(U3 was APPROVED by the user 2026-09-19.)*
  U3 shipped the rules core wired to nothing; **U4 wired it, in dry-run only**. The phase
  boundary now rests on `src/playback/` not existing and on `LoggingExecutor` taking no
  playback collaborator — if anything can skip a track before U5, that is a regression.
  **FR-33 stays PARTIAL** — `hold` is U5's.
  *(U2 was approved 2026-09-05.)*
  **486 tests passing · typecheck clean · live-verified against the real MusicBrainz.**
  Summary: [`construction/build-and-test/u2-build-and-test-summary.md`](construction/build-and-test/u2-build-and-test-summary.md).
  🔒 The **Phase 2 hypothesis gate** (BR-11) was **DISCHARGED 2026-09-10**: the
  confirmatory evaluation ran and **R1 IS NOT SUPPORTED** — `major` 9.2% (7/76) vs
  `independent` 8.6% (10/116), +0.6pp, 95% CI [−7.7%, +8.9%], p = 0.888 —
  [`hypothesis-gate/gate-result-2026-09-10.md`](construction/u2-label-enrichment/hypothesis-gate/gate-result-2026-09-10.md).
  ⚠️ Not *disproven*: the CI rules out ~±8pp and nothing smaller. Under **BR-11.7 the single
  confirmatory run is spent** — any further run is exploratory and cannot re-open the gate.
  **The 2026-09-05 pause of U3 is therefore over**: it existed to let the gate reach its minimum,
  which it has. **U3 is the next unit**, and was always designed not to depend on R1.
  Database at schema **v4**, **427 plays**.
  A **listening-statistics panel** was added 2026-09-06 (see below) — display only, no migration.
  ⚠️ **The artist-level LABEL verdict was removed 2026-09-06 (migration 004) and Q12 is
  withdrawn.** It was classified over `browse /release?artist=`, which counts releases the artist
  merely *features* on: Bad Bunny returned 92 lead releases against 109 guest spots, and 49 of 64
  label names came only from other artists' record deals. One strong `major` vote decides the
  fold, so every collaborative artist read `major` — bias in the **independent** variable, in the
  direction that would mask R1. The label question is answered once, at release level, through the
  ISRC; the artist level is now **genres and a resolution pointer**, at 4 requests per new artist
  instead of 5. See `audit.md` for the probe and the four-way classifier comparison.
  **486 tests** · 99.19% line · 92.86% branch. Routes extracted to `api.ts` and tested over real
  HTTP; `noOrphanModules.test.ts` closes the coverage blind spot that hid them.

### ▶ Where to pick up (2026-09-06, end of session)

**Nothing is half-finished.** Container healthy and recording on schema v4, all work documented
in `audit.md`. **Commits are unpushed** — code only exists on this machine until `git push`.

The instrument is now collecting properly for the first time: before today every restart
duplicated recent plays, and the corpus mixed "the app was off" with "the app could not tell".
Both are fixed, so **the plays recorded from here are clean** — which matters, because the
hypothesis gate was discharged 2026-09-10 — R1 not supported; see above.

Open threads, none blocking:

1. **Three modules are knowingly untested** and now listed in `noOrphanModules.test.ts`'s
   `ALLOWED_ORPHANS`: `diagnostics.ts`, `export/SnapshotScheduler.ts`, `mcp/spotifyMcpClient.ts`.
   Each is constructed only by `server.ts` and would need the same injection treatment `api.ts`
   got.
2. **`public/app.js` has no tests at all** and is not covered by the orphan check, which walks
   `src/` only. Two real defects were found there today by *clicking* — the liked-refresh race
   and the "every axis tick says Aug" bug.
3. **Two database backups sit in `data/`** — `history.db.backup-2026-09-06T02-07-53-966Z` from
   the `played_at` repair, and `backup-before-migration-004-20260906T231755Z/` from the
   artist-level removal. Delete each once its change has been trusted for a while.
4. **The label-coverage statistics are now cleaner than they were, for a reason worth noting.**
   Nothing consumed the artist-level verdict except the panel and the export — the hypothesis
   gate has always grouped on `label_verdict` (release level, BR-11.1a), so removing it changed
   **no gate input**. That is why this was a safe removal rather than a re-measurement.
4. **Watch `Inconclusive` on the weekly chart.** With the container on autostart it should stay
   near zero; today's 17 live-unknowns are mostly container rebuilds. A rising count with the app
   running continuously would be a real classifier finding.

### 🚢 The container is now the running deployment — open item 1 CLOSED

The app runs **unattended** on Rancher Desktop: `application.autoStart` +
`startInBackground` (set via `rdctl`), plus `restart: unless-stopped` in `compose.yaml`.
Chain: Windows login → Rancher Desktop (no window) → dockerd → app container.
**Proven end to end by a real reboot on 2026-09-05** — `scripts/post-boot-check.ps1` passed every
check; the container started 82s after the host boot clock, by itself.
UI at **`http://localhost:3010`** (3000 was taken on this machine by another project).

**Open item 1 closed** by user decision: `localGuard` option **B**, implemented as opt-in
`TRUST_PUBLISHED_PORT`, set only in `compose.yaml`. It disables the peer-address check **and
nothing else** — Host/Origin validation, the DNS-rebinding defence, stays in force. Verified live:
UI `200`, cross-site `Origin` still `403`. 7 new tests, 411 total.

⚠️ **That verification was HTTP-only, and it hid a defect for the life of the deployment.** The
WebSocket upgrade handler held a *second copy* of the admission rule and never learned about
`trustPublishedPort`, so in the container every page load succeeded and every handshake got `403`
— the UI loaded and sat on "Disconnected — reconnecting…", which reads as a Spotify outage.
Found 2026-09-05 by opening the page; fixed by routing both paths through one `decideAccess`.
Now verified on **both** surfaces: WS same-origin `101`, WS cross-site `403`, non-`/ws` upgrade
`403`. **415 tests.**

**Recording does not need the UI.** The poll loop is a server-side `setInterval` started at boot;
the WebSocket only pushes to whoever is connected. That is why option B was a convenience
decision, not a prerequisite — the container would have collected data while returning 403 to
every browser.

⚠️ **Never run the container and `npm start` together** — two pollers, two writers, one SQLite
file, every play recorded twice.

### 📊 Listening statistics panel (2026-09-06) — display only

Play count for the current track split by outcome, and a weekly stacked trend for its primary
artist. `GET /api/history/stats` is read-only over `history.db` and makes **zero** upstream
requests, so it cannot put a Spotify or MusicBrainz outage in the path of a local count. No
migration was needed — `idx_play_track` and `idx_play_artist_id` already exist.

Three constraints were measured before designing, and each changed the result:

- The corpus is **17 days**, not six months, so the window is adaptive and capped at 26 weeks.
  `capped` is reported as a distinct flag: "stopped at the limit" and "stopped because there is no
  more history" are different facts, and the caption says which.
- `artist_id` is the **primary** artist only. Ren is on 34 plays and owns the primary id on 26, so
  the panel labels itself `(as primary artist)` rather than presenting a known undercount as a
  total. Fixing it properly needs every artist id recorded per play — a schema change, and **not
  retroactive**. User chose the documented undercount (2026-09-06).
- 116 of 163 plays are backfilled and therefore `unknown`. Bars are stacked by outcome with
  `unknown` kept visibly separate as a hatched neutral; filtering to `completed` would have drawn
  listening as beginning the day live recording started.

⚠️ **This does not touch the recording path, the classifier, or the hypothesis gate.** It reads
rows that already exist.

### 🔒 The hypothesis gate is DISCHARGED — R1 NOT SUPPORTED (2026-09-10)

The comparison, the minimum sample and the robustness checks were fixed in
[`hypothesis-gate/pre-registration.md`](construction/u2-label-enrichment/hypothesis-gate/pre-registration.md)
and committed at **`fd09ad7`** *before* any result was computed — five days and 240 plays before.
**BR-11.6a** (`n ≥ 50` per group **and** `≥ 10` skips) was **first met on 2026-09-10**, making that
run the single confirmatory evaluation permitted by **BR-11.7**. It was run with the user's
explicit decision, and **it is now spent**.

| Group | n | skipped | skip rate |
|---|---|---|---|
| `major` | 76 | 7 | **9.2%** |
| `independent` | 116 | 10 | **8.6%** |
| `unknown` (BR-11.2) | 125 | 13 | 10.4% |

**Difference +0.6pp · 95% CI [−7.7%, +8.9%] · z = 0.141 · p = 0.888 · NOT SIGNIFICANT.**

> ⚠️ **NOT SUPPORTED is not DISPROVEN.** The CI rules out roughly ±8pp — about 2× against a ~9%
> baseline — and **nothing smaller**. 8.6% vs 12% remains entirely possible and would need several
> hundred plays per group to resolve. The pre-registration stated this limit in advance.
>
> ⚠️ **Do not re-run the gate hoping for a different answer.** BR-11.7 forbids it; a further run is
> **exploratory** and cannot discharge or re-open the gate.
>
> **U3 was never gated on this**, and that was written down before the result. Rules must be
> authorable and valuable to the user *without* R1 being settled. U2's label enrichment stays a
> legitimate rule *input* — simply not one backed by evidence that it predicts this listener's skips.

⚠️ **BR-11.2's most informative check also returned nothing.** The `unknown` group was expected to
resemble `independent` if unknowns are uncatalogued independents; all three groups sit within 1.8
points of each other.

⚠️ **Open item 4 rides along and is unresolved.** 12 of the 30 skips sit at ratio 0.80–0.90. The
crossfade confound inflates the *independent* skip rate, so correcting it could only move the result
**toward** R1, never further away.
⚠️ **WITHDRAWN 2026-09-22.** Crossfade is ruled out (the affected plays lose 21–41 s; Spotify caps
crossfade at 12 s), the duration gap dissolved at 10× the sample (213 s vs 201 s, not 248 s vs
191 s), and the direction is backwards: those plays are **67% of major skips but 50% of
independent**, so the correction removes proportionally more from the *major* arm. See open item 4.
Retroactively correctable — trails are retained, and `skip_attribution` now labels them directly.

⚠️ **The runner had no significance test until this run.** Earlier revisions stopped at the
sufficiency check because the answer was fixed at "insufficient data". The §2 test was added
**after** the group rates were visible — thresholds, eligibility and grouping untouched, formula
with no free parameters. Recorded rather than hidden.

⚠️ **A denominator trap was caught during the run** — folding "no ISRC" (a Spotify artefact) in
with "MusicBrainz has no label" (the R2 measure) reported coverage as 28% → 12% instead of the
correct **86% → 44%**. Same shape as the `inc=releases` bug: a wrong denominator produces a
plausible number that reads as a finding. Corrected, the shipped code **reproduces the 2026-08-26
research probe** (2022+: 43% then, **44%** now) on a larger corpus — the recency-biased coverage
gap of open item 3b is **real and stable**.

## ✅ U2 delivered and live-verified (2026-09-01)

| | |
|---|---|
| Tests | **399** (193 before U2), 0 failing |
| Coverage | 98.97% line · 92.14% branch · 96.88% function |
| Live MusicBrainz | ✅ real service, shipped code, 19 real ISRCs |
| Container egress | ✅ HTTP 200 from inside a container |
| Errors in the full live run | **0** |

### 🔴 Three defects, all found by RUNNING it — none reachable from fixtures

Every one passed the full suite first.

| # | Defect | Why fixtures could not catch it |
|---|---|---|
| 1 | A transient network error wrote an **immutable** `unknown/error` verdict. 21 plays would have been permanently unresolvable from one blip | A fixture failure is deterministic; you must watch a real failure be *recorded* to see it is never retried |
| 2 | `LabelCache.isFresh` gave an `error` the full **30-day** TTL. The SQL sweep had been fixed; the **live path never consults the sweep** | Hid *inside* the fix for #1 |
| 3 | The work set keyed only on the release verdict, so a play whose **artist** lookup failed was permanently unfinished — 21 real plays, work set reporting **zero remaining** | Needs two levels failing independently against a real service |

> **What they share**: all three are *a transient failure becoming permanent*. The design was
> careful that `unknown` and `pending` stay distinct; it was **not** careful that `error` stays
> distinct from both.

### ⚠️ P-4's bounded retry had never been implemented

Only the queue-wide pause was. At 1200 ms spacing — **wider** than the policy floor — **6 of 19
tracks took a `503`**. With retry added: **0 errors**, 0.46 req/sec. Each retry goes back through
the queue, so retrying spends **time, never rate**.

### The shipped code reproduces the research measurement exactly

| | Research probe (ad-hoc, 2026-08-26) | Shipped code (2026-09-01) |
|---|---|---|
| ISRC → recording | 13/19 — **68.4%** | 13/19 — **68.4%** |

Audioslave 44 releases · Slipknot 50 · Faouzia `unknown` (Publisher refused) · Imminence `unknown`
(`[no label]` refused) · NF `major high` and **not** contested · Spinefarm caught as Universal.

### ⭐ The two-level split earned its keep: **8 plays disagree**

Release and artist verdicts differ on 8 of the resolved plays — the Token case at scale, an artist
signed to a major releasing a particular track independently. Merging them would have silently
picked one. **Artist confidence never exceeded `medium`** across all 19.

### BR-12.3 demonstrated on real data

```
Imminence — God Fearing Man
  refused 1: [no label] (BR-3.2) · unknown by BR-4.6
```

Without the trace this `unknown` is indistinguishable from "MusicBrainz knew nothing" — and this
is the very artist whose `[no label]` handling was wrong in round 1 of the design.

### Still owed — reviewed at the 2026-09-05 approval

- ✅ **Liked capture has now fired live** — closed. 9 `kept-liked`, 8 `kept-unliked`,
  1 `liked-during`, 2 `unknown` written across the 2026-09-02 session
- ✅ **Work set empty** — closed. 0 plays remain missing either level
- **Search fallback still never fired** — fixture-tested only. Still owed
- `localGuard` still blocks the container **UI** (egress is verified; serving is not) — open item 1

### ⭐ The three defect fixes are now demonstrated on production data

A real transient failure occurred during the 2026-09-02 session and was handled correctly, which
is the evidence fixtures structurally cannot provide:

```
artist_label_resolution id 40   2026-09-02T20:54:23Z   status=error
  → plays pointing at it:                 0            (fix #1 — never written)
  → id 41, same artist, 20:55:01Z         resolved     (fix #2 — error never fresh, retried in 38s)
  → work set remaining:                   0            (fix #3 — both levels tracked)
```

Claims re-checked on the grown corpus (145 plays): artist confidence still never exceeds `medium`
(13 `low`, 28 `medium`, **zero** `high`); release ≠ artist verdict now on **20** plays, up from 8 —
the two-level split is earning more, not less; **zero** `error` values leaked into
`label_unknown_reason` (15 `notFound`, 2 `noEligibleCandidate`).

## 🎯 Rancher Desktop packaging is a stated goal (user, 2026-08-31)

> *"I do eventually want the entire app to be packaged and deployable in Rancher Desktop, but for
> now we can continue using host deployment for dev/test."*

**Open item 1 is therefore a *when*, not an *if*.** Two consequences that bind from now on:

1. **All new code stays container-compatible.** No host-only assumptions — paths resolved through
   `config.ts`'s existing `inContainer` detection, no reliance on a terminal being open, no
   absolute host paths. `compose.yaml` is kept current even while unverified.
2. **The `localGuard` decision is still owed**, and it is the one thing standing between the
   current image and a working container. Options A–D remain in
   `construction/build-and-test/security-test-instructions.md`.

## ⭐ BR-13 — resolutions are versioned, never overwritten (2026-08-31)

**Raised by the user**, after NFR Design flagged a missing `label_resolved_at` column:

> *"Some of that data can change (an artist can sign with a label for instance)… I'm not sure if
> there's enough value in that chain of changes to make it worth the added complexity."*

### The distinction that resolves it

| | What happened | Correct handling |
|---|---|---|
| **Our knowledge changed** | A volunteer catalogued a release we could not see | Old verdict was **wrong**. Prefer the new |
| **The world changed** | The artist signed to a major | Old verdict was **right for its time**. Keep it |

**MusicBrainz cannot tell you which occurred** — a lookup that 404'd in August and returns `Atlantic`
in January is byte-identical either way. So the design keeps **both readings** and chooses per level
(BR-13.6), which is only expressible because **Q12 kept the two levels separate**:

| Level | What it is | A later change means | Analysis uses |
|---|---|---|---|
| **Release** | A fact about a **past event** | We **learned** it | **Latest** — better measurement of a fixed fact |
| **Artist** | A fact about **now** | The **world** may have changed | **As-of-play** — the covariate is "signed *when this played*" |

Using the latest artist-level verdict would count an artist who signed *after* the play as signed at
the time — **the direction that fabricates support for R1**, which the standing precision rule
forbids.

### ⚠️ The finding that changed Q1: the chain is inert under Q1 = A

Caching successes indefinitely means the app never looks again, so a version chain could only ever
record `unknown → known` — our own catalogue gaps — and **never** `independent → major`, the case
that prompted the design. It would have appeared to work while being structurally incapable of
observing what it was built for.

**Q1 revised A → C**: TTL on everything (`unknown` ~30 d, success ~90 d). Measured cost at 1,000
distinct ISRCs: ~2,000 requests, about **33 minutes** of `LOW`-priority queue per quarter. Current
corpus is **19 distinct ISRCs**.

### The proposal was tested against the schema, not assumed

| Check | Result |
|---|---|
| Precedent | ✅ `observation` is already this shape — many timestamped rows per parent |
| Migration cost | ✅ **Zero.** `schema_version` is still **1**; migration 002 was designed, never written |
| Storage | ✅ `observation` holds 1,296 rows for 71 plays (~3,600/day); a quarterly sweep of 1,000 ISRCs appends ~4,000 rows |
| "Same track record" | ⚠️ **No `track` table exists** — `play` denormalises. The parent is a key, not a row |
| Candidates / votes | ⚠️ Must key to `resolution_id`; keyed to `isrc` they would make BR-8.7 vote on a **union of 2026 and 2027 facts** |
| Vote table | ⚠️ Splits in two — one `resolution_id` cannot be a foreign key into two tables |

### Consequences

- **Migration 002**: **6 tables** (was 5), **16 `play` columns** (was 14). Still additive; nothing implemented yet
- **`label_resolved_at` finding CLOSED** — superseded by `label_resolution_id`, a pointer to the
  exact version, which cannot drift out of step with the row it describes
- **No `is_current` flag.** The current value is `ORDER BY resolved_at DESC LIMIT 1`, which cannot go
  stale; a maintained flag can end up with two rows both claiming to be current, and that reads as
  valid data
- **BR-13.5**: as-of-play is the **pointer**, not a timestamp comparison — a track is `pending` at
  play start, so its resolution lands *after* `started_at` and a timestamp query would return nothing
- **FR-14 drift recorded**: "resolved at most once" now means *at most once per TTL window*

> **On "is the chain worth the complexity"** — the doubt was well founded, and the expensive version
> is not needed. A track's sequence of plays is **already a sparse time series**, sampled at the
> moments that mattered. Versioning the resolutions makes that series legible. No revision log, no
> temporal-join machinery.

## U2 NFR Design decisions (2026-08-31)

| Q | Decision | Source |
|---|---|---|
| Q1 Cache lifetime | ~~A~~ → **C** (revised 2026-08-31) — TTL on everything; each resolution **appends a version** (BR-13) | **User** |
| Q2 Failure handling | **D** — retry `503`/timeout only, never `404`; **pause the queue** on repeated `503`s | default |
| Q3 Restart | **C** — no queue persistence; the **database is the queue of record**; startup sweep | default |
| Q4 Contention | **A** — two priority classes; the live track jumps, backfill fills idle time | default |
| Q5 Outbound posture | **A** — proceed as designed; compliant `User-Agent` with contact address | **User** |
| Q6 Trace route | **A** — separate `GET /api/explain/{playId}`, rendered in the diagnostics dialog | default |
| Q7 Point-in-time capture | **C** — scheduled + startup saved-track refresh; flush grace window on graceful shutdown | default |

### ⭐ Q1 is a measurement decision, not a performance one (superseded in part by BR-13 above)

FR-14 read literally means a `404` today is a `404` **forever**. But MusicBrainz is crowd-sourced and
growing, and the probe measured exactly where it is thin — **2022-onward 43%, pre-2022 100%**.
Caching negatives permanently would **freeze the measured coverage bias into the dataset
permanently**, converting a temporary property of an upstream database into a fixed property of this
project's data — in precisely the population R1 is about.

### The 503 pause is a shared queue stop, not per-request backoff

Per-request retry **increases** pressure exactly when the service signals overload. There is no API
key here, so there is no per-key throttle to absorb the mistake: being blocked takes out the whole
unit rather than degrading it. A pause leaves items **`pending`, never `unknown`** — a pause is a
delay, not an answer.

### `notFound` and `error` stay separate end to end

Both render as `unknown` to a reader. But `notFound` is a finding about **MusicBrainz's catalogue**;
`error` is a finding about **the network on Tuesday**. Folding the second into the first inflates
the apparent coverage gap with noise — and that gap is the measurement R2 depends on.

**The load-bearing claim**: with MusicBrainz entirely down, display, recording and export are all
unaffected. U2's total failure costs the label column and nothing else.

## ⭐ Added at the approval gate (2026-08-31) — the resolution trace

User approved the design **and** asked for *"a debug output that shows how the data for a track was
collected … showing the rules applied so different rule paths can be tested"*, suggesting the
existing diagnostics pop-up as its home.

**Migration 002 is unchanged.** The trace is *recomputed* from `label_candidate` and
`label_signal_vote` by re-running the pure classifier — data BR-8.7 already required so
reclassification needs no MusicBrainz request. Second time the observation/judgement split has paid
(first was U1's completion threshold).

| Decision | Rule |
|---|---|
| Works for **any play in history**, not just now-playing | BR-12.4 |
| Names the rule IDs that fired, **including suppressions** | BR-12.3 |
| Shows stored **and** running `label_classifier_version`, flags divergence | BR-12.5 |
| A **derivation**, not `ok`/`fail` steps — own section in the dialog | BR-12.6 |
| Zero MusicBrainz / Spotify requests | BR-12.7 |

**Why BR-12.3 matters most.** The standing precision rule works by **exclusion**, which is invisible
in a verdict: `unknown` because MusicBrainz knew nothing and `unknown` because a `Publisher`
candidate was found and refused are the same output. Faouzia is the live case — `Faouzia Music`,
type `Publisher`, artist actually on Atlantic.

**Why BR-12.5 is mandatory.** R3 guarantees the classifier is re-tuned. After that, a recomputed
trace explains an old play with today's rules — self-consistent, plausible, and never actually run.
Same failure shape as the MusicBrainz `200`-with-`inc`-ignored catch, anticipated rather than
discovered.

**Assumption, not blocking**: trace always available, not dev-flag-gated. Local single-user app.

**Deferred to NFR Design**: whether it is `/api/explain/{playId}` or an extension of
`/api/diagnostics`, and how a historical play is selected in the UI.

## U2 Settled Design Parameters (Functional Design, 2026-08-26)
| Parameter | Value | Source |
|---|---|---|
| Join key | **ISRC only** at release level; the **exact Spotify-URL join** survives at artist level for genres alone | Q3, Q12 rescinded |
| Resolution chain | **Two calls** — `/isrc/{isrc}` then `/release?recording=…&inc=labels` | Part 5 |
| Release narrowing | **Cascade** `title+date → title → all`, tier recorded | Q1 = A |
| Tier `all` | **Caps confidence at `low`** | Q1 = A |
| Search fallback | Only `count == 1` **and** exact normalised match; `matchMethod` recorded | Q3 = B+D |
| `Publisher` candidates | **Ineligible** — never vote | Q5 = A |
| `Distributor` / untyped | Eligible, **`strength = weak`** | Q13 = A |
| `[no label]` | **`unknown`** — never `independent` | Q10 = A |
| Fold rule | Any strong `major` ⇒ `major`; `independent` requires **no** major vote | Q5 principle |
| `contested` | **Major-vs-major only**; caps confidence at `low` | Q2 = A+C |
| Confidence | **Ordinal `high`/`medium`/`low`**, per-signal votes retained underneath | Q6+Q11 = A |
| ~~Two levels~~ | ~~Release and artist stored separately, never merged~~ — **Q12 WITHDRAWN 2026-09-06.** The artist level had no valid label evidence; it is genres only | Q12 rescinded |
| Artist confidence | **Capped at `medium`** — aggregates a career, not a release | Part 6 |
| ISRC backfill | **Yes** — ⚠️ **72** one-off `GET /tracks/{id}`, re-measured 2026-09-20. The *47* was correct at 71 plays (50 rows / 47 tracks); later sweeps grew the gap to **82 rows / 72 tracks**, and it has been closed since 2026-09-03. **Still not spent** — all 82 are `outcome = 'unknown'`, so 0 are gate-eligible (open item 3) | Q7 = A |
| `likedAtEnd` | Play close **+ ~30 s grace window**, attributed by `added_at` | Q8 = A |
| Hypothesis gate | **Pre-registered**, `unknown` group reported alongside | Q9 = C |

### ⭐ The standing rule for U2 — precision over recall
User, Q5: *"prioritise accuracy in the 'Artist Is Independent' determination even if it ultimately
misses some independent products."*

**Deliberately asymmetric.** Missing an independent track costs one row; calling a major track
independent **manufactures support for the hypothesis under test**, invisibly. BR-3.1 (publishers
ineligible), BR-3.2 (`[no label]` ⇒ unknown) and BR-4.3/4.4 (any major wins) are all expressions
of it. **This principle already caught one live error** — it is what exposed that the round-1
`[no label]` recommendation was wrong.

**Migration 002** (revised 2026-08-31 for BR-13): **6 new tables** — `label_resolution`,
`label_candidate`, `label_signal_vote`, `artist_label_resolution`, `artist_label`,
`artist_label_signal_vote` — **16 new nullable `play` columns**, 6 indexes. Additive only, and
still unimplemented (`schema_version` = 1).

**Migration 004** (2026-09-06) is the first **non-additive** one: `artist_label` and
`artist_label_signal_vote` dropped, the three `artist_label_*` verdict columns dropped, and
`artist_label_resolution` / `artist_label_resolution_id` renamed to `artist_resolution` /
`artist_resolution_id`. Renamed rather than left as-is, because a table called
`artist_label_resolution` holding only genres reads as evidence that a verdict exists somewhere.
Forward-only, like the rest; the dropped rows were **derived, not observed**, and regenerable in
principle — unlike a play record, which is why the same latitude does not extend to `play` or
`observation`.

> **New session?** Read `CLAUDE.md` first, then this file, then the last few `audit.md` entries.

## 🔬 U2 — MusicBrainz first live probe (2026-08-26)
Probed against the **19 distinct ISRCs actually in `history.db`**, 47 requests, no API key, no
rate-limit rejection. Full detail in `inception/research/research-findings.md` **Part 5**.

**Working chain — 2 requests/track** (matches R11's estimate):
`GET /ws/2/isrc/{isrc}` → recording MBID, then
`GET /ws/2/release?recording={mbid}&inc=labels&limit=100` → releases with `label-info`.

⚠️ **`inc=` is silently ignored on the ISRC endpoint.** `GET /isrc/{isrc}?inc=releases` returns
**200 with no releases** — not an error. Nineteen ISRCs looked like "MusicBrainz has nothing",
which was false. **Fourth** documentation-vs-reality catch in this project, and the first where the
wrong answer was *plausible* rather than an error code. Caught only by checking against a track
known to have 44 releases.

| Coverage stage | Result |
|---|---|
| ISRC → recording | **13/19 — 68.4%** |
| …→ a **named** label | **11/19 — 57.9%** |
| Resolved but `[no label]` | 2 |
| 404 | 6 |

**⚠️ R2 confirmed and measured — the bias is recency.** Pre-2022 releases: **5/5 (100%)**.
2022-onward: **6/14 (43%)**. The misses are recent independent singles — *exactly* the population
the promotion hypothesis is about. Dropping `unknown` rows silently drops the newest independent
music first. All five `QZ*` ISRCs missed; `USUM`/`USSM`/`GBUM` (major registrants) all resolved.

**⚠️ "The label" is not a single value.** Audioslave → 44 releases → 10 labels spanning **two
different majors** (Epic/Sony *and* Interscope/Universal). Slipknot → 50 releases → 12 labels.
FR-13 anticipated ambiguity in *classifying* the label; the ambiguity actually starts one step
earlier, in deciding which label is even the input. Narrowing by Spotify's album title fires on
13/13 and cut Slipknot to the single correct label; title **and** date is more precise but fires on
only 8/13 (year-only dates, deluxe reissues).

**All three FR-13 signals exist and genuinely disagree**:
- **`type`** — `Imprint` / `Original Production` / `Distributor` / `Publisher` / null.
  ⚠️ **`Publisher` is not a label**: Faouzia's only entry is `Faouzia Music`, type `Publisher`
  (`SOCAN`) — she records for Atlantic. Including publishers **over-counts independence in the
  direction that would falsely support the hypothesis.**
- **Relationships** (`inc=label-rels`) — `imprint`, `label ownership`, `label distribution`, each
  directional and **not interchangeable**. Epic→Sony ✅, Interscope→UMG ✅, Roadrunner→Warner ✅,
  but **Spinefarm's `distribution` points at indie [PIAS] while Spinefarm is Universal-owned** ❌.
  R3 on real data — ownership and distribution must vote separately.
- **ISRC registrant prefix** — free, and the **only signal with 100% coverage**, including the 6
  tracks MusicBrainz cannot resolve.

**🚨 Search fallback misattributes.** For Ren's *Starry Night Act III*, the top **two** hits score
**100 and are different tracks**; the near-correct one scores **95**. `score` does not rank
correctness. Net over the 6 misses: 2 clean recoveries, 2 count=0, 1 with no releases, **1
confidently wrong**. A wrong label is invisible downstream; `unknown` is counted (FR-51).

> **U2's failure mode is not missing data — that is visible in the coverage counts. It is
> confident wrong data, which is not.**

## 🔑 U2 — second probe, artist-level (2026-08-26) — `research-findings.md` Part 6

Prompted by the user's Q5 answer: *"prioritise accuracy in the **Artist Is Independent**
determination even if it ultimately misses some independent products."* Precision over recall is
now a **standing rule for U2**.

**⚠️ Correction 5 — `[no label]` is NOT self-release, and Part 5's recommendation was wrong.**
Both `[no label]` artists carry real labels on their other MusicBrainz releases — **Imminence: 41
of 66 named, including Virgin Music Group (Universal)**; Red Leather: EMPIRE. The sentinel means
incomplete data entry. Treating it as `independent` would have been wrong **in the direction that
falsely supports the hypothesis**.

**🔑 An exact Spotify → MusicBrainz artist join exists** — not known at Application Design:
```
GET /ws/2/url?resource=https://open.spotify.com/artist/{spotifyArtistId}&inc=artist-rels
```
MusicBrainz stores streaming links as first-class `url` entities, so the Spotify artist ID the app
already holds is a **direct exact key** — no name matching, no `score`, none of the misattribution
hazard that made search fallback unsafe. MusicBrainz holds **three** artists named `Prof`; the join
returns the right one by construction, and resolves `Mjhanks`, which name search cannot find.

| Level | Coverage (same 19 tracks) |
|---|---|
| Release-level (ISRC chain) | **57.9%** |
| Artist-level, exact join | **88.2%** resolved · **76.5%** named label |

Recovers **5 of the 6 ISRC 404s and both `[no label]` cases**.

**⚠️ It answers a different question — do not merge the two.** Token — *Full Bag* is
`Never Too Different` (independent) at **release** level and **`Atlantic`** at **artist** level.
Both true: an Atlantic artist releasing this one independently. Plausibly *control* (is the artist
signed?) vs *treatment* (was this release a label push?) for R1. Artist-level noise to handle:
bootlegs/regional licensees inflate the set (Slipknot → Roadrunner + `Smokin' Cactus`, `Jigu
Records`), and career aggregation ignores time (Audioslave spans five labels).

## ✅ U1 live verification (2026-08-26)
User played real tracks; database inspected directly. Full evidence in
[`construction/u1-listening-history/live-verification.md`](construction/u1-listening-history/live-verification.md).

Confirmed working: automatic recording · ISRC and follow status on **every** live play ·
completions (12, ratios 0.910–0.995) · skips attributed `user` (3) · pause → `unknown` not
`skipped` · trail length proportional to duration · **0 counted gaps** · max observation gap
**3–4 s** (no missed polls) · FR-56 snapshot verified manually (68 rows, coverage header).

**⚠️ Finding — the 0.90 threshold splits a dense behavioural cluster.** Sorted by seconds
remaining at play end, the data is sharply bimodal: plays end either **≤ 23 s** from the end
(14 of 17) or **≥ 194 s** (3 of 17), with nothing between. The threshold discriminates *inside*
the crowded cluster — "16 s left" completes, "20 s left" does not. **6 of 17 plays sit within
±0.03 of it**, and two tracks skipped after ~88% are recorded as rejections, becoming false
negatives in the outcome variable.

A **fixed tail window (~30 s)** would separate this listener's behaviour with 178 s of margin —
option D from U1 FD Q1, now supported by measurement rather than speculation. **Fully correctable
retroactively**, since trails are retained (Application Design Q1 = C paying off for the first
time). Not changed unilaterally: the threshold was an explicit user decision and 18 plays is a
small sample. **Revisit at a few hundred plays.**

**Not yet observed**: rewind/replay (`rewound = false` on all 18 plays) — the path is unit- and
property-tested but has never fired against real listening.

## 🚨 OPEN DECISION — the local-only guard blocks containerised deployment
**Pre-existing U0 defect, found 2026-08-26 by exercising the container for the first time.**

`localGuard` requires `req.socket.remoteAddress` to be loopback. Traffic reaching a container via
a published port arrives from the **Docker bridge gateway**, so **every request is refused**.
Proven both ways: `/api/health` **succeeds from inside the container** (`toolCount: 30`) and is
**refused from the host** via the published port.

**The containerised deployment has never been able to serve its UI.** The app is healthy; only the
guard blocks it, and it fails closed (the safe direction).

**Not fixed** — any change relaxes the single control NFR-07's no-authentication decision rests
on, so it is the user's call, consistent with §3.5 route C and W-1. Options in
`construction/build-and-test/security-test-instructions.md`:
- **A** — run on the host (`npm start`). Works today, no change. **Recommended for now**
- **B** — in-container, trust the `127.0.0.1:3000:3000` publish for isolation and accept the
  bridge gateway as a peer, keeping Host/Origin validation
- **C** — configurable peer CIDR · **D** — `network_mode: host` (poor on Docker Desktop Windows)

## U1 fixes made during Build and Test
| Defect | Fix |
|---|---|
| **R7's SHA pin broke the Docker build** — `git clone --branch` rejects commit SHAs (exit 128) | `git init` + `git fetch --depth 1 origin <ref>` + `checkout FETCH_HEAD` |
| **Bind mount unwritable** — image ran as `node` (1000), mount arrived root-owned 755 | `scripts/docker-entrypoint.sh` chowns mount points as root, then drops via `setpriv`. Verified PID 1 = `node dist/server.js` as Uid 1000 |

⚠️ **Check build exit codes directly.** `docker compose build \| tail` reports the *pipe's* exit
code — a failing build read as success and was nearly recorded as one.

### 🔎 New capability found 2026-08-26 — saved-track ("liked") status IS available
Probed live in response to a user question. `GET /me/tracks/contains` is **403** (like
`/me/following/contains`), but `GET /me/tracks` returns **200** — 596 saved tracks, **12 requests**
at `limit=50` to cache the set. Same workaround shape as the existing `FollowedArtistsCache`.

**Pattern**: three `/contains` endpoints now confirmed blocked while every list counterpart works.
Development Mode appears to restrict the membership-check family generally — useful as a rule of
thumb for endpoints not yet tried.

**Why it matters**: liking is an *explicit per-track* positive judgement, a stronger preference
signal than follow status. For R1 it is also a **control variable** — an already-liked track is
self-evidently profile-matched rather than promoted.

**Second-order signal, recorded so it is not lost**: a track not liked when it started and liked
shortly after was almost certainly liked *because of that play* — arguably stronger than a
completion, since completion can be passive and liking cannot.

**Liked-status transitions — four-state model agreed with the user 2026-08-26.** The 2×2 over
(liked at start, liked at end) is exhaustive: `liked-during` · `unliked-during` · `kept-liked` ·
`kept-unliked`, **plus `unknown`** as a fifth member (the liked set can be unavailable).

Two asymmetries found, both recorded in research-findings.md Part 4b:
- **Informativeness**: `kept-unliked` is the *null case* covering nearly all plays, most involving
  no like/unlike consideration at all. Absence of action ≠ decision. Treat it as the reference
  level in analysis, not as an observed choice. `kept-liked` genuinely is informative, especially
  combined with a skip.
- **Detectability**: `GET /me/tracks` is **most-recently-saved first** with an exact `added_at`
  (probed). So `liked-during` costs **1 request** and is *definitively* attributable — `added_at`
  inside the play window proves it. `unliked-during` leaves **no tombstone and no timestamp**;
  mitigated by only probing when `likedAtStart` was true, using the cached rank to check a small
  `offset` window (~1–2 requests). Net: 1 request/play typical, 2–3 when already liked.

**Design**: store `likedAtStart` / `likedAtEnd` as *evidence*, derive the enum — same
observation-vs-judgement split as play outcomes. Unlike a trail, these are point-in-time facts and
cannot be reconstructed later, so they must be captured correctly at the time.

**DECIDED 2026-08-26 — include in U2.** User agreed on both the four-state model and the
placement. Also agreed: **`kept-unliked` has significantly less analytic value than the active
transitions** — it is the reference level, not an observed choice.

**U2 must therefore deliver**: a cached saved-tracks set (12 requests, TTL) · `likedAtStart` /
`likedAtEnd` captured per play as *evidence* · the derived five-state enum · migration 002 adding
the columns · a rule field in U3. Requirements to be written at U2 Functional Design.

### U1 open item for U2
**Backfilled plays carry no ISRC.** Verified live: `GET /me/player/recently-played` returns no
`external_ids` field at all. The 50 backfilled rows therefore have `isrc = null`, and U2's label
backfill will silently skip them. **U2 must decide** whether to resolve ISRCs for backfilled rows
with an extra `GET /tracks/{id}` per track, or accept that backfilled history carries no label.

## U1 Infrastructure & NFR Decisions
| Decision | Value | Source |
|---|---|---|
| SQLite driver | **`node:sqlite`** behind the NFR-10 repository interface | NFR Q1 = C |
| Write timing | **Buffer in memory, one transaction per play** (~200/day) | NFR Q2 = A |
| Database location | **Bind mount `./data/`** (directory, gitignored) | Infra Q3 = A |
| Backups | **Automatic dated snapshots** on a schedule → **FR-56** | Infra Q4 = B |
| `MCP_SERVER_REF` | **Pinned to `7b5fde6309a52a7874768c63deda7880ee85935b`** (2026-08-21) | **R7 CLOSED** |

**Q1+Q2 pair deliberately**: one transaction per play is small enough that `node:sqlite`'s
synchronous API is a non-issue — which it would not be at option B's ~28,800 writes/day.

**Mount the directory, not the file.** SQLite's `-wal` and `-shm` files must sit beside the
database. Copying the `secrets/` single-file mount pattern here would break recovery subtly.

⚠️ **Residual backup risk, accepted with the trade-off visible**: database and snapshots share
`./data/`, inside the project tree and gitignored — which makes them *more* exposed to
`git clean -xdf`, not less. FR-56 protects against corruption, **not** against losing the
directory. Cheap fixes if it later feels wrong: point `SNAPSHOT_DIR` outside the tree, or move the
mount (Infra Q3 = B). Neither needs redesign.

**U1 requires no security review** — export is a download over the existing loopback listener, so
NFR-01–07 are untouched. That is the §3.5 decision holding all the way through to infrastructure.

## U1 Settled Design Parameters
| Parameter | Value | Source |
|---|---|---|
| Completion threshold | **`completionRatio >= 0.90`** | U1 FD Q1 + Q5 |
| Below threshold at track change | `skipped` | Q2 |
| Short-play special handling | **None** — no sub-threshold flag | Q2 |
| Poll-interval floor | **Not applied** | Q6 |
| Paused/stopped, never resumed | `unknown` | Q4, Q7 |
| **Outcome enumeration** | **`completed \| skipped \| unknown`** (3 values) | Q7 — `abandoned` **retired** |
| Trail retention | Indefinite, no auto-pruning | Q3 → wishlist W-2 |
| **Ratio basis** | **Listened time**, not furthest position. `listenedMs / duration`, **unclamped — may exceed 1.0** | User, 2026-08-25 |
| **Backward jump** | **No logic at all.** Rewinding adds listening time, which raises the ratio by itself | User, 2026-08-25 |
| **Forward jump** | **Not detected.** Each step capped at elapsed wall time (arithmetic, not detection) | User, 2026-08-25 |

**The ratio change removed three rules.** Under the earlier *position-based* ratio
(`max(progress)/duration`), a rewind moved the position backwards and left the ratio unchanged, so
a rewound play scored as if the listener had stopped at the peak — which needed a special rule to
rescue. Under **listened time**, re-hearing adds to the numerator directly. Deleted as a result:
the replay-vs-rewind branch, the rewind classification rule, and forward-seek detection. The
classifier is now four branches with no special cases; all the subtlety moved into `summarise`,
which is arithmetic and exhaustively property-testable.

⚠️ **Do not clamp `completionRatio` to 1.0.** It looks like defensive hygiene and would silently
destroy the repeat-listen signal — a ratio of 2.4 means the track was heard nearly 2½ times.

**Known consequences**: a track played twice in a row is **one** play record with ratio ≈ 2.0, not
two — play counts undercount repeats, and the ratio carries that signal instead. And a rewind
followed by an early skip can still score below 0.90 (rewind at 40%, re-hear 20–40%, leave ⇒ 0.60
⇒ `skipped`); no rule added for it, since encoding intent would put a preference judgement back
into the classifier.

### ⚠️ Accepted data-quality limitation — short tracks
**Corrected 2026-08-25 during code generation** — the earlier statement ("systematically recorded
as skipped") was wrong.

A fully-played track is *guaranteed* to clear the threshold only when
`duration >= pollInterval / (1 - threshold)` = **30 s** at 3 s and 0.90. Below that, the outcome
**depends on where the final poll lands**: a 20 s track observes a ratio anywhere in 0.85–1.00, so
it is **sometimes `skipped` and sometimes `completed`**.

The limitation is therefore **intermittent, not systematic** — better in that not every short
track is mislabelled, worse in that the *same track played identically can be recorded differently
on different occasions*. That inconsistency is harder to notice and to correct for than a uniform
bias. Affects interludes, skits and short intros; ordinary music is unaffected.

Accepted deliberately (Q6 = B). Correctable via `reclassify()` from the retained trail (FR-20),
no re-collection needed. **Any analysis of short-form content must state this caveat.** Both
outcomes are pinned by tests.

**`abandoned` retired** — propagated to requirements.md (FR-18), stories.md (US-11),
components.md, component-methods.md and services.md.

## Units of Work
Units nest inside delivery phases (Q1 = C). **Phases** guarantee a runnable app; **units** are
development groupings and need not be independently runnable.

| Unit | Phase | Name | Done means |
|---|---|---|---|
| U0 | 0 | Existing application | ✅ Delivered |
| U1 | 1 | Listening History & Export | CI + **live** |
| U2 | 2 | Label Enrichment | CI + **live** |
| U3 | 3 | Rule Model & Evaluation (pure core) | **CI only** |
| U4 | 3 | Rule Observability | CI + **live** |
| U5 | 4 | Automated Skipping | CI + **live** |

*Phase 5 units (U6…U11, renumbered 2026-10-18): see [`inception/application-design/unit-of-work.md`](inception/application-design/unit-of-work.md).*

Build order **U1 → U2 → U3 → U4 → U5**, forced by the dependency matrix rather than chosen.
U3 is gated on tests alone because its correctness is entirely a property of pure functions —
a live session would tell us nothing a property test does not.

**U1 must record `skipSource='user'` from the first play.** US-13 is deliberately split across
U1 and U5: if the column arrived only with U5, every play from Phases 1–3 would be permanently
unattributed, and a later migration would have to *assume* they were user skips rather than
record it.

## Application Design Decisions
| # | Decision | Source |
|---|---|---|
| D-A | **Plays + observation trail** — play row with live verdict, plus the progress samples it came from | Q1 = C |
| D-B | **Rules as a schema-validated JSON file**; UI read-only | Q2 = A |
| D-C | **Flat layout, pure domain logic isolated** into dependency-free modules | Q3 = C |
| D-D | **Schema grows per phase** via forward-only migrations | Q4 = B |

**Structural guarantee**: `DecisionExecutor` is a strategy. In Phase 3 the only implementation is
`LoggingExecutor`, so **no code path from a decision to a skip exists** — verifiable by reading
the import graph rather than by trusting a feature flag. Phase 4 registers `SkipExecutor`.

**Integration trap recorded**: `NowPlayingService` must emit `tick` (every poll) separately from
`change` (signature-suppressed, for the UI). History capture consuming `change` would silently
lose the progress samples the outcome classifier depends on — producing verdicts that are wrong
but plausible.

**Watch item**: the pure/impure boundary. A `Date.now()` inside `outcomeClassifier`, `RuleEngine`
or `labelClassifier` fails no test but breaks FR-20 and FR-42 silently. Add a mechanical check in
Build and Test that pure modules import nothing impure.

## Delivery Phasing
Four phases, sequenced by **risk containment** rather than architectural convenience. See
[`inception/plans/execution-plan.md`](inception/plans/execution-plan.md).

| Phase | Delivers | Complexity | Consequence of a miss |
|---|---|---|---|
| 0 | Display, enrichment, tests, CI | — | ✅ Delivered |
| 1 **Remember** | Listening history + export | Low–Med | Small — verdicts recomputable from stored evidence |
| 2 **Understand** | MusicBrainz labels + **hypothesis gate** | Med | Bounded to one module |
| 3 **Decide** | Rules engine, **dry-run only** | **High** | **Contained — cannot act on playback** |
| 4 **Act** | Playback control + safety interlocks | Med | Visible but reversible |

**Key structural decision**: the rules engine (largest, least certain) and playback control (only
part that can cause harm) are in **separate phases**. The risky component ships where being wrong
costs nothing, and is validated by back-testing against real history before it is armed.

**Phase 1 must store ISRC** with every play — it makes label backfill possible, so shipping
Phase 1 before Phase 2 is not a one-way door.

**Phase 2 ends with a decision gate**: export the data and test R1 before building the engine
premised on it.

## Workspace State
- **Existing Code**: No
- **Programming Languages**: None found
- **Build System**: None found
- **Project Structure**: Empty (only `.github/` tooling instructions present)
- **Reverse Engineering Needed**: No
- **Workspace Root**: `d:/Software/Spotify`

## Rule Details Source
Resolved from additional working directory (no in-workspace rule details found):
`D:/Software/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/`

## Code Location Rules
- **Application Code**: Workspace root (NEVER in aidlc-docs/)
- **Documentation**: aidlc-docs/ only

## Extension Configuration
| Extension | Enabled | Decided At |
|---|---|---|
| Security Baseline | Partial (scoped) | Requirements Analysis (Q9 = X) |
| Property-Based Testing | Partial | Requirements Analysis (Q10 = B) |

**Q9 scoping**: user asked for security "as simple as possible, but enough to ensure it is
only ever accessed by the local system". Interpreted as: enforce the local-access rules as
blocking constraints; do not apply production-grade controls (authn/authz, secret managers,
TLS, audit logging) that are inapplicable to a single-user localhost tool. Implemented in
`src/localGuard.ts` — loopback peer check, Host validation, Origin validation.

**Q10 scoping**: PBT applies to pure functions and serialisation round-trips only. Partial
mode enforces PBT-02, PBT-03, PBT-07, PBT-08 and PBT-09 as blocking; the rest are advisory.

### PBT Compliance (as of 2026-08-24)

| Rule | Status | Evidence |
|---|---|---|
| PBT-02 Round-trip | ✅ Compliant | `parseNowPlaying.property.test.ts` — format→parse round-trip against a model of upstream's template |
| PBT-03 Invariants | ✅ Compliant | Progress ≤ duration; raw text preserved; age never negative; `pickArt` never fabricates a URL; guard never admits non-loopback |
| PBT-07 Generator quality | ✅ Compliant | `test/generators.ts` — domain generators for titles, Spotify IDs, devices, image sets, release dates. No raw primitives in domain positions |
| PBT-08 Shrinking / reproducibility | ✅ Compliant | Shrinking enabled; `test/fc-config.ts` selects and logs a seed every run; `.github/workflows/ci.yml` runs the full suite on push/PR with `FC_SEED` set from the run ID and surfaced in the job summary. Replay verified: the same seed reproduces an identical shrunk counterexample |
| PBT-09 Framework | ✅ Compliant | fast-check 4.9.0, in `devDependencies`, integrated with `node:test` |
| PBT-01, 04, 05, 06, 10 | Advisory | PBT-10 satisfied anyway (example + property tests, regressions pinned). PBT-06 N/A — no stateful component beyond simple caches |

**No open PBT findings.** The PBT-08 CI gap was closed on 2026-08-24 by adding
`.github/workflows/ci.yml`.

## Key Decisions
| Decision | Value | Source |
|---|---|---|
| Spotify MCP server | `marcelmarais/spotify-mcp-server` | Research spike — `inception/research/research-findings.md` Part 1 |
| Local runtime | Rancher Desktop (containerd + Docker Compose) | User request |
| Update transport | WebSocket push, backend polls MCP | Q5 = C |
| Playback control | Read-only now, designed for later control | Q4 = B |
| Album artwork | **Included** — reversed from Q2a | Q2a's premise was wrong: art needs no extra call or auth path. `track.album.images` returns 3 sizes on the request already being made. Reversal approved by user 2026-08-24 |
| OAuth flow | Host-side auth, token file mounted (`npm run auth`) | Q6 = X, resolved to A — Option B is technically impossible |
| Network exposure | Localhost only, enforced in code | Q7 = A |
| Deployment | Compose now, no k8s-blocking debt | Q3 = A + constraint |
| Enrichment architecture | **Hybrid** — MCP for now-playing, Web API direct for enrichment | CQ1 = A, resolved implicitly by the instruction to build read items |
| OAuth scopes | Upstream's 14 **plus `user-follow-read`** | Upstream omits it; follow-status would 403 without it |
| Token refresh | In-memory only, never written back to `spotify-config.json` | Avoids racing the MCP server's own token rewrites |
| External enrichment source | **MusicBrainz only**, pulling **label / signed-vs-independent only** | CQ2 = B, narrowed. Not genres, not play counts |
| Product framing | Estimate **likelihood a track was *promoted*** into the feed vs. profile-matched. Signed-vs-independent is a **proxy variable**, not an end in itself | CQ2 rationale |
| MusicBrainz join key | **ISRC**, from `track.external_ids.isrc` | Verified live 2026-08-25. Arrives on the `GET /tracks/{id}` call already made — costs zero extra Spotify requests |
| Unit 1 scope | **General rules engine** — the core feature. User-authored rules over **any** known track field, evaluated on **every** new track in **every** playback context, skipping on match. The age rule is one instance, not the feature | CQ3 = C, clarified by user 2026-08-25 |
| Rule representation | **Structured predicate tree** (field/operator/value + AND/OR/NOT), stored as data. **No `eval`, no code evaluation** | FR-43/44/45 — keeps the local-only security posture from depending on the rule store being trusted |
| Unknown-field semantics | **Tri-state true/false/unknown**; each rule declares its behaviour on `unknown` | FR-32/33 — neither default is safe given MusicBrainz coverage gaps (R2) |
| Rule combination | **OR only — any true rule skips.** No precedence, no exemptions, no ordering significance | Q-B = OR-only, user 2026-08-25. Seams kept for later: action is an enum, OR-folding isolated to one function |
| Slow-field timing | **Pre-warm enrichment from the queue**, don't block on it | FR-34–36. `GET /me/player/queue` verified 200 in Dev Mode 2026-08-25 |
| Persistence | **Now, in Unit 1** — listening history with skip/complete outcome | CQ4 = A |
| Persistence engine | **SQLite via `node:sqlite`** (recommended), behind a repository interface | NFR-08/09/10. Built into Node 22.17; interface contains the experimental-API risk |
| Playback control | **Enabled** (off by default) — the rules engine is inert without it | CQ3 = C supersedes Q4 = B's "later" |
| Premium prerequisite | **Confirmed active** | CQ5 = A — risk closed |

## Known Risks
| Risk | Impact | Status |
|---|---|---|
| **Spotify Premium mandatory** for Dev Mode API since 2026-03-09 | Project cannot function without it | ✅ **Closed** — CQ5 = A, Premium confirmed active |
| **`audio-features` deprecated** (Nov 2024), no replacement | "Preference alignment" goal unreachable via Spotify | ✅ **Closed** — dropped from scope (CQ2) |
| **`label` field removed** from Album (Feb 2026) | "Independent vs. signed" unreachable via Spotify | ✅ **Closed** — recovered via MusicBrainz on ISRC (CQ2 = B) |
| **`popularity` removed** from track/artist (Feb 2026) | "Number of plays" unreachable via Spotify | ✅ **Closed** — dropped from scope (CQ2) |
| **MCP server lacks get-artist/get-album/check-following tools** | Enrichment impossible through MCP alone | ✅ **Closed** — hybrid architecture (CQ1 = A), built and live-verified |
| **Promotion hypothesis may be false** — signed-vs-independent may not predict skips | The headline feature would have no predictive value | ⚠️ Open — R1. Mitigated by keeping raw data re-analysable and by dry-run rule evaluation |
| **MusicBrainz coverage gaps** on new/independent releases — the population of interest | Missing data correlated with the measured variable | ⚠️ Open — R2. `unknown` kept distinct from "independent"; track coverage rate |
| **Major/indie has no clean definition** (imprints, majors' "indie" sublabels, distributors) | Classification disagrees with intuition | ⚠️ Open — R3. Store per-signal votes, not a boolean |
| **Skip inference is heuristic** — pause, seek, replay, session end all confound it | Noisy outcome variable weakens the model | ⚠️ Open — R4. Store raw evidence; property-test the classifier |
| **A runaway rule could skip an entire queue** — higher risk now that rules are user-authored over arbitrary fields | User-visible loss of control | ⚠️ Open — R5. Dry-run, kill switch, rate limit, no-repeat-skip, off by default |
| **Slow fields can't resolve before a track starts** — a label lookup is 2 MusicBrainz calls behind a 1 req/sec queue | Label-based rules fire late or never — and those are the rules that test the promotion hypothesis | ✅ **Closed — R11, probed during active playback 2026-09-22** (this cell read *"unconfirmed during active playback"* until 2026-09-26). **Context-dependent**: album/autoplay/radio expose 7–20 tracks, **the AI DJ none, ever**; ⚠️ `context.type` cannot distinguish them, so **FR-36 must ask the queue at runtime**. The same probe found the **18–41 s reporting lag** now gating FR-46/FR-48 |
| **A rule language over arbitrary fields invites `eval`** | Arbitrary code execution reachable from the rule store, collapsing the local-only posture | ⚠️ Open — R12. Structured predicate tree; code evaluation prohibited by requirement |
| **`node:sqlite` is experimental** in Node 22.17 | API may change under us | ⚠️ Open — R10. Repository interface makes the engine swappable |
| MCP server's `getAlbums` uses a **removed batch endpoint** | That tool is already broken in Dev Mode | Noted; unused by this app |
| MCP server **declares no license** | Blocks open-sourcing this project later | Accepted for personal use (Q8 = A) |
| `getNowPlaying` returns **markdown, not JSON** | Upstream template change breaks parsing silently | Mitigated — isolated in one module, raw text surfaced |
| Extended Quota Mode requires **250k MAU + registered business** | Restrictions are permanent, not appealable | Accepted constraint |

## Stage Progress

### 🔵 INCEPTION PHASE
- [x] Workspace Detection
- [ ] Reverse Engineering — **SKIPPED** (greenfield)
- [x] Requirements Analysis — *both rounds answered; `requirements.md` written 2026-08-25.
      Awaiting user review/approval.*
- [x] User Stories — *complete 2026-08-25, approved by user. 3 personas, 7 epics, 27 stories.*
- [x] Workflow Planning — *complete 2026-08-25. Execution plan with 4 delivery phases.
      Awaiting approval.*
- [x] Application Design — *complete 2026-08-25. 24 components (9 pure, 15 impure), 6 services.
      Awaiting approval.*
- [x] Units Generation — *complete 2026-08-25. 5 work units (U1–U5) plus U0 reference.
      Awaiting approval. **INCEPTION PHASE COMPLETE.***
- [ ] Workflow Planning
- [ ] Application Design
- [ ] Units Generation

### 🟢 CONSTRUCTION PHASE
*Runs once per delivery phase, not all up front (execution plan).*
- [x] Functional Design — **U4 complete 2026-09-19, REVISED 2026-09-20**, awaiting approval —
      `construction/u4-rule-observability/functional-design/`, **BR-22…BR-32**. 11 questions +
      7 follow-ups; ⚠️ **all 7 follow-ups taken BY RECOMMENDATION**, and two of them (FQ1, FQ3)
      **modify answers the user gave explicitly** — flagged in the plan, first thing to revisit.
      **BR-20.8 is discharged** (BR-26.3). Schema **v5** proposed.
      🔵 **Senior-architect design review (Fable) 2026-09-20 — 14 findings, all verified against
      `src/` before action; 13 held, 1 probed.** Four decisions taken: **watcher owns the rule
      set** (BR-26.3a/3b), **BR-22.1 scoped to U4, no `UNIQUE`** (BR-22.1a), **`PlayObserver`
      owns segmentation** (BR-22.8/8a), **answerability is per row over two eras**
      (BR-27.5a/5b/5c). Plus BR-22.5a–c, BR-23.7a, BR-23.9, BR-24.3a, BR-27.7/27.8, BR-28.3a,
      BR-29.4/29.5, BR-31.5–31.7.
      ⚠️ **The probe disproved CLAUDE.md open item 3**: `recently-played` **does** return
      `external_ids.isrc`, and `RecentlyPlayedBackfill` has read it since **U1** — yet 0 of 82
      backfilled rows to 2026-08-31 carry one, against 4 of 4 after, and 457 of 457 live.
      ⚠️ **The cause is UNESTABLISHED and is not the code** (`webApiClient.ts` has one commit,
      the wiring never changed, the break is clean at row id 120 → 155 with no code change in
      that window). No migration marks the boundary, so no schema-derived watermark can see it —
      hence a per-row predicate. ✅ **Open item 3 corrected 2026-09-20, with 3a added.**
      **U1 complete** 2026-08-25, approved. **U2 complete** 2026-08-26,
      **approved 2026-09-05**. **U3 complete and APPROVED 2026-09-10** — 11 questions + 3
      follow-ups; artifacts at `construction/u3-rule-model/functional-design/`, **BR-14…BR-21**.
      ⚠️ **FR-33 only partially met by U3**: `hold` is deferred to U5 (Q9 = B). U4–U5 pending.
- [x] NFR Requirements — **SKIPPED** (27 NFRs already agreed in requirements.md §4)
- [x] NFR Design — **U4 complete 2026-09-20**, awaiting approval —
      `construction/u4-rule-observability/nfr-design/`, **P-19…P-26**, **LC-13…LC-22**,
      **PBT-21…PBT-33**. Q1 C · Q2 C · Q3 A · Q4 B · Q5 C, all as recommended.
      🔵 **Revised 2026-09-20 by the design review**: **LC-21 `liveFactSource`** (a real
      `enrichmentSettled`, moved out of `server.ts` — the resolver has no per-track pending
      state, and **four** uncached exits are confusable with "still working") and **LC-22
      `historyCountsBefore`** (one method for live and replay; the repository had **no** counting
      method at all). New properties **PBT-22a** ⭐ *(PBT-22 passes trivially against counts that
      are always zero)*, **PBT-30a**, **PBT-31**, **PBT-32**, **PBT-33**.
      🔴 **`fs.watch` DISPROVEN on this deployment** — 0 events over the Rancher Desktop bind
      mount while the container read new content within 1 s. BR-26's watcher is **polling**
      (5 s `stat`, hash on change) plus a reload button, both entering the same loader.
- [x] NFR Design — **U1 complete** 2026-08-25 (narrow: persistence only), awaiting approval.
      **U3 complete and APPROVED 2026-09-10** — `construction/u3-rule-model/nfr-design/`,
      **P-10…P-18**, **LC-7…LC-12**, **PBT-11…PBT-20**. ⚠️ `RuleStore.watch()` **deferred to U4**
      (Q3 = D), which also defers **BR-20.8**; diverges from `component-methods.md` by design.
- [x] Infrastructure Design — **U4 complete 2026-09-20**, awaiting approval —
      `construction/u4-rule-observability/infrastructure-design/`. Q1 A · Q2 as tabled · Q3 A ·
      Q4 A. **No new mount, volume or port** — one migration (**005**, additive) and two env
      values. ✅ **Rollback to U3's image verified safe** (`migrate` skips ≤ current version),
      *while migrations stay additive*. ⚠️ `./config` stays **`:ro`** — U4 has **no editor**, and
      compose's comment anticipating `:rw` "at U4" is wrong and gets retargeted.
      A **status bar** (Q4) surfaces recording/rules/connection/Spotify;
      `functional-design/frontend-components.md` added.
      🔵 **Revised 2026-09-20**: migration 005 also creates a **`meta` table + v5 watermark**
      (BR-31.7 — the database has only `schema_version`, verified) and carries **no `UNIQUE`** on
      the decision log (BR-22.1a — dropping one in U5 would be non-additive and retire the
      by-image rollback guarantee). ⚠️ **The `explicit`/`album_type` write path was in no scope
      table**: six places change, export serialisers and CSV headers included. Probed: both
      fields are on `recently-played`, so the backfill can populate them.
      Status bar corrected — **Recording reads `degraded`/`gaps`**, not just a null repository,
      and **Spotify reads the WebSocket snapshot**, never a polled `/api/health` (a real MCP
      round-trip per request).
      **U1 complete** 2026-08-25 (narrow: storage + R7), approved.
      **U3 complete and APPROVED 2026-09-10** — one file, one mount: `./config:/config:ro`
      (the DIRECTORY, not the file — a single-file bind mount binds an inode and breaks
      atomic rename at U4). Bounds are constants, not settings. ⚠️ FQ1 taken **by
      recommendation**, not an explicit answer.
- [x] Code Generation — **U1 complete** 2026-08-25. 10 files created, 8 modified, 7 test files.
      184/184 tests passing. **U3 complete 2026-09-11**: 7 new modules in `src/rules/`, 7 new test
      files, **620 tests passing**, typecheck clean, purity clean, no new `ALLOWED_ORPHANS`.
      ⚠️ **Wired to nothing** — `git status src/` shows only `src/rules/`; no route, no
      `server.ts` change, no schema change. U2, U4–U5 pending.
- [x] Build and Test — **U4 complete 2026-09-22.** 866 tests, 99.39% line / 93.27% branch,
      schema v6, container verified end to end, **all three live exit criteria closed**.
      ⚠️ **Five defects, four invisible to the suite**: `skip_source` asserted rather than
      observed (found by the user, not a test); `trackPlayStats` re-implementing `bucketOf`;
      `history.db` corrupted by a maintenance script run against the live container (fully
      recovered, zero rows lost); open item 4's four numbers all failing to replicate; and the
      `explicit`/`album_type` write path missing from every scope table.
      Summary: [`construction/build-and-test/u4-build-and-test-summary.md`](construction/build-and-test/u4-build-and-test-summary.md).
      **U1 complete** 2026-08-26. Build ✅, 193/193 tests, container verified.
      **U3 complete 2026-09-11** — PASS. 620 tests, 99.26% line / 93.10% branch, container built
      (exit 0) and **recreated on the new compose**: UI 200, WS handshake 101, cross-site 403,
      `/config` read-only, `integrity_check: ok`, 428 rows before and after.
      **APPROVED by the user 2026-09-19** after a re-verification pass: 620/620 tests green on
      the day of approval, working tree clean, container up and healthy, corpus grown to **504
      plays** with recording unbroken across the eight days since the build.
      ⚠️ The "one open decision blocks container use" note that stood here was **U1's**, and was
      stale — open item 1 closed 2026-09-05.
      **U2 complete** 2026-09-01, **approved 2026-09-05** after a verification pass:
      404/404 tests, typecheck clean, three defect fixes confirmed against production data.
- [x] **Phase 2 hypothesis gate (BR-11)** — pre-registered `fd09ad7`; ran 2026-09-05
      (insufficient data) and **DISCHARGED 2026-09-10 by the confirmatory run: R1 NOT SUPPORTED**
      (p = 0.888, 95% CI [−7.7%, +8.9%]). BR-11.7's single evaluation is **spent**. Runner:
      `scripts/hypothesis-gate.mjs`
- [ ] NFR Requirements — **U5: SKIPPED**, as for U1–U4 (the 27 NFRs in `requirements.md` §4 stand)
- [x] NFR Design — **U5: ALL NINE QUESTIONS ANSWERED 2026-09-30**, every one as recommended.
      Authoritative reading: [`construction/plans/u5-nfr-design-plan.md`](construction/plans/u5-nfr-design-plan.md)
      **§5.1**. ⚠️ **Q8 carried a new requirement — §5.2**: metrics proving a "light touch" on
      Spotify/MusicBrainz. Measuring it found the **3 s poll is 98.4% of the app's Spotify footprint**
      (1,200/hr of 1,220) and that **nothing counts requests at all** — `webApiClient.ts:125` throws the
      `Retry-After` away in a message string. ⚠️ **So "what is a reasonable rate" is unanswerable
      today**: MusicBrainz publishes 1 req/s (complied with, and already probed *tighter* than the
      published floor), **Spotify publishes no number at all**. Adds metrics **M1–M4** and pattern
      **P-37**. ⚠️ Idle backoff deferred as **W-7** — it changes the *recording instrument*, and is
      **blocked on M1–M4**. ⚠️ The deliverables (`logical-components.md`, `nfr-design-patterns.md`)
      ✅ **are WRITTEN 2026-10-01**: `construction/u5-automated-skipping/nfr-design/` —
      **P-27…P-37** and **LC-23…LC-31** with **PBT-34…PBT-50**.
      ⚠️ **P-30 AMENDS NFR-17 rather than satisfying it** — its `Retry-After` clause is declined for
      the skip path, because waiting 30 s then posting `next` is *"skip whatever is playing in 30
      seconds"*. **An NFR quietly not met is a defect; one explicitly amended with a reason is a
      decision**, and it is recorded in the coverage table so the next reader does not "fix" it.
      ⚠️ **PBT-34a is a positive control and not garnish**: a `drain` that posted nothing, ever, would
      satisfy all six refusal properties perfectly. ⚠️ **PBT-41 is the only property that can catch
      the P-27 defect** — checking the predicate at decision time instead of drain time is correct in
      every ordinary test and diverges only when automation is switched off *during* the 10 s
      enrichment wait, which is exactly what FR-38 is about.
      ⚠️ **This stage was nearly skipped**: every U5 document said *"next: the Code Generation plan"*,
      and four documents agreeing was one observation rather than four, because each had copied the
      next. The two questions that justified running it: **Q3**, a genuine conflict between **NFR-17's
      retry and BR-43.5's never-retry**, resolved by *did the request reach the device?*; and **Q5**,
      where the obvious "don't change state if you couldn't persist it" means **the user presses stop
      and the system keeps going**.
- [x] Infrastructure Design — **U5 COMPLETE 2026-10-01.** All six questions answered as recommended
      (Q1 **C** · Q2–Q6 **A**); deliverable at
      `construction/u5-automated-skipping/infrastructure-design/infrastructure-design.md`.
      **Migration 007** is additive only — the by-image rollback guarantee depends on it, and
      `skip_attribution` stays nulled-not-dropped for the same reason.
      ✅ **Q1 = C: a NEW `./state:/state:rw` mount, and `config/` STAYS `:ro`.** This overturned NFR
      Q5's `config/automation-state.json`, because `:rw` there would grant the app permission to
      overwrite the user's hand-authored `rules.json` — which no U5 code would use, and which BR-20.8
      would not protect (it reloads on a **parse failure**; a file truncated to valid-but-empty JSON
      parses fine). ⚠️ **`data/` was rejected because of restore**: once W-5's full-inventory backup
      exists, restoring a week-old backup would restore the week-old automation latch and **silently
      re-arm automation**.
      ✅ **The planned AI-authored rules system does not change this and strengthens it**: a kill switch
      in the same writable directory as the file an AI agent edits is a kill switch that agent can
      disable. The future `config/` → `:rw` change remains a one-word edit in the unit that adds rule
      editing.
      ✅ **Q4 = A: the BR-35 thresholds are CONSTANTS IN SOURCE, not env values** — an explicit
      exception to this project's habit, because `compose.yaml` already holds three operational numbers.
      ⚠️ The halt is reachable in normal use: the busiest hour held **27 plays**, so 10/hour trips on
      any rule matching **>37%** of tracks. If it were an env value the easy fix would be to raise it,
      after which it never fires. Precedents: the hypothesis gate's `pre-registration.md`, and
      `MAX_PREDICATE_DEPTH` (*"Only the PATH is configurable. The bounds are not."*).
      ✅ **Q5 = A: automation state survives a restart** — ⚠️ **so once armed, a reboot resumes skipping
      unattended.** FR-47's *"off by default"* means fresh install, not fresh boot. FC-U5-1's indicator
      is what makes that visible without a click.
      ✅ **Q3 = A: rollback is verified LIVE, not read from the code** — the skip line proves *007 is
      skipped*, not *U4's code runs correctly against an unread table and three unread columns*.
      ⚠️ **Still open**: the two `compose.yaml` comment corrections, the live rollback check, and the
      BR-35 pre-registration
- [ ] Code Generation — **U5: PLAN WRITTEN 2026-10-01, 2 scoping questions awaiting answers.**
      [`construction/plans/u5-code-generation-plan.md`](construction/plans/u5-code-generation-plan.md).
      13 steps, pure-first ordering, and the app's behaviour is unchanged until Step 9.
      ⚠️ **Q1**: `DecisionExecutor` is declared inside `LoggingExecutor.ts`, so `SkipExecutor` would
      import the interface from the other implementation — contradicting BR-30 in the import graph and
      muddying the P-33 structural test. Recommend moving it to `src/rules/types.ts`.
      ⚠️ **Q2**: confirms `SKIP_EXECUTOR_ENABLED` (constructed at startup) and `globalAutomationEnabled`
      (checked at the action point) are **not** redundant — collapsing them breaks FR-38, and the env
      flag is what lets U5 ship **inert** for the dry-run review.
      ⚠️ **The action point is written in Step 6, before anything can reach it**, and tested against a
      fake player client. ⚠️ **Step 12 carries the P-33 structural tests** — `src/rules/` imports nothing
      from `src/playback/`, and `spotifyPlayerClient`'s exported surface is **exactly one method**,
      asserted on the shape because the orphan check walks modules rather than methods
- [ ] Build and Test — **U5 pending.** ⚠️ Exit criterion 3 (kill switch persists across restart) is
      the one most likely to **pass on the host and fail in the container**

### 🟡 OPERATIONS PHASE
- [ ] Operations (placeholder)

## Notes

### Stage ordering deviation
Working code exists ahead of the formal Code Generation stage, built at the user's explicit
request across several turns. The Construction checkboxes above remain unticked because the
*formal stages* (Functional Design, NFR Design, Infrastructure Design) have not been executed —
not because the code is absent. What exists, live-verified against a real Spotify account:

- Now-playing display, MCP stdio client, markdown parser, WebSocket push (FR-01–FR-06)
- Enrichment: release date, age, follow status, album art (FR-07–FR-11)
- Local-only access control (NFR-01–NFR-04), host-side OAuth, 10-step diagnostics
- 100 tests passing, coverage 99.88% line / 92.86% branch on tested modules, CI green

Requirements sign-off should therefore be read as *retrospective* for FR-01–FR-11 and
*prospective* for everything added in round 2.

### Round 2 raises new work not yet started
FR-12–FR-48 are all new: MusicBrainz label resolution, persistent listening history with skip
detection, the rules engine, and playback control. None of it is built.

### Resolved question
**Q-A** (does the age rule apply everywhere, or only to DJ contexts?) — **resolved 2026-08-25:
everywhere.** The user clarified the age rule is only an example; rules apply to every new track
in every context. Playback context stays available as a *field*, so DJ-only behaviour can be
expressed as a condition inside a rule rather than imposed by the engine.

**Q-B** (are exemption / allow rules needed?) — **resolved 2026-08-25: no, not for Unit 1.**
User chose "any rule is true causes skip" as the whole combination semantics, with richer
combination as a possible future addition. Accepted limitation: "skip major-label tracks except
by artists I follow" can't be one rule; it must be folded into the predicate as
`label = major AND following = false`. Two seams preserved so it can be added later without
migrating stored rules — rule action is an **enum** (not a boolean), and OR-folding is
**isolated to one function**.

**No open questions remain from Requirements Analysis.**

### US-25 finding — RESOLVED 2026-08-25
Raised by User Stories (history was specified as collect-only, with no way to review or export
it, despite that being CQ2's whole rationale). **Resolved by user decision**: analysis happens
**outside the app** — mature reporting tools exist. Produced requirements **FR-49–55** (§3.5
Export and external analysis). US-25 rewritten as an export story; US-27 added for the
integration route. Every story now traces to a requirement.

### Export vs. local-only conflict — RESOLVED 2026-08-25
`isLoopbackAddress` accepts only `127.x` and `::1`, so a **Grafana container** on the Compose
network (e.g. `172.18.0.3`) is refused with 403 — NFR-01 working correctly, not a defect.

**User decision: download only.** No data API. FR-55 withdrawn to the wishlist (**W-1**,
requirements §5.1) pending a security architecture the project deliberately does not have —
serving an API properly would require authentication for consumers, authorisation, transport
security, audit logging and a defined container-network trust boundary, i.e. most of what Q9
explicitly excluded. US-27 retained as a **deferred** story so the reasoning stays visible.

**Consequence: NFR-01 to NFR-07 are untouched and no security work sits on any phase's critical
path.** Escape hatch if liveness is ever needed: run the dashboard **on the host** rather than in
a container — it reaches loopback and needs no security change at all.

**US-18 is not estimable yet** — its pre-warming criterion depends on queue lookahead that is
confirmed reachable but unverified during active playback (R11). Probe at the start of Phase 4.
