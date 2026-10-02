# NFR Design Patterns — U5: Automated Skipping

**Date**: 2026-10-01 · **Stage**: CONSTRUCTION — NFR Design, U5
**Answers**: Q1 **C** · Q2 **C** · Q3 **B** · Q4 **A and A** · Q5 **C** · Q6 **B** · Q7 **C** ·
Q8 **A + a new requirement** · Q9 **A and A** — all nine as recommended.
Authoritative reading: [`../../plans/u5-nfr-design-plan.md`](../../plans/u5-nfr-design-plan.md) §5.1.
**Numbering** continues from U4, which ended at **P-26**.

> ### The pattern that governs the other patterns
>
> **U4 was derived data hanging off an irreplaceable one, and asked: when this fails, what does it
> take down?** U5 asks a different question, because it is the first unit that *acts*:
>
> > **When this is wrong, what cannot be undone?**
>
> A skip that should have happened and did not is recoverable — the listener presses a button. A skip
> that should not have happened is **not recoverable at all**. Every pattern below is shaped by that
> asymmetry, and where a choice existed it was taken restrictively on purpose rather than out of
> habit.

---

## P-27: The safety predicate is evaluated at the action point, and nowhere else *(Q1, Q2)*

`LoggingExecutor.ts:88` hardcodes `dryRun: true` today, because in U4 everything was dry-run. U5
replaces that constant with BR-33.2's computed value:

```
live(rule) := globalAutomationEnabled
              AND NOT runawayHalted
              AND rule.enabled
              AND NOT rule.dryRun
```

⚠️ **The predicate must be evaluated when the action fires, not when the decision was taken.** A
decision is taken up to `ENRICHMENT_WAIT_MS` = 10 s before anything could act on it, and FR-38
requires that *no skip is issued after the switch is thrown*. Checking at decision time permits a
skip to fire from a decision taken while automation was still on — which is precisely the guarantee
the kill switch exists to make.

```
decision taken ──10s──> action point ──> POST
                        ▲
                   ALL SIX refusals are checked HERE
```

> ⚠️ **This is why the action is queued rather than awaited**, and the reasoning is worth keeping
> because *"just make `execute` async"* is the obvious move. It was rejected three times over: it
> changes `LoggingExecutor`'s signature to serve a collaborator it does not have (**BR-30** exists to
> prevent exactly that), it puts an unawaited promise inside a **timer** — which is how a swallowed
> rejection becomes a skip that silently never happened — and **it puts the safety check in the wrong
> place.** Queueing makes the right place the only place.

---

## P-28: Refusal is a recorded outcome, never an absence *(Q1)*

Six refusal points, **four of them correct behaviour and two of them defect signals**:

| | Refusal | Correct, or a signal? |
|---|---|---|
| ① | `automation-off` | Correct — FR-47's default |
| ② | `runaway-halted` | Correct — the system protecting the listener |
| ③ | `rule-dry-run` | Correct — the arming gate working |
| ④ | `already-attempted` | Correct — BR-36's loop guard |
| ⑤ | `play-closed` | ⚠️ **Either.** Normal for a short play; a signal if frequent |
| ⑥ | `rate-limited` | ⚠️ **Probably a defect somewhere** — 10/hr is below the median *play* rate |

⚠️ **A `firedAt` of `null` cannot distinguish any of these**, so `refusedReason` is a first-class
field. This is U4's `playLink` lesson repeated at higher stakes: *why is this absent* must never be
inferred from the absence itself. **`null` means unknown and is never `false` or `0`.**

⚠️ **And a refusal that is never exercised is indistinguishable from one that cannot fire.** Each of
the six therefore needs a test that drives it, not merely a branch that could. See PBT-34…PBT-39.

---

## P-29: Queue the action; keep the executor synchronous *(Q1 = C, Q2 = C)*

```
SkipExecutor.execute()          SYNCHRONOUS, returns evaluationId     [BR-42.1]
   │  writes decision rows
   │  INSERT skip_attempt (state = 'queued')
   │  schedule drain
   ▼
drain()  ◄── scheduled on enqueue          ◄── 3 s tick (BACKSTOP)
   │
   └─ checks P-27's predicate, then acts
```

**The queue is in memory; every state transition is written through** to `skip_attempt`. ⚠️ **A
durable queue was rejected** — the thing being queued is an action on a live audio device, so an
attempt that survives a restart fires into whatever happens to be playing when the app returns.
**Durability is a cost here, not a benefit.**

⚠️ **But an attempt that vanishes silently is the P-28 failure in a new place.** So a surviving
`queued` row at startup is closed as **`refused: play-closed`** — fails closed *and* leaves a record.
An attempt that never fired because the app restarted must be distinguishable from one that never
existed.

⚠️ **One drain function, two entry points — never two drains.** This is the one-admission-rule lesson:
the WebSocket `403` happened because the local-access policy was *re-implemented* rather than reused,
the copies diverged, and **all 411 tests passed** while every page load returned `200` and every
handshake returned `403`. ⚠️ **The tick backstop is load-bearing, not belt-and-braces** — it is what
moves an attempt whose scheduled drain was lost to a terminal state instead of leaving it `queued`
for ever. ⚠️ **The drain must catch its own rejections and record them on the attempt row**, never let
one escape into the timer.

---

## P-30: A failure at the edge that provably did not reach the device is not an attempt *(Q3 = B)*

**NFR-17** says retry a 429 with `Retry-After` and a 401 with one token refresh. **BR-43.5** says an
unconfirmed skip is never retried. ⚠️ **Those conflict**, and the distinction that resolves them is
not in either rule: **did the request reach the player?**

| Failure | Reached the device? | Therefore |
|---|---|---|
| **401** expired token | **No** — rejected at the edge | re-issue once: it *completes* the first attempt |
| **429** rate limited | **No** — rejected at the edge | ⚠️ **refuse, do not wait** |
| **5xx / network** | ⚠️ **Unknown** — it may have landed | failed, surfaced, never retried |
| **2xx, unconfirmed** | ⚠️ Unknown — BR-43.3's check did not hold | failed, surfaced, never retried |

⚠️ **Honouring `Retry-After` is the trap, and it is what NFR-17 literally asks for.** Waiting 30 s and
then issuing `POST /me/player/next` is *"skip whatever is playing in 30 seconds"* — not the action that
was decided. FR-48 was written about **confirmation** and never contemplated **transport**.

⚠️ **Anything whose landing is unknown is treated as having landed.** `null` is unknown, and unknown is
not `false` — the project's rule, applied to an action instead of a field.

⚠️ **This needs a new `RefusalReason` member, `upstream-rate-limited`.** `rate-limited` already means
**BR-35.2's own hourly safety cap**, which is a completely different fact from *Spotify returned 429*.
**Conflating them would make the runaway halt's evidence unreadable** — the halt's whole purpose is to
say what tripped it.

---

## P-31: Asymmetric safety — the direction that errs toward not acting always wins *(Q5 = C, Q1, Q3)*

The same shape appears four times in U5, and it is one pattern rather than four decisions:

| | Permissive direction | Restrictive direction | Settled |
|---|---|---|---|
| Re-evaluation (BR-37.5/37.6) | may fire a skip an earlier pass declined | may **cancel** a pending skip | restrictive |
| Kill-switch write failure | revert in memory, stay armed | **disarm anyway**, refuse to arm | restrictive |
| Unknown landing (P-30) | assume it failed, retry | **assume it landed** | restrictive |
| Startup with a `queued` row | fire it | **refuse it** | restrictive |

⚠️ **The kill-switch case is the one where the restrictive answer looks wrong.** *"Don't change state
if you couldn't persist it"* is ordinary transactional hygiene — and applied to a kill switch it means
**the user pressed stop and the system kept going**, then reported a file error they cannot act on.
So: **a write failure never blocks disarming, and always blocks arming.**

⚠️ **`config/` is mounted `:ro` today** (`compose.yaml:202`) and U5 is the first unit that writes
there, so **failure is the expected case until the mount changes**. It will present as *a kill switch
that works in the UI and does not persist* — the worst failure mode this particular control could
have. The button therefore reflects **what was read back from disk**, never optimistic client state.
**Verify through the container, never on the host**, where the write succeeds and the bug is invisible.

---

## P-32: A guard must be able to observe the condition it guards

⚠️ **Discovered 2026-09-27 as a live defect, and it has since earned a second citation.**
`reclassify-unobserved-tails.mjs` carried an exclusive-lock guard whose docstring argued it was *"a
real test of the dangerous condition rather than a proxy for it."* It was **blind**: SQLite's locks do
not cross the Rancher Desktop bind mount, so with the container up, healthy and recording, a host
process acquired `BEGIN EXCLUSIVE` without resistance.

**It returned green exactly when the danger was present**, which mechanically explains the U4
corruption incident — and it **outlived the incident it had failed to prevent.**

> ⚠️ **Worse than no guard**, because it produced a green light and a reassuring comment. The family is
> U3's *"a guard computed the same way as the thing it guards is not a guard"* (`depthOf` recursing and
> overflowing while computing the limit's own input); this is the observational version.

**Applied to U5**, three guards must be checked against the thing they claim to observe:

| Guard | Must actually observe |
|---|---|
| The action-point predicate (P-27) | automation state **as of the drain**, re-read, not captured at decision time |
| The one-attempt-per-play guard (BR-36) | the **play row**, never `track_id` |
| The phase guard (P-33) | the **import graph and the client's exported shape**, not the file tree |

⚠️ **And it failed closed when fixed.** If `docker` cannot be reached the answer is *unknown*, and
unknown refuses. A guard that cannot tell is not permitted to say yes.

---

## P-33: A capability not required is a capability not exposed *(Q4 = A and A)*

U4's phase guard was **`src/playback/` does not exist**. U5 necessarily ends that, so the boundary
becomes two structural properties:

```
src/rules/     ──(DecisionExecutor interface only)──>  SkipExecutor
SkipExecutor   ──(sole importer)──────────────────────>  src/playback/
src/playback/  ──(sole importer)──────────────────────>  the Spotify write client
```

**And the client exposes exactly one method: `skipToNext()`.** No pause, no seek, no volume, no
transfer-playback.

⚠️ **A general `PlayerClient` is how a skip-only unit acquires the ability to pause the user's music.**
Nothing in U5 needs it and no requirement asks for it, and an unused capability against a live device
is indistinguishable from an intended one the day someone calls it. **BR-30 already makes this argument
about a constructor parameter** — *"an injected-but-uncalled one reduces the boundary to one line of
restraint"* — and it applies unchanged to a method.

⚠️ **Assert it on the client's exported shape, not via the orphan check.**
`test/noOrphanModules.test.ts` **walks modules, not methods**: `recordSuccessorLag` and
`updateSkipAttribution` had zero callers for their entire lives inside a heavily-executed file and the
check was satisfied throughout. **A second method would be invisible to it.**

✅ **`LoggingExecutor` remains a complete `DecisionExecutor` and is not taught to skip** (BR-33.6).
`LoggingExecutor.length === 1` must still pass when U5 is done.

---

## P-34: No fixed timing offset may be assumed anywhere *(BR-43.6, probe P-U5-1)*

The AI DJ has **at least three transition behaviours**, and nothing in the API predicts which is
coming:

| type | n | tail (median) | audio lag |
|---|---|---|---|
| hard-cut | 3 | 8.0 s | +0.9 s |
| crossfade | 3 | 25.1 s | +2.0 s |
| **dj-talk** | 2 | 1.6 s | **−6.9 s** |

⚠️ **`dj-talk`'s lag is negative, so even the *sign* varies.** Any threshold, guard or delay assuming a
constant offset is wrong on at least one type — which is why BR-43.1 **compensates for nothing** rather
than compensating by an average, and why BR-43.4's ~3 s grace is **a tolerance, never a compensation**.

✅ **The regime is discriminated by the queue, not by `context_type`** — the DJ and a radio station are
both `type: playlist` sharing the `37i9dQZF1E` prefix. **Pre-determined** contexts expose a queue and
transition cleanly; **produced-live** ones expose nothing. So **FR-36's runtime queue probe is also the
transition-regime probe** and U5 needs no new field for it.

> ⚠️ **This is R11's shape again**: the answer is *it depends*, and the field you would branch on does
> not exist. Both times the resolution was to **ask at runtime** rather than infer from metadata.

---

## P-35: Subordinate by scheduling, not by quality *(Q7 = C)*

BR-39.5: pre-warming *"may never starve the 1 req/sec MusicBrainz queue that the current track's own
verdict depends on."*

**Pre-warm only when the queue is idle, and abandon a pre-warm the moment a live request arrives.**

⚠️ **A priority queue is the textbook answer and does not satisfy the rule as written.** Priority means
the live request waits for the *in-flight* pre-warm to finish — up to 1.2 s plus a `503` retry — so it
starves nothing *on average* and delays the thing that matters *every time*. **"Never starve" is a
stronger claim than "usually wins."** Idle-only makes it true by construction.

⚠️ **Scheduling subordination is not a licence for a weaker implementation.** BR-39.7 requires the
FR-34/35 and FR-36 paths to have **equal** error handling, logging and tests; `requirements.md` still
calls FR-34/35 *the fallback* and **the word must not license weaker code**. Build-time check: neither
path has coverage the other lacks. ⚠️ **And the DJ path is not relabelled *primary*** despite being
50–70% of current listening — the mix is expected to change (BR-39.8).

---

## P-36: A tool outside `src/` is outside every guard *(Q9 = A and A)*

⚠️ **Three instances in eight days**, each invisible for the same reason:

| | Why nothing caught it |
|---|---|
| `recordSuccessorLag` / `updateSkipAttribution` — zero callers, ever | Inside a heavily-executed module. **Module-level** reachability satisfied |
| Ten backups with no restore path | No reachability check sees a half-built capability |
| **`npm run reclassify` dead for a week** (`f864e4e`) | **`scripts/` is outside the orphan walk entirely.** 891 tests green |

`test/noOrphanModules.test.ts` walks **`src/` only**, and **coverage cannot see a file no test
imports** — an untested file leaves the *denominator* rather than scoring zero, which is why the suite
once reported 98.96% while `server.ts` had no tests at all.

**Two guards close it:**

1. **Every entry point executes in CI** — each script's existing safe mode (dry-run / `--verify-only`
   / `--self-test`). ⚠️ **`node --check` is NOT sufficient**: the reclassify breakage was a missing
   *named export*, a link-time failure, so the module must actually evaluate. ⚠️ **And importing is
   not safe for every script** — `reclassify-unobserved-tails.mjs` does not guard its `main()`, so
   importing it would run it. **Invoke the safe mode; do not import the file.**
2. **`knip` over `src/` and `scripts/`** — unused files, exports and dependencies. The **method-level**
   half the orphan check structurally cannot do.

⚠️ **Expect a noisy first run, and expect some of the noise to be real.** `ALLOWED_ORPHANS` already
carries four deliberate entries with reasons; the same discipline applies — **an ignore entry is a
decision, not a formality.**

⚠️ **This bears on P-33 directly.** U5's replacement phase guard is a structural test. If it lives
where the orphan check cannot reach it, or asserts on modules rather than the client's exported shape,
it is P-32 and P-36 at once: a guard that cannot observe its condition, in a file nothing executes.

---

## P-37: A limit you cannot see is a limit you cannot respect *(Q8 addendum)*

⚠️ `webApiClient.ts:125` throws on a 429 with the `Retry-After` **inside a message string** and records
nothing. **So the app cannot say whether it has ever been rate-limited.**

Measured 2026-09-30 — the poll is **98.4%** of the Spotify footprint:

| Upstream call | Rate/hr | Share |
|---|---|---|
| MCP `getNowPlaying` @ 3 s | **1,200** | **98.4%** |
| `GET /tracks/{id}` — once per *distinct* track | ≤16 | 1.3% |
| Token refresh · liked set · followed · `recently-played` | ~4 | 0.3% |

✅ **Everything except the poll is already a light touch, and Development Mode is why** — the
`/contains` 403s forced *fetch the set once, cache it, resolve locally*, so follow and liked status cost
**zero** per-track requests. **The sandbox accidentally produced the efficient design.**

**Metrics M1–M4**: per-upstream rate in a **rolling 30-second window** *and* per hour (30 s is
Spotify's own window; an hourly mean hides a burst) · **429/503 counted and persisted** with the last
`Retry-After` · **requests per play** (the efficiency ratio) · **share of polls returning nothing
playing**.

⚠️ **M2 must count, never just log.** A failure written down and never aggregated is the
`successor_lag_ms` shape, where a structurally empty column reads as *this never happens*.

⚠️ **What is and is not knowable.** MusicBrainz publishes 1 req/sec and we comply — **and we have
already probed tighter than the published floor**: 6 of 19 tracks took a `503` at 1200 ms spacing.
**Spotify publishes no number at all**, only *"rolling 30-second windows"* differing by app mode. So
*"what is a reasonable rate"* is **not derivable from documentation**, and six wrong conclusions have
already come from those docs. ⚠️ **A clean 429 counter would bound nothing except "below the limit"** —
the hypothesis gate's CI ruled out ±8pp *and nothing smaller*. **Do not read zero 429s as headroom.**

⚠️ **M4 is load-bearing beyond efficiency.** It is the **positive liveness signal** that distinguishes
*polling and hearing silence* from *not polling* — the discriminator the 2026-09-30 outage lacked, when
recording stopped for ~13 hours and nothing noticed. **"No new rows" is ambiguous in both directions**,
demonstrated twice in two days. ⚠️ **But a monitor for that cannot live in the container**, because the
failure mode is *the container is not running*; M4 makes the state *visible*, it does not *alert*.

---

## Pattern-to-NFR coverage

| NFR | Discharged by |
|---|---|
| **NFR-10** repository interface | LC-24 — `SkipAttemptRepository`, interface + SQLite impl |
| **NFR-12** migrate, never drop | Migration **007**, additive only (BR-37.4) |
| **NFR-13** degrade, never crash | **P-31** — an unwritable `config/` blocks *arming*, never *recording* |
| **NFR-15** 1 req/sec MusicBrainz | **P-35** |
| **NFR-16** latency never delays the display | **P-29** — the drain is off the publish path |
| **NFR-17** 429 / 401 | **P-30** ⚠️ **amended, not merely applied** |
| **NFR-18** partial data, never fatal | **P-31**, BR-38.4 |
| **NFR-20/21** property tests, logged seed | PBT-34 … PBT-50, incl. **PBT-34a** (positive control) |
| **NFR-24** diagnostics authoritative | **P-37** + LC-28 — incl. the `config/` writability probe |
| **NFR-26** deterministic evaluation | Inherited — `RuleEngine` **untouched**, `outcomeClassifier` **untouched** |
| **NFR-01–04** local-only admission | Inherited. ⚠️ **No new WebSocket surface**; the kill-switch route sits in `api.ts` behind `decideAccess` |

⚠️ **NFR-17 is the only NFR this unit AMENDS rather than satisfies.** P-30 declines its
`Retry-After` clause for the skip path specifically, with the reason recorded. **An NFR quietly not
met is a defect; an NFR explicitly amended with a reason is a decision** — and this one needs to be
visible, because the next person to read NFR-17 will otherwise see a contradiction and "fix" it.

⚠️ **NFR-26 is discharged by *not touching* two modules.** `RuleEngine` must stay pure so back-tests
and live decisions use the same engine, and a `Date.now()` in `outcomeClassifier` would break FR-20
and FR-42 **while every other test passed**. `test/purity.test.ts` is the only thing that catches it.
