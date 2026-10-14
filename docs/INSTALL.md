# Install

This installs your own copy of Spotify Companion on your own machine, with **your own Spotify account and your own
Spotify developer app**. Nothing is shared with anyone else's install.

**How to use this document.** Do the steps in order. Each step has a **Purpose**, the **Commands**, what you should
see (**Expected**), and what to do if you see something else (**If it differs**). If a step does not match its
*Expected* and its *If it differs* does not get you past it, **stop there**. Don't improvise: that is a gap in this
document, and worth reporting.

This document is written to be followed by a person **or** by an AI agent acting for one. A few steps need a person
in a web browser (signing in to Spotify, approving access). Those steps say so.

**Platforms.**

- **Windows 10/11 with Rancher Desktop**: walked.
- **Linux with Docker Engine**: written, but **not yet walked**. Commands marked *Linux* may be wrong in details;
  please report any that are.
- **macOS**: untested.

On Windows, run commands in **PowerShell**. Where Windows and Linux differ, both are shown. Otherwise the command
is the same on both.

---

## S1 — Prerequisites

**Purpose**: install the three tools the rest of the routine uses: a container engine, Node.js and git.

**Commands**

*Windows* (PowerShell). Install whichever of these you do not have yet:

```powershell
winget install --id SUSE.RancherDesktop -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Then start **Rancher Desktop** from the Start menu. In its first-run dialog (or later under **Preferences**):

- **Container Engine** = **dockerd (moby)**. The routine uses the `docker` command; the other engine does not
  provide it.
- **Kubernetes**: turn it off. It is not needed and uses memory.

Wait until Rancher Desktop's status bar shows it is running. Then **open a new PowerShell window**, so the new tools
are on your PATH, and check:

```powershell
docker version
node --version
git --version
```

*Linux* (not yet walked): install Docker Engine and its Compose plugin by following
<https://docs.docker.com/engine/install/> for your distribution. Install Node.js 22 or newer and git with your
package manager. Then run the same three checks (`docker version`, `node --version`, `git --version`).

**Expected**

- `docker version` prints a **`Client:`** section **and a `Server:`** section, with no error.
- `node --version` prints `v22` or higher (for example `v22.12.0` or `v24.11.0`).
- `git --version` prints `git version 2.` followed by more digits.

**If it differs**

- `docker version` shows `Client:` but then an error such as *cannot connect to the Docker daemon* or *the system
  cannot find the file specified*: the engine is not running, or the engine choice is not dockerd. Open Rancher
  Desktop, wait for it to finish starting, check **Preferences → Container Engine = dockerd (moby)**, and run
  `docker version` again.
- The Rancher Desktop installer says Windows must restart (it may need to install WSL): restart, start Rancher
  Desktop again, then repeat this step's checks. *(An agent session ends with the restart. Start a new one and
  continue from these checks.)*
- `docker`, `node` or `git` is *not recognized*: open a **new** PowerShell window. A window opened before the install
  does not see the new PATH.
- `node --version` prints `v20` or lower: install a newer Node.js (the LTS installer above), then re-check.

---

## S2 — Get the code

**Purpose**: download the code at a **release tag**, so you are running a tested version and not whatever is on
`main` today.

**Commands**

Choose the folder you want the app in, then run (the tag is the release you were pointed to, for example
`v1.0.0-beta.1`):

```powershell
git clone --branch v1.0.0-beta.1 https://github.com/kuhndj67/spotify-companion.git
cd spotify-companion
git describe --tags
```

If the repository is private, you need **read access** to it. GitHub will ask you to sign in, or to give a token
that grants read access to this repository.

**Expected**

- `git clone` finishes. It may print a note about being in *'detached HEAD'* state, which is normal for a tag.
- `git describe --tags` prints exactly the tag you cloned (e.g. `v1.0.0-beta.1`).
- The folder contains `compose.yaml`, `package.json`, `docs`, `secrets` and `config`. Check with `ls`.

**If it differs**

- *Repository not found* or *Authentication failed*: the repository is private and the credential you gave does not
  grant read access to it. Get a credential that does, and run the `git clone` again in a fresh folder.
- *Remote branch … not found*: the tag name is wrong. `git ls-remote --tags https://github.com/kuhndj67/spotify-companion.git`
  lists the tags that exist.

**All later steps run inside the `spotify-companion` folder.**

---

## S3 — Register your own Spotify app *(a person, in a browser)*

**Purpose**: get a **client id** and **client secret** that belong to you. Every install uses its own Spotify
developer app. This routine never ships, suggests or reuses one.

**Commands** (in a web browser)

1. Open <https://developer.spotify.com/dashboard> and sign in with the Spotify account whose listening you want to
   record. Accept the developer terms if asked.
2. Click **Create app**. Fill in:
   - **App name**: anything, e.g. `spotify-companion`
   - **App description**: anything
   - **Redirect URIs**: exactly `http://127.0.0.1:8888/callback`. Type it, then click **Add**.
   - **Which API/SDKs are you planning to use?**: tick **Web API**.
3. Agree to the terms and click **Save**.
4. On the app's page, open **Settings**. Copy the **Client ID**. Click **View client secret** and copy the **Client
   secret**. Keep both for S4, and never put them in a file you share.

**Expected**: the app's Settings page shows a Client ID (32 letters and digits), a client secret you can reveal, and
`http://127.0.0.1:8888/callback` under Redirect URIs.

**If it differs**

- The redirect URI is refused or changed: it must be the literal loopback address `127.0.0.1`, not `localhost`, with
  port `8888` and path `/callback`.
- Spotify will not let you create an app: Spotify sets who may register developer apps and has changed these
  rules before. The dashboard's message says what it needs. This routine cannot work around it.

**About Development Mode.** A new app is in Spotify's *Development Mode*. It works for **the account that created
it**, and for other accounts only if you add them under the app's **User Management**. Spotify sets those limits.
This app is single-user, so that is enough.

---

## S4 — Sign in to Spotify *(a person approves in the browser)*

**Purpose**: give the app a long-lived Spotify sign-in, stored in `secrets/spotify-config.json` on your machine
only (the file is gitignored).

**Commands**

First, create `secrets/spotify-config.json` from its template and put your two values in:

```powershell
# Windows
Copy-Item secrets\spotify-config.example.json secrets\spotify-config.json
```

```bash
# Linux
cp secrets/spotify-config.example.json secrets/spotify-config.json
```

Edit `secrets/spotify-config.json` and replace `your-spotify-client-id` and `your-spotify-client-secret` with the
Client ID and Client secret from S3. Leave `redirectUri` as it is. Then:

```powershell
npm run auth
```

A browser opens on a Spotify page asking you to approve access. A person signs in (with the same account as S3) and
clicks **Agree**. The command waits until then.

**Expected** (in the terminal, after approving):

```
✓ Using existing credentials from secrets/spotify-config.json
...
✓ Tokens written to secrets/spotify-config.json (gitignored)
✓ Scopes granted include user-follow-read
```

The browser tab shows **Authorised** and *You can close this tab and return to the terminal.* `secrets/spotify-config.json` now also contains
`accessToken`, `refreshToken` and `expiresAt`.

**If it differs**

- No browser opens: the terminal printed a long `https://accounts.spotify.com/authorize?...` URL. Open it in a
  browser yourself.
- The terminal asks `Client ID:` instead of saying *Using existing credentials*: the file is missing, or still holds
  the placeholders. Fix the file as above (or type the two values at the prompts).
- The browser shows **Authorisation denied**: the person clicked *Cancel* on Spotify's page. Run `npm run auth`
  again.
- Spotify's page says **INVALID_CLIENT** or *redirect URI mismatch*: the Client ID is wrong, or the redirect URI in
  S3 is not exactly `http://127.0.0.1:8888/callback`.
- `✗ Authentication failed` mentioning port `8888` (*address already in use*): another program uses that port.
  Close it and run `npm run auth` again.

---

## S5 — MusicBrainz contact

**Purpose**: the app looks up record labels on MusicBrainz, whose policy requires every app to say how to reach its
operator. **The app refuses to start without this file**, so it is created before the first start.

**Commands**

```powershell
# Windows
Copy-Item secrets\musicbrainz.example.json secrets\musicbrainz.json
```

```bash
# Linux
cp secrets/musicbrainz.example.json secrets/musicbrainz.json
```

Edit `secrets/musicbrainz.json` and replace `you@example.com` with **your own** email address, or another way to
reach you, such as a URL. Leave the other fields as they are.

**Expected**: `secrets/musicbrainz.json` exists, and its `"contact"` is your address. It is no longer
`you@example.com`.

**If it differs**: if the copy fails with *cannot find path*, you are not in the `spotify-companion` folder (S2).

---

## S6 — Rules file and data folders

**Purpose**: create your (empty) rules file and the folders the app writes to, owned by you.

**Commands**

```powershell
npm run rules:init
```

```powershell
# Windows
New-Item -ItemType Directory -Force data, state | Out-Null
```

```bash
# Linux (not yet walked)
mkdir -p data state
id -u
```

**Expected**

- `npm run rules:init` prints `Created config/rules.json from the example.` and says the file contains no rules
  and nothing will be skipped.
- The folders `data` and `state` exist.
- *Linux*: `id -u` prints `1000`.

**If it differs**

- `config/rules.json already exists — leaving it alone.`: it was created before. That is fine.
- *Linux*: `id -u` prints something other than `1000`. The app inside the container runs as user id 1000 and must
  be able to write `config`, `state` and `secrets/musicbrainz.json`. Run
  `sudo chown -R 1000:1000 config state secrets/musicbrainz.json`. *(Not yet walked; to be confirmed on Linux.)*

---

## S7 — Build and start

**Purpose**: build the app's container image from this source on your machine, and start it. No pre-built image is
published, so every install builds its own.

**Commands**

First check the two secrets are **files**, not folders. If either was missing when the container started, Docker
creates a **folder** in its place:

```powershell
# Windows
Get-Item secrets\spotify-config.json, secrets\musicbrainz.json | Select-Object Name, Mode
```

```bash
# Linux
ls -ld secrets/spotify-config.json secrets/musicbrainz.json
```

Then build and start. The first build takes several minutes:

```powershell
docker compose up -d --build
```

Wait about a minute, then:

```powershell
docker inspect -f "{{.State.Health.Status}}" spotify-now-playing
```

**Expected**

- Both secrets are files: the `Mode` begins with `-a` on Windows, or the line begins with `-` on Linux. Neither is a
  `d` (folder).
- `docker compose up` ends with lines saying the container `spotify-now-playing` is **Started**, with no error.
- `docker inspect` prints **`healthy`**.

**If it differs**

- A secret shows as a **folder** (`d`): delete that folder (`Remove-Item -Recurse secrets\<name>` /
  `rm -r secrets/<name>`), redo S4 or S5 to create the file, run `docker compose down`, then repeat this step.
- `docker inspect` prints `starting`: wait 30 seconds and run it again.
- It prints `unhealthy`, or the container keeps restarting: run `docker logs spotify-now-playing`. A line naming
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

```powershell
curl.exe -s http://localhost:3010/api/health
```

*(Windows: type `curl.exe`, not `curl`. In Windows PowerShell, `curl` is a different command.)*

Then **play music on Spotify**, on any device signed in to the same account (phone, desktop app, web player), and
run:

```powershell
curl.exe -s http://localhost:3010/api/now-playing
```

Open <http://localhost:3010> in a browser on this machine.

Finally, note the current time. **Let one track play to its end** (or skip to the next one), then run:

```powershell
curl.exe -s http://localhost:3010/api/history/recent
```

**Expected**

- `/api/health` prints `{"status":"ok","mcp":"connected","toolCount":` followed by a number and `}`.
- `/api/now-playing` (while music plays) prints JSON containing `"isPlaying":true` and `"track":"<the title you are
  hearing>"`.
- The page shows the track that is playing. In the status bar at the top, the **Spotify** indicator is **●** (ok)
  and hovering it shows *The last poll succeeded.* The same bar reads **Automation off**.
- `/api/history/recent` lists plays newest first. The **first** entry has the `title` of the track you just let
  finish, and a `startedAt` (UTC) **after** the time you noted.

**If it differs**

- `/api/health` prints `"status":"degraded"`: the app is running but its Spotify connection is not.
  `docker logs spotify-now-playing` names the cause. Usually S4 is incomplete; redo it, then
  `docker compose restart`.
- Connection refused: the container is not running (S7), or you are using the wrong port.
- `/api/now-playing` shows `"isPlaying":false` while music plays: the music is playing on a **different Spotify
  account** from the one used in S3/S4.
- The Spotify indicator is **✕**: hover it. The text says what Spotify answered. A credentials message means S4.
- `/api/history/recent` has entries but **none after your noted time**: on first start the app imports your last
  ~50 plays from Spotify. Those are older, so they do not prove anything. Let another track finish and check again.
  A play is recorded when the track **ends**, not when it starts.

---

## S9 — *(optional)* Bring your history from another install

**Purpose**: move the play history of another install of this app into this one.

**Commands**: in the **old** install, open **Settings → Create backup** and save the file. In **this** install, open
**Settings → Restore backup**, choose that file, and follow the prompts (it verifies the file first and asks you to
type a confirmation word).

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

**Expected**: the JSON begins `{"enabled":false,`. In the page, the status bar shows automation **off**.

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
- **Remove**: `docker compose down`, then delete the folder. ⚠️ `data/` holds your play history and **nothing can
  recreate it**. Keep a backup if you may want it.
