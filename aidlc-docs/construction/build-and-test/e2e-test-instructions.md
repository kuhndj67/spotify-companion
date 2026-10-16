# End-to-end test: the U8 cold walk

**What this is**: the owner's guide to **walk ①**, an AI agent installing the app from `docs/INSTALL.md` alone, on
a clean machine. It is **U8's exit criterion** (FR-65, BR-62) and the trigger for **`1.0.0-beta.1`**. Walk ② (a
person) uses the same guide from §4 on.
**Design**: [`u8-team-workflow/infrastructure-design/infrastructure-design.md`](../u8-team-workflow/infrastructure-design/infrastructure-design.md)
(IN-U8-1…7). **Walk machine**: `kuhndjwin11pro`.

The order: **§1 base and checkpoint → §2 canary probe → §3 token → §4 the walk → §5 teardown.** §1 and §2 are done
once. §3–§5 are repeated for every walk and every re-walk.

⚠️ **Nothing passes through the Hyper-V host OS** (amended 2026-10-16). The host sits on a corporate VPN, isolated
from the VM, which has its own NIC on the owner's local network. The host is used **only to manage the VM**
(checkpoint, revert, settings). There is no clipboard and no Enhanced Session between them:

- **Results** (inventory, canary results, walk record, transcript) are written to **`C:\walk-out\`** on the VM.
  Before every revert, **this dev PC pulls them** over the local network with **Procedure T** (§6).
- **The GitHub token** is created **in the VM's Edge** (§3), and never travels between machines.

---

## 1. Base configuration and the `clean` checkpoint *(once; IN-U8-2)*

On the **VM**:

✅ 1. **B1**: run Windows Update until nothing is left to install, restarting when asked.
✅ 2. **B2**: VS Code and the Claude Code extension are already installed. 
✅ 3. **B3**: open VS Code, open Claude Code, and **sign in**. Close VS Code afterwards.
✅ 4. **B4**: Settings → Windows Update → **Pause updates** for the longest period offered. ⚠️ Write the date the pause ends in the walk record: after that date, take the base again.
✅ 5. **B5**: open **Edge** once, finish its first-run screens, and **do not sign in**. Close it.
X 6. ~~**B7**: confirm Enhanced Session works~~. **Replaced 2026-10-16**: the host is isolated (corporate VPN), so
   nothing relies on it. Results leave the VM by **Procedure T** (§6): **this dev PC pulls** from a temporary
   read-only share **on the VM**, created just before a revert and deleted by it. ⚠️ **Never the other direction**:
   no share or mapped drive on the VM points at this dev PC, which runs the live app and holds `data/`.
7. Delete the `coreinfo64` download from the 2026-10-13 probe.
8. **Inventory** (PowerShell on the VM). It is saved to `C:\walk-out\base-inventory.txt`, which becomes **part of
   `clean`**. It holds no credentials and nothing about the project, so it is harmless there, and every later walk
   finds it in place. It reaches this dev PC with the first Procedure T (end of §2), and goes into `audit.md` and
   the top of every walk record:

   Run the lines **inside** the box, not the ```` ``` ```` fence lines around it:

   ```powershell
   New-Item -ItemType Directory -Force C:\walk-out | Out-Null
   & {
     "Recorded: $((Get-Date).ToUniversalTime().ToString('u'))"
     $pause = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -ErrorAction SilentlyContinue).PauseUpdatesExpiryTime
     "Windows Update paused until: $(if ($pause) { $pause } else { 'NOT FOUND in the registry -- write the B4 date here by hand' })"
     git --version; node --version; docker version; wsl --status
     ".claude top level: $((Get-ChildItem $env:USERPROFILE\.claude -Force | Select-Object -ExpandProperty Name) -join ', ')"
     "CLAUDE.md in .claude: $(Test-Path $env:USERPROFILE\.claude\CLAUDE.md)"
     "memory folders under .claude\projects: $(@(Get-ChildItem $env:USERPROFILE\.claude\projects -Recurse -Directory -Filter memory -ErrorAction SilentlyContinue).Count)"
     "settings.json in .claude: $(Test-Path $env:USERPROFILE\.claude\settings.json)"
     Get-PSDrive C | Select-Object Used,Free | Format-List | Out-String
   } *>&1 | Out-File -Encoding utf8 C:\walk-out\base-inventory.txt
   Get-Content C:\walk-out\base-inventory.txt
   ```

   (The `*>&1` keeps the *not recognized* errors in the file, and those errors are the result. WSL's message prints
   with spaces between the letters, which is just its UTF-16 output.)

   Expected: `git`, `node` and `docker` are *not recognized* (**measured 2026-10-16: git is NOT in the base**, so
   Claude Code does not need it and S1's git install is walked for real), and WSL is not installed. `CLAUDE.md` is
   `False`, there are `0` memory folders, and `settings.json` is `False`. The *paused until* line shows a date. If it
   says NOT FOUND, edit the file and write the B4 date in by hand.

On the **Hyper-V host**:

9. **B6**: `Set-VM -Name kuhndjwin11pro -AutomaticCheckpointsEnabled $false`
10. `Get-VMProcessor kuhndjwin11pro | Select-Object Count`. Note the vCPU count down by hand, and add it to
    `base-inventory.txt` on the VM before step 11.
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

Write C1–C3's results (yes/no, plus what the session said and what `/memory` listed) into
`C:\walk-out\canary.txt` on the VM. Then run **Procedure T** (§6), and only **after** the files are on this dev PC,
**revert to `clean`**.

---

## 3. A read-only token for the private repository *(each walk; IN-U8-3)*

Done by the owner **in the VM's Edge**, at the start of §4 (after the revert, **before** the walk session starts).
The host is isolated, and a token created anywhere else would have to be retyped. *(Amended 2026-10-16.)*

0. Sign in to **github.com** in Edge on the VM. That is a website sign-in, not an Edge profile sign-in, so leave
   Edge's own *Sign in* alone (B5).
1. GitHub → profile picture → **Settings** → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. **Token name** `u8-cold-walk-<date>` · **Expiration**: custom, **7 days** · **Resource owner**: `kuhndj67`.
3. **Repository access** → **Only select repositories** → `spotify-companion`.
4. **Permissions** → **Repository permissions** → **Contents: Read-only**. GitHub adds **Metadata: Read-only** by
   itself. Leave **everything else** at *No access*.
5. **Generate token**, then copy it into a new, **unsaved** Notepad window on the VM. GitHub shows it **once**.
6. **Check it before using it**: the token's page should list exactly one repository and the permissions
   *Contents: read* and *Metadata: read*. If anything else is listed, delete the token and start again.
7. **Sign out of GitHub in Edge** (profile picture → *Sign out*) **before** starting the walk session. The agent
   must not inherit a signed-in browser, and a signed-in session would make *Sign in with your browser* at S2 grant
   the owner's whole account.
8. At S2, when **Git Credential Manager** asks how to sign in, the **owner** chooses **Token** and pastes the token
   from the Notepad window. Then **close Notepad without saving**, and clear the clipboard
   (`Set-Clipboard -Value ' '` in PowerShell). The agent could otherwise read it with `Get-Clipboard`.
   ⚠️ **Not *Sign in with your browser***.
   ⚠️ **The token is never pasted into the Claude Code session**, so it never appears in the transcript.
9. **After the walk**: delete the token from **any** browser signed in to GitHub (this dev PC is fine):
   Settings → Developer settings → Fine-grained tokens → the token → **Delete**. The revert to `clean` removes the
   VM's stored copy.

---

## 4. The walk *(each walk)*

**Before**: the **latest release tag** is pushed (today `v0.8.1`). That is what the walk clones: `1.0.0-beta.1` is
released only **after** a pass, from the walked commit, with nothing changed but the version. You also need the
token (§3). The live
deployment on the owner's PC **keeps running** (IN-U8-6). Note the start time (UTC).

1. **Revert** the VM to `clean`, then boot it.
2. In Edge on the VM, **signed in to GitHub** (§3 step 0; the repository is private, so the download needs it):
   create `C:\walk\` containing **only** `INSTALL.md`, taken **from the tag**
   (`https://github.com/kuhndj67/spotify-companion/blob/<tag>/docs/INSTALL.md` → *Raw* → save as).
   Then create the token (§3 steps 1–6) and **sign out of GitHub** (§3 step 7).
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
   - **S2**: the token, at Git Credential Manager's **Token** option (§3 step 8).
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

1. On the VM, copy `C:\walk\walk-record.md` and the session **transcript**
   (`%USERPROFILE%\.claude\projects\…\*.jsonl`) into `C:\walk-out\`. Then run **Procedure T** (§6), which brings
   both to `D:\walk-results\<date>\` on this dev PC, **outside the repository**.
2. Run the secret scan on `walk-record.md`, then commit it as `aidlc-docs/construction/u8-team-workflow/walks/walk-1-agent-<date>.md`, adding at its top: the base
   inventory, the `INSTALL.md` commit walked, the start/end times (UTC), and the push-refused result.
3. The **transcript** is for **review only**. ⚠️ **Never copy it into the repository**: it holds the walk app's client
   secret. Check it for files read outside `INSTALL.md` (IN-U8-4), then delete `D:\walk-results\<date>\*.jsonl`.
4. **Delete** the token (§3 step 9) and the `spotify-companion-walk` Spotify app.
5. **Revert** the VM to `clean`, and only once step 1's files are confirmed on this dev PC.
6. Walk passed → bump `package.json` and both compose tags to `1.0.0-beta.1` in **one commit that changes nothing
   else**, then run `npm run release -- --apply`. If `INSTALL.md` changed during the walk, the walked commit is the
   last one whose changed steps were re-walked.

---

## 6. Procedure T — moving results from the VM to this dev PC *(before every revert)*

**Direction: this dev PC reads from the VM. Never the reverse.** The share lives **on the VM**, is read-only, and
is deleted by the revert that follows. Nothing on this dev PC is shared. Files land in `D:\walk-results\`, outside
the repository, so a transcript cannot be committed by accident.

**On the VM** (PowerShell **as Administrator**):

```powershell
New-SmbShare -Name walk-out -Path C:\walk-out -ReadAccess "$env:USERDOMAIN\$env:USERNAME"
Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object InterfaceAlias, IPAddress
```

**On this dev PC** (PowerShell; `<vm-ip>` from above, `<date>` e.g. `2026-10-16`):

```powershell
New-Item -ItemType Directory -Force D:\walk-results\<date> | Out-Null
net use \\<vm-ip>\walk-out /user:<vm-user>        # prompts for the VM account's password
Copy-Item \\<vm-ip>\walk-out\* D:\walk-results\<date>\ -Recurse
net use \\<vm-ip>\walk-out /delete
Get-ChildItem D:\walk-results\<date>
```

**Expected**: the listing on this dev PC shows the same files as `C:\walk-out\` on the VM. **Only then** revert.

**If it differs**

- `net use` fails with *network path was not found*: from this dev PC, run `Test-NetConnection <vm-ip> -Port 445`.
  `TcpTestSucceeded : False` means the firewall rule did not apply, or the two machines are not on the same
  network. **Do not revert**: the files are still safe on the VM. Report it, and we choose another route.
- *Access denied* or a rejected password: for a **Microsoft account** on the VM, `<vm-user>` is
  `MicrosoftAccount\<email>` and the password is the **account password**, not the PIN. For a local account it is
  `<vm-ip>\<username>`.
