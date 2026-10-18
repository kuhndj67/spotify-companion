# Code Generation Plan — U9: Connector Upgrade & Publishable Image

**Date**: 2026-10-18 · **Stage**: CONSTRUCTION — Code Generation (Part 1: Planning), Unit U9
**Status**: ✅ **APPROVED 2026-10-18** (Q1 = A: branch `u9-connector-upgrade`, standard PR flow · Q2 = A: the acceptance test checks shape, the release refuses). Step 13 (public-readiness review) added at the owner's request.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield. *Generate* means modify existing files
where they exist, never duplicate them.

> ⚠️ **This plan is the single source of truth for U9 Code Generation.** Each step is checked off here as it
> completes, with any deviation recorded beside it (the U5–U8 precedent).

**Inputs (all approved 2026-10-18)**: FD **BR-68…BR-75** · NFR Design **P-65…P-75**, **LC-58…LC-68**,
**PBT-73…PBT-78** · Infrastructure Design **IN-U9-1…7** · Requirements **FR-73…75**, **NFR-40** · Story **US-32**

---

## Unit context

| | |
|---|---|
| **Story** | **US-32**: run the app from a published image, without the source (FR-74, FR-75) |
| **Requirements** | FR-73 the pin move, every upstream change accounted for · FR-74 publish to GHCR, one name, licences · FR-75 *App only* steps · NFR-40 pin policy |
| **Depends on** | U8: release script and decision (LC-50/51), CI and ruleset (LC-52…55), `verify-install.mjs`, `versionSources` test, INSTALL.md · U7: `CredentialsWriter`, `atomicWrite.ts`, PBT-66 |
| **Consumed by** | **U10** (pulls the published image) |
| **Owns** | No database entities. **No migration**: schema stays **v7** |

### ⚠️ What must not move

- **`decideAccess`, `ingestGuard`, `localGuard.test.ts`**: untouched. No route is added.
- **The parser** (`parseNowPlaying`): untouched unless BR-70.3 shows the text changed (G1 says it has not).
- **The live deployment**: nothing in Code Generation starts, stops or rebuilds `spotify-now-playing`. Images may be
  **built** under new tags for checks; nothing is `up`-ed except, in Build & Test, the `:3011` install.
- **`data/`**: never touched.

## Ordering principle

Pure decisions and their property tests first; then the shells that call them; then the files that move names and
mounts; documentation last. `npm run verify` stays green after **every** step, so a step that would turn it red is
split.

---

## Steps

### Step 1 — Guarded patch *(BR-69.1, P-65, LC-58, PBT-73, PBT-74)* — ✅ DONE · Node 22.23 runs the `.ts` CLI directly (probed); on the host's 22.17 it cannot, which does not matter (only the build runs it). Seen to refuse on a re-run over an already-patched file
- [x] `scripts/lib/patchConfigPath.ts`: pure `patchConfigPath(source) → { ok, patched } | { ok: false, reason }`
      (count original line, replace with `process.env.SPOTIFY_CONFIG_PATH ?? <upstream path>`, count again).
      A thin CLI entry (`--file <path>`) for the Dockerfile.
- [x] `test/patchConfigPath.property.test.ts`: PBT-73 (0 or ≥ 2 → refuse, reason names the count), PBT-74 ⭐
      (exactly one, arbitrary surroundings → success, one patched line, every other line unchanged); seeds logged.
- [x] The real upstream `utils.ts` at `6065ce5c` as an example test fixture input (read from `.mcp-server` when
      present, as PBT-66 does).
- [x] ⚠️ The Docker build stage has Node 22.23 and no `tsx`. Probe `node --experimental-strip-types` on 22.23 for
      this file; if it cannot run it, the module is written as `.mjs` with JSDoc types (recorded as a deviation).

### Step 2 — Connector build stage and licences *(BR-68.1–68.4, BR-73, P-66, LC-59)* — ✅ DONE · patched upstream suite **113/113** on 22.23 in the build; both LICENSEs and the labels seen in the image; PBT-66 passes over the new source (≈31 `Error` literals in 5 files, all matching). ⚠️ Deviations: **(a)** `compose.verify.yaml` has no `build:` and no pin (it runs the image by tag), so "both compose files" is **compose.yaml only**; **(b)** the Dockerfile's `ARG MCP_SERVER_REF` defaulted to **`main`** and CI's `docker build .` passed no ref, so **CI built upstream `main`, not the pin**: the default is now the pin, a checked copy (Step 6's test); **(c)** `npm run mcp:setup` cloned `main` and never updated: it now follows the compose pin (host checkout moved to `6065ce5`); **(d)** `.dockerignore` gains `config`, `state`, `verify-install`, `.mcp-server` (BR-69.8) and loses the untrue "the repository is public"
- [x] `compose.yaml`, `compose.verify.yaml`: `MCP_SERVER_REF` → `6065ce5cdef13ffeb43042e295bb788ce7ad00df`, comment
      updated (date, **MIT**, R7 still applies).
- [x] `Dockerfile` connector stage: run LC-58 on `src/utils.ts` (build fails on refusal) → `npm ci` (upstream ships a
      lockfile now) → `npm run build` → **`npm test`** (fails the build) → prune. Comment: the expected
      `EBADENGINE` warnings and why (Q1 = A).
- [x] Runtime stage: `COPY` the connector's `LICENSE` to `/opt/spotify-mcp/LICENSE` and the root `LICENSE` to
      `/app/LICENSE`; a `RUN` check that both exist and are non-empty (BR-73.3); OCI labels (`licenses`, `source`;
      `revision`, `version` and base digest via build args, defaulted for local builds).
- [x] `.mcp-server` for host and CI (`npm run mcp:setup`, CI's PBT-66 fetch) follows the compose pin already; checked,
      not assumed.

### Step 3 — Credentials directory *(BR-69.4, BR-69.5, P-67, LC-60, IN-U9-1)* — ✅ DONE · `connectorSpawnParams` extracted so the explicit `env` is tested (`test/connectorSpawn.test.ts`, with a positive control) · `compose.yaml`'s `SPOTIFY_CONFIG_PATH` env (read before the default) moved to `/app/secrets/…` in both compose files · `verify-install.mjs` needed no change (it already writes `verify-install/secrets/spotify-config.json`) · owed to B&T: `:3011` polls hourly (`POLL_INTERVAL_MS: 3600000`), so BR-70's play and refresh need a shorter interval for the acceptance run
- [x] `src/config.ts`: one constant for the container credentials directory `/app/secrets`; `spotifyConfigPath` and
      `musicbrainzConfigPath` derive from it in the container; host paths unchanged. The comment about the
      connector's `__dirname` path is rewritten.
- [x] `src/mcp/spotifyMcpClient.ts`: spawn with `env: { ...getDefaultEnvironment(), SPOTIFY_CONFIG_PATH }` in the
      container (BR-69.5); a test asserts the spawn parameters carry it.
- [x] `scripts/docker-entrypoint.sh`: `chown` the directory `/app/secrets` (not recursive); the per-file `chown`
      goes.
- [x] `compose.yaml`, `compose.verify.yaml`: `./secrets/` (resp. `./verify-install/secrets/`) → `/app/secrets` as a
      directory; both single-file mounts removed. The `compose.verify.yaml` placeholder comment is updated.
- [x] `scripts/verify-install.mjs`: creates `verify-install/secrets/` with the placeholder (or, with
      `--probe-credentials`, the reduced copy) and the MusicBrainz file inside it.

### Step 4 — Credentials-directory check *(Q5 = A, P-68, LC-61, PBT-76)* — ✅ DONE · read once at startup (mounts do not change); single-file is detected from `/proc/self/mountinfo` (the config file itself a mount point); an unreadable mount table does not block, writability still does · `SpotifyMcpClient` takes `blockedBecause` and throws `CredentialsDirectoryError` instead of spawning · messages kept ≤ 200 characters so the fix is not clipped (tested). The real-container check (old compose → `single-file` shown) is Build & Test's
- [x] `src/configuration/credentialsDirectory.ts`: a pure classifier over probe answers → `ok` · `not-mounted` ·
      `not-writable` · `single-file`, with the probes at the edge (reusing `probeDirectoryWritable`).
- [x] Wiring: on anything but `ok`, the connector is **not spawned**, the Spotify indicator shows the reason in words
      (pointing at INSTALL's upgrading note), `/api/diagnostics` reports the class. The app keeps running.
- [x] `test/credentialsDirectory.property.test.ts`: PBT-76 (every combination → exactly one class; only *mounted
      directory + writable* → `ok`); example tests for the indicator text and diagnostics.

### Step 5 — `CredentialsWriter` on rename *(BR-69.6, BR-69.7, LC-62)* — ✅ DONE · ⚠️ added: `writeFileAtomic` now **keeps the target's permission bits** (a rename would otherwise turn a `600` credentials file into the default; the in-place write never did) — its test runs on Linux CI only (Windows has no mode bits) · `probeFileWritable` **removed** (no caller left) with its test; diagnostics probe the directory · caught in my own new test: a success check `!('refused' in r)` would have passed whatever happened (the refusal key is `reason`); fixed before commit
- [x] Both files written with `writeFileAtomic` (temp in the same directory, then rename); no temp left after a
      failure. The in-place write and its in-place probe are retired for these two files; the diagnostics'
      writability check becomes the directory check (Step 4).
- [x] `src/configuration/atomicWrite.ts`: the header comment that forbids these files is rewritten to say why they
      are now allowed (directory mount, U9).
- [x] `test/credentialsWriter.test.ts`, `test/atomicWrite.test.ts`: updated; a failure-path test proves no temp file
      is left.

### Step 6 — One name *(BR-71.1, BR-71.5, P-69, LC-63)* — ✅ DONE · test is `test/structure.u9.test.ts`; the old-name allow-list holds **exact counts** per file (a new occurrence in an allowed file fails too) · the compose **service** is renamed as well, which makes the old container an orphan that `up`/`down` leave running (comment in `compose.yaml`; guard in Step 7; note in Step 10) · `docs/INSTALL.md` and `CLAUDE.md` renamed here, not in Step 10, so the test is clean now · upstream feature variables read from its source: `MCP_AUTH`, `MCP_TRANSPORT`, `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `SPOTIFY_AUTHORIZATION_SERVERS`, `SPOTIFY_RESOURCE_URL` · `.claude/settings.local.json` is untracked and untouched · CI on PR #3 green, incl. the Linux-only mode test (ran, not skipped)
- [x] Rename to `spotify-companion` in: `compose.yaml` (service, container, image), `compose.verify.yaml`
      (`spotify-companion-verify`), `scripts/release.mjs`, `scripts/lib/releaseDecision.ts`,
      `scripts/verify-install.mjs` (live **and** verify names), `scripts/backup-history.mjs` (default container),
      `scripts/post-boot-check.ps1`, the two P-U5-1 probe scripts, `src/server.ts` (log line),
      `src/mcp/spotifyMcpClient.ts` (MCP client name), `test/versionSources.test.ts`,
      `test/releaseDecision.property.test.ts`.
- [x] ⚠️ `scripts/verify-install.mjs`'s no-impact proof must recognise the live container by **either** name during
      the crossing window (it checks live is unchanged; live is still `spotify-now-playing` until step 5 of
      IN-U9-7).
- [x] `test/structure.u9.test.ts` (name settled in the step; family of `versionSources`): **no old name** outside the
      allow-list · **one full-SHA pin** in both compose files · **no upstream feature variables** (HTTP transport,
      `MCP_AUTH`) in compose files or the Dockerfile. Each fed a planted violation once (positive control).
- [x] `.claude/settings.local.json` is the owner's local file: listed, **not edited**.

### Step 7 — Release guards *(BR-70, BR-71.2, P-74, P-75, LC-67, PBT-77, IN-U9-3)* — ✅ DONE · `scripts/lib/connectorAcceptance.ts` (parse, accepted pins — the LAST entry for a pin decides — and the compose pin); `test/connectorAcceptance.test.ts` checks the committed file's shape (Q2 = A) · `release --plan` read on this machine: pin `6065ce5c` vs last release `7b5fde63`, none accepted, **`spotify-now-playing` RUNNING**: both guards see real conditions · an unreadable previous pin fails closed (treated as moved) · PBT-70 now draws the new facts arbitrarily ("whatever else is true") · ⚠️ **added (deviation)**: `verify:up -- --candidate` builds the working tree as `spotify-companion:candidate` and runs `:3011` on it, and `--poll-ms <n>` replaces the hourly poll. Without them BR-70 could not run before a release (`:3011` runs an existing image by version tag, and the release refuses a tag that exists); `compose.verify.yaml` takes both by `${VAR:-default}`, and `versionSources` reads the default
- [x] `scripts/lib/releaseDecision.ts`: two new refusals: `old-container-running` (Docker reports a running
      `spotify-now-playing`, or cannot be asked) and `pin-not-accepted` (the compose pin differs from the last
      released pin and has no `pass` entry). The refusal text names the one command or record needed.
- [x] `scripts/release.mjs`: gathers the two facts (one `docker ps` query; reads `scripts/connector-acceptance.json`
      and the last release's pin from its git tag).
- [x] `scripts/connector-acceptance.json`: created **empty** (`[]`); the U9 entry is written in Build & Test.
- [x] `test/releaseDecision.property.test.ts`: PBT-77 (refuses whenever running **or** unknown; positive control:
      neither → not blocked), plus `pin-not-accepted` cases; existing PBT-68…71 still pass.
- [x] The acceptance file's structural test: see **Question 2**.

### Step 8 — Publishing *(BR-72, P-70–P-72, LC-64–LC-66, PBT-75, IN-U9-4)* — ✅ DONE · ⚠️ `publishDecision.ts` imports **nothing**: Node 22.23 strips types but cannot resolve `../../src/version.js` to `.ts`, and installing `tsx` in the job would run third-party install scripts beside the write token; full SemVer validity is `versionSources`' job in the `test` job that `publish` needs. CLI seen on 22.23 (publish / already-published / tag-mismatch) · pins: `actions/checkout` v4.4.0 = `11d5960a…` (credentials not persisted), **Trivy v0.75.0** (2026-10-01; v0.76.0 is 4 days old) SHA-256 `c6e65abd…` matched a real download · `check-image.sh` exports the image **once** (the first version exported per check and was minutes slow) · **positive control seen**: an image with a planted `app/secrets/spotify-config.json` and the MIT `LICENSE` removed → both caught, exit 1 · ⚠️ the Trivy step's first real run is the first tag push (owed to B&T)
- [x] `scripts/lib/publishDecision.ts` + `test/publishDecision.property.test.ts` (PBT-75 with its positive control).
- [x] `scripts/check-image.sh` (run by CI against the built image): licences present and non-empty; no file under a
      `secrets` path except `*.example.json`; no `data/`, `config/`, `state/` content; writes base digest and Node
      version to the job summary; **Trivy** release binary, pinned version **and SHA-256**, report only.
- [x] `.github/workflows/ci.yml`: `push: tags: ['v*']`; workflow `permissions: contents: read`; job `publish`
      (`needs: [test, container, secrets]`, tag-only `if`, `concurrency: publish-${{ github.ref }}`,
      `packages: write`, `actions/checkout@<full SHA>`, then `docker` CLI: login with `GITHUB_TOKEN` on stdin →
      LC-64 → build with labels and build args → `check-image.sh` → push). No floating tag; `linux/amd64`.
- [x] `test/rulesetMatchesWorkflow.test.ts`: extended, `publish` is **not** a required check.

### Step 9 — *App only* entry points *(BR-74, P-73, LC-68, PBT-78, IN-U9-5)* — ✅ DONE · `setup` also writes **`config/rules.json`** from the rules example (what `npm run rules:init` does for a source install; the plan said an empty `config/`) · the loopback check is a **dependency-free copy** of `localGuard`'s (`scripts/lib/loopbackHost.mjs`, because `npm run auth` runs on plain Node before `npm ci`), held to it by a property test that they **agree on every input** · `.dockerignore` lets exactly the two committed examples in · `knip` gets `setupCli.ts` as an entry · **seen in a real container**: `setup` writes the folder and a second run refuses naming every file; `auth` with FAKE credentials refuses a LAN `Host` (403), aborts on a wrong `state` (exit 1), prints the link, leaves the file untouched. The success path needs a real sign-in: owed to B&T / the walk · ⚠️ incident: a stray `import()` meant as a syntax check RAN `auth.mjs` on the host; stopped within a minute, nothing written (audit 2026-10-18T21:45)
- [x] `src/appOnly/setup.ts` (compiled into `dist/`, so it ships): a pure decision over the files already in the
      target → write all or refuse naming each; the writer around it. PBT-78 in `test/appOnlySetup.property.test.ts`.
- [x] `compose.app.yaml` (repository root, copied into the image): image-only, `ghcr.io/kuhndj67/spotify-companion:<version>`,
      `./secrets/` directory mount, the same `127.0.0.1` port binding and environment as `compose.yaml` minus
      `build:`. Its image tag joins `versionSources`' checked copies.
- [x] `scripts/auth.mjs`: bind host from an environment variable (default `127.0.0.1`, unchanged on the host);
      **refuse a non-loopback `Host`** (P-73, both host and container); output path from `SPOTIFY_CONFIG_PATH` when
      set; in the container, print the link instead of opening a browser. Copied into the image.
- [x] `scripts/docker-entrypoint.sh`: dispatch `setup` / `auth`; for those, drop to the uid/gid of `/work`
      (IN-U9-5); anything else starts the app as today.
- [x] Tests: the loopback-`Host` refusal (seen to refuse a LAN `Host`); the setup decision; the entrypoint's
      dispatch is covered by Build & Test (a shell script, `smoke` cannot load it).

### Step 10 — Documents *(BR-71.6, BR-74.5, BR-75.2, BR-75.3, BR-69.2)*
- [ ] `docs/INSTALL.md`: names updated; an **Upgrading from `1.0.0-beta.2`** section (stop the old container, then
      start as usual; the host files do not move).
- [ ] `README.md` *App only*: the real steps (log in, `setup`, register a Spotify app, `auth`, `compose up`, the
      positive check), each with expected output. ⚠️ The **coming soon** label **stays** until the walk passes
      (BR-74.6).
- [ ] `CONTRIBUTING.md`: a trap entry for the connector patch (where it is, why, when it goes) and the pin policy
      (NFR-40).
- [ ] `CLAUDE.md`: container name in the commands (`docker logs -f spotify-companion`); the pin and image-publishing
      facts where they belong; stays ≤ 200 lines.
- [ ] `src/api.ts:145,151`, `compose.verify.yaml:4`: "U9" → "U10" for the NAS (BR-75.3).
- [ ] The upstream proposal (an environment override for the config path) **drafted** to
      `construction/u9-connector-upgrade/code/upstream-proposal-draft.md`; not posted (BR-69.3).

### Step 11 — Positive controls and a local image build *(the guard-test table, LC-58/59/66)*
- [ ] `docker build` (new tag, **no `up`**): the connector stage runs the patched upstream suite on 22.23 and passes.
- [ ] Seen to fail, each in a throwaway build or run: a mutated `CONFIG_FILE` line · a missing `LICENSE` · a planted
      `secrets/spotify-config.json` in an image under `check-image.sh` · each structural test with a planted
      violation. Recorded in the code summary.

### Step 12 — Verify and summarise
- [ ] `npm run verify` green; test count recorded.
- [ ] `construction/u9-connector-upgrade/code/code-summary.md`: files modified and created, deviations, and the
      **owed-to-Build-&-Test list** (IN-U9-7: acceptance on `:3011` with rotation watch and negative control,
      rollback rehearsal, live crossing, tag push, token probe, walk).
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md`.

### Step 13 — Public-readiness review *(W-14; owner request 2026-10-18)*

The owner plans to make the repository public. This step **reviews and reports**; it changes no visibility. Going
public is the owner's exposure decision, made outside the unit (W-14).

- [ ] Re-run the **full-history secret scan** (gitleaks, the U8 pattern) on the branch tip; record the result.
- [ ] **Disclosure inventory** (W-14 item 2): where `aidlc-docs/`, tests and fixtures quote listening history (track
      and artist names with dates), the NAS's LAN address, personal email addresses and account names. Counted and
      listed per file, with the options *accept · redact going forward · rewrite history* for each class.
- [ ] **Licence and image readiness**: NFR-32's block is discharged once U9's acceptance passes (the image is MIT +
      GPL-clean); note what changes on going public (the GHCR package can be made public; FR-74's *private while the
      repository is* follows; GPL source availability is then met by the public repository).
- [ ] **After-going-public checklist** from W-14: private vulnerability reporting, `SECURITY.md`, ruleset review.
- [ ] Record: `construction/u9-connector-upgrade/code/public-readiness-review.md`, ending in a plain **ready / not
      ready, because …**, and tell the owner.

---

## Questions

### Question 1 — Where the code changes go

`main` is protected, and an agent commits only when the owner asks (CLAUDE.md).

A) ⭐ **A local branch `u9-connector-upgrade`** created now (it carries the uncommitted U9 design documents with it).
Nothing is committed until you ask; when you do, it is pushed and goes to `main` by pull request with CI green, which
also gives the `publish` job's `if` and the ruleset change a real CI run before any tag exists

B) Work on `main`'s working tree, uncommitted, and decide at the end

[Answer]: **A** (owner, 2026-10-18: *"Agree with both, and from here forward we should be using a standard (for a multi-dev project) github process for development"*). The branch is pushed and work arrives by pull request; recorded in `CLAUDE.md` *Git and CI*.

### Question 2 — ⚠️ A conflict in IN-U9-3: the acceptance test cannot be green before Build & Test

IN-U9-3 says a structural test checks that **both compose pins have a `pass` entry**. But the entry is written only
after BR-70 passes on `:3011`, which is Build & Test. With the pin moved in Step 2, `npm run verify` would be **red
from Step 2 until Build & Test**, against this plan's ordering rule.

A) ⭐ **Split the duty**: the structural test checks the file's **shape** (every entry has a full-SHA `pin`, an ISO
`date`, `result` `pass`|`fail`, and an existing `record` file); the **release** is what refuses an unaccepted pin
(P-74, LC-67), which is the point at which it matters. IN-U9-3 is amended to say so

B) Keep the test as designed and accept a red `verify` until Build & Test

C) Move the pin last (after Build & Test's acceptance). ⚠️ The acceptance would then run against code that does not
yet pin the new connector

[Answer]: **A** (owner, 2026-10-18). IN-U9-3 amended.

---

## Story traceability

| Story / requirement | Steps |
|---|---|
| **US-32** (FR-74, FR-75) | 2 (licences), 6 (name), 8 (publish), 9 (*App only*), 10 (README) |
| **FR-73** | 1, 2, 3, 4, 5, 7 (acceptance gate); the acceptance itself is Build & Test |
| **NFR-40** | 2, 6 (one pin), 7, 10 (CONTRIBUTING) |
