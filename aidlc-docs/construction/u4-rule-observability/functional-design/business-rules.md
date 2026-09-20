# Business Rules — U4: Rule Observability

**Date**: 2026-09-19 · **Stage**: CONSTRUCTION — Functional Design, U4

Numbered, individually testable. Every rule states its source. Numbering continues from U3, which
ended at **BR-21.9**.

**Settled parameters**: one decision per play at first-enrichment or a 10 s cap · one log row per
rule evaluated · point-in-time history counts · three-way agreement · dry-run by logical AND ·
100,000-row cap · `explicit` and `album_type` persisted at schema v5 · back-test writes nothing.

> ### Revised 2026-09-20 by the senior-architect design review *(Fable)*
>
> Four decisions taken at the review, all confirmed against the code before being written down:
>
> | Settled | Rules |
> |---|---|
> | **`RuleSetWatcher` owns the current set**; `RuleStore` becomes a parser | BR-26.3a/3b |
> | **`PlayObserver` owns play segmentation**; the coordinator consumes its hooks | BR-22.8/8a |
> | **BR-22.1 is scoped to U4**; no uniqueness constraint may encode it | BR-22.1a |
> | **Answerability is per row**, covering a provenance gap as well as a schema era | BR-27.5a/5b/5c/5d |
>
> Plus corrections at BR-22.5, BR-23.7a, BR-23.9, BR-24.3a, BR-27.7/27.8, BR-28.3a, BR-29.4/29.5
> and BR-31.5–31.7. **Nothing in `src/` changed** — U4 has still written no code.

> ### The rule that governs the other rules
>
> **U4 invokes, records and replays. It never acts, and it never judges.**
> Verdicts come from U3's engine; outcomes come from `outcomeClassifier`. U4 owns wiring and
> record. A judgement of its own would make FR-42 replay something other than what ran.

---

## BR-22: The evaluation trigger

| # | Rule | Source |
|---|---|---|
| **BR-22.1** | Exactly **one decision per play — in U4**. A second decision for the same play is a defect *of this unit*, not a refinement | Q1 = A |
| **BR-22.1a** | ⚠️ **No uniqueness constraint or index may encode BR-22.1.** Not on `playId`, not on `(playId, ruleId)`, not on `evaluationId` per play | FR-34, settled 2026-09-20 |
| **BR-22.2** | The decision is taken at the **first tick where enrichment has settled** for the track | FQ1 = A-prime |
| **BR-22.3** | If enrichment has not settled within **`ENRICHMENT_WAIT_MS` = 10 000**, the decision is taken anyway with whatever is present | FQ1 |
| **BR-22.4** | When the cap fires, `partialData` is `true`; otherwise `false` | FQ3 |
| **BR-22.5** | `enrichmentSettled` is a **pure, tested predicate over explicit resolution state**, never inferred from fields reading null | P-17, audit 2026-09-20 |
| **BR-22.5a** | It is `true` when Spotify enrichment has landed **AND** label resolution has reached a terminal state: `completed`, `failed`, or **`not-attemptable`** | audit 2026-09-20 |
| **BR-22.5b** | **`not-attemptable` is terminal and immediate.** No ISRC *and* no artist id, or label enrichment disabled entirely, settles the track at once | audit 2026-09-20 |
| **BR-22.5c** | The state lives in a **tested live-fact source**, not in `server.ts`. That module also builds `FactSources` | audit 2026-09-20 |
| **BR-22.6** | The trigger consumes **`tick`**, never `change` | working rule |
| **BR-22.7** | A play that ends before a decision is taken logs **nothing**. Absence of a row is not a decision | BR-22.1 |
| **BR-22.8** | **Play segmentation is `PlayObserver`'s, and is not re-derived.** The coordinator consumes `onPlayStarted` / `onPlayRecorded` | settled 2026-09-20 |
| **BR-22.8a** | Consequence, accepted: **no repository ⇒ no evaluation.** The decision log lives in `history.db` regardless | settled 2026-09-20 |

> ### ⚠️ BR-22.7 has a measured blind spot: plays shorter than the wait are never evaluated
>
> Under BR-22.3's 10 s cap, a play that **ends** before the cap fires produces **no decision row at
> all**. Measured over 457 live plays on 2026-09-20:
>
> | | |
> |---|---|
> | Plays ending under 10 s | **13 — 2.8%** |
> | **Skips** ending under 10 s | **4 of 31 — 13%** |
> | Median skip duration | **87.6 s** — comfortably past the wait |
>
> **Bounded and acceptable, but it must not be discovered later as a gap in the log.** The back-test
> is unaffected (it reconstructs from stored plays, not from decisions), and in U5 a skip the user
> made inside 10 s is one they already acted on themselves. ⚠️ **But a missing row is not a "no
> match"** — anything counting decisions must use its own denominator, not the play count.
>
> ⚠️ **If `ENRICHMENT_WAIT_MS` is ever raised, this blind spot grows with it.** At 15 s it is 3.5%
> of plays and 5 of 31 skips. Re-measure before changing the constant.

> ### ⚠️ BR-22.8 — two segmenters that must agree is the WebSocket `403` shape
>
> The coordinator pseudo-code re-derived the play boundary from `trackId` and null samples.
> `PlayObserver` **already owns that boundary**, and owns more of it than the pseudo-code knew:
> the `pause-idle` close, the `playback-stopped` close, and the null-progress projection in
> `toPlaybackSample`. A second implementation would agree on the common case and diverge on
> exactly the edges — and **BR-24.1's `evaluationId → playId` back-fill depends on the two
> agreeing**, so a divergence would silently mis-link decisions to plays rather than fail.
>
> That is the admission-rule defect exactly: re-implemented rather than reused, copies diverged,
> **all 411 tests passed** while every handshake failed. One segmenter, consumed through the
> hooks it already exposes ([PlayObserver.ts:148](../../../../src/history/PlayObserver.ts),
> [:217](../../../../src/history/PlayObserver.ts)).
>
> ⚠️ **BR-22.8a is a real reduction in capability and was accepted knowingly.** With no
> repository there is no `onPlayRecorded`, so there is no evaluation — the rules engine goes
> quiet exactly when recording is broken. That is the safe direction (the Recording indicator
> already shouts, and BR-20.10 keeps the two concerns separate), and it costs nothing real
> because the decision log has nowhere to live in that state anyway.

> ### BR-22.6 is the `PlayObserver` lesson, applied to a second consumer
>
> `change` is signature-suppressed and the signature excludes progress. A trigger fed from it would
> evaluate sparsely and at the wrong moments — and would look like it was working. The existing
> integration test pins `PlayObserver`; U4 needs its own.

> ### ⚠️ BR-22.5 had no implementation behind it, and the naive one breaks FQ3
>
> *"The resolver's queue state"* names a thing that does not exist: the resolver exposes no
> per-track pending state. The only such state is `labelInFlight` / `labelByTrack` in `server.ts`,
> and it has **four** exits that leave a track uncached — three of which a naive
> *"not cached and not in flight ⇒ still pending"* test reads identically:
>
> | Exit | `server.ts` | Truth | Naive reading |
> |---|---|---|---|
> | Enrichment not landed yet | `enrichmentData === null` | genuinely pending | pending ✅ |
> | **No ISRC and no artist id** | returns, deliberately uncached | **permanently unanswerable** | pending ❌ |
> | **Both resolutions returned null** | uncached so a later tick retries | transiently failed | pending ❌ |
> | **`labelEnrichment === null`** | returns immediately | feature off — never answerable | pending ❌ |
>
> Under the naive definition a keyless track waits the **full 10 s cap** and is stamped
> `partialData = true`. That conflates **permanent absence** with **timeout** — precisely the
> distinction FQ3 exists to draw — and it would corrupt the one number U4 exists to measure.
> ⚠️ **`partialData` would over-report, and the over-report would look like evidence that
> `ENRICHMENT_WAIT_MS` is too low.** A wrong answer that reads as a finding.
>
> This is also why BR-22.5c moves the state out of `server.ts`: wiring it in place would grow the
> one file the orphan check excuses, and the settled predicate is a judgement, not wiring.

> ### BR-22.3's constant is a guess, and is labelled as one
>
> The enrichment latency this waits on **has never been measured**. The figure that appeared to
> measure it — resolutions completing 0.2 s after track start — is `resolvedAt` stamped *before*
> the two MusicBrainz calls, recording initiation. R11's floor is seconds. **`partialData` counts
> how often the cap fires, which is the first real measurement of it.**

---

## BR-23: What is logged

| # | Rule | Source |
|---|---|---|
| **BR-23.1** | One row per **rule evaluated**, matched or not | Q3 = A, FR-41 |
| **BR-23.2** | All rows of one decision share an `evaluationId` | FR-41 |
| **BR-23.3** | `fieldsSeen` records every field the rule read, **including those that read null** | FR-41, US-23 |
| **BR-23.4** | A null in `fieldsSeen` is written explicitly, never by omission | working rule |
| **BR-23.5** | `restedOnUnknown` is copied from the `Decision` **verbatim** and never accumulated | BR-21 (U3) |
| **BR-23.6** | `ruleName` and `ruleHash` are **denormalised** onto every row | Q2 caveat |
| **BR-23.7** | `engineVersion` and `ruleSetVersion` are stamped on every row | Q2 caveat |
| **BR-23.7a** | **`ruleSetContentHash` is stamped on every row too**, and it — not `ruleSetVersion` — is what identifies the set across restarts | BR-26.8, audit 2026-09-20 |
| **BR-23.8** | In U4, `dryRun` is always `true`, `executed` always `false`, `error` always `null` | FR-37 |
| **BR-23.9** | ⚠️ `liked.transition` is **structurally `unknown` on every live evaluation** and populated in every back-test. The field catalogue `note` must say so | audit 2026-09-20 |

> ### ⚠️ BR-23.9 is the profile that got `context` excluded, in a field that was kept
>
> `liked.transition` is derived at **play close**, from `likedAtStart` against the liked state at
> the end. A decision taken ~10 s into a play cannot have it, so live it is `unknown` **100% of
> the time** — while a back-test reads it from `play.liked_transition` and sees it populated.
>
> That is precisely the profile BR-16.6 used to exclude `context` from the catalogue (open item 7:
> available exactly where the outcome variable is not). The field is **kept** — it is genuinely
> useful in back-testing, which is what FR-42 is for — but a rule written against it will
> back-test beautifully and never fire live, and nothing on screen would explain why.
>
> Its catalogue `availability` is already `often-unknown`. That is too weak: it reads as a
> coverage statement about the data when the truth is a statement about **when** the field can
> exist. The `note` must say *"unknown during live evaluation; available in back-testing only"*.

> ### ⚠️ BR-23.7a — `ruleSetVersion` alone **misidentifies**, because it resets
>
> BR-26.8 makes `version` a per-process counter that restarts at 1. Stamped on a **permanent**
> table, a repeating small integer says nothing: today's `v3` and next month's `v3` are different
> rule sets wearing the same number, and nothing on the row distinguishes them.
>
> `ruleHash` does not close this — it identifies **one rule**, not the set that was in force.
> The counter stays, for the UI, where *"v7 rejected, still running v6"* is the whole point. The
> **hash** is what the durable row is attributable by.

> ### BR-23.6 answers the divergence the user raised at Q2
>
> *"a potential issue if the recorded decision differs from what a reconstruction from rules plus
> history says it SHOULD be."* With the rule's **content hash** on the row, a stored decision that
> disagrees with a recomputation is **attributable** — the rule was edited under the same id.
> Without it, an edited-but-same-id rule makes old decisions silently unreproducible, and the
> divergence would be discovered during reporting with no way to explain it.

---

## BR-24: The log's relationship to `play`

| # | Rule | Source |
|---|---|---|
| **BR-24.1** | `playId` is **nullable** and is back-filled when the play closes | §1 domain-entities |
| **BR-24.2** | `trackId` is recorded on every row, independently of `playId` | BR-24.1 |
| **BR-24.3** | A decision whose play never closes keeps `playId = null` **permanently**. This is correct, not a gap | W-3 shape |
| **BR-24.3a** | ⚠️ A play that closed but whose **row failed to write** must **not** be recorded the same way. The two are distinguished on the row | audit 2026-09-20 ext. |
| **BR-24.4** | Writing a decision row **never** blocks on, creates, or modifies a `play` row | NFR-10 |

> ### ⚠️ BR-24.3a — `playId = null` would otherwise mean two different things
>
> `PlayObserver` fires `onPlayRecorded` **only after `recordPlay` succeeds**. On a write failure it
> increments `#gaps`, sets `#degraded`, and the hook never runs — so the back-fill never happens
> and `playId` stays null for ever.
>
> That is the *same* null BR-24.3 assigns to *"the play never closed"*, and the two readings point
> at opposite conclusions: one says the instrument never saw the outcome (a W-3 case, expected),
> the other says the database refused a write (a fault, and the one artefact that cannot be
> regenerated). **`null` means unknown and is never `false` or `0`** — it must also never mean two
> incompatible things on the same column.
>
> The coordinator therefore records the *reason* the link is absent — `pending` → `linked`, versus
> `link-failed` — rather than leaving it to be inferred. Same family as `error` is not `unknown`,
> which produced three U2 defects that all passed the full suite.

> ### BR-24.1 is causality, not convenience
>
> A decision is taken *during* a play; the `play` row is written when the play *closes* — seconds
> to minutes later. A `NOT NULL` constraint would force the decision to wait for its own
> consequence. And the plays that never close cleanly — the app stops, the power goes out — are
> exactly the W-3 cases, where the decision still happened and should still be on the record.

---

## BR-25: Dry-run and precedence

| # | Rule | Source |
|---|---|---|
| **BR-25.1** | A rule is **live** only if global automation is enabled **AND** the rule is enabled **AND** the rule is not in dry-run | Q8 = C |
| **BR-25.2** | A rule **cannot** opt out of a global dry-run | Q8 = C |
| **BR-25.3** | In U4, global automation is a **constant `false`** | FR-47 |
| **BR-25.4** | Dry-run decisions are recorded as such and **never counted as user skips** | US-20, FR-23 |

---

## BR-26: Rule-set loading, `watch()` and last-known-good

| # | Rule | Source |
|---|---|---|
| **BR-26.1** | ⚠️ **SUPERSEDED 2026-09-20 by the NFR probe.** Originally "file events debounced by 500 ms" — `fs.watch` **never fires** over the bind mount. Change detection is **polling** (P-19): `stat` every 5 s, hash only when `mtime`/`size` move. **The poll interval is the debounce** | Q9.1, **revised by P-19** |
| **BR-26.2** | A valid reload **swaps atomically between evaluations**; no reload lands mid-evaluation | Q9.2 |
| **BR-26.3** | An invalid file **on reload** keeps the last-known-good set in memory | **BR-20.8**, deferred from U3 |
| **BR-26.3a** | ⚠️ On reload, **`absent` and `no-directory` are REJECTIONS**, not accepted empty sets | audit 2026-09-20 |
| **BR-26.3b** | The last-known-good set is owned by **`RuleSetWatcher`**. `RuleStore` becomes a **parser** — it returns a `LoadOutcome` and holds no current set | settled 2026-09-20 |
| **BR-26.4** | An invalid file **at cold start** leaves the app running with no rules and a surfaced reason | BR-20.7 |
| **BR-26.5** | `version` is a monotonic counter incremented **only on an accepted load** | FQ5 |
| **BR-26.6** | A **rejected** load does not advance `version` | FQ5 |
| **BR-26.7** | The rejected state names **which version is still in force**, and the errors | FQ5.2 |
| **BR-26.8** | `version` is **not persisted**; it resets on restart. `contentHash` carries identity across restarts | §4 domain-entities |
| **BR-26.9** | The `reloading` state displays for a **minimum of ~1 s** so an instant reload is still visible | FQ5.1(b) |

> ### ⚠️ BR-26.3b — `RuleStore` as written **cannot** deliver last-known-good
>
> `RuleStore.load()` sets `#rules = []` on **every** non-`loaded` outcome — `failed`
> ([RuleStore.ts:118](../../../../src/rules/RuleStore.ts)), `absent` (:102) and `no-directory`
> (:108) — and the comment at :116 says so deliberately, because in U3 there was no reload and
> nothing to retain. **If the watcher calls `load()`, BR-26.3 is violated the first time a bad
> file lands.**
>
> Settled 2026-09-20: the **watcher owns the set**; the store stops holding one. This also
> removes a trap the alternative left standing — `RuleStore.current()` and
> `RuleSetWatcher.current()` would otherwise be two methods with the same name returning
> different things, and a coordinator wired to the wrong one silently evaluates against the
> wiped set while every indicator reads green.
>
> ### ⚠️ BR-26.3a — the save race, which only a reload can reach
>
> A write-temp-then-rename save is momentarily `ENOENT`. `RuleStore` classifies that as `absent`
> and treats it as an **accepted empty set**: under BR-26.5 the version would advance, every rule
> would silently drop for one poll interval, and the new file would load 5 s later. The user sees
> a version bump and no error, having briefly run **no rules at all**.
>
> Cold start is unchanged — there, `absent` genuinely is *"no rules file yet"*, which
> `npm run rules:init` fixes. It is only on **reload** that absence is a fault.

> ### BR-26.6 is what makes the indicator sayable
>
> *"v7 rejected, still running v6"* is only expressible if 7 was never taken. A counter that
> advanced on **attempts** would leave the running set unnameable at exactly the moment the user
> needs to know it — and a silent last-known-good is indistinguishable from a successful reload.

---

## BR-27: Back-test fact reconstruction

| # | Rule | Source |
|---|---|---|
| **BR-27.1** | The **same** `RuleEngine` evaluates back-tests and live decisions. No variant | NFR-26 |
| **BR-27.2** | `history.*` counts are **point-in-time**: plays strictly **before** this row's `started_at` | Q5 = A |
| **BR-27.3** | The counting window **excludes the current row** | BR-27.2 |
| **BR-27.4** | Fields no given row **can** answer are **`unanswerable`**, not null-valued | FQ2 |
| **BR-27.5** | Answerability is computed **per row, from the row**, never inferred from a value coming back null | R2, settled 2026-09-20 |
| **BR-27.5a** | Schema era: `track.explicit` and `album.type` are unanswerable on **pre-v5** rows | FQ2 = B |
| **BR-27.5b** | ⚠️ **Provenance gap**: `label.*` is unanswerable where `isrc IS NULL AND label_unknown_reason IS NULL` — the row was never asked | measured 2026-09-20 |
| **BR-27.5d** | ⚠️ The **cause** of BR-27.5b's gap is **unestablished**. The rule is keyed on the row's own state, never on a date or a supposed cause | measured 2026-09-20 |
| **BR-27.5c** | Schema era is judged by a **stored watermark** — the `id` of the last row inserted before migration 005 — never by `started_at` | audit 2026-09-20 |
| **BR-27.7** | The **same** repository method computes history counts live and in back-test: `historyCountsBefore(trackId, artistId, beforeIso)`, with `before = now` live | audit 2026-09-20 |
| **BR-27.8** | ⚠️ A later reconstruction may legitimately see **more** prior plays than the live evaluation saw. This is expected, not drift | audit 2026-09-20 |
| **BR-27.6** | The same rule over the same range produces **identical** results on repeated runs | US-24 |

> ### ⚠️ BR-27.5b — answerability has a SECOND era, and it has no migration to anchor it
>
> BR-27.5 originally derived era from the **schema**, which can only see migration 005. Measured
> on the live corpus 2026-09-20, there is a second boundary the schema cannot see:
>
> | Backfilled rows | ISRC present | `label_verdict` | `label_unknown_reason` |
> |---|---|---|---|
> | 2026-08-20 → 08-31 | **0 of 82** | NULL on all 82 | NULL on all 82 |
> | 2026-09-03 → 09-16 | **4 of 4** | populated | populated |
> | *(live, all dates)* | 457 of 457 | populated on all 457 | — |
>
> ⚠️ **The cause is unestablished, and it is NOT the code** (BR-27.5d). `recently-played` **does**
> return `external_ids.isrc` — probed live 2026-09-20, HTTP 200, 3/3 items — and
> `RecentlyPlayedBackfill` has read `track.external_ids?.isrc` since **U1** (`a8136d9`).
> `webApiClient.ts` has exactly one commit, the wiring never changed, and live rows carried an
> ISRC from the very first one (row id 51). The break is clean at **row id 120 → 155**
> (2026-09-01 → 09-03) with **no code change in that window**.
>
> **Do not invent a cause.** What matters for U4 is that no `ALTER TABLE` marks the boundary, so
> no schema-derived watermark can find it — and the rule is therefore keyed on **the row's own
> state**, which holds regardless of why the gap exists.
>
> **Why it matters to the back-test**: on those 82 rows `label.classification` is null because
> *there was never a key to ask MusicBrainz with* — not because MusicBrainz had no label. Under a
> schema-only rule they would be counted in `unknownFieldCounts` as 82 plays that "read
> `label.classification` absent", which a reader takes for **coverage**. ⚠️ **That is the
> 28%→12%-where-the-truth-was-86%→44% denominator bug, reappearing inside the new instrument** —
> a wrong answer that looks like a finding.
>
> The data already separates the two: `label_verdict IS NULL AND label_unknown_reason IS NULL`
> means **never attempted**, and every row that *was* attempted carries a reason
> (`notFound` 151, `noEligibleCandidate` 48) or a verdict. Answerability is therefore a predicate
> over **the row**, and `unanswerableFields` becomes row-dependent rather than range-dependent.
>
> ⚠️ **The general shape**: an era boundary can come from a code change with no migration behind
> it. Anywhere answerability is derived from the schema, ask whether a column was ever populated
> by code that did not always exist.

> ### ⚠️ BR-27.5c — `started_at` cannot decide schema era
>
> The 6-hourly backfill inserts rows dated in the **past**. A backfilled row written *after*
> migration 005 for a play that happened *before* it is answerable for `explicit` and
> `album_type` — the backfill had the values — yet `started_at` places it in the pre-v5 era.
> Judging by row `id` against a watermark stored at migration time answers correctly; judging by
> date marks real data unanswerable.

> ### BR-27.8 is stated here so live verification does not discover it
>
> NFR-26's *"replays exactly"* is a claim about the **engine**, not about the corpus. Because the
> backfill writes rows dated in the past, a back-test run next week over last week's range can see
> prior plays that did not exist when the live decision was taken — so a reconstructed count can
> legitimately exceed the logged one. `fieldsSeen` makes the difference detectable, which is what
> turns it from unexplained drift into a recorded fact.

> ### BR-27.2 exists because as-of-now counts would pass every test
>
> US-24 requires two back-tests of the same rule over the same history to be identical. With
> today's counts they are identical only within a day — the corpus grows and the counts move.
> **Fixture history does not grow**, so no unit test would catch it; it would surface months later
> as unexplained drift. Ren shows 47 plays today and had 0 at the start of the corpus.

> ### BR-27.3 — off by one row, and the rule matches a tautology
>
> A window including the current row makes every play count itself, so
> `history.playsOfTrack >= 1` is true for **every row in existence**. The rule looks like it is
> working and is matching nothing but its own arithmetic.

---

## BR-28: Back-test reporting

| # | Rule | Source |
|---|---|---|
| **BR-28.1** | `undecidable` is reported **separately** from `wouldNotMatch` | US-24, Q6 |
| **BR-28.2** | `notObserved` (backfilled) is reported **separately** from `inconclusive` (live) | Q7 = B |
| **BR-28.3** | Eligibility for the **agreement comparison** is `outcome IN ('completed','skipped')` — the hypothesis gate's predicate | Q7 = A/B |
| **BR-28.3a** | ⚠️ The back-test **iterates every row in range**, not only live or only eligible ones. Eligibility selects what is *compared*, never what is *read* | audit 2026-09-20 |
| **BR-28.4** | Plays with `skip_source = 'rule'` are excluded from the agreement comparison | FR-23, US-24 |
| **BR-28.5** | Unknown fields are **reported**, never silently excluded | US-24 |
| **BR-28.6** | A back-test **writes nothing** — no decision row, no play row, no cached report | FQ7 |

> ### ⚠️ BR-28.3a — the selection and the report contradicted each other
>
> §5's pseudo-code selected *"live plays in range"* while §5.2 reports `notObserved` for
> **backfilled** rows. With that selection `notObserved` is **always zero** — a counter that can
> never fire, reporting that the app never missed anything, over a corpus where **86 of 543 rows
> are backfilled** and seven of the corpus's ten early days exist *only* as backfilled rows.
>
> A permanent zero reads as *"no gaps"*. That is the 2026-09-06 merge inverted: instead of the
> instrument's downtime being drawn as the classifier's uncertainty, it would be drawn as
> **nothing at all**. R2 depends on the miss staying visible.

> ### BR-28.1 and BR-28.2 are two merges this project has already paid for
>
> Folding `undecidable` into `wouldNotMatch` reports *"your rule matched nothing"* when the truth
> is *"your rule could not be answered"* — the `Label detail` dash and the `inc=releases` 200 in a
> new place. Folding `notObserved` into `inconclusive` is the 2026-09-06 merge exactly: the app's
> **downtime** rendered as the classifier's **uncertainty**, which read completion as 38% of the
> corpus where it was 74% of what was measured.

> ### BR-28.4 is a guard with nothing to guard, and must still be built
>
> The corpus has **0** rows with `skip_source = 'rule'` and will until U5 is armed. The first row
> it must exclude appears the moment automation runs — by which time the back-test will already
> have been trusted. Same shape as W-3: a design guard, not a repair.

---

## BR-29: Retention

| # | Rule | Source |
|---|---|---|
| **BR-29.1** | The decision log is capped at **100,000 rows**, pruned oldest-first | Q4 = B, FQ4 = A |
| **BR-29.2** | The cap is a **constant, not a setting** | U3 precedent |
| **BR-29.3** | The pruner's **DELETE** names **only** the decision table and deletes by an explicit id list | Q4 warning, user 2026-09-20 |
| **BR-29.3a** | The pruner **may read `play`** to decide *which* ids to prune, in a `SELECT` that writes nothing | user 2026-09-20 |
| **BR-29.3b** | The read and the delete are **separate statements**. No `DELETE ... USING`, no `DELETE ... WHERE id IN (SELECT ... JOIN play ...)` | BR-29.3 |
| **BR-29.4** | Pruning never runs inside the evaluation path. It is **checked after each write batch**, which puts it inside the poll tick and off the evaluation path | NFR-10, audit 2026-09-20 |
| **BR-29.5** | The explicit id list is **chunked** below SQLite's bound-variable limit, and the chunks run in one transaction | audit 2026-09-20 |

> ### BR-29.5 exists for the one-time case, not the steady state
>
> Steady state prunes a handful of rows per tick and never approaches a bound. The case that
> matters is the **first** run after the cap is lowered, or after a long unattended stretch, when
> the delete list can be tens of thousands of ids at once. `SQLITE_MAX_VARIABLE_NUMBER` refuses
> that, and the failure lands in the poll tick.
>
> ⚠️ **A prune that throws must not stop recording.** The same reasoning as BR-20.10: retention is
> housekeeping, and the plays are the artefact that cannot be regenerated.

> ### BR-29.3 splits the read from the write, because forbidding the read costs a real policy
>
> A decision row is recomputable from rules plus history; a play row is recomputable from nothing —
> `recently-played` is a 50-play window and seven of the corpus's ten days exist only as backfilled
> rows. A pruner able to name `play` **in a DELETE** is one wrong `WHERE` clause from the one
> artefact here that cannot come back.
>
> ⚠️ **But a blanket ban on touching `play` forecloses the most useful retention policy there is.**
> Raised by the user 2026-09-20. Every policy keyed on the decision itself — keep matches, keep the
> last N per rule, prune oldest — needs only the decision table. The one policy that needs the join
> is *"keep the decisions where the rule and I disagreed"*, which is precisely the subset worth
> keeping when authoring rules. Banning the read would have quietly deleted the interesting rows
> first.
>
> **The safety property is about the DELETE, not about the module.** A `SELECT` cannot destroy
> anything, so the join is safe by construction; what must never happen is a delete whose predicate
> can reach `play`. Splitting them keeps the policy and keeps the guarantee.
>
> **Pinned structurally**, the way `localGuard.test.ts` pins the upgrade handler: a test asserts the
> delete statement's SQL text contains no reference to `play`. ⚠️ A single statement that joined and
> deleted would satisfy every behavioural test and lose the property entirely — this is the
> *"guard computed the same way as the thing it guards"* shape, and it is why the rule constrains
> the **SQL text** rather than the outcome.
>
> A stronger mechanism is available if it is ever wanted: a dedicated read connection under
> `PRAGMA query_only = 1`. Not specified here — it buys enforcement the text assertion already
> gives, at the cost of a second connection to a file with one writer.

---

## BR-30: The phase boundary

| # | Rule | Source |
|---|---|---|
| **BR-30.1** | `DecisionExecutor` has **exactly one** implementation in U4, and it cannot skip | unit-of-work exit criterion |
| **BR-30.2** | `LoggingExecutor` takes **no playback collaborator** — not an unused one, not an optional one | BR-30.1 |
| **BR-30.3** | **`src/playback/` does not exist** at the end of U4 | unit-of-work |
| **BR-30.4** | Nothing in `src/rules/` imports a Spotify **write** client | BR-30.3 |
| **BR-30.5** | The boundary is verified by **inspecting the import graph**, not by a runtime flag | unit-of-work |

> ### ⚠️ U3's containment guarantee is retired here, deliberately
>
> U3's was *"`git status src/` shows only `src/rules/`"*. U4 necessarily changes the poll loop,
> `api.ts`, the schema and the UI, so that guarantee **cannot survive this unit** — and from here
> the phase boundary rests entirely on BR-30.3. That is a weaker guard than U3's, and it is stated
> rather than discovered.
>
> An injected-but-uncalled `PlaybackController` would reduce the boundary to a runtime flag. U5
> adds `SkipExecutor` **alongside** `LoggingExecutor`; it does not grow one into the other.

---

## BR-31: Schema v5

| # | Rule | Source |
|---|---|---|
| **BR-31.1** | Migration 005 adds the decision-log table and its indexes | Q2 = A |
| **BR-31.2** | Migration 005 adds `explicit` and `album_type` to `play` | FQ2 = B |
| **BR-31.3** | Both new columns are **nullable**. Null on a **pre-v5 row** means **unanswerable**, not `false` | BR-27.4 |
| **BR-31.3a** | The limitation is **temporal and back-test-only**. Live evaluation reads both from enrichment and resolves them normally | user 2026-09-20 |
| **BR-31.3b** | ⚠️ A null arriving from enrichment because `GET /tracks/{id}` **failed** is `unknown`, and must never be written as `false` | `error` is not `unknown` |
| **BR-31.4** | Persisting them costs **zero** additional upstream requests | FQ2 |
| **BR-31.5** | The **write path is in scope**: `PlaybackSample` → `NewPlayRecord` → the `INSERT` in `SqliteHistoryRepository.recordPlay` → `PlayRecord` → the export serialisers, **CSV headers included** | audit 2026-09-20 |
| **BR-31.6** | `RecentlyPlayedBackfill` populates both. ✅ **Probed 2026-09-20**: `recently-played` returns `explicit` and `album.album_type` on every item | probe 2026-09-20 |
| **BR-31.7** | Migration 005 stores a **schema-era watermark** — the maximum `play.id` at migration time — read by BR-27.5c | audit 2026-09-20 |

> ### ⚠️ BR-31.5 — a column with no writer is a column that is always null
>
> The migration was fully specified and the **write path was not in any scope table**. Two new
> columns would have shipped, stayed null on every row, and then been read back as *unanswerable*
> by BR-27.4 — for ever, with the migration reporting success. Six files change, and the export
> serialisers are the easiest of them to forget because nothing fails without them: a CSV that
> silently lacks two columns is indistinguishable from a CSV that predates them.
>
> ### BR-31.6 was probed rather than assumed
>
> The claim *"`recently-played` carries both"* came from a review, not a probe, and
> `RecentlyPlayedBackfill`'s hand-written response type declares only
> `album?: { name, release_date }` — which is exactly what an absent field looks like. Probed
> live: `HTTP 200`, `explicit` present on 3/3 items, `album.album_type` present on 3/3
> (`album`, `album`, `single`).
>
> ⚠️ **The same probe disproved a standing claim in CLAUDE.md** — see BR-27.5b. `external_ids.isrc`
> is returned too, and has been read by the backfill since 2026-09-03.

> ### BR-31.2 stops the app discarding data it already pays for
>
> `explicit` and `album_type` both come back from the `GET /tracks/{id}` call already made for
> every enriched track, and both already reach `TrackFacts`. They were simply never written down.
> The question *"is this data never reported by our sources?"* was answered by probe: **it is
> reported, on every enriched track.**

---

## Requirements coverage

| Requirement | Status in U4 |
|---|---|
| **FR-37** dry-run | ✅ BR-25 |
| **FR-41** log rule, field values, verdict | ✅ BR-23 |
| **FR-42** back-test against history | ✅ BR-27, BR-28 |
| **BR-20.8** last-known-good on reload | ✅ **discharged** — BR-26.3 |
| FR-33 `hold` | ⚠️ **still PARTIAL** — U5. Unchanged by this unit |
| FR-23 exclude rule-initiated skips | ✅ built, BR-28.4 — **inert until U5** |
| FR-38, FR-39, FR-40 | ⬜ U5 |


---

## BR-32: The execution trace (debug output)

Added 2026-09-20 at the user's request, to make the rules system's output legible during hands-on
evaluation. **Scope chosen: rule-level, not per-node.**

| # | Rule | Source |
|---|---|---|
| **BR-32.1** | The trace reports, per rule: `verdict`, `applied`, `restedOnUnknown`, and `fieldsSeen` with every value | user 2026-09-20 |
| **BR-32.2** | It reports the **trigger timeline**: track start, whether enrichment settled or the wait timed out, and when the decision was taken | BR-22 |
| **BR-32.3** | The trace is **rendered from the stored `Decision`**. It adds **no** new evaluation and **no** engine change | user 2026-09-20 |
| **BR-32.4** | Per-**node** predicate verdicts are **out of scope**. "Which branch of the AND decided it" is not answerable in U4 | user 2026-09-20 |

> ### BR-32.3 is the whole reason this scope was chosen, and it avoids a known failure
>
> U3's `RuleOutcome` carries a rule-level verdict and a flat `fieldsSeen` map — **not** per-node
> verdicts. A per-node trace would require a second walk of the predicate tree, and a second walk
> is a second implementation of the evaluator.
>
> ⚠️ **That is the WebSocket `403` exactly.** The local-access policy was re-implemented rather
> than reused, the copies diverged, and **all 411 tests passed** while every handshake failed —
> the UI sat on "Disconnected" in a way that read as *Spotify is down*. A trace that drifts from
> the evaluator is worse than no trace: it explains a decision that did not happen.
>
> If per-node tracing is wanted later, it must come from **the same walk that produces the
> verdict** — one function returning both — never from a parallel `explain`.

⚠️ **What this gives up**: with `fieldsSeen` showing every value, the deciding branch is usually
inferable by hand, but it is not *stated*. On a deep predicate with several unknowns that inference
gets harder. The upgrade is additive and needs no rework of what U4 builds.
