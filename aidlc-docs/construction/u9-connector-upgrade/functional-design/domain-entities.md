# U9 Domain Entities — Connector Upgrade & Publishable Image

**Unit**: U9 (Phase 5) · **Date**: 2026-10-18 · Rules: [`business-rules.md`](business-rules.md)

U9 adds no runtime data and no database change. Its entities are **release artefacts and their invariants**. Each
has one place where it is defined and checked copies elsewhere, following NFR-34's *one source* pattern.

---

| Entity | Defined in (one source) | Checked copies | Invariants |
|---|---|---|---|
| **Connector pin** | `compose.yaml` `MCP_SERVER_REF` (full SHA) | `compose.verify.yaml`; CI's PBT-66 source fetch reads it | Full 40-char SHA; equals `6065ce5c…` after U9; moves only with BR-70 re-run (BR-68.1, 68.6) |
| **Config-path patch** | The Dockerfile's connector build stage | CONTRIBUTING's trap list (a pointer, not a copy) | Original line matched exactly once, patched line exactly once after; fallback = upstream's path; removed when upstream has an override (BR-69.1, 69.2) |
| **Credentials directory** | Host `./secrets/`, mounted as a directory | Container path in compose; `SPOTIFY_CONFIG_PATH` passed to the connector; the app's config paths | Host file names unchanged; read-write; never in an image (BR-69.4, 69.8) |
| **App name** | `package.json` `name` = `spotify-companion` | Image, container, service, verification install names; registry path | One name everywhere; old name only in history and old images (BR-71.1) |
| **App version** | `package.json` `version` | Local image tag; registry tag; git tag `v<version>`; compose image tags (already tested by `versionSources`) | Registry tag = git tag minus `v` = `package.json` (BR-72.2); never overwritten (BR-72.3); no floating tag (BR-72.4) |
| **Published image** | CI's publishing job, from the tagged commit | — | `linux/amd64`; private; linked to the repository; both licences present; no secrets or user data; pushed only after checks pass (BR-72) |
| **Licence notices** | Root `LICENSE` (GPL-3.0); upstream's `LICENSE` at the pin (MIT) | OCI `licenses` label | Both files in the image, unmodified; build fails if either is missing (BR-73) |
| **App-only bundle** | Inside the image: an image-only compose template, the MusicBrainz example, the folder layout | — | Compose pins the image's own version; written only into an empty target, never overwriting (BR-74.2) |
| **Sign-in run** | `auth.mjs`, shipped in the image | Source install's `npm run auth` (same script) | Listener reachable only via the host's `127.0.0.1`; redirect URI unchanged; writes only `secrets/spotify-config.json` (BR-74.3, 74.4) |
| **Acceptance record** | `construction/u9-connector-upgrade/` (Build & Test) | — | One entry per BR-70 item, with the negative control; the new pin reaches live only after all pass (BR-70) |

## Relationships

```text
package.json (name, version) ──► local image tag ──► release (git tag v<version>) ──► CI publishing job
                                                                                         │
compose.yaml MCP_SERVER_REF ──► connector build stage ──(patch + upstream tests)──►      ▼
                                                                         published image (amd64, private)
                                                                         ├─ /app/LICENSE (GPL-3.0)
                                                                         ├─ /opt/spotify-mcp/LICENSE (MIT)
                                                                         ├─ app-only bundle  ──► user's folder
                                                                         └─ auth.mjs         ──► secrets/spotify-config.json
host ./secrets/ (directory mount) ◄── connector refresh (rename) · CredentialsWriter (rename) · sign-in run
```
