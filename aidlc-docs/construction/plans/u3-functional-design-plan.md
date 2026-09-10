# Functional Design Plan — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — Functional Design, Unit U3
**Unit**: [`../../inception/application-design/unit-of-work.md`](../../inception/application-design/unit-of-work.md) (U3)
**Stories**: US-14, US-15, US-16, US-17
**Requirements**: FR-24–33, FR-43–45, NFR-25–27

---

## Unit context

U3 is the **pure core of the rules engine** — six modules, five of them pure, producing `Decision`
values that **nothing yet consumes**. It cannot skip a track; `src/playback/` does not exist until
U5. That containment is the point: the riskiest logic in the project is proven correct before
anything depends on its behaviour.

**Done means CI green.** This is the one unit gated on tests alone, deliberately — its correctness
is entirely a property of pure functions, and a live listening session would tell you nothing a
property test does not.

### U3 starts in a changed world

Two things happened since the unit was specified, and both bear on the field catalogue:

1. **The Phase 2 gate was discharged 2026-09-10: R1 is NOT SUPPORTED** (`major` 9.2% vs
   `independent` 8.6%, p = 0.888). This was always designed not to gate U3 — *"rules are
   user-authored; they must be valuable without R1 being settled"* — and it does not. But it
   changes the honest framing of `label.classification`: it remains a legitimate field to write
   rules over, and is **no longer a field backed by evidence that it predicts this listener's
   skips**. Q3 asks whether the catalogue should say so.
2. **The artist-level label verdict was removed** (migration 004, 2026-09-06) because it was
   classifying other artists' record deals. **A field the catalogue would have exposed ceased to
   exist.** Rules persist across restarts; the schema does not stand still. Q7 is about that.

### Facts measured from the live corpus (427 plays) for this plan

Every question below is grounded in the database as it actually is, not in the schema as designed.

| Field | Reality on 2026-09-10 |
|---|---|
| `release_date` | 423 full `YYYY-MM-DD`, **5 year-only** (`YYYY`). Partial dates are rare but real |
| `context_type` | **NULL on all 342 live plays; populated on all 85 backfilled** (83 playlist, 2 artist) |
| `artist_genres` | A **JSON list of `{name, count}`**, not a scalar. 258 populated, 131 empty array, 39 NULL |
| `following` | 255 true, 88 false, 85 NULL |
| `liked_transition` | 4 states + `unknown`: kept-unliked 193, kept-liked 69, liked-during 33, unknown 14 |
| `artist_id` | The **primary** artist only. Ren appears on 34 plays, owns the primary id on 26 |

> ⚠️ **Open item 7 is stale and should be corrected.** It records `context_type` as NULL on all
> plays. It is NULL on every **live** play and present on every **backfilled** one — the MCP
> `getNowPlaying` returns no context field, while `recently-played` does. The field is available
> **exactly where the outcome variable is not**, which is the inverse of what a rule needs. Q5.

---

## Plan

- [x] Confirm the tri-state truth tables and the `exists` escape hatch (Q1, Q2)
- [x] Settle string comparison semantics — case, normalisation, `contains` (Q4)
- [x] Settle partial-date and numeric comparison semantics (Q6)
- [x] Decide the field catalogue's membership and honesty obligations (Q3, Q5, Q8)
- [x] Decide what `onUnknown: 'hold'` means in a synchronous pure engine (Q9)
- [x] Decide rule-set failure and field-drift behaviour (Q7, Q10)
- [x] Decide what "reorder" means when combination is a pure OR (Q11)
- [x] Write `business-logic-model.md` — evaluation algorithm, fold, Decision assembly
- [x] Write `domain-entities.md` — Rule, Predicate, TrackFacts, FieldDefinition, Decision
- [x] Write `business-rules.md` — numbered BRs for every semantic settled above
- [x] Define the property-test obligations that discharge NFR-25/26/27

---

## Questions

### Question 1 — Which three-valued logic?

NFR-25 requires De Morgan's laws to hold and forbids `unknown` collapsing to `false`. Two families
qualify on the first count; only one is the conventional answer.

| | `unknown AND false` | `unknown OR true` | De Morgan |
|---|---|---|---|
| **A) Kleene (strong)** | **false** | **true** | ✅ holds |
| B) Bochvar (weak) | unknown | unknown | ✅ holds |

Kleene says a known-decisive operand wins even when its partner is unknown: *"label is major AND
artist is not followed"* is **false** if the artist **is** followed, whatever the label is. Bochvar
says any unknown anywhere poisons the whole expression.

Kleene is the standard choice and what SQL does. Bochvar is more conservative — it would route far
more decisions into `onUnknown` handling, which for a unit that will eventually skip tracks is the
safer direction, at the cost of rules that "should" have been decidable.

A) **Kleene (strong)** — a decisive known operand wins

B) **Bochvar (weak)** — unknown propagates unconditionally

C) Kleene, but `Decision.restedOnUnknown` flags any expression that *contained* an unknown even
   when the verdict was decisive — Kleene's semantics with Bochvar's reporting

**[Answer]:**
A
---

### Question 2 — Can a rule ask whether a field is missing?

`exists` is in the operator list. If it returns `unknown` for a missing field like every other
operator, it is useless — and *"skip tracks whose label we could not resolve"* becomes unwritable.
That matters here: **125 of 317 eligible plays have no label verdict**, and R2 says those misses
are not random.

But an `exists` that returns a clean true/false is the one place `unknown` is deliberately
collapsed, which is exactly what NFR-25 forbids everywhere else.

A) **`exists` always returns true/false, never `unknown`** — the single, named, documented
   exception. `not(exists(label.classification))` is how you write "unresolved"

B) Add a distinct `is-unknown` operator instead, leaving `exists` tri-state — more explicit, one
   more operator to validate and test

C) No such operator; let `onUnknown: 'match'` cover it — but that is rule-wide, not per-field, so
   a rule cannot say "unknown label AND followed artist"

**[Answer]:**
B
---

### Question 3 — Should the catalogue tell the author what the gate found?

FR-28 requires the catalogue to expose "typical availability" of every field. `availability` is
about *presence*. Nothing in the design carries a field's **evidential standing**.

`label.classification` is now a field whose headline hypothesis was tested and not supported. A
Curator writing *"skip major-label releases"* is doing something legitimate — it is their taste —
but they may also believe they are acting on a measured effect.

A) **Add a `note` to `FieldDefinition`**, surfaced wherever the field is offered. For
   `label.classification`: *"Tested 2026-09-10 against this listener's own skips — no detectable
   effect (p = 0.888). Legitimate as a preference; not evidence-backed as a predictor."*

B) Availability only. The catalogue describes data, not findings; the gate result lives in the
   docs and does not belong in a field definition

C) Add the note but keep it out of the `FieldDefinition` type — a separate advisory the UI can
   render, so the pure module carries no editorial content

**[Answer]:**
A
---

### Question 4 — How do string comparisons treat case and punctuation?

`artist.name`, `label.name` and `album.name` are free text from two different upstreams. U2 already
learned that label matching needs normalisation. A rule saying `label.name contains "universal"`
should presumably match `"Universal Music Group"`.

A) **`eq`/`in` case-insensitive and Unicode-normalised; `contains` likewise** — one rule, no
   surprises, and it matches how a person means it

B) Exact and literal throughout — predictable, but `"Universal"` silently missing
   `"universal"` is a footgun on a field with no autocomplete

C) Case-insensitive `contains`, exact `eq` — the common split, but two rules to remember

D) Case-insensitive **and** punctuation-folded (`"Def Jam"` ≡ `"def-jam"`) — most forgiving, most
   surprising when it over-matches

**[Answer]:**
D
---

### Question 5 — Should `context.type` be in the catalogue at all?

It is NULL on **every live play** and populated on **every backfilled** one. A rule evaluates at
track start — i.e. on the live path — so `context.type` would be `unknown` **100% of the time** in
production, while looking populated in any back-test over history (FR-42, U4).

That is the worst shape available: a field that back-tests as available and is never available
live. Open item 7 records that `/me/player/currently-playing` **does** return it and the user
declined to add that call for now.

A) **Exclude it from the catalogue until the live path can populate it.** A field that is
   structurally always-unknown live is not a field, and its back-test behaviour would actively
   mislead

B) Include with `availability: 'often-unknown'` — honest by the letter, but the label understates
   "never, live"

C) Include with a new `availability: 'never-live'` value that the validator **warns** on and the
   back-tester refuses to use

D) Take open item 7 now — add the `currently-playing` call so the field becomes real. Scope
   increase; U3 is meant to be pure and this is a collection change

**[Answer]:**
A
---

### Question 6 — How are partial dates and derived numbers compared?

`release_date` is `YYYY-MM-DD` on 423 plays and bare `YYYY` on 5. `album.ageYears` is derived from
it. A rule `release_date > "2022-06-01"` has no defensible answer for a track dated `"2022"`.

A) **Partial dates yield `unknown` for ordering comparisons** (`lt`/`gt`/`lte`/`gte`), and remain
   usable for `eq`/`contains`. Honest, and 5 of 428 plays are affected

B) Widen to the range and answer only when unambiguous — `"2022" > "2022-06-01"` is `unknown`,
   `"2022" > "2021-12-31"` is `true`. Most correct, most code, most tests

C) Coerce to `YYYY-01-01` and compare — simple, silently wrong at year boundaries, and the wrong
   answer is indistinguishable from a right one

D) Steer authors to `album.ageYears` for ordering and keep `release_date` for equality only

⚠️ Note C is the shape this project has been bitten by four times: a plausible wrong answer that
reads as data rather than as a bug.

**[Answer]:**
A
---

### Question 7 — What happens to a rule when its field disappears?

Not hypothetical. **Migration 004 deleted the artist-level label verdict on 2026-09-06.** Any rule
written over it the week before would now reference a field that does not exist. FR-45 validates
at *creation* time; this is a field that vanished afterwards.

A) **The rule is disabled, not deleted, and says why.** The rule set still loads; the broken rule
   is inert and visibly flagged. Nothing acts on a rule it cannot evaluate, and nothing is lost

B) The field evaluates to `unknown` and `onUnknown` decides — uniform with missing data, but wrong:
   "we never resolved this" and "this field no longer exists" are different facts, and merging them
   is the `unknown`-merge defect of 2026-09-06 in a new place

C) The whole rule set is rejected, as with a malformed file — safest, but one dead field disarms
   every rule the user has

D) Validation is re-run at load and the rule is rejected with the file — same as C in effect

**[Answer]:**
A
---

### Question 8 — Is `artist_genres` a rule field, and what type is it?

It is a **JSON list of `{name, count}`** — 258 populated, 131 empty, 39 NULL. The catalogue's
`FieldType` has no list type. Genres are also the most natural thing a person wants to write a rule
about, and are now the *only* thing the artist level provides.

⚠️ Note the empty array is not missing data: MusicBrainz was asked and returned nothing. **131
empty vs 39 NULL is the `unknown`-is-two-facts distinction again** — "we have not asked" versus
"we asked and there are none".

A) **Add `type: 'string-list'` with `contains` / `in` operators**, `unknown` only for NULL and
   `false` for the empty array. Honest about both facts; one new type to test

B) Expose as a joined string and let `contains` do substring matching — no new type, but
   `contains "rock"` matches `"acoustic rock"`, `"rock"` **and** `"punk rock"`, which may or may
   not be wanted

C) Expose `artist.topGenre` (highest count) as a plain string — simple, discards most of the data,
   and ties the answer to MusicBrainz's vote counts

D) Leave genres out of U3 and revisit in a later unit

**[Answer]:**
B
---

### Question 9 — What does `onUnknown: 'hold'` mean in a pure, synchronous engine?

FR-33 offers three behaviours: no-match, match, and **hold pending resolution**. `evaluate` is pure
and returns a `Verdict` immediately — it has no clock, no queue and no way to wait. FR-34/FR-35 and
`Decision.partialData` suggest the waiting belongs elsewhere.

This is the U3/U5 seam, and getting it wrong puts a timer inside a pure module.

A) **`hold` is a `Decision` outcome, not a wait.** The engine returns `action: 'none'` with a
   `heldRuleIds` list; whoever owns the deadline (U5) may re-evaluate when enrichment lands. U3
   stays pure and synchronous, and the re-evaluation is just a second call with better facts

B) Drop `hold` from U3 and implement it in U5 — FR-33 is then only partly met by this unit

C) `hold` is validated and stored but treated as `no-match` until U5 — simplest, but a stored
   setting that silently does nothing is the "empty state that does not explain itself" trap

D) Model it as a fourth `Verdict` value alongside true/false/unknown — invasive; every truth table
   and property test doubles

**[Answer]:**
B
---

### Question 10 — What runs when the rules file is invalid?

`RuleStore.load()` rejects the **whole file** on any failure. The engine then has no rules. Because
U3 cannot act, this is harmless now and load-bearing at U5.

A) **No rules — fail to inert.** A rules engine that cannot read its rules skips nothing. On a
   `watch()` reload failure, keep the last-known-good set in memory and surface the error loudly

B) Last-known-good on both cold start and reload — but on cold start there is nothing to fall back
   to, so this differs from A only on reload

C) Refuse to start the app — unacceptable: recording must survive a bad rules file, and recording
   is the artefact that cannot be regenerated

⚠️ The failure to avoid is a **partial** load: taking the rules that parsed and ignoring those that
did not, which silently changes the active rule set to something the user never wrote.

**[Answer]:**
B
---

### Question 11 — What does "reorder" mean when combination is OR?

FR-31 lets the user reorder rules. FR-30 makes combination a pure OR, which is commutative — order
cannot change *whether* a track is skipped in Unit 1.

A) **Order is presentation and reporting only** — it decides which rule is named first in the
   `Decision` when several match, and the order they appear in the UI. Documented as having no
   effect on the outcome

B) Order is first-match-wins: evaluation stops at the first matching rule. Changes FR-30's
   semantics, and stops `Decision.outcomes` from being a complete record — which U4's
   observability needs

C) Order is priority for a future action set (when `RuleAction` gains members beyond `skip`),
   stored now and unused. Honest, but a stored value that does nothing

D) Drop reorder from U3 and add it when it means something

**[Answer]:**
A
---

## After the answers

Ambiguous or partial responses get follow-up questions before any artifact is written. The three
artifacts — `business-logic-model.md`, `domain-entities.md`, `business-rules.md` — then follow,
with every semantic settled above written as a numbered business rule so the property tests have
something to cite.

---

# Follow-up questions — round 2

**Answers received 2026-09-10**: Q1 **A** · Q2 **B** · Q3 **A** · Q4 **D** · Q5 **A** · Q6 **A** ·
Q7 **A** · Q8 **B** · Q9 **B** · Q10 **B** · Q11 **A**.

None were vague. Three of them have consequences the original question did not spell out, and one
pair interacts in a way neither question could show alone. Raised here rather than resolved
silently.

---

### FQ1 — Q2=B leaves `exists` unable to ever return `false`

`is-unknown` is added and `exists` stays tri-state. But `exists` has only two possible inputs:

| Field state | tri-state `exists` returns |
|---|---|
| present | `true` |
| missing | **`unknown`** |

There is no third case, so **`exists` never returns `false`**. It becomes a strictly weaker
`is-unknown` that cannot be used to test anything, and `not(exists(f))` — the natural way to write
"unresolved" — yields `not(unknown)` = `unknown`, which is precisely the thing that does not work.

A) **Drop `exists` from the operator set.** `is-unknown` and `not(is-unknown)` cover both
   directions cleanly, and there is one obvious way to write each

B) **Keep `exists` as validated sugar for `not(is-unknown(field))`** — clean `true`/`false`,
   familiar name, but it is then *not* tri-state, which is what Q2=B chose against

C) **Keep it exactly as answered** — tri-state, documented as returning only `true` or `unknown`,
   with the validator warning when `exists` appears under a `not`

**[Answer]:**
A
---

### FQ2 — Q8=B × Q4=D: folding the separator lets a match cross two genres

Q8=B exposes genres as a **joined string** matched by substring; Q4=D folds **case and
punctuation**. Together, the separator between genres is folded away:

```
["hip hop", "rapcore"]  →  "hip hop, rapcore"  →  folded: "hiphoprapcore"
```

A query can now match across a boundary that exists in the data but not in the folded string.
Measured on the corpus — **110 distinct genres, 62 of them multi-word** — the sharper problem is
plain substring matching:

| Rule the author writes | Also matches |
|---|---|
| `genres contains "rap"` | **`trap`, `trap latino`, `trap metal`** — 7 genres, 4 unintended |
| `genres contains "rock"` | 17 genres, mostly intended (`hard rock`, `indie rock`) |
| `genres contains "pop"` | 21 genres, including `britpop` |

The `rap` → `trap` case is the one that will actually bite: it reads as a working rule.

A) **Match per genre element, on whole-word boundaries.** `"rap"` matches `pop rap`, not `trap`.
   No cross-boundary matches. The author still sees a plain string field, so Q8=B's "no new type"
   holds — the list stays an implementation detail

B) **Match per genre element, substring within each element.** No cross-boundary matches, but
   `"rap"` still matches `trap`

C) **Joined string, folded, substring — exactly as answered.** Simplest; accepts both the
   cross-boundary match and the `trap` over-match

D) **Reopen Q8 and take option A** (`type: 'string-list'` with real list operators)

**[Answer]:**
A
---

### FQ3 — Q9=B: what does the validator do with `onUnknown: 'hold'` *today*?

`hold` moves to U5, so FR-33 is **partly met** by U3 and that gap gets recorded. The open point is
what happens right now if a rule file contains `"onUnknown": "hold"`.

Q9=C — accept it and silently treat it as `no-match` — was rejected as the "stored setting that
does nothing" trap, so the remaining choices are about *how loudly* it is refused.

A) **The `Rule` type has no `'hold'` member in U3.** A file containing it fails validation with
   *"onUnknown: 'hold' is not available until U5"*. Unwritable and clearly explained

B) **The type includes `'hold'`; the validator rejects it** with the same message. The seam is
   visible in the type, so U5 adds behaviour rather than widening a union

C) **Accept and store it, and disable the rule** — reusing Q7=A's machinery: the rule loads, is
   inert, and says why. Consistent with how a rule referencing a dead field behaves

**[Answer]:**
C
---

### Carried into the design without asking

Recorded here so they are decisions rather than omissions:

- **Q10=B keeps last-known-good on reload.** Option A's *"surface the error loudly"* is carried
  over regardless — a rule set that silently reverts to an older version is the same class of
  problem as an empty state that does not explain itself.
- **Q10 on cold start**: there is no last-known-good, so an invalid file yields **no rules**.
  B and A agree here; only reload differs.
- **Q7=A implies validation runs at load, not only at creation** (FR-45 says creation). A rule
  referencing a field that has since disappeared can only be caught at load, so `validateRuleSet`
  runs both times and `Rule` carries a status.
- **Q3=A puts editorial text in a pure module.** `FieldDefinition.note` is static data with no I/O,
  so `test/purity.test.ts` is unaffected.
