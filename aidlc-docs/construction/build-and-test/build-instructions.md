# Build Instructions

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Build and Test

---

## Prerequisites

| | |
|---|---|
| **Runtime** | Node.js **≥ 22** (verified on 22.17.0). `node:sqlite` requires it |
| **Container runtime** | Docker Desktop or Rancher Desktop (verified on Docker 29.5.3) |
| **Spotify** | Premium account, app registered in the developer dashboard |
| **Disk** | ~500 MB for `node_modules` and the image; history grows ~0.5–1 GB/year |

### Required environment / files

| Item | Purpose |
|---|---|
| `secrets/spotify-config.json` | Created by `npm run auth`. Never committed |
| `data/` | Created automatically. Holds the history database and snapshots |

All other configuration has working defaults — see `src/config.ts`.

---

## Build steps

### 1. Install dependencies

```bash
npm install
```

### 2. Authenticate (once)

```bash
npm run auth        # host-side OAuth; writes secrets/spotify-config.json
npm run mcp:setup   # only needed to run outside a container
```

### 3. Typecheck and build

```bash
npm run typecheck   # covers src AND test
npm run build       # tsc -> dist/
```

**Expected**: both silent. Any output is a failure.

`npm run typecheck` uses `tsconfig.test.json`, so test files are typechecked too — worth keeping,
since it has already caught type errors the runtime did not.

### 4. Build the container

```bash
docker compose build
```

**Expected**: `Image spotify-now-playing:0.1.0 Built`.

> ⚠️ **Check the exit code, not the last line of output.**
> ```bash
> docker compose build > build.log 2>&1; echo "exit: $?"
> ```
> Piping the build through `tail` or `head` replaces the build's exit status with the pipe's.
> During this stage a failing build reported exit 0 that way and was nearly recorded as a
> success — the failure was only visible in the log text.

---

## U2 — the one extra prerequisite

MusicBrainz policy (NFR-14) requires every request to identify the application and carry a contact
address. **The app will not enable label enrichment without one**, and does not fall back to
anonymous traffic:

```bash
cp secrets/musicbrainz.example.json secrets/musicbrainz.json
# edit "contact" to a real address
```

`secrets/` is gitignored; only the example template is tracked. Without the file the app still
starts and records — it logs an actionable error and runs display-and-record-only. To run without
labels deliberately, set `LABELS_ENABLED=false`.

**Verified 2026-09-01**: both paths. Missing file → clear message, app healthy. Present file →
`Labels: SpotifyNowPlaying/0.1.0 ( … )` at startup.

---

## Build artifacts

| Artifact | Location |
|---|---|
| Compiled app | `dist/` |
| Container image | `spotify-now-playing:0.1.0` |
| Vendored MCP server | inside the image at `/opt/spotify-mcp` |

## Acceptable warnings

| Warning | Why it is expected |
|---|---|
| `ExperimentalWarning: SQLite is an experimental feature` | `node:sqlite` in Node 22. Contained behind `HistoryRepository` (R10) |
| npm audit advisories in the vendored MCP server | Upstream, unpinned dependencies; out of our control |

---

## Troubleshooting

### `git clone ... did not complete successfully: exit code: 128`

**Cause**: `MCP_SERVER_REF` set to a **commit SHA** while the Dockerfile used
`git clone --depth 1 --branch "$REF"`. `--branch` accepts only branch and tag names.

**This happened**: pinning the ref to close R7 broke the build immediately.

**Fix**: already applied — the Dockerfile now uses `git init` + `git fetch --depth 1 origin <ref>`
+ `git checkout FETCH_HEAD`, which works for a SHA, branch or tag alike and keeps the shallow
depth.

### `History: DISABLED — unable to open database file`

**Cause**: the bind-mounted data directory is not writable by the container's runtime user.

**This happened**: the image ran as `node` (uid 1000) while the Windows bind mount arrived
root-owned `755`.

**Fix**: already applied — `scripts/docker-entrypoint.sh` starts as root, `chown`s the mount
points only, then drops to `node` via `setpriv`. Verify with:

```bash
docker exec <container> ls -ldn /data          # expect 1000 1000
docker exec <container> grep ^Uid: /proc/1/status   # expect 1000
```

### `Bind for 0.0.0.0:3000 failed: port is already allocated`

**Cause**: another container or process holds port 3000.

**Fix**: `docker ps --format '{{.Names}} {{.Ports}}'` to find it, or publish elsewhere:
`docker run -p 127.0.0.1:3100:3000 ...`.

### Typecheck fails on `SQLOutputValue`

**Cause**: `node:sqlite` returns `Record<string, SQLOutputValue>`, which does not overlap a
concrete row type.

**Fix**: cast through `unknown` at the single query site, as `SqliteHistoryRepository` does.
