# The Phase 2 Hypothesis Gate — Result (CONFIRMATORY)

**Run**: 2026-09-10 · **Corpus**: 427 plays · **Runner**: `scripts/hypothesis-gate.mjs`
**Pre-registration**: [`pre-registration.md`](pre-registration.md), committed at `fd09ad7`,
**five days and 240 plays before** this analysis was computed.

> 🔒 **This is the single confirmatory evaluation permitted by BR-11.7.** The minimum was first
> met on this run. Under the pre-registration's stopping rule, any later run is **exploratory**
> and cannot discharge the Phase 2 gate.

---

## ⚖️ Outcome: **R1 IS NOT SUPPORTED**

| Condition (BR-11.6a) | Required | Actual | |
|---|---|---|---|
| Eligible plays, `major` | ≥ 50 | **76** | ✅ |
| Eligible plays, `independent` | ≥ 50 | **116** | ✅ |
| Skips in the eligible set | ≥ 10 | **17** | ✅ |

### The primary comparison

| Group (latest release verdict) | n | skipped | completed | skip rate |
|---|---|---|---|---|
| `major` | 76 | 7 | 69 | **9.2%** |
| `independent` | 116 | 10 | 106 | **8.6%** |
| `unknown` *(BR-11.2)* | 125 | 13 | 112 | 10.4% |

**Difference (major − independent): +0.6 percentage points.**
**95% CI: [−7.7%, +8.9%] · z = 0.141 · p = 0.888 · NOT SIGNIFICANT at α = 0.05.**

The direction is nominally the one R1 predicts. It is **six-tenths of a percentage point** on a
confidence interval nearly thirty times as wide. There is no effect here.

---

## What this does and does not establish

**It does not mean R1 is false.** It means the effect, if any, is **smaller than this instrument
can resolve** — and the pre-registration said so in advance, before any number was seen:

> The honest position is that this gate can find a **strong** effect or nothing, and if R1's
> effect is subtle this instrument will never resolve it.

The CI is the honest statement of what has been ruled out: a difference larger than roughly
**±8 percentage points**. Against a ~9% baseline that excludes effects of about **2× or greater**.
It excludes nothing smaller. An effect of 8.6% vs 12% is entirely compatible with this result and
would need several hundred plays per group to see.

⚠️ **The baseline came in far below the design assumption, and that costs power.** The
pre-registration's power table assumed a 10–20% baseline skip rate; the observed rate is **8.9%
pooled**, at the bottom of that range. Skips are rarer than the design anticipated, so n = 50 per
group buys less resolution here than the table implied.

## The `unknown` group (BR-11.2), reported unconditionally

At **10.4%**, the unknown group does not resemble the `independent` group more than the `major`
group — it sits marginally above both. The pre-registration expected this comparison to be *"the
single most informative available check"* on R2's coverage bias, on the reasoning that unknowns
are predominantly uncatalogued independents. **That check returns nothing either**: all three
groups are within 1.8 points of one another. Consistent with the primary result — nothing in this
corpus separates skip behaviour by label verdict at all.

## Coverage (BR-11.3)

| | plays |
|---|---|
| eligible | 192 |
| verdict `unknown`, reported alongside | 125 |
| no trail **and** no ISRC (backfilled) | 82 |
| no measurable outcome | 28 |
| **corpus** | **427** (342 live, 85 backfilled) |

Label coverage among ISRC-bearing plays: **pre-2022 56%**, **2022+ 60%**. ⚠️ Note this **does not
reproduce** the recency bias recorded twice before (open item 3b: 86% → 44%, and 100% → 43%). On
this larger corpus the gap has closed and mildly inverted. The earlier measurements were taken
over far fewer plays; **open item 3b should be treated as unsettled again, not as confirmed.**

---

## ⚠️ Threats to this result, stated rather than buried

1. **Open item 4 — the crossfade confound is NOT resolved and rides along with this number.**
   Twelve of the thirty skips sit at ratio 0.80–0.90, immediately below the completion threshold.
   The threshold is proportional over a constant-time effect, and majors run ~30% longer, so an
   identical crossfade costs independents more ratio. That biases the outcome variable *by the
   grouping variable*, in the direction that would **inflate** the independent skip rate — i.e.
   **against** R1. A correction here could only move the result toward R1, not away from it. It is
   fully correctable retroactively because trails are retained (FR-20).
2. **W-3 — session ends are not the explanation.** Probed immediately before this run: all 30
   skips close on `track-change` and all 30 have a successor within 30 seconds; every session end
   in the corpus landed on `completed` or `unknown`. This confounder is **absent from the corpus**,
   not merely assumed away.
3. **One listener, 17 skips, 21 days.** The unit of analysis is a play, but the skips are not
   independent draws — they come from a handful of listening sessions with their own moods and
   contexts. The nominal CI is optimistic.
4. **Open item 7 — playback context is still unrecorded.** Every eligible play came through the AI
   DJ, but `context_type` is NULL throughout, so "promoted into the feed" is not directly observed
   anywhere in this test. The gate tests the *proxy's observable consequence*, as §1 stated.

## Provenance note — a computation was added to the runner after the sufficiency check

`scripts/hypothesis-gate.mjs` computed group rates and the BR-11.6a sufficiency check, but **never
implemented the two-proportion test and CI that pre-registration §2 requires** — earlier revisions
stopped there because the outcome was fixed at "insufficient data" and the statistic could not be
needed. It was added on 2026-09-10, in the same session as this run, **after** the group rates were
visible.

Recorded plainly because the ordering matters and hiding it would be worse: **MIN_PER_GROUP,
MIN_SKIPS, the eligibility predicate and the grouping were not touched.** The added formula is the
standard two-sided two-proportion test named in §2 and has **no free parameters** — there was no
degree of freedom available to tune after seeing the data. The commit history carries the ordering.

---

## Consequence for the project

**The Phase 2 gate is discharged.** R1 is recorded as **not supported at the resolvable effect
size**, and it must not be quietly re-tested later hoping for a different answer — that is exactly
what BR-11.7 forbids.

This was **designed to be survivable**, and it is:

> **This does not gate U3.** Rules are user-authored; they must be valuable *without* R1 being
> settled. Design U3 on that assumption.

That instruction was written before the result and stands unchanged. The label enrichment built in
U2 remains a legitimate rule *input* — a user may still write "skip major-label releases" and have
it work — it is simply no longer backed by evidence that it predicts **this** listener's skips.

**R1 was built so it could be disconfirmed. It was, and the design held.**
