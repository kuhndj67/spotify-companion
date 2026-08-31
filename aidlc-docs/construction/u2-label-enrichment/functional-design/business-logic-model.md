# Business Logic Model — U2: Label Enrichment

**Date**: 2026-08-26 · **Stage**: CONSTRUCTION — Functional Design, U2

Algorithms and flows, technology-agnostic. Rule references are to
[`business-rules.md`](business-rules.md); entities to
[`domain-entities.md`](domain-entities.md).

---

## Module map

```
src/musicbrainz/
  labelClassifier.ts   ⚙️ PURE   candidates + root list -> verdict, confidence, votes
  isrcPrefix.ts        ⚙️ PURE   ISRC -> registrant vote
  releaseNarrowing.ts  ⚙️ PURE   releases + album/date -> candidate set + tier
  MusicBrainzClient.ts    I/O    the two-call chain, the URL join, label lookups
  RequestQueue.ts         I/O    single serialised ≤1 req/sec queue
  LabelCache.ts           I/O    ISRC and artist resolutions, TTL
  LabelBackfillJob.ts     I/O    historical rows
  LikedSetCache.ts        I/O    saved-track set + grace-window re-check
```

**Three pure modules, and the purity is load-bearing.** `labelClassifier` decides the variable the
whole hypothesis rests on. A `Date.now()` or config read inside it breaks FR-42 **while every test
still passes** (BR-4.8) — `test/purity.test.ts` must be extended to cover all three.

---

## Flow 1 — Live enrichment of a playing track

**Never on the display path** (BR-7.5). The panel renders immediately; label fields arrive later
and are pushed over the existing WebSocket.

```
tick / track change
   │
   ├─ render now-playing immediately            ← no MusicBrainz involvement
   │
   └─ enqueue label enrichment (async)
         │
         ├─ release level ── LabelCache[isrc] ── hit ──► classify ──► push
         │                        │ miss
         │                        └─► RequestQueue ─► resolveRelease() ─► cache ─► classify ─► push
         │
         └─ artist level ─── LabelCache[artistId] ─ hit ──► classify ──► push
                                  │ miss
                                  └─► RequestQueue ─► resolveArtist() ─► cache ─► classify ─► push
```

Label state is `pending` until resolved and **never rendered or exported as `unknown`** (BR-7.7).
Observed MusicBrainz latency spanned **0.1 s to 6.7 s** for identical request classes, so this
separation is a measured requirement, not caution.

---

## Flow 2 — `resolveRelease(isrc)`

```
1.  GET /ws/2/isrc/{isrc}
      404 ─────────────────────► status = not-found        (a FACT about coverage, cached)
      5xx / network ───────────► status = error            (retryable, NEVER cached as absence)
      200 ─────────────────────► recordingMbid, matchMethod = 'isrc'
                                    │
2.  GET /ws/2/release?recording={mbid}&inc=labels&limit=100
                                    │
3.  narrowReleases(releases, spotifyAlbum, spotifyDate)     ⚙️ pure
        tier 1  title AND date match  ────► candidates, tier = 'title-date'
        tier 2  title matches         ────► candidates, tier = 'title'
        tier 3  all releases          ────► candidates, tier = 'all'    (caps confidence low)
                                    │
4.  candidates -> LabelCandidate[]  (name, mbid, type, catno, release info)
```

### ⚠️ Step 1 and step 2 must stay two calls

`GET /ws/2/isrc/{isrc}?inc=releases` returns **200 with `inc` silently dropped** — recordings, no
releases, no error. It reads exactly like "MusicBrainz has no data for this track". All 19 probe
ISRCs came back that way, and it was caught only by checking against a recording *known* to have 44
releases.

**A wrong request shape here is indistinguishable from absent data.** Any optimisation that folds
these into one call reintroduces a *plausible* wrong answer — the worst kind. Pin it with a test
(BR-1.2).

### Step 5 — search fallback, narrowly

Only when step 1 returned `not-found` (BR-1.5):

```
GET /ws/2/recording?query=recording:"{title}" AND artist:"{artist}"
    count == 1  AND  normalised artist and title match exactly
        ├─ yes ─► accept, matchMethod = 'search'
        └─ no  ─► status stays not-found, matchMethod = 'none'
```

**Never take the top hit.** For Ren's *Starry Night Act III* the top **two** hits scored **100 and
were different recordings**; the near-correct one scored **95**. `score` does not rank correctness.
This rule recovers BOVSKI and Prof and correctly **refuses** Ren.

---

## Flow 3 — `resolveArtist(spotifyArtistId)`

```
1.  GET /ws/2/url?resource=https://open.spotify.com/artist/{id}&inc=artist-rels
        404 ─────► no MusicBrainz artist; artist level = unknown
        200 ─────► relations[].artist.id  =  artistMbid          ← EXACT, no name matching
2.  GET /ws/2/release?artist={artistMbid}&inc=labels&limit=100
3.  drop non-Official releases                                    (BR-3.6)
4.  aggregate label -> releaseCount
```

**This is the only place a second resolution level is permitted, because the join is exact.** No
`score`, no name matching. MusicBrainz holds **three** artists named `Prof`; this returns the right
one by construction. Name search is explicitly forbidden as a fallback here (BR-6.2) — permitting
it would reintroduce the hazard Flow 2 step 5 exists to contain.

**Measured**: 88.2 % of artists resolve, 76.5 % yield a named label, versus 57.9 % at release
level. It recovers 5 of the 6 ISRC 404s and both `[no label]` cases.

---

## Flow 4 — `classify(candidates, context)` ⚙️ PURE

The heart of the unit. Input in, verdict out — no clock, no network, no database (BR-4.8).

```
STEP 1  Eligibility                                              (BR-3)
        drop labelType == 'Publisher'                     ← Faouzia
        drop labelName == '[no label]'                    ← Imminence, Red Leather
        strength: Imprint | Original Production -> strong
                  Distributor | null            -> weak

STEP 2  Cast votes, independently                                (BR-4.1, BR-4.2)
        S1  major root list      name matches a curated major/imprint root
        S2  label relationships  imprint / ownership / distribution  ← VOTED SEPARATELY
        S3  ISRC prefix          USUM->Universal, USSM->Sony, GBUM->Universal UK...

STEP 3  Fold                                                     (BR-4.3-4.5)
        any strong 'major' vote            -> major
        some 'independent', NO 'major'     -> independent
        otherwise                          -> unknown

STEP 4  Contested                                                (BR-4.7)
        two or more DIFFERENT majors present -> contested = true

STEP 5  Band confidence                                          (BR-5)
        >=2 strong agreeing AND tier in (title-date, title) -> high
        1 strong, no contradiction                          -> medium
        weak only | contradiction | tier == 'all' | contested -> low
```

### Step 3 is asymmetric on purpose

This is the user's precision principle as arithmetic: **a major anywhere makes it major;
independence requires the absence of any major vote.**

NF's *The Search* carries `NF Real Music`, `Capitol` and `Caroline`. Folding on the artist's own
imprint alone would read *independent* — an artist imprint distributed by a major is one
arrangement, not a contradiction, and step 3 records it as what it is.

Missing an independent track costs one row. Calling a major track independent **manufactures
support for the hypothesis under test**, invisibly.

### Step 2 keeps the three relationship types apart

| Label | Walk | Correct? |
|---|---|---|
| Epic | `imprint` → Sony Music Entertainment | ✅ |
| Interscope | `imprint` → UMGRI Interscope | ✅ |
| Roadrunner | `imprint` → Elektra; `distribution` → Atlantic | ✅ Warner |
| **Spinefarm** | `distribution` → **[PIAS] UK Ltd.** | ❌ **Universal-owned** |

Following distribution says *independent* where the truth is *Universal*. Merging the three into a
single "parent" walk produces a wrong answer with no trace of the disagreement — which is exactly
what R3 predicted and FR-13's per-signal votes exist to preserve.

---

## Flow 5 — Two levels, side by side

```
Play
 ├── label_verdict         label_confidence         label_contested          ← release level
 └── artist_label_verdict  artist_label_confidence                           ← artist level
```

**They are never merged, reconciled, or used to override one another** (BR-6.4).

> **Token — *Full Bag*** resolves to `Never Too Different` (independent) at release level and
> **`Atlantic`** at artist level. Both are true — an Atlantic artist who released this one
> independently.

For R1 these are plausibly *different variables*: artist-signed status as a **control** (is this
person already inside the industry?), release label as the **treatment** (was this particular track
a label push?). One merged column would destroy the distinction permanently and leave no evidence
that it had been destroyed. **Disagreement between the levels is the data**, not an error
(BR-6.5).

---

## Flow 6 — Liked-status capture

```
play start ──► likedAtStart := cachedSavedSet.has(trackId)      (null if set unavailable)
                                                                 ⚠️ NOT recoverable later
play close ──► likedAtEnd := cachedSavedSet.has(trackId)
                    │
                    └─► schedule grace-window check, ~30 s        (Q8 = A)
                             │
                             GET /me/tracks?limit=50   (page 1, most-recently-saved first)
                             │
                             added_at >= play.startedAt  AND  trackId matches
                                   ├─ yes ─► likedAtEnd := true, likedAddedAt := added_at
                                   └─ no  ─► unchanged
                    │
derive transition ──┴──► liked-during | unliked-during | kept-liked | kept-unliked | unknown
```

**The grace window exists because liking lags the track.** Sampling strictly at the play boundary
would record the strongest positive signal the Spotify API can yield as `kept-unliked`.

**`added_at` is what makes it safe rather than a guess** (BR-9.4): second precision,
most-recently-saved first, so a like is *provably* attributable to the play window.

Unlikes are probed only when `likedAtStart` was true, via a targeted `offset` window around the
cached rank (BR-9.7) — an unlike leaves no tombstone and no timestamp, so a full 12-request diff
per play would be the only alternative, and that is unaffordable at ~200 plays/day.

⚠️ **`null` means unknown and is never `false`.** The saved set can be unavailable; a `false`
written in its place is an unrecoverable fabrication (BR-9.5).

---

## Flow 7 — Backfill

Two independent jobs, run once, idempotent.

```
JOB A  ISRC recovery                                              (Q7 = A)
       plays where isrc IS NULL and track_id IS NOT NULL
         └─► GET /tracks/{id} -> external_ids.isrc -> UPDATE play.isrc
       47 rows today. One-off Spotify cost, trivially within quota.

JOB B  Label backfill                                             (BR-8.3)
       plays where isrc IS NOT NULL and label_verdict IS NULL
         └─► batched through RequestQueue -> resolveRelease -> classify -> UPDATE
       Uses idx_play_isrc, created in migration 001 for exactly this scan.
```

**Neither job ever rewrites a U1 field** — outcome, evidence, provenance and the observation trail
are untouched (BR-8.4). Backfill adds columns' worth of new information; it does not revise
history.

### Reclassification needs no MusicBrainz request at all

```
reclassifyLabels()  =  stored candidates + stored votes -> classify() -> new verdict
                       classifier_version bumped
```

R3 guarantees the classifier will be re-tuned. Because facts were stored separately from
judgements, that re-tune is a local recomputation over the database (BR-8.7) — the same structure
that let U1's completion threshold be revisited without re-collecting a single play.

---

## Flow 8 — The hypothesis gate

The Phase 2 exit criterion, and the reason the unit exists.

```
1.  Export (FR-49/50/51) — every field, unknown as the literal token, coverage counts
2.  PRE-REGISTERED comparison, fixed before results are seen           (BR-11.1)
       skip rate: label_verdict = 'major'  vs  'independent'
       among plays with a KNOWN label, rule-initiated skips excluded   (BR-11.4)
3.  Report the `unknown` group ALONGSIDE                               (BR-11.2)
4.  Report coverage counts and the by-year breakdown                   (BR-11.3)
5.  Below the stated minimum sample -> "insufficient data", not a verdict (BR-11.6)
6.  Record the outcome in audit.md EITHER WAY                          (BR-11.5)
```

### Why the `unknown` group is not optional

Measured coverage: **pre-2022 5/5 (100 %), 2022-onward 6/14 (43 %)**. The missingness is *not
random* — it concentrates on recent independent singles, the population the hypothesis is about.

So a naive `major` vs `independent` comparison is confounded: the `unknown` bucket is
disproportionately made of independents. **If the `unknown` group's skip rate resembles the
`independent` group's, that is evidence about who the unknowns are** — and it is the single most
informative check available on the measured bias.

### The gate is designed to be able to fail

BR-11.1 and BR-11.5 together are what make this a gate rather than a formality. Pre-registration
stops the criterion being fitted to the result; recording the outcome either way is the project's
stated commitment that **R1 is a hypothesis to be tested, and the design was built so it can be
disconfirmed.**

---

## Migration 002

Forward-only (NFR-12). Additive: no existing column is altered or dropped, so U1 data is untouched.

```sql
-- cached facts
CREATE TABLE label_resolution (
  isrc TEXT PRIMARY KEY, recording_mbid TEXT,
  match_method TEXT CHECK (match_method IN ('isrc','search','none')),
  narrowing_tier TEXT CHECK (narrowing_tier IN ('title-date','title','all','none')),
  release_count INTEGER NOT NULL DEFAULT 0, resolved_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('resolved','not-found','error')));

CREATE TABLE label_candidate (
  isrc TEXT NOT NULL REFERENCES label_resolution(isrc) ON DELETE CASCADE,
  label_name TEXT NOT NULL, label_mbid TEXT, label_type TEXT, catalog_number TEXT,
  release_id TEXT NOT NULL, release_title TEXT, release_date TEXT, release_status TEXT);

CREATE TABLE artist_label_resolution (
  spotify_artist_id TEXT PRIMARY KEY, artist_mbid TEXT,
  release_count INTEGER NOT NULL DEFAULT 0, named_label_count INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('resolved','not-found','error')));

CREATE TABLE artist_label (
  spotify_artist_id TEXT NOT NULL REFERENCES artist_label_resolution(spotify_artist_id)
    ON DELETE CASCADE,
  label_name TEXT NOT NULL, label_mbid TEXT, label_type TEXT,
  release_count INTEGER NOT NULL DEFAULT 0);

CREATE TABLE label_signal_vote (
  scope TEXT NOT NULL CHECK (scope IN ('release','artist')),
  scope_key TEXT NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('major-root-list','label-relationship','isrc-prefix')),
  verdict TEXT NOT NULL CHECK (verdict IN ('major','independent','unknown')),
  strength TEXT NOT NULL CHECK (strength IN ('strong','weak')),
  evidence TEXT);

-- derived snapshot on the play
ALTER TABLE play ADD COLUMN label_verdict TEXT
  CHECK (label_verdict IN ('major','independent','unknown'));
ALTER TABLE play ADD COLUMN label_confidence TEXT
  CHECK (label_confidence IN ('high','medium','low'));
ALTER TABLE play ADD COLUMN label_contested INTEGER;
ALTER TABLE play ADD COLUMN label_names TEXT;
ALTER TABLE play ADD COLUMN label_match_method TEXT;
ALTER TABLE play ADD COLUMN label_narrowing_tier TEXT;
ALTER TABLE play ADD COLUMN artist_label_verdict TEXT
  CHECK (artist_label_verdict IN ('major','independent','unknown'));
ALTER TABLE play ADD COLUMN artist_label_confidence TEXT
  CHECK (artist_label_confidence IN ('high','medium','low'));
ALTER TABLE play ADD COLUMN artist_label_names TEXT;
ALTER TABLE play ADD COLUMN label_classifier_version INTEGER;
ALTER TABLE play ADD COLUMN liked_at_start INTEGER;
ALTER TABLE play ADD COLUMN liked_at_end INTEGER;
ALTER TABLE play ADD COLUMN liked_added_at TEXT;
ALTER TABLE play ADD COLUMN liked_transition TEXT
  CHECK (liked_transition IN
    ('liked-during','unliked-during','kept-liked','kept-unliked','unknown'));

CREATE INDEX idx_play_label_verdict ON play(label_verdict);
CREATE INDEX idx_play_artist_id     ON play(artist_id);
```

**Every new column is nullable, and `NULL` means unknown** — not `false`, not `0`, end to end
including exports, where it renders as the literal token `unknown`. Every existing U1 row becomes a
row with unresolved labels, which is exactly what it is, and Job B fills them in.

`idx_play_artist_id` is new and supports Flow 3's per-artist cache lookups; `idx_play_isrc` already
exists from migration 001, created there in anticipation of Job B's scan.
