# U1 Live Verification

**Date**: 2026-08-26 · **Status**: ✅ **Verified against real listening**

Closes the item left outstanding at Build and Test, when nothing was playing.

---

## Dataset

| | |
|---|---|
| Total plays | 68 |
| Live-observed | 18 |
| Backfilled | 50 |
| Counted gaps | **0** |
| Max observation gap | **3–4 s** across every play — no missed polls |

---

## What the data confirms

| Expectation | Evidence |
|---|---|
| Plays recorded automatically | 18 live plays, no user action |
| ISRC on every live play | `unknownIsrc = 50`, exactly the backfilled rows |
| Follow status on every live play | `unknownFollowing = 50`, same |
| Completions detected | 12 plays, ratios 0.910 – 0.995 |
| Skips detected and attributed | 3 plays, all `skipSource = user` |
| Pause handled | `Duality` — 203 observations over ~10 min wall clock, `sawPause`, `pause-idle`, **`unknown` not `skipped`** |
| Playback stop handled | `playback-stopped` → `unknown` |
| Trail length proportional to duration | 320 s track → 104 observations ≈ 320/3 ✓ |
| `listenedMs == maxProgressMs` throughout | Correct: no rewinds occurred, so the two must agree |
| Persistence survives restarts | History accumulated across sessions |
| No recording failures | `countedGaps = 0` |
| **FR-56 snapshots** | Triggered manually: `history-snapshot-2026-08-26T23-14-48-200.csv`, 68 rows, coverage header present |

---

## ⚠️ Finding: the 0.90 threshold splits a dense behavioural cluster

Sorting live plays by **seconds remaining when the play ended** shows a sharply bimodal
distribution — and the threshold cuts straight through the crowded half.

```
   1s left | 0.994 | completed
   1s left | 0.994 | completed
   1s left | 0.995 | completed
   6s left | 0.969 | completed
  10s left | 0.955 | completed
  11s left | 0.963 | completed
  11s left | 0.917 | completed
  12s left | 0.963 | completed
  13s left | 0.921 | completed
  14s left | 0.930 | completed
  16s left | 0.910 | completed     <-- last completion
  ------------------------------------ 0.90 threshold falls here
  20s left | 0.899 | unknown       <-- missed by 0.001
  22s left | 0.880 | skipped
  23s left | 0.895 | skipped
  ------------------------------------ a 178-second gap with nothing in it
 194s left | 0.233 | skipped
 195s left | 0.229 | unknown
 219s left | 0.022 | unknown
```

**Two clusters, and nothing between them.** Plays end either with **≤ 23 s remaining** (14 of 17)
or with **≥ 194 s remaining** (3 of 17). The genuine rejections are unmistakable and nowhere near
the boundary.

The ratio threshold is therefore doing its discriminating work *inside* the dense cluster: it
separates "moved on with 16 s left" from "moved on with 20 s left". **A four-second difference
decides a categorical outcome**, in exactly the region where the listener's behaviour is most
concentrated and least meaningful.

**6 of 17 live plays sit within ±0.03 of the threshold.**

### Why this matters

Two plays — `Fuck You` (22 s left) and `UNETHICAL` (23 s left) — are recorded as **`skipped`**
after roughly 88% of the track had played. Those are almost certainly not rejections; they are
outro skips. Recorded as skips, they become **false negatives in the preference signal**, which is
the outcome variable the entire promotion hypothesis is tested against.

### What the data suggests

A **fixed tail window** — treat a play as completed if it ended within ~30 s of the end —
separates this listener's behaviour cleanly:

| Rule | Result on this data |
|---|---|
| Ratio ≥ 0.90 (current) | Splits the 14-play cluster into 11 completed / 1 unknown / 2 skipped |
| Ended within 30 s of the end | All 14 → completed; all 3 genuine rejections → skipped. **178 s of margin** |

That is option D from U1 Functional Design Q1, which was recommended and not chosen. The
difference now is that this is **measurement rather than speculation** — the earlier discussion had
no data.

### This is correctable, and that is the point

Every observation trail is retained, so `reclassify()` can apply a different rule to **all
existing history** with no re-collection. The design decision to store trails (Application Design
Q1 = C) exists precisely for this, and this is the first time it has paid off.

**Recommendation**: consider a tail-window rule, applied retroactively. Not changed unilaterally —
the threshold was an explicit user decision, and 18 plays is a small sample. Worth revisiting once
a few hundred plays have accumulated, which will show whether the clustering holds.

---

## Secondary observations

**A brief false start creates its own record.** `.CoDA.` appears twice: once with 2 observations
at ratio 0.022, then a full play at 0.955. The track started, stopped almost immediately, and was
restarted. Correct per BR-1, but analyses should be aware that very-low-ratio `unknown` rows may be
false starts rather than rejections. The `observationCount` field distinguishes them.

**A long pause splits one listen into two records.** `Duality` has a 203-observation play
(`sawPause`, `pause-idle`, `unknown`) followed by a 1-observation play (`skipped`). Expected
behaviour, worth knowing when counting plays.

**Snapshot retention untested at the boundary.** Rotation keeps 14; only one snapshot exists.
The logic is unit-tested but has not run against a full directory.

---

## Still outstanding

| Item | Status |
|---|---|
| Rewind / replay behaviour | **Not observed** — `rewound = false` on all 18 plays. The rewind path is unit- and property-tested but has never fired against real listening |
| Containerised deployment | Blocked by the local-only guard (see build-and-test summary) |
| Snapshot rotation at capacity | Untested with > 14 snapshots |
