# RESUME HERE — U5, paused mid-Functional-Design

**Written 2026-09-23, end of session.** Nothing is half-finished in code; this is a *decision*
pause, not a build pause.

> **Read this, then `../../plans/u5-functional-design-plan.md`.** This file exists because the
> previous session ended on an unexpected reboot and the context was nearly lost. It is written to
> be read cold, by someone with none of this in their head.

---

## The one-line state

**U5 Functional Design plan is written and waiting on answers to 9 questions. Nothing is blocked
except by those answers — and one of them needs a live probe that requires the user present and
listening.**

Working tree at pause: **documentation only**. `src/` untouched, no migration, no schema change,
container healthy and recording. `git status src/` should be clean — **if it is not, something was
started that this file does not know about.**

---

## ▶ THE RECOMMENDED NEXT STEP

**Run probe P-U5-1.** It is the gate on FR-46, it needs about fifteen minutes, and **it cannot be
run unattended** — the instrument is the user's ear, not an endpoint.

Everything else in U5 can proceed in any order. This one is first because *designing FR-46 before
knowing the answer risks designing the wrong thing entirely*, which is precisely what R11 taught:
the answer there was "it depends on the context", which neither branch of the execution plan had
anticipated.

### Why P-U5-1 exists — the hazard, in full

Classifier v2 (2026-09-22) established that **in the AI DJ context the Spotify API stops reporting
a track 18–41 s before it stops playing.** The listener hears track A finish; the API already says
track B.

`EvaluationCoordinator` takes its play boundary from `PlayObserver`, which consumes `tick` — that
is, **the API's reported state.** So:

```
t+0s     API reports B.  A is still audible for another 18-41s.
t+0s     EvaluationCoordinator opens a decision for B.
t+~10s   ENRICHMENT_WAIT_MS elapses.  A rule matches B.  SkipExecutor fires.
         -> POST /me/player/next acts on the PLAYER's real state... which is still A.
```

**If the player's state is the real one, the skip truncates A** — a track the listener was enjoying
and the rules did not match — **and B then plays in full, unskipped.** The rule fails at its job
*and* causes the exact harm U5 exists to avoid, in the context used **50–70%** of the time.

⚠️ **Every step of that chain is established except the last one.** Whether
`POST /me/player/next` acts on the player's real state or on the same lagged state the read
endpoints report is **not inferable from anything we have**. If the lag lives in Spotify's
*reporting* rather than its *state store*, the skip lands on B and there is no problem at all.

**Do not resolve this by reasoning.** That is the project's single most important working rule, and
it has been vindicated six times.

### The protocol

**Preconditions**
- The user is at the machine, listening, and can report what they *hear*.
- Playback is confirmed in the **AI DJ** context (`spotify:playlist:37i9dQZF1EYkqdzj48dyYq` was the
  URI in the R11 probe; ⚠️ **verify it rather than assuming — a recorded negative decays**).
- The container may stay **up**. This probe does not write to `history.db`.

**Per trial**
1. Poll `GET /me/player/currently-playing` until the reported track id **changes** (A → B). Note the
   wall-clock instant and both track ids.
2. **Immediately** issue `POST /me/player/next`.
3. Record, within a few seconds:
   - what the API now reports (`currently-playing`: track id and `progress_ms`);
   - **what the user says they HEARD** — did the audio cut mid-track, and was the track that got cut
     the one they had been hearing (A), or had B genuinely started?
4. Wait for playback to settle before the next trial.

**Read the result this way**

| What the user heard | What it means |
|---|---|
| Audio cut a track that had been playing a while, then B started | **Hazard is REAL.** The player's state is A. FR-46 must not act on a fresh `track-change` in the DJ context without a guard |
| B had already started audibly, and B got cut | **Hazard is NOT real.** Reported state and player state agree; FR-46 as designed is safe |
| Mixed across trials | Report it as mixed. ⚠️ **Do not average it into a conclusion** — a context-dependent answer is exactly what R11 found |

**Trials**: 4–6 is enough to distinguish these. ⚠️ **Run a positive control**, as R11 did — repeat
2 trials during **album** playback, where no reporting lag is known. If the album trials behave
differently from the DJ trials, that difference *is* the finding. Without the control, an ambiguous
DJ result is unusable.

⚠️ **The probe script is deliberately NOT yet written.** It issues a real write against live
playback, and the shape of that write is one of the things U5 has not yet decided. Write it at the
start of the probe session, with the user present.

---

## The second thing to decide: open item 7 (`context_type` live)

`context_type` is **NULL on all 577 live plays** — populated only on backfilled rows. It comes from
`GET /me/player/currently-playing`, not from the MCP `getNowPlaying` the poll loop uses.

**The user declined this on 2026-09-02**, when it was a standalone enrichment. **It is now
load-bearing for a safety question** — the §3 hazard is context-specific, and it cannot even be
*measured* while the field is NULL. That is a different trade from the one declined, which is why
it is re-raised rather than quietly assumed.

⚠️ **`context.uri` goes stale** — it named an album through 33 minutes of autoplay by other artists.
So recording it is **necessary but not sufficient**, and a rule written over it would classify
algorithmic placement as album playback: wrong, in the direction that *hides* what R1 is about.
The plan's recommendation is to record it **as evidence only**, no rule field in U5.

---

## What was settled this session, so it is not re-litigated

✅ **U5 handoff item 1 is CLOSED, not inherited.** The handoff's "most important thing on the page"
warned that `BackTestService` counted 22 user + 21 `unattributed` skips. Classifier v2 fixed the
**outcome itself** the same day, and `BackTestService` reads `outcome` — it never read attribution.
**All 22 remaining skips are the listener's.**

⚠️ **But the evidence base got smaller, not cleaner-and-bigger.** 22 events is everything there is
for validating a rule before arming it. The 2026-09-10 gate's n=17 precedent says what that can and
cannot decide — it catches a wildly wrong rule and cannot separate a good one from a mediocre one.
That is **Q1**, and the plan recommends **(C)**: back-test as an advisory number, dry-run as the
actual gate.

**Corpus facts measured 2026-09-23** (read-only, container up) — do not re-derive:

| | |
|---|---|
| Plays | 664 (577 live, 87 backfilled) |
| `completed` / `skipped` / `unknown` | 518 / **22** / 124 |
| All 22 skips | `skip_source = 'user'` |
| Longest consecutive user-skip run | **2** (18 runs of 1, 2 runs of 2) |
| Play rate over 47 active hours | median **12/hr**, p90 21, max 25 |
| `context_type` on live plays | **NULL, all 577** |

These are the basis for the FR-39 recommendations: **halt at 3 consecutive** (one above anything
the user has ever done) and **10 skips/hour**.

---

## Also recorded this session, unrelated to U5

**Wishlist W-4** — artist-credit ambiguity. Noted, **not built**, by user decision.

⚠️ **`Inpatient` IS A REAL ARTIST.** It looked like a track name in `Inpatient, Ren, Chris Webby`.
It is not: `GET /artists/5Qqx3JIJnK5mtk7U4tC4Vb` → 200, and its entire discography is 10 releases,
every one `Inpatient | Ren | Chris Webby`. The album is *Asylum*; *Asylum* is track 6. **Do not
"fix" the comma-splitter on that example — the split is exact there.**

The real issues, both deferred: group aliases rank as independent artists in the reporting DB
(`Inpatient` at rank 8, `Macklemore & Ryan Lewis` at rank 12), and a `", "` **inside** an artist
name would split silently (`Tyler, The Creator`). Neither is a rule or gate input; both are confined
to the derived reporting database. See `requirements.md` §5.1 W-4 and `audit.md` 2026-09-23.

---

## Standing hazards — still true, check before touching anything

- **`docker compose down` before ANY writer to `history.db`.** A maintenance script is a writer.
  This corrupted the index during U4, reported `integrity_check: ok` at the time, and surfaced later
  as a just-written value reading `null`. ⚠️ `VACUUM INTO` does **not** repair it.
- **Never run the container and `npm start` together.** Assume the container is running.
- **Back up `data/` before migration 007.**
- **The app is `http://localhost:3010`.** `localhost:3000` is a different project.
- **Check exit codes directly** — a pipe reports the pipe's status, not the command's.
