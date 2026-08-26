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
