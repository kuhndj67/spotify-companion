# Code Generation Plan — U5: Automated Skipping

**Date**: 2026-10-01 · **Stage**: CONSTRUCTION — Code Generation, Unit U5
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield (working code exists)

**This plan is the single source of truth for U5 code generation.**

All three design stages are complete and answered as recommended:

| Stage | Deliverables | Answers |
|---|---|---|
| Functional Design | `functional-design/` — **BR-33 … BR-43** | 9 questions; authoritative reading is [`u5-functional-design-plan.md`](u5-functional-design-plan.md) §5.1 |
| NFR Design | `nfr-design/` — **P-27 … P-37**, **LC-23 … LC-31**, **PBT-34 … PBT-50** | 9 questions, [§5.1](u5-nfr-design-plan.md) |
| Infrastructure Design | `infrastructure-design/infrastructure-design.md` | 6 questions, [plan](u5-infrastructure-design-plan.md) |

**Brownfield rule**: existing files are modified in place. No `_new` or `_modified` duplicates.

---

## Unit context

| | |
|---|---|
| **Stories** | US-18, US-19, US-21, US-22, completing US-13 |
| **Requirements** | FR-34, FR-35, FR-36, FR-38, FR-39, FR-40, FR-46, FR-47, FR-48 · completes **FR-33** |
| **Depends on** | **U3** (`RuleEngine`, pure, unmodified) · **U4** (`EvaluationCoordinator`, `DecisionLogRepository`, `RuleSetWatcher`, `BackTestService`) · **U1** (`play`, `PlayObserver`) |
| **Owns entities** | `SkipAttempt`, `AutomationState`, `RunawayHalt`, `SafetyCounters`. **Migration 007 — schema v7** |
| **Adds** | `src/playback/` — whose *absence* was U4's phase guard |

### ⚠️ This is the first unit that can interrupt the music

Every prior unit, wrong, produced a bad number in a report. **The design bias throughout is refuse
rather than act**, because a skip that should have happened and did not is recoverable by pressing a
button, and a skip that should not have happened is not recoverable at all.

### ⚠️ What replaces U4's phase guard

U4's guard was **`src/playback/` does not exist**, plus `LoggingExecutor` taking no playback
collaborator. U5 ends the first. **P-33 replaces it with two structural properties**, and both must be
asserted by tests, not by review:

```
src/rules/     ──(DecisionExecutor interface only)──>  SkipExecutor
SkipExecutor   ──(sole importer)──────────────────────>  src/playback/
src/playback/  ──(sole importer)──────────────────────>  the Spotify write client
```

**And the write client exposes exactly one method: `skipToNext()`.** No pause, seek, volume or
transfer-playback. ⚠️ **Assert that on the client's exported shape**, because
`test/noOrphanModules.test.ts` walks **modules, not methods** — two dead methods lived inside a
heavily-executed file for their entire lives and the check was satisfied throughout.

⚠️ **`LoggingExecutor.length === 1` must still pass when U5 is done.** If it fails, the boundary was
collapsed rather than crossed.

---

## ⚠️ Two scoping decisions to confirm before generation

### Q1 — `DecisionExecutor` lives inside `LoggingExecutor.ts`, and `SkipExecutor` must not import it from there

`src/rules/LoggingExecutor.ts:24` declares the interface, and `EvaluationCoordinator.ts:29` imports it
from that file. So as things stand, `SkipExecutor` would have to `import type { DecisionExecutor } from
'../rules/LoggingExecutor.js'` — making the logging executor's module a dependency of the skipping one.

⚠️ **That is cosmetically ugly and structurally misleading.** BR-30 says `SkipExecutor` is *added
alongside, never grown out of* `LoggingExecutor`. An import edge from one to the other says the
opposite to anyone reading the import graph — including the P-33 structural test, which has to
distinguish "imports the interface" from "imports the other implementation".

| | Option |
|---|---|
| **A** | ⭐ **Move `DecisionExecutor` and `ExecutionContext` to `src/rules/types.ts`**, where every other shared rule type already lives. Both executors import from there. A pure type move: no behaviour changes, no runtime import added |
| **B** | Leave it. `SkipExecutor` imports the interface from `LoggingExecutor.ts` |
| **C** | Declare a second copy of the interface in `src/playback/` |

⚠️ **C is the one to avoid**: two declarations of one contract drift, and this project has already
shipped that defect — the local-access policy was written twice, the copies diverged, and every page
load returned `200` while every WebSocket handshake returned `403` with all 411 tests passing.

**Recommendation: A.** It is a one-commit type move with no behavioural risk, and it makes the P-33
test expressible as *nothing in `src/rules/` imports `src/playback/`* without an exception clause.

**[Answer]:** **A** (user, 2026-10-02). `DecisionExecutor` and `ExecutionContext` move to
`src/rules/types.ts`.

⚠️ **Type placement refined during Step 1.** The plan's structure table listed the new U5 entities in
`src/rules/types.ts` alongside the moved interface. That is wrong for most of them: `SkipAttempt`,
`SkipAttemptState`, `RefusalReason`, `AutomationState` and `RunawayHalt` are **playback** entities and
belong in **`src/playback/types.ts`**. Only the rules-side contract moves to `src/rules/types.ts`:
`DecisionExecutor`, `ExecutionContext`, and `DecisionTrigger` (a `decision_log` column).

⚠️ **The import direction is what decides this.** `src/playback/` → `src/rules/` is allowed;
`src/rules/` → `src/playback/` is what **P-33 forbids**. Putting `SkipAttempt` in `src/rules/types.ts`
would not break the test, but it would put U5's action vocabulary inside the module group that is
forbidden from knowing about actions — and the next person adding a field would have no signal that they
were on the wrong side of the boundary.

### Q2 — `SKIP_EXECUTOR_ENABLED` selects the executor, and it is NOT the kill switch

Infrastructure §3 defines `SKIP_EXECUTOR_ENABLED` (default `false`) to choose which
`DecisionExecutor` `server.ts` wires. The kill switch (`globalAutomationEnabled`) is separate and is
checked at the action point.

⚠️ **That is two off switches, and the risk is that they are read as redundant** — someone later
"simplifies" by deleting one. They are not redundant:

| | Controls | Changing it requires | Checked |
|---|---|---|---|
| `SKIP_EXECUTOR_ENABLED` | whether `SkipExecutor` is **constructed at all** | editing `compose.yaml`, restarting | at startup, once |
| `globalAutomationEnabled` | whether a queued attempt **fires** | clicking the UI button | at the action point, every attempt |

| | Option |
|---|---|
| **A** | ⭐ **Keep both**, and document the distinction at both sites. The env flag is a deployment-time choice; the kill switch is a runtime control |
| **B** | Drop the env flag. `LoggingExecutor` is selected whenever automation has never been armed |
| **C** | Drop the kill switch's independence and derive it from the env flag |

⚠️ **C is wrong and would break FR-38**: a restart-requiring control cannot satisfy *"no skip is
issued after the switch is thrown"*.

⚠️ **B is tempting and loses the ability to deploy U5 inert.** The env flag is what lets the unit ship
and run for days with `SkipExecutor` never constructed — which is how the dry-run review (BR-40.1, the
actual arming gate) happens without the action path existing at all.

**Recommendation: A.**

**[Answer]:** **A — keep both** (user, 2026-10-02), with one correction to the framing.

⚠️ **`SKIP_EXECUTOR_ENABLED` is DEPLOYMENT-TIME, not dev-only.** Its primary non-debug use is shipping
U5 **inert**: the unit deploys, records decisions through `LoggingExecutor`, and the dry-run log is
reviewed for days with `SkipExecutor` **never constructed**. That is **BR-40.1's arming gate**, which is
a normal-operations phase rather than a debugging activity.

⚠️ **Why the distinction matters in writing:** labelled *"dev only"*, someone eventually strips it
before production and removes the ability to run that gate at all.

| | Answers | Changing it | Checked |
|---|---|---|---|
| `SKIP_EXECUTOR_ENABLED` | *is the skip machinery built at all?* | `compose.yaml` + restart | once, at startup |
| `globalAutomationEnabled` | *may a built attempt fire?* | one UI click | every attempt, at the action point |

---

## Structure

```
src/rules/
  types.ts                        MODIFY ⚙️  ⚠️ Q1: + DecisionExecutor, ExecutionContext (MOVED
                                             here from LoggingExecutor.ts) + DecisionTrigger
  LoggingExecutor.ts              MODIFY 🔌  dryRun: true -> computed; interface MOVED OUT.
                                             ⚠️ NO new constructor parameter (BR-30.2)
  EvaluationCoordinator.ts        MODIFY 🔌  + re-evaluation trigger (BR-37). execute stays SYNC
  SqliteDecisionLogRepository.ts  MODIFY     + trigger column on write and read

src/playback/                     NEW — the directory whose absence was U4's phase guard
  types.ts                        NEW    ⚙️  SkipAttempt, SkipAttemptState, RefusalReason,
                                             AutomationState, RunawayHalt. ⚠️ NOT in src/rules/
  automationPredicate.ts          NEW    ⚙️  LC-23 — returns a REASON, never a bare boolean
  safetyCounters.ts               NEW    ⚙️  LC-27 — derived, takes `now`
  SkipAttemptRepository.ts        NEW        LC-24 interface (NFR-10)
  SqliteSkipAttemptRepository.ts  NEW    🔌  LC-24 impl. ⚠️ NO UNIQUE constraint
  SkipExecutor.ts                 NEW    🔌  LC-25 — enqueues; does NOT post
  skipDrain.ts                    NEW    🔌  LC-26 — THE ACTION POINT. The only player command
  spotifyPlayerClient.ts          NEW    🔌  ⚠️ EXACTLY ONE METHOD: skipToNext()
  AutomationStateStore.ts         NEW    🔌  LC-29 — /state/, atomic rename, fails closed
  upstreamMetrics.ts              NEW    🔌+⚙️ LC-28 — M1..M4
  armingProjection.ts             NEW    ⚙️  LC-31 — a projection, cannot block arming

src/history/
  migrations.ts                   MODIFY     migration 007 (schema v7)
  types.ts                        MODIFY     + contextType, contextUri on sample/record/row
  SqliteHistoryRepository.ts      MODIFY     INSERT the two columns
  RecentlyPlayedBackfill.ts       MODIFY     populate context from recently-played

src/export/serialisers.ts         MODIFY     two columns — ⚠️ CSV headers included
src/ui/statusBar.ts               MODIFY ⚙️  LC-30 — automationIndicator, 7 states + glyphs
src/api.ts                        MODIFY     3 routes
src/server.ts                     MODIFY     wiring + executor selection (Q2)
src/diagnostics.ts                MODIFY     automation state, halt, queue depth, M1..M4, probe
public/app.js                     MODIFY     FC-U5-1/2/3 — DOM only, no judgement
compose.yaml                      MODIFY     + ./state:/state:rw · 2 env values · 2 comment fixes

test/                             mirrors src/ — see Step 11
.github/workflows/ci.yml          MODIFY     ⚠️ Q9: entry-point execution + knip
```

**Naming follows the existing convention**: lower-camel for pure function modules, Pascal for classes.

---

## Ordering principle

**Pure first, then storage, then the action point, then wiring, then UI.** Every step ends with
`npm test` and `npm run typecheck` green, and **the app's behaviour is unchanged until Step 9**, where
the executor becomes selectable. Nothing is deployed until Step 12.

⚠️ **The action point (Step 6) is written before anything can reach it.** `skipDrain` is fully tested
against a fake player client before `server.ts` ever constructs the real one.

---

## Steps

### Step 1 — Types ⚙️ — ✅ DONE 2026-10-02
- [x] ⚠️ **Q1: move `DecisionExecutor` and `ExecutionContext`** out of `LoggingExecutor.ts`
- [x] `SkipAttempt`, `SkipAttemptState`, `RefusalReason`, `AutomationState`, `RunawayHalt`
- [x] ⚠️ `RefusalReason` includes **`upstream-rate-limited`** (P-30) as a member distinct from
      `rate-limited`. Conflating them makes the runaway halt's evidence unreadable
- [x] ⚠️ **Two members ADDED in Step 3 that the FD's list lacked**: **`rule-disabled`** and
      **`rule-gone`**. BR-33.2 includes `rule.enabled` as a term, and the FD listed no reason for
      it. It looks unreachable because `RuleEngine.ts:51` skips disabled rules — but the predicate
      runs at the **action point**, and `RuleSetWatcher` can reload the file in the 10 s between
      decision and action. A rule disabled in that window, or deleted, is exactly what the
      action-point check is for. Kept as two members, not one: *switched off* and *deleted* are
      different facts
- [x] `DecisionTrigger = 'initial' | 'enrichment-arrived'`
- [x] `contextType`, `contextUri` as `Maybe<string>` on `PlaybackSample`, `NewPlayRecord`, `PlayRecord`
- [x] ⚠️ **No enum gains a falsy member.** `null` stays the only unknown

### Step 2 — Migration 007 — ✅ DONE 2026-10-02 (code + tests; NOT yet run against the live db)
- [x] `ALTER TABLE decision_log ADD COLUMN trigger TEXT DEFAULT 'initial'` — ⚠️ **default, not an
      `UPDATE`.** The 909 existing rows are `initial` by construction
- [x] `ALTER TABLE play ADD COLUMN context_uri TEXT` — nullable. ⚠️ **ONE column, not two:**
      `context_type` has existed since the **v1** schema (`migrations.ts:61`) and is already populated on
      backfilled rows. Re-adding it would fail the `ALTER`, abort 007 in its own transaction, and leave
      the app **display-only** with the UI looking fine. Found by the compiler in Step 1
- [x] `CREATE TABLE skip_attempt (...)` + indexes on `play_id` and `enqueued_at`
- [x] ⚠️ **No `UNIQUE` anywhere** (BR-22.1a, BR-37.2). One-attempt-per-play is enforced in code
- [x] Test: applied once, idempotent, and **a rolled-back 007 leaves no `skip_attempt` table**

### Step 3 — `automationPredicate` ⚙️ and `safetyCounters` ⚙️ — ✅ DONE 2026-10-02
- [x] `live(state, rule): LiveVerdict` — returns `{ live: false, reason }`, never a bare boolean
- [x] `consecutiveRuleSkips`, `ruleSkipsInWindow` — **rolling window, `now` as a parameter**
- [x] ⚠️ Only `skip_source = 'rule'` counts (BR-35.3)
- [x] Constants **in source**: `MAX_CONSECUTIVE_RULE_SKIPS = 3`, `MAX_RULE_SKIPS_PER_HOUR = 10`.
      ⚠️ **Not env values, not settings** (Infra Q4)
- [x] **PBT-40** (all eight combinations), **PBT-46**, **PBT-47**
- [x] Extend `test/purity.test.ts` to both modules

### Step 4 — `SkipAttemptRepository` + SQLite impl — ✅ DONE 2026-10-02
- [x] `enqueue`, `transition`, `queued`, `attemptedForPlay`, **`firedSinceMs`**, `get`
- [x] ⚠️ **LC-24's `recentForConsecutive` was on the WRONG REPOSITORY and is not here.** BR-35.9
      resets the consecutive counter on any play **not** skipped by a rule, and `skip_attempt` has
      no row for such a play — a query over that table alone counts *three rule skips ever* rather
      than *three in a row*. The authoritative source is **`play.skip_source = 'rule'`**, the column
      U1 created for exactly this (US-13 split across U1 and U5). Added as
      **`HistoryRepository.recentPlaysForCounting(limit)`** instead. ⚠️ **An attempt is not a skip**:
      a `refused` or `cancelled` attempt never touched the player
- [x] ⚠️ **`firedSinceMs` filters on STATE, not on `fired_at` being set** — `fired`, `confirmed`
      and `unconfirmed` count; `queued`, `cancelled` and `refused` do not. Counting `unconfirmed` is
      deliberate: whether it landed is *unknown*, and unknown counts as landed (P-30's rule applied
      to a safety limit). A halt that under-counts is a halt that does not fire
- [x] ⚠️ `transition` writes state **and its evidence fields in one statement** (BR-43.2)
- [x] ⚠️ `attemptedForPlay` keyed on **`evaluationId`, never `trackId`** — **PBT-37** pins both
      directions, plus the case that forced the change: it works **while `playId` is still null**
- [x] ⚠️ **`skip_attempt.play_id` is NULLABLE and the FD said otherwise.** `PlayObserver` writes the
      play row at **close**, so there is no `playId` while the play is open — which is when a skip must
      happen. `NOT NULL` would have thrown on the first real skip. Amended in migration 007 **before it
      had ever run**; `playId` is backfilled via `attachPlayId`, as `decision_log` already does
- [x] ⚠️ Normalise `undefined → null` before persisting — **PBT-49**

### Step 5 — `AutomationStateStore` and `spotifyPlayerClient` — ✅ DONE 2026-10-02
- [x] `read()` **fails closed**: missing, unparseable or partial ⇒ automation **off** (BR-34.5)
- [x] `write()` returns a `WriteOutcome` and **never throws into the caller** — P-31 needs the caller
      to apply the asymmetry
- [x] `probeWritable()` at startup — a real write-and-delete in `/state`, ⚠️ **not an inference from
      `compose.yaml`**. ⚠️ **Must not refuse to start on failure** (NFR-13)
- [x] ⚠️ **`spotifyPlayerClient` exposes `skipToNext()` and nothing else.** Structural test on its
      exported shape
- [x] **PBT-45**'s storage half — `write` returns an outcome so the caller can apply P-31's
      asymmetry; the asymmetry itself lands with the API route in Step 10
- [x] ⚠️ **`read()` returns a SOURCE** (`file` | `absent` | `unreadable`), not just state.
      Infrastructure Q8 asked diagnostics to report *where the state was read from*, and the reason
      is sharper than reporting: **"off" and "we could not tell" are different facts.** A user
      shown a plain *off* while the file is corrupt would believe they turned it off themselves,
      and would not know a halt acknowledgement had been lost. Reporting a halt we cannot read
      would be fabrication
- [x] ⚠️ **A malformed halt is NOT read as "no halt"** — that would clear a latch the system set
      for its own protection, which BR-35.6 reserves for an explicit acknowledgement
- [x] ⚠️ **A third `RefusalReason` added: `no-active-device`** (HTTP 404). Classified as a
      *refusal* rather than a *failure* because it is benign and provable — the listener pressed
      stop. In the failed bucket it would read as a defect every time

### Step 6 — `skipDrain` 🔌 — **THE ACTION POINT** — ✅ DONE 2026-10-02
- [x] The refusals **in order**, each recorded with its reason (P-28)
- [x] ⚠️ **`already-attempted` is NOT checked here — it moved to ENQUEUE** (Step 7). The row being
      drained is itself an attempt for this play, so a drain-time check would have refused every
      attempt as a duplicate of itself. The budget is spent when the row is created
- [x] ⚠️ **The queue is the `skip_attempt` table, not an in-memory array** — a deviation from
      P-29's wording, with the risk it named covered **twice**: the startup sweep closes surviving
      `queued` rows, *and* the play-open check refuses them anyway because `currentPlay()` reports a
      different `evaluationId` after a restart. One source of truth beats two that can disagree
- [x] ⚠️ **Re-entrancy guard** — `drain` is called from the enqueue path AND the 3 s tick, so
      without it two overlapping runs could both claim the same attempt and both `POST`: a
      **double skip**. Pinned by a concurrent-drain test
- [x] ⚠️ **Re-read `AutomationState` from disk at drain time** — not a value captured at decision
      time. **PBT-41 is the only property that can catch this**
- [x] Evidence before and after the `POST` (BR-43.2)
- [x] Confirmation: `progress_ms` reset **AND** track-id change, **~3 s grace** (BR-43.3/43.4)
- [x] ⚠️ **P-30 transport handling**: 401 → one refresh-and-reissue · 429 → **refuse without waiting**,
      `upstream-rate-limited` · 5xx / network / unconfirmed → failed, surfaced, **never retried**
- [x] ⚠️ **`drain` never throws.** Rejections are caught and written to the attempt row
- [x] ⚠️ **No fixed timing offset anywhere** (P-34) — `dj-talk`'s audio lag is **negative**
- [x] **PBT-34 … PBT-39**, **PBT-41**, **PBT-43**, **PBT-44**
- [x] ⭐ **PBT-34a — the positive control.** A drain that posts nothing satisfies all six refusal
      properties perfectly

### Step 7 — `SkipExecutor` and `LoggingExecutor`'s one change — ✅ DONE 2026-10-02
- [x] `SkipExecutor.execute` is **synchronous**, writes decision rows, enqueues, schedules a drain,
      returns the `evaluationId` (BR-42.1/42.2)
- [x] **One drain function, two entry points** — the schedule and the 3 s tick backstop. ⚠️ Never two
      drains
- [x] ⚠️ **`LoggingExecutor`'s `dryRun: true` STAYS `true`, and the plan's instruction was wrong.**
      It said the constant *"becomes BR-33.2's computed value"* — but computing it needs the
      `AutomationStateStore`, and **BR-30.2 forbids giving `LoggingExecutor` that collaborator.**
      `true` is also *accurate* rather than a leftover: if `LoggingExecutor` is the selected
      executor, no action is possible at all. The row builder takes `dryRun` as a **parameter**;
      `LoggingExecutor` passes `true`, `SkipExecutor` passes the computed value
- [x] ⚠️ **Row building extracted to `rules/decisionRows.ts` (pure), not duplicated.** Both
      executors write identical rows, and a second copy of forty lines carrying three deliberate
      subtleties is how the WebSocket `403` happened. Having `SkipExecutor` call `LoggingExecutor`
      was also rejected: that import edge says the opposite of BR-30. `LoggingExecutor` dropped
      from 120 lines to 79
- [x] ⚠️ **`DecisionLogEntry.trigger` and the INSERT were MISSING** — migration 007 added the
      column but nothing wrote it, so Step 8's re-evaluation could not have recorded which pass it
      was. Added here, with the bind value; probed that a column DEFAULT does **not** rescue an
      explicitly bound null, so the omission failed loudly instead of silently recording `initial`
- [x] ⚠️ **`LoggingExecutor` gains NO constructor parameter** (BR-30.2) and
      `LoggingExecutor.length === 1` still passes

### Step 8 — FR-34 re-evaluation and FR-33's `hold` — ✅ DONE 2026-10-02
- [x] A second decision per play, `trigger = 'enrichment-arrived'`, writing **new** rows (BR-37.8)
- [x] ⚠️ May **cancel** a queued attempt; may **never create** one (BR-37.5/37.6) — **PBT-42**,
      enforced in **ONE place**: `SkipExecutor` returns early on `trigger === 'enrichment-arrived'`.
      Keyed on the trigger rather than by comparing verdicts, because the trigger already separates
      the two cases — a first pass that MATCHED leaves an attempt the drain can cancel, and a first
      pass that DECLINED leaves none, which is the escalation BR-37.6 forbids
- [x] ⭐ **A HELD play's decision is `initial`, not `enrichment-arrived`** — and that distinction is
      what makes FR-33 useful rather than inert. A held play was never decided, so there is nothing
      to re-evaluate; if its late decision were tagged `enrichment-arrived`, BR-37.6 would forbid a
      holding rule from ever acting
- [x] ⚠️ **At most ONE re-evaluation per play**, and only when the first pass used partial data.
      Without the flag the coordinator would write a decision group every 3 s for the rest of the
      track, which BR-22.1a's deliberate absence of a uniqueness constraint would not have surfaced
- [x] `execute` call stays **synchronous and unawaited** (BR-42.1)
- [x] ⚠️ **No `FactCache`.** If one is ever added it may cache point-in-time history counts and
      **never the enrichment fields** — the point of re-evaluating is that the facts changed
- [x] `hold` completes FR-33: `min(label resolved, 30 000 ms, 50% of duration)` — **PBT-48**.
      ⚠️ `applyOnUnknown` keeps **no `default:` clause**

### Step 9 — The context write path and `upstreamMetrics` — ✅ DONE 2026-10-02
- [x] ⚠️ **New module `playbackContext.ts`, and it fetches ONCE PER TRACK, never per tick.** The
      poll is already **98.4%** of this app's Spotify footprint, so a per-tick context fetch would
      **double** it — to collect a value that cannot change within one play. ~16 req/hr instead of
      1,200. An in-flight guard stops a slow upstream turning one call per track into one per tick
- [x] ⚠️ **A context failure records `null` and does NOT poison the cache** — the next tick may
      retry. Marking the track fetched on failure would record `unknown` for a whole play on one
      transient error (NFR-18)
- [x] ⚠️ **The fetch reports itself to `upstreamMetrics`** — a new upstream call that was not
      counted would be exactly the blind spot M1–M4 exist to remove
- [x] Wiring it into `server.ts` is **Step 10**; the module and its tests are here
- [x] `RecentlyPlayedBackfill` populates both — probed present on `recently-played`
- [x] ⚠️ **`src/export/serialisers.ts` including CSV headers** — the one nothing fails without
- [x] M1 (rolling 30 s **and** per hour) · **M2 counts and persists 429/503 with `Retry-After`** ·
      M3 requests-per-play · M4 share of polls returning nothing playing
- [x] ⚠️ **M2 must count, not log.** `webApiClient.ts:125` currently throws the `Retry-After` away
      inside a message string — **PBT-50**

### Step 10 — `api.ts`, `server.ts`, `diagnostics.ts` — ✅ DONE 2026-10-02
- [x] `POST /api/automation` (arm/disarm) · `POST /api/automation/acknowledge-halt` ·
      `GET /api/automation`
- [x] All three in **`api.ts`**, collaborators injected including `now` — `automationRoutes.test.ts`
      (22 tests over real HTTP). ⚠️ **Every response is read back from disk**, so a failed write is
      `503` carrying the PREVIOUS value; arming while halted is `409` and writes nothing; `reArm` has
      **no default**; acknowledging with nothing halted is `409`, so it cannot become a second way to arm
- [x] ⚠️ **No new route for metrics** and **no new WebSocket surface** (Infra Q6) — M1–M4 ride
      alongside `steps` on `/api/diagnostics`, as `coverage` does
- [x] `server.ts`: executor selection by `SKIP_EXECUTOR_ENABLED` (Q2), the drain on the 3 s tick **and**
      `scheduleDrain`, the **startup sweep** closing surviving `queued` rows as `refused: play-closed`
      (P-29). ⚠️ Sweep ordering is pinned structurally, because the ordering *is* the guarantee
- [x] ⚠️ **Leave the `upgrade` handler in `server.ts`** — untouched; `localGuard.test.ts` still passes
- [x] `diagnostics.ts`: automation state **and where it was read from**, halt with trigger, queue depth
      and oldest queued age, last attempt + reason, **`/state` writability**
- [x] ⚠️ **EXTRACTED as `automationDiagnosticSteps`, taking plain data only.** Inlining would have put
      the halt banner, the unwritable-`/state` fault and the stale-queue threshold inside
      `diagnostics.ts`, which is in `ALLOWED_ORPHANS` — live code covered by nothing
- [x] `test/playbackBoundary.test.ts` — **P-33 moved from Step 12 to here**, because this is the step
      that spends U4's boundary. Pins the import direction, the one-method player client, one `SkipDrain`,
      and the sweep-before-executor ordering
- [x] ⚠️ **Defect found in review**: `skipAttempts.attachPlayId` had TWO call sites, and the one on
      `PlayObserver.onPlayRecorded` lacked the coordinator's *"is this still the play that was decided"*
      guard — so on a fast transition it would attach the **closing play's id to the next play's
      attempt**. Fixed by **removing the copy**, not by adding the term; pinned structurally

### Step 11 — UI (FC-U5-1, FC-U5-2, FC-U5-3) — ✅ DONE 2026-10-02
- [x] **`src/ui/statusBar.ts` ⚙️ tested** — `automationIndicator`, seven states, **a glyph per state**,
      pinned by a test asserting 7 distinct levels AND 7 distinct glyphs
- [x] ⚠️ **`IndicatorLevel` widened by five members; no `default:` clause added.** The compiler named
      every site that had to change, which is the pattern working — five `statusBar({…})` literals in
      `statusBar.test.ts` had to gain `automation`
- [x] ⚠️ **A second test pins that no glyph is an EMOJI.** An emoji renders at a different size and
      baseline from the geometric shapes, so a state change would visibly shift the whole bar — and
      colour fonts vary by platform
- [x] ⚠️ **`Rules v#` is NOT recoloured** — untouched; the U5 dot is appended and is omitted entirely
      when `automation` is `null`, rather than drawn as `unknown`
- [x] Kill switch + halt acknowledgement on the **Rules pop-up**, FIRST section, not the primary screen
- [x] ⚠️ The button reflects **what was read back from disk** — a structural test asserts `app.js`
      keeps no local `automationEnabled` and never toggles the rendered state without a round trip
- [x] ⚠️ **Two buttons for the halt** (BR-35.5), and `haltPanel` returns two distinct labels, asserted
- [x] `public/app.js` gets DOM wiring only
- [x] ⚠️ **`src/ui/automationPanel.ts` ⚙️ tested** — added because `app.js` **cannot import from
      `src/`** (no bundler), so *"the judgement lives in a tested module"* can only mean **the server
      derives it and ships it**. `/api/automation` now returns `view` and `haltPanel` beside the facts,
      exactly as the status-bar indicators already arrive on the WebSocket snapshot
- [x] ⚠️ **`test/statusBarPrecedence.test.ts`** — the message precedence is the ONE status-bar
      judgement that exists twice, because the Connection dot is client-side and so `app.js` has to
      assemble the array itself. The test reads **both files** and fails if the orderings disagree
- [x] ⚠️ **A test drives FC-U5-1 into `failed`** — and into all six others
- [x] ⚠️ **Defect found and fixed**: `switchView`'s *machinery not built* branch hard-coded
      `warning: null`, so a failed save vanished behind the greyed control. `explanation` and `warning`
      are separate channels; pinned
- [x] ⚠️ **Defect found and fixed**: `decorate()` called `statusIndicators()` **twice** per tick.
      Harmless while every input was an in-memory counter — and no longer, because the automation
      indicator reads the state file and queries `skip_attempt`. The two calls could also have
      **disagreed**, giving a payload whose dot and whose message came from different reads

> ⚠️ **NOT verified by clicking, and the FD says that is where this component's defects live.** Both
> real defects ever found in `app.js` — the liked-refresh race and *"every axis tick says Aug"* — were
> found by a human using the page, and the container still runs the **U4 image**, so none of this UI is
> reachable yet. **The click-through belongs to step 13**, against the real `/state` mount.

### Step 12 — Tests, purity, orphans, and the CI guards

> ⚠️ **P-33's structural tests MOVED TO STEP 10** (`test/playbackBoundary.test.ts`), because step 10 is
> the step that spends U4's boundary — leaving the replacement two steps downstream would have left the
> guarantee unenforced across the very commits that break it. What remains here is purity, orphans and
> the CI guards from NFR Q9.
- [ ] **PBT-34 … PBT-50**, including **PBT-34a** and **PBT-41**
- [ ] Extend `test/purity.test.ts` to `automationPredicate`, `safetyCounters`, `armingProjection`,
      `statusBar`'s new derivation, and `upstreamMetrics`' pure aggregation
- [ ] ⚠️ Generators build the child arbitrary **once** — never recurse per branch
- [ ] `noOrphanModules.test.ts`: every new module executed, or an `ALLOWED_ORPHANS` entry **with a
      reason**
- [ ] **Structural tests**: nothing in `src/rules/` imports `src/playback/` · only `SkipExecutor`
      imports `src/playback/` · `spotifyPlayerClient`'s exported surface is **exactly one method** ·
      `LoggingExecutor.length === 1`
- [ ] ⚠️ **Q9 from the NFR plan**: CI runs **each script's safe mode** (not `node --check`, not by
      importing), and **`knip`** over `src/` *and* `scripts/`, ignore list seeded **with a reason per
      entry**

### Step 13 — Deployment and documentation
- [ ] `compose.yaml`: `+ ./state:/state:rw` · `AUTOMATION_STATE_PATH` · `SKIP_EXECUTOR_ENABLED` ·
      **two comment corrections** (the `:rw` *reason*, and the inode hazard moving to `./state`)
- [ ] ⚠️ `npm run db:restore -- data/backup-before-migration-007-20260929T172027Z --verify-only`
- [ ] `docker compose down` → build **checking the exit code directly** → `up -d` → `migrated 7:`
      **exactly once**
- [ ] ⚠️ **Verify rollback live** (Infra Q3): U4's image against a **v7 copy**, expecting
      `from: 7, to: 7`
- [ ] ⚠️ **Pre-register the BR-35 thresholds in writing** — before any rule is armed
- [ ] `aidlc-state.md`, `audit.md`, code summary, build-and-test doc

---

## Verification

| Check | Command |
|---|---|
| Tests | `npm test` — **914 passing** as of Step 2 (was 891 at the start of U5) |
| Types (src **and** test) | `npm run typecheck` |
| Coverage + orphan guard | `npm run test:coverage` |
| Dead exports | `npx knip` |
| Entry points | each `scripts/*` safe mode, in CI |
| Migration | `docker logs spotify-now-playing \| head -40` → `migrated 7:` **exactly once** |
| Phase boundary | `src/rules/` imports nothing from `src/playback/`; client has one method |

⚠️ **A green suite is not sufficient for this unit, and it is less sufficient here than anywhere else
in the project.** Three exit criteria cannot be closed by CI:

1. **The dry-run review** that arms the first rule — BR-40.1's actual gate.
2. **The first real skip**, heard by the user, confirming it costs 2–3 s rather than 18–41 s.
3. **`probeWritable` against the real `/state` mount**, verified **through the container** — on the
   host the write succeeds and the bug is invisible.

> ⚠️ Three separate U2 defects all passed the full test suite and were found only by running the system
> and watching a real failure get *recorded*. **U5's equivalent failure is audible.**

---

## Story traceability

| Story | Delivered by |
|---|---|
| **US-13** (completing) rules act on playback | Steps 6, 7, 10 |
| **US-18** automated skipping | Steps 6, 7 · BR-33, BR-42, BR-43 |
| **US-19** stop it immediately | Steps 5, 10, 11 · BR-34 · **PBT-41, PBT-45** |
| **US-21** protection from runaway behaviour | Steps 3, 6 · BR-35 · **PBT-39, PBT-46, PBT-47** |
| **US-22** see what automation did and why | Steps 4, 10, 11 · P-28 · **PBT-49** |

| Requirement | Status at end of U5 |
|---|---|
| **FR-33** `hold` | ✅ **complete** — PARTIAL since U3 |
| **FR-34** re-evaluate on enrichment | ✅ Step 8 |
| **FR-35** partial-data path | ✅ Step 8 |
| **FR-36** pre-warm, depth 3, queue asked at runtime | ✅ |
| **FR-38** kill switch | ✅ Steps 5, 10, 11 |
| **FR-39** rate limit + runaway halt | ✅ Step 3 |
| **FR-40** one attempt per play | ✅ Step 4 — **PBT-37** |
| **FR-46** action point | ✅ Step 6 — no lag guard (BR-43.1) |
| **FR-47** off by default | ✅ Step 5 |
| **FR-48** confirm, surface, never retry | ✅ Step 6 — **PBT-44** |
| **NFR-17** 429/401 | ⚠️ **AMENDED by P-30, not merely met.** Its `Retry-After` clause is declined for the skip path, with the reason recorded |

---

## Out of scope

| | Why |
|---|---|
| Rule **authoring** UI | Stays file-based. `config/` stays `:ro` |
| A general `PlayerClient` | **P-33** — refused, not deferred |
| Exemption / allow rules, rule precedence | Q-B — revisit after Phase 4 |
| `FactCache` | Declined again. ⚠️ A cache over enrichment fields makes FR-34 a no-op **while every test passes** |
| **W-6** mutation testing, BR-derived tests | Backlog, triggered at the **end of U5** |
| **W-7** idle poll backoff | Backlog. ⚠️ Changes the recording instrument; blocked on M1–M4 |
| Re-running the hypothesis gate | **BR-11.7 — the confirmatory run is spent** |
