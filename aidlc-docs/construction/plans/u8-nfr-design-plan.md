# NFR Design Plan — U8: Team Workflow & Onboarding

**Date**: 2026-10-12 · **Stage**: CONSTRUCTION — NFR Design, Unit U8
**Status**: 📋 **PLAN — 7 questions open.**
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U8 Functional Design (**approved 2026-10-12**) — `business-rules.md` **BR-61…BR-67**,
`domain-entities.md`, `business-logic-model.md`, `frontend-components.md` · requirements **FR-65**, **NFR-28,
NFR-30…NFR-34**

**NFR Requirements: SKIPPED**, as for U1–U7.

> **U8's non-functional risk is decay, not load.** Nothing here runs hot; what fails is a gate that silently stops
> gating (a renamed CI job that protection still waits for, a scanner whose allow-list grew), a version written in
> two places that drift, and a document whose commands stopped being true. So the bias of every pattern below is
> **make the claim testable, and test it where it can fail**.

---

## 1. Unit context

| | |
|---|---|
| **NFRs in play** | **NFR-28** secrets · **NFR-30** protection · **NFR-31** smoke in CI · **NFR-32** licence / no image · **NFR-33** docs accurate · **NFR-34** versions · **NFR-20/21** property tests with logged seeds |
| **Allocates** | **P-58 …** · **LC-49 …** · **PBT-68 …** (U7 ended at P-57, LC-48, PBT-67) |
| **Schema** | ⚠️ **None** — stays v7 |

## 2. Facts measured for this plan — 2026-10-12

| | |
|---|---|
| Version reader | `readAppVersion()` in `src/server.ts:923` reads `package.json` one level above `src/`/`dist/` — **already one reader for the backup manifest**. `loadMusicBrainzIdentity` (`src/config.ts:256`) and `CredentialsWriter` (`:191`) carry their own `'0.1.0'` |
| Image tag | A **literal** `spotify-now-playing:0.1.0` in `compose.yaml` and `compose.verify.yaml`. Compose cannot read `package.json`; `docker compose build` **overwrites** an existing tag |
| CI job names | `Typecheck, test, build` and `Container image builds` — what branch protection would have to name exactly (BR-63.4) |
| gitleaks | **Not installed** on the host. In CI it can run as a pinned binary, the official container image, or `gitleaks/gitleaks-action` (⚠️ that action requires a paid licence key for **organisation** accounts; this repo is personal — to be confirmed by running it, not by reading its README) |
| GitHub Pro | Classic branch protection **and** rulesets both available (re-probed 2026-10-12) |

## 3. What this stage must produce

- `construction/u8-team-workflow/nfr-design/nfr-design-patterns.md` — **P-58 …**
- `construction/u8-team-workflow/nfr-design/logical-components.md` — **LC-49 …**, **PBT-68 …**

---

## 4. Questions

### Question 1 — ⭐ Maintainability — How does the image tag "derive" from `package.json`?

BR-66.1 says one source; BR-66.7 says a tag is never overwritten. Compose files cannot read `package.json`, and an
installer runs plain `docker compose up --build`.

A) **The compose files keep a literal tag, and a test fails unless it equals `package.json`'s version** (both compose
files). The copy cannot drift, because CI refuses it. Immutability is enforced by **`npm run release`** (the owner's
path): it refuses to build `X.Y.Z` if that image or the `vX.Y.Z` tag already exists, or if the version is not greater
than the last tag. Installers build from source and are unaffected. ⚠️ This **reads BR-66.1 as "derived or
mechanically checked equal"** — stated in the patterns, not left implicit ⭐ *recommended*

B) Compose uses `image: spotify-now-playing:${APP_VERSION:?…}` with a generated `.env`. ⚠️ A fresh clone has no `.env`,
so the install routine gains a step that exists only to feed compose

C) Compose uses an unversioned local tag; only `npm run release` applies the version tag. ⚠️ An installer's
running image then carries no version in its tag at all

[Answer]:

---

### Question 2 — Security — How does the secret scan run?

A) **The official gitleaks binary, pinned by version and checksum, run as a CI step** — on a push or PR it scans
the **commits in the range**; a **scheduled weekly job** scans full history (the one-time scan made routine). A
committed `.gitleaks.toml` holds the allow-list, every entry with a reason (BR-64.4). No third-party action, no
licence key question ⭐ *recommended*

B) `gitleaks/gitleaks-action` — simpler, but the licence-key condition must be probed, and it is a third-party action
with repository read access

C) The gitleaks container image in a step — like A, without the checksum step

[Answer]:

---

### Question 3 — Security / resilience — How is branch protection applied and kept true?

A) **A ruleset defined as a committed JSON file**, applied by `npm run protect` (`gh api`, idempotent, prints the
diff before applying). A **test** reads the ruleset file and `ci.yml` and fails if a required check names a job that
does not exist — so renaming a job breaks CI **before** it can leave `main` waiting for a check that never reports
(BR-63.4). The owner bypass is in the file, visible. Positive control (BR-63.5) recorded once ⭐ *recommended*

B) Classic branch protection set in the web UI, documented in CONTRIBUTING. ⚠️ A setting nobody can diff or test

C) As A, but with classic protection instead of a ruleset

[Answer]:

---

### Question 4 — Maintainability — Keeping the documents true (BR-67.5)

A) **A `docs` test** in the suite: every `npm run <x>` in `README.md`, `docs/INSTALL.md`, `CONTRIBUTING.md` and
`CLAUDE.md` exists in `package.json`; every relative link and file path resolves; README carries **no hand-written
counts** (tests, plays) — the old README's decay; `CLAUDE.md` is **≤ 200 lines** (BR-67.3); every INSTALL step has
the four parts of BR-61.1 (purpose, command, expected, if it differs). What it cannot check — that a command's
*output* still matches — is the cold walk's job, and the test's header says so ⭐ *recommended*

B) As A without the INSTALL structure check

C) No test; the cold walk and review only

[Answer]:

---

### Question 5 — Logical components — Where does U8's code live?

A) **`src/version.ts`** — the one reader of `package.json` (moved from `server.ts`), used by the backup manifest, the
User-Agent, diagnostics and Settings · **`scripts/release.mjs`** (`npm run release`) · **`scripts/protect.mjs`**
(`npm run protect`) + `.github/ruleset-main.json` · **`.gitleaks.toml`** · tests: `version`, `release` (pure
decision part), `ruleset-vs-workflow`, `secrets-tracked`, `docs`. Scripts follow the existing pattern — a pure
decision module tested, a thin impure shell checked by `smoke` ⭐ *recommended*

B) Everything in one `scripts/u8.mjs`

X) Other

[Answer]:

---

### Question 6 — Testing — Property obligations

A) **PBT for the release decision**: for any existing tag set and candidate version, `release` refuses unless the
candidate is a valid SemVer **strictly greater** than every existing tag, and pre-releases order correctly
(`1.0.0-beta.2 < 1.0.0`). **PBT for the version reader**: any `package.json` without a valid version yields
`unknown`, never a throw and never `0.1.0` (the fallback BR-66.2 removes). Plus a **positive control**: a valid
increasing version is accepted — a `release` that refused everything would pass every refusal property ⭐
*recommended*

B) Example tests only

[Answer]:

---

### Question 7 — Security — What the history scan does if it finds something (BR-64.5)

A) **Stop U8 at that point.** The finding is reported to the owner with file, commit and rule — **the value is never
printed in full** (gitleaks `--redact`). The owner revokes and rotates at the source; Claude does not rewrite history.
U8 resumes when the owner confirms rotation; the scan result records the finding as *rotated*, with the allow-list
entry and its reason ⭐ *recommended*

B) Record it and continue; rotation tracked as a backlog item

[Answer]:

---

## 5. Out of scope for U8 NFR Design

- **Where the agent cold walk runs** (Windows Sandbox, a VM, a cloud runner) — that is **Infrastructure Design**.
  ⚠️ Flagged now because it may not be simple: the walk needs Docker, and a sandboxed Windows may not run a nested
  container engine. To be **probed** there, not assumed.
- Team operations (issues, CODEOWNERS, CHANGELOG) — **U10**.
