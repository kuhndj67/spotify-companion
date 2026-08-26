# Application Design Plan

**Date**: 2026-08-25 · **Stage**: INCEPTION — Application Design
**Inputs**: [`../requirements/requirements.md`](../requirements/requirements.md) ·
[`../user-stories/stories.md`](../user-stories/stories.md) ·
[`execution-plan.md`](execution-plan.md)

---

## Design scope

Four new subsystems on top of an existing, working codebase:

| Subsystem | Phase | Existing code it touches |
|---|---|---|
| Persistence + listening history | 1 | `nowPlayingService.ts` (source of observations) |
| Export | 1 | `server.ts` (download endpoint) |
| MusicBrainz label enrichment | 2 | `spotify/enrichment.ts` (extends the record) |
| Rules engine | 3 | `nowPlayingService.ts` (track-start trigger) |
| Playback control + safety | 4 | `mcp/spotifyMcpClient.ts` or Web API |

**Existing structure** (`src/config.ts`, `src/localGuard.ts`, `src/nowPlayingService.ts`,
`src/server.ts`, `src/diagnostics.ts`, `src/mcp/*`, `src/spotify/*`) is flat, feature-grouped,
and works. The design should extend it, not replace it.

---

## Questions

Four questions. Each changes the design materially.

### Question 1 — What exactly gets stored, and when is the outcome decided?

**This is the most consequential question in the design.** FR-19 requires storing the evidence
behind each outcome; FR-20 requires outcomes to be recomputable when the classifier improves.
How literally we take that determines whether FR-20 is genuinely satisfiable.

A) **Play records with an evidence snapshot** — one row per play, carrying the fields the
   classifier used: last observed progress, duration, observation gap, pause/seek markers.
   Classification happens live. Recomputation works only for what the snapshot captured.
   *~200 rows/day.*

B) **Raw observation log, outcomes derived at read time** — persist every poll tick; plays and
   outcomes are *views* over that log, computed on demand. Maximum fidelity: any future
   classifier can be applied retroactively to the complete record.
   *~28,800 rows/day at a 3 s interval — ~10 M/year. Well within SQLite's capability, but the
   display and export paths get more complex.*

C) **Hybrid — play records plus the observation trail for that play.** One row per play with the
   live verdict, plus the handful of observations belonging to it retained alongside. Full
   recomputation for any classifier that works from progress samples, at a fraction of B's volume.
   *~200 play rows + ~28,800 observation rows/day, with the trail prunable after N months.*

X) Other (please describe after [Answer]: tag below)

[Answer]: C — hybrid: play records plus the observation trail for that play.

---

### Question 2 — How are rules authored?

The Curator persona needs precision; you are also the developer, which widens the sensible
options.

A) **JSON rules file, edited directly; the UI displays them read-only** — rules live in a file
   validated against a schema, editable in VS Code with completion. Cheapest to build; excellent
   for precision and diffing; no form-building work

B) **Full UI editor** — build a rule builder in the web app: field picker, operator picker,
   condition tree. Most approachable, and the only option that makes the field catalogue (FR-28)
   directly browsable. Significantly more work, and the UI is currently vanilla JS

C) **Both** — file as the source of truth, plus a UI editor added later once the rule model has
   settled

X) Other (please describe after [Answer]: tag below)

[Answer]: A — JSON rules file, schema-validated, edited directly; UI displays read-only.

---

### Question 3 — Module organisation

A) **Continue the existing flat, feature-grouped layout** — add `src/history/`, `src/rules/`,
   `src/musicbrainz/`, `src/export/` alongside `src/mcp/` and `src/spotify/`. Consistent with what
   is there; low ceremony

B) **Introduce layered directories** — `domain/`, `application/`, `infrastructure/`. Clearer
   dependency direction for the rule engine and repositories; a larger change to existing code and
   heavier than this codebase's current style

C) **Hybrid** — keep the flat layout, but isolate pure domain logic (rule evaluation, outcome
   classification, label classification) into dependency-free modules that never import I/O

X) Other (please describe after [Answer]: tag below)

[Answer]: C — flat feature-grouped layout, with pure domain logic isolated into dependency-free
modules that never import I/O.

---

### Question 4 — Schema strategy across phases

History accumulates from Phase 1, but labels arrive in Phase 2 and rule actions in Phase 4. Data
is the expensive thing to get wrong.

A) **Design the full end-state schema now, populate progressively** — columns for labels and rule
   actions exist from Phase 1, sitting null until their phase arrives. Fewer migrations over real
   data; commits to a shape before Phases 2–4 have taught us anything

B) **Grow the schema per phase via migrations** — Phase 1 stores only what Phase 1 knows; later
   phases add columns and backfill. Each phase's schema is informed by what the previous one
   learned; requires migrations to work correctly from the start (NFR-12 mandates them anyway)

C) **Core schema now, flexible payload alongside** — fixed columns for the stable core (track,
   timestamps, outcome, evidence), plus a JSON column for evolving enrichment. Avoids most
   migrations; weaker typing and clumsier querying for downstream tools

X) Other (please describe after [Answer]: tag below)

[Answer]: B — grow the schema per phase via migrations.

---

## Answer Analysis (Step 8, mandatory)

All four answers are unambiguous single-option selections matching the recommendations. No vague
qualifiers, undefined terms, contradictions, or combined options. **Step 9 follow-up round not
triggered.**

Consistency cross-check:
- **Q1 = C + Q4 = B** — the observation trail is a Phase 1 table, and per-phase migrations are the
  mechanism by which it later gains label and rule-action columns. Consistent.
- **Q2 = A + Q3 = C** — rules-as-JSON needs a pure validator and a pure evaluator with an
  I/O-bound loader around them. That split is exactly what Q3 = C prescribes. Consistent.
- **Q1 = C + Q3 = C** — the outcome classifier reads the trail and is pure; the observer that
  collects it is impure. The design must keep that boundary explicit. Consistent.

---

## Recommendations

- **Q1 = C (hybrid).** A quietly under-delivers on FR-20: a snapshot only supports classifiers
  that use the fields we happened to save, so the first schema decision silently caps every future
  improvement. B is the most faithful but makes every read path a reconstruction. C keeps the live
  verdict cheap to read while retaining enough raw signal for genuine recomputation, and the trail
  can be pruned once the classifier stabilises. Given that history is the one thing that cannot be
  regenerated, err toward keeping more.
- **Q2 = A.** The rule model is the least-settled part of the design; building a UI editor on top
  of it before it stabilises means rebuilding the editor. A JSON file with a schema gives the
  Curator persona precision immediately, and C's UI can follow once Phase 3 has proven the model.
- **Q3 = C.** The flat layout is working and matches the codebase; the valuable half of layering
  is dependency-free domain logic, which is exactly what the property tests need (NFR-25/26) and
  what makes back-testing (FR-42) possible without stubbing I/O.
- **Q4 = B.** A commits to a shape before Phases 2–4 have taught us anything, and the phasing
  exists precisely because we expect to learn. Migrations are mandatory regardless (NFR-12), so B
  exercises them from the start rather than discovering they are broken during Phase 2's backfill.

---

## Execution Checklist

Runs after the questions are answered.

- [x] Confirm answers and check them for consistency
- [x] Generate `application-design/components.md` — component definitions, responsibilities,
      interfaces
- [x] Generate `application-design/component-methods.md` — method signatures, purposes, I/O types
- [x] Generate `application-design/services.md` — service definitions and orchestration
- [x] Generate `application-design/component-dependency.md` — dependency matrix, communication
      patterns, data flow
- [x] Generate `application-design/application-design.md` — consolidated view
- [x] Verify every component traces to requirements and stories
- [x] Verify pure/impure separation holds for anything property-tested
- [x] Verify the design supports phase boundaries — Phase 3 must be buildable with no playback
      control path existing at all
- [x] Update `aidlc-state.md` and log in `audit.md`
