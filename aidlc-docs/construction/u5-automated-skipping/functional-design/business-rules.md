# Business Rules — U5: Automated Skipping

**Date**: 2026-09-26 · **Stage**: CONSTRUCTION — Functional Design, U5

Numbered, individually testable. Every rule states its source. Numbering continues from U4, which
ended at **BR-32.4**.

**Settled parameters** (design plan §5.1): dry-run is the arming gate, back-test advisory only ·
pre-warm depth 3, asked at runtime · re-evaluation may cancel, never escalate · `hold` until
`min(label resolved, 30 s, 50% of duration)` · kill switch in `config/`, fails closed · runaway halt
at 3 consecutive / 10 per hour, global, acknowledged · one skip attempt **per play row** ·
`context_type` recorded as evidence only · migration **007**, additive.

> ### The rule that governs the other rules
>
> **U5 acts, so U5 refuses.** Every other unit, wrong, produces a bad number in a report; this one,
> wrong, interrupts the music. Where a rule below could be written permissively or restrictively,
> it is written restrictively, and the asymmetry is deliberate rather than cautious-by-habit:
> **a skip that should have happened and did not is recoverable by the listener pressing a button.
> A skip that should not have happened is not recoverable at all.**

> ### ✅ BR-43 was deliberately empty until 2026-09-27; probe P-U5-1 filled it
>
> FR-46's action point and FR-48's confirmation were left unspecified rather than guessed. **P-U5-1
> settled both**, and the answer was that **the predicted hazard is false**: audio follows the reported
> track boundary within ~2 s, so a skip there costs 2–3 s, not 18–41 s.
>
> ⚠️ **And the original hypothesis was backwards.** The API never lagged — the DJ stops *playing* a
> track 18–50 s early and reports that accurately. Classifier v2's **fix stands; its stated mechanism
> does not.** See BR-43.

---

## BR-33: Automation enablement and precedence

| # | Rule | Source |
|---|---|---|
| **BR-33.1** | Automation is **off by default**. A fresh install, a missing state file and an unreadable state file all mean **off** | FR-47, Q5 |
| **BR-33.2** | A rule is live only when **every** term holds: `globalAutomationEnabled AND NOT runawayHalted AND rule.enabled AND NOT rule.dryRun` | U5 handoff, Q6 |
| **BR-33.3** | A rule **cannot** opt out of a global dry-run. `dryRun` at the rule level can only ever *add* restriction | BR-25.2 |
| **BR-33.4** | `runawayHalted` is a **separate latch from `globalAutomationEnabled`**, never a write to it | Q6 — see BR-35.5 |
| **BR-33.5** | The predicate in BR-33.2 is evaluated **at the action point**, not at the moment the decision was taken | Q5.2 |
| **BR-33.6** | `LoggingExecutor` remains a complete `DecisionExecutor` and is **not modified to skip**. `SkipExecutor` is a second implementation, selected by configuration | BR-30 |
| **BR-33.7** | The test asserting `LoggingExecutor.length === 1` must still pass at the end of U5 | U4 phase guard |

> ### ⚠️ BR-33.5 is the whole reason the action is queued rather than immediate
>
> `LoggingExecutor.ts:88` currently hardcodes `dryRun: true`, because in U4 everything was dry-run.
> U5 replaces that constant with BR-33.2's computed value. **But a decision is taken up to 10 s
> before anything could act on it** (`ENRICHMENT_WAIT_MS`), and FR-38 requires that *no skip is
> issued after the switch is thrown*. Checking at decision time would allow a skip to fire from a
> decision taken while automation was still on. **The check must happen when the action fires.**

---

## BR-34: The kill switch (FR-38)

| # | Rule | Source |
|---|---|---|
| **BR-34.1** | Persisted to **`config/automation-state.json`** | Q5 |
| **BR-34.2** | Written by **write-temp-then-rename**, never in place | Q5.3 |
| **BR-34.3** | ⚠️ `config/` is mounted as a **directory**, and must stay so. A single-file mount binds an **inode**, and an atomic rename either fails or silently detaches the container's view from the host file | CLAUDE.md |
| **BR-34.4** | ⚠️ The mount is currently **`:ro`** (`compose.yaml:202`). U5 is the **first unit that writes to `config/`**, so the mount must become `:rw`. Until it does, every save fails | measured 2026-09-26 |
| **BR-34.5** | **Fails closed.** Missing, unparseable, or partially-written state ⇒ automation **off**. A corrupt file must never be a path to *on* | Q5.4, FR-47 |
| **BR-34.6** | Exposed as **a button on the Rules pop-up** and **an API route**. ⚠️ Not on the primary screen — it stays as clean as possible | Q5 (user) |
| **BR-34.7** | "Immediately" means **no skip is issued after the switch is thrown** — a guarantee about the action point, not about the 3 s poll | Q5.2 |
| **BR-34.8** | Throwing the switch **never cancels the decision log**. Evaluation and recording continue; only action stops | FR-41 |

> ### ⚠️ BR-34.4 is a latent failure U3 and U4 could not have found
>
> CLAUDE.md already predicted it: *"U3 only reads, so the bug is invisible here and would surface
> the first time the U4 rule editor saves."* U4 shipped a **read-only** panel, so it still has not
> surfaced. **U5 is where it comes due**, and it will present as a kill switch that appears to work
> in the UI and does not persist — the worst possible failure mode for this particular control.
> Verify by writing through the container, not on the host.

---

## BR-35: The runaway halt (FR-39)

**Pre-registered thresholds.** ⚠️ These are **safety limits, not tuning parameters**. If a
legitimate rule trips the halt, that is information about the rule. Raising the number to make a
favourite rule work is the failure mode, and BR-11's precedent is why they are fixed in writing
before anything is armed.

| # | Rule | Source |
|---|---|---|
| **BR-35.1** | Halt when **3 consecutive** plays are skipped by rules | Q6 — corpus longest user run is **2** |
| **BR-35.2** | Halt when **10 rule-skips in a rolling hour** are reached | Q6 — median *play* rate is 12/hr |
| **BR-35.3** | Only skips with `skip_source = 'rule'` count toward either. A user's own skips never trip it | FR-23 |
| **BR-35.4** | The halt is **global** — every rule, not the one that tripped. A runaway is evidence the *system* misjudged | Q6 = (c) |
| **BR-35.5** | It is a **third latch**, distinct from BR-34's kill switch. Automation is live only when **neither** is set | Q6 (user declined option b) |
| **BR-35.6** | Clears on **explicit user acknowledgement only** — never on a timer, never on restart, never on a rules-file reload | Q6 = (c) |
| **BR-35.7** | **Persists across restart**, alongside BR-34's state, and **fails closed** on an unreadable file | Q6, BR-34.5 |
| **BR-35.8** | The acknowledgement surface states **what tripped it and which rule-skips counted**, linking the decision log | Q6 — *"the user should review"* |
| **BR-35.9** | The consecutive counter resets on any play **not** skipped by a rule. The hourly counter is a rolling window, not a calendar hour | BR-35.1/2 |

> ### ⚠️ Why BR-35.5 exists, and why implementing the halt as a kill-switch write is wrong
>
> Q6's option (b) — *throw the global kill switch* — was explicitly declined. It is worth recording
> the consequence, because collapsing the two latches is the obvious simplification and it destroys
> two distinctions:
>
> 1. **The user could not tell the system's halt from their own choice.** One flag, two causes.
> 2. **Clearing it would read as re-arming rather than acknowledging.** The user turning automation
>    back on and the user saying *"I have reviewed the runaway"* are different acts, and BR-35.6
>    requires the second one specifically.

---

## BR-36: The loop guard (FR-40, amended)

⚠️ **FR-40 was amended 2026-09-26.** *"Never skip the same track twice within one session"* is
**withdrawn**; the requirement is now *a failed skip must not loop — at most one skip attempt per
play*. See `requirements.md` §FR-40.

| # | Rule | Source |
|---|---|---|
| **BR-36.1** | **At most one skip attempt per play row.** The second attempt against the same play is refused | FR-40 as amended, Q7 |
| **BR-36.2** | ⚠️ The guard is keyed on the **play**, never on `track_id`. A recurring track is a **new play** and remains fully skippable | Q7 (user) |
| **BR-36.3** | The refusal is **recorded**, not silent. A play whose skip was refused for this reason is distinguishable from one never attempted | FR-48 |
| **BR-36.4** | The guard holds **regardless of whether the attempt succeeded**. One attempt is the budget; a failed attempt does not earn a retry | FR-48 — *surface, do not retry* |
| **BR-36.5** | It survives a restart in the sense that matters: a play row is closed by then, so no attempt can be made against it at all | BR-36.1 |
| **BR-36.6** | No definition of *"session"* exists anywhere in U5, and none may be introduced to satisfy FR-40 | Q7 |

> ### ⚠️ Why the withdrawn clause was wrong, not merely unnecessary
>
> Suppressing a skip because the same `track_id` was attempted earlier would refuse a rule the user
> authored, silently, for a track they chose to hear again. **That is the same class of error as
> clamping `completionRatio` to 1.0** — hygiene that destroys signal. The user's words:
> *if it DOES happen and the rules say skip the track, we should skip the track.*
>
> And the loop the requirement actually guards is **more** likely than it looked, not less: §3's
> reporting lag means an ineffective skip may not announce itself, and BR-43 records that the
> obvious confirmation check cannot reliably detect one. **BR-36 is the backstop that holds however
> P-U5-1 resolves**, which is why it is specified now rather than after the probe.

---

## BR-37: Re-evaluation (FR-34) and the BR-22.1 relaxation

| # | Rule | Source |
|---|---|---|
| **BR-37.1** | BR-22.1's *one decision per play* was **scoped to U4**. U5 may write a second decision for the same play | BR-22.1a, Q3 |
| **BR-37.2** | ⚠️ No uniqueness constraint may be added on `playId`, `(playId, ruleId)` or `evaluationId`-per-play. BR-22.1a already forbids it and stays in force | BR-22.1a |
| **BR-37.3** | Migration **007** adds a `trigger` column: `initial` \| `enrichment-arrived` | Q3 |
| **BR-37.4** | Migration 007 is **additive only** — new columns and new tables, no drops, no rewrites. The by-image rollback guarantee depends on it | Q3 |
| **BR-37.5** | A re-evaluation may resolve `unknown` → decided, and may **cancel a pending skip** | Q3 |
| **BR-37.6** | ⚠️ A re-evaluation may **never** fire a skip that an earlier evaluation declined. The asymmetry is the point | Q3 |
| **BR-37.7** | Re-evaluation is only meaningful **before the action fires**. Once a skip has been issued there is nothing to reverse | Q3 |
| **BR-37.8** | A re-evaluation writes its own log rows with `trigger = 'enrichment-arrived'`; it never rewrites the `initial` rows | FR-41, BR-37.4 |

> ### ⚠️ `FactCache` (LC-12, P-16) re-opens here, and U4 closed it for a reason that no longer holds
>
> U3 deferred it to *"the unit that first evaluates rules on the poll path"*. U4 closed it as
> superseded: with one decision per play, `historyCountsBefore` is called once and a cache saves
> nothing. **BR-37.5 means a second fact assembly for the same play**, which is exactly the case
> the cache was specified for. Recorded in `u4-code-generation-plan.md` Q1.
>
> ⚠️ **But a cache across a re-evaluation is a correctness question, not only a performance one.**
> The point of re-evaluating is that *the facts changed*. A cache that serves the first assembly's
> values to the second would make FR-34 a no-op **while every test passes**. If a cache is built,
> what it may cache is the **point-in-time history counts**, never the enrichment fields.

---

## BR-38: `hold` (FR-33, completed)

`onUnknown: 'hold'` currently loads a rule **disabled with a reason** (U3). U5 is where the promise
comes due.

| # | Rule | Source |
|---|---|---|
| **BR-38.1** | A rule declaring `onUnknown: 'hold'` **loads enabled** once U5 ships. No re-authoring is required — that was the point of storing it disabled | FR-33, U3 |
| **BR-38.2** | Hold expires at **`min(label resolved, 30 000 ms, 50% of track duration)`** | Q4 |
| **BR-38.3** | ⚠️ The cap is expressed in **milliseconds**. The duration term is a *second, independent* bound, not a re-expression of the first | Q4, CLAUDE.md |
| **BR-38.4** | On expiry the rule takes the **FR-35 partial-data path** and the decision is marked `partialData` | Q4, BR-22.4 |
| **BR-38.5** | ⚠️ `ENRICHMENT_WAIT_MS = 10 000` is **not** reused as the hold deadline. It is measured-correct for U4's purpose; a label behind a 1 req/sec queue can take far longer | Q4 |
| **BR-38.6** | ⚠️ `ENRICHMENT_WAIT_MS` must **not** be lowered on the median. An earlier read of the same data (max 6.9 s) suggested 7–8 s was safe; the tail then moved to 9.0 s | U5 handoff |
| **BR-38.7** | Holding past the point the track has finished is pointless and is not done. A play that closes while held logs the hold and no action | BR-22.7 |
| **BR-38.8** | `applyOnUnknown`'s switch keeps **no `default:` clause**. Adding an `OnUnknown` member must stay a compile error at the site that has to change | U3 |

---

## BR-39: Pre-warming (FR-36)

R11 is discharged: lookahead is **context-dependent**. Album, autoplay and radio expose 7–20 tracks
and predict correctly (8 for 8, in order, across a context boundary). **The AI DJ exposes none,
ever** — 0 on all 88 samples, including at track boundaries.

| # | Rule | Source |
|---|---|---|
| **BR-39.1** | FR-36 **asks the queue at runtime**, every poll, and adapts to the answer | R11, Q2 |
| **BR-39.2** | ⚠️ Lookahead is **never inferred from `context.type`**. The DJ and a radio station are both `type: playlist` with the same `37i9dQZF1E` prefix | R11 |
| **BR-39.3** | ⚠️ Nor from *"algorithmic"*. Autoplay and radio are algorithmic and fully exposed | R11 |
| **BR-39.4** | Pre-warm depth is **3**, re-checked each poll — not the 20 the queue may offer | Q2 |
| **BR-39.5** | Pre-warming **yields to label resolution for live plays**. It may never starve the 1 req/sec MusicBrainz queue that the current track's own verdict depends on | Q2 |
| **BR-39.6** | An empty queue is **normal, not an error**, and is not logged as a failure | R11 — the DJ, always |
| **BR-39.7** | The FR-34/FR-35 path and the FR-36 path get **equal design attention**. Neither may be built as a degraded catch-all | Q2 (user) |
| **BR-39.8** | ⚠️ The DJ path is **not** relabelled *primary*, despite being 50–70% of current listening. The user's listening mix is expected to change | Q2 (user) |

> ### ⚠️ BR-39.7 is a design-quality rule, and it is enforceable
>
> `requirements.md` still calls FR-34/FR-35 *the fallback*, and the user chose to leave that wording
> alone. The rule that matters is the one above: **the word must not license a weaker
> implementation.** The check at build time is that neither path has error handling, logging or
> tests the other lacks.

---

## BR-40: The arming gate (FR-37, FR-42)

| # | Rule | Source |
|---|---|---|
| **BR-40.1** | **Dry-run is the gate.** A rule must run in dry-run and have its decisions reviewed by the user before it may be armed | Q1 = C |
| **BR-40.2** | The back-test number is **advisory** and is shown at arming time. It carries **no threshold** and cannot block or permit arming | Q1 = C |
| **BR-40.3** | ⚠️ The back-test is displayed **with its n**. A bare agreement percentage over 22 events invites the reading the 2026-09-10 gate's CI forbids | Q1 |
| **BR-40.4** | `BackTestService` continues to **write nothing** | U4 |
| **BR-40.5** | Arming is **per rule**, and is recorded with a timestamp | FR-47 |

> ### ⚠️ Why no numeric back-test threshold, on this project's own precedent
>
> The 2026-09-10 hypothesis gate had **17** skips and its pre-registration said *in advance* that it
> would find a strong effect or nothing. It found nothing, and the CI ruled out about ±8pp **and
> nothing smaller**. The back-test now has **22**. It has the same character: it can catch a rule
> that is wildly wrong, and it **cannot distinguish a good rule from a mediocre one**.
>
> A threshold over 22 events would be a number that *looks* like a gate. Hiding the back-test
> entirely would be worse — it is genuinely informative about gross errors. So it is shown, with its
> n, and the gate is the human one that has already demonstrated it works here: U4's dry-run review
> over 65 decisions.

---

## BR-41: Recording playback context (Q9, open item 7)

| # | Rule | Source |
|---|---|---|
| **BR-41.1** | Migration 007 records **`context_type`** and **`context_uri`** on live plays | Q9 |
| **BR-41.2** | Source is `GET /me/player/currently-playing`. The MCP `getNowPlaying` returns no context field | Q9, open item 7 |
| **BR-41.3** | **Evidence only.** No rule field is exposed over context in U5 | Q9 |
| **BR-41.4** | ⚠️ `context_uri` **goes stale** — it named an album through 33 minutes of autoplay by other artists. It is necessary but **not sufficient** to identify a context | R11 |
| **BR-41.5** | A rule written over context would classify algorithmic placement as album playback — wrong, and wrong in the direction that **hides** what R1 is about. That is why BR-41.3 is a rule and not a preference | Q9 |
| **BR-41.6** | `null` remains **unknown** and is never backfilled with a guess. All 577 existing live plays stay `null` | CLAUDE.md |

---

## BR-42: The executor contract

⚠️ **Found while writing this document, 2026-09-26.** `DecisionExecutor.execute` returns
**`string`**, not `Promise<string>` (`LoggingExecutor.ts:31`), and `EvaluationCoordinator` calls it
**synchronously and unawaited** (`EvaluationCoordinator.ts:228`). A `SkipExecutor` must issue an
HTTP `POST`, which is asynchronous. **The contract as it stands cannot express U5's action.**

| # | Rule | Source |
|---|---|---|
| **BR-42.1** | `execute` **stays synchronous** and keeps returning the `evaluationId` | BR-33.6, U4 |
| **BR-42.2** | `SkipExecutor.execute` writes the decision rows and **enqueues a `SkipAttempt`**. It does not perform the `POST` | settled 2026-09-26 |
| **BR-42.3** | The `POST` is performed by a separate asynchronous path that drains the queue | BR-42.2 |
| **BR-42.4** | BR-33.2's predicate is evaluated **when the attempt is drained**, never when it was enqueued | BR-33.5 |
| **BR-42.5** | A queued attempt for a play that has since closed is **discarded, and the discard is recorded** | BR-36.3, BR-38.7 |

> ### ⚠️ Why not simply make `execute` async
>
> Making it `Promise<string>` is the obvious move and it was rejected for three reasons:
>
> 1. It changes `LoggingExecutor`'s signature to serve a collaborator it does not have, which is
>    what **BR-30 exists to prevent** — *added alongside, never grown out of*.
> 2. The coordinator's tick handler would become async, and an unawaited promise inside a **timer**
>    is how a swallowed rejection becomes a skip that silently never happened.
> 3. ⚠️ **It would put the safety check in the wrong place.** An awaited `execute` checks the kill
>    switch where the decision is taken; BR-33.5 requires it where the action fires. Queueing makes
>    the right place the only place.
>
> The queue also makes BR-37.5's *"may cancel a pending skip"* implementable rather than aspirational
> — there is a pending entry to cancel.

---

## BR-43: FR-46's action point and FR-48's confirmation — ✅ RESOLVED by probe P-U5-1

⚠️ **This section was deliberately empty until 2026-09-27.** It is now settled by measurement, not
reasoning. Record:
[`../probes/p-u5-1-transition-behaviour-2026-09-27.md`](../probes/p-u5-1-transition-behaviour-2026-09-27.md).

### ✅ The hazard the design plan predicted is FALSE

The plan predicted that a skip at the reported boundary would truncate **18–41 s** of a track the
listener was enjoying, in the context used 50–70% of the time. **It does not.** Measured across three
contexts:

| | AI DJ (n=8) | radio (n=3) | album (n=4) |
|---|---|---|---|
| **audio lag** behind the reported flip | **+0.9 to +2.2 s** | −0.3 to +0.5 s | −0.4 to −0.5 s |
| reported tail | 1.4 – 50.9 s | 0.0 – 0.7 s | 0.0 – 0.3 s |
| `B@first` | 0.6 – **23.6 s** | 0.0 – 0.7 s | 0.8 – 1.2 s |

**A skip at the reported boundary costs at most ~2–3 s of the outgoing track.**

⚠️ **The reason is that the original hypothesis was backwards.** The API was never lagging: **the DJ
stops *playing* the track 18–50 s before its nominal end**, and the API reports that accurately. See
the classifier-v2 correction below.

| # | Rule | Source |
|---|---|---|
| **BR-43.1** | The action point **fires on the reported track boundary**. No lag guard, no compensating delay | P-U5-1 |
| **BR-43.2** | Every skip attempt records the reported **track id and `progress_ms` before the `POST`, and the same pair after** | Q8, retained |
| **BR-43.3** | A skip is **confirmed** by `progress_ms` **resetting** *and* a track-id change | Q8, validated |
| **BR-43.4** | ⚠️ Allow a **~3 s grace** before judging a skip unconfirmed. A check at +1.5 s can precede the audio | P-U5-1 |
| **BR-43.5** | An unconfirmed skip is **failed** — **surfaced, never retried** | FR-48, FR-40 |
| **BR-43.6** | ⚠️ **No fixed timing offset may be assumed anywhere in U5** | P-U5-1 — see below |
| **BR-43.7** | The transition regime is discriminated by **the queue**, never by `context_type` | P-U5-1 + R11 |
| **BR-43.8** | ⚠️ An **absent track** in a now-playing read must not be treated as *playback stopped* for the purpose of firing a skip | P-U5-1 — see below |
| **BR-43.9** | ⚠️ BR-36's one-attempt-per-play guard **stays**. The hazard being false does not license removing the loop guard | BR-36.4 |

> ### ⚠️ BR-43.6 — the DJ has at least THREE transition behaviours and nothing predicts which
>
> | type | n | tail (median) | audio lag |
> |---|---|---|---|
> | hard-cut | 3 | 8.0 s | +0.9 s |
> | crossfade | 3 | 25.1 s | +2.0 s |
> | **dj-talk** | 2 | 1.6 s | **−6.9 s** — the audio changes *before* the API names the next track |
>
> ⚠️ **`dj-talk`'s audio lag is NEGATIVE**, so even the *sign* of the offset varies. Nothing in the API
> says which behaviour is coming. Any rule, threshold or guard that assumes a constant offset will be
> wrong on at least one type — which is why BR-43.1 compensates for nothing rather than compensating
> by an average.
>
> **This is R11's shape again**: the answer is *it depends*, and the field you would branch on does not
> exist.

> ### ✅ BR-43.7 — the discriminator already exists, and FR-36 already fetches it
>
> The mechanism (user's observation, 2026-09-27) is **pre-determined vs produced-live**, not
> *algorithmic* — radio is algorithmic and behaves exactly like an album.
>
> ```
> queue returns tracks  ->  pre-determined  ->  clean transitions, progress_ms trustworthy
> queue is empty        ->  produced-live   ->  trimmed, pre-reported, progress_ms ahead
> ```
>
> ⚠️ **`context.type` cannot do this** — the DJ and a radio station are both `type: playlist` with the
> `37i9dQZF1E` prefix (R11, re-confirmed: DJ `…Ykqdzj48dyYq` vs radio `…4xunLN1DdaFF`). **The queue
> can.** So BR-39.1's runtime queue probe is *also* the transition-regime probe, and U5 needs no new
> field for it. BR-41.3 stands: `context_type` remains **evidence only**.

> ### ⚠️ BR-43.8 — `200` with `item: null`, a new API fact
>
> During DJ commentary the Web API returns **HTTP 200 with `item: null`** — *not* a 204 — for
> **6.5–7.2 s**, on 3 of 8 DJ transitions. Code that reads the item and infers *playback stopped* will
> mis-handle it, and `PlayObserver` takes its play boundary from exactly that state.
>
> **For U5 the safe behaviour already follows from BR-42.5**: a queued attempt whose play has closed is
> **discarded, and the discard recorded**. Erring toward not acting is correct here.
>
> ⚠️ **But there is an unresolved question this must not be confused with.** The live path parses the
> MCP `getNowPlaying` **text**, not this endpoint, so the shape of a commentary gap there is *unknown*.
> If it reads as *nothing playing*, a commentary gap would **close the play** and — since `classify`
> returns `skipped` only on `track-change` — fall through to **`unknown`**, systematically. That would
> mean a slice of the `unknown` population is DJ commentary rather than instrument downtime, which
> reaches R2 and open item 8. **It is a hypothesis. It must be probed on the MCP surface and must not
> be asserted from P-U5-1**, which never observed that surface.

> ### ⚠️ Classifier v2: the FIX stands, the stated MECHANISM was backwards
>
> `CLAUDE.md` recorded *"in the DJ context the API stops reporting a track 18–41 s before it stops
> playing."* **Reversed.** `B@first` settles it: radio and album name the incoming track at ~1 s of
> progress, the DJ at up to **23.6 s**. So `progress_ms` is accurate in pre-determined contexts, the DJ
> tails are **real edits**, and the DJ simply does not play the last ~18–50 s.
>
> ✅ **No re-derivation is needed.** `maxUnobservedTailMs = 55_000` thresholds the right quantity and
> the 24 re-derived rows stay correct — the listener heard those tracks finish because, as the DJ
> presented them, they did. Only the explanation changes. ⚠️ **Do not treat this as grounds to re-run
> the classifier or the gate**; BR-11.7 is untouched by a change of explanation.

### ⚠️ What P-U5-1 does NOT establish

- **n is small**: 8 DJ / 3 radio / 4 album, one machine, one account, one evening. Enough to separate
  ~2 s from ~25 s; **not** enough to characterise the distribution of DJ trim lengths.
- **Trim length as a distribution** is unmeasured — observed 6.8–48.7 s implied, on 6 transitions.
- **Autoplay was never tested.** R11 found it exposes a queue, so it *should* be pre-determined, but
  that is inference, not measurement.


## Rules inherited unchanged, listed so they are not re-litigated

| | |
|---|---|
| **BR-22.1a** | No uniqueness constraint encodes one-decision-per-play. **Still in force** — BR-37.2 |
| **BR-22.6** | The trigger consumes `tick`, never `change`. `change` is signature-suppressed and the signature excludes progress |
| **BR-23.1** | One log row per rule **evaluated**, matched or not |
| **BR-25.2** | A rule cannot opt out of a global dry-run — BR-33.3 |
| **BR-30** | `SkipExecutor` alongside `LoggingExecutor`, never grown out of it — BR-33.6 |
| **`null` is unknown** | Never `false`, never `0`, end to end including exports |
| **Store observations; derive judgements** | Trails are retained so verdicts can be recomputed (FR-20) |
| **Pure modules import nothing impure** | `test/purity.test.ts` is the only thing that catches a violation |
