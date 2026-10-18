# NFR Design Plan — U9: Connector Upgrade & Publishable Image

**Date**: 2026-10-18 · **Stage**: CONSTRUCTION — NFR Design, Unit U9
**Status**: ✅ **ALL 6 ANSWERED A (2026-10-18).** Deliverables: `nfr-design/nfr-design-patterns.md` (**P-65…P-75**) and `nfr-design/logical-components.md` (**LC-58…LC-68**, **PBT-73…PBT-78**).
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U9 Functional Design (**approved 2026-10-18**): `business-rules.md` **BR-68…BR-75** (facts G1–G7),
`domain-entities.md`, `business-logic-model.md` · requirements **FR-73…75**, **NFR-40**, NFR-28, NFR-32, NFR-34,
NFR-20/21

**NFR Requirements: SKIPPED**, as for U1–U8.

> **U9's non-functional risk is a write credential and a supply chain, not load.** Until now nothing this project
> built left the machine. From U9, a CI job holds `packages: write`, and what it pushes runs on other people's
> machines (the walk VM, then U10's NAS). The bias of every pattern below: **the job that can publish runs as little
> third-party code as possible, and checks what it publishes before it publishes it.**

---

## 1. Unit context

| | |
|---|---|
| **NFRs in play** | **NFR-28** no secret in an image · **NFR-32** licence before publishing · **NFR-34** one version, never overwritten · **NFR-40** pin policy · **NFR-20/21** property tests, seeds logged · **NFR-13** degrade, never crash |
| **Allocates** | **P-65 …** · **LC-58 …** · **PBT-73 …** (U8 ended at P-64, LC-57, PBT-72) |
| **Schema** | **None**: stays v7 |
| **Scalability / performance** | **Not applicable, with reason**: one user per deployment; the only new cost is build time (upstream's suite runs in about 0.7 s) and one CI job per release. No question asked |

## 2. Facts measured for this plan — 2026-10-18

| | |
|---|---|
| ✅ **Upstream's tests pass on Node 22.23** | `npm ci` + `npm test` at `6065ce5c` in `node:22.23-bookworm-slim`: **113 tests, 113 pass, 0 fail**, ~0.7 s. BR-68.3 is workable as designed. (Unpatched source; the patched run is Code Generation's) |
| CI actions | `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, pinned by **major tag**, not commit. Acceptable while no job holds a write credential; the publishing job will |
| Base image | `node:22.23-bookworm-slim`; the **patch floats** (IN-U6-1, so security fixes arrive on rebuild). A published image therefore records a base that a later rebuild of the same commit may not reproduce |
| Build attestations | The local Buildx build already exports an **attestation manifest** (seen in the 2026-10-18 probe build log) |
| Startup today | Missing `secrets/musicbrainz.json` → the app **refuses to start** (NFR-14). Missing Spotify credentials → the app **runs** and the Spotify indicator says why (FR-71) |
| `auth.mjs` | Listens on `127.0.0.1`, opens the browser itself; a container needs it to bind inside and print the link (BR-74.3) |
| CI layout | One workflow `ci.yml`, jobs `test`, `container`, `secrets`; their names are pinned by the ruleset test (`rulesetMatchesWorkflow`) |

## 3. Patterns already implied by the FD (stated here, not asked)

- **Guarded patch** (BR-69.1): a pure function *count the line → patch → count again*, property-tested, plus a build
  run seen to fail on a mutated source.
- **Check, then push, serialised**: GHCR has no tag-immutability switch that this design relies on; the workflow
  checks that the tag is absent, and a **`concurrency` group per tag** stops two runs racing between check and push.
- **One name, enforced by a test**: no file outside an allow-list (the release guard, the upgrade note, history)
  contains `spotify-now-playing`; both compose files carry the same full-SHA pin.
- **The live install sees the new pin only after BR-70**: the release script cannot deploy a pin that has no
  recorded acceptance (to be shaped in Infrastructure Design).

---

## 4. Questions

### Q1 — Logical components — Where does the publishing job live?

| | Option |
|---|---|
| **A** | ⭐ **In `ci.yml`**: a `push: tags: ['v*']` trigger, and a `publish` job that `needs:` the existing `test`, `container` and `secrets` jobs and runs **only on a tag**. The checks are literally the same jobs as `main`'s, not a copy. `publish` is not a required check, so the ruleset test is unaffected |
| **B** | A separate `publish.yml` that calls `ci.yml` as a reusable workflow (`workflow_call`). Cleaner separation; `ci.yml` is refactored to be callable |
| **C** | A separate `publish.yml` repeating the steps. ⚠️ Two copies of the checks drift |

[Answer]:
A
---

### Q2 — Security — What runs inside the job that holds `packages: write`?

| | Option |
|---|---|
| **A** | ⭐ **Only `actions/checkout`, pinned by full commit SHA** (version in a comment), and the **plain `docker` CLI** already on the runner: `docker login ghcr.io` with `GITHUB_TOKEN` on stdin, `docker build`, the image checks, `docker push`. No third-party action ever sees the write token. The other jobs keep their `@v4` tags (no write credential) |
| **B** | Docker's official actions (`docker/login-action`, `docker/build-push-action`), pinned by SHA. Less shell, more third-party code holding the token |
| **C** | Pin **every** action in every workflow by SHA now. Strongest, but updating them by hand until U11's Dependabot arrives |

[Answer]:
A
---

### Q3 — Security — ⚠️ A security-posture decision: scan the image for known vulnerabilities before publishing?

The image includes Debian's base packages, Node and two `node_modules` trees. Most findings would be in the base,
outside this project's control.

| | Option |
|---|---|
| **A** | ⭐ **Scan and report, don't gate**: a pinned scanner (e.g. Trivy, binary pinned by version and checksum, as gitleaks is) runs on the built image; findings go into the job summary and the release record. A release is never blocked by a base-image CVE with no fix |
| **B** | **Gate on fixable criticals**: the push fails if a *critical* finding has a fixed version available. Stronger, but a release can be blocked by something only a rebuild of the base fixes |
| **C** | **No scanner in U9**; revisit with U10, when the image first runs on another machine |

[Answer]:
A
---

### Q4 — Resilience / reproducibility — The base image's floating patch, once images are published

| | Option |
|---|---|
| **A** | ⭐ **Keep the patch floating, record it**: the publishing job writes the resolved base image **digest** and Node version into an OCI label and the job summary, so any published image says exactly what it was built on. Security fixes keep arriving on rebuild (IN-U6-1 unchanged) |
| **B** | **Pin the base by digest** in the Dockerfile. Reproducible, but every security fix becomes a manual edit until U11's Dependabot |

[Answer]:
A
---

### Q5 — Resilience — What the app does when the credentials directory is wrong

After U9, an old compose file (a stale *App only* folder, or a half-done rollback) can start the new image with the
old single-file mount, or with no `secrets/` mount at all.

| | Option |
|---|---|
| **A** | ⭐ **Start, and say so**: a startup check finds whether the credentials **directory** is mounted and writable. If not, the app runs (as it does today without credentials), the Spotify indicator names the reason (*"credentials directory is not mounted / not writable: see the upgrading note"*), and `/api/diagnostics` shows it. No token refresh is attempted into a path that cannot take it. MusicBrainz's existing refuse-to-start rule is unchanged |
| **B** | **Refuse to start** with the reason in the log. Unmissable, but a running app with a clear indicator is easier for a non-developer to diagnose |

[Answer]:
A
---

### Q6 — Security — Hardening the sign-in listener when it runs in a container (BR-74.3)

Inside a container, the listener must bind to all interfaces; only the `-p 127.0.0.1:…` part of the command keeps
it off the network. A user who drops that prefix exposes it.

| | Option |
|---|---|
| **A** | ⭐ **Defence in depth**: add one check, so the listener accepts a callback only with a **loopback `Host`** (the app's own rule, `decideAccess`'s principle). It **already** rejects a wrong OAuth `state` and closes after a code or its timeout (`scripts/auth.mjs:99-127`, read 2026-10-18); those stay. The documented command carries the `127.0.0.1` prefix |
| **B** | Rely on the documented `127.0.0.1` port binding alone |

[Answer]:
A
---

## 5. Plan — after the answers

- [x] Collect answers; follow-ups for anything ambiguous
- [x] `construction/u9-connector-upgrade/nfr-design/nfr-design-patterns.md`: **P-65 …**
- [x] `construction/u9-connector-upgrade/nfr-design/logical-components.md`: **LC-58 …**, **PBT-73 …**
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md`; completion message; owner approval
