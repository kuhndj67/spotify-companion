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
| **BR-7.3** | A given ISRC is resolved **at most once per TTL window**; each resolution **appends a version**, never overwrites | FR-14, Q1 = C, BR-13 |
| **BR-7.4** | A given Spotify artist ID is resolved at most once per TTL window; each resolution **appends a version** | Q12, BR-13 |
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
| **BR-8.4a** | Backfill **never** rewrites a play's label snapshot or its resolution pointers once written. A new resolution appends a version; it does not revise history | BR-13.4, user 2026-08-31 |
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
| **BR-11.1a** | The primary variable is the **latest** release-level verdict and the **as-of-play** artist-level verdict. The alternative reading of each is reported as a robustness check | User 2026-08-31 |
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

## BR-12: The resolution trace — how a verdict was reached

**Added 2026-08-31 by user decision at the Functional Design approval gate:** *"include a debug
output that shows how the data for a track was collected (perhaps showing the rules applied so
different rule paths can be tested)."*

| # | Rule | Source |
|---|---|---|
| **BR-12.1** | Any play with a stored label resolution can produce a **resolution trace**: the ordered derivation from ISRC through candidates, eligibility, votes and fold to the final verdict | User, 2026-08-31 |
| **BR-12.2** | The trace is **recomputed** by re-running the pure classifier over stored candidates and votes — it is never a separately persisted narrative | BR-4.8, BR-8.7 |
| **BR-12.3** | The trace names the **rule IDs** that fired, including every rule that **suppressed** a candidate | User, 2026-08-31 |
| **BR-12.4** | The trace is available for **any play in history**, not only the currently playing track | User: *"so different rule paths can be tested"* |
| **BR-12.5** | The trace reports the `label_classifier_version` stored on the play **and** the version generating the trace, and **flags divergence explicitly** | BR-8.7, FR-20 |
| **BR-12.6** | The trace renders as a **derivation**, not as pass/fail steps; it has no `ok`/`fail` status | — |
| **BR-12.7** | Generating a trace issues **zero** MusicBrainz and zero Spotify requests | BR-8.7, NFR-15 |
| **BR-12.8** | A play with no resolution traces as its `unknown` **reason** (BR-10.2), not as an empty trace | BR-10.2, BR-7.7 |

> ### BR-12.3 is the rule that makes the precision principle visible
>
> The standing rule for this unit works almost entirely **by exclusion**. BR-3.1 discards
> `Publisher` candidates, BR-3.2 turns `[no label]` into `unknown`, and BR-4.4 requires the
> *absence* of any major vote before `independent` can be returned. None of those leave a mark in
> the verdict — a suppressed candidate and a candidate that never existed produce identical output.
>
> Faouzia is the worked example: her only MusicBrainz label is `Faouzia Music`, type `Publisher`,
> and she records for Atlantic. The correct verdict is `unknown`. Without BR-12.3 that is
> indistinguishable from "MusicBrainz returned nothing" — the trace is what shows a candidate was
> found and deliberately refused, and **which rule refused it**.

> ### BR-12.2 and BR-12.5 together — why the trace is recomputed, and why that needs a guard
>
> Recomputation is what makes the trace honest: it runs **the same pure function** that produced the
> verdict, so it cannot drift into a hand-written description of what the code is believed to do.
> BR-8.7 already guarantees this costs nothing, which is also what makes BR-12.4 affordable.
>
> But a classifier that has since been re-tuned will trace a historical play with **today's** rules
> and produce a derivation that never actually ran. R3 guarantees the classifier *will* be re-tuned,
> so this is a certainty rather than a risk. The output would be a plausible, self-consistent, wrong
> account — **the exact failure shape this project has been caught by four times already**, and the
> reason BR-12.5 is mandatory rather than a nicety.

> ### BR-12.4 is a testing requirement, not a convenience
>
> The rule paths most in need of inspection are the rare ones — `contested` (two majors on one
> release), the `all` narrowing tier, a search-fallback match, a `Distributor`-only weak vote.
> **None of them can be summoned on demand by playing a track.** Restricting the trace to
> now-playing would leave precisely the paths with the least test coverage the hardest to observe.

---

## BR-13: Resolutions are versioned, never overwritten

**Added 2026-08-31 by user decision.** Raised by the user as a general problem: *"some of that data
can change (an artist can sign with a label for instance)"*. Resolves the `label_resolved_at`
finding raised at NFR Design.

| # | Rule | Source |
|---|---|---|
| **BR-13.1** | A resolution is **append-only**. Re-resolving an ISRC or artist inserts a **new row**; no existing row is updated or deleted | User 2026-08-31 |
| **BR-13.2** | Candidates and votes key to the **`resolution_id`**, never to the `isrc` or artist id | BR-8.7 |
| **BR-13.3** | Every resolution carries `resolved_at`; the **current** value for a key is the row with the greatest `resolved_at` | — |
| **BR-13.4** | A play stores `label_resolution_id` and `artist_label_resolution_id` — the **exact versions** its verdict was derived from. Immutable once written | BR-8.4a |
| **BR-13.5** | The **as-of-play** value is the version the play points at, **not** a timestamp comparison against `started_at` | see below |
| **BR-13.6** | Release-level analysis uses the **latest** version; artist-level analysis uses the **as-of-play** version | BR-11.1a |
| **BR-13.7** | Exports carry **both** readings plus `resolved_at`, so the choice is visible in the data rather than baked into the export | FR-50, FR-51 |
| **BR-13.8** | A new version that agrees with its predecessor is still recorded — *"unchanged at this date"* is evidence, not noise | R2 |

> ### BR-13.2 is the rule that stops the classifier voting across time
>
> Candidates keyed to the `isrc` would **accumulate across every resolution**, so BR-8.7's
> reclassification would fold 2026 facts together with 2027 facts and vote on the union. The verdict
> would be derived from a state of the world that never existed at any single moment.
>
> This is the reason all five tables change together rather than only `label_resolution`. Keying
> candidates to a version is not bookkeeping — it is what makes a version *mean* anything.

> ### BR-13.5 — why the pointer, not the timestamp
>
> "The resolution as of the play's `started_at`" is **not well defined**. A track playing now is
> `pending` (BR-7.7); its resolution arrives seconds to minutes *after* the play began, and under a
> paused queue (P-4) possibly much later. A timestamp comparison would return *nothing* for the
> common case and would silently pick a stale version for a re-resolved track.
>
> The play stores the version it actually used. That is a fact about what the app did, not an
> inference about what it might have seen.

> ### BR-13.6 — the two levels are asymmetric because the underlying facts are
>
> | Level | What it is | A later change means | Use |
> |---|---|---|---|
> | **Release** | A fact about a **past event** — this pressing, on this date, carried this label | We **learned** it. The release did not change | **Latest** — strictly better measurement of a fixed fact |
> | **Artist** | A fact about **now** — an aggregate over a career | The **world** may have changed. The artist may have signed | **As-of-play** — the covariate is "signed *when this played*" |
>
> Using the latest artist-level verdict would count an artist who signed *after* the play as having
> been signed at the time — **the direction that fabricates support for R1**, and therefore the one
> the standing precision rule forbids. Using an as-of-play release verdict would discard a genuine
> improvement in measurement for no gain, since the release itself cannot have changed.
>
> **This asymmetry is only expressible because Q12 kept the two levels separate.** Merged, one rule
> would have to serve two facts with opposite temporal behaviour.

> ### ⚠️ BR-13 is inert without a TTL on successes
>
> Under the original Q1 = A, a successful resolution was **never re-fetched**, so a version chain
> could only ever record `unknown → known` — our own catalogue gaps. It could **never** record
> `independent → major`, which is the case that prompted this design. The chain would have looked
> like it was working the entire time.
>
> Q1 was therefore revised **A → C** (TTL on everything). Measured cost at 1,000 distinct ISRCs:
> ~2,000 requests, about **33 minutes** of background queue, once per quarter.

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
| Resolution trace (added 2026-08-31) | BR-12.1–12.8 |
| Versioned resolutions (added 2026-08-31) | BR-13.1–13.8, BR-7.3, BR-7.4, BR-8.4a, BR-11.1a |
