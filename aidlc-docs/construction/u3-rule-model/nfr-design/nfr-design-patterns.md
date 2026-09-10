# NFR Design Patterns — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — NFR Design, U3
**Plan**: [`../../plans/u3-nfr-design-plan.md`](../../plans/u3-nfr-design-plan.md) (Q1–Q5, answered 2026-09-10)
**NFRs**: NFR-25, NFR-26, NFR-27 · **Numbering**: continues from U2 at **P-10**

**Answers**: Q1 **A** depth bound at validation · Q2 **B** `config/rules.json` · Q3 **D** no watching
in U3 · Q4 **B** `partialData` is an input, plus report unknown fields · Q5 **C** assemble eagerly,
cache per play.

---

## P-10: Bounded recursion — closing the hole in "never throws"

**Problem.** BR-21.1 says every pure function is total. A predicate is a tree, the evaluator is
recursive, and a deep enough tree overflows the stack — **which is a throw, from a function
documented as unable to throw.**

**Pattern.** Bound the depth at *validation*, keep the evaluator recursive and readable.

| | |
|---|---|
| **Limit** | `MAX_PREDICATE_DEPTH = 32` |
| **Enforced by** | `ruleValidator`, before any evaluation |
| **On breach** | The rule **loads, disabled**, reason `too-deep` (BR-18.4's machinery) |
| **Evaluator** | Stays recursive — it must read against the truth tables to be reviewable |

32 is far beyond any hand-written rule and far below any stack limit, so the bound is invisible in
practice and decisive in the pathological case. It is a **named constant, not a magic number**, and
it is checked by a property test rather than trusted (PBT-14).

> ### `too-deep` is a new `DisabledReason`, not a reuse of `type-mismatch`
>
> Folding it into an existing reason would tell the user their rule has a type error when it does
> not. BR-18.7 requires the reason to survive; a wrong reason is worse than a generic one.

⚠️ **A depth breach is a *semantic* failure, not a structural one.** The file is valid JSON and the
tree is well-formed — it is simply unevaluable. So it disables the one rule (BR-20.5) and never
rejects the set (BR-20.3).

---

## P-11: Totality by construction

Every pure function returns a value for every input. No throw, no `undefined`, no exception path.

| Input class | Handling |
|---|---|
| Absent field value | `unknown` (BR-14.2) — or `true`/`false` for `is-unknown` (BR-15.1) |
| Operand of the wrong type | Rejected at validation; unreachable at evaluation |
| `NaN`, `Infinity`, huge numbers | Rejected at validation |
| Arbitrary JSON in `value` | Rejected at validation |
| Empty operand list | Identity element (BR-14.6) |
| Tree deeper than 32 | Rejected at validation (P-10) |

**The pattern is that validation is the only place that says no.** Evaluation has no failure mode,
which is what lets `evaluate` be a total function of two arguments and what makes PBT-13 a
meaningful test rather than a tautology.

---

## P-12: Purity by static import check *(extends P-9)*

The five pure modules are added to `PURE_MODULES` in `test/purity.test.ts`:

```
rules/fieldCatalogue.ts   rules/TrackFacts.ts   rules/predicate.ts
rules/ruleValidator.ts    rules/RuleEngine.ts
```

**In the same commit that creates them.** A pure module that nothing checks for purity is the
2026-09-06 coverage blind spot in a new place — and `noOrphanModules.test.ts` will not save it,
because a module can be imported by a test and still import a clock.

⚠️ **`RuleStore.ts` is deliberately *not* in the list.** It is the unit's only impure module. It
reads a file and does nothing else — no evaluation, no verdict logic — so the boundary is a file
boundary and is checkable by eye.

---

## P-13: Determinism by injected instant

`TrackFacts.evaluatedAtMs` is passed **in** as data. No module in U3 calls `Date.now()`, reads a
timezone, or consults a locale.

This is what makes FR-20 recomputation and FR-42 back-testing reproduce live decisions exactly
(NFR-26). It is the same discipline that keeps `outcomeClassifier` and `playStats` pure, and it
exists because a clock in a pure module breaks both requirements **while every other test passes**.

---

## P-14: Fail-inert on load *(Q10 = B, narrowed by Q3 = D)*

```
  read config/rules.json ──┬─ valid ────> use it
                           └─ invalid ──> NO RULES, and say so loudly
```

A rules engine that cannot read its rules **skips nothing**. Never a partial load (BR-20.6):
loading the rules that parsed and dropping the rest silently arms a set the user never wrote, in
the component that eventually controls playback.

**A bad rules file never stops the app recording** (BR-20.10). Recording is the artefact that
cannot be regenerated.

> ### ⚠️ Q3 = D makes BR-20.8 unreachable in U3, and that is recorded rather than quietly dropped
>
> BR-20.8 says an invalid file **on reload** keeps the last-known-good set. With no watcher in U3
> there is no reload, so only the cold-start branch (BR-20.7) can fire. BR-20.8 is **specified and
> deferred to U4**, which is where `watch()` lands.
>
> It is called out here because a rule that cannot fire is the "stored setting that does nothing"
> trap. It is not implemented-but-dead code in U3 — it is simply not implemented yet, and U4's
> NFR design must pick it up along with the watcher.

---

## P-15: User-authored input separated from irreplaceable output *(Q2 = B)*

| Path | Class | Loss if destroyed |
|---|---|---|
| `config/rules.json` | **User-authored input** | Retyping |
| `data/history.db` | **Irreplaceable output** | Months of listening, recoverable from nowhere |

Rules get their **own directory and their own mount**. The user hand-edits rules; nobody should
hand-edit next to the database. The extra deployment surface is the price of a smaller blast
radius, and it is small.

⚠️ The concrete path, mount and permissions are **Infrastructure Design**'s to finalise. What is
fixed here is the *class boundary*: rule state is never co-located with `history.db`.

---

## P-16: Facts assembled once per play, cached outside the pure core *(Q5 = C)*

`history.playsOfTrack`, `skipsOfTrack`, `playsOfArtist` and `skipsOfArtist` are SQLite aggregates
on the track-start path. One combined query per play, cached for that play's duration.

A track's history counts cannot meaningfully change while it plays — the current play is not
recorded until it ends — so the cache has no staleness window.

> ### ⚠️ The cache is state, so it lives OUTSIDE the pure modules
>
> `assembleFacts` stays a pure mapping from already-fetched values to `TrackFacts`. The cache
> belongs to the impure caller. Putting it inside would give a pure function a memory, and
> P-13/NFR-26 would be gone.

⚠️ **Fact assembly must never be able to fail the recording path.** A rules engine that throws
while counting plays must not cost a play record — the same containment `PlayObserver.#safely`
already gives label enrichment.

> ### `playsOfTrack` excludes the play being evaluated
>
> At track start the current play is not yet recorded, so the counts are *"before this one"*. A
> rule reading `playsOfTrack > 5` therefore means "I have heard this more than five times before
> now". Stated because the alternative reading is equally natural and the difference is invisible
> in the value.

---

## P-17: Honest degradation *(Q4 = B)*

**R11 makes incomplete facts the common case, not the edge**: a label lookup is two MusicBrainz
calls behind a 1 req/sec queue, so at track start `label.classification` will usually read
`unknown` for reasons that have nothing to do with the track.

| Signal | Set by | Meaning |
|---|---|---|
| `Decision.partialData` | **The caller**, passed in | "I was still waiting for something when I asked" |
| `Decision.unknownFields` | U3, observed | "These catalogue fields read `unknown` on this evaluation" |

**U3 never infers `partialData`.** Inferring it from `often-unknown` fields reading `unknown`
cannot distinguish *"not yet resolved"* from *"resolved, and the answer is nothing"* — the
distinction this project has been bitten by three times (the `inc=releases` 200, the conflated
coverage denominator, the `unknown` chart merge). The caller knows what it was waiting for; U3
does not, and does not guess.

`unknownFields` is the union across all evaluated rules; `RuleOutcome.fieldsSeen` remains the
per-rule record. Together they let U4 answer *"why did this happen"* and *"would waiting have
helped"* without U3 speculating about either.

---

## P-18: Round-trip equivalence *(NFR-27)*

A rule serialised and reparsed evaluates **identically** on the same facts. Tested as a property
over generated rules (PBT-16), not by example.

The assertion is on **behaviour, not bytes**: key order and formatting may differ, verdicts may
not. Comparing serialised text would fail on cosmetic differences and pass on a semantic change to
a field the comparison did not reach.

---

## Pattern-to-NFR coverage

| NFR | Patterns |
|---|---|
| NFR-25 property-tested tri-state, no throw | P-10, P-11 · PBT-11, PBT-12, PBT-13, PBT-14 |
| NFR-26 deterministic, side-effect free | P-12, P-13, P-16 · PBT-15 |
| NFR-27 storage round-trip | P-18 · PBT-16 |
| FR-44 no code evaluation | Structural — a predicate is data (BR-20.1–20.2) |
| Resilience — malformed input | P-11, P-14 |
| Security — resource exhaustion | P-10 (depth), Infrastructure Design (file size) |
