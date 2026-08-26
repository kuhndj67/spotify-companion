# Functional Design Plan — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Functional Design, Unit U1
**Unit**: [`../../inception/application-design/unit-of-work.md`](../../inception/application-design/unit-of-work.md) (U1)
**Stories**: US-10, US-11, US-12, US-25, recording half of US-13

---

## Unit context

U1 turns playback observation into a durable dataset. Its output is the **outcome variable** for
every later analysis — the thing the promotion hypothesis is tested against, and the thing rules
are back-tested against.

**Everything in this unit is downstream of one definition: what counts as a skip.** Get that
wrong and the dataset is subtly, permanently misleading. It is also not recoverable by better
analysis later, because the bias would be systematic rather than random.

The questions below are therefore all about the same thing from different angles.

---

## Questions

### Question 1 — When has a track "completed"?

Spotify reports `progress_ms` on a poll interval (currently 3 s), so the last observation before a
track change can be up to one interval stale. An exact `progress == duration` test would almost
never be true.

Many tracks also end with trailing silence or a fade, and skipping during the last few seconds is
normal listening behaviour, not rejection.

A) **Within one poll interval of the end** — completed if `duration - lastProgress <= pollInterval`.
   Directly models the measurement limitation, and nothing else. Tracks skipped at 95% of a
   4-minute song (12 s early) count as **skipped**

B) **Ratio threshold** — completed if `lastProgress / duration >= 0.95`. Forgiving of end-of-track
   skips, but the meaning varies with length: 5% of a 2-minute track is 6 s, of a 10-minute track
   is 30 s

C) **Either** — completed if within one poll interval **or** past a ratio threshold. Most forgiving;
   captures "I heard essentially all of it" under both short and long durations

D) **Within one poll interval, OR within a fixed tail window** (e.g. last 10 s) — models the
   measurement limit *and* a constant "close enough to the end" allowance that does not scale
   oddly with track length

X) Other (please describe after [Answer]: tag below)

[Answer]: B — ratio threshold. **Value resolved to 0.90 in Q5.**

---

### Question 2 — Are very short plays signal, or noise?

A track abandoned after 2 seconds is different from one abandoned after 90. It might be the
strongest possible rejection signal — or it might be you scrubbing through a queue, hitting the
wrong control, or a device handover.

A) **All skips are equal** — record the outcome as `skipped` regardless of duration. Simplest; the
   evidence (elapsed time) is stored anyway, so any analysis can filter later

B) **Record a distinct outcome for very short plays** — e.g. `skipped` vs a separate marker below a
   threshold, so browsing behaviour can be excluded from preference analysis without guessing

C) **Record all as `skipped`, but flag sub-threshold plays** — one outcome value, plus a boolean on
   the record. Keeps the outcome enumeration small while making the distinction queryable

X) Other (please describe after [Answer]: tag below)

[Answer]: A — no special handling. *"Any track skipped before the threshold ratio is reached
(90% seems like a good target) is considered skipped, after that threshold is considered
completed."* Option C's sub-threshold flag is **not** adopted.

---

### Question 3 — How long are observation trails kept?

Play records are small and permanent. Trails are the bulk of the data — roughly 28,800 rows/day at
a 3 s interval — and exist to make reclassification possible (FR-20).

A) **Keep indefinitely** — never prune. Maximum future flexibility; roughly 10 M rows/year, which
   SQLite handles but the file grows steadily

B) **Prune after a fixed period** (e.g. 12 months), keeping play records forever. Bounded growth;
   reclassification is possible only within the retention window

C) **Keep indefinitely, with a manual prune command** — no automatic deletion, but the tool exists
   for when it is wanted

X) Other (please describe after [Answer]: tag below)

[Answer]: A — keep indefinitely, no automatic pruning. *"A future task will be to lifecycle manage
our data — I think we'll want a smart management routine and that will take some thought."*
Recorded as wishlist **W-2**.

---

### Question 4 — Paused and never resumed

You pause mid-track and walk away; the device eventually goes idle. That is neither a completion
nor a rejection — you may well have been enjoying it.

A) **`abandoned`** — a distinct outcome, excluded from preference analysis by default. Honest, and
   avoids polluting the skip signal with interruptions

B) **`skipped`** — treat leaving as rejection. Simpler, but conflates "I disliked this" with "the
   doorbell rang", which is exactly the noise that weakens the outcome variable

C) **`unknown`** — refuse to guess. Most conservative; costs data, since pausing is common

X) Other (please describe after [Answer]: tag below)

[Answer]: C — **`unknown`**.

---

## Recommendations

- **Q1 = D.** A is principled but unforgiving — it would mark a genuinely-finished listen as a
  skip whenever you move on a few seconds early, which is common and not rejection. B's ratio
  misbehaves across the length range this catalogue actually spans. D models the two real effects
  separately: measurement staleness (one poll interval) and human end-of-track behaviour (a fixed
  tail), neither of which is a ratio.
- **Q2 = C.** The distinction is real and worth capturing, but a fifth outcome value complicates
  every consumer — rules, exports, back-testing — for something that is genuinely an attribute of
  a skip rather than a different kind of event. A flag keeps the enumeration at four while making
  it filterable.
- **Q3 = C.** Trails are the raw material for FR-20, and this project's whole posture is that
  history cannot be regenerated. Automatic deletion on a timer is an irreversible action taken
  without anyone present to judge it. ~10 M rows/year is unremarkable for SQLite; revisit when the
  file size actually becomes a problem rather than pre-emptively.
- **Q4 = A.** `abandoned` already exists in the outcome enumeration precisely for this. B is the
  option that would quietly degrade the dataset — interruptions are frequent, and every one
  recorded as a skip is a false rejection signal attached to a track you may have liked.

---

## Answers — Round 1

| Q | Answer |
|---|---|
| Q1 Completion | **Ratio threshold** |
| Q2 Short plays | *"Any track skipped before the threshold ratio is reached (90% seems like a good target) is considered skipped, after that threshold is considered completed."* |
| Q3 Retention | *"Keep indefinitely for now, but a future task will be to lifecycle manage our data — I think we'll want a smart management routine and that will take some thought."* |
| Q4 Paused, never resumed | **`unknown`** |

### Analysis (Step 5, mandatory)

**Q3 is clear**: keep indefinitely, no automatic pruning, and data lifecycle management becomes a
future work item. Recorded as wishlist **W-2**. No ambiguity.

**Q4 is clear**: paused-and-never-resumed classifies as `unknown`.

**Q2 supersedes rather than answers.** The question asked whether very short plays deserve special
treatment; the answer defines a single ratio threshold governing skip-vs-complete. Read as: **no
special handling for short plays** — everything below threshold is `skipped`, everything above is
`completed`. Option C's sub-threshold flag is therefore *not* adopted.

**Three ambiguities must be resolved before design.**

---

## Follow-up Questions — Round 2

### Question 5 — 90% or 95%?

Q1 selected the option written as `>= 0.95`; Q2's text says *"90% seems like a good target"*.
These are different rules, and the difference is material: on a 4-minute track it is the
difference between recording a skip at 3:36 and at 3:48.

A) **90%** — the value stated in your own words in Q2

B) **95%** — the value in the option selected in Q1

C) **Something else** — specify

X) Other (please describe after [Answer]: tag below)

[Answer]: A — **90%**.

---

### Question 6 — Short tracks can be misclassified by a pure ratio. Add a floor?

A consequence of the ratio rule that is worth surfacing before it is built in, because it
produces **false skips on tracks you actually finished**.

The last poll before a track ends lands somewhere in the final poll interval, so the highest
progress ever observed is roughly `duration - pollInterval`. For that to clear the threshold:

| Threshold | Poll interval | Tracks at risk |
|---|---|---|
| 95% | 3 s | **anything under 60 s** |
| 90% | 3 s | **anything under 30 s** |

A 45-second interlude played to the end would last-poll at ~93% and be recorded as **skipped**
under a 95% rule — a false rejection signal attached to a track you did not reject.

Most music is longer than 60 s, so the blast radius is small: interludes, skits, intros, short
outros. But the failure is systematic rather than random — it would consistently mark short
tracks as disliked.

A) **Add a poll-interval floor** — completed if `ratio >= threshold` **OR**
   `duration - lastProgress <= pollInterval`. The ratio stays the rule; this only prevents the
   measurement limit from manufacturing skips

B) **Leave it** — accept that very short tracks may be misclassified. Simpler rule, and the raw
   evidence is stored, so it can be corrected by reclassification later (FR-20)

X) Other (please describe after [Answer]: tag below)

[Answer]: B — **leave it.** No poll-interval floor. Accept that tracks under ~30 s may be
recorded as skipped when they were played through; the raw evidence is retained, so this is
correctable by reclassification (FR-20) if it proves to matter.

---

### Question 7 — Is `abandoned` still an outcome?

The enumeration was `completed | skipped | abandoned | unknown`. Your answers narrow it: a single
ratio decides skip-vs-complete, and paused-then-idle is `unknown`. That leaves `abandoned` with
no obvious remaining case.

The scenario it was for: playback **stops entirely without a pause** — device switched off,
Spotify closed, queue exhausted mid-track.

A) **Retire `abandoned`** — three outcomes: `completed`, `skipped`, `unknown`. Anything that is
   not a clean completion or a clean track-change-while-below-threshold becomes `unknown`.
   Simplest enumeration; loses the ability to distinguish "device died" from "genuinely unclear"

B) **Keep `abandoned`** for stop-without-pause, `unknown` for pause-then-idle. Four outcomes.
   Preserves a real distinction — a queue running out is not the same event as an ambiguous one

C) **Keep `abandoned` and fold `unknown` into it** — treat both interruption cases the same

X) Other (please describe after [Answer]: tag below)

[Answer]: A — **retire `abandoned`.** Three outcomes: `completed`, `skipped`, `unknown`.

---

## Settled design parameters

| Parameter | Value | Source |
|---|---|---|
| Completion threshold | **`lastProgress / duration >= 0.90`** | Q1 + Q5 |
| Below threshold at track change | **`skipped`** | Q2 |
| Short-play special handling | **None.** No sub-threshold flag | Q2 |
| Poll-interval floor | **Not applied** | Q6 |
| Paused, never resumed | **`unknown`** | Q4 |
| Stop without pause | **`unknown`** | Q7 |
| Outcome enumeration | **`completed \| skipped \| unknown`** | Q7 |
| Trail retention | **Indefinite.** No automatic pruning | Q3 |

### Accepted limitation — short tracks

At a 90% threshold and a 3 s poll, the highest progress ever observed is about
`duration - 3 s`. For that to clear 90%, a track must be at least **30 seconds** long.

**Corrected 2026-08-25 during code generation.** The claim below originally read "will be recorded
as `skipped`… consistently mislabelled". Writing the tests showed that is wrong.

A fully-played track is *guaranteed* to clear the threshold only when
`duration >= pollInterval / (1 - threshold)` = 30 s. Below that, the observed ratio depends on
where the final poll lands — a 20 s track lands anywhere in 0.85–1.00, so it is **sometimes
`skipped` and sometimes `completed`**.

The limitation is **intermittent, not systematic**: not every short track is mislabelled, but the
*same track played identically can be recorded differently on different occasions*. Interludes,
skits and short intros are affected; ordinary music is not.

Accepted deliberately (Q6 = B). Mitigation: the observation trail is retained, so
`reclassify()` can correct these records later without data loss (FR-20). Recorded as a known
data-quality caveat that must accompany any analysis of short-form tracks.

**No `abandoned` value exists**, so nothing distinguishes "device switched off" from "genuinely
unclear" — both are `unknown`. Also deliberate (Q7 = A).

---

## Execution Checklist

- [x] Confirm answers; analyse for ambiguity (Step 5)
- [x] Generate `domain-entities.md` — Play, Observation, OutcomeEvidence, ExportRow
- [x] Generate `business-logic-model.md` — play segmentation, classification algorithm, backfill,
      export pipeline
- [x] Generate `business-rules.md` — numbered, testable rules with edge cases
- [x] Define the Phase 1 database schema and migration 001
- [x] Verify every U1 story's acceptance criteria maps to a business rule
- [x] Verify the classifier remains pure — tolerances as parameters, no clock
- [x] Verify `skipSource='user'` is recorded from the first play (US-13 split)
- [x] Update `aidlc-state.md`; log in `audit.md`

**No frontend-components.md**: U1's only UI change is a download control on the existing page.
The component hierarchy from U0 is unchanged, so the artifact would be empty ceremony. The
download behaviour is specified as a business rule instead.
