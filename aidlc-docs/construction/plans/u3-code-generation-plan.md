# Code Generation Plan — U3: Rule Model & Evaluation

**Date**: 2026-09-10 · **Stage**: CONSTRUCTION — Code Generation, Unit U3
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield (working code exists)

**This plan is the single source of truth for U3 code generation.**

---

## Unit context

| | |
|---|---|
| **Stories** | US-14, US-15, US-16, US-17 |
| **Requirements** | FR-26–33, FR-43–45, NFR-25–27 (FR-24/25 belong to the units that own the poll loop and UI) |
| **Depends on** | Nothing at runtime. `TrackFacts` has fields *sourced* from U1 and U2, but the dependency is **soft** — generators produce `unknown` for them directly |
| **Owns entities** | None. **No schema change, no migration** |
| **Provides to later units** | `Decision` values — consumed by **U4** (logging, back-test) and **U5** (skip executor) |
| **Design** | [functional](../u3-rule-model/functional-design/) · [NFR](../u3-rule-model/nfr-design/) · [infrastructure](../u3-rule-model/infrastructure-design/) — all approved 2026-09-10 |

**Brownfield rule**: existing files are modified in place. No `_new` or `_modified` duplicates.

> ### U3 produces `Decision` values that nothing consumes, and that is the point
>
> **No wiring into `server.ts`. No route. No poll-loop change. No UI.** The riskiest logic in the
> project is proven correct before anything depends on its behaviour. If this plan ends with the
> app behaving exactly as it does today, it has succeeded.

---

## ⚠️ One scoping decision to confirm before generation

**LC-12 `FactCache` — build it now, or defer it?**

NFR design specified it (Q5 = C: assemble the four history aggregates once per play, cache for that
play). But **U3 has no caller**: nothing evaluates rules on the poll path until U4/U5, so the cache
would have no production consumer and would exist only to satisfy its own tests.

A) **Defer `FactCache` to the unit that first evaluates rules on the poll path.** U3 builds the
   pure core plus `RuleStore` — exactly the six modules the unit-of-work names. P-16/LC-12 stay
   specified and are picked up with the caller, the same treatment `watch()` and BR-20.8 already
   received. *Recommended — it keeps the unit boundary where the design put it.*

B) **Build it now** with direct tests against a repository double. Nothing is left for later, but
   an impure component with no production caller lands a unit early, and its shape will be
   driven by guesses about a caller that does not exist yet.

**[Answer]:**
A — **defer.** Taken by recommendation: the user replied *"continue"* on 2026-09-11 with the tag
blank, and A was the stated recommendation. Recorded as an assumption rather than a decision.
`FactCache` / P-16 / LC-12 stay **specified and deferred** to the unit that first evaluates rules
on the poll path — the same treatment `watch()` and BR-20.8 received.

---

## Structure

```
src/rules/                       ← new feature dir, flat (Application Design Q3 = C)
  types.ts             ⚙️ PURE   Verdict, Predicate, Rule, Decision, field types
  fieldCatalogue.ts    ⚙️ PURE   LC-7  — the static table
  trackFacts.ts        ⚙️ PURE   assembleFacts
  predicate.ts         ⚙️ PURE   LC-8  — comparison + Kleene evaluation
  ruleValidator.ts     ⚙️ PURE   LC-9  — the only component that says no
  RuleEngine.ts        ⚙️ PURE   LC-10 — onUnknown, the OR-fold
  RuleStore.ts         🔌 IMPURE LC-11 — reads config/rules.json

test/                            ← mirrors src/
  ruleGenerators.ts              fast-check generators, DEPTH-PARAMETERISED
  predicate.property.test.ts     PBT-11, 12, 13, 17, 18, 19
  ruleValidator.test.ts          the failure table, PBT-14
  ruleEngine.test.ts             PBT-15, PBT-20
  ruleStore.test.ts              the failure-behaviour table, PBT-16
  fieldCatalogue.test.ts         membership, notes, operator table

config/rules.example.json        ← new, committed
scripts/rules-init.mjs           ← new
```

**Naming follows the existing convention**: lower-camel for pure function modules
(`outcomeClassifier.ts`, `playStats.ts`), Pascal for classes (`LabelCache.ts`, `RuleStore.ts`).

---

## Steps

### Step 1 — `src/rules/types.ts` ⚙️
- [x] `Verdict` as a **string union** (`'true' | 'false' | 'unknown'`) — no falsy member, so the
      collapse NFR-25 forbids cannot be written by accident
- [x] `Maybe<T>`, `Operator`, `FieldType`, `Availability`, `FieldDefinition`
- [x] `Predicate`, `Rule`, `LoadedRule`, `RuleStatus`, `DisabledReason` (incl. `too-deep`)
- [x] `TrackFacts` (no `context` group), `RuleOutcome`, `Decision` (incl. `unknownFields`)
- [x] Constants: `MAX_PREDICATE_DEPTH = 32`, `MAX_RULES = 1000`, `MAX_RULES_FILE_BYTES = 1_048_576`
- [x] **No `exists` in `Operator`** (BR-15.5) · *US-14*

### Step 2 — `src/rules/fieldCatalogue.ts` ⚙️
- [x] Static frozen table — **never reflection** over `TrackFacts` (BR-16.1)
- [x] `allFields()`, `findField()`, `operatorsFor(type)`
- [x] `availability` on every field; `note` on `label.classification` and the two artist-history
      fields (BR-16.4, BR-16.5)
- [x] `artist.genres` declared `type: 'string'`, `multiValued: true` (BR-17.3)
- [x] **No `context.*` fields** (BR-16.6, BR-16.7) · *US-14, US-16, US-17*

### Step 3 — `src/rules/trackFacts.ts` ⚙️
- [x] `assembleFacts(input)` — pure mapping, **no default ever substituted** (BR-21.5)
- [x] `evaluatedAtMs` taken as input; **no clock** (BR-21.3) · *US-16*

### Step 4 — `src/rules/predicate.ts` ⚙️
- [x] `is-unknown` evaluated **first** (BR-15.2), returns only `true`/`false` (BR-15.1)
- [x] Absent value ⇒ `unknown` for every other operator (BR-14.2)
- [x] `fold()` — NFKD, lowercase, strip non-alphanumeric (BR-17.1)
- [x] Genres: **per element, word boundaries**; `null` ⇒ `unknown`, `[]` ⇒ `false` (BR-17.4–17.6)
- [x] Partial dates ⇒ `unknown` for ordering; string compare for `eq`/`neq` (BR-17.7–17.9)
- [x] Kleene AND/OR/NOT tables; identity elements for empty lists (BR-14.3–14.6)
- [x] **Exhaustive, not short-circuiting** (BR-14.7) · *US-14, US-17*

### Step 5 — `src/rules/ruleValidator.ts` ⚙️
- [x] `validateRule`, `validateRuleSet` returning `ValidationResult`
- [x] **Structural** failures reject the whole set; **semantic** failures disable one rule
      (BR-20.3–20.5)
- [x] Depth bound → `too-deep` (BR-18.6a); `onUnknown: 'hold'` → `unsupported-on-unknown`
      (BR-18.6)
- [x] Duplicate `id` rejects the set (BR-20.4)
- [x] Usable messages naming rule index and field · *US-14, US-17*

### Step 6 — `src/rules/RuleEngine.ts` ⚙️
- [x] `evaluateRules` — only `enabled && status.state === 'active'` (BR-18.3)
- [x] `onUnknown` mapping; `'hold'` branch as an **exhaustiveness check** so U5 adding it is a
      compile error, not a silent fallthrough
- [x] `restedOnUnknown` from the **raw verdict**, never accumulated (BR-19.6)
- [x] `foldDecisions` — pure OR, one named function (BR-19.1, BR-19.8)
- [x] `partialData` is an **input**, never inferred (P-17)
- [x] `unknownFields` — union across evaluated rules · *US-15, US-17*

### Step 7 — `src/rules/RuleStore.ts` 🔌
- [x] `load()`, `current()`. **No `watch()`** (NFR Q3 = D)
- [x] Size and count bounds before parse (Q5 = A)
- [x] The eight-row failure table from `infrastructure-design.md`, including **absent file
      (info) vs absent directory (warn)**
- [x] Never a partial structural load (BR-20.6); never blocks startup (BR-20.10) · *US-15*

### Step 8 — Extend `test/purity.test.ts` **in this same change**
- [x] Add the six pure modules to `PURE_MODULES`
- [x] `RuleStore.ts` deliberately **not** added — it is the impure boundary (P-12)

> ⚠️ **This step does not get deferred to the end.** A pure module that nothing checks for purity
> is the 2026-09-06 coverage blind spot in a new place, and `noOrphanModules` will not catch it —
> a module can be imported by a test and still import a clock.

### Step 9 — `test/ruleGenerators.ts`
- [x] **Depth-parameterised** predicate tree generator, so PBT-14 can target 32/33 exactly rather
      than hope to reach it
- [x] `TrackFacts` generator emitting `null` for every `Maybe` field, and `[]` vs `null` for genres
- [x] Arbitrary-JSON generator for `value`, including `NaN`, `Infinity`, huge numbers, nested
      objects
- [x] Import `./fc-config.js` for seed reporting (PBT-08)

### Step 10 — Property tests
- [x] **PBT-11** tri-state never collapses · **PBT-12** De Morgan both ways · **PBT-13** no throw
- [x] **PBT-14** depth 32 validates, 33 disabled `too-deep`, neither throws
- [x] **PBT-15** determinism · **PBT-16** round-trip by **behaviour, not bytes**
- [x] **PBT-17** `is-unknown` totality · **PBT-18** genre word boundaries (`"rap"` ∌ `trap`)
- [x] **PBT-19** partial-date ordering · **PBT-20** `restedOnUnknown` iff raw verdict unknown

### Step 11 — Example and table tests
- [x] Kleene truth tables asserted cell by cell — including the two that look alike and mean
      opposite things: `false AND unknown === 'false'` vs `unknown !== 'false'`
- [x] `ruleValidator` failure table, one case per row
- [x] `RuleStore` failure table, one case per row, against fixture files in a temp dir
- [x] `fieldCatalogue` membership: `context.*` **absent**, notes present where required

### Step 12 — Deployment artifacts
- [x] `compose.yaml` — `./config:/config:ro` volume and `RULES_PATH`, with the recorded comments
- [x] `.gitignore` — `config/*` with `!config/rules.example.json`
- [x] `config/rules.example.json` — `{ "version": 1, "rules": [] }`
- [x] `scripts/rules-init.mjs` — creates `config/` as the invoking user, copies the example,
      **refuses to overwrite**
- [x] `package.json` — `rules:init` script

### Step 13 — Documentation
- [x] `aidlc-docs/construction/u3-rule-model/code/u3-code-summary.md`
- [x] `CLAUDE.md` — U3 row, and any non-obvious trap this build surfaces

---

## Not applicable to this unit

Recorded rather than skipped, per the stage's step list:

| Generic step | Why not |
|---|---|
| Project structure setup | Brownfield — `src/rules/` is the only new directory |
| API layer | **No route.** U3 is not reachable over HTTP. `/api/rules` is U4's |
| Repository layer | No entities, no schema change, no migration |
| Frontend components | **No UI.** The rule editor is U4's |
| Database migration scripts | None — U3 owns no tables |

---

## Verification

**Done means CI green** — the one unit gated on tests alone.

- [x] `npm test` — 486 existing plus the new suites, all passing
- [x] `npm run typecheck` — clean, covering `src` and `test`
- [x] `test/purity.test.ts` passes with the six new modules listed
- [x] `test/noOrphanModules.test.ts` passes with no new `ALLOWED_ORPHANS` entry
- [x] The app's behaviour is **unchanged**: no new route, no poll-loop change, nothing skipped

⚠️ **The container must not need rebuilding for this unit to be correct.** U3 changes no running
behaviour. `compose.yaml` gains a mount that the code reads only when something calls `RuleStore`,
which nothing does until U4.

---

## Story traceability

| Story | Steps |
|---|---|
| **US-14** — write a rule about anything the app knows | 1, 2, 4, 5 |
| **US-15** — run several rules at once | 6, 7 |
| **US-16** — write rules about my own listening history | 2, 3 |
| **US-17** — decide what a rule does when the data isn't there | 2, 4, 5, 6 |

**13 steps.** Seven new source modules, six new test files, one test file extended, five deployment
artifacts, two documents.
