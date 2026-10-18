# CLAUDE.md — orientation for any contributor's agent

Short on purpose (≤ 200 lines, tested). **Current state is not here.** It is in
[`aidlc-docs/aidlc-state.md`](aidlc-docs/aidlc-state.md), the active unit's `HANDOFF.md`, and the last few
entries of [`aidlc-docs/audit.md`](aidlc-docs/audit.md). The traps are in [`CONTRIBUTING.md`](CONTRIBUTING.md#traps).
**Read both before changing anything.**

---

## What this project is

A **local, single-user Spotify companion**: it displays what is playing, enriches it (label, genres, liked status,
history), records every play, and skips tracks by user-authored rules.

**It is a data-collection instrument first.** Its purpose is to estimate whether a track was **promoted** into the
feed rather than chosen for the user, on the hypothesis that signed-artist placements are disproportionately paid
promotion. Signed-vs-independent is a **proxy variable**. The hypothesis (**R1**) is **unproven**: the one
pre-registered confirmatory test (2026-09-10) found it **not supported**, and that run is spent. The design must stay
able to **disconfirm** it. Rules are valuable without R1.

**Single-USER, always**: each person runs their own deployment with their own Spotify app and corpus. This is not
multi-tenancy.

## Method: AI-DLC

Rules live outside the repo at `D:/Software/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/` (the owner's
machine). Stages gate on **owner approval**. Only the standard document types are used: inception questions go in
the requirements and units plans; unit questions go in `aidlc-docs/construction/plans/uN-*-plan.md`. **Do not invent
new document types**, and keep exactly one `HANDOFF.md` per unit.

| Document | Purpose |
|---|---|
| `aidlc-docs/aidlc-state.md` | **Current state. Start here** |
| `aidlc-docs/audit.md` | Append-only decision log: what was decided, why, and what was rejected |
| `aidlc-docs/inception/requirements/requirements.md` | FRs, NFRs, risks, backlog (W-*) |
| `aidlc-docs/inception/research/research-findings.md` | **Live API probe results: authoritative** |
| `aidlc-docs/inception/plans/execution-plan.md` | Phases |
| `aidlc-docs/construction/uN-*/` | Per-unit design, code records, `HANDOFF.md` |

New scope re-enters Inception. Requirements are ratified **before** a unit's Functional Design.

## The working rule: probe, don't reason

**Probe the live API. Do not reason from documentation.** Spotify's Development Mode has been restricted twice since
2024 and the docs do not say so. Six wrong conclusions here were caught only by live probes (list in
CONTRIBUTING.md). Pattern: membership checks (`/contains`) and batch endpoints are blocked, single-item and list
endpoints are open, and the workaround is **fetch the set once, cache it, resolve locally**. ⚠️ A restriction can
misname itself (`400 "Invalid limit"`).

⚠️ **A wrong request shape is indistinguishable from absent data.** When a probe says "no data", check it against a
case whose answer you know. The same goes for a recorded claim in this repo's own notes: **re-probe before building
on it**, whether it says "the API doesn't return X" or "this guard is safe".

Credentials are in `secrets/spotify-config.json` (gitignored). Probe scripts follow the pattern in
`research-findings.md`.

## Working style

- **Say what is verified and what is not.** Several findings here came from noticing a green test that was green
  for the wrong reason.
- **A plausible inference is not a measurement.** Do not record one as if it were. Measure first.
- **Positive controls.** A guard, property or check must be seen to *fail* on a bad input, or it is a belief.
- **Security-posture decisions are surfaced to the owner, not decided.**
- **Outward-facing actions** (push, GitHub settings, posting issues) need the owner's go-ahead.

## Git and CI

- `main` is protected: changes arrive by **pull request** with every check green: **Typecheck, test, smoke, knip,
  build** · **Container image builds** · **Secret scan**. The ruleset is code: `.github/rulesets/main.json`, applied
  by `npm run protect`, and cross-checked against `ci.yml` by a test.
- **Standard multi-developer flow** (owner, 2026-10-18): all work happens on a **branch** (one per unit or fix, e.g.
  `u9-connector-upgrade`), committed in reviewable steps, pushed, and merged to `main` only by **pull request** with
  every check green. The **owner merges**. An agent never commits to `main` directly.
- ⚠️ **The owner may push directly** (ruleset bypass, stated in CONTRIBUTING.md). Releases, tag pushes and anything
  touching the live deployment still wait for the owner's go-ahead.
- Commit messages end with the attribution line the session specifies.
- **Versions**: SemVer, `package.json` is the one source (`src/version.ts` is its one reader; the compose image tags
  are checked copies). Releases go through `npm run release`. An image tag is never overwritten.

## The deployment (the owner's machine)

- **The container is the deployment**: `docker compose up -d` → `http://localhost:3010`. ⚠️ `localhost:3000` is a
  **different app**.
- ⚠️ **Never run the container and `npm start` together.** Both poll Spotify and both write `data/history.db`. Assume
  the container is running, and `docker compose down` first.
- **`data/` cannot be regenerated** (months of plays). It is gitignored, which makes it *more* exposed to `git clean
  -xdf`. Never delete play rows to tidy anything.
- Mounts: `./data` (history), `./state` (automation kill switch: **never** in `data/` or `config/`), `./config` (rules,
  written only by `RulesWriter`), `./secrets` (credentials, a **directory** mount at `/app/secrets` since U9; never in
  a backup, never in a response).
- **The connector** (`spotify-mcp-server`, MIT) is pinned by SHA in `compose.yaml` and patched in one line at build
  (CONTRIBUTING.md *Operations*). Moving the pin needs an acceptance `pass` first, or `npm run release` refuses.
- **The image is published by CI** on a pushed `v*` tag, to `ghcr.io/kuhndj67/spotify-companion` (private while the
  repository is). Pushing a tag is the owner's act.
- Automation ships **off** (`SKIP_EXECUTOR_ENABLED`, plus the UI kill switch). Never arm it on the owner's behalf.
- Backup and restore are **in-app** (Settings), with one writer. The `db:*` scripts are a developer path and need
  the container down.

## Commands

```bash
npm run verify          # typecheck + test + smoke + knip. Run THIS, not `npm test` alone
npm test                # the suite
npm run typecheck       # src and test
npm run smoke           # every scripts/ entry point LOADS (a load check, not a behaviour check)
npm run knip            # dead files, exports and dependencies over src/ and scripts/

docker compose up -d --build   # build and run the deployment; check the build's exit code directly, not via a pipe
docker compose down
docker logs -f spotify-companion

npm run auth            # host-side Spotify OAuth, once per install
npm run rules:init      # create config/rules.json from the template (refuses to overwrite)

npm run release         # plan a release (read-only); `-- --apply` builds, deploys, health-checks and tags (no push)
npm run protect         # diff the committed ruleset against GitHub (read-only); `-- --apply` writes it

npm run db:backup -- --label <why>                  # container DOWN first
npm run db:restore -- <dir> --verify-only           # read-only; verify a backup the day you take it
npm run db:restore -- --self-test                   # proves the verifier can FAIL (corrupt snapshot kept on purpose)
npm run db:verify-backups                           # read-only sweep over data/
npm run verify:up                                   # throwaway second install on :3011 (--candidate: on the working tree)
npm run verify:down                                 # remove it and PROVE the live deployment unchanged

node scripts/hypothesis-gate.mjs                    # Phase 2 gate. Read-only. Its confirmatory run is SPENT
npm run reclassify                                  # re-derive outcomes from trails (dry run by default)
```

⚠️ The hypothesis gate's thresholds are **pre-registered constants**. Change them by amending the pre-registration,
never by editing the script.

## Where things are

| Path | What |
|---|---|
| `src/server.ts` | Wiring, startup, and the WebSocket `upgrade` handler (keep it there; a test pins it) |
| `src/api.ts` | Every route, with injected dependencies (including `now`), so routes are testable |
| `src/localGuard.ts` | `decideAccess`: the ONE local-access policy, for HTTP and WebSocket alike |
| `src/version.ts` | The one reader of the app version |
| `src/history/`, `src/rules/`, `src/playback/` | Recording, the rules engine, automated skipping |
| `src/maintenance/`, `src/backup/`, `src/configuration/` | Backup/restore, verification, rules and credential writes |
| `scripts/` | Developer and owner scripts; covered by `smoke` (load only) and `knip` |
| `test/` | `node:test` + fast-check. Structural guards: `purity`, `noOrphanModules`, `localGuard`, `propertyObligations`, `versionSources`, `rulesetMatchesWorkflow`, `secretsTracked`, `docs` |
| `docs/INSTALL.md` | The install routine, walked cold by an agent before each major release |
| `aidlc-docs/` | All design records |

## Before you change…

- **the classifier, a threshold or a rate**: CONTRIBUTING.md *Data*, especially the ratio-over-constant-time trap.
- **a guard**: CONTRIBUTING.md *Code*. Is it computed the same way as what it guards? Can it observe its condition?
  Does it read a label a bug could leave empty?
- **anything under `scripts/`**: it is outside the test suite. `smoke` only proves it loads.
- **a document**: every `npm run` it names must exist, and every path must resolve (`test/docs.test.ts`). Write no
  hand-written counts; they decay.
