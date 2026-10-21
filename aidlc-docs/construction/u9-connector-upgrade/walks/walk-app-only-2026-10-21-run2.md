# App-only walk ② — 2026-10-21 — NOT PASSED (BR-62.3); its gaps fixed by the document split

| | |
|---|---|
| Walker | A fresh Claude Code session on **Machine 1** (the walk VM), from `clean` |
| Image | `ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.6` (digest `sha256:a4891f26…`) |
| Documents | `README.md` (*App only*), `docs/INSTALL.md`, `docs/claude-start.md` from `main` **before** the split (PR #12) |
| Files read | Only those three (transcript checked; reviewed outside the repository, not committed) |
| Log | The agent's own `install-log.md` below: **kept this time**, from `claude-start.md`'s rule. Secret-pattern check: clean |

**Outcome**: installed, signed in, healthy, a play recorded after start, automation off. Walk ①'s **F1** (version) and
**F3** (setup's *Expected*) now match as written.

**Not passed**, seven gaps (the log's summary). How each is dealt with, in `docs/INSTALL-APP.md` (PR #12):

| # | Gap | Fix |
|---|---|---|
| 1 | `docker version` needed **two** one-minute waits on first start | Both install documents: retry once a minute for up to about three minutes; both error texts named |
| 2 | S1's box lists Node.js and Git | A1's own box: Rancher Desktop only |
| 3 | S3's box says "Keep both for S4" | A4: "for A6" |
| 4 | Step 3 had no check | A5's check |
| 5 | Step 5 did not say to run it in the install folder | A6: "go to your folder from A3", with an example |
| 6 | Step 6 had no command checks; the first-start import of earlier plays not warned | A7 and A8's checks; A7 warns that about 50 earlier plays are imported, so only a track that ends after start proves recording |
| 7 | README said "No published image" | README corrected |

Next: the re-walk of `docs/INSTALL-APP.md` on `1.0.0-beta.7`.

---

## The agent's install log, as written

### Install log — App only

Started 2026-10-21. Route: `README.md` *App only*, using `INSTALL.md` S1 (Rancher Desktop parts) and S3, per
`claude-start.md`. Platform: Windows 11 Pro 10.0.26200, PowerShell 5.1.

## Pre-read observations

- `README.md` *What it is not* says **"No published image. You build your own from this source"**, while the *App
  only* section of the same file pulls a prebuilt image from `ghcr.io`. The two contradict each other. (Not a step;
  noted as a documentation gap.)

## S1 (Rancher Desktop parts) — initial checks

Commands (PATH refreshed first, per INSTALL.md agent rule 6):

```
wsl --status
docker version
rdctl list-settings | ConvertFrom-Json | ForEach-Object { ... }
```

Observed:

- `wsl --status`: *The Windows Subsystem for Linux is not installed.* (exit code 50; output came through as
  UTF-16 with spaces between letters in the agent's shell)
- `docker`: *not recognized*
- `rdctl`: *not recognized*

Result: nothing installed yet, as expected on a clean machine. Handing the person the S1 👤 box (App only: steps 1,
2, 4 `SUSE.RancherDesktop` line only, 5, 6).

Deviation: the 👤 box itself lists the Node.js and Git `winget` lines; for App only, the agent added a note after the
box telling the person to run only the Rancher Desktop line. The box has no App-only variant.

## S1 (Rancher Desktop parts) — checks after the person's "S1 done"

Commands: same as above (PATH refreshed).

Observed:

- `wsl --status`: `Default Distribution: rancher-desktop`, `Default Version: 2`, plus the *WSL1 is not supported…*
  line. Matches.
- `rdctl` line: `engine=moby kubernetes=False`. Matches.
- `docker version`, 1st run: `Client:` section (29.6.2-rd), then *failed to connect to the docker API at
  npipe:////./pipe/docker_engine … The system cannot find the file specified.*
- Waited 60 s (as *If it differs* says). 2nd run: `Client:` then *Error response from daemon: failed to connect to
  the backend: timed out dialing Hyper-V socket*.
- Waited 60 s again. 3rd run: `Client:` and `Server:` (Engine 29.5.3), no error. Matches.

Matched *Expected* as written: **No** on first check; matched after two waits, which *If it differs* covers
("wait a minute, and run `docker version` again"). It took two waits, not one. Note: the person reported done
before Rancher Desktop had finished starting, although the box's step 6 says to wait for it.

## README App only, step 1 — Log in to the registry

Done by the person (needs a token typed in). Agent gave the command `docker login ghcr.io -u <user>` and the token
requirements from README's *You need*. Person reported "logged in". Agent did not see the output; the pull in step 2
succeeding confirms the login worked.

Matched as written: yes (as far as observable).

## README App only, step 2 — Set up a folder

Install folder: `C:\spotify-companion` (new, empty; checked `Test-Path` → `False` first). Agent's choice; README
says only "a new, empty folder", and claude-start.md says not this one.

Commands:

```
New-Item -ItemType Directory C:\spotify-companion
cd C:\spotify-companion
docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.6 setup
```

Observed: image pulled (digest `sha256:a4891f26…cdec9`), then
`✓ setup wrote: compose.yaml, secrets/app/musicbrainz.json, config/rules.json (and empty data/, state/)` and
`Next: put your contact address in secrets/app/musicbrainz.json, then run the sign-in (README, App only).`
Exit 0. Folder now holds exactly those files and the empty `data`, `state` folders.

Matched as written: **yes**.

## README App only, step 3 — Your contact address

Done by the person in a text editor. README gives no check, so the agent borrowed INSTALL.md S5's check (value not
printed):

```
(Get-Content C:\spotify-companion\secrets\app\musicbrainz.json -Raw | ConvertFrom-Json).contact -notin @('', 'you@example.com')
```

Observed: `True`.

Matched as written: yes. Gap: README step 3 has no *Expected* or check of its own; the agent used S5's.

## README App only, step 4 — Your Spotify app (INSTALL.md S3)

S3 👤 box shown word for word. Person reported done (values not shared). No commands.

Matched as written: yes. Note: the S3 box says "Keep both for S4", but App only has no S4; the values are typed into
README step 5. The agent added a one-line note after the box to say so.

## README App only, step 5 — Sign in to Spotify

Done by the person (Client ID and secret typed in, plus browser approval). Agent gave the command from README:
`docker run --rm -it -v "${PWD}:/work" -p 127.0.0.1:8888:8888 ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.6 auth`,
run from `C:\spotify-companion`.

Person confirmed seeing `✓ Tokens written to /work/secrets/app/spotify-config.json`. Agent checked, without
printing values, that the file exists and has the fields `clientId, clientSecret, redirectUri, accessToken,
refreshToken, expiresAt`, with `refreshToken` set.

Matched as written: yes. Minor gap: README's command relies on `${PWD}` being the install folder, but step 5 does
not say "in that folder"; the agent added `cd C:\spotify-companion`.

## README App only, step 6 — Start it

Commands (in `C:\spotify-companion`):

```
docker compose up -d
# after ~45 s, checks borrowed from INSTALL.md S7, S8 step 1 and S10:
docker inspect -f "{{.State.Health.Status}}" spotify-companion
curl.exe -s http://localhost:3010/api/health
curl.exe -s http://localhost:3010/api/automation
```

Observed:

- `compose up`: network and container `spotify-companion` Created, then **Started**. Exit 0.
- Health: `healthy`.
- `/api/health`: `{"status":"ok","mcp":"connected","toolCount":31}`.
- `/api/automation`: begins `{"enabled":false,` (label *Turn automation on*, *Nothing will be skipped.*).

Agent side matched. README step 6's *Expected* (indicator **ok**, a played track appears in history) needs the
person: waiting on them. Gap: README step 6 gives no command-line checks; the agent borrowed INSTALL.md's.

Person's check: music playing, page opened at `http://localhost:3010`; person reported "looks good".

Further agent checks (borrowed from INSTALL.md S8 steps 3–4):

- `/api/now-playing`: `"isPlaying":true`, `"track":"Vampire By Rumor"`, artist TX2. Enrichment shows
  `genresUnavailableReason: "Spotify no longer returns artist genres in Development Mode"`, which INSTALL.md S3 says
  is expected.
- Container `StartedAt`: `2026-10-21T15:15:35Z`.
- `/api/history/recent` (first look): ids 2–51; ids 2–50 are the first-start import of ~50 earlier plays (S8 notes
  these prove nothing). Waited ~100 s for the current track to end, then checked again: new entry id 52 *Vampire By
  Rumor* (TX2), `startedAt 2026-10-21T15:15:49Z`, after the container start. A play was recorded.

Matched as written: **yes**.

## Summary

App only install complete: `C:\spotify-companion`, image `1.0.0-beta.6`, healthy, Spotify connected, plays
recorded, automation off.

Steps that did **not** match as written, or that needed the agent to fill a gap:

1. **S1 `docker version`**: failed twice (*pipe … cannot find the file*, then *timed out dialing Hyper-V socket*)
   before it passed. *If it differs* covers this, but says to wait one minute; it took two.
2. **S1 👤 box**: it has no App-only variant, so it lists Node.js and Git installs that App only doesn't need. The
   agent added a note to skip them.
3. **S3 box**: says "Keep both for S4"; App only has no S4 (the values go into README step 5).
4. **README step 3**: no *Expected* and no check. The agent used S5's check.
5. **README step 5**: doesn't say to run it in the install folder (the command depends on `${PWD}`).
6. **README step 6**: no command-line checks, and "a track you play appears in the history" doesn't warn that the
   first-start import already fills the history (S8 does). The agent used S7/S8/S10 checks.
7. **README contradiction**: *What it is not* says "No published image", while *App only* pulls one from ghcr.io.
