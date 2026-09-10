# NFR Design Plan — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — NFR Design, Unit U3
**Functional design**: [`../u3-rule-model/functional-design/`](../u3-rule-model/functional-design/) (approved 2026-09-10)
**NFRs in scope**: NFR-25 (property tests), NFR-26 (deterministic, side-effect free), NFR-27 (round-trip)

Numbering continues from U2: patterns at **P-10**, logical components at **LC-7**, property
obligations at **PBT-11**.

---

## What is already settled, and will not be asked

The AI-DLC stage directive says to evaluate every NFR category. Several are already answered by
this codebase's existing conventions, and asking again would be noise:

| Settled | By |
|---|---|
| Property-testing library and configuration | `fast-check` 4.9, `test/fc-config.ts` — `FC_SEED` for replay, shrinking on (PBT-08) |
| Generator organisation | `test/generators.ts`, `historyGenerators.ts`, `labelGenerators.ts` — U3 adds `ruleGenerators.ts` |
| Purity enforcement | `test/purity.test.ts` — static import check over a `PURE_MODULES` list |
| Untested-module detection | `test/noOrphanModules.test.ts` — fails on any module nothing executes |
| Seed reproducibility | PBT-08, unchanged |

**U3 extends these; it does not redesign them.** The five new pure modules are added to
`PURE_MODULES` in the same commit that creates them — a pure module that nothing checks for purity
is the coverage blind spot of 2026-09-06 in a new place.

---

## Categories evaluated and found not applicable

Justified explicitly rather than skipped silently, as the stage requires.

| Category | Applicability | Why |
|---|---|---|
| **Scalability** | ❌ None | Single user, single process. The rule set is a handful of rules; `TrackFacts` is one track. There is no load axis |
| **Availability / HA** | ❌ None | U3 is a function call inside an already-running process. It has no uptime of its own |
| **Concurrency** | ❌ None | Evaluation is synchronous and stateless. `RuleStore` is the only mutable state and is written by one watcher |
| **Caching** | ❌ None | Evaluation is cheaper than a cache lookup. Memoising a pure function of a track that plays once is negative value |
| **Circuit breakers / retry** | ❌ None | No network, no upstream. The one retry story in the project belongs to MusicBrainz (U2) |
| **Observability** | ⚠️ Deferred | `Decision.outcomes` carries the complete record by design (BR-19.4). Rendering it is **U4** |
| **Security** | ⚠️ Narrow | FR-44 is satisfied *structurally* — a predicate is data, so there is nothing to `eval`. The residual surface is resource exhaustion from a hostile or accidental rules file → **Q1, Q5** |
| **Resilience** | ✅ Applies | Not upstream failure, but malformed input, partial writes and degraded facts → **Q1, Q3, Q4** |
| **Performance** | ✅ Narrow | Evaluation itself is trivial. Assembling the facts is not → **Q5** |

---

## Plan

- [x] Decide recursion strategy and depth bound for predicate evaluation (Q1)
- [x] Decide where rule state lives and its durability class (Q2)
- [x] Decide file-watch semantics: partial writes and debounce (Q3)
- [x] Decide the degraded-facts seam — who sets `partialData`, and does U3 offer re-evaluation (Q4)
- [x] Decide the fact-assembly budget on the track-start path (Q5)
- [x] Write `nfr-design-patterns.md` — P-10 onward
- [x] Write `logical-components.md` — LC-7 onward
- [x] Enumerate PBT-11 onward, mapped to NFR-25/26/27 and the U3 exit criteria

---

## Questions

### Question 1 — "Never throws" has a hole, and it is the stack

**BR-21.1 says every pure function is total: any input returns a value and never throws.** A
predicate is a tree and the natural evaluator is recursive. A sufficiently deep tree overflows the
stack — which *is* a throw, from a function documented as unable to throw.

This is reachable without malice: a generated rule, a hand-edited file, a UI that nests on every
edit. And a property test with a tree generator will find it, so the choice is whether it is
handled or discovered.

A) **Bound depth at validation.** A tree deeper than *N* fails validation and the rule is
   disabled with a reason (reusing BR-18.5's machinery). The evaluator stays recursive and simple,
   and the bound is a documented constant. Suggested *N* = **32** — far beyond any hand-written
   rule, far below any stack limit

B) **Make the evaluator iterative** with an explicit stack. No bound needed, no rule ever refused,
   but the clearest code in the unit becomes the least clear, and the tri-state fold is harder to
   read against the truth tables

C) **Both** — iterative evaluator *and* a validation bound, belt and braces

D) **Neither** — accept it. A local single-user app whose rules the user wrote themselves is not
   an adversarial setting

**[Answer]:**
A
---

### Question 2 — Where do rules live, and what durability class are they?

`RuleStore` reads a JSON file. Two candidate homes, and they carry very different warnings:

| Location | Character |
|---|---|
| `data/rules.json` | Already bind-mounted into the container and gitignored. **But `data/` holds `history.db` — the one artefact here that cannot be regenerated**, and the project's standing warning is that being gitignored makes it *more* exposed to `git clean -xdf`, not less |
| `config/rules.json` | A new directory, needs its own mount, separate from the irreplaceable data |

Rules are user-authored text: losing them costs retyping, not months of listening. But they are
also the thing a user will hand-edit most often, and a hand-edit next to `history.db` is a hand-edit
next to the database.

A) **`data/rules.json`** — one mount, already working, consistent with everything else the app
   writes. Accept that the user edits a file in the same directory as the database

B) **`config/rules.json`** — a second mount, separating *user-authored input* from *irreplaceable
   output*. More deployment surface; clearer blast radius

C) `data/rules/rules.json` — inside the existing mount but in its own subdirectory, so a careless
   glob or editor backup file lands away from `history.db`

D) Somewhere else you would rather name

⚠️ The concrete path and mount are **Infrastructure Design**'s to finalise. What is being decided
here is the *durability class*: is rule state co-located with the irreplaceable artefact, or
deliberately separated from it?

**[Answer]:**
B
---

### Question 3 — What does the watcher do with a half-written file?

`RuleStore.watch()` fires on file change. A text editor saving a file is frequently **not**
atomic — the watcher can read it mid-write and see truncated JSON. Under Q10 = B that is a
structural failure, so the last-known-good set is kept and an error is surfaced.

The failure mode: the user saves once, the watcher reads a partial file, logs an error, and the
**completed** write may not fire a second event. The user sees an error, their file is now valid on
disk, and the app is still running the old rules — and the error message says the file is
malformed, which is no longer true.

A) **Debounce, then re-read.** Wait ~250 ms after the last change event before reading; on a parse
   failure, retry once after a further short delay before declaring the file bad. Cheap, and
   removes the common case entirely

B) **Debounce only** — no retry. Simpler; still loses the race if the editor's write is slower
   than the debounce

C) **Re-read on any subsequent event, no debounce** — relies on the editor emitting a final event,
   which not all do

D) **No watching at all in U3.** `load()` on startup only; live reload arrives with the UI in U4,
   where there is something to trigger it explicitly

**[Answer]:**
D
---

### Question 4 — Who decides that the facts were incomplete?

`Decision.partialData` exists (FR-35) but nothing in U3 can set it: the engine cannot know whether
enrichment was still in flight. **R11 makes this the common case, not the edge** — a label lookup is
two MusicBrainz calls behind a 1 req/sec queue, so at track start `label.classification` will
usually be `unknown` for reasons that have nothing to do with the track.

Q9 = B already moved `hold` to U5, so waiting is not U3's. What remains is how honestly U3 reports
what it was working with.

A) **`partialData` is an input to `foldDecisions`, supplied by the caller**, who knows what it was
   still waiting for. U3 records it and never infers it. The engine also exposes no re-evaluation
   entry point — re-evaluating is just calling the same pure function again with better facts,
   which is U5's business

B) As A, but U3 additionally reports **which catalogue fields read `unknown`** on this evaluation,
   so the caller can decide whether waiting would help. Slightly more surface, considerably more
   useful to U4's "why did this happen" view

C) U3 infers `partialData` from `often-unknown` fields reading `unknown` — convenient, and wrong:
   it cannot distinguish "not yet resolved" from "resolved, and the answer is nothing", which is
   the distinction this project has now been bitten by three times

**[Answer]:**
B
---

### Question 5 — What is the budget for assembling the facts?

Evaluation is microseconds of in-memory work over a handful of rules. **Assembly is where the cost
is**: `history.playsOfTrack`, `skipsOfTrack`, `playsOfArtist` and `skipsOfArtist` are SQLite
aggregates, needed on every track start.

The indexes exist (`idx_play_track` from v1, `idx_play_artist_id` from v2), so the queries are
cheap — but they are on the poll path, and the poll path is what records plays.

A) **Assemble lazily, per field, only when a rule actually reads it.** `FieldDefinition.read` is
   already the seam. A rule set that mentions no history field costs no queries at all — and at
   U3 there are no rules, so the cost is genuinely zero until someone writes one

B) **Assemble eagerly, one combined query per track start.** Simpler and predictable; pays for
   four aggregates whether or not any rule wants them

C) Eager, but cached for the duration of the play — a track's history counts do not change while
   it plays

⚠️ Whichever is chosen, **assembly must not be able to fail the recording path.** A rules engine
that throws while counting plays must not cost a play record — the same containment that already
keeps label enrichment from affecting history (`#safely` in `PlayObserver`).

**[Answer]:**
C
---

## After the answers

Ambiguities get follow-ups. Then `nfr-design-patterns.md` (P-10 onward) and
`logical-components.md` (LC-7 onward), with every property obligation numbered PBT-11 onward and
mapped to the U3 exit criteria so `build-and-test` has something to check against.
