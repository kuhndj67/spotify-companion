# Infrastructure Design Plan — U9: Connector Upgrade & Publishable Image

**Date**: 2026-10-18 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U9
**Status**: ✅ **ALL 5 ANSWERED A (2026-10-18).** Deliverables: `infrastructure-design/infrastructure-design.md` (**IN-U9-1…7**) and `deployment-architecture.md`.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U9 FD (approved 2026-10-18) BR-68…75 · U9 NFR Design (approved 2026-10-18) P-65…75, LC-58…68,
PBT-73…78 · U7 IN-U7-3 (probe credentials) · U8 infrastructure (walk VM, verification install, ruleset)

---

## 1. What maps where

| Logical component | Infrastructure | Settled by |
|---|---|---|
| LC-58/59 connector build, patch, upstream tests | `Dockerfile` connector stage, on this PC (release) and GitHub-hosted `ubuntu-latest` (CI) | NFR Design |
| LC-60/61/62 credentials directory | Host `./secrets/` → container `/app/secrets` (directory, `:rw`); live and verification installs alike | FD Q3 |
| LC-63 structural tests | `npm test` locally and in CI's `test` job | NFR Design |
| LC-64/65/66 publishing | `ci.yml` `publish` job on GitHub-hosted `ubuntu-latest`; registry **GHCR**, package `kuhndj67/spotify-companion`, private | Q27, NFR Q1–Q4 |
| LC-67 release guards | `npm run release` on this PC | NFR Design |
| LC-68 *App only* entry points | The image's entrypoint; walked on `kuhndjwin11pro` | FD Q8, Q10, Q11 |
| Acceptance (BR-70) | The `:3011` verification install (`compose.verify.yaml`, project `spotify-verify`) | FD |

**Categories with nothing to decide** (rule Step 3 asks each to be justified):
- **Compute and scaling**: unchanged. One container per deployment, one user.
- **Messaging**: none. The connector stays a stdio child (BR-68.2).
- **Networking**: unchanged for the app (`127.0.0.1:3010`). The only new listener is the sign-in's, `127.0.0.1:8888`
  on the host (`auth.mjs` already uses port 8888, so the redirect URI does not change; BR-74.4).
- **Shared infrastructure**: GHCR is the only new shared service, and it is per-account. No
  `shared-infrastructure.md` is needed.

## 2. Facts measured for this plan — 2026-10-18

| | |
|---|---|
| 🔴 **`:3011` runs on placeholder credentials** | `compose.verify.yaml:43-45`: *"A PLACEHOLDER… NEVER the live file. If Spotify rotates refresh tokens, a second container refreshing a copy of the live token could invalidate it."* BR-70 needs a **real** refresh and a **real** play there |
| ✅ **The rotation risk was measured in U7** | P-U7-1 (2026-10-08, record `u7-configuration-management/probes/p-u7-1-3-2026-10-08.md`) used a **reduced copy** of the real credentials (`npm run verify:up -- --probe-credentials`, IN-U7-3): after a refresh the `refreshToken` was **byte-identical**, and live stayed healthy. Both connector versions **save** a rotated token if Spotify returns one (old `utils.ts:284`, new `:452`), so "unchanged in the file" means **Spotify did not rotate it**, not that the code ignored it. The new connector's refresh and `invalid_grant` handling are otherwise identical to the old |
| Entrypoint | `scripts/docker-entrypoint.sh` `chown`s the **file** at `SPOTIFY_CONFIG_PATH` (default `/opt/spotify-mcp/spotify-config.json`). With a directory mount it must `chown` the **directory**, or the `node` user cannot create the temp file a rename needs |
| GitHub token on this PC | `gh` holds `repo`, `workflow`, `read:org`, `gist`, and **no** `write:packages`. Under NFR Q2 = A nothing on this PC needs it |
| Walk VM read access (U8) | A **fine-grained** token, this repository only, *Contents: read*, 7 days, revoked after (U8 Infrastructure Q3 = A) |
| GHCR and token types | ⚠️ **Not probed**: whether a fine-grained token can pull from GHCR. GitHub's documentation has said GHCR needs a **classic** token with `read:packages`; this project has seen documentation be wrong (CLAUDE.md), so Q5's answer is probed before the walk guide is written |

---

## 3. Patterns stated, not asked

- **Verification compose follows live**: `compose.verify.yaml` mounts `./verify-install/secrets/` as a directory at
  the same container path. `verify:down`'s no-impact proof is unchanged and still runs.
- **Entrypoint**: root `chown`s the credentials **directory** (not recursive), then drops to `node`, as today for
  `data/`.
- **The live crossing** happens once, in U9's Build & Test, after BR-70 and the rollback rehearsal pass on `:3011`,
  with the owner present. `npm run release -- --apply` health-checks; then a track is played and seen recorded.
  Expected polling gap: about one minute.

---

## 4. Questions

### Q1 — Deployment environment — Which credentials the `:3011` acceptance runs on

| | Option |
|---|---|
| **A** | ⭐ **The reduced copy, as in U7** (`verify:up -- --probe-credentials`, IN-U7-3): the four values with a placeholder token. It runs **at least 50 minutes** beside live, so upstream's 45-minute proactive refresh is seen (BR-70.1). After **every** refresh, `refreshToken` is compared with the live one (presence and equality only, never printed); a difference stops the acceptance and the owner is told at once. The copy is deleted by `verify:down` |
| **B** | **A second Spotify developer app** used only for verification: the owner registers it once and signs in to it, and its refresh token is unrelated to live's. No shared token at all, but a one-time setup and a second registration to keep |

[Answer]:
A
---

### Q2 — Storage — Where the acceptance record that the release reads lives (P-74)

| | Option |
|---|---|
| **A** | ⭐ **A small committed data file**, `scripts/connector-acceptance.json`: `{ pin, date, result, record }`, where `record` is the path of the human-readable Build & Test record. `npm run release` refuses a pin with no `pass` entry; a structural test checks that both compose files' pin has one and that the record file exists |
| **B** | `npm run release` reads the **heading** of the Markdown Build & Test record. No second file, but the release script parses prose |

[Answer]:
A
---

### Q3 — Monitoring — Which scanner reports on the image (P-72, report only)

| | Option |
|---|---|
| **A** | ⭐ **Trivy**, the release **binary pinned by version and SHA-256** (the gitleaks pattern), not its GitHub Action; scans the built image; the table goes to the job summary and the release record |
| **B** | **Grype** (Anchore), the same way. Equivalent for a report-only scan |

[Answer]:
A
---

### Q4 — Compute — File ownership when `setup` and `sign-in` run on Linux

The entrypoint starts as root. On Windows/Rancher this does not matter. On a Linux host, files that `setup` writes
into the user's folder would belong to **root**, and the user could not edit `musicbrainz.json` without `sudo`.

| | Option |
|---|---|
| **A** | ⭐ **Run as the folder's owner**: for `setup` and `auth`, the entrypoint reads the owner (uid and gid) of the mounted target folder and drops to it with `setpriv`, so files land owned by the user. No extra flag for the user to remember |
| **B** | Document `--user "$(id -u):$(id -g)"` in the Linux variant of the commands |

[Answer]:
A
---

### Q5 — Security — The read token for the *App only* walk (BR-74.6)

| | Option |
|---|---|
| **A** | ⭐ **The least token that can pull**: probe first whether a **fine-grained** token (this repository, *Packages: read*) pulls from GHCR. If it does, use it; if not, a **classic** token with **only `read:packages`**. Either way: **7-day expiry**, created by the owner for the walk, **revoked after**, and a step-by-step creation guide in the walk guide (U8's precedent). ⚠️ A classic `read:packages` token can read **every** package the account can see, not only this one; today that is only this image |
| **B** | Classic `read:packages` straight away, without the probe |

[Answer]:
A
---

## 5. Plan — after the answers

- [x] Collect answers; follow-ups for anything ambiguous
- [x] `construction/u9-connector-upgrade/infrastructure-design/infrastructure-design.md`: IN-U9-1 …
- [x] `construction/u9-connector-upgrade/infrastructure-design/deployment-architecture.md`
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md`; completion message; owner approval
