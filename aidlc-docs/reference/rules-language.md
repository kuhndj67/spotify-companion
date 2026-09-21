# The rules language — grammar and reference

**For**: anyone — or anything — authoring a rule. Written to be usable both by a person editing
`config/rules.json` by hand and as **reference context for a generator that turns natural
language into rules** (a planned unit of work).
**Status**: describes the language as implemented at **U4** (2026-09-21). Derived by reading
`ruleValidator.ts`, `fieldCatalogue.ts` and `predicate.ts`, not from the design documents — where
this disagrees with the code, the code is right and this file is a bug. `test/rulesLanguageDoc.test.ts`
pins the catalogue, the operator matrix and the limits against the code so that cannot drift
silently.

---

## What this document is about

**The rule syntax**, not the file format. A rule is a small expression language expressed in
JSON; where it is stored, and the wrapper around it, are incidental and are relegated to
[Appendix A](#appendix-a--the-file-wrapper).

The substance is §1's `rule` and `predicate` productions, the field vocabulary in §2, and the
three-valued semantics in §5. A generator that gets those right produces working rules
regardless of how the file is assembled.

⚠️ **A grammar cannot express this language completely, and the gap is not a detail.** Validation
has two phases with *different failure behaviours* — a structurally perfect rule can still load
**disabled**. See [Validation](#6-validation). Reading the grammar alone gives you a wrong model
of what happens when a rule is *almost* right, which is the usual output of a generator.

---

## 1. The rule

An EBNF over the **JSON value structure** — the shape required once the text has been parsed.
`object`, `array`, `string`, `number` and `boolean` are JSON's own.

```ebnf

rule            = "{"
                    '"id"'        , ":" , non-empty-string , ","
                    '"name"'      , ":" , string           , ","
                    '"enabled"'   , ":" , boolean          , ","
                    '"action"'    , ":" , '"skip"'         , ","
                    '"onUnknown"' , ":" , on-unknown       , ","
                    '"predicate"' , ":" , predicate
                  [ , '"dryRun"'  , ":" , boolean ]
                  "}" ;
                (* Member order is irrelevant; all but dryRun are required. *)

on-unknown      = '"no-match"' | '"match"' | '"hold"' ;

(* ---- predicates: the recursive part, and the reason this file exists ---- *)

predicate       = comparison | conjunction | disjunction | negation ;

conjunction     = "{" , '"kind"' , ":" , '"and"' ,
                    "," , '"operands"' , ":" , non-empty-predicate-array , "}" ;

disjunction     = "{" , '"kind"' , ":" , '"or"' ,
                    "," , '"operands"' , ":" , non-empty-predicate-array , "}" ;

negation        = "{" , '"kind"' , ":" , '"not"' ,
                    "," , '"operand"' , ":" , predicate , "}" ;

comparison      = binary-comparison | unary-comparison ;

binary-comparison
                = "{" , '"kind"'  , ":" , '"compare"' ,
                    "," , '"field"' , ":" , non-empty-string ,
                    "," , '"op"'    , ":" , binary-op ,
                    "," , '"value"' , ":" , operand , "}" ;

unary-comparison
                = "{" , '"kind"'  , ":" , '"compare"' ,
                    "," , '"field"' , ":" , non-empty-string ,
                    "," , '"op"'    , ":" , '"is-unknown"' , "}" ;
                (* ⚠️ "value" MUST BE ABSENT here, not null. *)

binary-op       = '"eq"'  | '"neq"'
                | '"lt"'  | '"lte"' | '"gt"' | '"gte"'
                | '"in"'  | '"contains"' ;

non-empty-predicate-array
                = "[" , predicate , { "," , predicate } , "]" ;

operand         = scalar | scalar-array ;
                (* An array is required by "in" and accepted by nothing else.
                   ⚠️ An EMPTY array is structurally legal here and refused in the
                   semantic phase -- so it disables one rule, it does not reject
                   the set. Verified against ruleValidator.ts. *)

scalar          = string | number | boolean ;
scalar-array    = "[" , [ scalar , { "," , scalar } ] , "]" ;
```

### Three things the grammar states that are easy to miss

- **An empty `operands` array is refused.** `and` over nothing is `true` and `or` over nothing is
  `false` by the identity laws, but a rule containing one is almost certainly a mistake, and the
  validator is a better place to object than an evaluator that invents an answer.
- **`is-unknown` takes no `value`, and passing one is an error** — not ignored. Writing
  `"value": null` is *providing* a value and will be refused.
- **`action` has exactly one legal value, `"skip"`.** There is no `pause`, no `like`, no
  `volume`. A rule expresses *which tracks*, never *what to do about them*.

---

## 2. Field catalogue

The complete set. A field not listed here does not exist, and a rule referencing one is
**disabled with a reason** (never silently false).

| Field | Type | Availability | Notes |
|---|---|---|---|
| `track.title` | string | always | |
| `track.durationMs` | number | always | |
| `track.explicit` | boolean | usually | Stored from schema v5. Unanswerable on older rows in back-tests |
| `track.isrc` | string | usually | |
| `artist.name` | string | always | |
| `artist.following` | boolean | usually | |
| `artist.genres` | string | often-unknown | ⚠️ **Multi-valued** — see §4 |
| `album.name` | string | always | |
| `album.releaseDate` | date | usually | `YYYY-MM-DD`, occasionally bare `YYYY` |
| `album.ageYears` | number | usually | |
| `album.type` | string | usually | `album` / `single` / `compilation`. v5, as `track.explicit` |
| `label.name` | string | often-unknown | |
| `label.classification` | **enum** | often-unknown | `major` \| `independent` \| `unknown` — ⚠️ see §7 |
| `label.confidence` | string | often-unknown | |
| `liked.atStart` | boolean | usually | |
| `liked.transition` | **enum** | often-unknown | `kept-liked` \| `kept-unliked` \| `liked-during` \| `unliked-during` \| `unknown` — ⚠️ see §7 |
| `history.playsOfTrack` | number | usually | Plays strictly *before* this one |
| `history.skipsOfTrack` | number | usually | |
| `history.playsOfArtist` | number | usually | ⚠️ **Primary artist only** — see §7 |
| `history.skipsOfArtist` | number | usually | ⚠️ As above |

---

## 3. Operators by type

An operator outside its row **disables the rule** with `type-mismatch`.

| Type | Permitted operators |
|---|---|
| `string` | `eq` `neq` `in` `contains` `is-unknown` |
| `number` | `eq` `neq` `lt` `lte` `gt` `gte` `in` `is-unknown` |
| `boolean` | `eq` `neq` `is-unknown` |
| `date` | `eq` `neq` `lt` `lte` `gt` `gte` `is-unknown` |
| `enum` | `eq` `neq` `in` `is-unknown` |

`is-unknown` is valid on **every** type: it asks about presence, not value.

### Operand rules

| Operator | Operand | Enforced in |
|---|---|---|
| `in` | An **array** of scalars… | structural |
| `in` | …that is **non-empty**, each member valid for the field's type | **semantic** |
| `is-unknown` | **None** | structural |
| everything else | A single scalar… | structural |
| everything else | …valid for the field's type | **semantic** |

⚠️ The split matters: `"op": "in", "value": []` is **not** a file-level error. It loads with that
one rule **disabled** (`type-mismatch`), and the rest of the set runs.

A `number` operand must be **finite** — `NaN` and `Infinity` are refused at load, which is what
lets the evaluator be a total function. An `enum` operand outside the declared set is refused
too, rather than silently never matching: a rule that can never fire should say so when you
write it, not at 3am.

---

## 4. Comparison semantics

### Strings are folded on both sides

Case-insensitive and punctuation-folded: `"Def Jam"` ≡ `"def-jam"` ≡ `"defjam"`.

### `contains` matches on word boundaries, not substrings

`contains "rap"` does **not** match `trap`, `trap latino` or `trap metal`. This was measured over
the corpus's 110 distinct genres: plain substring matching produced 4 unintended hits out of 7.

### ⚠️ `artist.genres` is multi-valued and matched per element

| Operator | Meaning on `artist.genres` |
|---|---|
| `eq` | **any** element equals the operand |
| `neq` | `not(eq)` |
| `in` | **any** element appears in the operand list |
| `contains` | **any** element contains the operand on a word boundary |

Matching happens **per element, never over a join**. Joining `["hip hop","rapcore"]` and folding
would produce `"hiphoprapcore"`, where a match can cross a boundary that exists in the data but
not in the string.

⚠️ **An empty genre list is `false`, not `unknown`.** `[]` means MusicBrainz was asked and lists
none — that is an answer. `null` means nobody asked. Collapsing them loses a real distinction.

---

## 5. Evaluation is three-valued

Every comparison yields `true`, `false` or `unknown`. **An absent field yields `unknown` for
every operator except `is-unknown`** — never `false`, never `0`, never a default.

```
    AND | true    false   unknown          OR | true   false    unknown
  ------|-----------------------         -----|------------------------
   true | true    false   unknown         true | true   true     true
  false | false   false   false          false | true   false    unknown
unknown | unknown false   unknown       unknown| true   unknown  unknown

  NOT true = false     NOT false = true     NOT unknown = unknown
```

A decisive operand wins: `false AND unknown` is **`false`**, because the data answered the
question. That is why a rule can read an unknown field and still resolve definitively.

### `onUnknown` — what happens when the rule's own verdict is `unknown`

| Value | Effect |
|---|---|
| `no-match` | The rule does not fire |
| `match` | The rule fires |
| `hold` | ⚠️ **Not available.** A rule declaring it **loads disabled**, with a reason |

`hold` needs a deadline and a re-evaluation trigger, which do not exist yet. It is stored rather
than refused so a rule written today starts working when automated skipping ships, instead of
needing to be re-authored at the moment the stakes become real.

### Across rules

The action is taken if **any** rule matches, after each rule's own `onUnknown` is applied.

---

## 6. Validation

### Two phases, two very different consequences

| Phase | Examples | Consequence |
|---|---|---|
| **Structural** | bad JSON, missing `id`, malformed tree, empty `operands`, `is-unknown` with a value, duplicate id, too many rules | ⚠️ **THE WHOLE SET IS REJECTED** |
| **Semantic** | unknown field, wrong operator for the type, ill-typed operand, **empty `in` array**, too deep, `onUnknown: hold` | **That one rule loads disabled**, with a reason |

⚠️ **Empty `operands` and empty `in` land in different phases**, which looks inconsistent and is
not: an empty `and` has no meaningful reading at all, whereas an empty `in` is a well-formed
comparison against nothing. Cross-checked against the implementation rather than assumed.

**There is never a partial structural load.** Keeping the rules that parsed and dropping the rest
would silently arm a rule set nobody wrote — in the component that will eventually control
playback.

A **duplicate `id`** rejects the set rather than disabling one of the pair: with two rules sharing
an id, no report can say which one matched.

### Disabled reasons you may see

| Reason | Meaning |
|---|---|
| `unknown-field` | No such field in the catalogue. Often a field that *used* to exist |
| `type-mismatch` | Operator or operand does not fit the field's type |
| `too-deep` | Predicate nests deeper than 32 levels |
| `unsupported-on-unknown` | `onUnknown: "hold"` |

Validation runs **on every load**, not only when you write the rule. A field can disappear
underneath a working rule — one did, when the artist-level label verdict was removed.

### Limits

| Limit | Value |
|---|---|
| Predicate depth | 32 |
| Rules per file | 1000 |
| File size | 1 MiB |

These are **constants, not settings**. A limit that can be raised from the environment gets
raised the moment it first refuses something — which is the moment it is doing its job.

---

## 7. ⚠️ Traps

### `label.classification` has a value literally named `"unknown"`

This is the one most likely to mislead you, and it shows up in the very first decisions you read.

`unknown` is a **legitimate member of the enum**: it means *the release was looked up and could
not be classed major or independent*. The field **has an answer**.

Consequences:

| Expression | Result when the value is `"unknown"` |
|---|---|
| `label.classification eq "major"` | **`false`** — decisively, not `unknown` |
| `label.classification eq "unknown"` | **`true`** |
| `label.classification is-unknown` | **`false`** — the field is not absent, it is answered |

To catch *"we never resolved a label for this track"*, use `is-unknown`. To catch *"we looked and
could not tell"*, compare against `"unknown"`. They are different questions and different rows.

`liked.transition` carries the same shape.

### `not(unknown)` is `unknown`, so `not` cannot rescue a missing field

`{"kind":"not","operand":{...is-unknown...}}` is the usual mistake. `is-unknown` is always
decisive, so negating *it* is fine — but negating an ordinary comparison on an absent field
leaves you with `unknown`, which is exactly the question you were trying to answer.

### `liked.transition` is always unknown during live evaluation

It is derived when a play **closes**, and a decision is taken seconds after a play **starts**. A
rule using it will back-test beautifully and never fire live.

### `history.*` artist counts undercount guest appearances

Only the **primary** artist is recorded per play, so a feature credit files under the lead.
Measured: an artist appearing on 34 plays owned the primary id on 26 — about 24% low. This
affects live evaluation and back-testing equally.

### A rule matching nothing may never have been asked

`0 matches` and `0 evaluations against an answerable field` look identical in a naive count. The
back-test reports `undecidable` and `unanswerableFields` separately for exactly this reason.

---

## 8. Worked examples

**Simple comparison**

```json
{
  "id": "major-label",
  "name": "Major-label release",
  "enabled": true,
  "action": "skip",
  "onUnknown": "no-match",
  "predicate": { "kind": "compare", "field": "label.classification", "op": "eq", "value": "major" }
}
```

**Conjunction**

```json
{
  "id": "old-and-major",
  "name": "Over 20 years old AND major",
  "enabled": true,
  "action": "skip",
  "onUnknown": "no-match",
  "predicate": {
    "kind": "and",
    "operands": [
      { "kind": "compare", "field": "album.ageYears", "op": "gt", "value": 20 },
      { "kind": "compare", "field": "label.classification", "op": "eq", "value": "major" }
    ]
  }
}
```

**Multi-valued `contains`, and a set membership**

```json
{
  "kind": "or",
  "operands": [
    { "kind": "compare", "field": "artist.genres", "op": "contains", "value": "hip hop" },
    { "kind": "compare", "field": "album.type", "op": "in", "value": ["single", "compilation"] }
  ]
}
```

**Never resolved, versus resolved-and-unclassifiable**

```json
{
  "kind": "or",
  "operands": [
    { "kind": "compare", "field": "label.classification", "op": "is-unknown" },
    { "kind": "compare", "field": "label.classification", "op": "eq", "value": "unknown" }
  ]
}
```

**Negation**

```json
{
  "kind": "not",
  "operand": { "kind": "compare", "field": "artist.following", "op": "eq", "value": true }
}
```

⚠️ With `onUnknown: "no-match"`, this does **not** fire for an artist whose follow status is
absent — `not(unknown)` is `unknown`.

---

## 9. Authoring from natural language

Written for a generator — human or model — turning a request like *"skip anything on a major
label that's over 20 years old"* into JSON. Everything here is a consequence of §§1–7; it is
gathered separately because the failure modes of *generating* a rule differ from those of
reading one.

### The vocabulary is closed

⚠️ **Field names are exact and there are no synonyms.** The catalogue in §2 is the entire
vocabulary. A plausible-looking name that is not on that list produces a rule that **loads
disabled** — it does not error at write time, and it does not match anything.

Frequent near-misses, none of which exist:

| Tempting | Correct |
|---|---|
| `artist.genre` | `artist.genres` |
| `track.duration`, `track.lengthMs` | `track.durationMs` |
| `album.year`, `album.age` | `album.ageYears` |
| `label.type`, `label.major` | `label.classification` |
| `liked`, `track.liked` | `liked.atStart` |
| `artist.playCount` | `history.playsOfArtist` |
| `album.releaseYear` | `album.releaseDate` (a date string) |

Enum operands are closed too: `label.classification` accepts **only** `major`, `independent`,
`unknown`. Not `indie`, not `Major`, not `self-released`. An operand outside the set is refused
rather than silently never matching.

### Choosing `onUnknown` is a real decision, not boilerplate

Most requests are silent about what should happen when the data is missing, and it happens
often — `label.*` and `artist.genres` are marked `often-unknown` for measured reasons.

| The request sounds like | Use | Because |
|---|---|---|
| *"skip X"* (a positive filter) | `no-match` | Absent data is not evidence of X |
| *"only keep things I know are Y"* | `match` | The user wants the benefit of the doubt withheld |
| anything needing a wait | ⚠️ not available | `hold` loads the rule **disabled** until U5 |

**Default to `no-match`.** It is the conservative reading for a component that will eventually
control playback, and it is what all three shipped rules use.

### Mapping common phrasings

| Natural language | Predicate |
|---|---|
| *"major label"* | `label.classification eq "major"` |
| *"not on a major label"* | ⚠️ `label.classification eq "independent"` — **not** `not(eq major)`, which is `true` for `unknown` too |
| *"we couldn't identify the label"* | `label.classification is-unknown` |
| *"the label is unidentifiable"* | `label.classification eq "unknown"` — a different set of rows; see §7 |
| *"hip hop"* | `artist.genres contains "hip hop"` |
| *"longer than 6 minutes"* | `track.durationMs gt 360000` |
| *"older than 20 years"* | `album.ageYears gt 20` |
| *"released before 2000"* | `album.releaseDate lt "2000-01-01"` |
| *"a single or an EP"* | `album.type in ["single", "compilation"]` |
| *"explicit"* | `track.explicit eq true` |
| *"an artist I follow"* | `artist.following eq true` |
| *"I've skipped this before"* | `history.skipsOfTrack gt 0` |
| *"I've never heard this"* | ⚠️ `history.playsOfTrack is-unknown` — a first play reads **unknown**, not `0` |

### What a generator must not do

- **Invent a field, operator or enum value.** All three are closed sets.
- **Substitute `0` for missing data.** `history.playsOfTrack eq 0` does not mean "never played":
  a never-played track reads `unknown`, so that comparison is `unknown`, not `true`.
- **Use `not` to handle absence.** `not(unknown)` is `unknown`. Only `is-unknown` is decisive.
- **Emit `"value": null`** for `is-unknown`. Omit the key entirely.
- **Emit an empty `operands` array.** Structurally refused — it rejects the whole file.
- **Reuse an `id`.** A duplicate rejects the whole file, so a generator appending to an existing
  set must read the existing ids first.
- **Assume `action` can be anything but `"skip"`.**

### ⚠️ Generated rules must be validated before they are written

A structurally valid rule can still load disabled, and **nothing about the JSON tells you
which**. Any generator writing to `config/rules.json` should run `validateRuleSet` over the
result and surface `status.state === 'disabled'` with its reason, rather than writing and hoping.

The consequences are asymmetric, which is what makes this worth enforcing rather than
recommending:

- a **semantic** mistake disables one rule — recoverable, and visible in the rules panel;
- a **structural** mistake rejects the **entire file**, so one malformed generated rule silently
  disarms every rule the user wrote by hand.

⚠️ The second case is the one to design against. Validate the *whole set* after insertion, not
just the new rule, and refuse to write when the set would be rejected.

### Notes for the unit that builds this

- `allFields()` in `fieldCatalogue.ts` is the machine-readable catalogue — name, type,
  availability, enum values and per-field notes. **No endpoint exposes it today**; one would be
  the natural way to give a generator its vocabulary without hard-coding a copy that drifts.
- `label.classification` carries a note recording that it was tested against this listener's own
  skips and showed no detectable effect. A generator offering it as a suggestion should not
  imply it predicts anything.
- Back-testing already exists (`POST /api/backtest`) and is the obvious way to show someone what
  a freshly generated rule *would have done* before they enable it.

---

## 10. Where this is enforced

| Concern | Source |
|---|---|
| Grammar, limits, disabled reasons | `src/rules/ruleValidator.ts` |
| Fields, types, permitted operators | `src/rules/fieldCatalogue.ts` |
| Kleene logic, folding, word boundaries | `src/rules/predicate.ts` |
| `onUnknown`, the cross-rule fold | `src/rules/RuleEngine.ts` |

A machine-checkable schema for the structural phase lives beside this file at
[`rules.schema.json`](./rules.schema.json). ⚠️ **It covers phase one only** — it cannot know the
field catalogue, the operator matrix or the depth limit, so a document it accepts can still load
with rules disabled. `scripts/check-rules-schema.mjs` cross-checks it against the real validator.

---

## Appendix A — the file wrapper

Incidental to the language, and recorded only so a file can be assembled correctly.

```ebnf
rule-set        = rule-array | object-with-rules ;

rule-array      = "[" , [ rule , { "," , rule } ] , "]" ;

object-with-rules
                = "{" , ... , '"rules"' , ":" , rule-array , ... , "}" ;
                (* Any other member is IGNORED. *)
```

Both forms are accepted. The conventional one is:

```json
{ "version": 1, "rules": [] }
```

⚠️ **`version` is decorative — nothing reads it.** Any unrecognised top-level member is ignored,
which also means a `$schema` key is safe to add for editor support. Do not use `version` to gate
behaviour; it will have no effect.
