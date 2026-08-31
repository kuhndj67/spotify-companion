# NFR Design Plan — U2: Label Enrichment

**Date**: 2026-08-31 · **Stage**: CONSTRUCTION — NFR Design, Unit U2
**Unit**: [`../../inception/application-design/unit-of-work.md`](../../inception/application-design/unit-of-work.md) (U2)
**NFRs in scope**: NFR-14, NFR-15, NFR-16, NFR-18 · **Rules**: BR-7, BR-8, BR-9, BR-12
**Functional Design**: [approved 2026-08-31](../u2-label-enrichment/functional-design/)

---

## Scope

Execution plan marks NFR Design **EXECUTE (narrow)**; NFR Requirements is **SKIP** — the 27 NFRs
are settled in `requirements.md` §4.

**U2 introduces one genuinely new class of non-functional problem: the app now depends on a
third-party service it does not own, cannot authenticate to, and can be banned from.**

U0 and U1 talked only to Spotify — authenticated, quota'd per user, failing loudly with status
codes. MusicBrainz is a free, unauthenticated, community-run service with a **policy-based** rate
limit whose enforcement is a `503` rather than a `429`, and whose data is **incomplete in a way this
project has already measured** (58% coverage, recency-biased).

Two consequences run through every question below:

1. **Latency is 0.1–6.7 s and unpredictable** (measured, Part 5). Anything on the display path
   stalls the UI for seconds at random intervals. NFR-16 is a measured constraint, not a precaution.
2. **Coverage is the thing being measured, so anything affecting coverage is a measurement decision,
   not a tuning decision.** A retry policy or a cache lifetime silently changes the `unknown` rate —
   and `unknown` is the population R2 is about.

### Categories evaluated

Recorded explicitly rather than skipped silently, per the stage rules.

| Category | Applicability |
|---|---|
| **Resilience patterns** | **Applicable — the core of this unit.** A new external dependency failing in ways Spotify does not: `503` throttling, silent partial data, and absent records that may appear later. Q2, Q3, Q7 |
| **Performance patterns** | **Applicable but narrow.** One hard constraint (NFR-16, never on the display path) and one throughput ceiling fixed by policy at 1 req/sec (NFR-15). No targets to choose — the ceiling is given. Q4 covers contention beneath it |
| **Security patterns** | **Applicable, and it is a posture change.** The app has been strictly local-only. U2 makes outbound requests to a third party carrying an identifying `User-Agent` and the ISRC of what is playing. Q5 |
| **Scalability patterns** | **Not applicable.** One user, one process, one machine, ~200 plays/day. The 1 req/sec ceiling is 86,400 requests/day against a working set of a few hundred distinct ISRCs. There is no load to scale to |
| **Logical components** | **Applicable — three new ones**: a serialised request queue, a two-level resolution cache, and a backfill job. Q1, Q3, Q4, Q6 |

---

## Questions

### Question 1 — How long does a resolution stay cached, and are `unknown` results cached at all?

**This has the largest effect on the data of anything in this plan, and it is not a performance
question.**

FR-14 says an ISRC is resolved *at most once*. Read literally, a `404` today is a `404` forever. But
MusicBrainz is **crowd-sourced and continuously growing**, and the probe measured precisely where it
is thin: pre-2022 releases resolved **5/5**, 2022-onward **6/14 (43%)**. Those misses are recent
independent singles — the population R1 is about. Many will be catalogued later.

Caching a negative result permanently **freezes the measured coverage bias into the dataset
permanently.** Re-resolving everything forever costs requests and makes a play's verdict a moving
target.

A) **Cache successes indefinitely; retry `unknown`s on a long TTL** (e.g. 30 days). A positive
   result is a stable fact; a negative one is a statement about MusicBrainz's *current*
   completeness. Costs a slow trickle of re-lookups, bounded by the number of unresolved ISRCs

B) **Cache everything indefinitely.** Strictest reading of FR-14, cheapest, fully reproducible — and
   permanently inherits today's coverage gap

C) **TTL on everything** (e.g. 90 days) — labels can also be *corrected* upstream, not only added

D) **Cache everything indefinitely, plus a manual "re-resolve unknowns" action** — no automatic
   behaviour; the user decides when to spend the requests

[Answer]: ~~A~~ → **C**, revised 2026-08-31. TTL on everything: `unknown`s at ~30 days,
successes at ~90 days, **each resolution appending a version** (BR-13). **User.**
See "Revision" at the end of this plan — A was structurally unable to record a label *change*.

---

### Question 2 — What happens when MusicBrainz fails or throttles?

MusicBrainz signals rate-limit rejection with **`503`**, not `429`, and can also simply time out.
NFR-18 says treat every upstream failure as partial data. BR-10.2 already separates the `unknown`
reasons (`noIsrc`, `notFound`, `noEligibleCandidate`, `error`).

The risk is specific: **a transient failure recorded as `unknown` is indistinguishable from a genuine
absence unless it is retried or distinctly marked.** Silently converting "the service was busy" into
"this release has no label" corrupts the coverage metric — and the coverage metric is the instrument
R2 is measured with.

A) **Bounded retry with backoff** (e.g. 3 attempts, exponential, still inside the 1 req/sec queue),
   then record `error` — distinct from `notFound` — and leave it eligible for a later sweep

B) **No retry.** One attempt; failure records `error` and backfill picks it up later. Simplest, and
   the backfill sweep already exists (BR-8.3)

C) **Retry only `503` and timeouts; never retry a `404`** — a `404` is an answer, not a failure

D) **A + C combined**, and additionally **pause the whole queue** on repeated `503`s, since
   continuing to hammer a service that is asking us to stop is what gets a client banned

[Answer]: D — bounded retry on `503`/timeout only, never on `404`; pause the queue on repeated `503`s. *Recommended default.*

---

### Question 3 — The queue is in-memory. What happens to pending work on restart?

At any moment the queue may hold lookups for recently played tracks. A restart drops them.

BR-8.3's backfill already scans for *"plays with an ISRC and no label resolution"*, so the system
**self-heals with no extra machinery** — the dropped work is exactly what backfill looks for. The
question is whether that is relied on deliberately or supplemented.

A) **Rely on backfill.** No queue persistence. The in-memory queue is a fast path; the database is
   the source of truth for what still needs doing. Nothing to lose, because nothing is stored in it

B) **Persist the pending queue** so work resumes exactly where it stopped

C) **Rely on backfill, and run a sweep at startup** so catch-up is prompt rather than waiting for a
   scheduled run

[Answer]: C — rely on backfill, no queue persistence, plus a sweep at startup. *Recommended default.*

---

### Question 4 — Live lookups and backfill share one 1 req/sec queue. Who goes first?

NFR-15 permits **one** request per second in total, and BR-7.1 requires a single queue. Backfill has
real volume: ~40 unresolved ISRCs × 2 calls, plus artist-level joins, plus the 47 one-off Spotify
`GET /tracks/{id}` calls for ISRC recovery (Q7 = A).

If backfill is queued ahead of the current track, **the label for what is playing right now could
arrive minutes late** — visible to the user as a `pending` panel that never seems to settle.

A) **Two priority classes.** The currently playing track jumps the queue; backfill fills idle time
   behind it. Bounded, predictable, and keeps the live experience intact

B) **Strict FIFO** — simplest, and occasionally leaves the live track waiting behind a backfill run

C) **Priority classes, and backfill runs only while nothing is playing** — zero contention, but
   backfill then makes no progress during long listening sessions, which is when the app is on

[Answer]: A — two priority classes; the live track jumps the queue. *Recommended default.*

---

### Question 5 — Outbound requests to a third party are a change in the app's posture. Confirm it.

**Surfacing this rather than deciding it, consistent with how the `localGuard` question was handled.**

Every prior network call went to Spotify — the service that already knows what you are playing,
because it is playing it. U2 adds a **second** party. Concretely, per unresolved track, the app sends
to `musicbrainz.org`:

- the **ISRC** of a track you are listening to, and/or your Spotify **artist ID**
- a `User-Agent` that NFR-14 **requires** to be descriptive and to carry a **contact address**
- timing that correlates with when you were actually listening

MusicBrainz is a reputable non-profit and this is its documented, intended use. But the app's stated
posture is local-only, and this is the first traffic to leave the machine other than Spotify's. Note
the tension: **NFR-14 mandates identifying ourselves**, so anonymity is not available without
violating their policy — which is not on the table.

Real mitigation does exist: the cache means each distinct ISRC is sent **once**, not once per play,
so what is exposed is closer to *your distinct library* than *your listening timeline*.

A) **Proceed as designed** — compliant `User-Agent` with contact address, requests made as tracks
   play. MusicBrainz's documented intended use

B) **Proceed, but decouple timing from listening** — hold lookups and release them on a fixed
   schedule or in batches, so request timing does not reveal when you were listening

C) **Proceed, with a generic contact address** (a project address rather than a personal email) —
   still NFR-14 compliant, less personally identifying

D) **Make outbound enrichment opt-in** with a config flag, defaulting to off

[Answer]: A — proceed as designed: compliant `User-Agent` with contact address, lookups as tracks play. **User.**

---

### Question 6 — How is the resolution trace (BR-12) delivered?

Deferred here from the Functional Design gate. BR-12.4 requires the trace to work for **any play in
history**, and BR-12.7 requires it to make zero upstream requests — so it is a pure local read.

The existing `/api/diagnostics` runs a fixed **system** health sweep with no parameters, and hits
Spotify and MCP on every call. A trace is a **per-play, parameterised, local-only** read. Bolting it
onto that endpoint means either a trace request re-runs the whole live health check (violating
BR-12.7) or the endpoint grows a mode switch that changes whether it touches the network.

A) **A separate `GET /api/explain/{playId}`**, rendered in a second section of the existing
   diagnostics dialog. Keeps your chosen placement in the UI; keeps each endpoint honest about what
   it does

B) **Extend `/api/diagnostics`** with an optional `playId` parameter that changes its behaviour

C) **Separate endpoint and a separate dialog** — do not reuse the diagnostics pop-up at all

[Answer]: A — separate `GET /api/explain/{playId}`, rendered in a second section of the diagnostics dialog. *Recommended default.*

---

### Question 7 — Two point-in-time captures cannot be recovered later. How hard do we try?

BR-9.1's warning is explicit: unlike an observation trail, liked-state captures are point-in-time and
**unrecoverable if missed**. Two mechanisms are exposed:

- **The saved-track set cache** — 596 tracks, **12 requests** to build. If it is stale or unavailable
  at play start, `likedAtStart` is `null` (BR-9.5, correctly — never `false`), and that play's
  liked-transition is permanently `unknown`.
- **The 30 s grace window** (BR-9.3) — a deferred re-check and a **second write** to a play row that
  has already been closed. If the app stops during that window, the amendment is lost.

A) **Refresh the saved-track set on a schedule and at startup; accept grace-window loss on
   shutdown** — an interrupted window loses at most a `liked-during` upgrade on one play

B) **A + persist pending grace-window checks**, so a restart still completes the amendment

C) **A + flush pending grace-window checks on graceful shutdown** — covers the ordinary case
   (Ctrl-C, restart) without persisting state for the crash case

[Answer]: C — scheduled + startup saved-track refresh, and flush pending grace-window checks on graceful shutdown. *Recommended default.*

---

## Recommendations

- **Q1 = A.** The asymmetry is real: a resolved label is a stable fact, while a `404` is a statement
  about MusicBrainz's completeness *today* — and the probe measured that completeness as both low
  and recency-biased. B is the literal reading of FR-14, but it would bake the 43% 2022-onward gap
  into the dataset permanently, undermining what U2 exists to measure. A spends a bounded trickle of
  requests on the one population the hypothesis is about. D is defensible but makes coverage depend
  on remembering to press a button.
- **Q2 = D (A + C, with the queue pause).** Distinguishing `error` from `notFound` matters more than
  the retry count: they mean opposite things about coverage, and BR-10.2 already has the field.
  Never retrying a `404` follows from it being an *answer*. The queue pause is the part not to skip —
  a client that keeps requesting through repeated `503`s is what gets an unauthenticated client
  blocked, and being blocked takes out the entire unit.
- **Q3 = C.** A is already correct in substance — the database, not the queue, knows what remains to
  be done — and that self-healing property comes free. C only makes catch-up prompt. Persisting a
  queue (B) adds durable state duplicating what the `play` table already implies.
- **Q4 = A.** The live track is the one thing a person is actually looking at. C over-corrects: it
  starves backfill during exactly the periods the app is running, which is when it could work.
- **Q5 = C.** Proceed — this is MusicBrainz's intended use and the unit cannot exist without it — but
  with a project contact address rather than a personal one, which is fully NFR-14 compliant and
  costs nothing. B's batching buys little once the cache means each ISRC is sent once. D is
  disproportionate: opting out disables the unit entirely. **Flagged rather than decided, since this
  is the same class of posture question as the `localGuard` item.**
- **Q6 = A.** BR-12.7 requires zero upstream requests; `/api/diagnostics` makes several by design. A
  mode switch that changes whether an endpoint touches the network is exactly the kind of thing that
  later gets called by accident. Your chosen placement in the dialog is preserved either way — this
  is about the route, not the UI.
- **Q7 = C.** B protects against a crash mid-window at the cost of durable state for a 30 s interval;
  the realistic loss under C is one `liked-during` upgrade during an ungraceful kill. The saved-track
  refresh is the part that matters, and it appears in all three options.

---

## Execution Checklist

- [x] Confirm answers; analyse for ambiguity (Step 5)
- [x] Generate `nfr-design/nfr-design-patterns.md`
- [x] Generate `nfr-design/logical-components.md` — request queue, two-level cache, backfill job
- [x] Verify NFR-14, NFR-15, NFR-16, NFR-18 are each addressed by a named pattern
- [x] Verify no pattern weakens NFR-01–07 (local-only posture) — Q5
- [x] Verify no pattern puts MusicBrainz on the display path (NFR-16, BR-7.5)
- [x] Verify `pending` stays distinct from `unknown` through the async path (BR-7.7)
- [x] Verify the trace path makes zero upstream requests (BR-12.7)
- [x] Confirm the cache policy's effect on coverage metrics is stated, not incidental (BR-10, R2)
- [x] Update `aidlc-state.md`; log in `audit.md`


---

## Revision — Q1 reopened by the user, 2026-08-31

After the plan was answered, the user raised a problem the questions had not covered:

> *"The back-correcting of any of our data fields raises a bigger issue given the fact that some of
> that data can change (an artist can sign with a label for instance). I'm thinking maybe we just
> stick to the data that is available at the time the track is played … I'm not sure if there's
> enough value in that chain of changes to make it worth the added complexity."*

### The distinction that resolves it

Two different things are called "the data changed", and they need opposite handling:

| | What happened | Correct handling |
|---|---|---|
| **Our knowledge changed** | A volunteer catalogued a release we could not see | The old verdict was **wrong**. Prefer the new |
| **The world changed** | The artist signed to a major | The old verdict was **right for its time**. Keep it |

**MusicBrainz cannot tell you which one occurred** — a lookup that 404'd in August and returns
`Atlantic` in January is byte-identical either way. So the design stops trying to decide at write
time and **keeps both readings**, choosing per level (BR-13.6). That is only expressible because Q12
kept release-level and artist-level separate: a release's label is a fact about a past event, while
an artist's is a fact about now.

### The user's proposal, tested against the schema rather than assumed

Proposed: a timestamped details table in a many-relationship with the track, latest row winning.
**Adopted as BR-13.** What checking the actual schema found:

| Check | Result |
|---|---|
| Precedent in the codebase | ✅ `observation` is already this shape — many timestamped rows per parent |
| Migration cost | ✅ **Zero.** `schema_version` is still 1; migration 002 was designed, never written |
| Storage cost | ✅ Negligible. `observation` already holds 1,296 rows for 71 plays (~3,600/day); a quarterly re-resolution of 1,000 ISRCs appends ~4,000 rows |
| "Same track record" | ⚠️ **There is no `track` table.** `play` denormalises track fields, so the parent is a key (`isrc`, `spotify_artist_id`), not a row |
| Candidates and votes | ⚠️ Must key to `resolution_id`, not `isrc` — otherwise BR-8.7 reclassification votes on a **union of 2026 and 2027 facts** |
| Vote table | ⚠️ Splits in two: one `resolution_id` cannot be a foreign key into two different tables |

### ⚠️ The finding that changed the answer

**The version chain is inert under Q1 = A.** Caching successes indefinitely means the app never looks
again, so the chain could only ever record `unknown → known` — our own catalogue gaps — and **never**
`independent → major`, which is the case that prompted the question. It would have appeared to work
while being structurally incapable of observing what it was built for.

Q1 therefore revised **A → C**. Measured cost at 1,000 distinct ISRCs: ~2,000 requests, roughly
**33 minutes** of `LOW`-priority queue, once per quarter. The current corpus is 19 distinct ISRCs.

### On "is the chain worth the complexity"

The user's doubt was well founded, and the answer is that **the expensive version is not needed**: a
track's sequence of plays is already a sparse time series, sampled at the moments that mattered.
Versioning the resolutions makes that series legible. No revision log, no temporal join machinery,
no `is_current` flag — the current value is `ORDER BY resolved_at DESC LIMIT 1`, which cannot go
stale.

### Consequences recorded

- **BR-13** added (8 rules); **BR-7.3, BR-7.4, BR-8.4a, BR-11.1a** amended
- Migration 002: **6 tables** (was 5), **16 `play` columns** (was 14)
- **Open finding `label_resolved_at` is closed** — superseded by `label_resolution_id`, a pointer to
  the exact version, which cannot drift out of step with the row it describes
- **FR-14 drift recorded**: "resolved at most once" now means *at most once per TTL window*
- **BR-11.1a**: the hypothesis test uses the **latest** release-level verdict and the
  **as-of-play** artist-level verdict; the alternative reading of each is a robustness check
