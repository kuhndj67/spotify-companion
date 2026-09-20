# NFR Design Patterns — U4: Rule Observability

**Date**: 2026-09-20 · **Stage**: CONSTRUCTION — NFR Design, U4
**Answers**: Q1 **C** · Q2 **C** · Q3 **A** · Q4 **B** · Q5 **C** — all as recommended, none vague,
no follow-ups.
**Numbering** continues from U3, which ended at **P-18**.

> ### The pattern that governs the other patterns
>
> **U4 is derived data hanging off an irreplaceable one.** Every pattern below answers the same
> question: *when this subsystem fails, what does it take down with it?* The answer must always be
> **nothing** — not the display, not the poll loop, and above all not `play`.

---

## P-19: Change detection by polling, because the event never arrives *(Q1 = C)*

`fs.watch` is **disproven on this deployment** — 0 events in 12 s over the Rancher Desktop bind
mount, for both an in-place write and a rename, while the container read the new content within
1 s. It registers, throws nothing, and never calls back.

```
every 5 s:  stat(path) -> (mtime, size)
            unchanged? -> return              # the overwhelmingly common case
            changed?   -> hash -> still same? -> return
                                  different?  -> load()
```

**A `stat` is the guard; the hash is the confirmation.** `mtime` granularity and a same-size edit
each produce false signals on their own, and hashing every 5 s to avoid them would be work done
for nothing 99.99% of the time.

> ⚠️ **Polling is not a workaround to be removed when "watch is fixed".** Re-probe before ever
> replacing it — and note the probe must run **in the container against the bind mount**, because
> a watcher on a normal filesystem fires correctly and would prove nothing.

⚠️ **The reload button and the poll enter the same `load()`.** Not a second path that also parses.
This is the one-admission-rule lesson: the WebSocket `403` happened because the local-access policy
was re-implemented rather than reused, and the copies diverged while 411 tests passed.

---

## P-20: The display is never behind the record *(Q2 = C)*

`node:sqlite` is synchronous — every write blocks its caller, and the caller is the poll loop.

**Order within a tick, fixed:**

```
evaluate (pure)  ->  broadcast to WebSocket  ->  write decision rows (one transaction)
```

One decision per play (BR-22.1), so this is ~10 inserts per *track*, not per tick — far inside a
3 s budget. Sequencing it after the broadcast costs nothing and makes the ordering claim
structural rather than a measurement that could drift.

This is NFR-16's principle applied to a local write: the display leads, persistence follows.

---

## P-21: Derived failure is contained; irreplaceable failure is not risked *(Q3 = A)*

| | `play` | decision log |
|---|---|---|
| Regenerable | **No** — `recently-played` is a 50-play window | **Yes** — rules + history + a deterministic engine |
| On write failure | degrade to display-only (NFR-13) | **drop the row, count it, carry on** |

**They never share a transaction.** A rules defect must be unable to abort a play write; the
corpus is the one artefact here that cannot come back.

⚠️ **A dropped decision is counted, never silent.** A gap in the log reads as *"the rule did not
match"* — a wrong answer that looks like a finding, which is the failure mode this project has
paid for repeatedly. The counter surfaces in diagnostics (P-25).

---

## P-22: Determinism by reconstruction, not by recollection *(NFR-26)*

Back-testing rebuilds `TrackFacts` from a stored `play` row and feeds **the same pure engine** that
ran live. No back-test variant of the evaluator exists.

The `history.*` counts are **point-in-time** — plays strictly before this row's `started_at`
(BR-27.2), computed by a window function with `1 PRECEDING`.

> ⚠️ **This is the pattern with no observable failure**, and therefore the one that needs a
> property test rather than attention. As-of-now counts produce plausible numbers today and
> diverge only across months, as the corpus grows underneath a range that has not changed.
> **PBT-22 is the only thing that will ever catch it.**

---

## P-23: Atomic swap over a pure core *(BR-26.2)*

The coordinator reads the rule set **once** at the top of a decision and uses that reference
throughout. A reload replaces a reference between decisions; it never mutates one in flight.

This is cheap **only because U3's engine is pure** — there is no partially-updated evaluator state
to reconcile. The pattern is a dividend of the U3 boundary, not a new mechanism.

---

## P-24: A truncation that does not announce itself is a lie *(Q4 = B)*

A back-test is capped at **50,000 plays**, and `truncated` is a **required** field of
`BackTestReport` — not optional, not defaulted.

> ⚠️ **This is the `release_count = 100` bug, pre-empted.** A MusicBrainz browse was capped at 100
> with no paging, and the 100 was stored as the count: 18 of 56 resolutions sat at exactly 100, an
> arbitrary sample recorded as a complete figure with nothing marking it partial. Bad Bunny has
> 205, and page 2 alone held 20 labels page 1 never saw.
>
> **Any capped fetch whose count is written down is that bug.** A required field makes the
> statement unavoidable at the type level rather than remembered at the call site.

---

## P-25: New subsystem, new tested surface — not a bigger orphan *(Q5 = C)*

Rules diagnostics live in a **separate, tested module** that `diagnostics.ts` composes.

`diagnostics.ts` is one of three knowingly-untested modules in `ALLOWED_ORPHANS`, constructed only
by `server.ts`. Extending it in place would grow untested surface; refactoring it for injection
would ride a cleanup on a feature unit. Composition does neither.

Reported: rule-set **version** and state · active vs disabled **rule counts** with reasons · **last
load attempt** and result · **decisions recorded** in 24 h · **dropped writes** (P-21) ·
**`partialData` rate** · **last change-check time** (P-19).

⚠️ **The `partialData` rate is not diagnostics decoration — it is the measurement.**
`ENRICHMENT_WAIT_MS = 10 000` is a guess (BR-22.3), because the true enrichment latency has never
been measured and the number that appeared to measure it was `resolvedAt` stamped before the
network calls. This counter is the first real evidence about it.

---

## P-26: The phase boundary is an import-graph property *(BR-30)*

`LoggingExecutor` takes **no** playback collaborator — not unused, not optional, not null. The
boundary is verified by inspecting imports, never by a runtime flag.

⚠️ **An injected-but-uncalled collaborator would reduce the boundary to one line of restraint.**
U5 adds `SkipExecutor` *alongside*; it does not grow `LoggingExecutor` into one.

---

## Pattern-to-NFR coverage

| NFR | Discharged by |
|---|---|
| **NFR-10** repository interface | LC-13 — `DecisionLogRepository` |
| **NFR-12** migrate, never drop | Migration 005 (BR-31) |
| **NFR-13** degrade, never crash | **P-21** |
| **NFR-16** latency never delays display | **P-20** |
| **NFR-20/21** property tests, logged seed | PBT-21 … PBT-30 |
| **NFR-24** diagnostics authoritative | **P-25** |
| **NFR-26** deterministic, side-effect free | **P-22**, P-23 |
| **NFR-01–04** local-only admission | Inherited — routes in `api.ts`, `decideAccess` unchanged |

⚠️ **NFR-01–04 are inherited, not re-implemented.** The new routes sit in `api.ts` behind the
existing guard. **No new WebSocket surface is added**, which is deliberate: the upgrade handler is
the one place the admission rule has to be invoked explicitly, and it is pinned structurally by
`localGuard.test.ts`. The decision-log view reads over HTTP.
