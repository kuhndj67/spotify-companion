# Domain Entities — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — Functional Design, U3
**Source**: [`../../plans/u3-functional-design-plan.md`](../../plans/u3-functional-design-plan.md)
(Q1–Q11 and FQ1–FQ3, answered 2026-09-10)

Technology-agnostic. Types are written in TypeScript notation because that is the project's
language, but nothing here implies a runtime, a store or a transport.

---

## The settled shape, in one place

| Decision | Answer |
|---|---|
| Three-valued logic | **Kleene (strong)** — Q1 = A |
| Missing-field test | **`is-unknown`**; `exists` **removed from the operator set** — Q2 = B, FQ1 = A |
| Field catalogue carries evidential standing | **`FieldDefinition.note`** — Q3 = A |
| String comparison | **Case-insensitive and punctuation-folded** — Q4 = D |
| `context.type` | **Not a catalogue field** — Q5 = A |
| Partial dates | **`unknown` for ordering comparisons** — Q6 = A |
| Rule referencing a vanished field | **Disabled with a reason, never deleted** — Q7 = A |
| Genres | **String field, matched per element on word boundaries** — Q8 = B, FQ2 = A |
| `onUnknown: 'hold'` | **Stored, rule disabled with a reason; behaviour is U5's** — Q9 = B, FQ3 = C |
| Invalid rule file | **Last-known-good on reload; no rules on cold start** — Q10 = B |
| Rule order | **Presentation and reporting only** — Q11 = A |

---

## 1. `Verdict` — the three-valued result

```ts
type Verdict = 'true' | 'false' | 'unknown';
```

A string union rather than `boolean | null`, deliberately. `null` in a boolean position is the
exact shape that invites `if (v)` and collapses `unknown` to `false` — the failure NFR-25 exists to
prevent. A union has no falsy member, so the collapse cannot be written by accident.

---

## 2. `Maybe<T>` — a field value that may be absent

```ts
type Maybe<T> = T | null;
```

Project-wide convention, unchanged: `null` means **unknown** and is never `false` or `0`.
`TrackFacts` history counts are `Maybe<number>` precisely so that "never seen" is distinguishable
from "seen zero times".

---

## 3. `TrackFacts` — everything a rule may read

```ts
interface TrackFacts {
  track:   { id: string; title: string; durationMs: number;
             explicit: Maybe<boolean>; isrc: Maybe<string> };
  artist:  { id: Maybe<string>; name: string;
             following: Maybe<boolean>; genres: Maybe<readonly string[]> };
  album:   { name: string; releaseDate: Maybe<string>;
             ageYears: Maybe<number>; type: Maybe<string> };
  label:   { name: Maybe<string>; classification: Maybe<LabelClass>;
             confidence: Maybe<string> };
  liked:   { atStart: Maybe<boolean>; transition: Maybe<LikedTransition> };
  history: { playsOfTrack: Maybe<number>;  skipsOfTrack: Maybe<number>;
             playsOfArtist: Maybe<number>; skipsOfArtist: Maybe<number> };

  /** Evaluation timestamp, passed IN as data. Not a catalogue field, never read by a rule. */
  evaluatedAtMs: number;
}

type LabelClass = 'major' | 'independent' | 'unknown';
type LikedTransition = 'kept-liked' | 'kept-unliked' | 'liked-during' | 'unliked-during' | 'unknown';
```

### `context` is gone from `TrackFacts` (Q5 = A)

`context.type` is NULL on **all 342 live plays** and populated on **all 85 backfilled** ones. A rule
evaluates on the live path, so the field would be `unknown` 100% of the time in production while
back-testing (FR-42) as richly populated. A field that back-tests as available and is never
available live is worse than an absent one.

⚠️ `context.deviceName` is excluded **for a different reason**: its live availability has never
been probed. This project does not add fields on the assumption that an upstream returns them —
that assumption has been wrong four times. If it is wanted, probe first.

### `evaluatedAtMs` is data, not a clock

The engine never calls `Date.now()`. The caller supplies the instant. This is what makes FR-20
recomputation and FR-42 back-testing reproduce live decisions exactly (NFR-26), and it is the same
discipline that keeps `outcomeClassifier` pure.

### `genres` is a list in the facts and a string in the catalogue

`Maybe<readonly string[]>` — three distinguishable states, and the distinction is load-bearing:

| Facts value | Meaning | Corpus |
|---|---|---|
| `null` | MusicBrainz has not been asked, or the artist is uncatalogued | 39 plays |
| `[]` | MusicBrainz **was** asked and lists no genres | 131 plays |
| `['hip hop', …]` | Genres known | 258 plays |

**Collapsing `[]` into `null` would repeat the 2026-09-06 `unknown`-merge defect.** "We have not
asked" and "we asked and there are none" are two facts.

---

## 4. `FieldType`, `Operator` and `FieldDefinition`

```ts
type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum';

type Operator =
  | 'eq' | 'neq'
  | 'lt' | 'lte' | 'gt' | 'gte'
  | 'in'
  | 'contains'
  | 'is-unknown';
```

> ### `exists` has been removed from the operator set (FQ1 = A)
>
> With tri-state semantics it had only two reachable results — `true` for a present field and
> `unknown` for a missing one — so it could **never return `false`**, and `not(exists(f))`
> evaluated to `not(unknown)` = `unknown`, which is exactly the question it was meant to answer.
> `is-unknown` returns a clean `true`/`false` and `not(is-unknown(f))` is the other direction.
> One obvious way to write each.

```ts
type Availability = 'always' | 'usually' | 'often-unknown';

interface FieldDefinition {
  name: string;                       // "label.classification"
  type: FieldType;
  description: string;
  enumValues?: readonly string[];
  availability: Availability;         // FR-28 — about PRESENCE
  note?: string;                      // Q3 = A — about STANDING
  multiValued?: boolean;              // true only for artist.genres (FQ2 = A)
  read(facts: TrackFacts): Maybe<unknown>;
}
```

### `availability` and `note` answer different questions

`availability` says **how often the field is there**. `note` says **what the field is worth, and
what it is not**. Two fields carry a `note` at U3, and both exist because the project measured
something a rule author could not otherwise know:

| Field | `note` |
|---|---|
| `label.classification` | *"Tested 2026-09-10 against this listener's own skips — no detectable effect (p = 0.888, 95% CI [−7.7%, +8.9%]). Legitimate as a preference; not evidence-backed as a predictor."* |
| `history.playsOfArtist` `history.skipsOfArtist` | *"Counts the PRIMARY artist only. A featured credit is filed under the lead artist — measured ~24% low for an artist who guests often."* |

`note` is static text on a static structure. It is data, not I/O, so the module stays pure.

---

## 5. `Predicate` — the structured tree (FR-43, FR-44)

```ts
type Predicate =
  | { kind: 'compare'; field: string; op: Operator; value?: unknown }
  | { kind: 'and'; operands: readonly Predicate[] }
  | { kind: 'or';  operands: readonly Predicate[] }
  | { kind: 'not'; operand: Predicate };
```

`value` is optional because `is-unknown` takes none. Every other operator requires one, and the
validator enforces it.

**There is no expression string anywhere in this type.** FR-44 is satisfied structurally rather
than by discipline: there is nothing to `eval`, because a predicate is never text.

---

## 6. `Rule`, and the two independent ways a rule can be off

```ts
type RuleAction = 'skip';                        // enum, not boolean (FR-26). One member at U3
type OnUnknown  = 'no-match' | 'match' | 'hold';

interface Rule {
  id: string;
  name: string;
  enabled: boolean;                              // the USER's switch (FR-25, FR-31)
  action: RuleAction;
  onUnknown: OnUnknown;                          // default 'no-match' (FR-33)
  predicate: Predicate;
}

interface LoadedRule {
  rule: Rule;
  status: RuleStatus;                            // the SYSTEM's determination
}

type RuleStatus =
  | { state: 'active' }
  | { state: 'disabled'; reason: DisabledReason; detail: string };

type DisabledReason =
  | 'unknown-field'            // Q7 = A — the field no longer exists
  | 'type-mismatch'            // operator not valid for the field's type
  | 'too-deep'                 // NFR Q1 = A — tree exceeds MAX_PREDICATE_DEPTH (32)
  | 'unsupported-on-unknown';  // FQ3 = C — onUnknown: 'hold', deferred to U5
```

> ### `enabled` and `status` are two facts and must never be merged
>
> `enabled: false` is **the user chose to turn this off**. `status.state === 'disabled'` is **the
> system cannot evaluate this**. Merging them loses the reason, and a rule silently switched off by
> the system while the UI shows the user's own toggle is the "empty state that does not explain
> itself" failure with real consequences at U5.
>
> A rule is evaluated only when `enabled === true && status.state === 'active'`.

### Why `'hold'` is stored rather than rejected (FQ3 = C)

`onUnknown: 'hold'` is valid input. U3 has no clock and no queue, so it cannot implement waiting —
that is U5's. Rather than making it unwritable, a rule declaring it **loads, is inert, and says
why**, reusing exactly the machinery Q7 = A introduced for vanished fields. When U5 arrives, the
rules already written begin working; nothing has to be re-authored.

---

## 7. `RuleOutcome` and `Decision`

```ts
interface RuleOutcome {
  ruleId: string;
  verdict: Verdict;                       // the raw predicate result
  applied: Verdict;                       // after the onUnknown mapping
  restedOnUnknown: boolean;               // verdict === 'unknown' — see below
  fieldsSeen: Readonly<Record<string, unknown>>;
}

interface Decision {
  action: RuleAction | 'none';
  matchedRuleIds: readonly string[];
  outcomes: readonly RuleOutcome[];       // EVERY evaluated rule, matched or not
  disabledRules: readonly { ruleId: string; reason: DisabledReason; detail: string }[];
  restedOnUnknown: boolean;
  unknownFields: readonly string[];       // NFR Q4 = B — catalogue fields that read `unknown`
  partialData: boolean;                   // FR-35 — SUPPLIED BY THE CALLER, never inferred
}
```

> ### ⚠️ `restedOnUnknown` means the verdict WAS unknown — not that an unknown was seen
>
> Q1 = A chose Kleene semantics **and** Kleene reporting. Option C — Kleene's answers with
> Bochvar's flagging, where any unknown anywhere in the tree raises the flag — was **offered and
> not chosen**.
>
> So `restedOnUnknown` is true exactly when the raw `verdict` is `'unknown'` and the `applied`
> value therefore came from the `onUnknown` mapping rather than from the data. A rule whose
> predicate read one unknown field but still resolved decisively is **not** resting on unknown: the
> data answered it.
>
> This is a one-line difference in implementation and a large one in meaning. It is written down
> because the tempting implementation — accumulating a flag while walking the tree — silently
> produces option C.

`outcomes` holds every evaluated rule, including non-matches. U4's observability needs the complete
record, which is also why Q11 = A rejected first-match-wins.

---

## 8. `FactSources` and assembly

```ts
function assembleFacts(input: FactSources): TrackFacts;
```

`assembleFacts` is pure: it maps already-fetched values into `TrackFacts`. It performs no I/O and
issues no request. Anything absent arrives as `null` and stays `null` — the assembler never
substitutes a default, because a default here is a fabricated fact about the variable under study.

---

## 9. `RuleStore` — the unit's only impure module

```ts
interface RuleStore {
  load(): Promise<ValidationResult<LoadedRule[]>>;
  current(): readonly LoadedRule[];
  // watch(onChange) — DEFERRED TO U4 (NFR Q3 = D)
}
```

Reads `config/rules.json` — its own directory and mount, deliberately **not** `data/`, which holds
the one artefact that cannot be regenerated (NFR Q2 = B, pattern P-15).

Impure only because a JSON file has to be read from somewhere. It performs no evaluation, holds no
logic about verdicts, and can be replaced by an in-memory double in every test of the other five
modules.

> ⚠️ **`watch()` is deferred to U4**, where the UI gives live reload something to trigger it. Two
> consequences: **BR-20.8 (last-known-good on reload) cannot fire in U3** — only cold start exists,
> so only BR-20.7 applies — and the half-written-file race disappears from U3 along with the
> watcher. Both are specified and deferred, not implemented-but-dead. See `nfr-design/logical-components.md` LC-11.

---

## Entity relationships

```
FieldDefinition ──describes──> a path into TrackFacts
       │
       │ validated against
       ▼
   Predicate ──evaluated with──> TrackFacts ──> Verdict
       │                                          │
   contained in                            mapped by onUnknown
       ▼                                          ▼
     Rule ──loaded as──> LoadedRule ──> RuleOutcome ──folded──> Decision
                              │                                     │
                         RuleStatus                            consumed by
                    (active | disabled)                      U4 log, U5 executor
```

**`Decision` is the unit's only output, and nothing in U3 consumes it.** That is the containment
argument: the riskiest logic in the project is proven correct before anything depends on it.
