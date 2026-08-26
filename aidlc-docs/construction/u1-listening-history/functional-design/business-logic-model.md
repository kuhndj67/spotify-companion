# Business Logic Model — U1: Listening History & Export

**Date**: 2026-08-25 · **Stage**: CONSTRUCTION — Functional Design, U1

Technology-agnostic. Algorithms and workflows; no infrastructure concerns.

---

## 1. The observation pipeline

```
poll tick ──► segment ──► accumulate ──► boundary? ──► summarise ──► classify ──► persist
   (U0)      (BR-1)       (trail)        (BR-1.2)      (evidence)    (BR-2)     (BR-3)
```

One rule governs the whole pipeline: **observation is never lost, and judgement is always
reversible.** Segmentation and classification are separable, and only classification is allowed to
be wrong in a way that matters — because only classification can be redone.

---

## 2. Play segmentation

Consumes the unsuppressed `tick` stream. Maintains one in-progress play.

```
on tick(observation):
    if no current play:
        start new play with this observation
        return

    if observation.trackId != current.trackId:
        close current play (reason: track-change)
        start new play
        return

    if observation is idle (nothing playing):
        close current play (reason: playback-stopped)
        return

    append observation to current trail
```

### There is no backward-jump branch

An earlier draft had one, plus a classification rule to stop rewound plays being scored as skips.
Both are gone. **Backward progress on the same track simply continues the play**, and the ratio
handles the rest (§3).

The reasoning, from the user: rewinding extends listening time, which raises the ratio by itself.
Once the ratio measures time rather than position, the replay-versus-rewind question — previously
the hardest disambiguation in this unit — stops existing.

**Consequence worth knowing**: a track played twice in a row is one play record with a ratio near
2.0, not two records. Play counts undercount repeats; the ratio carries that signal instead.

---

## 3. Evidence summarisation

Pure. Trail in, evidence out.

```
summarise(trail):
    # Listened time: seed with the first sample's position, then sum forward movement only.
    listenedMs = trail.first.progressMs
    for each consecutive pair (prev, cur):
        step        = cur.progressMs - prev.progressMs        # negative on a rewind
        elapsed     = cur.atMs - prev.atMs
        listenedMs += clamp(step, 0, elapsed + jitterTolerance)   # BR-2.1, BR-2.10

    durationMs       = trail.last.durationMs
    completionRatio  = durationMs > 0 ? listenedMs / durationMs : undefined   # NOT clamped
    maxProgressMs    = max(o.progressMs for o in trail)       # evidence only
    maxGapMs         = max(consecutive differences in o.atMs)
    sawPause         = any(not o.isPlaying)
    rewound          = any(o[i].progress < o[i-1].progress - pollInterval)   # evidence only
    endedWithIdle    = trail.last is idle or play closed by playback-stop
    observationCount = |trail|
```

### Three details in that loop carry the design

**`clamp(step, 0, …)` — the lower bound is what makes rewinds free.** A negative step contributes
nothing rather than subtracting. Re-listening then adds its time again, so the ratio rises. This
one clamp is the entire replacement for the rewind rule and the replay branch.

**`clamp(…, elapsed + jitter)` — the upper bound is accounting, not seek detection.** You cannot
listen to more audio than time has passed. Without it, an undetected forward seek would add its
whole jump as though it had been heard. With it, forward seeks are harmless without any of the
detection logic that was rejected as not worth building.

**The seed matters.** `listenedMs` starts at the first sample's position, because the listener
heard everything up to the first poll — typically a second or two. Starting at zero would
systematically undercount every play by up to one poll interval.

**`completionRatio` is not clamped above.** A ratio of 2.4 means the track was heard nearly two and
a half times, and that is a signal worth keeping. `maxProgressMs` and `rewound` are retained as
evidence only — neither influences classification.

---

## 4. Classification

Pure. Evidence and threshold in, verdict out. No clock, no config, no I/O (BR-2.9).

```
classify(evidence, threshold = 0.90, closeReason):

    if evidence.durationMs <= 0:                     return unknown   # BR-2.7
    if evidence.completionRatio >= threshold:        return completed # BR-2.2 — precedence
    if closeReason == track-change:                  return skipped   # BR-2.3
    if closeReason in (pause-idle, playback-stopped,
                       app-shutdown):                return unknown   # BR-2.4/5/6
    return unknown
```

### The ordering is the algorithm

`completed` is tested **first**, before any interruption reason. A track that reached 90% and was
then paused or stopped is `completed` — the threshold was met, and what happened afterwards does
not retract it. Reversing these two checks would downgrade genuine completions to `unknown`
whenever playback was paused after a track effectively ended, which is ordinary behaviour.

**The classifier is now four branches with no special cases.** Every complication that was here
before — rewind handling, replay detection, forward-seek detection — moved into how `listenedMs` is
summed. That is the better place for it: `summarise` is arithmetic over a trail, easy to
property-test exhaustively, while a branch in `classify` is a judgement that has to be argued for.

Everything that is not a clean completion or a clean below-threshold track change becomes
`unknown`. That is a deliberately wide net (Q7 retired `abandoned`), and it is the conservative
direction: `unknown` costs analytical power, whereas a wrong `skipped` actively misleads.

---

## 5. Reclassification (FR-20)

```
reclassify(playId, threshold):
    trail = load trail for playId
    if trail is empty:            skip        # BR-4.5 — backfilled plays have none
    evidence = summarise(trail)
    outcome  = classify(evidence, threshold, storedCloseReason)
    if outcome != stored.outcome or evidence != stored.evidence:
        update outcome, evidence, classifierVersion
        record the change
    # observations are never touched — BR-4.2
```

This is the mechanism that makes the accepted short-track limitation recoverable. Every
sub-30-second track currently destined to be marked `skipped` can be corrected later by a
classifier that applies a poll-interval floor — **without re-collecting anything**, because the
trail is retained.

That is the whole argument for Q1 = C in Application Design, made concrete.

---

## 6. Backfill workflow

```
on startup:
    recent = GET /me/player/recently-played        # BR-5.1
    for each item, oldest first:
        if hasPlayAt(trackId, playedAt, tolerance):   continue   # BR-5.4
        record play with:
            outcome    = unknown                                 # BR-5.2/5.3
            provenance = backfilled
            evidence   = empty (no trail exists)
            skipSource = unknown
    # failure here is non-fatal — BR-5.6
```

**Oldest-first** so that if the process is interrupted, what was written is a contiguous prefix
rather than scattered rows with holes.

The endpoint reports no progress and no outcome, so `unknown` is the only honest verdict. Treating
these as completions would inflate the completion rate exactly during the periods the app was not
running — a bias correlated with app downtime, which is not random.

---

## 7. Export pipeline

```
request(format, since?)
    ├── validate filter                          # BR-6.10, before any output
    ├── confirm repository readable              # BR-6.10
    ├── compute coverage counts                  # BR-6.4
    ├── emit header (CSV) or opening structure (JSON)
    ├── for each play, streamed:                 # BR-6.8
    │       flatten → render Maybe values → emit row
    └── emit coverage summary as a trailer / sibling field
```

**Validation precedes the first byte** because a stream cannot be un-sent. Once output has begun,
a failure can only terminate the stream and log — there is no recovery, and no way to signal an
error status.

**Rendering `Maybe` is the step that carries the analytical weight.** `unknown` must be
distinguishable from every legitimate value in every column: not an empty cell, not `0`, not
`false`. R2's missing data is correlated with the variable being measured, so if `unknown`
disappears into blankness in a spreadsheet, the bias becomes invisible rather than merely present.

The coverage counts turn "how much is missing?" from an assumption into a number the analyst can
see without querying anything.

---

## 8. Startup and shutdown

**Startup**, order significant:
1. Open database
2. Run migrations to current version — **fail fast**; a half-migrated schema must never take writes
3. Run backfill (non-fatal on failure)
4. Subscribe the observer to `tick`

**Shutdown**:
1. Stop accepting ticks
2. Flush the in-progress play as `unknown` (BR-2.6)
3. Close the database

The in-progress play is flushed rather than discarded. Discarding loses a real listening event;
classifying it as `completed` or `skipped` would assert something unobserved. `unknown` records
what actually happened: a play occurred, and its ending was not seen.

---

## 9. Degraded operation (NFR-13)

| Failure | Behaviour |
|---|---|
| Database unopenable at startup | Start display-only; diagnostics reports it; retry on next start |
| Write fails mid-session | Count the gap (BR-3.9); log once per failure class; keep serving |
| Migration fails | **Refuse to write.** Display-only; never write against an unknown schema |
| Disk full | Same as write failure |

**No failure in this unit may break the now-playing display.** U0 worked before history existed
and must continue to work when history is broken.

**Logging is once per failure class, not per tick.** A locked database at a 3 s poll would
otherwise produce 1,200 identical log lines an hour and bury everything else.

---

## 10. Story coverage

| Story | Sections |
|---|---|
| US-10 Every play recorded | §2, §3, §8 |
| US-11 Skips vs completions | §2, §3, §4 |
| US-12 Backfill gaps | §6 |
| US-13 (recording half) | §3 — `skipSource = user` from the first play |
| US-25 Export | §7 |
| FR-20 Recomputable | §5 |
