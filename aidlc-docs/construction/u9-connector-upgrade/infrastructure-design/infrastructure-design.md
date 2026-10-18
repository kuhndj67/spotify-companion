# Infrastructure Design — U9: Connector Upgrade & Publishable Image

**Date**: 2026-10-18 · **Plan**: [`u9-infrastructure-design-plan.md`](../../plans/u9-infrastructure-design-plan.md), all 5 answered **A**
**Maps**: LC-58…LC-68 (NFR Design) · BR-68…BR-75 (FD) · Picture: [`deployment-architecture.md`](deployment-architecture.md)

**Nothing to decide** (plan §1, justified there): compute and scaling, messaging, app networking, shared
infrastructure. No `shared-infrastructure.md`.

---

## IN-U9-1 — The credentials directory, on every install

| | Host | Container | Mode |
|---|---|---|---|
| Live (`compose.yaml`) | `./secrets/` | `/app/secrets` | directory, `:rw` |
| Verification (`compose.verify.yaml`) | `./verify-install/secrets/` | `/app/secrets` | directory, `:rw` |
| *App only* (image's compose template) | `./secrets/` in the user's folder | `/app/secrets` | directory, `:rw` |

- One constant in `src/config.ts` names `/app/secrets`, `…/spotify-config.json` and `…/musicbrainz.json`
  (LC-60). The connector is spawned with `SPOTIFY_CONFIG_PATH` from that constant (BR-69.5).
- The **entrypoint** `chown`s `/app/secrets` (the directory, not recursive) before dropping to `node`, as it does
  for `data/`. The old per-file `chown` is removed.
- The old single-file mounts (`/opt/spotify-mcp/spotify-config.json`, `/app/secrets/musicbrainz.json`) are gone from
  all compose files. LC-61 reports `single-file` if an old compose file brings one back (P-68).
- Host paths and `npm run auth` are unchanged. The host development path (`npm start`) is unchanged (unpatched
  connector, no mount).

## IN-U9-2 — Acceptance on `:3011` (Q1 = A)

- Credentials: `npm run verify:up -- --probe-credentials` (IN-U7-3), adapted to write the reduced copy into
  `./verify-install/secrets/spotify-config.json`. No value is ever printed; only presence, length and comparisons.
- Duration: **at least 50 minutes** beside live, so upstream's 45-minute proactive refresh is observed (BR-70.1).
- **Rotation watch**: after **every** refresh, the copy's `refreshToken` is compared with live's (equality only).
  A difference **stops** the acceptance and is reported to the owner at once; live is checked for health.
- The negative control (BR-70.2) runs on the same install: the patch's variable unset → `EBUSY`, seen in the log.
- A play during the window is played by the owner; it is recorded by **both** installs into their own databases.
  Automation is off on `:3011` (it always is).
- `npm run verify:down` deletes the copy and runs the no-impact proof, as today.

## IN-U9-3 — The acceptance record (Q2 = A)

- **`scripts/connector-acceptance.json`**, committed: an array of `{ pin, date, result, record }`. `result` is
  `"pass"` or `"fail"`; `record` is the repo path of the readable Build & Test record.
- `npm run release -- --apply` (LC-67) refuses when the compose pin differs from the last released pin and has no
  `pass` entry (P-74).
- A structural test (LC-63) checks the file's **shape**: every entry has a full-SHA `pin`, an ISO `date`, `result`
  `pass`|`fail`, and a `record` path that exists. ~~Both compose pins have a `pass` entry~~: *amended 2026-10-18
  (Code Generation Q2 = A)*, because that entry is written only in Build & Test, so the test would keep `verify` red
  until then. Refusing an unaccepted pin is the **release's** duty (LC-67), where it matters.
- U9's first entry is written in Build & Test, after BR-70 passes, with the pin `6065ce5c…`.

## IN-U9-4 — Publishing (NFR Q1–Q4)

| | |
|---|---|
| Trigger | `push` of a tag `v*` to `kuhndj67/spotify-companion` (the owner's act) |
| Where | `ci.yml`, job `publish`, `needs: [test, container, secrets]`, `if` tag; `ubuntu-latest` |
| Concurrency | group `publish-${{ github.ref }}`, no cancel |
| Permissions | workflow default `contents: read`; `publish` adds `packages: write` |
| Code beside the token | `actions/checkout` pinned by full SHA; then the runner's `docker` CLI only |
| Registry | `ghcr.io/kuhndj67/spotify-companion:<version>`, **private**, linked by the `org.opencontainers.image.source` label |
| Platform | `linux/amd64` |
| Before push | LC-64 decision (tag = `v` + version; tag not in registry) → build → LC-66 checks (licences; no secrets or user data; base digest + Node version into labels and summary; scan) → push |
| Scanner (Q3 = A) | **Trivy release binary**, pinned by version and **SHA-256**, downloaded and verified in the step (the gitleaks pattern); **report only**, table to the job summary |
| Not published | No `latest` or other floating tag |

`rulesetMatchesWorkflow` is extended to assert `publish` is **not** a required check (a required check that only
runs on tags would block every PR).

## IN-U9-5 — *App only* entry points (FD Q10–Q11, Q4 = A)

- The entrypoint dispatches on its first argument: `setup` · `auth` · anything else starts the app (as today).
- **`setup`**: target is the current folder mounted at a fixed container path (`/work`); writes the image-only
  `compose.yaml`, `secrets/musicbrainz.json` (from the example), empty `config/`, `data/`, `state/`; refuses if any
  target exists (LC-68, PBT-78).
- **`auth`**: runs `auth.mjs` with its listener bound to `0.0.0.0` **inside** the container (an environment
  variable, default unchanged on the host), port **8888**; the documented command publishes `-p 127.0.0.1:8888:8888`;
  the listener refuses a non-loopback `Host` (P-73); writes `/work/secrets/spotify-config.json`.
- **Ownership** (Q4 = A): for `setup` and `auth`, the entrypoint reads the uid and gid of `/work` and drops to them
  with `setpriv`. On Windows/Rancher the mount reports root, and this does no harm; on Linux the user owns the files.
- The commands, with their expected output, are README *App only* (BR-74.5).

## IN-U9-6 — The walk's read token (Q5 = A)

1. **Probe** (Build & Test, before the walk guide is written): can a **fine-grained** token (this repository,
   *Packages: read*) run `docker pull` of the private image? Record the result.
2. Use the least token that pulls: the fine-grained one if the probe passes, otherwise a **classic** token with only
   **`read:packages`** (⚠️ it reads every package the account can see; today that is this image only).
3. **7-day expiry**, created by the owner in the VM's browser for the walk, **revoked after**. The walk guide carries
   step-by-step creation instructions (U8's precedent).

## IN-U9-7 — Order of Build & Test (what must be true before the next step)

1. `npm run verify` green; CI green on the branch (incl. the connector build running upstream's tests, patched).
2. Positive controls seen to fail (logical-components *Guard tests*).
3. `:3011` on the new pin and names → BR-70 incl. negative control and rotation watch → record + `connector-acceptance.json`.
4. Rollback rehearsal on `:3011` to `1.0.0-beta.2` (BR-71.4) → `verify:down` no-impact proof.
5. **Live crossing**: owner present; release refuses while `spotify-now-playing` runs (seen) → owner stops it →
   release builds, deploys `spotify-companion:1.0.0-beta.N`, health-checks, tags → a play is seen recorded.
6. Owner pushes the tag → `publish` runs → the image is in GHCR, private, with both licences (checked by pulling).
7. Token probe (IN-U9-6) → walk guide → agent walk of *App only* on `kuhndjwin11pro` → on pass, README's
   *coming soon* comes off (a docs-only release).

Steps 5 and 6 are outward-facing or touch the live deployment: each waits for the owner's go-ahead.
