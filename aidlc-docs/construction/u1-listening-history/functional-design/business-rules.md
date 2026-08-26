# Business Rules — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Functional Design, U1

Numbered, individually testable. Every rule states its source and the story criterion it serves.

**Settled parameters**: completion threshold **0.90** · no poll-interval floor · outcomes
**`completed | skipped | unknown`** · trails kept indefinitely.

---

## BR-1: Play segmentation

| # | Rule | Source |
|---|---|---|
| **BR-1.1** | A play begins at the first observation of a track that was not the immediately preceding track | US-10 |
| **BR-1.2** | A play ends at the last observation before the track changes, playback stops, or the app shuts down | US-10 |
| **BR-1.3** | Backward progress on the **same track** does not end the play. There is no replay-versus-rewind branch | User, 2026-08-25 |
| **BR-1.4** | A play with fewer than one observation is never recorded — there is no evidence to record | — |

> ### There is no backward-jump logic at all
>
> An earlier draft had two rules here and a special classification rule (BR-2.10) to stop a rewound
> play being scored as a skip. **All three are gone**, replaced by changing what the ratio measures
> (BR-2.1).
>
> User, 2026-08-25: *"I don't know if a specific rule needs to be created for this, just that we
> likely don't need specific logic to handle it. Rewinding will just extend the play time of the
> track which will increase its ratio."*
>
> That is true once the ratio measures **listened time** rather than furthest position. Re-hearing
> a passage adds listening time, so engagement raises the ratio by itself — no rule required, and
> the replay-versus-rewind distinction stops existing as a question.
>
> **Consequence, stated so it is not a surprise**: a track played twice in a row is now **one play
> record with a ratio near 2.0**, not two records. A track left on repeat for an hour is one record
> with a large ratio. Play *counts* for US-16's history rules undercount repeats; the ratio carries
> that signal instead, and arguably carries it better.

---

## BR-2: Outcome classification

| # | Rule | Source |
|---|---|---|
| **BR-2.1** | `completionRatio = listenedMs / durationMs`, where `listenedMs` is **total time spent listening** — the sum of forward progress made during the play. **It may exceed 1.0** | Q1, User 2026-08-25 |
| **BR-2.2** | If `completionRatio >= 0.90`, the outcome is **`completed`** | Q1, Q5 |
| **BR-2.3** | If the track changed while `completionRatio < 0.90`, the outcome is **`skipped`** | Q2 |
| **BR-2.4** | If playback was paused and never resumed before the play ended, the outcome is **`unknown`** | Q4 |
| **BR-2.5** | If playback stopped entirely without a pause — device idle, app closed, queue exhausted — the outcome is **`unknown`** | Q7 |
| **BR-2.6** | If the app shut down mid-play, the outcome is **`unknown`** | — |
| **BR-2.7** | `durationMs` of zero or missing yields **`unknown`**; the ratio is undefined and must never be computed | — |
| **BR-2.8** | The outcome enumeration is exactly `completed`, `skipped`, `unknown`. There is no fourth state, implicit or otherwise | Q7 |
| **BR-2.9** | Classification uses **only** the observation trail and the threshold parameter. No clock, no configuration read, no database access | FR-20 |
| **BR-2.10** | A single forward step never counts more listening than wall-clock time elapsed between the two observations | User, 2026-08-25 |

### BR-2.1 is the rule that replaced three rules

Measuring **listened time** rather than furthest position means engagement raises the ratio on its
own. Rewinding to re-hear a chorus adds listening time; a repeat listen pushes the ratio past 1.0.
No rewind rule, no replay branch, no preference judgement encoded in the classifier — the metric
does the work.

The earlier position-based definition could not do this: rewinding moved the position backwards,
so `max(progress)` was unchanged and a rewound play scored exactly as if the listener had stopped
at the peak.

**Ratios above 1.0 are meaningful, not errors.** A ratio of 2.4 says the track was heard nearly
two and a half times. Nothing clamps it, and analysis should treat it as the engagement signal it
is.

### BR-2.10 is accounting, not seek detection

Forward seeks are still not *detected* — that was dropped as effectively non-occurring. But
`listenedMs` sums forward progress, so an undetected forward seek would otherwise add its whole
jump as if it had been heard.

Capping each step at the wall-clock time between observations is a single `min()` that makes that
impossible: **you cannot listen to more audio than time has passed.** It costs one clamp, adds no
branch, and keeps the metric physically meaningful without any of the seek-detection logic that
was rejected.

### BR-2.2 takes precedence over BR-2.4 and BR-2.5

A track that reached 90% **and then** was paused or stopped is `completed`. The threshold was met;
what happened afterwards does not retract it. Without this precedence, pausing after a track
effectively ended would downgrade a genuine completion to `unknown`.

### BR-2.9 is the requirement that makes FR-20 real

If classification reads the clock or the current config, the same trail can produce different
verdicts on different days, and reclassification stops being reproducible. This is the rule most
likely to be broken accidentally and the least likely to be caught by a test.

### ⚠️ Accepted limitation — tracks under ~30 seconds

**Corrected 2026-08-25 while writing the tests.** The earlier wording said short tracks are
*consistently* mislabelled. That is wrong, and the truth is more awkward.

The last poll of a play lands somewhere in the final poll interval, so the observed ratio for a
fully-played track is `(duration − x) / duration` for some `x` in `(0, pollInterval]`. A track is
**guaranteed** to clear the threshold only when

```
duration  >=  pollInterval / (1 − threshold)     =  30 s at 3 s and 0.90
```

Below that, the outcome **depends on where the final poll happens to fall**:

| Track | Observed ratio range | Result |
|---|---|---|
| 20 s | 0.85 – 1.00 | **Sometimes `skipped`, sometimes `completed`** |
| 30 s + | ≥ 0.90 always | Always `completed` |

So the limitation is **intermittent, not systematic**. That is better in one way — not every short
track is mislabelled — and worse in another: **the same track, played identically, can be recorded
differently on different occasions**, purely from sampling alignment. An inconsistency of that kind
is harder to notice and harder to correct for than a uniform bias would be.

Accepted deliberately (Q6 = B). The trail is retained, so BR-4 reclassification can correct these
records. **Any analysis of short-form content must account for this**, and should say so wherever
such analysis is presented.

Both cases are pinned by tests, including the one showing the same duration resolving both ways.

---

## BR-3: Recording

| # | Rule | Source |
|---|---|---|
| **BR-3.1** | Every segmented play is recorded, whatever its outcome — including `unknown` | US-10 |
| **BR-3.2** | Enrichment is **snapshotted** at play time, never re-derived at read time | US-10 |
| **BR-3.3** | `isrc` is recorded whenever enrichment supplies it | US-10, U2 |
| **BR-3.4** | `skipSource` is `user` for every live-observed skip; `rule` is unreachable until U5 | US-13 |
| **BR-3.5** | `provenance` is `live` for observed plays, `backfilled` for reconstructed ones | US-12 |
| **BR-3.6** | Enrichment failure does not prevent recording — affected fields are `unknown` | US-07, US-10 |
| **BR-3.7** | A play and its trail are written in **one transaction**; a partial play is never visible | — |
| **BR-3.8** | A persistence failure degrades the app to display-only. It is logged once per failure class, surfaced in diagnostics, and **never crashes the app** | NFR-13 |
| **BR-3.9** | Plays lost to a persistence failure are recorded as a **counted gap**, never silently dropped | NFR-13 |

> **BR-3.9 matters more than it looks.** A silently dropped play is indistinguishable from "nothing
> was playing" — which is a *plausible* reading of the data and therefore an undetectable
> corruption. A counted gap keeps the dataset honest about what it does not contain.

---

## BR-4: Reclassification

| # | Rule | Source |
|---|---|---|
| **BR-4.1** | Any stored play with a retained trail can be reclassified without data loss | FR-20 |
| **BR-4.2** | Reclassification updates `outcome`, `evidence` and `classifierVersion`. **It never modifies observations** | FR-20 |
| **BR-4.3** | Reclassifying with unchanged logic and parameters must produce identical results | FR-20 |
| **BR-4.4** | Reclassification reports how many verdicts changed, and from what to what | FR-20 |
| **BR-4.5** | Plays with `provenance = backfilled` have no trail and are **never** reclassified | US-12 |

---

## BR-5: Backfill

| # | Rule | Source |
|---|---|---|
| **BR-5.1** | On startup, recent plays are fetched from `GET /me/player/recently-played` | US-12 |
| **BR-5.2** | A backfilled play is recorded with outcome **`unknown`** — the endpoint reports no progress and no outcome | US-12 |
| **BR-5.3** | Backfilled plays are **never** recorded as `completed`, whatever their apparent duration | US-12 |
| **BR-5.4** | Deduplication is by `(trackId, startedAt)` within a tolerance window | US-12 |
| **BR-5.5** | A live-observed play always wins over a backfilled duplicate | US-12 |
| **BR-5.6** | Backfill failure is non-fatal; the app starts regardless | NFR-18 |

> **BR-5.3 is a guard against the most tempting shortcut here.** `recently-played` only returns
> tracks Spotify considered played, which invites treating them as completions. It reports no
> progress data, so that would be an inference dressed as an observation — and it would inflate
> the completion rate exactly in the periods when the app was not running.

---

## BR-6: Export

| # | Rule | Source |
|---|---|---|
| **BR-6.1** | Export supports CSV and JSON | FR-49 |
| **BR-6.2** | Export includes **every** recorded field, including all evidence | FR-50 |
| **BR-6.3** | `unknown` renders as a distinct token — **never blank, zero, or false** | FR-51 |
| **BR-6.4** | Coverage counts accompany every export: total plays, and counts of `unknown` per nullable field | FR-51 |
| **BR-6.5** | Every row carries `provenance` and `skipSource` | FR-54 |
| **BR-6.6** | Incremental export by `startedAt >= T` is supported | FR-52 |
| **BR-6.7** | Export is delivered as a file download from the local UI, in one action | FR-53 |
| **BR-6.8** | Export **streams**; it never buffers the full result set | US-25 |
| **BR-6.9** | Export never mutates history and never blocks recording | US-25 |
| **BR-6.10** | Filters are validated and readability confirmed **before** the first byte is sent | — |

> **BR-6.3 and BR-6.4 are what make R2 measurable downstream.** An `unknown` exported as an empty
> CSV cell is invisible in a spreadsheet — and because the missing data is correlated with the
> variable being measured, invisibility there biases every conclusion built on it. The coverage
> counts exist so the size of that gap is a number rather than an assumption.

---

## Edge cases

| Scenario | Expected behaviour | Rule |
|---|---|---|
| Track changes after one observation | Play recorded; `skipped` if below threshold | BR-1.5, BR-2.3 |
| Same track queued twice in a row | **One play**, ratio ≈ 2.0, `completed` | BR-1.3, BR-2.1 |
| Rewind mid-track, then keep listening | Same play; the re-listened time counts again, raising the ratio | BR-2.1 |
| Rewind at 40%, re-hear 20–40%, then skip | Same play; ratio ≈ 0.60 ⇒ **`skipped`**. See note below | BR-2.1 |
| Track on repeat for an hour | One play, large ratio, `completed` | BR-1.3 |
| Seek forward past 90% | Step capped at elapsed wall time, so it adds almost nothing | BR-2.10 |
| Track paused at 95%, never resumed | `completed` — threshold precedence | BR-2.2 |
| Track paused at 40%, never resumed | `unknown` | BR-2.4 |
| Device switched off mid-track | `unknown` | BR-2.5 |
| `duration_ms` reported as 0 | `unknown`; no ratio computed | BR-2.7 |
| Duration changes mid-play | Per-observation duration preserved; latest used for the ratio | BR-2.1 |
| Enrichment fails entirely | Play recorded with `unknown` fields | BR-3.6 |
| Database locked | Degrade to display-only; count the gap | BR-3.8, BR-3.9 |
| App restarts mid-track | In-progress play flushed as `unknown` | BR-2.6 |
| 20-second interlude played fully | **`skipped`** — accepted limitation | Q6 = B |
| Clock changes (DST, NTP) | Timestamps are UTC; gaps computed from monotonic deltas where available | — |

> ### One residual case, recorded rather than ruled on
>
> Listened-time raises a rewound play's ratio; it does not **guarantee** the play clears 0.90.
> Rewinding at 40%, re-hearing 20–40%, then moving on gives a ratio of about 0.60 — still
> `skipped`, despite the rewind having been a moment of interest.
>
> No rule is added for this, deliberately. The premise *"a rewind means I like it"* is a statement
> about intent, and encoding it in the classifier would put a preference judgement back into what
> is otherwise a record of observations — the exact thing removing BR-2.10 achieved.
>
> The case is also arguably classified correctly: the listener heard 60% of the track and chose to
> leave. If it later proves to matter, `rewound` is retained as evidence and the trail is intact,
> so reclassification can revisit it (FR-20) without re-collecting anything.

---

## Property-test targets (NFR-22)

Invariants the classifier must satisfy for **all** trails, not just the examples above:

| # | Property |
|---|---|
| P-1 | `classify` is total — never throws, for any trail including empty and single-element |
| P-2 | The outcome is always one of exactly three values |
| P-3 | `completionRatio >= 0` always. **It is not bounded above** — repeat listening legitimately exceeds 1.0 |
| P-3b | `listenedMs` never exceeds the play's wall-clock span, for any trail (BR-2.10) |
| P-4 | `classify(trail)` is deterministic: same trail and parameters ⇒ same verdict, always |
| P-5 | `listenedMs` counts only forward movement; a backward jump never decreases it |
| P-6 | A trail reaching ≥ 90% never classifies as `skipped`, regardless of what follows |
| P-7 | A trail whose listened time never reaches 90%, ending in a track change, never classifies as `completed` |
| P-11 | A trail with `rewound = true` **never** classifies as `skipped`, for any progress sequence |
| P-8 | Reclassifying a trail with unchanged parameters is idempotent |
| P-9 | No observation is mutated by classification |
| P-10 | Export renders `unknown` distinguishably from every legitimate value, for every field type |
| P-11 | Adding a rewind followed by re-listening to any trail **never decreases** its `completionRatio` |

**P-11 is the property that replaces the deleted rewind rule.** It states formally what makes the
special case unnecessary: engagement can only move the ratio upward. If that ever stops holding,
the simplification is unsound and explicit rewind handling has to come back.

**P-3 is the one most likely to be got wrong**, because clamping a ratio to 1.0 looks like
defensive hygiene. Here it would destroy the repeat-listen signal — the difference between "heard
it once" and "heard it four times" is exactly what the unclamped ratio carries.
