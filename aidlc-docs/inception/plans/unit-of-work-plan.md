# Unit of Work Plan

**Date**: 2026-08-25 · **Stage**: INCEPTION — Units Generation, Part 1 (Planning)
**Inputs**: [`../application-design/application-design.md`](../application-design/application-design.md) ·
[`../user-stories/stories.md`](../user-stories/stories.md) · [`execution-plan.md`](execution-plan.md)

---

## Context

A unit of work is a logical grouping of stories for development. This project is a **single
deployable** (Q3 = A, one container), so there is no microservice decomposition to make — units
are **modules within one service**, and the interesting question is where the development
boundaries fall.

The execution plan already defines four delivery phases. The decomposition question is therefore
narrower than usual: **do units simply equal phases, or should they be finer?**

### Settled already — not re-asked

| Category | Status | Where settled |
|---|---|---|
| **Deployment model** | Single container, single deployable. No independently deployable services | Q3 = A (Requirements) |
| **Code organisation** | Flat feature-grouped directories under `src/`, pure domain logic isolated | Q3 = C (Application Design) |
| **Team alignment** | Single developer, who is also the sole user. No ownership boundaries to negotiate, no collaboration model to design | Personas: three modes of one person |
| **Scalability / differing deployment needs** | None. One user, one machine, one process | NFR-01, Development Mode limits |

Re-asking these would be ceremony. They are recorded here so the omission is deliberate and
visible rather than an oversight.

---

## Questions

Three questions. Each changes the decomposition.

### Question 1 — What should unit boundaries follow?

A) **Units = delivery phases.** Four units, matching Phase 1–4 exactly. Simplest possible mapping;
   every unit is a runnable, testable app; unit order is delivery order

B) **Units = capability domains.** History, Export, Labels, Rules, Playback, Safety — grouped by
   what they do rather than when they ship. Cleaner conceptual boundaries; but units then cut
   across phases, and the phase guarantee ("each phase runs") stops being a unit property

C) **Hybrid — units nest inside phases.** Phases remain the runnable checkpoints; units are
   development groupings within them, so a large phase can hold more than one unit

X) Other (please describe after [Answer]: tag below)

[Answer]: C — hybrid. Phases remain the runnable checkpoints; units nest inside them.

---

### Question 2 — Should Phase 3's rules engine be split?

Phase 3 is by far the largest and least-certain body of work: field catalogue, `TrackFacts`,
predicate evaluator, validator, rule store, engine, decision log, executor, and back-testing.
US-14 was already flagged in INVEST validation as the largest story and a splitting candidate.

A) **Split into two units** — *Rule Model & Evaluation* (the pure core: catalogue, facts,
   predicate, validator, engine, store) and *Rule Observability* (decision log, logging executor,
   dry-run, back-testing). The first is heavily property-tested and can be proven correct before
   anything observes it; the second makes it visible and back-testable

B) **Keep Phase 3 as one unit** — the pieces are tightly coupled and splitting creates a unit
   with no user-visible output

C) **Split into three** — also separate the field catalogue and `TrackFacts` assembly, since they
   depend on every enrichment source and are the most likely to churn

X) Other (please describe after [Answer]: tag below)

[Answer]: A — split into two: *Rule Model & Evaluation* (pure core) and *Rule Observability*.

---

### Question 3 — What counts as "done" for a unit?

This project has twice had documentation-derived conclusions proven wrong by a live probe
(follow-status 403, artist genres absent). That history is relevant to how completion is defined.

A) **Live-verified** — typecheck clean, full suite green in CI, *and* verified against a real
   Spotify account with the result recorded. Slowest, and the only definition that would have
   caught the two prior errors

B) **CI green** — typecheck and tests pass, including property tests. Live verification happens
   at phase boundaries rather than per unit

C) **CI green, with live verification required only for units that touch an external service** —
   history and rule evaluation are self-contained and provable by test; MusicBrainz, queue
   lookahead and playback control are not

X) Other (please describe after [Answer]: tag below)

[Answer]: C — CI green for self-contained units; live verification required for units that touch
an external service.

---

## Answer Analysis (Step 7, mandatory)

Three unambiguous single-option selections, all matching the recommendations. No vague qualifiers,
undefined terms, contradictions, or combined options. **Step 8 follow-up round not triggered.**

Consistency cross-check:
- **Q1 = C + Q2 = A** — the hybrid boundary is what *permits* the Phase 3 split; choosing Q2 = A
  under Q1 = A would have been contradictory, since units-equal-phases forbids two units in one
  phase. Consistent, and mutually reinforcing.
- **Q2 = A + Q3 = C** — the split produces U3, a pure unit with no external dependency, which
  Q3 = C correctly gates on CI alone. The split is what makes Q3 = C sharper than it would
  otherwise be: it isolates the provable-by-test work from the must-be-probed work.
- **Q3 = C + execution plan** — phase exit criteria already mandate live verification at phase
  boundaries; Q3 = C adds per-unit gating without weakening that. Consistent.

- **Q1 = C (hybrid).** A is nearly right — the phase boundaries are good boundaries — but it
  forces Phase 3's large, uncertain body of work into a single unit purely because it ships
  together. C keeps the phase guarantee (every phase runs) while letting the largest phase be
  developed in two tractable pieces. B is the wrong trade here: it produces tidy domains and
  loses the property that actually matters, which is that each checkpoint is a working app.
- **Q2 = A (split into two).** The pure rule core can be proven correct by property tests before
  anything consumes it, which is exactly where this project's risk concentrates. C over-splits:
  the field catalogue and `TrackFacts` are small and change together with the predicate evaluator,
  so separating them creates coordination overhead without reducing risk.
- **Q3 = C.** A is the most rigorous but makes self-contained units wait on live sessions for no
  benefit — the outcome classifier is a pure function and a live listening session tells you
  nothing a property test does not. B under-tests exactly the places this project has already
  been burned. C puts the effort where the evidence says it is needed.

---

## Proposed units (subject to the answers above)

| Unit | Phase | Delivers | Stories |
|---|---|---|---|
| **U1** Listening History & Export | 1 | Recording, outcomes, export download | US-10, 11, 12, 25, part of 13 |
| **U2** Label Enrichment | 2 | MusicBrainz labels, classification, backfill | US-08, 09 |
| **U3** Rule Model & Evaluation | 3 | Catalogue, facts, predicate, validator, engine, store | US-14, 15, 16, 17 |
| **U4** Rule Observability | 3 | Decision log, dry-run, back-testing | US-20, 23, 24 |
| **U5** Automated Skipping | 4 | Playback control, safety interlocks, timing | US-18, 19, 21, 22, rest of 13 |
| **U6** User-Data Lifecycle | **5** | Full backup, verified restore, cross-machine migration | ~~none~~ **US-28** *(FD, 2026-10-07)* |
| **U7** Configuration Management | **5** | Rules and credentials in-app | — |
| **U8** Team Workflow & Onboarding | **5** | CI gating, docs, install routine | — |
| **U9** Off-machine Deployment | **5** | The NAS target | — |
| **U0** Existing (reference only) | 0 | Display, enrichment, guard, diagnostics | US-01–07, 26 |

---

## Execution Checklist

Runs after approval.

- [x] Confirm answers; check for consistency and ambiguity (Step 7)
- [x] Generate `application-design/unit-of-work.md` — unit definitions, responsibilities,
      code organisation strategy
- [x] Generate `application-design/unit-of-work-dependency.md` — dependency matrix and
      inter-unit communication
- [x] Generate `application-design/unit-of-work-story-map.md` — story-to-unit mapping
- [x] Verify every in-scope story is assigned to exactly one unit
- [x] Verify no unit depends on a later unit
- [x] Verify each phase's units together deliver a runnable app
- [x] Verify U3 can be built with no playback code path existing
- [x] Update `aidlc-state.md`; log in `audit.md`


---
---

# Phase 5 round — Units Generation re-entered (2026-10-07)

> ⚠️ **Unit numbers were changed during this round (Question 5a = A, 2026-10-07).** Questions 4, 5 and 5a and
> their answers below use the **old** numbers, because they are the record of what was asked. Old → new:
> **U8 Configuration Management → U7** · **U9 Team Workflow & Onboarding → U8** · **U7 Off-machine
> Deployment → U9**. Everything outside those questions uses the new numbers.

**Why**: Phase 5's units were declared ad hoc — U6 and U7 on 2026-10-06 in a non-standard
`phase-5-plan.md`, and **U8** on 2026-10-07 from the U6 Functional Design (T1 = A) — without passing
through this stage. This round brings them in. **Inputs**: the Phase 5 round of
[`../requirements/requirement-verification-questions.md`](../requirements/requirement-verification-questions.md)
(Questions 11–17a) and the U6 FD settled reading
([`../../construction/plans/u6-functional-design-plan.md`](../../construction/plans/u6-functional-design-plan.md) §10).

### Settled already — not re-asked

| | Status | Where settled |
|---|---|---|
| Units nest inside phases (hybrid) | Unchanged | Question 1 = C above |
| **U6 User-Data Lifecycle** | Its scope is settled by its own FD | U6 FD §10 |
| **U7 Configuration Management** (declared as *U8*) split out of U6 | Decided | U6 FD T1 = A |
| **Deployment model** | Still one container — but now **one per user, on that user's machine**; one may live on a NAS | Phase 5 requirements round context |
| **Team alignment** | ⚠️ **Changes**: no longer *"single developer"*. Others may review and contribute; ownership boundaries are still not needed | Phase 5 requirements round |

---

## Questions

### Question 4 — Which units make up Phase 5?

The work that Phase 5 requirements Questions 13–17 produce — CI gating, README/INSTALL/CONTRIBUTING,
LICENCE/SECURITY, the install routine and its cold walk — is listed in the execution plan only as
*"(later) team workflow + onboarding docs"*, with no unit.

A) **Four units: U6, U8, U7, and a new U9 — Team Workflow & Onboarding** (CI gating, the documents, the install routine) ⭐ *recommended*

B) Three units — fold the onboarding work into U7

C) Three units — the onboarding work done as housekeeping outside any unit. ⚠️ Work with no unit has no design stage, no exit criteria and no build-and-test record: the non-standard path this round exists to remove

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 5 — In what order?

Fixed: U6 first (the corpus must be movable before anything moves), and U8 before U7 (an appliance is
unusable if rules and credentials cannot be managed in-app).

A) **U6 → U8 → U9 → U7.** U7's NAS deployment is then performed **by following U9's install routine** — so the cold walk *is* U7's verification, rather than a second exercise ⭐ *recommended*

B) U6 → U8 → U7 → U9. Deploy first, write the routine from what was learned. ⚠️ Writes it from memory — exactly what the cold walk is meant to prevent

C) U9 in parallel with U6/U8 — documents and CI have no code dependency on them. ⚠️ The install routine's restore and credential steps would describe features not yet built

X) Other (please describe after [Answer]: tag below)

[Answer]:
Is there a reason why we shouldn't just swap the unit numbers if we find that U8 needs to be build before U7? (just swap 7 and 8)?
---

## Carried to U9's design plan — NOT asked now

These were Q2 and Q5 of the retired `phase-5-plan.md`. They are **U9 design** questions, so under the
standard process they belong in U9's Functional/Infrastructure Design plan when U9 starts. Recorded here so
they are not lost.

**U9-a — Is the NAS deployment THE deployment, or a second, throwaway one?**
A) Treat the NAS as *the* deployment; move the corpus there with U6 ·
B) ⭐ A second, throwaway deployment with its own empty corpus first; this machine stays authoritative.
⚠️ B's cost: two deployments on one Spotify registration (U9-b), and a second corpus that is **not** a
backup of the first and must never be mistaken for one. ⚠️ `secrets/spotify-config.json` holds a refresh
token the MCP server rewrites — on NAS storage it may be swept into DSM snapshots or cloud sync.

**U9-b — Two deployments, one Spotify app registration.** The poll is ~1,200 requests/hour (98.4% of the
footprint); two live deployments double it against a ceiling Spotify does not publish.
A) ⭐ Only one deployment polls at a time · B) Both run; watch M2 for 429s · C) A second registration for
the NAS. ⚠️ *Run both* forecloses going back — restore replaces, never merges (U6 Q3). ⚠️ Zero observed
429s is not headroom.

**Also carried to U9**: probe **WAL on the NAS volume** (the existing proof covers a Rancher bind mount; the
standing advice is that WAL is unsafe on *network* filesystems) · verify the WebSocket handshake **in both
directions** from off-machine (the `403` incident's signature is 200 on the page and 403 on the socket).

---

## Phase 5 Execution Checklist

Runs after approval.

- [x] Confirm answers; check consistency and ambiguity
- [x] `application-design/unit-of-work.md` — add **U9** and (per Question 4) **U8** entries; U6 and U7 exist
- [x] `application-design/unit-of-work-dependency.md` — ⚠️ **has no Phase 5 units at all**; add U6–U8
- [x] `application-design/unit-of-work-story-map.md` — ⚠️ **has no Phase 5 units at all**; map US-28 → U6
- [x] Correct the *Proposed units* table above: U6's *"none"* stories cell → **US-28**
- [x] Verify no unit depends on a later unit, and that Phase 5's units together leave a runnable app
- [x] Update `execution-plan.md`, `aidlc-state.md`; log in `audit.md`


---

## Phase 5 round — answer analysis and follow-ups (2026-10-07)

**Settled**: Question 4 = **A** — four units: U6, U8, U7, and **U9 Team Workflow & Onboarding**.

**Question 5** was answered with a question: *"Is there a reason why we shouldn't just swap the unit numbers
if we find that U8 needs to be built before U7?"*

**Answer: no strong reason.** Unit numbers here are names, not dates, but every earlier unit was numbered in
build order, so keeping that convention is the less surprising choice. Renumbering is cheap **now** because
**nothing has been designed for U7, U8 or U9 yet**: about 60 mentions across 12 documents, all of them
declarations or cross-references.

⚠️ **One thing it touches: `audit.md` is append-only**, so its earlier entries keep the old numbers. The
renumbering is logged there with an explicit mapping, so old entries stay readable.

⚠️ **And swapping only 7 and 8 is not quite enough**: under the recommended order (Question 5 A) U9 is also
built before the deployment unit. Build order is U6 → configuration → onboarding → deployment, so matching it
means renumbering all three.

## Question 5a — Order, and whether the numbers follow it

A) **Order U6 → configuration → onboarding → deployment, and renumber to match**: **U7 Configuration
Management · U8 Team Workflow & Onboarding · U9 Off-machine Deployment**. Mapping logged in `audit.md` ⭐
*recommended*

B) Same order, **keep the current numbers** (U6 → U8 → U9 → U7); the execution plan carries the order

C) Order U6 → configuration → deployment → onboarding (Question 5 B), renumbered to match (onboarding = U9)

X) Other (please describe after [Answer]: tag below)

[Answer]: A — renumber to build order. *(Recorded from the user's reply in conversation, 2026-10-07: "go ahead and swap the numbers so the numbers stay sequential.")*

### Answer analysis (Step 7)

Q4 = A, Q5a = A. **Order: U6 → U7 Configuration Management → U8 Team Workflow & Onboarding → U9 Off-machine
Deployment.** Consistency: U7 before U9 (an appliance needs in-app configuration); U8 before U9 (the
deployment is performed by following U8's install routine, so the cold walk is U9's verification); U8 after U7
(the routine documents U7's credential and rules steps). No unit depends on a later one.


---

## Question 6 — A unit for team operations (added 2026-10-12)

Reviewing U8's FD, the user found no issue tracking or multi-developer coordination in Phase 5 and chose to keep
**U8 as groundwork** and add a **new unit** for team operations (Requirements Questions 21–25 set its scope).
U9 (NAS deployment) **does not depend on it** — it needs U8's install routine, not issues or reviews.

A) **U10 — Team Operations, built after U9**: U8 → U9 → U10. No renumbering; the NAS work is not held up, and
team operations are designed once the first cold walk and the NAS install have shown what a second developer
actually trips on ⭐ *recommended*

B) **Built before U9, renumbered to match** (the Question 5a precedent: numbers follow build order) — team
operations become **U9**, the NAS deployment **U10**. Mapping logged in `audit.md`. Choose this if a second
developer is joining before the NAS work

X) Other (please describe after [Answer]: tag below)

[Answer]: **A** (user, 2026-10-12, question prompt: *"U10, after U9 (Recommended)"*). **U10 — Team Operations** declared in `unit-of-work.md`; build order **U8 → U9 → U10**.

---

## Question 7 — Where the connector upgrade goes (added 2026-10-18)

The owner wants it **before** the NAS deployment, because U9 is easier with a container (Requirements Questions 26–28
set its scope). It depends on U8 (release, CI, docs) and nothing in U9 or U10.

A) **New unit U9 — Connector Upgrade & Publishable Image**, built next. Numbers follow build order (the Question 5a
precedent): Off-machine Deployment becomes **U10**, Team Operations **U11**. Mapping logged in `audit.md` ⭐
*recommended*

B) Keep the existing numbers: the new unit is **U11**, built **before** U9. No renumbering, but the numbers no longer
match the build order

X) Other (please describe after [Answer]: tag below)

[Answer]: **A** (owner, 2026-10-18, question prompt: *"A: new U9, renumber (Recommended)"*). **U9 — Connector Upgrade & Publishable Image** is built next; Off-machine Deployment **U9 → U10**, Team Operations **U10 → U11**. Questions 1–6 above keep the numbers they were asked with.

---

## Question 8 — Where the data-safety unit goes (added 2026-10-18)

The owner chose a new unit **before the NAS** (question prompt, 2026-10-18), for Requirements Questions 29–33. It
depends on U6 (in-app backup), U8 (release script) and U9 (the App-only image it updates); the NAS deployment is where
a second running copy makes these risks real.

A) **New unit U10 — Data Safety**, built after U9. Numbers follow build order (the Question 5a and 7 precedent):
Off-machine Deployment **U10 → U11**, Team Operations **U11 → U12**. Mapping logged in `audit.md` ⭐ *recommended*

B) Keep the numbers: the new unit is **U12**, built before U10

X) Other (please describe after [Answer]: tag below)

[Answer]: **A** (owner, 2026-10-18, in this file). **U10 — Data Safety** is built after U9; Off-machine Deployment **U10 → U11**, Team Operations **U11 → U12**. Questions above keep the numbers they were asked with.
