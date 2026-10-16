# U8 Business Rules — Team Workflow & Onboarding

**Unit**: U8 (Phase 5) · **Date**: 2026-10-12 · **Settled answers**: [`u8-functional-design-plan.md`](../../../construction/plans/u8-functional-design-plan.md) §3
**Requirements**: FR-65 · NFR-28, NFR-30–NFR-34 · **Stories**: US-30, US-31 (Requirements Question 20)
**Numbering**: BR-61…BR-67 (U7 ended at BR-60)

U8's product is a set of documents and gates, not runtime behaviour. Its rules are the conditions that make a
document **trustworthy** and a gate **real**. The project's recurring failure has been a recorded claim that nothing
re-tests (CLAUDE.md, *"a recorded reassurance decays exactly like a recorded negative"*); most rules below exist to
give a document a test.

---

## BR-61: The install routine (FR-65, US-30)

| # | Rule | Source |
|---|---|---|
| **BR-61.1** | `docs/INSTALL.md` is **one ordered list of steps**. Every step has: a **purpose** (one sentence), the **command(s)** per platform where they differ, the **expected output** (literal text or a stated shape), and **what to do if it differs**. A step with no verification is not a step — it is folded into one that has one | Q17 = C |
| **BR-61.2** | ⚠️ **Written once, for a person and an AI agent.** No step depends on seeing a screen without saying what to look for in words; no step relies on "you'll know". Where a step can only be checked in the browser, the expected text is quoted | Q17 = C |
| **BR-61.3** | **Supported platforms**: **Windows + Rancher Desktop** and **Docker Engine on Linux**. A platform-specific command is shown for each, or marked as identical. **macOS is *untested*.** ⚠️ *Amended 2026-10-14 (Infrastructure Q1 = A)*: the MacBook is too old for VS Code or Claude Code, so the agent walk moved to the Windows VM `kuhndjwin11pro` and macOS went back to *untested*. *(2026-10-12 had made macOS supported for the MacBook walk.)* Linux is walked in **U9** | Q3 = A, amended 2026-10-12 and 2026-10-14 |
| **BR-61.4** | **Each user registers their own Spotify developer app**; the routine never ships, suggests or reuses a client id. Development Mode's limits are stated (the app works for the registering account and up to the allow-listed users) | Q17a = A |
| **BR-61.5** | ⚠️ **First start needs `secrets/musicbrainz.json`** — the app **refuses to start** without a real contact (NFR-14, `loadMusicBrainzIdentity`), so Settings cannot be used for it on a fresh install. The routine creates it from the example **before** the first `compose up`. Spotify credentials **may** be entered in Settings after first start (the app runs credential-less — observed on U6's verification copy) | measured 2026-10-12 |
| **BR-61.6** | The routine ends with a **positive** check, never an absence: the UI responds, the Spotify indicator is **ok**, and a play is recorded while music plays. ⚠️ *"No errors"* is not a pass — absence of data is not a signal (CLAUDE.md, 2026-10-01) | project rule |
| **BR-61.7** | Moving history in is an **optional** step through *Restore backup* (U6) — never a file copy into `data/`. Credentials and the automation switch never travel with it (FR-60, FR-61) | US-30 |
| ~~**BR-61.10**~~ | **WITHDRAWN 2026-10-14** (Infrastructure Q1 = A: no Mac walk). Its principle carries over to Linux in U9: *a platform is not supported on the strength of another platform's probe.* Original text: ~~The **arm64** image build (Apple Silicon), **SQLite WAL over the macOS bind mount**, and the bind-mount ownership seen by the container are **probed on the Mac before the walk** — each was proved only on Windows / Rancher Desktop. A platform is not supported on the strength of another platform's probe~~ | added 2026-10-12, withdrawn 2026-10-14 |
| **BR-61.8** | Each user builds **their own image** from source. The routine never pulls a published image, because none may be published (NFR-32, BR-65) | Q5 = A |
| **BR-61.9** | Automation is **off** at the end of a fresh install, and the routine says how it is turned on and what arming means — never arms it | FR-47 |

## BR-62: The cold walk (FR-65 exit criterion; NFR-34's 1.0.0 trigger)

| # | Rule | Source |
|---|---|---|
| **BR-62.1** | A **cold walker** has **only** `docs/INSTALL.md` and a clean environment: no clone history read beforehand, no `CLAUDE.md`, no `aidlc-docs/`, no help from the owner beyond what a step's *if it differs* says | Q2 = C |
| **BR-62.2** | **Two walks, in order.** ① A **fresh AI agent — a new Claude Code session on the clean Windows 11 VM `kuhndjwin11pro`**, reverted to its `clean` checkpoint, with a newly registered Spotify app — **U8's exit criterion**, released as **`1.0.0-beta.1`**. ② **A person** who did not write it, on **whatever platform they have — recorded, not prescribed** — the **`1.0.0`** trigger. **Linux** is walked by U9 (the NAS). ⚠️ *Amended 2026-10-12 (user)*: the walk machine was a Windows Sandbox or VM; the NAS was considered and rejected for the walk because a least-authority deploy credential cannot give the shell a cold walk needs. ⚠️ *Amended again 2026-10-14 (Infrastructure Q1 = A)*: MacBook too old → `kuhndjwin11pro`; walk ②'s platform no longer prescribed | Q2 = C, NFR-34, amended 2026-10-12 and 2026-10-14 |
| **BR-62.6** | ⚠️ **The cold agent must not receive the project's tacit knowledge by accident.** Claude Code loads `CLAUDE.md` from the working tree automatically, so a walk session started inside the clone is **not cold**. The walk starts in a folder holding only `INSTALL.md`; whether the cloned repo's `CLAUDE.md` is loaded once the agent works inside it is **probed before the walk** (Infrastructure Design), and prevented if so. No memory files, no project settings on the walk VM *(was "on the Mac" — amended 2026-10-14)*. Probe and its outcomes: `infrastructure-design.md` IN-U8-4 | added 2026-10-12 |
| **BR-62.3** | ⚠️ **Any step that needed outside knowledge fails the walk**, even if the walker succeeded by working it out. The fix goes into the document and **that step is walked again**; a walk is recorded as passed only when every step passed as written | FR-65 |
| **BR-62.4** | U9's NAS install by the owner **counts toward** walk ② only if every step passed as written — the owner is the least cold walker there is, so their walk can find gaps but cannot prove their absence | Q2 = C |
| **BR-62.5** | Every walk is **recorded**: date, walker, platform, each step's observed output against the expected, and every deviation. An unrecorded walk did not happen | project rule |

## BR-63: CI and `main` (NFR-30, NFR-31, US-31)

| # | Rule | Source |
|---|---|---|
| **BR-63.1** | CI runs on every push and every PR: **typecheck, tests, `smoke`, `knip`, the secret scan** (BR-64), the build and the container build | NFR-30, Q14 |
| **BR-63.2** | ⚠️ **`smoke` is labelled in CI as a LOAD check**: it proves every script's modules load, not that the scripts behave. The step name and a comment say so, so a green `smoke` is never read as *the scripts work* | NFR-31 |
| **BR-63.3** | `main` is **protected**: changes arrive by PR, and every check in BR-63.1 is **required** to pass. ⚠️ **The owner may push directly** (bypass), and that exception is stated in `CONTRIBUTING.md`, not hidden in settings | Q13 = B, Q1 = B |
| **BR-63.4** | ⚠️ **A required check that does not run is a failure, not a pass.** Required checks are named exactly as the workflow names them; renaming a job without updating protection would leave `main` waiting for a check that never reports — or, worse, unprotected. Verified **by a PR that is meant to fail** (BR-63.5) | project rule |
| **BR-63.5** | **Positive control**: the protection is shown to work by a throwaway PR that deliberately breaks one check and is **refused merge**. Protection that was never seen to refuse is a belief about a setting (the U5 PBT-34a lesson) | project rule |

## BR-64: Secrets (NFR-28)

| # | Rule | Source |
|---|---|---|
| **BR-64.1** | **`gitleaks` scans every push and PR** in CI; a finding fails the build | Q4 = A |
| **BR-64.2** | **A one-time full-history scan** is run during U8 and its result recorded (findings or *none*, with the commit count scanned). ⚠️ Only the `*.example.json` files have ever been added under `secrets/` — but that says nothing about a token pasted into a doc or a script, which is what the scan is for | Q4 = A |
| **BR-64.3** | **A test fails if any tracked file under `secrets/` is not `*.example.json`** — the rule NFR-28 names, independent of the scanner's patterns | NFR-28 |
| **BR-64.4** | An allow-list entry for a scanner finding needs a **reason in the file** (the `ALLOWED_ORPHANS` precedent). A silent allow-list is a disabled scanner | project rule |
| **BR-64.5** | ⚠️ **A finding in history is a rotation, not a deletion.** If the history scan finds a real credential, it is **revoked and rotated at its source first**; rewriting history is a separate decision (W-14) and never a substitute | security |

## BR-65: Licence and the MCP server (NFR-32)

| # | Rule | Source |
|---|---|---|
| **BR-65.1** | `LICENSE` at the root is the **GPL-3.0** text, unmodified; `package.json` says `GPL-3.0-only` (or `-or-later` — decided in Code Generation, recorded) | Q16 = C |
| **BR-65.2** | ⚠️ **No built image is published** while the bundled `spotify-mcp-server` has no licence. *(Status 2026-10-16: MIT upstream at `6065ce5c`; our pin predates it, so this holds until **W-15**.)* The README and INSTALL say each user builds their own | NFR-32, Q5 = A |
| **BR-65.3** | An upstream issue asking for a licence is **drafted** for the owner to post; Claude does not post it (outward-facing) | Q5 = A |

## BR-66: Versions and releases (NFR-34)

| # | Rule | Source |
|---|---|---|
| **BR-66.1** | **`package.json` is the one source** of the app version. Everything else **derives** from it: the image tag, the backup manifest's `appVersion`, the MusicBrainz User-Agent, the UI and `/api/diagnostics` | NFR-34 |
| **BR-66.2** | ⚠️ **`appVersion` leaves `musicbrainz.json`** — the example, every install's copy (ignored if present, never written again), `loadMusicBrainzIdentity`'s `'0.1.0'` fallback, and `CredentialsWriter`'s default. A per-install copy is a version no release can reach | NFR-34 |
| **BR-66.3** | **The first numbered version is `0.8.0`** (U0–U7 delivered), tagged `v0.8.0` on U8's first release. **No retroactive tags** — they would claim releases that never happened | Q8 = A |
| **BR-66.4** | **A release** is: `npm run verify` green → version bumped → image built and tagged **`spotify-now-playing:X.Y.Z`** → deployed → `vX.Y.Z` git tag on that commit. A deployed image that does not match a tag is not a release | NFR-34 |
| **BR-66.5** | **Rollback uses the previous version's image** (`spotify-now-playing:<previous>`), never a hand-made tag. Existing `u4/u5/u6-rollback` tags are kept until U9 completes, then removed | Q8 = A |
| **BR-66.6** | The **schema version stays separate**: it answers *can this database be opened*, the app version *which code is this*. Neither is derived from the other | NFR-34 |
| **BR-66.7** | ⚠️ An image tag is **never overwritten**. Building `X.Y.Z` when that tag exists is refused; a changed build is a new PATCH. (Today every build overwrites `0.1.0` — the reason rollback needed hand-made tags) | NFR-34 |

## BR-67: Documents (NFR-33, Q6, Q7)

| # | Rule | Source |
|---|---|---|
| **BR-67.1** | `README.md` is **short**: what the app is (including that its purpose is a **testable, unproven hypothesis**), its status and version, the licence, and links to INSTALL / CONTRIBUTING / SECURITY. The 463-line walking-skeleton text is **removed**, not moved — anything still true and useful lands in the document that owns it | Q15 = A |
| **BR-67.2** | `CONTRIBUTING.md` states **two paths**: a **fix** (behaviour already specified) is a PR with tests and `npm run verify` green; a **feature or new requirement** re-enters AI-DLC (Inception → unit design) with the owner approving each gate. It carries the project's **non-obvious traps** (from `CLAUDE.md`) as the shared core, and the owner's direct-push exception (BR-63.3) | Q7 = A, Q6 = A |
| **BR-67.3** | `CLAUDE.md` becomes a **short orientation (≤ 200 lines)** for any contributor's agent: what this is, the working rules (probe, don't reason), the traps, the commands, where state lives. ⚠️ The dated *Current state* history is **removed, not copied** — it already lives in `audit.md` and each unit's `HANDOFF.md`. Single-developer statements (*commit directly to `main`*) are rewritten for PRs | Q6 = A |
| **BR-67.4** | `SECURITY.md` names **`kuhndj67@hotmail.com`** as the reporting channel, asks reporters not to open public issues for vulnerabilities, and says what is in scope (the app's local-only guard, the upload admission path, credential handling). ⚠️ Moves to GitHub private vulnerability reporting under **W-14** | Q10 = B |
| **BR-67.5** | ⚠️ **A document makes no claim it does not test.** Every command in INSTALL and CONTRIBUTING is one the cold walk or CI runs; every count or version in README is derived (or stated with a date). A number written by hand is the decay pattern the old README is the proof of | project rule |
| **BR-67.6** | No document names a credential value, a real client id, or the owner's Spotify account. The owner's NAS address may appear in U9 design records (memory: OK to name), never in INSTALL | NFR-28 |
