# Business Rules — U2: Label Enrichment

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Functional Design, U2

Numbered, individually testable. Every rule states its source and the criterion it serves.

**Settled parameters**: narrowing cascade `title+date → title → all` · search fallback only on an
unambiguous single hit · `Publisher` ineligible, `Distributor` weak · `[no label]` ⇒ `unknown` ·
confidence **ordinal** with votes retained · release-level and artist-level **never merged**.

> ### The rule that governs the other rules
>
> **Precision over recall in the independent determination** (user, Q5).
> Where a rule below is asymmetric — and several are — this is why. Missing an independent track
> costs one row. Calling a major track independent **manufactures evidence for the hypothesis under
> test**, and does so invisibly.

---

## BR-1: Release-level resolution

| # | Rule | Source |
|---|---|---|
| **BR-1.1** | A track is resolved by **ISRC only**. Artist and title are never used as the primary key | FR-12 |
| **BR-1.2** | Resolution is `GET /ws/2/isrc/{isrc}` → recording MBID, then `GET /ws/2/release?recording={mbid}&inc=labels` | Part 5 |
| **BR-1.3** | A 404 from the ISRC lookup is recorded as `status = not-found` — a **fact about coverage**, cached, never retried on a schedule | R2 |
| **BR-1.4** | A transport failure is `status = error` — retryable, and **never cached as absence** | NFR-18 |
| **BR-1.5** | Search fallback runs **only** when the ISRC lookup returned `not-found`, **and** the query returns exactly one hit, **and** artist and title match exactly after normalisation | Q3 = B |
| **BR-1.6** | `matchMethod` (`isrc` / `search` / `none`) is recorded on every resolution | Q3 = D |
| **BR-1.7** | A play with no ISRC is `unknown` at release level. It is never resolved by name | Q3 = B |

> ### BR-1.5 exists because `score` does not rank correctness
>
> Measured over the 6 ISRCs MusicBrainz did not know: 2 clean recoveries, 2 count-zero misses, 1
> recording carrying no releases — and **one confident wrong answer**. For Ren's *Starry Night
> Act III*, the top **two** hits scored **100 and were different recordings** (*The Bedroom*,
> *Self Portrait*); the near-correct *Starry Night, Act II* scored **95**.
>
> Any threshold rule takes the wrong track here. `count == 1` plus exact match is the only fallback
> the probe showed to be safe, and it correctly **refuses** Ren while recovering BOVSKI and Prof.

⚠️ **BR-1.2 is written as a two-call chain for a reason.** `GET /ws/2/isrc/{isrc}?inc=releases`
returns **200 with `inc` silently ignored** — no error, no warning, just recordings with no
releases. It reads as "MusicBrainz has no data", which is false. Any implementation that collapses
the chain back into one call will reintroduce a **plausible** wrong answer, which is worse than a
loud one. Pin it with a test against a recording known to have many releases.

---

## BR-2: Release narrowing cascade

| # | Rule | Source |
|---|---|---|
| **BR-2.1** | Tier 1 — releases whose normalised title equals the Spotify album **and** whose date equals the Spotify release date | Q1 = A |
| **BR-2.2** | Tier 2 — if tier 1 is empty, releases whose normalised title equals the Spotify album | Q1 = A |
| **BR-2.3** | Tier 3 — if tier 2 is empty, **all** releases of the recording | Q1 = A |
| **BR-2.4** | The tier that produced the candidate set is recorded as `narrowingTier` | Q1 = A |
| **BR-2.5** | Normalisation lower-cases, strips bracketed suffixes (`(Deluxe)`, `[Remastered]`) and non-alphanumerics | — |
| **BR-2.6** | `narrowingTier = all` **caps confidence at `low`** — the app could not identify which release was played | Q1 = A, BR-5 |

> ### Why a cascade rather than strict matching
>
> Measured on the 13 resolved tracks: title+date fires on **8/13**, title-only on **13/13**.
> Requiring both would drop coverage from 58 % to ~42 % — and it fails for reasons that are
> **Spotify formatting artefacts, not data problems**: a year-only release date (`Slipknot — 2004`)
> and deluxe-edition titles (`-!- (Deluxe)`).
>
> Title-only narrowing cut Slipknot from **50 releases and 12 labels down to 1 → Roadrunner
> Records**, which is correct. Tier 3 is retained so a candidate set always exists, and BR-2.6 is
> what stops that recall costing precision.

---

## BR-3: Candidate eligibility

| # | Rule | Source |
|---|---|---|
| **BR-3.1** | A candidate whose `labelType` is **`Publisher`** is **ineligible** and never votes | Q5 = A |
| **BR-3.2** | The sentinel `[no label]` is **ineligible** and contributes `unknown` — never `independent` | Q10 = A |
| **BR-3.3** | A candidate whose `labelType` is `Distributor` is eligible but votes at `strength = weak` | Q13 = A |
| **BR-3.4** | `Imprint` and `Original Production` vote at `strength = strong` | Q13 = A |
| **BR-3.5** | A candidate with `labelType = null` votes at `strength = weak` | Q13 = A |
| **BR-3.6** | Non-`Official` releases (bootleg, promo) are excluded from artist-level aggregation | Part 6 |
| **BR-3.7** | If no eligible candidate remains, the verdict is `unknown`, reason `noEligibleCandidate` | FR-16 |

> ### BR-3.1 — `Publisher` is not a record label
>
> Faouzia's **only** candidate is `Faouzia Music`, type `Publisher`, disambiguation `SOCAN`. She
> records for Atlantic. Admitting it yields a confident **`independent`** verdict that is wrong.
>
> The direction is the point: majors routinely operate publishing subsidiaries, so admitting
> publishers **over-counts independence precisely where the hypothesis would be falsely supported.**
> Under BR-3.1 Faouzia becomes `unknown` — which is the honest answer, because MusicBrainz genuinely
> does not know her label.

> ### BR-3.2 — reversal, recorded so it is not re-litigated
>
> The round-1 recommendation was to treat `[no label]` as `independent`, on the reasoning that it is
> an assertion rather than an absence. **Testing it showed that was wrong.** Both affected artists
> carry real labels on their other MusicBrainz releases — **Imminence: 41 of 66 named, including
> Virgin Music Group (Universal)**; Red Leather: EMPIRE. The sentinel records incomplete data entry.
>
> Had this shipped, two plays by label-signed artists would have been counted as `independent`.

---

## BR-4: Classification and voting

| # | Rule | Source |
|---|---|---|
| **BR-4.1** | Each signal casts an independent `SignalVote` of `major` / `independent` / `unknown`. **Votes are stored, not just the verdict** | FR-13, Q11 |
| **BR-4.2** | `imprint`, `label ownership` and `label distribution` relationships are **voted separately** and never merged into one parent walk | R3, Part 5 |
| **BR-4.3** | If **any** eligible candidate votes `major` at `strong`, the verdict is `major` | Q5 principle |
| **BR-4.4** | The verdict is `independent` only if at least one eligible candidate votes `independent` **and no candidate votes `major` at any strength** | Q5 principle |
| **BR-4.5** | Otherwise the verdict is `unknown` | FR-16 |
| **BR-4.6** | `unknown` is never treated as `independent`, at any layer, including export | FR-16, FR-51 |
| **BR-4.7** | `contested = true` when eligible candidates resolve to **two or more different majors** | Q2 = C |
| **BR-4.8** | Classification is **pure**: candidates and the curated root list in, verdict out. No clock, no network, no database | FR-42, Application Design |

> ### BR-4.3 / BR-4.4 are deliberately asymmetric
>
> This is the user's precision principle expressed as arithmetic. A major present anywhere makes
> the release `major`; independence requires the **absence** of any major vote.
>
> NF's *The Search* carries `NF Real Music`, `Capitol` and `Caroline`. Reading the artist's own
> imprint alone would say independent — an artist imprint distributed by a major is **one
> arrangement**, not a contradiction, and BR-4.3 records it as what it is.

> ### BR-4.2 — Spinefarm is R3 on real data
>
> | Label | Walk | Correct? |
> |---|---|---|
> | Epic | `imprint` → Sony Music Entertainment | ✅ |
> | Interscope | `imprint` → UMGRI Interscope | ✅ |
> | Roadrunner | `imprint` → Elektra; `distribution` → Atlantic | ✅ Warner |
> | **Spinefarm** | `distribution` → **[PIAS] UK Ltd.** (independent) | ❌ **Universal-owned** |
>
> Following distribution says *independent* where the truth is *Universal*. Ownership and
> distribution are different claims about the world; merging them into a single "parent" produces a
> wrong answer with no trace of the disagreement that caused it.

⚠️ **BR-4.8 is the purity constraint, and it fails silently.** A `Date.now()` or a config read
inside the classifier breaks FR-42 **while every other test still passes**. `test/purity.test.ts`
is the only thing that catches it — `labelClassifier` must be added to its list.

---

## BR-5: Confidence banding

| # | Rule | Source |
|---|---|---|
| **BR-5.1** | Confidence is exactly `high` / `medium` / `low`. **No numeric score** | Q6 = A |
| **BR-5.2** | `high` — two or more `strong` signals agree, and `narrowingTier` is `title-date` or `title` | Q6, Q1 |
| **BR-5.3** | `medium` — one `strong` signal, no contradiction | Q6 |
| **BR-5.4** | `low` — only `weak` signals, **or** signals contradict, **or** `narrowingTier = all` | Q6, Q1 |
| **BR-5.5** | `contested = true` caps confidence at `low` | Q2 = C |
| **BR-5.6** | Confidence describes **evidence quality only** — never the strength of the underlying preference signal | — |

> **Q6 = A, user**: *"we shouldn't imply precision that doesn't exist."* A 0–1 score invites
> thresholding at 0.73 across three heuristics never calibrated against ground truth. Three bands
> carry what is actually known — and BR-4.1 keeps the votes underneath, so a future calibration is
> possible without re-fetching MusicBrainz.

---

## BR-6: Artist-level resolution

| # | Rule | Source |
|---|---|---|
| **BR-6.1** | The artist is resolved by the **exact** join `GET /ws/2/url?resource=https://open.spotify.com/artist/{id}&inc=artist-rels` | Q12 = A |
| **BR-6.2** | Artist name search is **never** used as a fallback | Q12, BR-1.5 rationale |
| **BR-6.3** | Artist-level classification runs BR-3 to BR-5 over the artist's aggregated labels | Q12 |
| **BR-6.4** | Artist-level and release-level verdicts are stored in **separate fields** and are never merged, reconciled, or used to override one another | Q12 = A |
| **BR-6.5** | Disagreement between the two levels is **not** an error and raises no flag | Q12 |
| **BR-6.6** | Artist-level confidence is capped at `medium` — it aggregates a career, not a release | Part 6 |

> ### BR-6.4 is load-bearing
>
> **Token — *Full Bag*** is `Never Too Different` (independent) at release level and **`Atlantic`**
> at artist level. **Both are true**: an Atlantic artist who released this one independently.
>
> For R1 these are plausibly different variables — artist-signed status as a **control**, release
> label as the **treatment**. A single merged column would destroy that distinction permanently and
> without trace. BR-6.5 follows: the disagreement *is the data*.

> ### BR-6.2 — the join is exact, and that is the whole reason this is allowed
>
> MusicBrainz holds **three** artists named `Prof`. The URL join returns the right one by
> construction; name search returned it by luck, and the Ren case (BR-1.5) proves luck is not
> reliable. Permitting a name-search fallback here would reintroduce exactly the hazard Q3 excluded.

---

## BR-7: Rate limiting, caching and the display path

| # | Rule | Source |
|---|---|---|
| **BR-7.1** | All MusicBrainz requests pass through **one** serialised queue at **≤ 1 req/sec** | NFR-15 |
| **BR-7.2** | Every request sends a descriptive `User-Agent` identifying the app and a contact address | NFR-14 |
| **BR-7.3** | A given ISRC is resolved **at most once** while cached | FR-14 |
| **BR-7.4** | A given Spotify artist ID is resolved at most once while cached | Q12 |
| **BR-7.5** | MusicBrainz latency **never** delays the now-playing display. Enrichment is asynchronous and the panel renders without it | NFR-16, FR-16 |
| **BR-7.6** | A MusicBrainz failure degrades that field to `unknown` and never propagates as an error | NFR-18, FR-10 |
| **BR-7.7** | Label state is `pending` until resolved, and `pending` is **never** rendered or exported as `unknown` | FR-11 |

> **BR-7.5 is a measured constraint, not a precaution.** Observed MusicBrainz latency across the
> probe ranged **0.1 s to 6.7 s** for the same class of request. Anything on the display path would
> stall the UI for seconds at unpredictable intervals.

> **BR-7.7 distinguishes "not yet" from "not known".** Collapsing them would corrupt the coverage
> metric (BR-10) by counting in-flight lookups as absent data — and R2 is the thing those metrics
> exist to measure.

---

## BR-8: Backfill

| # | Rule | Source |
|---|---|---|
| **BR-8.1** | Plays lacking an ISRC but carrying a `track_id` have their ISRC recovered via `GET /tracks/{id}` | Q7 = A |
| **BR-8.2** | ISRC recovery is a **one-off job**, not a per-play cost | Q7 |
| **BR-8.3** | Label backfill scans plays with an ISRC and no label resolution, in batches, through the BR-7.1 queue | FR-14 |
| **BR-8.4** | Backfill **never** rewrites a play's U1 fields — outcome, evidence, provenance, trail | NFR-12 |
| **BR-8.5** | Backfilled label data is indistinguishable in *content* from live-resolved label data; `provenance` on the play already marks how the **play** was captured | FR-54 |
| **BR-8.6** | Re-running backfill is idempotent | — |
| **BR-8.7** | Reclassification recomputes verdicts from stored candidates and votes **without any MusicBrainz request** | FR-20 analogue |

> **BR-8.7 is the payoff for storing facts separately from judgements** — the same structure that
> let U1's completion threshold be revisited without re-collecting a single play. R3 guarantees the
> label classifier will be re-tuned; BR-8.7 is what makes that cheap rather than impossible.

---

## BR-9: Liked-status transitions

| # | Rule | Source |
|---|---|---|
| **BR-9.1** | `likedAtStart` is captured at play start from the cached saved-track set | Agreed 2026-08-26 |
| **BR-9.2** | `likedAtEnd` is captured at play close, then **amended once** if the grace window observes a like | Q8 = A |
| **BR-9.3** | The grace window re-checks page 1 of `GET /me/tracks` approximately 30 s after play close | Q8 = A |
| **BR-9.4** | A like is attributed to the play only if its `added_at` falls **at or after the play's start** | Q8 = A |
| **BR-9.5** | Either endpoint being unavailable yields `null` — **never `false`** — and the transition is `unknown` | Project rule |
| **BR-9.6** | The five-state transition is **derived** from the two booleans, never stored as the primary fact | Agreed 2026-08-26 |
| **BR-9.7** | An unlike is probed only when `likedAtStart` was true, using the cached rank for a targeted `offset` window | Research Part 4b |
| **BR-9.8** | `kept-unliked` is the **reference level** in analysis, not an observed choice | Agreed 2026-08-26 |

> ### BR-9.4 is what makes the grace window safe
>
> `added_at` has second precision and `GET /me/tracks` is most-recently-saved first, so a like is
> **provably** attributable to the play window rather than inferred. Without that timestamp the
> grace window would be a guess; with it, it is a fact.

⚠️ **BR-9.1 cannot be recovered later.** Unlike an observation trail, these are point-in-time
facts — an unlike leaves **no tombstone and no timestamp**. A missed `likedAtStart` is gone
permanently. This is the one place in U2 where getting capture right at the time is not
recoverable by re-analysis.

---

## BR-10: Coverage as a first-class metric

| # | Rule | Source |
|---|---|---|
| **BR-10.1** | Coverage rate is exposed in diagnostics, not derived ad hoc | U2 exit criterion, R2 |
| **BR-10.2** | `unknown` is broken down by **reason**: `noIsrc`, `notFound`, `noEligibleCandidate`, `error` | R2 |
| **BR-10.3** | Coverage is reported **by release year** | Part 5 |
| **BR-10.4** | Exports represent `unknown` as the literal token `unknown` and carry coverage counts | FR-51 |
| **BR-10.5** | Exports include per-signal votes and both levels' verdicts, not a summarised view | FR-50 |

> ### BR-10.3 is the rule that keeps R2 visible
>
> Measured: **pre-2022 releases resolved 5/5 (100 %); 2022-onward 6/14 (43 %).** The missingness is
> **not random** — it concentrates on recent independent singles, exactly the population the
> hypothesis concerns.
>
> An analysis that drops `unknown` rows drops the newest independent music first. A single aggregate
> coverage number would hide that completely; broken out by year it is unmissable.

---

## BR-11: The hypothesis gate

| # | Rule | Source |
|---|---|---|
| **BR-11.1** | The comparison is **pre-registered before results are seen**: skip rate for `major` versus `independent` among plays with a **known** label | Q9 = C |
| **BR-11.2** | The `unknown` group is reported **alongside**, never omitted | Q9 = C |
| **BR-11.3** | Coverage counts and the by-year breakdown accompany the result | Q9 = C, FR-51 |
| **BR-11.4** | Rule-initiated skips are excluded from the comparison | FR-23 |
| **BR-11.5** | The result is recorded in `audit.md` **either way** — support or disconfirmation | U2 exit criterion |
| **BR-11.6** | A minimum sample is stated in advance; below it the gate reports *"insufficient data"* rather than a verdict | Q9 |

> ### BR-11.2 is not a formality
>
> If the `unknown` group's skip rate resembles the `independent` group's, that is **evidence about
> who the unknowns are** — consistent with them being predominantly independent releases
> MusicBrainz has not catalogued. Omitting them would discard the single most informative check
> available on the measured coverage bias.

> **BR-11.1 and BR-11.5 together are what make this a gate rather than a formality.**
> Pre-registration stops the criterion being fitted to the result after the fact; recording the
> outcome either way is the project's stated commitment that R1 is a hypothesis to be **tested**,
> and the design was deliberately built so it can be **disconfirmed**.

---

## Rule-to-requirement coverage

| Requirement | Rules |
|---|---|
| FR-12 resolve label via MusicBrainz on ISRC | BR-1.1–1.7, BR-2.1–2.6 |
| FR-13 classify with explicit confidence + per-signal votes | BR-4.1–4.8, BR-5.1–5.6 |
| FR-14 resolve a given ISRC at most once | BR-7.3, BR-7.4, BR-8.3 |
| FR-15 serialise to ~1 req/sec | BR-7.1, BR-7.2 |
| FR-16 degrade to `unknown`, never block or guess | BR-3.7, BR-4.5, BR-4.6, BR-7.5–7.7 |
| NFR-14 compliant User-Agent | BR-7.2 |
| NFR-15 ≤ 1 req/sec | BR-7.1 |
| NFR-16 never delay the display | BR-7.5, BR-7.7 |
| NFR-18 failures are partial data | BR-1.4, BR-7.6 |
| US-08 see the label | BR-1, BR-2, BR-7.7 |
| US-09 signed-vs-independent | BR-4, BR-5, BR-6 |
| R2 coverage bias measurable | BR-10.1–10.5, BR-11.2 |
| R3 no clean major/indie definition | BR-4.1, BR-4.2, BR-4.7 |
| Liked transitions (added by decision) | BR-9.1–9.8 |
| Phase 2 decision gate | BR-11.1–11.6 |
