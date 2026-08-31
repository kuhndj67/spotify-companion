# Domain Entities — U2: Label Enrichment

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Functional Design, U2

Technology-agnostic domain model. Storage mapping appears at the end for concreteness, but the
entities are defined independently of it.

**Grounded in measurement.** Every entity here exists because a live probe showed it was needed —
`research-findings.md` **Parts 5 and 6**. Two entities (`ArtistLabelResolution`, `SignalVote`)
would not exist if the design had been written from documentation.

---

## The organising principle

> **Store what MusicBrainz said. Derive what it means.**

The same split U1 used for plays: `Observation` is fact, `outcome` is judgement, and judgement is
recomputable because fact was retained. Here, `LabelResolution` and `SignalVote` are fact;
`LabelClassification` is judgement. The classifier will be re-tuned — R3 guarantees it — and when
it is, no MusicBrainz request need be repeated.

## The standing rule for this unit

> **Precision over recall in the independent determination** (user, Q5).
> *"Prioritise accuracy in the 'Artist Is Independent' determination even if it ultimately misses
> some independent products."*

This is **asymmetric by design** and shows up in three entity decisions: `[no label]` maps to
`unknown` not `independent` (Q10), `Publisher`-typed entries are ineligible entirely (Q5), and a
single major vote outweighs any number of independent votes (BR-4.3). Missing an independent track
costs a row; **misclassifying a major track as independent manufactures support for the very
hypothesis under test.**

---

## Entity overview

| Entity | Cardinality | Lifetime | Mutable? |
|---|---|---|---|
| **LabelResolution** | **Many per ISRC** — one per resolution | Permanent, append-only | **Never.** Re-resolution appends a version (BR-13.1) |
| **LabelCandidate** | Many per LabelResolution **version** | With its version | Never |
| **ArtistLabelResolution** | **Many per Spotify artist ID** — one per resolution | Permanent, append-only | **Never** (BR-13.1) |
| **SignalVote** | Many per classification | With its resolution **version** | Never |
| **LabelClassification** | One per Play, per level | Permanent on the Play | Recomputed with classifier version |
| **LikedEvidence** | One per Play | Permanent | Amended once, within the grace window |
| **CoverageMetrics** | Derived, transient | Query-scoped | N/A |
| **ResolutionTrace** | Derived, transient | Request-scoped | N/A — never stored (BR-12.2) |

**Two levels, never merged** (Q12). A Play carries *two* independent `LabelClassification`
values — one release-level, one artist-level. See the Token case below.

---

## LabelResolution

The MusicBrainz facts for one ISRC **at one moment**. **Append-only** (BR-13.1): re-resolving
inserts a new version rather than replacing the old one, so an ISRC accumulates a chain.

| Attribute | Type | Notes |
|---|---|---|
| `id` | id | **Version identity.** What candidates, votes and plays point at (BR-13.2, BR-13.4) |
| `isrc` | string | The join key from U1. **Not** unique — one per version |
| `supersedesId` | `Maybe<id>` | The version this one replaced; `null` for the first |
| `recordingMbid` | `Maybe<string>` | `null` when MusicBrainz does not know the ISRC |
| `matchMethod` | `isrc \| search \| none` | **Q3 = D.** How the recording was found |
| `narrowingTier` | `title-date \| title \| all \| none` | **Q1 = A.** Which cascade tier fired |
| `candidates` | `LabelCandidate[]` | May be empty even when `recordingMbid` is set |
| `releaseCount` | number | Total releases seen before narrowing — the ambiguity measure |
| `resolvedAt` | timestamp | TTL input, **and the version ordering key** (BR-13.3) |
| `status` | `resolved \| not-found \| error` | `error` is retryable; `not-found` is a fact |

### `matchMethod` exists because search misattributes

Measured (Part 5): over the 6 ISRCs MusicBrainz did not know, artist+title search gave 2 clean
recoveries, 2 count-zero misses, 1 recording with no releases — and **1 confidently wrong track**.
For Ren's *Starry Night Act III* the top **two** hits scored 100 and were different recordings;
the near-correct one scored 95.

`score` does not rank correctness. So search is used only on an unambiguous single exact hit
(BR-1.5), and **every row records which method found it**, so analysis can exclude searched matches
entirely without re-deriving them.

### `narrowingTier` is an input to confidence, not just metadata

A recording maps to many releases carrying different labels. Tier `all` means the app could not
identify which release Spotify played and is voting over everything ever pressed — materially
weaker evidence than tier `title-date`. Recording the tier is what lets BR-5 band confidence
honestly instead of presenting all verdicts as equivalent.

### `status` distinguishes three states that look alike

`not-found` (MusicBrainz returned 404 — a fact about coverage, cacheable) is not `error` (the
request failed — retryable, must not poison the cache) and neither is "resolved with no labels".
Collapsing them would make R2's coverage rate unmeasurable, because transport failures would be
counted as missing data.

### Versioning exists because two different things are called "the data changed"

**Raised by the user, 2026-08-31**: *"some of that data can change (an artist can sign with a label
for instance)."*

| | What happened | Correct handling |
|---|---|---|
| **Our knowledge changed** | A volunteer catalogued a release we could not see in August | The old verdict was **wrong**. Prefer the new one |
| **The world changed** | The artist signed to a major in January | The old verdict was **right for its time**. Keep it |

**MusicBrainz cannot tell you which occurred.** A lookup that 404'd in August and returns `Atlantic`
in January is byte-identical in both cases. So the design does not try to distinguish them at write
time — it **keeps both readings** and lets the analysis choose per level (BR-13.6), which is
possible because release-level and artist-level facts have opposite temporal behaviour.

The chain is not extra machinery for its own sake: **a track's sequence of plays is already a sparse
time series**, sampled at exactly the moments that mattered. Versioning the resolutions is what makes
that series legible instead of collapsing it to whatever was true last.

---

## LabelCandidate

One label as it appears on one release. Immutable.

| Attribute | Type | Notes |
|---|---|---|
| `labelName` | string | May be the sentinel `[no label]` |
| `labelMbid` | `Maybe<string>` | Key for the label-relationship signal |
| `labelType` | `Maybe<Imprint \| Original Production \| Distributor \| Publisher>` | Often `null` |
| `catalogNumber` | `Maybe<string>` | |
| `releaseId` | string | Which release carried it |
| `releaseTitle` | string | |
| `releaseDate` | `Maybe<string>` | |
| `releaseStatus` | `Maybe<string>` | `Official`, bootleg, promo… |

### `labelType` is an eligibility filter, not decoration

**`Publisher` is not a record label** (Q5). Faouzia's *only* candidate is `Faouzia Music`, type
`Publisher`, disambiguation `SOCAN` — a publishing entity, while she records for Atlantic. Taken at
face value it yields a confident **`independent`** verdict that is wrong.

The direction matters more than the instance: majors routinely operate publishing subsidiaries, so
admitting publishers **over-counts independence exactly where the hypothesis would be falsely
supported.** `Publisher` candidates are ineligible (BR-3.1). `Distributor` is eligible but votes at
reduced confidence (Q13) — `broke` is genuinely independent, but a distribution relationship says
nothing about whether a deal sits behind it.

### `[no label]` is a sentinel, and it means unknown

⚠️ **Reversal, recorded so it is not re-litigated.** The first recommendation was to treat
`[no label]` as `independent`, reasoning that it is an assertion rather than an absence. **That was
wrong**, and testing it is what showed so (Part 6):

| Artist | Releases | Named label | Labels actually present |
|---|---|---|---|
| Imminence | 66 | **41** | Arising Empire, Sumerian, **Virgin Music Group** |
| Red Leather | 25 | 6 | EMPIRE, Sounds Good |

Both `[no label]` tracks belong to artists MusicBrainz *knows* to have labels — one of them
Universal. The sentinel records incomplete data entry, not self-release. It maps to `unknown`
(Q10, BR-3.2).

### `releaseStatus` exists to suppress bootlegs

Artist-level aggregation over Slipknot's 100 releases surfaces Roadrunner alongside
`Smokin' Cactus`, `Metal Mind Records` and `Jigu Records Corporation` — bootlegs and regional
licensees. Weighting by status keeps those from voting as if they were the label.

---

## ArtistLabelResolution

**New in round 2 (Q12).** MusicBrainz facts for one *artist*, reached by an **exact** join.

| Attribute | Type | Notes |
|---|---|---|
| `spotifyArtistId` | string | Cache key — already held on every Play |
| `artistMbid` | `Maybe<string>` | Via the `url` entity join |
| `labels` | `{ name, mbid, type, releaseCount }[]` | Aggregated across the artist's releases |
| `releaseCount` | number | Total releases examined |
| `namedLabelCount` | number | Releases carrying a named label |
| `resolvedAt` | timestamp | |

### The join is exact, which is why this entity is safe and search is not

```
GET /ws/2/url?resource=https://open.spotify.com/artist/{spotifyArtistId}&inc=artist-rels
```

MusicBrainz stores streaming links as first-class `url` entities, so the Spotify artist ID the app
already holds is a **direct key** — no name matching, no `score`, none of the hazard that
constrains `matchMethod` above. MusicBrainz holds **three** artists named `Prof`; the join returns
the right one **by construction rather than by luck**, and it resolves `Mjhanks`, which name search
cannot find at all.

Coverage measured on the same 19 tracks: **88.2 %** of artists resolve, **76.5 %** yield a named
label — against **57.9 %** at release level.

### ⚠️ It answers a different question, and must never be merged

> **Token — *Full Bag*** is `Never Too Different` (independent) at **release** level and
> **`Atlantic`** at **artist** level. Both are true: an Atlantic artist who put this release out
> independently.

For R1 these are plausibly *different variables* — artist-signed status as a **control**, release
label as the **treatment**. Merging them into one "label" column would destroy that distinction
irrecoverably and silently. A Play therefore carries both, side by side (Q12 = A).

**Second caveat**: artist-level aggregation ignores time. Audioslave spans Epic, Interscope,
Columbia, Polydor and Geffen across a career. That is a fine answer to *"is this artist signed?"*
and not an answer about any single release.

---

## SignalVote

One classification signal's opinion, with its evidence. Immutable. **This is the entity FR-13
requires** — *"record which signals fired and how they voted, not just the verdict."*

| Attribute | Type | Notes |
|---|---|---|
| `signal` | `major-root-list \| label-relationship \| isrc-prefix` | Which heuristic |
| `verdict` | `major \| independent \| unknown` | Tri-state, never boolean |
| `strength` | `strong \| weak` | Set by BR-4 — e.g. `Distributor` votes weak |
| `evidence` | string | The concrete fact: label name, relationship walked, prefix matched |

### The three signals genuinely disagree — measured, not anticipated

| Label | Relationship walk | Correct? |
|---|---|---|
| Epic | `imprint` → Sony Music Entertainment | ✅ Sony |
| Interscope | `imprint` → UMGRI Interscope | ✅ Universal |
| Roadrunner | `imprint` → Elektra; `distribution` → Atlantic | ✅ Warner |
| **Spinefarm** | `distribution` → **[PIAS] UK Ltd.** (independent) | ❌ **Universal-owned** |

**Spinefarm is R3 happening on real data.** `imprint`, `label ownership` and `label distribution`
are three different claims about the world and are **not interchangeable**: following distribution
says independent where the truth is Universal. They are voted separately, never merged into a
single "parent" walk (BR-4.2).

`isrc-prefix` is the weakest signal and the only one with **100 % coverage** — it is available for
the six tracks MusicBrainz cannot resolve at all. `USUM`→Universal, `USSM`→Sony, `GBUM`→Universal
UK all matched the label MusicBrainz returned; all five `QZ*` ISRCs were indie-distributor ranges
and were exactly the ones that 404'd.

---

## LabelClassification

The derived judgement. **One per Play per level** — release and artist.

| Attribute | Type | Notes |
|---|---|---|
| `verdict` | `major \| independent \| unknown` | Tri-state (FR-16, FR-32) |
| `confidence` | `high \| medium \| low` | **Ordinal only** (Q6) |
| `contested` | boolean | Two *different* majors present (Q2 = C) |
| `votes` | `SignalVote[]` | Retained underneath (Q11) |
| `classifierVersion` | number | Mirrors U1's `classifierVersion`; makes re-classification auditable |

### Confidence is ordinal because the precision does not exist

User, Q6: *"we shouldn't imply precision that doesn't exist."* A 0–1 score would invite
thresholding at 0.73 over three disagreeing heuristics that have never been calibrated against
ground truth. Three bands carry what is actually known.

**Votes are retained underneath it** (Q11), because FR-13 requires them and because U1 already
proved the value: the completion-threshold finding was correctable only because the evidence had
been kept. A band alone would make the classifier un-retunable without re-fetching MusicBrainz.

### `contested` is narrow and deliberate

It marks **major-versus-major** disagreement — Audioslave's single title+date match carries
**Epic (Sony) and Interscope (Universal)** on one release. That is a real fact about reissue
history, not a bug to resolve with a tiebreak rule invented here.

It is *not* raised for major-versus-independent: under the precision rule a major present anywhere
makes the verdict `major` (BR-4.3), which is a decision, not a conflict. NF's *The Search* carries
`NF Real Music` **and** `Capitol` — an artist imprint distributed by a major is one arrangement,
and reading `NF Real Music` alone as independent is precisely the error the rule prevents.

---

## LikedEvidence

Point-in-time facts about saved-track status across a play. Agreed 2026-08-26; scheduling settled
at Q8.

| Attribute | Type | Notes |
|---|---|---|
| `likedAtStart` | `Maybe<boolean>` | `null` when the saved set was unavailable |
| `likedAtEnd` | `Maybe<boolean>` | Sampled at close, then amended within the grace window |
| `likedAddedAt` | `Maybe<timestamp>` | Exact `added_at` from Spotify — makes attribution provable |
| `transition` | `liked-during \| unliked-during \| kept-liked \| kept-unliked \| unknown` | **Derived**, never stored as the primary fact |

### Evidence is stored; the enum is derived

Same split as everywhere else in this project. **But with one critical difference from an
observation trail**: these are point-in-time facts that *cannot be reconstructed later*. An unlike
leaves no tombstone and no timestamp. If `likedAtStart` is not captured at play start, it is gone —
so this is the one place where getting the capture right at the time is not recoverable by
re-analysis.

### `kept-unliked` is the reference level, not an observed choice

Agreed with the user 2026-08-26. It covers the overwhelming majority of plays, nearly all of which
involve no like/unlike consideration whatsoever. **Absence of an action is not evidence of a
decision.** Treating it as one would import a deliberate-choice reading into the baseline
population of a statistical model.

### The grace window exists because liking lags the track

Q8 = A. Liking often happens a beat *after* a track ends. Sampling strictly at the play boundary
would record the **strongest positive signal the Spotify API can yield** as `kept-unliked`.
`added_at` has second precision and `GET /me/tracks` is most-recently-saved first, so a like is
*provably* attributable to the play window rather than inferred (BR-9.4).

---

## CoverageMetrics

Derived, never stored as truth. **First-class because R2 is measured, not hypothetical** (FR-51).

| Attribute | Type |
|---|---|
| `totalPlays` | number |
| `withReleaseLabel` / `withArtistLabel` | number |
| `unknownByReason` | `{ noIsrc, notFound, noEligibleCandidate, error }` |
| `byMatchMethod` | `{ isrc, search, none }` |
| `byNarrowingTier` | `{ titleDate, title, all }` |
| `coverageByReleaseYear` | year → resolved/total |

### `coverageByReleaseYear` is the one that matters

Measured (Part 5): **pre-2022 releases resolved 5/5 (100 %); 2022-onward 6/14 (43 %).** The
missingness is *not random* — it concentrates on recent independent singles, the population the
promotion hypothesis is about.

An analysis that silently drops `unknown` rows drops the newest independent music first. Exposing
coverage **by year** is what makes that visible rather than latent, and it is why Q9 = C requires
the `unknown` group to be reported alongside the comparison.

---

## ResolutionTrace

**Added 2026-08-31 by user decision at the approval gate.** The ordered derivation showing how one
play's label verdict was reached, and which rules produced it. Governed by BR-12, generated by
Flow 9.

| Field | Type | Meaning |
|---|---|---|
| `playId` | id | The play being explained |
| `level` | `release` \| `artist` | Traced separately per level — they are never merged (Q12) |
| `join` | object | `{ key: 'isrc' \| 'spotify-url', value, matchMethod: 'isrc' \| 'search' }` |
| `narrowingTier` | `title+date` \| `title` \| `all` \| `n/a` | Which cascade tier fired (Q1 = A) |
| `candidates[]` | object[] | `{ name, labelType, eligible, suppressedBy: ruleId \| null }` |
| `votes[]` | object[] | `{ signal, verdict, strength, ruleId }` |
| `fold` | object | `{ verdict, decidedBy: ruleId, contested: bool }` |
| `confidence` | object | `{ band, capsApplied: ruleId[] }` |
| `classifierVersion` | object | `{ storedOnPlay, running, diverged: bool }` — BR-12.5 |
| `unknownReason` | enum \| null | Present instead of the above when nothing resolved (BR-12.8) |

**Derived, never persisted** (BR-12.2). It is a *view* of `LabelCandidate` and `SignalVote`,
recomputed by re-running the pure classifier. Storing it would create a second copy of the
reasoning that could disagree with the code — which is the failure it exists to prevent.

### `suppressedBy` is the field that carries the standing rule

Every other field describes what the data *contained*. `suppressedBy` describes what the rules
**refused**, and it is the only place exclusion becomes visible. A `Publisher` candidate that was
found and discarded (BR-3.1) and a MusicBrainz lookup that returned nothing both yield `unknown`;
without this field they are the same row. Faouzia is the live case — `Faouzia Music`, type
`Publisher`, artist actually signed to Atlantic.

### `classifierVersion.diverged` is a correctness flag, not metadata

Because the trace is recomputed (BR-12.2), a re-tuned classifier explains an old play with new
rules. R3 makes that certain rather than hypothetical. `diverged` is what stops a self-consistent
account of reasoning that never ran from being read as history — the same class of error as a
MusicBrainz `200` with `inc` silently ignored, caught in advance this time.

---

## Storage mapping

**Migration 002**, forward-only (NFR-12), extending U1's schema.

### New tables — the cached facts

```
label_resolution          id PK, isrc, recording_mbid, match_method, narrowing_tier,
                          release_count, resolved_at, status, supersedes_id
                          UNIQUE (isrc, resolved_at)              append-only, BR-13.1
label_candidate           resolution_id FK, label_name, label_mbid, label_type,
                          catalog_number, release_id, release_title, release_date,
                          release_status
artist_label_resolution   id PK, spotify_artist_id, artist_mbid, release_count,
                          named_label_count, resolved_at, status, supersedes_id
                          UNIQUE (spotify_artist_id, resolved_at) append-only, BR-13.1
artist_label              resolution_id FK, label_name, label_mbid, label_type, release_count
label_signal_vote         resolution_id FK -> label_resolution
artist_label_signal_vote  resolution_id FK -> artist_label_resolution
```

**Six tables, not five.** Votes split by scope because a single `resolution_id` would otherwise be a
polymorphic foreign key across two tables — unenforceable in SQLite. A consequence of BR-13.2, not a
separate decision.

### New columns on `play` — the derived snapshot

```
label_verdict, label_confidence, label_contested, label_names,
label_match_method, label_narrowing_tier,
artist_label_verdict, artist_label_confidence, artist_label_names,
label_classifier_version,
label_resolution_id, artist_label_resolution_id,      <- BR-13.4, as-of-play pointers
liked_at_start, liked_at_end, liked_added_at, liked_transition
```

**16 columns** (was 14). The two resolution pointers replace the `label_resolved_at` column proposed
at NFR Design: a pointer to the exact version is strictly more informative than a timestamp, and it
cannot drift out of step with the row it describes. **Immutable once written** (BR-8.4a) — the play
snapshot is the as-of-play reading and backfill never revises it.

### The ResolutionTrace adds no schema

The trace is recomputed from `label_candidate` and `label_signal_vote`, which BR-8.7 already required
to be stored for reclassification. Getting a new capability for zero schema is not luck — it is the
direct payoff of storing observations separately from judgements, and it is the second time that
split has paid (the first was U1's completion threshold).

**Versioning makes the trace strictly better**: because a play points at the exact
`label_resolution_id` its verdict came from (BR-13.4), the trace can reconstruct the derivation from
the candidates *that version actually held* — not from whatever the current ones happen to be. Under
the pre-versioning design, re-resolving a track would have silently changed the explanation of an
older play.

### Why facts are cached but judgements are copied onto the Play

Resolutions are keyed by ISRC and artist and are **shared across plays** — caching them is what
satisfies FR-14 ("resolved at most once") and keeps MusicBrainz within 1 req/sec.

The *verdict* is snapshotted onto the Play instead, for the same reason U1 snapshots enrichment:
exports must contain every recorded field (FR-50) without a join, and a re-tuned classifier must
not silently rewrite the history of what was believed at the time. `label_classifier_version`
records which logic produced the stored verdict — without it, a partially reclassified database is
indistinguishable from a consistent one.

⚠️ **`liked_at_start` / `liked_at_end` are `NULL`-able and `NULL` means unknown**, never `false`.
This is the project's end-to-end rule and it matters most here: the saved-track set can be
unavailable, and a `false` written in its place would be an unrecoverable fabrication.
