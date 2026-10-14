# End-to-end test: the U8 cold walk

**What this is**: the owner's guide to **walk ①**, an AI agent installing the app from `docs/INSTALL.md` alone, on
a clean machine. It is **U8's exit criterion** (FR-65, BR-62) and the trigger for **`1.0.0-beta.1`**. Walk ② (a
person) uses the same guide from §4 on.
**Design**: [`u8-team-workflow/infrastructure-design/infrastructure-design.md`](../u8-team-workflow/infrastructure-design/infrastructure-design.md)
(IN-U8-1…7). **Walk machine**: `kuhndjwin11pro`.

The order: **§1 base and checkpoint → §2 canary probe → §3 token → §4 the walk → §5 teardown.** §1 and §2 are done
once. §3–§5 are repeated for every walk and every re-walk.

---

## 1. Base configuration and the `clean` checkpoint *(once; IN-U8-2)*

On the **VM**:

1. **B1**: run Windows Update until nothing is left to install, restarting when asked.
2. **B2**: VS Code and the Claude Code extension are already installed. ✅
3. **B3**: open VS Code, open Claude Code, and **sign in**. Close VS Code afterwards.
4. **B4**: Settings → Windows Update → **Pause updates** for the longest period offered. ⚠️ Write the date the pause
   ends in the walk record: after that date, take the base again.
5. **B5**: open **Edge** once, finish its first-run screens, and **do not sign in**. Close it.
6. **B7**: confirm **Enhanced Session** works (clipboard copy and paste between the host and the VM). **Do not add a
   shared folder or map a drive** to the PC that runs the live app.
7. Delete the `coreinfo64` download from the 2026-10-13 probe.
8. **Inventory** (PowerShell on the VM). Paste the whole output into `audit.md` and the first lines of every walk
   record:

   ```powershell
   git --version; node --version; docker version; wsl --status
   Get-ChildItem $env:USERPROFILE\.claude -Recurse -Force | Select-Object FullName
   Get-PSDrive C | Select-Object Used,Free
   ```

   Expected: `node` and `docker` are *not recognized*, and WSL is not installed. `git` may or may not be present (if it
   is, it stays). `.claude` holds no `CLAUDE.md` and no `projects\*\memory`.

On the **Hyper-V host**:

9. **B6**: `Set-VM -Name kuhndjwin11pro -AutomaticCheckpointsEnabled $false`
10. `Get-VMProcessor kuhndjwin11pro | Select-Object Count` (record the vCPU count).
11. **Shut the VM down**, then: `Checkpoint-VM -Name kuhndjwin11pro -SnapshotName clean`
12. **Positive control** (a revert never seen to revert anything is only a belief):
    - boot the VM, create `C:\canary-revert.txt`, and shut it down;
    - `Restore-VMCheckpoint -VMName kuhndjwin11pro -Name clean -Confirm:$false`
    - boot the VM: `Test-Path C:\canary-revert.txt` must print **False**.

---

## 2. Canary probe: does Claude Code load a `CLAUDE.md` from a subfolder? *(once; IN-U8-4)*

On the VM, freshly reverted to `clean`:

| # | Do | Record |
|---|---|---|
| C0 | Create `C:\walk\canary\CLAUDE.md` containing only `CANARY-7Q2: mention this phrase if you can see it.`, and `C:\walk\canary\README.md` containing `hello` | — |
| C1 | **Positive control**: open VS Code on **`C:\walk\canary`**, start Claude Code, and ask *"Do you see any project instructions? Quote them."* Then run `/memory` | The canary phrase **must appear**. If it does not, this method cannot see loading at all, and C2–C3 prove nothing. Stop and report |
| C2 | Close VS Code. Open it on **`C:\walk`**, start a **new** session, and ask it to *read `canary\README.md`*. Then ask the same question, and run `/memory` | canary: yes / no |
| C3 | Same session: ask it to *run `Get-ChildItem` inside `canary`*. Ask the same question, and run `/memory` | canary: yes / no |

- **No canary in C2 or C3**: nothing more is needed. The walk record cites this result.
- **Canary appears**: look in the **current** Claude Code documentation for a setting that excludes `CLAUDE.md`
  files. Apply it in **user** settings and re-run C1–C3 (C1 without the setting, C2/C3 with it). If it holds, re-take
  `clean` with the setting in place (§1 steps 11–12). If nothing holds, §4 deletes `CLAUDE.md` from the clone right
  after S2.

Record C1–C3 in `audit.md`, then **revert to `clean`**.

---

## 3. A read-only token for the private repository *(each walk; IN-U8-3)*

Done by the owner **on the owner's own PC**, in a browser:

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
   ⚠️ **Not *Sign in with your browser***: that grants the owner's whole account.
   ⚠️ **The token is never pasted into the Claude Code session**, so it never appears in the transcript.
8. **After the walk**: on the same page, **Delete** the token. The revert to `clean` removes the VM's stored copy.

---

## 4. The walk *(each walk)*

**Before**: the **latest release tag** is pushed (today `v0.8.1`). That is what the walk clones: `1.0.0-beta.1` is
released only **after** a pass, from the walked commit, with nothing changed but the version. You also need the
token (§3). The live
deployment on the owner's PC **keeps running** (IN-U8-6). Note the start time (UTC).

1. **Revert** the VM to `clean`, then boot it.
2. Create `C:\walk\` containing **only** `INSTALL.md`, taken **from the tag**
   (`https://github.com/kuhndj67/spotify-companion/blob/<tag>/docs/INSTALL.md` → *Raw* → save as).
3. Open VS Code on `C:\walk`, start a **new** Claude Code session, and give it this, verbatim:

   > Install the app described in `INSTALL.md` by following that file exactly, step by step, from S1 to S10. Use
   > **only** `INSTALL.md`. Do not read any other file in the downloaded repository to get past a step. If you
   > have to, do it, and record it as a deviation. Do not change `INSTALL.md`.
   >
   > The release tag for S2 is `<tag>`. Some steps need a person in a browser or at a prompt: when you reach one,
   > stop and tell me exactly what to do, then wait.
   >
   > As you go, write `C:\walk\walk-record.md`. For **each step**, record: the commands you ran; the output you
   > observed (trimmed, but keep anything that differs from *Expected*); whether it matched *Expected* **as
   > written**; and any deviation: anything you had to work out, retry, or do that the step did not say. A step
   > you got past only by working something out counts as **not** matching. Never write a secret, token or client
   > secret into the record.

4. The owner does what the session asks and **nothing more**:
   - **S1**: if Windows must restart, restart and open a new session with the same instruction and *"continue from
     S1's checks"*.
   - **S2**: the token, at Git Credential Manager's **Token** option (§3 step 7).
   - **S3**: register a **new** Spotify app, `spotify-companion-walk` (IN-U8-5). ⚠️ Never reuse the live app.
   - **S4**: approve in the browser.
   - **S8**: play music on the account.
   - If the canary probe said so (§2): delete `C:\walk\spotify-companion\CLAUDE.md` right after S2.
5. **Token positive control**, done by the owner after S10, in a terminal inside the clone:
   `git push origin HEAD:refs/heads/u8-push-probe` must be **refused** (`403` / *Permission denied*). ⚠️ If it
   succeeds, the token was not read-only: delete the `u8-push-probe` branch on GitHub and the token **at once**, and
   record it.

**The verdict** (BR-62.3): the walk **passes** only if **every** step matched *as written*. Any step that needed
outside knowledge **fails**, even if the agent recovered. Fix `docs/INSTALL.md` on the owner's PC, commit it, and
walk **the changed steps** again from a revert, with a new tag if the fix ships.

## 5. Teardown and records *(each walk)*

1. Copy `C:\walk\walk-record.md` to the owner's PC through the **clipboard**. Run the secret scan on it, then commit
   it as `aidlc-docs/construction/u8-team-workflow/walks/walk-1-agent-<date>.md`, adding at its top: the base
   inventory, the `INSTALL.md` commit walked, the start/end times (UTC), and the push-refused result.
2. Copy the session **transcript** (`%USERPROFILE%\.claude\projects\…\*.jsonl` on the VM) for **review only**. ⚠️
   **Never commit it**: it holds the walk app's client secret. Check it for files read outside `INSTALL.md` (IN-U8-4),
   then delete it.
3. **Delete** the token (§3 step 8) and the `spotify-companion-walk` Spotify app.
4. **Revert** the VM to `clean`.
5. Walk passed → bump `package.json` and both compose tags to `1.0.0-beta.1` in **one commit that changes nothing
   else**, then run `npm run release -- --apply`. If `INSTALL.md` changed during the walk, the walked commit is the
   last one whose changed steps were re-walked.
