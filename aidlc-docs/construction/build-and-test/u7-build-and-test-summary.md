# U7 Build & Test Summary — Configuration Management

**Date**: 2026-10-09 (UTC) · **Status**: ✅ deployed and verified — awaiting approval
**Deployment**: the IN-U7 steps in order ([`infrastructure-design.md`](../u7-configuration-management/infrastructure-design/infrastructure-design.md)).
`npm run verify` green — **1565 tests**, typecheck, smoke, knip. Schema **v7**.

## 1. Deployment

| Step | Result |
|---|---|
| IN-U7-4 rollback tag | `spotify-now-playing:u6-rollback` = the U6 image (`9a2a8e287d84`) |
| IN-U7-5 safety copies | In-app backup taken from the live app (2.0 MB; entries `manifest.json`, `history.db`, `rules.json`) — **verified restorable by the developer verifier: 1093 plays, all checks**. Host copies of `config/rules.json` and `secrets/musicbrainz.json` in `data/before-u7-20261009T012805Z/`. `spotify-config.json` deliberately not copied (FR-60) |
| Build | exit **0**, checked directly |
| ⭐ Extra: the BUILT image's MCP error texts | **30** error templates in the image's compiled code — **all match** BR-58.1's pattern; no non-error text starts with `Error`. ⚠️ **Corrected 2026-10-09**: this first said the image *"fetched `main` today"* and that 30 vs the local 25 was upstream drift. **Wrong** — `compose.yaml` pins the server (`7b5fde63`, R7) and the local checkout is that same commit; 30 vs 25 is compiled JS vs TypeScript source counted by two different patterns |
| Deploy | healthy ~10 s after `up`; `/api/health` ok; UI 200 |
| Diagnostics (IN-U7-6) | `config/`, `spotify-config.json`, `musicbrainz.json` all **writable through the container**; polls three-way (`0 / 5 / 0`, idle share 100%) |
| Guards | all four new POSTs **403** without the ingest header and cross-site; WebSocket **101** local, **403** cross-site |

## 2. Exit tests

| Exit criterion | Where | Result |
|---|---|---|
| ⚠️ Broken credentials show **RED** — the exact case U6's copy showed green | `:3011`, placeholder config | ✅ `/api/now-playing` **502** *"Spotify returned an error: … Failed to get access token."*; counted as an **error** poll, idle share *unknown*; status bar **red ✗ Spotify** with the reason (screenshot) |
| Rules changed through the app; watcher reloads; Undo restores | `:3011`, real `:rw` bind mount | ✅ upload → **version 2**, no restart; **host and container see identical content** (temp-then-rename through `/config` — verified for `/state` before, now for `/config`); `rules.previous.json` kept, no temp left; undo restored the rule |
| ⚠️ Valid-but-empty upload refused without the word; stale base refused | `:3011` | ✅ *"This removes 1 of your 1 rules."* → confirm without `REPLACE` **400**, file unchanged; with it applied. Stale base → *"Your rules changed since you downloaded them…"* |
| Credentials replaced through the app, recording continuing | `:3011` (fake) and **live** (your own values re-saved) | ✅ copy: written **in place** (container inode unchanged), response holds no secret, **2.4 s** (the awaited child exit), next poll **red** with Spotify's `invalid_client`. ✅ **live**: same four values re-saved → file held the placeholder → **1 s later** a real token (60 min), refresh token unchanged, `replacedAt` survived the MCP server's own rewrite (F4 live), now-playing **200 ok**. 4.2 s |
| MusicBrainz contact | **live** (same value re-saved) | ✅ in place; `appName`/`appVersion` preserved; container sees the same file |
| Restore with rules — opted in | `:3011`, the live backup | ✅ 1093 plays restored, copy's rules **byte-match** the backup's, after-restart message states the rules outcome and the right undo; back in **3.9 s** (U6: 3.8 s) |
| Restore — opted out (default) | `:3011` | ✅ the copy's own rule `keep-me` survived; message does not mention rules |
| `localGuard.test.ts` unchanged; every new route behind `ingestGuard` | suite + live curl | ✅ |
| IN-U7-4 rollback | U6 image on a copy with U7's leftovers (`rules.previous.json`, a stray `.rules.json.tmp`, a ready pending restore with `applyRules: true`) | ✅ starts, UI 200, applies the history restore, **ignores the rules opt-in** (`rules.json` md5 unchanged), ignores the extra files; `integrity_check: ok`, 1093 plays, v7 |
| `verify:down` no-impact proof | | ✅ live container unchanged (same start, 0 restarts, image, health); no verify container/network/directory. ⚠️ It flagged *"tracked files changed"* — my own wording fixes made during the test (below), not the copy |

## 3. Clicked and LOOKED AT (U6's lesson) — Chrome on `:3011`

- Status bar red ✗ Spotify with the reason · Settings: Spotify status *"Set · client abcd…2345 · replaced …"*, guidance, masked secret fields, **disabled Save… visibly dim** with *"Fill in all four fields to save."*, the BR-56.6 warning with **Replace credentials** · MusicBrainz restart note.
- Rules pop-up: *Rules file* section; an **empty file uploaded through the page** → *"1 removed: Keep me"*, **both** `REPLACE` reasons, **Apply visibly disabled** (opacity 0.45).
- Restore dialog: opt-in **unticked**; ticking shows the comparison with the **"will be able to skip tracks once automation is on"** warning first, Removed/Added; **Restore visibly disabled** until the word.
- No console errors from the app.

## 4. Defects found in Build & Test — fixed and redeployed

1. **The Spotify indicator read *"Spotify is not answering: Spotify returned an error: …"*** — doubled, and wrong (Spotify answered and refused). A refusal is now stated once; a transport failure keeps *"not answering"*. Two tests.
2. **The guidance showed literal backticks** around `npm run auth` (the text is not Markdown). Plain quotes.

Both found only by looking — every test passed with them. Redeployed (build exit 0, healthy).

## 5. Test-harness mistake, recorded so it is not mistaken for a defect

The first browser restore showed *"Upload failed: TypeError: Failed to fetch"*. **My error**: I gave Chrome a path built from the backup's *download* timestamp (`…012808Z`), not the folder's (`…012805Z`) — the file did not exist. With the real file the dialog rendered correctly. The app's message for an unreadable file was accurate.

## 6. Not done here

- The fixed indicator wording was verified by tests, not re-screenshotted (the live Spotify is healthy, so the red state cannot be shown without breaking it).
- `data/before-u7-20261009T012805Z/extracted/` holds an expanded copy of the backup — redundant with the archive beside it; left for you to delete or keep.
