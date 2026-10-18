# U9 Business Rules — Connector Upgrade & Publishable Image

**Unit**: U9 (Phase 5) · **Date**: 2026-10-18 · **Settled answers**: [`u9-functional-design-plan.md`](../../plans/u9-functional-design-plan.md) §3, §3a
**Requirements**: FR-73, FR-74, FR-75 · NFR-40 · NFR-28, NFR-32, NFR-34 · **Story**: US-32 (FD Q9 = A)
**Numbering**: BR-68…BR-75 (U8 ended at BR-67)

U9 has two halves. The first, **the move**, is maintenance: keep the one path this app uses from the connector (the
now-playing text and token refresh) working across 17 upstream commits, and adopt nothing else. The second, **the
image**, is distribution: once the connector is licensed, the built image may leave this machine, and it has to
leave carrying its licences, no secrets and one name.

**Supersedes in U8**: **BR-61.8** ("never pulls a published image") and **BR-65.2** ("no built image is
published"), for the *App only* path. The source install (`docs/INSTALL.md`) still builds its own image.
⚠️ **BR-66.5**'s "until U9 completes" was written with the old numbers and means the NAS unit, now **U10**. U9 does
**not** remove the `u4/u5/u6-rollback` tags.

---

## Facts this design rests on (measured 2026-10-18; plan §2)

| # | Fact | Consequence |
|---|---|---|
| G1 | `getNowPlaying`'s handler body is **byte-identical** at `7b5fde63` and `6065ce5c`, and it is the only tool the app calls | The parser is not expected to change. It is still checked live (BR-70) |
| G2 | The v2 server answers our v1 client's protocol `2025-11-25` and lists 31 tools, on Node 22.23 | The client stays on `@modelcontextprotocol/sdk` v1 (BR-68.5) |
| G3 | Upstream declares Node `>=26.8.1`; its connector **builds** on 22.23 with `EBADENGINE` warnings only | Q1 = A, guarded by BR-68.3 |
| G4 | 🔴 `rename` onto a single-file bind mount → **`EBUSY`**, host file unchanged | Upstream's atomic write fails on every refresh as mounted today → BR-69 |
| G5 | The connector's config path is fixed (`<package root>/spotify-config.json`), with no override | The build-time patch, BR-69.1 |
| G6 | *Read from source, not probed*: upstream still forces a refresh for U7's placeholder token, and caches its client in memory, keyed by token | U7's BR-56.4/56.5 are expected to hold → re-probed as BR-70.5 |
| G7 | `auth.mjs` uses only Node built-ins and listens on `127.0.0.1` | It can run in the image, but must bind inside the container → BR-74.3 |

---

## BR-68: The pin move (FR-73, NFR-40, Q1 = A)

| # | Rule | Source |
|---|---|---|
| **BR-68.1** | The connector is pinned by **full SHA** to `6065ce5cdef13ffeb43042e295bb788ce7ad00df` in **both** compose files. The comment beside the pin states the commit, its date and that it is **MIT**; R7's reason for pinning (no release tags, a moving `main`) still applies | NFR-40 |
| **BR-68.2** | ⚠️ **Nothing new from upstream is switched on.** The connector runs over **stdio** only. None of its new environment variables (HTTP transport, `MCP_AUTH`) is set anywhere, and the image publishes **no** connector port. A test fails if any of them appears in a compose file or the Dockerfile | Q26 = X |
| **BR-68.3** | **The whole image stays on Node 22.23** (the `node:sqlite` `backup()` pin). The connector build stage **runs upstream's own test suite** on 22.23; a failure **fails the build**. So a future pin that really needs Node 26 stops at build time, not in the running app. ⚠️ If upstream's tests themselves cannot run on 22.23, that is brought to the owner; tests are never skipped to get a green build | Q1 = A |
| **BR-68.4** | The `EBADENGINE` warnings are **expected** and named in a Dockerfile comment, with the reason. Any other new warning from the connector build is looked at, not ignored | G3 |
| **BR-68.5** | The app's MCP **client** is not upgraded in U9: v1 speaks to the v2 server (G2). Moving the client is separate work | Q26 = X |
| **BR-68.6** | **Moving the pin again** (NFR-40) repeats **all of BR-70** on the verification install. Dependabot never moves it. CI's PBT-66 (U7) still fetches the connector source **at the pinned ref**, so it scans what ships | NFR-40, Q28 = A |

## BR-69: The config write (Q2 = A, Q3 = A)

| # | Rule | Source |
|---|---|---|
| **BR-69.1** | **One build-time patch, guarded.** The Dockerfile replaces the connector's single `CONFIG_FILE` line so the path is `process.env.SPOTIFY_CONFIG_PATH`, falling back to upstream's own path. The build **fails** unless the original line is found **exactly once** before the patch and the patched line exactly once after. ⚠️ **Positive control**: the guard is seen to fail on a source where the line is changed or duplicated | Q2 = A, G5 |
| **BR-69.2** | The patch is the **only** divergence from upstream. It is listed in one place (a Dockerfile comment, cross-referenced from CONTRIBUTING's traps), with the condition for removing it: upstream accepts an equivalent override, the pin moves to that commit, the patch goes | NFR-40 |
| **BR-69.3** | The upstream proposal (an environment override for the config path) is **drafted** by Claude and **posted only on the owner's go-ahead**; outward-facing | project rule |
| **BR-69.4** | **The host's `./secrets/` directory is mounted read-write as a directory** at one container path. `spotify-config.json` and `musicbrainz.json` are read and written there by the connector and the app alike. The **host paths do not change** (`secrets/spotify-config.json`, `secrets/musicbrainz.json`), so `npm run auth`, `docs/INSTALL.md` and every existing install keep working | Q3 = A |
| **BR-69.5** | ⚠️ **The connector receives `SPOTIFY_CONFIG_PATH` explicitly.** The app spawns the connector, and an MCP stdio client passes only a minimal environment to its child, so the variable is set in the spawn arguments, not inherited (checked 2026-10-18 in the installed SDK: the child gets `getDefaultEnvironment()` plus the caller's `env`; `spotifyMcpClient.ts` passes no `env` today). *Seen working* means the **host file** changes after a refresh (BR-70.1), not just that no error appeared | G5 |
| **BR-69.6** | **`CredentialsWriter` writes both files atomically** (temp file in the same directory, then rename), now that they are in a directory mount. The in-place path and the in-place write probe are retired for these two files; the startup check becomes *can this directory be written*. A failed write leaves **no temp file** behind (FR-62's principle) | Q3 = A |
| **BR-69.7** | **Two writers, unchanged.** The connector (refresh) and `CredentialsWriter` (Settings) both write `spotify-config.json`, as in U7. Atomic rename makes each write whole; it does **not** order them. U7's BR-56.5 (close the connector after a save) still governs, and BR-70.5 re-proves it | U7 BR-56.5 |
| **BR-69.8** | **No secret is ever in an image.** `secrets/`, `data/`, `config/` and `state/` are excluded from the build context, and the published image is checked for any file under a `secrets` path other than examples (BR-72.7) | NFR-28 |

## BR-70: Acceptance on the verification install (FR-73)

The new pin reaches the live deployment **only after every item below is seen on `:3011`**. Each is a positive
observation; "no errors" passes nothing.

| # | Rule | Source |
|---|---|---|
| **BR-70.1** | **A token refresh lands**: after a forced refresh, the **host** file's `accessToken` and `expiresAt` have changed, and the container's next call uses the new token. Then across one **proactive** refresh (upstream's 45-minute timer), the same is seen again | FR-73(a) |
| **BR-70.2** | ⚠️ **Negative control for BR-70.1**: with the patch's variable unset (the old single-file path), the same refresh is seen to **fail with `EBUSY`**. The acceptance can fail, so its pass means something | project rule |
| **BR-70.3** | **Now-playing parses**: with a track playing, the parsed title, artist, album and progress match what Spotify shows; the nothing-playing case reads as healthy, not as a failure (FR-71). Property tests are updated only if the text changed (G1 predicts it has not) | FR-73(b) |
| **BR-70.4** | **PBT-66 passes against the new source.** If the new upstream files (HTTP, OAuth) add `Error …` templates that never reach stdio, the test's scope is stated, not silently widened | FR-73(b) |
| **BR-70.5** | **U7's credential save still works at the new pin**: probe **P-U7-1** re-run (the four values, placeholder token, `expiresAt: 0` → the first poll refreshes and records a real token, now written by rename into the directory mount) | G6 |
| **BR-70.6** | **A play is recorded end to end** in the verification install's own database | FR-73(d) |
| **BR-70.7** | Each result is recorded with the date, the version, what was observed and against what expectation. An unrecorded check did not happen | project rule |

## BR-71: One name, and crossing to it (FR-74, Q4 = A)

| # | Rule | Source |
|---|---|---|
| **BR-71.1** | **Everything is `spotify-companion`**: local image `spotify-companion:<version>`, container `spotify-companion`, compose service `spotify-companion`, the verification install `spotify-companion-verify`, the registry `ghcr.io/kuhndj67/spotify-companion`. Docs, scripts and `CLAUDE.md` follow. `spotify-now-playing` survives only in history and in old images | owner, 2026-10-18 |
| **BR-71.2** | ⚠️ **The crossing is guarded, not remembered.** `npm run release -- --apply` **refuses** while a container named `spotify-now-playing` is **running**, and prints the one command that stops it. Two containers polling Spotify and writing `data/history.db` is the failure this prevents | CLAUDE.md trap |
| **BR-71.3** | The crossing is **rehearsed on the verification install first** (`spotify-now-playing-verify` → `spotify-companion-verify`), and `npm run verify:down`'s proof that the live deployment is unchanged still holds afterwards | Q4 = A |
| **BR-71.4** | **Rollback across the crossing**: going back to `1.0.0-beta.2` means its image **and** its compose file (from tag `v1.0.0-beta.2`), with `spotify-companion` stopped first. Because the host files did not move (BR-69.4), rollback moves no files. Rehearsed on `:3011` | BR-66.5 |
| **BR-71.5** | Existing `spotify-now-playing:*` images are **kept, never re-tagged** under the new name: a re-tag would claim a build that never had that name (BR-66.7's principle) | BR-66.7 |
| **BR-71.6** | `docs/INSTALL.md` gets an **upgrading from `1.0.0-beta.2`** note: stop the old container, then start as usual | Q4 = A |

## BR-72: Publishing (FR-74, Q6 = A)

| # | Rule | Source |
|---|---|---|
| **BR-72.1** | **CI publishes, on a pushed `v*` tag.** A workflow checks out the **tagged commit**, runs the same checks as `main` (`npm run verify`, the container build), and only then builds and pushes the image. Pushing the tag is the **owner's** act (outward-facing); `npm run release` still tags locally and does not push | Q6 = A |
| **BR-72.2** | The tag must equal **`v` + `package.json`'s version**, or the workflow fails before building. The image tag is that version (NFR-34) | NFR-34 |
| **BR-72.3** | ⚠️ **A published tag is never overwritten.** If `<version>` already exists in the registry, the workflow **fails**. A changed build is a new version | BR-66.7 |
| **BR-72.4** | **No floating tag** (`latest` or similar). A floating tag is overwritten by definition; users name a version | BR-66.7 |
| **BR-72.5** | The write credential is the workflow's own short-lived `GITHUB_TOKEN`, with `packages: write` granted **only to the publishing job**. No long-lived write token exists on any machine | Q6 = A |
| **BR-72.6** | **Platform: `linux/amd64` only**, the platform of every consumer U9 has (this PC, CI, the walk VM). Other architectures are U10's decision | Q5 withdrawn |
| **BR-72.7** | **The image is checked before it is pushed**: both licence files present (BR-73), no file under a `secrets` path other than `*.example.json`, and no `data/`, `config/` or `state/` content. A failed check pushes nothing | NFR-28, Q7 = A |
| **BR-72.8** | The package is **private while the repository is private**, and linked to the repository (the OCI `source` label), so the repository's access decides who can pull | Q27 = A |
| **BR-72.9** | The local deployment still **builds from source** (`npm run release`). The published image is built by CI from the same commit; the two are the same source, not the same bytes | Q6 = A |

## BR-73: Licence notices (FR-74, Q7 = A)

| # | Rule | Source |
|---|---|---|
| **BR-73.1** | The image carries **this app's `LICENSE`** (GPL-3.0) at `/app/LICENSE` and **the connector's `LICENSE`** (MIT, Marcel Marais) at `/opt/spotify-mcp/LICENSE`, unmodified | Q7 = A |
| **BR-73.2** | OCI labels: `org.opencontainers.image.licenses="GPL-3.0-or-later AND MIT"`, plus `source`, `revision` (the commit) and `version` | Q7 = A |
| **BR-73.3** | The build **fails** if either `LICENSE` file is missing from the image. ⚠️ Positive control: seen to fail with one removed | Q7 = A |
| **BR-73.4** | Third-party dependencies ship their **own** licence files inside `node_modules`, which the image copies whole. A test confirms nothing in the build strips them (no prune or ignore rule removes `LICENSE*` files) | Q7 = A |
| **BR-73.5** | `requirements.md` NFR-32 and risk R8 are marked **discharged** once BR-70 passes and the first image is published with BR-73.1 | NFR-32, R8 |

## BR-74: *App only* (FR-75, US-32, Q10 = A, Q11 = A)

| # | Rule | Source |
|---|---|---|
| **BR-74.1** | **One credential.** An *App only* user needs only a **GHCR read token** and Docker. Never Node, never the source, never a second credential to read repository files | Q11 = A |
| **BR-74.2** | **The image sets up its own folder.** One `docker run` command writes into the current folder: an **image-only** `compose.yaml` (no `build:`, pinned to the image's own version), `secrets/musicbrainz.json` from its example, and empty `config/`, `data/`, `state/`. It **refuses to overwrite** any existing file and says which (as `npm run rules:init`) | Q11 = A |
| **BR-74.3** | **The image runs the Spotify sign-in.** One `docker run` command runs `auth.mjs`: its callback listener binds **inside** the container, and the port is published **only on the host's `127.0.0.1`** (the app's own pattern). The sign-in link is **printed**, since a container cannot open the host's browser. It writes `secrets/spotify-config.json` through the directory mount (BR-69.4) | Q10 = A |
| **BR-74.4** | ⚠️ **The redirect URI does not change**: `http://127.0.0.1:<port>/callback`, so a Spotify app registered for the source install works unchanged. To be **probed** before it is written into the steps | Q10 = A |
| **BR-74.5** | The *App only* steps follow BR-61.1's shape: purpose, command, **expected output**, what to do if it differs. They end with BR-61.6's positive check (UI responds, Spotify indicator **ok**, a play recorded) | BR-61 |
| **BR-74.6** | **Walked before the label comes off**: an agent walk on `kuhndjwin11pro` from its `clean` checkpoint, given **only** README *App only* and a read token, under BR-62's rules (any step needing outside knowledge fails the walk; the walk is recorded). README's *coming soon* is removed only when that walk passes | Q8 = A |
| **BR-74.7** | Automation is **off** at the end of an *App only* install (BR-61.9) | FR-47 |

## BR-75: Release and records

| # | Rule | Source |
|---|---|---|
| **BR-75.1** | U9 ships as the next **`1.0.0-beta.N`** (NFR-34): a change existing users act on (the rename crossing) during beta | NFR-34 |
| **BR-75.2** | `CHANGELOG`-style notes for the release state the **rename crossing** and the **mount change** first, because they are what an existing user must act on or know | BR-71.6 |
| **BR-75.3** | The code comments that still call the NAS "U9" (`src/api.ts`, `compose.verify.yaml`) are corrected to U10 | renumbering, 2026-10-18 |
