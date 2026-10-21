# Application Design — Consolidated

**Date**: 2026-08-25 · **Stage**: INCEPTION — Application Design
**Detail documents**: [`components.md`](components.md) ·
[`component-methods.md`](component-methods.md) · [`services.md`](services.md) ·
[`component-dependency.md`](component-dependency.md)

> ⚠️ **This is the inception-time plan** (2026-08-25). Some components here were never built under these names. The
> system as built is in [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) (added 2026-10-21, pre-public
> solution review §3.9).

---

## 1. Design decisions

| # | Decision | Source |
|---|---|---|
| D-A | **Plays plus observation trail** — one row per play with the live verdict, plus the progress samples it was derived from | Q1 = C |
| D-B | **Rules authored as a schema-validated JSON file**; the UI displays them read-only | Q2 = A |
| D-C | **Flat feature-grouped layout, pure domain logic isolated** into dependency-free modules | Q3 = C |
| D-D | **Schema grows per phase via forward-only migrations** | Q4 = B |

### Why D-A matters more than it looks

FR-20 requires that outcomes be recomputable when the classifier improves. An evidence *snapshot*
would satisfy that only for classifiers using the fields we happened to save — meaning the first
schema decision silently caps every future improvement, and does so invisibly.

Retaining the trail means a better classifier can be applied to the complete record. Given that
listening history is the one artefact in this project that **cannot be regenerated**, the design
errs toward keeping more. The trail is prunable later once the classifier stabilises; the reverse
is impossible.

### Why D-C is structural, not stylistic

The pure/impure split is what makes three requirements achievable at once:

- **FR-20** — reclassification is a pure function of stored data, not of deployment state
- **FR-42** — back-testing replays the *same* evaluation code over history with no I/O to stub
- **NFR-25/26** — property tests need determinism and totality

A single `Date.now()` inside the classifier would break all three, and **would not fail any
test**. It would just make historical re-classification disagree with the original run.

---

## 2. Component map

```
src/
├── config.ts            🔌  extended: db path, rules path, automation flags
├── localGuard.ts        ⚙️🔌 UNCHANGED — download-only export needs no security change
├── nowPlayingService.ts 🔌  extended: tick / change / trackStart events
├── diagnostics.ts       🔌  extended: one step per subsystem
├── server.ts            🔌  extended: export download, rules read endpoints
├── mcp/                 🔌⚙️ unchanged
├── spotify/             🔌  extended: ISRC surfaced, next/queue/recently-played
│
├── history/                                          ── Phase 1
│   ├── outcomeClassifier.ts   ⚙️ PURE   FR-18,19,20
│   ├── PlayObserver.ts        🔌        FR-17,18
│   ├── HistoryRepository.ts   🔌 iface  NFR-10
│   ├── SqliteHistoryRepo.ts   🔌        NFR-08,11
│   ├── migrations.ts          🔌        NFR-12
│   └── RecentlyPlayedBackfill 🔌        FR-22
│
├── export/                                           ── Phase 1
│   ├── serialisers.ts         ⚙️ PURE   FR-49,50,51,54
│   └── ExportService.ts       🔌        FR-52,53
│
├── musicbrainz/                                      ── Phase 2
│   ├── labelClassifier.ts     ⚙️ PURE   FR-13,16
│   ├── MusicBrainzClient.ts   🔌        FR-12
│   ├── RequestQueue.ts        🔌        FR-15
│   ├── LabelCache.ts          🔌        FR-14
│   └── LabelBackfillJob.ts    🔌        FR-12
│
├── rules/                                            ── Phase 3
│   ├── fieldCatalogue.ts      ⚙️ PURE   FR-27,28
│   ├── TrackFacts.ts          ⚙️ PURE   FR-27
│   ├── predicate.ts           ⚙️ PURE   FR-29,32,43
│   ├── ruleValidator.ts       ⚙️ PURE   FR-45
│   ├── RuleEngine.ts          ⚙️ PURE   FR-24,26,30,33
│   ├── RuleStore.ts           🔌        FR-25,31,44
│   ├── DecisionLog.ts         🔌        FR-41
│   ├── BackTestService.ts     🔌        FR-42
│   └── DecisionExecutor.ts    🔌        ← THE PHASE BOUNDARY
│
└── playback/                                         ── Phase 4
    ├── PlaybackController.ts  🔌        FR-46,48
    ├── SafetyGovernor.ts      ⚙️🔌      FR-38,39,40
    └── EnrichmentPrewarmer.ts 🔌        FR-36 (contingent on R11)
```

**9 pure components carry the correctness-critical logic. 15 impure components are thin adapters.**

---

## 3. The three decisions that carry the most weight

### 3.1 `DecisionExecutor` makes Phase 3's inertness structural

`RuleEngine` produces a `Decision`. It does not act. A separate executor consumes it.

| Phase | Executors | Consequence |
|---|---|---|
| 3 | `LoggingExecutor` only | **No code path from a decision to a skip exists** |
| 4 | `+ SkipExecutor` | Skips occur, gated by `SafetyGovernor` |

The alternative — an `if (automationEnabled)` inside a single executor — would leave the skip path
present in Phase 3 and reachable by mistake. With the strategy split, "the rules engine cannot
act" is verifiable by reading the import graph rather than by trusting a flag.

This is the design-level expression of the execution plan's central risk-containment move.

### 3.2 `NowPlayingService` must emit `tick` separately from `change`

`#publish` suppresses unchanged snapshots via `#lastSignature`, which deliberately excludes
progress so the UI is not spammed.

**If history capture consumed `change`, the observation trail would contain only samples where
something else changed** — losing exactly the progress data the classifier depends on. The
classifier would still produce verdicts; they would simply be wrong, and the error would stay
invisible until someone tried to analyse months of corrupted history.

Hence three events with distinct contracts: `tick` (every poll), `change` (suppressed, for the
UI), `trackStart` (derived, for rules).

### 3.3 `unknown` is a value everywhere, not an absence

`Maybe<T>` appears in `TrackFacts`, `PlayRecord`, the field catalogue, the predicate evaluator and
the export serialisers. Three specific consequences:

- History counts are `Maybe<number>`, **not `number`** — zero and unknown are different claims,
  and conflating them makes "never skipped this" true for a track never seen (US-16)
- `evaluate()` returns `'match' | 'no-match' | 'unknown'`, never a boolean (FR-32)
- `renderMaybe()` in the serialisers must never emit blank, zero or false for unknown (FR-51)

R2's missing-data bias is *correlated with the variable being measured*. If `unknown` collapses
anywhere along this chain, that bias becomes invisible downstream — which is the failure mode most
likely to make the whole dataset quietly worthless.

---

## 4. Requirements coverage

| Requirement group | Components |
|---|---|
| FR-17–23 History | outcomeClassifier, PlayObserver, HistoryRepository, migrations, RecentlyPlayedBackfill |
| FR-49–54 Export | serialisers, ExportService |
| FR-12–16 Labels | labelClassifier, MusicBrainzClient, RequestQueue, LabelCache, LabelBackfillJob |
| FR-24–33 Rules | fieldCatalogue, TrackFacts, predicate, RuleEngine |
| FR-43–45 Representation | predicate, ruleValidator, RuleStore |
| FR-37, 41, 42 Observability | DecisionExecutor, DecisionLog, BackTestService |
| FR-34–36 Timing | AutomationService, EnrichmentPrewarmer |
| FR-38–40 Safety | SafetyGovernor |
| FR-46–48 Playback | PlaybackController |
| NFR-08–13 Persistence | HistoryRepository interface, SqliteHistoryRepo, migrations |
| NFR-14–15 External | RequestQueue, MusicBrainzClient |
| NFR-20–27 Testability | all 9 pure components |
| NFR-01–07 Security | `localGuard` **unchanged** |

**Every in-scope functional requirement maps to at least one component.** FR-55 is wishlisted
(W-1) and has no component, correctly.

---

## 5. Validation

| Check | Result |
|---|---|
| Every component traces to requirements | ✅ See §4 and the inventory in `components.md` |
| Pure/impure separation holds for property-tested logic | ✅ No pure component imports I/O; matrix in `component-dependency.md` |
| Phase 3 buildable with no playback path | ✅ `DecisionExecutor` strategy; `playback/` does not exist until Phase 4 |
| No circular dependencies | ✅ Two near-cycles broken deliberately — see `component-dependency.md` |
| Existing structure extended, not replaced | ✅ Flat feature directories alongside `mcp/` and `spotify/` |
| Security posture unchanged | ✅ `localGuard` untouched; no new listener or exposure |

---

## 6. Open items carried into Functional Design

| # | Item | Needed by |
|---|---|---|
| R11 | Queue lookahead unverified during playback — `EnrichmentPrewarmer` may be dropped entirely | Phase 4 |
| — | Classifier tolerance values (completion threshold, staleness window) — deliberately parameters, not constants, so they can be tuned and re-run | Phase 1 Functional Design |
| — | Curated major-label root list — content and maintenance | Phase 2 Functional Design |
| — | Rules JSON schema — concrete shape and validation messages | Phase 3 Functional Design |
| — | Safety default limits — skip rate, consecutive-skip threshold | Phase 4 Functional Design |
| R10 | `node:sqlite` experimental in Node 22.17 — repository interface contains it | Ongoing |

---

## 7. Risk to watch

**The pure/impure boundary eroding under deadline pressure** is the most likely design failure,
and the least visible one.

A `Date.now()` or a config read inside `outcomeClassifier`, `RuleEngine` or `labelClassifier`
would not fail any existing test. It would break FR-20 and FR-42 silently — historical
re-classification would disagree with the original run, and back-testing would stop being a
faithful replay of live behaviour.

Worth an explicit check during Build and Test: **assert that pure modules import nothing impure.**
That is mechanically verifiable, and cheaper than discovering the problem in a year's worth of
data.
