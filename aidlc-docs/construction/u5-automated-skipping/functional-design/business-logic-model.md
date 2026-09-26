# Business Logic Model — U5: Automated Skipping

**Date**: 2026-09-26 · **Stage**: CONSTRUCTION — Functional Design, U5

How a decision becomes an action, and every place the system refuses to act.

> **U5 is the only unit that can cause harm.** U0–U4, wrong, produce a bad number in a report. This
> one, wrong, interrupts the music. The pipeline below has **six** refusal points and **one** action
> point, and that ratio is the design.

---

## 1. The pipeline

```
 tick (3s)
   │
   ▼
 PlayObserver ──────── owns play segmentation (BR-22.8). U5 does not re-derive it
   │  onPlayStarted
   ▼
 EvaluationCoordinator
   │  waits for enrichment to settle, or ENRICHMENT_WAIT_MS = 10 000 (BR-22.2/22.3)
   │  ⚠️ a play ending before the cap logs NOTHING — 2.8% of plays, 4 of 31 skips
   ▼
 RuleEngine (U3, pure, unmodified) ──── produces a Decision. Never modified by U5
   │
   ├── onUnknown: 'hold'? ──► HOLD until min(label resolved, 30s, 50% duration)   [BR-38]
   │                          then take the FR-35 partial-data path
   ▼
 DecisionExecutor.execute()  ── SYNCHRONOUS, unawaited, called from a timer
   │
   ├── LoggingExecutor ─────► writes decision rows. THE ONLY PATH WHEN AUTOMATION IS OFF
   │
   └── SkipExecutor ────────► writes decision rows, then ENQUEUES a SkipAttempt   [BR-42.2]
                                        │                 (it does NOT post)
                                        ▼
                              ┌──── SkipAttempt queue ────┐
                              │                            │
        re-evaluation may CANCEL a queued attempt  [BR-37.5]
        ⚠️ it may never CREATE one  [BR-37.6]
                              │                            │
                              ▼                            │
 ═══════════════════ THE ACTION POINT ═══════════════════   │
   every refusal below is checked HERE, not at decision time  [BR-33.5]
                              │
   ① automation off?          ──► refused: automation-off        [BR-33.1]
   ② runaway halted?          ──► refused: runaway-halted        [BR-35.4]
   ③ rule in dry-run?         ──► refused: rule-dry-run          [BR-33.2]
   ④ play already attempted?  ──► refused: already-attempted     [BR-36.1]
   ⑤ play already closed?     ──► refused: play-closed           [BR-42.5]
   ⑥ 10 skips this hour?      ──► refused: rate-limited          [BR-35.2]
                              │
                              ▼
   record reportedTrackId + progress_ms BEFORE            [BR-43.2]
                              │
                              ▼
          ⚠️⚠️  POST /me/player/next  — NOT SPECIFIED  ⚠️⚠️
                  see §4. Gated on probe P-U5-1
                              │
                              ▼
   record reportedTrackId + progress_ms AFTER             [BR-43.2]
                              │
                              ▼
   confirm? ⚠️ PROVISIONAL — progress_ms reset + track-id change   [BR-43.5]
        │                                        │
     confirmed                             unconfirmed
        │                                        │
        ▼                                        ▼
   update counters                    SURFACE AS FAILED — never retry  [BR-43.1]
        │
        ▼
   consecutive ≥ 3?  ──► RUNAWAY HALT, global, until acknowledged  [BR-35]
```

---

## 2. The six refusal points, and why they are all at the action point

**Every one of them is checked when the attempt drains, not when the decision was taken.** A decision
is taken up to 10 s before anything could act on it, and FR-38 requires that *no skip is issued after
the switch is thrown*. Checking at decision time would let a skip fire from a decision taken while
automation was still on.

| | Refusal | Correct behaviour or defect? |
|---|---|---|
| ① | `automation-off` | Correct — FR-47's default |
| ② | `runaway-halted` | Correct — the system protecting the listener |
| ③ | `rule-dry-run` | Correct — the arming gate working |
| ④ | `already-attempted` | Correct — BR-36's loop guard |
| ⑤ | `play-closed` | ⚠️ **Either.** Normal for a short play; a signal if it is frequent |
| ⑥ | `rate-limited` | ⚠️ **Probably a defect somewhere.** 10/hr is below the median *play* rate |

⚠️ **All six are recorded, never silent** (BR-36.3). Six causes, four of them correct behaviour and
two of them defects, and a `firedAt` of `null` cannot tell them apart. This is U4's `playLink` lesson:
*why is this absent* must never be inferred from the absence.

---

## 3. What changes in existing code

| | |
|---|---|
| `LoggingExecutor.ts:88` | `dryRun: true` is hardcoded — U4 was all dry-run. Becomes BR-33.2's computed value. ⚠️ `LoggingExecutor` itself is **not** otherwise modified (BR-33.6), and `LoggingExecutor.length === 1` must still pass |
| `EvaluationCoordinator.ts:228` | Gains the re-evaluation trigger (BR-37). The `execute` call **stays synchronous and unawaited** (BR-42.1) |
| `compose.yaml:202` | ⚠️ `./config:/config:ro` → **`:rw`**. U5 is the first unit that writes here |
| `src/playback/` | **New.** Its absence was U4's phase guard; U5 necessarily ends that |
| `outcomeClassifier` | ⚠️ **Untouched.** It is pure, and a `Date.now()` in it breaks FR-20 and FR-42 while every other test passes |
| `RuleEngine` | ⚠️ **Untouched.** Back-tests and live decisions must keep using the same engine |

---

## 4. ⚠️ THE ACTION POINT IS NOT SPECIFIED — probe P-U5-1

**Everything above and below this section is designable now. This is not.**

### Established

In the AI DJ context the API **stops reporting a track 18–41 s before it stops playing** (classifier
v2). `EvaluationCoordinator` takes its play boundary from `PlayObserver`, which consumes `tick` — the
API's notion of the current track. **So the engine opens a decision for track B while track A is still
audible.**

### Not established

⚠️ **Whether `POST /me/player/next` acts on the player's real state or on the same lagged state the
read endpoints report.**

| If the lag is in… | Then… |
|---|---|
| Spotify's **reporting** | The skip fires against a player still on **A** and **truncates an unmatched track the listener was enjoying**, while B plays on unskipped — in the context used **50–70%** of the time |
| Spotify's **state store** | The skip lands on **B**. FR-46 as designed is safe and needs no guard |

**Not inferable from anything this project has. Probe it.**

### Why the confirmation is stuck on the same answer

The obvious check — *is a different track reported now?* — is **exactly the signal the DJ reports
early**. It can return *confirmed* when nothing audible happened. ⚠️ **A confirmation guaranteed to
pass is not a confirmation**: the `inc=releases` 200 and `measure-confound.mjs`'s zeros, a third time.

### ⚠️ Run the probe with the container DOWN

Each trial POSTs `next` 0–3 s into a track. `PlayObserver` closes that play on `track-change` at
near-zero progress, and **both v2 conditions fail** — `unobservedTailMs` is nearly the whole duration
against the 55 s cap, `observedPositionRatio` ~0.01 against the 0.75 rail — so `outcomeClassifier`
records **`skipped`**, `skip_source = 'user'`.

**4–6 trials would inject 4–6 artefact skips into a corpus of 22** — up to **27% contamination of the
entire evidence base** BR-40 depends on. The probe needs no container: it reads `spotify-config.json`
and cannot race the MCP server, because token handling deliberately never writes back.

---

## 5. The two paths, given equal weight (BR-39.7)

R11: lookahead is **context-dependent**. `context.type` cannot distinguish the DJ from a radio
station — both are `type: playlist` with the same `37i9dQZF1E` prefix — so **FR-36 asks the queue at
runtime**.

| | Queue exposed | Path |
|---|---|---|
| Album, autoplay, radio | 7–20 tracks, predicts 8 for 8 in order | **FR-36** pre-warm, depth 3, re-checked each poll |
| **The AI DJ** | **0, always** — 88 of 88 samples | **FR-34/FR-35** — decide on arrival, re-evaluate when enrichment lands |

⚠️ **Neither is a degraded catch-all** (BR-39.7). `requirements.md` still calls FR-34/FR-35 *the
fallback* and the user chose to leave that wording; the rule is that **the word must not license a
weaker implementation**. Build-time check: neither path has error handling, logging or tests the other
lacks.

⚠️ **The DJ path is not relabelled *primary*** despite being 50–70% of current listening — the user's
mix is expected to change (BR-39.8).

---

## 6. Where FR-34's re-evaluation sits, and the cache trap

BR-22.1's *one decision per play* was **scoped to U4** with **no uniqueness constraint** (BR-22.1a)
precisely so this could be added additively.

```
initial decision ──► queued SkipAttempt
       │
       │  slow enrichment lands (a label, behind 1 req/sec)
       ▼
re-evaluation  trigger = 'enrichment-arrived'
       │
       ├── resolves unknown → decided          ✅
       ├── CANCELS a queued attempt            ✅  [BR-37.5]
       └── fires a skip an earlier pass declined ❌  [BR-37.6]
```

The asymmetry is deliberate: the direction that errs toward **not acting** is the safe one.

> ### ⚠️ `FactCache` re-opens here, and a cache would make FR-34 a silent no-op
>
> U3 deferred it to *"the unit that first evaluates rules on the poll path"*; U4 closed it as
> superseded because one decision per play means `historyCountsBefore` runs once. **Re-evaluation is a
> second assembly for the same play** — the case the cache was specified for.
>
> ⚠️ **But the point of re-evaluating is that the facts changed.** A cache serving the first
> assembly's values to the second makes FR-34 do nothing **while every test passes**. If a cache is
> built, it may cache the **point-in-time history counts** and **never the enrichment fields**.

---

## 7. The arming sequence

```
author rule ──► loads, disabled or dry-run
                     │
                     ▼
            back-test (advisory, writes nothing)
            ⚠️ shown WITH ITS n — 22 user skips  [BR-40.3]
                     │
                     ▼
            DRY-RUN PERIOD ── the actual gate  [BR-40.1]
            user reviews the decision log
                     │
                     ▼
               user arms the rule
                     │
                     ▼
        still inert unless globalAutomationEnabled
                  AND NOT runawayHalted           [BR-33.2]
```

⚠️ **No numeric back-test threshold**, on this project's own precedent. The 2026-09-10 gate had 17
skips and its CI ruled out about ±8pp **and nothing smaller**. The back-test has 22: it can catch a
rule that is wildly wrong and **cannot distinguish a good rule from a mediocre one**. A threshold
would be a number that *looks* like a gate; hiding the back-test would be worse. So it is shown, with
its n, and the gate is the human one that already worked here — U4's dry-run review over 65 decisions.

---

## 8. Phase 4's exit criteria — where each is discharged

| | Criterion | Discharged by |
|---|---|---|
| 1 | Automation off by default | BR-33.1 · fresh-install test |
| 2 | Kill switch halts action immediately | BR-34.7 · action-point check |
| 3 | Kill switch **persists across restart** | BR-34.1–34.5 · ⚠️ verified **through the container**, not on the host (BR-34.4) |
| 4 | Rate limit and runaway halt enforced | BR-35 · pre-registered before arming |
| 5 | A failed skip is surfaced, not retried | BR-43.1 · ⚠️ partly gated on P-U5-1 |
| 6 | No skip without a matching armed rule | BR-33.2 · six refusal points |
| 7 | Every action logged with rule, facts and verdict | FR-41 · U4's log plus `SkipAttempt` |

⚠️ **Criterion 3 is the one most likely to pass on the host and fail in the container**, because
`config/` is mounted `:ro` today and the failure looks like a UI bug rather than a mount problem.

---

## 9. Standing hazards for whoever builds this

- **`docker compose down` before anything that writes `history.db`.** A maintenance script is a
  writer. This corrupted the index during U4, reported `integrity_check: ok` at the time, and
  surfaced later as a just-written value reading `null`. ⚠️ `VACUUM INTO` does **not** repair it.
- **Back up `data/` before migration 007** — and ⚠️ **a file copy is not a backup**: `history.db-wal`
  is currently **larger** than `history.db`, so copying the `.db` alone loses over half the corpus.
  Checkpoint the WAL first.
- **`PlayObserver` must consume `tick`, never `change`.** `change` is signature-suppressed and the
  signature excludes progress.
- **Never clamp `completionRatio` to 1.0.** It measures listened time; replaying legitimately exceeds
  1.0.
- **A coverage percentage cannot see a file no test imports.** `test/noOrphanModules.test.ts` catches
  the module case. ⚠️ **It walks modules, not methods** — `recordSuccessorLag` had zero callers for its
  entire life inside a heavily-executed file. BR-43.3 is the same trap waiting to happen again.
- **The app is `http://localhost:3010`.** `localhost:3000` is a different project.
- **Check build exit codes directly.** `npm run typecheck | tail && echo OK` reported success while
  typecheck was failing.
