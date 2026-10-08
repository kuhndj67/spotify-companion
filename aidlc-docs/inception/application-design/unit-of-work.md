# Units of Work

**Date**: 2026-08-25 · **Stage**: INCEPTION — Units Generation
**Decisions**: Q1 = C (units nest inside phases) · Q2 = A (Phase 3 splits in two) ·
Q3 = C (CI green; live verification where a unit touches an external service)

---

## Decomposition model

This is a **single deployable** — one container, one process, one `package.json`. There are no
independently deployable services, so "unit" here means **a logical module and a body of
development work**, not a deployment artefact.

Two levels, and the distinction matters:

| Level | Guarantee |
|---|---|
| **Phase** | A runnable, testable, independently useful app. Never broken by a phase boundary |
| **Unit** | A coherent body of work with its own exit criteria. **Not required to be independently runnable** |

Q1 = C is what allows Phase 3 — the largest and least-certain work — to be developed as two
tractable units while still shipping as one runnable checkpoint.

---

## Unit inventory

| Unit | Phase | Name | Kind | Done means |
|---|---|---|---|---|
| **U0** | 0 | Existing Application | Reference | ✅ Delivered |
| **U1** | 1 | Listening History & Export | Feature | CI green **+ live** |
| **U2** | 2 | Label Enrichment | Feature | CI green **+ live** |
| **U3** | 3 | Rule Model & Evaluation | Pure core | **CI green** |
| **U4** | 3 | Rule Observability | Feature | CI green **+ live** |
| **U5** | 4 | Automated Skipping | Feature | CI green **+ live** |
| **U6** | **5** | **User-Data Lifecycle** | Feature *(was Infrastructure until its FD, 2026-10-07)* | CI green **+ live + a VERIFIED CROSS-MACHINE ROUND TRIP** |
| **U7** | 5 | Configuration Management | Feature | CI green **+ live** — rules and credentials changed in-app on a running deployment |
| **U8** | 5 | Team Workflow & Onboarding | Process & docs | CI gating enforced **+ the install walked cold** by someone who did not write it |
| **U9** | 5 | Off-machine Deployment | Deployment | Reachable and fully working from a second machine, **deployed by following U8's install routine** |

⚠️ **Phase 5's units were renumbered on 2026-10-07** to match build order (Units Question 5a = A). Old → new:
U8 → **U7**, U9 → **U8**, U7 → **U9**. `audit.md` entries written before that date use the old numbers.

---

## U0 — Existing Application *(reference only)*

Display, enrichment, artwork, local-only guard, diagnostics, 100 tests, CI. Live-verified.

Listed so the story map is complete and so later units have a named thing to extend. **No work is
planned against U0** beyond the extension points other units require.

**Modules**: `config`, `localGuard`, `nowPlayingService`, `diagnostics`, `server`, `mcp/`,
`spotify/`
**Stories**: US-01–07, US-26

---

## U1 — Listening History & Export

**Purpose**: turn playback observation into a durable, honest dataset, and let the user get it out.

**Modules**
```
src/history/  outcomeClassifier ⚙️  PlayObserver  HistoryRepository  SqliteHistoryRepo
              migrations  RecentlyPlayedBackfill
src/export/   serialisers ⚙️  ExportService
```

**Extends U0**: `nowPlayingService` gains a `tick` event; `server` gains the export download
route; `config` gains the database path.

**Stories**: US-10, US-11, US-12, US-25, and the *recording* half of US-13
**Requirements**: FR-17–23, FR-49–54, NFR-08–13

**Exit criteria**
- [ ] Property tests cover the outcome classifier, including pause, seek, replay and session end
- [ ] A real listening session records correct outcomes — **live verification required**
- [ ] History survives a container rebuild
- [ ] Export downloads with every field present, `unknown` distinct, provenance marked
- [ ] **ISRC recorded on every play**

> **The ISRC criterion is the load-bearing one.** It is what makes U2's retrospective label
> backfill possible, and therefore what makes shipping U1 before U2 a reversible decision rather
> than a one-way door. Omitting it would silently make it one.

---

## U2 — Label Enrichment

**Purpose**: resolve each track's label and classify it, and backfill U1's accumulated history.

**Modules**
```
src/musicbrainz/  labelClassifier ⚙️  MusicBrainzClient  RequestQueue
                  LabelCache  LabelBackfillJob
```

**Extends U0**: `spotify/enrichment` surfaces `external_ids.isrc` and carries label fields.
**Depends on U1**: the label cache and backfill both write through the history repository.

**Stories**: US-08, US-09
**Requirements**: FR-12–16, NFR-14–15

**Exit criteria**
- [ ] Label resolves for a representative sample — **live verification required**
- [ ] Coverage rate measured and exposed in diagnostics
- [ ] Classification records per-signal votes; disagreement preserved
- [ ] `unknown` visibly distinct from `independent`
- [ ] U1 history backfilled via stored ISRCs
- [ ] MusicBrainz never delays the now-playing display
- [ ] **Hypothesis tested against exported data; result recorded either way**

> The last criterion is the Phase 2 decision gate. It is a unit exit criterion because it is the
> point of the unit — U2 exists to make R1 answerable, not merely to display a label.

---

## U3 — Rule Model & Evaluation

**Purpose**: the pure core of the rules engine — everything needed to decide, nothing that acts
or observes.

**Modules**
```
src/rules/  fieldCatalogue ⚙️  TrackFacts ⚙️  predicate ⚙️
            ruleValidator ⚙️  RuleEngine ⚙️  RuleStore
```

**Six modules, five of them pure.** `RuleStore` is the only I/O, and only because a JSON file has
to be read from somewhere.

**Stories**: US-14, US-15, US-16, US-17
**Requirements**: FR-24–33, FR-43–45, NFR-25–27

**Done means: CI green.** This is the one unit gated on tests alone, and deliberately so — its
correctness is entirely a property of pure functions. A live listening session would tell you
nothing a property test does not, and would take hours to tell you it.

**Exit criteria**
- [ ] Tri-state evaluation property-tested — `unknown` never collapses to `false`, including
      under NOT and OR
- [ ] Composition obeys De Morgan's laws
- [ ] No field value causes a throw, for any input
- [ ] Invalid rules rejected at creation with a usable message
- [ ] Rules round-trip through storage with identical behaviour
- [ ] Evaluation is deterministic and side-effect free
- [ ] **No import of I/O, clock, network or database anywhere in the five pure modules**

> **U3 is not independently runnable, and that is the point.** It produces `Decision` values that
> nothing yet consumes. Splitting it out means the riskiest logic in the project is proven correct
> *before* anything depends on its behaviour — which is the unit-level expression of the same
> containment argument that keeps Phase 3 unable to act.

---

## U4 — Rule Observability

**Purpose**: make U3's decisions visible, and make them checkable against real history.

**Modules**
```
src/rules/  DecisionLog  DecisionExecutor (LoggingExecutor only)  BackTestService
```

**Extends U0**: `server` gains read-only rule and decision-log endpoints; the UI displays rules
read-only (Q2 = A from Application Design).

**Stories**: US-20, US-23, US-24
**Requirements**: FR-37, FR-41, FR-42

**Exit criteria**
- [ ] Every evaluation logged with rule, field values seen, and verdict
- [ ] Decisions resting on unknown or partial data marked as such
- [ ] Dry-run session over real listening produces a match log the user agrees with —
      **live verification required**
- [ ] Back-test produces identical results on repeated runs
- [ ] Back-test excludes rule-initiated skips from the comparison
- [ ] Unknown fields reported in back-test output, not silently excluded
- [ ] **`DecisionExecutor` has exactly one implementation, and it cannot skip**

> The last criterion is verified by inspection of the import graph, not by a runtime flag. At the
> end of U4, `src/playback/` does not exist.

---

## U5 — Automated Skipping

**Purpose**: arm it, with interlocks that make being wrong recoverable.

**Modules**
```
src/playback/  PlaybackController  SafetyGovernor ⚙️🔌
src/rules/     SkipExecutor  EnrichmentPrewarmer
```

**Extends U0**: `spotify/webApiClient` gains `POST /me/player/next` and
`GET /me/player/queue`.

**Stories**: US-18, US-19, US-21, US-22, and the *attribution* half of US-13
**Requirements**: FR-34–36, FR-38–40, FR-46–48

**Exit criteria**
- [ ] **Queue lookahead probed during active playback; result recorded either way (R11)**
- [ ] A matched track is skipped silently, with no confirmation prompt — **live verification**
- [ ] A failed skip is surfaced and does not loop
- [ ] Runaway guard halts a deliberately over-broad rule
- [ ] Kill switch halts immediately and persists across restart
- [ ] Rule-initiated skips recorded distinctly and excluded from preference signal
- [ ] Automation confirmed **off by default** on a fresh install

> **R11 is probed first, not last.** `EnrichmentPrewarmer` may be dropped entirely if queue
> lookahead proves unavailable during playback; FR-34/35's deadline fallback already covers that
> case. Designing around unverified lookahead and discovering the problem afterwards is the
> avoidable version of this risk.

---

## U6 — User-Data Lifecycle *(Phase 5)*

**Purpose**: make the corpus **movable and recoverable** — *Create backup* / *Restore backup* in a
Settings pop-up, without stopping the app.

⚠️ **Amended 2026-10-07 by the Functional Design.** This entry first described U6 as *"adds no feature,
EXTENDS the scripts, no user story"*. The FD answers changed all three: backup and restore are **in-app**
(user-facing feature, FR-57…FR-64), they run **inside the app's own process** (which is what removes the
cross-machine writer-guard problem), and the unit has **US-28**. The scripts remain as a developer facility.

**Modules** (logical — names allocated in NFR Design)
```
src/maintenance/   backup (online, node:sqlite backup()), restore staging, startup swap, temp sweep
src/ingest/        FR-64's ONE admission path — transport, archive extraction, content checks (reused by U7)
src/backup/        the 8-check verifier, MOVED from scripts/restore-history.mjs and imported by both
public/            Settings pop-up; Export and Diagnostics move into it
scripts/           db:backup / db:restore / db:verify-backups — developer-only, now importing the verifier
```

**Stories**: **US-28**. **Requirements**: **FR-57…FR-64**. **Rules**: BR-44…BR-52.
FD: `construction/u6-data-lifecycle/functional-design/`.

**Exit criterion is an operation, not a screen**: a corpus backed up on one machine, restored on another,
and the restored app runs.

---

## U7 — Configuration Management *(Phase 5)* — declared 2026-10-07, NOT YET DESIGNED

**Purpose**: on an appliance the user cannot edit host files, so **rules and credentials must be
manageable from inside the app**. Split out of U6 by FD T1 = A (2026-10-07).

**Gates U9** alongside U6. **Reuses U6's FR-64 admission path** for every file it ingests — it does not get
its own.

**Scope as settled so far** (U6 FD §10): rules **download/upload now, a built-in editor later** (T2 = C),
validated by U3's validator **before** any write · credentials via **write-only settings fields** for
non-OAuth values plus **upload of the `spotify-config.json` produced by `npm run auth`** run where the
browser is (T3 = A; in-app OAuth needs TLS → W-10) · offering to apply a backup's `rules.json` during a
U6 restore.

⚠️ **It reopens a settled posture decision**: Infrastructure Q1 made `config/` `:ro` so the app could never
overwrite hand-authored rules. U7 makes the app write rules **by design**, so where they live is its first
question — ⚠️ **never `state/`** (*"a kill switch stored in the same writable directory as the file an AI
agent edits is a kill switch that agent can disable"*). ⚠️ And `secrets/spotify-config.json` is a
**single-file `:rw` bind mount**, so writing it must be in place (inode hazard).

---

## U8 — Team Workflow & Onboarding *(Phase 5)* — declared 2026-10-07, NOT YET DESIGNED

**Purpose**: a second person can review, install and contribute **without this project's tacit knowledge**.
Added by Units Question 4 = A — this work was previously listed only as *"(later) team workflow + onboarding
docs"*, with no unit, no design stage and no exit criteria.

**Scope as settled by the Phase 5 requirements round** (`requirement-verification-questions.md`):
`main` protected with PRs and required CI, owner may push directly (**Q13 = B**) · `smoke` and `knip` in CI,
with the workflow saying `smoke` is a link check there (**Q14 = A**; closes the gap owed from U5's NFR Q9) ·
short README + `docs/INSTALL.md` + `CONTRIBUTING.md` (**Q15 = A**) · `SECURITY.md` · licence **GPL-3.0**
(**Q16 = C**; ⚠️ the bundled MCP server has **no licence** — no built image may be published until resolved) · an install routine written once for both a person and an AI agent, every step with its verification
command and expected output (**Q17 = C**) · each user registers their own Spotify app (**Q17a = A**) ·
credentials never in the repo, enforced in CI (**Q17b = B**) · rewrite `CLAUDE.md`'s single-developer assumption.

**Requirements**: **FR-65**, **NFR-28, NFR-30–NFR-33**.

**Depends on**: U6 and U7 — the install routine documents *Restore backup* and the in-app credential and rules
steps. **Stories**: none yet — to be settled in its FD, not invented here.

---

## U9 — Off-machine Deployment *(Phase 5)* — NOT YET DESIGNED

**Target**: the owner's Synology NAS, **`SYNNAS` (192.168.0.223)**, on a private, non-forwarding LAN.

**Purpose**: the app runs on another machine on the user's LAN (a Synology NAS first), fully working, under
the security posture chosen in Requirements **Question 11a = B**: **delegated authentication** (NFR-29) —
an OIDC sign-in at a proxy that terminates TLS, and a signed-token check in the app. The user's NAS has its
OAuth/SSO service installed but unconfigured — a candidate identity provider, **to be probed**. A Synology MCP
server could let the agent do NAS configuration directly; ⚠️ that is an administrator credential (NFR-28,
least privilege).

**Depends on**: U6 (the corpus can move), U7 (an appliance needs in-app configuration), U8 (the deployment is
performed **by following U8's install routine** — so the cold walk is this unit's verification).

**Carried into its design plan** (Units round, *Carried to U9's design plan*): **U9-a** NAS as *the* deployment
or a throwaway second one · **U9-b** two deployments on one Spotify registration · probe **WAL on the NAS
volume** · verify the WebSocket handshake **both directions** off-machine. ⚠️ U6's upload routes must not be
reachable off-machine before Question 11 is decided.

---

## Code organisation strategy

**Single package, flat feature directories.** No workspaces, no monorepo, no per-unit packages.

```
src/
├── config.ts  localGuard.ts  nowPlayingService.ts  diagnostics.ts  server.ts   ── U0
├── mcp/  spotify/                                                              ── U0
├── history/  export/                                                           ── U1
├── musicbrainz/                                                                ── U2
├── rules/                                                                      ── U3, U4, (U5)
└── playback/                                                                   ── U5
test/
└── mirrors src/, with .property.test.ts alongside .test.ts
```

**Rationale**: one deployable needs one package. Workspaces would add build complexity and
cross-package version management to buy module isolation that directory boundaries and the
pure/impure import rule already provide. The existing codebase is organised this way and works.

**One directory holds three units.** `src/rules/` spans U3, U4 and part of U5. That is
deliberate — they are one cohesive domain delivered in stages, and splitting the directory to
mirror unit boundaries would optimise for a planning artefact over the code's own coherence.

### The constraint that matters more than layout

**Pure modules must import nothing impure.** No `node:fs`, `node:sqlite`, `node:net`, `fetch`, or
`Date.now`. This is checkable mechanically, and worth checking — a violation fails no test while
silently breaking FR-20 (reclassification) and FR-42 (back-testing), because historical replay
would stop agreeing with the original run.

---

## Validation

| Check | Result |
|---|---|
| Every in-scope story assigned to exactly one unit | ✅ See `unit-of-work-story-map.md` |
| No unit depends on a later unit | ✅ See `unit-of-work-dependency.md` |
| Each phase's units together deliver a runnable app | ✅ Phase 3 = U3 + U4 |
| U3 buildable with no playback code path | ✅ `src/playback/` does not exist until U5 |
| Deployment model consistent | ✅ Single container throughout |
