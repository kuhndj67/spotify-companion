# Install: full development environment

This installs your own copy of Spotify Companion **from source**, with the tools to change and test it (to run
just the app, use [`INSTALL-APP.md`](INSTALL-APP.md) instead), on your own machine, with **your own Spotify account and your own
Spotify developer app**. Nothing is shared with anyone else's install.

**How to use this document.** Do the steps in order. Each step has a **Purpose**, the **Commands**, what you should
see (**Expected**), and what to do if you see something else (**If it differs**). If a step does not match its
*Expected* and its *If it differs* does not get you past it, **stop there**. Don't improvise: that is a gap in this
document, and worth reporting.

Some steps can only be done by **a person**: an administrator window, a browser sign-in, playing music. Each of those
is a box that starts with **👤 YOU DO THIS**. If you are installing this yourself, just do every step, boxes
included. To have Claude Code do it with you, see [`claude-start.md`](claude-start.md).

**Platforms.**

- **Windows 10/11 with Rancher Desktop**: walked.
- **Linux with Docker Engine**: written, but **not yet walked**. Commands marked *Linux* may be wrong in details;
  please report any that are.
- **macOS**: untested.

On Windows, run commands in **PowerShell**. Where Windows and Linux differ, both are shown. Otherwise the command
is the same on both.

## If you are an AI agent following this file

1. When you reach a **👤 YOU DO THIS** box, **show it to the person word for word**. Do not summarise it, reword it
   or merge it with other text. Then **stop and wait** until the person says it is done.
2. **Never try to do a 👤 box yourself.** These steps need things your terminal does not have: administrator rights,
   a browser, an interactive sign-in prompt, or music playing.
3. When the person says it is done, run the step's own checks, under **Commands**, and compare what you see with
   **Expected**.
4. Prompts that wait for typed input (*Do you agree…?*, *Username for…*) cannot be answered from your terminal. Every
   command here that could ask one has flags to avoid it, or sits in a 👤 box. Before any `git` command, set
   `$env:GIT_TERMINAL_PROMPT='0'; $env:GCM_INTERACTIVE='never'` (Linux: `export GIT_TERMINAL_PROMPT=0`), so a sign-in
   prompt fails at once with a message this file lists, instead of hanging.
5. Restarting Windows ends your session. The 👤 box says where to continue. The person starts a new session and tells
   you.
6. Where a step says *open a new PowerShell window* so newly installed tools are found, you cannot. Instead, run this
   at the start of each command (your shell keeps no state between commands):

   ```powershell
   $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
   ```

---

## S1 — Prerequisites

**Purpose**: install the three tools the rest of the routine uses: a container engine, Node.js and git.

> 👤 **YOU DO THIS** — S1, Windows · needs: PowerShell **as administrator**, then a restart, then an ordinary
> PowerShell window
>
> 1. **WSL** (Windows Subsystem for Linux, which Rancher Desktop runs on). Skip to 4 if `wsl --status` already prints
>    settings rather than *not installed*. Open **PowerShell as administrator**: Start menu → type `PowerShell` →
>    right-click **Windows PowerShell** → **Run as administrator** → **Yes**. In that window run:
>    `wsl --install --no-distribution`
> 2. When it finishes, **restart Windows**.
> 3. After the restart, in an **ordinary** PowerShell window, run `wsl --status`.
> 4. In an ordinary PowerShell window, install whichever of these you do not have yet. Click **Yes** if Windows asks
>    to allow changes. Run them **one at a time**:
>
>    ```powershell
>    winget install --id SUSE.RancherDesktop -e --source winget --accept-source-agreements --accept-package-agreements
>    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
>    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
>    ```
> 5. Start **Rancher Desktop** from the Start menu. In its first-run dialog (or later under **Preferences**): set
>    **Container Engine** to **dockerd (moby)**, and turn **Kubernetes off**.
> 6. Wait until Rancher Desktop's status bar shows it is running. On first start this takes **about a minute**.
>
> **You should see:** after step 3, `wsl --status` prints `Default Version: 2`, perhaps with a line saying *WSL1 is
> not supported…*, which is normal. Each `winget install` ends with *Successfully installed*. Rancher Desktop shows it
> is running.
> **When done, tell the agent:** "S1 installs done", plus anything that looked different.

*Linux* (not yet walked): install Docker Engine and its Compose plugin by following
<https://docs.docker.com/engine/install/> for your distribution, and Node.js 22 or newer and git with your package
manager. Then run the checks below, without `wsl --status`.

**Commands** (the checks; an agent runs these itself). Use a **new** PowerShell window, so the new tools are on the
PATH. An agent refreshes its PATH instead, as in rule 6 of the agent section.

```powershell
wsl --status
docker version
node --version
git --version
rdctl list-settings | ConvertFrom-Json | ForEach-Object { "engine=$($_.containerEngine.name) kubernetes=$($_.kubernetes.enabled)" }
```

**Expected**

- *Windows*: `wsl --status` prints `Default Version: 2` (and usually a default distribution such as
  `rancher-desktop`). It does **not** say *Windows Subsystem for Linux is not installed*. A line saying *WSL1 is not
  supported with your current machine configuration* is **normal**: Rancher Desktop uses WSL 2.
- `docker version` prints a **`Client:`** section **and a `Server:`** section, with no error.
- `node --version` prints `v22` or higher (for example `v22.12.0` or `v24.20.0`).
- `git --version` prints `git version 2.` followed by more digits.
- *Windows*: the `rdctl` line prints `engine=moby kubernetes=False`, the two settings from the 👤 box's step 5.

**If it differs**

- `wsl --install` refuses with a message about **elevation**, **administrator** or *access denied*: the PowerShell
  window is not running as administrator. Close it, open one with **Run as administrator**, and run it again.
- `wsl --status` still says *not installed* after the restart: repeat the 👤 box from 1, restart, and re-check.
- `winget` stops at *"Do you agree to all the source agreements terms?"* and does not accept typed input: the command
  was run without `--accept-source-agreements --accept-package-agreements`. Use the commands exactly as in the box.
- `docker version` shows `Client:` but then an error such as *cannot connect to the Docker daemon*, *the system
  cannot find the file specified*, *failed to read the response from the backend: unexpected EOF*, or *failed to
  connect to the backend: timed out dialing Hyper-V socket*: Rancher Desktop is not running yet (its first start
  takes a minute or more), or a setting from the 👤 box's step 5 was missed. Check the `rdctl` line's output, then
  run `docker version` again **once a minute, for up to about three minutes**: on a first start the error can
  change (*cannot find the file*, then *timed out dialing Hyper-V socket*) before it passes (walked 2026-10-21).
- The `rdctl` line prints `kubernetes=True`, or an engine other than `moby`: step 5 of the 👤 box was missed or not
  saved. In Rancher Desktop open **Preferences**, set **Container Engine** to **dockerd (moby)** and turn
  **Kubernetes off**, click **Apply**, wait for it to restart, and re-check. Kubernetes left on makes Rancher Desktop's
  first start slow, and Docker can fail with the errors above until it settles. Check **Preferences → Container Engine = dockerd (moby)**, wait for it to finish starting, and run
  `docker version` again.
- `docker`, `node` or `git` is *not recognized*: open a **new** PowerShell window. A window opened before the install
  does not see the new PATH. An agent refreshes its PATH instead, as in rule 6 of the agent section.
- `node --version` prints `v20` or lower: install a newer Node.js (the `winget` line above), then re-check.

---

## S2 — Get the code

**Purpose**: download the code at a **release tag**, so you are running a tested version and not whatever is on
`main` today.

If the repository is **private**, you need **read access**, and the sign-in must happen in a window where you can
answer GitHub's prompt:

> 👤 **YOU DO THIS** — S2 sign-in, only if the repository is private · needs: an ordinary PowerShell window you type in
>
> 1. Run: `git ls-remote --tags https://github.com/kuhndj67/spotify-companion.git`
> 2. When Git asks how to sign in, use the access you were given: choose **Token** and paste a token with read access
>    to this repository, or sign in with your own GitHub account.
>
> **You should see:** a list of lines ending in `refs/tags/v…`. Git remembers the sign-in, so later `git` commands
> (including an agent's) no longer ask.
> **When done, tell the agent:** "S2 signed in", plus the tag you were told to install, if you were given one.

**Commands**

1. Choose the tag. Use the one you were pointed to. Otherwise list the tags and pick the **highest version**,
   ignoring the duplicate lines that end in `^{}`:

   ```powershell
   git ls-remote --tags https://github.com/kuhndj67/spotify-companion.git
   ```

2. In the folder you want the app in, clone that tag. Replace `<tag>` with it, for example `v0.8.3`:

   ```powershell
   git clone --branch <tag> https://github.com/kuhndj67/spotify-companion.git
   cd spotify-companion
   git describe --tags
   ```

**Expected**

- `git ls-remote` lists tags such as `refs/tags/v0.8.3`.
- `git clone` finishes. It may print *warning: refs/tags/… is not a commit!* and a note about *'detached HEAD'*
  state. **Both are normal** when cloning a tag.
- `git describe --tags` prints exactly the tag you cloned.
- The folder contains `compose.yaml`, `package.json`, `docs`, `secrets` and `config`. Check with `ls`.

**If it differs**

- *could not read Username* / *terminal prompts disabled* / *Cannot prompt*: the repository is private and nobody has
  signed in yet. Do the 👤 box above, then repeat.
- *Repository not found* or *Authentication failed*: the credential does not grant read access to this repository.
  Get one that does, and repeat in a fresh folder.
- *Remote branch … not found*: the tag name is wrong. Run step 1 again and copy a tag that is listed.

**All later steps run inside the `spotify-companion` folder.**

---

## S3 — Register your own Spotify app

**Purpose**: get a **client id** and **client secret** that belong to you. Every install uses its own Spotify
developer app. This routine never ships, suggests or reuses one.

> 👤 **YOU DO THIS** — S3 · needs: a web browser and the Spotify account whose listening you want to record
>
> 1. Open <https://developer.spotify.com/dashboard> and sign in. Accept the developer terms if asked.
> 2. Click **Create app**. **App name**: anything (e.g. `spotify-companion`). **App description**: anything.
>    **Redirect URIs**: exactly `http://127.0.0.1:8888/callback`. Type it, then click **Add**. **Which API/SDKs are
>    you planning to use?**: tick **Web API**.
> 3. Agree to the terms and click **Save**.
> 4. On the app's page, open **Settings**. Copy the **Client ID**. Click **View client secret** and copy the **Client
>    secret**. Keep both for S4. Do not paste them anywhere else, including into a chat with an agent.
>
> **You should see:** the app's Settings page with a Client ID (32 letters and digits), a client secret you can
> reveal, and `http://127.0.0.1:8888/callback` under Redirect URIs.
> **When done, tell the agent:** "S3 done" (not the values).

**Commands**: none. This step is entirely in the browser.

**Expected**: as in the box.

**If it differs**

- The redirect URI is refused or changed: it must be the literal loopback address `127.0.0.1`, not `localhost`, with
  port `8888` and path `/callback`.
- Spotify will not let you create an app: Spotify sets who may register developer apps and has changed these
  rules before. The dashboard's message says what it needs. This routine cannot work around it.

**About Development Mode.** A new app is in Spotify's *Development Mode*. It works for **the account that created
it**, and for other accounts only if you add them under the app's **User Management**. Spotify sets those limits.
This app is single-user, so that is enough. One visible effect: Development Mode returns **no artist genres**, and the
app says so (*"Spotify no longer returns artist genres in Development Mode"*). That is expected, not a fault.

---

## S4 — Sign in to Spotify

**Purpose**: give the app a long-lived Spotify sign-in, stored in `secrets/app/spotify-config.json` on your machine
only (the file is gitignored).

**Commands**

1. Create the file from its template:

   ```powershell
   # Windows
   New-Item -ItemType Directory -Force secrets\app | Out-Null
   Copy-Item secrets\spotify-config.example.json secrets\app\spotify-config.json
   ```

   ```bash
   # Linux
   mkdir -p secrets/app
   cp secrets/spotify-config.example.json secrets/app/spotify-config.json
   ```

2. Put the two values from S3 into it:

   > 👤 **YOU DO THIS** — S4 values · needs: a text editor, and the Client ID and secret from S3
   >
   > 1. Open `secrets\app\spotify-config.json` in the `spotify-companion` folder, in any text editor (Notepad is fine).
   > 2. Replace `your-spotify-client-id` with your Client ID, and `your-spotify-client-secret` with your Client
   >    secret. Keep the quotes. Leave `redirectUri` as it is. Save.
   >
   > **You should see:** the file still has its four lines, with your two values in place of the placeholders.
   > **When done, tell the agent:** "S4 values in".

3. Start the sign-in. It opens a browser and **waits** until the person approves. An agent shows this box **first**,
   then runs the command:

   > 👤 **YOU DO THIS** — S4 approval · needs: the browser that `npm run auth` opens, and the same Spotify account as S3
   >
   > 1. When the browser opens on Spotify's page, sign in if asked, check it names your app, and click **Agree**.
   > 2. If the page shows an error instead of *Agree* (for example *"response_type must be code"*), or no page opened,
   >    copy the long `https://accounts.spotify.com/authorize?...` line that `npm run auth` printed into the
   >    browser's address bar, and approve there. If an agent ran the command, you cannot see its terminal: ask the
   >    agent for that line.
   >
   > **You should see:** a page saying **Authorised** and *You can close this tab and return to the terminal.*
   > **When done, tell the agent:** "S4 approved", and whether the page said **Authorised**.

   ```powershell
   npm run auth
   ```

   `npm run auth` needs no `npm install` first: it uses only Node.js itself.

**Expected** (in the terminal, after approving):

```
✓ Using existing credentials from secrets/app/spotify-config.json
...
✓ Tokens written to secrets/app/spotify-config.json
✓ Scopes granted include user-follow-read
```

`secrets/app/spotify-config.json` now also contains `accessToken`, `refreshToken` and `expiresAt`. An npm notice about a
new npm version may appear too. It is harmless.

**If it differs**

- The terminal asks `Client ID:` instead of saying *Using existing credentials*: the file is missing, or still holds
  the placeholders. Do the *S4 values* box again.
- The browser shows **Authorisation denied**: *Cancel* was clicked on Spotify's page. Run `npm run auth` again.
- Spotify's page says **INVALID_CLIENT** or *redirect URI mismatch*: the Client ID is wrong, or the redirect URI in
  S3 is not exactly `http://127.0.0.1:8888/callback`.
- `✗ Authentication failed` mentioning port `8888` (*address already in use*): another program uses that port.
  Close it and run `npm run auth` again.

---

## S5 — MusicBrainz contact

**Purpose**: the app looks up record labels on MusicBrainz, whose policy requires every app to say how to reach its
operator. **The app refuses to start without this file**, so it is created before the first start.

**Commands**

1. Create the file from its template:

   ```powershell
   # Windows
   Copy-Item secrets\musicbrainz.example.json secrets\app\musicbrainz.json
   ```

   ```bash
   # Linux
   cp secrets/musicbrainz.example.json secrets/app/musicbrainz.json
   ```

2. Put your contact in:

   > 👤 **YOU DO THIS** — S5 contact · needs: a text editor
   >
   > 1. Open `secrets\app\musicbrainz.json` in the `spotify-companion` folder.
   > 2. Replace `you@example.com` with **your own** email address, or another way to reach you such as a URL. Keep
   >    the quotes. Leave the other fields as they are. Save.
   >
   > **You should see:** `"contact"` holds your address, not `you@example.com`.
   > **When done, tell the agent:** "S5 contact in".

3. Check it, without printing the value:

   ```powershell
   # Windows
   (Get-Content secrets\app\musicbrainz.json -Raw | ConvertFrom-Json).contact -notin @('', 'you@example.com')
   ```

   ```bash
   # Linux
   grep -q '"contact": "you@example.com"' secrets/app/musicbrainz.json && echo False || echo True
   ```

**Expected**: the check prints `True`: `secrets/app/musicbrainz.json` exists, and its `"contact"` is set and no longer
`you@example.com`.

**If it differs**: it prints `False`, so do the *S5 contact* box again. If the copy fails with *cannot find path*, you are not in the `spotify-companion` folder (S2).

---

## S6 — Rules file and data folder

**Purpose**: create your (empty) rules file and the folder the app writes its history to, owned by you.

**Commands**

```powershell
npm run rules:init
```

```powershell
# Windows
New-Item -ItemType Directory -Force data | Out-Null
```

```bash
# Linux (not yet walked)
mkdir -p data
id -u
```

Check both folders exist:

```powershell
Test-Path data, state
```

**Expected**

- `npm run rules:init` prints `Created config/rules.json from the example.` and says the file contains no rules
  and nothing will be skipped.
- `Test-Path data, state` prints `True` twice. (`state` already exists: it comes with the code.)
- *Linux*: `id -u` prints `1000`.

**If it differs**

- `config/rules.json already exists — leaving it alone.`: it was created before. That is fine.
- *Linux*: `id -u` prints something other than `1000`. The app inside the container runs as user id 1000 and must
  be able to write `config`, `state` and `secrets/app`. Run
  `sudo chown -R 1000:1000 config state secrets/app`. *(Not yet walked; to be confirmed on Linux.)*

---

## S7 — Build and start

**Purpose**: build the app's container image from this source on your machine, and start it. No pre-built image is
published, so every install builds its own. The build downloads the Spotify connector (`spotify-mcp-server`) from
GitHub at a fixed version, so it needs internet access.

**Commands**

First check the two secrets are **files**, not folders. If either was missing when the container started, Docker
creates a **folder** in its place:

```powershell
# Windows
Get-Item secrets\app\spotify-config.json, secrets\app\musicbrainz.json | Select-Object Name, Mode
```

```bash
# Linux
ls -ld secrets/app/spotify-config.json secrets/app/musicbrainz.json
```

Then build and start. The first build takes a few minutes:

```powershell
docker compose up -d --build
```

Wait about a minute, then:

```powershell
docker inspect -f "{{.State.Health.Status}}" spotify-companion
```

**Expected**

- Both secrets are files: the `Mode` begins with `-a` on Windows, or the line begins with `-` on Linux. Neither is a
  `d` (folder).
- `docker compose up` ends with lines saying the container `spotify-companion` is **Started**, with no error.
  Lines from inside the build such as `debconf: unable to initialize frontend` or npm notices are normal.
- `docker inspect` prints **`healthy`**.

**If it differs**

- A secret shows as a **folder** (`d`): delete that folder (`Remove-Item -Recurse secrets\app\<name>` /
  `rm -r secrets/<name>`), redo S4 or S5 to create the file, run `docker compose down`, then repeat this step.
- `docker inspect` prints `starting`: wait 30 seconds and run it again.
- It prints `unhealthy`, or the container keeps restarting: run `docker logs spotify-companion`. A line naming
  `musicbrainz.json` means S5 is incomplete. A line naming `spotify-config.json` means S4 is incomplete. Fix the
  step, then `docker compose up -d` again.
- `docker compose up` fails with *port is already allocated* (or *address already in use*) on `3010`: another
  program uses port 3010. Create a file named `.env` in this folder containing one line,
  `SPOTIFY_COMPANION_PORT=3020` (or another free port). Run `docker compose up -d` again, and **use that port
  instead of 3010 in S8**.
- The build fails: copy the last 30 lines of its output into your report.

---

## S8 — Check that it works

**Purpose**: prove the install works with **positive** evidence: the app answers, it can reach Spotify, and it
records a play. *No errors* is not evidence. (Port `3010`, or the port you chose in S7.)

**Commands**

1. The app answers:

   ```powershell
   curl.exe -s http://localhost:3010/api/health
   ```

   *(Windows: type `curl.exe`, not `curl`. In Windows PowerShell, `curl` is a different command.)*

2. Music:

   > 👤 **YOU DO THIS** — S8 music · needs: Spotify on any device signed in to the same account (phone, desktop app,
   > web player), and a browser on this machine
   >
   > 1. **Play music** and leave it playing.
   > 2. Open <http://localhost:3010> in your web browser (Edge, Chrome…). A link clicked in a Claude Code chat opens
   >    inside VS Code instead; that view works too, but a browser shows the page as users will see it.
   >
   > **You should see:** the page shows the track that is playing. In the status bar at the top, the **Spotify**
   > indicator is **●**, and hovering it shows *The last poll succeeded.* The same bar reads **Automation off**.
   > **When done, tell the agent:** "S8 playing", and the title you are hearing, and whether the page matched.

3. Spotify is reachable. While the music plays:

   ```powershell
   curl.exe -s http://localhost:3010/api/now-playing
   ```

4. A play is recorded. A play is recorded when a track **ends**, so the track that is playing **now** cannot prove
   anything new: it may have started before this check. Note the current time (UTC) first:

   ```powershell
   (Get-Date).ToUniversalTime().ToString('u')
   ```

   > 👤 **YOU DO THIS** — S8 next track · needs: the Spotify player you are listening on
   >
   > 1. **Skip to the next track.** This matters: the track playing now started *before* the time just noted, so
   >    only a track that starts *after* it can prove that a new play was recorded.
   > 2. Let **that** track play **to its end**, then let the one after it start.
   >
   > **You should see:** the player moves on to another track by itself.
   > **When done, tell the agent:** "S8 next track finished", and its title.

   Then:

   ```powershell
   curl.exe -s http://localhost:3010/api/history/recent
   ```

**Expected**

- `/api/health` prints `{"status":"ok","mcp":"connected","toolCount":` followed by a number and `}`.
- `/api/now-playing` prints JSON containing `"isPlaying":true` and `"track":"<the title being heard>"`.
- The page matches the 👤 box's *You should see*.
- `/api/history/recent` lists plays newest first. At least one entry has a `startedAt` (UTC) **after** the time you
  noted, and the newest one is a track that played after that time.

**If it differs**

- `/api/health` prints `"status":"degraded"`: the app is running but its Spotify connection is not.
  `docker logs spotify-companion` names the cause. Usually S4 is incomplete; redo it, then
  `docker compose restart`.
- Connection refused: the container is not running (S7), or you are using the wrong port.
- `/api/now-playing` shows `"isPlaying":false` while music plays: the music is playing on a **different Spotify
  account** from the one used in S3/S4.
- The Spotify indicator is **✕**: hover it. The text says what Spotify answered. A credentials message means S4.
- `/api/history/recent` has entries but **none after your noted time**: on first start the app imports your last
  ~50 plays from Spotify. Those are older, so they do not prove anything. Let another track finish and check again.

---

## S9 — *(optional)* Bring your history from another install

**Purpose**: move the play history of another install of this app into this one.

**Commands**: in the **old** install, open **Settings → Create backup** and save the file. In **this** install, open
**Settings → Restore backup**, choose that file, and follow the prompts (it verifies the file first and asks you to
type a confirmation word). This is done by a person in the browser.

**Expected**: after the app restarts itself, the history shows the old install's plays. Your **credentials** and
your **automation switch** are **not** carried over. A backup never contains them.

**If it differs**: the restore dialog explains every refusal in words. Do **not** copy files into `data/` by hand.
That bypasses the checks, and a database copied while the app is running can silently lose recent plays.

---

## S10 — Automated skipping is off

**Purpose**: know where automation is, and that it is **off**. This routine never turns it on.

**Commands**

```powershell
curl.exe -s http://localhost:3010/api/automation
```

**Expected**: the JSON begins `{"enabled":false,`. In the page, the status bar shows automation **off** (seen in S8).

**What turning it on means.** Rules you write in the **Rules** pop-up decide which tracks match. The **Automated
skipping** section of that pop-up turns automation on and off. Once it is on, matching tracks are **skipped on your
Spotify player for real**, and a reboot resumes skipping without asking. Built-in safety limits stop it after a
run of consecutive skips. Read the Rules pop-up's explanations before turning it on, and start with a rule you have
watched match in the decision log while automation was off.

**If it differs**: if it reports `"enabled":true` on a fresh install, stop and report it. A fresh install must never
start armed.

---

## Updating, stopping, removing

- **Stop**: `docker compose down` (your data stays in `data/`).
- **Start again**: `docker compose up -d`. It also restarts by itself after a reboot, once Rancher Desktop / Docker
  is running.
- **Update to a newer release**: `git fetch --tags`, then `git checkout <new tag>`, then `docker compose up -d --build`.
  Take **Settings → Create backup** first.
- **Upgrading from `1.0.0-beta.4` or earlier** (once): since `1.0.0-beta.5` the two credential files live in
  **`secrets/app/`**, and only that folder is mounted into the container (so other tools' credentials in `secrets/`
  stay out of it). And from `1.0.0-beta.2` or earlier, the container was also renamed from `spotify-now-playing` to
  `spotify-companion`.
  1. **Settings → Create backup**.
  2. `docker compose down` **before** you check out the new tag. The old `compose.yaml` is the only one that knows
     the old container; once you have the new one, `down` leaves the old container running beside the new one, and
     both would record into `data/`.
  3. Move the two files:

     Windows (PowerShell):
     ```powershell
     New-Item -ItemType Directory -Force secrets\app | Out-Null
     Move-Item secrets\spotify-config.json, secrets\musicbrainz.json secrets\app\
     ```

     Linux:
     ```bash
     mkdir -p secrets/app && mv secrets/spotify-config.json secrets/musicbrainz.json secrets/app/
     ```
  4. `git fetch --tags`, `git checkout <new tag>`, `docker compose up -d --build`.

  **If the app will not start after the update** (`docker logs spotify-companion` says the MusicBrainz contact is
  missing), step 3 was skipped: do it, then `docker compose up -d`.

  **If you already checked out the new tag**: run `docker stop spotify-now-playing`, then `docker rm
  spotify-now-playing`, then `docker compose up -d`. **If the Spotify indicator says the credentials are mounted as
  single files**, the old `compose.yaml` is in use with the new image: check out the new tag and start again.
- **Remove**: `docker compose down`, then delete the folder. ⚠️ `data/` holds your play history and **nothing can
  recreate it**. Keep a backup if you may want it.
