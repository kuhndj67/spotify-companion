# Deployment Architecture — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U1

---

## Topology

```
┌─ Host: Windows 11 + Rancher Desktop ─────────────────────────────┐
│                                                                  │
│  Browser ──► http://127.0.0.1:3000                               │
│                    │                                             │
│  ┌─────────────────▼──────────────────────────────────────────┐  │
│  │ Container: spotify-now-playing                             │  │
│  │                                                            │  │
│  │   Express + WebSocket  ──► localGuard (loopback only)      │  │
│  │            │                                               │  │
│  │   NowPlayingService ──tick──► PlayObserver ──► buffer      │  │
│  │            │                                       │       │  │
│  │   MCP subprocess (stdio)                    [boundary]     │  │
│  │            │                                       ▼       │  │
│  │            │                            SQLite  /data      │  │
│  │            │                                       │       │  │
│  │            │                    ExportService ◄────┤       │  │
│  │            │                    Snapshot timer ◄───┘       │  │
│  └────────────┼───────────────────────────────────────────────┘  │
│               │                          │                       │
│      ./secrets/spotify-config.json    ./data/                    │
│               │                          ├── history.db          │
│               │                          └── snapshots/          │
└───────────────┼──────────────────────────────────────────────────┘
                ▼
        api.spotify.com
```

**Port `3000` is the only ingress, bound to `127.0.0.1`, and U1 adds nothing to it** beyond a
download route on the existing listener.

---

## Startup sequence

Order is significant; two steps are gates rather than steps.

```
1. Load config                       ── fail fast on malformed config
2. Open database                     ── on failure ⇒ DISPLAY-ONLY MODE
3. Run migrations                    ── GATE: on failure ⇒ REFUSE TO WRITE
4. Verify writability                ── probe, don't assume
5. Start HTTP + WebSocket
6. Spawn MCP subprocess
7. Backfill from recently-played     ── non-fatal
8. Subscribe PlayObserver to tick    ── recording begins here
9. Start snapshot timer
```

**Step 3 is a gate.** A half-migrated schema must never accept writes — the resulting rows would
be structurally wrong in a way that is hard to detect and impossible to undo. Refusing to write is
correct even though it means running degraded.

**Step 4 probes rather than assumes.** Bind-mount permission problems on Windows surface as write
failures at the first play boundary otherwise — minutes after startup, with the user having seen a
healthy-looking UI. Failing at step 4 makes it immediate and diagnosable.

**Step 5 precedes step 6 deliberately** (existing behaviour): the UI is servable even if the MCP
subprocess cannot start, so the diagnostics page is reachable to explain the failure.

---

## Shutdown

```
SIGTERM / SIGINT
  1. Stop accepting ticks
  2. Flush in-progress play as `unknown`   ── BR-2.6; never discarded
  3. Close database (WAL checkpoint)
  4. Terminate MCP subprocess
  5. Exit
```

Step 2 is the one worth guarding. On an unclean kill (`SIGKILL`, host power loss) the in-progress
play is lost — the accepted exposure of Q2 = A. The graceful path must not also lose it.

---

## Operating modes

| Mode | Trigger | Display | Recording | Export |
|---|---|---|---|---|
| **Normal** | All healthy | ✅ | ✅ | ✅ |
| **Display-only** | DB unopenable / migration failed | ✅ | ❌ counted | ❌ |
| **Degraded recording** | Intermittent write failure | ✅ | ⚠️ gaps counted | ✅ |
| **No playback data** | MCP down | ⚠️ error shown | ❌ | ✅ |

**The display column is the invariant.** It is green or degraded in every row and never absent —
U0 worked before history existed and must keep working when history is broken.

Note that **export still works when recording is degraded**: reading and writing fail
independently, so the user can always retrieve what was captured before the problem started.

---

## Data lifecycle

| Artefact | Growth | Retention | Regenerable? |
|---|---|---|---|
| `play` rows | ~73k/year | **Forever** | ❌ **Never** |
| `observation` rows | ~10.5 M/year | Indefinite (W-2) | ❌ Never |
| Snapshots | 1/day | Rotate, keep 14 | ✅ From the database |
| WAL/SHM | Bounded by checkpointing | Transient | ✅ |

**The asymmetry in the last column is the whole retention policy.** Snapshots rotate freely
because they are derived. Trails are not pruned on a timer because they are the raw material FR-20
depends on, and deleting them is irreversible — which is exactly why W-2 defers that decision to a
considered routine rather than a cron job.

---

## Backup and recovery

| Scenario | Recovery |
|---|---|
| Database file corrupted | Restore from the most recent snapshot; plays since then are lost |
| `./data/` deleted | Same, **if** a snapshot survives — but snapshots live in `./data/` too |
| Repository deleted or re-cloned | **Total loss.** Nothing outside the tree survives |
| Container rebuilt | **No loss** — this is what the bind mount guarantees (NFR-11) |
| Host failure | Whatever the user's own backup covers |

### ⚠️ Residual risk, stated plainly

**Everything in `./data/` shares a single deletion event.** The database and its snapshots are in
the same directory, inside the project tree, and `.gitignore`d — which makes them invisible to git
and therefore *more* exposed to `git clean -xdf`, not less.

FR-56 protects against corruption and accidental table damage. It does **not** protect against
losing the directory.

**Not resolved here**, because Q3 = A was chosen with the trade-off visible. If it later feels
wrong, two cheap options exist: point `SNAPSHOT_DIR` outside the project tree, or move the whole
mount (Q3 = B). Neither requires redesign — only a path change.

---

## Verification checklist for Build and Test

- [ ] `./data/` created with correct permissions on first run under Rancher Desktop
- [ ] `history.db`, `-wal` and `-shm` all present in the mount
- [ ] `compose down && compose up --build` preserves history (NFR-11)
- [ ] Migration runs once; a second start is a no-op
- [ ] Corrupt/unwritable database ⇒ display-only, diagnostics explains it
- [ ] Snapshot written on schedule; rotation removes the oldest
- [ ] Pinned `MCP_SERVER_REF` builds successfully
- [ ] Graceful shutdown flushes the in-progress play as `unknown`
- [ ] Export streams a large history without stalling the display
