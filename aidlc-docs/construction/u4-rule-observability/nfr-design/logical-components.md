# Logical Components — U4: Rule Observability

**Date**: 2026-09-20 · **Stage**: CONSTRUCTION — NFR Design, U4
**Numbering** continues from U3, which ended at **LC-12** and **PBT-20**.

⚙️ = pure · 🔌 = impure

---

## The boundary

U3 was six modules, five pure, importing nothing impure. U4 is the opposite shape: it is **the
wiring**, and most of it is impure by necessity. The purity discipline therefore moves to a
narrower claim:

> **Everything that decides anything stays pure.** The evaluator is U3's. Fact reconstruction,
> agreement classification and trace rendering are new and **pure**. What is impure is storage,
> timers, file reads and HTTP — things that *move* data, never things that *judge* it.

⚠️ **`test/purity.test.ts` must be extended to the new pure modules**, not merely left passing. A
`Date.now()` in `factReconstructor` would break back-test determinism (NFR-26) while every other
test passed — the same trap as the classifier, in a new place.

---

## LC-13 · `rules/DecisionLogRepository` ⚙️ interface / 🔌 SQLite impl

Satisfies **NFR-10**: the call sites name the interface, never `node:sqlite`.

```
record(entries: DecisionLogEntry[]): void      // one transaction, all rows of one decision
attachPlayId(evaluationId, playId): void       // back-fill when the play closes (BR-24.1)
list(filter: DecisionFilter): DecisionLogEntry[]
countSince(since): number
pruneToCap(cap: number): number                // returns rows deleted
```

⚠️ **`pruneToCap` issues two statements** (BR-29.3): a `SELECT` that may join `play` to choose ids,
then a `DELETE` naming **only** the decision table, by explicit id list. Pinned on the SQL text —
a single join-and-delete statement would pass every behavioural test and lose the property.

---

## LC-14 · `rules/EvaluationCoordinator` 🔌 IMPURE

Owns the trigger (BR-22) and the per-play state that makes "one decision per play **in U4**"
enforceable. ⚠️ **It does not own the play boundary** — `PlayObserver` does (BR-22.8).

```
onPlayStarted(sample): void        // from PlayObserver's existing hook
onTick(sample): void
onPlayRecorded(playId, record): void   // back-fills playId (BR-24.1)
```

Holds: current `trackId`, play start instant, `evaluationId`, `decided` flag. Collaborators
injected — clock, rule-set accessor (**the watcher**, LC-16), fact builder, `enrichmentSettled`
(LC-21), `historyCountsBefore`, executor.

⚠️ **Segmentation is not re-derived.** The original pseudo-code rebuilt the boundary from
`trackId` and null samples; the observer already owns it, *including* the `pause-idle` and
`playback-stopped` closes and the null-progress projection in `toPlaybackSample`. Two segmenters
that must agree is the WebSocket `403` shape — and **BR-24.1's back-fill depends on their
agreement**, so a divergence mis-links decisions to plays rather than failing.

⚠️ **Consequence accepted: no repository ⇒ no evaluation** (BR-22.8a). `onPlayRecorded` fires only
after a successful write, so with recording down the engine goes quiet. That is the safe
direction, and the decision log has nowhere to live in that state anyway.

⚠️ **`onPlayRecorded` never fires on a write failure.** The coordinator must mark the row
`link-failed` rather than leave a null `playId` that reads as *"the play never closed"*
(BR-24.3a).

⚠️ **Consumes `tick`, never `change`** (BR-22.6). `change` is signature-suppressed and the
signature excludes progress; a coordinator fed from it would evaluate sparsely and at the wrong
moments, and would look like it was working. `PlayObserver` has an integration test pinning this;
**the coordinator needs its own**.

---

## LC-15 · `rules/LoggingExecutor` 🔌 IMPURE — the phase boundary

```
execute(decision, facts): void     // records; cannot act
```

**The only `DecisionExecutor` implementation in U4.** Constructor takes the decision log and
nothing else — **no playback collaborator, not even an unused one** (P-26, BR-30.2).

---

## LC-16 · `rules/RuleSetWatcher` 🔌 IMPURE

Polling change detection (P-19), 5 s interval, plus a `reloadNow()` the UI button calls. **Both
enter the same `load()`.**

```
start(): void
reloadNow(): LoadResult          // same loader as the poll
current(): LoadedRuleSet
```

**Owns the current rule set** (BR-26.3b, settled 2026-09-20), plus `version` (monotonic,
**accepted loads only** — BR-26.5/26.6), `contentHash`, `state` and the last rejection. On an
invalid file it keeps the last-known-good set (**BR-20.8**, deferred from U3 and reachable here
for the first time).

### ⚠️ `RuleStore` becomes a parser, and is IN SCOPE for this unit

`RuleStore.load()` sets `#rules = []` on **every** non-`loaded` outcome — `failed`
([RuleStore.ts:118](../../../../src/rules/RuleStore.ts)), `absent` (:102) and `no-directory`
(:108) — and the comment at :116 says so deliberately, because U3 had no reload. **A watcher
calling `load()` violates BR-26.3 the first time a bad file lands.**

```
RuleStore.read(): LoadOutcome      // no #rules, no current(), no state
```

⚠️ **Two `current()` methods was the trap avoided.** Had the store kept its state, it and the
watcher would each expose `current()` returning different things, and a coordinator wired to the
store would evaluate against the wiped set **while every indicator read green**.

⚠️ **On reload, `absent` and `no-directory` are rejections** (BR-26.3a). A write-temp-then-rename
save is momentarily `ENOENT`; accepted as an empty set it would advance the version and silently
drop every rule for one poll interval, showing the user a version bump and no error.

⚠️ **`version` is not persisted** (BR-26.8). It resets on restart; `contentHash` carries identity
across restarts — **and is stamped on every decision row** (BR-23.7a), because a repeating small
integer on a permanent table identifies nothing.

---

## LC-17 · `rules/factReconstructor` ⚙️ PURE

`play` row + point-in-time counts → `TrackFacts`.

```
reconstruct(row: PlayRow, counts: HistoryCounts): TrackFacts
unanswerableFields(row: PlayRow, v5Watermark: number): string[]
```

⚠️ **Per row, and over two eras** (BR-27.5a/5b/5c):
- **Schema era** — `track.explicit`, `album.type` unanswerable where `row.id <= v5Watermark`.
- **Provenance gap** — `label.*` unanswerable where `isrc IS NULL AND label_unknown_reason IS
  NULL`. Measured: 82 rows, all backfilled, 2026-08-20 → 08-31, 72 distinct tracks.
  ⚠️ **The cause is unestablished and is not the code** — the backfill has read
  `external_ids.isrc` since U1. **No migration marks this boundary**, so no schema-derived rule
  can find it, and the predicate is keyed on the row's own state instead.
- ⚠️ **The watermark is a row `id`, never a date.** The backfill inserts rows dated in the past,
  so a post-v5 insert for a pre-v5 play *is* answerable — judging by `started_at` marks real data
  unanswerable.

⚠️ **`unanswerableFields` is computed from the row's schema era, never from a value being null**
(BR-27.5). A pre-v5 `explicit` is *unanswerable*; a post-v5 `explicit` that is null because
`GET /tracks/{id}` failed is *unknown*. **Both read as `null` in the column and they are not the
same fact** — this is the `error` is not `unknown` family that produced three U2 defects, all of
which passed the full suite.

---

## LC-18 · `rules/BackTestService` 🔌 IMPURE shell, ⚙️ pure core

The shell reads plays; the fold is pure.

```
run(rule, range): BackTestReport
```

Uses **the same `RuleEngine`** as live (BR-27.1). Capped at 50,000 plays with `truncated` required
(P-24). Writes nothing — not a decision row, not a cached report (BR-28.6).

---

## LC-19 · `rules/decisionTrace` ⚙️ PURE

Renders a stored `Decision` into the rule-level trace (BR-32): trigger timeline, and per rule
`verdict`, `applied`, `restedOnUnknown`, and every value in `fieldsSeen`.

⚠️ **Rendering only — it never evaluates.** Per-node verdicts are out of scope precisely because
they would require a second walk of the predicate, and a second walk is a second evaluator.

---

## LC-20 · `rules/rulesDiagnostics` ⚙️ PURE — composed by `diagnostics.ts` *(Q5 = C)*

A pure function from subsystem state to a report, so it is testable without constructing the
server. `diagnostics.ts` composes it and stays an allowed orphan at its current size.

---

## LC-21 · `rules/liveFactSource` 🔌 IMPURE shell, ⚙️ pure predicate *(added 2026-09-20)*

The state `enrichmentSettled` needs, moved out of `server.ts` and given tests.

```
noteEnrichment(trackId, enrichment): void
noteLabelResult(trackId, outcome): void      // completed | failed | not-attemptable
settled(trackId): boolean                    // ⚙️ PURE over the recorded state
factSources(trackId, sample): FactSources
```

Absorbs `labelByTrack`, `labelInFlight` and `likedAtStartByTrack` from `server.ts`.

⚠️ **BR-22.5's *"the resolver's queue state"* names a state that does not exist.** The resolver
exposes no per-track pending flag; the only state is those maps, and they have **four** exits
that leave a track uncached — three of which a naive *not-cached-and-not-in-flight* test reads as
*"still working"*:

| Exit | Truth | Naive reading |
|---|---|---|
| Enrichment not landed | genuinely pending | pending ✅ |
| No ISRC **and** no artist id | permanently unanswerable | pending ❌ |
| Both resolutions null (uncached, will retry) | transiently failed | pending ❌ |
| `labelEnrichment === null` | feature off | pending ❌ |

Under the naive definition a keyless track waits the **full 10 s cap** and is stamped
`partialData = true` — **permanent absence recorded as a timeout**, the exact distinction FQ3
exists to draw. ⚠️ **It would inflate the one number U4 was built to measure, in the direction
that reads as "the wait is too short".**

⚠️ **It must not stay in `server.ts`.** That file has 952 lines, nine routes and no tests, and is
an allowed orphan only because nothing judges anything in it. `settled` is a judgement.

---

## LC-22 · `HistoryRepository.historyCountsBefore` 🔌 — **an existing component, extended**

```
historyCountsBefore(trackId, artistId, beforeIso): HistoryCounts
```

⚠️ **The repository has no counting method today** — not per track, not per artist. The back-test
was given a window function (§5.1) and the live path was given nothing, which is two
implementations of *"plays of this artist before this instant"*. They would agree on every fixture
and diverge only on the corpus (BR-27.7).

⚠️ **It inherits the `artist_id` limitation and must say so**: `artist_id` is the **primary**
artist, so a guest credit files under the lead. Ren appears on 34 plays and owns the primary id on
26 — every per-artist count is ~24% low for a frequent guest, live and replayed alike. A schema
limit, not a listening pattern; `historyRepository.test.ts` already pins it.

---

## Property obligations — PBT-21 onward

| # | Property | Guards |
|---|---|---|
| **PBT-21** | Same rule + same range ⇒ **identical** report, repeated runs | US-24, NFR-26 |
| **PBT-22** | ⭐ **Inserting plays dated *after* a range does not change that range's report** | **BR-27.2** |
| **PBT-22a** | ⭐ **Positive control**: inserting a play dated *before* a row **must** change that row's counts | **BR-27.2**, audit 2026-09-20 |
| **PBT-23** | Point-in-time counts **exclude the current row**; a first play reads `playsOfTrack = 0` | BR-27.3 |
| **PBT-24** | `reconstruct` is **total** — any well-formed row yields well-formed facts, never throws | BR-21.1 |
| **PBT-25** | `DecisionLogEntry` **round-trips**: recorded then read back is equal by value | NFR-27 shape |
| **PBT-26** | `pruneToCap` never leaves more than the cap, never deletes below it, and its `DELETE` text never names `play` | BR-29.3 |
| **PBT-27** | `decisionTrace` output is a **function of the stored `Decision` alone** — no evaluation | BR-32.3 |
| **PBT-28** | Dry-run precedence truth table: live ⟺ global ∧ enabled ∧ ¬dryRun, all 8 combinations | BR-25.1 |
| **PBT-29** | A **rejected** load never advances `version`; the running set stays the last accepted one | BR-26.6 |
| **PBT-30** | `unanswerable` and `null` are never conflated — a pre-v5 row and a failed-fetch row classify differently | BR-27.4/27.5 |
| **PBT-30a** | ⭐ `label.*` on a never-asked row (`isrc` null **and** `label_unknown_reason` null) classifies `unanswerable`; on a `notFound` row it classifies `unknown` | **BR-27.5b** |
| **PBT-31** | `fieldsSeen` **round-trips every key**: a field read as `undefined` or `null` survives serialisation as an explicit null | **BR-23.4**, audit 2026-09-20 |
| **PBT-32** | `enrichmentSettled` is `true` **immediately** for a track with no ISRC and no artist id, and for a disabled resolver — never after the cap | **BR-22.5b** |
| **PBT-33** | On reload, `absent` and `no-directory` leave the running set **unchanged** and do not advance `version` | **BR-26.3a** |

> ### ⭐ PBT-22 is the only thing that will ever catch the point-in-time decision
>
> BR-27.2 has **no observable failure mode**. As-of-now counts produce plausible numbers today and
> diverge only over months. No amount of hands-on evaluation reveals it, because the corpus has to
> grow for the two answers to separate.
>
> The property makes the divergence immediate: build a range, take a report, insert plays dated
> *after* the range, take it again. Point-in-time is stable; as-of-now is not. **It fails loudly
> under the wrong implementation and is silent under the right one** — which is the whole job.
>
> ⚠️ **PBT-22 passes trivially if the counts are always zero**, so PBT-22a is not optional
> garnish — it is the half of the pair that proves the counter is wired to anything at all. A
> `historyCountsBefore` that returned `0` for every input satisfies PBT-22 perfectly. **Do not
> weaken PBT-22 into "back-test twice in a row"** either: that passes under *both*
> implementations, because nothing changed between the runs.

> ### PBT-31 pins a defect the type system cannot reach
>
> `JSON.stringify` **drops keys whose value is `undefined`**, so a field recorded as undefined
> vanishes from `fieldsSeen` entirely — silently violating BR-23.4, whose whole point is that a
> null is written explicitly rather than by omission. The reader would then see a field the rule
> demonstrably read simply **not listed**, which reads as *"the rule never looked at it"*.
>
> `Maybe<T> = T | null` means `undefined` is not currently type-reachable through `field.read`,
> so this is a **pin, not a fix**: it fails the day someone adds a field whose reader can return
> undefined. Normalise `undefined → null` before serialising regardless.

⚠️ **Seeds are logged and replayable** (NFR-21), as for PBT-01…PBT-20.

⚠️ **The generator must not recurse per branch.** U3's `treeOfDepth` called itself three times per
level, building ~3^d arbitraries; at depth 20 it exhausted the heap and killed the process with a
V8 stack dump and no useful message — reading as *"property testing is slow"* rather than *"the
generator is wrong"*. Build the child arbitrary **once** and reuse it.

---

## Exit criteria — how each is discharged

| U4 exit criterion | Discharged by |
|---|---|
| Every evaluation logged with rule, field values, verdict | LC-13, LC-15 · BR-23 · PBT-25 |
| Decisions on unknown or partial data marked as such | `restedOnUnknown`, `partialData` · BR-22.4 |
| Dry-run over real listening produces a log the user agrees with | **Live verification** — not discharged by CI |
| Back-test identical on repeated runs | **PBT-21** |
| Back-test excludes rule-initiated skips | BR-28.4 · inert until U5, built now |
| Unknown fields reported, not silently excluded | BR-28.5 · **PBT-30** |
| `DecisionExecutor` has one implementation and cannot skip | **P-26** · LC-15 · import-graph inspection |

⚠️ **Three of these cannot be closed by tests**: the dry-run agreement gate, the `partialData` rate
that tells us whether `ENRICHMENT_WAIT_MS` is right, and BR-20.8's last-known-good path — which has
been specified since U3 and **has never once run**.
