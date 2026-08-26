# Components

**Date**: 2026-08-25 · **Stage**: INCEPTION — Application Design
**Decisions applied**: Q1 = C (plays + observation trail) · Q2 = A (JSON rules file) ·
Q3 = C (flat layout, pure domain isolated) · Q4 = B (per-phase migrations)

---

## Organising principle

Q3 = C splits every subsystem into two kinds of module, and the split is load-bearing rather than
stylistic:

| Kind | Rule | Why it matters |
|---|---|---|
| **Pure** ⚙️ | No imports of I/O, clock, network, or database. Deterministic. All inputs are arguments | These are the property-tested modules (NFR-20/22/25/26). Back-testing (FR-42) replays them over history with no stubbing, which is only possible if they never reach for the world themselves |
| **Impure** 🔌 | Talks to Spotify, MusicBrainz, SQLite, the filesystem, or the clock | Kept thin. Exercised by the diagnostics endpoint and live verification rather than unit tests |

**Where the boundary sits is the design.** Anything whose correctness matters and can be
expressed as a function of its inputs belongs on the pure side — outcome classification, label
classification, rule evaluation, export serialisation.

---

## Existing components — unchanged or extended

| Component | Kind | Status | Change |
|---|---|---|---|
| `config` | 🔌 | Existing | Extend: database path, rules file path, automation flags |
| `localGuard` | ⚙️+🔌 | Existing | **None.** Download-only export requires no change (§3.5) |
| `mcp/parseNowPlaying` | ⚙️ | Existing | None |
| `mcp/spotifyMcpClient` | 🔌 | Existing | None |
| `spotify/webApiClient` | 🔌 | Existing | Extend: `POST /me/player/next`, `GET /me/player/queue`, `GET /me/player/recently-played` |
| `spotify/enrichment` | 🔌 | Existing | Extend: surface `external_ids.isrc`; carry label fields from Phase 2 |
| `nowPlayingService` | 🔌 | Existing | **Extend: emit a per-poll `tick` event** — see note below |
| `diagnostics` | 🔌 | Existing | Extend: one step per new subsystem |
| `server` | 🔌 | Existing | Extend: export download, rules read endpoints |

### ⚠️ `nowPlayingService` needs a new event, and this is easy to get wrong

`NowPlayingService.#publish` suppresses unchanged snapshots via `#lastSignature`, and the
signature deliberately ignores progress so the UI is not spammed. **Observation collection must
not consume that stream** — it would lose exactly the progress samples the outcome classifier
depends on.

The service therefore emits two distinct events:

- **`tick`** — every poll, unconditionally, including unchanged ones. Consumed by `PlayObserver`.
- **`change`** — the existing suppressed stream. Consumed by the WebSocket broadcast.

A third, **`trackStart`**, is derived from `tick` and is what the rules engine subscribes to.

---

## Phase 1 — Listening history and export

### `history/outcomeClassifier` ⚙️ **PURE**

The single most correctness-critical module in the project.

**Responsibility**: given an observation trail for one play, decide `completed` / `skipped` /
`unknown`, and report the evidence supporting that verdict. (Three values — `abandoned` was
retired in U1 Functional Design, Q7.)

**Why it is pure**: FR-20 requires outcomes to be recomputable when the classifier improves.
That is only meaningfully true if classification is a function of stored data — no clock, no
database, no "what was playing at the time". Purity is the mechanism by which FR-20 is satisfied,
not a stylistic preference.

Handles the confounders enumerated in US-11: poll-interval staleness, pause/resume, seek,
replay, session end.

### `history/PlayObserver` 🔌

**Responsibility**: consume `tick` events, segment them into plays, accumulate each play's
observation trail, and hand completed plays to the repository. Detects track boundaries and
replays.

Deliberately thin — it decides *where a play ends*, not *what the outcome was*. That judgement
belongs to the pure classifier.

### `history/HistoryRepository` (interface) + `history/SqliteHistoryRepository` 🔌

**Responsibility**: persist and query plays and their observation trails. NFR-10 requires the
interface so a later move to Postgres needs no call-site changes.

Two tables (Q1 = C): `play` (one row per play, with the live verdict) and `observation` (the
trail, foreign-keyed to a play, prunable independently).

### `history/migrations` 🔌

**Responsibility**: versioned, forward-only schema migration. Q4 = B makes this load-bearing from
day one — Phase 2's label backfill and Phase 4's action columns both arrive as migrations over
real accumulated data.

Must never drop and recreate (NFR-12).

### `history/RecentlyPlayedBackfill` 🔌

**Responsibility**: on startup, fill gaps from `GET /me/player/recently-played` (FR-22). Marks
rows as backfilled with **no reliable outcome** — never as completions.

### `export/serialisers` ⚙️ **PURE**

**Responsibility**: turn play records into CSV and JSON (FR-49–51, FR-54). Pure so the
`unknown`-representation and provenance rules are property-testable, since getting those wrong
silently corrupts downstream analysis (R2).

### `export/ExportService` 🔌

**Responsibility**: query the repository, stream through a serialiser, produce a download.
Streams rather than buffers so a large history does not stall the display (US-25).

---

## Phase 2 — Label enrichment

### `musicbrainz/labelClassifier` ⚙️ **PURE**

**Responsibility**: given a label name, ISRC, and MusicBrainz relationships, produce
`major | independent | unknown` **plus the per-signal votes** (FR-13).

Three signals, which disagree on real data: curated major-label roots, MusicBrainz label
relationships, and the ISRC registrant code (`USUM71703861` → `UM7` → Universal). The component
records the disagreement rather than resolving it silently.

### `musicbrainz/MusicBrainzClient` + `musicbrainz/RequestQueue` 🔌

**Responsibility**: ISRC → recording → release → `label-info`, serialised at ≤1 req/sec with an
identifying `User-Agent` (NFR-14/15). The queue is separate so rate limiting is enforced in one
place and cannot be bypassed by a new caller.

### `musicbrainz/LabelCache` 🔌

**Responsibility**: persist resolutions by ISRC so each is fetched at most once (FR-14), across
restarts.

### `musicbrainz/LabelBackfillJob` 🔌

**Responsibility**: resolve labels for plays recorded before Phase 2, using stored ISRCs. This
is what makes Phase 1 shipping-before-Phase-2 a reversible decision rather than a one-way door.

---

## Phase 3 — Rules engine

### `rules/fieldCatalogue` ⚙️ **PURE**

**Responsibility**: define every referenceable field — name, type, domain, typical availability,
and how to read it from a `TrackFacts` record (FR-28).

**This is what makes FR-27 tractable.** Without it, "any known information" means the engine
hard-codes a field list and every new enrichment field requires engine changes to become
rule-usable.

### `rules/TrackFacts` ⚙️ **PURE (type + assembler)**

**Responsibility**: the flattened, tri-state record rules evaluate against. Merges Spotify
enrichment, label classification, playback context, and history-derived counts into one shape
where every field is `value | unknown`.

Flattened deliberately: it keeps the catalogue, the predicate evaluator, and the export schema
aligned, and avoids path-expression complexity.

### `rules/predicate` ⚙️ **PURE**

**Responsibility**: the predicate tree type and its **tri-state evaluator** (FR-29, FR-32,
FR-43). Comparison, AND/OR/NOT to any depth, `unknown` propagating correctly rather than
collapsing to `false`.

Property-tested against De Morgan's laws and unknown-propagation (NFR-25).

### `rules/ruleValidator` ⚙️ **PURE**

**Responsibility**: validate a rule against the catalogue at creation time — unknown fields and
type-mismatched comparisons rejected before storage, not at evaluation (FR-45).

### `rules/RuleStore` 🔌

**Responsibility**: load, validate and watch the JSON rules file (Q2 = A). The only impure part
of rule handling. Rejects the whole file on validation failure rather than silently loading a
partial rule set.

### `rules/RuleEngine` ⚙️ **PURE**

**Responsibility**: evaluate enabled rules against `TrackFacts`, apply each rule's declared
unknown-behaviour (FR-33), and **OR-fold** the results into a single `Decision` (FR-30).

Pure so back-testing replays it over history with no I/O — which is what makes FR-42 a genuine
correctness check rather than a simulation.

**The OR-fold is one named function.** Q-B's deferred exemption rules replace that function
rather than rippling through the engine.

### `rules/DecisionLog` 🔌

**Responsibility**: persist every evaluation and action with rule, field values seen, and verdict
(FR-41), including whether the decision rested on unknown or partial data.

### `rules/BackTestService` 🔌

**Responsibility**: replay a rule over stored history and compare against what the user actually
did (FR-42), excluding rule-initiated skips from the comparison (FR-23).

---

## Phase 4 — Playback control and safety

### `playback/PlaybackController` 🔌

**Responsibility**: skip via `POST /me/player/next`; confirm the skip took effect; surface
failure rather than retrying indefinitely (FR-46, FR-48).

### `playback/SafetyGovernor` ⚙️+🔌

**Responsibility**: the interlocks — kill switch (FR-38), skip rate limit and consecutive-skip
halt (FR-39), no-repeat-skip per track (FR-40).

Decision logic is pure and property-testable; the persisted kill-switch state is the impure part.

### `rules/DecisionExecutor` 🔌 — **the phase boundary**

**Responsibility**: consume a `Decision` and act on it.

This component is what keeps Phase 3 genuinely inert. `RuleEngine` produces a `Decision`; it does
not act. In **Phase 3 the only executor is the logger** — no code path from a decision to a skip
exists at all. **Phase 4 adds a second executor** that consults `SafetyGovernor` and calls
`PlaybackController`.

That structure is why "the rules engine cannot act" is verifiable by inspection rather than by
trusting a feature flag.

### `rules/EnrichmentPrewarmer` 🔌

**Responsibility**: fetch enrichment for upcoming queue entries so slow fields resolve before the
track starts (FR-36).

**Contingent on R11** — `GET /me/player/queue` is confirmed reachable but unverified during
active playback. If lookahead proves unavailable this component is dropped, and FR-34/35's
deadline fallback carries the behaviour instead.

---

## Component inventory

| # | Component | Phase | Kind | Requirements |
|---|---|---|---|---|
| 1 | `history/outcomeClassifier` | 1 | ⚙️ | FR-18, 19, 20 |
| 2 | `history/PlayObserver` | 1 | 🔌 | FR-17, 18 |
| 3 | `history/HistoryRepository` | 1 | 🔌 | FR-17, 21, NFR-08–13 |
| 4 | `history/migrations` | 1 | 🔌 | NFR-12 |
| 5 | `history/RecentlyPlayedBackfill` | 1 | 🔌 | FR-22 |
| 6 | `export/serialisers` | 1 | ⚙️ | FR-49, 50, 51, 54 |
| 7 | `export/ExportService` | 1 | 🔌 | FR-52, 53 |
| 8 | `musicbrainz/labelClassifier` | 2 | ⚙️ | FR-13, 16 |
| 9 | `musicbrainz/MusicBrainzClient` | 2 | 🔌 | FR-12, NFR-14 |
| 10 | `musicbrainz/RequestQueue` | 2 | 🔌 | FR-15, NFR-15 |
| 11 | `musicbrainz/LabelCache` | 2 | 🔌 | FR-14 |
| 12 | `musicbrainz/LabelBackfillJob` | 2 | 🔌 | FR-12 |
| 13 | `rules/fieldCatalogue` | 3 | ⚙️ | FR-27, 28 |
| 14 | `rules/TrackFacts` | 3 | ⚙️ | FR-27 |
| 15 | `rules/predicate` | 3 | ⚙️ | FR-29, 32, 43 |
| 16 | `rules/ruleValidator` | 3 | ⚙️ | FR-45 |
| 17 | `rules/RuleStore` | 3 | 🔌 | FR-25, 31, 44 |
| 18 | `rules/RuleEngine` | 3 | ⚙️ | FR-24, 26, 30, 33 |
| 19 | `rules/DecisionLog` | 3 | 🔌 | FR-41 |
| 20 | `rules/BackTestService` | 3 | 🔌 | FR-42 |
| 21 | `rules/DecisionExecutor` | 3/4 | 🔌 | FR-37, 47 |
| 22 | `playback/PlaybackController` | 4 | 🔌 | FR-46, 48 |
| 23 | `playback/SafetyGovernor` | 4 | ⚙️+🔌 | FR-38, 39, 40 |
| 24 | `rules/EnrichmentPrewarmer` | 4 | 🔌 | FR-36 |

**9 pure components carry the correctness-critical logic; 15 impure components are thin
adapters.**
