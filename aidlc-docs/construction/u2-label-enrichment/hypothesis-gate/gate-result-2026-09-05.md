# The Phase 2 Hypothesis Gate — Result

**Run**: 2026-09-05 · **Corpus**: 145 plays · **Runner**: `scripts/hypothesis-gate.mjs`
**Pre-registration**: [`pre-registration.md`](pre-registration.md), committed at `fd09ad7`
**before** this analysis was computed.

---

## ⚖️ Outcome: **INSUFFICIENT DATA** (BR-11.6)

Not a weak verdict. Not a trend. Not a direction. The pre-registered minimum is not met, and
under BR-11.6a there is no intermediate category.

| Condition (BR-11.6a) | Required | Actual | |
|---|---|---|---|
| Eligible plays, `major` | ≥ 50 | **8** | ❌ short by 42 |
| Eligible plays, `independent` | ≥ 50 | **13** | ❌ short by 37 |
| Skips in the eligible set | ≥ 10 | **4** | ❌ short by 6 |

Per **BR-11.7**, this run is **not** the single confirmatory evaluation. The Phase 2 gate remains
open, and the criterion that will decide it is already fixed and on the record.

---

## The numbers, which are **not** a result

Recorded because BR-11.2 and BR-11.3 make the accompanying figures unconditional, and because
concealing them would be worse than reporting them with the caveat attached. **Four skips across
the entire eligible corpus.** Every rate below is one or two events wide; moving a single play
between groups swings them by ten points or more.

| Group (latest release verdict) | n | skipped | completed | skip rate |
|---|---|---|---|---|
| `major` | 8 | 2 | 6 | 25.0% |
| `independent` | 13 | 2 | 11 | 15.4% |
| `unknown` *(BR-11.2)* | 14 | 1 | 13 | 7.1% |

The ordering is nominally the direction R1 predicts. **It is worth nothing.** Two skips against
two skips is indistinguishable from a coin, and the pre-registration exists precisely so that this
observation cannot be promoted into support later. It is written down here so that a future run
cannot claim the criterion was met all along.

No test statistic is quoted. At these counts a p-value would lend arithmetic authority to noise.

### The `unknown` group did not behave as BR-11.2 anticipated

The pre-registration reasoned that if the `unknown` group's skip rate **resembled** the
`independent` group's, that would be evidence the unknowns are predominantly uncatalogued
independent releases. Observed, it sits **below both** named groups (7.1%).

That is not yet evidence of anything — n = 14 with a single skip — but it is the first
observation pointing away from the assumed composition of the unknowns, and it is the check the
pre-registration named as the most informative available on R2. Worth watching as the sample
grows rather than concluding from now.

---

## ⚠️ A denominator trap, caught in this run

The first version of the coverage report folded **two different causes** of a missing verdict into
one number:

1. **No ISRC.** `recently-played` returns no `external_ids`, so all 104 backfilled plays lack one
   (open item 3). This is a **Spotify** artefact and says nothing about MusicBrainz.
2. **ISRC present, MusicBrainz has no label.** This is the actual R2 coverage measure.

The backfill is heavily weighted to recent releases, so folding cause 1 into the denominator makes
MusicBrainz look far worse on recent music than it is:

| | Conflated (wrong) | Corrected — ISRC-bearing plays only |
|---|---|---|
| pre-2022 | 12/43 = 28% | **12/14 = 86%** |
| 2022+ | 12/102 = 12% | **12/27 = 44%** |

**This is the `inc=releases` shape again**, the one CLAUDE.md warns is the dangerous one: a wrong
denominator produces a plausible number that reads as a coverage finding rather than a bug. It
would have been recorded as "MusicBrainz coverage has collapsed to 12% on recent music" and
believed.

### The corrected measure independently confirms open item 3b

| | Research probe, ad-hoc (2026-08-26) | This run, shipped code (2026-09-05) |
|---|---|---|
| pre-2022 | 100% | **86%** (12/14) |
| 2022+ | 43% | **44%** (12/27) |

The 2022+ figure reproduces almost exactly on a larger, differently-composed corpus. The
recency-biased coverage gap is **real and stable**, not an artefact of the original probe's
sample — and it remains concentrated on precisely the recent independent releases R1 is about.

The pre-2022 drop from 100% to 86% is two misses (2017, 2019) at n = 14; it needs no explanation
beyond sample size yet.

---

## Coverage accounting (BR-11.3)

| Plays | Disposition |
|---|---|
| 104 | **Structurally ineligible** — backfilled: no trail *and* no ISRC (pre-registration §2) |
| 14 | Verdict `unknown` — reported alongside, not in the comparison |
| 6 | No measurable outcome (live, still open or unclassified) |
| **21** | **Eligible** — the comparison above |
| **145** | Total corpus |

**Only 14% of the corpus can enter this gate**, and that ceiling is structural rather than a
matter of waiting: the 104 backfilled plays will never become eligible, because neither the
missing trail nor the missing ISRC is recoverable from `recently-played`.

---

## What reaching the threshold would take

Per live play observed so far: P(eligible ∧ `major`) ≈ 8/41 = 0.20, P(eligible ∧ `independent`)
≈ 13/41 = 0.32.

| To satisfy | Additional live plays needed |
|---|---|
| `independent` ≥ 50 | ≈ 117 |
| **`major` ≥ 50** | **≈ 215 — the binding constraint** |
| ≥ 10 skips | ≈ 31 more eligible plays — reached long first |

So roughly **215 more live plays**, and the `major` group is what gates it. At the observed rate
of ~20 usable plays per listening session, that is on the order of **11 more sessions** with the
app running.

**The real bottleneck is session count, not listening.** Live capture has run on exactly two days
— 2026-08-26 and 2026-09-02 — because the app only records while it is running. Nothing about
this gate progresses on days the app is not started.

Two things would move it materially, neither of which is proposed here:

- **Spending 47 `GET /tracks/{id}` calls to recover ISRCs for the backfill** (open item 3) would
  give those plays a label verdict — but *not* an outcome, since the trail is what they lack. It
  would improve label coverage statistics and would **not** add a single eligible play to this
  gate. Worth knowing before spending the calls.
- Running the app routinely during normal listening.

---

## What this result does **not** do

It does not gate U3 (pre-registration §6). The rules engine evaluates **user-authored** rules;
its value does not depend on R1 being true. Phase 3 was sequenced ahead of Phase 4 for risk
containment, and the execution plan asks that Phase 3 be *designed after* the gate — which it now
has been, with the honest input that **the hypothesis is currently untested and the instrument is
several months of listening away from being able to test it.**

That is itself a useful design input for U3: rules must be authorable and valuable to the user
**without** R1 being settled.
