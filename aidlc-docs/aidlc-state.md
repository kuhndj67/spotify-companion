# AI-DLC State Tracking

## Project Information
- **Project Name**: Spotify Now Playing
- **Project Type**: Greenfield
- **Start Date**: 2026-08-24T13:17:23Z
- **Current Stage**: CONSTRUCTION - **U1 COMPLETE and live-verified** (2026-08-26), approved by
  user. 193/193 tests, coverage 99.41% line / 93.00% branch, **68 plays recorded, 0 gaps**.
  Next: **U2 — Label Enrichment** (Functional Design)

> **New session?** Read `CLAUDE.md` first, then this file, then the last few `audit.md` entries.

## ✅ U1 live verification (2026-08-26)
User played real tracks; database inspected directly. Full evidence in
[`construction/u1-listening-history/live-verification.md`](construction/u1-listening-history/live-verification.md).

Confirmed working: automatic recording · ISRC and follow status on **every** live play ·
completions (12, ratios 0.910–0.995) · skips attributed `user` (3) · pause → `unknown` not
`skipped` · trail length proportional to duration · **0 counted gaps** · max observation gap
**3–4 s** (no missed polls) · FR-56 snapshot verified manually (68 rows, coverage header).

**⚠️ Finding — the 0.90 threshold splits a dense behavioural cluster.** Sorted by seconds
remaining at play end, the data is sharply bimodal: plays end either **≤ 23 s** from the end
(14 of 17) or **≥ 194 s** (3 of 17), with nothing between. The threshold discriminates *inside*
the crowded cluster — "16 s left" completes, "20 s left" does not. **6 of 17 plays sit within
±0.03 of it**, and two tracks skipped after ~88% are recorded as rejections, becoming false
negatives in the outcome variable.

A **fixed tail window (~30 s)** would separate this listener's behaviour with 178 s of margin —
option D from U1 FD Q1, now supported by measurement rather than speculation. **Fully correctable
retroactively**, since trails are retained (Application Design Q1 = C paying off for the first
time). Not changed unilaterally: the threshold was an explicit user decision and 18 plays is a
small sample. **Revisit at a few hundred plays.**

**Not yet observed**: rewind/replay (`rewound = false` on all 18 plays) — the path is unit- and
property-tested but has never fired against real listening.

## 🚨 OPEN DECISION — the local-only guard blocks containerised deployment
**Pre-existing U0 defect, found 2026-08-26 by exercising the container for the first time.**

`localGuard` requires `req.socket.remoteAddress` to be loopback. Traffic reaching a container via
a published port arrives from the **Docker bridge gateway**, so **every request is refused**.
Proven both ways: `/api/health` **succeeds from inside the container** (`toolCount: 30`) and is
**refused from the host** via the published port.

**The containerised deployment has never been able to serve its UI.** The app is healthy; only the
guard blocks it, and it fails closed (the safe direction).

**Not fixed** — any change relaxes the single control NFR-07's no-authentication decision rests
on, so it is the user's call, consistent with §3.5 route C and W-1. Options in
`construction/build-and-test/security-test-instructions.md`:
- **A** — run on the host (`npm start`). Works today, no change. **Recommended for now**
- **B** — in-container, trust the `127.0.0.1:3000:3000` publish for isolation and accept the
  bridge gateway as a peer, keeping Host/Origin validation
- **C** — configurable peer CIDR · **D** — `network_mode: host` (poor on Docker Desktop Windows)

## U1 fixes made during Build and Test
| Defect | Fix |
|---|---|
| **R7's SHA pin broke the Docker build** — `git clone --branch` rejects commit SHAs (exit 128) | `git init` + `git fetch --depth 1 origin <ref>` + `checkout FETCH_HEAD` |
| **Bind mount unwritable** — image ran as `node` (1000), mount arrived root-owned 755 | `scripts/docker-entrypoint.sh` chowns mount points as root, then drops via `setpriv`. Verified PID 1 = `node dist/server.js` as Uid 1000 |

⚠️ **Check build exit codes directly.** `docker compose build \| tail` reports the *pipe's* exit
code — a failing build read as success and was nearly recorded as one.

### 🔎 New capability found 2026-08-26 — saved-track ("liked") status IS available
Probed live in response to a user question. `GET /me/tracks/contains` is **403** (like
`/me/following/contains`), but `GET /me/tracks` returns **200** — 596 saved tracks, **12 requests**
at `limit=50` to cache the set. Same workaround shape as the existing `FollowedArtistsCache`.

**Pattern**: three `/contains` endpoints now confirmed blocked while every list counterpart works.
Development Mode appears to restrict the membership-check family generally — useful as a rule of
thumb for endpoints not yet tried.

**Why it matters**: liking is an *explicit per-track* positive judgement, a stronger preference
signal than follow status. For R1 it is also a **control variable** — an already-liked track is
self-evidently profile-matched rather than promoted.

**Second-order signal, recorded so it is not lost**: a track not liked when it started and liked
shortly after was almost certainly liked *because of that play* — arguably stronger than a
completion, since completion can be passive and liking cannot.

**Liked-status transitions — four-state model agreed with the user 2026-08-26.** The 2×2 over
(liked at start, liked at end) is exhaustive: `liked-during` · `unliked-during` · `kept-liked` ·
`kept-unliked`, **plus `unknown`** as a fifth member (the liked set can be unavailable).

Two asymmetries found, both recorded in research-findings.md Part 4b:
- **Informativeness**: `kept-unliked` is the *null case* covering nearly all plays, most involving
  no like/unlike consideration at all. Absence of action ≠ decision. Treat it as the reference
  level in analysis, not as an observed choice. `kept-liked` genuinely is informative, especially
  combined with a skip.
- **Detectability**: `GET /me/tracks` is **most-recently-saved first** with an exact `added_at`
  (probed). So `liked-during` costs **1 request** and is *definitively* attributable — `added_at`
  inside the play window proves it. `unliked-during` leaves **no tombstone and no timestamp**;
  mitigated by only probing when `likedAtStart` was true, using the cached rank to check a small
  `offset` window (~1–2 requests). Net: 1 request/play typical, 2–3 when already liked.

**Design**: store `likedAtStart` / `likedAtEnd` as *evidence*, derive the enum — same
observation-vs-judgement split as play outcomes. Unlike a trail, these are point-in-time facts and
cannot be reconstructed later, so they must be captured correctly at the time.

**DECIDED 2026-08-26 — include in U2.** User agreed on both the four-state model and the
placement. Also agreed: **`kept-unliked` has significantly less analytic value than the active
transitions** — it is the reference level, not an observed choice.

**U2 must therefore deliver**: a cached saved-tracks set (12 requests, TTL) · `likedAtStart` /
`likedAtEnd` captured per play as *evidence* · the derived five-state enum · migration 002 adding
the columns · a rule field in U3. Requirements to be written at U2 Functional Design.

### U1 open item for U2
**Backfilled plays carry no ISRC.** Verified live: `GET /me/player/recently-played` returns no
`external_ids` field at all. The 50 backfilled rows therefore have `isrc = null`, and U2's label
backfill will silently skip them. **U2 must decide** whether to resolve ISRCs for backfilled rows
with an extra `GET /tracks/{id}` per track, or accept that backfilled history carries no label.

## U1 Infrastructure & NFR Decisions
| Decision | Value | Source |
|---|---|---|
| SQLite driver | **`node:sqlite`** behind the NFR-10 repository interface | NFR Q1 = C |
| Write timing | **Buffer in memory, one transaction per play** (~200/day) | NFR Q2 = A |
| Database location | **Bind mount `./data/`** (directory, gitignored) | Infra Q3 = A |
| Backups | **Automatic dated snapshots** on a schedule → **FR-56** | Infra Q4 = B |
| `MCP_SERVER_REF` | **Pinned to `7b5fde6309a52a7874768c63deda7880ee85935b`** (2026-08-21) | **R7 CLOSED** |

**Q1+Q2 pair deliberately**: one transaction per play is small enough that `node:sqlite`'s
synchronous API is a non-issue — which it would not be at option B's ~28,800 writes/day.

**Mount the directory, not the file.** SQLite's `-wal` and `-shm` files must sit beside the
database. Copying the `secrets/` single-file mount pattern here would break recovery subtly.

⚠️ **Residual backup risk, accepted with the trade-off visible**: database and snapshots share
`./data/`, inside the project tree and gitignored — which makes them *more* exposed to
`git clean -xdf`, not less. FR-56 protects against corruption, **not** against losing the
directory. Cheap fixes if it later feels wrong: point `SNAPSHOT_DIR` outside the tree, or move the
mount (Infra Q3 = B). Neither needs redesign.

**U1 requires no security review** — export is a download over the existing loopback listener, so
NFR-01–07 are untouched. That is the §3.5 decision holding all the way through to infrastructure.

## U1 Settled Design Parameters
| Parameter | Value | Source |
|---|---|---|
| Completion threshold | **`completionRatio >= 0.90`** | U1 FD Q1 + Q5 |
| Below threshold at track change | `skipped` | Q2 |
| Short-play special handling | **None** — no sub-threshold flag | Q2 |
| Poll-interval floor | **Not applied** | Q6 |
| Paused/stopped, never resumed | `unknown` | Q4, Q7 |
| **Outcome enumeration** | **`completed \| skipped \| unknown`** (3 values) | Q7 — `abandoned` **retired** |
| Trail retention | Indefinite, no auto-pruning | Q3 → wishlist W-2 |
| **Ratio basis** | **Listened time**, not furthest position. `listenedMs / duration`, **unclamped — may exceed 1.0** | User, 2026-08-25 |
| **Backward jump** | **No logic at all.** Rewinding adds listening time, which raises the ratio by itself | User, 2026-08-25 |
| **Forward jump** | **Not detected.** Each step capped at elapsed wall time (arithmetic, not detection) | User, 2026-08-25 |

**The ratio change removed three rules.** Under the earlier *position-based* ratio
(`max(progress)/duration`), a rewind moved the position backwards and left the ratio unchanged, so
a rewound play scored as if the listener had stopped at the peak — which needed a special rule to
rescue. Under **listened time**, re-hearing adds to the numerator directly. Deleted as a result:
the replay-vs-rewind branch, the rewind classification rule, and forward-seek detection. The
classifier is now four branches with no special cases; all the subtlety moved into `summarise`,
which is arithmetic and exhaustively property-testable.

⚠️ **Do not clamp `completionRatio` to 1.0.** It looks like defensive hygiene and would silently
destroy the repeat-listen signal — a ratio of 2.4 means the track was heard nearly 2½ times.

**Known consequences**: a track played twice in a row is **one** play record with ratio ≈ 2.0, not
two — play counts undercount repeats, and the ratio carries that signal instead. And a rewind
followed by an early skip can still score below 0.90 (rewind at 40%, re-hear 20–40%, leave ⇒ 0.60
⇒ `skipped`); no rule added for it, since encoding intent would put a preference judgement back
into the classifier.

### ⚠️ Accepted data-quality limitation — short tracks
**Corrected 2026-08-25 during code generation** — the earlier statement ("systematically recorded
as skipped") was wrong.

A fully-played track is *guaranteed* to clear the threshold only when
`duration >= pollInterval / (1 - threshold)` = **30 s** at 3 s and 0.90. Below that, the outcome
**depends on where the final poll lands**: a 20 s track observes a ratio anywhere in 0.85–1.00, so
it is **sometimes `skipped` and sometimes `completed`**.

The limitation is therefore **intermittent, not systematic** — better in that not every short
track is mislabelled, worse in that the *same track played identically can be recorded differently
on different occasions*. That inconsistency is harder to notice and to correct for than a uniform
bias. Affects interludes, skits and short intros; ordinary music is unaffected.

Accepted deliberately (Q6 = B). Correctable via `reclassify()` from the retained trail (FR-20),
no re-collection needed. **Any analysis of short-form content must state this caveat.** Both
outcomes are pinned by tests.

**`abandoned` retired** — propagated to requirements.md (FR-18), stories.md (US-11),
components.md, component-methods.md and services.md.

## Units of Work
Units nest inside delivery phases (Q1 = C). **Phases** guarantee a runnable app; **units** are
development groupings and need not be independently runnable.

| Unit | Phase | Name | Done means |
|---|---|---|---|
| U0 | 0 | Existing application | ✅ Delivered |
| U1 | 1 | Listening History & Export | CI + **live** |
| U2 | 2 | Label Enrichment | CI + **live** |
| U3 | 3 | Rule Model & Evaluation (pure core) | **CI only** |
| U4 | 3 | Rule Observability | CI + **live** |
| U5 | 4 | Automated Skipping | CI + **live** |

Build order **U1 → U2 → U3 → U4 → U5**, forced by the dependency matrix rather than chosen.
U3 is gated on tests alone because its correctness is entirely a property of pure functions —
a live session would tell us nothing a property test does not.

**U1 must record `skipSource='user'` from the first play.** US-13 is deliberately split across
U1 and U5: if the column arrived only with U5, every play from Phases 1–3 would be permanently
unattributed, and a later migration would have to *assume* they were user skips rather than
record it.

## Application Design Decisions
| # | Decision | Source |
|---|---|---|
| D-A | **Plays + observation trail** — play row with live verdict, plus the progress samples it came from | Q1 = C |
| D-B | **Rules as a schema-validated JSON file**; UI read-only | Q2 = A |
| D-C | **Flat layout, pure domain logic isolated** into dependency-free modules | Q3 = C |
| D-D | **Schema grows per phase** via forward-only migrations | Q4 = B |

**Structural guarantee**: `DecisionExecutor` is a strategy. In Phase 3 the only implementation is
`LoggingExecutor`, so **no code path from a decision to a skip exists** — verifiable by reading
the import graph rather than by trusting a feature flag. Phase 4 registers `SkipExecutor`.

**Integration trap recorded**: `NowPlayingService` must emit `tick` (every poll) separately from
`change` (signature-suppressed, for the UI). History capture consuming `change` would silently
lose the progress samples the outcome classifier depends on — producing verdicts that are wrong
but plausible.

**Watch item**: the pure/impure boundary. A `Date.now()` inside `outcomeClassifier`, `RuleEngine`
or `labelClassifier` fails no test but breaks FR-20 and FR-42 silently. Add a mechanical check in
Build and Test that pure modules import nothing impure.

## Delivery Phasing
Four phases, sequenced by **risk containment** rather than architectural convenience. See
[`inception/plans/execution-plan.md`](inception/plans/execution-plan.md).

| Phase | Delivers | Complexity | Consequence of a miss |
|---|---|---|---|
| 0 | Display, enrichment, tests, CI | — | ✅ Delivered |
| 1 **Remember** | Listening history + export | Low–Med | Small — verdicts recomputable from stored evidence |
| 2 **Understand** | MusicBrainz labels + **hypothesis gate** | Med | Bounded to one module |
| 3 **Decide** | Rules engine, **dry-run only** | **High** | **Contained — cannot act on playback** |
| 4 **Act** | Playback control + safety interlocks | Med | Visible but reversible |

**Key structural decision**: the rules engine (largest, least certain) and playback control (only
part that can cause harm) are in **separate phases**. The risky component ships where being wrong
costs nothing, and is validated by back-testing against real history before it is armed.

**Phase 1 must store ISRC** with every play — it makes label backfill possible, so shipping
Phase 1 before Phase 2 is not a one-way door.

**Phase 2 ends with a decision gate**: export the data and test R1 before building the engine
premised on it.

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
| External enrichment source | **MusicBrainz only**, pulling **label / signed-vs-independent only** | CQ2 = B, narrowed. Not genres, not play counts |
| Product framing | Estimate **likelihood a track was *promoted*** into the feed vs. profile-matched. Signed-vs-independent is a **proxy variable**, not an end in itself | CQ2 rationale |
| MusicBrainz join key | **ISRC**, from `track.external_ids.isrc` | Verified live 2026-08-25. Arrives on the `GET /tracks/{id}` call already made — costs zero extra Spotify requests |
| Unit 1 scope | **General rules engine** — the core feature. User-authored rules over **any** known track field, evaluated on **every** new track in **every** playback context, skipping on match. The age rule is one instance, not the feature | CQ3 = C, clarified by user 2026-08-25 |
| Rule representation | **Structured predicate tree** (field/operator/value + AND/OR/NOT), stored as data. **No `eval`, no code evaluation** | FR-43/44/45 — keeps the local-only security posture from depending on the rule store being trusted |
| Unknown-field semantics | **Tri-state true/false/unknown**; each rule declares its behaviour on `unknown` | FR-32/33 — neither default is safe given MusicBrainz coverage gaps (R2) |
| Rule combination | **OR only — any true rule skips.** No precedence, no exemptions, no ordering significance | Q-B = OR-only, user 2026-08-25. Seams kept for later: action is an enum, OR-folding isolated to one function |
| Slow-field timing | **Pre-warm enrichment from the queue**, don't block on it | FR-34–36. `GET /me/player/queue` verified 200 in Dev Mode 2026-08-25 |
| Persistence | **Now, in Unit 1** — listening history with skip/complete outcome | CQ4 = A |
| Persistence engine | **SQLite via `node:sqlite`** (recommended), behind a repository interface | NFR-08/09/10. Built into Node 22.17; interface contains the experimental-API risk |
| Playback control | **Enabled** (off by default) — the rules engine is inert without it | CQ3 = C supersedes Q4 = B's "later" |
| Premium prerequisite | **Confirmed active** | CQ5 = A — risk closed |

## Known Risks
| Risk | Impact | Status |
|---|---|---|
| **Spotify Premium mandatory** for Dev Mode API since 2026-03-09 | Project cannot function without it | ✅ **Closed** — CQ5 = A, Premium confirmed active |
| **`audio-features` deprecated** (Nov 2024), no replacement | "Preference alignment" goal unreachable via Spotify | ✅ **Closed** — dropped from scope (CQ2) |
| **`label` field removed** from Album (Feb 2026) | "Independent vs. signed" unreachable via Spotify | ✅ **Closed** — recovered via MusicBrainz on ISRC (CQ2 = B) |
| **`popularity` removed** from track/artist (Feb 2026) | "Number of plays" unreachable via Spotify | ✅ **Closed** — dropped from scope (CQ2) |
| **MCP server lacks get-artist/get-album/check-following tools** | Enrichment impossible through MCP alone | ✅ **Closed** — hybrid architecture (CQ1 = A), built and live-verified |
| **Promotion hypothesis may be false** — signed-vs-independent may not predict skips | The headline feature would have no predictive value | ⚠️ Open — R1. Mitigated by keeping raw data re-analysable and by dry-run rule evaluation |
| **MusicBrainz coverage gaps** on new/independent releases — the population of interest | Missing data correlated with the measured variable | ⚠️ Open — R2. `unknown` kept distinct from "independent"; track coverage rate |
| **Major/indie has no clean definition** (imprints, majors' "indie" sublabels, distributors) | Classification disagrees with intuition | ⚠️ Open — R3. Store per-signal votes, not a boolean |
| **Skip inference is heuristic** — pause, seek, replay, session end all confound it | Noisy outcome variable weakens the model | ⚠️ Open — R4. Store raw evidence; property-test the classifier |
| **A runaway rule could skip an entire queue** — higher risk now that rules are user-authored over arbitrary fields | User-visible loss of control | ⚠️ Open — R5. Dry-run, kill switch, rate limit, no-repeat-skip, off by default |
| **Slow fields can't resolve before a track starts** — a label lookup is 2 MusicBrainz calls behind a 1 req/sec queue | Label-based rules fire late or never — and those are the rules that test the promotion hypothesis | ⚠️ Open — R11. Pre-warm from queue endpoint (verified reachable); **lookahead unconfirmed during active playback** |
| **A rule language over arbitrary fields invites `eval`** | Arbitrary code execution reachable from the rule store, collapsing the local-only posture | ⚠️ Open — R12. Structured predicate tree; code evaluation prohibited by requirement |
| **`node:sqlite` is experimental** in Node 22.17 | API may change under us | ⚠️ Open — R10. Repository interface makes the engine swappable |
| MCP server's `getAlbums` uses a **removed batch endpoint** | That tool is already broken in Dev Mode | Noted; unused by this app |
| MCP server **declares no license** | Blocks open-sourcing this project later | Accepted for personal use (Q8 = A) |
| `getNowPlaying` returns **markdown, not JSON** | Upstream template change breaks parsing silently | Mitigated — isolated in one module, raw text surfaced |
| Extended Quota Mode requires **250k MAU + registered business** | Restrictions are permanent, not appealable | Accepted constraint |

## Stage Progress

### 🔵 INCEPTION PHASE
- [x] Workspace Detection
- [ ] Reverse Engineering — **SKIPPED** (greenfield)
- [x] Requirements Analysis — *both rounds answered; `requirements.md` written 2026-08-25.
      Awaiting user review/approval.*
- [x] User Stories — *complete 2026-08-25, approved by user. 3 personas, 7 epics, 27 stories.*
- [x] Workflow Planning — *complete 2026-08-25. Execution plan with 4 delivery phases.
      Awaiting approval.*
- [x] Application Design — *complete 2026-08-25. 24 components (9 pure, 15 impure), 6 services.
      Awaiting approval.*
- [x] Units Generation — *complete 2026-08-25. 5 work units (U1–U5) plus U0 reference.
      Awaiting approval. **INCEPTION PHASE COMPLETE.***
- [ ] Workflow Planning
- [ ] Application Design
- [ ] Units Generation

### 🟢 CONSTRUCTION PHASE
*Runs once per delivery phase, not all up front (execution plan).*
- [x] Functional Design — **U1 complete** 2026-08-25, approved. U2–U5 pending.
- [x] NFR Requirements — **SKIPPED** (27 NFRs already agreed in requirements.md §4)
- [x] NFR Design — **U1 complete** 2026-08-25 (narrow: persistence only), awaiting approval
- [x] Infrastructure Design — **U1 complete** 2026-08-25 (narrow: storage + R7), approved
- [x] Code Generation — **U1 complete** 2026-08-25. 10 files created, 8 modified, 7 test files.
      184/184 tests passing. Awaiting approval. U2–U5 pending.
- [x] Build and Test — **U1 complete** 2026-08-26. Build ✅, 193/193 tests, container verified.
      **One open decision blocks container use** (see below). Awaiting approval.
- [ ] NFR Requirements
- [ ] NFR Design
- [ ] Infrastructure Design
- [ ] Code Generation
- [ ] Build and Test

### 🟡 OPERATIONS PHASE
- [ ] Operations (placeholder)

## Notes

### Stage ordering deviation
Working code exists ahead of the formal Code Generation stage, built at the user's explicit
request across several turns. The Construction checkboxes above remain unticked because the
*formal stages* (Functional Design, NFR Design, Infrastructure Design) have not been executed —
not because the code is absent. What exists, live-verified against a real Spotify account:

- Now-playing display, MCP stdio client, markdown parser, WebSocket push (FR-01–FR-06)
- Enrichment: release date, age, follow status, album art (FR-07–FR-11)
- Local-only access control (NFR-01–NFR-04), host-side OAuth, 10-step diagnostics
- 100 tests passing, coverage 99.88% line / 92.86% branch on tested modules, CI green

Requirements sign-off should therefore be read as *retrospective* for FR-01–FR-11 and
*prospective* for everything added in round 2.

### Round 2 raises new work not yet started
FR-12–FR-48 are all new: MusicBrainz label resolution, persistent listening history with skip
detection, the rules engine, and playback control. None of it is built.

### Resolved question
**Q-A** (does the age rule apply everywhere, or only to DJ contexts?) — **resolved 2026-08-25:
everywhere.** The user clarified the age rule is only an example; rules apply to every new track
in every context. Playback context stays available as a *field*, so DJ-only behaviour can be
expressed as a condition inside a rule rather than imposed by the engine.

**Q-B** (are exemption / allow rules needed?) — **resolved 2026-08-25: no, not for Unit 1.**
User chose "any rule is true causes skip" as the whole combination semantics, with richer
combination as a possible future addition. Accepted limitation: "skip major-label tracks except
by artists I follow" can't be one rule; it must be folded into the predicate as
`label = major AND following = false`. Two seams preserved so it can be added later without
migrating stored rules — rule action is an **enum** (not a boolean), and OR-folding is
**isolated to one function**.

**No open questions remain from Requirements Analysis.**

### US-25 finding — RESOLVED 2026-08-25
Raised by User Stories (history was specified as collect-only, with no way to review or export
it, despite that being CQ2's whole rationale). **Resolved by user decision**: analysis happens
**outside the app** — mature reporting tools exist. Produced requirements **FR-49–55** (§3.5
Export and external analysis). US-25 rewritten as an export story; US-27 added for the
integration route. Every story now traces to a requirement.

### Export vs. local-only conflict — RESOLVED 2026-08-25
`isLoopbackAddress` accepts only `127.x` and `::1`, so a **Grafana container** on the Compose
network (e.g. `172.18.0.3`) is refused with 403 — NFR-01 working correctly, not a defect.

**User decision: download only.** No data API. FR-55 withdrawn to the wishlist (**W-1**,
requirements §5.1) pending a security architecture the project deliberately does not have —
serving an API properly would require authentication for consumers, authorisation, transport
security, audit logging and a defined container-network trust boundary, i.e. most of what Q9
explicitly excluded. US-27 retained as a **deferred** story so the reasoning stays visible.

**Consequence: NFR-01 to NFR-07 are untouched and no security work sits on any phase's critical
path.** Escape hatch if liveness is ever needed: run the dashboard **on the host** rather than in
a container — it reaches loopback and needs no security change at all.

**US-18 is not estimable yet** — its pre-warming criterion depends on queue lookahead that is
confirmed reachable but unverified during active playback (R11). Probe at the start of Phase 4.
