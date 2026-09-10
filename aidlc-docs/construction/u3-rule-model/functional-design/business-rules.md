# Business Rules — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — Functional Design, U3

Numbered, individually testable. Every rule states its source and the criterion it serves.
Numbering continues from U2, which ended at BR-13.

**Settled parameters**: Kleene strong logic · `is-unknown` in, `exists` out · folded string
comparison · genres matched per element on word boundaries · partial dates `unknown` for ordering ·
`context.type` excluded · unevaluable rules disabled with a reason · depth bounded at **32** ·
cold-start failure is inert · order is presentational.

**Amended 2026-09-10 by NFR Design** (`../nfr-design/`): BR-18.6a (depth bound), BR-21.7–21.9
(fact cache), and BR-20.8 marked **deferred to U4** because `watch()` is not built in U3.

> ### The rule that governs the other rules
>
> **U3 decides; it never acts, and it never learns.**
> Five of six modules are pure. No clock, no I/O, no network, no database, no randomness. Every
> input arrives as an argument. This is not style: it is the mechanism by which FR-20
> recomputation and FR-42 back-testing reproduce live decisions exactly. A single `Date.now()`
> here would break both **while every other test passed** — which is precisely how the same
> mistake nearly shipped in `outcomeClassifier`.

---

## BR-14: Tri-state evaluation

| # | Rule | Source |
|---|---|---|
| **BR-14.1** | A predicate evaluates to exactly one of `true`, `false`, `unknown`. `Verdict` is a string union with no falsy member | FR-32, NFR-25 |
| **BR-14.2** | A field whose value is absent yields `unknown` for every operator **except** `is-unknown` | FR-32, Q2 = B |
| **BR-14.3** | `AND`/`OR`/`NOT` follow **Kleene strong** tables: a decisive known operand wins. `false AND unknown` = `false`; `true OR unknown` = `true` | Q1 = A |
| **BR-14.4** | `NOT unknown` = `unknown`, always | Q1 = A |
| **BR-14.5** | De Morgan's laws hold for every tree and every assignment of the three values | NFR-25 |
| **BR-14.6** | `and: []` = `true`, `or: []` = `false` — the identity elements. The validator rejects empty operand lists; the evaluator still answers rather than throwing | BR-21.1 |
| **BR-14.7** | Evaluation is **exhaustive, not short-circuiting**: every operand is evaluated so `fieldsSeen` records what the rule actually read | FR-28, U4 |

⚠️ **BR-14.3 is the one place `unknown` legitimately disappears from a result, and it is not a
collapse.** `false AND unknown` is `false` because no value the unknown could take would change it
— the data answered the question. That is different from treating `unknown` **as** `false`, which
BR-14.2 forbids. A test asserting `false AND unknown === false` and a test asserting
`unknown === false` look similar and mean opposite things.

---

## BR-15: The `is-unknown` operator

| # | Rule | Source |
|---|---|---|
| **BR-15.1** | `is-unknown` returns `true` when the field's value is absent and `false` when present. It **never** returns `unknown` | Q2 = B |
| **BR-15.2** | It is evaluated **before** BR-14.2, so absence cannot be converted to `unknown` first | FQ1 = A |
| **BR-15.3** | It is valid on **every** field type — it asks about presence, not value | — |
| **BR-15.4** | It takes **no** operand. A `value` supplied alongside it is a validation failure | BR-20.4 |
| **BR-15.5** | **`exists` is not an operator.** It is absent from the type, the catalogue and the validator | FQ1 = A |

> ### BR-15.5 exists because a tri-state `exists` can never return `false`
>
> A field is either present (`true`) or absent (`unknown`) — there is no third input state, so
> `false` is unreachable, and `not(exists(f))` evaluates to `not(unknown)` = `unknown`: exactly the
> question it was meant to answer, unanswered. `is-unknown` and `not(is-unknown)` give one obvious
> way to write each direction.

---

## BR-16: The field catalogue

| # | Rule | Source |
|---|---|---|
| **BR-16.1** | The catalogue is a **static table**, never reflection over `TrackFacts`. Adding a field is a decision | FR-28 |
| **BR-16.2** | Every field declares `name`, `type`, `description`, `availability` and a `read` function | FR-28 |
| **BR-16.3** | `availability` describes **presence**; the optional `note` describes **evidential standing**. They are never merged | Q3 = A |
| **BR-16.4** | `label.classification` carries a `note` recording that R1 was tested on 2026-09-10 and not supported (p = 0.888) — legitimate as a preference, not evidence-backed as a predictor | Q3 = A |
| **BR-16.5** | `history.playsOfArtist` and `history.skipsOfArtist` carry a `note` recording that they count the **primary** artist only, measured ~24% low for a frequent guest | Q3 = A |
| **BR-16.6** | `context.type` is **not** a catalogue field | Q5 = A |
| **BR-16.7** | `context.deviceName` is **not** a catalogue field: its live availability has never been probed | working rule |
| **BR-16.8** | A `note` is static text on a static structure — data, not I/O. The module stays pure | NFR-26 |

> ### BR-16.6 — a field that back-tests as available and is never available live
>
> `context_type` is NULL on **all 342 live plays** and populated on **all 85 backfilled** ones: the
> MCP `getNowPlaying` returns no context field, `recently-played` does. A rule evaluates on the
> live path, so the field would be `unknown` 100% of the time in production while a back-test
> (FR-42) showed it richly populated. That is worse than an absent field — it would validate a rule
> that cannot work. If open item 7 is ever taken, this rule is what changes.

---

## BR-17: Comparison semantics

| # | Rule | Source |
|---|---|---|
| **BR-17.1** | String comparison folds **case and punctuation** on both sides: NFKD, lowercase, strip non-alphanumeric. `"Def Jam"` ≡ `"def-jam"` | Q4 = D |
| **BR-17.2** | Folding is applied **per value**, never across a join of several values | FQ2 = A |
| **BR-17.3** | `artist.genres` is declared `type: 'string'`, `multiValued: true`. The author sees a string field | Q8 = B |
| **BR-17.4** | Genre `eq`/`in` match when **any element** folds equal to the operand | FQ2 = A |
| **BR-17.5** | Genre `contains` matches when any element contains the operand **on a word boundary** — `"rap"` matches `pop rap`, **not** `trap` | FQ2 = A |
| **BR-17.6** | `genres == null` ⇒ `unknown` (never asked). `genres == []` ⇒ `false` (asked; none). **Never merged** | Q8 = B |
| **BR-17.7** | Ordering comparisons (`lt`/`lte`/`gt`/`gte`) on a **partial date** yield `unknown` | Q6 = A |
| **BR-17.8** | `eq`/`neq` on dates compare as strings, so `"2022"` ≠ `"2022-01-01"` | Q6 = A |
| **BR-17.9** | A partial date is **never** widened, coerced or defaulted to reach an ordering answer | Q6 = A |

> ### BR-17.5 was measured, not assumed
>
> Over the corpus's **110 distinct genres, 62 of them multi-word**, plain substring matching turns
> `contains "rap"` into a rule that also matches `trap`, `trap latino` and `trap metal` — four
> unintended genres out of seven hits. It reads as a working rule. Word boundaries fix it.
>
> BR-17.2 is the other half: joining genres and then folding punctuation turns
> `["hip hop", "rapcore"]` into `"hiphoprapcore"`, where a match can cross a boundary that exists
> in the data but not in the string.

⚠️ **BR-17.9 is the `inc=releases` shape.** Coercing `"2022"` to `"2022-01-01"` answers every
ordering question plausibly and is wrong at year boundaries — and the wrong answer is
indistinguishable from a right one. Only 5 of 428 plays carry a year-only date, which is exactly
why nobody would notice.

---

## BR-18: Rule validity and lifecycle

| # | Rule | Source |
|---|---|---|
| **BR-18.1** | A rule is validated against the catalogue at **creation and at every load** | FR-45, Q7 = A |
| **BR-18.2** | `enabled` is the **user's** switch; `status` is the **system's** determination. They are never merged | Q7 = A |
| **BR-18.3** | A rule is evaluated only when `enabled === true` **and** `status.state === 'active'` | — |
| **BR-18.4** | A rule referencing a field not in the catalogue **loads, disabled**, reason `unknown-field`. It is never deleted and never evaluated | Q7 = A |
| **BR-18.5** | A rule whose operator does not fit its field's type, or whose `value` is missing or ill-typed, **loads, disabled**, reason `type-mismatch` | FR-45 |
| **BR-18.6** | A rule declaring `onUnknown: 'hold'` **loads, disabled**, reason `unsupported-on-unknown` | Q9 = B, FQ3 = C |
| **BR-18.6a** | A predicate tree deeper than **`MAX_PREDICATE_DEPTH` = 32** **loads, disabled**, reason `too-deep`. A depth breach is a *semantic* failure: it disables one rule, never the set | NFR Q1 = A |
| **BR-18.7** | Every disabled rule reports its `reason` and a human-readable `detail` in `Decision.disabledRules` | Q7 = A |
| **BR-18.8** | A field that disappears **never** becomes `unknown`. "We could not resolve this" and "this field no longer exists" are two facts | Q7 = A |

> ### BR-18.4 is not hypothetical
>
> **Migration 004 deleted the artist-level label verdict on 2026-09-06.** A rule written the week
> before would now reference a field that does not exist. FR-45 validates at *creation*; only
> BR-18.1's load-time pass can catch a field that vanished afterwards.

> ### BR-18.6 — why `'hold'` is stored rather than refused
>
> U3 has no clock and no queue, so it cannot implement waiting; that is U5's. Making `hold`
> **unwritable** would mean re-authoring rules when U5 lands. Making it **silently inert** would be
> a stored setting that does nothing. Storing it and disabling the rule with a reason reuses
> BR-18.4's machinery, and the rules already written begin working when U5 arrives.

⚠️ **BR-18.2 protects a real failure mode at U5.** If the system quietly clears the user's
`enabled` flag to disable a rule it cannot evaluate, the user sees their own toggle switched off
and no reason. Two fields, two facts.

---

## BR-19: Combination and the Decision

| # | Rule | Source |
|---|---|---|
| **BR-19.1** | Independent rules combine as **OR**: any rule whose `applied` verdict is `true` yields the action | FR-30 |
| **BR-19.2** | `action` is an enumerated value, never a boolean. `skip` is the only member at U3 | FR-26 |
| **BR-19.3** | Rule **order has no effect on the outcome**. It orders `matchedRuleIds` and the UI, nothing else | Q11 = A |
| **BR-19.4** | Evaluation does **not** stop at the first match. `Decision.outcomes` records every evaluated rule, matched or not | Q11 = A, U4 |
| **BR-19.5** | `applied` is the raw verdict when decisive, otherwise the `onUnknown` mapping: `match` ⇒ `true`, `no-match` ⇒ `false` | FR-33 |
| **BR-19.6** | `RuleOutcome.restedOnUnknown` is `true` **exactly when the raw verdict was `unknown`** — never accumulated while walking the tree | Q1 = A |
| **BR-19.7** | `Decision.restedOnUnknown` is scoped to the **matched** rules: it answers whether the action about to be taken rests on absent data | US-17 |
| **BR-19.8** | The OR-fold lives in one named function, `foldDecisions`, so a future combination policy replaces that and nothing else | FR-30 |

> ### BR-19.6 is a one-line difference in code and a large one in meaning
>
> Q1 offered option C — Kleene's answers with Bochvar's flagging, raising the flag whenever an
> unknown appeared anywhere in the tree — and it was **not chosen**. A rule that read one unknown
> field but still resolved decisively is not resting on unknown: the data answered it.
>
> The tempting implementation, accumulating a flag during the walk, silently produces option C.

---

## BR-20: Rule storage and load failure

| # | Rule | Source |
|---|---|---|
| **BR-20.1** | Rules are **structured data** — a predicate tree of field/operator/value nodes. No expression string exists anywhere in the model | FR-43 |
| **BR-20.2** | User input is **never evaluated as code**: no `eval`, no `new Function`, no expression interpreter. Satisfied structurally, not by discipline | FR-44 |
| **BR-20.3** | A **structural** failure — invalid JSON, not an array, a rule missing `id` or `predicate`, a malformed tree — rejects the **whole set** | FR-45 |
| **BR-20.4** | A duplicate rule `id` rejects the **whole set**: ambiguous identity makes every report unattributable | — |
| **BR-20.5** | A **semantic** failure disables the individual rule (BR-18.4–18.6); it never rejects the set | Q7 = A |
| **BR-20.6** | **Never a partial load.** Loading the rules that parsed and dropping the rest is forbidden | Q10 |
| **BR-20.7** | On **cold start** with an invalid file: **no rules**. A rules engine that cannot read its rules skips nothing | Q10 = B |
| **BR-20.8** | On **reload** with an invalid file: keep the **last-known-good** set in memory. ⚠️ **Unreachable in U3 and DEFERRED TO U4** — `watch()` is not built here (NFR Q3 = D), so only BR-20.7 can fire | Q10 = B |
| **BR-20.9** | Either failure is surfaced **loudly**. A rule set that silently reverts to an older version is an unexplained empty state with consequences | Q10 = A carried |
| **BR-20.10** | A bad rules file **never** stops the app recording | data-first |
| **BR-20.11** | A saved and reloaded rule evaluates **identically** on the same facts | NFR-27 |

⚠️ **BR-20.6 is the most dangerous rule in this document to get wrong.** A partial load silently
arms a rule set the user never wrote, in a component that will eventually control playback. It is
the same family as the 2026-09-05 divergence where two copies of the admission policy drifted and
all 411 tests passed.

⚠️ **BR-20.10 restates the project's ordering of what matters.** Code comes back from git, rules
come back from retyping; months of play records come back from nowhere.

---

## BR-21: Purity and determinism

| # | Rule | Source |
|---|---|---|
| **BR-21.1** | Every function in the five pure modules is **total**: any input, including malformed values, returns a value and never throws | NFR-25 |
| **BR-21.2** | The five pure modules import **no** I/O, clock, network, database or randomness. Enforced by a static import check | NFR-26 |
| **BR-21.3** | The evaluation instant arrives as `TrackFacts.evaluatedAtMs`, passed in as data. The engine never reads a clock | NFR-26 |
| **BR-21.4** | The same `(rules, facts)` pair yields an identical `Decision` on every call, on any machine, on any day | NFR-26, FR-42 |
| **BR-21.5** | `assembleFacts` performs no I/O and issues no request. Absent inputs arrive `null` and stay `null` — no default is ever substituted | FR-32 |
| **BR-21.6** | `RuleStore` is the unit's **only** impure module in the rules core, and it performs no evaluation | — |
| **BR-21.7** | History aggregates are fetched **once per play and cached**, and the cache lives **outside** the pure modules. Caching inside `assembleFacts` would give a pure function a memory and NFR-26 would be gone | NFR Q5 = C |
| **BR-21.8** | `playsOfTrack` and the other counts **exclude the play being evaluated** — at track start it is not yet recorded, so they mean *“before this one”* | NFR Q5 = C |
| **BR-21.9** | Fact assembly must **never** fail the recording path. A failure yields `null` counts, never an exception reaching the poll loop | NFR Q5 = C |

> ### BR-21.5 — a default here is a fabricated fact
>
> The same reasoning that forbids writing `completed` onto backfilled play rows. Substituting `0`
> for an unknown history count would make *"never skipped this track"* silently true for a track
> never seen, which is US-16's stated failure mode.

⚠️ **BR-21.2 and BR-21.3 are what `test/purity.test.ts` already exists to protect.** A
`Date.now()` in a pure module breaks FR-20 and FR-42 **while every other test passes**. That test
is the only thing that catches it, and it must be extended to cover the five new modules in the
same commit that creates them — not afterwards.

---

## Requirements coverage

| Requirement | Covered by | Status |
|---|---|---|
| FR-26 action is an enum | BR-19.2 | ✅ |
| FR-27 any field referenceable | BR-16.1–16.2 | ✅ |
| FR-28 introspectable catalogue | BR-16.2–16.5 | ✅ |
| FR-29 AND/OR/NOT + typed operators | BR-14.3, §2 operator table | ✅ |
| FR-30 rules combine as OR | BR-19.1, BR-19.8 | ✅ |
| FR-31 create/edit/enable/disable/delete/reorder | BR-18.2, BR-19.3 | ✅ |
| FR-32 tri-state evaluation | BR-14.1–14.2 | ✅ |
| FR-33 per-rule `onUnknown` | BR-19.5 (`no-match`, `match`) | ⚠️ **Partial** |
| FR-43 structured predicate tree | BR-20.1 | ✅ |
| FR-44 never evaluate input as code | BR-20.2 | ✅ |
| FR-45 validate at creation | BR-18.1 (creation **and** load) | ✅ exceeded |
| NFR-25 property-tested tri-state | BR-14.5, BR-21.1 | ✅ |
| NFR-26 deterministic, side-effect free | BR-21.2–21.4 | ✅ |
| NFR-27 storage round-trip | BR-20.11 | ✅ |

> ### ⚠️ FR-33 is knowingly **partially** met by U3
>
> `no-match` and `match` are implemented. **`hold` is not** — it requires a deadline and a
> re-evaluation trigger, neither of which exists in a pure synchronous module (Q9 = B). Rules
> declaring it are stored and disabled with a reason (BR-18.6).
>
> **FR-33 is discharged by U5, not by U3**, and that must be carried in the state document rather
> than left for someone to discover when the requirement is marked complete on the strength of this
> unit's tests.

**FR-24 and FR-25** are not listed: they concern *when* evaluation is triggered and how rules are
managed at runtime, both of which belong to the units that own the poll loop and the UI. U3
supplies the function they call.
