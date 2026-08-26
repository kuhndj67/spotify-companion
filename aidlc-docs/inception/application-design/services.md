# Services

**Date**: 2026-08-25 · **Stage**: INCEPTION — Application Design

Services are the **orchestration layer**: they own lifecycle, sequencing and error policy, and
they compose components. They hold no correctness-critical logic themselves — that lives in the
pure components, so it can be property-tested and replayed.

---

## Service inventory

| Service | Phase | Owns | Composed from |
|---|---|---|---|
| `NowPlayingService` | 0 (extend) | Poll loop, event fan-out | MCP client, parser, enrichment |
| `HistoryService` | 1 | Observation capture, persistence lifecycle | PlayObserver, classifier, repository, migrations, backfill |
| `ExportService` | 1 | Streaming export | Repository, serialisers |
| `LabelService` | 2 | Label resolution and caching | MB client, queue, classifier, cache, backfill job |
| `AutomationService` | 3–4 | Rule evaluation on track start | RuleStore, RuleEngine, DecisionExecutor, DecisionLog |
| `DiagnosticsService` | 0 (extend) | Subsystem health | All of the above |

---

## `NowPlayingService` — extended

**Existing responsibility**: poll the MCP server, parse, enrich, publish snapshots.

**New responsibility**: emit three distinct events, because three consumers need different
things.

| Event | Emitted | Consumer | Why separate |
|---|---|---|---|
| `tick` | Every poll, unconditionally | `HistoryService` | Observation capture needs **every** progress sample |
| `change` | Only when the snapshot signature changes | WebSocket broadcast | Existing behaviour; avoids spamming the UI |
| `trackStart` | When a new play begins | `AutomationService` | The rules trigger (FR-24) |

> ### The trap this avoids
>
> `#publish` suppresses unchanged snapshots via `#lastSignature`, and that signature deliberately
> excludes progress. If history capture consumed `change`, the observation trail would contain
> only the samples where something *else* changed — losing precisely the progress data the outcome
> classifier depends on, and doing so silently.
>
> A classifier fed a sparse trail would still produce verdicts. They would just be wrong, and the
> error would be invisible until someone tried to analyse months of corrupted history.

**Error policy**: unchanged. Poll failures surface as error snapshots; the loop continues.

---

## `HistoryService` — Phase 1

**Responsibility**: everything between a poll tick and a durable play record.

**Startup sequence**, order significant:
1. Open the database; run migrations to current version (fail fast — a half-migrated schema must
   never accept writes)
2. Run `RecentlyPlayedBackfill`, deduplicating against existing rows
3. Subscribe `PlayObserver` to `tick`

**Per-tick flow**: `tick` → `PlayObserver.#onTick` → boundary? → `summarise(trail)` →
`classify(evidence)` → `repository.recordPlay(play, trail)`.

**Error policy — NFR-13**: a persistence failure must degrade the app to display-only, never
crash it. Concretely: log once per failure class rather than per tick, keep serving the UI, and
surface the degraded state through diagnostics. **Do not silently drop plays without recording
that a gap exists** — a silent gap is indistinguishable from "nothing was playing", which
corrupts the dataset in a way that cannot be detected later.

**Concurrency**: `node:sqlite` is synchronous. Writes are small and infrequent (~200/day plus
trail rows), so the simplest correct approach is a single writer with WAL enabled. Batch trail
inserts per play rather than per observation.

---

## `ExportService` — Phase 1

**Responsibility**: turn a history query into a download (FR-49–54).

**Flow**: HTTP request → filter parsing → `repository.listPlays()` async iteration → serialiser →
streamed response with `Content-Disposition: attachment`.

**Streams rather than buffers.** A year of history is ~70k play rows; buffering that into a
string before responding would stall the event loop and the display with it.

**Error policy**: a failure mid-stream cannot un-send sent bytes. Validate the filter and confirm
the repository is readable *before* writing the first byte; after that, terminate the stream and
log rather than attempting recovery.

**Access**: served through the existing `localGuard` on the normal loopback listener. No new
exposure — §3.5's download-only decision means this service needs no security design.

---

## `LabelService` — Phase 2

**Responsibility**: ISRC → label → classification, without ever delaying the display.

**Flow**: enrichment yields an ISRC → cache hit returns immediately → miss enqueues on
`RequestQueue` → `MusicBrainzClient` resolves → `classifyLabel` → cached → **enrichment updated
asynchronously and pushed to the UI when it lands**.

**The display never awaits this** (US-08). The now-playing panel renders with the label absent
and fills in when resolution completes.

**Rate limiting**: all MusicBrainz traffic passes through one `RequestQueue`. Enforcing it inside
the client rather than at call sites means a new caller cannot accidentally bypass it — which
matters because `LabelBackfillJob` issues thousands of requests and must share the same budget as
live lookups.

**Backfill policy**: runs at low priority behind live requests, in batches, resumable. A backfill
of months of history at ~1 req/sec takes hours — it must not block, and must survive restart
without redoing completed work.

**Error policy**: MusicBrainz unavailable → classification is `unknown` with a reason, never a
guess, never a failure that propagates to the display (FR-16).

---

## `AutomationService` — Phases 3–4

**Responsibility**: evaluate rules when a track starts, and route the decision to an executor.

**Flow**:
```
trackStart
  → assembleFacts(enrichment, label, context, history)
  → evaluateRules(rules, facts)
  → foldDecisions(outcomes)          → Decision
  → DecisionExecutor.execute(decision, facts)
  → DecisionLog.record(...)
```

### The phase boundary lives here

| Phase | Executors registered | Consequence |
|---|---|---|
| **3** | `LoggingExecutor` only | **No code path from a decision to a skip exists.** Verifiable by inspection, not by trusting a flag |
| **4** | `LoggingExecutor` + `SkipExecutor` | Skips occur, gated by `SafetyGovernor` |

This is deliberately structural rather than conditional. A boolean `automationEnabled` check
inside one executor would leave the skip path present in Phase 3 code and reachable by mistake.

**Timing policy (FR-34/35, Phase 4)**: evaluate immediately on fast fields; if a referenced field
is still resolving, re-evaluate when it lands, up to the decision deadline. On expiry, act on what
is known and mark the decision `partialData`.

**Dry-run (FR-37)**: a property of the executor, not of the engine. `RuleEngine` is pure and has
no notion of dry-run; the executor decides whether to act. This keeps back-testing and live
evaluation running identical code.

**Error policy**: an evaluation failure must never affect playback or the display. Log the
failure, treat the decision as `none`, continue.

---

## `DiagnosticsService` — extended

One step per new subsystem, following the existing convention that a step whose prerequisite
failed reports **skipped**, not **failed**, so the fault localises:

| Step | Reports |
|---|---|
| Database | Schema version, migration status, writability |
| History | Plays recorded, last recorded time, degraded-mode flag |
| MusicBrainz | Reachability, queue depth, cache hit rate, **coverage rate** |
| Rules | File valid?, rule count, enabled count, validation errors |
| Automation | Executor set (proves Phase 3 inertness), kill-switch state, recent skip count |

The MusicBrainz coverage rate is a first-class diagnostic rather than an internal metric, because
R2's missing-data bias is correlated with the variable being measured — it needs to be visible,
not inferred.

---

## Cross-cutting policies

| Concern | Policy |
|---|---|
| **Failure isolation** | No new subsystem may break the now-playing display. History, labels and rules all degrade independently |
| **Purity boundary** | Services orchestrate; pure components decide. Any logic worth property-testing belongs in a component |
| **Startup ordering** | Migrations before writes; rule validation before automation; backfill after migration |
| **Shutdown** | Flush the in-progress play before exit, recording it as `unknown` — never write a false `completed` or `skipped` |
| **Clock injection** | Anything time-dependent takes a clock, so tests are deterministic |
