# Functional Design Plan — U5: Automated Skipping

**Stage**: CONSTRUCTION · Functional Design
**Unit**: U5 — Automated Skipping (Phase 4, *Act*)
**Written**: 2026-09-23 · **answers recorded 2026-09-26**
**Status**: ✅ **COMPLETE.** All 9 questions answered (§5.1) and **probe P-U5-1 discharged 2026-09-27**
— the predicted hazard is **FALSE**, FR-46 needs no lag guard, and BR-43 is written. Record:
[`../u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md`](../u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md).
**Next stage: the Code Generation plan.**

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

⚠️ **RESOLVED 2026-09-27 — THE HAZARD BELOW IS FALSE, AND ITS PREMISE WAS BACKWARDS.** Probe P-U5-1
found the audio follows the reported boundary within **~2 s**, so a skip there costs 2–3 s, not 18–41 s;
and the API was never reporting early — **the DJ stops *playing* 18–50 s before nominal end and reports
that accurately.** FR-46 needs no lag guard (BR-43). Record:
[`../u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md`](../u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md).
**The section is kept in full because the probe protocol and the reasoning that motivated it are the
record of how it was tested.**

Classifier v2 established that ~~**in the AI DJ context the API stops reporting a track 18–41 s
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

### Probe P-U5-1 — the protocol

Read-mostly: one write per trial. **It cannot be run unattended** — the instrument is the user's
ear, not an endpoint. That is what caught the mis-classification in the first place, and no
endpoint can report it.

**Preconditions**
- The user is at the machine, listening, and can report what they *hear*.
- Playback confirmed in the **AI DJ** context (`spotify:playlist:37i9dQZF1EYkqdzj48dyYq` was the URI
  in the R11 probe; ⚠️ **verify rather than assume — a recorded negative decays**).
- ⚠️ **`docker compose down` FIRST.** Corrected 2026-09-26 — see below.

#### ⚠️ CORRECTED 2026-09-26 — this said *"the container may stay up; this probe does not write to `history.db`"*

**That was inherited from R11 and is wrong here.** R11 only **read** (`currently-playing`, `queue`),
so the container was irrelevant to it. **P-U5-1 writes to the player**, and the container is
recording, so it writes down the consequences.

Each trial POSTs `next` about 0–3 s into track B. `PlayObserver` closes that play on `track-change`
at near-zero progress, and in [`outcomeClassifier.ts`](../../../src/history/outcomeClassifier.ts)
**both v2 conditions fail** — `unobservedTailMs` is nearly the whole duration against a 55 s cap, and
`observedPositionRatio` is ~0.01 against a 0.75 rail — so it records **`skipped`**, with
`skip_source = 'user'`.

⚠️ **4–6 trials would therefore inject 4–6 skips that are probe artefacts into a corpus of 22.** Up
to **27% contamination of the entire evidence base** Q1 depends on, and `BackTestService` counts every
`skipped` row. **That is precisely the defect class classifier v2 just spent a day removing**: rows
labelled `skipped` that are not rejections.

✅ **`docker compose down` for the duration.** The probe needs **no** container: it reads
`spotify-config.json` and holds its access token in memory, and
[`webApiClient.ts`](../../../src/spotify/webApiClient.ts) documents why that cannot race the MCP
server — token handling **deliberately never writes back**, and Spotify's refresh tokens are
long-lived and reusable. The music comes from Spotify, not from this app. Cost: ~15 minutes of
unrecorded listening.

⚠️ **A swap-in test database was considered and rejected for this** (user proposal, 2026-09-26). It
keeps a writer running against a database to be discarded and then restores the real one while the
engine may still hold it open — the shape of the U4 incident, which reported `integrity_check: ok` at
the time and surfaced later as a just-written value reading `null`. And it is not one file:
`history.db-wal` is **currently 4.1 MB against a 3.3 MB `history.db`**, so a swap that does not
checkpoint first moves less than half the data. **An untested restore path is more risk than the
fifteen-minute window it would protect.** The underlying need is real and is now backlog item
**W-5**; its near-term slice is a §4 checklist entry for migration 007.

**Per trial**
1. Poll `GET /me/player/currently-playing` until the reported track id **changes** (A → B). Note the
   wall-clock instant and both track ids.
2. **Immediately** issue `POST /me/player/next`.
3. Record within a few seconds: what the API now reports (track id and `progress_ms`), and **what
   the user says they HEARD** — did the audio cut mid-track, and was the track that got cut the one
   they had been hearing (A), or had B genuinely started?
4. Let playback settle before the next trial.

**Reading the result**

| What the user heard | What it means |
|---|---|
| Audio cut a track that had been playing a while, then B started | **Hazard is REAL.** The player's state is A. FR-46 must not act on a fresh `track-change` in the DJ context without a guard |
| B had already started audibly, and B got cut | **Hazard is NOT real.** Reported and player state agree; FR-46 as designed is safe |
| Mixed across trials | Report it as mixed. ⚠️ **Do not average it into a conclusion** — a context-dependent answer is exactly what R11 found |

**Trials**: 4–6 distinguishes these. ⚠️ **Run a positive control**, as R11 did — repeat 2 trials
during **album** playback, where no reporting lag is known. If the album trials behave differently
from the DJ trials, that difference *is* the finding. Without the control, an ambiguous DJ result is
unusable.

### ✅ The script exists: `scripts/probe-p-u5-1.mjs` (written 2026-09-26)

~~⚠️ **The probe script is deliberately NOT yet written.** It issues a real write against live
playback, and the shape of that write is one of the things U5 has not decided.~~ **Superseded** —
`POST /me/player/next` has exactly one shape and needs no decision U5 has not made.

```bash
npm run probe:p-u5-1:rehearse    # ⚠️ START HERE. Detects boundaries, issues NO write.
                                 # Read-only, so the container may stay UP.
docker compose down
npm run probe:p-u5-1             # the real thing: 4 DJ trials + 2 album controls
docker compose up -d
```

**What it does, in order:**

| Step | |
|---|---|
| Preflight 1 | ⚠️ **Refuses to run if `spotify-now-playing` is up.** If `docker` is unreachable it says the state is *unproven, not proven-down* and asks. **Rehearsal is exempt** — it makes no writes, so requiring a shutdown for the safe path would make it cost more than the risky one |
| Preflight 2 | ⚠️ **Verifies the token actually carries `user-modify-playback-state`.** The refresh response returns the granted scopes for free. `auth.mjs` requests it, but the refresh token on disk was minted under whatever set was in force when the user last authorised — **a recorded positive decays as silently as a recorded negative.** ✅ Verified present 2026-09-26 |
| Context | Prints `context.type` / `context.uri` and **asks** which context it is. ⚠️ It does **not** classify from the uri — R11 established the DJ and a radio station are both `type: playlist` with the same `37i9dQZF1E` prefix. It flags that prefix and says the answer decides, not the uri |
| Per trial | Polls `currently-playing` at 1 s until the reported id changes, then POSTs **immediately** and records the latency. Re-reads at **+1.5 s and +6 s** |
| ⚠️ The measurement | Prints *"everything above is what the API SAYS, and the API is the suspect"*, then asks **what you heard**: did audio cut · had the new track **already** started audibly · roughly how long the audio you were hearing had been playing |
| Reading | Prints a **tentative** per-trial reading only. ⚠️ The conclusion is drawn across trials with the control, by a human — a confident per-trial verdict would invite exactly the averaging R11 forbids |
| Control | Prompts you to switch to an **album**, then repeats. ⚠️ If album differs from the DJ, **that difference is the finding** |
| Record | Writes `probes/p-u5-1-<stamp>.json`. **Never opens `history.db`** |

⚠️ **A third outcome the protocol table above does not list**: *nothing cut at all*. The script
captures it, and it is a finding about **FR-48** rather than about the action point — a skip that did
not take effect.

---

## 4. Plan

✅ **All nine questions are answered.** The settled specification is **§5.1**; §5 keeps the answers
in the user's own words with a ⚙ note where a clarification changed something.

- [x] Settle Q1–Q9 — answered 2026-09-26. **Authoritative reading: §5.1**
- [x] ✅ **Probe P-U5-1 — DISCHARGED 2026-09-27.** The predicted hazard is **FALSE**: audio follows the
      reported boundary within ~2 s, so a skip costs 2–3 s, not 18–41 s. ⚠️ **And the hypothesis was
      backwards** — the DJ stops *playing* 18–50 s early and reports it accurately. Classifier v2's fix
      stands, its stated mechanism does not
- [ ] Get sign-off on the two **§5.2** amendments (FR-40's wording; R11's stale caveat)
- [x] Write `business-rules.md` — **BR-33 … BR-43**, continuing from U4's BR-32.4
- [x] Write `domain-entities.md` — `SkipAttempt`, `AutomationState`, `RunawayHalt`, `SafetyCounters`,
      migration 007
- [x] Write `business-logic-model.md` — the pipeline, **six refusal points and one action point**
- [x] Write `frontend-components.md` — the UI workstream (Q4 indicator, Q5 kill switch, BR-35.6
      acknowledgement)
- [x] Specify the **skip-attempt evidence fields** (Q8b) — BR-43.2
- [ ] Pre-register the Q6 safety thresholds **before** any rule is armed
- [ ] **Minimal `history.db` backup + RESTORE, before migration 007.** ⚠️ `data/` already holds ten
      ad-hoc backups in five naming conventions written by three scripts, **and not one of them has a
      restore path** — every script writes a backup, none reads one back. Must checkpoint the WAL
      first (`history.db-wal` is currently **larger** than `history.db`, so a naive copy loses over
      half the corpus) and refuse to run while the container is up. ⚠️ **Verify the restore** — an
      unverified restore path is the defect this item exists to fix. Full-inventory version is
      backlog **W-5**, which includes the `metabase-app-db` named volume that no tree-walking backup
      would find, and an undecided `secrets/` security question
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

--- C

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

--- I accept  the Recommendation. Regarding the behavior when the DJ is running I think my app usage preferences are likely to change over time so I don't think changing the DJ to the primary path is necessary... but both paths should be given equal attention since they will both be heavily used.

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

--- Agree with recommendation

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

--- I accepe the recommendation and add that the status line should provide a visual queue of the state of this process. To keep the status line clean I suggest not adding more text but rather providing color/flashing queues to identify the state... Maybe of the "Rules v#" status indicator, something like "White-idle, Grey-disabled, Yellow-hold, Yellowgreen-passed with missing info, Green-passed, Red-Failed" (not dictating the solution just suggesting a path, ideally UI elements should be designed for ease of use).

⚙ **Settled 2026-09-26 — accepted, and the cue needs its OWN indicator.**
Hold deadline is `min(label resolved, 30 s, 50% of track duration)`, expressed in **milliseconds**.

⚠️ **The `Rules v#` indicator's colours are already fully allocated, to a different variable.**
`rulesIndicator` in `src/ui/statusBar.ts` maps all four `IndicatorLevel` values to **rules-file load
health**: `unknown` = engine not running or nothing loaded, `warn` = reloading, `fail` = a newer file
was **rejected**, `ok` = applied. Its docstring pins why red is load-bearing there — **red names the
version still in force (FQ5)**, because a light that only says *"something failed"* leaves exactly the
ambiguity the indicator exists to remove, and a silent last-known-good is indistinguishable from a
successful reload.

Recolouring that indicator with per-play evaluation state would make **red ambiguous between *your
rules file is broken* and *a rule matched and the skip failed*** — destroying the one distinction it
was built to carry. The two are independent variables and must not share a light.

**So**: the evaluation-state cue becomes a **second, adjacent compact indicator**, which still meets
the stated goal (no added prose on the primary screen). The user's palette maps to it directly —
idle / disabled / hold / passed-with-missing-info / passed / failed — and the FD will work the
colours out as a design question. ⚠️ Six states exceed the four `IndicatorLevel` members, so that
union must be widened; it has no `default:` clause, so the compiler will name every site that must
change. Same deliberate pattern as `applyOnUnknown`.

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

--- Agree - put the UI button on the Rules pop-up (Primary screen needs to be kept as clean as possible). 

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

--- C only.

⚙ **Settled 2026-09-26 — (c) only, and its SCOPE is now defined: pause all automation.**
Thresholds stand: **consecutive-skip halt at 3**, **rate limit 10 skips/hour**, both
**pre-registered before any rule is armed**.

The user's reasoning: *tripping the halt indicates something isn't working right, and the user should
review* — so the scope is **global, not per-rule**. Option (a), disabling the offending rule, is
rejected for the reason the recommendation gave: a runaway is evidence the **system** misjudged, and
one rule is not necessarily uniquely at fault.

⚠️ **A halt is therefore a THIRD state, not the FR-38 kill switch.** Option (b) was declined, so
the runaway latch must not be implemented by flipping the user's kill switch — that would make the
system's own halt indistinguishable from a choice the user made, and clearing it would look like
re-arming rather than acknowledging. The FD specifies:

| | |
|---|---|
| Effect | All automated action stops. Evaluation and logging continue — the decision log is what the user reviews |
| Scope | **Global.** Every rule, not the one that tripped |
| Clears on | **Explicit user acknowledgement only.** Never on a timer, never on restart |
| Persistence | **Survives restart**, alongside the FR-38 state. A halt that clears itself at 03:00 defeats its purpose |
| Failure direction | **Fail closed.** An unreadable or missing latch file comes up **halted**, on the same rule as FR-47 |
| Distinct from | The kill switch. Two independent latches; automation is live only when **neither** is set |

So the precedence rule from the handoff gains one term:

```
live(rule) := globalAutomationEnabled AND NOT runawayHalted
              AND rule.enabled AND NOT rule.dryRun
```

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

--- A "session" is my name for one continuous listening period (which is why it's not defined), however... I don't believe we need a functional rule saying "never skip the same track twice within one session", the liklihood of that happening is low and if it DOES happen and the rules say skip the track - we should skip the track.

⚙ **Settled 2026-09-26 — FR-40 as written is declined; the loop guard is keyed on the PLAY ROW.**

Two different things were tangled in FR-40, and they separate cleanly:

1. **"Never skip the same track twice within one session"** — **declined.** The user's reasoning
   holds, and it is the same reasoning that forbids clamping `completionRatio` to 1.0: a track
   recurring is a **real listening signal**, and if the rules match it, it should be skipped. The
   recommended *(A) + (D)* — one attempt per `track_id` per process — would have refused exactly
   that, permanently, for the rest of the process lifetime.
2. **"A failed skip must not loop"** — **kept**, and this is what [`requirements.md`](../../inception/requirements/requirements.md)
   actually says FR-40 is for: *"the specific failure where a skip does not take effect and the
   engine re-evaluates the same track forever."* Against a 3 s poll loop that is an unbounded
   `POST /me/player/next` stream.

**The guard is therefore: at most one skip attempt per PLAY ROW, never per `track_id`.**

A repeat listen is a **new play row**, so it stays skippable — satisfying (1). A skip that did not
take effect cannot re-fire against the same row — satisfying (2). And it needs **no session
definition at all**, which is what made the original question hard.

⚠️ **This hazard is made MORE likely by §3, not less.** If the reported-vs-audible lag is real, a
skip can legitimately fail to do what the engine expected, and Q8 establishes that the obvious
confirmation check cannot reliably detect that. The row-keyed cap is the backstop that holds
regardless of how P-U5-1 resolves.

✅ **FR-40 is a `Must`, so this was a requirements AMENDMENT rather than an implementation choice —
and it is APPLIED.** User approved 2026-09-26; `requirements.md` FR-40 now reads *"a failed skip must
not loop — at most one skip attempt per play"*, with the withdrawal reasoned in place beneath it.
See §5.2.

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

--- This is not really a question since it's not asking me anything. However... I think we should monitor skip behavior to see if this is a concern (I suspect it's not)

⚙ **Settled 2026-09-26 — clarified: no NEW instrumentation, and the review is a later, separate act.**

The user clarified they were **not** proposing extra monitoring machinery, but that *at some point we
review the monitor data for the occurrence of this issue*. That resolves what was ambiguous. Three
consequences, and they are not the same thing:

**(a) The FR-48 confirmation itself is still built.** FR-48 is a `Must` — *confirm a skip took
effect; surface a failed skip rather than silently retrying* — so the provisional check stands:
confirm on `progress_ms` **resetting** *plus* a track-id change, and treat an unconfirmed skip as
**failed — surfaced, never retried**. This is not new instrumentation; it is one read on a path that
is already reading player state.

**(b) The later review needs the evidence to have been recorded at the time.** A review can only find
this if the skip path **writes down what it saw**. So the decision log records, per skip attempt: the
track id the rule matched, the reported track id and `progress_ms` **immediately before** the `POST`,
and the same pair **after**. No new subsystem — fields on a row that is already written. ⚠️ Without
this, the review has nothing to review, and *"we'll look at the data later"* silently becomes *"there
is no data."* Same family as `successor_lag_ms`: a column nothing wrote, so the mechanism it existed
to measure had to be reconstructed from trails.

**(c) ⚠️ The review CANNOT substitute for probe P-U5-1, and this is the load-bearing point.**
Reviewing logged skip behaviour means asking the decision log whether the skip landed — but §3
establishes that **the log's own signal is the suspect one**. In the DJ context the reported track
already changed 18–41 s before the audible one, so a logged *"different track reported now"* can read
as success when nothing audible happened. **Measuring the suspect effect with the suspect instrument
returns a plausible answer that means nothing** — the `inc=releases` 200 and `measure-confound.mjs`
zeros, a third time.

And the cost is asymmetric. If the hazard is real, the review pays for its evidence in **real
truncations of tracks the listener was enjoying**, in the context used 50–70% of the time — the
single harm U5 exists to avoid. P-U5-1 answers the same question in 4–6 trials plus the album control,
read-mostly, one write per trial, with the instrument that caught classifier v2 in the first place:
**the user's ear.** ⚠️ If the probe finds the skip lands on B, the hazard is closed, FR-46 is designed
as written, and (a) above is sufficient. **The suspicion is cheap to confirm; it is not safe to
assume.**

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

--- agree with recommendation

---

## 5.1 Settled — the specification the FD documents will be written from

All nine answered. This table is the **authoritative reading**; §5 keeps the user's own words above
each one, and the ⚙ notes carry the reasoning where a clarification changed something.

| Q | Settled |
|---|---|
| **1** | **(C)** — back-test shown at arming time as an **advisory number only**; a **mandatory dry-run period** is the actual gate. ⚠️ No numeric back-test threshold, because 22 events cannot bear one |
| **2** | Pre-warm **depth 3**, re-checked each poll, asked from the queue **at runtime**. ⚠️ **Do NOT relabel the DJ path as "primary"** — the user's listening mix will change. Both paths get **equal design attention**; neither may be built as a degraded catch-all |
| **3** | Re-evaluation resolves `unknown` → decided and may **cancel** a pending skip, but **never fires a skip an earlier evaluation declined**. Asymmetric on purpose. Migration **007** adds `trigger` (`initial` \| `enrichment-arrived`), **additive only** |
| **4** | `hold` until `min(label resolved, 30 s, 50% of duration)`, in **milliseconds**. Evaluation state gets its **own adjacent indicator** — ⚠️ **not** a recolouring of `Rules v#`, whose four colours are already allocated to load health |
| **5** | Persist to `config/automation-state.json` (**directory** mount, atomic rename). **UI button on the Rules pop-up**, not the primary screen, **plus** an API route. Checked at the **action point**. **Fails closed** |
| **6** | Halt at **3 consecutive**, **10 skips/hour**, pre-registered. **(c) only** — halt is **global**, clears on **explicit acknowledgement only**, persists across restart, fails closed, and is a **third latch distinct from the FR-38 kill switch** |
| **7** | FR-40's *"same track twice per session"* **declined**. Guard is **one skip attempt per PLAY ROW**, never per `track_id`. Needs a **requirements amendment** — see §5.2 |
| **8** | FR-48 confirmation **built** (`progress_ms` reset **+** track-id change; unconfirmed ⇒ failed, surfaced, never retried). Skip attempts **record reported track id and `progress_ms` before and after the POST**, so the later review has evidence. ⚠️ The review **does not replace P-U5-1** |
| **9** | Record `context_type` **and** `context_uri` on live plays in migration 007, **as evidence only**. ⚠️ No rule field in U5 — `context.uri` goes stale |

### ⚠️ What is still NOT decided, and cannot be

**FR-46's action point and FR-48's confirmation** both depend on probe **P-U5-1** (§3). Everything in
the table above can be designed now; those two cannot. The probe is the next step.

## 5.2 Document cleanup — ✅ ALL APPLIED 2026-09-26

Found while reviewing the handoff against current state. The two `requirements.md` items were held
for sign-off because amending an approved inception deliverable is stage-gated; **the user approved
both on 2026-09-26** and they are now applied.

| # | Item | State |
|---|---|---|
| 1 | **FR-40 amended.** *"Never skip the same track twice within one session"* → **one skip attempt per play row**, with the withdrawal reasoned in place: the session clause is *wrong*, not merely unnecessary, because a recurring track is real signal (the `completionRatio` clamp argument), and it silently required a *"session"* the corpus has never modelled | ✅ applied |
| 2 | **R11's caveats discharged.** §FR-36's *"Verify against active playback"* struck through with the context-dependent result in place, and the R11 risk row rewritten. Both had read as open since **2026-09-22** | ✅ applied |
| 3 | **`HANDOFF.md` R11 staleness.** It asserted in **two** places that R11 *"has never been probed while music is playing"* — one of them under the heading *The rule that has not changed*. Also *five* wrong conclusions where `CLAUDE.md` lists **six** | ✅ applied |
| 4 | **Stale current-state blocks** in `CLAUDE.md` and `aidlc-state.md` (*"waiting on 9 answers"*, *"resume file written"* — that file was deleted in `ec73798`) | ✅ applied |

⚠️ **The lesson from item 3 is narrower than *documents go stale*.** `ec73798` fixed that same file's
item 1 for precisely this reason and **left R11 stale two sections further down, in the same pass** —
while re-dating the file *Updated 2026-09-26*, which reads as authority. **A correction pass that
fixes only the statement it went looking for leaves the document wrong and freshly reviewed**, which
is worse than leaving it visibly old. Recency is not authority — the rule `ec73798` itself recorded,
applied to its own output.

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
