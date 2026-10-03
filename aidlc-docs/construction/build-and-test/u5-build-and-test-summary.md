# Build and Test Summary — U5: Automated Skipping

**Date**: 2026-10-03 · **Stage**: CONSTRUCTION — Build and Test, Unit U5
**Companions**: [`build-and-test-summary.md`](build-and-test-summary.md) (U1) ·
[`u2-build-and-test-summary.md`](u2-build-and-test-summary.md) (U2) ·
[`u3-build-and-test-summary.md`](u3-build-and-test-summary.md) (U3) ·
[`u4-build-and-test-summary.md`](u4-build-and-test-summary.md) (U4)

> **U5 is the only unit that can cause harm.** Every other unit, wrong, produces a bad number in a
> report. This one, wrong, interrupts the music. ⚠️ **So a green suite is less sufficient here than
> anywhere else in the project**, and §6 lists what it does not cover.

---

## 1. Status

| | |
|---|---|
| **Typecheck** | ✅ clean, `src` and `test` |
| **Tests** | ✅ **1228 passing**, 0 failing (891 before U5) |
| **Coverage** | **99.16% line · 94.26% branch · 95.96% function** (was 99.39 / 93.27 / 95.82) |
| **Purity** | ✅ six new pure modules enforced, incl. `upstreamMetrics` and `ui/automationPanel` |
| **Orphan modules** | ✅ no new `ALLOWED_ORPHANS` entries |
| **Entry points** | ✅ `npm run smoke` — every `scripts/*.mjs` starts |
| **Dead code** | ✅ `npm run knip` clean; **4 dead exports and 1 undeclared dependency removed** |
| **Container build** | ✅ exit **0**, checked directly (not through a pipe) |
| **Container runtime** | ✅ live, `migrated 7:` **exactly once** |
| **Schema** | **v7** — migration 007, additive only · `integrity_check: ok` · **885 plays** |
| **Rollback** | ✅ **verified live**, including a U4 **write** to a v7 database |
| **App behaviour** | ⚠️ **UNCHANGED in effect** — shipped **inert**, see §5 |
| **Overall** | ✅ **PASS** |

⚠️ **Line coverage fell slightly** (99.39 → 99.16) while branch and function **rose**. U5 adds impure
wiring whose error branches are unreachable from a test — `AutomationStateStore` lines 12 and 30 are
`catch` arms for a filesystem that does not fail on demand, and `skipDrain` 73–74 is a defensive guard
on a state the queue cannot be in. ⚠️ **That is the honest shape of this unit**: the pure safety logic
is at 100%, and what is missed is the part that only a broken disk exercises.

### Coverage of the U5 modules

| Module | Line | Branch | Function |
|---|---|---|---|
| `playback/automationPredicate.ts` | **100.00** | **100.00** | **100.00** |
| `playback/safetyCounters.ts` | **100.00** | **100.00** | **100.00** |
| `playback/types.ts` | **100.00** | **100.00** | **100.00** |
| `playback/upstreamMetrics.ts` | **100.00** | **100.00** | **100.00** |
| `playback/SqliteSkipAttemptRepository.ts` | **100.00** | **100.00** | **100.00** |
| `playback/SkipExecutor.ts` | **100.00** | **100.00** | **100.00** |
| `ui/automationPanel.ts` | **100.00** | **100.00** | **100.00** |
| `ui/statusBar.ts` | **100.00** | 97.14 | **100.00** |
| `playback/skipDrain.ts` | 99.43 | 96.55 | **100.00** |
| `playback/playbackContext.ts` | **100.00** | 95.65 | **100.00** |
| `playback/spotifyPlayerClient.ts` | **100.00** | 95.45 | 87.50 |
| `playback/AutomationStateStore.ts` | 99.13 | 83.33 | 92.31 |

⚠️ **The four modules that decide whether a skip may fire are all at 100% on every axis.** That is the
distribution to want: `automationPredicate`, `safetyCounters`, `SkipExecutor` and the repository that
enforces one-attempt-per-play. The gaps are in transport and filesystem error handling.

---

## 2. The phase boundary, replaced rather than retired

U3's containment guarantee was *"`git status src/` shows only `src/rules/`"*. U4's was
*"`src/playback/` does not exist"*. ⚠️ **U5 necessarily ends both.** What replaces them is
`test/playbackBoundary.test.ts`, asserted over the **source text**:

| Pinned | Why |
|---|---|
| Nothing under `src/rules/` **imports** `src/playback/` | The uncertain component must not reach into the one that can cause harm |
| `SpotifyPlayerClient.prototype` exposes **exactly `skipToNext`** | A client that grew `pause`/`seek` would widen what a drain defect can do |
| The module names no other `/me/player/*` endpoint | The method count cannot see a second endpoint called from inside |
| `new SkipDrain(` appears **once**, with two entry points calling it | Two drains would mean two queues and two re-entrancy guards |
| `sweepOrphaned()` precedes `new SkipExecutor(` **in file order** | P-29's ordering *is* the guarantee |
| `LoggingExecutor.length === 1` | U4's arity pin, still passing |

⚠️ **The import check strips comments first, and that is load-bearing.** `LoggingExecutor.ts` and
`DecisionLogRepository.ts` both *discuss* `src/playback/` while explaining the rule. A naive
`includes('playback/')` fails on them, and the natural "fix" is to delete the sentences rather than the
import. A second test asserts those files still mention it, so the first cannot pass by the two trees
never meeting.

---

## 3. Defects found during this unit, and how

⚠️ **None of these was found by the test suite.** Four were found by reading, one by a compiler error,
one by a tool added in step 12, and one by running the thing.

| # | Defect | Found by |
|---|---|---|
| 1 | `skip_attempt.play_id NOT NULL` was **impossible** — the play row is written at close, a skip happens mid-play | Design review, step 4 |
| 2 | `context_type` **already existed** since the v1 schema; re-adding it would have failed the `ALTER` and aborted migration 007, leaving the app display-only with a healthy-looking UI | A **duplicate identifier** compiler error |
| 3 | `confirmed()` **always returned true** — it read the evidence column from the row loaded *before* the transition wrote it, so both comparisons were against `null`. A permanently green light | A test asserting *track change without a progress reset* |
| 4 | `>= 10` written in place of `MAX_RULE_SKIPS_PER_HOUR` — a second copy of a pre-registered threshold | Reading |
| 5 | `RunawayHalt.attemptIds` **synthesised from array indices** — would have named attempts that do not exist, in the one place the user reviews evidence before clearing a safety latch | Reading |
| 6 | `skipAttempts.attachPlayId` had **two call sites**, and the one on `PlayObserver.onPlayRecorded` lacked the coordinator's *is this still the play that was decided* guard — on a fast transition it would attach the **closing play's id to the next play's attempt** | Reading, step 10 |
| 7 | `switchView`'s *machinery not built* branch hard-coded `warning: null`, so a **failed save vanished behind the greyed control** | A route test, step 11 |
| 8 | `decorate()` called `statusIndicators()` **twice per tick** — harmless until U5 made each call read a file and query SQLite, and the two could have **disagreed** | Reading, step 11 |
| 9 | Four dead exports, one undeclared dependency (`ajv`) | ⚠️ **`knip`, on its first run** |
| 10 | The step-12 smoke runner passed `--dry-run` to a script with **no such flag**, and ran three genuine writers | ⚠️ **Running it, and checking what it touched** |

⚠️ **Defect 6 is the WebSocket `403` shape for the fourth time in this project**: one rule implemented
twice, with the second copy missing a term. It was fixed by **removing the copy**, not by adding the
term, and is now pinned structurally — because what is being prevented is a future edit.

⚠️ **Defect 10 is worth its own line.** The runner built to catch *"a tool that cannot start"* shipped
with an unrecognised flag that read as a safety mode. Nothing irreplaceable was touched and no upstream
budget was spent **because a cache happened to be warm** — luck, not design. Writers are now skipped
with a reason, every flag is checked against the target script's source, and a `--self-test` proves
that check can fail.

---

## 4. The two CI guards added in step 12 (NFR Q9)

`scripts/` holds 20 files, all of them untested, and it is **outside `noOrphanModules.test.ts`**, which
walks `src/` only. That gap produced three findings in eight days, including `npm run reclassify` being
**unable to start for a week** while 891 tests stayed green.

| Guard | What it catches | What it does NOT |
|---|---|---|
| `npm run smoke` | A script that cannot **load** — `SyntaxError`, `ERR_MODULE_NOT_FOUND`, `does not provide an export named` | That the script **works**. A dry run doing nothing silently would pass |
| `npm run knip` | Unused files, exports and dependencies, over `src/` **and** `scripts/` — the **method-level** half the orphan check structurally cannot do | Anything about behaviour |

⚠️ **`node --check` would not have caught the reclassify breakage**: a missing named export is a
*link-time* failure, not a parse error. The module has to be evaluated — and evaluating it by importing
is only safe for scripts that guard their `main()`, which `reclassify-unobserved-tails.mjs` does not.
**So the convention is *invoke the safe mode*, never *import the file*.**

⚠️ **A non-zero exit is deliberately not a failure.** `backup-history.mjs` exits 2 while the container
is up, because SQLite's locks do not cross the bind mount and `docker ps` is the only working check.
**That refusal is the guard working**, and a smoke test demanding exit 0 would pressure someone into
weakening it.

---

## 5. ⚠️ Deployed INERT, and that is the delivered state

`SKIP_EXECUTOR_ENABLED: "false"`, so **`SkipExecutor` is never constructed** — no player client, no
drain, no attempt rows. The rules engine evaluates and logs exactly as it did in U4.

**Two off switches, and they are not redundant:**

| | answers | changing it | checked |
|---|---|---|---|
| `SKIP_EXECUTOR_ENABLED` | *is the machinery built at all?* | `compose.yaml` + restart | once, at startup |
| `globalAutomationEnabled` | *may a built attempt fire?* | one UI click | **every action point** |

⚠️ Collapsing them breaks FR-38: a control that needs a restart cannot satisfy *no skip is issued after
the switch is thrown*. And dropping the first would lose the ability to ship inert for the dry-run
review, which is **BR-40.1's actual arming gate**.

### Verified live, through the container

| Check | Result |
|---|---|
| `migrated 7:` in the startup log | **exactly once** |
| Schema / integrity | **v7** · `ok` · 885 plays · 987 decision rows · **0** skip attempts |
| `skip_attempt` shape | `evaluation_id NOT NULL`, **`play_id` nullable**, 3 indexes |
| `decision_log.trigger` | `TEXT NOT NULL DEFAULT 'initial'` |
| `/state` writability | ✅ **`writable`**, probed by the app as the `node` user |
| Kill switch write path | ✅ `false → true → false`, each read back **from disk** |
| ⚠️ Host vs container file content | ✅ **identical** — the write-temp-then-rename survived the bind mount |
| `GET /` | **200** |
| WebSocket handshake | **101** local · **403** cross-site `Origin` |
| Route guards | acknowledge-with-no-halt **409** · `enabled: "true"` **400** · `reArm` omitted **400** |
| Status bar | **5 dots**, automation last: `Automation off` / `disabled` / `⊘`, level in the aria-label |
| Rules pop-up | *Automated skipping* first, **disabled** button, server-derived explanation, no halt panel |
| Browser console | ✅ **no errors or warnings** |
| M1–M4 | live on `/api/diagnostics` — polls counted, idle share 1.0 with nothing playing |

⚠️ **The inode hazard is now EVIDENCE rather than inference.** U3 and U4 could only describe it; U5's
`AutomationStateStore.write` is the first code in this project that actually does
write-temp-then-rename into a bind mount, and a single-file mount would have detached the container's
view on the **first** kill-switch change.

### Rollback, verified live

U4's image is tagged **`spotify-now-playing:u4-rollback`**. Against a **v7 copy**:

- `migrate()` reports `{from: 7, to: 7, applied: []}`
- every U4 read path works — `listPlays`, `getTrail`, `decisionLog.list`, `count`, `coverage`,
  `trackPlayStats`, `labelCoverage`
- ⚠️ **a U4 `INSERT` into a v7 `decision_log` succeeds**, and `trigger` defaults to `'initial'`
- `integrity_check: ok` after that write

> ⚠️ **Reading the skip line alone would have proved only that 007 is skipped**, not that U4's code runs
> correctly against an unread table and three unread columns. The plan said so, and the **write** is
> what actually closes it.

---

## 6. ⚠️ What a green suite does NOT cover

Two exit criteria remain, and neither is a test:

1. **The dry-run review that arms the first rule** — BR-40.1's actual gate. User judgement.
2. **The first real skip, heard by the user**, confirming it costs **2–3 s** rather than 18–41 s
   (probe P-U5-1 predicts 2–3 s; nothing has verified it with automation acting).

> ⚠️ **Three separate U2 defects all passed the full test suite** and were found only by running the
> system and watching a real failure get *recorded*. **U5's equivalent failure is audible.**

⚠️ **The BR-35 thresholds are pre-registered** in
[`../u5-automated-skipping/safety-thresholds/pre-registration.md`](../u5-automated-skipping/safety-thresholds/pre-registration.md),
in its own commit, written while `skip_attempt` held 0 rows. **Expect `3 consecutive` to trip before
`10/hour`**: the broadest armed rule matches 16.4% of plays against the ~37% needed to trip the hourly
limit at peak — but 16.4% says nothing about **adjacency**, and three consecutive major-label tracks is
an ordinary run inside an album.

⚠️ **W-6 is not closed by step 12.** `smoke` and `knip` are *guards*; mutation testing, BR-derived
tests, the negative-control convention and container-parity probes remain backlog, and W-6.2 wants
BR-33…BR-43 backed by shipped code — which is only now true.
