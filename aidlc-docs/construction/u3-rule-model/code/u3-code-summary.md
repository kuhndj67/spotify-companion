# Code Summary — U3: Rule Model & Evaluation

**Date**: 2026-09-11 · **Stage**: CONSTRUCTION — Code Generation, Unit U3
**Plan**: [`../../plans/u3-code-generation-plan.md`](../../plans/u3-code-generation-plan.md)

**620 tests passing** (up from 486) · typecheck clean · purity clean · no new `ALLOWED_ORPHANS`.

---

## The containment claim, verified

> **`git status src/` shows only `src/rules/`. Not one existing source file changed.**

No route, no `server.ts` wiring, no poll-loop change, no UI, no schema change, no migration. The
app behaves exactly as it did before this unit. `Decision` values are produced by `decide()` and
consumed by nothing until U4.

That was the point of putting the largest, least-certain component in a phase where being wrong
costs nothing.

---

## What was built

| File | Lines | Kind | Role |
|---|---|---|---|
| `src/rules/types.ts` | 300 | ⚙️ pure | `Verdict`, `Predicate`, `Rule`, `Decision`, bounds |
| `src/rules/fieldCatalogue.ts` | 245 | ⚙️ pure | LC-7 — the static table, 20 fields |
| `src/rules/trackFacts.ts` | 105 | ⚙️ pure | `assembleFacts` |
| `src/rules/predicate.ts` | 385 | ⚙️ pure | LC-8 — comparison + Kleene evaluation |
| `src/rules/ruleValidator.ts` | 330 | ⚙️ pure | LC-9 — the only component that says no |
| `src/rules/RuleEngine.ts` | 175 | ⚙️ pure | LC-10 — `onUnknown`, the OR-fold |
| `src/rules/RuleStore.ts` | 190 | 🔌 impure | LC-11 — reads `config/rules.json` |

**Six pure modules and one impure one.** The boundary is a file boundary, and `purity.test.ts`
now lists the six; `RuleStore.ts` is deliberately absent from that list.

| Test file | Covers |
|---|---|
| `test/predicate.property.test.ts` | PBT-11, 12, 13, 14, 17, 18, 19 |
| `test/ruleValidator.test.ts` | the failure table, PBT-14 |
| `test/ruleEngine.test.ts` | Kleene tables cell by cell, PBT-15, PBT-20 |
| `test/ruleStore.test.ts` | the eight-row failure table, PBT-16 |
| `test/fieldCatalogue.test.ts` | membership, notes, operator table |
| `test/trackFacts.test.ts` | nothing-is-defaulted |
| `test/ruleGenerators.ts` | depth-parameterised generators |

Deployment: `compose.yaml` (`./config:/config:ro` + `RULES_PATH`), `.gitignore`,
`config/rules.example.json`, `scripts/rules-init.mjs`, `package.json`.

---

## ⚠️ Three defects found during the build, each in something the design had already decided

### 1. The depth guard could not be reached

`depthOf` was written recursively — the obvious way. **It is the guard that stops `evaluate` from
overflowing the stack, and a recursive implementation overflows while computing the guard's own
input**, on exactly the trees the guard exists to refuse. The `RangeError` would have escaped from
the *validator* rather than the evaluator, and P-10 would have been strictly decorative.

Rewritten iteratively with an explicit stack and an early exit at the limit, so a pathological
tree costs O(limit) rather than O(tree). `predicate.property.test.ts` nests 50,000 levels and
asserts both that it does not throw and that it returns in under 50 ms.

> **A guard that is computed the same way as the thing it guards is not a guard.**

### 2. The generator was exponential

`treeOfDepth(depth)` called itself three times per level, constructing ~3^depth arbitraries. At
depth 20 it exhausted the heap and killed the test process with a V8 stack dump and no useful
message — it read as "property testing is slow", not "the generator is wrong". Fixed by building
the child arbitrary once and reusing it. Same bug in `predicateTree`.

### 3. `applyOnUnknown` threw on an unreachable branch

The first draft threw on `'hold'` to make the U5 seam loud. But **BR-21.1 says every pure function
is total**, and PBT-13 asserts no input throws — a test constructing a `LoadedRule` directly,
bypassing the validator, would have hit it. Totality wins; the compile-time tripwire comes from
the switch having no `default:`, which is what actually makes adding an `OnUnknown` member a
compile error.

### And one test that was wrong rather than one behaviour

A property asserted that every catalogue field reads `unknown` on blank facts. `track.title`,
`artist.name` and `album.name` are `availability: 'always'` and are never absent. Rewritten to
condition on whether the field *actually* reads null — which tests more, not less — plus a
companion check that any never-absent field is declared `always`.

---

## Decisions visible in the code

**`Verdict` is a string union.** No falsy member, so `if (verdict)` cannot silently collapse
`unknown` to `false`. The collapse has to be spelled out to be written.

**`exists` does not exist.** Under tri-state semantics it had only two reachable results and could
never return `false`. `is-unknown` and `not(is-unknown)` give one obvious way to write each
direction.

**`restedOnUnknown` is set from the raw verdict**, never accumulated while walking the tree.
`ruleEngine.test.ts` pins the distinction with a predicate that contains an unknown and still
resolves decisively — an accumulator reports `true` there, which is the option that was offered
and rejected.

**Genre matching is per element, on word boundaries.** `contains "rap"` matches `pop rap` and not
`trap`, `trap latino` or `trap metal`. The test asserts all four by name, because the substring
version reads as a working rule.

**Partial dates yield `unknown` for ordering.** Never widened, never coerced. Equality is a string
comparison, so `"2022" ≠ "2022-01-01"`.

**Structural vs semantic failure** is the validator's whole shape: a malformed file rejects the
set; a dead field, a bad operator, a too-deep tree or `onUnknown: 'hold'` disables one rule with a
reason. `ruleStore.test.ts` asserts that a valid rule does **not** survive alongside a structurally
invalid one — BR-20.6, the most dangerous rule in the unit to get wrong.

---

## Deployment notes

`npm run rules:init` creates `config/rules.json` from the committed example and **refuses to
overwrite**. Run it before the first `compose up`: Docker creates a missing bind-mount source
directory owned by **root**, and the entrypoint drops privileges to `node`, so a root-owned
`config/` leaves the app unable to read its own rules with a permissions error that reads like a
code fault.

`./config:/config:ro` mounts the **directory**, not the file. A single-file bind mount binds an
inode, and write-temp-then-rename replaces it — the U4 editor would break on a mount that works
perfectly here.

`docker compose config` validates. **The container has not been rebuilt**, and does not need to be
for this unit to be correct: nothing reads `RULES_PATH` yet.

---

## Requirements

| | Status |
|---|---|
| FR-26, 27, 28, 29, 30, 31, 32, 43, 44, 45 | ✅ |
| **FR-33** | ⚠️ **Partial** — `no-match` and `match` implemented; **`hold` is U5's** |
| NFR-25, 26, 27 | ✅ PBT-11…PBT-20 |

**Exit criteria: all met.** Tri-state property-tested, De Morgan holds, no input throws, invalid
rules rejected with usable messages, rules round-trip by behaviour, evaluation deterministic and
side-effect free, and no I/O, clock, network or database in any of the six pure modules.

**Done means CI green, and it is.**
