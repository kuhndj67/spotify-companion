# Business Logic Model — U4: Rule Observability

**Date**: 2026-09-19 · **Stage**: CONSTRUCTION — Functional Design, U4
**Stories**: US-20, US-23, US-24 · **Requirements**: FR-37, FR-41, FR-42

---

> ## The rule that governs the other rules
>
> **U4 invokes, records and replays. It never acts, and it never judges.**
>
> Verdicts come from U3's pure engine and nowhere else. Outcomes come from
> `outcomeClassifier` and nowhere else. U4 owns the *wiring* and the *record* — and the moment it
> owns a judgement, FR-42 stops being able to replay live behaviour, because the thing being
> replayed would no longer be the thing that ran.

---

## 1. The evaluation trigger (FQ1 = A-prime)

Exactly **one decision per play — in U4** (BR-22.1), taken at the first tick where enrichment has
settled, with a **10-second cap**.

> ⚠️ **Revised 2026-09-20 by the design review.** This section previously re-derived the play
> boundary from `trackId` and null samples, and defined `enrichmentSettled` as *"the resolver's
> queue state"* — a state that does not exist. Both are corrected below (BR-22.8, BR-22.5a–c).

**The boundary is `PlayObserver`'s** (BR-22.8). The coordinator does not segment; it subscribes.

```
observer.onPlayStarted(sample):           # the observer's own boundary, not a second one
    current := { trackId, startedAtMs, decided: false }

observer.onPlayRecorded(playId, record):  # fires ONLY after recordPlay() succeeds
    log.attachPlayId(current.evaluationId, playId)
    current := null

on tick(sample):
  if current is null or current.decided: return
  if sample.trackId != current.trackId:   return   # a stale tick; the observer decides boundaries

  facts := buildTrackFacts(sample, liveFacts, historyCountsBefore(..., now))

  if enrichmentSettled(sample.trackId):
      decide(facts, partialData = false)
  else if elapsedSince(current.startedAtMs) >= ENRICHMENT_WAIT_MS:   # 10 s
      decide(facts, partialData = true)
  # else: wait for the next tick
```

### `enrichmentSettled` is a tested predicate, not a queue peek (BR-22.5a–c)

```
settled(trackId) :=
      spotifyEnrichmentLanded(trackId)
  AND labelState(trackId) IN { completed, failed, not-attemptable }

not-attemptable :=  labelEnrichmentDisabled
                 OR (isrc IS NULL AND primaryArtistId IS NULL)
```

⚠️ **`not-attemptable` is the whole point.** The resolver exposes no per-track pending state, and
the only state that exists — `labelInFlight` / `labelByTrack` in `server.ts` — has **four** exits
that leave a track uncached. Three of them are indistinguishable from *"still working"* under a
naive *not-cached-and-not-in-flight* test, so a keyless track would wait the full 10 s and be
stamped `partialData = true`: **permanent absence recorded as a timeout**, which is exactly the
distinction FQ3 exists to draw, corrupting the one number U4 was built to measure.

Those maps, plus `likedAtStartByTrack`, move out of `server.ts` into a small tested **live-fact
source** that also builds `FactSources` — otherwise U4's wiring grows the one file the orphan
check excuses.

### Why not evaluate at track start

Measured on the live corpus for this design: a resolution already existed before the track started
for **94.9% of repeat plays** but only **0.5% of first plays**, and first plays are **86.6% of all
live plays**. A track-start trigger therefore reads `label.classification` as absent on roughly
seven plays in eight — for the field the project was built around.

> ⚠️ **The latency this waits on has never been measured, and the number that looked like it had
> was measuring something else.** Resolutions appear to complete a median of 0.2 s after track
> start; `resolvedAt` is stamped **before** the two MusicBrainz calls, so it records *initiation*.
> R11's floor — 2 calls behind a 1 req/sec queue, with observed 503 retries at 1200 ms — is the
> only evidence, and it is seconds. **The 10 s cap is a guess made explicit, not a measurement.**
> U4's live verification is the first chance to measure it: `partialData` counts how often the cap
> fired, which is precisely the missing number.

### What this hands U5

The trigger that eventually fires a real skip. A skip would land a few seconds into a track rather
than at its start — accepted deliberately, in the direction of *knowing the label* over *acting
instantly*. **Do not "optimise" this back to track-start in U5** without re-measuring the first-play
figure above.

---

## 2. The decision pipeline

```
NowPlayingService.tick ──────────────┬──────────────> PlayObserver
        │                            │                    │ owns the play boundary
        │                            │                    │
        │        onPlayStarted ◄─────┴────────────────────┤
        ▼                                                 │
  EvaluationCoordinator ── builds TrackFacts ── RuleEngine.evaluate (U3, pure)
        │      ▲                                       │
        │      │ liveFactSource                   Decision
        ▼      │ historyCountsBefore                    │
  DecisionExecutor ◄─────────────────────────────────────┘
        │  (LoggingExecutor — the ONLY implementation)
        ▼
  DecisionLog.record  ── one row per evaluated rule ──> history.db
        ▲
        └── onPlayRecorded(playId) ── back-fill playId ── PlayObserver
                (fires ONLY after recordPlay() succeeds)
```

⚠️ **`onPlayRecorded` does not fire when the write fails.** The observer counts a `gap`, sets
`degraded`, and the hook never runs — so the back-fill never happens and `playId` stays null for
ever. That is the *same* null BR-24.3 assigns to *"the play never closed"*, and the two point at
opposite conclusions: one is an expected W-3 case, the other is the database refusing a write to
the one artefact that cannot be regenerated. **The reason is recorded on the row**
(`pending` → `linked` versus `link-failed`), never inferred (BR-24.3a).

**`DecisionExecutor` has exactly one implementation and it cannot skip.** It takes no playback
collaborator — not an unused one, not an optional one. The U4 exit criterion is verified by the
import graph: `src/playback/` does not exist, and nothing in `src/rules/` imports a Spotify write
client.

> ⚠️ **`LoggingExecutor` must not be given a `PlaybackController` "for U5".** An injected
> collaborator that is never called is one line away from being called, and the phase boundary
> would then be a runtime flag rather than a structural fact. U5 adds `SkipExecutor` *alongside*.

---

## 3. What gets logged (Q3 = A)

One row per **rule evaluated**, matched or not, sharing an `evaluationId`.

This is why BR-14.7 made U3's evaluation **exhaustive rather than short-circuiting**: `fieldsSeen`
records what the rule actually read. A short-circuiting engine would log a truthful but partial
account of its own reasoning, and *"why did my rule not fire?"* would be unanswerable.

`fieldsSeen` records **nulls explicitly**. A field that read absent appears with a null value, not
by omission — end to end, `null` means unknown and is never `false` or `0`.

### Dry-run (Q8 = C)

```
live(rule) := globalAutomationEnabled AND rule.enabled AND NOT rule.dryRun
```

Logical AND in both directions: a rule is live only if the global switch **and** the rule agree.
A rule cannot opt out of a global dry-run. **In U4 `globalAutomationEnabled` is a constant
`false`** — there is nothing to enable — so every row is `dryRun = true`, `executed = false`.

> The switch is designed now and inert now, on purpose. FR-47 puts automation off by default, and
> settling precedence while being wrong is free is the point of doing it in this unit.

---

## 4. Rule-set loading, `watch()` and last-known-good (Q9, discharges BR-20.8)

⚠️ **Revised 2026-09-20 by the NFR probe.** This section originally described an event-driven
watcher with a 500 ms debounce. **`fs.watch` never fires over the Rancher Desktop bind mount** —
0 events in 12 s while the container read new content within 1 s. Change detection is polling
(P-19), and **the poll interval is the debounce**.

⚠️ **Revised again 2026-09-20 by the design review.** `RuleStore.load()` **cannot** deliver
last-known-good as written — it sets `#rules = []` on `failed`, on `absent` *and* on
`no-directory`. Settled: the **watcher owns the current set**; `RuleStore` becomes a parser that
returns a `LoadOutcome` and holds nothing (BR-26.3b).

```
RuleStore.read() -> LoadOutcome           # parser only: no #rules, no current()

RuleSetWatcher, every 5 s (or on reloadNow()):
  stat -> (mtime, size) unchanged?  -> return
  hash -> unchanged?                -> return
  switch RuleStore.read():
    loaded       -> swap atomically; version += 1; state := applied
    failed       -> keep last-known-good; state := rejected; record errors
    absent       -> cold start: empty set, quiet
                    RELOAD:     keep last-known-good; state := rejected
    no-directory -> cold start: empty set, loud
                    RELOAD:     keep last-known-good; state := rejected
  # version advances on `loaded` and on nothing else
```

⚠️ **`absent` on reload is a rejection, and this is the save race.** A write-temp-then-rename save
is momentarily `ENOENT`. Treated as an *accepted* empty set — which is what U3's store does — the
version would advance, every rule would silently drop for one poll interval, and the new file
would load 5 s later. The user would see a version bump, no error, and would have briefly run
**no rules at all**. Cold start is unchanged: there, absence really is *"run `npm run rules:init`"*.

⚠️ **Two `current()` methods would have been the trap.** Had `RuleStore` kept its state, the store
and the watcher would each expose `current()` returning different things, and a coordinator wired
to the store would evaluate against the wiped set while every indicator read green.

**Atomic swap between evaluations.** A reload never lands mid-evaluation: the coordinator reads the
current set once at the top of `decide` and uses that reference throughout. This is cheap because
U3's engine is pure — there is no partially-updated state to reconcile.

**Cold start with an invalid file (BR-20.7)** is inert: no rules, app runs, reason surfaced.
**Reload with an invalid file (BR-20.8)** keeps the last-known-good set — *now reachable for the
first time*, because U4 is where `watch()` exists.

### The indicator (FQ5)

| State | Shows |
|---|---|
| 🟢 `applied` | `Rules v6 — 4 active, 1 disabled` |
| 🟡 `reloading` | Minimum ~1 s display, so an instant reload is still *seen* |
| 🔴 `rejected` | `v7 rejected: rule 'skip majors' references unknown field 'album.kind'. Still running v6.` |

> ⚠️ **A silent last-known-good is indistinguishable from a successful reload**, and the user would
> believe an edit is live when it is not. Red **names the version still in force** — a light that
> only says "something failed" leaves exactly the ambiguity the indicator exists to remove.

---

## 5. Back-testing (FR-42, US-24)

```
backTest(rule, range):
  plays := EVERY play in range, ordered by started_at        # BR-28.3a — not "live plays"
  for each play:
      answerable := answerableFields(play)                   # §5.3, per ROW
      facts      := reconstructFacts(play, countsBefore(play.started_at))
      verdict    := RuleEngine.evaluateRule(rule, facts)     # the SAME pure engine
      classify into wouldMatch | wouldNotMatch | undecidable
      compare against play.outcome                           # §5.2
  return report                                              # writes NOTHING
```

⚠️ **"Live plays in range" was a defect.** §5.2 reports `notObserved` for **backfilled** rows, so
that selection made the counter permanently **zero** — the back-test reporting that the app never
missed anything, over a corpus where **86 of 543 rows are backfilled** and seven of the corpus's
ten early days exist *only* as backfilled rows. Eligibility (BR-28.3) decides what is **compared**;
it never decides what is **read**.

The **same engine**, not a back-testing variant. NFR-26's determinism is what makes the comparison
mean anything, and a second implementation would silently drift from the first.

### 5.1 Fact reconstruction is point-in-time (Q5 = A)

The four `history.*` counts are computed over plays **strictly before** this row's `started_at`:

```sql
COUNT(*) OVER (PARTITION BY track_id ORDER BY started_at
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
```

⚠️ **One method serves both paths** (BR-27.7). The live coordinator needs the same four counts and
`HistoryRepository` has **no counting method at all** today — not per track, not per artist. Two
implementations of *"plays of this artist before this instant"* is the segmentation mistake in a
second place, and it would be worse here because the two would agree on every fixture and diverge
only on the corpus. The signature is

```
historyCountsBefore(trackId, artistId, beforeIso): HistoryCounts
```

used by the back-test with `before = play.started_at` and by the live path with `before = now`.
⚠️ **It inherits the `artist_id` limitation**: `artist_id` is the **primary** artist, so a guest
credit is filed under the lead. Ren appears on 34 plays and owns the primary id on 26 — any
per-artist count is ~24% low for someone who guests often, live and in back-test alike. That is a
schema limit, not a listening pattern, and `historyRepository.test.ts` already pins it.

> ### ⚠️ Live and replay can legitimately disagree, and the design must say so (BR-27.8)
>
> The 6-hourly backfill inserts rows dated **in the past**. A back-test run next week over last
> week's range can therefore see prior plays that did not exist when the live decision was taken,
> so a reconstructed count can exceed the logged one **without either being wrong**.
>
> NFR-26's *"replays exactly"* is a claim about the **engine**, not about the corpus. Left
> unstated, the first person to compare a `fieldsSeen` count against a reconstruction finds a
> discrepancy, and the cheapest explanation available to them is *"the back-test is broken"*.

> ⚠️ **As-of-now counts fail US-24's own determinism criterion, and would pass every unit test.**
> *"The same rule and the same history, back-tested twice, gives identical results"* — under
> today's counts the corpus grows, the counts move, and next week's answer differs. Fixture history
> does not grow, so no test would catch it; it would surface months later as unexplained drift.
> Ren shows 47 plays today and had 0 at the start of the corpus.

⚠️ **The window must exclude the current row** (`1 PRECEDING`, not `CURRENT ROW`). Including it
makes every play count itself, and `history.playsOfTrack >= 1` becomes true for every row in
existence — a rule that looks like it is working and is matching a tautology.

### 5.2 Agreement (Q7 = B, three-way)

| Rule | Play outcome | Counted as |
|---|---|---|
| matched | `skipped` | `agreedWithUserSkip` |
| matched | `completed` | `disagreedWithUserKeep` |
| did not match | `skipped` | `missedUserSkip` |
| did not match | `completed` | (agreement by omission; not counted) |
| any | `unknown`, backfilled | `notObserved` |
| any | `unknown`, live | `inconclusive` |
| any | `skip_source = 'rule'` | `excludedRuleInitiated` — **0 until U5** |

The eligibility predicate mirrors the hypothesis gate exactly: `outcome IN ('completed','skipped')`.

> ⚠️ **`notObserved` and `inconclusive` stay separate**, for the reason the statistics panel
> already learned: merging them made the app's downtime look like the classifier's uncertainty,
> and completion read as 38% of the corpus where it was 74% of what was actually measured.

### 5.3 Unanswerable fields — decided **per row**, over two eras *(revised 2026-09-20)*

Before evaluating, the rule's referenced fields are intersected with the fields **this row** cannot
answer. Those are reported in `unanswerableFields`, and the affected plays land in `undecidable`,
never in `wouldNotMatch`.

| Era | Fields | Unanswerable when | Anchored by |
|---|---|---|---|
| **Schema** (migration 005) | `track.explicit`, `album.type` | row `id` ≤ the v5 watermark | a **stored watermark** (BR-27.5c) |
| **Code** (backfill, 2026-09-03) | `label.*` | `isrc IS NULL AND label_unknown_reason IS NULL` | the row itself (BR-27.5b) |

> ⚠️ **A back-test that reports 0 matches on an unanswerable field reads as "this rule matches
> nothing".** That is a wrong answer that looks like a finding — the same family as the
> MusicBrainz `inc=releases` 200 and the `Label detail` dash.

> ### ⚠️ The second gap has no migration behind it, and a schema-derived rule cannot see it
>
> Measured on the live corpus 2026-09-20:
>
> | Backfilled rows | ISRC | `label_verdict` | `label_unknown_reason` |
> |---|---|---|---|
> | 2026-08-20 → 08-31 | **0 of 82** | NULL ×82 | NULL ×82 |
> | 2026-09-03 → 09-16 | **4 of 4** | populated | populated |
>
> `recently-played` **does** return `external_ids.isrc` — probed live, HTTP 200, 3/3 items — and
> `RecentlyPlayedBackfill` has read `track.external_ids?.isrc` since **U1** (`a8136d9`).
>
> ⚠️ **Why those 82 lack one is UNESTABLISHED, and it is not the code** (BR-27.5d):
> `webApiClient.ts` has exactly one commit, the wiring never changed, live rows carried an ISRC
> from the very first one (row id 51), and the break is clean at **row id 120 → 155**
> (2026-09-01 → 09-03) with no code change in that window. **Do not invent a cause** — the rule
> is keyed on the row's own state and holds regardless of why the gap exists.
>
> On those 82 rows `label.classification` is null because **there was never a key to ask
> MusicBrainz with**, not because MusicBrainz had no label. Under a schema-only rule they would be
> counted in `unknownFieldCounts` as 82 plays that read the field absent — which any reader takes
> for **coverage**. ⚠️ **That is the 28%→12%-where-the-truth-was-86%→44% denominator bug,
> reappearing inside the instrument built to avoid it.**
>
> The data already separates the two facts: every row that *was* attempted carries a verdict or a
> reason (`notFound` 151, `noEligibleCandidate` 48). Never-attempted is the pair of nulls.
>
> ⚠️ **`started_at` cannot decide the schema era either** (BR-27.5c). The backfill writes rows
> dated in the past, so a row inserted *after* migration 005 for a play that happened *before* it
> is genuinely answerable — the backfill had the values. Judging by date would mark real data
> unanswerable; judging by row `id` against a watermark stored at migration time answers correctly.

### 5.4 Back-testing writes nothing

Not a decision row, not a play row, not a cached report. `POST /api/backtest` uses POST only
because a predicate does not fit a query string.

> ⚠️ *"The back-test endpoint started logging its own decisions"* is a plausible future change that
> would contaminate the decision log with hypothetical decisions and, through it, any later
> analysis. The prohibition is a business rule, not a convention.

---

## 6. Retention (Q4 = B, FQ4 = A)

Cap at **100,000 rows**, pruned oldest-first, **checked after each write batch** — which places it
inside the poll tick and off the evaluation path (BR-29.4). Cheap, and stated rather than left to
be inferred from *"never in the evaluation path"*.

⚠️ **The id list is chunked** below `SQLITE_MAX_VARIABLE_NUMBER` (BR-29.5). Steady state prunes a
handful of rows and never approaches the bound; the case that matters is the **first** run after
the cap is lowered or after a long unattended stretch, when the list can be tens of thousands of
ids at once — and that failure would land in the poll tick. A prune that throws must not stop
recording, for the same reason BR-20.10 keeps a bad rules file from stopping it.

Measured basis: 49 plays/day mean, 102 busiest, over the 9 days the app has actually run. At 10
rules that is ~491 rows/day — roughly 7 months to the cap. `observation` already holds 27,842 rows
in a 1.91 MB database, so this is a known-shaped load.

### The pruner reads `play`; only its DELETE is fenced (revised 2026-09-20)

```
ids    := SELECT d.id FROM decision d LEFT JOIN play p ON p.id = d.play_id
          WHERE <policy>                       -- reads play freely; writes nothing
DELETE FROM decision WHERE id IN (:ids)        -- names ONE table
```

> ⚠️ **A blanket ban on touching `play` would have deleted the interesting rows first.** Every
> policy keyed on the decision itself needs only the decision table. The one policy that needs the
> join is *"keep the decisions where the rule and I disagreed"* — the subset most worth keeping
> when authoring rules. The safety property was never about the module; it is about the **DELETE**.
> A `SELECT` cannot destroy anything.
>
> Pinned structurally: a test asserts the delete statement's SQL text contains no reference to
> `play`. ⚠️ A single statement that joined *and* deleted would pass every behavioural test and
> lose the property completely.

---

## 7. Read-only surface (Q11)

| Endpoint | Returns | Writes |
|---|---|---|
| `GET /api/rules` | `LoadedRuleSet` — version, state, per-rule status, disabled reasons | — |
| `GET /api/decisions` | Filtered, paginated `DecisionLogEntry` rows | — |
| `POST /api/backtest` | `BackTestReport` | **nothing** |

All three live in **`api.ts`**, taking collaborators by injection including `now`. `server.ts`
keeps wiring, startup and the `upgrade` handler.

> ⚠️ Routes that live in `server.ts` are untestable, and that is not a style claim: 952 lines and
> nine routes had **no tests at all** while the suite reported 98.96% coverage, because V8 omits
> unloaded modules from the **denominator**. That blind spot is what hid the WebSocket `403`.

**UI** (FQ6): the rules list with its version indicator, plus a read-only decision-log table —
time, track, rule, verdict, matched, fields seen — with a matches-only filter. No editing, no
charts.

### The execution trace (BR-32) — rule-level, chosen 2026-09-20

Per decision: the **trigger timeline** (track start → enrichment settled *or* the 10 s wait timed
out → decided) and, per rule, `verdict`, `applied`, `restedOnUnknown` and every value in
`fieldsSeen`.

**Rendered from the stored `Decision`. No second evaluation, no engine change.**

> ⚠️ **Per-node verdicts are out of scope, and the reason is a defect this project has already
> shipped.** `RuleOutcome` carries a rule-level verdict and a flat `fieldsSeen` map — not a tree.
> Tracing each node needs a second walk, and a second walk is a second implementation of the
> evaluator. That is the WebSocket `403` exactly: the admission rule was re-implemented rather than
> reused, the copies diverged, and **all 411 tests passed** while every handshake failed.
>
> A trace that drifts from the evaluator explains a decision that did not happen. If per-node
> tracing is wanted later it must come from **the same walk that produces the verdict**.

The decision-log view is not decoration: U4's live gate is *"a dry-run session produces a match log
the user agrees with"*, and agreement is a judgement made by reading. The two real defects in
`public/app.js` were both found by clicking.

---

## 8. Live verification protocol

CI green is not sufficient for U4. The dry-run exit criterion requires a real session:

1. Author 2–3 rules over fields with **known** corpus behaviour (a label rule, a genre rule, an
   `album.ageYears` rule).
2. Listen for a session with the container running.
3. Read the decision log against tracks actually heard, and confirm each match is one the rule
   should have made.
4. **Record how often `partialData` fired** — the first real measurement of enrichment latency,
   and the evidence for whether `ENRICHMENT_WAIT_MS` is right.
5. Confirm a deliberately broken `rules.json` produces 🔴 naming the version still in force, and
   that evaluation continues on the last-known-good set.

> ⚠️ Step 5 is the only way BR-20.8 is ever exercised. It has been specified since U3 and has
> never once run.
