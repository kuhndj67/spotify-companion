# Deployment Architecture — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Infrastructure Design, U6
Companion: [`infrastructure-design.md`](infrastructure-design.md)

---

## 1. The live deployment after U6 — unchanged in shape

```
host 127.0.0.1:3010 ──▶ container spotify-now-playing   (Compose project "spotify", network spotify_default)
                          image spotify-now-playing:0.1.0 → rebuilt as U6 (Node 22.23, npm ci)
                          ./data   → /data   :rw   history.db(+wal,shm) · previous/ · restore-pending/ · .work/   ← U6 dirs, same mount
                          ./config → /config :ro   rules.json  (read into a backup; never written)
                          ./state  → /state  :rw   automation-state.json  (never read or written by U6)
                          ./secrets/spotify-config.json  :rw   (never read or written by U6)
                          ./secrets/musicbrainz.json     :ro
                          restart: unless-stopped  ──  exit(0) after staging a restore ⇒ Docker restarts it (probed)
```

Rollback image kept beside it: `spotify-now-playing:u5-rollback` (IN-U6-4).

---

## 2. The verification installation — side by side, and isolated

```
host 127.0.0.1:3010 ──▶ spotify-now-playing           project "spotify"          ./data ./config ./state ./secrets
host 127.0.0.1:3011 ──▶ spotify-now-playing-verify    project "spotify-verify"   ./verify-install/{data,state,config,secrets}
                         same image TAG (referenced, never built or re-tagged)
                         network spotify-verify_default
```

### 2.1 The isolation contract *(user requirement, 2026-10-07)*

> *"…cleanly installed for the test and then cleanly removed without impacting the primary deployment at all
> (either the deployment or the project artifacts that enable it)."*

| | Verification installation | Why |
|---|---|---|
| Compose file | `compose.verify.yaml`, **standalone** — never `-f compose.yaml -f compose.verify.yaml` | Merging would pull in the live service definition |
| Project name | Top-level **`name: spotify-verify`** | ⚠️ **Measured**: the live project is `spotify`, from the directory name. Without `name:` the verify file would **share it**, and its `down` could act on the live project |
| Container / network | `spotify-now-playing-verify` · `spotify-verify_default` | Distinct names; removed by its own `down` |
| Image | `image:` the live tag, **no `build:`** | Can never rebuild or re-tag the live image. Removal **never** uses `--rmi` |
| Port | `127.0.0.1:3011` (measured free) | Loopback only, like the live app |
| State | **One** directory, `verify-install/` (gitignored): `data/` (empty at start), `state/` (empty ⇒ automation off), `config/rules.json` (from the committed template), `secrets/spotify-config.json` (**placeholder** from `secrets/spotify-config.example.json`) | Removal is deleting one directory |
| Spotify | ⚠️ **No credentials** | Designs out a possible refresh-token rotation invalidating the live token (unverified, so not tested); no Spotify calls, so no doubled poll (U9-b does not arise) |
| Environment | `LABELS_ENABLED=false` · `SNAPSHOTS_ENABLED=false` · `SKIP_EXECUTOR_ENABLED=false` · `POLL_INTERVAL_MS=3600000` | No MusicBrainz traffic, no snapshot writes, **cannot skip a track** |

**Never touched**: `compose.yaml` · `Dockerfile` · `data/` · `state/` · `config/` · `secrets/` (beyond reading
the example template) · the live container · `spotify_default` · any image tag.

### 2.2 `npm run verify:up`

1. **Refuse** unless `docker compose -f compose.verify.yaml config` resolves the project name to
   `spotify-verify`, and unless `verify-install/` does not already exist (no stale half-install).
2. **Record the live baseline** to `verify-install/baseline.json`: container id, `StartedAt`, `RestartCount`,
   image id, health status, and the list of tracked files `git status --porcelain` reports (normally empty).
3. Create `verify-install/` from the templates above; `docker compose -f compose.verify.yaml up -d`.
4. Wait for health; print `http://localhost:3011`.

### 2.3 The test itself (Build & Test)

1. ⚠️ **First**: the copy **starts without Spotify** and serves the UI (NFR-13). If not, stop — a U6 defect.
2. Live app (3010): *Create backup* → archive downloaded.
3. Copy (3011): *Restore backup* with that archive → comparison panel → `RESTORE` → restart → counts and sha256
   match the manifest; `integrity_check: ok`; automation **off**.
4. Copy: *Undo last restore* → back to the empty database; undo again → restored again (BR-49.3).
5. Copy: *Create backup* → the archive verifies (round trip in the other direction).
6. Measure the copy's real restart time (P-47).

### 2.4 `npm run verify:down`

1. **Refuse** unless the project name resolves to `spotify-verify`.
2. `docker compose -f compose.verify.yaml down` — **no `--rmi`, no `--volumes` needed** (bind mounts only).
3. Delete `verify-install/`.
4. **Prove no impact**: the live container's id, `StartedAt`, `RestartCount`, image id and health equal the
   baseline; **no** container, network or directory matching `*verify*` remains; `git status --porcelain` shows
   no tracked file changed relative to the baseline. Any difference **fails loudly** and names it.

⚠️ The baseline lives inside `verify-install/` and is read **before** that directory is deleted.

### 2.5 Permanent project changes U6 makes for this (committed once)

`compose.verify.yaml` · `verify:up` / `verify:down` in `package.json` (+ their script) · `verify-install/` in
`.gitignore`. Nothing in the live deployment's files changes.

---

## 3. The NAS — not in U6

The cross-machine restore is **U9's** exit criterion (P-48): the real corpus restored on `SYNNAS` through
*Restore backup*, once NFR-29 lets a browser on another machine reach the app.
