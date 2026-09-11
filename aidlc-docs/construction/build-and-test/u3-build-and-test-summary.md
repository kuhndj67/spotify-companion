# Build and Test Summary — U3: Rule Model & Evaluation

**Date**: 2026-09-11 · **Stage**: CONSTRUCTION — Build and Test, Unit U3
**Companions**: [`build-and-test-summary.md`](build-and-test-summary.md) (U1) ·
[`u2-build-and-test-summary.md`](u2-build-and-test-summary.md) (U2)

---

## Status

| | |
|---|---|
| **Typecheck** | ✅ clean, `src` and `test` |
| **Compile** | ✅ clean → `dist/`, exit **0** |
| **Tests** | ✅ **620 passing**, 0 failing (486 before U3) |
| **Coverage** | **99.26% line · 93.10% branch · 97.53% function** (was 99.19 / 92.86) |
| **Purity** | ✅ six new pure modules enforced |
| **Orphan modules** | ✅ no new `ALLOWED_ORPHANS` entries |
| **Container build** | ✅ exit **0**, checked directly |
| **Container runtime** | ✅ recreated and verified end to end |
| **App behaviour** | ✅ **unchanged — U3 is reachable from nothing** |
| **Overall** | ✅ **PASS** |

U3's gate is **CI only** by design — its correctness is entirely a property of pure functions, and
a live listening session would tell us nothing a property test does not.

### Coverage of the U3 modules

| Module | Line | Branch | Function |
|---|---|---|---|
| `trackFacts.ts` | **100.00** | **100.00** | **100.00** |
| `fieldCatalogue.ts` | **100.00** | 96.43 | **100.00** |
| `RuleStore.ts` | 98.89 | 93.55 | 72.73 |
| `RuleEngine.ts` | 98.84 | 96.15 | **100.00** |
| `predicate.ts` | 98.54 | 88.03 | 90.91 |
| `ruleValidator.ts` | 98.46 | 89.42 | **100.00** |

`RuleStore`'s function coverage is the default logger, which the tests replace with a recorder in
order to assert log *levels*. The uncovered lines elsewhere are unreachable defensive branches —
the `default:` arms that keep evaluation total.

---

## Build

```bash
npm run typecheck   # exit 0
npm run build       # exit 0 -> dist/rules/*.js
npm test            # 620 passing
npm run test:coverage
docker compose build   # exit 0
```

⚠️ **Every exit code above was captured directly, not through a pipe.** `docker compose build | tail`
reports the *pipe's* status, and a failing build has already read as success once in this project.

---

## The claim this unit had to prove, and how it was checked

> **U3 produces `Decision` values that nothing consumes.**

| Check | Result |
|---|---|
| `git status src/` after the change | **only `src/rules/`** — no existing source file touched |
| `grep -c rules src/api.ts` | **0** — no route |
| `grep -n rules src/server.ts` | one hit, an unrelated comment about local-access rules |
| Container logs after restart | **no rules log line** — nothing reads `RULES_PATH` |
| Schema version | **v4, unchanged** — no migration |

If a later session finds the rules engine affecting app behaviour before U4/U5, that is a
regression of the phase boundary, not progress.

---

## Container verification

The running deployment was on the **old** compose file. The new `./config:/config:ro` mount would
otherwise have been exercised for the first time at an unattended reboot — and a broken mount means
the app does not start, which means **recording stops silently**. That is the shape of latent
failure this project exists to avoid, so the container was recreated deliberately, with the corpus
recorded before and after.

| Check | Result |
|---|---|
| `docker compose up -d` | exit **0**, recreated and healthy in 7s |
| UI `http://localhost:3010/` | **200** |
| `/api/health` | `{"status":"ok","mcp":"connected","toolCount":30}` — a real MCP round-trip |
| **WebSocket handshake** | **101 Switching Protocols** |
| Cross-site `Origin` | **403** |
| `/config` in container | mounted, both files visible |
| Write to `/config` | **refused — "Read-only file system"** |
| `PRAGMA integrity_check` | **ok** |
| `journal_mode` | **wal**, intact over the bind mount |
| Play rows before / after | **428 / 428**, no loss, no duplication |
| Live observation trails | **343**, all intact |

The WebSocket check is included because a `200` on `/` does not imply the live display works — that
surface was the blind spot behind the 2026-09-05 `403`, where every page load succeeded and every
handshake failed while all 411 tests passed.

⚠️ **One claim from the infrastructure design needs narrowing.** It warned that Docker creates a
missing bind-mount source directory **owned by root**, leaving the app unable to read its own
rules. On this Rancher Desktop / Windows host the bind mount synthesises `rwxrwxrwx root:root`
regardless, so the files are world-readable and the app reads them fine. **The hazard is real on a
Linux host and does not reproduce here.** `npm run rules:init` still earns its place — it creates
the file from the template and refuses to overwrite — but the root-ownership rationale is
host-specific and should not be cited as if it had been observed.

---

## Defects found during this unit

Four, all during code generation and all recorded in
[`../u3-rule-model/code/u3-code-summary.md`](../u3-rule-model/code/u3-code-summary.md):

1. **The depth guard could not be reached** — `depthOf` was recursive, so it would have overflowed
   while computing the guard's own input, on exactly the trees the guard exists to refuse. Now
   iterative with early exit; the property suite nests 50,000 levels.
2. **The tree generator was exponential** — `3^depth` arbitraries; exhausted the heap at depth 20
   and killed the test process with no useful message.
3. **`applyOnUnknown` threw on an unreachable branch** — contradicting BR-21.1's totality and
   PBT-13. The compile-time tripwire comes from the switch having no `default:`, not from a throw.
4. **A test was wrong rather than a behaviour** — it asserted that every catalogue field reads
   `unknown` on blank facts, but three fields are `availability: 'always'`.

**None were found by running the system**, unlike U2's three — which is the expected shape for a
unit with no runtime. `noOrphanModules.test.ts` did catch an untested module immediately
(`trackFacts.ts`), and the gap was filled rather than allowlisted.

---

## Requirements

| | Status |
|---|---|
| FR-26–32, FR-43–45 | ✅ |
| **FR-33** | ⚠️ **Partial — `hold` is U5's.** Do not mark complete on these tests |
| NFR-25, NFR-26, NFR-27 | ✅ PBT-11 … PBT-20 |

**All seven U3 exit criteria met.** Tri-state property-tested, De Morgan holds both ways, no input
throws, invalid rules rejected with usable messages, rules round-trip by behaviour rather than
bytes, evaluation deterministic and side-effect free, and no I/O, clock, network or database in any
of the six pure modules.
