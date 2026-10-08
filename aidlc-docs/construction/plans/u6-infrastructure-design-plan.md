# Infrastructure Design Plan — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U6
**Status**: ✅ **ALL 6 ANSWERED (2026-10-07), every one A.** Q3 asked whether the copy needs Spotify to complete the validations — **no**; answered in `infrastructure-design.md` IN-U6-3. Deliverables: `infrastructure-design/infrastructure-design.md` (IN-U6-1…6) and `deployment-architecture.md` — ✅ **APPROVED 2026-10-07**.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U6 FD (BR-44…BR-52) · U6 NFR Design (**P-38…P-48**, **LC-32…LC-39**, PBT-51…58) — both approved

---

## What U6 needs from infrastructure

Less than any unit since U1, by design: P-38 puts all maintenance **inside the one running process**, so U6
adds **no mount, no port, no service, no migration**. What it does need is narrower and easy to miss:

| Need | Why |
|---|---|
| A Node version that has `node:sqlite` `backup()` | P-38 depends on it; the base image tag floats today |
| The new runtime dependency (`tar`) built exactly as reviewed | First new runtime dependency since U0 |
| A **second installation** for the U6 exit test | P-48 — local round trip now, the NAS in U9 |
| A rollback path | U6's startup code **renames `history.db`** (the swap) — the first unit whose startup can move the live database |

### Unchanged, and why that is correct

| | |
|---|---|
| Mounts | `data/previous/`, `data/restore-pending/`, `data/.work/` all live **inside the existing `./data:/data:rw`** directory mount — same-filesystem renames, which is what BR-50.1 requires. `state/` and `config/` untouched |
| Ports / network | Ingest routes sit behind `localGuard` on the existing `127.0.0.1:3010` publish. **No exposure change** — NFR-29 is U9's |
| Restart policy | `restart: unless-stopped` (`compose.yaml:287`) — ✅ probed: an `exit(0)` **is** restarted |
| Repository hygiene | `data/` and `state/*` are already gitignored (`.gitignore:27, 54`) |

---

## Facts established for this plan — 2026-10-07

| | |
|---|---|
| Container Node | **v22.23.3**, `backup` is a function ✅ |
| `Dockerfile` | `ARG NODE_VERSION=22` — ⚠️ **floats**; any 22.x rebuild is accepted |
| Dependency install | `Dockerfile:41` runs **`npm install`**, not `npm ci` — ⚠️ the lockfile is not enforced at build |
| Polling off-switch | **None**. `POLL_INTERVAL_MS` (default 3000) is the only knob |
| Container name | Fixed: `container_name: spotify-now-playing` (`compose.yaml:19`) — a second installation needs an override |
| Healthcheck | In the image (`Dockerfile:85`): 30 s interval, **10 s start period** |
| Images | `spotify-now-playing:0.1.0` (current, U5) · `:u4-rollback` |
| Graceful shutdown | `server.ts:1349` handles `SIGINT`/`SIGTERM` and closes the repository — the `exit(0)` path can reuse it |

---

## Plan

- [ ] Answer Q1–Q6; follow-ups if anything is ambiguous
- [ ] `infrastructure-design/infrastructure-design.md` — Node pin, dependency build, rollback, deploy steps
- [ ] `infrastructure-design/deployment-architecture.md` — the live installation and the verification installation side by side
- [ ] Update `HANDOFF.md`, `aidlc-state.md`; log in `audit.md`

---

## Questions

### Question 1 — Compute · How is the Node version that has `backup()` guaranteed?

`node:sqlite`'s `backup()` exists in today's container (v22.23.3), but `NODE_VERSION=22` floats and older 22.x
releases do not have it.

A) **Pin the minor** — `NODE_VERSION=22.23` (patches still float, so security fixes arrive) — **plus a startup capability check**: if `backup` is missing, *Create backup* is disabled with the reason, and Diagnostics says so ⭐ *recommended*

B) Pin the exact patch (`22.23.3`) — fully reproducible, but security patches need a manual bump

C) Keep `22`, rely on the startup check alone

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 2 — Security · Is the new dependency built exactly as reviewed?

`npm install` may resolve versions differently from `package-lock.json`. Until now every runtime dependency was
long-standing; `tar` is new, and P-39's whole argument is about *which* `tar` runs.

A) **Switch the image build to `npm ci`** — the lockfile is authoritative, and a mismatch fails the build ⭐ *recommended*

B) Keep `npm install`

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 3 — Deployment environment · The second installation for U6's exit test (P-48)

> ⚠️ **User requirement, 2026-10-07**: *"Make sure this second deployment is able to be cleanly installed for the
> test and then cleanly removed without impacting the primary deployment at all (either the deployment or the
> project artifacts that enable it)."* Option A below was rewritten to meet it as a **contract**, with a
> before/after proof rather than an assurance.

**Measured 2026-10-07 — the trap this contract exists for**: the live deployment's Compose project is named
**`spotify`**, derived from the directory name (`com.docker.compose.project` label). ⚠️ **A second Compose file
in the same directory gets the SAME project name by default** — so `docker compose -f compose.verify.yaml down`
could act on the live project's resources. Port `3011` is free.

A) **A standalone `compose.verify.yaml` under its own project name, with an isolation contract** ⭐ *recommended*

**What install creates — and nothing else:**

| | |
|---|---|
| `compose.verify.yaml` | Committed, **standalone** (never merged with `compose.yaml` via `-f a -f b`), top-level **`name: spotify-verify`** |
| Container | `spotify-now-playing-verify`, on its own network `spotify-verify_default` |
| Image | **References** the already-built live image by tag — **no `build:`**, so it can never rebuild or re-tag the live image |
| Port | `127.0.0.1:3011` |
| `verify-install/` | **One** gitignored directory holding all of its state: `data/`, `state/`, `config/` (rules from the committed template), and a **placeholder** Spotify config copied from `secrets/spotify-config.example.json` |

**What it never touches**: `compose.yaml`, `Dockerfile`, `data/`, `state/`, `config/`, `secrets/`, the live
container, `spotify_default`, or any image tag.

**What it never calls**:
- ⚠️ **No Spotify credentials at all.** If Spotify rotates refresh tokens, a second container refreshing a copy of
  the live token could invalidate the live one — **unverified, so designed out rather than tested**. With no
  credentials there are no Spotify calls, no token refresh and no doubled poll, so the U9-b question does not
  arise. ⚠️ This relies on the app **starting without Spotify** (NFR-13). Credentials load lazily
  (`webApiClient.ts:42`), which suggests it will, but that is **not yet seen** — it is the first Build & Test step,
  and if it fails it is a U6 defect to fix, not a reason to hand the copy a real token.
- `LABELS_ENABLED=false` (no MusicBrainz), `SNAPSHOTS_ENABLED=false`, `SKIP_EXECUTOR_ENABLED=false` with an
  empty `state/` — it **cannot skip a track on your account**.

**Removal**: `docker compose -f compose.verify.yaml down` (never `--rmi`, which could delete the shared image
tag) → delete `verify-install/`. Nothing else exists to remove.

**Proof, not assurance — `npm run verify:up` / `verify:down`** wrap the above and:
1. **refuse to run** unless the resolved project name is `spotify-verify` (the trap above);
2. **before install**, record the live container's id, `StartedAt`, `RestartCount`, image id and health;
3. **after removal**, assert all five are **unchanged**, that no container, network or directory named
   `*verify*` remains, and that `git status` shows **no change to any tracked file**.

The only permanent project changes are the ones U6 commits once: `compose.verify.yaml`, the two npm scripts and
a `verify-install/` line in `.gitignore`.

B) Stop the live app, and restore into it after moving its data aside. ⚠️ Fails the requirement: it stops the
primary deployment and puts the test on the real corpus

X) Other (please describe after [Answer]: tag below)

[Answer]:
A - I think this makes sense since we don't need this second local copy to actually be fully operational (connected to spotify) to complete the needed validations correct?
---

### Question 4 — Rollback · How do we get back to U5 if U6's startup misbehaves?

U6 is the first unit whose **startup code can rename `history.db`**. U6 adds no migration, so U5's image reads the
same database.

A) **Tag the current image `spotify-now-playing:u5-rollback` before deploying U6**, and verify live that U5's image starts cleanly on a data directory containing U6's `previous/`, `restore-pending/` and `.work/` (it should ignore them) ⭐ *recommended — the U4 precedent*

B) Rebuild U5 from git if needed

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 5 — Deployment · A safety backup before the first U6 deploy?

U6 itself adds no migration, so nothing *requires* one. But the first start of U6's image runs the startup restorer
and the sweeper against the real `data/` for the first time.

A) **Yes — one developer backup (`npm run db:backup -- --label before-u6`), verified, before the first deploy.** Needs a brief `docker compose down`; `recently-played` backfills the gap ⭐ *recommended*

B) No — rely on the U5 rollback image (Q4) and BR-49's previous database

X) Other (please describe after [Answer]: tag below)

⚠️ This is also the natural moment for **BR-52**'s legacy cleanup, which needs a fresh verified backup first —
but BR-52 says that backup should be taken **through the app**, so the cleanup itself waits until U6 is live.

[Answer]:
A
---

### Question 6 — Monitoring · Is a backup or restore recorded anywhere durable?

Today the design reports maintenance events in **Diagnostics** (in memory, from startup) and the **container
log**. A restore's outcome is only known after the restart that applies it, and a later restart loses it from
Diagnostics.

A) **In-memory status + the container log only.** Consistent with FD Q3 = A, which declined recording provenance ⭐ *recommended*

B) Also a small append-only file, `data/maintenance.log` — last 100 events (when, what, outcome, play count). Bounded, and **not** in the archive allowlist, so it never travels

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

## Out of scope for U6 Infrastructure Design

| | Why |
|---|---|
| Any change to how the app is reached | NFR-29 — **U9** |
| The NAS | **U9** |
| CI changes (secret scan, `smoke`/`knip` required) | NFR-28/30/31 — **U8** |
| A polling off-switch as a feature | Not needed: Q3 uses the existing `POLL_INTERVAL_MS` knob |
