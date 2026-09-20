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

---

## Out of scope for U4 — recorded so it is not re-litigated

| | Why |
|---|---|
| `SkipExecutor`, `PlaybackController`, `SafetyGovernor` | U5. `src/playback/` must not exist at the end of U4 |
| `onUnknown: 'hold'` | **FR-33 stays PARTIAL.** Needs a deadline and a re-evaluation trigger; a rule declaring it is stored and disabled with a reason |
| Kill switch (FR-38), rate limit (FR-39), no-repeat-skip (FR-40) | U5 — they govern actions, and U4 has none |
| Rule **editing** in the UI | Read-only in U4 by Application Design Q2 = A |
| W-3 session-end discriminator | Backlog; would change the outcome variable that back-testing compares against |
