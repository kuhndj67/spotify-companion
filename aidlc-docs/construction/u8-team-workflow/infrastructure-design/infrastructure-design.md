# Infrastructure Design — U8: Team Workflow & Onboarding

**Date**: 2026-10-14 · **Stage**: CONSTRUCTION — Infrastructure Design, U8 · **Status**: ✅ approved 2026-10-14
**Answers**: Q1–Q7 all **A** — [`../../plans/u8-infrastructure-design-plan.md`](../../plans/u8-infrastructure-design-plan.md).
Q2 and Q3 came with additions (base configuration; a token guide) — IN-U8-2 and IN-U8-3.
Picture: [`deployment-architecture.md`](deployment-architecture.md).

> U8 does not change the app's deployment. Its infrastructure is the **walk machine**, the **CI runners** and the
> **GitHub settings** that make the gates real. The walk machine carries the risk: it has to be clean enough that a
> pass means something, and contained enough that it touches nothing it should not.

**Not applicable, with reason**: *Storage, Messaging, Networking*: U8 adds no database, queue or network path,
and the walk install binds `127.0.0.1` like every other install. *Compute scaling*: none.

---

## IN-U8-1 · The walk machine is `kuhndjwin11pro` *(Q1 = A, which amends the FD)*

| | |
|---|---|
| Machine | Hyper-V **Windows 11 Pro** guest on a second physical machine (not this PC) |
| Probed 2026-10-13 | nested virtualization ✅ (host `ExposeVirtualizationExtensions : True`; guest `coreinfo64 -v` shows the extensions) · memory **fixed 16 GB**, dynamic **off** ✅ |
| Walk ① | the **agent** walk on this VM, on Windows. It is U8's exit criterion and releases **`1.0.0-beta.1`** |
| Walk ② | a **person**, on whatever platform that person has. The platform is **recorded, not prescribed**. This walk triggers **`1.0.0`** |
| Linux | walked in **U9** (the NAS) |

**FD amendments this requires** (made 2026-10-14 and marked in each place):

- **BR-61.3**: supported = **Windows + Rancher Desktop** and **Docker Engine on Linux**. **macOS returns to
  *untested*.**
- **BR-61.10**: **withdrawn.** It existed only to probe the Mac before the walk. Its principle still applies to
  Linux in U9: *a platform is not supported on the strength of another platform's probe.*
- **BR-62.2**: walk ① runs on `kuhndjwin11pro`; walk ②'s platform is recorded, not prescribed.
- **BR-62.6**: *"on the Mac"* → *"on the walk VM"*.
- `business-logic-model.md` S1 and §2, `domain-entities.md` §4: MacBook → `kuhndjwin11pro`.

## IN-U8-2 · Base configuration and the `clean` checkpoint *(Q2 = A, plus the user's addition)*

The user's rule: **every walk starts from a base install only.** The base is **what a new user's machine would have
before they open `INSTALL.md`**. Nothing that `INSTALL.md` tells a user to install goes in it, because those are
the steps the walk tests.

### 2a. In the base

| # | Item | Why |
|---|---|---|
| B1 | Windows 11 Pro, **fully updated** | the starting point |
| B2 | VS Code + the Claude Code extension | ✅ already present. The walker runs here |
| B3 | ➕ **Claude Code signed in** | so the walk does not start with a login. Signing in is not an `INSTALL.md` step |
| B4 | ➕ **Windows Update paused** (the longest pause offered), taken **after** B1 | ⚠️ **the outage shape**: WSL updates installed during standby took Rancher down here twice (2026-09-30, 2026-10-13). An update in the middle of a walk would look like an `INSTALL.md` failure. ⚠️ The pause ends on a **calendar date**, and reverting the checkpoint does not reset that date. Once it lapses, take the base again |
| B5 | ➕ **Edge first-run finished, no account signed in** | the owner does the browser steps (Spotify dashboard, OAuth consent). A first-run wizard in the middle of S3 is noise. No sign-in, so no synced passwords or extensions |
| B6 | ➕ **Hyper-V automatic checkpoints OFF** (host: `Set-VM -Name kuhndjwin11pro -AutomaticCheckpointsEnabled $false`) | client Hyper-V takes one at every VM start by default. They pile up beside `clean`, and a revert can then land on the wrong one |
| B7 | Enhanced Session (clipboard) **on** | how the token goes into Git's prompt and how the walk record comes back (IN-U8-7). ⚠️ **No shared folder or mapped drive to this PC**: that would give the walk machine a path to `data/` |

### 2b. Not in the base, on purpose

**Node, Rancher Desktop, WSL, Docker, the `gh` CLI, any GitHub or Spotify sign-in, the repository, and a Spotify
client.** S1–S8 install or create each of these, except the Spotify client. Plays come from whatever device the
owner listens on, because the app reads the account and not the machine.

**git** goes in the base only **if it is already there**. Claude Code on Windows has needed Git for Windows in the
past, so it may be. That has to be **measured** (2c), not assumed. If git is present, it stays, because any user who
has Claude Code has it, and the walk record says S1's git line was already satisfied.

### 2c. Before the checkpoint: measure and record (on the VM, in PowerShell)

```powershell
git --version; node --version; docker version; wsl --status    # expected: git ?, node/docker absent, WSL not installed
Get-ChildItem $env:USERPROFILE\.claude -Recurse -Force | Select-Object FullName   # no CLAUDE.md, no projects\*\memory
Get-PSDrive C | Select-Object Used,Free
```

On the host: `Get-VMProcessor kuhndjwin11pro | Select-Object Count` (the vCPU count; not measured yet).

Also delete the `coreinfo64` download left by the 2026-10-13 probe. These results are the **base inventory**. They
go into `audit.md` and the first lines of every walk record.

### 2d. Taking `clean`, and its positive control

1. Shut the VM **down**. Then, on the host: `Checkpoint-VM -Name kuhndjwin11pro -SnapshotName clean`.
   ⚠️ Take it while the VM is **off**. Hyper-V restricts saving the state of a VM that exposes virtualization
   extensions, and a powered-off checkpoint avoids that question. *(Restriction recalled from Microsoft's
   documentation, not probed. Taking it with the VM off makes the probe unnecessary.)*
2. **Positive control**: boot, create `C:\canary-revert.txt`, shut down, `Restore-VMCheckpoint -VMName kuhndjwin11pro -Name clean -Confirm:$false`,
   boot, and confirm the file is **gone**. *A revert never seen to revert anything is only a belief about a
   checkpoint.*
3. Every walk, and every re-walk after an `INSTALL.md` fix (BR-62.3), **starts with that revert**. After U8 the
   checkpoint stays for walk ② and U10's contributor walk.

⚠️ A revert also takes Claude Code's stored sign-in back to checkpoint time. If the token has been rotated since
then, the session asks to sign in again. That is an expected cost, not a walk deviation.

## IN-U8-3 · Repository access: a fine-grained, read-only, 7-day token *(Q3 = A, plus a guide)*

The owner creates the token on **this PC** before the walk. The guide below goes **verbatim into U8's walk guide**
(the Build & Test instructions, which are the "test guide"):

1. GitHub → profile picture → **Settings** → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. **Token name** `u8-cold-walk-<date>` · **Expiration**: custom, **7 days** · **Resource owner**: `kuhndj67`.
3. **Repository access** → **Only select repositories** → `spotify-companion`.
4. **Permissions** → **Repository permissions** → **Contents: Read-only**. GitHub adds **Metadata: Read-only** by
   itself. Leave **everything else** at *No access*.
5. **Generate token**, then copy it. GitHub shows it **once**.
6. **Check it before using it**: the token's page should list exactly one repository and the permissions
   *Contents: read* and *Metadata: read*. If anything else is listed, delete the token and start again.
7. At S2, when **Git Credential Manager** asks how to sign in, the **owner** chooses **Token** and pastes the token.
   ⚠️ **Not *Sign in with your browser***: that is option B, the owner's whole account.
   ⚠️ **The token is never pasted into the Claude Code session**, so it never appears in the transcript.
8. **After the walk**: on the same page, **Delete** the token. The revert to `clean` removes the VM's stored copy.

A **wrong scope** shows up at step 6. A **token that works** shows up at S2. ⚠️ Neither proves the token is
**read-only**. Expect the walker to be unable to push (IN-U8-7), and check that: a `git push` from the clone should
be **refused** (`403`). That refusal is the token's positive control, and the walk record notes it.

## IN-U8-4 · Keeping `CLAUDE.md` out of the cold session *(Q4 = A)*: the canary probe

**Run on `clean`, before the walk. Revert afterwards.**

⚠️ **One change from the plan's wording, made on purpose**: the canary is a **local folder**, not a public GitHub
repository. The thing being tested is *does Claude Code load a `CLAUDE.md` from a subfolder it works in*, and a
clone puts a folder on disk like any other. Making a public repository would be an outward-facing step that the
probe does not need.

| # | Step | Expected |
|---|---|---|
| C0 | `C:\walk\canary\CLAUDE.md` contains only: *"CANARY-7Q2: mention this phrase if you can see it."* Plus a `C:\walk\canary\README.md` with one line | — |
| C1 | **Positive control**: open a fresh session **in `C:\walk\canary`** and ask *"Do you see any project instructions?"* Then run `/memory` | the canary phrase **appears**, and `/memory` lists the file. *If it does not, this method cannot detect loading at all, and C2–C3 prove nothing* |
| C2 | Fresh session **in `C:\walk`**. Ask it to read `canary\README.md`, then ask the same question. Run `/memory` | records whether the canary appears |
| C3 | Same session: ask it to **run a command inside** `canary\` (e.g. `Get-ChildItem`), as the walk will (`npm run auth`, `docker compose` from inside the clone). Ask again. Run `/memory` | records whether the canary appears |

- **Canary absent in C2 and C3**: nothing is needed. The walk record cites this probe.
- **Canary present**: look in the **current** Claude Code documentation for a setting that excludes it, apply it
  in **user** settings, and **re-run C1–C3**. C1 must still show the canary with the setting removed, and C2/C3
  must not show it with the setting on. If the setting holds, it goes into the base (re-take `clean`), and the walk
  record names it as part of the **walk harness, not the routine**.
- **No setting works**: the walker's clone has `CLAUDE.md` **deleted right after S2**, and the walk record says
  so.

⚠️ **This probe covers loading, not reading.** The clone also contains `aidlc-docs/` and `audit.md`, and an agent
stuck on a step will search the repository. Under BR-62.3 that is outside knowledge, so the walker's instructions
say: *use only `INSTALL.md`, and record every other repository file you read to get past a step as a deviation.*
The **session transcript** (IN-U8-7) is where this gets checked, not the walker's own account.

## IN-U8-5 · Spotify: a new app for the walk *(Q5 = A)*

The owner registers **`spotify-companion-walk`** on the Spotify developer dashboard **during S3**, exactly as the
routine tells a new user to. So S3 is really walked, and the walk's polling counts against that app's rate limit,
not the live one's. The redirect URI is whatever `INSTALL.md` says. **Delete the app after the walk.**

⚠️ Development Mode has been restricted twice since 2024. **If registration itself is refused or limited, that is
an S3 finding**, which is exactly what walking S3 for real is for. Do not work around it with the live app's
credentials.

## IN-U8-6 · Running alongside the live deployment *(Q6 = A)*

- The live deployment on **this PC** keeps running and recording. The walk install on the VM records the same
  account's plays into **its own throwaway database** for the hours it runs. **Two apps, one account, nothing
  shared.**
- Automation stays **off** on the walk install (BR-61.9). The walk never arms anything.
- **Nothing from the VM ever enters this PC's `data/`.** There is no shared folder (B7), and the walk's database is
  never restored here.
- The walk record notes the overlap window (start and end, UTC). Teardown is the revert to `clean`.

## IN-U8-7 · Monitoring: what comes back from the walk *(Q7 = A)*

| Artefact | Comes back? | Where |
|---|---|---|
| `walk-record.md`, written by the walk session (BR-62.5: base inventory, `INSTALL.md` commit, each step's observed vs expected output, every deviation, the push-refused check) | ✅ copied by the owner (Enhanced Session clipboard) | committed under `construction/u8-team-workflow/walks/walk-1-agent-<date>.md`. ⚠️ **gitleaks runs on it before the commit**. It is the one file in U8 that travels from a machine holding credentials |
| The Claude Code **session transcript** (`%USERPROFILE%\.claude\projects\…\*.jsonl` on the VM) | ✅ copied for **review only** | ⚠️ **Never committed**: it contains the throwaway app's client secret from S3. Used to check IN-U8-4's *files read outside `INSTALL.md`*, then deleted after review |
| The walk install's database, config and secrets | ❌ | destroyed by the revert |

The walker's token is read-only, so **it cannot push**. That is deliberate, and IN-U8-3 checks it.

## Already decided (NFR Design), mapped to infrastructure

| Component | Runs on | Credential |
|---|---|---|
| LC-54 secret scan: gitleaks on push/PR; **weekly** full-history scan (new workflow, `schedule:` cron, UTC) | GitHub-hosted `ubuntu-latest` | none beyond the default `GITHUB_TOKEN`, **read-only** (`permissions: contents: read`) |
| LC-55 `smoke` (labelled *load check*) and `knip` | the existing CI job | — |
| LC-52/53 ruleset applied by `npm run protect` | **this PC**, the owner's `gh` | the **only write-capable credential in U8**, and it **never** reaches the VM |
| Image `spotify-now-playing:0.8.0` (BR-66) · `u4/u5/u6-rollback` tags kept until U9 | this PC, Rancher Desktop | — |

## Order of work on the VM

1. Base: B1–B7 · 2c inventory · `clean` + revert control (IN-U8-2)
2. Canary probe C0–C3, then revert (IN-U8-4)
3. *(Code Generation produces `docs/INSTALL.md` and `v1.0.0-beta.1`'s candidate commit)*
4. Walk ①: revert → `C:\walk\` holding only `INSTALL.md` from the tag → fresh session → token at S2 (owner) →
   new Spotify app at S3 (owner) → … → `walk-record.md` → copy back → token deleted, Spotify app deleted, revert
