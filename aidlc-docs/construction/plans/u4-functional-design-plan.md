# Functional Design Plan — U4: Rule Observability

**Date**: 2026-09-19 · **Stage**: CONSTRUCTION — Functional Design, Unit U4
**Unit**: [`../../inception/application-design/unit-of-work.md`](../../inception/application-design/unit-of-work.md) (U4)
**Stories**: US-20, US-23, US-24
**Requirements**: FR-37, FR-41, FR-42
**Inherited debt**: `RuleStore.watch()` and **BR-20.8**, both deferred here by U3 NFR Q3 = D

---

## Unit context

U4 makes U3's decisions **visible and checkable**. It is the unit where the rules engine stops
being inert — not by acting, but by being *invoked*.

> **U4 observes; it still never acts.** The exit criterion is structural: `DecisionExecutor` has
> exactly one implementation, it cannot skip, and **`src/playback/` does not exist** at the end of
> this unit. That is verified by inspecting the import graph, not by a runtime flag.

This is also the unit that **breaks U3's containment on purpose**. U3's guarantee was
*"`git status src/` shows only `src/rules/`"*. U4 necessarily wires the engine into the poll loop,
adds routes, and (probably) adds a table. **After U4 that guarantee is retired and the phase
boundary is carried entirely by the missing `src/playback/`** — a weaker guard than U3's, and one
worth stating plainly before it is crossed rather than discovering later that nobody noticed.

**Done means CI green *and* live verification** — U4 is the first rules unit with a live gate:
*a dry-run session over real listening produces a match log the user agrees with*.

---

## Facts measured from the live corpus for this plan

512 plays at time of writing. Every question below is grounded in the database as it actually is.

### Catalogue field coverage in stored history — what back-testing can actually read

| Catalogue field | `play` column | Non-NULL |
|---|---|---|
| `track.title`, `album.name`, `album.releaseDate`, `track.durationMs` | direct | **100%** |
| `artist.genres` | `artist_genres` | 92% |
| `track.isrc`, `label.classification`, `label.confidence` | direct | 84% |
| `artist.following`, `album.ageYears` | direct | 83% |
| `liked.transition` | `liked_transition` | 77% |
| `liked.atStart` | `liked_at_start` | 74% |
| `label.name` | `label_names` | **50%** |
| **`track.explicit`** | — | ⚠️ **no column exists** |
| **`album.type`** | — | ⚠️ **no column exists** |
| **`history.playsOfTrack`, `history.skipsOfTrack`, `history.playsOfArtist`, `history.skipsOfArtist`** | derived | ⚠️ **time-dependent** |

**Two of the twenty catalogue fields are not stored on a play at all.** They are enrichment-only
and have never been persisted, so a rule over them back-tests as `unknown` on **100%** of history
— not as a coverage gap that improves with time, but permanently, for every row already recorded.

**Four more are counts that change every day.** Ren shows 47 plays today and had 0 at the start of
the corpus. A back-test that reads today's counts is not replaying what a rule would have seen.

### Volume

| | |
|---|---|
| Live listening time recorded | **24.4 hours** |
| Decision-log rows if evaluated **per poll tick** (3 s) | **~29,300** |
| Decision-log rows if evaluated **once per play** | **426** |
| Live plays | 426 |
| Plays with a decidable outcome (`completed`/`skipped`) | **400** |
| Plays with `skip_source = 'rule'` (FR-23 exclusion) | **0** |

⚠️ **The FR-23 exclusion is currently a no-op, and will stay one until U5.** Same shape as W-3: a
guard with nothing to guard against yet. It must still be built and tested now, because the first
row it needs to exclude will appear the moment U5 is armed — and by then the back-test will
already have been trusted.

---

## Plan

- [ ] Settle the evaluation trigger and its cost (Q1, Q3)
- [ ] Settle decision-log storage, shape and retention (Q2, Q4)
- [ ] Settle back-test fact reconstruction — the point-in-time question (Q5, Q6)
- [ ] Settle what agreement means when the outcome variable is itself partial (Q7)
- [ ] Settle dry-run scope and precedence (Q8)
- [ ] Settle `watch()`, debounce and last-known-good, discharging BR-20.8 (Q9)
- [ ] Settle who supplies `partialData` (Q10)
- [ ] Settle the read-only API and UI surface (Q11)
- [ ] Write `business-logic-model.md` — evaluation trigger, log pipeline, back-test algorithm
- [ ] Write `domain-entities.md` — DecisionLogEntry, BackTestReport, DecisionFilter, DateRange
- [ ] Write `business-rules.md` — numbered BRs, continuing from **BR-21**
- [ ] Define the live-verification protocol that discharges the dry-run exit criterion

---

## Questions

### Question 1 — When is a rule evaluated?

U3's engine is a pure function; something must call it. The poll loop ticks every **3 s**.

| | Trigger | Log rows over the corpus so far | Cost |
|---|---|---|---|
| **A** | **Once per play**, at track start | **426** | Label often unresolved at start (R11) |
| **B** | **Every poll tick** | **~29,300** | 69× the rows; most are identical |
| **C** | **At track start, then re-evaluate when enrichment arrives** | ~450–900 | Most faithful; needs a change-detection rule |

⚠️ **R11 makes this sharper than it looks.** Label resolution is 2 MusicBrainz calls behind a
1 req/sec queue, so at track start `label.classification` is frequently *not yet resolved*. Option
A therefore systematically evaluates label rules against `unknown` — and `label.classification`
is the field the whole project was built around. Option C sees the resolved value but decides
*later*, which in U5 may be after the track has already played.

**Note the U5 consequence**: whatever is chosen here becomes the trigger that eventually fires a
real skip. Choosing B now to "get more data" means U5 inherits a 3-second skip loop.

[Answer]:
A - but without enrichment this means the first play of a new track it will not have that data (may not be able to apply a rule)... but on subsequent plays it SHOULD have the enrichment data (collected the first time the track played) to use for the rule correct?
---

### Question 2 — Where does the decision log live?

| | Option | For | Against |
|---|---|---|---|
| **A** | **New SQLite table** in `history.db` (schema **v5**) | Queryable, joins to `play`, one backup story, WAL already proven | Grows the one irreplaceable artefact; needs a migration |
| **B** | **Append-only JSONL** under `data/decisions/` | Cannot corrupt `history.db`; trivially rotatable | No joins; a second retention story; another thing to back up |
| **C** | SQLite table in a **separate** `decisions.db` | Isolates growth; `history.db` untouched | Two databases, two connections, no cross-database join to `play` |

⚠️ **`data/` holds the only artefact in this project that cannot be regenerated.** A decision log
*can* be regenerated — it is derived from rules plus history. That asymmetry argues against
putting it in the same file as the thing that cannot. It also argues the other way: joining a
decision to its play is the single most useful query U4 enables, and B and C both make it manual.

[Answer]:
A - I understand the issue that this data is reconstructable so different from the existing history data - but it is ALSO history. I'm assuming that reconstructing the decisions every time they're used in a query would be computationally expensive so I think a table to cache those decisions is still "history" of the decision made. It does introduce a potential issue if the recorded decision differs from what a reconstruction from rules plus history says it SHOULD be. Something to consider when we start looking at reporting.
---

### Question 3 — Log every evaluation, or only matches?

FR-41 says *"log every evaluation and action"*. US-23 says *"every automated action records the
rule, the field values evaluated, and the verdict"*. These are not the same scope.

| | Option | Rows/play | Answers "why did it fire?" | Answers "why did it NOT fire?" |
|---|---|---|---|---|
| **A** | Every evaluation, matched or not | 1 | ✅ | ✅ |
| **B** | Matches only | ~0.1 | ✅ | ❌ |
| **C** | Every evaluation, but **field values only on match** | 1 | ✅ | partially |

⚠️ **"Why did my rule not fire?" is the question a rule author actually asks**, and B cannot answer
it. U3 already built for A: `Decision.outcomes` carries **every evaluated rule, matched or not**,
and BR-14.7 makes evaluation *exhaustive rather than short-circuiting* specifically so
`fieldsSeen` records what the rule really read. Choosing B would waste that and is the kind of
decision that looks like hygiene and removes the diagnostic.

[Answer]:
A
---

### Question 4 — Decision-log retention

Unlike `play` rows, decision entries are **derivable** — same rules plus same history plus a
deterministic engine (NFR-26) reproduces them.

- **A** — Keep everything, no pruning. Simplest; grows without bound.
- **B** — Rolling window (e.g. 90 days), pruned automatically.
- **C** — Keep everything, provide a **manual** prune the user triggers.
- **D** — Keep matches for ever, prune non-matches on a window.

⚠️ **Whatever is chosen, pruning must never touch `play`.** The interim policy already recorded
for history (§5.1 W-2) is *no automatic pruning*; a background pruner that walks `history.db` is
one wrong `WHERE` clause from the corpus. If pruning is automatic, it argues for Q2 = B or C.

[Answer]:
B - but rather than setting a 90 day window I think setting a reasonable record count makes sense (limit database growth size and also protect query times from unconstrained growth). I don't know what a "reasonable record count" is, we may need to test that by predicting size and db performance (or observe the app running for some period of time)
---

### Question 5 — Back-test facts: point-in-time, or as-of-now? ⚠️ **the critical one**

Four catalogue fields are **counts over history**: `history.playsOfTrack`, `history.skipsOfTrack`,
`history.playsOfArtist`, `history.skipsOfArtist`. Their value depends on *when you ask*.

| | Option | "Would have matched" is… | Determinism |
|---|---|---|---|
| **A** | **Point-in-time** — count only plays *before* this row's `started_at` | what the rule would truly have seen | ✅ stable for ever |
| **B** | **As-of-now** — use today's counts for every historical row | anachronistic: the rule "knew" its own future | ❌ **changes every day** |
| **C** | **Exclude** `history.*` from back-testing; report them `unknown` | honest but blind | ✅ stable |

⚠️ **Option B fails an explicit acceptance criterion of US-24**: *"Given the same rule and the
same history, when I back-test it twice, then the results are identical."* Under B the results are
identical only within a day — the corpus grows, the counts move, and the same back-test returns a
different number next week. **It would pass every unit test** (fixture history does not grow) and
fail only in use, months later, as an unexplained drift. That is this project's recurring shape.

Option A is a window function over `play` ordered by `started_at`; at 512 rows it is free, and it
stays cheap at 10,000.

[Answer]:
A
---

### Question 6 — Fields that history cannot answer at all

`track.explicit` and `album.type` have **no column in `play`** and never have. A rule over them
back-tests as `unknown` for 100% of rows, permanently.

- **A** — Report them `unknown` in the back-test, prominently, and change nothing else.
  (US-24 already requires: *"tracks are reported as unknown rather than silently excluded"*.)
- **B** — Add the two columns now (schema v5) so history **from today forward** can answer them,
  and accept that everything already recorded stays `unknown`.
- **C** — Remove both from the field catalogue, so a rule cannot be written over a field that
  cannot be back-tested.

⚠️ **Do not let a back-test report 0 matches on an unanswerable field and read as "this rule
matches nothing".** That is the `Label detail` empty state again, and the MusicBrainz
`inc=releases` 200: a wrong answer that looks like a finding. Whatever is chosen, the report must
distinguish *"evaluated and did not match"* from *"could not be evaluated"*.

[Answer]:
Question - are these two fields empty because that data is NEVER being reported by the data sources we're using? If so can they be removed? (they are not key data points, explicit is of limited value and album.type I'm not sure what it is supposed to report at all)
---

### Question 7 — What counts as agreement, when the outcome variable is partial?

`BackTestReport` carries `agreedWithUserSkip` and `disagreedWithUserKeep`. Of 512 plays, **400**
have a decidable outcome and **112** are `unknown` (86 backfilled and unobservable, plus the
session-enders of W-3).

- **A** — Compare only `completed`/`skipped`; report the `unknown` count separately as a coverage
  figure. (Mirrors the hypothesis gate's `ELIGIBLE` predicate exactly.)
- **B** — Three-way comparison: agreed / disagreed / undecidable, all first-class in the report.
- **C** — Compare only *live* plays, excluding all 86 backfilled rows regardless of outcome.

⚠️ **Backfilled `unknown` and live `unknown` are two different facts** — the app was not running
versus the app watched and could not classify. The statistics panel already splits them
(`not-observed` vs `inconclusive`) and merging them once produced a 38%-versus-74% error. Whatever
is chosen here should not re-merge them.

[Answer]:
B
---

### Question 8 — Dry-run scope and precedence

US-20 requires dry-run **globally and per rule**. That is two switches over one decision.

- **A** — Global dry-run forces dry-run regardless of per-rule setting (global wins, fail-safe).
- **B** — Per-rule overrides global in both directions (per-rule wins, more expressive).
- **C** — A rule is live **only** if global is live **and** the rule is live (logical AND).

⚠️ In U4 **nothing can act anyway**, so this choice is invisible until U5 — which is exactly why
it should be settled now, while being wrong is free. A and C differ only when a rule tries to opt
*out* of a global dry-run; B allows a single rule to go live while the user believes everything is
held. FR-47 (*automation off by default*) points at C.

[Answer]:
C
---

### Question 9 — `watch()`, debounce, and last-known-good (discharges BR-20.8)

U3 deferred the file watcher here. BR-20.8: *on reload with an invalid file, keep the
last-known-good set in memory.* U3 could only ever reach BR-20.7 (cold start).

Settle three things:

1. **Debounce** — an editor writing a file emits several events. U3's infrastructure design chose
   the `./config` **directory** mount precisely so write-temp-then-rename works. Debounce window?
   (A shape considered at U3: debounce plus one retry.)
2. **In-flight evaluation** — a reload mid-evaluation. Options: finish the current evaluation on
   the old set (atomic swap between evaluations), or abandon it.
3. **Visibility** — a rejected reload leaves the app running rules the file no longer contains.
   How loudly does that surface? ⚠️ **A silent last-known-good is indistinguishable from a
   successful reload**, and the user will believe their edit is live.

[Answer]:
1. Debounce makes sense, do we intend to provide visual feedback when a new rules set goes into effect? (this would avoid the issue of the user thinking new rules were in place when they'd not yet been applied)
2. Atomic evaluation - I don't think there's any value in dealing with the complexity of a mid-evaluation rules change.
3. Same as in 1, a visual indicator of the rules state might be good here. Maybe each rules set gets a version number and that is indicated in the app... with green meaning "applied", yellow meaning "changing", and red meaning "problem"?
---

### Question 10 — Who supplies `partialData`?

`Decision.partialData` is **supplied by the caller, never inferred** (P-17) — because inferring it
from `often-unknown` fields reading `unknown` cannot distinguish *"not yet resolved"* from
*"resolved, and the answer is nothing"*. U4 builds the first caller, so U4 must answer it.

- **A** — The caller sets it when a label/genre resolution for this track is **still queued**
  (a real, knowable state — the resolver has a work queue).
- **B** — The caller sets it whenever the play is younger than the enrichment latency budget.
- **C** — Always `false` in U4, since nothing acts on it until U5.

⚠️ C is tempting and is the option that quietly defers a distinction this project has been caught
by three times. If it is chosen, it should be chosen **explicitly and recorded**, not defaulted.

[Answer]:
C
---

### Question 11 — The read-only surface

The unit definition says: *"`server` gains read-only rule and decision-log endpoints; the UI
displays rules read-only (Q2 = A from Application Design)."*

1. Endpoints — proposed: `GET /api/rules` (loaded rules + status + disabled reasons),
   `GET /api/decisions` (filterable log), `POST /api/backtest` (read-only despite the verb; it
   writes nothing). Any to add or drop?
2. Does the **UI** get a decision-log view in U4, or only the rules list? (The live-verification
   criterion — *"a dry-run session produces a match log the user agrees with"* — needs the log to
   be readable *somehow*; an endpoint plus `curl` would technically satisfy it.)
3. Back-test invocation: UI, endpoint, or a script like `hypothesis-gate.mjs`?

⚠️ Routes go in **`api.ts`, not `server.ts`**, and take collaborators by injection including
`now` — `server.ts` keeps wiring, startup and the `upgrade` handler, and `localGuard.test.ts` pins
that structurally.

[Answer]:
1. nothing to add/drop
2. would a decision log view in U4 help with any debug/diagnostics needed here? If yes then include it, if no then defer to U5
3. Please provide more information on this item... use of the back-test invocation, cost/benefit of the three options?
---

## Out of scope for U4 — recorded so it is not re-litigated

| | Why |
|---|---|
| `SkipExecutor`, `PlaybackController`, `SafetyGovernor` | U5. `src/playback/` must not exist at the end of U4 |
| `onUnknown: 'hold'` | **FR-33 stays PARTIAL.** Needs a deadline and a re-evaluation trigger; a rule declaring it is stored and disabled with a reason |
| Kill switch (FR-38), rate limit (FR-39), no-repeat-skip (FR-40) | U5 — they govern actions, and U4 has none |
| Rule **editing** in the UI | Read-only in U4 by Application Design Q2 = A |
| W-3 session-end discriminator | Backlog; would change the outcome variable that back-testing compares against |

---

## Answers received 2026-09-19

Q1 **A** · Q2 **A** · Q3 **A** · Q4 **B** (record count, not days) · Q5 **A** · Q6 *question* ·
Q7 **B** · Q8 **C** · Q9 **atomic swap + version indicator** · Q10 **C** · Q11 *2 questions*

Three answers asked questions back, and **two of them I could only answer by probing.** Both
probes changed the answer from what the plan assumed. One further pair (Q1 + Q10) interacts in a
way neither question could show alone.

### Accepted without a follow-up

**Q2's caveat is right and becomes a business rule.** The concern — *"a potential issue if the
recorded decision differs from what a reconstruction from rules plus history says it SHOULD be"* —
is real and is why `RULE_ENGINE_VERSION` already exists. Each decision row will store the engine
version **and a hash of the rule it evaluated**, so a divergence between a stored decision and a
recomputed one is **detectable and attributable** rather than a surprise during reporting. Without
the hash, an edited-but-same-id rule makes old decisions silently unreproducible. Recorded as an
obligation for `business-rules.md`; no decision needed.

---

### FQ1 — Q1=A: your assumption holds for repeat plays and fails for first plays. Measured.

> *"on subsequent plays it SHOULD have the enrichment data (collected the first time the track
> played) to use for the rule correct?"*

**Correct, and it is stronger than "should" — it is 94.9%.** Every live play was joined to the
label resolution it actually used, and the resolution's timestamp compared to the play's start:

| | Resolution already existed before the track started |
|---|---|
| **Repeat play (2nd+)** | **56 of 59 — 94.9%** |
| **First play of a track** | **2 of 382 — 0.5%** |

The lookup is `LabelCache.getRelease(isrc)`, a **synchronous SQLite read** — no network, no queue.
So on a repeat play the value is there at track start, exactly as you supposed.

WARNING: **first plays are 86.6% of all live plays** (382 distinct tracks across 441 plays; only
13.4% are repeats). Under Q1=A, a rule over `label.classification` would therefore evaluate
against a not-yet-resolved label on roughly **seven plays in eight** — for the field the project
was built around.

> WARNING: **A number in the first draft of this analysis was wrong, and the way it was wrong is
> the house pattern.** The probe showed resolutions completing a median of **0.2 s** after track
> start, which would have made Q1=A look nearly free. Checking the code rather than trusting the
> number showed `resolvedAt` is stamped **before** the two MusicBrainz calls, at the start of
> `resolveRelease` — it records when resolution was *initiated*, not when it finished.
> **The true availability latency is recorded nowhere.** R11's floor (2 calls behind a 1 req/sec
> queue, with measured 503 retries) is all we have, and it is seconds, not milliseconds.

This does not overturn Q1=A — one decision per play remains the right shape, and B's 3-second skip
loop is still the wrong thing to hand U5. It questions only **when within the play** that one
decision is taken:

- **A** — At track start, as answered. Simple; label reads unresolved on ~87% of plays.
- **A-prime** — **One decision per play, taken at the first tick where enrichment has landed**,
  with a short cap (e.g. 10 s) after which it evaluates with whatever is present. Still exactly
  one decision per play and one log row; still no 3-second loop. Costs a little state per play.
- **A-double-prime** — At track start, and **re-evaluate once** if enrichment arrives later
  (at most 2 rows/play).

WARNING: Under A-prime or A-double-prime, U5 would skip a few seconds into a track rather than at
its start. Under **A**, U5 would skip promptly but would rarely know the label. **That trade
cannot be avoided by implementation; it is R11 surfacing at the decision point.**

[Answer]:

---

### FQ2 — Q6: no, the data is not missing from the source. We fetch it and throw it away.

> *"are these two fields empty because that data is NEVER being reported by the data sources?"*

**No.** Both come back from `GET /tracks/{id}` — the call the app **already makes for every
enriched track** — and both already flow into `TrackFacts`:

    src/spotify/enrichment.ts:293   result.albumType = track.album?.album_type ?? null;
    src/spotify/enrichment.ts:296   result.explicit  = track.explicit ?? null;

They are live and correct *right now*; they are simply never written to the `play` table. So the
choice is not "recover unavailable data" but **"stop discarding data we already pay for."**
Persisting them costs **one migration and zero API requests**.

On `album.type`: Spotify's `album_type` is `album`, `single` or `compilation`. It is a plausible
rule input for this project specifically — *"skip singles"* is a coarse proxy for promoted
placements, and promoted tracks are disproportionately singles. That is a hypothesis, not a
finding, and R1's fate is a caution against assuming it.

- **B** — Add both columns (schema **v5**). History before today stays `unknown`; everything from
  today forward is answerable, at no request cost. *(Recommended.)*
- **C** — Remove both from the catalogue, as you suggested. Defensible for `explicit`; it also
  permanently forecloses `album.type` as a rule input.
- **B-prime** — Persist `album.type` only, drop `track.explicit` from the catalogue.

WARNING: Whichever is chosen, the back-test report must still distinguish *"evaluated, did not
match"* from *"could not be evaluated"* — the pre-v5 rows stay unanswerable for ever.

[Answer]:

---

### FQ3 — Q10=C costs more under Q1=A than the question could show

Q10=C sets `partialData` permanently `false`. Read alone that is nearly harmless — nothing acts on
it until U5. Read **with Q1=A and FQ1's measurement**, it stops being harmless:

Under Q1=A, `label.classification` reads unknown on ~87% of plays, and that unknown has **two
completely different causes**:

| Cause | Frequency | Meaning |
|---|---|---|
| Not yet resolved — the queue has not got there | the common case at track start | **transient**; the answer is coming |
| Resolved, and MusicBrainz has no label | 153 of 382 first plays carry verdict `unknown` | **permanent**; R2's actual measure |

With `partialData` always `false`, the decision log **cannot tell these apart** — and this is the
exact distinction that has caught this project three times (`error` vs `unknown` in U2, all three
defects; the `inc=releases` 200; the coverage denominator). It is also the distinction the
back-test needs to avoid reporting "no match" for a rule that was merely asked too early.

The cost of A is small: the resolver **already has a work queue**, so "is this track's resolution
still pending?" is a real, knowable state, not an inference.

- **A** — Caller sets `partialData` when a resolution for this track is still queued.
  *(Recommended.)*
- **C** — As answered: always `false`, recorded as a deliberate deferral to U5.

WARNING: If C stands, it should stand **because you want U4 kept small**, which is a good reason —
not because `partialData` looked unused. It is the field that makes an 87%-unknown log
interpretable.

[Answer]:

---

### FQ4 — Q4: a record cap needs a number; here is the measurement to set one

> *"I don't know what a 'reasonable record count' is, we may need to test that"*

Measured over the 9 days the app has actually run: **mean 49 plays/day, busiest 102**.

| Rules authored | Rows/day (Q1=A x Q3=A) | Rows/year | Busiest day |
|---|---|---|---|
| 5 | 246 | ~90k | 510 |
| 10 | 491 | ~179k | 1,020 |
| 25 | 1,228 | ~448k | 2,550 |

**There is already a precedent for a high-volume table in this database**: `observation` holds
**27,842 rows**, and `history.db` is **1.91 MB** in total. Decision rows are wider than
observations (they carry `fieldsSeen`), so estimate roughly 300 bytes each — **~50 MB/year at 10
rules**, which is large relative to today's 1.9 MB but not a performance problem for SQLite with
an index on the timestamp.

Proposal, in the spirit of your answer:

- **A** — Cap at **100,000 rows**, pruned oldest-first. About 7 months at 10 rules; ~30 MB.
  Set now, revisited once real rows exist. *(Recommended — a cap that exists beats a cap that is
  perfect.)*
- **B** — Ship U4 **uncapped**, measure real row size for a few weeks, then set the cap from
  observation. Risks the cap never being added.
- **C** — Cap by **bytes** rather than rows, which is what actually matters for growth.

WARNING: **The pruner must be unable to name `play`.** Whatever the cap, prune through a
repository method whose SQL mentions only the decision table — a background pruner that can reach
the corpus is one wrong `WHERE` clause from the one artefact that cannot be regenerated.

[Answer]:

---

### FQ5 — Q9: the version indicator is a good idea; two details to settle

Taking your answer as: **debounce + atomic swap between evaluations + a visible rule-set version
with a state colour.** Agreed on all three — and the version is what makes a silent
last-known-good impossible, which was the hazard in Q9.3.

The version can be derived without changing the rules file format: a **monotonic counter assigned
at load, plus a content hash**. The hash is the same one accepted above for decision rows, so a
decision can be traced to the exact rule text that produced it.

Two details the traffic light raises:

1. **Yellow will almost never be seen.** Debounce is ~300 ms to 1 s; the swap is atomic.
   "Changing" exists for a fraction of a second. Options: (a) drop yellow, keep **green = applied
   vN** and **red = rejected, still running vN**; (b) keep yellow with a minimum display time
   (~1 s) so a reload is *visibly* acknowledged even when instant.
2. **Red must say which version is in force**, not just that something failed — *"v7 rejected:
   rule 'skip majors' has an unknown field `album.kind`. Still running v6."* A red light that does
   not name the running version leaves exactly the ambiguity Q9.3 was about.

WARNING: This adds a UI element to a unit whose UI is otherwise read-only. It is small and it is
the thing that makes BR-20.8 observable, so it earns its place — but it is scope, and it is being
named rather than absorbed.

[Answer]:

---

### FQ6 — Q11.2: yes, include the decision-log view. Recommended, with the reason.

> *"would a decision log view in U4 help with any debug/diagnostics needed here?"*

**Yes, and it is close to required by U4's own exit criterion.** The live gate is *"a dry-run
session over real listening produces a match log **the user agrees with**"*. Agreement is a
judgement you make by reading the log against tracks you remember hearing. Via `curl` that means
reading raw JSON and correlating timestamps by hand — the kind of friction that makes a
verification step get skipped or done shallowly.

The sharper argument is precedent: **the two real defects in `public/app.js` were found by
clicking**, not by tests — the liked-refresh race and the "every axis tick says Aug" bug. U4's
output is a *judgement about your own listening*; it is exactly the kind of thing where looking at
it is the test.

Scope kept small: a read-only table over `GET /api/decisions` — time, track, rule, verdict,
matched or not, and the field values seen — with a filter for matches only. No editing, no charts.

[Answer]:

---

### FQ7 — Q11.3: back-test invocation, as requested

**What it is for.** Two different users of the same machinery: the **Curator** authoring a rule
iteratively (*"would this have been a disaster?"*), run repeatedly over minutes; and the
**Analyst**, rarely, comparing a rule against history. Today it would run over **400 decidable
plays** — small and fast.

| | Option | Cost | Benefit | Risk |
|---|---|---|---|---|
| **A** | **Script**, like `hypothesis-gate.mjs` | Lowest — no route, no UI | Precedent exists; read-only DB access is safe alongside the container | A second surface from where rules are read; the host needs Node and the repo. **Iterating on a rule means editing a file and re-running a command** |
| **B** | **`POST /api/backtest`** | Medium — one route in `api.ts` | Runs in the container where the DB writer already lives; **testable over real HTTP** with injected deps; becomes the substrate the UI uses later | A `POST` that writes nothing needs saying out loud |
| **C** | **Full UI** | Highest | Best for iterative authoring | U4's UI is read-only by design; most of the work lands in the unit with the least certainty |

**Recommendation: B**, with C deferred to U5 where rule editing arrives anyway.

Reasons, in order: it is **testable** — the `api.ts` extraction exists precisely because routes in
`server.ts` had no tests and hid the WebSocket `403`; a script would be another `ALLOWED_ORPHANS`
entry. It avoids a **second process touching `history.db`** — read-only is safe, but "never run
the container and the host at once" is already a standing warning. And it is the **substrate for
C**, so choosing it now is not throwaway.

WARNING: `POST /api/backtest` **writes nothing** — not a decision row, not a play row. The verb is
POST only because a rule predicate is too large for a query string. That must be a business rule,
because "the back-test endpoint started logging its own decisions" is a plausible future change
that would quietly contaminate the log with hypothetical decisions.

[Answer]:

---

## Follow-up resolutions — 2026-09-19, TAKEN BY RECOMMENDATION

The user answered *"ok commit and continue"*. The seven follow-ups were therefore **not
individually answered**, and each is resolved below by the recommendation stated in the question.

> WARNING: **Precedent, and its limit.** U3's Infrastructure Design took FQ1 *"by recommendation,
> not an explicit answer"* and marked it. The same convention applies here — but **two of these
> resolutions modify an answer the user gave explicitly** (Q1 and Q10). Those two are flagged
> below and are the first thing to revisit at approval. A recommendation adopted in silence is
> still a decision someone made, and it should be as easy to reverse as it was to take.

| # | Resolution | Status |
|---|---|---|
| **FQ1** | **A-prime** — one decision per play, taken at the first tick where enrichment has landed, capped at **10 s** | WARNING: **modifies the answered Q1=A** |
| **FQ2** | **B** — persist `explicit` and `album_type` (schema **v5**) | extends Q6 |
| **FQ3** | **A** — `partialData` is set when the enrichment wait timed out | WARNING: **reverses the answered Q10=C** |
| **FQ4** | **A** — cap at **100,000 rows**, pruned oldest-first, revisited once real rows exist | refines Q4=B |
| **FQ5** | **1(b) + 2** — keep yellow with a ~1 s minimum display; red names the version still in force | as proposed by the user |
| **FQ6** | **Yes** — a read-only decision-log view ships in U4 | answers Q11.2 |
| **FQ7** | **B** — `POST /api/backtest`, writing nothing; full UI deferred to U5 | answers Q11.3 |

### Why FQ1 and FQ3 resolve together, and why that lowers the cost of both

Taken separately they look like two reversals. Taken together they are one design:

**A-prime waits for enrichment, so "not yet resolved" largely stops happening.** The label is read
after it has landed, not seven plays in eight before it. What remains is the case where the **10 s
cap fires** — and that is exactly what `partialData` now means:

> `partialData` is `true` when **the enrichment wait timed out** and the decision was taken with
> whatever was present.

That is a single, knowable, caller-supplied fact — it satisfies P-17 (never inferred) without the
resolver needing to expose queue internals, and it is far narrower than the original FQ3 option A.
It also preserves the user's stated Q1 concern (*"the first play of a new track will not have that
data"*) rather than accepting it.

**The trade being accepted**: under A-prime, U5 will skip a few seconds into a track rather than
at its start. That is the R11 trade named in FQ1, chosen in the direction of *knowing the label*
over *skipping instantly* — because a rule that cannot see the field the project was built around
is not a rule worth arming.

WARNING: **If either flag is unwanted, say so at approval and both revert together.** Reverting
FQ1 to a plain track-start evaluation makes FQ3's `partialData` meaningless again, and it should
revert to Q10=C in the same motion. They are one decision wearing two numbers.
