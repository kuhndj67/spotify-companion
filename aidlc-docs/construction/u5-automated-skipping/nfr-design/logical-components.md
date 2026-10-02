# Logical Components — U5: Automated Skipping

**Date**: 2026-10-01 · **Stage**: CONSTRUCTION — NFR Design, U5
**Numbering** continues from U4, which ended at **LC-22** and **PBT-33**.
**Patterns**: [`nfr-design-patterns.md`](nfr-design-patterns.md) — **P-27 … P-37**

⚙️ = pure · 🔌 = impure

---

## The boundary

U3 was six modules, five pure. U4 was the wiring, mostly impure. **U5 is the first unit that acts on
the world**, so the purity discipline narrows again:

> **Everything that decides whether to act stays pure. Only one component may act.**

The decision to skip is `RuleEngine`'s (U3, untouched). Whether that decision *may* fire is a pure
predicate over state. **The `POST` lives in exactly one module**, reached through exactly one path —
which is P-33, and is what replaces U4's *`src/playback/` does not exist* guard.

⚠️ **`test/purity.test.ts` must be extended to the new pure modules**, not merely left passing. A
`Date.now()` in `safetyCounters` or `automationPredicate` would make a safety decision
time-dependent and untestable **while every other test passed** — the same trap as the classifier, in
the place where it costs most.

⚠️ **`RuleEngine` and `outcomeClassifier` are UNTOUCHED by this unit**, and that is load-bearing, not
incidental. Back-tests and live decisions must keep using the same engine (NFR-26), and a clock in
the classifier breaks FR-20 and FR-42.

---

## LC-23 · `playback/automationPredicate` ⚙️ PURE

The P-27 predicate, as a total function of state. No I/O, no clock.

```
live(state: AutomationState, rule: Rule): LiveVerdict
  // { live: true } | { live: false, reason: RefusalReason }
```

⚠️ **It returns the REASON, never a bare boolean.** P-28: six causes, four correct behaviour and two
defect signals, and `firedAt === null` cannot tell them apart. A predicate returning `false` would
force the caller to re-derive *why*, which is where two copies of one rule diverge.

⚠️ **Pure so that all eight combinations of BR-33.2's four terms are testable** (PBT-40). The live
path has no way to exercise *automation on, rule disabled, halt set* on demand.

---

## LC-24 · `playback/SkipAttemptRepository` ⚙️ interface / 🔌 SQLite impl

Satisfies **NFR-10**: call sites name the interface, never `node:sqlite`.

```
enqueue(attempt: NewSkipAttempt): number          // returns id; state = 'queued'
transition(id, state, patch?): void               // writes evidence fields with the state
queued(): SkipAttempt[]                           // for the startup sweep
attemptedForPlay(playId): boolean                 // BR-36.1, the one-attempt guard
ruleSkipsSince(since): SkipAttempt[]              // BR-35.2 rolling window
recentForConsecutive(limit): SkipAttempt[]         // BR-35.1
```

⚠️ **`transition` writes the state and its evidence in ONE statement.** BR-43.2 requires the reported
track id and `progress_ms` before and after the `POST`; a state written without its evidence is a row
that says *fired* and cannot say *against what*.

⚠️ **`attemptedForPlay` is keyed on `playId`, never `trackId`** (BR-36.2). A recurring track is a new
play and stays fully skippable — the same class of error as clamping `completionRatio` to 1.0, and
pinned by PBT-37.

⚠️ **No `UNIQUE` constraint anywhere** (BR-22.1a, BR-37.2). The one-attempt-per-play rule is enforced
by this method, **not by the schema** — U4 deliberately created no constraint so migration 007 could
stay additive, and the by-image rollback guarantee depends on that.

---

## LC-25 · `playback/SkipExecutor` 🔌 IMPURE — the second `DecisionExecutor`

```
execute(decision): string        // SYNCHRONOUS. Returns evaluationId. Does NOT post.
```

**Added alongside `LoggingExecutor`, never grown out of it** (BR-30, BR-33.6). Two implementations of
one interface, selected by configuration.

It writes the decision rows, **enqueues a `SkipAttempt`, schedules a drain, and returns** (P-29).

⚠️ **The test asserting `LoggingExecutor.length === 1` must still pass at the end of U5.** If it
fails, the phase boundary was collapsed rather than crossed.

⚠️ **`execute` stays synchronous and unawaited from the timer** (BR-42.1). Making it
`Promise<string>` was rejected — see P-27.

---

## LC-26 · `playback/skipDrain` 🔌 IMPURE — **the action point**

The only place in the codebase that issues a player command.

```
drain(): Promise<void>     // scheduled on enqueue; ALSO called by the 3 s tick (backstop)
```

Per queued attempt, in order:

```
① re-read AutomationState from disk    ──> LC-23 predicate ──> refuse with reason
② play still open?                      ──> refuse: play-closed          [BR-42.5]
③ already attempted for this play?      ──> refuse: already-attempted    [BR-36.1]
④ safety counters (LC-27)               ──> refuse: rate-limited         [BR-35.2]
⑤ record trackId + progress_ms BEFORE                                   [BR-43.2]
⑥ POST /me/player/next   ── on the reported boundary, NO lag guard      [BR-43.1]
⑦ record trackId + progress_ms AFTER                                    [BR-43.2]
⑧ confirm: progress_ms reset AND track-id change, ~3 s grace            [BR-43.3/43.4]
⑨ consecutive >= 3 ?                    ──> RUNAWAY HALT                [BR-35.1]
```

⚠️ **Step ① re-reads from disk and does not use a captured value.** P-32: a guard that cannot observe
the condition it guards. The whole point of the action point is that state may have changed in the
10 s since the decision.

⚠️ **`drain` never throws.** A rejection is caught and written to the attempt row. An escaped
rejection inside a timer is how a skip silently never happens — and the backstop would then retry an
attempt the queue thinks is still pending.

⚠️ **Step ⑧ is a confirmation, not a retry trigger.** Unconfirmed ⇒ `unconfirmed`, surfaced, **never
retried** (BR-43.5). ⚠️ **And step ⑥'s failures are classified by P-30, not by this list** — a 401 is
re-issued once, a 429 is **refused without waiting**.

---

## LC-27 · `playback/safetyCounters` ⚙️ PURE

```
consecutiveRuleSkips(attempts, plays): number     // reset by any play not skipped by a rule
ruleSkipsInWindow(attempts, now, windowMs): number // ROLLING, not a calendar hour
```

**Derived, never stored** (`domain-entities.md` §4). A stored counter is a second source of truth that
drifts invisibly from the rows it summarises — *store observations; derive judgements*.

⚠️ **Takes `now` as a parameter.** Same reason `playStats.ts` does: a rolling window anchored on an
ambient clock is untestable, and the week-seam bug is the precedent.

⚠️ **Only `skip_source = 'rule'` counts** (BR-35.3). A user's own skips never trip a halt — and there
are **31** of them in the corpus, all `user`.

> ⚠️ **The thresholds are reachable by a legitimate rule, and this is measured.** The busiest rolling
> hour holds **27 plays** (median 16). So BR-35.2's 10/hour trips on any rule matching more than
> **37%** of plays at peak, or **62%** at the median. **This is not grounds to raise the number** —
> they are pre-registered safety limits, and BR-11's precedent is why. It is grounds for Q6's
> projection at arming time.

---

## LC-28 · `playback/upstreamMetrics` 🔌 IMPURE shell, ⚙️ pure aggregation

**M1–M4** from P-37. The shell records; the aggregation is pure and takes `now`.

```
record(upstream, outcome, retryAfterMs?): void
snapshot(now): UpstreamMetrics
  // per upstream: rolling30s, perHour, rateLimitHits, lastRetryAfter, lastRateLimitAt
  // derived:      requestsPerPlay, pollsReturningNothingPlaying
```

⚠️ **The 30-second window is not decoration** — it is the window Spotify itself uses, and an hourly
mean hides exactly the burst that would trip a limit.

⚠️ **`rateLimitHits` is a COUNT, not a log line.** `webApiClient.ts:125` currently throws the
`Retry-After` away inside a message string, so today the app cannot say whether it has ever been
rate-limited. A structurally empty field reads as *this never happens* — the `successor_lag_ms` trap.

⚠️ **`pollsReturningNothingPlaying` is the positive liveness signal**, and it is why this component
outgrew its diagnostics brief: it distinguishes *polling and hearing silence* from *not polling*. The
2026-09-30 outage lacked exactly that and ran ~13 hours unnoticed. ⚠️ **It makes the state visible; it
does not alert** — a monitor cannot live in the container when the failure mode is *the container is
not running*.

---

## LC-29 · `playback/AutomationStateStore` 🔌 IMPURE

**`/state/automation-state.json`** — read, write-temp-then-rename, **fails closed**.
⚠️ **Amended 2026-10-01**: was `config/automation-state.json`. Infrastructure Q1 moved it to a new
`./state:/state:rw` mount so `config/` stays `:ro` and the app never gains permission to overwrite the
user's hand-authored `rules.json`.

```
read(): AutomationState        // missing | unparseable | partial  =>  automation OFF
write(next): WriteOutcome      // { ok } | { ok: false, reason }
probeWritable(): boolean       // STARTUP. BR-34.4
```

⚠️ **`write` returns an outcome and never throws into the caller's lap**, because P-31 needs the
caller to apply the *asymmetric* rule: a failure never blocks disarming, always blocks arming.

⚠️ **`./state` must be a DIRECTORY mount.** A single-file bind mount binds an **inode**, and
write-temp-then-rename *replaces* it — so the rename either fails or silently detaches the container's
view from the host file.

⚠️ **`probeWritable` is a PROBE, not an inference from `compose.yaml`.** `./state` is a new mount, and
if the directory is missing Docker creates it — measured on this host as `rwxrwxrwx root:root`, but
**that measurement covered reads and this needs a write**. The failure presents as *a kill switch that
works in the UI and does not persist*, and discovering it when the user reaches for the kill switch is
the worst possible moment. ⚠️ **It must not fail closed into refusing to start** — NFR-13: an
unwritable `/state` means automation cannot be *armed*, not that the app stops recording.
**Recording is the irreplaceable function.**

---

## LC-30 · `ui/automationIndicator` ⚙️ PURE *(FC-U5-1)*

Seven states → `{ level, label, glyph }`. The **judgement** is here and tested; the DOM wiring is
`public/app.js`.

⚠️ **A second indicator beside `Rules v#`, never a recolouring of it.** All four `IndicatorLevel`
values are already bound to rules-**file** load health, where `fail` **names the version still in
force** (FQ5). Recolouring would make red mean either *your rules file is broken* or *a skip failed* —
two variables on one light.

⚠️ **Colour is never the only channel**, per `statusBar.ts`'s own contract: each state needs a glyph,
which matters most for the proposed `Green`/`Yellowgreen` pair. ⚠️ **`IndicatorLevel` must widen**,
and the union has **no `default:` clause** anywhere it is switched — the compiler will name every site
that must change. **Do not add a `default:` to silence it.**

⚠️ **The split is not stylistic.** `public/app.js` has no tests and is outside the orphan walk, and
*both* defects ever found in it were found **by clicking**. A false green would come from this
judgement, so the judgement must be testable.

---

## LC-31 · `playback/armingProjection` ⚙️ PURE *(Q6 = B)*

```
project(ruleMatchRate, playRatePerHour): { projectedSkipsPerHour, wouldTripHalt }
```

Shown at arming time beside the advisory back-test.

⚠️ **Labelled a PROJECTION, not a prediction.** It is computed from past plays under a rule that was
not armed then — the back-test's own limitation, and it must not be presented more confidently than
the back-test is. ⚠️ **It cannot block arming** (BR-40.2): a projected-rate gate would be the numeric
threshold Q1 deliberately rejected, wearing different clothes.

---

## Components deliberately NOT built

| | Why |
|---|---|
| A general `PlayerClient` | **P-33** — refused, not deferred. One method, `skipToNext()` |
| A durable queue | **P-29** — a skip surviving a restart fires into whatever is playing now |
| A stored `SafetyCounters` row | LC-27 — derived. A second source of truth that drifts invisibly |
| `FactCache` (LC-12, P-16) | ⚠️ **Re-opened by FR-34 and still declined.** If ever built it may cache **point-in-time history counts** and **never the enrichment fields** — the point of re-evaluating is that the facts changed, so a cache serving the first assembly's values makes FR-34 a no-op **while every test passes** |
| A rules **editor** | Out of scope; authoring stays file-based |
| An in-container liveness monitor | **LC-28** — the failure mode is *the container is not running* |

---

## Property obligations — PBT-34 onward

| # | Property | Guards |
|---|---|---|
| **PBT-34** | ⭐ **`automation-off` refuses** — a queued attempt drained with automation off never posts | BR-33.1, P-28 ① |
| **PBT-34a** | ⭐ **Positive control**: with all four terms true, the same attempt **does** post | ⚠️ PBT-34 passes trivially if nothing ever posts |
| **PBT-35** | `runaway-halted` refuses, and the halt is a **separate latch** from the kill switch | BR-35.4/35.5, ② |
| **PBT-36** | `rule-dry-run` refuses; **a rule cannot opt out of a global dry-run** | BR-33.3, ③ |
| **PBT-37** | ⭐ **One attempt per PLAY ROW** — a second attempt on the same play refuses; **the same `track_id` on a NEW play does not** | BR-36.1/36.2, ④ |
| **PBT-38** | `play-closed` refuses, and the discard is **recorded** | BR-42.5, ⑤ |
| **PBT-39** | `rate-limited` refuses at the 10th rule-skip in a rolling hour | BR-35.2, ⑥ |
| **PBT-40** | **All eight combinations** of BR-33.2's four terms; `live` iff all four hold | BR-33.2, LC-23 |
| **PBT-41** | The predicate is evaluated **at drain time** — flipping automation off *after* enqueue refuses the attempt | ⭐ **P-27, the whole point of the queue** |
| **PBT-42** | Re-evaluation **cancels** a queued attempt and **never creates** one | BR-37.5/37.6, P-31 |
| **PBT-43** | A `queued` row surviving a restart is closed **`refused: play-closed`**, never fired | P-29 |
| **PBT-44** | ⭐ **401 is re-issued once; 429 is refused WITHOUT waiting**; 5xx / unconfirmed are failed and never retried | **P-30**, the NFR-17 amendment |
| **PBT-45** | ⭐ **Kill-switch asymmetry**: a write failure **does not block disarming** and **does block arming** | **P-31**, Q5 |
| **PBT-46** | `consecutiveRuleSkips` resets on any play not skipped by a rule; the hourly window is **rolling** | BR-35.9, LC-27 |
| **PBT-47** | Only `skip_source = 'rule'` counts toward either threshold — user skips never trip a halt | BR-35.3 |
| **PBT-48** | `hold` expires at **`min(label resolved, 30 000 ms, 50% of duration)`**, in milliseconds | BR-38.2/38.3 |
| **PBT-49** | `SkipAttempt` **round-trips**: written then read back is equal by value, `undefined → null` normalised | NFR-27 shape, BR-23.4 |
| **PBT-50** | `M1`'s rolling-30s window is a function of `(records, now)` alone — no ambient clock | LC-28, NFR-26 |

> ### ⭐ PBT-34a and PBT-41 are the two that actually earn their place
>
> **PBT-34a is a positive control and is not optional garnish.** PBT-22 passed trivially against
> counts that were always zero, and the backup verifier needed a `--self-test` against a known-corrupt
> file for the same reason. ⚠️ **A `drain` that posted nothing, ever, would satisfy PBT-34 through
> PBT-39 perfectly.** Six refusal properties prove the refusals fire; **one of them must prove the
> action fires too**, or the suite is green on a system that cannot skip.
>
> **PBT-41 is the only thing that will ever catch the P-27 defect.** Checking the predicate at
> decision time instead of drain time produces **correct behaviour in every ordinary test** — the
> states agree whenever nothing changed in between. It diverges only when automation is switched off
> *during* the 10-second enrichment wait, which is exactly the case FR-38 is about and exactly the
> case no hands-on session will reproduce on purpose.

⚠️ **Seeds are logged and replayable** (NFR-21), as for PBT-01 … PBT-33. `FC_SEED` is surfaced in the
CI run summary.

⚠️ **Generators build the child arbitrary ONCE.** U3's `treeOfDepth` called itself three times per
level, building ~3^d arbitraries; at depth 20 it exhausted the heap and killed the process with a V8
stack dump and no useful message — reading as *"property testing is slow"* rather than *"the generator
is wrong"*.

---

## Exit criteria — how each is discharged

| | Phase 4 criterion | Discharged by |
|---|---|---|
| 1 | Automation off by default | BR-33.1 · LC-29 fresh-install test · PBT-40 |
| 2 | Kill switch halts action immediately | LC-26 ① · **PBT-41** |
| 3 | Kill switch persists across restart | LC-29 · ⚠️ verified **through the container**, not on the host |
| 4 | Rate limit and runaway halt enforced | LC-27 · PBT-39, PBT-46, PBT-47 · pre-registered before arming |
| 5 | A failed skip is surfaced, not retried | LC-26 ⑧ · PBT-44 · BR-43.5 |
| 6 | No skip without a matching armed rule | LC-23 · PBT-34 … PBT-40 |
| 7 | Every action logged with rule, facts and verdict | U4's decision log + `skip_attempt` · PBT-49 |

⚠️ **Criterion 3 is the one most likely to pass on the host and fail in the container**, because
`config/` is `:ro` today and the failure looks like a UI bug rather than a mount problem.

⚠️ **Three things CI cannot close, as in U4:**

1. **The dry-run review** that arms the first rule — Q1's actual gate.
2. **The first real skip**, heard by the user, confirming BR-43.1 costs 2–3 s and not 18–41 s.
3. **`probeWritable` against the `:rw` mount**, verified by writing *through the container*.

> ⚠️ **A green suite is not sufficient for this unit, and it is less sufficient here than anywhere
> else in the project.** Three separate U2 defects all passed the full suite and were found only by
> running the system and watching a real failure get *recorded*. U5's equivalent failure is audible.
