# Code Generation Plan — U2: Label Enrichment

**Date**: 2026-08-31 · **Stage**: CONSTRUCTION — Code Generation, Unit U2
**Workspace root**: `d:/Software/Spotify` · **Project type**: Brownfield (working code exists)

**This plan is the single source of truth for U2 code generation.**

---

## Unit context

| | |
|---|---|
| **Stories** | US-08, US-09 · liked-transitions (added by decision) |
| **Requirements** | FR-12–16, FR-50, FR-51, NFR-14–16, NFR-18, NFR-24 |
| **Depends on** | U0 (`nowPlayingService`, `server`, `config`, `webApiClient`), U1 (`HistoryRepository`, `play`) |
| **Owns entities** | `label_resolution`, `label_candidate`, `label_signal_vote`, `artist_label_resolution`, `artist_label`, `artist_label_signal_vote` |
| **Provides to later units** | Label verdicts as rule fields (U3), coverage metrics (U4) |

**Brownfield rule**: existing files are modified in place. No `_new` or `_modified` duplicates.

### Container compatibility is a standing constraint

Rancher Desktop packaging is a stated goal (user, 2026-08-31), so open item 1 is a *when*, not an
*if*. **No host-only assumptions**: paths go through `config.ts`'s existing `inContainer`
detection, nothing depends on a terminal staying open, and `compose.yaml` is kept current.

---

## Structure

```
src/musicbrainz/     ← new feature dir (flat, Application Design Q3 = C)
src/spotify/         ← LikedSetCache joins the existing dir
test/                ← mirrors src/
```

---

## Steps

### A. Pure core — the correctness-critical part

Every module here is `⚙️ PURE` and must stay so. **BR-4.8**: a `Date.now()` or a config read in
`labelClassifier` breaks FR-42 *while every other test passes*; `test/purity.test.ts` is the only
thing that catches it, and step A6 extends it.

- [x] **A1.** `src/musicbrainz/types.ts` ⚙️ — resolutions, candidates, votes, verdicts, trace shapes
- [x] **A2.** `src/musicbrainz/majorRootList.ts` ⚙️ — curated major-label roots + normalisation
- [x] **A3.** `src/musicbrainz/isrcPrefix.ts` ⚙️ — ISRC registrant → vote (the only 100%-coverage signal)
- [x] **A4.** `src/musicbrainz/releaseNarrowing.ts` ⚙️ — cascade `title+date → title → all`, returns tier (BR-2)
- [x] **A5.** `src/musicbrainz/labelClassifier.ts` ⚙️ — candidates + roots → verdict, confidence, votes (BR-3, BR-4, BR-5, BR-6)
- [x] **A6.** `test/purity.test.ts` — **extend** `PURE_MODULES` with all four new pure modules
- [x] **A7.** `test/labelGenerators.ts` — domain generators for candidates, releases, ISRCs
- [x] **A8.** `test/labelClassifier.test.ts` — the measured cases: Faouzia (`Publisher` → `unknown`), Audioslave (two majors → `contested`), Spinefarm (ownership ≠ distribution), `[no label]` → `unknown`, `broke` (`Distributor` → weak independent)
- [x] **A9.** `test/labelClassifier.property.test.ts` — asymmetry properties: any strong major ⇒ `major`; `independent` requires **no** major vote at any strength; `unknown` never becomes `independent`
- [x] **A10.** `test/isrcPrefix.test.ts` + `test/releaseNarrowing.test.ts`

### B. Repository layer — migration 002 and versioned access

- [ ] **B1.** `src/history/migrations.ts` — **migration 002**: 6 tables, 16 `play` columns, 6 indexes (additive, forward-only)
- [ ] **B2.** `src/history/HistoryRepository.ts` — extend the interface: resolution read/write, as-of-play lookups, coverage query
- [ ] **B3.** `src/history/SqliteHistoryRepository.ts` — implement; append-only writes, `ORDER BY resolved_at DESC LIMIT 1` for current
- [ ] **B4.** `test/labelRepository.test.ts` — migration applies to a U1-shaped database; version chains append; `UNIQUE(isrc, resolved_at)` blocks duplicates; current-version query

### C. MusicBrainz I/O

- [ ] **C1.** `src/musicbrainz/RequestQueue.ts` — single queue, 1 req/sec, HIGH/LOW, pause-on-`503` (P-1, P-4)
- [ ] **C2.** `test/requestQueue.test.ts` — ordering, spacing, priority never bypasses rate, pause behaviour
- [ ] **C3.** `src/musicbrainz/MusicBrainzClient.ts` — **two-call chain**, URL join, search fallback, typed errors, `User-Agent`
- [ ] **C4.** `test/musicBrainzClient.test.ts` — ⚠️ **BR-1.2 regression**: a fixture recording with *many* releases, so a "no releases" assertion cannot pass against the `inc=`-ignored bug

### D. Orchestration

- [ ] **D1.** `src/musicbrainz/LabelCache.ts` — versioned read/write over B2, TTL decisions
- [ ] **D2.** `src/musicbrainz/LabelEnrichmentService.ts` — live path; `pending` → resolved; never blocks the display (BR-7.5)
- [ ] **D3.** `src/musicbrainz/LabelBackfillJob.ts` — startup + scheduled sweep, bounded batches, LOW priority
- [ ] **D4.** `src/musicbrainz/resolutionTrace.ts` ⚙️ — **pure**; stored rows → ordered derivation with rule IDs (BR-12)
- [ ] **D5.** `test/resolutionTrace.test.ts` — suppression is visible (`suppressedBy`), version divergence flagged
- [ ] **D6.** `test/labelBackfill.test.ts` — idempotent; never rewrites a written snapshot (BR-8.4a)

### E. Liked-status capture

- [ ] **E1.** `src/spotify/LikedSetCache.ts` — saved-track set, grace window, `null` never `false` (BR-9)
- [ ] **E2.** `test/likedSetCache.test.ts` — `added_at` attribution, grace flush, unavailable ⇒ `unknown`

### F. Wiring (modify existing)

- [ ] **F1.** `src/config.ts` — U2 settings; `secrets/musicbrainz.json` read, **fails closed**
- [ ] **F2.** `src/server.ts` — `GET /api/explain/{playId}`, U2 lifecycle, shutdown flush
- [ ] **F3.** `src/diagnostics.ts` — `coverage` block with `asOf`, by-reason and by-year (BR-10)
- [ ] **F4.** `src/export/serialisers.ts` — label columns, both readings, `unknown` as the literal token (BR-13.7, FR-51)
- [ ] **F5.** `public/index.html` + `public/app.js` + `styles.css` — label fields; trace and coverage sections in the diagnostics dialog

### G. Deployment and docs

- [ ] **G1.** `compose.yaml` — U2 env vars, read-only `musicbrainz.json` mount
- [ ] **G2.** `secrets/musicbrainz.example.json` — committed template (mirrors the Spotify one)
- [ ] **G3.** `README.md` — MusicBrainz setup, contact address, what leaves the machine
- [ ] **G4.** Code summary → `aidlc-docs/construction/u2-label-enrichment/code/code-summary.md`

---

## Quality gates

Applied at the end of every batch, not only at the end:

- [ ] `npm run typecheck` clean across `src` **and** `test`
- [ ] `npm test` green — 193 existing tests must not regress
- [ ] `test/purity.test.ts` covers all four new pure modules
- [ ] No new inbound port or listener
- [ ] `pending` never renders or exports as `unknown` (BR-7.7)
- [ ] `null` means unknown end to end — never `false`, never `0`

---

## Sequencing rationale

**A before everything.** The pure core is where the unit's correctness lives and it needs no
infrastructure to test — the classifier can be fully validated against the measured probe cases
before a single HTTP call exists. It is also the part R3 guarantees will be re-tuned, so it is
worth having under property tests early.

**B before C.** Migration 002 has to land against the real U1-shaped database before anything
writes resolutions, and it is the only irreversible step in the unit.

**F last.** Wiring is where a mistake is least dangerous and most visible.
