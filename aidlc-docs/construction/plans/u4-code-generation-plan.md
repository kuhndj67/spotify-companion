# Code Generation Plan — U4: Rule Observability

**Date**: 2026-09-20 · **Stage**: CONSTRUCTION — Code Generation, Unit U4
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield (working code exists)

**This plan is the single source of truth for U4 code generation.**

Designs approved 2026-09-20, after a senior-architect review whose four decisions and nine
corrections are already folded into the artifacts — see `audit.md` 2026-09-20 and
[`../u4-rule-observability/HANDOFF.md`](../u4-rule-observability/HANDOFF.md).

---

## Unit context

| | |
|---|---|
| **Stories** | US-20, US-23, US-24 |
| **Requirements** | FR-37, FR-41, FR-42 · NFR-10, NFR-26, NFR-27 |
| **Depends on** | **U3** (the pure engine, unmodified) · **U1** (`play`, `PlayObserver`) · **U2** (label state) |
| **Owns entities** | `DecisionLogEntry`, `BackTestReport`, `LoadedRuleSet`. **Migration 005 — schema v5** |
| **Provides to later units** | The trigger U5 arms, and the back-test that validates a rule *before* it is armed |
| **Design** | [functional](../u4-rule-observability/functional-design/) · [NFR](../u4-rule-observability/nfr-design/) · [infrastructure](../u4-rule-observability/infrastructure-design/) |

**Brownfield rule**: existing files are modified in place. No `_new` or `_modified` duplicates.

> ### ⚠️ U3's containment guarantee retires here, deliberately
>
> U3's was *"`git status src/` shows only `src/rules/`"*. U4 necessarily changes the poll loop,
> `api.ts`, the schema and the UI, so that guarantee **cannot survive this unit**. From here the
> phase boundary rests entirely on **BR-30.3: `src/playback/` does not exist** — a weaker guard,
> stated rather than discovered.
>
> ⚠️ **`LoggingExecutor` takes no playback collaborator** — not unused, not optional, not null. An
> injected-but-uncalled one reduces the boundary to one line of restraint.

---

## ⚠️ Two scoping decisions to confirm before generation

### Q1 — `FactCache` (LC-12, P-16) was deferred from U3 **to this unit**, and U4's design never mentions it

U3's plan deferred it *"to the unit that first evaluates rules on the poll path"*. **That is U4.**
It is not in LC-13…LC-22, not in any business rule, and not in the scope table — so it would be
dropped silently unless named here.

A) **Close it as superseded — no cache.** BR-22.1 takes **exactly one decision per play**, so
   `historyCountsBefore` is called **once per play** already. A cache whose stated purpose is
   *"assemble the four history aggregates once per play"* would have nothing to save. It becomes
   live again in **U5**, where FR-34's re-evaluation means a second assembly for the same play.
   *Recommended — record the supersession so the deferral does not simply evaporate.*

B) **Build it now** as specified. An extra component with no measurable benefit under U4's
   trigger, whose shape would be guessed from a U5 caller that does not exist.

**[Answer]:**
**A — closed as superseded** (user, 2026-09-20). BR-22.1's one-decision-per-play already assembles
the four aggregates exactly once, so the cache has nothing to save. ⚠️ **It becomes live again in
U5**, where FR-34's re-evaluation means a second assembly for the same play — recorded here rather
than allowed to evaporate, because a deferral that is never re-stated is indistinguishable from
one that was forgotten.

### Q2 — Back-testing has **no UI** in U4, only `POST /api/backtest`

FQ6's UI is the rules panel and the decision-log table. `POST /api/backtest` exists and nothing
calls it, so **US-24 would be exercisable only with `curl`**.

⚠️ This is not obviously wrong — the unit's live gate is the *dry-run agreement* reading exercise,
not back-testing — but it means the half of rule authoring that answers *"would this rule have
been any good?"* ships without a way to ask it.

A) **API-only, as designed.** Back-testing lands with the rule **editor** in U5, where authoring
   and evaluating a rule belong on one screen. `curl` is enough to satisfy the exit criterion and
   to run PBT-21/22. *Recommended — it keeps FQ6's scope and avoids a throwaway panel.*

B) **Add a minimal panel** — pick a rule, pick a range, show the report's counters. More of US-24
   delivered now; a UI surface built before the editor it will sit beside.

**[Answer]:**
**A — API-only** (user, 2026-09-20). FQ6's scope stands. `curl` satisfies the exit criterion and
PBT-21/22; back-testing lands beside the rule editor in U5. ⚠️ **US-24 is therefore delivered but
not *surfaced* in U4** — anyone reading the UI alone will not find it, so the code summary must
say so.

---

## Structure

```
src/rules/
  types.ts                        MODIFY ⚙️  + DecisionLogEntry, LoadedRuleSet, BackTestReport,
                                             DecisionFilter, DateRange, HistoryCounts, LoadOutcome
  RuleStore.ts                    MODIFY 🔌  → parser: read(): LoadOutcome. No #rules, no current()
  RuleSetWatcher.ts               NEW    🔌  LC-16 — owns the set, version, contentHash, state
  liveFactSource.ts               NEW    🔌  LC-21 — enrichmentSettled ⚙️ + FactSources
  EvaluationCoordinator.ts        NEW    🔌  LC-14 — the trigger
  LoggingExecutor.ts              NEW    🔌  LC-15 — the ONLY DecisionExecutor
  DecisionLogRepository.ts        NEW        LC-13 interface (NFR-10)
  SqliteDecisionLogRepository.ts  NEW    🔌  LC-13 impl + pruneToCap
  factReconstructor.ts            NEW    ⚙️  LC-17 — reconstruct + unanswerableFields
  BackTestService.ts              NEW    🔌  LC-18 — impure shell, pure fold
  decisionTrace.ts                NEW    ⚙️  LC-19 — renders a stored Decision (BR-32)
  rulesDiagnostics.ts             NEW    ⚙️  LC-20

src/history/
  migrations.ts                   MODIFY     migration 005 (schema v5)
  types.ts                        MODIFY     explicit + albumType on sample/record/row
  HistoryRepository.ts            MODIFY     LC-22 historyCountsBefore, v5Watermark
  SqliteHistoryRepository.ts      MODIFY     INSERT columns, counts, watermark read
  RecentlyPlayedBackfill.ts       MODIFY     populate both columns (probed available)

src/export/serialisers.ts         MODIFY     two columns — ⚠️ CSV headers included
src/ui/statusBar.ts               NEW    ⚙️  indicator state derivation (FC-1)
src/api.ts                        MODIFY     4 routes
src/server.ts                     MODIFY     wiring; the three maps LEAVE this file
public/app.js                     MODIFY     FC-1, FC-2, FC-3 — DOM only
compose.yaml                      MODIFY     2 env values + 2 comment corrections

test/                             mirrors src/ — see Step 12
```

**Naming follows the existing convention**: lower-camel for pure function modules, Pascal for
classes.

---

## Ordering principle

**Pure first, then storage, then wiring, then UI.** Every step ends with `npm test` and
`npm run typecheck` green, and **the app behaves identically until Step 10**. Nothing is deployed
until Step 13.

---

## Steps

### Step 1 — `src/rules/types.ts` ⚙️ and `src/history/types.ts`
- [ ] `DecisionLogEntry` incl. **`playLink: 'pending' | 'linked' | 'link-failed'`** (BR-24.3a) and
      **`ruleSetContentHash`** (BR-23.7a)
- [ ] `BackTestReport` incl. **`truncated`** — required, never optional (P-24)
- [ ] `LoadedRuleSet`, `DecisionFilter`, `DateRange` (half-open), `HistoryCounts`
- [ ] `explicit: Maybe<boolean>`, `albumType: Maybe<string>` on `PlaybackSample`, `NewPlayRecord`,
      `PlayRecord`
- [ ] ⚠️ **No `Verdict`-style enum gains a falsy member**; `null` stays the only unknown

### Step 2 — Migration 005 (`src/history/migrations.ts`)
- [ ] `decision_log` + three indexes. ⚠️ **No `UNIQUE`** anywhere (BR-22.1a)
- [ ] `ALTER TABLE play ADD COLUMN explicit INTEGER` / `album_type TEXT` — both nullable
- [ ] `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)` — **does not exist today**
- [ ] `INSERT` the **v5 watermark** = `COALESCE(MAX(id),0)` from `play`, **same transaction**
- [ ] Test: applied once, idempotent, and a **rolled-back 005 leaves no `meta` row**

### Step 3 — The two columns' write path (BR-31.5)
- [ ] Enrichment → `PlaybackSample` → `NewPlayRecord` → `recordPlay`'s `INSERT` → `PlayRecord`
- [ ] `RecentlyPlayedBackfill` populates both — ✅ probed present on `recently-played`
- [ ] ⚠️ **`src/export/serialisers.ts` including CSV headers** — the one nothing fails without
- [ ] ⚠️ A null from a **failed** `GET /tracks/{id}` is `unknown`, never `false` (BR-31.3b)

### Step 4 — `historyCountsBefore` (LC-22, BR-27.7)
- [ ] **One** method, live (`before = now`) and back-test (`before = row.started_at`)
- [ ] ⚠️ Doc comment states the **primary-artist** limitation (~24% low for frequent guests)
- [ ] `v5Watermark()` reader alongside it

### Step 5 — `factReconstructor.ts` ⚙️ (LC-17)
- [ ] `reconstruct(row, counts)` — total, no clock, no defaults
- [ ] `unanswerableFields(row, v5Watermark)` — **per row, two eras** (BR-27.5a/5b/5c/5d):
      schema era by **row id**, never by date; `label.*` where
      `isrc IS NULL AND label_unknown_reason IS NULL`

### Step 6 — `DecisionLogRepository` + SQLite impl (LC-13)
- [ ] `record` (one transaction), `attachPlayId`, `list`, `countSince`, `pruneToCap`
- [ ] ⚠️ `pruneToCap` is **two statements**: a `SELECT` that may join `play`, then a `DELETE`
      naming **only** `decision_log`, by explicit id list, **chunked** (BR-29.3/29.5)
- [ ] ⚠️ Normalise `undefined → null` before serialising `fieldsSeen` (BR-23.4)

### Step 7 — `RuleStore` → parser, and `RuleSetWatcher` (LC-16)
- [ ] `RuleStore.read(): LoadOutcome` — **delete `#rules` and `current()`**
- [ ] Watcher owns the set, `version` (accepted loads only), `contentHash`, `state`, `rejection`
- [ ] ⚠️ On **reload**, `absent` and `no-directory` are **rejections** (BR-26.3a)
- [ ] Polling at `RULES_POLL_INTERVAL_MS`; `reloadNow()` enters **the same loader**
- [ ] ⚠️ **No `fs.watch`** — 0 events over the bind mount, probed

### Step 8 — `liveFactSource.ts` (LC-21)
- [ ] Absorb `labelByTrack`, `labelInFlight`, `likedAtStartByTrack` **out of `server.ts`**
- [ ] `settled(trackId)` ⚙️ — Spotify enrichment landed **AND** label
      `completed | failed | not-attemptable`
- [ ] ⚠️ **`not-attemptable` is immediate**: no ISRC *and* no artist id, or resolver disabled

### Step 9 — `EvaluationCoordinator` + `LoggingExecutor` (LC-14, LC-15)
- [ ] Subscribes to `PlayObserver`'s **existing** `onPlayStarted` / `onPlayRecorded` (BR-22.8)
- [ ] Consumes **`tick`**, never `change` (BR-22.6) — its own integration test
- [ ] `decided` flag enforces one decision per play; **no constraint does** (BR-22.1a)
- [ ] ⚠️ `onPlayRecorded` never fires on a write failure → mark **`link-failed`** (BR-24.3a)
- [ ] ⚠️ `LoggingExecutor` constructor takes the log **and nothing else** (BR-30.2)

### Step 10 — `BackTestService` (LC-18) and `decisionTrace` / `rulesDiagnostics`
- [ ] Iterates **every row in range** (BR-28.3a) — eligibility selects what is *compared*
- [ ] Same `RuleEngine`; writes **nothing**; `truncated` at 50,000
- [ ] `decisionTrace` renders a **stored** `Decision` — no second walk of the tree (BR-32.3)

### Step 11 — `src/api.ts` and `src/server.ts`
- [ ] `GET /api/rules`, `GET /api/decisions`, `POST /api/backtest`, `POST /api/rules/reload`
- [ ] All four in **`api.ts`**, collaborators injected incl. `now`
- [ ] `server.ts` gains wiring only. ⚠️ **Leave the `upgrade` handler there** — `localGuard.test.ts`
      pins it structurally
- [ ] ⚠️ **No new WebSocket surface**

### Step 12 — UI (FC-1, FC-2, FC-3)
- [ ] **`src/ui/statusBar.ts` ⚙️ tested** — indicator state derivation, `unknown` never green
- [ ] Recording reads **`degraded` and `gaps`**, not just `repository !== null`
- [ ] Spotify reads the **WebSocket snapshot's `error`**, never a polled `/api/health`
- [ ] `public/app.js` gets DOM wiring only — **no judgement**

### Step 13 — Tests, purity, orphans
- [ ] **PBT-21…PBT-33**, including **PBT-22a** (positive control — PBT-22 passes trivially against
      counts that are always zero) and **PBT-30a**, **PBT-31**, **PBT-32**, **PBT-33**
- [ ] Extend **`test/purity.test.ts`** to `factReconstructor`, `decisionTrace`,
      `rulesDiagnostics`, `statusBar`, and `liveFactSource`'s pure predicate
- [ ] ⚠️ Generators build the child arbitrary **once** — never recurse per branch
- [ ] `noOrphanModules.test.ts`: every new module executed, or an `ALLOWED_ORPHANS` entry **with a
      reason**
- [ ] Structural: `pruneToCap`'s `DELETE` text contains no `play`; `src/playback/` absent

### Step 14 — Deployment and documentation
- [ ] `compose.yaml`: two env values, **two comment corrections** (`:rw` retarget, root-ownership)
- [ ] `docker compose down` → back up `data/` → **build, checking the exit code directly** → up
- [ ] `aidlc-state.md`, `audit.md`, code summary, build-and-test doc

---

## Verification

| Check | Command |
|---|---|
| Tests | `npm test` |
| Types (src **and** test) | `npm run typecheck` |
| Coverage, and the orphan guard | `npm run test:coverage` |
| Phase boundary | `src/playback/` absent; no Spotify **write** client under `src/rules/` |
| Migration | `docker logs spotify-now-playing \| head -40` → `migrated 5:` **exactly once** |

⚠️ **A green suite is not sufficient for this unit.** Three exit criteria cannot be closed by CI:

1. **The dry-run agreement gate** — a real session whose match log the user agrees with
2. **The `partialData` rate** — the first real measurement of enrichment latency, and the evidence
   for whether `ENRICHMENT_WAIT_MS = 10 000` is right
3. **BR-20.8's last-known-good path** — specified since U3 and **never once run**. Break
   `rules.json` deliberately and confirm 🔴 names the version still in force

⚠️ **Expect transient rejections during live verification.** A 5 s poll will sometimes read a
half-written in-place save, flash 🔴 and heal on the next poll. Correct behaviour, not a bug.

---

## Story traceability

| Story | Delivered by |
|---|---|
| **US-20** dry-run without acting | Steps 9, 11 · BR-25 · LC-15 |
| **US-23** see why a rule did or did not fire | Steps 6, 10, 12 · BR-23, BR-32 |
| **US-24** back-test against history | Steps 5, 10 · BR-27, BR-28 · PBT-21/22/22a |

| Requirement | Status at end of U4 |
|---|---|
| **FR-37** dry-run | ✅ |
| **FR-41** log rule, field values, verdict | ✅ |
| **FR-42** back-test | ✅ |
| **BR-20.8** last-known-good on reload | ✅ — and **exercised for the first time** |
| **FR-33** `hold` | ⚠️ **still PARTIAL** — U5. Unchanged by this unit |
| **FR-34/35/36**, FR-38/39/40, FR-23 | ⬜ U5 (FR-23 built, inert) |
