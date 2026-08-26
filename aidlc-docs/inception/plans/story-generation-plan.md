# Story Generation Plan

**Date**: 2026-08-25 · **Stage**: INCEPTION — User Stories, Part 1 (Planning)
**Assessment**: [`user-stories-assessment.md`](user-stories-assessment.md) — Execute = Yes
**Source requirements**: [`../requirements/requirements.md`](../requirements/requirements.md)

---

## Purpose

Convert 48 functional and 27 non-functional requirements into user-centred stories with
testable acceptance criteria. This document is the **plan and the question set**; stories are
not written until it is approved.

---

## Questions

Please fill in each `[Answer]:` tag. Four questions — each one changes how the stories get
written, so none is ceremony.

### Question 1 — Personas for a single-user project

This project has exactly one human user, who is also the developer. Conventional multi-persona
modelling doesn't apply. But the same person clearly operates in **distinct modes** with
different goals, and those modes are what stories would be written against.

A) **Modes as personas** — model three: *the Listener* (music is on, wants ambient awareness),
   *the Curator* (actively authoring and tuning rules), *the Analyst* (examining accumulated
   history to test the promotion hypothesis). Stories are grouped by which mode they serve

B) **One persona** — a single "Owner" persona covering everything. Simplest, but loses the
   distinction between passive and active use, which matters because the display must not
   demand attention while the rule editor must invite it

C) **Two personas** — *Listener* (passive) and *Operator* (rule authoring plus analysis, since
   both are deliberate sit-down activities)

X) Other (please describe after [Answer]: tag below)

[Answer]: A — three modes as personas: **Listener**, **Curator**, **Analyst**.

---

### Question 2 — Do stories cover the already-built work?

This project has working, live-verified code ahead of the formal stages. FR-01 to FR-11 (display,
enrichment, artwork, diagnostics) are **already implemented and passing 100 tests**.

A) **New work only** — write stories for FR-12 to FR-48. Treat the existing display as given.
   Smallest document, but the built behaviour never gets acceptance criteria

B) **All requirements** — write stories for FR-01 to FR-48, marking the already-built ones as
   satisfied. Gives the whole product one coherent story set and retroactively documents
   acceptance criteria for the display

C) **New work in full, existing work summarised** — detailed stories for FR-12 to FR-48, plus a
   small number of thin "already delivered" stories covering FR-01 to FR-11 so the set is
   complete without re-litigating built behaviour

X) Other (please describe after [Answer]: tag below)

[Answer]: C — detailed stories for FR-12 to FR-48; thin "already delivered" stories for
FR-01 to FR-11.

---

### Question 3 — Story organisation

The requirements are already grouped by subsystem (display, enrichment, history, rules,
playback). Stories could follow that, or cut across it.

A) **Epic-based** — four or five epics (Awareness, Enrichment, History, Rules, Safety) each
   containing stories. Maps cleanly onto the requirements and onto likely delivery order

B) **User journey-based** — stories follow end-to-end flows: "a track starts and I learn about
   it", "I write a rule and watch it work", "I review what was skipped last week". Better at
   exposing gaps between subsystems, less tidy a mapping to requirements

C) **Hybrid** — epics for structure, with each epic's stories written as journey steps so the
   flow through the system stays visible

X) Other (please describe after [Answer]: tag below)

[Answer]: C — hybrid: epics for structure, journey-style stories within them.

---

### Question 4 — Acceptance criteria format

This matters more than it usually would, because the project has an established property-based
testing practice and acceptance criteria should feed it (NFR-25/26/27).

A) **Given / When / Then** — conventional Gherkin. Precise about state and trigger, and maps
   naturally onto the event-driven behaviour here ("given a rule referencing an unresolved
   field, when the track starts, then…"). Verbose

B) **Checklist** — a bulleted list of testable assertions per story. Compact and quick to scan,
   less explicit about preconditions, which is where several of this project's subtleties live

C) **Given/When/Then for behavioural stories, checklist for the rest** — reserve the heavier
   format for the rules engine and skip-inference stories where preconditions genuinely matter,
   use checklists for display and configuration stories

X) Other (please describe after [Answer]: tag below)

[Answer]: C — Given/When/Then for rules-engine and skip-inference stories; checklists for
display and configuration stories.

---

## Answer Analysis (Step 9, mandatory)

All four answers are unambiguous single-option selections matching the stated recommendations.
Checked for and found **none** of: vague qualifiers ("mix of", "depends", "probably"), undefined
terms, contradictions between answers, combined options without decision rules, or
assumption-based responses. **No follow-up clarification round required** (Step 10 not
triggered).

Cross-check for consistency: Q1 = A (three personas) and Q3 = C (epics + journeys) work together
— journey-style stories need an actor, and the three modes supply distinct ones. Q2 = C and
Q4 = C are also consistent: the thin "already delivered" stories take checklist criteria, which
is what Q4 = C prescribes for display stories.

---

## Execution Checklist

Steps run **after** this plan is approved. Nothing below is started before then.

### Preparation
- [x] Re-read `requirements.md` in full and build an FR → story coverage map
- [x] Confirm the scope boundary set by Q2
- [x] Confirm persona set from Q1
- [x] Confirm organisation approach from Q3
- [x] Confirm acceptance criteria format from Q4

### Personas
- [x] Create `aidlc-docs/inception/user-stories/personas.md`
- [x] Define each persona: goals, context of use, attention level, what they need from the system
- [x] State explicitly that personas represent **modes of a single user**, not distinct people
- [x] Map each persona to the stories that serve it

### Stories
- [x] Create `aidlc-docs/inception/user-stories/stories.md`
- [x] Write stories in the organisation approach chosen in Q3
- [x] Write every story in the standard form: *As a [persona], I want [capability], so that [value]*
- [x] Write acceptance criteria in the Q4 format for every story
- [x] Cover the rules engine's non-obvious behaviour explicitly:
  - [x] Unknown-field handling — what the user sees when a field cannot be resolved (FR-32/33)
  - [x] Decision deadline expiry — what happens when enrichment doesn't arrive in time (FR-34/35)
  - [x] Automated skip — what the user observes when the app acts on their playback (FR-46/48)
  - [x] Safety — dry-run, kill switch, runaway halt (FR-37–40)
- [x] Cover skip inference (FR-18–20) including the confounders: pause, seek, replay, session end
- [x] Cover back-testing (FR-42) as the story that links rules to the promotion hypothesis
- [x] Note where a story's value depends on an unproven assumption (R1)

### INVEST validation
- [x] **Independent** — check for stories that cannot be built without another; note real
      dependencies rather than pretending they don't exist
- [x] **Negotiable** — confirm stories state intent, not implementation
- [x] **Valuable** — confirm each story delivers observable user value; challenge any that
      exist only to satisfy a requirement number
- [x] **Estimable** — confirm each is understood well enough to size
- [x] **Small** — split anything spanning multiple subsystems
- [x] **Testable** — confirm every acceptance criterion is objectively verifiable

### Traceability and completion
- [x] Produce an FR → story coverage table
- [x] Identify any requirement with **no** story, and justify it (infrastructure NFRs legitimately
      may have none)
- [x] Identify any story with **no** requirement — that means requirements are incomplete, and it
      must be raised rather than quietly absorbed
- [x] Flag ambiguities discovered while writing stories
- [x] Update `aidlc-state.md` — mark User Stories complete
- [x] Log completion in `audit.md`

---

## Story Breakdown Options — trade-offs

Recorded per Step 5 so the Q3 choice is informed.

| Approach | Benefit | Cost | Fit here |
|---|---|---|---|
| **User Journey-Based** | Exposes gaps *between* subsystems; keeps the user's experience central | Maps untidily onto requirements; risks duplication where journeys overlap | Strong — the interesting failures here are cross-subsystem (enrichment latency breaking rule evaluation) |
| **Feature-Based** | Clean mapping to requirements; easy traceability | Can produce stories that describe components rather than value | Moderate — requirements are already feature-grouped, so this adds little |
| **Persona-Based** | Good when user types differ sharply | Weak with one real user | Poor |
| **Domain-Based** | Good for large business domains | No meaningful domain separation at this size | Poor |
| **Epic-Based** | Hierarchy suits a multi-release arc; groups naturally by delivery order | Can drift into a work breakdown structure rather than user value | Strong — the arc is explicitly multi-release |

**Recommendation**: **Q3 = C (hybrid)**. Epics give the structure a multi-release arc needs;
journey-style stories inside them keep the cross-subsystem interactions visible — and those
interactions are where this project's genuine risk sits.

## Other recommendations

- **Q1 = A (three modes as personas)**. The Listener/Curator distinction is not cosmetic: it
  produces a real, testable design constraint — the display must be glanceable and never demand
  attention, while the rule editor may be dense and deliberate. One persona would blur that.
- **Q2 = C**. Keeps the story set complete without spending effort re-specifying working,
  tested code.
- **Q4 = C**. Given/When/Then earns its verbosity exactly where preconditions carry the meaning
  (tri-state evaluation, deadline expiry) and is overhead everywhere else.

---

## Out of scope for this stage

Per Step 11, this stage does **not** cover prioritisation, sprint planning, timelines, effort
estimation, or technical design. Those belong to Workflow Planning and Application Design.
