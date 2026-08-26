# Code Generation Plan — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Code Generation, Unit U1
**Workspace root**: `d:/Software/Spotify` · **Project type**: Brownfield (working code exists)

**This plan is the single source of truth for U1 code generation.**

---

## Unit context

| | |
|---|---|
| **Stories** | US-10, US-11, US-12, US-25, recording half of US-13 |
| **Requirements** | FR-17–23, FR-49–54, FR-56, NFR-08–13, NFR-22, NFR-26 |
| **Depends on** | U0 only (`nowPlayingService` tick stream, `server`, `config`) |
| **Owns entities** | `play`, `observation`, `schema_version` |
| **Provides to later units** | `HistoryRepository` (U2, U4, U5), history counts (U3) |

**Brownfield rule**: existing files are modified in place. No `_new` or `_modified` duplicates.

### Structure (flat feature dirs, Application Design Q3 = C)

```
src/history/    src/export/       ← new
test/           ← mirrors src/
```

---

## Steps

### Business logic (pure) — the correctness-critical core
- [x] **1.** `src/history/types.ts` — shared types, outcome enum, evidence shape
- [x] **2.** `src/history/outcomeClassifier.ts` ⚙️ — `summarise`, `classify`, `reclassify`
- [x] **3.** `test/historyGenerators.ts` — trail/observation domain generators (PBT-07)
- [x] **4.** `test/outcomeClassifier.test.ts` — example tests, BR-2 and edge cases
- [x] **5.** `test/outcomeClassifier.property.test.ts` — properties P-1…P-11
- [x] **6.** Business logic summary → `aidlc-docs/construction/u1-listening-history/code/`

### Repository layer
- [x] **7.** `src/history/HistoryRepository.ts` — interface + filter types (NFR-10)
- [x] **8.** `src/history/migrations.ts` — forward-only runner + migration 001 (NFR-12)
- [x] **9.** `src/history/SqliteHistoryRepository.ts` — `node:sqlite`, WAL, one txn per play
- [x] **10.** `test/historyRepository.test.ts` — round-trip, migration, streaming

### Observation capture
- [x] **11.** `src/history/PlayObserver.ts` — segmentation, buffering, flush (BR-1, BR-3)
- [x] **12.** `test/playObserver.test.ts` — boundaries, replay, shutdown flush
- [x] **13.** `src/history/RecentlyPlayedBackfill.ts` — FR-22, BR-5

### Export
- [x] **14.** `src/export/serialisers.ts` ⚙️ — CSV/JSON, `unknown` rendering (BR-6.3)
- [x] **15.** `test/serialisers.test.ts` + properties — P-10
- [x] **16.** `src/export/ExportService.ts` — streaming, coverage counts
- [x] **17.** `src/export/SnapshotScheduler.ts` — FR-56 automatic dated snapshots

### Wiring (modify existing)
- [x] **18.** `src/config.ts` — db path, snapshot settings, classifier tolerances
- [x] **19.** `src/server.ts` — export routes, history lifecycle, shutdown flush
- [x] **20.** `src/diagnostics.ts` — database / history / snapshot steps
- [x] **21.** `public/index.html` + `public/app.js` — download control (`data-testid`)

### Guards and deployment
- [x] **22.** `test/purity.test.ts` — LC-6 import check (the defect no other test catches)
- [x] **23.** `compose.yaml` — `./data` mount, pinned `MCP_SERVER_REF`, snapshot env
- [x] **24.** `.gitignore` — `data/`
- [x] **25.** `README.md` — history, export, backup, data location
- [x] **26.** Code summary doc → `aidlc-docs/construction/u1-listening-history/code/`

---

## Story traceability

| Story | Steps |
|---|---|
| US-10 Every play recorded | 1, 2, 7–12, 18, 19 |
| US-11 Skips vs completions | 2, 4, 5, 11, 12 |
| US-12 Backfill gaps | 13 |
| US-13 (recording half) | 1, 7, 9, 11 |
| US-25 Export | 14–17, 19, 21 |
| FR-56 Snapshots | 17, 23 |
| FR-20 Reclassifiable | 2, 5, 7, 9 |

---

## Constraints carried in

- **Threshold 0.90**, ratio = listened time / duration, **never clamped above 1.0**
- Outcomes are exactly `completed | skipped | unknown`
- `outcomeClassifier` and `serialisers` import **nothing impure** — enforced by step 22
- `skipSource='user'` recorded from the first play (US-13 split)
- **ISRC recorded on every play** — makes U2's backfill possible
- Buffer in memory, **one transaction per play**
- No failure in U1 may break the now-playing display
