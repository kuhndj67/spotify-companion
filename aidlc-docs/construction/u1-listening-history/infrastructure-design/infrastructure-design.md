# Infrastructure Design — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U1
**Decisions**: Q3 = A (bind mount `./data/`) · Q4 = B (automatic snapshots)

---

## Scope

U1 adds **one** infrastructure concern: a durable location for the database.

No cloud provider is involved. This runs on one laptop under Rancher Desktop, as settled by
Q3 = A in Requirements. The stage exists here to make the storage decision explicit and to close
R7 — not to select managed services.

---

## Logical → infrastructure mapping

| Logical component | Infrastructure | Notes |
|---|---|---|
| LC-1 Embedded database | **File on a bind-mounted host directory** | `./data/history.db` |
| LC-2 Migration runner | In-process, at startup | No infrastructure |
| LC-3 Write buffer | In-process memory | No infrastructure |
| LC-4 Export streamer | Existing HTTP listener | **No new port, no new exposure** |
| LC-5 Snapshot scheduler | In-process timer, writes to the same mount | `./data/snapshots/` |
| LC-6 Purity check | CI and local build | Not deployed |

**Five of six need no infrastructure at all.** That is the honest shape of this stage for a
single-user local tool, and it is why the execution plan marked it narrow.

---

## Storage

### Decision: bind mount `./data/`

```
d:/Software/Spotify/
├── data/                    ← NEW, gitignored
│   ├── history.db           ← SQLite database
│   ├── history.db-wal       ← WAL journal
│   ├── history.db-shm       ← shared memory
│   └── snapshots/           ← FR-56 dated exports
├── secrets/                 ← existing bind mount, same convention
└── ...
```

**Why a bind mount over a named volume.** The data exists to be analysed in external tools. A bind
mount puts the file where the user can open it in a SQLite browser, copy it, or point a notebook
at it — with no `docker cp` and no volume inspection. It also matches how `secrets/` is already
mounted, so the project has one convention rather than two.

Given that the integration decision is download-and-import (§3.5), directness is worth more here
than the tidiness of a managed volume.

### ⚠️ The risk this accepts

The database sits **inside the project tree**. Deleting or re-cloning the repository destroys the
one artefact in this project that cannot be regenerated.

Three mitigations, and they are load-bearing rather than decorative:

1. **`.gitignore` must exclude `data/`** — but note that gitignoring is what makes the directory
   invisible to `git clean -xdf`... which is precisely the command that would delete it. Ignored
   files are *more* exposed to accidental cleanup, not less.
2. **FR-56 automatic snapshots** provide a second copy, though in the same tree.
3. **A snapshot copy outside the project tree is worth considering later.** Not built now, but the
   residual risk is real: everything in `./data/` shares one deletion event.

Recorded rather than resolved. Q3 = B (a mount outside the project) remains available if that risk
comes to feel worse than the machine-specific path it costs.

### WAL files must be on the same mount

SQLite's `-wal` and `-shm` files live beside the database. A mount that captured only
`history.db` would break recovery, so the **directory** is mounted, never the single file.

This differs from the `secrets/` mount, which binds one file — worth noting, because copying that
pattern here would be a subtle and hard-to-diagnose mistake.

---

## Compose changes

```yaml
services:
  now-playing:
    build:
      args:
        # R7 CLOSED 2026-08-25 — pinned to the verified head.
        MCP_SERVER_REF: 7b5fde6309a52a7874768c63deda7880ee85935b

    environment:
      HISTORY_DB_PATH: /data/history.db
      SNAPSHOT_DIR: /data/snapshots
      SNAPSHOT_INTERVAL_HOURS: 24
      SNAPSHOT_KEEP: 14

    volumes:
      - ./secrets/spotify-config.json:/opt/spotify-mcp/spotify-config.json:rw
      - ./data:/data:rw          # NEW — directory, not file (WAL needs siblings)
```

**Unchanged**: port binding (`127.0.0.1:3000:3000`), `LOCAL_ONLY`, `HOST`, `POLL_INTERVAL_MS`.
U1 introduces **no networking change whatsoever** — the download-only export decision is what
makes that true.

### R7 — closed

`MCP_SERVER_REF` was `main`, unpinned. Upstream declares no license and no release tags, so `main`
could move and silently change the `getNowPlaying` output the parser depends on.

Resolved to the current head:

```
7b5fde6309a52a7874768c63deda7880ee85935b   2026-08-21
"fix: add offset param to getMyPlaylists (#72)"
```

**Secondary benefit**: the CI Docker-build job becomes a real drift detector. Against `main` a
failure was ambiguous — our change, or upstream moved? Against a pinned SHA, a failure is ours.

---

## Container filesystem

| Path | Source | Mode |
|---|---|---|
| `/opt/spotify-mcp/spotify-config.json` | `./secrets/…` | rw (MCP server rewrites tokens) |
| `/data` | `./data` | rw |
| `/app` | image | ro in practice |

**Permissions**: the container process must own or be able to write `/data`. On Windows under
Rancher Desktop, bind-mount UID mapping is usually permissive, but this is the most likely
first-run failure — worth verifying explicitly during Build and Test rather than assuming.

---

## Monitoring

No observability stack. The existing diagnostics endpoint gains steps:

| Step | Reports |
|---|---|
| Database | Path, schema version, writable, WAL active |
| History | Plays recorded, last recorded time, degraded flag, counted gaps |
| Snapshots | Last snapshot time, count retained, last error |

Consistent with the existing convention: a step whose prerequisite failed reports **skipped**, not
**failed**, so the fault localises.

Introducing Prometheus or similar for a single-user local tool would be infrastructure without a
consumer.

---

## What deliberately does not change

| Area | Status |
|---|---|
| Networking | **No new port, listener, or exposure.** `127.0.0.1` binding stands |
| Security | `localGuard` untouched. NFR-01–07 as built and live-verified |
| Compute | One container, one process |
| Deployment topology | Single container (Q3 = A). No k8s-blocking debt introduced |
| Secrets | Unchanged mount and handling |

The security row is the meaningful one: because export is a download over the existing loopback
listener, **U1 requires no security review**. That was the point of the §3.5 decision, and it
holds all the way through to infrastructure.
