# Functional Design Plan — U2: Label Enrichment

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Functional Design, Unit U2
**Unit**: [`../../inception/application-design/unit-of-work.md`](../../inception/application-design/unit-of-work.md) (U2)
**Stories**: US-08, US-09 · **Requirements**: FR-12–16, NFR-14–16
**Also in scope** (added 2026-08-26 by decision): liked-status transitions — see Q8

---

## Unit context

U2 supplies the **independent variable** of the promotion hypothesis, as U1 supplied the outcome
variable. Its exit criterion is not "a label is displayed" but **"R1 has been tested and the result
recorded either way"** — this unit exists to make the hypothesis answerable.

**MusicBrainz was probed live for the first time on 2026-08-26**, against the 19 distinct ISRCs
actually in `history.db`. Full results: `research-findings.md` **Part 5**. Every question below is
grounded in that measurement rather than in documentation — and three of them exist *only* because
of what the probe found.

### The four findings that drive these questions

1. **End-to-end label coverage is 58 %** (11/19), and the misses are **not random**: 100 % of
   pre-2022 releases resolved, versus **43 % of 2022-onward**. R2 is now measured. The missing rows
   are recent independent releases — the population the hypothesis is about.
2. **"The label" is not a single value.** Audioslave → 44 releases → 10 labels spanning **two
   different majors** (Epic/Sony *and* Interscope/Universal). Slipknot → 50 releases → 12 labels.
3. **The three FR-13 signals all exist and genuinely disagree.** Spinefarm's relationships point at
   an *independent* distributor while Spinefarm is Universal-owned. R3, on real data.
4. **Search fallback misattributes.** For Ren's *Starry Night Act III*, the two top-scoring hits
   (score 100) are **different tracks**; the near-correct one scores 95.

> **The thread running through all of it**: this unit's failure mode is not missing data, which is
> visible in the coverage counts. It is **confident wrong data**, which is not.

---

## Questions

### Question 1 — Which release's label counts?

A recording maps to many releases — pressings, countries, reissues — carrying different labels.
Spotify tells us `album_name` and `release_date`, so we can narrow. Measured on the 13 resolved:

| Strategy | Fires on | Effect |
|---|---|---|
| Album title **and** exact date | **8 / 13** | Precise (Audioslave 44 → 1) but silent on year-only dates and deluxe editions |
| Album title only, normalised | **13 / 13** | Slipknot 50 → **1 → Roadrunner Records** (correct) |
| All releases of the recording | 13 / 13 | Every label anyone ever pressed it under |

A) **Cascade** — title+date, else title-only, else all releases. Always produces a candidate set,
   narrowest available. Record which tier fired, so precision is queryable

B) **Title+date only** — refuse to guess when it does not match; those become `unknown`.
   Highest precision, drops coverage from 58 % to ~42 %

C) **All releases, always** — never narrow; let classification see everything and vote

D) **Cascade, but stop at title-only** — never fall through to "all releases"

[Answer]:

---

### Question 2 — When the candidate releases disagree, what is the label?

Even after narrowing, disagreement persists. Audioslave's single title+date match carries **Epic
*and* Interscope** — Sony and Universal on the same release. NF's *The Search* carries NF Real
Music (artist's own), Capitol, and Caroline.

Note the NF case is not really disagreement: an artist imprint distributed by a major is *one
arrangement*, and "NF Real Music" alone would read as independent, which is misleading.

A) **Store every label, classify the set** — the record holds a label *list*; the verdict is
   derived from all of them. Consistent with "store observations, derive judgements"

B) **Pick one by precedence** (e.g. most frequent, or the `Original Production` type) and store it
   plus the alternatives as context

C) **Store every label and mark the record `contested`** when the majors disagree with each other,
   so those rows can be excluded from analysis explicitly

[Answer]: 

---

### Question 3 — Use search fallback for the ISRCs MusicBrainz does not know?

Six of 19 ISRCs 404. An artist+title search recovers **2 cleanly**, finds 1 with no releases
(useless), misses 2 — and returns a **confident wrong track** for the sixth, where `score` ranked
two unrelated recordings above the right one.

A) **No fallback.** ISRC or `unknown`. One join key, exact, no misattribution possible.
   Coverage stays at 58 %

B) **Fallback, but only on an unambiguous single hit** — `count == 1` and exact normalised
   artist+title match. Would have recovered BOVSKI and Prof, and correctly refused Ren (count=7).
   Coverage → ~68 %

C) **Fallback on best score above a threshold** — highest recall; would have taken the wrong Ren
   track

D) **Fallback, and record the match method** (`isrc` vs `search`) on the row, so analysis can
   exclude searched matches

[Answer]: 

---

### Question 4 — `[no label]` is an explicit MusicBrainz value. Is it `independent` or `unknown`?

Two of 19 (Imminence, Red Leather) resolve to a release whose label is the sentinel `[no label]` —
MusicBrainz asserting *there was no label*, which is different from not knowing. Under the
project's `null`-means-unknown discipline this is a real fork.

A) **`independent`, with a distinct provenance marker** — a self-released track is the clearest
   possible independent case, and treating it as unknown discards a true positive from the small
   independent sample

B) **`unknown`** — conservative; `[no label]` may equally mean "nobody filled this in"

C) **A third value, `self-released`**, distinct from both

[Answer]: 

---

### Question 5 — `Publisher`-typed entries are not record labels. Exclude them?

MusicBrainz types labels `Imprint`, `Original Production`, `Distributor`, `Publisher`, or null.
Faouzia's *only* label is **`Faouzia Music`, type `Publisher`, disambiguation `SOCAN`** — a
publishing entity. Faouzia records for Atlantic. Taken at face value it produces a confident
**"independent"** verdict that is wrong.

This matters directionally: majors routinely use publishing subsidiaries, so including publishers
**over-counts independence in precisely the direction that would falsely support the hypothesis.**

A) **Exclude `Publisher` entirely**; if nothing else remains, the label is `unknown`. Faouzia would
   become `unknown` — correct, since MusicBrainz genuinely does not know her label

B) **Include, but record the type** so it can be filtered downstream

C) **Exclude `Publisher`, and also treat `Distributor` as a weaker signal** than
   `Imprint` / `Original Production`

[Answer]: A - and in general we should prioritize accuracy in the "Artist Is Independant" determination even if it ultimately misses some independant products. 

---

### Question 6 — What does FR-13's "explicit confidence" mean concretely?

FR-13 requires a confidence alongside major/independent/unknown. The probe shows what drives it:
how many signals fired, whether they agreed, and which tier of Q1's cascade matched.

A) **Ordinal band** — `high` / `medium` / `low`, derived from signal agreement. Readable, easy to
   filter, no false precision

B) **Numeric score 0–1** — sortable and threshold-able in external analysis, but invites reading a
   precision that three disagreeing heuristics do not have

C) **No scalar at all** — store only the per-signal votes and let analysis decide. Maximally
   honest; every consumer must then implement its own rollup

D) **Ordinal band *and* the raw votes** — band for the UI and rules, votes for analysis

[Answer]: A - we shouldn't imply precision that doesn't exist.

---

### Question 7 — Backfill: spend 47 Spotify requests to recover missing ISRCs?

47 of 71 recorded plays are backfilled from `recently-played`, which returns no `external_ids`, so
they have no ISRC (open item 3). `GET /tracks/{id}` would recover them — a one-off 47 requests,
trivially within quota.

The catch: those plays' outcomes were **inferred** at backfill, not observed. Enriching them adds
label data to the rows with the *weakest* outcome variable.

A) **Yes, backfill ISRCs** — data already collected, cheap to complete, and `provenance` already
   marks them so analysis can exclude them

B) **No** — backfilled rows are already second-class; leave them label-less rather than spend
   requests making weak rows look complete

C) **Yes, and re-run label resolution for every historical row** whenever the classifier changes

[Answer]: 

---

### Question 8 — Liked-status: when is `likedAtEnd` sampled?

Agreed 2026-08-26: four states plus `unknown`, stored as evidence (`likedAtStart` / `likedAtEnd`),
enum derived. One functional detail is unresolved — **liking often happens a beat *after* a track
ends**, especially if the user reaches for the phone. Sampling at the exact play boundary would
record that as `kept-unliked` and lose the strongest positive signal available.

`GET /me/tracks` page 1 gives an exact `added_at`, so a like is *provably* attributable to a
window rather than inferred.

A) **Sample at play close, plus a short grace window** (e.g. re-check ~30 s later and attribute by
   `added_at` if it falls at or after play start). Catches the common case; play record is written
   once, then amended

B) **Sample at play close only** — simplest, no deferred write, undercounts `liked-during`

C) **Sample at close, and attribute by `added_at` against the play window on the *next* play's
   refresh** — no timer, no extra request, slightly later attribution

[Answer]: 

---

### Question 9 — What is the hypothesis gate's decision criterion?

The Phase 2 exit criterion is *"hypothesis tested against exported data; result recorded either
way."* Deciding **now** what would count as support — before seeing results — is what keeps the
gate meaningful rather than retrofitted.

At 58 % coverage with recency-correlated missingness, a naive skip-rate comparison between
`major` and `independent` is confounded: `unknown` is disproportionately new independent music.

A) **Pre-register a specific comparison** — e.g. skip rate for `major` vs `independent` among plays
   with a *known* label, reported with coverage counts and a stated minimum sample

B) **Descriptive only** — export, look, and record the judgement in `audit.md` without a
   pre-committed test

C) **Pre-register, and additionally require the `unknown` group be reported alongside**, since a
   skip rate for unknowns that resembles independents is itself evidence

[Answer]: 

---

## Recommendations

- **Q1 = A (cascade, recording which tier fired).** B's precision is attractive but it discards
  coverage in a unit that already only has 58 %, and it fails on year-only dates — a Spotify
  formatting artefact, not a data problem. The cascade's tier is itself a useful confidence input.
- **Q2 = A, with C's `contested` marker.** The project's established split — store observations,
  derive judgements — applies directly. The Audioslave case (two majors on one release) is real and
  should be visible, not resolved by a tiebreak rule invented here.
- **Q3 = B, combined with D.** The Ren result is the argument: `score` does not rank correctness,
  so any threshold rule will occasionally be confidently wrong, and a wrong label is invisible
  downstream while `unknown` is counted. `count == 1` plus exact match is the only fallback the
  probe showed to be safe, and recording the match method costs one column.
- **Q4 = A.** `[no label]` is an assertion, not an absence, and the independent sample is small
  enough that discarding true positives is costly. The provenance marker preserves the ability to
  reverse this.
- **Q5 = C.** Excluding publishers is clearly right — Faouzia is the proof. Distributor deserves
  the weaker weighting too: `broke` is genuinely independent, but a distributor prefix says nothing
  about whether a deal exists behind it.
- **Q6 = D.** The rules engine (U3) needs something simple to compare against; analysis needs the
  votes. B is the one to avoid — 0.73 implies a calibration these heuristics do not have.
- **Q7 = A.** The data is already collected and `provenance` already marks it. Declining to spend
  47 requests would be a strange economy given the project's stance that history cannot be
  regenerated.
- **Q8 = A.** `liked-during` is described in the research as the strongest positive signal the
  Spotify API can yield; B forfeits most of it to save a timer. `added_at` makes the attribution
  provable rather than assumed, which is what makes the grace window safe.
- **Q9 = C.** This is the honest version. Pre-registration is what stops the gate becoming a
  post-hoc rationalisation, and given measured recency bias, reporting the `unknown` group is not
  optional — if unknowns skip like independents, that is evidence about who the unknowns *are*.

---

## Answers — Round 1 (2026-08-26)

User answered Q5 and Q6 explicitly and instructed: *"if I didn't enter a value use the recommended
value for that question."*

| Q | Answer | Source |
|---|---|---|
| Q1 Release narrowing | **A** — cascade, record which tier fired | recommended default |
| Q2 Disagreeing labels | **A + C** — store every label, mark `contested` | recommended default |
| Q3 Search fallback | **B + D** — single unambiguous hit only, record match method | recommended default |
| Q4 `[no label]` | **A** — treat as `independent` | recommended default — **⚠️ see Q10, this is now withdrawn** |
| Q5 Publisher entries | **A** — exclude `Publisher`; `unknown` if nothing remains | **user** |
| Q6 Confidence | **A** — ordinal band, no numeric score | **user** |
| Q7 ISRC backfill | **A** — spend the 47 requests | recommended default |
| Q8 `likedAtEnd` | **A** — sample at close + grace window, attribute by `added_at` | recommended default |
| Q9 Hypothesis gate | **C** — pre-register, report `unknown` alongside | recommended default |

### Analysis (Step 5, mandatory)

**Q5's answer carried a general principle, not just an option letter**: *prioritise accuracy in the
"Artist Is Independent" determination even if it ultimately misses some independent products.*
That is a **precision-over-recall directive**, and it is now adopted as a standing rule for this
unit. It has consequences the round-1 recommendations did not anticipate, because those
recommendations were written before the principle was stated.

**Two things in that sentence prompted further live probing rather than interpretation** — the
principle itself, and the fact that it is framed at the **artist** level while U2 was designed at
the **release** level. Results are in `research-findings.md` **Part 6**, and they changed two
answers and revealed one capability that did not previously exist.

**Q6 needs one clarification.** Option A concerns the *confidence value* and is fully compatible
with storing per-signal votes — but read literally as "band only, discard votes" it would
contradict **FR-13** (*"must record which signals fired and how they voted"*), the U2 exit
criterion *"classification records per-signal votes; disagreement preserved"*, and the project's
"store observations, derive judgements" rule. Almost certainly not what was meant. Confirmed in Q11.

**Three follow-up questions plus one withdrawal below.**

---

## Follow-up Questions — Round 2

### Question 10 — Q4 is withdrawn: `[no label]` should be `unknown`

**My round-1 recommendation for Q4 was wrong, and your precision principle is what exposed it.**

I argued `[no label]` is an *assertion* of no label, so it should count as `independent`. I tested
that instead of assuming it — by asking whether those same artists carry real labels on their
*other* MusicBrainz releases:

| Artist | Releases | Named label | `[no label]` | Labels actually present |
|---|---|---|---|---|
| **Imminence** | 66 | **41** | 8 | Arising Empire, Sumerian, **Virgin Music Group** |
| **Red Leather** | 25 | 6 | 8 | EMPIRE, Sounds Good |

Both `[no label]` tracks belong to artists MusicBrainz **knows to have labels** — one of them
Virgin Music Group, i.e. **Universal**. The sentinel reflects incomplete data entry, not a claim
of self-release. Under Q4 = A both plays would be classified **`independent`** — wrong, and wrong
in the direction that **falsely supports the hypothesis**.

A) **`unknown`** — original option B. Consistent with your precision principle (Recommended)

B) **Keep `independent`** as answered in round 1

C) **`self-released` as a third value**, recorded but never counted as `independent` in analysis

[Answer]: A

---

### Question 11 — Q6: confidence is an ordinal band. Are per-signal votes still stored?

Your reasoning — *"we shouldn't imply precision that doesn't exist"* — is decisive against a
numeric score, and option A is adopted for the **confidence value**.

The question is only whether votes are *also* retained underneath it. FR-13 requires them
explicitly, and the U1 threshold finding is the precedent: retained evidence let a judgement be
revisited without re-collecting data.

A) **Ordinal band as the confidence, per-signal votes stored underneath** — the band is the only
   thing rules and UI see; votes exist for re-tuning and export (Recommended)

B) **Ordinal band only** — discard votes. Would require amending FR-13 and the U2 exit criterion

[Answer]: A

---

### Question 12 — An exact Spotify → MusicBrainz artist join exists. Use it?

**This capability was not known when the round-1 questions were written.** MusicBrainz stores
Spotify links as first-class `url` entities:

```
GET /ws/2/url?resource=https://open.spotify.com/artist/{spotifyArtistId}&inc=artist-rels
```

The Spotify artist ID we already hold is therefore an **exact key** — no name matching, no `score`,
none of the misattribution hazard that made Q3's search fallback unsafe. (MusicBrainz holds
**three** artists named `Prof`; the join returns the right one by construction rather than by luck,
and it resolved `Mjhanks`, which name search could not find at all.)

Measured on the same 19 tracks:

| Level | Coverage |
|---|---|
| Release-level (current design) | **57.9 %** |
| Artist-level, exact join | **88.2 %** resolved · **76.5 %** with a named label |

It recovers **5 of the 6 ISRC 404s and both `[no label]` cases**.

**⚠️ But it answers a different question, and one track proves it**: Token — *Full Bag* is
`Never Too Different` (independent) at **release** level and **`Atlantic`** at **artist** level.
Both are true — an Atlantic artist releasing this one independently. For R1 that is arguably a
*control* variable (is the artist signed?) versus the *treatment* (was this release a label push?).

A) **Add artist-level as a separate field**, alongside release-level — never merged. Two columns,
   two questions, disagreement preserved and visible (Recommended)

B) **Replace release-level with artist-level** — higher coverage, simpler, but loses the
   per-release signal the hypothesis is actually about

C) **Release-level only** — do not adopt it; keep U2's scope as originally planned

D) **Add artist-level, and use it only as a fallback** when release-level is `unknown`

[Answer]: A

---

### Question 13 — Does the precision principle change Q5 from A to C?

You chose Q5 = **A** (exclude `Publisher`). Option **C** was A *plus* treating `Distributor` as a
weaker signal than `Imprint` / `Original Production`.

Your stated principle argues for C: a distributor relationship says nothing about whether a deal
exists behind it. `broke` (Marino, bbno$) is typed `Distributor` and self-describes as *"LA-based
independent label & distributor"* — genuinely independent, but the *type alone* does not establish
that. Under C it would still classify independent, at **lower confidence**.

A) **Yes, adopt C** — `Distributor` votes independent at reduced confidence (Recommended, as the
   direct application of your own principle)

B) **No, keep A** — `Distributor` weighted the same as `Imprint`

[Answer]: A

---

## Execution Checklist

- [x] Confirm answers; analyse for ambiguity (Step 5) — **round 2 run**; Q4 withdrawn, Q6 clarified
- [x] Generate `domain-entities.md` — LabelResolution, LabelCandidate, **ArtistLabelResolution**,
      SignalVote, LabelClassification, LikedEvidence, CoverageMetrics
- [x] Generate `business-logic-model.md` — 8 flows: live enrichment, release resolution, artist
      resolution, pure classification, two-level storage, liked capture, backfill, hypothesis gate
- [x] Generate `business-rules.md` — **BR-1 to BR-11**, 60 numbered rules with edge cases
- [x] Define migration 002 — 5 new tables, 14 new `play` columns, 2 indexes, additive only
- [x] Verify `labelClassifier` is **pure** — BR-4.8; `purity.test.ts` extension named as a
      Code Generation obligation for all three pure modules
- [x] Verify `unknown` stays distinct from `independent` end to end — BR-3.2, BR-4.6, BR-10.4
- [x] Verify MusicBrainz cannot delay the now-playing display — BR-7.5, BR-7.7, Flow 1
- [x] Confirm coverage rate is exposed as a first-class metric — BR-10.1–10.5, `CoverageMetrics`
- [x] Verify every U2 story's acceptance criteria maps to a business rule — coverage table at the
      end of `business-rules.md`
- [x] Update `aidlc-state.md`; log in `audit.md`

**No `frontend-components.md`**: U2 adds label fields to the existing enrichment panel; the U0
component hierarchy is unchanged, so the artifact would be empty ceremony. The one new UI
behaviour — `pending` must never render as `unknown` — is specified as **BR-7.7** instead.

---

## Settled design parameters

| Parameter | Value | Source |
|---|---|---|
| Join key | **ISRC only** at release level; **exact Spotify-URL join** at artist level | Q3, Q12 |
| Resolution chain | **Two calls** — `/isrc/{isrc}` then `/release?recording=…&inc=labels` | Part 5 |
| Release narrowing | **Cascade** `title+date → title → all`, tier recorded | Q1 = A |
| Tier `all` | **Caps confidence at `low`** | Q1 = A |
| Search fallback | Only on `count == 1` **and** exact normalised match; `matchMethod` recorded | Q3 = B+D |
| `Publisher` candidates | **Ineligible** — never vote | Q5 = A |
| `Distributor` / untyped | Eligible, **`strength = weak`** | Q13 = A |
| `[no label]` | **`unknown`** — never `independent` | Q10 = A |
| Fold rule | Any strong `major` ⇒ `major`; `independent` requires **no** major vote | Q5 principle |
| `contested` | **Major-vs-major only**; caps confidence at `low` | Q2 = A+C |
| Confidence | **Ordinal `high`/`medium`/`low`**, votes retained underneath | Q6 + Q11 = A |
| Two levels | Release and artist stored **separately, never merged** | Q12 = A |
| Artist confidence | **Capped at `medium`** — aggregates a career, not a release | Part 6 |
| ISRC backfill | **Yes** — 47 one-off `GET /tracks/{id}` | Q7 = A |
| `likedAtEnd` | Play close **+ ~30 s grace window**, attributed by `added_at` | Q8 = A |
| Hypothesis gate | **Pre-registered**, `unknown` group reported alongside | Q9 = C |

### The standing rule

**Precision over recall in the independent determination** (user, Q5). Missing an independent track
costs one row; calling a major track independent **manufactures support for the hypothesis under
test**, invisibly. BR-3.1, BR-3.2 and BR-4.3/4.4 are all expressions of this.
