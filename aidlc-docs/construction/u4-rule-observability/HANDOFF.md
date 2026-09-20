# U4 Handoff — read this before starting Code Generation

**Written 2026-09-20**, at the design/code boundary. Everything committed and pushed; working tree
clean; no code written; schema still **v4**; container healthy and recording on the U3 image.

> **Where we are**: U4's three design stages are **complete and awaiting approval** — Functional
> Design, NFR Design, Infrastructure Design. **Next stage is Code Generation**, which is the
> largest single chunk of this unit.

> ### ✅ The five "settle before Code Generation" items are SETTLED — 2026-09-20
>
> The Fable review's items 1–5 were each **verified against the code** before being decided, and
> items 6–14 have been applied to the artifacts. Four decisions, all taken by the user:
>
> | # | Settled | Written to |
> |---|---|---|
> | 1 | **`RuleSetWatcher` owns the rule set**; `RuleStore` becomes a parser with no state | BR-26.3a/3b · LC-16 |
> | 2 | **BR-22.1 is scoped to U4.** No `UNIQUE` constraint may encode it | BR-22.1a · migration 005 |
> | 3 | **`PlayObserver` owns segmentation**; the coordinator consumes its hooks. No repository ⇒ no evaluation | BR-22.8/8a · LC-14 |
> | 4 | **Answerability is per row**, over a schema era **and a backfill gap** | BR-27.5a/5b/5c/5d · LC-17 |
>
> Items 4 and 5 of the review (one shared count method; a real `enrichmentSettled`) had no
> competing option and were applied directly, as **LC-22** and **LC-21**.
>
> ⚠️ **Still no code.** `git status src/` is clean; schema is still v4.

---

## Read in this order

1. `CLAUDE.md` — the invariants
2. `aidlc-docs/aidlc-state.md` — authoritative state
3. `audit.md` — the last ~6 entries cover all of U4
4. `u4-rule-observability/functional-design/` — BR-22…BR-32, plus `frontend-components.md`
5. `u4-rule-observability/nfr-design/` — P-19…P-26, LC-13…**LC-22**, PBT-21…**PBT-33**
6. `u4-rule-observability/infrastructure-design/`
7. The three plans in `construction/plans/u4-*` — **these carry the Q&A trail and the reasoning
   that did not survive into the artifacts**

---

## ⚠️ The five things most likely to be got wrong

### 1. Two decisions were taken BY RECOMMENDATION and modify explicit user answers

**FQ1** (evaluate at first-enrichment + 10 s cap, not at track start) and **FQ3** (`partialData`
means the wait timed out). The user answered *"ok commit and continue"* rather than answering them
individually.

**They are one decision wearing two numbers. If either is reversed, both revert together** —
reverting FQ1 makes FQ3's `partialData` meaningless. Flagged in the plan, the state doc and
`audit.md` as the first thing to revisit at approval.

### 2. `fs.watch` DOES NOT WORK here — and BR-26.1 was written before that was known

Probed 2026-09-20: **0 events in 12 s** over the Rancher Desktop bind mount, for both an in-place
write and a rename, **while the container read the new content within 1 s**. `watch()` registers,
throws nothing, and never calls back.

BR-26.1 and `business-logic-model.md` §4 have been **marked superseded** rather than silently
rewritten. The mechanism is **polling** (P-19): `stat` every 5 s, hash only when `mtime`/`size`
move, plus a reload button. **Both enter the same `load()`** — re-implementing it is the WebSocket
`403` shape.

⚠️ **A unit test of a watcher on a normal filesystem proves nothing.** The defect exists only over
the bind mount, which is the only place the app runs.

### 3. `ENRICHMENT_WAIT_MS = 10 000` is an admitted guess, and it has a measured blind spot

The enrichment latency it waits on **has never been measured**. The number that looked like it
measured it (0.2 s) was `resolvedAt` stamped *before* the MusicBrainz calls — initiation, not
completion.

Plays that **end** before the cap produce **no decision row at all**: measured **2.8% of plays**
and **4 of 31 skips**. Bounded and accepted — but anything counting decisions must use its own
denominator, not the play count. **At 15 s the blind spot grows to 3.5% / 5 of 31.**

`partialData` counts how often the cap fires. **That is the first real measurement of this number**
and the main thing to collect in live verification.

### 4. PBT-22 is the only thing that will ever catch the point-in-time decision

BR-27.2 (history counts computed over plays strictly *before* the row) has **no observable failure
mode**. As-of-now counts produce plausible numbers today and diverge only over months.

The property: take a report, insert plays dated **after** the range, take it again. Point-in-time
is stable; as-of-now moves. **Do not weaken this into "back-test twice in a row" — that passes
under both implementations.**

⚠️ **PBT-22 also passes trivially if the counts are always zero**, which a `historyCountsBefore`
returning `0` for everything would satisfy perfectly. **PBT-22a is the other half**: inserting a
play dated *before* a row **must** change that row's counts. Neither test is meaningful alone.

### 5. U3's containment guarantee retires HERE, on purpose

U3's was *"`git status src/` shows only `src/rules/`"*. Code Generation necessarily changes the
poll loop, `api.ts`, the schema and the UI. **From this unit the phase boundary rests entirely on
`src/playback/` not existing** (BR-30.3) — a weaker guard, stated rather than discovered.

⚠️ **`LoggingExecutor` takes no playback collaborator — not unused, not optional, not null.** An
injected-but-uncalled one reduces the boundary to one line of restraint.

---

## Code Generation scope

> **Revised 2026-09-20** after the design review. Rows marked ⭐ were **absent from the original
> table** and are the audit's main structural finding: four of them are changes to code that
> already exists, which is exactly the kind of work a scope table silently omits.

| Area | What |
|---|---|
| `src/rules/` | `EvaluationCoordinator`, `LoggingExecutor`, `DecisionLogRepository` + SQLite impl, `RuleSetWatcher`, `factReconstructor` ⚙️, `BackTestService`, `decisionTrace` ⚙️, `rulesDiagnostics` ⚙️ |
| ⭐ `src/rules/RuleStore.ts` | **Becomes a parser**: `read(): LoadOutcome`, no `#rules`, no `current()`. The watcher owns the set (BR-26.3b) |
| ⭐ `src/rules/liveFactSource.ts` | **LC-21, new.** Absorbs `labelByTrack` / `labelInFlight` / `likedAtStartByTrack` from `server.ts`; owns `enrichmentSettled` and builds `FactSources` |
| ⭐ `src/history/HistoryRepository.ts` + SQLite impl | **LC-22.** `historyCountsBefore(trackId, artistId, beforeIso)` — **one** method for live and back-test (BR-27.7) |
| `src/history/migrations.ts` | **Migration 005** — `decision_log` + indexes (**no `UNIQUE`** — BR-22.1a), `play.explicit`, `play.album_type`, **`meta` table + v5 watermark** (BR-31.7) |
| ⭐ The `explicit` / `album_type` **write path** | `PlaybackSample` → `NewPlayRecord` → `recordPlay`'s `INSERT` → `PlayRecord` → **export serialisers incl. CSV headers** → `RecentlyPlayedBackfill` (BR-31.5) |
| ⭐ `src/history/PlayObserver.ts` | Coordinator subscribes to the **existing** `onPlayStarted` / `onPlayRecorded`. ⚠️ Mark `link-failed` when a write fails (BR-24.3a) |
| `src/api.ts` | `GET /api/rules`, `GET /api/decisions`, `POST /api/backtest`, `POST /api/rules/reload` |
| `src/nowPlayingService.ts` | Wire the coordinator to **`tick`** |
| ⭐ `src/rules/fieldCatalogue.ts` | `liked.transition` gains a `note`: **unknown live, back-test only** (BR-23.9) |
| `public/app.js` + `src/` helpers | Status bar, rules panel, decision-log table. ⚠️ **State derivation goes in `src/` as tested pure functions.** Recording reads `degraded`/`gaps`; Spotify reads the **snapshot**, not `/api/health` |
| `compose.yaml` | Two env values; **two comment corrections** (see below) |
| `test/` | PBT-21…**PBT-33**, plus extend `purity.test.ts` to the new pure modules |

### The two compose comment corrections

1. The `./config` mount says *"this becomes `:rw` at U4 when the editor needs to write."* **U4 has
   no editor** — it stays `:ro`. Retarget the comment at the unit that adds editing.
2. The same mount states the root-ownership hazard as fact. **Measured 2026-09-11 not to occur on
   this host.** CLAUDE.md was corrected; `compose.yaml` was not.

### Deployment (Q1 = A)

```bash
docker compose down            # two writers on one SQLite file is the standing hazard
cp -r data/ data/backup-before-migration-005-<ts>/
docker compose build           # check the exit code DIRECTLY, not through a pipe
docker compose up -d
docker logs spotify-now-playing | head -40      # "migrated 5: ..." exactly once
```

Rollback is by image and is **verified safe** — `migrate()` skips anything ≤ current version, so
U3's image ignores the new table and columns. ⚠️ **Only while migrations stay additive.**

---

## Three exit criteria that CI cannot close

1. **The dry-run agreement gate** — a real session whose match log the user agrees with
2. **The `partialData` rate** — whether the 10 s wait is right
3. **BR-20.8's last-known-good path** — specified since U3 and **never once run**. Exercise it by
   deliberately breaking `rules.json` and confirming 🔴 names the version still in force

---

## Open, not blocking

- **Fable design review** — ✅ **DONE and SETTLED 2026-09-20**, see *Audit results* below.
  Fourteen findings, all verified against `src/`; four decisions taken, nine corrections applied,
  five new property obligations. **Nothing from it is still blocking.** The rest of this list is
  unchanged.
- ✅ **CLAUDE.md open item 3 corrected 2026-09-20**, with **3a** added: the cause of the 82-row
  ISRC gap is **unestablished and is not the code**. Recovery is **72 distinct tracks**; the
  zero-gate-eligible conclusion is unchanged.
- **W-3** (session-end discriminator) — backlog; would change the outcome variable back-testing
  compares against
- **Open item 4** (crossfade confound) and **open item 7** (playback context) — unchanged

---

## Audit results — senior architect review, 2026-09-20 (Fable)

**Verdict: the design is sound and approved in substance.** All seven by-recommendation
follow-ups are endorsed, including the FQ1/FQ3 pair. The probes (`fs.watch`, the blind spot, the
point-in-time trap) were the right ones. What follows is where the design does not yet fit the
code it lands on, or contradicts itself or a requirement. **Nothing in the repository was changed
by the review.** Items 1–5 are to be settled before code is written; the rest are corrections to
the artifacts or obligations for Code Generation.

### ✅ Settled before Code Generation — all five, 2026-09-20

**Each was checked against the source before being decided.** The five items below are kept as
written by the review; the resolution follows each one. Items 6–14 have been applied to the
artifacts and are no longer open.

#### What the verification changed about the review's own account

| Review item | Verified | Sharper than stated |
|---|---|---|
| 1 | ✅ `RuleStore.ts` :102, :108, :118 all wipe `#rules` | **Two `current()` methods** would have been the live trap — wrong wiring evaluates a wiped set while indicators read green |
| 3 | ✅ hooks exist at `PlayObserver.ts` :148, :217 | **`onPlayRecorded` never fires on a write failure** → a permanent null `playId` means *two* things. Now `playLink` (BR-24.3a) |
| 5 | ✅ no per-track resolver state exists | **Four** uncached exits, not two — `labelEnrichment === null` makes *every* play wait the full cap |
| 2 | ✅ FR-34 is a Must and does contradict BR-22.1 | The `trigger` column is **not** the load-bearing part; `ALTER TABLE ADD COLUMN` is O(1) in U5 too, and U4's value is derivable from `partialData`. **The irreversible risk is a `UNIQUE` constraint** — dropping one later is non-additive and would retire the by-image rollback guarantee |
| 6 | ✅ no writer in scope | Premise **probed**, not assumed — and the probe disproved a standing CLAUDE.md claim (below) |

#### ⚠️ One finding the review did not have: CLAUDE.md open item 3 was false

`recently-played` **does** return `external_ids.isrc` — probed live 2026-09-20, HTTP 200, 3/3
items — and `RecentlyPlayedBackfill` has read `track.external_ids?.isrc` since **U1**
(`a8136d9`):

| Backfilled rows | ISRC | `label_verdict` | `label_unknown_reason` |
|---|---|---|---|
| 2026-08-20 → 08-31 | **0 of 82** | NULL ×82 | NULL ×82 |
| 2026-09-03 → 09-16 | **4 of 4** | populated | populated |

⚠️ **Why the 82 lack one is UNESTABLISHED, and it is not the code**: `webApiClient.ts` has one
commit, the wiring never changed, live rows carried an ISRC from row id 51, and the break is clean
at **row id 120 → 155** (2026-09-01 → 09-03) with no code change in that window. **Do not invent a
cause.** What matters is that no migration marks the boundary, so no schema-derived watermark can
find it. On those 82 rows `label.classification` is null
because there was never a key to ask MusicBrainz with — reported as an unknown *value* it becomes
82 plays that "read the field absent", which reads as **coverage**. That is the
28%→12%-where-the-truth-was-86%→44% denominator bug, reappearing inside the back-test. Hence
decision 4.

✅ **CLAUDE.md open item 3 was corrected 2026-09-20**, and item **3a** added for the unestablished
cause. The recovery figure is **72 distinct tracks**, not 47 — and the 2026-09-05 conclusion still
stands: all 82 are `outcome = 'unknown'`, so **0 are gate-eligible**.

---

### Items 1–5, as the review wrote them

1. **`RuleStore.load()` cannot deliver last-known-good as written.** On a `failed` outcome it sets
   `#rules = []` — `src/rules/RuleStore.ts` ~line 117, and the comment says so deliberately. If
   `RuleSetWatcher` calls `load()` on reload, **BR-26.3 is violated the first time a bad file
   lands.** Either `RuleStore` learns the cold-start-vs-reload distinction, or the watcher owns the
   current set and uses the store purely as a parser. `RuleStore` is absent from the scope table
   above either way — **add it.**
   ⚠️ Also unspecified: a write-temp-then-rename save can show `ENOENT` for one poll. The store
   treats `absent` as an *accepted* empty set — version advances, every rule is dropped for 5 s,
   then the new file loads. **On reload, `absent` and `no-directory` must count as rejections.**

2. **BR-22.1 contradicts FR-34, which is a Must.** FR-34: evaluate fast fields immediately, then
   re-evaluate when slow enrichment lands. BR-22.1: a second decision per play is a defect. FR-34
   is U5's, so U5 will have to revise BR-22.1 and the log shape. Migrations are forward-only, so
   **add a `trigger` column to `decision_log` now** with values `settled` | `deadline`; U5 adds
   `initial` | `enrichment-arrived`. BR-22.4 already encodes this reason as a boolean.

3. **Play segmentation is written twice.** The coordinator pseudo-code (`business-logic-model.md`
   §1) re-derives the play boundary from `trackId` and null samples. `PlayObserver` already owns
   that boundary — including the `pause-idle` close and the null-progress projection in
   `toPlaybackSample`. Two segmenters that must agree is the WebSocket `403` shape, and the
   `evaluationId → playId` back-fill (BR-24.1) depends on their agreement. **The observer issues
   the boundary through its existing hooks (`onPlayStarted`, `onPlayRecorded`); the coordinator
   consumes it.** Consequence, acceptable: no evaluation without a repository — the log lives in
   `history.db` anyway.

4. **History counts are written twice, and live-vs-replay divergence is inherent.** The back-test
   gets a window function (§5.1). The live path gets nothing specified, and no repository method
   counts per artist. **One method — `historyCountsBefore(trackId, artistId, beforeIso)` — used by
   both, with `before = now` live.** Separately: the 6-hourly backfill inserts rows dated in the
   past, so a later reconstruction can legitimately see *more* prior plays than the live evaluation
   saw. `fieldsSeen` makes that detectable. **BR-27 and the NFR-26 "replays exactly" claim must
   state this** rather than let live verification discover it.

5. **`enrichmentSettled` has no implementation behind it.** BR-22.5 says "the resolver's queue
   state". The resolver exposes no per-track pending state. The only such state is
   `labelInFlight` / `labelByTrack` in `server.ts`, and the display resolver deliberately caches
   nothing on transient failure or when there is no ISRC and no artist id. Under a naive
   definition a keyless track waits the full cap and is stamped `partialData` — conflating
   permanent absence with timeout, the distinction FQ3 exists for.
   **Define settled as a pure, tested function over: Spotify enrichment landed AND label
   resolution completed | failed | not-attemptable.** Move those maps plus `likedAtStartByTrack`
   out of `server.ts` into a small tested live-fact source that also builds `FactSources`.
   Otherwise U4's wiring grows the one file the orphan check excuses.

### ✅ Applied to the artifacts — 2026-09-20

Items 6–11 are **done**, with two corrections to the review's own account: item 6's premise was
**probed** rather than accepted (and the probe found the stale CLAUDE.md claim above), and the
`BackTestReport` entity was additionally missing **`truncated`**, which P-24 declares required —
the `release_count = 100` shape, in the document that defines the report.

Items 12–14 are Code Generation obligations and are now pinned as **PBT-22a**, **PBT-31**, plus
**PBT-30a**, **PBT-32** and **PBT-33** for the decisions above.

### Items 6–11, as the review wrote them

6. **Migration 005's two `play` columns have no writer in scope.** `PlaybackSample`,
   `NewPlayRecord`, the `INSERT` in `SqliteHistoryRepository.recordPlay`, `PlayRecord`, and the
   export serialisers (CSV headers included) all change; `RecentlyPlayedBackfill` can populate
   both, since `recently-played` carries `explicit` and `album.album_type`. None are in the scope
   table. BR-27.5's "schema era" also needs a **stored watermark**, and the rule must say whether
   era is judged by `started_at` against migration 005's `applied_at` or by row id — a backfilled
   row inserted *after* v5 for an *older* play is answerable.

7. **§5 pseudo-code selects "live plays in range" yet §5.2 reports `notObserved` for backfilled
   rows.** With that selection the count is always zero. Iterate every row in range.

8. **`ruleSetVersion` on a durable row resets to 1 on restart (BR-26.8).** A repeating integer in
   a permanent table misidentifies. Stamp the set's `contentHash` on the row; keep the counter for
   the UI only.

9. **The Recording indicator reads only `repository !== null`.** Runtime write failures are the
   likelier fault and are already tracked — `observer.stats.degraded` and `gaps`. Include them.
   The **Spotify** indicator should read the snapshot's `error` state the WebSocket already
   delivers every poll, **not** poll `/api/health`, which is a real MCP round-trip per request.

10. **`liked.transition` is computed at play close.** Live evaluation reads it `unknown` every
    time while back-tests see it populated — the exact profile BR-16.6 used to exclude `context`.
    The catalogue `note` must say so.

11. **BR-29.4 vs §6.** "Checked after each write batch" puts the prune inside the tick. Cheap, but
    say it. Chunk the explicit id list for the one-time case where the table is far over the cap
    (SQLite bound-variable limit).

### Obligations for Code Generation

12. **PBT-22 passes trivially if counts are always zero.** Add the positive control: inserting a
    play dated *before* a row **must** change that row's counts.
13. **Normalise `undefined` → `null` before serialising `fieldsSeen`.** `JSON.stringify` drops
    undefined keys, violating BR-23.4 silently. Readers return `Maybe`, so this is a pin, not a fix.
14. **Expect transient rejections during live verification.** A 5 s poll will sometimes read a
    half-written in-place save, flash 🔴, and heal on the next poll; diagnostics will record it.
    Correct behaviour, not a bug to chase.
