# Unit of Work Dependencies

**Date**: 2026-08-25 · **Stage**: INCEPTION — Units Generation

---

## Dependency matrix

`→` hard dependency (cannot build without) · `↝` soft dependency (better with, works without) ·
`E` extends existing U0 code

| | U0 | U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 |
|---|---|---|---|---|---|---|---|---|---|---|
| **U0** Existing | — | | | | | | | | | |
| **U1** History & Export | E | — | | | | | | | | |
| **U2** Label Enrichment | E | → | — | | | | | | | |
| **U3** Rule Model | | ↝ | ↝ | — | | | | | | |
| **U4** Rule Observability | E | → | | → | — | | | | | |
| **U5** Automated Skipping | E | → | | → | → | — | | | | |
| **U6** User-Data Lifecycle | E | → | | | | ↝ | — | | | |
| **U7** Configuration Management | E | | | → | | ↝ | → | — | | |
| **U8** Team Workflow & Onboarding | | | | | | | → | → | — | |
| **U9** Off-machine Deployment | E | | | | | | → | → | → | — |

*Phase 5 rows added 2026-10-07 (Units Generation, Phase 5 round).*

**No unit depends on a later unit.** The matrix is strictly lower-triangular, which is the
property that makes the phase ordering safe.

---

## Dependency detail

### U1 → U0 *(extends)*
Needs `nowPlayingService` to emit `tick`, `server` to host the download route, `config` to carry
the database path. All additive; no existing behaviour changes.

### U2 → U1 *(hard)*
The label cache and the backfill job both persist through `HistoryRepository`, and the backfill
reads ISRCs from U1's play rows. **U2 cannot be built first.**

### U2 → U0 *(extends)*
`spotify/enrichment` must surface `external_ids.isrc` and carry label fields.

### U3 ↝ U1, U3 ↝ U2 *(soft — worth being precise about)*

U3's `TrackFacts` has fields sourced from U1 (history counts) and U2 (label classification). But
**every field is `Maybe<T>`**, and `unknown` is a valid, first-class value.

So U3 compiles, runs and is fully property-testable with both absent — its generators can produce
`unknown` for those fields directly. In practice U3 is built after U1 and U2 because rules over
labels are the point; but the dependency is on the *field definitions*, not on working
implementations.

This is a real benefit of the tri-state design, not an accident: it means U3's development is not
blocked by MusicBrainz coverage or by accumulated history existing yet.

### U4 → U3 *(hard)*
Logs and back-tests `Decision` values. Nothing to observe without the engine.

### U4 → U1 *(hard)*
Back-testing replays rules over stored history. Without history there is nothing to replay.

### U5 → U3, U5 → U4 *(hard)*
`SkipExecutor` consumes `Decision` values (U3) and registers alongside `LoggingExecutor` (U4).
Both must exist first.

### U5 → U0 *(extends)*
`spotify/webApiClient` gains `POST /me/player/next` and `GET /me/player/queue`.

---

## Build order

```
U0 (done)
  └─ U1 ──┬─ U2 ──┐
          │       │
          └───────┴─ U3 ─── U4 ─── U5
```

**U1 → U2 → U3 → U4 → U5.** Strictly sequential, and the ordering is forced by the matrix rather
than chosen for convenience.

**Where parallelism exists**: U3's pure modules could be developed alongside U1 or U2, since it
only needs field *definitions* rather than working implementations. With a single developer this
is of little practical value, but it is worth knowing that U3 is not blocked if U2 stalls — for
example if MusicBrainz coverage turns out to be poor and the label work needs rethinking.

---

### Phase 5 (added 2026-10-07)

- **U6 → U1 (hard)**: backs up and restores the database `HistoryRepository` owns, through the app's own
  connection. **U6 ↝ U5 (soft)**: must never carry `state/` — the kill switch U5 owns.
- **U7 → U6 (hard)**: every file it ingests goes through U6's FR-64 admission path. **U7 → U3 (hard)**: rules
  are validated with U3's validator before any write.
- **U8 → U6, U7 (hard)**: the install routine documents their steps; written before them, it would describe
  features that do not exist.
- **U9 → U6, U7, U8 (hard)**: the deployment is performed by following U8's routine.

**Phase 5 build order: U6 → U7 → U8 → U9.**

---

## Inter-unit communication

Units are modules in one process. Communication is direct function calls and in-process events —
no network, no serialisation, no versioning between units.

| From → To | Mechanism | Contract |
|---|---|---|
| U0 → U1 | Event: `tick` | `Observation` per poll, unsuppressed |
| U0 → U4/U5 | Event: `trackStart` | New play began |
| U1 → U2 | Repository interface | `HistoryRepository` |
| U1 → U4 | Repository interface | `listPlays`, `getTrail` |
| U2 → U3 | Data | Label fields on `TrackFacts` |
| U1 → U3 | Data | History counts on `TrackFacts` |
| U3 → U4 | Value | `Decision` |
| U3 → U5 | Value | `Decision` |
| U4 → U5 | Interface | `DecisionExecutor` |

### The two seams that carry the design

**`HistoryRepository` (U1)** — the interface NFR-10 requires. U2, U4 and U5 all reach history
through it, so a later move to Postgres touches one implementation rather than three consumers.

**`DecisionExecutor` (U4 → U5)** — the phase boundary. U4 registers `LoggingExecutor`; U5 adds
`SkipExecutor`. Because it is a strategy rather than a conditional, **U4 ships with no code path
from a decision to a skip in existence** — verifiable by reading imports.

---

## Shared resources

| Resource | Owner | Consumers | Contention |
|---|---|---|---|
| SQLite database file | U1 | U2, U4, U5 | Single writer, WAL enabled. Writes are small and infrequent (~200 plays/day plus trail rows) |
| MusicBrainz rate budget | U2 | U2 only | One `RequestQueue`; the backfill job and live lookups share it by construction rather than by convention |
| Spotify API quota | U0 | U2, U5 | Development Mode limits. U5's queue polling is the only meaningful addition |
| Rules JSON file | U3 | U4, U5 | Read-mostly; watched for changes |

**The MusicBrainz budget is the one to watch.** `LabelBackfillJob` issues thousands of requests at
~1/sec while live lookups continue. Enforcing the limit inside a single queue — rather than at
each call site — is what stops a backfill from starving live enrichment, and is why the queue is
its own module.

---

## Risks at unit boundaries

| Risk | Boundary | Mitigation |
|---|---|---|
| U1's schema proves wrong once U2 needs label columns | U1 → U2 | Q4 = B: per-phase migrations, exercised from U1 rather than first attempted under pressure in U2 |
| U2 blocked by poor MusicBrainz coverage | U2 → U3 | U3's soft dependency means rule work is not blocked; label fields stay `unknown` |
| U3's predicate model proves wrong after U4 is built on it | U3 → U4 | U3 gated on property tests before U4 starts; U4 consumes `Decision`, a small stable value |
| U5's prewarmer designed around lookahead that does not exist | U5 | R11 probed **first** in U5; FR-34/35 fallback already specified |
| Pure/impure boundary erodes across units | All | Mechanical import check in Build and Test |
