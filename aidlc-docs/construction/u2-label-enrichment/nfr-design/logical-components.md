# Logical Components — U2: Label Enrichment

**Date**: 2026-08-31 · **Stage**: CONSTRUCTION — NFR Design, Unit U2
**Patterns**: [`nfr-design-patterns.md`](nfr-design-patterns.md) · **Rules**:
[`../functional-design/business-rules.md`](../functional-design/business-rules.md)

---

## Component map

```
                    ┌──────────────────────────────────────────────┐
   now playing ───▶ │ LabelEnrichmentService                       │
   (tick)           │  orchestrates; owns nothing; blocks nothing  │
                    └───┬───────────────────────┬──────────────────┘
                        │ HIGH                  │ reads/writes
                        ▼                       ▼
           ┌────────────────────────┐   ┌──────────────────────┐
           │ MusicBrainzQueue       │   │ LabelCache           │
           │  1 req/sec · 2 classes │   │  release + artist    │
           │  pause-on-503    (P-1) │   │  asymmetric TTL (P-3)│
           └───────────┬────────────┘   └──────────┬───────────┘
                       │                           │
                       ▼                           ▼
           ┌────────────────────────┐   ┌──────────────────────┐
           │ MusicBrainzClient      │   │ HistoryRepository    │
           │  two-call chain        │   │  (U1 interface)      │
           │  URL join · typed errs │   │  extended, not forked│
           └────────────────────────┘   └──────────┬───────────┘
                       ▲ LOW                       │
           ┌───────────┴────────────┐              │
           │ LabelBackfillJob       │◀─────────────┘
           │  startup + scheduled   │   "what still needs doing"
           │  DB is the queue (P-5) │
           └────────────────────────┘

           ┌────────────────────────┐   ┌──────────────────────┐
           │ LikedSetCache          │   │ ResolutionTraceSvc   │
           │  596 tracks · 12 reqs  │   │  local read only     │
           │  grace window    (P-8) │   │  zero upstream  (P-7)│
           └────────────────────────┘   └──────────────────────┘
                       │                           │
                  Spotify API                /api/explain/{playId}
```

**Pure modules carry no arrows.** `labelClassifier`, `isrcPrefix`, `releaseNarrowing` and
`resolutionTrace` take data in and return data out. That they appear nowhere in this diagram is the
point — BR-4.8, and `test/purity.test.ts` is the only thing that enforces it.

---

## MusicBrainzQueue

**Implements**: P-1, P-4 · **Addresses**: NFR-15, NFR-18

The single choke point for every MusicBrainz request in the process.

| Property | Value |
|---|---|
| Emission rate | ≤ 1 request/second, globally |
| Priority classes | `HIGH` (now playing) · `LOW` (backfill, artist joins) |
| Ordering | Priority selects order **only** — never rate |
| On repeated `503` | **Pauses entirely**, resumes after a backoff interval |
| Persistence | **None** — see `LabelBackfillJob` |
| Items while paused | Remain `pending`; a pause is a delay, never an answer |

**Single instance is a correctness property, not a convention.** Two independently-correct limiters
still emit two requests per second. This is the only component in U2 where a second instance is a
policy violation rather than a performance detail.

**Interface shape**: `enqueue(request, priority) → Promise<Result>`. Callers never see the queue's
internals and cannot bypass it — there is no direct path from any component to `MusicBrainzClient`
except through here.

---

## MusicBrainzClient

**Implements**: P-4, P-6 · **Addresses**: NFR-14, NFR-18, BR-1.2

Knows the shape of MusicBrainz's API and nothing about scheduling. Three operations:

| Operation | Calls | Rule |
|---|---|---|
| `resolveRelease(isrc)` | **two** — `/isrc/{isrc}` then `/release?recording=…&inc=labels` | BR-1.2 |
| `resolveArtist(spotifyArtistId)` | one — `/url?resource=…&inc=artist-rels` | Q12 |
| `searchRecording(artist, title)` | one — only on `count == 1` exact match | BR-2.x, Q3 = B |

> ⚠️ **The two-call chain must stay two calls.** `GET /isrc/{isrc}?inc=releases` returns **200 with
> the `inc` silently ignored** — no error, no warning, just plausible-looking data with no releases.
> Folding the chain into one call reintroduces a response indistinguishable from absent data.
> BR-1.2 requires a test against a recording known to have many releases; a test asserting "no
> releases" would pass against the bug.

**Emits typed failures**, never raw exceptions: `NotFound` (404) · `Throttled` (503) ·
`Timeout` · `Malformed`. The distinction between `NotFound` and the rest is what keeps `notFound`
separable from `error` in the coverage metric (P-4).

**Sets the `User-Agent`** from configuration (P-6). A missing contact address fails at startup rather
than defaulting to anonymous traffic.

---

## LabelCache

**Implements**: P-3 · **Addresses**: FR-14, NFR-15, R2

Two independent caches over the tables migration 002 adds, never merged (Q12):

| Level | Key | Tables |
|---|---|---|
| Release | `isrc` | `label_resolution`, `label_candidate` |
| Artist | `spotify_artist_id` | `artist_label_resolution`, `artist_label` |

**Asymmetric lifetime**, and it is a measurement decision (Q1 = A):

```
status = resolved   ─▶ never re-fetched     a label is a stable fact
status = unknown    ─▶ re-fetched after 30d MusicBrainz's completeness changes; the release does not
status = error      ─▶ eligible on the next sweep (P-4)
```

**Not a performance cache.** It is a durable store that BR-8.7 depends on: reclassification recomputes
verdicts from `label_candidate` and `label_signal_vote` with zero upstream requests, and BR-12's
trace re-runs the classifier over the same rows. Eviction would break both. Nothing here may be
treated as discardable.

---

## LabelBackfillJob

**Implements**: P-5 · **Addresses**: BR-8.1–8.7, FR-14

Runs at startup and on a schedule. Derives its work from the database rather than from a stored
queue:

```
1. plays with track_id but no ISRC      ─▶ GET /tracks/{id}   (Spotify, 47 one-off, NFR-17 applies)
2. plays with ISRC but no resolution    ─▶ MusicBrainzQueue @ LOW
3. resolutions unknown and older than TTL ─▶ MusicBrainzQueue @ LOW      (P-3)
4. artists with no artist-level resolution ─▶ MusicBrainzQueue @ LOW
```

| Property | Value |
|---|---|
| Priority | `LOW` always — never competes with the live track |
| Idempotent | Yes (BR-8.6); re-running finds less to do, never duplicates |
| Touches U1 fields | **Never** (BR-8.4) — outcome, evidence, provenance and trail are read-only here |
| Batching | Bounded per sweep, so a long backlog does not monopolise the queue for hours |

**Step 1 uses Spotify, not MusicBrainz**, so it is governed by NFR-17's existing 429/401 handling
rather than P-1's queue. Reusing U1's client rather than adding a second Spotify path.

---

## LikedSetCache

**Implements**: P-8 · **Addresses**: BR-9.1–9.8

| Property | Value |
|---|---|
| Contents | The saved-track set — 596 tracks, **12 requests** at `limit=50` |
| Refresh | Startup, then on a schedule |
| Unavailable | `likedAtStart` / `likedAtEnd` = **`null`**, transition `unknown` — **never `false`** |
| Grace window | 30 s deferred re-check of page 1; **flushed on graceful shutdown** |
| Grace attribution | Only if `added_at` ≥ play start (BR-9.4) |

**Same workaround shape as `FollowedArtistsCache`.** `GET /me/tracks/contains` is 403 in Development
Mode while `GET /me/tracks` returns 200 — the third confirmed instance of that pattern. The cache
exists because the membership-check endpoint is blocked, not for performance.

⚠️ **The grace window is the only deferred *write* in the system.** It amends a play row that has
already been closed. It must amend exactly once (BR-9.2) and must never rewrite anything other than
the liked fields.

---

## ResolutionTraceService

**Implements**: P-7 · **Addresses**: BR-12.1–12.8

Serves `GET /api/explain/{playId}`. Loads the play, its resolutions, candidates and votes; re-runs
the **pure** classifier collecting the rule IDs that fire; emits the derivation.

| Property | Value |
|---|---|
| Upstream requests | **Zero** (BR-12.7) — local reads only |
| Scope | **Any** play in history (BR-12.4), not just now playing |
| Output shape | A derivation. No `ok`/`fail` status anywhere (BR-12.6) |
| Version handling | Reports stored **and** running `label_classifier_version`, flags divergence (BR-12.5) |
| No resolution | Emits the `unknown` **reason**, not an empty trace (BR-12.8) |

**Behind `localGuard`** like every other route. It adds no inbound exposure — it is a read of data
the machine already holds.

---

## Component-to-NFR matrix

| Component | NFR-14 | NFR-15 | NFR-16 | NFR-18 | New state? |
|---|---|---|---|---|---|
| `MusicBrainzQueue` | — | ✅ primary | ✅ async boundary | ✅ pause | In-memory only |
| `MusicBrainzClient` | ✅ primary | via queue | — | ✅ typed errors | None |
| `LabelCache` | — | ✅ avoids repeats | — | — | **Durable** (5 tables) |
| `LabelBackfillJob` | — | ✅ `LOW` only | ✅ never blocks | ✅ retry sweep | None — derives from DB |
| `LikedSetCache` | — | n/a (Spotify) | ✅ async | ✅ `null` on failure | In-memory + play columns |
| `ResolutionTraceSvc` | — | ✅ zero requests | ✅ not on path | — | None |

---

## Failure modes

| Failure | Behaviour | Rule |
|---|---|---|
| MusicBrainz `404` | `notFound`, no retry, cached 30 days | P-4, P-3 |
| MusicBrainz `503` | Bounded retry, then **queue pause**; items stay `pending` | P-4 |
| Timeout | Bounded retry, then `error`, eligible for the next sweep | P-4 |
| `200` with unexpected shape | `Malformed` → `error`. **Never** parsed optimistically | BR-1.2 |
| Process restart mid-queue | Work re-derived from the database at startup | P-5 |
| Saved-track set unavailable | `null`, transition `unknown`, never `false` | BR-9.5 |
| Shutdown during grace window | Flushed if graceful; one upgrade lost if killed | P-8 |
| Everything MusicBrainz down | Display, recording and export **all unaffected**; labels stay `pending` then `error` | NFR-16, NFR-18 |

**The last row is the design's load-bearing claim**: U2 is additive to a working system. Its total
failure costs the label column and nothing else.

---

## Deferred to Infrastructure Design

- Whether the backfill schedule is a timer in-process or an external trigger
- Container concerns for the outbound host (`musicbrainz.org`) — the existing Compose setup has no
  egress restrictions, so likely nothing to do, but it should be confirmed rather than assumed
- Where the `User-Agent` contact address is configured alongside `secrets/spotify-config.json` (P-6)
