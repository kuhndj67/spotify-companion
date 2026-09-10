# Business Logic Model — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — Functional Design, U3
**Entities**: [`domain-entities.md`](domain-entities.md) · **Rules**: [`business-rules.md`](business-rules.md)

The algorithms, in evaluation order. Every one is a total function: for any input, including
malformed or absent data, it returns a value and never throws (NFR-25).

---

## The pipeline

```
  rules file ──> validateRuleSet ──> LoadedRule[]        (impure boundary ends here)
                                          │
   TrackFacts ─────────────────────────┐  │
                                       ▼  ▼
                                  evaluateRules
                                       │
                                  RuleOutcome[]
                                       │
                                  foldDecisions
                                       │
                                    Decision  ──> (nothing, at U3)
```

Five pure stages. The only I/O in the unit happens before the first arrow.

---

## 1. Field resolution — `fieldCatalogue`

```
findField(name) -> FieldDefinition | undefined
```

The catalogue is a **static table**, not a reflection over `TrackFacts`. Reflection would silently
expose every field the interface happens to gain, including ones nobody has decided are meaningful
or measured — and would have exposed the artist-level label verdict right up until it was deleted.
An explicit table means adding a field is a decision.

### Membership at U3

| Group | Fields |
|---|---|
| `track` | `id`, `title`, `durationMs`, `explicit`, `isrc` |
| `artist` | `id`, `name`, `following`, `genres` |
| `album` | `name`, `releaseDate`, `ageYears`, `type` |
| `label` | `name`, `classification`, `confidence` |
| `liked` | `atStart`, `transition` |
| `history` | `playsOfTrack`, `skipsOfTrack`, `playsOfArtist`, `skipsOfArtist` |

**Excluded**: `context.type` (Q5 = A — never available live), `context.deviceName` (live
availability never probed), `evaluatedAtMs` (an input, not a fact about the track).

### `operatorsFor(type)`

| `FieldType` | Operators |
|---|---|
| `string` | `eq` `neq` `in` `contains` `is-unknown` |
| `number` | `eq` `neq` `lt` `lte` `gt` `gte` `in` `is-unknown` |
| `boolean` | `eq` `neq` `is-unknown` |
| `date` | `eq` `neq` `lt` `lte` `gt` `gte` `is-unknown` |
| `enum` | `eq` `neq` `in` `is-unknown` |

`is-unknown` is valid on **every** type — it asks about presence, not value.

---

## 2. Comparison — the leaf of the tree

```
compare(field, op, value, facts) -> Verdict
```

### Step 1 — `is-unknown` short-circuits before anything else

```
if op == 'is-unknown':
    return (read(facts) == null) ? 'true' : 'false'
```

This is the **one** place a missing value produces a decisive answer, and it is the whole reason
the operator exists. It runs first so that no later step can turn it into `unknown`.

### Step 2 — an absent value yields `unknown` for every other operator

```
raw = field.read(facts)
if raw == null: return 'unknown'
```

No default, no coercion, no zero. This is FR-32 and it is the rule the rest of the project already
lives by.

### Step 3 — compare by declared type

#### Strings (Q4 = D) — case-insensitive **and** punctuation-folded

```
fold(s) = s.normalize('NFKD')
           .toLowerCase()
           .replace(/[^\p{Letter}\p{Number}]+/gu, '')
```

So `"Def Jam"` ≡ `"def-jam"` ≡ `"defjam"`. Applied to **both** sides, always. `label.name contains
"universal"` matches `"Universal Music Group"`, which is what a person means.

⚠️ **Folding is applied per value, never across a join.** See §2.4.

#### Multi-valued strings — `artist.genres` (Q8 = B, FQ2 = A)

`genres` is declared `type: 'string'`, `multiValued: true`. The author sees a string field; the list
is an implementation detail.

```
values = read(facts)                       # readonly string[]  |  []  |  null
if values == null:  return 'unknown'       # never asked
if values == []:    return 'false'         # asked; there are none  ← NOT unknown

eq / in       : any element folds equal to the operand
contains      : any element contains the operand ON A WORD BOUNDARY
```

**Word boundaries, not substrings.** Measured over the corpus's 110 distinct genres:

| Written | Plain substring would also match | Word-boundary matches |
|---|---|---|
| `contains "rap"` | `trap`, `trap latino`, `trap metal` | `pop rap`, `punk rap`, `cloud rap` |
| `contains "rock"` | 17 genres | `hard rock`, `indie rock`, … (the intended ones) |

The `rap` → `trap` case is the one that matters: it reads as a working rule and quietly matches a
different genre.

Because folding strips punctuation, boundaries are computed on the **tokenised** value —
`"hip hop"` → `["hip","hop"]` — and never on a folded join. A joined-then-folded string turns
`["hip hop","rapcore"]` into `"hiphoprapcore"`, where a match can cross a boundary that exists in
the data. That is why FQ2 = A matches per element.

#### Numbers

Standard ordering. `in` tests set membership. Non-finite operands are rejected at validation, so
they cannot reach here.

#### Dates (Q6 = A) — partial dates are `unknown` for ordering

`release_date` is `YYYY-MM-DD` on 423 plays and bare `YYYY` on 5.

| Operator | Full date | Year-only |
|---|---|---|
| `eq` `neq` | compare as strings | compare as strings — `"2022"` ≠ `"2022-01-01"` |
| `lt` `lte` `gt` `gte` | compare as dates | **`unknown`** |

A year-only date genuinely does not have an answer to *"is it after 2022-06-01?"*. Coercing it to
`2022-01-01` produces a **plausible wrong answer that is indistinguishable from a right one** —
the shape that has caught this project four times. `album.ageYears` is the field for ordering.

#### Booleans and enums

`eq`/`neq` on the value. `in` on enums tests membership of the operand list. An enum operand
outside `enumValues` is rejected at validation, not silently unmatched.

---

## 3. Tree evaluation — Kleene strong three-valued logic (Q1 = A)

```
evaluate(predicate, facts) -> Verdict
```

| `AND` | true | false | unknown | | `OR` | true | false | unknown |
|---|---|---|---|---|---|---|---|---|
| **true** | true | false | unknown | | **true** | true | true | true |
| **false** | false | false | **false** | | **false** | true | false | unknown |
| **unknown** | unknown | **false** | unknown | | **unknown** | true | unknown | unknown |

| `NOT` | true → false | false → true | **unknown → unknown** |
|---|---|---|---|

**A decisive known operand wins.** `false AND unknown` is `false`, because nothing the unknown
could turn out to be would rescue it. `true OR unknown` is `true`, for the mirror reason.

De Morgan holds in both directions, which is what NFR-25 requires and what makes the property test
meaningful:

```
NOT(a AND b) ≡ (NOT a) OR (NOT b)
NOT(a OR  b) ≡ (NOT a) AND (NOT b)
```

### Empty operand lists

`and: []` → `'true'`, `or: []` → `'false'` — the identity elements. Mathematically forced: any
other choice breaks associativity, and a validator that rejects empty lists is a better place to
object than an evaluator that invents an answer.

### Evaluation is exhaustive, not short-circuiting

Every operand is evaluated even when the result is already determined, because `fieldsSeen` must
record what the rule actually read for U4's observability. Short-circuiting would make the
explanation depend on operand order, which Q11 = A says is presentational.

---

## 4. Applying `onUnknown` — `evaluateRules`

```
evaluateRules(rules, facts) -> RuleOutcome[]
```

For each rule where `enabled === true && status.state === 'active'`:

```
verdict = evaluate(rule.predicate, facts)

applied = verdict != 'unknown' ? verdict
        : rule.onUnknown == 'match'    ? 'true'
        : rule.onUnknown == 'no-match' ? 'false'
        : /* 'hold' cannot reach here — the rule is disabled (FQ3 = C) */

restedOnUnknown = (verdict == 'unknown')
```

`'hold'` is unreachable by construction: `validateRuleSet` marks such rules
`disabled / unsupported-on-unknown` before evaluation. The branch is written as an exhaustiveness
check so that U5 adding the behaviour is a compile error here rather than a silent fallthrough.

> ⚠️ `restedOnUnknown` is set from the **raw verdict**, never accumulated while walking the tree.
> Accumulating produces option C of Q1, which was offered and not chosen. See `domain-entities.md`
> §7.

Disabled and user-disabled rules produce **no outcome**. Disabled-by-system rules are reported
separately in `Decision.disabledRules` so the reason survives; user-disabled rules are simply off.

---

## 5. The fold — `foldDecisions` (FR-30, Q11 = A)

```
foldDecisions(outcomes, disabled, partialData) -> Decision
```

```
matched = outcomes where applied == 'true'
action  = matched.isEmpty ? 'none' : 'skip'
restedOnUnknown = any matched outcome restedOnUnknown
```

**Pure OR across rules.** Any satisfied rule yields the action; order changes nothing about
whether. Order decides only the sequence of `matchedRuleIds`, which is what Q11 = A means by
presentation and reporting.

`restedOnUnknown` on the `Decision` is scoped to the **matched** rules — it answers *"did the thing
we are about to do rest on absent data?"*, which is US-17's criterion. A non-matching rule that
rested on unknown is still visible in its own `RuleOutcome`.

> ### This function is the designated seam
>
> `foldDecisions` is a single named function because the OR-fold is the thing most likely to
> change — exemptions, priorities, additional actions. Those would replace **this**, and nothing
> else. The engine, the evaluator and the catalogue are unaffected by a different combination
> policy.

---

## 6. Validation — `ruleValidator` (FR-45, Q7 = A, FQ3 = C)

```
validateRule(raw)    -> ValidationResult<Rule>
validateRuleSet(raw) -> ValidationResult<LoadedRule[]>
```

Two distinct outcomes, and the difference matters:

| Problem | Result |
|---|---|
| Not valid JSON; not an array; a rule missing `id`/`predicate`; malformed tree | **The whole set is rejected.** The file is not a rule set |
| Duplicate `id` | **The whole set is rejected** — an ambiguous identity makes every report unattributable |
| `field` not in the catalogue | Rule **loads, disabled**, `unknown-field` |
| Operator not valid for the field's type | Rule **loads, disabled**, `type-mismatch` |
| `value` missing, wrong type, or an enum value outside `enumValues` | Rule **loads, disabled**, `type-mismatch` |
| `onUnknown: 'hold'` | Rule **loads, disabled**, `unsupported-on-unknown` |

### Why the split is where it is

A **structural** problem means the file is not a rule set at all, and guessing at the author's
intent would run something they did not write. A **semantic** problem — a field that vanished, an
operator that no longer fits — means the rule is well-formed but currently unevaluable, and Q7 = A
says that rule is disabled with a reason, not deleted and not silently treated as `unknown`.

> ⚠️ **This is why validation runs at load, not only at creation.** FR-45 specifies creation-time
> validation, which cannot catch a field that disappears afterwards — and one did, on 2026-09-06,
> when migration 004 removed the artist-level label verdict. A rule written the week before would
> reference a field that no longer exists. `validateRuleSet` therefore runs on every load and every
> `watch()` reload, and `LoadedRule.status` carries the answer.

---

## 7. Loading — `RuleStore` (Q10 = B)

```
                    ┌─ valid ──────> replace current set
  read file ──────> │
                    └─ invalid ────> cold start: NO RULES
                                     reload:     KEEP LAST-KNOWN-GOOD
                                     …and surface the error loudly in both cases
```

**Never a partial load.** Taking the rules that parsed and dropping those that did not would
silently arm a rule set the user never wrote — the most dangerous outcome available to a component
that will eventually control playback.

A rule set that reverts to an older version without saying so is the same class of problem as an
empty state that does not explain itself, which is why the loud error is not optional. On cold
start there is no previous set, so an invalid file means **no rules**, and a rules engine with no
rules skips nothing.

**A bad rules file never stops the app from recording.** Recording is the artefact that cannot be
regenerated; rules are text that can be retyped.

---

## 8. What discharges the exit criteria

| Exit criterion | Discharged by |
|---|---|
| Tri-state never collapses `unknown` to `false`, incl. under NOT/OR | Property test over the §3 tables; generator emits `unknown` for any field |
| Composition obeys De Morgan | Property test over random trees, both identities |
| No field value causes a throw | Property test over arbitrary JSON values in `value`, incl. `NaN`, huge numbers, nested objects |
| Invalid rules rejected with a usable message | Table test over each row of §6 |
| Rules round-trip through storage | PBT-02: `parse(serialise(r))` evaluates identically on the same facts |
| Evaluation deterministic and side-effect free | `test/purity.test.ts` extended to the five pure modules; same facts twice ⇒ identical `Decision` |
| No I/O, clock, network or DB in the five pure modules | Static import check in `test/purity.test.ts` |

**Done means CI green.** A live listening session would tell us nothing these do not, and would
take hours to say it.
