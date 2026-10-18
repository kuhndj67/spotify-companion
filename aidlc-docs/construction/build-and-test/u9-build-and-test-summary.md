# U9 Build & Test — Connector Upgrade & Publishable Image

**Started**: 2026-10-18 (owner approved Code Generation) · **Status**: ▶ IN PROGRESS — ✅ `1.0.0-beta.5` LIVE and PUBLISHED (2026-10-18 23:53Z); the App-only walk remains · Order: IN-U9-7, as listed in
[`code-summary.md`](../u9-connector-upgrade/code/code-summary.md) · Branch `u9-build-and-test`

✅ Live is `spotify-companion` `1.0.0-beta.3` at the MIT pin (from 19:45Z); `spotify-now-playing` `1.0.0-beta.2` stopped and kept for rollback.

---

## 1. CI — ✅

PR #3 (Code Generation) merged to `main` with all three checks green (`cc32bf0`).

## 2. Acceptance on `:3011` (BR-70) — ✅ PASSED (18:26Z → 19:37Z, 70 minutes)

`npm run verify:up -- --candidate --probe-credentials --poll-ms 3000`: the working tree built as
`spotify-companion:candidate`, a REDUCED COPY of the live credentials (IN-U7-3), polling every 3 s, beside the live
deployment. Rotation watch: every 30 s the copy's `refreshToken` is compared with live's (equality only, never
printed), and every change in the copy's token is logged.

| # | Check | Result |
|---|---|---|
| BR-70.1 | A token refresh **lands in the host file** | ✅ 18:26:38Z: the placeholder replaced by a real token, expiry +59.8 min, written by rename through the `./verify-install/secrets` directory mount (the write that is `EBUSY` on a single-file mount). **Second refresh 19:21:41Z**, exactly as predicted (55 min, inside the 5-minute buffer, triggered by a poll): new token in the host file, expiry +59.8 min |
| BR-70.2 | **Negative control** | ✅ The patched connector's own `saveSpotifyConfig` in the candidate image: single-file mount → **`EBUSY`**, host file unchanged; directory mount → saved, host file changed. Fake credentials, throwaway containers |
| BR-70.3 | Now-playing parses a playing track | ✅ 18:3xZ, owner playing: *"Voices In My Head"*, Falling In Reverse, *Popular Monster*, progress 95 s / 191 s, track id, device: every field parsed, and the same as the live install's. *Nothing playing* also parsed and reported healthy (FR-71) |
| BR-70.4 | PBT-66 on the new source | ✅ Code Generation step 2 (≈31 `Error` literals in 5 files, all matching) |
| BR-70.5 | P-U7-1 at the new pin | ✅ The probe credentials ARE P-U7-1's shape (four values, placeholder, `expiresAt: 0`): the first poll refreshed and stored a real token, by rename |
| BR-70.6 | A play recorded end to end | ✅ Recorded by **both** installs with provenance `live`: *"Rollin' (Air Raid Vehicle)"* `skipped` (starts 0.6 s apart, ends 2.3 s apart) and *"Voices In My Head"* `completed` (ends 0.6 s apart). `:3011` also backfilled the day's earlier plays from Spotify at start (provenance `backfilled`), as designed. ⚠️ A first read that "Voices" was missing was mine: it was still playing (plays are written when they end) |
| — | Rotation | ✅ the copy's `refreshToken` **equals live's after both refreshes** (watched every 30 s for 70 min; never printed). Live stayed healthy, same container start |
| — | Agreement with live | ✅ over the window both installs recorded the **same 18 plays with identical outcomes** (1 skipped, 17 completed); neither degraded |
| — | MCP v2 | ✅ 31 tools; `getNowPlaying` answers through the v2 server on Node 22.23 |

⚠️ **Correction to BR-70.1's wording, measured from upstream's source**: the second refresh is NOT the 45-minute timer.
`createSpotifyApi` refreshes only within **5 minutes of expiry**, and every now-playing poll goes through it, so the
second refresh comes at ≈ 55 minutes, triggered by a poll. The 45-minute timer finds a valid token and does nothing.
So the run is **≥ 60 minutes**, not 50.

## 3. The startup check in a real container (P-68) — ✅, with one defect found and fixed

The candidate image started with the **1.0.0-beta.2 compose layout** (single-file mount at
`/opt/spotify-mcp/spotify-config.json`, the old `SPOTIFY_CONFIG_PATH`): the app **started**, the Spotify indicator
showed the reason, diagnostics reported `fail — single-file`. ✅

🔴 **Defect found**: the message said *"mount ./secrets as a directory at **/opt/spotify-mcp**"*, which is wrong. It
named the folder of the *configured* path, and an old compose file configures the old path. **Fixed**
(`src/server.ts`): it names the expected mount point, `/app/secrets`. Seen in a rebuilt image: *"… at /app/secrets"*.

**Recorded**: `scripts/connector-acceptance.json`, pin `6065ce5c…`, `pass`, pointing at this record. `npm run release`
now accepts the moved pin (P-74).

## 4. Version — ✅

`1.0.0-beta.3` in `package.json` and the three compose files (`versionSources` green), its own commit.

**Seen in passing, not U9's**: the live (old-code) log shows `MaxListenersExceededWarning: 11 error listeners added to
[ServerResponse]`. Not investigated here; noted for the backlog.

## 5. Crossing and rollback rehearsed (BR-71.3/71.4) — ✅

After `npm run verify:down` (no-impact proof ✅: same live container, start time, restart count, image, health; no
`*verify*` left; the credential copy gone). In a throwaway folder on the verification project and port, with the
owner's **verified backup** (2026-10-18) as the database:

| Stage | Health | Plays | Credentials directory |
|---|---|---|---|
| 1. Old layout: `v1.0.0-beta.2` compose, image `spotify-now-playing:1.0.0-beta.2`, single-file mounts | healthy | 1430 | (pre-U9 code has no such check) |
| 2. Crossing as INSTALL says: `down` with the OLD file, then `up` with the new (candidate image, `./secrets` directory) | healthy | 1430 | `ok` |
| 3. Rollback: `down` with the new file, `up` with the old file and image; **no file moved** | healthy | 1430 | (pre-U9) |

No old container left behind at the crossing; folder removed; **live unchanged** (id, start time, image compared before
and after). The release image is NOT built here: `spotify-companion:1.0.0-beta.3` is built only by the release
(BR-66.7); the rehearsal used `spotify-companion:candidate`, since removed.

## 6. Live crossing — ✅ 2026-10-18, `1.0.0-beta.3` LIVE

Owner merged PRs #4 and #5, then gave the go-ahead. From `main` (`2f626f7`), clean tree:

1. `npm run release -- --apply` **with `spotify-now-playing` running** → `verify` passed (1700 tests), then
   **REFUSED: `old-container-running`**. No tag, live untouched. The crossing guard (BR-71.2, PBT-77) seen working on
   the real deployment.
2. `docker stop spotify-now-playing` (19:45:18Z), **kept** with its image `1.0.0-beta.2` for rollback.
3. `npm run release -- --apply` → built `spotify-companion:1.0.0-beta.3`, deployed, healthy, **tagged
   `v1.0.0-beta.3` locally** (not pushed). Polling gap ≈ 19:45:18Z–19:45:42Z.
4. Checks on the live app: version `1.0.0-beta.3`, schema v7 · **credentials directory `ok`** · token acquired · MCP
   v2, 31 tools · now-playing parsed while playing · **1453 plays**, not degraded · first play recorded by the new
   container: *"The Diary of Jane"*, `live`, `completed`, 19:45:42Z → 19:48:21Z.

As expected for a restart mid-track, that song is split in two rows: the old container's first 12 s (`unknown`,
19:45:04–19:45:16) and the new container's remainder (`completed`). Diagnostics still shows *"Snapshots: scheduled;
none written yet"*: the known false green, U10's FR-80.

**Still to see on the live install**: its first token refresh through the new directory mount, due ≈ 20:24Z (the live
file was last written 19:29:34Z by the old connector).

## 7. First tag push — ❌ publish failed, nothing published; fixed → `1.0.0-beta.4`

Owner: *"You go ahead and run."* `git push origin v1.0.0-beta.3` (tag → `2f626f7`, `main`). The tag run: **test,
container, secret scan ✅; `publish` ❌ at its first step, *Decide***. Nothing was built for, or pushed to, the registry.

**Cause (mine)**: the step mounted `scripts/lib` at **`/lib`** in the `node:22.23` container. `/lib` is Debian's
system library folder; covering it removes the C library and the program loader, so the container cannot start any
program: `exec /usr/local/bin/docker-entrypoint.sh: no such file or directory`. The local test of the decision had
used a different mount point, so it could not see this. **Reproduced locally** (same message), **fixed** (`/publish`),
and **guarded**: `test/structure.u9.test.ts` refuses any workflow `-v` onto a system folder, seen to catch the old
`ci.yml`.

**The rest of the job, exercised before the next tag** (so it does not take a third version): `check-image.sh` run
**on Linux** (Debian container, Docker socket) against a local build: licences, no user data, build facts, **Trivy
v0.75.0 downloaded, checksum verified, scan reported**, summary written, exit 0. Untested until the next tag: the
registry login and push (they need the job's own token).

**Scan, report only** (the owner's posture): 64 HIGH/CRITICAL findings in the Debian base, and a few in **npm's own
bundled dependencies** (e.g. `picomatch`, `sigstore`), which come with the base image's `npm`, a tool the app never
runs. Removing `npm` from the runtime stage would drop those: a backlog idea, not done.

**Version**: `v1.0.0-beta.3` is a pushed git tag and is never reused (BR-66.7, BR-72.3), so the fix ships as
**`1.0.0-beta.4`**: the same app, a fixed workflow. Live will be redeployed to it by `npm run release`.

## 8. `1.0.0-beta.4` released and ✅ PUBLISHED

Owner merged PR #6. From `main` (`d8f2ce4`): `npm run release -- --apply` → pin `6065ce5c` (unchanged since the last
release, so no acceptance asked), old container not running → `spotify-companion:1.0.0-beta.4` live and healthy,
tagged `v1.0.0-beta.4`. Live after the restart: version `1.0.0-beta.4`, credentials directory `ok`, recording (1459
plays).

`git push origin v1.0.0-beta.4` → run `39161435957`: test ✅ · container ✅ · secret scan ✅ · **publish ✅** (its first
full run). From the job log, all on the image that was pushed:

| Step | Result |
|---|---|
| Decision (LC-64) | `publish 1.0.0-beta.4` (tag = version; the registry did not hold it) |
| Licences (BR-73) | `/app/LICENSE` 35149 bytes (GPL-3.0) · `/opt/spotify-mcp/LICENSE` 1070 bytes (MIT) |
| User data (NFR-28) | none: no credentials, history, rules or automation state |
| Build facts (NFR Q4) | Node `v22.23.3`; base `node@sha256:c3de60bf…` in the labels |
| Scan, report only | 64 in the Debian base (HIGH 60, CRITICAL 4); 11 HIGH in npm's own bundled dependencies |
| Push | `ghcr.io/kuhndj67/spotify-companion:1.0.0-beta.4`; no floating tag |

**Not yet checked**: pulling the image back (needs a `read:packages` token, which this PC's GitHub CLI token does not
have, and the owner's broad token is not put into Docker's login store). Moved to the token probe (IN-U9-6), with the
short-lived read token.

## 9. Token probe (IN-U9-6) and the published image pulled back — ✅

Run by the owner in their own PowerShell (the token never entered the conversation):

| Token | `docker login ghcr.io` | `docker pull …:1.0.0-beta.4` |
|---|---|---|
| **Fine-grained**, repository `spotify-companion` only, read-only | `Login Succeeded` | ❌ **`403 Forbidden`** |
| **Classic**, only `read:packages`, 7 days | `Login Succeeded` | ✅ pulled, digest `sha256:9cf5c083…` |

So **a fine-grained token cannot pull this package**, and the walk and README *App only* use the classic
`read:packages` token (⚠️ it reads every package the account can see; today that is this one). `Login Succeeded` proves
nothing on its own: GHCR checks the permission at the pull. The fine-grained token is revoked.

**The image as published**, checked after the pull with `scripts/check-image.sh`: both licences present (GPL 35149 B,
MIT 1070 B), no user data, and the `revision` label is **`d8f2ce4`** = the commit tagged `v1.0.0-beta.4`. What is in the
registry is what was released. README *App only* now names the classic token and its one scope.

## 10. Live token refresh through the new mount — ✅

At **20:24:34Z** the live connector refreshed the token and wrote `secrets/spotify-config.json` by temp + rename through
the directory mount (the write that is `EBUSY` on the old single-file mount). No temp file left; Spotify, MCP and the
credentials directory `ok`. The last live check of FR-73.

## 11. ⚠️ Found live: the directory mount exposed other credentials → `1.0.0-beta.5`

The same listing showed that `secrets/` also holds **`metabase.json`** (the owner's Metabase reporting credentials).
Mounting the whole folder (FD Q3 = A) made it readable by the app container, which never needs it; the design had
considered only the harmless `*.example.json` templates. A **least-privilege regression**, surfaced to the owner as a
security-posture decision. Owner (question prompt): **"Separate subfolder (Recommended)"**.

**Fix**, as `1.0.0-beta.5` (BR-69.4 amended): the host's **`secrets/app/`** holds the app's two files and is the only
thing mounted (container path still `/app/secrets`); templates and other credentials stay in `secrets/`. Every host
path moved (`npm run auth`, `mcp:setup`, the probes, `verify:up`, INSTALL S4/S5/S7, README *App only*, `setup`).
`npm run release` now **refuses** (`credentials-not-in-place`) until `secrets/app/musicbrainz.json` exists, naming the
move when the files are still in `secrets/` (property-tested with its positive control): without it the app would
start with no MusicBrainz contact, refuse to run, and restart in a loop. INSTALL's upgrade note gives the move for both
platforms. **Seen in a real container** (verification install, candidate image): `/app/secrets` holds only the app's
file; credentials directory `ok`; `verify:down` proved live unchanged.

**Live crossing for beta.5** (owner's go-ahead after merge): `docker compose down` → move the two files → `npm run
release -- --apply` (≈ 2–3 min without polling) → tag push → publish.

## 12. `1.0.0-beta.5` live and published — ✅

Owner: *"go"* (PR #8 merged). From `main` (`d0cd5d8`):
1. `docker compose down` (23:51:57Z). `spotify-metabase` untouched; the stopped `spotify-now-playing` kept.
2. `secrets/spotify-config.json` and `secrets/musicbrainz.json` moved to `secrets/app/`; **contents identical**
   (checksums before and after). `metabase.json` and the templates stay in `secrets/`.
3. `npm run release -- --apply` → `spotify-companion:1.0.0-beta.5` live and healthy, tagged (23:52:48Z; gap under a
   minute).
4. The live container sees **only** `musicbrainz.json` and `spotify-config.json` in `/app/secrets`: least privilege
   restored. Version, token, MCP, MusicBrainz identity, credentials directory all `ok`; 1465 plays.
5. `git push origin v1.0.0-beta.5` → run `39178339707`: all four jobs ✅; decision `publish 1.0.0-beta.5`, both
   licences, no user data, the scan as before (report only).

## Still to do (in order)

11. Agent walk of README *App only* on Machine 1 (the classic token), on `1.0.0-beta.5`.
