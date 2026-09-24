# Functional Design Plan — U5: Automated Skipping

**Stage**: CONSTRUCTION · Functional Design
**Unit**: U5 — Automated Skipping (Phase 4, *Act*)
**Written**: 2026-09-23
**Status**: ⬜ Awaiting answers to the questions in §5

> **U5 is the only unit that can cause harm.** Every other unit, wrong, produces a bad number in a
> report. This one, wrong, interrupts the music the user is listening to. The phases were
> sequenced for exactly this reason (`CLAUDE.md`, *Phases are sequenced by risk containment*), so
> the design bias throughout is **refuse rather than act when uncertain**.

---

## 1. Unit context

| | |
|---|---|
| **Stories** | US-18, US-19, US-21, US-22, completing US-13 |
| **Requirements** | FR-34, FR-35, FR-36, FR-38, FR-39, FR-40, FR-46, FR-47, FR-48; completes FR-33 |
| **Builds on** | U3 (`RuleEngine`, pure) · U4 (`EvaluationCoordinator`, `DecisionLogRepository`, `BackTestService`, `RuleSetWatcher`) |
| **Adds** | `src/playback/` — which does not exist today, and whose absence is U4's phase guard |
| **Schema** | Migration **007**, additive only |

### What changes about the system's posture

Until now the app has been **read-only against playback**. U5 issues `POST /me/player/next`. That
is a one-way action against a live device: there is no undo, and the user hears the result
immediately.

⚠️ **`SkipExecutor` is added ALONGSIDE `LoggingExecutor`, never grown out of it** (BR-30, U4's
design). Two implementations of `DecisionExecutor` selected by configuration. The test asserting
`LoggingExecutor.length === 1` must still pass when U5 is done.

---

## 2. Facts measured from the live corpus for this plan

Measured 2026-09-23, read-only against `history.db` with the container up.

### Outcome distribution — the evidence base a rule is validated against

| | |
|---|---|
| Plays | **664** (577 live, 87 backfilled) |
| `completed` | 518 |
| `skipped` | **22** — all `skip_source = 'user'` |
| `unknown` | 124 |

✅ **U5 handoff item 1 is CLOSED, not inherited.** The handoff (2026-09-22) warned that
`BackTestService` counted 22 user + 21 `unattributed` skips against a target that was roughly half
not-a-rejection. **Classifier v2 landed the same day and fixed the outcome itself**: 24 rows were
re-derived `skipped` → `completed`, `skip_attribution` was retired, and `BackTestService` needed no
change because it reads `outcome` and never read attribution. **All 22 remaining skips are the
listener's.**

⚠️ **But the number that matters got smaller, not cleaner-and-bigger. 22 events is the entire
evidence base for arming anything.** See Q1.

### Consecutive-skip runs — the empirical basis for the FR-39 runaway threshold

Over 577 live plays in time order:

| | |
|---|---|
| Longest run of consecutive skips | **2** |
| Run-length histogram | `{1: 18 runs, 2: 2 runs}` |

**The user has never skipped 3 tracks in a row in the recorded corpus.** That is the signal a
runaway guard is trying to separate itself from.

### Play rate — the basis for a rate limit

Over 47 active hours: **median 12 plays/hr · p90 21 · max 25.**

### ⚠️ `context_type` is NULL on all 577 live plays

Populated only on backfilled rows (85 `playlist`, 2 `artist`). This is CLAUDE.md **open item 7**,
and it is **the field FR-36 most wants**. It is available from
`GET /me/player/currently-playing` but *not* from the MCP `getNowPlaying` the poll loop uses.

---

## 3. ⚠️ The hazard that was not in the handoff, and that changes FR-46

**This is the most important thing on this page. It is a hypothesis with a clear mechanism, and it
must be probed before `POST /me/player/next` is designed, not after.**

Classifier v2 established that **in the AI DJ context the API stops reporting a track 18–41 s
before it stops playing**. The listener hears track A finish; the API is already reporting track B.

`EvaluationCoordinator` takes its play boundary from `PlayObserver`, which consumes `tick` — i.e.
**the API's notion of the current track**. So in the DJ context the sequence is:

```
t+0s     API reports B; A is still audible for another 18-41s
t+0s     EvaluationCoordinator opens a decision for B
t+~10s   ENRICHMENT_WAIT_MS elapses; a rule matches B; SkipExecutor fires
         -> POST /me/player/next acts on the PLAYER's real state, which is still A
```

**Predicted consequence: the skip truncates A** — a track the user was enjoying and the rules did
not match — **and B then plays in full, unskipped.** The rule fails at its job *and* causes the one
harm U5 exists to avoid, in the context the listener uses **50–70%** of the time.

⚠️ **Every step of this is established except the last.** What is *not* established is whether
`POST /me/player/next` acts on the player's real state or on the same lagged state the read
endpoints report. If the lag is in Spotify's *state store* rather than in its *reporting*, the skip
lands on B and there is no problem at all. **I do not know which, and it is not inferable from what
we have.**

⚠️ **This is not a reason to defer U5.** It is a reason to probe before designing FR-46, exactly as
R11 was probed before FR-36 — and R11 is the precedent for why that ordering pays: the answer was
"it depends on the context", which neither branch of the execution plan anticipated.

**Proposed probe P-U5-1** (read-mostly, one write per trial, user present and listening): during
confirmed DJ playback, wait for a reported `track-change`, then immediately issue
`POST /me/player/next` and record what the user *hears* against what the API reports. A handful of
trials answers it. **The listener's ear is the instrument here** — that is what caught the
mis-classification in the first place, and no endpoint can report it.

---

## 4. Plan

- [ ] **Probe P-U5-1** — resolve §3 before FR-46 is designed
- [ ] Settle what validates a rule before it may be armed, on 22 events (Q1)
- [ ] Settle FR-36 pre-warm strategy under a context-dependent queue (Q2)
- [ ] Settle FR-34 re-evaluation and the BR-22.1 relaxation; specify migration 007 (Q3)
- [ ] Settle FR-33 `hold` — deadline and re-evaluation trigger (Q4)
- [ ] Settle the FR-38 kill switch — surface, latency, persistence, failure direction (Q5)
- [ ] Settle FR-39 rate limit and runaway halt — numbers, and what "halt" means (Q6)
- [ ] Settle FR-40 — the definition of a "session" (Q7)
- [ ] Settle FR-48 skip confirmation, given §3 (Q8)
- [ ] Settle whether `context_type` is recorded live now (Q9, open item 7)
- [ ] Write `business-logic-model.md` — decision-to-action pipeline, safety interlocks
- [ ] Write `domain-entities.md` — `SkipAttempt`, `AutomationState`, `SafetyCounters`
- [ ] Write `business-rules.md` — numbered BRs continuing from **BR-33**
- [ ] Define the live-verification protocol discharging Phase 4's seven exit criteria

---

## 5. Questions

### Question 1 — What validates a rule before it may be armed? ⚠️ **the critical one**

`BackTestService` now reports agreement against **22 user skips** across 577 live plays.

⚠️ **The instrument's own precedent applies.** The 2026-09-10 hypothesis gate had 17 skips, and its
pre-registration said *in advance* that it would find a strong effect or nothing. It found nothing,
and the CI ruled out roughly ±8pp **and nothing smaller**. A back-test over 22 events has the same
character: it can catch a rule that is wildly wrong, and it cannot distinguish a good rule from a
mediocre one.

**Options**

- **(A) A back-test gate with a numeric threshold** — a rule may be armed only if it agreed with
  ≥ N user skips and produced ≤ M false positives. ⚠️ Requires committing to N and M on 22 events.
  **Pre-register them, on the BR-11 precedent**, so they cannot be tuned once a favourite rule
  fails.
- **(B) A mandatory dry-run period** — a rule must run in dry-run for a set time or a set number of
  matches, and the user reviews the decision log before arming. Trades a statistical gate for a
  human one. ⚠️ Honest about n, and consistent with U4's dry-run agreement gate (65 decisions).
- **(C) Both** — back-test as an advisory number shown at arming time; dry-run as the actual gate.
- **(D) Neither** — arming is purely the user's call, with the back-test shown for information.

**Recommendation: (C).** The back-test cannot bear a threshold's weight at n=22, but it is
genuinely informative and hiding it would be worse. The dry-run is the gate that has already
demonstrated it works on this project.

---

### Question 2 — FR-36 pre-warming, when the queue is context-dependent

R11 is discharged: album/autoplay/radio expose 7–20 tracks and predict correctly (8 for 8, in
order, across a context boundary). **The AI DJ exposes none, ever** (0 on all 88 samples, including
at track boundaries), and `context.type` **cannot** tell the DJ from a radio station.

So FR-36 must **ask the queue at runtime and adapt**. The question is what to do with the answer.

1. **How deep to pre-warm?** The queue gives up to 20. Each unresolved label is ~2 MusicBrainz
   calls behind a **1 req/sec** queue, and the bounded retry is load-bearing (6 of 19 tracks took a
   503 at 1200 ms spacing). Pre-warming 20 tracks is ~40 s of queue occupancy that label backfill
   also needs.
2. **What happens when the queue is empty — the DJ, the majority path?** The specified fallback is
   FR-34/35. ⚠️ `requirements.md` still calls this the *fallback*; **at 50–70% DJ listening it is
   the majority path** and should be designed as the primary.

**Recommendation**: pre-warm **depth 3**, re-checked each poll, and treat FR-34/35 as primary.
Depth 3 covers the realistic window between a track appearing in the queue and playing, without
monopolising the MusicBrainz queue.

---

### Question 3 — FR-34 re-evaluation vs BR-22.1's one decision per play

BR-22.1 (*one decision per play*) was **deliberately scoped to U4** with **no `UNIQUE` constraint**
(BR-22.1a) precisely so U5 could write a second decision without a non-additive migration.

Migration **007** adds a `trigger` column (`initial` | `enrichment-arrived`, alongside U4's implicit
`settled` | `deadline`). ⚠️ **It must stay additive** — the by-image rollback guarantee depends on
it.

**To settle**: may a re-evaluation *reverse* a decision, or only resolve an `unknown` into one?

⚠️ **If a track has already been skipped, reversal is meaningless** — the action is not undoable.
So re-evaluation can only matter in the window *before* the action fires, which makes the deadline
(Q4) and the action point the same question.

**Recommendation**: re-evaluation resolves `unknown` → decided and may **cancel** a pending skip,
but never fires a skip that an earlier evaluation declined. Asymmetric on purpose: the direction
that errs toward *not acting* is the safe one.

---

### Question 4 — FR-33 `hold`, finally

`onUnknown: 'hold'` currently loads a rule **disabled with a reason**. U5 is where the promise comes
due. It needs a deadline and a re-evaluation trigger — the same machinery as Q3.

**To settle**: the deadline. `ENRICHMENT_WAIT_MS = 10 000` is measured-correct for U4's purpose (max
observed settle **9.0 s**; ⚠️ do not lower it on the median — an earlier read suggested 7–8 s was
safe, and the tail then moved to 9.0 s). But a *label* resolution behind a 1 req/sec queue can take
far longer than 10 s.

**So `hold` needs its own, longer deadline**, and holding past the point the track has finished is
pointless.

**Recommendation**: hold until `min(label resolved, 30 s, 50% of track duration)`, then take the
FR-35 partial-data path. ⚠️ **Express the cap in milliseconds, not as a ratio of duration alone** —
CLAUDE.md's constant-time-effect warning applies directly here.

---

### Question 5 — FR-38 kill switch: surface, latency, persistence

**Requirements**: halts all automated action *immediately*, and (Phase 4 exit criterion) *persists
across restart*.

1. **Surface** — a UI button, an API route, a config flag, or all three?
2. **Latency** — "immediately" against a 3 s poll loop means *no skip is issued after the switch is
   thrown*. That is a check at the **action point**, not a promise about the poll.
3. **Persistence** — the switch must survive a container restart. ⚠️ `config/` is a **directory**
   bind mount for a reason: a single-file mount binds an inode, and write-temp-then-rename either
   fails or silently detaches the container's view. **U5 is the first unit that WRITES to
   `config/`**, so this is exactly where that latent bug surfaces.
4. ⚠️ **Which way does it fail?** If the state file is missing or unreadable at startup, automation
   must come up **off**. FR-47 already says off by default; a corrupt state file must not be a path
   to *on*.

**Recommendation**: persist to `config/automation-state.json` (directory mount, atomic rename),
expose a UI button **and** an API route, check at the action point, and **fail closed**.

---

### Question 6 — FR-39 rate limit and runaway halt: the numbers

Measured above: the user has **never skipped 3 in a row** (longest run 2; 18 runs of 1, 2 runs of
2), and plays run at **median 12/hr, p90 21, max 25**.

**Recommendation**, to be **pre-registered before any rule is armed**:

- **Consecutive-skip halt at 3** — one above anything the user has ever done.
- **Rate limit at 10 skips/hour** — below the median *play* rate, so a runaway cannot outrun the
  listener's attention.

**To settle: what does "halt" mean?** (a) disable the offending rule; (b) throw the global kill
switch; (c) halt until the user acknowledges.

**Recommendation: (b) + (c).** A runaway is evidence the *system* misjudged, not necessarily that
one rule is uniquely bad, and the user should have to look at the decision log before re-arming.

⚠️ **These thresholds are safety limits, not tuning parameters.** If a legitimate rule trips the
halt at 3, that is information about the rule, not grounds to raise the number.

---

### Question 7 — FR-40: what is a "session"?

*"Never skip the same track twice within one session."* The corpus has no session concept.

⚠️ **Note the interaction.** `completionRatio` is deliberately **never clamped to 1.0** because
replaying a track is a real signal — so a track legitimately recurring is normal, and FR-40 must not
read a genuine repeat listen as a failed skip loop.

**Options**: (A) app process lifetime; (B) a rolling window (e.g. 4 h); (C) until a playback gap
> N minutes; (D) per `track_id`, N attempts ever, then never retry.

**Recommendation: (A) + (D)** — remember attempts for the process lifetime, capped at **one**
attempt per `track_id` per process. The failure FR-40 guards is a skip that does not take effect and
re-fires every poll; one attempt closes it **without needing a session definition at all**.

---

### Question 8 — FR-48: confirming a skip took effect

*"Confirm a skip took effect; surface a failed skip rather than silently retrying."*

⚠️ **This is where §3 bites hardest.** The obvious confirmation — after `POST /me/player/next`,
check that `currently-playing` reports a different track — is **exactly the signal the DJ context is
known to report early**. In the DJ the reported track already changed 18–41 s before the audible one
does, so this check can return "skip confirmed" when nothing audible happened.

**A confirmation that is guaranteed to pass is not a confirmation.** Same family as the
`inc=releases` 200 and `measure-confound.mjs` returning zeros: a plausible success that means
nothing.

**This question cannot be answered before probe P-U5-1.** It is recorded here so it is not quietly
answered with the obvious check.

**Provisional**: confirm on `progress_ms` **resetting** *plus* a track-id change, and treat an
unconfirmed skip as failed — **surfaced, not retried** (FR-40).

---

### Question 9 — Record `context_type` live? (open item 7)

NULL on all 577 live plays. Not available from the MCP `getNowPlaying`; available from
`GET /me/player/currently-playing`, which R11's probes already call.

⚠️ **Two independent reasons U5 wants it, and a warning:**

1. FR-36 must know whether lookahead exists. **It must still ask the queue** — `context.type` cannot
   distinguish the DJ from a radio station — but the context is worth *recording*.
2. §3's hazard is **context-specific**. If the DJ is the only context with a reporting lag, the
   action point may need to behave differently there, and that **cannot even be measured while the
   field is NULL**.
3. ⚠️ **`context.uri` goes stale** — it named an album through 33 minutes of autoplay by other
   artists. Recording it is **necessary but not sufficient**, and a rule written over it would
   classify algorithmic placement as album playback: wrong, and wrong in the direction that *hides*
   what R1 is about.

**The user declined this on 2026-09-02**, when it was a standalone enrichment. **It is now
load-bearing for a safety question**, which is a different trade — so it is re-raised rather than
assumed.

**Recommendation**: record `context_type` and `context_uri` on live plays in migration 007, **as
evidence only** — no rule field in U5, given the staleness.

---

## 6. Out of scope for U5 — recorded so it is not re-litigated

| | |
|---|---|
| Exemption / allow rules, rule precedence | Q-B — revisit *after* Phase 4 |
| W-3 session-end discriminator | Data recovery, not a skip repair. ⚠️ Anyone implementing it as stated writes code that does nothing |
| W-4 artist-credit aliases | 2026-09-23. Derived reporting DB only; not a rule or gate input |
| Re-running the hypothesis gate | **BR-11.7 — the confirmatory run is spent.** Not reopened by better outcome data |
| Rule authoring UI | U4 shipped a read-only panel; authoring stays file-based |

---

## 7. Standing hazards

- **`docker compose down` before anything that writes `history.db`.** A maintenance script is a
  writer. This corrupted the index during U4, reported `integrity_check: ok` at the time, and
  surfaced later as a just-written value reading `null`. ⚠️ `VACUUM INTO` does **not** repair it.
- **Back up `data/` before migration 007.** That backup is why the U4 incident was a detour rather
  than a loss.
- **The app is `http://localhost:3010`.** `localhost:3000` is a different project.
- **Check exit codes directly** — `npm run typecheck | tail && echo OK` reported success while
  typecheck was failing. The pipe's exit code is not the command's.
