# U9 Logical Components — Connector Upgrade & Publishable Image

**Unit**: U9 · **Date**: 2026-10-18 · Patterns: [`nfr-design-patterns.md`](nfr-design-patterns.md)
**Allocates**: **LC-58…LC-68** · **PBT-73…PBT-78**

The project's shape holds: a **pure decision module** that is property-tested, and a thin **impure shell** (a
script, a Dockerfile step or a CI step) around it. Files named here are where the component is expected to live;
Infrastructure Design and Code Generation may refine the paths, not the split.

---

## Components

| ID | Component | Where | Kind | Patterns / rules |
|---|---|---|---|---|
| **LC-58** | **Config-path patch**: count, replace, count again; refusal with a reason | `scripts/lib/patchConfigPath.ts`, run by a Dockerfile step in the connector build stage | ⚙️ pure + build step | P-65 · BR-69.1 |
| **LC-59** | **Connector build stage**: fetch at the pin, LC-58, `npm ci`, build, **upstream's `npm test`**, prune; copy `LICENSE` to runtime | `Dockerfile` | build | P-66 · BR-68.3, BR-73.1 |
| **LC-60** | **Credentials location**: one constant for the container's credentials directory and the two file paths in it; the connector spawn passes `SPOTIFY_CONFIG_PATH` from it | `src/config.ts`, `src/mcp/spotifyMcpClient.ts` | config | P-67 · BR-69.4/69.5 |
| **LC-61** | **Credentials-directory check**: classify `ok` / `not-mounted` / `not-writable` / `single-file`; feeds the Spotify indicator and diagnostics; blocks spawning the connector on anything but `ok` | `src/configuration/` (beside `atomicWrite.ts`, reusing `probeDirectoryWritable`) | ⚙️ pure classifier + probes at the edge | P-68 · Q5 = A |
| **LC-62** | **`CredentialsWriter` on rename**: both files written temp-then-rename in the directory; in-place path retired for them; no temp left after a failure | `src/configuration/` | impure | P-67 · BR-69.6 |
| **LC-63** | **Structural tests**: no old name outside the allow-list; one full-SHA pin in both compose files; no upstream feature variables; `publish` is not a required check | `test/` (the `versionSources` / `rulesetMatchesWorkflow` family) | test | P-69, P-70 · BR-68.1/68.2, BR-71.1 |
| **LC-64** | **Publish decision**: given the tag, `package.json`'s version and whether the registry has that tag → `publish` or `refuse(reason)` | `scripts/lib/publishDecision.ts` (run in CI with the tsx loader) | ⚙️ pure | P-70, P-71 · BR-72.2/72.3 |
| **LC-65** | **`publish` job**: tag trigger, `needs` the three jobs, tag `concurrency`, `packages: write` only here, SHA-pinned checkout + `docker` CLI; LC-64, then build, LC-66, push | `.github/workflows/ci.yml` | CI | P-70, P-71 · BR-72 |
| **LC-66** | **Image checks**: licences, no secrets or user data, base digest and Node version into labels and summary, pinned scanner (report only) | a script run by LC-65 against the built image | CI | P-72 · BR-72.7, BR-73 · Q3 = A, Q4 = A |
| **LC-67** | **Release guards**: the crossing guard (old container running → refuse) and the acceptance gate (pin moved without a passing record → refuse), as pure decisions inside the existing release decision | `scripts/lib/releaseDecision.ts` (extends LC-50), `scripts/release.mjs` | ⚙️ pure + shell | P-74, P-75 · BR-70, BR-71.2 |
| **LC-68** | **App-only entry points**: the entrypoint dispatches `setup` (write the folder, refuse to overwrite) and `auth` (run `auth.mjs` bound inside the container, loopback-`Host` check); default starts the app | `scripts/docker-entrypoint.sh`, an image-only compose template, `scripts/auth.mjs` | impure + ⚙️ pure overwrite decision | P-73 · BR-74.2/74.3 |

**Host development path (`npm start`) is unchanged**: it runs a local, **unpatched** connector checkout with no
mount, where rename works. An unpatched connector ignores `SPOTIFY_CONFIG_PATH`, so passing it is harmless there.

## Guard tests (example-based, each seen to fail once)

| Guard | Positive control |
|---|---|
| Connector build fails when the patch line is changed or duplicated (LC-58 in LC-59) | Build run on a mutated source, seen to fail |
| Build fails when a `LICENSE` is missing (LC-59, LC-66) | One removed in a throwaway build, seen to fail |
| Image check fails on a planted `secrets/spotify-config.json` (LC-66) | A throwaway image with the file, seen to fail |
| The structural tests (LC-63) | Each fed a planted violation, seen to fail |
| The crossing guard (LC-67) | Run with a container named `spotify-now-playing` running on the verification install, seen to refuse |

## Property-based tests (NFR-20/21: seeds logged)

| ID | Property | Covers |
|---|---|---|
| **PBT-73** | For any source with the original `CONFIG_FILE` line occurring **0 or ≥ 2** times, LC-58 **refuses**, and the reason names the count | LC-58 · BR-69.1 |
| **PBT-74** | ⭐ **Positive control**: for any source with **exactly one** original line (surrounded by arbitrary other lines), LC-58 **succeeds**, the result has exactly one patched line and **no** original line, and every other line is unchanged | LC-58 |
| **PBT-75** | LC-64 publishes **only** when the tag is exactly `v` + version **and** the registry lacks it; for every other combination it refuses. Includes the ⭐ positive control: any valid version not yet published **is** published | LC-64 · BR-72.2/72.3 |
| **PBT-76** | LC-61's classifier: every combination of probe answers maps to exactly one class, and **only** *mounted directory + writable* maps to `ok` | LC-61 · P-68 |
| **PBT-77** | LC-67's crossing guard refuses whenever Docker reports a running `spotify-now-playing` **or** cannot be asked; with neither, it does not block (positive control) | LC-67 · BR-71.2 |
| **PBT-78** | LC-68's `setup` decision: for any set of files already in the target folder, it writes **nothing** if any target file exists and names each one; with none existing it writes **all** (positive control) | LC-68 · BR-74.2 |

## What is not a component

- **No scanner gate**: the scan reports and never blocks (Q3 = A).
- **No base digest pin**: the patch floats and is recorded (Q4 = A).
- **No new runtime dependency** in the app. The scanner is a CI binary, pinned by checksum.
