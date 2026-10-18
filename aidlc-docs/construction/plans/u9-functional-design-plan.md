# U9 Functional Design Plan — Connector Upgrade & Publishable Image

**Date**: 2026-10-18 · **Stage**: CONSTRUCTION — Functional Design, Unit **U9** (Phase 5)
**Status**: Q1–Q9 answered 2026-10-18 (Q1 A · Q2 A · Q3 A · Q4 A · Q5 withdrawn, U10's · Q6 A · Q7 A · Q8 A · Q9 A). Follow-ups **Q10 A · Q11 A** (§3a, 2026-10-18). ✅ **ALL ANSWERED.** ▶ FD artifacts written: `construction/u9-connector-upgrade/functional-design/`.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: `unit-of-work.md` §U9 · requirements **FR-73…75**, **NFR-40**, NFR-28, NFR-32, NFR-34 · Requirements
Questions 26–28 · U8 as built (release script, CI, `:3011` verification install, the walk method)

> **The scope is the move, not the features** (Q26). U9's "business logic" is small: keep the one path this app uses
> (now-playing text and token refresh) working across 17 upstream commits, then make the built image something that
> may legally and safely leave this machine. The probes below already settle most of it. What is left is where the
> upstream change collides with how this app is mounted, and how a published image is made and named.

---

## 1. Unit context

| | |
|---|---|
| **Phase** | 5 — build order U6 → U7 → U8 → **U9** → U10 → U11 |
| **Settled already** | Pin target `6065ce5c` (MIT) · no upstream features adopted (Q26 = X) · CI publishes `ghcr.io/kuhndj67/spotify-companion:<version>` on release tags, private while the repository is (Q27 = A) · keep pinning, no fork, Dependabot excluded (Q28 = A) · **one name, `spotify-companion`** (FR-74, owner 2026-10-18) |
| **Gates** | **U10** — the NAS pulls U9's image |
| **Stories** | None yet — Q9 |

---

## 2. Facts measured for this plan — 2026-10-18

All probes were run against upstream at `6065ce5c`, read-only, in throwaway containers. The live deployment was not
touched.

| | |
|---|---|
| **Upstream `main`** | `git ls-remote`: `6065ce5c` = `main` today. 16 commits after our pin, then the licence commit |
| ✅ **`getNowPlaying` output is unchanged** | The handler body is **byte-identical** at both commits; only its wrapper changed (`defineTool`). It is the **only** tool this app calls (`src/mcp/spotifyMcpClient.ts:107`). The "[E] explicit" and album-name changes (`10e11f0`) touch track **listings**, not now-playing. ⚠️ So FR-73(b) is expected to hold; it is still checked live, and PBT-66 still runs |
| ✅ **MCP v2 talks to our v1 client** | Upstream moved from `@modelcontextprotocol/sdk@^1.10` to `@modelcontextprotocol/server@^2.3.1` + `node@^2.1.1`. Our client is `@modelcontextprotocol/sdk@^1.12.0`. Probe: the new server answered our client's protocol version **`2025-11-25`** with `2025-11-25` and listed **31 tools**, `getNowPlaying` among them. Not yet probed: a `getNowPlaying` **call** with credentials (needs `:3011`) |
| ⚠️ **Upstream now declares Node `>=26.8.1`** | Its `package.json` `engines`, its Dockerfile (`node:26-alpine`) and its CI (`node-version: 'node'`, latest Current) all target **Node 26**. Our image builds and runs everything on **Node 22.23**, pinned for `node:sqlite`'s `backup()` (U6, IN-U6-1). The MCP v2 libraries themselves declare `node >=20`. Probe: the connector stage **builds on 22.23** (npm prints `EBADENGINE` warnings, does not fail) and the built server **runs and handshakes** on 22.23. ⚠️ Running outside upstream's declared range is a standing risk — Q1 |
| 🔴 **The atomic config write FAILS on our mount** | Upstream `b56bb07` replaced the in-place write with **temp file + `rename`** (`writeFileAtomic`, `src/utils.ts`). Its path is still fixed: `CONFIG_FILE = <package root>/spotify-config.json` = `/opt/spotify-mcp/spotify-config.json`, **no environment override**. `compose.yaml` mounts that as a **single file**. Probe (node 22.23, a throwaway single-file bind mount): `rename` → **`EBUSY: resource busy or locked`**; the host file is **unchanged**. So at the new pin **every token refresh fails** (loudly, an error, not a silent detach). Without a fix the app stops working within an hour of a deploy — Q2, Q3 |
| Token refresh | Upstream now **serialises** refreshes and still refreshes proactively every 45 minutes in stdio mode (`index.ts`). Our `webApiClient` reads the file and **never writes** it (`src/spotify/webApiClient.ts:7`); `CredentialsWriter` (U7) writes it **in place** because of the single-file mount (`src/configuration/atomicWrite.ts:11`) |
| **Names today** | Repository and package: `spotify-companion`. Image and container: **`spotify-now-playing`**, compose service **`now-playing`**. CI already builds `spotify-companion:ci`. About 18 files outside `aidlc-docs/` use the old name |
| Licences | This app: `GPL-3.0-or-later` (`package.json`, `LICENSE`). Connector: **MIT** (`LICENSE` at `6065ce5c`, Marcel Marais). The runtime stage copies the connector's `build/`, `node_modules/` and `package.json` only, **not** its `LICENSE` — an image built today would ship MIT code without its notice |
| CI | `ci.yml` runs on push/PR; Node 22; builds `spotify-companion:ci` but **pushes nothing**. No workflow reacts to tags. `npm run release -- --apply` tags locally and does **not** push (U8) |
| Version | `1.0.0-beta.2`. NFR-34: a fix or feature release before `1.0.0` is the next **`1.0.0-beta.N`** |

---

## 3. Questions

### Q1 — Which Node runs the connector, given upstream now targets Node 26?

| | Option |
|---|---|
| **A** | ⭐ **Keep Node 22.23 for the whole image**, outside upstream's declared range, on the evidence above. Make the evidence stronger and repeatable: the connector build stage **runs upstream's own test suite** (`node --test`, including its `config-write` test) on 22.23, so a pin move that needs Node 26 **fails the build** rather than the app. Revisit when the app itself moves to Node 26 |
| **B** | **Two Node versions in one image**: the connector built and run on Node 26, the app on 22.23 (the connector's `node` binary copied into the runtime stage, `MCP_SERVER_ENTRYPOINT` run by it). Inside upstream's range; a second runtime to patch |
| **C** | **Move the whole app to Node 26.** One runtime, inside the range. ⚠️ Beyond Q26's "the move only": `node:sqlite` (experimental, R10) and `backup()` must be re-probed on 26, and the host path (`npm start`, CI) moves too |

[Answer]:
A
---

### Q2 — How does the connector's config write survive the mount? (🔴 the `EBUSY` above)

The connector writes `<package root>/spotify-config.json` by rename, and the path cannot be configured. A rename
works only when the **directory** holding the file is writable and belongs to the same mount.

| | Option |
|---|---|
| **A** | ⭐ **A checked build-time patch, offered upstream.** The Dockerfile changes the one `CONFIG_FILE` line so the path comes from `SPOTIFY_CONFIG_PATH` (defaulting to upstream's), and the build **fails** unless that line matches exactly once. The file then lives in a **directory mount** (Q3), where rename works. Separately, with the owner's go-ahead, propose the same environment override **upstream** (as #106 was); when it lands, the patch goes and the pin moves. ⚠️ A patch is a small divergence from upstream; NFR-40 says *no fork*, and the guard plus the upstream PR are what keep it from becoming one |
| **B** | **Directory-mount the connector's package root** and arrange the connector's files around it (symlinks or `--preserve-symlinks-main` so `__dirname/..` resolves into the mount). No source change, but the layout tricks are fragile and a symlink that `rename` replaces would **silently detach** the file — the failure Q26 was written to prevent |
| **C** | **Wait for upstream**: propose the override first, and move the pin only when it is merged. No divergence at all, but U9 (and so U10) depends on a maintainer's timing |

[Answer]:
A
---

### Q3 — Where the Spotify credentials live on the host, once they are directory-mounted

| | Option |
|---|---|
| **A** | ⭐ **Mount the existing `./secrets/` directory** (read-write) into the container, and point both the connector and the app at files inside it. The host path `secrets/spotify-config.json` **does not change**, so `npm run auth`, INSTALL.md S4 and every existing install keep working; `musicbrainz.json` moves to the same directory mount (one pattern, and `CredentialsWriter` can use the ordinary atomic write for both). ⚠️ The `*.example.json` files become visible inside the container too (harmless: examples, no secrets) |
| **B** | A new **`secrets/spotify/`** subdirectory holding only `spotify-config.json`. Narrower mount, but every install moves a file by hand, and INSTALL.md, `npm run auth` and U7's upload path all change |

[Answer]:
A
---

### Q4 — How far the rename to `spotify-companion` goes, and how an existing install crosses it

Changing `container_name` (or the compose **service** name) makes Compose create a new container. If the old one is
still running, **two pollers write `data/history.db`** — the deployment trap in `CLAUDE.md`.

| | Option |
|---|---|
| **A** | ⭐ **Everything**: image, container **and** service become `spotify-companion`, plus docs and scripts. The crossing is guarded, not remembered: `npm run release -- --apply` refuses while a container named `spotify-now-playing` is running and says the one command that stops it; INSTALL.md gets an *upgrading from beta.2* note. Probed on `:3011` before the live crossing |
| **B** | **Image and container only**; the service stays `now-playing`, so Compose recreates the container in place (⚠️ to be probed). Fewer moving parts, one name left behind in `compose.yaml` |

[Answer]:
A
---

### Q5 — Which architectures the published image is built for

U10's NAS is `Machine 2`; **its CPU architecture is not yet recorded** (Synology sells both x86-64 and ARM models).

| | Option |
|---|---|
| **A** | ⭐ **Probe first**: read Machine 2's architecture (one read-only check by the owner, e.g. the model in DSM's *Info Center*), then build **`linux/amd64`**, adding `linux/arm64` only if the NAS needs it |
| **B** | **Always `amd64` + `arm64`** (Buildx with QEMU). Covers any NAS and Apple-silicon Macs; CI is slower, and the arm64 image is built but never run here unless the NAS is ARM |

[Answer]:
This is for U10 so should not be in this unit... please check to make sure U9 and U10 have been kept separate.

*Resolution (2026-10-18)*: **out of U9's scope; Q5 withdrawn.** Checked: FR-73…75 and NFR-40 never mention the NAS; the other U10 mentions in U9's documents are context (U10 depends on U9, never the reverse). Q5 was the one place that put U10 work (reading Machine 2's CPU) into U9. U9 publishes **`linux/amd64`**, the platform of every consumer U9 itself has (this PC, CI, the walk VM). The NAS's architecture, and adding `arm64` if it needs it, is **carried to U10's design plan**. Also corrected: Q8's option text described how U10 would walk; that is U10's to decide.
---

### Q6 — Who builds the published image, and from what

| | Option |
|---|---|
| **A** | ⭐ **CI, on a pushed `v*` tag**: a workflow builds from the **tagged commit** and pushes to GHCR with the workflow's own short-lived `GITHUB_TOKEN` (`packages: write`), only after the same checks as `main` pass. No write credential on any machine. `npm run release` stays local and unchanged except that its plan names the image the tag will publish. The local deployment keeps building from source |
| **B** | **`npm run release -- --apply` pushes** the image it just built and health-checked. The exact bits that ran here are the ones published, but the owner's machine then holds a long-lived `write:packages` token |

[Answer]:
A
---

### Q7 — How the licence notices travel with the image

| | Option |
|---|---|
| **A** | ⭐ **Both `LICENSE` files in the image** (this app's at `/app/LICENSE`, the connector's at `/opt/spotify-mcp/LICENSE`), an OCI label `org.opencontainers.image.licenses="GPL-3.0-or-later AND MIT"` plus `source` and `revision` labels, and a **build-time check** that fails if either file is missing. Third-party npm dependencies ship their own licence files inside `node_modules`, which the image already copies; a test confirms none is stripped |
| **B** | As A, plus a generated **`THIRD-PARTY-NOTICES`** file listing every runtime dependency and its licence |

[Answer]:
A
---

### Q8 — How FR-75's *App only* steps are walked

| | Option |
|---|---|
| **A** | ⭐ **An agent walk on the walk VM** (`Machine 1`, the walk ① method and checkpoint), given only README *App only* and a read token. It ships when that walk passes. ~~U10's NAS install then walks the same steps on Linux~~ *(U10's to decide, 2026-10-18)* |
| **B** | **U10's NAS install is the walk.** No separate walk in U9; *coming soon* stays on README until U10 |
| **C** | The owner follows the steps on this machine. Fastest, but not cold |

[Answer]:
A
---

### Q9 — Does U9 add a user story?

| | Option |
|---|---|
| **A** | ⭐ **One story, US-32**: *"As someone who only wants to run the app (P1), I can install it from a published image without the source or a build toolchain, and my credentials stay on my machine."* Acceptance = FR-74/75. The connector move itself is maintenance and gets no story |
| **B** | No story: U9 is maintenance and distribution, tracked by FR-73…75 only |

[Answer]:
A
---

## 3a. Follow-up questions (added 2026-10-18, while writing the business rules)

FR-75 says an *App only* user needs "the image, the two secrets, `docker compose up`". Writing that out as rules
showed two things it silently assumes. Both are measured, not guessed:

- **The refresh token needs a browser sign-in that today only `npm run auth` does**, which needs the source and
  Node on the host (`src/ui/credentialsPanel.ts:42` says so to the user). `scripts/auth.mjs` uses **only Node
  built-ins**, but listens on **`127.0.0.1`**, which inside a container does not receive a published port. In-app
  OAuth is **W-10**, new scope and out of U9.
- **While the repository is private, its files are private too.** A read token for GHCR (`read:packages`) does not
  read repository contents, so an *App only* user could pull the image but not download `compose.yaml` or the
  example secrets without a **second** credential.

### Q10 — How an *App only* user gets the Spotify refresh token

| | Option |
|---|---|
| **A** | ⭐ **The image runs the sign-in**: `auth.mjs` ships in the image, and one `docker run` command runs it. Its callback listener binds inside the container and is published **only on `127.0.0.1`** of the host (the same pattern as the app's port); the sign-in link is **printed** (a container cannot open the host's browser); it writes `secrets/spotify-config.json` through the same directory mount. No Node on the host. ⚠️ To be probed: the redirect URI stays `http://127.0.0.1:<port>/callback`, so registered Spotify apps keep working |
| **B** | **Node on the host is a prerequisite of *App only***: the user downloads `auth.mjs` alone and runs it with Node, as today. Simpler for U9, but *App only* still needs a toolchain |

[Answer]:
A
---

### Q11 — How an *App only* user gets the compose file and the example secrets

| | Option |
|---|---|
| **A** | ⭐ **The image carries them**: one `docker run` command writes `compose.yaml` (image-only, no `build:`), `secrets/musicbrainz.json` from its example, and an empty `config/`, `data/`, `state/` into the current folder, and **refuses to overwrite** anything (as `npm run rules:init`). One credential (the GHCR read token) is all an *App only* user ever needs, and the files always match the image's version |
| **B** | **Downloaded from the release tag**: README links the files at `v<version>`. Plain and inspectable, but while the repository is private it needs a second credential (repository read), and the links change with every version |

[Answer]:
A
---

## 4. Plan — after the answers

- [x] Collect answers; ask follow-ups for anything ambiguous (rule Step 5)
- [x] `construction/u9-connector-upgrade/functional-design/business-logic-model.md` — the pin move, the config-write
      path, the rename crossing, the release → publish flow
- [x] `…/functional-design/business-rules.md` — BR-68… (acceptance probes as rules, the patch guard, the name rule,
      publishing preconditions, licence notices)
- [x] `…/functional-design/domain-entities.md` — pin, patch, image reference, published tag, notices
- [x] No `frontend-components.md` (no UI change is in scope)
- [ ] `HANDOFF.md`, `aidlc-state.md`, `audit.md` updated; completion message; owner approval
