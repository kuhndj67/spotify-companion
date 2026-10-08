# Infrastructure Design — U6: User-Data Lifecycle

**Date**: 2026-10-07 · **Stage**: CONSTRUCTION — Infrastructure Design, U6
**Answers**: Q1–Q6 all **A** (Q3 rewritten as an isolation contract at the user's request).
Plan: [`../../plans/u6-infrastructure-design-plan.md`](../../plans/u6-infrastructure-design-plan.md)
Companion: [`deployment-architecture.md`](deployment-architecture.md)

> **U6 adds no mount, no port, no service and no migration to the live deployment.** P-38 keeps all
> maintenance inside the one running process, and its working directories live inside the existing `./data`
> directory mount. What infrastructure does carry is narrow: a guaranteed Node capability, a dependency built
> exactly as reviewed, a test installation that cannot touch the live one, and a way back.

---

## IN-U6-1 · Node version: pin the minor, check the capability *(Q1 = A)*

- `Dockerfile`: `ARG NODE_VERSION=22` → **`ARG NODE_VERSION=22.23`**. Patches still float, so security fixes
  arrive on rebuild; the minor that has `node:sqlite` `backup()` is guaranteed. (Container measured on
  **v22.23.3**.)
- **Startup capability check**: if `typeof backup !== 'function'`, *Create backup* is **disabled with the reason**
  and Diagnostics reports it. ⚠️ The check is what protects a host deployment (`npm start`), which the
  `Dockerfile` pin cannot reach.

## IN-U6-2 · Dependencies built from the lockfile *(Q2 = A)*

- `Dockerfile:41`: `RUN npm install` → **`RUN npm ci`**. `package-lock.json` becomes authoritative, and a
  mismatch **fails the build** rather than resolving silently.
- `tar` **7.5.22** (BlueOak-1.0.0, GPL-3.0-compatible per its publisher; 5 transitive deps) added to
  `dependencies`. It is the first new **runtime** dependency since U0; `npm ci` is what makes P-39's argument
  about *which* `tar` runs hold in the image.

## IN-U6-3 · The verification installation *(Q3 = A — the isolation contract)*

Full contract and the side-by-side picture in [`deployment-architecture.md`](deployment-architecture.md) §2.
In short: a standalone `compose.verify.yaml` with **`name: spotify-verify`**, no `build:`, port `3011`, all
state in one gitignored `verify-install/`, **no Spotify credentials**, and `npm run verify:up` / `verify:down`
that **refuse a wrong project name** and **prove the live deployment unchanged** before and after.

### Q3's question, answered: does the copy need Spotify to complete U6's validations? **No.**

| U6 exit check | Needs Spotify? |
|---|---|
| *Create backup* on the live app downloads an archive | No — the live app does it on its own connection |
| *Restore backup* into the copy: upload, verify, compare, confirm, restart, swap | No |
| The restored copy starts and its counts / sha256 match the manifest | No |
| `integrity_check: ok`; automation is **off** in the copy; `secrets/`/`state/` absent from the archive | No |
| *Undo last restore* on the copy | No |
| The copy itself can *Create backup* (round trip in the other direction) | No |

⚠️ **What the copy does NOT prove**: live display and play recording. Those are untouched by U6 and keep being
proven by the **live** deployment, which runs throughout. ⚠️ The one assumption is that the app **starts
without Spotify** (NFR-13) — not yet seen, so it is **Build & Test step 1**; if it fails, that is a U6 defect
to fix, not a reason to give the copy a real token.

## IN-U6-4 · Rollback image *(Q4 = A)*

Before the first U6 deploy: `docker tag spotify-now-playing:0.1.0 spotify-now-playing:u5-rollback`. Then
verify **live**, against a **copy** of `data/` that contains U6's `previous/`, `restore-pending/` (with and
without `ready`) and `.work/`: U5's image starts, reports `integrity_check: ok`, and **ignores** all three.
⚠️ Reading U5's code to conclude it ignores them is not enough — the U4 precedent verified the rollback live.

## IN-U6-5 · A safety backup before the first deploy *(Q5 = A)*

`docker compose down` → `npm run db:backup -- --label before-u6` → `npm run db:restore -- <dir> --verify-only`
(all eight checks) → deploy. Reason: U6's image is the **first whose startup code can rename `history.db`**,
and its first start runs the restorer and sweeper against the real `data/`. The gap is backfilled by
`recently-played` on restart. ⚠️ **BR-52's legacy cleanup waits** — it requires a backup taken **through the
app**, so it happens after U6 is live.

## IN-U6-6 · Monitoring *(Q6 = A)*

Maintenance events go to **Diagnostics** (in memory, from startup) and the **container log** — no durable
maintenance file, consistent with FD Q3 = A (provenance declined). Diagnostics' Maintenance block shows busy
state, last restore outcome, the previous database, the startup sweep count, the Node capability (IN-U6-1) and
size against caps (P-46).

---

## Deployment steps for U6 (live)

1. `docker tag spotify-now-playing:0.1.0 spotify-now-playing:u5-rollback` (IN-U6-4)
2. `docker compose down` → `npm run db:backup -- --label before-u6` → `--verify-only` (IN-U6-5)
3. `docker compose up -d --build` — check the build's exit code **directly**, not through a pipe (CLAUDE.md)
4. `/api/health` and `/api/diagnostics`: schema still **v7**, Node capability present, sweep count 0
5. Run the verification installation (deployment-architecture §2), then remove it with the no-impact proof
6. BR-52 legacy cleanup, through a fresh **in-app** backup

## What does not change

`compose.yaml` mounts, ports, environment, restart policy · `config/` `:ro` · `state/` · `secrets/` · the
schema (**v7**) · `localGuard`/`decideAccess` (P-42 composes `ingestGuard` after it).
