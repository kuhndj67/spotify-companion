# R11 — queue lookahead during active playback

**Probed 2026-09-22.** Read-only: `GET /me/player`, `/me/player/queue`,
`/me/player/currently-playing`. Nothing was written to `history.db`; the container stayed up
throughout and remained the only writer.

> **Answer: it depends on the playback context, which is neither outcome the execution plan
> anticipated.** An album returns 7–20 tracks of accurate lookahead. The AI DJ returns an empty
> queue, always. FR-36 is therefore implementable for some contexts and *impossible* for the one
> the listener uses 50–70% of the time.

Phase 4's exit criterion — *"Queue lookahead probed during active playback; result recorded
either way"* — is discharged by this document.

---

## Why the 2026-08-25 probe could not answer this

The original probe returned `200` with an empty queue **while nothing was playing**. That result
is indistinguishable between "the endpoint yields nothing useful" and "there was simply nothing
queued", which is why `requirements.md` recorded it as *reachable, not populated* and deferred the
real question to the start of Phase 4.

---

## Method, and the control that makes it trustworthy

Two 15-minute runs, 88 samples each at 10-second intervals, forty minutes apart, on one machine
with unchanged settings and the same app build. Each sample paired `currently-playing` with
`queue`.

The probe checked **predictiveness, not presence**: whether `queue[0]` actually became the next
track. A queue that returns plausible tracks that do not play is the `inc=releases` shape — a
wrong answer that reads as a working feature.

⚠️ **The album run is the positive control for the DJ run, and without it the DJ result is not
usable.** An empty queue on its own is consistent with a Development Mode restriction, a missing
scope or a malformed request — the three things that have caught this project before. The album
run rules all three out: same credentials, same endpoint, same session, minutes apart, one
context returns 10 and the other returns 0. A further check inside the DJ run points the same
way — the queue response's own `currently_playing` field was **populated with the correct track**
while `queue` was `[]`, so the endpoint was working and truthfully reporting nothing.

---

## Result

| | AI DJ | Album |
|---|---|---|
| Context URI | `spotify:playlist:37i9dQZF1EYkqdzj48dyYq` | `spotify:album:2knEuvsxqHMAoxlQpIdpQD` |
| Samples / with playback confirmed | 88 / 75 | 88 / 88 |
| Queue HTTP status | `200` on all 88 | `200` on all 88 |
| Queue depth | **0** — `min 0 · max 0 · distinct [0]` | **7–20** — `distinct [7,8,9,10,20]` |
| Track changes crossed | 4 | 4 |
| `queue[0]` predicted the next track | **0 / 4** (nothing to predict from) | **4 / 4** |

Album depth counts *down* as the album is consumed (10 → 9 → 8 → 7), then jumps to 20 — consistent
with autoplay extending the queue as the context nears exhaustion, though that was not probed
directly.

`queue[0]` is a full track object: `id`, `name`, `artists`, `album`, `duration_ms`, `explicit`,
`track_number`, `uri`, `disc_number`, `external_urls`, `href`, `is_local`, `preview_url` — which
is everything FR-36 needs to pre-warm enrichment.

⚠️ **The DJ's empty queue was checked at track boundaries specifically**, in case the queue
populated only just before a transition. It does not: depth is 0 in the samples immediately
before and after all four changes.

### Other contexts

A third probe (`probe-context-matrix.mjs`, 6s sampling, auto-detecting context changes) extended
the table. **Two further contexts measured; the matrix is incomplete.**

| Context | `context.type` | Queue depth | Samples | Transitions | Shortfall median |
|---|---|---|---|---|---|
| AI DJ | `playlist` | **0** | 88 | 4 | **~24s** |
| Album | `album` | 7–20 | 442 | 12 | 3.4s |
| Autoplay continuation | `album` *(stale — see below)* | 20 | *(within the album run)* | 5 of the 12 | clean |
| Spotify radio station | `playlist` | **20**, never depleting | 627 | 16 | **3.2s** (max 5.8s) |

**Not yet measured**: shuffle on, artist "popular tracks", user-authored playlists, Liked Songs,
single track with no context.

⚠️ A context observed briefly is **not** measured to the standard of these. The DJ result rests on
88 consecutive samples across 4 transitions. A context passed through for 30 seconds gives a far
weaker answer and must be reported as such rather than filling in a table row as though all rows
were equal.

### 🔑 `context.type` cannot predict lookahead — the DJ and a radio station are the same type

```
Maphra Radio   spotify:playlist:37i9dQZF1E4xunLN1DdaFF   type=playlist  depth=20
The DJ         spotify:playlist:37i9dQZF1EYkqdzj48dyYq   type=playlist  depth=0
```

Both are `type: playlist`, both carry Spotify's `37i9dQZF1E` algorithmic prefix, and they give
**opposite** answers. The DJ is not a distinct context type; it is indistinguishable from a radio
station by every field except its specific URI.

Nor is "algorithmic" the discriminator. Autoplay recommendations (18 tracks by other artists,
queued before the album ended) and a radio station are both algorithmically selected and both
fully exposed. **Only the DJ hides its queue.**

**Design consequence**: FR-36 must ask the **queue** at runtime and adapt. It cannot infer
availability from `context.type`, and hardcoding the DJ's URI would be a recorded negative of
exactly the kind that decays silently when Spotify changes a URI or adds another queue-less
context. The check is one `GET` already on the polling path, and it is self-correcting.

### ⚠️ `context.uri` goes stale and keeps reporting a context that has ended

The album ran to exhaustion and autoplay continued for 33 minutes. `context.uri` **never
changed** — it reported `spotify:album:2knEuvsxqHMAoxlQpIdpQD` while playing Imminence, Bring Me
The Horizon, LaLion and NOTHING MORE, none of whom are on that album.

So the field stops describing what is playing once a context is exhausted. Recording
`context_type` per play (open item 7) is **necessary but not sufficient**: a rule written over
context would classify algorithmic recommendations as "album playback" — wrong, and wrong in the
direction that *hides* algorithmic placement, which is what R1 is about. An honest signal needs
something like "is the current track actually *in* the declared context", which the queue can
answer because each entry carries its album.

### Lookahead is deep and accurate, not merely present

A queue dump taken while `ZOMBIFIED` was playing (≈14:20) listed the next eight tracks. All eight
then played **in exactly that order** over the following 33 minutes, across the album → autoplay
boundary:

```
14:23 -> NO FEAR                        14:43 -> Can You Feel My Heart
14:26 -> Last Resort - Reimagined       14:47 -> Devil Himself
14:31 -> The Drug In Me Is Reimagined   14:50 -> Curse My Name
14:37 -> The Black                      14:52 -> Let 'em Burn
```

8 for 8. Where lookahead exists it offers minutes of runway — far more than the two MusicBrainz
calls behind a 1 req/sec queue that FR-36 exists to cover.

---

## Consequence for FR-36

FR-36 is a **Should**, so it can ship as "pre-warm where lookahead exists". But the emphasis in
`requirements.md` is now inverted:

> *"The resolution is to **pre-warm rather than wait** … FR-34/FR-35 remain the fallback for the
> cases pre-warming cannot cover — a manually chosen track, a context switch, an empty queue."*

The listener reports the DJ is **50–70% of listening**. The "fallback" is therefore the majority
path, not an edge case — and the rules that most need pre-warming are the label-based ones,
because a label lookup is two MusicBrainz calls behind a 1 req/sec queue. Those are also the rules
that bear on R1.

**Design consequence**: the app must *discover* lookahead availability at runtime, per context,
rather than assuming it. FR-36 degrades per-context, not globally. A design that treats
pre-warming as the normal path and FR-34/35 as an exception is built on an assumption this probe
disproves for the majority of real listening.

⚠️ **`context_type` is NULL on all 532 live plays** (open item 7), so the variable that decides
whether FR-36 can work is the one field the app never records. Open item 7 was filed as a deferred
*rule input*; it is a prerequisite for designing FR-36.

---

## ⚠️ The probe found something bigger than R11: `unattributed` skips are completions

Not what this probe was for, and it changes the outcome variable U5 arms rules on.

### What was observed

Four DJ transitions were watched live while the listener was deliberately **not** touching
playback (confirmed by the listener). Three of the four were recorded as `skipped`:

| Play | ratio | unplayed at close | recorded as |
|---|---|---|---|
| Full Bag | 0.887 | 18s | `skipped` / `unattributed` |
| Bad Company | 0.896 | 19s | `skipped` / `unattributed` |
| Enemy | 0.967 | 7s | `completed` |
| Murderer | 0.858 | 30s | `skipped` / `unattributed` |

**The listener reports hearing every track play to its end.** That rules out truncation, and the
stored data agrees: the same tracks reach 99–100% on other days, so `duration_ms` is not
overstated.

```
Full Bag     158s/159s = 0.994 completed  (26 Aug)
             158s/159s = 0.994 completed  (10 Sep)
             141s/159s = 0.887 skipped    (22 Sep)
Bad Company  181s, 183s, 183s  completed x3
             164s/183s = 0.896 skipped    (22 Sep)
```

The cut is a property of the **transition**, not of the track.

### The measurement

Reconstructed retroactively from retained observation trails (FR-20): a play's *first* observed
`progress_ms` is how far it had **already run** when the app first saw it.

| A closed as | n | A's unplayed remainder (median) | B's head start (median) | B already >2s in |
|---|---|---|---|---|
| `completed` | 455 | 2.0s | 2.0s | 38% |
| `user` skip | 22 | 145.0s | **2.0s** | **27%** |
| `unattributed` | 24 | 24.0s | **7.0s** | **75%** |
| `unknown` | 34 | 139.0s | 45.0s | 94% |

`user` and `unattributed` are **opposite shapes**. A user skip leaves 145s unplayed and the next
track starts from the beginning — a clean cut. An `unattributed` close leaves ~24s unplayed and
the successor is *already playing* in 75% of cases.

**The audio does not stop; the reporting does.** These are completions.

### The mechanism is the context, not a playback setting

Settings checked by the listener: **crossfade OFF**, gapless ON, **Automix ON**.

⚠️ Open item 4 ruled crossfade out on the grounds that *"the affected plays lose 21–41s and
Spotify caps crossfade at 12s"*. That argument fails twice over: the inference assumes *cut
length = crossfade length*, which holds only if the API switches at the **end** of a transition
(the data says it switches near the start) — **and crossfade is disabled on this machine**, so it
was never a candidate. The 12s figure is a UI fact used as though it were a probe result, which is
this project's most-documented failure mode.

The later runs are a natural experiment on the same question, because global settings did not
change across any of them. As recorded by the app itself, over one afternoon:

| Mode | plays | skipped | **unattributed** | shortfall median | max |
|---|---|---|---|---|---|
| **AI DJ** | 12 | 3 | **3** | **17.0s** | 176s |
| Album / autoplay | 20 | 0 | **0** | 1.0s | 27s |
| Radio station | 16 | 0 | **0** | 2.0s | 3s |

**36 non-DJ plays across two modes produced zero `unattributed` skips.** The probe's own
transition log agrees: 28 non-DJ transitions, none with the overlap signature, against 4 DJ
transitions of which 3 had it.

Automix is ON globally and does **not** produce the overlap on album, autoplay or radio playback.
The overlap is a property of the **DJ context**.

The DJ is the sole outlier on **both** dimensions — no queue, and overlapping transitions. Those
are plausibly one fact: a DJ that does not commit to a next track in advance cannot expose a
queue, and blends in real time instead. ⚠️ **That is a hypothesis, not a probed mechanism**, and
is recorded here only because it fits everything measured.

⚠️ **Recorded as *consistent with* Automix-style segues, not *caused by* them.** Whether Automix
is the mechanism was not probed, and asserting it from knowledge of the feature would repeat the
mistake this document just criticised.

### Honest limits

1. **n = 4 DJ transitions.** The non-DJ side is now well sampled — 28 transitions across two
   modes, 36 recorded plays, zero `unattributed` skips — but the positive side of the contrast
   still rests on a single 15-minute DJ session. The effect is large (2s vs 24s) and all 24
   corpus-wide `unattributed` skips share the signature; four DJ transitions is still four.
2. **Exploratory and computed after seeing the data.** Grounds for changing how U5 treats these
   rows; not a pre-registered result. **BR-11.7's confirmatory run is spent** and this does not
   re-open it.
3. **B's head start is partly poll cadence.** The 2.0s baseline on `completed` is the app's
   polling interval, not a real head start. The signal is 75% vs 27%; the medians do not line up
   one-to-one with the shortfalls.
4. The `unattributed` cluster runs 0.807–0.899 and stops dead at 0.90 **because that is where the
   classifier's label changes**. The phenomenon does not stop at 0.90; it stops being *visible*
   there.

### What this means for U5 — RESOLVED, not inherited

The U5 handoff said the outcome variable is "half noise" and that U5 must decide in writing
whether an `unattributed` skip counts as agreement. That framing was too generous: **24 of 46 live
skips were not noisy skips, they were mis-labelled completions.** A rule validated against them
would have been scored as agreeing with a rejection that never happened.

✅ **Fixed on 2026-09-22 rather than carried into U5.** Classifier v2 puts the tail rule in the
outcome, the 24 rows were re-derived from their retained trails (`skipped` -> `completed`), and
`skip_attribution` was retired because v2 subsumes it. Live skips: **46 -> 22, all the listener's**.

So **U5 handoff item 1 is closed**. `BackTestService` needed no change at all — it counts
`skipped` rows and never read attribution, so correcting the outcome corrected it for free. There
is no weighting decision left to make: the 22 remaining skips are the whole population of
rejections.

⚠️ **`skip_source` was NOT retired** and U5 still needs it: `user` vs `rule` is a different
question, and recording rule-initiated skips distinctly is a Phase 4 exit criterion.

---

## What was changed as a result (2026-09-22)

| | |
|---|---|
| `CLASSIFIER_VERSION` | 1 -> **2**, with a second completion path on `track-change` |
| `maxUnobservedTailMs` | **55 000 ms**. Derivation and the empty band in `outcomeClassifier` |
| `minObservedPositionRatio` | **0.75**. Raised from a proposed 0.50 after the test suite showed 0.50 would fabricate completions from genuine short-track skips |
| Rows re-derived | **24** of 576 live, all `skipped/unattributed` -> `completed`. 552 re-derived identical |
| `skip_attribution` | **Retired.** Column nulled (662 rows), kept in the schema for by-image rollback |
| `ended-early` display bucket | Removed from `playStats`, the repository, `TrackPlayStats` and the UI |
| `scripts/attribute-skips.mjs` | **Deleted** — it held a second copy of `USER_SKIP_RATIO_CEILING` and would re-derive the retired judgement |
| U1 FD Q6 short-track limitation | **Closed**, as a side effect rather than a goal |
| Tests | 851 passing, typecheck clean |

⚠️ **`Mascara` is knowingly left as `skipped`** — 136 s, 35 s tail, position 0.743. The single
ambiguous row: its tail is inside the overlap range but its position is below the rail. Leaving one
over-counted skip is recoverable from the trail; inventing a completion is not.

Backups: `data/backup-before-classifier-v2-<stamp>/` (with `classification-snapshot-before.csv`,
17 columns x 662 rows), `data/backup-before-reclassify-v2-<stamp>/` (with a `changes.json`
manifest), and `data/backup-before-attribution-retire-<stamp>/`.

---

## Two defects found along the way

### 1. `recordSuccessorLag` has zero callers

`SqliteHistoryRepository.ts:506` defines the writer; nothing in `src/`, `test/` or `scripts/`
calls it. `successor_lag_ms` is populated on **0 of 622 rows**.

The field designed to measure exactly the question above was built and never wired. It is
recoverable from trails (as done here), so no data was lost — but a column that is structurally
empty reads as "this never happens", which is the absent-data trap again.

⚠️ `noOrphanModules.test.ts` cannot catch this: it walks **modules**, not methods. The module is
imported and executed; one method inside it is dead.

### 2. The `USER_SKIP_RATIO_CEILING` empty band is no longer empty

`skipAttribution.ts:57` states:

> Measured over 35 live skips, nothing falls between 0.489 and 0.807 … **if plays ever appear in
> the gap, this constant stops being arbitrary and the question has to be reopened rather than the
> number nudged.**

At 46 live skips the distribution reads:

```
0.009U 0.009U 0.066U … 0.440U 0.488U 0.489U  0.743U  0.807- 0.822- 0.840- … 0.896- 0.899-
```

**A play has landed in the gap at 0.7426.** By the code's own instruction the question is
reopened. Flagged, not acted on — and explicitly not by moving 0.75.

---

## Also confirmed

- **Pause handling is correct.** A ~3-minute external pause (another app taking the audio
  session) was excluded from listened time: 204s listened against 362s of wall clock, ratio
  0.995, `ev_saw_pause = 1`. **Decision (listener, 2026-09-22): the *cause* of a pause is not
  tracked** — only that one occurred and that listened time excludes it. Do not add cause
  attribution later; it was considered and declined.
- `GET /me/player` returns `shuffle_state`, `smart_shuffle`, `repeat_state` and `device`, none of
  which the app currently records.
