# User Stories Assessment

**Date**: 2026-08-25 · **Stage**: INCEPTION — User Stories, Step 1 (mandatory validation)

## Request Analysis

- **Original Request**: A locally-deployed app that displays what Spotify is playing, enriches
  it with information Spotify's own client does not show, and applies user-authored rules that
  automatically skip tracks — with listening history recorded to test the hypothesis that
  signed-artist placements are paid promotion.
- **User Impact**: **Direct.** Every requirement in scope is user-facing — a display, a rule
  authoring surface, and an automation that acts on the user's own music playback.
- **Complexity Level**: **Complex.** 48 functional requirements across four subsystems, with
  non-obvious behavioural semantics (tri-state evaluation, derived skip inference, decision
  deadlines) that are easy to get subtly wrong.
- **Stakeholders**: Single stakeholder — the project owner, who is also the sole user and the
  developer. No cross-team coordination.

## Assessment Criteria Met

- [x] **High Priority — New User Features**: FR-12 to FR-48 are all new functionality the user
      interacts with directly.
- [x] **High Priority — Complex Business Logic**: The rules engine has multiple scenarios and
      genuine decision rules — tri-state unknown handling (FR-32/33), decision deadlines
      (FR-34/35), safety interlocks (FR-37–40). These are exactly the kind of semantics that
      benefit from being stated as observable behaviour rather than as implementation notes.
- [x] **High Priority — User Experience Changes**: The app transitions from read-only display to
      one that **acts on the user's playback**. That is a fundamental change in the relationship
      between the user and the tool, and it deserves explicit narrative treatment.
- [x] **Medium Priority — Data Changes**: Listening history introduces persistent user data with
      a schema intended for later statistical analysis.
- [x] **Complexity — Scope**: Changes span display, enrichment, persistence, rules, and playback
      control.
- [x] **Complexity — Risk**: An incorrect rule skips the user's music. Misclassified skip
      outcomes silently corrupt the dataset the project's central hypothesis depends on.
- [x] **Complexity — Testing**: User acceptance testing is required — several requirements
      (FR-36 queue lookahead, FR-18 skip inference) can only be validated against live playback.

## Criteria Explicitly NOT Met

- **Multi-Persona Systems**: No. Single user, single account, capped at 5 users by Spotify
  Development Mode. Personas will represent *modes of use*, not different people — see Q1 in the
  story plan.
- **Cross-Team Projects**: No.
- **Customer-Facing APIs**: No. Localhost only (NFR-01).

## Decision

**Execute User Stories**: **Yes**

**Reasoning**: This clears the High Priority bar on three independent criteria, so the assessment
is not marginal. The strongest specific justification is the rules engine. Its requirements are
written as system properties — "evaluate predicates as tri-state", "enforce a decision deadline"
— and while that is correct for a requirements document, it leaves the *observable behaviour*
unstated. What should the user actually see when a rule wants a field MusicBrainz has never heard
of? What happens on screen when a track is skipped automatically? Those are story questions, and
answering them before design is cheaper than discovering them during implementation.

The second justification is the **hypothesis-testing purpose**. This project is unusual: its
value depends on collecting data that supports a later statistical analysis. Stories force the
question "who looks at this, when, and what decision do they make with it?" — which is the check
that stops the history feature from becoming a write-only log nobody ever reads.

**Honest counter-argument, recorded rather than hidden**: single-user projects are the classic
case where user stories become ceremony. The mitigating factor is complexity, not headcount —
and the plan below is deliberately scoped to keep stories thin where the behaviour is obvious
(the display) and detailed only where it is genuinely non-obvious (rules, history, safety).

## Expected Outcomes

- **Observable behaviour for the rules engine**, particularly the unknown-field and
  deadline-expiry cases, which the requirements specify structurally but not experientially.
- **Acceptance criteria usable as test specifications**, feeding directly into the existing
  property-based testing practice (NFR-25/26/27).
- **A validated story for listening history** — confirming it serves a real user need rather
  than accumulating data speculatively.
- **An explicit safety narrative** — what the user does when a rule misbehaves, which is
  currently specified as mechanisms (FR-37–40) without a story tying them together.
- **A scope boundary between already-built and new work**, which this project needs more than
  most, because working code exists ahead of the formal stages.
