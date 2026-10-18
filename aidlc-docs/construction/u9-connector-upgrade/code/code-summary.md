# U9 Code Summary — Connector Upgrade & Publishable Image

**Date**: 2026-10-18 · **Plan**: [`u9-code-generation-plan.md`](../../plans/u9-code-generation-plan.md) (steps 1–12 done; step 13 is the
public-readiness review) · **Branch**: `u9-connector-upgrade`, draft PR #3 · `npm run verify` green, **1701 tests**
(1 skipped on Windows: the file-mode test, which **ran and passed on Linux CI**).

⚠️ **Nothing is deployed or released.** The live container is still `spotify-now-playing` on `1.0.0-beta.2` at the old
pin; `package.json` is still `1.0.0-beta.2`. All of that is Build & Test (below).

---

## What changed

**Created**: `compose.app.yaml` · `scripts/check-image.sh` · `scripts/connector-acceptance.json` (`[]`) ·
`scripts/lib/{patchConfigPath,publishDecision,connectorAcceptance}.ts` · `scripts/lib/loopbackHost.mjs` ·
`src/appOnly/{setup,setupCli}.ts` · `src/configuration/credentialsDirectory.ts` · tests: `patchConfigPath.property`,
`publishDecision.property`, `credentialsDirectory.property`, `appOnlySetup.property`, `loopbackHost.property`,
`connectorAcceptance`, `connectorSpawn`, `structure.u9`.

**Modified**: `Dockerfile` (pin default, patch, upstream tests, licences, labels, App-only files) · `.dockerignore` ·
`compose.yaml`, `compose.verify.yaml` (pin, names, directory mount, candidate/poll overrides) ·
`.github/workflows/ci.yml` (tag trigger, `publish` job) · `src/config.ts`, `src/mcp/spotifyMcpClient.ts`,
`src/nowPlayingService.ts`, `src/server.ts`, `src/configuration/{CredentialsWriter,atomicWrite,configurationDiagnostics}.ts`,
`src/api.ts` (comments) · `scripts/{auth,release,verify-install,mcp-setup,backup-history,probe-p-u5-1,probe-p-u5-1-step}.mjs`,
`scripts/docker-entrypoint.sh`, `scripts/post-boot-check.ps1`, `scripts/lib/releaseDecision.ts` · `knip.jsonc` ·
`README.md`, `docs/INSTALL.md`, `CONTRIBUTING.md`, `CLAUDE.md` · tests: `versionSources`, `releaseDecision.property`,
`rulesetMatchesWorkflow`, `atomicWrite`, `credentialsWriter`, `configurationDiagnostics`, `nowPlayingService`,
`noOrphanModules`, `propertyObligations`.

## Deviations from the plan (each recorded at its step)

1. **CI built upstream `main`, not the pin** (found in step 2): the Dockerfile defaulted to `main` and CI passed no
   ref. The default is now the pin, a checked copy. `npm run mcp:setup` also cloned `main`; it follows the pin now.
2. `compose.verify.yaml` has no pin (it runs an image by tag), so "one pin in both compose files" is **compose.yaml +
   the Dockerfile default**.
3. **`writeFileAtomic` keeps the target's permission bits** (step 5): a rename would otherwise widen a `600`
   credentials file. `probeFileWritable` removed (no caller left).
4. **`verify:up -- --candidate` and `--poll-ms`** added (step 7): without them BR-70 could not run before a release.
5. `publishDecision.ts` **imports nothing** (step 8): Node 22.23 cannot map `.js` → `.ts`, and `tsx` in the publish
   job would run install scripts beside the write token.
6. `setup` also writes **`config/rules.json`** (step 9), as `npm run rules:init` does for a source install.
7. The sign-in's `Host` check is a **dependency-free copy** of `localGuard`'s, held equal by a property test (step 9).
8. ⚠️ **Incident** (step 9): a command meant as a syntax check ran `auth.mjs` on the host; stopped within a minute,
   nothing written (`audit.md` 2026-10-18T21:45).

## Positive controls seen to fail

| Guard | How it was made to fail |
|---|---|
| Patch guard (build) | Minimal build with upstream's `CONFIG_FILE` line mutated → build exit 1, *"found it 0 time(s)"* |
| Patch CLI | Re-run on an already-patched file (Node 22.23) → refused |
| Licence check (build) | Minimal build with the Dockerfile's exact check and an empty connector licence → exit 1, *BR-73.3* message |
| `check-image.sh` | Image with a planted `app/secrets/spotify-config.json` and the MIT licence removed → both caught, exit 1 |
| Loopback copy ≡ `localGuard` | Copy mutated to accept `evil.com` → property test red (counterexample `"evil.com"`), restored → green |
| Sign-in listener | In a real container with FAKE credentials: LAN `Host` → 403; wrong `state` → abort, file untouched |
| Structural, release, publish, setup, credentials-directory tests | Each carries its own planted-violation case or ⭐ positive-control property |
| Two of my own test bugs | A success check (`!('refused' in r)`) that would pass whatever happened; two quoting slips. Fixed before commit |

(Two first attempts at the build controls were **invalid**: one did not mutate the line, one failed for an unrelated
reason. Both were redone with the failure *reason* asserted, not just the exit code.)

## Owed to Build & Test (IN-U9-7, in order)

1. **CI green on PR #3** at the final commit.
2. **Version**: bump `package.json` (and the three compose image tags) to **`1.0.0-beta.3`** in its own commit.
3. **Acceptance on `:3011`** (BR-70): `npm run verify:up -- --candidate --probe-credentials --poll-ms 3000`, at least
   50 minutes beside live: a forced refresh and a **proactive** refresh seen in the **host** file; `refreshToken`
   compared with live's after every refresh (stop on any difference); now-playing parsed while a track plays; a play
   recorded; P-U7-1 re-run; the **`EBUSY` negative control** (the old single-file mount). Record → entry in
   `scripts/connector-acceptance.json`.
4. **The startup check in a real container**: the new image with the old compose file shows *single-file* on the
   Spotify indicator and in diagnostics (P-68).
5. **The crossing, rehearsed on `:3011`**, and the **rollback** to `1.0.0-beta.2` (BR-71.3/71.4); `verify:down`'s
   no-impact proof.
6. **Live crossing** (owner present, owner's go-ahead): `npm run release -- --apply` **seen to refuse** while
   `spotify-now-playing` runs → owner stops it → release deploys `spotify-companion:1.0.0-beta.3` → a play recorded.
7. **First tag push** (owner's act) → `publish` runs: its first real run of the Trivy step, the registry check, and
   the push; then pull it back and check both licences.
8. **Token probe** (IN-U9-6): does a fine-grained token pull from GHCR? Then the walk guide, and the **agent walk** of
   README *App only* on `Machine 1` (incl. the real sign-in success path, BR-74.4) → on a pass, *coming soon*
   comes off.
9. Mark NFR-32 and R8 discharged (BR-73.5) once 3 and 7 are done.
