# Infrastructure Design Plan — U10: Data Safety

**Date**: 2026-10-22 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U10
**Status**: Q1 B · Q2 A (2026-10-22). ✅ **ALL ANSWERED.** Deliverables: `infrastructure-design/infrastructure-design.md` (**IN-U10-1…8**) and `deployment-architecture.md`.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U10 FD (approved 2026-10-22) BR-78…86 · U10 NFR Design (approved 2026-10-22) P-76…87, LC-69…80,
PBT-79…89 · U8/U9 infrastructure (release script, `:3011` verification install, the image's entrypoint)

---

## 1. What maps where

| Logical component | Infrastructure | Settled by |
|---|---|---|
| LC-69/70 writer lock | `<data mount>/history.db.lock`: `./data` → `/data` in the container; `data/` or `data-dev/` on the host | FD, NFR |
| LC-71 startup sequence, migration 8 | The app process; the live install on this PC, then every *App only* install on its first start | FD |
| LC-72/73/74 kept backups | `/data/backups/{scheduled,before-change}/` inside the existing `./data` mount (Q1 = B: always there) | FD Q2, Q1 here |
| LC-75/76 Status, Diagnostics button, Settings | `public/` served by the app; no infrastructure | NFR Q3 |
| LC-77 `data-dev/` | Host runs only; `.gitignore`, `.dockerignore` | FD Q4 |
| LC-78/79 `update` | The image's entrypoint (`update` beside `setup` and `auth`), run with `-v "${PWD}:/work"` | FD Q1 |
| LC-80 update check | Outbound HTTPS from the container's default network to `api.github.com:443`; preference in the `./state` mount | FR-81 |
| BR-82 release backup | `npm run release` on this PC → `http://localhost:3010` → the store, read back on the host under `data/backups/` | FD |

**Categories with nothing to decide** (rule Step 3 asks each to be justified):
- **Compute and scaling**: unchanged; one container, one user. Startup may now wait up to 30 s for a stale lock and
  take one backup (seconds at today's 3–5 MB); `npm run release` already waits **180 s** for health
  (`HEALTH_TIMEOUT_MS`), and the health check tolerates 10 s + 3 × 30 s.
- **Messaging**: none.
- **Networking**: no new listener and no new port. One new outbound destination (`api.github.com`, FR-81, opt-out),
  over the default network the MusicBrainz client already uses.
- **Monitoring**: the *Status* light, diagnostics and one log line per lock and backup event (P-85, P-86); `docker
  logs` as today. No external monitoring (single user, local).
- **Shared infrastructure**: none. No `shared-infrastructure.md`.

## 2. Facts measured for this plan — 2026-10-22

| | |
|---|---|
| **Three compose files** | `compose.yaml` (the live install, built from source), `compose.app.yaml` (the template `setup` writes for *App only*), `compose.verify.yaml` (`:3011`, its own `verify-install/data`, `SNAPSHOTS_ENABLED: "false"`). Each mounts `./data:/data:rw` and `./state:/state:rw` as **directories**, so every new file can be written by rename |
| ⚠️ **Existing *App only* folders keep their `compose.yaml`** | `update` rewrites only the image line, so they keep `SNAPSHOT_DIR: /data/snapshots` and the `SNAPSHOT_*` variables. U10 must work with **no new variable set**, and an old variable must be harmless |
| **The entrypoint creates and chowns `SNAPSHOT_DIR`** | `scripts/docker-entrypoint.sh`: `mkdir -p` and `chown node:node` on the data directory and `SNAPSHOT_DIR`, mount points only. After U10 the CSV timer is gone, so this makes an empty folder nobody writes |
| ⚠️ **`SNAPSHOT_DIR` is today's only "elsewhere"** | `.gitignore`: *"Snapshots live here too, so database and backups share a single deletion event. Point SNAPSHOT_DIR outside the project tree if that matters to you."* Retiring the CSV timer retires that escape hatch with it — Q1 |
| **The verification install starts empty** | `verify:up` copies reduced credentials and the example rules, never the history. Rehearsing migration 8 on **real** data needs a restored copy — Q2 |
| **Rename does not cross mounts** | A file built in `/data/.work` can be renamed into `/data/backups` (same mount) but not into another mount (`EXDEV`). A second location therefore needs its own working folder on its own mount |

---

## 3. Questions

### Q1 — Storage — Where kept backups may live

| | Option |
|---|---|
| **A** | ⭐ **`data/backups/` by default, movable by one setting.** A new optional `BACKUP_DIR` (default: `backups/` beside the database). Set, it must be its own mount in the container (e.g. another disk or a NAS share); the backup is then built in a working folder **inside** that location so the final rename stays on one mount. Startup checks the location is a writable directory; if not, *Status* fails with the reason and no kept backup is attempted there (a before-change backup counts as failed, BR-79.3). Replaces `SNAPSHOT_DIR` as the "elsewhere" setting; `.gitignore`'s note and the docs move to it |
| **B** | **Always `data/backups/`** (the FD as written). Database and backups share one deletion event (`git clean -xdf`, a lost disk); copying them elsewhere is the user's job |

[Answer]: **B** (owner, 2026-10-22, question prompt): always `data/backups/`. ⚠️ Residual risk accepted: the database and its backups share one deletion event (`git clean -xdf`, a lost disk); copying `data/backups/` elsewhere is the user's job, and the documents say so.

---

### Q2 — Deployment — The first U10 deploy on the live install

The first start of U10 migrates the owner's database (v7 → v8) through a code path never run on real data: open,
lock, backup-before-change, migrate, record the version.

| | Option |
|---|---|
| **A** | ⭐ **Rehearse on `:3011` first.** The owner takes **Settings → Create backup** on the live app; `verify:up --candidate` runs the working tree; the archive is restored into `:3011` through its own *Restore backup*. Observed there: the before-change backup appears in `verify-install/data/backups/before-change/` and itself restores; the schema is v8; play and decision counts equal the archive's; the lock refuses a host `npm start` pointed at `verify-install/data` and is taken over within 30 s after `docker kill` (the live cross-mount probe, P-76). Then `npm run release -- --apply` on the live install |
| **B** | **Release directly**: U10's own before-change backup protects the first start; the owner's manual backup is the fallback |

[Answer]: **A** (owner, 2026-10-22, question prompt).

---

## 4. Decisions stated here, not asked

- **`SNAPSHOT_DIR` retired** from `compose.yaml`, `compose.app.yaml` and the entrypoint's `mkdir`/`chown`; an old
  folder's setting is ignored and logged once (*"SNAPSHOT_DIR is no longer used; backups are in …"*). The existing
  CSV files are never touched. `SNAPSHOT_INTERVAL_HOURS` and `SNAPSHOT_KEEP` keep their names and now govern the
  scheduled kind.
- **The entrypoint** creates and chowns `backups/` as mount points only, as it does
  for `data/` today, and dispatches `update` beside `setup` and `auth`.
- **`data-dev/`** is added to `.gitignore` and `.dockerignore`, with the same "cannot be regenerated" warning
  `data/` carries.
- **CI is unchanged**: the lock and store tests use temporary folders on the runner's own disk; the cross-mount
  behaviour is the Rancher probe's (measured in FD, re-run live at Q2).
- **The verification install** keeps `SNAPSHOTS_ENABLED: "false"`, now meaning *no scheduled backups*;
  before-change backups still run there, which is what Q2's rehearsal observes.

## 5. Plan — after the answers

- [x] Collect answers; follow-ups if anything is ambiguous
- [x] `construction/u10-data-safety/infrastructure-design/infrastructure-design.md`: IN-U10-1… (mounts, files,
      entrypoint, settings, ignores, release backup, the rehearsal)
- [x] `…/infrastructure-design/deployment-architecture.md`: the three installs after U10, the first-deploy sequence
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md`; completion message; owner approval
