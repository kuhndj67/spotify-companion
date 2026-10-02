# NFR Design Plan — U5: Automated Skipping

**Date**: 2026-09-27 · **Q9 added 2026-09-29** · **Stage**: CONSTRUCTION — NFR Design, Unit U5
**Status**: ✅ **ANSWERED 2026-09-30** — all nine, every one as recommended. Authoritative reading:
**§5.1**. Q8 carried a new requirement from the user — **§5.2**, which found that the 3 s poll is
**98.4%** of the app's Spotify footprint and that nothing counts requests at all.
✅ **NFR DESIGN IS COMPLETE (2026-10-01)**: `nfr-design/nfr-design-patterns.md` (**P-27…P-37**) and
`nfr-design/logical-components.md` (**LC-23…LC-31**, **PBT-34…PBT-50**).
**Next: the Infrastructure Design plan**, then Code Generation.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U5 Functional Design (`business-rules.md` **BR-33…BR-43**, `domain-entities.md`,
`business-logic-model.md`, `frontend-components.md`) · probe **P-U5-1** · **R11**

> **U5 is the only unit that can cause harm.** Every other unit, wrong, produces a bad number in a
> report. This one, wrong, interrupts the music. The NFR bias throughout is the FD's:
> **refuse rather than act when uncertain**, because a skip that should have happened and did not is
> recoverable by pressing a button, and a skip that should not have happened is not recoverable at all.

---

## ⚠️ Why this stage exists at all, when every U5 document said to skip it

Every U5 document — `CLAUDE.md`, `aidlc-state.md`, `HANDOFF.md`, the FD plan — ended with *"Next: the
Code Generation plan."* **That skips two stages.** U1–U4 each ran NFR Design and Infrastructure Design
between Functional Design and Code Generation, and those stages are where the **LC-\***, **P-\*** and
**PBT-\*** numbers are allocated — numbers the U4 code-generation plan then references as *inputs*
throughout its structure table.

Both stages are *conditional* in AI-DLC, so skipping them was permissible. But it would have left U5
the only unit with **no logical components, no design patterns and no property obligations**, and the
`config/` `:ro` → `:rw` change — a security-posture change to a deliberately read-only mount — decided
inside a code plan rather than surfaced as posture. **User chose the full sequence, 2026-09-27.**

⚠️ **The lesson is the project's own, and it is not "documents go stale".** Four documents agreed with
each other, and their agreement was *itself* the evidence that nobody had re-derived the sequence —
each one copied the next. **Consensus across documents that share an author is one observation, not
four.**

---

## 1. Unit context

| | |
|---|---|
| **Requirements** | FR-33 (completing), FR-34, FR-35, FR-36, FR-38, FR-39, FR-40, FR-46, FR-47, FR-48 |
| **NFRs in play** | **NFR-10** (repository interface), **NFR-13** (degrade, never crash), **NFR-15** (1 req/s MusicBrainz), **NFR-16** (never delay the display), **NFR-17** (429/401), **NFR-18** (partial data, never fatal), **NFR-20/21** (property tests, logged seeds), **NFR-24** (diagnostics authoritative), **NFR-26** (deterministic evaluation) |
| **Adds** | `src/playback/` — whose *absence* is U4's phase guard |
| **Also adds** | **M1–M4 upstream metrics** (§5.2) — Q8's addendum. ⚠️ Prerequisite for backlog **W-7** |
| **Allocates** | **LC-23 …** · **P-27 … P-37** · **PBT-34 …** |
| **Schema** | Migration **007**, additive only |

### ⚠️ The phase guard retires here, and something must replace it

U4's guard was **`src/playback/` does not exist**, plus `LoggingExecutor` taking no playback
collaborator (constructor arity pinned by a test). **U5 necessarily ends the first.** From here the
boundary has to become an *import-graph* property rather than an absence — which is what **P-26** was
for U4, and needs a U5 successor. See **Q4**.

---

## 2. Facts measured for this plan — 2026-09-27, read-only against the live database

⚠️ Every number in `u5-functional-design-plan.md` §2 was taken on **2026-09-23** at 664 plays. The
corpus has grown 28% since. **These supersede them.**

| | 2026-09-23 (FD plan) | **2026-09-27 (now)** |
|---|---|---|
| Plays | 664 | **850** |
| `completed` | 518 | **692** |
| `skipped` — all `skip_source = 'user'` | **22** | **31** |
| `unknown` | 124 | **127** |
| `decision_log` rows | 342 | **900** |
| `observation` rows | ~36,400 | **49,582** |
| Rules loaded | — | **3** |

### ⚠️ The evidence base grew 41%, and it is still 31 events

The FD's Q1 reasoning — *back-test is advisory, dry-run is the gate, no numeric threshold because 22
events cannot bear one* — **is unchanged by 31**. The 2026-09-10 gate had 17 and its CI ruled out
about ±8pp and nothing smaller. **31 does not change the character of the instrument**, and BR-40.2/40.3
stand exactly as written. Recording the growth so that nobody re-opens Q1 on the strength of it.

### ⚠️ The busiest rolling hour holds 27 plays — and that makes BR-35.2 reachable by a GOOD rule

| Live plays in a rolling hour | median | p90 | p99 | **max** |
|---|---|---|---|---|
| | **16** | 23 | 26 | **27** |

**BR-35.2 halts at 10 rule-skips in a rolling hour.** So the halt trips when a rule matches:

| At this play rate | a rule matching more than… | trips the halt |
|---|---|---|
| max, 27/hr | **37%** of plays | yes |
| median, 16/hr | **62%** of plays | yes |
| the busiest day observed (123 plays) | — | trivially |

⚠️ **This is not a reason to raise the number.** BR-35 states in terms that the thresholds are
**pre-registered safety limits, not tuning parameters**, and *"raising the number to make a favourite
rule work is the failure mode"*. `business-logic-model.md` §2 already marks refusal ⑥ `rate-limited` as
*"probably a defect somewhere"*. **What is new is the exact figure**: a broad-but-legitimate rule is
not a hypothetical, it is 37% at peak. The user should know that before arming one — which is **Q6**,
a *surfacing* question, not a threshold question.

### ⚠️ Decision-log growth is `plays × rules`, exactly

369 rows on 123 plays with 3 rules. At **10 rules** and the busiest observed day that is **1,230
rows/day**, against U4's 100,000-row retention cap — **81 days**. The cap is fine; the arithmetic is
recorded so nobody re-derives it. ⚠️ **FR-34's re-evaluation makes this `plays × rules × triggers`**,
so a second trigger per play doubles it to ~40 days at 10 rules. Still fine, still worth stating.

### Carried forward, not re-derived

| | |
|---|---|
| `ENRICHMENT_WAIT_MS = 10 000` | ✅ correct, **not generous** — max observed settle **9.0 s**. ⚠️ Do not lower on the median; an earlier read said 7–8 s was safe and the tail then moved |
| Blind spot | Plays ending before the cap log nothing — 2.8% of plays |
| `partialData` rate | **0 of 65** |
| `fs.watch` over the bind mount | **Dead** — 0 events in 12 s. Do not retry it |
| `node:sqlite` | **Synchronous** (R10, experimental). Every write blocks its caller |
| Queue lookahead | **Context-dependent** — album/autoplay/radio expose 7–20; **the DJ exposes 0, always** |
| Audio vs reported boundary | DJ **+0.9 to +2.2 s**, radio −0.3…+0.5 s, album −0.4…−0.5 s |

### ⚠️ A hazard found while building the migration-007 prerequisite, 2026-09-27

**SQLite's locks do not cross the Rancher Desktop bind mount.** With the container up, healthy and
recording, a host process acquired `BEGIN EXCLUSIVE` on `data/history.db`. So
`reclassify-unobserved-tails.mjs`'s guard **cannot see the container** and returns green exactly when
the danger is present — which mechanically explains the U4 corruption incident.

**It bears on this stage** because U5 adds the first component that writes *outside* the database
(`automation-state.json` — ⚠️ **path changed to `/state/` by Infrastructure Q1, 2026-10-01**, not
`config/` as written here) and the first that writes *outside the machine* (`POST` to Spotify).
⚠️ **The pattern to extract is not about SQLite**: it is that **a guard which cannot observe the
condition it guards is worse than no guard**, because it produces a green light. That is a candidate
**P-\*** in its own right — see Q4 and the P-list below.

---

## 3. What this stage must produce

| Deliverable | Content |
|---|---|
| `nfr-design/nfr-design-patterns.md` | **P-27 …** — the patterns, each tied to an NFR or a BR |
| `nfr-design/logical-components.md` | **LC-23 …** — components, purity marks, and the exit-criteria map |
| Property obligations | **PBT-34 …**, including at least one **positive control** per safety property |

⚠️ **Every safety property needs a positive control, and this is not optional garnish.** PBT-22 passed
trivially against counts that were always zero; the backup verifier built today needed a `--self-test`
against a known-corrupt file for the same reason. **A refusal that is never exercised is
indistinguishable from a refusal that cannot fire.** Six refusal points means six properties that must
each be shown to *both* refuse and permit.

---

## 4. Plan

- [x] Settle **Q1** — where the `SkipAttempt` queue lives, and what a restart does to it
- [x] Settle **Q2** — what drains the queue, and the latency budget from decision to `POST`
- [x] Settle **Q3** — NFR-17 (429 / 401) against BR-43.5's *never retry*. ⚠️ **They conflict**
- [x] Settle **Q4** — the replacement phase guard, and what the playback client may expose
- [x] Settle **Q5** — NFR-13 when the `automation-state.json` **write** fails
- [x] Settle **Q6** — surfacing the BR-35.2 interaction above, before a broad rule is armed
- [x] Settle **Q7** — NFR-15: how pre-warming *yields* to label resolution (BR-39.5)
- [x] Settle **Q8** — NFR-24: what diagnostics must report, and the `config/` writability probe
- [x] Settle **Q9** — closing the `scripts/` blind spot: execute every entry point in CI, and
      `knip` for unused exports. ⚠️ **Three findings in eight days** came through this gap. The
      wider remedy is backlog **W-6**
- [x] ✅ **All nine answered 2026-09-30, every one as recommended.** Authoritative reading: **§5.1**
- [x] ✅ **Define the M1–M4 upstream metrics** (§5.2) — Q8's addendum. Specified as **LC-28
      `upstreamMetrics`** (impure shell, pure aggregation taking `now`), property **PBT-50**, pattern
      **P-37**. ⚠️ **M2 counts, never just logs**: `webApiClient.ts:125` currently throws the
      `Retry-After` away inside a message string, so the app cannot say whether it has ever been
      rate-limited. ⚠️ **M4 outgrew its diagnostics brief** — it is the *positive liveness signal*
      that distinguishes *polling and hearing silence* from *not polling*, which the 2026-09-30
      outage lacked for ~13 hours. It is load-bearing for **W-7** and for outage detection, not
      merely for Q8
- [x] ✅ Write `nfr-design-patterns.md` — **P-27 … P-37** (written 2026-10-01)
- [x] ✅ Write `logical-components.md` — **LC-23 … LC-31** (written 2026-10-01)
- [x] ✅ Define **PBT-34 … PBT-50**, with **PBT-34a** as the positive control and **PBT-41** as
      the only property that can catch the P-27 defect (written 2026-10-01)
- [ ] ⚠️ **Pre-register the Q6 safety thresholds in writing before any rule is armed** (carried from
      the FD plan; still open)

---

## 5. Questions

### Question 1 — Where does the `SkipAttempt` queue live, and what does a restart do to it?

BR-42.2 says `SkipExecutor.execute` **enqueues a `SkipAttempt` and returns**; BR-42.3 says a separate
async path drains it. Migration 007 creates a `skip_attempt` table. **Whether that table *is* the queue
is not settled**, and the two readings behave very differently across a restart.

| | Option | On restart | Cost |
|---|---|---|---|
| **A** | **In-memory queue only.** The table is the *audit record*, written when an attempt reaches a terminal state | Queued attempts **vanish** — nothing fires | A queued-but-never-drained attempt leaves no trace at all |
| **B** | **The table IS the queue.** `state = 'queued'` rows are re-read at startup | Attempts **survive** and could fire against a play that ended hours ago | BR-42.5 catches it (`play-closed`), but the durability buys nothing we want |
| **C** | ⭐ **In-memory queue, every transition written through.** The row is created `queued` and updated to its terminal state; at startup any surviving `queued` row is **closed as `refused: play-closed`** | Attempts do not fire, **and the record says why** | One extra write per attempt |

⚠️ **B is the trap, and it is the attractive-sounding one.** "Durable queue" reads as robustness, but
the thing being queued is *an action on a live audio device*. A skip that survives a restart is a skip
that fires into whatever happens to be playing when the app comes back — the FR-40 loop hazard with a
restart in the middle. **Durability is a cost here, not a benefit.**

⚠️ **A's weakness is the one this project keeps finding.** A queued attempt that vanishes leaves
`firedAt` null and no row at all — which is *"why is this absent"* answered by absence, exactly what
`refusedReason` and U4's `playLink` exist to prevent. **An attempt that never fired because the app
restarted must be distinguishable from one that never existed.**

**Recommendation: C.** It fails closed like A, and it is honest like B claims to be. The startup sweep
is three lines and it converts an invisible loss into a recorded refusal.

[Answer]:
C
---

### Question 2 — What drains the queue, and what is the latency budget?

BR-43.1 fires **on the reported track boundary**, no lag guard. But the decision itself is taken up to
`ENRICHMENT_WAIT_MS = 10 000` after the play starts, so the listener has already heard ~10 s. Whatever
the drain adds comes on top.

| | Option | Added latency | Risk |
|---|---|---|---|
| **A** | Drain on the **existing 3 s tick** | 0–3 s (mean 1.5 s) | Simplest — one timer, one code path. Worst case 13 s of an unwanted track |
| **B** | Its own **faster timer** (e.g. 500 ms) | ≤0.5 s | A second timer polling a usually-empty queue; more wakeups for a rare event |
| **C** | ⭐ **Schedule the drain when something is enqueued** (`setImmediate`/microtask), with the **3 s tick as a backstop** | ~0 | Two entry points to one drain function |

⚠️ **C must not become the thing BR-42 rejected.** BR-42's reasoning was that making `execute` async
puts *an unawaited promise inside a timer*, where a swallowed rejection becomes a skip that silently
never happened. **Scheduling a drain is not the same as awaiting one** — `execute` stays synchronous
and returns the `evaluationId`, and the drain is a separate task with its own error handling. But the
distinction has to be built deliberately: **the drain function must catch its own rejections and record
them on the attempt row**, never let them escape.

⚠️ **The tick backstop is load-bearing, not belt-and-braces.** It is what makes an attempt whose
scheduled drain was lost (an exception before the schedule, a process pause) eventually reach a terminal
state instead of sitting `queued` for ever. **One drain function, two entry points** — the same shape as
U4's *"one admission rule, invoked twice, never written twice"*, which exists because the copies diverged
and the WebSocket returned `403` while every page load returned `200`.

**Recommendation: C**, with the explicit constraint that both entry points call **the same** drain and
that it never throws.

[Answer]:
C
---

### Question 3 — NFR-17 says retry; BR-43.5 says never retry. ⚠️ They conflict, and it matters

**NFR-17**: *handle Spotify 429 with `Retry-After`, and 401 with a single token-refresh retry.*
**BR-43.5**: an unconfirmed skip is **failed — surfaced, never retried.**
**BR-36.4**: one attempt per play, *"a failed attempt does not earn a retry."*

These cannot all be applied literally. The resolution turns on a distinction the rules do not yet draw:
**did the request reach the player?**

| | Failure | Did anything happen? | Re-issuing is… |
|---|---|---|---|
| **401** — expired token | **No.** Rejected at the edge | *completing* the first attempt, not a second one |
| **429** — rate limited | **No.** Rejected at the edge | but `Retry-After` may be 30 s, by which time **the track has changed** |
| **5xx / network** | ⚠️ **Unknown.** It may have landed | a genuine second skip |
| **2xx, unconfirmed** | ⚠️ Unknown — BR-43.3's check did not hold | a genuine second skip |

| | Option |
|---|---|
| **A** | Apply NFR-17 as written — refresh on 401, wait out 429, then re-issue |
| **B** | ⭐ **401 → one refresh-and-reissue** (the request provably never landed). **429 → refuse, do not wait**, with a new `RefusalReason`. **5xx / network / unconfirmed → failed, surfaced, never retried** |
| **C** | Never re-issue anything, including 401 — strictest reading of BR-43.5 |

⚠️ **A is wrong specifically because of `Retry-After`.** Honouring a 30 s wait and then firing
`POST /me/player/next` is *"skip whatever is playing in 30 seconds"* — not the action that was decided.
The FD never contemplated it because FR-48 was written about confirmation, not about transport.

⚠️ **C is tempting and costs a real capability.** A 401 is routine — the container refreshed its token
at 03:11 today. Refusing to re-issue after a token refresh would make skips fail for a reason that has
nothing to do with the skip, and `refusedReason` would record `token-expired` as though it were a
judgement.

⚠️ **B needs a new `RefusalReason` member and possibly two.** `domain-entities.md` §1 lists six;
`rate-limited` there means **BR-35.2's own hourly safety limit**, which is a completely different fact
from *Spotify returned 429*. **Conflating them would make the runaway halt's evidence unreadable.**
Suggest `upstream-rate-limited` as a distinct member.

**Recommendation: B.** And record the general rule it rests on, because it will recur:
**a failure at the edge that provably did not reach the device is not an attempt.** ⚠️ Anything whose
landing is *unknown* is treated as having landed — `null` is unknown, and unknown is not `false`.

[Answer]:
B
---

### Question 4 — What replaces the phase guard, and what may the playback client expose?

U4's guard was `src/playback/` **not existing**. U5 ends that, so the boundary must become a property of
the code rather than of the file tree.

Two separable decisions:

**(i) The import-graph guard.**

| | Option |
|---|---|
| **A** | ⭐ A structural test: **only `src/playback/` may import the Spotify write client, and only `SkipExecutor` may import `src/playback/`.** `src/rules/` reaches it solely through the injected `DecisionExecutor` |
| **B** | Rely on review and on `LoggingExecutor.length === 1` alone |

**(ii) The client's surface — and this is the safety-relevant half.**

| | Option |
|---|---|
| **A** | ⭐ **Exactly one method: `skipToNext()`.** No pause, no seek, no volume, no transfer-playback. Pinned structurally, so adding a second method is a deliberate, visible act |
| **B** | A general `PlayerClient` wrapping the player endpoints, with U5 using one of them |

⚠️ **B is how a skip-only unit acquires the ability to pause the user's music.** Nothing in U5 needs
it, no requirement asks for it, and an unused capability on a live device is indistinguishable from an
intended one the day someone calls it. The `LoggingExecutor` precedent is explicit: BR-30 forbids an
*injected-but-uncalled* playback collaborator because *"an injected-but-uncalled one reduces the
boundary to one line of restraint."* **The same argument applies to an unused method.**

⚠️ **And a structural test walks modules, not methods** — `recordSuccessorLag` and
`updateSkipAttribution` had zero callers for their entire lives inside a heavily-executed file, and
`test/noOrphanModules.test.ts` was satisfied throughout. So the one-method rule must be asserted **on
the client's own shape**, e.g. its exported surface, not inferred from the orphan check.

**Recommendation: A and A.** Plus a candidate pattern: ⚠️ **a guard must be able to observe the
condition it guards** — the lesson from today's lock-guard defect, which returned green precisely when
the danger was present.

[Answer]:
A and A
---

### Question 5 — NFR-13: what happens when the `automation-state.json` WRITE fails?

BR-34.5 settles the **read**: missing, unparseable or partial ⇒ automation **off**, fails closed. The
**write** is unsettled, and `config/` is `:ro` today (`compose.yaml:202`), so **failure is the expected
case until the mount changes** (BR-34.4).

The question is what the *in-memory* state does when the write fails.

| | Option | User turns automation OFF, write fails | User turns automation ON, write fails |
|---|---|---|---|
| **A** | Symmetric — revert in memory, surface the error | ⚠️ **stays ON** | stays off |
| **B** | Symmetric — keep in memory, surface the error | goes off | ⚠️ **goes ON**, and a restart silently disarms |
| **C** | ⭐ **Asymmetric.** A write failure **never blocks disarming** and **always blocks arming** | goes off ✅ | stays off ✅ |

⚠️ **A is the dangerous one and it looks like the careful one.** "Don't change state if you couldn't
persist it" is ordinary transactional hygiene — and applied to a kill switch it means **the user
pressed stop and the system kept going**, then reported an error about a file. FR-38's *"immediately"*
is about the action point, and BR-34.7 says no skip is issued after the switch is thrown; a revert
breaks that for a reason the user cannot act on.

⚠️ **B's failure is the one `frontend-components.md` §2 already names** — *"a kill switch that works in
the UI and does not persist"*, the worst failure mode this particular control could have.

**Recommendation: C**, and note it is **the same asymmetry as BR-37.5/37.6** (a re-evaluation may cancel
a skip, never fire one). The direction that errs toward *not acting* wins in both. ⚠️ FC-U5-2 already
requires the button to reflect **what was read back from disk** rather than optimistic client state —
C is what makes that honest rather than merely cautious, because disarming is reflected even when the
write failed.

[Answer]:
C
---

### Question 6 — A broad rule will trip the runaway halt. How is that surfaced, and when?

From §2: at the peak observed rate of **27 plays/hour**, BR-35.2's 10-per-hour limit trips on any rule
matching more than **37%** of plays; at the median 16/hour, more than **62%**.

BR-35.6 clears the halt on **explicit acknowledgement only**. So a legitimately broad rule produces:
halt → acknowledge → halt again, indefinitely. That is the system working as designed and it will read
as a bug.

| | Option |
|---|---|
| **A** | Nothing extra. The halt explains itself when it fires (BR-35.8) |
| **B** | ⭐ **Show the projected hourly rate at arming time**, beside the advisory back-test: *"this rule matched 41% of the last 200 plays; at your peak rate that is ~11 rule-skips/hour and would trip the 10/hour halt"* |
| **C** | Refuse to arm a rule whose projected rate exceeds the limit |

⚠️ **C changes a safety limit into a gate on authoring**, which BR-40.1/40.2 deliberately did not do —
the back-test *"carries no threshold and cannot block or permit arming"*. A projected-rate gate would
be the numeric threshold Q1 rejected, wearing different clothes.

⚠️ **A's cost is specific**: the user learns the interaction by having automation halt mid-listening,
which is the moment least suited to understanding a rolling-hour window. And because the thresholds are
**pre-registered**, the correct response is *"this rule is too broad"* — a conclusion far easier to
reach before arming than after a halt.

**Recommendation: B.** It is the same instrument as BR-40.3's *show the back-test with its n*: give the
number and let the human decide. ⚠️ **It must be labelled a projection, not a prediction** — it is
computed from past plays under a rule that was not armed then, which is exactly the back-test's own
limitation and must not be presented more confidently than the back-test is.

[Answer]:
B
---

### Question 7 — NFR-15: how does pre-warming *yield* to label resolution?

BR-39.5: pre-warming *"may never starve the 1 req/sec MusicBrainz queue that the current track's own
verdict depends on."* **"Yields" is not yet a mechanism.**

⚠️ Note first that pre-warming's **queue** lookahead is a *Spotify* call, but resolving a pre-warmed
track's label is a **MusicBrainz** call, and that is the contended resource. NFR-15 is 1 req/sec and
**6 of 19 tracks took a `503` at 1200 ms spacing** — the retry is load-bearing, and each retry goes
back through the queue, so it spends time, never rate.

| | Option |
|---|---|
| **A** | **Single priority queue** — live-play requests jump ahead of pre-warm requests |
| **B** | **Separate budget** — pre-warm may use at most N requests/minute |
| **C** | ⭐ **Pre-warm only when the queue is idle**, and abandon a pre-warm the moment a live request arrives |

⚠️ **A is the textbook answer and it does not satisfy BR-39.5 as written.** A priority queue means the
live request waits for the *in-flight* pre-warm request to finish — up to 1.2 s plus a `503` retry. It
starves nothing on average and delays the thing that matters every time. "Never starve" is a stronger
claim than "usually wins".

⚠️ **B's number would be invented.** There is no measurement to set N from, and a budget tuned by guess
is the kind of constant that later reads as though it were derived.

**Recommendation: C.** Idle-only is the one option that makes BR-39.5 true by construction rather than
on average, and it costs nothing we have evidence for: **the DJ exposes no queue at all**, so on 50–70%
of current listening there is nothing to pre-warm regardless. ⚠️ **But BR-39.7/39.8 forbid treating the
pre-warm path as second-class** — idle-only is a *scheduling* subordination, not a licence for weaker
error handling, logging or tests. The build-time check stands: neither path may have coverage the other
lacks.

[Answer]:
C
---

### Question 8 — NFR-24: what must diagnostics report, and is `config/` writability probed?

`diagnostics.ts` must stay authoritative as subsystems are added. U5 adds automation state, a halt
latch, a queue and an outbound write.

Proposed additions (⭐ = not obvious):

| Reported | Why |
|---|---|
| `globalAutomationEnabled`, and **where it was read from** | BR-34.1 — distinguishes *off because the user said so* from *off because the file was unreadable* (BR-34.5) |
| `runawayHalt` — present/absent, with `trigger` and `haltedAt` | BR-35.7 persists across restart; it must be visible without opening the UI |
| Queue depth, and the oldest `queued` attempt's age | ⭐ A queue that never drains is otherwise invisible — the `recordSuccessorLag` shape |
| Last attempt: state and `refusedReason` | BR-36.3 — refusals are recorded, so they must be readable |
| ⭐ **`config/` writability, probed actively at startup** | BR-34.4 |

⚠️ **The writability probe is the one that earns its place.** `config/` is `:ro` today and the failure
presents as *a kill switch that works in the UI and does not persist*. Discovering that at the moment
the user reaches for the kill switch is the worst possible time. A startup write-and-delete of a temp
file in `config/` answers it in advance — and it is a **probe, not an inference from `compose.yaml`**,
which is this project's standing rule and the reason six documented traps were caught.

⚠️ **It must not fail closed into refusing to start.** NFR-13 says degrade, never crash: an unwritable
`config/` means automation cannot be *armed* (BR-34.5's direction), not that the app stops recording.
**Recording is the irreplaceable function; automation is not.**

| | Option |
|---|---|
| **A** | ⭐ All five, with the writability probe at startup, surfaced in diagnostics and in the Rules pop-up |
| **B** | The first four; treat writability as a runtime error when a save is attempted |

**Recommendation: A.**

[Answer]:
A - and in addition we may need some metrics that let the dev (during live debug) check that the app is not abusing the external api's (spotify, musicbrainz). Ideally the app has a "light touch" on the vendor sites reflecting efficient design. I'd also like a little thought/research put into "can we determine what a reasonable app bandwidth/hit rate to external sites should be". 
---

### Question 9 — Closing the `scripts/` blind spot, which has now cost three findings in eight days

⚠️ **Added 2026-09-29**, from the user's question about why the suite keeps missing dead or broken
artefacts. The full diagnosis — five defect categories, what agent authorship amplifies, and four
deferred remedies — is backlog **W-6** in `requirements.md` §5.1. **Two of the six remedies were held
back from W-6 and belong here**, because they are cheap, they are guards rather than analysis, and
**they would have caught two of the last three findings.**

**The blind spot, stated precisely.** `test/noOrphanModules.test.ts` asserts reachability — but it
walks **`src/` only**, and it walks **modules, not methods**. So:

| Finding | Why the guard missed it |
|---|---|
| `recordSuccessorLag` / `updateSkipAttribution`, zero callers for their whole lives | Inside a **heavily-executed module**. Module-level reachability was satisfied |
| `npm run reclassify` unable to start for a **week** (`f864e4e` → 2026-09-29) | `scripts/` is **outside the walk entirely**. 891 tests stayed green |
| Ten backups with no restore path | Neither — a whole capability half-built, invisible to any reachability check |

⚠️ **`scripts/` now holds 19 files**, including the hypothesis-gate runner, the `played_at` repair,
the P-U5-1 probes and the new backup/restore pair. **Every one of them is untested, unlinted for dead
exports, and unexecuted by CI.** They are also the tools most likely to be reached for in an
incident — which is the worst possible time to discover one does not start.

**(i) Execute every entry point in CI.**

| | Option |
|---|---|
| **A** | ⭐ **Run each script's existing safe mode in CI** — dry-run / `--verify-only` / `--self-test`. Adopt the convention that every script has a no-op mode, and loop over them |
| **B** | Static import-resolution check only |
| **C** | Nothing — rely on the script being run by hand |

⚠️ **B is not sufficient and it is worth knowing why**, because it is the obvious cheap answer.
`node --check` **would not have caught the reclassify breakage**: a missing named export is a
*link-time* failure, not a parse error. The module has to actually be evaluated. ⚠️ And evaluating it
is only safe for scripts that guard their `main()` — `backup-history.mjs` and `restore-history.mjs`
do (`import.meta.url === process.argv[1]`), **`reclassify-unobserved-tails.mjs` does not**, and
importing it would run it. So the convention has to be *invoke the safe mode*, not *import the file*.

**Recommendation: A**, and treat "has a safe mode" as a requirement of adding a script. ⚠️ `--apply`
paths stay out of CI — several of these are writers, and CI is not a place to discover that.

**(ii) `knip` (or `ts-prune`) over `src/` AND `scripts/`.**

Finds unused **files, exports and dependencies**. This is the method-level half the orphan check
structurally cannot do, and it is the direct remedy for the `recordSuccessorLag` class.

⚠️ **Expect a first run to be noisy**, and expect some of that noise to be real. `ALLOWED_ORPHANS`
already carries four deliberate entries with reasons — the same discipline applies: **an ignore entry
is a decision, not a formality.**

| | Option |
|---|---|
| **A** | ⭐ Add it, run in CI, seed the ignore list from the first run **with a reason per entry** |
| **B** | Add it as a local-only command, not gating CI |

**Recommendation: A.** ⚠️ **B is how this becomes the eleventh thing nobody runs** — which is,
precisely, the defect under discussion.

**Scope note**: these two are **guards**, not the analysis. Mutation testing, BR-derived tests, the
negative-control convention and container-parity probes are **W-6** and are deliberately *not* in U5
— W-6.2 in particular wants BR-33…BR-43 backed by shipped code, which is the end of this unit.

[Answer]:
A
---

## 5.1 Settled — the specification the NFR deliverables will be written from

All nine answered **2026-09-30**, every one as recommended. This table is the authoritative reading;
§5 keeps the reasoning above each.

| Q | Settled |
|---|---|
| **1** | **(C)** In-memory queue, **every transition written through** to `skip_attempt`. A surviving `queued` row at startup is closed as **`refused: play-closed`** — fails closed *and* leaves a record. ⚠️ A durable queue was rejected: a skip that survives a restart fires into whatever is playing when the app returns |
| **2** | **(C)** Drain **scheduled on enqueue**, with the 3 s tick as a **backstop**. ⚠️ `execute` stays synchronous (BR-42.1); the drain **catches its own rejections** and records them on the attempt row. **One drain function, two entry points** |
| **3** | **(B)** **401 → one refresh-and-reissue** (the request provably never landed). **429 → refuse, do not wait** — honouring a 30 s `Retry-After` would mean *"skip whatever is playing in 30 seconds"*. **5xx / network / unconfirmed → failed, surfaced, never retried.** ⚠️ Needs a **new `RefusalReason`: `upstream-rate-limited`**, distinct from BR-35.2's own hourly limit, or the runaway halt's evidence becomes unreadable |
| **4** | **(A and A)** ① Structural import-graph guard: only `src/playback/` imports the Spotify write client, only `SkipExecutor` imports `src/playback/`. ② The client exposes **exactly one method, `skipToNext()`** — no pause, seek, volume or transfer. ⚠️ Asserted on the client's **exported shape**, because a structural test walks modules, not methods |
| **5** | **(C)** **Asymmetric.** A write failure **never blocks disarming** and **always blocks arming**. ⚠️ The symmetric "don't change state if you couldn't persist it" was rejected: applied to a kill switch it means *the user pressed stop and the system kept going* |
| **6** | **(B)** Show the **projected hourly rate at arming time**, beside the advisory back-test. ⚠️ Labelled a **projection, not a prediction** — computed from plays under a rule that was not armed then, which is the back-test's own limitation |
| **7** | **(C)** Pre-warm **only when the MusicBrainz queue is idle**, abandoning on a live request. ⚠️ Makes BR-39.5 true **by construction** rather than on average; a priority queue only wins *usually*. Scheduling subordination only — BR-39.7 still forbids weaker tests or error handling |
| **8** | **(A)** All five diagnostics additions, including the **`config/` writability probe at startup**. ⚠️ **Plus a new requirement from the user — see §5.2** |
| **9** | **(A and A)** Run each script's **safe mode** in CI (not `node --check`, and not by importing), and **`knip`** over `src/` **and** `scripts/`, CI-gating, ignore list seeded **with a reason per entry** |

---

## 5.2 Q8's addendum — upstream footprint, measured

> **The user's addition (2026-09-30)**: *"we may need some metrics that let the dev (during live
> debug) check that the app is not abusing the external api's (spotify, musicbrainz). Ideally the app
> has a 'light touch' on the vendor sites reflecting efficient design. I'd also like a little
> thought/research put into 'can we determine what a reasonable app bandwidth/hit rate to external
> sites should be'."*

### ⚠️ The two halves are the same item, and that is the finding

*What is a reasonable rate?* cannot be answered today, because **nothing counts the requests**.
`webApiClient.ts:125` throws on a 429 with the `Retry-After` **in the message string** and does not
record it, so there is no history: the app has no idea whether it has ever been rate-limited.
⚠️ **Zero 429s in the current container log proves nothing** — the container was recreated 30 minutes
ago for the backup, so the window is 30 minutes. **The metric is the prerequisite for the research,
not a parallel task.**

### Measured footprint — read from the code, 2026-09-30

Steady state, per hour, with `POLL_INTERVAL_MS: 3000`:

| Upstream call | Rate/hr | Share |
|---|---|---|
| **MCP `getNowPlaying` poll** @ 3 s | **1,200** | **98.4%** |
| `GET /tracks/{id}` — enrichment, **once per distinct track** | ≤16 (median play rate) | 1.3% |
| Token refresh | ~1 | — |
| `GET /me/tracks` — liked set, 663 tracks ÷ 50 = 14 requests, startup + 6-hourly | ~2.3 amortised | — |
| `GET /me/following` · `recently-played` | <1 | — |
| **Spotify total** | **≈1,220/hr · ≈29,300/day** | |
| **MusicBrainz** | strictly ≤3,600/hr by the queue; **actual low and bursty** (`0 queued · idle`) | |

✅ **Everything except the poll is already a light touch, and the Development Mode restrictions are
why.** The `/contains` family returning 403 forced *fetch the set once, cache it, resolve locally* —
so follow and liked status cost **zero** per-track requests, and enrichment is **one** call per
*distinct* track. The sandbox accidentally produced the efficient design.

### ⚠️ The poll is 98% of the footprint, and it does not stop when nothing is playing

**28,800 polls/day, continuously, whether or not there is any music.** This is not hypothetical — it
was observed directly on 2026-09-29: no play was recorded for **~2.5 days** while the container ran
healthy, which is roughly **86,000 requests spent learning "nothing is playing" 86,000 times.**

⚠️ **This is the *efficiency* question, and it is independent of where Spotify's ceiling is.** "Light
touch" as the user framed it is requests per unit of information, not merely staying under a limit —
and by that measure the idle poll is the whole problem and the rest is already excellent.

### What is knowable about a "reasonable" rate — and what is not

| Vendor | Published limit? | Position |
|---|---|---|
| **MusicBrainz** | ✅ **Yes** — 1 req/sec sustained, with an identifying `User-Agent` | Compliant (NFR-15, NFR-14). ⚠️ **And already probed tighter than the published floor**: at 1200 ms spacing **6 of 19 tracks still took a 503**, so the real safe rate is *below* the documented one. The bounded retry is load-bearing |
| **Spotify** | ❌ **No numeric limit is published.** Documented only as *calculated in rolling 30-second windows*, and differing between Development and Extended Quota modes | At 3 s the app sits at **10 requests per 30-second window** — the right unit, because it is the window Spotify actually uses. ⚠️ **Whether that is 10% or 90% of the ceiling is unknown and not derivable from documentation** |

⚠️ **So the honest answer to "can we determine a reasonable rate" is: for MusicBrainz yes and we
already have; for Spotify no — not from documents.** The only evidence that exists is observed 429s
and their `Retry-After` values, which is exactly what is not being recorded. ⚠️ **And absence of a
429 would bound nothing except "below the limit"** — the same logic as the hypothesis gate's CI ruling
out ±8pp *and nothing smaller*. Do not let a clean counter be read as headroom.

⚠️ **Do not resolve this by reading Spotify's docs harder.** This project has drawn six wrong
conclusions from those docs, every one caught by a probe.

### The work this creates

**In U5** (cheap, read-only, and it is what Q8 = A already asked for):

| | Metric | Why |
|---|---|---|
| **M1** | Requests per upstream, as a **rolling 30-second window** and per hour | 30 s is Spotify's own window; an hourly average hides a burst |
| **M2** | **429 / 503 count, with the last `Retry-After` and when** — persisted, not thrown away in a message string | ⚠️ The only evidence that can ever answer the rate question |
| **M3** | **Requests per play** — the efficiency ratio | The *"light touch"* measure. Compliance and efficiency are different questions |
| **M4** | Share of polls returning **nothing playing** | Makes the idle waste visible rather than inferable |

⚠️ **M2 must count, never just log.** A failure written down and never aggregated is the
`successor_lag_ms` shape: a field that is structurally empty reads as *this never happens*.

**NOT in U5 — raised as a candidate for the backlog**: *adaptive poll backoff when nothing is
playing*, the single change that would cut ~98% of the footprint.

⚠️ **It is deliberately out of scope here**, because it changes the behaviour of the **recording
instrument** — the one function whose output cannot be regenerated — and U5 is the unit that was
sequenced for risk containment. It needs its own analysis, specifically:

- A longer interval **during playback** would thin `PlayObserver`'s trail, so backoff may apply
  **only when nothing is playing**.
- ⚠️ Returning from idle costs precision on the **first** play: `startedAt` would be late by up to the
  backoff interval. **Classifier v2 is probably robust to this** — it thresholds
  `durationMs − maxProgressMs` and a max-progress rail, both taken from Spotify's own `progress_ms`
  rather than from trail density, and dedup keys on the **end**. ⚠️ **"Probably" is doing real work in
  that sentence and it must be probed, not assumed.**
- ⚠️ It would also lengthen the FR-34 blind spot (plays ending before `ENRICHMENT_WAIT_MS`).

---

## 6. Candidate patterns, for `nfr-design-patterns.md`

Recorded here so the numbering is visible before the deliverable is written. Each is tied to a rule or a
measurement, not to taste.

| # | Pattern | Source |
|---|---|---|
| **P-27** | **The action point is the only place a safety predicate is evaluated** | BR-33.5, BR-42.4 |
| **P-28** | **Refusal is a recorded outcome, never an absence** — six causes, four correct, two defects | BR-36.3, U4's `playLink` |
| **P-29** | **Queue the action; keep the executor synchronous** | BR-42 |
| **P-30** | **A failure at the edge that provably did not reach the device is not an attempt**; unknown landing counts as landed | Q3 |
| **P-31** | **Asymmetric safety**: the direction that errs toward not acting always wins | BR-37.5/37.6, Q5 |
| **P-32** | ⭐ **A guard must be able to observe the condition it guards** | the lock-guard defect, 2026-09-27 |
| **P-33** | ⭐ **A capability not required is a capability not exposed** — one method on the playback client | BR-30, Q4 |
| **P-34** | **No fixed timing offset may be assumed** — the DJ's audio lag changes *sign* | BR-43.6, P-U5-1 |
| **P-35** | **Subordinate by scheduling, not by quality** — pre-warm yields; its tests do not | BR-39.5/39.7 |
| **P-36** | ⭐ **A tool outside `src/` is outside every guard** — the orphan check walks `src/` and walks **modules, not methods**; coverage cannot see a file no test imports | three instances in eight days · **Q9** · backlog **W-6** |
| **P-37** | ⭐ **A limit you cannot see is a limit you cannot respect** — count and persist 429/503 with their `Retry-After`; a thrown message string is not a measurement | §5.2 · Q8 addendum |

⚠️ **P-32, P-33 and P-36 came from defects rather than from design**, and they are the ones most
likely to be dropped as obvious. They are not obvious: P-32 shipped as a false guard that **outlived the
incident it failed to prevent** (and has since earned a second citation), P-33 is the reason BR-30 exists
at all, and P-36 has **three instances in eight days** — `recordSuccessorLag` dead inside a live file,
ten backups with no restore path, and `npm run reclassify` unable to start for a week while 891 tests
stayed green.

⚠️ **P-36 bears directly on this unit.** U5 adds `src/playback/`, whose guard is a *structural test*
(Q4). If that test lives where the orphan check cannot reach it, or asserts on modules rather than the
client's exported shape, it is P-32 and P-36 at once.

---

## 7. Out of scope for U5 NFR Design

| | Why |
|---|---|
| Replacing `node:sqlite` | R10 is mitigated by NFR-10's interface. Nothing in U5 pressures it |
| A general player-control client | **Q4(ii)** — deliberately refused, not deferred |
| Re-running the hypothesis gate | **BR-11.7 — the confirmatory run is spent.** Not reopened by 31 skips rather than 22 |
| Tuning BR-35's thresholds | **Pre-registered safety limits.** Q6 surfaces the interaction; it does not move the numbers |
| W-5 full-inventory backup | Backlog. The **minimal** backup + verified restore is built, and the `before-migration-007` backup is **taken and verified** (2026-09-29) |
| **W-6** — mutation testing, BR-derived tests, the negative-control convention, container-parity probes | Backlog, triggered at the **end of U5**. ⚠️ **Q9 deliberately takes only the two cheap guards** from that analysis; the rest is analysis rather than guardrail, and **W-6.2 wants BR-33…BR-43 backed by shipped code** |
| Fixing `reclassify-unobserved-tails.mjs`'s blind guard | ✅ **FIXED 2026-09-29** — delegates to `assertNobodyElseHoldsIt`, verified to refuse with the container up. ⚠️ And the script **could not start at all** since `f864e4e`; see P-36 |

---

## 8. Standing hazards

- ⚠️ **`docker compose down` before anything that writes `history.db`** — and note the script-level
  lock guard **cannot see the container** (probed 2026-09-27). `docker compose down` is the only real
  protection. A maintenance script is a writer.
- ⚠️ **Take the `before-migration-007` backup with the container down**:
  `npm run db:backup -- --label before-migration-007`, then
  `npm run db:restore -- <dir> --verify-only`. **Verify it the day you take it.**
- **The app is `http://localhost:3010`.** `localhost:3000` is a different project.
- **Check exit codes directly** — `npm run typecheck | tail && echo OK` reported success while
  typecheck was failing. The pipe's exit code is not the command's.
- **`PlayObserver` consumes `tick`, never `change`.** `change` is signature-suppressed and the
  signature excludes progress.
- ⚠️ **`test/noOrphanModules.test.ts` walks modules, not methods.** Two dead writers hid inside a live
  file for their entire lives. Q4(ii)'s one-method rule must be asserted on the client's shape.
