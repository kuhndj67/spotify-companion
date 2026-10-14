# Code Generation Plan — U8: Team Workflow & Onboarding

**Date**: 2026-10-14 · **Stage**: CONSTRUCTION — Code Generation (Part 1: Planning), Unit U8
**Status**: ✅ **APPROVED 2026-10-14** (Q1 = A: `GPL-3.0-or-later`). ▶ Executing.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield. *Generate* means modify existing files
where they exist, never duplicate them.

> ⚠️ **This plan is the single source of truth for U8 Code Generation.** Each step is checked off here as it
> completes, with any deviation recorded beside it (the U5–U7 precedent).

**Inputs (all approved)**: FD **BR-61…BR-67** (2026-10-12, amended 2026-10-14) · NFR Design **P-58…P-64**,
**LC-49…LC-57**, **PBT-68…PBT-72** (2026-10-13) · Infrastructure Design **IN-U8-1…7** (2026-10-14) · Requirements
**FR-65**, **NFR-28**, **NFR-30…34** · Stories **US-30**, **US-31**, persona **P4**

---

## Unit context

| | |
|---|---|
| **Stories** | **US-30**: install it on my own machine with my own Spotify account, from the docs alone · **US-31**: contribute a change that CI and review gate |
| **Requirements** | FR-65 install routine · NFR-28 no credentials in the repo, CI-enforced · NFR-30 branch protection · NFR-31 smoke + knip in CI · NFR-32 GPL-3.0, no published image · NFR-33 docs · NFR-34 SemVer, `package.json` the one source |
| **Depends on** | U6 (backup manifest's `appVersion`, *Restore backup* for S9) · U7 (Settings pop-up, `CredentialsWriter`, `loadMusicBrainzIdentity`) |
| **Consumed by** | **U9** (Linux walk; removes the `uN-rollback` tags) · **U10** (issues, CODEOWNERS, CHANGELOG, templates build on this CI and ruleset) |
| **Owns** | No database entities. ⚠️ **No migration**: schema stays **v7** (BR-66.6) |

### ⚠️ What must not move

- **App behaviour** changes in one place only: the **version display** (LC-57). No route is added (`frontend-components.md` §3).
- **`decideAccess`, `ingestGuard`, `localGuard.test.ts`** are untouched.
- **An existing install's `musicbrainz.json` keeps working**: `appVersion` is **ignored if present**, never
  required, and never written again (BR-66.2).
- **The live deployment is not touched by Code Generation.** Building and deploying `0.8.0`, pushing, applying the
  ruleset, the positive-control PR and the walk are all **Build & Test**.
- **Nothing outward-facing happens in this stage**: no push, no `gh api` write, no issue posted (BR-65.3 is a
  **draft**).

---

## Structure

```
.gitleaks.toml                                  LC-54  allow-list; every entry has a reason (BR-64.4)
.github/workflows/ci.yml                (mod)   LC-54/55  smoke ("LOAD check"), knip, a `Secret scan` job (range)
.github/workflows/secret-history.yml            LC-54  weekly + workflow_dispatch full-history scan
.github/rulesets/main.json                      LC-52  required checks + owner bypass
scripts/protect.mjs                             LC-53  diff, then apply via `gh api` (Build & Test runs it)
scripts/lib/releaseDecision.ts                  LC-50  ⚙️ pure
scripts/release.mjs                             LC-51  verify → decide → build → tag (Build & Test runs it)
src/version.ts                                  LC-49  the one reader of package.json's version
src/config.ts                           (mod)   identity no longer reads appVersion from musicbrainz.json
src/configuration/CredentialsWriter.ts  (mod)   stops writing appVersion
src/mcp/spotifyMcpClient.ts             (mod)   client version from LC-49
src/server.ts, src/api.ts …             (mod)   LC-57: version on diagnostics + Settings payload
public/app.js                           (mod)   renders `Version X` / `Version unknown`
secrets/musicbrainz.example.json        (mod)   appVersion removed
package.json, package-lock.json         (mod)   0.8.0 · license · `release`, `protect` scripts
compose.yaml, compose.verify.yaml       (mod)   image tag 0.8.0
LICENSE · SECURITY.md · CONTRIBUTING.md · docs/INSTALL.md       new
README.md · CLAUDE.md                   (mod)   rewritten short (BR-67.1, BR-67.3)
test/versionSources · rulesetMatchesWorkflow · secretsTracked · docs · releaseDecision.property · version.property
```

## Ordering principle

The FD's order (business-logic-model §5): **secrets first, then CI, then versions, then documents, with INSTALL
last**. INSTALL cites every other piece, so it is written once those pieces exist. Each step also puts the guard
before the thing it guards.

---

## Steps

### Step 1 — One-time full-history secret scan *(BR-64.2, P-61, P-64)*
- [ ] Download the **gitleaks** release binary for Windows into the **scratchpad**. Check it against the release's
      **published checksums file**, and record version + SHA-256. (Not installed on this PC, measured 2026-10-14.)
      The same version, and its **linux_x64** SHA-256, are what CI pins in Step 3.
- [ ] `gitleaks git --redact --report-path <scratchpad>` over **all of history**. Record the commit count scanned
      (153 at planning).
- [ ] Record the result in `construction/u8-team-workflow/code/secret-history-scan-<date>.md`: findings or **none**,
      with file, commit and rule only. **Never a value.**
- [ ] ⚠️ **P-64: any real finding STOPS U8 here.** The owner revokes and rotates the credential at its source.
      History is not rewritten (W-14). A false positive goes into `.gitleaks.toml` with a reason (Step 2).

### Step 2 — Tracked-secrets guard *(BR-64.3, BR-64.4, NFR-28)*
- [ ] `.gitleaks.toml`: extends the default rules; an allow-list holding only what Step 1 justified, **each entry
      with a reason**
- [ ] `test/secretsTracked.test.ts`: every **tracked** file under `secrets/` matches `*.example.json`, and every
      allow-list entry has a non-empty reason. **Positive controls**: an untracked `secrets/x.json` in a temp git
      repo is fine; a tracked one fails; an entry without a reason fails

### Step 3 — CI additions *(BR-63.1, BR-63.2, P-61, LC-54, LC-55)*
- [ ] ⚠️ **Probe first**: run `npm run smoke` and `npm run knip` in a **fresh clone with no `data/`, `secrets/` or
      `state/`** (a scratchpad clone). CI has none of those, and smoke has only ever run here. Record the result
      and fix only what the probe shows
- [ ] `ci.yml` `test` job: `Smoke — LOAD check only (modules load; scripts' behaviour is NOT tested)` and `Knip`
      steps, with a comment naming BR-63.2
- [ ] `ci.yml` new job **`Secret scan`**: pinned gitleaks (version + SHA-256 verified **before** it runs);
      `fetch-depth: 0`; scans the **push/PR range**, with `--redact`
- [ ] `.github/workflows/secret-history.yml`: weekly `schedule` + `workflow_dispatch`, full history, `--redact`,
      `permissions: contents: read`
- [ ] Job names are **final here**. Step 4's ruleset and test pin them

### Step 4 — Branch protection as code *(BR-63.3, BR-63.4, P-62, LC-52, LC-53)*
- [ ] `.github/rulesets/main.json`: target `main`; PR required; required checks = the CI job names exactly; **owner
      bypass**
- [ ] `test/rulesetMatchesWorkflow.test.ts`: every required check is a job name in `ci.yml`; the bypass is present.
      **Positive control**: a renamed job in a fixture copy fails
- [ ] `scripts/protect.mjs` + `npm run protect`: reads the live ruleset via `gh api`, **prints the diff**, applies
      only with `--apply`, idempotent. Default (no flag) is read-only. A **smoke** entry for that read-only mode. ⚠️
      **Not run against GitHub in this stage**

### Step 5 — The one version reader *(BR-66.1, BR-66.2, P-59, LC-49, PBT-72)*
- [ ] `src/version.ts`: `readAppVersion(packageJsonPath)` returns a valid SemVer string or `'unknown'`. It never
      throws and never returns `0.1.0`. Any existing reader of `package.json` moves here
- [ ] `test/version.property.test.ts` (**PBT-72**): missing file, malformed JSON, no `version`, non-SemVer →
      `unknown`. Plus a **positive control**: valid versions, including pre-releases, come back unchanged
- [ ] `config.ts`: the MusicBrainz User-Agent takes the version from LC-49. `appVersion` in the file is **ignored if
      present**, and an existing test with the field still passes
- [ ] `CredentialsWriter.ts`: no longer writes or defaults `appVersion`. Its existing tests run **unchanged first**,
      then are updated for this one field
- [ ] `spotifyMcpClient.ts`: client version from LC-49 · `secrets/musicbrainz.example.json`: `appVersion` removed
- [ ] Backup manifest's `appVersion` comes from LC-49

### Step 6 — `0.8.0` and the drift guard *(BR-66.3, P-58)*
- [ ] `package.json` (+ lock) → **`0.8.0`**; `compose.yaml` and `compose.verify.yaml` image → `spotify-now-playing:0.8.0`
- [ ] `test/versionSources.test.ts`: both compose tags equal `package.json`'s version; no version literal in `src/`
      or `secrets/*.example.json`. **Positive control**: a fixture with `0.1.0` in compose fails
- [ ] ⚠️ The rollback image for `0.8.0`'s deploy is the existing **`spotify-now-playing:0.1.0`**. Building `0.8.0`
      does not overwrite it (a new tag), so no hand-made `u7-rollback` is needed. Build & Test confirms it exists
      before deploying

### Step 7 — Release decision and shell *(BR-66.4, BR-66.7, P-60, LC-50, LC-51, PBT-68…71)*
- [ ] `scripts/lib/releaseDecision.ts` ⚙️: `decide({candidate, gitTags, imageTags, verifyPassed})` →
      `{accept} | {refuse, reason}`
- [ ] `test/releaseDecision.property.test.ts`: **PBT-68** strictly greater · **PBT-69** pre-release order ·
      **PBT-70** existing tag refuses · ⭐ **PBT-71** next PATCH/MINOR/MAJOR **is accepted** (positive control)
- [ ] `scripts/release.mjs` + `npm run release`: `--plan` (default) prints the decision and the commands it would
      run. `--apply` runs verify → build → `docker compose up -d` → health check → `git tag`. **Does not push.**
      A smoke entry for `--plan`
- [ ] `knip` clean with both new scripts

### Step 8 — Version display *(LC-57, `frontend-components.md`)*
- [ ] `/api/diagnostics`: `App version 0.8.0 · Database schema v7`, labelled so the two cannot be confused (BR-66.6)
- [ ] Settings status payload carries the version; `public/app.js` renders `Version X` at the bottom of the Settings
      pop-up, or **`Version unknown`**, never blank
- [ ] Route tests in `api.test.ts` for both values, including `unknown`
- [ ] **Click-test and LOOK** at it in the browser (U6 lesson). Done in Build & Test on the deployed image, and
      noted here as owed

### Step 9 — Licence and security *(BR-65, BR-67.4)*
- [ ] `LICENSE`: GPL-3.0 text **unmodified**, fetched from gnu.org and its SHA-256 recorded · `package.json`
      `license` per **Question 1**
- [ ] `SECURITY.md`: `kuhndj67@hotmail.com`; no public issues for vulnerabilities; scope: the local-only guard, the
      upload admission path, credential handling; W-14 noted
- [ ] **Draft** of the upstream licence request for `spotify-mcp-server` →
      `construction/u8-team-workflow/code/mcp-licence-issue-draft.md`. ⚠️ **The owner posts it**, not Claude

### Step 10 — CONTRIBUTING, README, CLAUDE.md *(BR-67.1–67.3, BR-63.3)*
- [ ] `CONTRIBUTING.md`: the two paths (fix → PR + `npm run verify`; feature → AI-DLC with owner-approved gates) ·
      **the non-obvious traps** carried from `CLAUDE.md`, condensed but none dropped · the owner's direct-push bypass
      stated
- [ ] `README.md`: short. What it is (a **testable, unproven hypothesis**), status, version (by reference to
      `package.json`, **no hand-written counts**), licence, links. The 463-line text is **removed, not moved**
- [ ] `CLAUDE.md` ≤ **200 lines**: orientation, *probe, don't reason*, a pointer to the traps in CONTRIBUTING,
      commands, where state lives, and **"current state: `aidlc-docs/aidlc-state.md`"**. The dated history is
      **removed**; it already lives in `audit.md` and the HANDOFFs. ⚠️ **Before removing it**, every dated block
      that is **not** in `audit.md` (checked by date) is listed in the step's record. *Commit directly to `main`*
      is rewritten as *PRs; the owner's bypass*

### Step 11 — `docs/INSTALL.md` and the docs test *(FR-65, BR-61, BR-67.5, P-63)*
- [ ] ⚠️ **Probes before writing the steps they decide** (business-logic-model §1, *open for Code Generation*):
      can S4 move after S7 (credentials in Settings, FR-69) as the primary path · the port when `3010` is taken ·
      on Linux, what Rancher Desktop supplies that Docker Engine does not (`TRUST_PUBLISHED_PORT`, mount
      ownership). The Linux items are **written but marked *not yet walked (U9)***, never asserted
- [ ] S1–S10, each with purpose · commands (Windows / Linux, or *identical*) · **expected output** · *if it
      differs*. Written for a person **and** an agent (BR-61.2). Ends on a **positive** check (BR-61.6). S3 says
      Development Mode's limits; S10 says automation is off and does not arm it. *"If the repository is private,
      you need read access"* at S2
- [ ] `test/docs.test.ts` (P-63): every `npm run` exists · links and paths resolve · README has no hand-written
      counts · `CLAUDE.md` ≤ 200 lines · each INSTALL step has the four parts. Its header says what it **cannot**
      check (command **output**, which is the walk's job)

### Step 12 — Verify and summarise
- [ ] `npm run verify` green (typecheck · test · smoke · knip). Test count recorded **from the run**, not by hand
- [ ] `construction/u8-team-workflow/code/code-summary.md`: files created vs modified, deviations from this plan, and
      what is **owed to Build & Test**: release `0.8.0` (deploy, rollback `0.1.0` confirmed present) · push · `npm
      run protect --apply` + the refused PR (BR-63.5) · the click-test (Step 8) · the walk guide with IN-U8-3's
      token guide · the VM work (IN-U8-2, IN-U8-4) · walk ① → `1.0.0-beta.1`
- [ ] HANDOFF, `aidlc-state.md`, `audit.md` updated

---

## Questions

### Question 1 — `LICENSE` variant *(BR-65.1 left this for Code Generation)*

The licence text is the same either way; what differs is the notice in `package.json` and file headers.

A) **`GPL-3.0-or-later`**: the notice the GPL itself suggests. Code can later be combined with GPL-licensed code
under a future GPL version. You are currently the sole author, so you can still change it later; once contributors
exist, changing it needs their agreement ⭐ *recommended*

B) **`GPL-3.0-only`**: you never agree in advance to the terms of a GPL version that has not been written yet. The
cost: if a future GPL v4 appears, code released under v4 only cannot be combined with this project without
relicensing it. That is rare in practice

[Answer]:
A
---

## Story traceability

| Story | Steps |
|---|---|
| US-30 (install from the docs alone) | 5, 6, 8, 9, 11 — proved by walk ① in Build & Test |
| US-31 (contribute through gated CI) | 1, 2, 3, 4, 7, 10 — proved by the refused PR in Build & Test |
