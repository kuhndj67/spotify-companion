# Code Summary — U2: Label Enrichment

**Date**: 2026-09-01 · **Stage**: CONSTRUCTION — Code Generation, Unit U2
**Plan**: [`../../plans/u2-code-generation-plan.md`](../../plans/u2-code-generation-plan.md)

**390 tests passing** (193 before U2) · typecheck clean across `src` and `test` · build clean.

---

## What was built

### Pure core — `src/musicbrainz/`

| Module | Role |
|---|---|
| `types.ts` ⚙️ | Domain types. `null` means unknown; `pending` is not `unknown` |
| `majorRootList.ts` ⚙️ | Curated major roots, name normalisation, `[no label]` sentinel |
| `isrcPrefix.ts` ⚙️ | ISRC registrant → vote. The only signal with 100% coverage |
| `releaseNarrowing.ts` ⚙️ | Cascade `title+date → title → all`, returns the tier |
| `labelClassifier.ts` ⚙️ | The asymmetric fold. **The module the hypothesis rests on** |
| `resolutionTrace.ts` ⚙️ | Stored rows → ordered derivation with rule IDs (BR-12) |

All six are in `test/purity.test.ts`. A `Date.now()` in the classifier would break FR-42 while
every other test passed.

### I/O and orchestration

| Module | Role |
|---|---|
| `RequestQueue.ts` | One queue, 1 req/sec, HIGH/LOW, pause-on-`503` |
| `MusicBrainzClient.ts` | The two-call chain, URL join, typed failures |
| `LabelCache.ts` | Versioned reads/writes, TTL policy |
| `LabelEnrichmentService.ts` | Live path; resolution → snapshot |
| `LabelBackfillJob.ts` | Startup + scheduled sweeps, bounded batches |
| `LabelRepository.ts` | Persistence boundary, append-only |
| `spotify/LikedSetCache.ts` | Saved-track set + grace window |

### Modified

`history/migrations.ts` (migration 002) · `history/SqliteHistoryRepository.ts` ·
`history/PlayObserver.ts` (two optional hooks) · `history/types.ts` · `export/serialisers.ts` ·
`config.ts` · `diagnostics.ts` · `server.ts` · `public/*` · `compose.yaml` · `README.md`

---

## Defects found and fixed during code generation

### 1. Root-list entries could never match (found while writing the list)

`labelRoot()` trims trailing `records` / `recordings` / `entertainment`, so an entry like
`legacy recordings` would be compared against candidates already reduced to `legacy`.

**This fails silently.** Nothing goes red; the label simply never registers as major — which is a
false `independent` waiting to happen, in the direction the standing rule exists to prevent.
Entries are now stored in root form, with a test asserting the invariant.

Two entries were also removed on accuracy grounds: **`J Records`** (root `j` would match
`J Dilla Music`) and **`Nuclear Blast`** (Believe-owned since 2018, so listing it as a major is
simply wrong).

### 2. Prefix matching without a word boundary

`universal` matched `Universalist Sound`. Now requires the root to be the whole name or be
followed by a space.

### 3. ⚠️ A transient network error permanently poisoned a play (found by **running** it)

The most serious of the three, and only a live run surfaced it.

Running the server against an unreachable base URL wrote **21 plays as `unknown / error`** in a
single sweep. Under BR-8.4a the play snapshot is immutable, and the backfill work set is *"plays
with no verdict"* — so **every one of those rows would have stayed unresolvable forever**, from one
network blip.

Two fixes:

- `toSnapshot()` now returns **`null`** for a transient failure, so it *cannot* be written. The
  play stays `pending` and re-enters the work set. The type change forced every caller to handle
  it rather than relying on anyone remembering.
- An `error` resolution is retried on the **next sweep** rather than waiting out the 30-day
  `unknown` TTL. Three statuses now have three lifetimes, because they mean three different
  things: `resolved` (the fact can change), `not-found` (MusicBrainz's completeness can change),
  `error` (the network failed on a Tuesday).

The 21 rows and 19 error resolutions were cleared from the database after a backup; 120 plays and
1,296 observations verified intact.

**This is the third time this project has been caught by a plausible-looking wrong answer**, and
the first found by running the system rather than by probing an API.

---

## Live verification performed

Not a test-suite claim — the built server was actually run.

| Check | Result |
|---|---|
| Migration 002 against a **copy** of the real database | 71 plays, 1,296 observations preserved; all new columns NULL; re-run a no-op |
| Migration 002 against the **real** database | ✅ Applied 2026-09-01. Now at schema v2 |
| Missing contact file | Fails closed with an actionable message; **app still starts** display-and-record-only |
| With a contact file | `Labels: SpotifyNowPlaying/0.1.0 ( … )` |
| `GET /api/history/recent` | 50 plays returned |
| `GET /api/explain/:playId` | Full two-level derivation, `summary: "No resolution — noIsrc"` |
| `GET /api/diagnostics` | 16 steps (3 new) + `coverage` block with `asOf` and by-year |
| Saved-track cache | **600 tracks** loaded live from Spotify |
| Transport failure handling | Recorded as `error`, **not** `notFound` — the distinction works in production |

U1's `recently-played` backfill also ran during this, inserting **49 plays** — the database now
holds **120**.

---

## Deliberate design points worth remembering

**The classifier's asymmetry is arithmetic, not sentiment.** Any strong `major` vote ⇒ `major`;
`independent` requires the *absence* of any major vote at any strength. A majority rule or a
most-frequent-label tiebreak would pass every example test and fail the property tests.

**Priority controls ordering, never rate.** A `HIGH` item still waits its turn in the 1 req/sec
cadence. A priority that bypassed the limiter would defeat NFR-15 exactly when the app is busiest.

**Spacing is measured from the previous request's *start*.** Latency was measured at 0.1–6.7 s;
spacing from completion would let a fast burst follow a slow response.

**Repeated `503`s pause the whole queue**, not per-request backoff — per-request retry increases
pressure exactly when the service signals overload, and there is no API key to absorb a mistake.

**The BR-1.2 regression test uses a recording with 44 releases**, specifically so it *cannot* pass
against the `inc=`-silently-ignored bug. A test asserting "no releases" would have passed happily.

**`null` is never `false`** in the liked path — before the set loads, when the fetch fails, and
when the grace-window check fails. A failed refresh *keeps* the stale set, because these values
cannot be reconstructed afterwards.

---

## Known gaps at the end of Code Generation

- **No live MusicBrainz verification yet.** Every upstream interaction is tested against
  fixtures. The contact address is the user's to create, and nothing has been sent to
  MusicBrainz under a real identity. **This is the Build and Test step.**
- **Container egress unverified** (Infrastructure Design Q3 = A, deliberately deferred).
- **Liked capture unobserved live** — the grace window has never fired against real listening.
- The five verification items in
  [`../infrastructure-design/deployment-architecture.md`](../infrastructure-design/deployment-architecture.md)
  remain owed.
