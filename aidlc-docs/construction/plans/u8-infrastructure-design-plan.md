# Infrastructure Design Plan — U8: Team Workflow & Onboarding

**Date**: 2026-10-13 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U8
**Status**: ✅ **All 7 answered 2026-10-14 (all A; Q2 and Q3 with additions)** → `u8-team-workflow/infrastructure-design/` written · ✅ **APPROVED 2026-10-14**.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U8 FD (approved 2026-10-12, amended for the MacBook the same day) · U8 NFR Design (**approved
2026-10-13**: P-58…P-64, LC-49…LC-57, PBT-68…PBT-72) · `audit.md` 2026-10-13 (walk machine probes)

> U8's infrastructure is not the app's — the app's deployment is unchanged. It is the **walk machine**, the **CI
> runners**, and the **GitHub settings** that make the gates real. The walk machine is the one with risk: it must be
> clean enough that a pass means something, and contained enough that it touches nothing it should not.

---

## 1. Facts measured — 2026-10-13

| | |
|---|---|
| ⚠️ **The MacBook is out** | Too old for VS Code or the Claude desktop app (user) — it cannot host a cold Claude Code session. The FD's 2026-10-12 MacBook amendment must be **replaced** (Q1) |
| **Walk machine `kuhndjwin11pro`** | Hyper-V **Windows 11 Pro** VM on another physical machine. VS Code and Claude Code installed; **no** Docker, WSL2 or Rancher Desktop |
| Nested virtualization | Host: `ExposeVirtualizationExtensions : True` ✅. Guest: Sysinternals `coreinfo64 -v` shows the extensions present ✅. (`systeminfo`'s *"A hypervisor has been detected"* is **not** evidence — every Hyper-V guest says it) |
| VM memory | **Fixed 16 GB**, dynamic memory **off** ✅ (was dynamic) |
| Repository | **Private** (GitHub Pro). A walker on another machine needs a read credential |
| CI | GitHub-hosted `ubuntu-latest`; the container job already builds the image. No scheduled workflow exists yet |
| Live deployment | This PC, Rancher Desktop, `localhost:3010` — **unchanged by U8**. ⚠️ Down twice from WSL updates in Modern Standby (2026-09-30, 2026-10-13) — U9's concern, noted here because the walk runs while it records |

## 2. What this stage must produce

- `construction/u8-team-workflow/infrastructure-design/infrastructure-design.md`
- `construction/u8-team-workflow/infrastructure-design/deployment-architecture.md`

**Categories not applicable, with reason**: *Storage, Messaging, Networking* — U8 adds no database, queue or network
path; the walk VM's app binds `127.0.0.1` like every install. *Compute scaling* — none. Each is stated rather than
silently skipped.

---

## 3. Questions

### Question 1 — ⭐ Deployment environment — The cold-walk machine (replaces the MacBook amendment)

A) **`kuhndjwin11pro` runs walk ① (the agent, U8's exit, `1.0.0-beta.1`) on Windows.** BR-62.2 and BR-61.3 are
amended again: macOS returns to **untested**; supported = Windows + Rancher Desktop and Docker Engine on Linux (Q3 = A's
original reading). Linux is walked in **U9**. Walk ② (a person, `1.0.0`) is on whatever platform that person has —
recorded, not prescribed ⭐ *recommended*

B) As A, and also walk Linux in U8 inside a throwaway WSL distro on the same VM

X) Other

[Answer]:
A
---

### Question 2 — ⭐ Shared infrastructure — Keeping it cold and repeatable: a checkpoint

A) **Take a Hyper-V checkpoint named `clean` now**, before anything else is installed. Every walk starts by reverting
to it — so a re-walk after an INSTALL fix (BR-62.3) is genuinely cold again, not a machine that already has WSL and
Rancher from the last attempt. After U8, the checkpoint is kept for walk ② and U10's contributor walk ⭐ *recommended*

B) No checkpoint; re-walks continue on the dirtied machine. ⚠️ A second walk would pass steps it never really ran

[Answer]:
A - always want to start with just a base install (right now that includes vscode with the claude extension but that's IT, if there are other items that should be included in the BASE configuration lets identify them and get them added prior to the checkpoint).
---

### Question 3 — Security — How the walker reads the private repository

A) **A fine-grained personal access token**: this repository only, **Contents: read**, expiry **7 days**, created by
the owner for the walk and **revoked after it**. The walker uses it only for the clone in step S2. The routine itself
says *"if the repository is private, you need read access"* — which is what a real second user would need ⭐
*recommended*

B) `gh auth login` as the owner on the VM. ⚠️ Grants the walk session the owner's whole GitHub account

C) A read-only SSH deploy key. Equivalent scope to A, but adds SSH key setup the routine would then have to document

[Answer]:
A - include GitHub guide for creating a limited expiring token in the test guide.
---

### Question 4 — ⚠️ Security — Keeping `CLAUDE.md` out of the cold session (BR-62.6)

Claude Code loads `CLAUDE.md` from the working directory and its parents at start, and may load one from a
**subfolder** when it reads files there. The walker clones into a subfolder at S2, so the project's tacit knowledge
could arrive mid-walk.

A) **Probe first, on the VM, with a canary**: a throwaway public repo whose `CLAUDE.md` says only *"CANARY-7Q2:
mention this phrase if you can see it"*; a fresh session in an empty folder clones it into a subfolder, reads a file
there, and is asked whether it sees any project instructions. If the canary appears, find and **probe** a setting that
excludes it (Claude Code settings, not assumed from memory); if none works, the walk is run with the project's
`CLAUDE.md` deleted from the walker's clone right after S2, and the walk record says so ⭐ *recommended*

B) Skip the probe; delete `CLAUDE.md` from the clone after S2 regardless. ⚠️ Simple, but a step a real user would never
take — the walk then differs from the routine

[Answer]:
A
---

### Question 5 — Deployment environment — Spotify for the walk

A) **The owner registers a new Spotify app for the walk** in step S3 (e.g. `spotify-companion-walk`), exactly as the
routine tells a new user to — so S3 is walked for real, and the walk's polling uses **its own app's** rate limit, not
the live deployment's. Deleted after the walk ⭐ *recommended*

B) Reuse the existing app's credentials. ⚠️ S3 is then not walked, and two installs share one client id (U9-b's open
question)

[Answer]:
A
---

### Question 6 — Monitoring — Coexisting with the live deployment while the walk runs

A) **Live keeps running.** The walk install records the owner's listening into **its own throwaway database** for the
hours it runs; automation stays **off** there (BR-61.9); nothing from the walk machine ever enters this PC's
`data/`. The walk record notes the overlap. Torn down by reverting to `clean` ⭐ *recommended*

B) Stop the live deployment during the walk. ⚠️ Loses recording for no benefit — the two do not share anything

[Answer]:
A
---

### Question 7 — Monitoring — Getting the walk record back

A) **The walk session writes `walk-record.md`** (BR-62.5: each step's observed output against expected, every
deviation) on the VM; the owner copies it to this machine, and it is committed under
`construction/u8-team-workflow/walks/`. The walker's token is read-only, so it **cannot** push — by design ⭐
*recommended*

B) Give the walker write access so it opens a PR with the record. ⚠️ A write credential on the test machine, for a
file

[Answer]:
A
---

## 4. Already decided (recorded here, not re-asked)

- **CI** (NFR Design): gitleaks binary pinned by version + SHA-256 on push/PR; a **weekly scheduled** full-history scan
  — a new workflow file. `smoke` and `knip` as steps in the existing job.
- **Branch protection** (P-62): a committed ruleset applied by `npm run protect`; positive control = a throwaway PR
  that breaks one check and is refused, then closed.
- **Versions** (BR-66): image `spotify-now-playing:0.8.0`; `uN-rollback` tags kept until U9.
