# Domain Entities — U4: Rule Observability

**Date**: 2026-09-19 · **Stage**: CONSTRUCTION — Functional Design, U4
**Continues from**: U3's `Rule`, `Predicate`, `TrackFacts`, `FieldDefinition`, `Decision`

U4 adds no entity to the *rule* model. It adds the entities that make a `Decision` **durable,
attributable and replayable**.

---

## The entity that already exists, and what U4 does to it

`Decision` (U3, `src/rules/types.ts`) is produced per evaluation and consumed by nothing. U4 is
its first consumer. **It is not modified** — U3 built it for this: `outcomes` already carries
*every* evaluated rule, `unknownFields` the union of absent fields, `restedOnUnknown` the raw
verdict, and `partialData` the caller-supplied flag U4 now finally supplies.

> **U4 stores a `Decision`; it never recomputes one.** The engine stays the only thing that
> produces verdicts. If U4 ever derives a verdict of its own, FR-42 back-testing stops replaying
> live behaviour and NFR-26 is unverifiable.

---

## 1. `DecisionLogEntry` — one evaluation, made durable

One row per **rule evaluated**, not per decision. A decision over 10 rules writes 10 rows (Q3 = A);
this is what lets the log answer *"why did my rule **not** fire?"*.

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Surrogate key, autoincrement |
| `evaluationId` | string | **Groups the rows of one decision.** Without it, "what did the engine see at 14:32" is unanswerable |
| `decidedAt` | ISO-8601 string | When the decision was taken — not when the play started |
| `playId` | `Maybe<number>` | FK to `play`. ⚠️ **Nullable and stays nullable** — see below |
| `playLink` | `'pending' \| 'linked' \| 'link-failed'` | ⚠️ **Why `playId` is absent.** Never inferred from the null — see below |
| `trackId` | string | Spotify track id, recorded **even when `playId` is null** |
| `ruleId` | string | The rule as identified in `rules.json` |
| `ruleName` | string | **Denormalised on purpose** — a renamed or deleted rule must not orphan its history |
| `ruleHash` | string | Content hash of the rule's normalised predicate + action + `onUnknown` |
| `verdict` | `'true' \| 'false' \| 'unknown'` | The rule's own verdict, tri-state |
| `matched` | boolean | Whether this rule contributed to the action after `onUnknown` was applied |
| `fieldsSeen` | JSON object | Field name → value actually read, **including nulls** |
| `unknownFields` | JSON array | Fields that read absent on this evaluation |
| `restedOnUnknown` | boolean | Copied from `Decision`, never accumulated |
| `partialData` | boolean | The enrichment wait timed out (FQ3) |
| `dryRun` | boolean | Whether the decision was held. **Always `true` in U4** |
| `executed` | boolean | Whether an action was taken. **Always `false` in U4** |
| `error` | `Maybe<string>` | Execution failure. **Always `null` in U4** |
| `engineVersion` | integer | `RULE_ENGINE_VERSION` at the time |
| `ruleSetVersion` | integer | The loaded rule-set counter (§4). **For the UI. It resets on restart** |
| `ruleSetContentHash` | string | ⚠️ **What actually identifies the set on a durable row** (BR-23.7a) |

### ⚠️ `playId` is nullable, and that is a fact about ordering, not a convenience

A decision is taken **during** a play; the `play` row is written when the play **closes**. Under
FQ1's A-prime the decision comes seconds after track start and the row may not exist for minutes.

Two consequences that must not be "tidied":

1. **`trackId` is recorded independently**, so a decision is attributable even if the play never
   closes cleanly — the app stops, the power goes out. Those are exactly the W-3 cases.
2. **The join is back-filled, not assumed.** The link is completed when the play closes. A decision
   whose play never closed keeps `playId = null` **for ever**, and that is correct: it records that
   the engine decided and the instrument never saw the outcome.

> A `NOT NULL` constraint here would force a decision to wait for its play, which inverts the
> causality the unit exists to observe.

> ### ⚠️ `playLink` exists because a null `playId` would otherwise mean two things
>
> `PlayObserver` fires `onPlayRecorded` **only after `recordPlay` succeeds**. When the write throws
> it increments `#gaps`, sets `#degraded`, and the hook never runs — so the back-fill never happens
> and `playId` stays null for ever, **exactly as if the play had never closed**.
>
> Those two readings point opposite ways. *"The play never closed"* is a W-3 case and expected.
> *"The write failed"* is a fault, on the one artefact that cannot be regenerated. Leaving them on
> one column makes the fault invisible inside an outcome the design already calls correct.
>
> Same family as `error` is not `unknown` — three U2 defects, all of which passed the full suite.

> ### ⚠️ No uniqueness constraint may encode "one decision per play" (BR-22.1a)
>
> Not on `playId`, not on `(playId, ruleId)`, not on `evaluationId` per play. FR-34 is a **Must**
> and requires re-evaluation when slow enrichment lands, so U5 will legitimately write a second
> decision for one play. A constraint added now would have to be **dropped** then — and a
> migration that drops a constraint is non-additive, which retires the by-image rollback
> guarantee that migration 005 currently enjoys.
>
> The U4 invariant is real; it is enforced by the coordinator's `decided` flag and tested there,
> where U5 can change it by changing code rather than by changing the schema.

---

## 2. `BackTestReport` — what a rule would have done

Extends the Application Design shape (`component-methods.md`) with what Q5–Q7 settled.

| Field | Type | Notes |
|---|---|---|
| `ruleId`, `ruleName`, `ruleHash` | string | The rule as tested |
| `range` | `DateRange` | Bounds actually applied |
| `evaluated` | integer | Plays the rule was evaluated against |
| `wouldMatch` | integer | Plays where it matched |
| `wouldNotMatch` | integer | Plays where it decisively did not |
| `undecidable` | integer | ⚠️ Plays where the predicate resolved `unknown` — **distinct from `wouldNotMatch`** |
| `unknownFieldCounts` | map<string, integer> | Per field, how many plays read it absent |
| `unanswerableFields` | string[] | Fields **some row in the range could not answer**, with the count per field (§5) |
| `truncated` | boolean | ⚠️ **Required, never optional or defaulted** — P-24. The 50,000-play cap fired |
| `agreedWithUserSkip` | integer | Rule matched **and** the user skipped |
| `disagreedWithUserKeep` | integer | Rule matched **and** the user completed |
| `missedUserSkip` | integer | Rule did not match **and** the user skipped |
| `notObserved` | integer | Backfilled plays — the app was not running |
| `inconclusive` | integer | Live plays the classifier could not judge |
| `excludedRuleInitiated` | integer | FR-23. **0 until U5** |
| `computedAt` | ISO-8601 | For the report, never for the evaluation |

> ### ⚠️ `truncated` was specified in P-24 and missing from this table
>
> P-24 makes it a **required** field — *"a truncation that does not announce itself is a lie"* —
> and the entity that defines the report did not list it. That is how the `release_count = 100`
> bug happened in the first place: the cap was real, the field that would have disclosed it was
> not written down, and 18 of 56 resolutions recorded an arbitrary sample as a complete count.

### ⚠️ `undecidable` is not `wouldNotMatch`, and `notObserved` is not `inconclusive`

Two separate merges, both of which this project has already made once and paid for:

- Folding `undecidable` into `wouldNotMatch` reports *"your rule matched nothing"* when the truth
  is *"your rule could not be answered"* — the `Label detail` empty state, and the `inc=releases`
  200, in a new place.
- Folding `notObserved` into `inconclusive` is the 2026-09-06 `unknown` merge exactly: it makes
  the **app's downtime** look like the **classifier's uncertainty**. 86 backfilled rows carry no
  trail and never can.

Both distinctions are load-bearing for R2, which is about missing data being correlated with what
is measured.

---

## 3. `DecisionFilter` and `DateRange`

```
DecisionFilter: { from?, to?, ruleId?, trackId?, matchedOnly?, limit, cursor? }
DateRange:      { from: ISO-8601, to: ISO-8601 }   // half-open [from, to)
```

`DateRange` is **half-open** so adjacent ranges partition history without double-counting a play
that sits exactly on a boundary — the same seam that makes SQL week bucketing wrong.

---

## 4. `LoadedRuleSet` — the thing the version indicator names

U3's `RuleStore` returns rules. U4 needs the **set** to be an identifiable thing, because BR-20.8's
last-known-good is only observable if you can say *which* set is running (FQ5).

⚠️ **`RuleSetWatcher` owns this entity; `RuleStore` owns none** *(settled 2026-09-20)*. U3's store
sets `#rules = []` on **every** non-`loaded` outcome — `failed`, `absent` *and* `no-directory` —
so a watcher calling `load()` would violate BR-26.3 the first time a bad file landed. The store
becomes a parser returning a `LoadOutcome`; the watcher holds the set and decides what to keep.
That also removes a trap: two `current()` methods returning different things, with the wrong
wiring evaluating against a wiped set while every indicator read green.

| Field | Type | Notes |
|---|---|---|
| `version` | integer | **Monotonic counter assigned at load.** Starts at 1; increments on each accepted load |
| `contentHash` | string | Hash of the file's normalised content |
| `loadedAt` | ISO-8601 | When this set became active |
| `rules` | `LoadedRule[]` | From U3, carrying per-rule `status` and `DisabledReason` |
| `state` | `'applied' \| 'reloading' \| 'rejected'` | Drives the indicator |
| `rejection` | `Maybe<{ attemptedAt, errors[] }>` | Present only in `rejected` |

> ⚠️ **`version` counts accepted loads, not file writes.** A rejected file does **not** advance it
> — that is the whole point. `v7 rejected, still running v6` is only sayable if 7 was never taken.
> A counter that incremented on attempts would make the running set unnameable at the exact moment
> the user needs to know it.

The version is **not persisted**. It resets to 1 on restart, and `contentHash` is what makes a
decision row attributable across restarts. Persisting the counter would imply a continuity the
file does not have.

---

## 5. Field answerability — a derived classification, not an entity

Back-testing reconstructs `TrackFacts` from a `play` row. Not every catalogue field survives that.

| Class | Fields | Back-test behaviour |
|---|---|---|
| **Directly stored** | `track.title`, `track.durationMs`, `track.isrc`, `artist.name`, `artist.following`, `artist.genres`, `album.name`, `album.releaseDate`, `album.ageYears`, `label.name`, `label.classification`, `label.confidence`, `liked.atStart`, `liked.transition` | Read from the row |
| **Point-in-time derived** | `history.playsOfTrack`, `history.skipsOfTrack`, `history.playsOfArtist`, `history.skipsOfArtist` | Counted over plays **strictly before** this row's `started_at` (Q5 = A) |
| **Stored from v5 forward** *(schema era)* | `track.explicit`, `album.type` | Answerable for rows whose `id` exceeds the **v5 watermark**; `unanswerable` below it (FQ2 = B, BR-27.5c) |
| ⚠️ **A 2026-08 backfill gap** *(cause unestablished)* | `label.name`, `label.classification`, `label.confidence` | `unanswerable` where `isrc IS NULL AND label_unknown_reason IS NULL` — **the row was never asked** (BR-27.5b/5d) |

`unanswerableFields` is computed **per row**, from the row: the intersection of the rule's
referenced fields with the fields *that row* cannot answer — never from "the value came back
null", and never from a single range-wide verdict.

> ### ⚠️ Answerability has TWO eras, and only one of them has a migration
>
> Measured on the live corpus 2026-09-20: **82 of 86** backfilled rows dated 2026-08-20 → 08-31
> carry no ISRC, and on every one of them both `label_verdict` **and** `label_unknown_reason` are
> null — never asked. Every backfilled row from 2026-09-03 onward carries an ISRC (4 of 4), as
> does every live row (457 of 457).
>
> `recently-played` **does** return `external_ids.isrc` — probed live, HTTP 200, 3/3 items — and
> `RecentlyPlayedBackfill` has read it since **U1**. ⚠️ **Why those 82 lack one is unestablished,
> and it is not the code** — one commit on `webApiClient.ts`, no wiring change, live rows with an
> ISRC from row id 51, and a clean break at row id 120 → 155 with no code change in that window.
> **No `ALTER TABLE` marks the boundary and no schema-derived watermark can find it**, which is
> what makes this a per-row question rather than a range-wide one.
>
> On those 82 rows `label.classification` is null because there was never a key to ask MusicBrainz
> with. Reported as an *unknown value* they would be counted as 82 plays that read the field
> absent — which reads as **coverage**, and is the 28%→12%-where-the-truth-was-86%→44% denominator
> bug reappearing inside the back-test.
>
> The discriminator already exists in the data: a row that *was* attempted carries a verdict or a
> reason (`notFound` 151, `noEligibleCandidate` 48). Never-attempted is the **pair** of nulls.
>
> ⚠️ **The general shape**: an era boundary can come from a code change with no migration behind
> it. Anywhere answerability is derived from the schema, ask whether the column was ever populated
> by code that did not always exist.

> ⚠️ **A null and an unanswerable are different, and the report must never infer one from the
> other.** `label.classification` null means MusicBrainz had no label — a *finding*.
> `track.explicit` null on a pre-v5 row means the column did not exist — an *artefact*. This is
> the same shape as the coverage denominator that read 28%→12% where the truth was 86%→44%.

---

## Relationships

```
Rule (U3) ──evaluated over──> TrackFacts (U3) ──produces──> Decision (U3)
                                                                │
                                                     one row per rule
                                                                ▼
play ◄──playId, nullable, back-filled──── DecisionLogEntry ──grouped by──> evaluationId
  │
  └──reconstructed into──> TrackFacts ──replayed──> BackTestReport   (writes nothing)

LoadedRuleSet ──version, contentHash──> stamped on every DecisionLogEntry
```

**`BackTestReport` has no write edge anywhere.** That is the FQ7 rule made structural: it is a
value returned to a caller, never a row.
