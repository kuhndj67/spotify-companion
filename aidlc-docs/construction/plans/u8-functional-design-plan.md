# U8 Functional Design Plan — Team Workflow & Onboarding

**Date**: 2026-10-12 · **Stage**: CONSTRUCTION — Functional Design, Unit **U8** (Phase 5)
**Status**: ✅ **ALL ANSWERED 2026-10-12** — Q1 B · Q2 C · Q3 A · Q4 A · Q5 A · Q6 A · Q7 A · Q8 A · Q9 A (ratified, Requirements Q20) · Q10 B (`<email address>`; W-14). ▶ FD artifacts written: `construction/u8-team-workflow/functional-design/`.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: `unit-of-work.md` §U8 · requirements **FR-65**, **NFR-28, NFR-30–NFR-34** · U6 and U7 as built (the
install routine documents *Restore backup*, the in-app rules and credential steps)

> **U8 is the first unit whose product is not code.** Its deliverable is that a second person can review, install
> and contribute **without this project's tacit knowledge**, and its exit criterion is that the install is
> **walked cold** by someone who did not write it. Most of the "business logic" is a procedure, and the business
> rules are the conditions that make the procedure trustworthy: every step verifiable, nothing secret in the
> repository, nothing merged to `main` without CI.

---

## 1. Unit context

| | |
|---|---|
| **Phase** | 5 — *Share* · build order U6 → U7 → **U8** → U9 |
| **Settled already** (Requirements round 2026-10-07, Q13–Q17b; Q18 2026-10-12) | `main` protected, PRs + required CI, owner may push directly (Q13 = B) · `smoke` and `knip` in CI (Q14 = A) · short README + `docs/INSTALL.md` + `CONTRIBUTING.md` (Q15 = A) + `SECURITY.md` · **GPL-3.0** (Q16 = C) · one install routine for a person **and** an AI agent, every step with its verification command and expected output (Q17 = C) · each user registers their own Spotify app (Q17a = A) · credentials never in the repo, CI-enforced (Q17b = B) · **SemVer pre-1.0** (Q18 = A → NFR-34) |
| **Gates** | **U9** — the NAS deployment is performed **by following U8's install routine**, so the cold walk is U9's verification too |
| **Stories** | None yet — Q9 below |

---

## 2. Facts measured for this plan — 2026-10-12

| | |
|---|---|
| ⚠️ **Branch protection is UNAVAILABLE** | `kuhndj67/spotify-companion` is **private on a free plan**. `GET …/branches/main/protection` and `GET …/rulesets` both return **403 "Upgrade to GitHub Pro or make this repository public"**. **NFR-30 cannot be met as written** without one of those — Q1 |
| CI today | `.github/workflows/ci.yml`: typecheck, `test:coverage`, build, and a container build. **No `smoke`, no `knip`, no secret scan** — the gap owed from U5 NFR Q9, and NFR-28/31 |
| `secrets/` in history | Only the three `*.example.json` files have **ever** been added under `secrets/` (all 142 commits checked). ⚠️ That says nothing about secrets **outside** `secrets/` — no full-history scan has been run |
| Docs | `README.md` is **463 lines** describing a "walking skeleton". **No** `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md` or `docs/` |
| `CLAUDE.md` | **1196 lines**, mostly a dated history of findings, written for one developer and one AI session |
| Version | `0.1.0` in `package.json`, both compose files' image tags, `secrets/musicbrainz.example.json` (and every install's own copy), and a fallback in `src/config.ts:256`. **No git tags** |
| MCP server | Cloned **at build time** from `marcelmarais/spotify-mcp-server` (pinned ref in `compose.yaml`); not vendored in this repo. ⚠️ It has **no licence** (checked 2026-10-07) |
| Install today | Undocumented as a routine. Known prerequisites: Docker (Rancher Desktop here), Node 22 on the host for `npm run auth` (OAuth runs where the browser is), a Spotify developer app, `npm run rules:init`, `secrets/musicbrainz.json` (the app **refuses to start** without it) |

---

## 3. Questions

### Q1 — ⚠️ NFR-30's branch protection needs GitHub Pro or a public repository

| | Option |
|---|---|
| **A** | **Make the repository public.** Free protection, rulesets and private vulnerability reporting. ⚠️ An **exposure decision**: `audit.md` and the design docs hold the owner's listening history in prose (track and artist names, dates), the NAS's LAN address and the owner's GitHub identity; a **full-history secret scan** must pass first, and history cannot be un-published. GPL-3.0 is compatible. The unlicensed MCP server is not in this repo, so publishing source does not publish it |
| **B** | ⭐ **GitHub Pro** (paid, per month). NFR-30 met as written; the repository stays private; contributors are invited. Publishing stays a separate, later decision |
| **C** | **Amend NFR-30**: required CI by convention plus a documented PR flow, no enforcement until A or B. ⚠️ An unenforced rule is what NFR-30 exists to replace — say so in `CONTRIBUTING.md` rather than imply protection |

[Answer]: **B** (user, 2026-10-12) — upgraded to GitHub Pro. ✅ Re-probed the same day: `…/branches/main/protection` now returns **404 "Branch not protected"** and `…/rulesets` returns `[]` — available, nothing configured. ⚠️ GitHub's public pricing page lists only Free / Team / Enterprise; Pro is under the personal account's *Settings → Billing → Plans*.

---
B - done

### Q2 — Who walks the install cold (FR-65's exit criterion, and NFR-34's `1.0.0` trigger)?

| | Option |
|---|---|
| **A** | **A fresh AI agent** with no access to this repository's history or `CLAUDE.md`, in a clean environment (Windows Sandbox or a VM), given only `docs/INSTALL.md` and its own Spotify app. Repeatable, and it tests the *agent* half of Q17 = C |
| **B** | **A second person** — the requirement's literal reading |
| **C** | ⭐ **Both, in order**: the agent walk is **U8's** exit criterion (`1.0.0-beta.1`); a person's walk is the **`1.0.0`** trigger, and U9's NAS install by the owner following the routine counts toward it only if no step needed knowledge outside the document |

[Answer]:
C
---

### Q3 — Which platforms does the install routine support?

| | Option |
|---|---|
| **A** | ⭐ **Two**: Windows + Rancher Desktop (the one proven here) **and** Docker Engine on Linux (what U9's Synology runs). macOS listed as *untested*, not unsupported |
| **B** | Windows + Rancher Desktop only; Linux arrives with U9 |
| **C** | Windows, Linux and macOS, each walked |

[Answer]:
A
---

### Q4 — The secret scan (NFR-28)

| | Option |
|---|---|
| **A** | ⭐ **`gitleaks` in CI on every push and PR**, a **one-time full-history scan now** (its result recorded), and the test NFR-28 names (any tracked file under `secrets/` that is not `*.example.json` fails). Runs on a private repository at no cost |
| **B** | GitHub's own secret scanning / push protection. ⚠️ Free only on a **public** repository (Q1 = A) |
| **C** | Only the tracked-file test. ⚠️ Blind to a token pasted into a doc or a script |

[Answer]:
A
---

### Q5 — The unlicensed MCP server (NFR-32)

| | Option |
|---|---|
| **A** | ⭐ **Keep cloning at build time; ask upstream for a licence** (an issue on `marcelmarais/spotify-mcp-server`); the docs state that **each user builds their own image** and none is published. Nothing changes in code |
| **B** | As A, and add a backlog item to **replace** the MCP server with direct Web API calls — the app already uses the Web API for everything except the poll. Not in U8 |
| **C** | Replace it inside U8. ⚠️ Changes the **recording instrument** (the live path parses MCP text) — that is a unit of its own, not onboarding |

⚠️ Opening an upstream issue is **outward-facing**; it is drafted for you to post, not posted by Claude.

[Answer]:
A
---

### Q6 — What happens to `CLAUDE.md` (the unit's *"rewrite the single-developer assumption"*)?

| | Option |
|---|---|
| **A** | ⭐ **Split it.** `CLAUDE.md` becomes a short orientation (what this is, the working rules, the non-obvious traps, commands — target ≤ 200 lines) for any contributor's agent. The dated *Current state* history moves out: it already lives in `audit.md` and each unit's `HANDOFF.md`, so it is **removed, not copied**. The *Non-obvious things that will bite you* list is kept and becomes the shared core of `CONTRIBUTING.md` |
| **B** | Edit only the single-developer statements (Git workflow: *commit directly to `main`*; *assume the container is running*); keep the length |
| **C** | Leave `CLAUDE.md` as the owner's; contributors get `CONTRIBUTING.md` only |

[Answer]:
A
---

### Q7 — Does a contributor follow AI-DLC?

| | Option |
|---|---|
| **A** | ⭐ **Two paths, stated in `CONTRIBUTING.md`**: a **fix** (behaviour already specified) is a PR with tests and `npm run verify` green; a **feature or a new requirement** re-enters AI-DLC (Inception questions → unit design), with the owner approving each gate |
| **B** | AI-DLC for everything |
| **C** | AI-DLC is the owner's process only; contributors send PRs |

[Answer]:
A
---

### Q8 — Applying NFR-34: the first numbered version

| | Option |
|---|---|
| **A** | ⭐ **`0.8.0` now** (U0–U7 delivered = eight units), tagged `v0.8.0` on U8's first release; **no retroactive tags** on old commits (they would claim releases that never happened). The rollback image for U8 becomes `spotify-now-playing:0.8.0`; the existing `uN-rollback` tags are kept until U9 and then removed |
| **B** | As A, plus retroactive tags `v0.1.0`…`v0.7.0` on each unit's completion commit |
| **C** | Start at `0.1.0` and count from here |

[Answer]:
A
---

### Q9 — User stories for U8

| | Option |
|---|---|
| **A** | ⭐ **Two**: **US-30** *new user* — installs on their own machine with their own Spotify app, verifying each step; **US-31** *contributor* — clones, runs `npm run verify`, opens a PR that CI gates. Ratified in Requirements (as U7's Q19 was) **before** this FD is approved |
| **B** | One (US-30 only) |
| **C** | None — a process unit |

[Answer]:
A
---

### Q10 — Where does `SECURITY.md` send a vulnerability report?

| | Option |
|---|---|
| **A** | **GitHub private vulnerability reporting.** ⚠️ Available only on a **public** repository (Q1 = A) |
| **B** | ⭐ **An email address you choose** — written into a public-facing file, so it should be one you are willing to publish |
| **C** | Issues only. ⚠️ Discloses the vulnerability in public before it is fixed |

[Answer]:
B - but since the plan is to make the repo public we should have a work item to shift to GitHub reporting once we do.

*Follow-up (2026-10-12)*: address **`<email address>`** (user). Backlog **W-14** logged: go public, then move reports to GitHub private vulnerability reporting.
---

## 4. What this unit will NOT do

- **No off-machine access**: NFR-29 (delegated auth) and the NAS are **U9**.
- **No change to recording, rules or skipping** — the only `src/` changes expected are NFR-34's version plumbing
  (the manifest, the User-Agent, the version shown in the UI and diagnostics).
- **No published image** (NFR-32), whatever Q5 decides.

## 5. Exit criteria (draft — settled by the answers)

1. CI runs typecheck, tests, `smoke` (labelled *load check*), `knip` and the secret scan; required on `main` per Q1.
2. `LICENSE` (GPL-3.0), short `README`, `docs/INSTALL.md`, `CONTRIBUTING.md`, `SECURITY.md` exist and are accurate.
3. The version is `0.8.0` (per Q8) from one source, visible in the UI and diagnostics, and tagged.
4. The install routine is walked cold per Q2, every step's verification output matching, with the walk recorded.
