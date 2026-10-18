# U9 Build & Test — Connector Upgrade & Publishable Image

**Started**: 2026-10-18 (owner approved Code Generation) · **Status**: ▶ IN PROGRESS — ✅ `1.0.0-beta.3` LIVE since 2026-10-18 19:45Z · Order: IN-U9-7, as listed in
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

## Still to do (in order)

8. **First tag push** — owner's act → the `publish` job.
9. Token probe → walk guide → agent walk of README *App only*.
