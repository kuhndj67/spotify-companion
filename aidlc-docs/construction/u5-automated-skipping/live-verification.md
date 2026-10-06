# U5 Live Verification — Automated Skipping

**Dates**: 2026-10-04 → 2026-10-06 · **Sessions**: 7 · **Status**: ✅ **Verified against real listening**

Closes the three exit criteria that `u5-code-generation-plan.md` §Verification said CI could not:

1. ✅ `probeWritable` against the real `/state` mount, **through the container**
2. ✅ The **dry-run review** that armed the first rule
3. ✅ The **first real skip, heard by the user** — and its cost measured

> ⚠️ **U5 is the only unit that can cause harm**, and this document exists because *a green suite is less
> sufficient here than anywhere else in the project*. **Eight defects were found across these sessions.
> None was caught by the test suite.** §4 lists them and what each one cost.

---

## 1. Dataset

| | |
|---|---|
| Live sessions | **7** |
| `skip_attempt` rows | **42** |
| Attempts that reached the player | **29** — 26 `confirmed`, 3 `unconfirmed` |
| Refusals | **13** — 8 `automation-off`, 5 `runaway-halted` |
| Runaway halts | **6** — 5 `consecutive`, **1 `hourly-rate`** |
| Plays labelled `skip_source = 'rule'` | **29** (was structurally impossible before 2026-10-04) |
| Attempts reaching the player with no `play_id` | **0** throughout |
| Corpus at close | **973 plays** · 1,214 decision rows · schema **v7** · `integrity_check: ok` |

---

## 2. ⭐ The headline measurement: what a skip costs

**FR-46/BR-43.1's open question was whether skipping at a track boundary would cut 18–41 s off the
*outgoing* track.** Probe P-U5-1 predicted 2–3 s. Measured over 29 real skips:

| | ms |
|---|---|
| Minimum | **1,000** |
| Median | **6,000** |
| Maximum | **9,000** |

**1–9 seconds. The design's fear is not realised, and no lag guard is needed.**

### ⚠️ But the figure is NOT a property of the skip mechanism, and two earlier reports got that wrong

The cost is **how long enrichment takes to settle**, bounded by `ENRICHMENT_WAIT_MS` (10 s). The decision
fires on the first tick where the rule's facts are complete; the skip follows within ~150 ms.

- Every skip decided on **complete** data (`partialData: 0`, `trigger: initial`) — none timed out.
- The **1,000 ms** case was a track played minutes earlier, so its enrichment was **cached** and the
  decision fired on the first tick.
- The **9,000 ms** case was a first-ever play whose label took most of the wait to resolve.

⚠️ **I reported "6–7 s" after 13 skips and "3–9 s" after 19.** Both were artefacts of the sample, and
both were stated more confidently than the evidence supported. The stable claim is the *mechanism*: the
cost tracks enrichment latency, so it is bounded by a constant this project already tunes deliberately.

### POST latency

Median **150 ms** · min 113 ms. ⚠️ **Three outliers at 3,089 / 3,156 / 5,458 ms** coincide with
`Access token expired… refreshing` in the container log.

⚠️ **The cause cannot be determined from the available evidence**, and that is worth recording rather
than guessing: `getAccessToken()` refreshes proactively, and `spotifyPlayerClient`'s 401 retry path
**logs nothing**. So a proactive refresh and a 401-triggered refresh-and-reissue are indistinguishable
here. **P-30's amendment to NFR-17 therefore remains unverified live** (§6), and the gap is an
observability one, not a behavioural one.

---

## 3. Every BR-35 path, and how it was reached

| Path | Verified | Evidence |
|---|---|---|
| `consecutive` halt | ✅ **5×** | Latches on the **3rd** skip; the 4th matching track is refused |
| **`hourly-rate` halt** | ✅ **1×** | 2026-10-06, `observedCount: 10`, `attemptIds` = all **10** in the window |
| `runaway-halted` refusal | ✅ 5× | Every match after a halt |
| `automation-off` refusal | ✅ 8× | Matches while the switch was off |
| **BR-35.9 reset** | ✅ | 4 separators in one session; `consecutiveRuleSkips` ended at 1 having never reached 3 |
| BR-35.6 survives restart | ✅ | A latched halt persisted through `compose up --build` |
| P-30 *unknown counts as landed* | ✅ | All 3 `unconfirmed` attempts counted toward their halts |
| FR-48 *surface, never retry* | ✅ | `[skip] attempt 34 was NOT confirmed … Not retried.` |

### ⭐ `attemptIds` differs by trigger, and that is the point

| Trigger | Names | Example |
|---|---|---|
| `consecutive` | the **run** only | `[31, 32, 33]` |
| `hourly-rate` | the **whole window** | `[31, 32, 33, 34, 35, 36, 37, 38, 39, 40]` |

⚠️ **This was defect #3** (§4). The first live halt recorded **7 ids for a run of 3**, because the field
was filled from the hourly window regardless of what fired — four of them from an unrelated session an
hour earlier. BR-35.8 exists so the user can review *which skips counted*; **evidence that includes rows
the trigger did not count is worse than no list, because it reads as authoritative.**

### ⚠️ `hourly-rate` is near-unreachable in production, and that is a real property

Reaching it required **disabling two of three rules** and hand-pacing skips in pairs with manual
separators. Any rule broad enough to produce 10 skips in an hour will almost certainly produce **3
adjacent first**, so the consecutive guard pre-empts it.

⚠️ So `MAX_RULE_SKIPS_PER_HOUR = 10` is **mostly theoretical at `MAX_CONSECUTIVE_RULE_SKIPS = 3`**. That
is arguably correct — the tighter guard firing first is the safe ordering — but it should not be mistaken
for a limit that routinely protects anything.

⚠️ **A corollary: `rate-limited` (the pre-POST cap at step ④) never fired and is nearly dead.** The halt
latches at the same threshold and is checked earlier in `#process`. It is reachable only by acknowledging
a halt while ≥10 skips remain in the rolling window.

---

## 4. ⚠️ Eight defects, none caught by the suite

| # | Defect | Found by | What it would have cost |
|---|---|---|---|
| 1 | `play.skip_source` was **never written as `'rule'`** — `PlayObserver` hardcoded `'user'` from U1 — so `consecutiveRuleSkips` could only return 0 and **the halt could not fire at all** | Answering a user question about what "3 skips" meant | ⚠️ **No working runaway guard**, plus rule-skips entering R1's data as genuine rejections through an `ELIGIBLE` predicate with no `skip_source` guard — **circular by construction** |
| 2 | The **fix** for #1 keyed on the play's time window and failed live **by 11–14 ms**: `ended_at` is the last *observation*, and the attempt is enqueued from the decision taken on that same tick | The halt still not firing | Same as #1, with the appearance of being fixed |
| 3 | `attemptIds` filled from the **hourly window** regardless of trigger | Reading the first real halt record | 7 ids for a run of 3 — unreviewable evidence that reads as authoritative |
| 4 | **Halted-and-still-armed had no UI branch.** BR-33.4 leaves the switch `true` through a halt, so it read *"Turn automation off"* beside *"before turning it back on"* | Inspecting the first live halt | A control misdescribing its own state |
| 5 | The halt's **prose on the primary screen**, in the one message slot | User, on seeing it | A paragraph parked on a glanceable display until acknowledged |
| 6 | **Three controls during recovery** — kill switch + two halt buttons | User | A 2³ state machine for a linear process |
| 7 | The **Rules pop-up did not refresh** while open | User, who left the browser in the failing state | ⚠️ Not a missing alert but the **opposite of the truth**: *"Rules that match will skip the track"* while the halt guaranteed they would not |
| 8 | `confirmed()` compares `progressMs` **across a track change** | Characterising an `unconfirmed` row | A red `Skip unconfirmed` for a skip that landed. **Deliberately not fixed** — backlog **W-8** |

### ⚠️ The pattern worth carrying forward

**Two of these I documented WRONGLY first**, and both wrong versions had **passing tests**:

- The halt's off-by-one. I reasoned *"the counter reads closed plays, so it must trail by one"* and wrote
  *the 4th skip latches it* into a docstring, the UI, the pre-registration and a test. **BR-43.4's 3-second
  confirmation grace defeats that** — the play has closed by the time `#checkHalt` runs. Measured: 3 means 3.
- The time-window key (#2), whose fixtures used generous windows.

> ⚠️ **A fixture built around a mental model confirms the model.** Both tests passed because I wrote the
> data to match what I believed, not what the system does. That is a distinct failure mode from an
> untested path, and it is **invisible to coverage** — the line was executed, the assertion ran, and both
> agreed with each other and not with reality.

⚠️ **`knip` could not see #1 either**: `skip_source` is read *and* written — just never with that value.
**Dead-value analysis is not dead-code analysis.**

---

## 5. The UX revision (FC-U5-3)

Defects #4–#7 were all one shape: **surfaces disagreeing about state.** The fix was structural rather
than cosmetic.

| | Before | After |
|---|---|---|
| Controls while halted | **3** | **1** |
| Primary screen | dot + a paragraph | **dot only** |
| Switch while halted | shown, reading *"Turn automation off"* | **not rendered** |
| Recovery | 3 buttons, orderings undefined | 1 button → 1 button, linear |
| Panel while open | stale | refreshed off the snapshot, on level change |

⚠️ **Acknowledging now unconditionally sets `globalAutomationEnabled: false`**, so resuming is a second,
deliberate act on the ordinary switch. **That separates the two acts more strictly than FC-U5-3's original
two buttons did** — with the old `reArm` parameter, one request could clear a safety latch *and* re-arm,
which is precisely what BR-35.5 exists to prevent. FC-U5-3 is revised in place, struck through, with the
reasoning; **BR-35.5 and BR-35.6 are unchanged.**

---

## 6. ⚠️ What is still NOT verified live

| Path | Why not |
|---|---|
| **`no-active-device`** refusal | Needs playback stopped between the drain's play-open check and the `POST` |
| **`upstream-rate-limited`** (Spotify 429) | Never observed. ⚠️ Zero 429s is **not** headroom — Spotify publishes no limit |
| **P-30's 401 refresh-and-reissue** | Indistinguishable from a proactive refresh, because that path logs nothing (§2) |
| **`rate-limited`** (our pre-POST cap) | Pre-empted by the halt at the same threshold (§3) |
| **FR-33 `hold`** | No armed rule used `onUnknown: 'hold'` |

⚠️ **All five are covered by tests.** They are listed because *covered by a test* and *observed in
service* are different claims, and this unit's history is that the second one keeps finding things the
first did not.

---

## 7. Deployed posture at close

| | |
|---|---|
| `SKIP_EXECUTOR_ENABLED` | `"true"` — the machinery is built |
| `globalAutomationEnabled` | **user-controlled**, off by default (FR-47) |
| Rules armed during verification | `old-and-major` only at the end; `major-label` and `hip-hop` disabled by the user |
| BR-35 thresholds | **pre-registered** (`safety-thresholds/pre-registration.md`), unchanged throughout |

⚠️ **`hip-hop` was disabled by the user on 2026-10-06** after it skipped a bbno$ track — correctly, per
the rule as written (`artist.genres contains "hip hop"`, and that genre led the list). **The rule was
right and the intent was wrong**, which is exactly what the dry-run review and a user-authored rules file
exist to surface.
