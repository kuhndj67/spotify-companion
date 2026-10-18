# U9 Build & Test — Connector Upgrade & Publishable Image

**Started**: 2026-10-18 (owner approved Code Generation) · **Status**: ▶ IN PROGRESS · Order: IN-U9-7, as listed in
[`code-summary.md`](../u9-connector-upgrade/code/code-summary.md) · Branch `u9-build-and-test`

⚠️ Nothing deployed yet: live is `spotify-now-playing` on `1.0.0-beta.2` at the old pin.

---

## 1. CI — ✅

PR #3 (Code Generation) merged to `main` with all three checks green (`cc32bf0`).

## 2. Acceptance on `:3011` (BR-70) — ▶ running since 18:26Z

`npm run verify:up -- --candidate --probe-credentials --poll-ms 3000`: the working tree built as
`spotify-companion:candidate`, a REDUCED COPY of the live credentials (IN-U7-3), polling every 3 s, beside the live
deployment. Rotation watch: every 30 s the copy's `refreshToken` is compared with live's (equality only, never
printed), and every change in the copy's token is logged.

| # | Check | Result |
|---|---|---|
| BR-70.1 | A token refresh **lands in the host file** | ✅ 18:26:38Z: the placeholder replaced by a real token, expiry +59.8 min, written by rename through the `./verify-install/secrets` directory mount (the write that is `EBUSY` on a single-file mount). Second refresh: expected ≈ 19:21Z (below) |
| BR-70.2 | **Negative control** | ✅ The patched connector's own `saveSpotifyConfig` in the candidate image: single-file mount → **`EBUSY`**, host file unchanged; directory mount → saved, host file changed. Fake credentials, throwaway containers |
| BR-70.3 | Now-playing parses a playing track | ⏳ needs the owner to play a track. *Nothing playing* is already parsed and reported healthy (FR-71) |
| BR-70.4 | PBT-66 on the new source | ✅ Code Generation step 2 (≈31 `Error` literals in 5 files, all matching) |
| BR-70.5 | P-U7-1 at the new pin | ✅ The probe credentials ARE P-U7-1's shape (four values, placeholder, `expiresAt: 0`): the first poll refreshed and stored a real token, by rename |
| BR-70.6 | A play recorded end to end | ⏳ needs a played track |
| — | Rotation | ✅ so far: the copy's `refreshToken` equals live's after the refresh |
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

## Still to do (in order)

4. Finish the acceptance (≥ 60 min, a played track), record it, add the entry to `scripts/connector-acceptance.json`.
5. Version `1.0.0-beta.3`.
6. Rehearse the crossing and the rollback on `:3011`; `verify:down`'s no-impact proof.
7. **Live crossing** — owner present, owner's go-ahead.
8. **First tag push** — owner's act → the `publish` job.
9. Token probe → walk guide → agent walk of README *App only*.
