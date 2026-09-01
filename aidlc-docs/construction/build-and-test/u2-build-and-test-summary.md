# Build and Test Summary — U2: Label Enrichment

**Date**: 2026-09-01 · **Stage**: CONSTRUCTION — Build and Test, Unit U2
**Companion**: [`build-and-test-summary.md`](build-and-test-summary.md) (U1)

---

## Status

| | |
|---|---|
| **Typecheck** | ✅ clean, `src` and `test` |
| **Compile** | ✅ clean → `dist/` |
| **Tests** | ✅ **399 passing**, 0 failing (193 before U2) |
| **Coverage** | **98.97% line · 92.14% branch · 96.88% function** |
| **Live MusicBrainz** | ✅ **verified against the real service** |
| **Container egress** | ✅ **verified** |
| **Overall** | ✅ **PASS — with three defects found and fixed** |

Coverage of the U2 modules specifically:

| Module | Line | Branch |
|---|---|---|
| `isrcPrefix.ts` | 100.00 | 100.00 |
| `labelClassifier.ts` | 100.00 | 98.36 |
| `releaseNarrowing.ts` | 100.00 | 100.00 |
| `LabelCache.ts` | 100.00 | 100.00 |
| `resolutionTrace.ts` | 99.62 | 90.00 |
| `RequestQueue.ts` | 99.49 | 86.84 |
| `LikedSetCache.ts` | 99.20 | 85.71 |
| `MusicBrainzClient.ts` | 97.95 | 72.06 |
| `LabelBackfillJob.ts` | 96.57 | 76.19 |
| `LabelEnrichmentService.ts` | 93.79 | 78.43 |

---

## 🔴 Three defects found — all three by **running the system**, not by testing it

Every one of these passed the full suite. They are the class of defect this project's standing
rule is about, and none of them were reachable from fixtures.

### 1. A transient network error permanently poisoned a play

**Severity: high.** Running the server against an unreachable endpoint wrote **21 plays as
`unknown / error`** in a single sweep.

The play snapshot is immutable (BR-8.4a) and the backfill work set is *"plays with no verdict"* —
so **every one of those rows would have stayed unresolvable forever**, from one network blip, in
the dependent variable of the experiment.

**Fixed**: `toSnapshot()` now returns `null` for a transient failure, so it *cannot* be written.
Changing the return type forced every caller to handle it rather than relying on anyone
remembering the rule. Separately, an `error` resolution is retried on the **next sweep** instead
of waiting out the 30-day `unknown` TTL.

### 2. `LabelCache.isFresh` treated an error as a valid 30-day cache entry

**Severity: high, and it hid inside the fix for #1.** The SQL sweep was corrected to treat `error`
as always-stale — but the **live path never consults the sweep**. It calls `isFresh`, which still
gave an errored resolution the full 30-day `unknown` TTL.

Surfaced by finding 17 artist resolutions written during the deliberate unreachable-endpoint run:
every one would have suppressed retries for a month.

**Fixed**: `isFresh` returns `false` for `error`, unconditionally. Three statuses, three lifetimes.

### 3. The backfill work set could never finish a partially-resolved play

**Severity: medium.** `listPlaysNeedingLabels` keyed only on `label_verdict IS NULL`. The two
levels resolve **independently** — release through the ISRC chain, artist through the Spotify-URL
join — and can fail independently.

Observed live: **21 real plays sat with a release verdict, no artist verdict, and the work set
reported zero rows remaining.** They were permanently unfinished and invisible.

**Fixed**: either level missing puts the play back in the set. `applyLabelSnapshot` already
refuses to overwrite the written level, so re-visiting is safe. On the next run the 21 plays were
picked up automatically.

> ### What these three have in common
>
> All are about a **transient failure becoming permanent**. The design was careful that `unknown`
> and `pending` stay distinct; it was *not* careful that `error` stays distinct from both. The
> fixtures could not catch it because a fixture failure is deterministic — you have to watch a real
> failure be *recorded* to see that it never gets retried.

---

## Live MusicBrainz verification

Run with the shipped code against the real service, using the 19 distinct ISRCs actually in
`history.db`.

### BR-1.2 — the two-call chain ✅

| | |
|---|---|
| Widest release set returned | **50 releases** (Slipknot — *Duality*) |
| Audioslave — *Like a Stone* | **44 releases** |

**PASS.** A recording known to have many releases returned them. The single-call form would have
returned zero with a 200, and a test asserting "no releases" would have passed against the bug.

### Coverage — the shipped code reproduces the research measurement

| Measure | Research probe (2026-08-26, ad-hoc scripts) | Shipped code (2026-09-01) |
|---|---|---|
| ISRC → recording | 13/19 — **68.4%** | 13/19 — **68.4%** |
| Errors | 0 | **0** |

Coverage by release year still shows the recency bias R2 is about: 2022 **0/1**, 2024 **0/1**,
2026 **2/5 (40%)**, against 100% for every year before 2022 in the corpus.

### The classifier on real data ✅

Every measured case from research Part 5 reproduced through the shipped classifier:

| Track | Result | Rule demonstrated |
|---|---|---|
| **Audioslave — Like a Stone** | 44 rel · `major` `low` **CONTESTED** — Epic + Interscope | BR-6.5, two majors on one release |
| **Slipknot — Duality** | 50 rel · `major` `low` **CONTESTED** | tier `all` caps confidence |
| **Faouzia** | `unknown` — 1 refused | BR-3.1, `Publisher` ineligible |
| **Imminence** | `unknown` — `[no label]` refused | BR-3.2 |
| **NF** | `major` `high` — NF Real Music + Capitol + Caroline, **not contested** | one arrangement, all Universal |
| **bbno$ / Marino** | `independent` `medium` — `broke` | BR-3.3, `Distributor` votes weak |
| **Dead Poet Society** | `major` `low` — Spinefarm | the Universal imprint whose *distribution* points at an indie |
| **Token — Full Bag** | `independent` at release level | disagrees with artist level, correctly |

### Rate limiting (NFR-15) ✅ — and a finding

| Attempt | Spacing | Result |
|---|---|---|
| First | 1200 ms | **6 of 19 tracks took a `503`** |
| After adding bounded retry | 1200 ms | **0 errors, 0 throttles** |

Measured throughput **0.46 req/sec** — comfortably inside policy.

> ⚠️ **The bounded retry P-4 specified had not been implemented.** Only the queue-wide pause was.
> A live run made the gap obvious: a third of the corpus failed on one pass for reasons that said
> nothing about MusicBrainz's catalogue, which would have swamped the coverage signal R2 is
> measured with. Each retry goes back through the queue, so retrying spends **time, never rate**.

### End-to-end through the running app ✅

| | |
|---|---|
| Release verdicts written | 6 independent · 6 major · 9 unknown |
| Artist verdicts written | 9 independent · 9 major · 1 unknown |
| Resolutions | 13 resolved · 6 not-found · **0 error** |
| Artist resolutions | 15 resolved · **0 error** |
| Stored evidence | 83 candidates · 88 release votes · 515 artist votes |
| Contested plays | 3 |
| **Release ≠ artist verdict** | **8 plays** |
| `unknown` reasons | 7 `notFound` · 2 `noEligibleCandidate` |
| Errors logged during the run | **0** |

**The 8 disagreements are the two-level design earning its keep.** They are the Token case at
scale: an artist signed to a major releasing a particular track independently. Merging the levels
would have silently picked one.

**Artist confidence never exceeded `medium`** across all 19 — the cap holds in production.

### The resolution trace on real plays ✅

```
Audioslave — Like a Stone
  release: considered Epic, Interscope Records, … · major by BR-4.3 · capped by BR-6.5
           tier title-date · 44 releases · contested · confidence low

Imminence — God Fearing Man
  release: refused 1: [no label] (BR-3.2) · unknown by BR-4.6
           [no label] (Production) -> REFUSED by BR-3.2
```

The second is precisely why BR-12.3 exists. Without it, that `unknown` is indistinguishable from
"MusicBrainz knew nothing" — and this is the very artist whose `[no label]` handling was wrong in
the first round of design.

---

## Container egress (Infrastructure Design Q3) ✅

```
docker run --rm --network bridge curlimages/curl \
  -A "SpotifyNowPlaying/0.1.0 ( … )" \
  "https://musicbrainz.org/ws/2/isrc/USSM10211587?fmt=json"
→ HTTP 200 in 0.373s
```

Outbound to `musicbrainz.org` works from inside a container on the default bridge, with no
`networks:` configuration. **Verified rather than assumed**, which was the point of deferring it
here — the container has produced one silent networking failure in this project already.

---

## Security

| Check | Result |
|---|---|
| New inbound ports | **None.** `/api/explain` and `/api/history/recent` sit on the existing loopback listener behind `localGuard` |
| Contact address in git | **No.** `secrets/musicbrainz.json` is gitignored; only the example template is tracked |
| Fails closed without a contact | ✅ Startup logs an actionable error and runs **display-and-record-only** rather than sending anonymous traffic |
| Read-only mount | `musicbrainz.json` mounted `:ro` in `compose.yaml` — nothing writes it |
| NFR-01–07 | **Unchanged.** U2 adds outbound requests only |

---

## Data safety

The database was backed up before every destructive step.

| Event | Outcome |
|---|---|
| Migration 002 rehearsed on a **copy** first | 71 plays, 1,296 observations preserved |
| Migration 002 applied to the real database | ✅ schema v2; U1's `recently-played` backfill also ran, taking the corpus **71 → 120 plays** |
| Cleanup of test-induced `error` rows | 21 play snapshots cleared, 19 + 17 resolutions deleted. **120 plays and 1,296 observations verified intact** |
| FK integrity | A bare delete of artist resolutions was **refused by the foreign key** because plays pointed at them — the constraint doing its job |

---

## Outstanding

- **Liked-status capture is still unobserved live.** The saved-track set loads (600 tracks), but
  no play has closed during a session with labels enabled, so the grace window has never fired
  against real listening and no `liked_transition` has been written. **Owed.**
- **2 plays remain in the work set** at the time of writing — the sweep is bounded per run and
  finishes on the next one, by design.
- **`localGuard` still blocks the container UI** (open item 1). Egress is verified; serving is
  not. This remains the gap between here and the Rancher Desktop packaging goal.
- **Search fallback never fired** in the live run — no ISRC hit the `count == 1` exact-match
  condition, so that path is fixture-tested only.
