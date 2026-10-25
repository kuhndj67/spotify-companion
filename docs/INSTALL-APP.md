# Install: the app only

This installs **just the running app**, from its published container image: no source code and no development tools.
It runs on your own machine, with **your own Spotify account and your own Spotify developer credentials** (a client
id and secret, which A4 shows you how to get). Nothing is shared with anyone else's install. (To work on the code instead, use [`INSTALL-DEV.md`](INSTALL-DEV.md). To run it on a server and open it from your other devices after signing in, use [`INSTALL-SERVER.md`](INSTALL-SERVER.md).)

The current release is **`1.0.0-beta.9`**. The commands below use it. Newer releases are announced on the
[Releases page](https://github.com/kuhndj67/spotify-companion/releases), with what changed and how to update.

**How to use this document.** Do the steps in order. Each step has a **Purpose**, the **Commands**, what you should
see (**Expected**), and what to do if you see something else (**If it differs**). If a step does not match its
*Expected* and its *If it differs* does not get you past it, **stop there**. Don't improvise: that is a gap in this
document, and worth reporting.

Some steps can only be done by **a person**: an administrator window, a browser sign-in, a password or a secret typed
in, playing music. Each of those is a box that starts with **👤 YOU DO THIS**. If you are installing this yourself,
just do every step, boxes included. To have Claude Code do it with you, see [`claude-start.md`](claude-start.md).

**Platforms.** **Windows 10/11 with Rancher Desktop** · **Linux with Docker Engine** (written, not yet walked) ·
macOS untested. The image is published for **`linux/amd64`** (Intel and AMD processors) only. On an **ARM** machine
(Apple Silicon Mac, Raspberry Pi, some NAS models) it has not been tested and may not run. On Windows, run commands in **PowerShell**; they are the same in a Linux shell unless both are shown.

## If you are an AI agent following this file

1. When you reach a **👤 YOU DO THIS** box, **show it to the person word for word**. Do not summarise it, reword it
   or merge it with other text. Then **stop and wait** until the person says it is done.
2. **Never try to do a 👤 box yourself.** These steps need things your terminal does not have: administrator rights,
   a browser, a password or secret typed at a prompt, or music playing.
3. When the person says it is done, run the step's own checks, under **Commands**, and compare what you see with
   **Expected**.
4. Restarting Windows ends your session. The 👤 box says where to continue. The person starts a new session and tells
   you.
5. Where a step says *open a new PowerShell window* so newly installed tools are found, you cannot. Instead, run this
   at the start of each command (your shell keeps no state between commands):

   ```powershell
   $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
   ```

---

## A1 — Docker

**Purpose**: install the one tool this needs, a container engine.

> 👤 **YOU DO THIS** — A1, Windows · needs: PowerShell **as administrator**, then a restart, then an ordinary
> PowerShell window
>
> 1. **WSL** (Windows Subsystem for Linux, which Rancher Desktop runs on). First check whether it is there already:
>
>    ```powershell
>    wsl --status
>    ```
>
>    If that prints settings rather than *not installed*, skip to 4. Otherwise open **PowerShell as administrator**:
>    Start menu → type `PowerShell` → right-click **Windows PowerShell** → **Run as administrator** → **Yes**. In that
>    window run:
>
>    ```powershell
>    wsl --install --no-distribution
>    ```
> 2. When it finishes, **restart Windows**.
> 3. After the restart, in an **ordinary** PowerShell window, run:
>
>    ```powershell
>    wsl --status
>    ```
> 4. In an ordinary PowerShell window, install **Rancher Desktop** (skip if you have it). Click **Yes** if Windows asks
>    to allow changes:
>
>    ```powershell
>    winget install --id SUSE.RancherDesktop -e --source winget --accept-source-agreements --accept-package-agreements
>    ```
> 5. Start **Rancher Desktop** from the Start menu. In its first-run dialog (or later under **Preferences**): set
>    **Container Engine** to **dockerd (moby)**, and turn **Kubernetes off**.
> 6. Wait until Rancher Desktop's status bar shows it is running. On first start this takes **about a minute**.
>
> **You should see:** after step 3, `wsl --status` prints `Default Version: 2`, perhaps with a line saying *WSL1 is
> not supported…*, which is normal. The `winget install` ends with *Successfully installed*. Rancher Desktop shows it
> is running.
> **When done, tell the agent:** "A1 installs done", plus anything that looked different.

*Linux* (not yet walked): install Docker Engine and its Compose plugin by following
<https://docs.docker.com/engine/install/> for your distribution. Then run the checks below, without `wsl --status`
and the `rdctl` line.

**Commands** (the checks; an agent runs these itself). Use a **new** PowerShell window, so the new tools are on the
PATH. An agent refreshes its PATH instead, as in rule 5 of the agent section.

```powershell
wsl --status
docker version
rdctl list-settings | ConvertFrom-Json | ForEach-Object { "engine=$($_.containerEngine.name) kubernetes=$($_.kubernetes.enabled)" }
```

**Expected**

- *Windows*: `wsl --status` prints `Default Version: 2` (and usually a default distribution such as
  `rancher-desktop`). It does **not** say *Windows Subsystem for Linux is not installed*. A line saying *WSL1 is not
  supported with your current machine configuration* is **normal**: Rancher Desktop uses WSL 2.
- `docker version` prints a **`Client:`** section **and a `Server:`** section, with no error.
- *Windows*: the `rdctl` line prints `engine=moby kubernetes=False`, the two settings from the 👤 box's step 5.

**If it differs**

- `wsl --install` refuses with a message about **elevation**, **administrator** or *access denied*: the PowerShell
  window is not running as administrator. Close it, open one with **Run as administrator**, and run it again.
- `wsl --status` still says *not installed* after the restart: repeat the 👤 box from 1, restart, and re-check.
- `winget` stops at *"Do you agree to all the source agreements terms?"* and does not accept typed input: the command
  was run without `--accept-source-agreements --accept-package-agreements`. Use the command exactly as in the box.
- `docker version` shows `Client:` but then an error such as *cannot connect to the Docker daemon*, *the system
  cannot find the file specified*, *failed to read the response from the backend: unexpected EOF*, or *failed to
  connect to the backend: timed out dialing Hyper-V socket*: Rancher Desktop is not running yet (its first start
  takes a minute or more), or a setting from the 👤 box's step 5 was missed. Check the `rdctl` line's output, then
  run `docker version` again **once a minute, for up to about three minutes**: on a first start the error can
  change (*cannot find the file*, then *timed out dialing Hyper-V socket*) before it passes (walked 2026-10-21).
- The `rdctl` line prints `kubernetes=True`, or an engine other than `moby`: in Rancher Desktop open **Preferences**,
  set **Container Engine** to **dockerd (moby)** and turn **Kubernetes off**, click **Apply**, wait for it to
  restart, and re-check.
- `docker` is *not recognized*: open a **new** PowerShell window. A window opened before the install does not see the
  new PATH. An agent refreshes its PATH instead, as in rule 5 of the agent section.

---

## A2 — Download the image

**Purpose**: download the app's image from GitHub's container registry. The image is public: no GitHub account or
sign-in is needed. Docker keeps the image in **its own storage, not in a folder of yours**: you can run this from any
folder, and no files appear. Your folder and its files come in A3.

**Commands**

```powershell
docker pull ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.9
docker image ls ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.9
```

**Expected**

- `docker pull` takes a minute or two the first time. It prints a line per part of the image (`Pull complete`), and
  ends with `Status: Downloaded newer image for ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.9` (or `Image is up to
  date` if it was downloaded before).
- `docker image ls` prints a heading line and **one line naming `1.0.0-beta.9`**: the image is stored and ready.
  (The columns differ between Docker versions; the version on the line is what matters.)

**If it differs**

- `manifest unknown` or `not found`: that version does not exist. Copy the command exactly as written here; the
  current release is named at the top of this file.
- `denied` or `unauthorized`: Docker is probably sending an old GitHub sign-in (for example, from an earlier install
  of this app). Run `docker logout ghcr.io` and repeat. Still refused: stop and report it.
- `docker image ls` prints only the heading line: the download did not finish. Run `docker pull` again.
- An error or warning naming a **platform**, `arm64` or `linux/amd64`: this is an ARM machine. See **Platforms** at
  the top: it is untested there.

---

## A3 — Your folder

**Purpose**: create the folder the app runs from, with its settings files. The image writes them itself.

**Commands**: in a **new, empty** folder (for example `C:\spotify-companion`):

```powershell
docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.9 setup
```

**Expected**:
`✓ setup wrote: compose.yaml, secrets/app/musicbrainz.json, config/rules.json (and empty data/, state/)`.

**If it differs**

- An error while downloading the image: back to A2.
- `✗ setup: refusing to overwrite: …`: the folder is not empty. Use a new, empty folder. Nothing was written.

---

## A4 — Your Spotify app

**Purpose**: get a **client id** and **client secret** that belong to you. Every install uses its own Spotify
developer app. This routine never ships, suggests or reuses one.

> 👤 **YOU DO THIS** — A4 · needs: a web browser and the Spotify account whose listening you want to record
>
> 1. Open <https://developer.spotify.com/dashboard> and sign in. Accept the developer terms if asked.
> 2. Click **Create app**. **App name**: anything (e.g. `spotify-companion`). **App description**: anything.
>    **Redirect URIs**: exactly `http://127.0.0.1:8888/callback`. Type it, then click **Add**. **Which API/SDKs are
>    you planning to use?**: tick **Web API**.
> 3. Agree to the terms and click **Save**.
> 4. On the app's page, open **Settings**. Copy the **Client ID**. Click **View client secret** and copy the **Client
>    secret**. Keep both for A6. Do not paste them anywhere else, including into a chat with an agent.
>
> **You should see:** the app's Settings page with a Client ID (32 letters and digits), a client secret you can
> reveal, and `http://127.0.0.1:8888/callback` under Redirect URIs.
> **When done, tell the agent:** "A4 done" (not the values).

**Commands**: none. This step is entirely in the browser.

**Expected**: as in the box.

**If it differs**

- The redirect URI is refused or changed: it must be the literal loopback address `127.0.0.1`, not `localhost`, with
  port `8888` and path `/callback`.
- Spotify will not let you create an app: Spotify sets who may register developer apps and has changed these rules
  before. The dashboard's message says what it needs. This routine cannot work around it.

**About Development Mode.** A new app is in Spotify's *Development Mode*: it works for **the account that created
it** (and accounts you add under its **User Management**). This app is single-user, so that is enough. Development
Mode returns **no artist genres**, and the app says so. That is expected, not a fault.

---

## A5 — Your contact address

**Purpose**: MusicBrainz, which the app asks for record labels, requires every request to say who is making it. The
app **does not start** with the placeholder.

> 👤 **YOU DO THIS** — A5 · needs: a text editor
>
> 1. Open `secrets\app\musicbrainz.json` in your folder (Notepad is fine).
> 2. Replace `you@example.com` with an address where you can be reached. Keep the quotes. Save.
>
> **You should see:** the line reads `"contact": "<your address>",`.
> **When done, tell the agent:** "A5 done".

**Commands** (the check):

```powershell
(Get-Content secrets\app\musicbrainz.json -Raw | ConvertFrom-Json).contact -notin @('', 'you@example.com')
```

*Linux:*

```bash
grep -q '"contact": "you@example.com"' secrets/app/musicbrainz.json && echo False || echo True
```

**Expected**: `True`.

**If it differs**: `False`, so do the box again. An error about JSON means a quote or comma was removed: undo the
edit and change only the address.

---

## A6 — Sign in to Spotify

**Purpose**: give the app a long-lived Spotify sign-in, stored in `secrets/app/spotify-config.json` on your machine.

> 👤 **YOU DO THIS** — A6 · needs: an ordinary PowerShell window in your folder, a web browser, and A4's Client ID and
> Client secret
>
> 1. In PowerShell, go to **your folder** from A3 (the command writes into the folder it is run in), for example:
>
>    ```powershell
>    cd C:\spotify-companion
>    ```
>
>    Then run:
>
>    ```powershell
>    docker run --rm -it -v "${PWD}:/work" -p 127.0.0.1:8888:8888 ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.9 auth
>    ```
>    Keep the `127.0.0.1:` in it: it keeps the sign-in reachable from this computer only.
> 2. Type the **Client ID** and **Client Secret** when asked.
> 3. Open the link it prints in your web browser, and approve.
>
> **You should see:** `✓ Tokens written to /work/secrets/app/spotify-config.json`.
> **When done, tell the agent:** "A6 done".

**Commands** (the check, in your folder):

```powershell
Test-Path secrets\app\spotify-config.json
```

**Expected**: `True`.

**If it differs**

- Spotify's page says **INVALID_CLIENT** or *redirect URI mismatch*: the Client ID is wrong, or the redirect URI in
  your Spotify app is not exactly `http://127.0.0.1:8888/callback` (A4). Fix it, then run the command again.
- *port is already allocated* for 8888: something else uses that port; close it, or finish an earlier sign-in, and run
  the command again.
- *Timed out after 5 minutes*: run the command again and approve sooner.

---

## A7 — Start it, and check that it works

**Purpose**: prove the install works with **positive** evidence: the app answers, it reaches Spotify, and it records a
play. *No errors* is not evidence.

**Commands**

1. In your folder:

   ```powershell
   docker compose up -d
   ```

   Wait about 30 seconds (first start), then:

   ```powershell
   curl.exe -s http://localhost:3010/api/health
   ```

   *(Windows: type `curl.exe`, not `curl`. In Windows PowerShell, `curl` is a different command.)*

2. Music:

   > 👤 **YOU DO THIS** — A7 music · needs: Spotify on any device signed in to the same account, and a browser on this
   > machine
   >
   > 1. **Play music** and leave it playing.
   > 2. Open <http://localhost:3010> in your web browser.
   > 3. **Skip to the next track**, and let **that** track play **to its end**.
   >
   > **You should see:** the page shows the track that is playing; in the status bar, the **Spotify** indicator is
   > **●** (*The last poll succeeded*), and **Automation off**.
   > **When done, tell the agent:** "A7 played", and the title of the track that played to its end.

3. Then:

   ```powershell
   curl.exe -s http://localhost:3010/api/history/recent
   ```

**Expected**

- `docker compose up -d` ends with the container `spotify-companion` **Started**.
- `/api/health` prints `{"status":"ok","mcp":"connected","toolCount":` followed by a number and `}`.
- `/api/history/recent` lists, first, the track that played to its end. ⚠️ On its first start the app also imports
  about 50 of your **earlier** plays from Spotify, so a full history proves nothing by itself: only that track, which
  started after the app did, shows that recording works.

**If it differs**

- `/api/health` fails to connect: wait 30 seconds (first start) and retry. Still failing, this names the cause:

  ```powershell
  docker logs spotify-companion
  ```

  *MusicBrainz contact* means A5; *credentials* means A6.
- The Spotify indicator is not **●**: hover it; the reason is written there.
- The played track is missing: a play is recorded when the track **ends**; wait for the next one and check again.

---

## A8 — Automation and rules are ready, and off

**Purpose**: know that automated skipping is **off**, and that the app can save rules and its automation setting.
This routine never turns automation on.

**Commands**

The second command prints only the two diagnostics steps this one checks. The full diagnostics output contains your
MusicBrainz contact address, so it is not printed here.

```powershell
# Windows
curl.exe -s http://localhost:3010/api/automation
(curl.exe -s http://localhost:3010/api/diagnostics | ConvertFrom-Json).steps | Where-Object name -match '^(Automation state file|Rules directory writable)' | Format-Table name, status, detail -AutoSize -Wrap
```

```bash
# Linux
curl -s http://localhost:3010/api/automation
curl -s http://localhost:3010/api/diagnostics | grep -oE '"name":"(Automation state file|Rules directory writable[^"]*)","status":"[a-z]+"'
```

**Expected**

- `/api/automation` begins `{"enabled":false,`.
- Two lines, *Automation state file* and *Rules directory writable (config/)*, both with status `ok` (on Windows,
  the detail of the first ends `· writable`).

**What turning it on means.** Rules you write in the **Rules** pop-up decide which tracks match; the **Automated
skipping** section there turns automation on and off. Once on, matching tracks are **skipped on your Spotify player
for real**, and a reboot resumes skipping. Built-in limits stop it after a run of consecutive skips. Start with a rule
you have watched match in the decision log while automation was off.

**If it differs**: `"enabled":true` on a fresh install: stop and report it. Either diagnostics step `fail`: stop and
report it (the app cannot save its settings). Fewer than two lines: the step names have changed; stop and report it.
Do not print the full diagnostics output into a log instead.

---

## Backups

Your listening history in `data/` **cannot be recreated**. The app keeps backups for you, and one copy should live
somewhere else.

- **Automatic backups** (from `1.0.0-beta.9`): once a day, and before any update or database change, the app keeps a
  backup in `data/backups/` (`scheduled/` keeps the newest 14, `before-change/` the newest 5). Each one can be
  restored with **Settings → Restore backup**. **Settings → Backup & restore** shows the newest of each, and the
  **Status** light turns yellow or red if they stop.
- ⚠️ **They are on the same disk as your history.** Deleting the folder, or losing the disk, loses both. Keep a copy
  elsewhere: **Settings → Create backup** downloads one, and you can also copy `data/backups/` to another drive or
  cloud folder.
- **The weekly reminder**: if no backup has been downloaded for a week, the **Status** light turns yellow and
  **Diagnostics** says so. Turn it off in **Settings → Backup & restore** if the whole computer or server running the
  app is already backed up.

---

## Updating, stopping, removing

- **Know when there is a new release**: **Settings → Version** says when a newer version exists, and an **Update**
  marker appears in the status bar. To do this, the app asks GitHub (`api.github.com`) once a day for this project's
  list of releases; GitHub sees your IP address and the app's version, nothing else. Turn it off in
  **Settings → Version**. On GitHub, **Watch → Custom → Releases** also tells you, and each release is listed on the
  [Releases page](https://github.com/kuhndj67/spotify-companion/releases) with what changed.
- **Update to a newer release**: in your folder, run the **new** version's `update` command, then start it. The
  command below names the current release (the top of this file says which); it is the version you move to:

  ```powershell
  docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.9 update
  docker compose up -d
  ```

  `update` changes only the version on the `image:` line of `compose.yaml`, and refuses to move to an older version.
  The new version **backs up your history before its first run** (into `data/backups/before-change/`). You do not
  need to stop the app first.

  **If `update` says there is no image line**, your `compose.yaml` was edited by hand: change the version at the end
  of its `image:` line yourself, then `docker compose up -d`.

- **Stop** (your data stays), and **start again**. It also restarts by itself after a reboot, once Rancher Desktop
  is running:

  ```powershell
  docker compose down
  docker compose up -d
  ```

- **Remove**: stop it, then delete the folder. ⚠️ Keep a backup if you may want your history.

  ```powershell
  docker compose down
  ```
