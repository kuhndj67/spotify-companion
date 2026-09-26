# U5 Handoff — read this before starting Functional Design

**Written 2026-09-22** at the U4/U5 boundary. **Updated 2026-09-26**; this is the single entry
point for U5.

---

## ▶ CURRENT STATE AND NEXT STEP (2026-09-26)

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

### The next step is **probe P-U5-1** — protocol in the plan, §3

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

**Why it gates FR-46**: classifier v2 established that in the AI DJ context the API stops reporting
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
