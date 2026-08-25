# AI-DLC State Tracking

## Project Information
- **Project Name**: Spotify Now Playing
- **Project Type**: Greenfield
- **Start Date**: 2026-08-24T13:17:23Z
- **Current Stage**: INCEPTION - Requirements Analysis (round 1 answered; awaiting clarification round)

## Workspace State
- **Existing Code**: No
- **Programming Languages**: None found
- **Build System**: None found
- **Project Structure**: Empty (only `.github/` tooling instructions present)
- **Reverse Engineering Needed**: No
- **Workspace Root**: `d:/Software/Spotify`

## Rule Details Source
Resolved from additional working directory (no in-workspace rule details found):
`D:/Software/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/`

## Code Location Rules
- **Application Code**: Workspace root (NEVER in aidlc-docs/)
- **Documentation**: aidlc-docs/ only

## Extension Configuration
| Extension | Enabled | Decided At |
|---|---|---|
| Security Baseline | Partial (scoped) | Requirements Analysis (Q9 = X) |
| Property-Based Testing | Partial | Requirements Analysis (Q10 = B) |

**Q9 scoping**: user asked for security "as simple as possible, but enough to ensure it is
only ever accessed by the local system". Interpreted as: enforce the local-access rules as
blocking constraints; do not apply production-grade controls (authn/authz, secret managers,
TLS, audit logging) that are inapplicable to a single-user localhost tool. Implemented in
`src/localGuard.ts` — loopback peer check, Host validation, Origin validation.

**Q10 scoping**: PBT applies to pure functions and serialisation round-trips only. Partial
mode enforces PBT-02, PBT-03, PBT-07, PBT-08 and PBT-09 as blocking; the rest are advisory.

### PBT Compliance (as of 2026-08-24)

| Rule | Status | Evidence |
|---|---|---|
| PBT-02 Round-trip | ✅ Compliant | `parseNowPlaying.property.test.ts` — format→parse round-trip against a model of upstream's template |
| PBT-03 Invariants | ✅ Compliant | Progress ≤ duration; raw text preserved; age never negative; `pickArt` never fabricates a URL; guard never admits non-loopback |
| PBT-07 Generator quality | ✅ Compliant | `test/generators.ts` — domain generators for titles, Spotify IDs, devices, image sets, release dates. No raw primitives in domain positions |
| PBT-08 Shrinking / reproducibility | ✅ Compliant | Shrinking enabled; `test/fc-config.ts` selects and logs a seed every run; `.github/workflows/ci.yml` runs the full suite on push/PR with `FC_SEED` set from the run ID and surfaced in the job summary. Replay verified: the same seed reproduces an identical shrunk counterexample |
| PBT-09 Framework | ✅ Compliant | fast-check 4.9.0, in `devDependencies`, integrated with `node:test` |
| PBT-01, 04, 05, 06, 10 | Advisory | PBT-10 satisfied anyway (example + property tests, regressions pinned). PBT-06 N/A — no stateful component beyond simple caches |

**No open PBT findings.** The PBT-08 CI gap was closed on 2026-08-24 by adding
`.github/workflows/ci.yml`.

## Key Decisions
| Decision | Value | Source |
|---|---|---|
| Spotify MCP server | `marcelmarais/spotify-mcp-server` | Research spike — `inception/research/research-findings.md` Part 1 |
| Local runtime | Rancher Desktop (containerd + Docker Compose) | User request |
| Update transport | WebSocket push, backend polls MCP | Q5 = C |
| Playback control | Read-only now, designed for later control | Q4 = B |
| Album artwork | **Included** — reversed from Q2a | Q2a's premise was wrong: art needs no extra call or auth path. `track.album.images` returns 3 sizes on the request already being made. Reversal approved by user 2026-08-24 |
| OAuth flow | Host-side auth, token file mounted (`npm run auth`) | Q6 = X, resolved to A — Option B is technically impossible |
| Network exposure | Localhost only, enforced in code | Q7 = A |
| Deployment | Compose now, no k8s-blocking debt | Q3 = A + constraint |
| Enrichment architecture | **Hybrid** — MCP for now-playing, Web API direct for enrichment | CQ1 = A, resolved implicitly by the instruction to build read items |
| OAuth scopes | Upstream's 14 **plus `user-follow-read`** | Upstream omits it; follow-status would 403 without it |
| Token refresh | In-memory only, never written back to `spotify-config.json` | Avoids racing the MCP server's own token rewrites |

## Known Risks
| Risk | Impact | Status |
|---|---|---|
| **Spotify Premium mandatory** for Dev Mode API since 2026-03-09 | Project cannot function without it | ⚠️ Unconfirmed — CQ5 |
| **`audio-features` deprecated** (Nov 2024), no replacement | "Preference alignment" goal unreachable via Spotify | Open — CQ2 |
| **`label` field removed** from Album (Feb 2026) | "Independent vs. signed" unreachable via Spotify | Open — CQ2 |
| **`popularity` removed** from track/artist (Feb 2026) | "Number of plays" unreachable via Spotify | Open — CQ2 |
| **MCP server lacks get-artist/get-album/check-following tools** | Enrichment impossible through MCP alone | Open — CQ1 |
| MCP server's `getAlbums` uses a **removed batch endpoint** | That tool is already broken in Dev Mode | Noted; unused by this app |
| MCP server **declares no license** | Blocks open-sourcing this project later | Accepted for personal use (Q8 = A) |
| `getNowPlaying` returns **markdown, not JSON** | Upstream template change breaks parsing silently | Mitigated — isolated in one module, raw text surfaced |
| Extended Quota Mode requires **250k MAU + registered business** | Restrictions are permanent, not appealable | Accepted constraint |

## Stage Progress

### 🔵 INCEPTION PHASE
- [x] Workspace Detection
- [ ] Reverse Engineering — **SKIPPED** (greenfield)
- [ ] Requirements Analysis — *round 1 answered; clarification round issued (contradiction + API constraints)*
- [ ] User Stories — *assessment: LIKELY REQUIRED. Q1 revealed a multi-release arc with
      distinct user journeys (passive display, enrichment, automated skip rules). Confirm
      after clarification.*
- [ ] Workflow Planning
- [ ] Application Design
- [ ] Units Generation

### 🟢 CONSTRUCTION PHASE
- [ ] Functional Design
- [ ] NFR Requirements
- [ ] NFR Design
- [ ] Infrastructure Design
- [ ] Code Generation
- [ ] Build and Test

### 🟡 OPERATIONS PHASE
- [ ] Operations (placeholder)

## Notes
- A provisional walking-skeleton scaffold exists at the workspace root, created ahead of
  the formal Code Generation stage at the user's explicit request ("get a basic web app
  framed up"). It encodes default assumptions that the Requirements Analysis answers may
  overturn. See `audit.md` entry "Provisional Walking Skeleton Scaffold".
