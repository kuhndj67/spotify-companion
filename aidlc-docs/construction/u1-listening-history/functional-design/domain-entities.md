# Domain Entities — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Functional Design, U1

Technology-agnostic domain model. Storage mapping appears at the end for concreteness, but the
entities are defined independently of it.

---

## Entity overview

| Entity | Cardinality | Lifetime | Mutable? |
|---|---|---|---|
| **Play** | One per track listen | Permanent | Outcome only, via reclassification |
| **Observation** | Many per Play | Indefinite (W-2) | Never |
| **OutcomeEvidence** | One per Play | Permanent | Recomputed with outcome |
| **ExportRow** | Transient | Request-scoped | N/A |

---

## Play

A single listening event: one track, from the moment it started to the moment it stopped.

| Attribute | Type | Notes |
|---|---|---|
| `id` | identity | |
| `trackId` | string | Spotify track ID |
| `isrc` | `Maybe<string>` | **The U2 join key — required from the first play** |
| `title` | string | |
| `artistName` | string | Primary artist |
| `artistId` | `Maybe<string>` | |
| `albumName` | string | |
| `releaseDate` | `Maybe<string>` | |
| `ageYears` | `Maybe<number>` | Derived at play time |
| `following` | `Maybe<boolean>` | Follow status at play time |
| `startedAt` | timestamp | First observation |
| `endedAt` | timestamp | Last observation |
| `outcome` | `completed \| skipped \| unknown` | Derived. Three values |
| `evidence` | OutcomeEvidence | What the verdict rested on |
| `provenance` | `live \| backfilled` | |
| `skipSource` | `Maybe<user \| rule>` | **`user` from U1; `rule` only from U5** |
| `contextType` | `Maybe<string>` | Playlist, album, artist, DJ… |
| `classifierVersion` | number | Which classifier produced `outcome` |

### Enrichment is snapshotted, not referenced

`title`, `ageYears`, `following` and the rest are copied onto the Play at the time it happened,
not looked up later. Follow status changes; albums get re-released; the app's own enrichment
improves. An analysis asking *"did I skip tracks by artists I wasn't following?"* needs the answer
**as it was then**, not as it is now.

### `classifierVersion` exists so FR-20 is auditable

When reclassification runs, this records which logic produced the stored verdict. Without it,
a partially-reclassified database is indistinguishable from a consistent one — you could not tell
which rows had been revisited. It is what makes "recompute the outcomes" a safe operation rather
than a destructive one.

### `skipSource` is populated from the first play

Recorded as `user` for every live-observed skip from U1 onward, even though nothing can produce
`rule` until U5. This is the US-13 split: if the attribute appeared only with U5, every play from
Phases 1–3 would be permanently unattributed and a later migration would have to *assume* they
were user skips.

---

## Observation

One poll sample. The raw material from which outcomes are derived.

| Attribute | Type | Notes |
|---|---|---|
| `playId` | identity | Owning Play |
| `atMs` | timestamp | Wall clock of the poll |
| `progressMs` | number | Position within the track |
| `durationMs` | number | Track length as reported |
| `isPlaying` | boolean | Distinguishes paused from advancing |
| `sequence` | number | Ordinal within the play |

**Immutable.** Observations are facts about what was seen; nothing may rewrite them. Reclassifying
an outcome re-reads them and never edits them.

`durationMs` is stored per observation rather than per play because Spotify has been observed to
report it inconsistently across a play; keeping it per sample means a mid-play change is visible
rather than silently overwritten.

---

## OutcomeEvidence

The derived summary a verdict rests on. Recomputable from the trail; stored so that reading a
verdict does not require re-deriving it.

| Attribute | Type | Notes |
|---|---|---|
| `listenedMs` | number | **Total time spent listening** — sum of forward progress. Re-listening adds again |
| `durationMs` | number | Duration used for the ratio |
| `completionRatio` | number | `listenedMs / duration` — **the decision variable. May exceed 1.0** |
| `maxProgressMs` | number | Furthest point reached. Evidence only |
| `maxObservationGapMs` | number | Largest gap between samples |
| `observationCount` | number | Trail length |
| `sawPause` | boolean | Any sample with `isPlaying = false` |
| `rewound` | boolean | A backward jump occurred. **Evidence only — does not affect classification** |
| `endedWithIdle` | boolean | Playback stopped rather than advancing |

### `completionRatio` measures listened time, not position

Changed 2026-08-25. User: *"rewinding will just extend the play time of the track which will
increase its ratio (making it possible for the ratio to exceed 1.0), that will not conflict with
the 90% skip vs complete task."*

This is why no rewind rule exists. Under the earlier **position-based** definition
(`max(progress) / duration`), rewinding moved the position backwards and left the ratio unchanged —
a rewound play scored as though the listener had simply stopped at the peak, so a special rule was
needed to rescue it. Under **listened time**, re-hearing a passage adds to the numerator directly,
and engagement raises the ratio without any rule at all.

**Ratios above 1.0 are legitimate and must not be clamped.** 2.4 means the track was heard nearly
two and a half times. Clamping looks like defensive hygiene and would silently discard the
repeat-listen signal.

### `maxProgressMs` and `rewound` are evidence, not inputs

Both are recorded because they are cheap and useful to an analyst. **Neither is read by the
classifier.** Keeping them as facts rather than triggers is what prevents a preference judgement
from creeping back into what is otherwise a record of observations.

### Forward jumps are not detected

Removed 2026-08-25 — user judged seeking forward *"extremely rare, since I'd always skip to the
next track instead."*

No detection logic exists. Instead, each forward step is capped at the wall-clock time elapsed
between observations (BR-2.10), so a seek cannot inflate `listenedMs`. That is arithmetic, not
detection: you cannot listen to more audio than time has passed.

`completionRatio` is stored explicitly even though it is derivable, because it is the value the
rule is expressed in. An analyst inspecting a surprising verdict should be able to see the number
that produced it without recomputing anything.

---

## ExportRow

A flattened Play, prepared for CSV or JSON. Transient — never persisted.

Flattening rules that carry meaning:

| Concern | Rule |
|---|---|
| `Maybe` values | Rendered as a distinct `unknown` token — **never blank, zero, or false** |
| Nested evidence | Flattened to `evidence_completionRatio`, `evidence_sawPause`, … |
| Timestamps | ISO 8601, UTC |
| Booleans | `true` / `false`, distinct from `unknown` |

The first rule is the one that matters. R2's missing-data bias is correlated with the variable
being measured, so an `unknown` that exports as an empty cell becomes invisible in a spreadsheet
and silently biases any analysis built on it.

---

## Relationships

```
Play  1 ──── * Observation      (composition; observations have no meaning alone)
Play  1 ──── 1 OutcomeEvidence  (embedded, not a separate table)
Play  1 ──── 1 ExportRow        (projection, transient)
```

**No Track entity.** Track identity is denormalised onto Play deliberately: a normalised Track
table would hold one row per track with current metadata, which defeats the point-in-time
snapshotting above. Aggregation by `trackId` at query time gives everything a Track table would,
without losing history.

---

## Storage mapping (SQLite, migration 001)

```sql
CREATE TABLE play (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id             TEXT    NOT NULL,
  isrc                 TEXT,                    -- NULL = unknown; U2 join key
  title                TEXT    NOT NULL,
  artist_name          TEXT    NOT NULL,
  artist_id            TEXT,
  album_name           TEXT    NOT NULL,
  release_date         TEXT,
  age_years            INTEGER,
  following            INTEGER,                 -- 0/1/NULL = unknown
  started_at           TEXT    NOT NULL,        -- ISO 8601 UTC
  ended_at             TEXT    NOT NULL,
  outcome              TEXT    NOT NULL CHECK (outcome IN ('completed','skipped','unknown')),
  provenance           TEXT    NOT NULL CHECK (provenance IN ('live','backfilled')),
  skip_source          TEXT             CHECK (skip_source IN ('user','rule')),
  context_type         TEXT,
  classifier_version   INTEGER NOT NULL,
  ev_listened_ms       INTEGER NOT NULL,      -- total listening time; re-listening accumulates
  ev_duration_ms       INTEGER NOT NULL,
  ev_completion_ratio  REAL    NOT NULL,      -- listened/duration; MAY EXCEED 1.0 — do not clamp
  ev_max_progress_ms   INTEGER NOT NULL,      -- furthest point; evidence only
  ev_max_gap_ms        INTEGER NOT NULL,
  ev_observation_count INTEGER NOT NULL,
  ev_saw_pause         INTEGER NOT NULL,
  ev_rewound           INTEGER NOT NULL,      -- evidence only; does not affect classification
  ev_ended_with_idle   INTEGER NOT NULL
);

CREATE TABLE observation (
  play_id     INTEGER NOT NULL REFERENCES play(id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL,
  at_ms       INTEGER NOT NULL,
  progress_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  is_playing  INTEGER NOT NULL,
  PRIMARY KEY (play_id, sequence)
);

CREATE INDEX idx_play_started   ON play(started_at);
CREATE INDEX idx_play_track     ON play(track_id);
CREATE INDEX idx_play_isrc      ON play(isrc);       -- U2 backfill
CREATE INDEX idx_play_outcome   ON play(outcome);

CREATE TABLE schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL);
```

### Storage decisions worth stating

**`NULL` means unknown, uniformly.** Every `Maybe` maps to a nullable column, and no column uses a
sentinel value. `following INTEGER` is `0`, `1`, or `NULL` — never `0` standing in for "we don't
know". This is the storage-level expression of the tri-state rule, and it is where that rule is
most easily broken.

**Evidence is embedded, not a table.** It is exactly one row per play, always read with the play,
and never queried independently. A separate table would add a join to every read for no benefit.

**`idx_play_isrc` exists before U2 needs it.** The backfill job scans for plays with an ISRC and no
label; without the index that becomes a full table scan over a growing table on every batch.

**`ON DELETE CASCADE` on observations** so W-2's eventual pruning can delete a play's trail
cleanly. Play records are never deleted by that mechanism.

**Migration 001 creates exactly this and nothing more** (Q4 = B). Label columns arrive in
migration 002 with U2; rule-action columns in 003 with U5.
