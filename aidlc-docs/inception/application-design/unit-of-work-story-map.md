# Unit of Work — Story Map

**Date**: 2026-08-25 · **Stage**: INCEPTION — Units Generation

---

## Story assignments

| Story | Unit | Phase | Persona | Status |
|---|---|---|---|---|
| US-01 See what is playing | U0 | 0 | P1 | ✅ Delivered |
| US-02 Album artwork | U0 | 0 | P1 | ✅ Delivered |
| US-03 Confirm the app works | U0 | 0 | P2 | ✅ Delivered |
| US-04 Track age | U0 | 0 | P1 | ✅ Delivered |
| US-05 Follow status | U0 | 0 | P1 | ✅ Delivered |
| US-06 Surrounding detail | U0 | 0 | P1 | ✅ Delivered |
| US-07 Partial enrichment | U0 | 0 | P1 | ✅ Delivered |
| US-26 Local-only assurance | U0 | 0 | P1 | ✅ Delivered |
| **US-10** Every play recorded | **U1** | 1 | P3 | ⬜ |
| **US-11** Skips vs completions | **U1** | 1 | P3 | ⬜ |
| **US-12** Backfill gaps | **U1** | 1 | P3 | ⬜ |
| **US-25** Export my data | **U1** | 1 | P3 | ⬜ |
| **US-13** Separate my skips from the app's | **U1 + U5** | 1, 4 | P3 | ⬜ **split** |
| **US-08** Record label | **U2** | 2 | P1 | ⬜ |
| **US-09** Major or independent | **U2** | 2 | P1 | ⬜ |
| **US-14** Rule over any field | **U3** | 3 | P2 | ⬜ |
| **US-15** Several rules at once | **U3** | 3 | P2 | ⬜ |
| **US-16** Rules about my history | **U3** | 3 | P2 | ⬜ |
| **US-17** What happens when data is missing | **U3** | 3 | P2 | ⬜ |
| **US-20** Try a rule without acting | **U4** | 3 | P2 | ⬜ |
| **US-23** Why was this skipped | **U4** | 3 | P2 | ⬜ |
| **US-24** Back-test against history | **U4** | 3 | P2, P3 | ⬜ |
| **US-18** Act at track start | **U5** | 4 | P2 | ⬜ |
| **US-19** Track actually goes away | **U5** | 4 | P1, P2 | ⬜ |
| **US-21** Stop everything | **U5** | 4 | P2 | ⬜ |
| **US-22** Protected from my mistake | **U5** | 4 | P2 | ⬜ |
| **US-28** Move my history to another machine | **U6** | 5 | P3 | ⬜ *(added 2026-10-07)* |
| US-27 Live dashboard | — | — | P3 | ⏸ Deferred (W-1) |

**26 in-scope stories assigned. US-27 is unassigned by design** — it is a wishlist item, not
deferred work awaiting a unit.

---

## The one split story

**US-13 — "Tell my own skips apart from the app's"** spans two units, and splitting it is
correct rather than a modelling failure:

| Unit | Half | Why here |
|---|---|---|
| **U1** | The `skipSource` column exists; every play records it; live-observed skips are attributed to `user` | The schema must carry the field from the first recorded play, or U5's attribution has nowhere to go and history before U5 is permanently ambiguous |
| **U5** | Rule-initiated skips are attributed to `rule`; analyses and back-tests exclude them | The app cannot initiate a skip until U5 exists |

Splitting it is what prevents a subtle data defect. If the column arrived only with U5, every
play recorded during Phases 1–3 would have no attribution — and since those are all user skips,
they would either be lost to analysis or require a migration that *assumes* they were user skips.
Recording `user` from the start makes that assumption explicit and verifiable rather than
retrospective.

---

## Coverage by unit

| Unit | Stories | Count |
|---|---|---|
| U0 | US-01–07, US-26 | 8 |
| U1 | US-10, 11, 12, 25, 13ᵃ | 5 |
| U2 | US-08, 09 | 2 |
| U3 | US-14, 15, 16, 17 | 4 |
| U4 | US-20, 23, 24 | 3 |
| U5 | US-18, 19, 21, 22, 13ᵇ | 5 |

ᵃ recording half · ᵇ attribution half

---

## Coverage by persona

| Persona | Stories | Units | First served |
|---|---|---|---|
| **P1 Listener** | 9 | U0, U2, U5 | U0 — already delivered |
| **P2 Curator** | 9 | U0, U3, U4, U5 | U4 — first usable rule feedback |
| **P3 Analyst** | 6 | U1, U2, U4 | U1 — recording starts immediately |

### What this ordering means for each persona

**P3 (Analyst) is served first**, and deliberately. The dataset is the time-sensitive asset — every
day without recording is permanently lost — so U1 exists partly to start the clock. P3 gets real
value at the end of U2, when the hypothesis becomes testable.

**P2 (Curator) waits longest for usable feedback.** U3 delivers the rule model but produces
nothing visible; it is U4 that first lets a rule be written, watched and back-tested. That is a
real cost of the U3/U4 split, and it is worth naming: **the Curator's first satisfying moment is
at the end of Phase 3, not the start.** The compensation is that when it arrives, back-testing
against months of accumulated history makes it far more useful than it would have been earlier.

**P1 (Listener) is already served** by U0 and gains incrementally — the label in U2, the skipping
they actually wanted in U5. P1 is last to get the headline feature, which is the direct
consequence of putting risk containment ahead of gratification.

---

## Requirements traceability

| Unit | Functional | Non-functional |
|---|---|---|
| U1 | FR-17–23, FR-49–54 | NFR-08–13, NFR-22 |
| U2 | FR-12–16 | NFR-14–15 |
| U3 | FR-24–33, FR-43–45 | NFR-25–27 |
| U4 | FR-37, FR-41, FR-42 | NFR-26 |
| U5 | FR-34–36, FR-38–40, FR-46–48 | NFR-23 |
| U0 | FR-01–11 | NFR-01–07, NFR-16–21, NFR-24 |
| U6 | FR-57–64 | — *(its NFR Requirements stage follows FD approval)* |
| U7, U8, U9 | — *(settled in their own stages; see the Phase 5 requirements round)* | — |

**All in-scope functional requirements (FR-01 to FR-54) are assigned.** FR-55 is wishlisted
(W-1) and correctly has no unit.

---

## Validation

| Check | Result |
|---|---|
| Every in-scope story assigned | ✅ 27 of 27 *(US-28 → U6, 2026-10-07)* |
| No story in two units without justification | ✅ US-13 only, justified above |
| No unit depends on a later unit | ✅ Matrix is lower-triangular |
| Each phase's units deliver a runnable app | ✅ Phase 3 = U3 + U4 together |
| Every FR maps to a unit | ✅ FR-01–54 and FR-57–64; FR-55 wishlisted |
| Every persona served by at least one unit | ✅ All three |
