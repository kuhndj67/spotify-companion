# U10 Infrastructure Design — Data Safety

**Unit**: U10 · **Date**: 2026-10-22 · **Plan**: [`u10-infrastructure-design-plan.md`](../../plans/u10-infrastructure-design-plan.md)
— Q1 B · Q2 A
**Allocates**: **IN-U10-1…IN-U10-8**

No new container, port, listener or service. One new outbound destination (FR-81). Everything else is files inside
the mounts every install already has.

---

## IN-U10-1 — Files inside the existing mounts

| Path (host · container) | Written by | Mount kind | Notes |
|---|---|---|---|
| `data/history.db.lock` · `/data/history.db.lock` | LC-70 | directory (`./data`) | exclusive create; heartbeat by modification time; deleted on orderly stop |
| `data/history.db.lock.takeover` | LC-70 | directory | exists only during a takeover |
| `data/backups/scheduled/`, `data/backups/before-change/` | LC-73 | directory | built in `data/.work/`, renamed in (same mount) |
| `state/update-check.json` · `/state/update-check.json` | LC-80 | directory (`./state`) | temp-then-rename |
| `data-dev/history.db` (host only) | the app, host runs | — | FR-78 |

Every new file is in a **directory** mount, so rename works (U9 measured `EBUSY` only on a single-file mount).

## IN-U10-2 — Backups stay in `data/backups/` (Q1 = B)

Always beside the database; **no new setting**. ⚠️ **Residual risk accepted by the owner (2026-10-22)**: the
database and its backups share one deletion event (`git clean -xdf`, a lost disk). The documents say so where the
user reads about backups (INSTALL-APP and INSTALL-DEV *Backups*, `.gitignore`'s note on `data/`): *copy
`data/backups/` somewhere else if that matters to you*. U11 (the NAS) may revisit it.

## IN-U10-3 — `SNAPSHOT_*` settings

| Setting | After U10 |
|---|---|
| `SNAPSHOT_DIR` | **Retired**: removed from `compose.yaml` and `compose.app.yaml` and from the entrypoint's `mkdir`/`chown`. An old folder that still sets it is ignored, with one log line at startup. `data/snapshots/` and its CSV files are never touched |
| `SNAPSHOT_INTERVAL_HOURS`, `SNAPSHOT_KEEP` | Kept, same names and defaults (24, 14); now govern the **scheduled** kind |
| `SNAPSHOTS_ENABLED` | Kept; `false` turns off **scheduled** backups only. Before-change backups cannot be turned off |
| Before-change keep count | `BEFORE_CHANGE_KEEP`, optional, default 5 |

An existing *App only* folder therefore runs U10 with **no edit** beyond the image line `update` writes.

## IN-U10-4 — The entrypoint

- Creates and chowns `$DATA_DIR/backups` (mount point's subfolder, not recursive), replacing the `SNAPSHOT_DIR` lines.
- Dispatches **`update`** beside `setup` and `auth`: runs as root inside the throwaway container only to write the
  user's `/work/compose.yaml`; touches nothing else (BR-83.4).
- Default command unchanged: the app as `node`, PID 1, so SIGTERM reaches the shutdown handler that releases the
  lock (P-78).

## IN-U10-5 — Ignore files

`data-dev/` added to `.gitignore` (with `data/`'s *cannot be regenerated* warning) and `.dockerignore`. The
`.gitignore` note on `data/` is rewritten: backups now live in `data/backups/` and share its deletion event
(IN-U10-2).

## IN-U10-6 — Outbound

`api.github.com:443` from the container's default network (the MusicBrainz client's route), only while the update
check is enabled (default on, FR-81). No proxy configuration is added. ⚠️ An install with no internet simply reports
*could not check*; nothing else depends on it.

## IN-U10-7 — Release script

`npm run release -- --apply`, before `docker compose build`: `POST http://localhost:<port>/api/backups` with a
loopback `Host` (the host reaches the app normally), retry while `409` (busy) for up to 60 s, then confirm the
returned file exists under the host's `data/backups/before-change/`. `--app-is-down` skips only this step. The
180 s health wait is unchanged and covers the worst startup (30 s stale-lock watch, one backup, migration 8).

## IN-U10-8 — First live deploy: rehearsed on `:3011` (Q2 = A)

1. Owner: **Settings → Create backup** on the live app (the archive is also the fallback).
2. `npm run verify:up -- --candidate`: the working tree on `:3011`, its own `verify-install/` folders.
3. Restore the archive into `:3011` through its own *Restore backup* (the app restarts and swaps it in).
4. Observe, each recorded in the build-and-test record:
   - a file in `verify-install/data/backups/before-change/` whose label reads *migration 7→8*, and which **itself
     restores** through the upload path;
   - schema **v8**; play and decision counts equal the archive's manifest;
   - with `:3011` running, a host `npm start` with `HISTORY_DB_PATH=verify-install/data/history.db` is **refused**,
     naming the container (the live cross-mount probe of P-76 on the real data path, `D:`);
   - `docker kill` the `:3011` container, start the host run: it waits, then takes over **within 30 s**; restart
     `:3011` while the host holds it: refused, *Status* fails, recording off;
   - *Status* and the Diagnostics button in light and dark.
5. `npm run verify:down` (proves the live install unchanged), then `npm run release -- --apply` on the live install
   (its own before-change backup, BR-82, and the first start's, BR-79).
