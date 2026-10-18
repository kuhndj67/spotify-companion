# U9 Business Logic Model — Connector Upgrade & Publishable Image

**Unit**: U9 (Phase 5) · **Date**: 2026-10-18 · Rules: [`business-rules.md`](business-rules.md) · Entities: [`domain-entities.md`](domain-entities.md)

Five flows. The order matters: **the move is proven before anything is published**, because publishing before
the pin moves would distribute the unlicensed connector (NFR-32), and publishing a connector whose token refresh
fails (G4) would distribute a broken app.

---

## Flow 1 — Building the connector (every build)

1. Fetch upstream at the pinned SHA (BR-68.1).
2. **Patch guard**: count the original `CONFIG_FILE` line; anything but exactly one → **fail the build**.
3. Apply the patch; count the patched line; anything but exactly one → **fail the build** (BR-69.1).
4. Install, build, **run upstream's test suite on Node 22.23**; any failure → **fail the build** (BR-68.3).
   `EBADENGINE` warnings are expected (BR-68.4).
5. Prune to runtime dependencies; copy `build/`, `node_modules/`, `package.json` **and `LICENSE`** to the runtime
   stage (BR-73.1).
6. **Licence check**: both `LICENSE` files present in the runtime image → else **fail** (BR-73.3).

## Flow 2 — Token refresh at run time

```text
connector call ──► needsRefresh? ──no──► use token
                        │yes
                        ▼
              refresh with Spotify ──► write SPOTIFY_CONFIG_PATH
                                        (temp file in /…/secrets/, then rename)  ← directory mount: rename works
                        ▼
              host secrets/spotify-config.json updated; app's WebApiClient reads it (never writes)
```

`SPOTIFY_CONFIG_PATH` reaches the connector only because the app passes it in the spawn's `env` (BR-69.5).
`CredentialsWriter` writes the same file the same way (BR-69.6); after a save the app closes the connector, so the
next poll starts a fresh one (U7 BR-56.5, unchanged; BR-69.7).

## Flow 3 — Acceptance, then the live crossing (once, in U9's Build & Test)

1. Bring up the **verification install** on the new pin and the new names (BR-71.3).
2. Run BR-70.1…70.6, **including the negative control** (BR-70.2); record each (BR-70.7). Any failure → stop; the
   live install is untouched.
3. Rehearse **rollback** to `1.0.0-beta.2` on the verification install (BR-71.4). `verify:down` proves live
   unchanged.
4. Live crossing: `npm run release -- --apply` **refuses** while `spotify-now-playing` runs (BR-71.2) → owner stops
   it → release builds, deploys `spotify-companion`, health-checks, tags.

## Flow 4 — Publishing (each release, after U9's first)

```text
owner pushes v<version> ──► CI: tag == v + package.json? ──no──► fail
                                     │yes
                                     ▼
                         npm run verify + container build (same as main)
                                     ▼
                         build linux/amd64 image from the tagged commit, with OCI labels
                                     ▼
                         image checks: both LICENSEs · no secrets/user data      ──fail──► nothing pushed
                                     ▼
                         <version> already in GHCR? ──yes──► fail (never overwrite)
                                     │no
                                     ▼
                         push ghcr.io/kuhndj67/spotify-companion:<version>  (no floating tag)
```

## Flow 5 — *App only* install (US-32)

1. `docker login ghcr.io` with the read token (the only credential, BR-74.1).
2. **Set up the folder** from the image: writes the image-only `compose.yaml`, `secrets/musicbrainz.json` (from
   the example; the user puts their contact in it), empty `config/`, `data/`, `state/`. Refuses to overwrite
   (BR-74.2).
3. Register a Spotify app (BR-61.4), redirect URI `http://127.0.0.1:<port>/callback` (BR-74.4).
4. **Sign in from the image**: prints the link, the user opens it in their browser, the callback reaches the
   container through the host's `127.0.0.1` only, `secrets/spotify-config.json` is written (BR-74.3).
5. `docker compose up -d` → the positive check: UI responds, Spotify indicator **ok**, a play recorded
   (BR-74.5). Automation is off (BR-74.7).

Every step carries its expected output and what to do if it differs (BR-61.1); the whole is walked cold on
`kuhndjwin11pro` before README's *coming soon* comes off (BR-74.6).

## Error handling summary

| Situation | Behaviour |
|---|---|
| Upstream changed the patched line | Build fails at the guard, naming the line (Flow 1.2) |
| Upstream tests fail on Node 22.23 | Build fails; brought to the owner, never skipped (BR-68.3) |
| Variable not passed to the connector | Refresh writes the fallback path → `EBUSY` or a write the host never sees; caught by BR-70.1, which checks the **host** file |
| Old container still running at release | Release refuses and prints the stop command (BR-71.2) |
| Tag ≠ version, tag already published, licence missing, secret in image | CI fails before pushing (Flow 4) |
| *App only* target folder not empty | Setup refuses and lists the files it would have overwritten (BR-74.2) |
