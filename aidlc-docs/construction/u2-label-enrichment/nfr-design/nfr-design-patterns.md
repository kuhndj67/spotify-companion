# NFR Design Patterns — U2: Label Enrichment

**Date**: 2026-08-31 · **Stage**: CONSTRUCTION — NFR Design, Unit U2
**Decisions**: Q1 = **C** (TTL on everything — *revised from A on 2026-08-31*) · Q2 = D (typed retry
+ queue pause) · Q3 = C (backfill self-heals, startup sweep) · Q4 = A (priority classes) ·
Q5 = A (proceed as designed) · Q6 = A (separate `/api/explain/{playId}`) ·
Q7 = C (refresh + graceful flush) · **BR-13 versioned resolutions**

---

## Scope

U1 introduced state that matters. **U2 introduces a dependency that matters** — a third-party
service the app does not own, cannot authenticate to, and can be banned from.

Everything below follows from three measured facts, not from anticipated ones:

| Measured | Consequence |
|---|---|
| Latency **0.1–6.7 s**, highly variable (Part 5) | P-2: never on the display path |
| Coverage **58%**, misses **recency-biased** (pre-2022 100%, 2022+ 43%) | P-3: negative results are not facts |
| Rate limit is **policy**, enforced by `503`, no API key to throttle per-key | P-1, P-4: self-restraint is the only control |

Scalability patterns are **not applicable** and are recorded as such in the plan. Security patterns
are addressed in P-6 and §10.

---

## P-1: Single serialised queue with two priority classes

**Addresses**: NFR-15, BR-7.1 · **Decision**: Q4 = A

Every MusicBrainz request — live, backfill, or artist-level — passes through **one** queue emitting
at most one request per second. There is no second path, because two independently-correct rate
limiters still add up to two requests per second.

```
live lookup (now playing)  ──▶ ┌──────────────┐
                               │  HIGH   ────▶ │──▶ 1 req/sec ──▶ MusicBrainz
backfill sweep             ──▶ │  LOW    ────▶ │
artist-level join          ──▶ └──────────────┘
```

**Why priority is not a nicety.** Backfill has real volume: ~40 unresolved ISRCs × 2 calls, plus
artist joins. Under strict FIFO, the track playing *right now* queues behind all of it and its label
arrives minutes late — presenting to the user as a `pending` panel that never settles. The live
track is the only thing a person is actually looking at.

**Constraint**: priority controls **ordering only**, never rate. A high-priority item waits its turn
in the 1 req/sec cadence like everything else. A "priority" that bypasses the limiter would defeat
NFR-15 exactly when the app is busiest.

---

## P-2: Enrichment is off the display path, and `pending` is a real state

**Addresses**: NFR-16, BR-7.5, BR-7.7

The now-playing panel renders from Spotify data alone and never awaits a MusicBrainz result. Label
fields arrive later by the same push path the UI already uses.

**`pending` is a distinct state, not a flavour of `unknown`.**

| State | Meaning | Counted in coverage? |
|---|---|---|
| `pending` | Lookup queued or in flight | **No** — not yet an answer |
| `unknown` | Resolved, and the answer is "not known" | **Yes** |

Collapsing them would corrupt the coverage metric by counting in-flight lookups as absent data — and
R2 is the thing that metric exists to measure. At 1 req/sec with a backfill running, `pending` can
persist for minutes, so this is a common state rather than a transient one.

---

## P-3: Versioned resolutions with a uniform TTL

**Addresses**: FR-14, NFR-15, R2, BR-13 · **Decision**: Q1 = C *(revised from A, 2026-08-31)*

```
every resolution  ─▶ appends a new version, keyed by resolution_id   (BR-13.1)
successes         ─▶ re-resolved on a ~90-day TTL                     records label CHANGE
unknowns          ─▶ re-resolved on a ~30-day TTL                     records knowledge ARRIVING
current value     ─▶ ORDER BY resolved_at DESC LIMIT 1                (BR-13.3)
```

**This is the pattern with the largest effect on the data, and it is a measurement decision rather
than a performance one.** Two distinct problems are being solved, and conflating them is what made
the first version of this pattern wrong.

| Problem | Measured / raised | Handled by |
|---|---|---|
| MusicBrainz is **incomplete**, and the gaps are recency-biased (2022+ at 43%, pre-2022 100%) | Probe, Part 5 | TTL on `unknown` |
| The underlying fact **changes** — an artist signs to a label | User, 2026-08-31 | TTL on **success** + versioning |

### ⚠️ Why Q1 was revised from A to C

The original answer cached successes **indefinitely**. Under it, a version chain could only ever
record `unknown → known` — our own catalogue gaps filling in. It could **never** record
`independent → major`, because after the first success the app stops looking. The chain would have
appeared to work while being structurally incapable of observing the case that motivated it.

Measured cost of the revision, at 1,000 distinct ISRCs: ~2,000 requests, about **33 minutes** of
background queue at `LOW` priority, once per quarter. Current corpus is **19 distinct ISRCs**. The
constraint that makes this cheap is the same one that makes P-1 necessary — everything is already
serialised at 1 req/sec, so a quarterly sweep is just a longer quiet stretch of the queue.

### Storage was checked, not assumed

`observation` already holds **1,296 rows for 71 plays** — roughly 3,600/day at the project's rate. A
full quarterly re-resolution of 1,000 ISRCs appending ~4 candidates each is **4,000 rows per
quarter**. The version chain is two to three orders of magnitude below what the database already
absorbs daily. Storage is not a constraint here, and this is why.

### The cache is not a cache

It is a durable, append-only record. BR-8.7 recomputes verdicts from `label_candidate` and the vote
tables; BR-12 re-runs the classifier over the same rows to build a trace. **Eviction would break
both.** Nothing in these tables may be treated as discardable, and there is no `is_current` flag to
maintain — the current row is a query (`ORDER BY resolved_at DESC LIMIT 1`), which cannot go stale.

### Consequence — coverage is time-dependent, and that is now visible rather than hidden

A coverage figure is only meaningful **with an as-of date**: the same query run twice can
legitimately differ. That was true under the original design too, but silently. With versioning it
is a property of the data anyone can see and query.

> **The `label_resolved_at` finding raised here on 2026-08-31 is closed.** It asked for a timestamp
> recording when a fact arrived. Versioning supersedes it with something stronger: the play stores
> `label_resolution_id`, a pointer to the **exact version** its verdict came from (BR-13.4). A
> pointer cannot drift out of step with the row it describes, and it lets the trace reconstruct the
> derivation from the candidates that version actually held.

---

## P-4: Typed failure, bounded retry, and a queue pause

**Addresses**: NFR-18, BR-7.6, BR-10.2 · **Decision**: Q2 = D

Failures are **classified before they are handled**, because they mean different things about
coverage:

| Upstream result | Classified as | Retried? | Why |
|---|---|---|---|
| `404` | `notFound` | **Never** | A `404` is an *answer*. Retrying it wastes the only budget there is |
| `503` | `error` | Yes — bounded backoff | MusicBrainz's throttle signal, always transient |
| Timeout / network | `error` | Yes — bounded backoff | Transient by nature |
| `200`, no eligible candidate | `noEligibleCandidate` | Never | A real answer produced by BR-3 |

After bounded retries are exhausted the result is recorded as **`error`, which is distinct from
`notFound`** (BR-10.2 already carries the field) and remains eligible for a later sweep.

**Why the distinction is load-bearing.** Both render as `unknown` to a reader. But `notFound` is a
finding about MusicBrainz's catalogue, while `error` is a finding about the *network on Tuesday*.
Silently folding the second into the first would inflate the apparent coverage gap with noise — and
that gap is the measurement R2 depends on.

### The queue pause is the part not to skip

On repeated `503`s the **entire queue pauses**, rather than each request retrying independently.

A client that keeps requesting through a service asking it to stop is what gets an unauthenticated
client blocked. There is no API key here and therefore no per-key throttle to fall back on — being
blocked would take out the whole unit, not degrade it. Per-request backoff without a shared pause
gets this exactly wrong: it *increases* pressure precisely when the service is signalling overload.

**Constraint**: a paused queue leaves items `pending`, never `unknown` (P-2). A pause is a delay,
not an answer.

---

## P-5: The database is the queue of record

**Addresses**: BR-8.3, resilience on restart · **Decision**: Q3 = C

The in-memory queue is a **fast path, not a system of record**. What still needs doing is derivable
from the data:

```
work remaining  ≡  plays WHERE isrc IS NOT NULL AND no label resolution
                   ∪  resolutions WHERE status = 'unknown' AND resolved_at older than TTL
```

A restart drops the in-memory queue and loses nothing, because BR-8.3's backfill scan already looks
for exactly that set. A startup sweep makes the catch-up prompt rather than waiting for a schedule.

**Why no queue persistence.** Persisting the queue would add durable state that duplicates what the
`play` table already implies, and introduces a way for the two to disagree. The self-healing
property comes free from a decision already made for other reasons — the same shape as BR-8.7, where
storing facts separately from judgements made reclassification free.

---

## P-6: Compliant identification, with the contact address out of source

**Addresses**: NFR-14 · **Decision**: Q5 = A

Every request carries a descriptive `User-Agent` naming the application, its version, and a contact
address, as MusicBrainz policy requires:

```
SpotifyNowPlaying/0.1 ( <contact-address> )
```

**The contact address is read from configuration, never committed to source.** NFR-14 requires a
real contact; the repository is on GitHub. Those two facts do not conflict as long as the value
lives beside the existing Spotify credentials in `secrets/` rather than in a tracked file. A missing
contact address is a **startup configuration error**, not a silent fallback to an anonymous
`User-Agent` — sending unidentified traffic would violate the policy the app is choosing to honour.

---

## P-7: The trace is a local read, on its own route

**Addresses**: BR-12.7, BR-12.4 · **Decision**: Q6 = A

`GET /api/explain/{playId}` reads only the local database, re-runs the pure classifier, and makes
**zero** upstream requests.

It is a separate route from `/api/diagnostics` for a concrete reason: diagnostics runs a fixed
system health sweep that hits Spotify and MCP on *every* call. Adding a `playId` mode to it would
mean either a trace re-runs the live health check — violating BR-12.7 — or the endpoint grows a
switch that changes whether it touches the network at all. That is precisely the kind of switch that
later gets set by accident.

The **UI placement is unchanged**: the trace renders as a second section inside the existing
diagnostics dialog, as requested. The split is in the route, not the interface.

---

## P-8: Protecting the two captures that cannot be recovered

**Addresses**: BR-9.1, BR-9.3 · **Decision**: Q7 = C

Liked-state is point-in-time. Unlike an observation trail it cannot be reconstructed afterwards, so
the patterns here are about **not missing the moment**:

- **Saved-track set** — refreshed at startup and on a schedule, so `likedAtStart` is answerable when
  a play begins. If it is unavailable the value is `null` and the transition is `unknown`
  (BR-9.5) — **never `false`**. A fabricated `false` here is unrecoverable and would read as an
  observed choice.
- **Grace window** — pending 30 s re-checks are **flushed on graceful shutdown**, covering the
  ordinary Ctrl-C and restart cases without persisting durable state for a 30 s interval. An
  ungraceful kill loses at most one `liked-during` upgrade on one play.

**Why not persist pending checks.** The exposure is a 30 s window against permanent schema and a
second write path. The realistic loss is one row's upgrade from `kept-unliked` to `liked-during`
during a crash — worth accepting, unlike the saved-track refresh, which is in every option because
missing it degrades *every* play.

---

## NFR coverage

| NFR | Addressed by |
|---|---|
| **NFR-14** compliant `User-Agent` | P-6 |
| **NFR-15** ≤ 1 req/sec, single queue | P-1 (and P-4's pause, which only ever reduces rate) |
| **NFR-16** never delay the display | P-2, reinforced by P-1's priority classes |
| **NFR-18** failures are partial data | P-4, P-2 (`pending` ≠ `unknown`) |
| **FR-14** resolve at most once | P-3 — reinterpreted as *at most once per TTL window* (BR-7.3). Drift recorded, not silent |
| **BR-12.7** trace makes no upstream calls | P-7 |

---

## §10 — NFRs deliberately unchanged

| NFR | Status under U2 |
|---|---|
| **NFR-01–07** local-only posture, `localGuard` | **Unchanged.** U2 adds *outbound* requests only; it opens no inbound path. `/api/explain` sits behind the same guard as every other route |
| **NFR-08–13** persistence, durability | **Unchanged.** Migration 002 is additive; U1's write path is untouched (BR-8.4) |
| **NFR-17** Spotify 429/401 handling | **Unchanged**, and reused as-is by the 47 one-off `GET /tracks/{id}` ISRC-recovery calls |
| **NFR-19–22** parsing isolation, property tests | **Extended, not altered.** `test/purity.test.ts` must cover `labelClassifier`, `isrcPrefix`, `releaseNarrowing` and `resolutionTrace` (BR-4.8) |

**No pattern here weakens NFR-01–07.** The one posture change — outbound traffic to a third party —
was put to the user explicitly (Q5) and answered "proceed as designed". It is recorded in the plan
alongside what is actually sent: an ISRC per *distinct* track, once, plus an identifying contact
address. Caching means what leaves the machine resembles a library rather than a listening timeline.

---

## What was deliberately not adopted

Recorded so the absence reads as a decision rather than an oversight.

| Not adopted | Why |
|---|---|
| **A message broker or durable queue** | P-5 — the database already implies the work set. New infrastructure to hold state that is derivable |
| **A circuit-breaker library** | P-4's pause is a single shared flag on one queue against one dependency. A library would be more configuration than logic |
| **An external cache (Redis, etc.)** | Single process, single machine. The cache is SQLite tables that must be durable anyway, since BR-8.7 recomputes verdicts from them |
| **Parallel requests to raise throughput** | NFR-15 forbids it. The ceiling is policy, not capacity |
| **A latency or throughput target** | Nothing to choose: the rate is fixed at 1 req/sec by policy, and the only latency requirement is "not on the display path" (P-2) |
