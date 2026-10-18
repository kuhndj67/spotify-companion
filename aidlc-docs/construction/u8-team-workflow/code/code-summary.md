# U8 Code Generation — summary

**Date**: 2026-10-14 · Plan: [`u8-code-generation-plan.md`](../../plans/u8-code-generation-plan.md) — all 12 steps done.
**`npm run verify` green**: typecheck · **1631 tests** (from 1612 at Step 8; 1565 at U7) · smoke · knip.
**Nothing outward-facing was done**: no push, no `gh api` write, no issue posted, nothing deployed.

## Files

| Created | |
|---|---|
| `.gitleaks.toml` | allow-list, two entries, each with a reason |
| `.github/workflows/secret-history.yml` | weekly + manual full-history scan |
| `.github/rulesets/main.json` | the `main` ruleset (3 required checks, owner bypass) |
| `scripts/protect.mjs` | `--plan` / diff (read-only) / `--apply` with read-back |
| `scripts/lib/releaseDecision.ts`, `scripts/release.mjs` | pure decision + shell (`--plan` default, `--apply` never pushes) |
| `src/version.ts` | the one version reader |
| `LICENSE` (GPL-3.0, gnu.org, SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`), `SECURITY.md`, `CONTRIBUTING.md`, `docs/INSTALL.md` | documents |
| `test/secretsTracked`, `rulesetMatchesWorkflow`, `version.property`, `versionSources`, `releaseDecision.property`, `docs` | guards and properties |
| `code/secret-history-scan-2026-10-14.md`, `code/mcp-licence-issue-draft.md` | records |

| Modified | |
|---|---|
| `.github/workflows/ci.yml` | smoke (labelled LOAD check), knip, new `Secret scan` job; test job **renamed** |
| `package.json` (+ lock) | `0.8.0`, `GPL-3.0-or-later`, `protect`, `release` |
| `compose.yaml`, `compose.verify.yaml` | image `0.8.0`; compose.yaml host port `${SPOTIFY_COMPANION_PORT:-3010}` |
| `src/config.ts`, `src/configuration/CredentialsWriter.ts`, `src/mcp/spotifyMcpClient.ts`, `src/server.ts` | version from `src/version.ts`; legacy `appVersion` ignored on read, dropped on rewrite |
| `src/api.ts`, `src/diagnostics.ts`, `public/app.js`, `public/index.html`, `public/styles.css` | version display |
| `secrets/musicbrainz.example.json` | `appVersion` removed |
| `scripts/smoke-entry-points.mjs`, `knip.jsonc` | new scripts registered; `scripts/**/*.ts` in knip's project |
| `scripts/auth.mjs`, `scripts/rules-init.mjs` | stale "next step" / "U4/U5" messages corrected (BR-67.5) |
| `README.md` (463 → 38 lines), `CLAUDE.md` (1198 → 146), `test/credentialsWriter`, `configurationRoutes`, `propertyObligations` | |

## Deviations from the plan (each recorded at its step)

1. **Step 2**: the tracked-secrets positive control runs on a path list (a pure function), not a temp git repo.
2. **Step 3**: the test job was renamed **`Typecheck, test, smoke, knip, build`**, because it now runs smoke and knip.
   Nothing pinned the old name yet.
3. **Step 4**: `protect` has three modes, not two. **`--plan`** (no network) is what smoke runs. The bypass is
   `always`, so **the positive control must be a merge attempted WITHOUT `--admin`**.
4. **Step 5**: `CredentialsWriter` **drops** a legacy `appVersion` when it rewrites the file (BR-66.2, *never written
   again*). One test expectation changed.
5. **Step 7**: the decision has **two extra refusals**: `tree-dirty` (a release is a commit) and `build-metadata`
   (`+` is not a legal Docker tag character). Mutation check: removing *strictly greater* fails PBT-68 and PBT-69.
   Changing `<=` to `<` fails nothing, and that is **correct**: an equal version is the same string, and the earlier
   *tag exists* check already refuses it.
6. **Step 8**: the version rides on `GET /api/settings/credentials`, **including its 503**, which Settings always
   calls. Diagnostics gains a **Version** step: `App version X · Database schema vN`.
7. **Step 11**: three probes settled, and one compose change resulted:
   - ⚠️ **A missing single-file bind source becomes a directory on the host** (probed with throwaway project
     `u8probe` on Rancher Desktop). So **both secrets must exist before the first `compose up`**: S4 stays before
     S7, and S7 checks for it.
   - **`npm run auth` runs without prompts** when `secrets/spotify-config.json` already holds the id and secret.
     That makes S4 workable for an agent; the person only approves in the browser.
   - **The port**: `compose.yaml` now reads `${SPOTIFY_COMPANION_PORT:-3010}` (probed from `.env` and from the
     shell). `localGuard` checks host names, never the port. `docker compose config` still resolves to 3010, so the
     live deployment is unchanged.
   - **Linux** (not walked): the entrypoint chowns only `/data` and the Spotify config, so `config/`, `state/` and
     `musicbrainz.json` need uid 1000. Written as *not yet walked (U9)*.

## Owed to Build & Test (not done here)

1. **Release `0.8.0`**: commit, `npm run release` (`--plan`, then `--apply`), deploy. Rollback image
   **`spotify-now-playing:0.1.0`**, confirmed present.
2. **Click-test and LOOK** at the version line in Settings and the Version diagnostics step on the deployed image.
3. **Push**, then **`npm run protect -- --apply`**, then **the positive control**: a throwaway PR that breaks one
   check; `gh pr merge` **without `--admin`** must be refused; then close it (BR-63.5).
4. First CI run: the `Secret scan` job and a manual run of `secret-history.yml` both green.
5. **Post the MCP licence issue** (owner) — see the draft's note about the private-repo link.
6. **The walk guide** (Build & Test instructions), including IN-U8-3's token guide verbatim.
7. **VM work** (owner): base B1–B7, inventory, `clean` + revert control, then the canary probe C0–C3.
8. **Walk ①** on `Machine 1` from tag `v1.0.0-beta.1` → if it passes, release `1.0.0-beta.1`.
