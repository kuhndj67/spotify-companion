# U5 Handoff — read this before starting Functional Design

**Written 2026-09-22**, at the U4/U5 boundary. Everything committed and pushed; working tree
clean; schema **v6**; container healthy and recording on the U4 image.

> **Where we are**: U4 is **complete, deployed and verified** — all three exit criteria that CI
> could not close are closed. **U5 is the next unit, and it is the only one that can cause harm.**

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

### 1. The outcome variable is half noise, and the back-test does not know it

**This is the most important thing on the page.**

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
| **5** | R11 — queue lookahead unverified during playback. **FR-36 depends on it**, and it has never been probed while music is playing |
| **8** | W-3, session-end discriminator. ⚠️ **Data recovery, not a false-skip repair** — anyone implementing it as stated writes code that does nothing |
| 7 | Playback context never recorded live. The AI DJ is arguably the closest available proxy for *promoted* |

---

## The rule that has not changed

> **Probe the live API. Do not reason from documentation.**

Five wrong conclusions have been drawn from docs in this project, each caught only by a probe.
The fifth was found during U4 and inverts the usual shape: **the project's own note said
`recently-played` returns no `external_ids`, and it does.** A recorded negative decays silently
because nothing re-tests it.

⚠️ **R11 is the one U5 needs and nobody has probed**: whether the queue endpoint returns useful
lookahead *during active playback*. FR-36 is designed on the assumption that it does.
