# The Phase 2 Hypothesis Gate — Pre-Registration

**Written**: 2026-09-05 · **Stage**: CONSTRUCTION — Phase 2 exit gate (BR-11)
**Status**: 🔒 **PRE-REGISTERED — written before the comparison was computed**

> This document fixes the analysis **before any result is seen**. That is BR-11.1, and it is the
> single thing standing between a hypothesis test and a rationalisation. It is committed to git as
> its own commit, ahead of the commit carrying any result, so the ordering is a fact on the record
> rather than a claim in prose.
>
> **At the time of writing, only marginals had been queried** — group sizes, verdict counts,
> coverage by year, the total skip count across the corpus. The skip rate *by verdict group* — the
> quantity this gate turns on — had not been computed and was not known.

---

## 1. The hypothesis under test (R1)

From `CLAUDE.md`, unchanged:

> Estimate the likelihood that a track was **promoted** into the feed rather than selected because
> it fits the user's profile — on the hypothesis that signed-artist placements are
> disproportionately paid promotion, and therefore likelier to be **disliked**.

Signed-vs-independent is a **proxy**. The gate tests the proxy's observable consequence, not the
promotion mechanism itself, which is not visible from any available API.

**The directional prediction, stated in advance**: if R1 holds, plays with a `major` label verdict
are **skipped at a higher rate** than plays with an `independent` verdict.

The test is **two-sided** regardless. A significant effect in the opposite direction is a real
finding about this listener and is recorded as such, not discarded as noise.

---

## 2. The primary comparison (BR-11.1, BR-11.1a)

**Outcome variable**: `outcome ∈ {completed, skipped}` as written by `outcomeClassifier` at the
`classifier_version` in force, derived from the retained observation trail.

**Grouping variable**: the **latest release-level** label verdict (BR-11.1a, BR-13.6), restricted
to `major` and `independent`.

**Statistic**: skip rate per group — `skipped / (skipped + completed)` — compared with a two-sided
two-proportion test at α = 0.05, reported with both group counts and a confidence interval on the
difference.

### Eligibility — fixed now, not chosen later

| Included | Excluded | Why |
|---|---|---|
| `outcome ∈ {completed, skipped}` | `outcome = 'unknown'` | No trail, no measurable outcome |
| `label_verdict ∈ {major, independent}` | `unknown` | Reported **alongside**, per BR-11.2 (§4) |
| `skip_source IS NULL` or `'user'` | `skip_source = 'rule'` | BR-11.4 — the instrument must not measure itself |
| — | `provenance = 'backfilled'` | **Structurally ineligible**, see below |

**Backfilled plays can never enter this gate.** They carry no observation trail, so
`outcome = 'unknown'`; and `recently-played` returns no `external_ids`, so they carry no ISRC and
therefore no release-level verdict (open item 3). They fail eligibility twice over. This is
recorded here so that their exclusion is a structural fact stated in advance, not a judgement made
after seeing which way they pushed the number.

---

## 3. Minimum sample (BR-11.6) — stated in advance

> ### The gate reports a verdict **only** when both of these hold:
>
> 1. **n ≥ 50** eligible plays in **each** of the `major` and `independent` groups; **and**
> 2. **≥ 10 skips** in the combined eligible set.
>
> Below either, the gate reports **"insufficient data"** — not a weak verdict, not a trend, not a
> direction. There is no intermediate category.

### Where 50 comes from

A design calculation, run on no project data. Two-sided two-proportion test, α = 0.05,
power = 0.80. The cell values are the second group's skip rate that could just be detected:

| Baseline skip rate | n = 25/group | **n = 50/group** | n = 100/group | n = 200/group |
|---|---|---|---|---|
| 10% | 44% | **33%** | 25% | 20% |
| 15% | 51% | **40%** | 32% | 26% |
| 20% | 58% | **46%** | 38% | 32% |

Read across: at n = 50 per group and a ~15% baseline, the smallest difference detectable at 80%
power is roughly **15% vs 40%** — a 2.7× relative effect.

That is a **large** effect, and choosing it is a deliberate, stated admission of what this
instrument can and cannot do. Detecting 15% vs 25% would need **250 per group**; 15% vs 30% needs
**121**. At the observed live capture rate — two sessions producing ~18 usable plays each — those
are many months of listening away. The honest position is that this gate can find a **strong**
effect or nothing, and if R1's effect is subtle this instrument will never resolve it. Saying so
now is worth more than discovering it afterwards.

### The second condition exists because n alone is not enough

Fifty plays per group with two skips between them carries no information regardless of n. The skip
floor is a floor on **outcome variance**, and it is the condition more likely to bind here.

### Stopping rule — no repeated peeking

The gate is evaluated **once**, when the minimum is first met. Testing repeatedly as data accrues
inflates the false-positive rate, and a pre-registration that permits it is not one. Any evaluation
after the first is labelled **exploratory** in `audit.md` and cannot discharge the Phase 2 gate.

Running the gate **below** the minimum does not consume the single confirmatory run: the output is
fixed at "insufficient data" by the rule above and cannot be a verdict either way.

---

## 4. Reported alongside, always (BR-11.2, BR-11.3)

Not optional, and not contingent on the result.

1. **The `unknown` group's skip rate**, reported with the other two. If it resembles the
   `independent` group, that is evidence about *who the unknowns are* — consistent with them being
   predominantly independent releases MusicBrainz has not catalogued. It is the single most
   informative available check on the coverage bias measured in R2.
2. **Coverage counts** — eligible, ineligible, and why.
3. **The by-year breakdown** of label coverage, which is where the recency bias (open item 3b:
   pre-2022 100%, 2022+ 43%) is visible. An aggregate number hides it; broken out by year it is
   unmissable.

---

## 5. Robustness checks — specified now, so they cannot be a rescue later

Each is reported whenever the gate produces a verdict. Pre-registering them is what stops a
disagreeing primary result from being re-cut until it agrees.

| # | Check | Threat it addresses |
|---|---|---|
| **R-A** | Repeat with the **as-of-play artist-level** verdict as the grouping variable, and with the alternative reading of each level (as-of-play release, latest artist) | BR-11.1a — the two levels disagree on 20 plays, so the split must not become a hidden researcher choice |
| **R-B** | Recompute `outcome` from the retained trails at completion thresholds **0.85 / 0.90 / 0.95**, and under a **constant-time** rule (ended within *k* seconds of track end) | **Open item 4 — the crossfade confound.** A proportional threshold over a constant-time effect penalises short tracks; majors run ~30% longer here, so the outcome variable may be biased *by the independent variable*. The constant-time rule is the one that does not have this shape |
| **R-C** | Repeat at **distinct-track** level, one row per `track_id` | 145 plays cover 95 distinct tracks; repeated plays are not independent observations |
| **R-D** | Report the `unknown` group's skip rate against both named groups | R2 coverage bias (§4.1) |

**R-B is the one that matters most**, and it is pre-registered *because* the confound was
identified before any result was seen (2026-09-02). Trails are retained under FR-20 precisely so
this recomputation is possible, and this is the third time that decision has paid for itself.

**If R-B materially changes the answer, the primary result does not stand.** Stated here, in
advance, rather than argued afterwards.

---

## 6. What the gate does **not** decide

The gate does not gate U3. The rules engine evaluates **user-authored** rules; its value does not
depend on R1 being true, and Phase 3 precedes Phase 4 for risk containment, not because it waits on
this result. What the gate informs is *which fields U3's rules will want to threshold on* — which
is why the execution plan says Phase 3 should be **designed after** the gate, not **blocked by** it.

A disconfirmation would be a genuine finding about this listener, and the project is explicitly
built to be able to produce one.

---

## 7. Recording (BR-11.5)

The outcome is appended to `audit.md` **either way** — support, disconfirmation, or insufficient
data. That commitment is the project's stated position that R1 is a hypothesis to be *tested*.
