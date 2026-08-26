# NFR Design Plan — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — NFR Design, Unit U1

---

## Scope

The execution plan marks NFR Design **EXECUTE (narrow)**. NFR Requirements was **skipped** — 27
NFRs are already enumerated and agreed in `requirements.md` §4, so there is nothing to re-derive.

**Only one genuinely new NFR problem arrives with U1: persistence.** Durability, concurrency and
degraded operation (NFR-08–13) did not exist before this unit, because the app held no state.

### Categories evaluated and found not applicable

Recorded explicitly rather than skipped silently.

| Category | Applicability |
|---|---|
| **Security patterns** | **None new.** Download-only export opens no network path; `localGuard` is untouched (§3.5). NFR-01–07 stand as built and live-verified |
| **Scalability patterns** | **Not applicable.** One user, one process, one machine. ~200 plays/day. There is no load to scale to |
| **Performance patterns** | **Narrow.** One real constraint: history work must never delay the now-playing display. No latency or throughput targets exist beyond that |
| **Resilience patterns** | **Applicable.** Persistence can fail in ways nothing previously could — locked database, full disk, failed migration |
| **Logical components** | **Applicable but minimal.** No queues, caches or circuit breakers. A single embedded database and a write path |

---

## Questions

### Question 1 — SQLite driver

The design assumed `node:sqlite`. R10 flagged it as experimental. Verified on this machine: Node
**22.17.0**, `node:sqlite` present and functional, emitting `ExperimentalWarning` — no flag needed.

A) **`node:sqlite`** — built in, zero dependencies, no native build step in Docker. Flagged
   experimental, so the API may change across Node versions

B) **`better-sqlite3`** — the mature, widely-used choice. Stable API. Requires a native build
   (`node-gyp`) during the Docker image build, adding build tooling and time

C) **`node:sqlite` behind the repository interface, swap only if it bites** — NFR-10's interface
   already exists to make the engine replaceable; treat the experimental flag as a contained risk

X) Other (please describe after [Answer]: tag below)

[Answer]: C — `node:sqlite`, behind the NFR-10 repository interface.

---

### Question 2 — When are observations written?

A play's trail is ~30–100 observations. They can be buffered in memory and written once when the
play closes, or written as they arrive.

A) **Buffer, write once per play** — one transaction per play, ~200 transactions/day. Minimal I/O.
   **A crash loses the in-progress play entirely**, including its trail

B) **Write each observation as it arrives** — ~28,800 small writes/day. A crash loses at most one
   observation. More I/O, though still trivial in absolute terms

C) **Buffer with periodic flush** — write the in-progress trail every N observations, and close the
   play on boundary. Bounded loss, moderate I/O

X) Other (please describe after [Answer]: tag below)

[Answer]: A — buffer in memory, one transaction per play.

**Answer analysis**: both unambiguous single selections, no follow-up required. Consistent with
each other — one transaction per play is small enough that `node:sqlite`'s synchronous API is a
non-issue, which it would not be under option B's ~28,800 writes/day.

---

## Recommendations

- **Q1 = C.** The interface required by NFR-10 already exists precisely so the storage engine is
  not a one-way decision. `node:sqlite` avoids native compilation in the container, which is real
  friction in a multi-stage Docker build. If the experimental API changes, one implementation file
  changes with it.
- **Q2 = A.** The exposure is one play — a few minutes of listening — against roughly 144× more
  write operations. Crashes should be rare, the app already flushes cleanly on shutdown (BR-2.6),
  and the loss is a single record in a dataset whose value is statistical rather than
  transactional. B optimises for a failure mode that barely matters here.

---

## Execution Checklist

- [x] Confirm answers; analyse for ambiguity
- [x] Generate `nfr-design/nfr-design-patterns.md`
- [x] Generate `nfr-design/logical-components.md`
- [x] Verify NFR-08–13 are each addressed by a named pattern
- [x] Verify no pattern weakens NFR-01–07
- [x] Update `aidlc-state.md`; log in `audit.md`
