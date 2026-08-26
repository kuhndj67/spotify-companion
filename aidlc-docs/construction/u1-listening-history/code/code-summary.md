# Code Summary — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Code Generation, Unit U1
**Verification**: typecheck clean · build clean · **184 tests, 184 passing** · live smoke test run

---

## Files created

| Path | Kind | Purpose |
|---|---|---|
| `src/history/types.ts` | ⚙️ pure | Domain types, three-value outcome, evidence shape |
| `src/history/outcomeClassifier.ts` | ⚙️ **pure** | `summarise`, `classify`, `reclassify` |
| `src/history/HistoryRepository.ts` | interface | Persistence boundary (NFR-10) |
| `src/history/migrations.ts` | 🔌 | Forward-only runner + migration 001 |
| `src/history/SqliteHistoryRepository.ts` | 🔌 | The only file that knows SQLite exists |
| `src/history/PlayObserver.ts` | 🔌 | Segmentation, buffering, degraded operation |
| `src/history/RecentlyPlayedBackfill.ts` | 🔌 | Gap filling (FR-22) |
| `src/export/serialisers.ts` | ⚙️ **pure** | CSV/JSON, `unknown` rendering |
| `src/export/ExportService.ts` | 🔌 | Streaming export, filter validation |
| `src/export/SnapshotScheduler.ts` | 🔌 | Automatic dated backups (FR-56) |

## Files modified

| Path | Change |
|---|---|
| `src/config.ts` | Database path, threshold, snapshot settings |
| `src/server.ts` | History lifecycle, export routes, shutdown flush, backfill |
| `src/diagnostics.ts` | Database / Listening history / Snapshots steps |
| `src/spotify/enrichment.ts` | **Surfaces `external_ids.isrc`** — the U2 join key |
| `public/index.html`, `public/app.js` | Export control (`data-testid` attributes) |
| `compose.yaml` | `./data` mount, pinned `MCP_SERVER_REF`, snapshot env |
| `.gitignore` | `data/`, with the exposure caveat recorded |
| `README.md` | History, outcomes, export, backup risk |

## Tests

| Path | Covers |
|---|---|
| `test/historyGenerators.ts` | Trail generators — plausible poll traces, not random numbers |
| `test/outcomeClassifier.test.ts` | BR-1/BR-2 behaviours and edge cases |
| `test/outcomeClassifier.property.test.ts` | Properties P-1 … P-11 |
| `test/historyRepository.test.ts` | Round-trip, migration, streaming, coverage |
| `test/playObserver.test.ts` | Boundaries, attribution, degraded operation |
| `test/serialisers.test.ts` | `unknown` rendering, CSV escaping, P-10 |
| `test/purity.test.ts` | **The import check** — the defect no other test catches |

**Suite: 100 → 184 tests, all passing.**

---

## Live verification

Ran the real server against the real account:

```
History: data/history.db (schema v1)
  migrated 1: listening history: play, observation, gap counter
[backfill] 50 inserted, 0 already known
```

| Check | Result |
|---|---|
| Migration on a fresh database | ✅ schema v1 |
| WAL siblings created beside the database | ✅ `-wal`, `-shm` present |
| Backfill from a real account | ✅ 50 plays, all `outcome: unknown` (BR-5.3 honoured) |
| CSV export with coverage header | ✅ |
| JSON export | ✅ |
| Invalid filter | ✅ `400` with a usable message, before any output |
| **Host-header guard still rejects `evil.com`** | ✅ `403` — NFR-01–07 intact |
| Diagnostics reports the three new steps | ✅ all `ok` |

**Not verified**: recording during actual playback (nothing was playing), and the `./data` bind
mount under Rancher Desktop. Both are on the Build and Test checklist.

---

## Findings

### 1. The short-track limitation is intermittent, not systematic — documentation corrected

The design documents stated that tracks under ~30 s played in full would be *consistently*
recorded as `skipped`. **Writing the tests showed that is wrong.**

The final poll of a play lands somewhere in the last poll interval, so the observed ratio for a
fully-played track is `(duration − x) / duration` with `x ∈ (0, pollInterval]`. A track clears the
threshold *reliably* only when `duration >= pollInterval / (1 − threshold)` = 30 s. Below that it
**depends on where the poll happens to fall**: a 20 s track observes a ratio anywhere in
0.85–1.00.

So the same short track, played identically, can be recorded differently on different occasions.
That is better than a uniform bias in one way and worse in another — an inconsistency is harder to
notice and harder to correct for.

Corrected in `business-rules.md`, `aidlc-state.md`, `stories.md` and the functional design plan.
Both outcomes are now pinned by tests, including one asserting the same duration resolving each
way.

### 2. Backfilled plays cannot carry an ISRC — this constrains U2

`GET /me/player/recently-played` returns **no `external_ids` field at all**. Verified against the
live API: the track object carries `album, artists, disc_number, duration_ms, explicit,
external_urls, href, id, is_local, name, preview_url, track_number, type, uri` — and nothing else.

**Consequence**: the 50 backfilled rows have `isrc = null`, so U2's label backfill will silently
skip them. Not a U1 defect — the field is simply unavailable — but U2 must decide whether to
resolve ISRCs for backfilled rows with an extra `GET /tracks/{id}` per track, or accept that
backfilled history carries no label.

Recorded here so U2 makes that choice deliberately rather than discovering a silent gap.

### 3. `completeTrail` initially modelled an impossible trace

The first version of the test helper emitted a final observation exactly at the track's duration.
That never happens: polls do not coincide with track endings, and the next poll already shows the
following track.

It made three tests pass that should have failed, and hid finding 1. Replaced with a helper that
takes the final gap as a parameter, plus `worstCaseTrail` and `replayTrail`. Worth noting because
a generator that models an impossible state produces *confidently green* tests about behaviour
that cannot occur.

### 4. Ratios above 1.0 require a replay, not just long listening

Progress can never exceed duration, so the unclamped ratio only goes above 1.0 when progress
*resets* and advances again. The first property test asserted otherwise and failed correctly.
`replayTrail` now models it properly.

---

## Deviations from design

| Deviation | Reason |
|---|---|
| `T \| null` instead of a `Maybe<T>` wrapper | Same semantics — null means unknown, never false or zero — matching the existing `Enrichment` shape and the nullable columns. The wrapper's only extra was a per-field reason, which `warnings` already provides. The rule is enforced where it matters: `renderMaybe` in the serialisers, property-tested by P-10 |
| `nowPlayingService` already emitted `tick` | The design specified adding it; it existed from the WebSocket work. No change was needed, only a consumer |
| `listPlays` returns `IterableIterator`, not `AsyncIterable` | `node:sqlite` is synchronous, so an async iterator would add ceremony without adding concurrency. Streaming and constant memory — the actual requirement — are unaffected |

---

## Requirements delivered

| Requirement | Where |
|---|---|
| FR-17, 21 Record every play, survive restart | `PlayObserver`, `SqliteHistoryRepository` |
| FR-18, 19, 20 Outcome + evidence + recomputable | `outcomeClassifier`, `updateOutcome` |
| FR-22 Backfill | `RecentlyPlayedBackfill` |
| FR-23 (U1 half) Skip attribution | `PlayObserver` — `skipSource: 'user'` from play one |
| FR-49–54 Export | `serialisers`, `ExportService`, `/api/history/export` |
| FR-56 Automatic snapshots | `SnapshotScheduler` |
| NFR-08–13 Persistence | WAL, one txn per play, migrations, degraded mode |
| NFR-22, 25, 26 Property tests, determinism | 11 properties + `purity.test.ts` |
| **R7 closed** | `MCP_SERVER_REF` pinned to `7b5fde63` |
