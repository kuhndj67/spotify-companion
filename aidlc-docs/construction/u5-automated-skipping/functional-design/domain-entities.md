# Domain Entities — U5: Automated Skipping

**Date**: 2026-09-26 · **Stage**: CONSTRUCTION — Functional Design, U5
**Continues from**: U3's `Rule`, `Predicate`, `TrackFacts`, `Decision` · U4's `DecisionLogEntry`

U5 adds no entity to the *rule* model and does not modify `Decision`. It adds the entities that turn
a `Decision` into an **action that can be refused, queued, cancelled, audited and halted**.

> **The shape of every entity here follows from one asymmetry.** A skip that should have happened and
> did not is recoverable — the listener presses a button. A skip that should not have happened is not
> recoverable at all. So every entity below can express *refused*, and none of them can express
> *retried*.

---

## 1. `SkipAttempt` — the action, as a record rather than a side effect

⚠️ **This entity exists because of BR-42.** `DecisionExecutor.execute` is **synchronous**
(`LoggingExecutor.ts:31`) and is called unawaited from a timer
(`EvaluationCoordinator.ts:228`); an HTTP `POST` cannot live there. So `SkipExecutor.execute`
**enqueues a `SkipAttempt` and returns**, and a separate asynchronous path drains it.

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Surrogate key |
| `evaluationId` | string | ⚠️ **THE GUARD KEYS ON THIS** (BR-36.1), not on `playId`. Created once per play in `onPlayStarted`, shared by both decision passes, and available **while the play is open** |
| `playId` | `Maybe<number>` | ⚠️ **AMENDED 2026-10-02 — nullable.** This said *non-nullable: an attempt without a play has nothing to be one-per*. The reasoning was sound and the conclusion **impossible** — see the note below |
| `trackId` | string | The track the **rule matched** |
| `ruleId` | string | The rule that caused it |
| `state` | `SkipAttemptState` | See below. The whole entity is this field plus its evidence |
| `enqueuedAt` | ISO-8601 | When the decision resolved to *act* |
| `firedAt` | `Maybe<ISO-8601>` | When the `POST` was issued. `null` while queued or if refused |
| `refusedReason` | `Maybe<RefusalReason>` | ⚠️ **Why nothing happened.** Never inferred from `firedAt` being null |
| `reportedTrackIdBefore` | `Maybe<string>` | BR-43.2 — the evidence fields |
| `reportedProgressMsBefore` | `Maybe<number>` | BR-43.2 |
| `reportedTrackIdAfter` | `Maybe<string>` | BR-43.2 |
| `reportedProgressMsAfter` | `Maybe<number>` | BR-43.2 |

### `SkipAttemptState`

| State | Meaning |
|---|---|
| `queued` | Enqueued, not yet drained |
| `cancelled` | A re-evaluation withdrew it before it fired (BR-37.5) |
| `refused` | The action point declined it. `refusedReason` says why |
| `fired` | The `POST` was issued |
| `confirmed` | ✅ `progress_ms` reset **+** a track-id change, with a **~3 s grace** (BR-43.3/43.4, validated by P-U5-1) |
| `unconfirmed` | Fired, and the confirmation did not hold. **Treated as failed and surfaced, never retried** (BR-43.5) |

### `RefusalReason`

| Reason | Source |
|---|---|
| `automation-off` | BR-33.1 |
| `runaway-halted` | BR-35.4 |
| `rule-dry-run` | BR-33.2 |
| `already-attempted` | BR-36.1 — one attempt per play |
| `play-closed` | BR-42.5 — the play ended while queued |
| `rate-limited` | BR-35.2 |

> ### ⚠️ AMENDED 2026-10-02: `playId` is nullable, and the guard keys on `evaluationId`
>
> This document specified `playId` **non-nullable**, reasoning that *"an attempt without a play has
> nothing to be one-per (BR-36.1)"*. **The reasoning is sound and the conclusion was impossible.**
>
> `PlayObserver` writes the play row in `recordPlay`, which runs when the play **closes**, and only
> then fires `onPlayRecorded`. **A skip must happen while the play is still playing**, so at the action
> point there is no `playId` to record. `NOT NULL` would have thrown a constraint violation on the
> first real skip — in the one unit whose failures are audible.
>
> ✅ **The guard keys on `evaluationId` instead**, which is created once per play in `onPlayStarted`,
> is shared by both decision passes, and exists throughout the play. One attempt per `evaluationId` is
> one attempt per play, exactly as BR-36.1 intends. `playId` is **backfilled** when the play closes,
> exactly as `DecisionLogEntry.playId` already is, so the analysis join is unchanged.
>
> ⚠️ **Found while writing the drain (Step 6), before migration 007 had ever run** — so the schema was
> amended rather than migrated twice. The user chose this resolution over writing the play row at play
> start, which would have rewritten the write path of the one table that cannot be regenerated.

> ### ⚠️ `refusedReason` is a first-class field for the same reason `playLink` was in U4
>
> U4 learned this: `playId` nullable **plus** an explicit `playLink` enum, because *"why is this
> absent"* must never be inferred from the absence itself. The same applies here, and more sharply —
> a skip that did not happen has **six** plausible causes, four of them correct behaviour and two of
> them defects. A `firedAt` of `null` cannot distinguish *the user had automation off* from *the
> queue drained too late*. **`null` means unknown and is never `false` or `0`.**

> ### ✅ `confirmed` IS now defined — P-U5-1 settled it, 2026-09-27
>
> This section used to say the predicate could not be written, on the grounds that *"the reported
> track changes 18–41 s before the audible one"*, so the obvious check could pass when nothing
> audible happened. ⚠️ **Both halves of that were wrong.** The predicted hazard is **false** — audio
> follows the reported boundary within **~2 s** — and the mechanism was **backwards**: the API never
> lagged, **the DJ stops *playing* 18–50 s early and reports it accurately** (`B@first`: ~1 s in
> radio/album, up to **23.6 s** in the DJ).
>
> So the predicate is **`progress_ms` reset AND a track-id change**, with a **~3 s grace** — a check
> at +1.5 s can precede the audio (BR-43.3/43.4).
>
> ⚠️ **What has NOT become safe is assuming a fixed offset.** The DJ has at least three transition
> behaviours and `dj-talk`'s audio lag is **negative** (−6.9 s), so even the *sign* varies and nothing
> in the API predicts which is coming (BR-43.6). The grace is a tolerance, never a compensation.

---

## 2. `AutomationState` — the persisted latches

Two independent latches, one file. ⚠️ **They are separate fields and must not be collapsed into
one** (BR-35.5): the user turning automation off and the system halting itself are different facts,
and clearing them are different acts.

| Field | Type | Notes |
|---|---|---|
| `globalAutomationEnabled` | boolean | FR-47. **Defaults to `false`** |
| `runawayHalt` | `Maybe<RunawayHalt>` | `null` when not halted. Present ⇒ halted |
| `schemaVersion` | number | So a future format change is detectable rather than silently misread |

**Persistence** (BR-34.1–34.5):

| | |
|---|---|
| Location | **`/state/automation-state.json`** ⚠️ **amended 2026-10-01** — was `config/` |
| Write | Write-temp-then-rename, **atomic** |
| ⚠️ Mount | **`./state:/state:rw`**, a **directory** mount, new in U5. `config/` stays **`:ro`** |
| Read failure | ⚠️ **Fails closed.** Missing, unparseable or partial ⇒ automation **off** |

> ### ⚠️ AMENDED 2026-10-01: this unit writes to a NEW `./state` mount, not to `config/`
>
> This section used to say U5 was the first unit that writes to `config/` and that the mount must
> become `:rw`. **Infrastructure Design Q1 reversed that**, because `:rw` on `config/` grants
> permission to overwrite the user's hand-authored `rules.json` — which no U5 code would use.
>
> **A single-file bind mount binds an inode.** Write-temp-then-rename *replaces* the inode, so through
> a single-file mount the rename either fails or silently detaches the container's view from the host
> file. ⚠️ **`./state` must therefore be a DIRECTORY mount**, for the same reason `config/` and `data/`
> are.
>
> ⚠️ **The latent failure moved with the file rather than disappearing.** An unwritable `./state`
> presents as a kill switch that works in the UI and does not persist — **the worst failure mode this
> control could have.** `probeWritable` (LC-29) tests it at startup, and verification must write
> **through the container**, never on the host.

---

## 3. `RunawayHalt` — the third latch

| Field | Type | Notes |
|---|---|---|
| `haltedAt` | ISO-8601 | When it tripped |
| `trigger` | `'consecutive' \| 'hourly-rate'` | Which threshold (BR-35.1 / BR-35.2) |
| `observedCount` | number | What was counted when it tripped |
| `threshold` | number | The limit in force **at that moment** — denormalised on purpose |
| `attemptIds` | readonly number[] | The `SkipAttempt` rows that counted, so BR-35.8's review has something to open |

⚠️ **Clears on explicit acknowledgement only** — never on a timer, never on restart, never on a
rules-file reload (BR-35.6). Acknowledgement sets it to `null` and is a **separate act** from
enabling automation.

> ### ⚠️ `threshold` is stored, not looked up, and that is the BR-11 lesson
>
> The thresholds are **pre-registered safety limits, not tuning parameters**. Storing the value in
> force at the moment of the halt means a later change to the constant cannot silently rewrite
> history — and if someone does raise the number after a halt, the record shows that the halt was
> against the old one. The gate's pre-registration exists for the same reason.

---

## 4. `SafetyCounters` — derived, never stored

⚠️ **Not persisted, and that is a decision.** These are computed from `SkipAttempt` rows on demand.

| Counter | Definition |
|---|---|
| `consecutiveRuleSkips` | Rule-skips on consecutive plays, reset by any play not skipped by a rule (BR-35.9) |
| `ruleSkipsInLastHour` | A **rolling** hour, not a calendar hour (BR-35.9) |

**Only `skip_source = 'rule'` counts. A user's own skips never trip a halt** (BR-35.3).

> ### ⚠️ Why derived rather than stored
>
> A stored counter is a second source of truth that can drift from the rows it summarises, and the
> drift is invisible: the counter reads plausible either way. **Store observations; derive
> judgements** — the same rule that keeps observation trails so verdicts can be recomputed. The cost
> is a query per action point, over a table bounded by the 100,000-row retention cap.
>
> ⚠️ **The consequence to accept**: counters reset on restart, because `consecutiveRuleSkips` is
> derived from plays and a restart interrupts the sequence. The **halt itself persists** (BR-35.7),
> which is the part that matters. A restart cannot clear a halt; it can only clear the count that
> would have led to one.

---

## 5. Migration 007 — additive only

⚠️ **Additive means new columns and new tables. No drops, no rewrites, no backfills of a guess.**
The by-image rollback guarantee depends on it (BR-37.4).

### `decision_log` — one new column

| Column | Type | Notes |
|---|---|---|
| `trigger` | text | `initial` \| `enrichment-arrived`. ⚠️ Existing 195 rows are `initial` by construction — set by **default**, not by a judgement about them |

⚠️ **No uniqueness constraint may be added** on `playId`, `(playId, ruleId)` or `evaluationId`-per-play
(BR-22.1a, BR-37.2). U4 deliberately created none so that this migration could stay additive.

### `play` — ONE new column

| Column | Type | Notes |
|---|---|---|
| `context_uri` | text | Nullable. ⚠️ **Goes stale** — necessary, not sufficient (BR-41.4) |

⚠️ **CORRECTED 2026-10-02: `context_type` is NOT new.** It has existed since the **v1** schema and is
already populated on backfilled rows (86 `playlist`, 2 `artist`; `null` on all 765 live plays). What U5
adds is **populating it on live plays** — the MCP `getNowPlaying` returns no context, so the field was
available exactly where the outcome variable was not. Re-adding the column would fail the `ALTER` and
abort migration 007.

⚠️ **All 577 existing live plays stay `null`.** `null` is *unknown* and is never backfilled with a
guess — and `recently-played` cannot supply it retroactively for a play it has aged out of.

### `skip_attempt` — new table

Holds `SkipAttempt` (§1). ⚠️ **Not a column on `play`**: a play may have an attempt that was
*refused*, and BR-36.3 requires that to be distinguishable from a play never attempted. Columns on
`play` would force one row's worth of state into the play and lose the refusal.

> ### ⚠️ Back up `data/` before running this — and a file copy is not a backup
>
> ✅ **The tooling now exists** (2026-09-27): `npm run db:backup -- --label before-migration-007`,
> then `npm run db:restore -- <dir> --verify-only`. Round trip rehearsed end to end.
>
> ⚠️ **The "less than half the corpus" figure was WRONG and is corrected.** The WAL really can be
> larger than the `.db` (3673 KB vs 3396 KB, re-measured 2026-09-27), but the inference was false: a
> `.db`-only copy held **824 of 850 plays**. WAL size tracks **page churn**, not row count.
> ⚠️ **The corrected reading is worse** — 3% lost, confined to the *newest* rows, reporting
> `integrity_check: ok`. Checkpoint first still stands; only the reason changes.
>
> ⚠️ **And for this migration specifically, `integrity_check` alone will not tell you the backup is
> complete.** A backup with one play deleted returns `ok`. The manifest's per-table counts are what
> catch that, which is why `backup-history.mjs` introspects `sqlite_master` rather than listing
> tables — **it has to be able to count `skip_attempt`, a table it was written before.**
>
> ⚠️ **`docker compose down` first.** A maintenance script is a writer. Doing this during U4 corrupted
> the index, reported `integrity_check: ok` at the time, and surfaced later as a just-written value
> reading `null`. **`VACUUM INTO` does not repair it** — it rebuilds from the b-tree it is given and
> produced worse damage in a fresher-looking file.
>
> A minimal backup **and verified restore** is a prerequisite for this migration (plan §4). Backlog
> **W-5** is the full-inventory version.

---

## 6. `skip_source` — inherited, and still what U5 needs

`skip_source` (`user` \| `rule`) already exists and was **untouched** by classifier v2's retirement of
`skip_attribution`. It is the field BR-35.3 counts on and the field that keeps a user's own skips out
of the runaway thresholds.

⚠️ **`skip_attribution` is retired and its column is nulled, not dropped** — dropping it breaks
by-image rollback. `skipAttribution.ts` is a tombstone carrying the history. **Do not reintroduce it**,
and do not read it: classifier v2 subsumes it, and the two rules could contradict each other.

---

## Entities deliberately NOT added

| | Why |
|---|---|
| A `Session` entity | ⚠️ **FR-40 was amended precisely to avoid needing one** (BR-36.6). The corpus has no session concept, and BR-36's per-play guard needs none. Introducing one to satisfy the withdrawn clause would re-import the problem the amendment removed |
| A stored `SafetyCounters` row | §4 — derived. A second source of truth that drifts invisibly |
| A context **rule field** | BR-41.3/41.5 — `context_uri` goes stale, and a rule over it would classify algorithmic placement as album playback, in the direction that hides R1 |
| A retry entity or attempt counter > 1 | BR-36.4, FR-48 — **surface, do not retry.** There is no budget to count |
| A modified `Decision` | U3 built it for this. U4 stored one without changing it; U5 acts on one without changing it |
