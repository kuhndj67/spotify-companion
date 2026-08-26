# Unit Test Execution

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Build and Test

---

## Run

```bash
npm test              # all suites
npm run test:watch    # re-run on change
npm run test:coverage # with coverage report
```

**Current results: 193 tests, 193 passing, 0 failing.**
Coverage: **99.41% line · 93.00% branch** across all files.

---

## Suites

| File | Covers |
|---|---|
| `parseNowPlaying.example.test.ts` | Markdown parser, upstream template |
| `parseNowPlaying.property.test.ts` | Round-trip property (PBT-02) |
| `localGuard.test.ts` | Loopback, Host, Origin, DNS-rebinding |
| `enrichment.test.ts`, `enrichmentService.test.ts` | Art selection, age, caching |
| `webApiClient.test.ts` | Token refresh, 401/429/403 |
| `nowPlayingService.test.ts` | Poll loop, change suppression |
| **`outcomeClassifier.test.ts`** | BR-1/BR-2 behaviours and edge cases |
| **`outcomeClassifier.property.test.ts`** | Properties P-1 … P-11 |
| **`historyRepository.test.ts`** | Round-trip, migration, streaming, coverage |
| **`playObserver.test.ts`** | Segmentation, attribution, degraded operation |
| **`serialisers.test.ts`** | `unknown` rendering, CSV escaping, P-10 |
| **`historyIntegration.test.ts`** | Full pipeline (see integration instructions) |
| **`purity.test.ts`** | Pure modules import nothing impure |

Bold entries are new in U1.

---

## The seed

Property tests select a seed per run and log it with a replay command:

```
FC_SEED=1266874889 npm test
```

A per-run seed is deliberate (PBT-08): a frozen seed explores the same inputs forever, which
defeats the purpose. CI derives the seed from the run ID and writes it to the job summary.

---

## Tests that deserve attention when they fail

### `purity.test.ts`

Asserts that `outcomeClassifier`, `types`, `serialisers` and `parseNowPlaying` import no I/O and
use no ambient non-determinism (`Date.now`, `Math.random`, `process.env`, `fetch`, timers).

**A failure here is not a style violation.** A clock inside the classifier breaks FR-20
(reclassification stops being reproducible) and FR-42 (back-testing stops replaying live
behaviour) **while every other test still passes**. It is the only check that catches that class
of defect.

It also contains meta-tests asserting the detector still detects — a green check that verifies
nothing would be worse than no check at all.

### The short-track limitation tests

Two tests assert that a 20-second track played in full resolves **both ways** depending on where
the final poll lands. That is not flakiness; it is the accepted, documented limitation (U1 FD Q6),
pinned so it stays visible and so a future fix registers as a deliberate change.

### `P-3: completionRatio is NOT bounded above`

Guards against "defensive" clamping to 1.0. Clamping would silently destroy the repeat-listen
signal — the difference between hearing a track once and four times.

---

## If tests fail

1. Read the failure — property failures print a **shrunk counterexample**, usually the minimal
   input that reproduces it.
2. Replay deterministically with the logged `FC_SEED`.
3. Paste the counterexample into the matching `.test.ts` as a pinned regression case.
4. Fix, then confirm the pinned case passes and the property no longer shrinks to it.

Three of the four defects found during U1 code generation were found this way, including one where
a **test helper modelled an impossible state** and made three tests pass that should have failed.
