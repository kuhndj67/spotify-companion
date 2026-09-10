# Logical Components — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — NFR Design, U3
**Patterns**: [`nfr-design-patterns.md`](nfr-design-patterns.md) · **Numbering**: continues from U2 at **LC-7**

Six components. **Five pure, one impure**, and the boundary is a file boundary so it can be checked
by eye as well as by `test/purity.test.ts`.

---

## The boundary

```
  ┌─────────────────────── IMPURE ────────────────────────┐
  │  LC-12  FactCache        LC-11  RuleStore             │
  │  (per-play aggregates)   (reads config/rules.json)    │
  └───────────┬───────────────────────┬───────────────────┘
              │ TrackFacts inputs     │ LoadedRule[]
  ┌───────────▼───────────────────────▼───────────────────┐
  │                      PURE                             │
  │  LC-7  fieldCatalogue                                 │
  │  LC-8  predicate (evaluator)                          │
  │  LC-9  ruleValidator                                  │
  │  LC-10 RuleEngine  ──> Decision                       │
  │        TrackFacts (assembleFacts)                     │
  └───────────────────────────────────────────────────────┘
                            │
                     Decision ──> nothing, at U3
```

---

## LC-7 · `rules/fieldCatalogue` ⚙️ PURE

**Responsibility**: the static table of referenceable fields, and the operators each type admits.

| | |
|---|---|
| **State** | None. A frozen module-level table |
| **Patterns** | P-12 purity |
| **Key constraint** | **Never reflection over `TrackFacts`.** Adding a field is a decision, not a side effect of a type gaining a property |
| **Carries** | `availability` (presence) and `note` (evidential standing) — BR-16.3, never merged |

The `note` on `label.classification` records the 2026-09-10 gate result; the `note` on the
artist-history fields records the primary-artist undercount. Both are static text on a static
structure — data, not I/O.

---

## LC-8 · `rules/predicate` ⚙️ PURE

**Responsibility**: evaluate a predicate tree against `TrackFacts` to a `Verdict`.

| | |
|---|---|
| **State** | None |
| **Patterns** | P-10 bounded recursion · P-11 totality · P-13 determinism |
| **Recursion** | Recursive by choice — it must read against the Kleene tables to be reviewable. Depth is bounded upstream by LC-9, never here |
| **Evaluation order** | `is-unknown` first (BR-15.2), then absence → `unknown`, then typed comparison |
| **Exhaustive** | Every operand evaluated even when the result is determined, so `fieldsSeen` is complete (BR-14.7) |

⚠️ **This component has no failure mode.** Everything that could fail was refused by LC-9. That is
what makes PBT-13 ("no input throws") a real test rather than a tautology.

---

## LC-9 · `rules/ruleValidator` ⚙️ PURE

**Responsibility**: the only component that says **no**.

| Failure | Scope | Reason |
|---|---|---|
| Invalid JSON, not an array, missing `id`/`predicate`, malformed tree | **Whole set** | Structural — the file is not a rule set |
| Duplicate `id` | **Whole set** | Ambiguous identity makes every report unattributable |
| Field not in the catalogue | One rule | `unknown-field` |
| Operator/type mismatch, bad or missing `value` | One rule | `type-mismatch` |
| Tree deeper than `MAX_PREDICATE_DEPTH` (32) | One rule | `too-deep` |
| `onUnknown: 'hold'` | One rule | `unsupported-on-unknown` |

| | |
|---|---|
| **State** | None |
| **Patterns** | P-10 depth bound · P-11 totality |
| **Runs** | At creation **and at every load** (BR-18.1) |

> **Load-time validation is not belt-and-braces.** FR-45 specifies creation time, which cannot
> catch a field that vanishes afterwards — and one did, when migration 004 removed the
> artist-level label verdict on 2026-09-06.

---

## LC-10 · `rules/RuleEngine` ⚙️ PURE

**Responsibility**: apply `onUnknown`, fold outcomes into a `Decision`.

| | |
|---|---|
| **State** | None |
| **Patterns** | P-13 determinism · P-17 honest degradation |
| **Inputs** | `LoadedRule[]`, `TrackFacts`, and `partialData` **from the caller** |
| **Outputs** | `Decision` — including `unknownFields`, the union of catalogue fields that read `unknown` |
| **Seam** | `foldDecisions` is one named function so a future combination policy replaces it alone |

⚠️ `restedOnUnknown` is set from the **raw verdict**, never accumulated while walking the tree
(BR-19.6). The accumulator silently produces Q1's option C, which was offered and not chosen.

⚠️ The `'hold'` branch is written as an **exhaustiveness check**, so U5 adding the behaviour is a
compile error here rather than a silent fallthrough.

---

## LC-11 · `rules/RuleStore` 🔌 IMPURE

**Responsibility**: read `config/rules.json` and hand back `LoadedRule[]`. Nothing else.

| | |
|---|---|
| **State** | The current rule set, in memory |
| **Patterns** | P-14 fail-inert · P-15 separated from `data/` |
| **Interface at U3** | `load()`, `current()` |
| **Not at U3** | **`watch()` — deferred to U4** (Q3 = D) |
| **On invalid file** | **No rules**, surfaced loudly. Never a partial load |

> ### ⚠️ `watch()` is deliberately absent, and this diverges from the inception design
>
> `component-methods.md` specifies `RuleStore.watch(onChange)`. Q3 = D defers it to U4, where the
> UI gives live reload something to trigger it. Two consequences, recorded so neither is
> discovered later:
>
> 1. **BR-20.8 (last-known-good on reload) cannot fire in U3.** Only cold start exists, so only
>    BR-20.7 applies. BR-20.8 is specified and deferred, not implemented-but-dead.
> 2. **The half-written-file race disappears from U3** along with the watcher. It returns with
>    `watch()` and is U4's to design — a debounce plus one retry was the shape considered here.
>
> This is a construction-stage refinement of an inception artifact, which the method permits; it
> is written down because a silently narrowed interface is how a requirement goes missing.

---

## LC-12 · `FactCache` 🔌 IMPURE

**Responsibility**: fetch the four history aggregates once per play and hold them for that play.

| | |
|---|---|
| **State** | One entry, keyed by the play being evaluated |
| **Patterns** | P-16 assemble once, cache outside the pure core |
| **Query** | One combined aggregate over `play`, using `idx_play_track` (v1) and `idx_play_artist_id` (v2) |
| **Staleness** | None — the current play is not recorded until it ends, so the counts cannot move |
| **Containment** | A failure here yields `null` counts, never an exception that reaches the poll loop |

> ### This component exists so that LC-10 does not need a memory
>
> Caching inside `assembleFacts` would give a pure function state and NFR-26 would be gone. The
> cache is deliberately a separate, impure component so the boundary stays a file boundary.

⚠️ **It must never fail the recording path.** A rules engine that throws while counting plays must
not cost a play record — the containment `PlayObserver.#safely` already provides for label
enrichment, applied here for the same reason.

---

## Property obligations — PBT-11 onward

Numbering continues from PBT-10. Each maps to an exit criterion.

| # | Property | Discharges |
|---|---|---|
| **PBT-11** | For any tree and any assignment, `unknown` never yields `false` unless a *known* operand forces it — checked against the Kleene tables, including under `NOT` and `OR` | NFR-25, exit 1 |
| **PBT-12** | De Morgan holds both ways for any generated tree: `NOT(a AND b) ≡ (NOT a) OR (NOT b)` and dually | NFR-25, exit 2 |
| **PBT-13** | No `(predicate, facts)` pair throws — generators emit arbitrary JSON in `value`, `NaN`, huge numbers, nested objects, empty operand lists | NFR-25, exit 3 |
| **PBT-14** | A tree at depth 32 validates; a tree at depth 33 is disabled with reason `too-deep`; **neither throws** | P-10 |
| **PBT-15** | `evaluateRules(r, f)` called twice returns deep-equal `Decision`s; and two processes with different `FC_SEED` agree | NFR-26, exit 6 |
| **PBT-16** | `parse(serialise(rule))` evaluates identically to `rule` on the same facts — behaviour, not bytes | NFR-27, exit 5 |
| **PBT-17** | `is-unknown` returns `true`/`false` for every field and every facts value, and **never** `unknown` | BR-15.1 |
| **PBT-18** | Genre `contains` matches on word boundaries only: `"rap"` matches `pop rap`, never `trap`; and no match crosses two elements | BR-17.5, FQ2 |
| **PBT-19** | An ordering comparison against a year-only date yields `unknown` for every operand | BR-17.7 |
| **PBT-20** | `RuleOutcome.restedOnUnknown` is `true` **iff** the raw verdict was `unknown` — never merely because an unknown appeared in the tree | BR-19.6 |

**Generators** live in `test/ruleGenerators.ts`, following `historyGenerators.ts` and
`labelGenerators.ts`. A tree generator must be **depth-parameterised**, so PBT-14 can target the
boundary rather than hope to reach it.

---

## Exit criteria — how each is discharged

| U3 exit criterion | Discharged by |
|---|---|
| Tri-state never collapses `unknown` to `false` | PBT-11 |
| Composition obeys De Morgan | PBT-12 |
| No field value causes a throw | PBT-13, PBT-14 |
| Invalid rules rejected with a usable message | Table test over LC-9's failure table |
| Rules round-trip through storage | PBT-16 |
| Evaluation deterministic and side-effect free | PBT-15, `purity.test.ts` |
| No I/O, clock, network or DB in the five pure modules | `purity.test.ts` — P-12, extended in the same commit |

**Done means CI green.** No live listening session is required, and none would add anything these
do not already establish.
