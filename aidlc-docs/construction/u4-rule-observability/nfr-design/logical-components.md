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

Owns the trigger (BR-22) and the per-play state that makes "exactly one decision per play"
enforceable.

```
onTick(sample): void
```

Holds: current `trackId`, play start instant, `decided` flag. Collaborators injected — clock,
rule set accessor, fact builder, enrichment-settled probe, executor.

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

Owns `version` (monotonic, **accepted loads only** — BR-26.5/26.6), `contentHash`, `state` and the
last rejection. On an invalid file it keeps the last-known-good set (**BR-20.8**, deferred from U3
and reachable here for the first time).

⚠️ **`version` is not persisted** (BR-26.8). It resets on restart; `contentHash` carries identity
across restarts.

---

## LC-17 · `rules/factReconstructor` ⚙️ PURE

`play` row + point-in-time counts → `TrackFacts`.

```
reconstruct(row: PlayRow, counts: HistoryCounts): TrackFacts
unanswerableFields(row: PlayRow): string[]
```

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

## Property obligations — PBT-21 onward

| # | Property | Guards |
|---|---|---|
| **PBT-21** | Same rule + same range ⇒ **identical** report, repeated runs | US-24, NFR-26 |
| **PBT-22** | ⭐ **Inserting plays dated *after* a range does not change that range's report** | **BR-27.2** |
| **PBT-23** | Point-in-time counts **exclude the current row**; a first play reads `playsOfTrack = 0` | BR-27.3 |
| **PBT-24** | `reconstruct` is **total** — any well-formed row yields well-formed facts, never throws | BR-21.1 |
| **PBT-25** | `DecisionLogEntry` **round-trips**: recorded then read back is equal by value | NFR-27 shape |
| **PBT-26** | `pruneToCap` never leaves more than the cap, never deletes below it, and its `DELETE` text never names `play` | BR-29.3 |
| **PBT-27** | `decisionTrace` output is a **function of the stored `Decision` alone** — no evaluation | BR-32.3 |
| **PBT-28** | Dry-run precedence truth table: live ⟺ global ∧ enabled ∧ ¬dryRun, all 8 combinations | BR-25.1 |
| **PBT-29** | A **rejected** load never advances `version`; the running set stays the last accepted one | BR-26.6 |
| **PBT-30** | `unanswerable` and `null` are never conflated — a pre-v5 row and a failed-fetch row classify differently | BR-27.4/27.5 |

> ### ⭐ PBT-22 is the only thing that will ever catch the point-in-time decision
>
> BR-27.2 has **no observable failure mode**. As-of-now counts produce plausible numbers today and
> diverge only over months. No amount of hands-on evaluation reveals it, because the corpus has to
> grow for the two answers to separate.
>
> The property makes the divergence immediate: build a range, take a report, insert plays dated
> *after* the range, take it again. Point-in-time is stable; as-of-now is not. **It fails loudly
> under the wrong implementation and is silent under the right one** — which is the whole job.

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
