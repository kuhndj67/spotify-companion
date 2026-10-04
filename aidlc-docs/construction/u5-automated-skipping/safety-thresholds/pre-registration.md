# The BR-35 Runaway Safety Thresholds — Pre-Registration

**Written**: 2026-10-03 · **Stage**: CONSTRUCTION — Unit U5, deployment (step 13)
**Status**: 🔒 **PRE-REGISTERED — written before any rule was armed**

> This document fixes the two safety limits, and what will count as evidence that either is wrong,
> **before automation has ever acted**. At the time of writing `skip_attempt` holds **0 rows** and
> `SKIP_EXECUTOR_ENABLED` is `false`, so no rule-skip has occurred and none can.
>
> ⚠️ **This is not the hypothesis gate and does not borrow its authority.** BR-11.7's confirmatory run
> is spent and nothing here touches it. What this borrows is the *method*: a threshold chosen after
> seeing the data it governs is not a threshold, and a limit that can be raised from the environment
> will be raised at the moment it first refuses something.

---

## 1. The two limits, as deployed

| | Constant | Value | Rule |
|---|---|---|---|
| **Consecutive** | `MAX_CONSECUTIVE_RULE_SKIPS` | **3** | BR-35.1 |
| **Rolling hour** | `MAX_RULE_SKIPS_PER_HOUR` | **10** | BR-35.2 |
| Window | `RULE_SKIP_WINDOW_MS` | 3 600 000 ms, half-open | BR-35.2 |

### ⚠️ THE FOURTH CONSECUTIVE SKIP IS WHAT LATCHES THE HALT, NOT THE THIRD

Added 2026-10-04, after the first live arming. **The counter reads CLOSED plays**, and the skip that
triggers the check has not closed yet — the track change it causes is what closes it. So at the check
following skip N the counter sees at most N−1 closed rule-skips:

| skip | counter sees | halt? |
|---|---|---|
| 1 | 0 | no |
| 2 | 1 | no |
| 3 | 2 | no |
| **4** | **3** | ⚠️ **yes** |

**Four tracks are skipped before automation stops.** This is **inherent to counting closed plays**, not an
implementation slip, and it is **ACCEPTED** (user, 2026-10-04) — on the condition that it is **stated
wherever the threshold is stated.** Anything that says *"3"* without saying *"the 4th skip latches it"*
under-describes the behaviour by one track, and a listener who counts four skips against a stated limit of
three will reasonably conclude the limit is broken.

⚠️ It is stated in: `MAX_CONSECUTIVE_RULE_SKIPS`'s docstring, FC-U5-1's `halted` detail, FC-U5-3's
acknowledgement panel, and pinned by `ruleSkipAgreement.test.ts`.

⚠️ **The threshold itself is unchanged**, so §4's amendment procedure does not apply — this records what
3 has always meant in practice, not a new value.

Both live in `src/playback/types.ts`. ⚠️ **Neither is an environment variable, and that is deliberate
in a file where every other cadence is one** — `POLL_INTERVAL_MS`, `RULES_POLL_INTERVAL_MS`,
`ENRICHMENT_WAIT_MS` and `COMPLETION_THRESHOLD` are all settings. The precedent is the hypothesis
gate's thresholds (*"pre-registered constants, not parameters"*) and `MAX_PREDICATE_DEPTH` (*"only the
PATH is configurable; the bounds are not"*).

**Exceeding either latches `runawayHalt`**, which is a **separate field** from
`globalAutomationEnabled` (BR-33.4) and clears **only** on explicit acknowledgement (BR-35.6).

---

## 2. ⚠️ Which limit is reachable, measured — and the denominator that nearly got this wrong

This must be on the record before the first halt, because afterwards it will look like an excuse.

**Measured 2026-10-03, read-only against the live v7 database (885 plays):**

| | |
|---|---|
| Busiest rolling hour in the corpus | **27 plays** (measured 2026-09-27) |
| So `10/hour` trips above | **~37% of plays at peak listening** |
| Label-resolved plays | **403** — 145 `major`, 258 `independent` |
| The user's broadest armed rule (*skip every major-label release*) matches | **145 of 885 = 16.4%** |

### ⚠️ THE DENOMINATOR IS ALL PLAYS, NOT RESOLVED PLAYS, and the first draft of this file got it wrong

A draft of this section said the rule matches **40%**, from `76 / 192` — both the **stale** gate figures
(2026-09-10, 427 plays) and, worse, the **wrong denominator**. A rule is evaluated against *every* play.
With `onUnknown: 'no-match'`, the 482 plays whose label never resolved **cannot match**, so they belong
in the denominator and they halve the rate: **36.0% of resolved plays is 16.4% of all plays.**

⚠️ That is this project's own standing warning — *"before reporting any rate, ask what is in the
denominator and whether every row in it could have been a success"* — and it nearly went into a
**pre-registration**, the one document whose whole value is that it was not fitted afterwards. Recorded
here rather than quietly corrected.

### What the corrected numbers actually predict

- **`10/hour` is NOT expected to trip on the currently-armed rules.** At 16.4% the broadest of them
  sits at roughly **half** the ~37% peak trip point. ⚠️ A halt on `hourly-rate` from these rules would
  therefore be **surprising**, and §3.1's conditions are written to be hard to meet for that reason.
- **`3 consecutive` IS expected to be reachable, and is the likelier of the two.** 16.4% overall says
  nothing about *adjacency*: three consecutive major-label tracks is an ordinary run inside an album or
  a label-heavy radio station, and `BR-35.9` resets only on a play **not** skipped by a rule. ⚠️ **So
  the consecutive halt is the one the user should expect to meet first.**
- **Neither number is a prediction about a rule that is not yet written.** A broader rule — a genre
  match, or `is-unknown` on a field with 55% coverage — would change both, which is what the arming
  projection (NFR Q6) exists to show **before** arming rather than after.

⚠️ **A halt remains the EXPECTED outcome of arming a broad rule, not evidence of a defect.** The halt
is doing its job when it fires on a rule that would have skipped two tracks in five.

### What follows from that, decided now

1. **A halt does not justify raising the limit.** The first response is to read the rule, not the
   constant. This is why the values are not env vars.
2. **A halt is not a bug report.** `FC-U5-1`'s `halted` state and the acknowledgement panel both say
   what tripped it and name the `skip_attempt` ids, so the user can judge the rule.
3. **Narrowing the rule is the remedy**, and the arming projection (NFR Q6) exists to show the
   expected hourly rate *before* arming, precisely so this is foreseeable rather than discovered.

---

## 3. What would count as evidence that a threshold is WRONG

Stated before any data exists, so it cannot be fitted afterwards.

### 3.1 Evidence that **10/hour is too low**

**All three** must hold:

1. ≥ **3 separate halts** on `hourly-rate`, each from a rule the user **affirms was behaving as
   intended** at the time — recorded in `audit.md` at the moment of each halt, not reconstructed.
2. In each case the rule's match rate over the preceding 7 days is **below 25% of ALL plays** — not of
   label-resolved plays, not of plays where the field was answerable — so the halt came from a burst of
   listening rather than a broad rule. ⚠️ The denominator is named explicitly because getting it wrong
   is what §2 records.
3. The user states that **not** skipping those tracks was worse than skipping them.

⚠️ **Any single one of these alone is not evidence**, and the common case — a broad rule — is excluded
by (2) on purpose.

### 3.2 Evidence that **3 consecutive is too low**

1. ≥ **3 separate halts** on `consecutive`, where in each the three tracks were **genuinely
   consecutive in the feed** (not an artefact of `BR-35.9`'s reset failing), **and**
2. the user affirms all three skips were correct.

⚠️ `BR-35.9` resets the consecutive counter on **any play not skipped by a rule**, so three in a row
means three *adjacent* tracks matched. In a DJ or radio context — 50–70% of listening — that is a
plausible run for a genre rule, which is exactly what this limit is for.

### 3.3 Evidence that either is too **HIGH**

A single occurrence is sufficient, because the cost is asymmetric:

- **Any instance** of the user reporting that automation skipped music they wanted to hear and the
  halt **did not fire soon enough**. One is enough. ⚠️ A skip that should not have happened is **not
  recoverable**; a skip that should have happened and did not costs one button press.

---

## 4. ⚠️ How a change may be made, if the evidence above is met

1. **Amend this document first**, in its own commit, stating the evidence and the new value.
2. Change the constants in `src/playback/types.ts` in a **later** commit.
3. ⚠️ **Never the other way round.** The ordering is what makes this a pre-registration rather than a
   note, and it is a fact on the record rather than a claim in prose — the same discipline as
   `hypothesis-gate/pre-registration.md`, committed at `fd09ad7` five days and 240 plays before the
   comparison it governed.

⚠️ **Do not change a threshold by editing the test.** `PBT-39` asserts the refusal fires at the 10th
rule-skip and `safetyCounters.test.ts` pins both numbers; a test adjusted to match a new constant
records nothing.

---

## 5. What this document does NOT fix

- **Which rules the user arms.** That is theirs, and BR-40.1's dry-run review is the gate.
- **Whether automation is useful at all.** R1 is *not supported* and rules must be valuable without
  it; these limits bound the harm, they do not justify the feature.
- **The `maxUnobservedTailMs` classifier threshold.** Different quantity, different document, and
  that one was explicitly **not** pre-registered — chosen after seeing the tail distribution, which
  is recorded as a limitation rather than hidden.

---

## 6. State at the moment of writing

Verified immediately before committing this document:

| | |
|---|---|
| `skip_attempt` rows | **0** |
| `SKIP_EXECUTOR_ENABLED` | **`false`** — the executor is not constructed |
| `globalAutomationEnabled` | **`false`** — verified in `state/automation-state.json` |
| `runawayHalt` | **`null`** |
| Schema | **v7** · `integrity_check: ok` · 885 plays |
| Rules loaded | 3 — `major-label`, `hip-hop`, `old-and-major`; all `enabled: true`, **`dryRun` absent on all three** ⇒ live-capable, and unreachable only because the executor is unbuilt |

⚠️ **No rule-skip has ever occurred.** Every number in §2 is a projection from plays recorded while
automation was off, which is the back-test's own limitation and is labelled a **projection, not a
prediction** (NFR Q6).
