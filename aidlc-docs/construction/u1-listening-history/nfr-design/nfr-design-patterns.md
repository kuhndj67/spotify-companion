# NFR Design Patterns — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — NFR Design, Unit U1
**Decisions**: Q1 = C (`node:sqlite` behind the interface) · Q2 = A (buffer, one write per play)

---

## Scope

U1 introduces exactly one new class of non-functional problem: **the app now has state that
matters**. Everything below follows from that.

Security, scalability and performance patterns are addressed as *unchanged* — see §6.

---

## P-1: Repository interface — engine isolation

**Addresses**: NFR-10, R10

`node:sqlite` is experimental in Node 22.17. That risk is contained rather than avoided: every
consumer reaches storage through `HistoryRepository`, so replacing the engine touches one
implementation file and no call sites.

```
HistoryRepository (interface)     ← U2, U4, U5 all depend on this
        ▲
SqliteHistoryRepository           ← the only file that knows what SQLite is
```

**Why this beats choosing the "safe" driver.** `better-sqlite3` is more stable but requires
`node-gyp` in the Docker build. The interface makes the stability question cheap either way, so
the build-simplicity argument wins. If the experimental API breaks, the swap is a contained,
well-understood change — not a migration.

**Constraint**: the interface must not leak SQL semantics. Filters are domain types
(`HistoryFilter`), never SQL fragments, or the abstraction is decorative.

---

## P-2: Unit-of-work write — one transaction per play

**Addresses**: NFR-08, BR-3.7 · **Decision**: Q2 = A

Observations accumulate in memory during a play. On boundary, the play row and its entire trail
are written in **one transaction**.

| Property | Consequence |
|---|---|
| Atomicity | A partial play is never visible. A play either exists with its full trail or not at all |
| Volume | ~200 transactions/day rather than ~28,800 writes |
| Exposure | A crash loses the in-progress play — minutes of listening, one record |

**Why the synchronous API stops mattering here.** `node:sqlite` is synchronous, which would be a
concern at 28,800 writes/day on the event loop. At ~200 batched transactions/day it is
irrelevant — this is the pairing that makes Q1 and Q2 work together rather than each being
independently defensible.

---

## P-3: WAL journaling — readers never block the writer

**Addresses**: NFR-08

Write-Ahead Logging is enabled at open.

- A SQLite browser or analysis tool can read the file **while the app writes**
- Export streams (P-4) read concurrently with recording without lock contention
- Crash recovery is handled by SQLite rather than by application logic

Even though the app is the only writer, WAL is what makes the file usable by the user's own tools
without stopping the app — which is the practical shape of the download-only integration decision.

---

## P-4: Streaming read — bounded memory on export

**Addresses**: US-25, BR-6.8

`listPlays` returns `AsyncIterable`. Export iterates and emits; it never materialises the result
set.

A year of history is ~70k play rows. Buffering that into a string before responding would stall
the event loop, and with it the now-playing display — the one thing U1 must never do.

**Validation precedes the first byte** (BR-6.10). Once bytes are sent there is no status code left
to change, so filters are validated and readability confirmed up front; after that, failure can
only terminate the stream and log.

---

## P-5: Graceful degradation — the display outlives its dependencies

**Addresses**: NFR-13, BR-3.8, BR-3.9

| Failure | Behaviour |
|---|---|
| Database unopenable at startup | Start **display-only**; diagnostics reports it |
| Migration fails | **Refuse to write.** Never write against an unknown schema |
| Write fails mid-session | Count the gap; keep serving |
| Disk full | As above |

**The rule this expresses**: U0 worked before history existed and must keep working when history
is broken. History is an addition to the app, never a precondition for it.

**Failures are counted, not silently swallowed** (BR-3.9). A dropped play is indistinguishable
from "nothing was playing" — a plausible reading of the data, and therefore an undetectable
corruption. A counted gap keeps the dataset honest about what it does not contain.

---

## P-6: Log damping — one line per failure class

**Addresses**: NFR-13

A locked database at a 3 s poll produces 1,200 identical lines an hour and buries everything else.
Failures are logged once per class, with a count, and the current state is surfaced through
diagnostics rather than through log volume.

---

## P-7: Forward-only migration

**Addresses**: NFR-12, Q4 = B (per-phase schema growth)

Numbered, forward-only migrations run at startup before any write. No `down` migrations:
reversing a migration over irreplaceable data is a trap dressed as a safety net.

This is exercised from U1 rather than first attempted under pressure during U2's label backfill —
which is the practical argument for per-phase schema growth.

---

## P-8: Automatic snapshot — protecting the irreplaceable

**Addresses**: FR-56 · **Decision**: Q4 = B

A dated export snapshot is written to the data directory on a schedule.

**Why this is a pattern rather than a nicety.** Every other asset in this project is
reconstructible — code from git, enrichment from Spotify, labels from MusicBrainz. Months of play
records are not. The mechanism already exists in this unit, so the marginal cost is scheduling.

The failure mode it prevents is specific: *discovering months later that no export was ever made.*

---

## 9. Purity enforcement — the check that fails no test

**Addresses**: NFR-25/26, FR-20, FR-42

`outcomeClassifier` and `export/serialisers` must import nothing impure — no `node:fs`,
`node:sqlite`, `fetch`, or `Date.now`.

**This is the design's most likely silent failure.** A `Date.now()` in the classifier breaks FR-20
(reclassification stops being reproducible) and FR-42 (back-testing stops replaying live
behaviour) while passing every existing test.

**Pattern**: a mechanical import check in Build and Test, asserting the pure module set has no
impure imports. Cheap, and the only thing that actually catches this.

---

## 6. Unchanged NFR areas

Recorded so their absence is a finding, not an omission.

| Area | Status |
|---|---|
| **Security** (NFR-01–07) | **No change.** Download-only export opens no network path; `localGuard` untouched. The no-auth decision rests on unchanged foundations |
| **Scalability** | **Not applicable.** One user, one process, ~200 plays/day. No load exists to scale to |
| **Performance** | **One constraint only**: history work must never delay the display. Satisfied by P-2 (batched), P-4 (streamed) and P-5 (degraded) |
| **Availability** | **Not applicable.** A local tool with no uptime obligation |
| **Resilience** | Addressed by P-5, P-6, P-7 |

---

## Requirements coverage

| NFR | Pattern |
|---|---|
| NFR-08 Local, file-backed, no server process | P-1, P-2, P-3 |
| NFR-09 Schema-aware, queryable | P-1, P-7 |
| NFR-10 Repository interface | **P-1** |
| NFR-11 Mounted volume, survives rebuild | Infrastructure Design |
| NFR-12 Migrations, never drop-and-recreate | **P-7** |
| NFR-13 Degrade, never crash | **P-5**, P-6 |
| NFR-22 Property-test the classifier | P-9 |
| NFR-26 Deterministic, side-effect free | **P-9** |
| FR-56 Automatic snapshot | **P-8** |
