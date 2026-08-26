# Logical Components — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — NFR Design, Unit U1

Infrastructure-bearing components introduced by U1's non-functional patterns.

---

## What U1 does *not* introduce

Stated first, because the absence is the notable part for a stage that usually enumerates
middleware.

| Component | Why not |
|---|---|
| **Message queue / broker** | In-process events only. Nothing crosses a process boundary |
| **Cache** | The enrichment cache already exists in U0. History reads are infrequent and indexed |
| **Circuit breaker** | One dependency (the local database file). It does not flap; it either opens or does not |
| **Connection pool** | One embedded file, one writer. A pool would add contention, not remove it |
| **Load balancer / gateway** | One process, loopback only |
| **Rate limiter** | Nothing external is called by U1. U2's MusicBrainz queue is a different unit |
| **Retry / backoff** | Deliberate: see the note under LC-1 |

**On retries.** The instinct is to retry a failed write. It is wrong here — a locked or full
database does not resolve within a poll interval, and retrying inside the poll loop would delay
the display to save a record that is one sample of many. Degrade and count the gap (P-5) instead.

---

## LC-1: Embedded database

| | |
|---|---|
| **Realises** | P-1, P-2, P-3, P-7 |
| **Technology** | SQLite via `node:sqlite` (Node 22.17, experimental) |
| **Configuration** | WAL journaling; `busy_timeout` set so brief contention waits rather than errors; foreign keys on |
| **Access** | Single writer (`PlayObserver`). Concurrent readers permitted — export, and the user's own tools |
| **Lifecycle** | Opened at startup after migration; closed on shutdown after the final flush |

**Failure semantics**: unopenable ⇒ display-only. Migration failure ⇒ refuse to write. Write
failure ⇒ count the gap, keep serving.

---

## LC-2: Migration runner

| | |
|---|---|
| **Realises** | P-7 |
| **Behaviour** | Reads `schema_version`, applies pending migrations in order, records each |
| **Ordering** | Runs **before** the observer subscribes. A half-migrated schema must never accept writes |
| **Direction** | Forward only |

**Migration 001** creates `play`, `observation`, `schema_version` and four indexes — and nothing
else. Label columns arrive in 002 with U2; rule-action columns in 003 with U5 (Q4 = B).

---

## LC-3: Write buffer

| | |
|---|---|
| **Realises** | P-2 |
| **Behaviour** | Accumulates the in-progress play's observations in memory; flushes as one transaction on boundary |
| **Bound** | A play is minutes; a trail is tens to low hundreds of rows. Memory is not a concern |
| **Loss window** | One play, on crash or hard kill |
| **Shutdown** | Flushed as `unknown` before close (BR-2.6) — never discarded |

A safety cap on trail length is worth having: a stuck play — same track, never advancing, never
ending — would otherwise grow the buffer without bound. Beyond the cap, sampling can thin the
trail rather than letting it grow.

---

## LC-4: Export streamer

| | |
|---|---|
| **Realises** | P-4 |
| **Behaviour** | Async-iterates plays, serialises row by row, writes to the HTTP response |
| **Memory** | Constant, independent of history size |
| **Concurrency** | Reads under WAL; never blocks recording |
| **Failure** | Validate before the first byte; after that, terminate and log |

---

## LC-5: Snapshot scheduler

| | |
|---|---|
| **Realises** | P-8, FR-56 |
| **Behaviour** | On a timer, writes a dated export to the data directory |
| **Reuses** | LC-4 — the snapshot is the same pipeline pointed at a file instead of a response |
| **Retention** | Keeps the most recent N snapshots; older ones removed |
| **Failure** | Non-fatal. Logged, surfaced in diagnostics, retried next interval |

**Snapshot retention is bounded, unlike trail retention.** Snapshots are derived data and
regenerable from the database; trails are not. That asymmetry is why W-2 defers trail pruning while
snapshots may rotate freely.

---

## LC-6: Purity check *(build-time)*

| | |
|---|---|
| **Realises** | P-9 |
| **Behaviour** | Asserts that designated pure modules import nothing impure |
| **Runs** | Build and Test, alongside typecheck |
| **Failure** | Fails the build |

Not a runtime component, but the only mechanism that catches a class of defect no test will —
`Date.now()` in the classifier passes every assertion while breaking FR-20 and FR-42.

---

## Component interaction

```
tick ──► PlayObserver ──► LC-3 buffer ──► [boundary] ──► LC-1 database
                                                              │
                          LC-2 migration ──► (startup, before any write)
                                                              │
                                              LC-4 streamer ◄─┤
                                                   │          │
                                     HTTP download ┘          │
                                                              │
                                              LC-5 scheduler ◄┘
                                                   │
                                        dated file in ./data/
```

---

## Sizing

| Metric | Estimate |
|---|---|
| Plays/day | ~200 |
| Observations/day | ~28,800 (3 s poll) |
| Play rows/year | ~73,000 |
| Observation rows/year | ~10.5 M |
| Database growth/year | Roughly 0.5–1 GB, dominated by observations |
| Write transactions/day | ~200 |
| Peak memory (buffer) | Tens of KB |

**Nothing here is near a SQLite limit.** The growth is steady rather than problematic, which is
exactly why W-2 defers lifecycle management rather than pre-emptively pruning the raw material
FR-20 depends on.
