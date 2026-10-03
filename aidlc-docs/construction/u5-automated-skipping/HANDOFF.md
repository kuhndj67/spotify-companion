# U5 Handoff — U5's single entry point

**Written 2026-09-22** at the U4/U5 boundary. **Updated 2026-10-03.** This is the single entry point
for U5.

---

## ▶ CURRENT STATE (2026-10-03) — U5 IS BUILT AND DEPLOYED, AND IT IS **INERT**

✅ **All 13 code-generation steps are done. Migration 007 ran. The container is live on the new
image.** 1228 tests · typecheck clean · `npm run smoke` green · `npm run knip` clean · **schema v7** ·
**885 plays** · `integrity_check: ok`.

⚠️ **NOTHING CAN SKIP A TRACK RIGHT NOW, and that is the intended delivered state.**
`SKIP_EXECUTOR_ENABLED` is **`"false"`** in `compose.yaml`, so `SkipExecutor` is **never
constructed** — no player client, no drain, no attempt rows. The rules engine keeps evaluating and
logging exactly as it did in U4. This is **BR-40.1's arming gate**: U5 ships inert so the dry-run
decision log can be reviewed *before* anything acts.

### ▶ THE NEXT STEP IS NOT CODE. It is the dry-run review.

**Three exit criteria remain, and none can be closed by CI.** Two of the three are now closed:

| | Criterion | Status |
|---|---|---|
| 1 | **`probeWritable` against the real `/state` mount, through the container** | ✅ **CLOSED 2026-10-03** — `/api/diagnostics` reports `writable` as the `node` user, and the kill switch was written and read back in both directions. Host and container see identical file content, so the **write-temp-then-rename survived the bind mount** |
| 2 | **The dry-run review that arms the first rule** | ⚠️ **OPEN — this is the next step.** User judgement, not a test |
| 3 | **The first real skip, heard by the user**, confirming it costs 2–3 s rather than 18–41 s | ⚠️ **OPEN** — needs (2) first |

### How to arm it, when the review says so

1. Read the decision log on the Rules pop-up. ⚠️ **It is already populated** — U4 has been recording
   decisions since 2026-09-11, so the review does not have to wait for new data.
2. Decide which rule to arm, and **narrow it if the projection says it would match a lot**. The
   currently-loaded `major-label` rule matches **145 of 885 plays (16.4%)** — measured, and see the
   pre-registration before reading that as safe.
3. Set `SKIP_EXECUTOR_ENABLED: "true"` in `compose.yaml` and `docker compose up -d`. ⚠️ **That builds
   the machinery; it does not arm it.** `globalAutomationEnabled` is still `false`.
4. Throw the switch on the **Rules pop-up**, which is the only control that acts without a restart.

⚠️ **Read [`safety-thresholds/pre-registration.md`](safety-thresholds/pre-registration.md) first.** It
fixes the two halt limits **and what would count as evidence that either is wrong**, written while
`skip_attempt` held 0 rows. ⚠️ **`3 consecutive` is the limit to expect first**, not `10/hour` — 16.4%
overall says nothing about adjacency, and three consecutive major-label tracks is an ordinary run
inside an album.

### ⚠️ Rollback is VERIFIED LIVE, not inferred

U4's image is tagged **`spotify-now-playing:u4-rollback`**. Against a **v7 copy** it reports
`{from: 7, to: 7, applied: []}`, every U4 read path works, and ⚠️ **a U4 `INSERT` into a v7
`decision_log` succeeds with `trigger` defaulting to `'initial'`** — which is the clause that would
have broken had that column been `NOT NULL` without a default. `integrity_check: ok` after that write.

> ⚠️ Reading the *skip line* alone would have proved only that **007 is skipped**, not that U4's code
> runs correctly against an unread table and three unread columns. The plan said so; the write is what
> actually closes it.

### Before running anything that touches the database

⚠️ **`docker compose down` first.** The container is the deployment and it holds `history.db` open.
**SQLite's locks do not cross the Rancher Desktop bind mount**, so the script-level lock probe cannot
see it — `docker ps` is the only working check, and `backup-history.mjs` does both.

Latest verified backup: **`data/backup-before-migration-007-deploy-20261003T135418Z`** — schema v6,
879 plays, **all eight checks pass**.

---

## Earlier state (2026-09-30)

## The state as of 2026-09-26, kept because the detail below is still current

✅ **All 9 design questions are ANSWERED** (2026-09-26). The settled specification is
[**§5.1 of the design plan**](../../plans/u5-functional-design-plan.md) — read that, not the raw
answers, as the authoritative reading.

**U5 Functional Design is now PAUSED on one PROBE, not on decisions.** `src/` is untouched, no
migration, container healthy and recording. If `git status src/` is not clean, something was started
that this file does not know about.

⚠️ **Two §5.2 amendments need the user's sign-off** before the FD documents are written: FR-40's
wording (Q7 declines it **as written** — the guard is now one attempt per **play row**, not per
`track_id`), and R11's stale caveat in `requirements.md`. Both are in stage-gated inception
deliverables, so they were deliberately **not** applied unilaterally.

✅ **Functional Design is WRITTEN** — `u5-automated-skipping/functional-design/`:
`business-rules.md` (**BR-33 … BR-43**), `domain-entities.md`, `business-logic-model.md`,
`frontend-components.md`. Everything except FR-46's action point and FR-48's confirmation, which
**BR-43 records as deliberately unspecified** pending probe P-U5-1.

⚠️ **Three things the FD found in the code while being written:**
1. **`DecisionExecutor.execute` is SYNCHRONOUS and unawaited** (`LoggingExecutor.ts:31`,
   `EvaluationCoordinator.ts:228`) — an HTTP `POST` cannot live there. Resolved by **BR-42**:
   `SkipExecutor.execute` enqueues a `SkipAttempt` and a separate async path drains it. Making
   `execute` async was rejected — it would change `LoggingExecutor` to serve a collaborator it does
   not have (BR-30), put an unawaited promise in a timer, and check the kill switch in the **wrong
   place**. Queueing makes the action point the only place, and makes BR-37.5's *cancel a pending
   skip* implementable rather than aspirational.
2. ⚠️ **`config/` is mounted `:ro`** (`compose.yaml:202`) and **U5 is the first unit that writes
   there.** CLAUDE.md predicted this would surface *"the first time the U4 rule editor saves"*; U4
   shipped read-only, so it has not. **It will present as a kill switch that works in the UI and does
   not persist.** BR-34.4.
3. ⚠️ **Q4's colour cue collides with an existing scheme.** All four `IndicatorLevel` values are
   already bound to rules-**file** load health, where `fail` **names the version still in force**
   (FQ5). Recolouring would make red mean either *your rules file is broken* or *a skip failed*.
   Resolved as a **second adjacent indicator**; and the contract already says **colour is never the
   only channel**, so each state needs a glyph too — which matters most for the proposed
   `Green`/`Yellowgreen` pair.

### ✅ Probe P-U5-1 is DISCHARGED (2026-09-27) — the FD is COMPLETE

**The predicted hazard is FALSE.** Audio follows the reported track boundary within **~2 s** in the DJ
and essentially simultaneously in radio and album, so a skip there costs **2–3 s**, not 18–41 s.
**FR-46 needs no lag guard**, FR-48's confirmation is validated, and **BR-43 is written**.

⚠️ **The hypothesis was backwards.** The API never lagged — **the DJ stops *playing* 18–50 s before
nominal end and reports it accurately** (`B@first`: ~1 s in radio/album, **up to 23.6 s** in the DJ).
**Classifier v2's fix stands; its stated mechanism does not.** No re-derivation, and BR-11.7 untouched.

✅ **Discriminator: PRE-DETERMINED vs PRODUCED-LIVE**, not *algorithmic* — radio is algorithmic and
behaves like an album. **This explains R11 with the same cause**, and means **the queue probe FR-36
already performs is also the transition-regime probe**. No new field.

⚠️ **New API fact**: DJ commentary returns **`200` with `item: null`** (not 204) for 6.5–7.2 s. An
**open question** about the MCP live path follows from it — see BR-43.8; **do not conclude it from
P-U5-1**.

Record:
[`probes/p-u5-1-transition-behaviour-2026-09-27.md`](probes/p-u5-1-transition-behaviour-2026-09-27.md).
~~**Next: the Code Generation plan.**~~ ⚠️ **Corrected 2026-09-27 — that skipped two stages.**
**Next: [the NFR Design plan](../plans/u5-nfr-design-plan.md)**, then Infrastructure Design, then Code
Generation. See the top block.

### The original protocol, kept for the history — §3 of the plan

⚠️ **It cannot be run unattended.** The instrument is the user's ear, not an endpoint. The user said
on 2026-09-23 that they could not start it immediately.

⚠️ **`docker compose down` FIRST — corrected 2026-09-26.** The protocol used to say the container
could stay up, inherited from R11, which only **read**. P-U5-1 **writes to the player**, and the
recording container writes down the result: each trial POSTs `next` 0–3 s into a track, which
`outcomeClassifier` records as **`skipped`** (both v2 conditions fail at near-zero progress). 4–6
trials would inject **4–6 artefact skips into a corpus of 22** — the defect class classifier v2 just
removed. The probe needs no container: it reads `spotify-config.json` and cannot race the MCP server,
because token handling deliberately never writes back. Cost: ~15 min of unrecorded listening.

⚠️ **It is the ONLY thing blocking the FD now.** Everything else in §5.1 can be designed today;
**FR-46's action point and FR-48's confirmation cannot.** Q8 settled that reviewing logged skip
behaviour **does not substitute** for it — the log's own signal is the suspect one, so that review
would measure the suspect effect with the suspect instrument.

⚠️ **EVERYTHING BELOW WAS THE HYPOTHESIS, AND IT IS FALSE.** Probed 2026-09-27: the audio follows the
reported boundary within ~2 s, so a skip costs 2–3 s rather than 18–41 s, and the API was never
reporting early — **the DJ stops *playing* early.** Kept for the history; act on the block at the top of
this file.

~~**Why it gates FR-46**~~: classifier v2 established that in the AI DJ context the API stops reporting
a track **18–41 s before it stops playing**. `EvaluationCoordinator` takes its play boundary from
that reported state — so a rule matching the newly-reported track B may fire
`POST /me/player/next` against a player still on **A**, truncating an unmatched track the listener
was enjoying while B plays on unskipped, in the context used **50–70%** of the time.

⚠️ **Every step of that is established except the last**: whether the skip acts on the player's real
state or on the same lagged state the read endpoints report. **Not inferable — probe it.** The same
lag also makes the obvious FR-48 confirmation (*"is a different track reported now?"*) one that can
pass when nothing audible happened.

✅ **CLAUDE.md open item 7 is DECIDED** (Q9, 2026-09-26). `context_type` **and** `context_uri` will
be recorded on live plays in migration 007 — **as evidence only, with no rule field in U5**, because
`context.uri` goes stale (it named an album through 33 minutes of autoplay by other artists). It was
declined 2026-09-02 as a standalone enrichment and re-raised because it became load-bearing for a
*safety* question, which is a different trade. ⚠️ It is still NULL on all 577 live plays today, so
§3's hazard **cannot be measured by context** until this ships.

---

## Read in this order

1. `CLAUDE.md` — the invariants
2. `aidlc-docs/aidlc-state.md` — authoritative state
3. `audit.md` — the last ~8 entries cover all of U4
4. [`../build-and-test/u4-build-and-test-summary.md`](../build-and-test/u4-build-and-test-summary.md)
   — what was proven, and the five defects
5. `u4-rule-observability/` — the designs U5 builds on
6. [`../../reference/rules-language.md`](../../reference/rules-language.md) — the rule syntax

---

## ⚠️ The five things most likely to be got wrong

### 1. ~~The outcome variable is half noise~~ — ✅ **CLOSED 2026-09-22, not inherited**

⚠️ **This was "the most important thing on the page" and it is now RESOLVED. Do not act on the text
below.** Classifier v2 landed hours after this handoff was written and fixed the **outcome itself**:
24 rows re-derived `skipped` → `completed`, `skip_attribution` **retired**, live skips 46 → 22.
`BackTestService` needed no change — it reads `outcome` and never read attribution. **All 22
remaining skips are `skip_source = 'user'`.**

⚠️ **But the evidence base got SMALLER, not cleaner-and-bigger.** 22 events is everything there is
for validating a rule before arming it, and the 2026-09-10 gate's n=17 precedent says what that can
and cannot decide. That is **Q1** of the design plan, which recommends back-test as an advisory
number and dry-run as the actual gate.

The original text is kept below for the history.

**This was the most important thing on the page.**

`skip_attribution` (migration 006) splits skips into `user` and `unattributed`. Currently **22
user, 21 unattributed** — an `unattributed` skip is a track that played to 81–90% and was then
replaced by something the listener did not choose.

⚠️ **`BackTestService` counts every `skipped` row regardless of attribution.** So
`agreedWithUserSkip` and `missedUserSkip` are computed against a target that is **roughly half
not-a-rejection**. That was not wrong when written — attribution arrived afterwards — but U5 arms
rules on the strength of those numbers.

**U5 must decide, in writing, whether an `unattributed` skip counts as agreement.** Inheriting the
current behaviour silently is the failure mode.

⚠️ Note the asymmetry before deciding: excluding them shrinks the evidence base to ~22 events;
including them means a rule can look validated by transitions nobody chose.

### 2. The phase boundary is what U5 is allowed to break — carefully

U4's guard was **`src/playback/` does not exist** and `LoggingExecutor` taking no playback
collaborator (constructor arity pinned by a test). U5 necessarily ends both.

⚠️ **`SkipExecutor` is added ALONGSIDE `LoggingExecutor`, never grown out of it** (BR-30, U4's
design). Two implementations of `DecisionExecutor`, selected by configuration — not one that
learns to skip. The test asserting `LoggingExecutor.length === 1` should still pass at the end
of U5.

`FR-47` puts automation **off by default**. `globalAutomationEnabled` is currently a constant
`false`; making it a real setting is U5's first act, and the precedence rule is already settled:

```
live(rule) := globalAutomationEnabled AND rule.enabled AND NOT rule.dryRun
```

A rule **cannot** opt out of a global dry-run (BR-25.2).

### 3. FR-33's `hold` is still unimplemented, and rules already declare it

`onUnknown: 'hold'` loads the rule **disabled with a reason**. That was deliberate so rules
authored now start working when U5 lands rather than needing re-authoring. ⚠️ **U5 is where the
promise comes due** — it needs a deadline and a re-evaluation trigger, which is also what FR-34
requires.

### 4. FR-34 contradicts BR-22.1, and that was left for U5 on purpose

BR-22.1 says *one decision per play*. **FR-34 is a Must** and requires re-evaluation when slow
enrichment lands. U4 scoped BR-22.1 to itself and **deliberately created no `UNIQUE` constraint**
(BR-22.1a) so U5 can write a second decision per play without a non-additive migration.

⚠️ When U5 adds the `trigger` column (`initial` | `enrichment-arrived` alongside U4's implicit
`settled` | `deadline`), migration 007 must stay **additive** — the by-image rollback guarantee
depends on it.

### 5. `FactCache` (LC-12, P-16) was closed as superseded, and U5 re-opens it

U3 deferred it to *"the unit that first evaluates rules on the poll path"*. U4 closed it: with one
decision per play, `historyCountsBefore` is called once and a cache saves nothing.

⚠️ **FR-34's re-evaluation means a second assembly for the same play**, which is exactly the case
the cache was specified for. Recorded in `construction/plans/u4-code-generation-plan.md` Q1.

---

## What U5 inherits, working

| | |
|---|---|
| `RuleEngine` | Pure, unmodified since U3. Back-tests and live decisions use the **same** engine |
| `EvaluationCoordinator` | The trigger. Consumes `tick`, takes its play boundary from `PlayObserver` |
| `DecisionLogRepository` | 195 rows, all linked. Retention capped at 100,000, pruner fenced |
| `RuleSetWatcher` | Polling reload, last-known-good **verified live** |
| `BackTestService` | Writes nothing. ⚠️ See item 1 |
| Status bar / rules panel / decision log | Read-only UI, `src/ui/statusBar.ts` tested |
| `[decision]` stdout line | One per play, `docker logs -f --timestamps` |

### Measurements U5 should not re-derive

| | |
|---|---|
| `ENRICHMENT_WAIT_MS = 10 000` | ✅ correct, **not generous** — max observed settle **9.0 s** |
| Blind spot | Plays ending before the cap log nothing: 2.8% of plays, 4 of 31 skips |
| `partialData` rate | **0 of 65** |
| `fs.watch` over the bind mount | **Dead** — 0 events in 12 s. Do not retry it |

⚠️ **Do not lower `ENRICHMENT_WAIT_MS` on the median.** An earlier read of the same data (max
6.9 s) suggested 7–8 s was safe; a few hours later a 9.0 s settle appeared. The tail moved and the
median did not.

---

## ⚠️ Standing hazards, one of which bit during U4

**Never run anything that writes to `history.db` while the container is up.** CLAUDE.md says this
about `npm start`; **it is about writers**, and a maintenance script is a writer. Doing it during
U4 corrupted the index, reported `integrity_check: ok` at the time, and surfaced later as a
just-written value reading `null`. ⚠️ **`VACUUM INTO` does not repair this** — it rebuilds from
the b-tree it is given and produced worse damage in a fresher-looking file.

`docker compose down` first. Always. Back up `data/` before any migration; that backup is the only
reason the U4 incident was a detour rather than a loss.

**The app is on `http://localhost:3010`.** `localhost:3000` is a different project.

---

## Open items U5 touches

| # | Item |
|---|---|
| **4** | ⚠️ Rewritten 2026-09-22. No longer a "crossfade confound"; now instrumented by `skip_attribution`. Its old direction claim is **withdrawn** |
| **5** | ✅ **CLOSED 2026-09-22 — R11 WAS probed during active playback.** ⚠️ This row said *"it has never been probed"* until 2026-09-26; it was already false when written. Answer: **context-dependent** — album/autoplay/radio expose 7–20 tracks and predict 8 for 8 in order; **the AI DJ exposes none, ever** (0 on all 88 samples). `context.type` **cannot** tell the DJ from a radio station. So **FR-36 must ask the queue at runtime**. Record: [`probes/r11-queue-lookahead-2026-09-22.md`](probes/r11-queue-lookahead-2026-09-22.md) |
| **8** | W-3, session-end discriminator. ⚠️ **Data recovery, not a false-skip repair** — anyone implementing it as stated writes code that does nothing |
| 7 | Playback context never recorded live. The AI DJ is arguably the closest available proxy for *promoted* |

---

## The rule that has not changed

> **Probe the live API. Do not reason from documentation.**

**Six** wrong conclusions have been drawn from docs in this project, each caught only by a probe
(this said *five* until 2026-09-26; `CLAUDE.md` is the authoritative list). One of them inverts the
usual shape: **the project's own note said `recently-played` returns no `external_ids`, and it
does.** A recorded negative decays silently because nothing re-tests it.

⚠️ **This section used to end by saying R11 was the one U5 needs and nobody had probed it. That
was already false when written** — R11 was discharged 2026-09-22 (see open item 5 above), and the
probe is what found the 18–41 s reporting lag that classifier v2 then corrected. Corrected
2026-09-26. **A stale claim standing under the heading *The rule that has not changed* is the
sharpest possible illustration of the rule itself.**

⚠️ **The open probe is now [`P-U5-1`](../plans/u5-functional-design-plan.md) (design plan §3)**:
whether `POST /me/player/next` acts on the player's real state or on the same lagged state the read
endpoints report. It gates **FR-46 and FR-48**, and it needs the user's ear — no endpoint reports it.
