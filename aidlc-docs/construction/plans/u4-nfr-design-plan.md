# NFR Design Plan — U4: Rule Observability

**Date**: 2026-09-20 · **Stage**: CONSTRUCTION — NFR Design, Unit U4
**Functional Design**: [`../u4-rule-observability/functional-design/`](../u4-rule-observability/functional-design/) — BR-22 … BR-32
**Numbering**: continues from U3 — patterns **P-19+**, logical components **LC-13+**, property tests **PBT-21+**

**NFR Requirements**: SKIPPED for this unit, as for U1–U3 — the 27 NFRs in `requirements.md` §4
are already agreed. Those bearing on U4: **NFR-10** (repository interface), **NFR-12**
(migrations), **NFR-13** (persistence failure degrades, never crashes), **NFR-16** (enrichment
latency must never delay the display), **NFR-20/21** (property tests, logged seed), **NFR-24**
(diagnostics stay authoritative), **NFR-26** (determinism), **NFR-01–04** (the new routes inherit
local-only admission).

---

## 🔴 PROBED 2026-09-20 — `fs.watch` DOES NOT FIRE through the Rancher Desktop bind mount

**The watcher specified in BR-26 cannot be built the way it is written.** This was probed before
designing it, not discovered during code generation.

**Method**: a watcher started *inside* the running container on `/config` and on
`/config/rules.json`, while the host modified `./config/rules.json` two ways — an in-place append,
and a write-temp-then-rename (the safe save pattern U3's infrastructure design chose the
**directory** mount to support).

| Check | Result |
|---|---|
| `fs.watch('/config')` — directory events in 12 s | **0** |
| `fs.watch('/config/rules.json')` — file events | **0** |
| `watch()` throwing, so the failure is at least loud | **No — it registers silently** |
| **Control: does the container see the new content at all?** | ✅ **Yes, within 1 s** |

The control is the part that matters. Content propagates through the mount correctly and
immediately; **only the change *events* are absent.** Rancher Desktop's virtualised filesystem does
not forward inotify across the host boundary.

> ⚠️ **This is the failure shape that has caught this project four times**, and it is the dangerous
> variant: `watch()` registers successfully, throws nothing, and simply never calls back. There is
> **no error to see**. A rules file edited on the host would take effect **never**, and the app
> would look like it was working — the exact profile of the WebSocket `403`, where every page load
> returned `200` while every handshake failed.
>
> ⚠️ **It would also have passed every test.** A unit test watching a `tmp` directory on a normal
> filesystem fires correctly. The defect exists only over the bind mount, which is *the only place
> the app actually runs*. Same family as the option-B divergence: tested in the shape that works,
> deployed in the shape that does not.

**Consequence**: BR-26.1's 500 ms debounce is not the mechanism. The mechanism has to be
**polling** — `stat` the file and compare `mtime` + `size`, hashing only when those move — or an
**explicit reload control**. Q1 settles which.

⚠️ **Do not "fix" this later by switching to a named volume or moving `rules.json` inside the
image.** The file is meant to be user-editable from the host; that is the whole point of the mount.

---

## Facts carried forward

| | |
|---|---|
| Corpus | **528 plays**, container healthy, recording continuously |
| Decision-log growth | ~491 rows/day at 10 rules (49 plays/day mean, 102 busiest) |
| Existing high-volume table | `observation` — **27,842 rows** in a 1.91 MB database |
| Back-test corpus today | **400** decidable plays; 0 rule-initiated |
| `node:sqlite` | **Synchronous API** (R10, experimental). Every write blocks its caller |

---

## Plan

- [ ] Settle the file-change mechanism now that `fs.watch` is disproven (Q1)
- [ ] Settle where the decision-log write sits relative to the tick and the broadcast (Q2)
- [ ] Settle decision-log failure isolation under NFR-13 (Q3)
- [ ] Settle back-test bounding as the corpus grows (Q4)
- [ ] Settle what diagnostics must report about the rules subsystem under NFR-24 (Q5)
- [ ] Write `nfr-design-patterns.md` — **P-19 … P-26**
- [ ] Write `logical-components.md` — **LC-13 … LC-19**
- [ ] Define property-test obligations **PBT-21 … PBT-30**, including the temporal-stability
      property that is the only way BR-27.2 is ever checked

---

## Questions

### Question 1 — Given `fs.watch` is dead here, how does a rules edit take effect?

| | Option | Latency | Honesty |
|---|---|---|---|
| **A** | **Poll `stat`** every N seconds; hash only when `mtime`/`size` move | N seconds | Automatic, but "when did it apply?" is answered only by the indicator |
| **B** | **Explicit reload control** in the UI — the user clicks after saving | Instant, user-initiated | ⭐ Unambiguous: the user *knows* when rules changed |
| **C** | **Both** — poll, plus a reload button that forces an immediate check | N seconds or instant | Most forgiving; two code paths to one loader |

Polling cost is negligible — one `stat` every few seconds against a local file.

⚠️ **B is more attractive here than it looks.** You asked for a version indicator precisely so
there is no ambiguity about whether an edit is live. An explicit reload makes that question
disappear rather than answering it — and it removes the *"I saved it 4 seconds ago, is it on
yet?"* window entirely. The cost is that a rules edit does nothing until you come back to the UI.

**Recommendation: C** — poll at **5 s** for the unattended case, plus a reload button for the
authoring loop, both entering the *same* loader. One admission rule, invoked twice, never written
twice.

[Answer]:
C
---

### Question 2 — Where does the decision-log write sit?

`node:sqlite` is **synchronous**: a write blocks whatever calls it. Under BR-22 there is **one
decision per play**, so this is ~10 row-inserts per track, not per tick.

- **A** — **Inline, in the same tick**, inside one transaction. Simple, ordered, and ~10 inserts on
  a 3 s tick is far inside budget.
- **B** — **Queued**, drained on a separate timer. Never blocks the tick; adds a queue that can be
  lost on shutdown.
- **C** — Inline, but **after** the WebSocket broadcast, so the display is never behind the write.

⚠️ NFR-16's principle is that enrichment latency must never delay the display. A write is not a
network call, but the ordering question is the same one.

**Recommendation: C** — inline and transactional, sequenced after the broadcast. Keeps ordering
and crash-safety, keeps the display first, and adds no queue to lose.

[Answer]:
C
---

### Question 3 — What happens when the decision-log write fails? (NFR-13)

NFR-13: *persistence failure must degrade the app to display-only, never crash it.* The decision
log is **derived** data; `play` is not.

- **A** — Log the error, **drop the decision row**, carry on. Play recording and display unaffected.
- **B** — Retry once, then drop.
- **C** — Disable the rules subsystem until restart, and say so in the UI.

⚠️ **Whatever is chosen, a decision-log failure must never abort the play write.** They must not
share a transaction — a rules bug would otherwise take the corpus down with it, and the corpus is
the artefact that cannot be regenerated.

⚠️ **And a dropped decision must be visible**, not silent. A gap in the log reads as *"the rule
didn't match"*, which is a wrong answer that looks like a finding.

**Recommendation: A**, with a **counter surfaced in diagnostics** (Q5) so drops are countable
rather than invisible.

[Answer]:
A
---

### Question 4 — Back-test bounding as the corpus grows

400 decidable plays today; unbounded in principle. A back-test reconstructs facts per play and
evaluates the rule over each.

- **A** — **No bound.** Range only. Simple; a multi-year corpus eventually makes one request slow.
- **B** — **Hard cap** (e.g. 50,000 plays) with the report stating it was truncated.
- **C** — Range **required** — no "all history" default — with no cap inside it.

⚠️ **A truncated back-test whose report does not say so is the `release_count = 100` bug exactly**:
an arbitrary sample recorded as a complete count, with nothing marking it partial. 18 of 56 stored
resolutions sat at exactly 100 and were believed.

**Recommendation: B**, and `truncated: boolean` is a **required** field of `BackTestReport`, not an
optional one.

[Answer]:
B
---

### Question 5 — What must diagnostics report about rules? (NFR-24)

NFR-24 requires the diagnostics endpoint to stay authoritative as subsystems are added. The rules
subsystem is the first addition since it was written.

Proposed: rule-set **version** and state (applied/rejected), **rule count** active vs disabled with
reasons, **last load attempt** and its result, **decisions recorded** in the last 24 h, **dropped
writes** (Q3), **`partialData` rate** — the enrichment-wait measurement — and the **file-change
mechanism's last check time** (Q1).

⚠️ `diagnostics.ts` is one of the three knowingly-untested modules in `ALLOWED_ORPHANS`,
constructed only by `server.ts`. Extending it means either extending an untested module, or giving
it the injection treatment `api.ts` got.

- **A** — Extend `diagnostics.ts` as-is; it stays an allowed orphan.
- **B** — Refactor it for injection and **test it**, as `api.ts` was. Removes an orphan.
- **C** — Put rules diagnostics in a **separate tested module** that diagnostics composes.

**Recommendation: C** — the new surface is tested, the existing orphan is not enlarged, and no
refactor rides along with a feature unit.

[Answer]:
C
---

## Out of scope for U4 NFR Design

| | Why |
|---|---|
| Rate limiting, kill switch, safety governor | U5 — they govern actions |
| Rule **editing** performance / concurrent writers | Read-only in U4; single user |
| Scaling the decision log beyond one machine | NFR-08/10 keep the option; nothing here needs it |
| Per-node predicate tracing | BR-32.4 — needs the same walk as the evaluator, not a second one |
