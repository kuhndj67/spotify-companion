# Build and Test Summary — U4: Rule Observability

**Date**: 2026-09-22 · **Stage**: CONSTRUCTION — Build and Test, Unit U4
**Companions**: [`build-and-test-summary.md`](build-and-test-summary.md) (U1) ·
[`u2-build-and-test-summary.md`](u2-build-and-test-summary.md) (U2) ·
[`u3-build-and-test-summary.md`](u3-build-and-test-summary.md) (U3)

---

## Status

| | |
|---|---|
| **Typecheck** | ✅ clean, `src` and `test` |
| **Tests** | ✅ **866 passing**, 0 failing (620 before U4) |
| **Coverage** | **99.39% line · 93.27% branch · 95.82% function** (was 99.26 / 93.10 / 97.53) |
| **Purity** | ✅ seven new pure modules enforced |
| **Orphan modules** | ✅ one new `ALLOWED_ORPHANS` entry — `rules/DecisionLogRepository.ts`, interface only |
| **Container build** | ✅ exit **0**, checked directly, three times |
| **Container runtime** | ✅ recreated and verified end to end |
| **Schema** | **v6** — migrations 005 and 006, both additive |
| **App behaviour** | ⚠️ **CHANGED, by design** — U3's containment guarantee retires here |
| **Overall** | ✅ **PASS** |

⚠️ **Function coverage fell** from 97.53% to 95.82%. That is not a regression in what is tested:
U4 adds impure wiring with defensive branches (a watcher's `stop()` when never started, a
repository's error paths), where U3 added pure functions exercised exhaustively. Line coverage
rose.

### Coverage of the U4 modules

| Module | Line | Branch | Function |
|---|---|---|---|
| `skipAttribution.ts` | **100.00** | **100.00** | **100.00** |
| `decisionSummary.ts` | **100.00** | **100.00** | **100.00** |
| `rulesDiagnostics.ts` | **100.00** | **100.00** | **100.00** |
| `decisionTrace.ts` | **100.00** | 96.00 | **100.00** |
| `factReconstructor.ts` | **100.00** | 93.94 | 87.50 |
| `BackTestService.ts` | **100.00** | 86.84 | **100.00** |
| `LoggingExecutor.ts` | **100.00** | 80.00 | **100.00** |
| `ruleHash.ts` | **100.00** | 77.78 | **100.00** |
| `liveFactSource.ts` | 99.57 | 80.00 | 92.31 |
| `EvaluationCoordinator.ts` | 99.26 | 90.91 | 94.12 |
| `statusBar.ts` | 98.64 | 95.24 | **100.00** |
| `SqliteDecisionLogRepository.ts` | 98.43 | 78.05 | 93.33 |
| `RuleSetWatcher.ts` | 93.42 | 89.29 | 70.59 |

`RuleSetWatcher` is the lowest, and knowingly: its uncovered lines are the polling timer's own
callback path. ⚠️ **A unit test of that timer would prove nothing about the only place it runs** —
`fs.watch` was probed dead over the Rancher Desktop bind mount, and the poll's value is that it
works *there*. It was verified live instead, twice.

---

## The claim this unit had to prove

> A rule set can be authored, evaluated against real listening, recorded, explained and replayed —
> **without anything being able to act on the result.**

### 🔒 The phase boundary held

| Check | Result |
|---|---|
| `src/playback/` exists | ❌ **no** |
| `LoggingExecutor` constructor arity | **1** — the decision log, nothing else. Pinned by a test |
| Anything in `src/rules/` importing a Spotify write client | ❌ none |
| `globalAutomationEnabled` | constant `false` |
| Every decision row | `dry_run = 1`, `executed = 0`, `error = NULL` |

⚠️ U3's guarantee was *"`git status src/` shows only `src/rules/`"*. U4 necessarily changed the
poll loop, `api.ts`, the schema and the UI, so that retires here — **deliberately, and stated
rather than discovered.**

---

## Live verification

Three exit criteria could not be closed by CI. All three are now closed.

### 1. The dry-run agreement gate ✅

Three rules authored against measured corpus behaviour, run over a full day of listening.
**65 decisions, 195 rows, 37 matches.** The user read the log and agreed with it.

⚠️ **It did more than pass** — reading it is what exposed the `skip_source` defect below, which
no test could have found. That is the argument for the gate existing.

### 2. The `partialData` rate ✅ — the first real measurement of enrichment latency

| | |
|---|---|
| Decisions | **65** |
| Cap fired (`partialData`) | **0** |
| Settle time — median | **4.1 s** |
| p90 | **7.2 s** |
| **max** | **9.0 s** |

`ENRICHMENT_WAIT_MS = 10 000` was an admitted guess. It is **correct but not generous**: the
slowest observed settle leaves **1.0 s of headroom**.

⚠️ **Do not lower it on the strength of the median.** An earlier reading of this same data — max
6.9 s — suggested 7–8 s was safe. A few hours more listening produced a 9.0 s settle, which 8 s
would have truncated. **The tail moved and the median did not**, which is the whole reason the cap
is set from the maximum rather than a quantile.

### 3. BR-20.8 — last-known-good on reload ✅ **run for the first time since U3 specified it**

`config/rules.json` was broken by hand (a removed `{`). Within one 5 s poll:

| Surface | Result |
|---|---|
| Log | `reload rejected — still running v1 (3 rule(s))` + `invalid JSON: … line 5 column 11` |
| `GET /api/rules` | `state: rejected`, `version: 1`, 3 rules still loaded |
| Status indicator | `fail · Rules v1 · …Still running v1.` |
| **Evaluation continued** | ✅ **decision at 00:53:23, 51 s after the rejection, all 3 rules evaluated** |

On repair: **v1 → v2**, rejection cleared, `contentHash` identical to before the break — the
content hash proved the restored set was the *same* set, which a counter could not have shown.

⚠️ **The last row is the one that mattered.** A silent last-known-good is indistinguishable from a
successful reload; the point of BR-20.8 is that the app keeps working *and* says it is running
something other than what is on disk.

---

## Container verification

```
docker compose down          # the writer stopped first, every time
cp -r data/ data/backup-…    # verified integrity_check: ok before proceeding
docker compose build         # exit code read DIRECTLY, not through a pipe: 0
docker compose up -d
docker logs … | head -40     # "migrated 5: …" / "migrated 6: …" exactly once each
```

| Check | Result |
|---|---|
| UI | `200` |
| WebSocket handshake, same-origin | **`101`** |
| WebSocket handshake, cross-site `Origin` | **`403`** |
| `integrity_check` | **ok** |
| Schema | **v6** |
| Plays | **613**, observations **32,750** |
| Decision links | **195 linked**, 0 pending, 0 `link-failed` |

⚠️ **Both WebSocket directions were checked.** A `200` on `/` does not imply the live display
works — that was the shape of the `403` that left the UI on "Disconnected" for a whole deployment
while 411 tests passed.

---

## Defects found during this unit

Five, and ⚠️ **four were invisible to the test suite**.

### 1. `skip_source = 'user'` was an assertion — and wrong on half the skips

Found by the user: *"I NEVER skip Ren tracks yet it's showing multiple skips."*

The observer did exactly what it said. The corpus turned out bimodal with an **empty band** —
17 skips at ratio ≤ 0.49, nothing between 0.489 and 0.807, then 18 at 0.81–0.90 each losing
21–41 s. A second independent measurement agreed: every genuine skip is followed by a track seen
within 3 s, while the upper cluster's successors had been playing for a median of 7 s and up to
31 s.

Crossfade was ruled out (Spotify caps it at 12 s) and wrong duration metadata was ruled out (the
same tracks reach full length on other plays). ⚠️ **The mechanism remains unproven**, so the new
value names no cause: `unattributed` says *not the listener* and nothing more.

Fixed by migration 006 and `skipAttribution.ts`. `outcome` was deliberately **not** changed — the
gate's eligibility is pre-registered.

### 2. `trackPlayStats` re-implemented `bucketOf` inline

Teaching `bucketOf` the new rule fixed the weekly chart and left the **per-track panel** — the
surface actually being looked at — still reporting the same wrong number. ⚠️ Same shape as the
WebSocket `403`: one rule, two implementations, tests green because they exercised the copy that
had been updated. The duplicate is gone.

### 3. ⚠️ `history.db` was corrupted by running a maintenance script against the live container

Two writers on one SQLite file — the hazard CLAUDE.md states in capitals, read as being about
`npm start` when it is about **writers**.

It reported `integrity_check: ok` and a verification query returned the right answer. The damage
surfaced later as a just-written value reading `null`: the write *had* landed, but the **index**
had come apart, so queries returned wrong rows instead of failing. ⚠️ **A corrupt index answers
questions.**

⚠️ **`VACUUM INTO` did not repair it** and produced worse damage in a fresher-looking file —
`Rowid out of order`, NULLs in NOT NULL columns. It rebuilds from the b-tree it is given.

**Recovered completely**: 613 plays, 32,750 observations, `integrity_check: ok`,
`foreign_key_check` empty, zero rows lost. Possible only because of a backup taken seven minutes
earlier as a checklist step. `data/` is gitignored; there was no other copy.

### 4. Open item 4's four numbers were all n≈10, and none replicated

Its conclusion — *"correcting the confound could only move the result toward R1"* — had reached
three documents including the hypothesis-gate result. Re-measured on 586 plays, the mechanism, the
duration gap, the threshold crowding and the direction all failed. Rewritten; the gate result got
an **addendum, not an edit**.

### 5. The `explicit` / `album_type` write path was in no scope table

Caught by `tsc` the moment the fields became non-optional. Without it, two columns would have
shipped, stayed null on every row, and been read back as *unanswerable* for ever — with the
migration reporting success.

---

## Requirements

| Requirement | Status |
|---|---|
| **FR-37** dry-run | ✅ |
| **FR-41** log rule, field values, verdict | ✅ |
| **FR-42** back-test against history | ✅ — ⚠️ delivered but **not surfaced in the UI** (Q2 = A) |
| **BR-20.8** last-known-good on reload | ✅ **and exercised live** |
| **FR-33** `hold` | ⚠️ **still PARTIAL** — U5. Unchanged by this unit |
| **FR-23** exclude rule-initiated skips | ✅ built, **inert until U5** |
| FR-34/35/36, FR-38/39/40 | ⬜ U5 |

---

## ⚠️ What U5 inherits, and must not assume

**Half the gate's skips are now known not to be rejections.** U5's premise is acting on rules
validated against the outcome variable, and the back-test's agreement counters
(`agreedWithUserSkip`, `missedUserSkip`) still count **every** `skipped` row regardless of
attribution.

That is not a defect in U4 — the attribution arrived after the back-test was written — but U5
must decide, in writing, whether an `unattributed` skip counts as agreement. Inheriting the
current behaviour silently would mean arming rules against a target that is half noise.
