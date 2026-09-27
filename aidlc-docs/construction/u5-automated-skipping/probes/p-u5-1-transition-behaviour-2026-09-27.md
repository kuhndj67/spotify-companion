# Probe P-U5-1 — does `POST /me/player/next` act on the player's state or the reported state?

**Run**: 2026-09-27, with the listener present. **Instrument**: the listener's ear, marked by keypress
against a 1 s API poll. **Result files**: `p-u5-1-driven.json`, `p-u5-1-marks-*.json` (4 sessions).

---

## ▶ THE ANSWER

> ### ⚠️ The hazard as the design plan framed it is **FALSE**. FR-46 needs no lag guard.
>
> **Audio follows the reported track-id flip within ~2 s in the worst context measured**, and
> essentially simultaneously in the others. A skip fired at the reported boundary cannot truncate
> more than about **2–3 seconds** of the outgoing track — not the 18–41 s the plan predicted.

And a second answer nobody asked for:

> ### ⚠️ Classifier v2's stated MECHANISM is wrong. Its FIX is right.
>
> `CLAUDE.md` says *"in the DJ context the API stops reporting a track 18–41 s before it stops
> playing."* It is the reverse: **the AI DJ stops PLAYING the track ~18–50 s before its nominal end,
> and the API reports that accurately.** There is no reporting lag. There is an edit.
>
> Everything v2 *did* stays correct — those plays are completions, and milliseconds of unobserved
> tail is the right axis. Only the explanation changes.

---

## 1. What was measured, and why the ear was required

Three independent timestamps per transition. None depends on anyone reacting *fast* — only
*consistently*, and human latency (~200–500 ms) is constant across marks.

| Signal | Source | Captured by |
|---|---|---|
| **Reported flip** | `GET /me/player/currently-playing` | polling at ~1.1 s |
| **Audio flip** | the listener's ear | listener pressing `a` |
| **UI flip** | the Spotify client's display | listener pressing `u` |
| **Transition type** | the listener's judgement | `c` crossfade · `h` hard cut · `t` DJ talking |

⚠️ **The obvious API-only check could not have answered this.** *"After the POST, is a different track
reported?"* is exactly the signal under suspicion. A confirmation guaranteed to pass is not a
confirmation.

### ⚠️ Derived quantity that did most of the work: `B@first`

**How far into the incoming track the API already was the first time it named it.** It needs no marks
at all, and it turned out to be the cleanest discriminator in the whole probe.

---

## 2. Results

| | **AI DJ** (n=8) | radio (n=3) | album (n=4) |
|---|---|---|---|
| reported tail | **1.4 – 50.9 s** | 0.0 – 0.7 s | 0.0 – 0.3 s |
| **`B@first`** | **0.6 – 23.6 s** | 0.0 – 0.7 s | 0.8 – 1.2 s |
| audio lag | +0.9 to +2.2 s | −0.3 to +0.5 s | −0.4 to −0.5 s |
| ui lag | ~−0.2 s | ~−0.2 s | ~−0.7 s |

**Radio and album are indistinguishable. The DJ is the sole outlier, on every measure.**

### DJ transitions are not one behaviour — they are at least three

| type | n | tail (median) | audio lag |
|---|---|---|---|
| hard-cut | 3 | 8.0 s | +0.9 s |
| crossfade | 3 | 25.1 s | +2.0 s |
| **dj-talk** | 2 | 1.6 s | **−6.9 s** |

⚠️ **`dj-talk` has a NEGATIVE audio lag** — the audio changes ~7 s *before* the API names the next
track, because the endpoint goes silent during commentary (§4). Nothing in the API says which type is
coming.

### Calibration

The poll runs at ~1.1 s, so a measured flip is up to 1.1 s **late**. Corrected: DJ audio lag ~2–3.3 s,
album/radio ~0–0.6 s. The conclusion is unaffected.

---

## 3. The mechanism — supplied by the user, and it unifies this probe with R11

⚠️ **"Algorithmic" is NOT the discriminator.** Radio is algorithmic and behaves exactly like an album.

The listener's observation: **radio's tracks are chosen ahead of time** — the full tracklist is shown,
as with an album — **while the DJ chooses as it goes.**

> ## The discriminator is **pre-determined vs produced-live**.

| | pre-determined | produced-live |
|---|---|---|
| Examples | album, radio, autoplay | **the AI DJ** |
| Transitions | sequential; API reports each change as it happens | **produced**: trimmed, crossfaded, commentary |
| `progress_ms` | accurate (`B@first` ≈ 1 s) | incoming track already running — it is being mixed |
| **Queue endpoint (R11)** | **exposes 7–20 tracks** | **exposes none, ever** |

✅ **This explains R11 with the same cause.** R11 found album, autoplay and radio expose a queue while
the DJ exposes none, and could not say why. A pre-determined list *can* be exposed; a mix composed
live has nothing to expose yet. **One mechanism, two findings.**

### ✅ So FR-46 needs no new signal

The **queue probe FR-36 already performs** discriminates the two regimes:

```
queue returns tracks  ->  pre-determined  ->  clean transitions, progress_ms trustworthy
queue is empty        ->  produced-live   ->  trimmed, pre-reported, progress_ms ahead
```

⚠️ And it sidesteps R11's blocker: **`context.type` cannot tell the DJ from a radio station** — both are
`type: playlist` with the `37i9dQZF1E` prefix, confirmed again here (`37i9dQZF1EYkqdzj48dyYq` DJ vs
`37i9dQZF1E4xunLN1DdaFF` radio). **The queue can.**

---

## 4. ⚠️ NEW API FACT — DJ commentary returns `200` with `item: null`

```
01:19:46.156  200  EoO  prog=202723
01:19:47.209  200  <- item is NULL
   ... 6.5-7.2s of 200-with-null ...
01:19:54.706  200  What You Want  prog=4250
```

**Not a 204 — a `200` with no track in the body.** Observed on 3 of 8 DJ transitions, 6.5–7.2 s.

⚠️ **Any code that reads `body.item` and infers "playback stopped" will mis-handle this**, and
`PlayObserver` takes its play boundary from exactly that state.

### ⚠️ An open question this raises about the LIVE path — not resolved here

The live path does not use this endpoint; it parses the MCP `getNowPlaying` **text** output
(`src/mcp/parseNowPlaying.ts`), where every field is `string | null`. So the shape of a commentary gap
on the live path is unknown, but the plausible outcome is `trackId: null` → read as *nothing playing*
→ `PlayObserver` closes the play on `pause-idle` / `playback-stopped`.

**If that is what happens, then in the DJ context a commentary gap CLOSES THE PLAY**, and because
`classify` returns `skipped` only on `closeReason === 'track-change'`, such plays fall through to
**`unknown`** — systematically, on roughly 3 of 8 DJ transitions.

⚠️ **That is a hypothesis, not a measurement.** It would mean a slice of the `unknown` population is
DJ commentary rather than instrument downtime, which matters to R2 and to open item 8. It is worth
probing on its own terms — the live path, not this endpoint — and **must not be asserted from this
probe**, which never observed the MCP surface. Noted so it is not lost, and so nobody concludes it
from the Web API evidence alone.

⚠️ Weak corroboration only: the one row the backfill wrote during this session carried
`close_reason: playback-stopped`. That is a *backfilled* row, so it says nothing about the live path.

---

## 5. FR-48 — the provisional confirmation is VALIDATED

The design plan's Q8 provisional was: confirm on `progress_ms` **resetting** *plus* a track-id change.

✅ **It holds.** In the live-skip trial the API reported the successor at `progress_ms 1472` immediately
after the `POST`, so the reset is real. And because audio follows the reported state within ~2–3 s, a
confirmation that passes means the audio *will* follow.

⚠️ **Allow ~3 s before judging a skip unconfirmed.** A check at +1.5 s can precede the audio.

---

## 6. ⚠️ Limits — what this probe does NOT establish

- **n is small**: 8 DJ transitions (3 crossfade, 3 hard-cut, 2 dj-talk), 3 radio, 4 album. Enough to
  separate ~2 s from ~25 s; **not** enough to characterise the distribution of DJ trim lengths.
- **One machine, one account, one evening.** Automix on, crossfade off (⚠️ see below).
- **Trim length is unmeasured as a distribution.** Observed 6.8–48.7 s implied, on 6 transitions.
- ⚠️ **`--context` was not passed on the mark runs** (added mid-session); context was supplied at
  analysis time instead. Correct here because one session is one context, but the raw files carry
  `declaredContext: null`.
- **Two album transitions went unmarked** (listener missed them). They still contribute tail and
  `B@first`, which come from the API, but not audio lag.

### ⚠️ Crossfade: the recorded setting was true and irrelevant

`CLAUDE.md` rules crossfade out partly because *"the feature was disabled"*. The listener confirms
crossfade **is** off in settings — **and the DJ crossfades anyway**, ~5 s, on 3 of 8 transitions.

**The setting was never the relevant fact in the DJ context**, which is the only context where the
anomaly appears. That argument has now failed a **third** time, and the reason recorded in CLAUDE.md is
wrong.

---

## 7. Pre-registered predictions and how they landed

Committed in `scripts/probe-p-u5-1-analyse.mjs` at `53f15ff`, **before** the repetitions were read.

| # | Prediction | Verdict |
|---|---|---|
| 1 | audio lag clusters ~5 s, roughly constant | ⚠️ **FAILED** — value wrong (~2 s not ~5 s) and `dj-talk` is *negative*. The shape held within type; the pooled claim did not |
| 2 | tail large, variable, independent of audio lag | ✅ HELD |
| 3 | implied trim ≫ 0 | ✅ HELD for the DJ (median 9.9 s), ≈0 for radio/album — the control direction |
| 4 | ui lag ≈ 0 | ✅ HELD — median −0.2 s. The UI moves with the API |
| 5 | ⚠️ **CONTROL** — album tail ≈ 0 | ✅ **HELD** — median 0.3 s vs DJ 8.0 s |

⚠️ **`impliedTrim = tail − audioLag` is invalid when audio lag is negative.** On a `dj-talk` row the
audio mark is A's *end* while the flip is B's *start*, with commentary between, so the subtraction
conflates two intervals and inflates the result. The 9.9 s on those rows is arithmetic, not
measurement.

---

## 8. Instrument failures, recorded because each nearly cost the result

| | Failure | Fix |
|---|---|---|
| 1 | Operator polled, then **asked** the listener what they heard. ⚠️ The round trip was slower than the effect — "I hear the new track" 12 s after an 8 s lag is consistent with a lag *and* with no lag | The listener marks by keypress; correlate afterwards |
| 2 | Read the reported tail as if it were a lag. ⚠️ **A tail is not a lag** — an 8.3 s tail sounded perfectly natural on video | Measure the audio separately |
| 3 | ⚠️ Marks went to the **Spotify window, where SPACE is play/pause**, stopping the music instead of recording | `a` is the key; banner explains focus vs visibility; script watches `is_playing` and reports a probable leaked mark |
| 4 | ⚠️ Flip detection required two consecutive samples with a track, so **commentary-gap transitions were invisible** — absent data reading as "no transition happened" | Track `lastWithTrack`; record `nullGapMs` |
| 5 | ⚠️ Context inferred from `context.uri` containing `37i9dQZF1E` — **which radio also matches**. R11's own finding reproduced as a defect in the tool built to test it | `--context` is declared; the analyser prints `dj-or-radio?` rather than guess |
| 6 | ⚠️ A **manual context switch** was pooled as a transition. One 149 s row moved the radio mean tail from 0.4 s to **37.6 s** — a context change reading as a finding | Auto-excluded on tail > 60 s with no marks, or a changed context uri; exclusion printed, never silent |
| 7 | ⚠️ Verdicts hardcoded to say "DJ", so a control run printed *"FAILED — audio the DJ never played"* when trim ≈ 0 is the account **confirmed** | Verdicts name the declared context and state that 1–3 were pre-registered about the DJ |
| 8 | ⚠️ The analyser computed **pooled medians** across DJ transitions while its own header carried R11's *"do not average a context-dependent answer"* warning | Groups by declared type and never pools; verdict block points at the by-type table |

**Two of these (4 and 5) were the project's own recurring traps**: absent data reading as a negative
finding, and a recorded fact about context indistinguishability being ignored by the next thing built.

---

## 9. Consequences for U5

| | |
|---|---|
| **FR-46** | ✅ No lag guard needed. The action point may fire on the reported boundary |
| **FR-48** | ✅ Provisional confirmation validated — `progress_ms` reset **+** track-id change. ⚠️ Allow ~3 s |
| **BR-43** | Can now be written rather than deferred |
| **FR-36** | ✅ Strengthened: the queue probe is also the **transition-regime** discriminator |
| **Open item 7** | `context_type` stays **evidence only** (Q9). ⚠️ It cannot discriminate the regimes — the queue must |
| **CLAUDE.md** | ⚠️ Two corrections: the classifier-v2 mechanism statement, and the crossfade argument |
| **Classifier v2** | ⚠️ **Fix stands, explanation changes.** No re-derivation needed — `maxUnobservedTailMs` thresholds the right quantity for the wrong stated reason |
