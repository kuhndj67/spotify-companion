# CLAUDE.md — orientation for a new session

Read this first, then `aidlc-docs/aidlc-state.md`, which is the authoritative current state.

---

## What this project is

A **local, single-user Spotify companion**. It displays what is playing, enriches it, records
every play, and will eventually filter the stream using user-authored rules.

**It is not a now-playing display with extras.** Its actual purpose:

> Estimate the likelihood that a track was **promoted** into the feed rather than selected because
> it fits the user's profile — on the hypothesis that signed-artist placements are
> disproportionately paid promotion, and therefore likelier to be disliked.

Signed-vs-independent is a **proxy variable**, not an end in itself. The app is a data collection
instrument first; analysis happens in external tools.

**That hypothesis is unproven (R1).** Treat it as something to be tested, not assumed. The design
is deliberately built so it can be *disconfirmed*.

---

## Method: AI-DLC

This project follows the AI-DLC workflow. Rules live outside the repo at
`D:/Software/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/`.

Stages gate on user approval. `aidlc-docs/audit.md` is an append-only decision log — **read the
last few entries to understand recent context**; it records not just what was decided but why, and
what was rejected.

| Document | Purpose |
|---|---|
| `aidlc-docs/aidlc-state.md` | **Current state. Start here.** |
| `aidlc-docs/audit.md` | Append-only history of decisions and findings |
| `aidlc-docs/inception/requirements/requirements.md` | 56 FRs, 27 NFRs, risks, wishlist |
| `aidlc-docs/inception/research/research-findings.md` | **Live API probe results — authoritative** |
| `aidlc-docs/inception/user-stories/` | 27 stories, 3 personas |
| `aidlc-docs/inception/plans/execution-plan.md` | The four delivery phases |
| `aidlc-docs/inception/application-design/` | Components, methods, units |
| `aidlc-docs/construction/` | Per-unit design, code summaries, build-and-test |

---

## The single most important working rule

> **Probe the live API. Do not reason from documentation.**

Spotify's Development Mode has been restricted twice since 2024, and the docs do not reflect it.
This project has drawn wrong conclusions from documentation **six times**, each caught only by a
live probe:

- `GET /me/following/contains` → **403** despite a valid scope
- `GET /artists/{id}` → returns **no `genres` field at all**
- `GET /me/tracks/contains` → **403**, while `GET /me/tracks` works
- MusicBrainz `GET /ws/2/isrc/{id}?inc=releases` → **200 with the `inc` silently ignored**
- `GET /tracks?ids=` → **403**, while `GET /tracks/{id}` works — confirmed with a batch of a
  *single* id, which rules out payload size and rate limiting
- `GET /artists/{id}/albums?limit=20` → **400 `"Invalid limit"`**; `limit=10` works, and the
  documented maximum of 50 fails too. `album_group` is **absent** from the items

**Pattern (Spotify)**: Development Mode blocks the `/contains` membership-check family and the
"several items at once" endpoints, while leaving the single-item and list endpoints open.
Workaround is always the same — fetch the set once, cache it, resolve locally. ⚠️ **The 400 is the
nastiest of the family**: `"Invalid limit"` reads as *your query string is malformed*, so it sends
you auditing your own code instead of suspecting the sandbox. A restriction that misnames itself
costs more than one that returns 403.

⚠️ **The fourth one is the dangerous shape.** The first three failed loudly. MusicBrainz returned
**200 and plausible-looking data** — 19 ISRCs that appeared to have no releases at all. It read as
a coverage finding, not a bug, and was caught only by checking a track *known* to have 44 releases.
**A wrong request shape is indistinguishable from absent data.** When a probe says "no data",
verify against a case where you know what the answer must be.

Credentials are at `secrets/spotify-config.json`; probe scripts follow the pattern in
`research-findings.md`.

---

## ▶ Current state (2026-09-26) — U5 DESIGN QUESTIONS ALL ANSWERED, PAUSED ON ONE PROBE

**Read [`aidlc-docs/construction/u5-automated-skipping/HANDOFF.md`](aidlc-docs/construction/u5-automated-skipping/HANDOFF.md) before anything else** — U5's single entry point; the current state is its top block.
✅ **All 9 Functional Design questions are answered.** The authoritative reading is
[**`u5-functional-design-plan.md` §5.1**](aidlc-docs/construction/plans/u5-functional-design-plan.md) — not the raw answers in §5.
**The next step is probe P-U5-1**, which needs the user present and listening, because the instrument
is their ear. It is now the **only** thing blocking the FD documents.

⚠️ **It gates FR-46 AND FR-48.** In the DJ context the API reports track B while A is still audible
for 18–41 s, and the evaluator takes its play boundary from that reported state — so a rule matching
B may fire `POST /me/player/next` against a player still on A, **truncating an unmatched track** and
letting B play unskipped. Every step of that is established **except** whether the lag is in
Spotify's reporting or its state store. **Probe it; do not reason about it.**

⚠️ **Reviewing logged skip behaviour is NOT a substitute for the probe** (Q8, 2026-09-26). The
obvious confirmation — *"is a different track reported now?"* — **is the signal under suspicion**, so
the review would measure the suspect effect with the suspect instrument and get a plausible answer
that means nothing. The `inc=releases` 200 a third time.

✅ **Two `requirements.md` amendments were approved and APPLIED 2026-09-26** (§5.2 of the plan):
- **FR-40 amended.** *"Never skip the same track twice within one session"* is **withdrawn** — it
  would refuse a genuine repeat listen for ever, which is the same mistake as clamping
  `completionRatio` to 1.0. Replaced by **one skip attempt per PLAY ROW**, never per `track_id`: a
  repeat listen is a new row so it stays skippable, while a skip that did not land cannot re-fire.
  ⚠️ **It needs no definition of "session" at all**, which the corpus has never modelled — requiring
  one was the withdrawn clause's hidden cost.
- **R11's caveats discharged** — §FR-36's *"Verify against active playback"* and the R11 risk row's
  *"unconfirmed during active playback"* had read as open since **2026-09-22**.

Documentation-only pause: `src/` untouched, no migration, container healthy.

## Earlier state (2026-09-22)

**U5 STARTED. R11 DISCHARGED. THE OUTCOME VARIABLE WAS WRONG AND IS FIXED.**
851 tests · typecheck clean · schema v6 · **662 plays** · `src/playback/` still absent.

**R11 — queue lookahead depends on the playback context**, which is neither outcome the execution
plan anticipated. Album, autoplay and radio expose 20 tracks and predict correctly (8 for 8, in
order, across a context boundary). **The AI DJ exposes none, ever** — 0 on all 88 samples,
including at track boundaries. ⚠️ **`context.type` cannot tell them apart**: the DJ and a radio
station are both `type: playlist` with the same `37i9dQZF1E` prefix. Nor is "algorithmic" the
discriminator — autoplay and radio are algorithmic and fully exposed. **So FR-36 must ask the queue
at runtime**, and at 50–70% DJ listening **FR-34/35 is the majority path, not the fallback**
`requirements.md` calls it. ⚠️ `context.uri` also **goes stale** — it kept naming an album through
33 minutes of autoplay by other artists, so open item 7's `context_type` is necessary but not
sufficient. Record:
`aidlc-docs/construction/u5-automated-skipping/probes/r11-queue-lookahead-2026-09-22.md`.

### 🔧 24 of 46 live skips were NOT SKIPS — classifier v2, applied retroactively

**In the DJ context the API stops reporting a track ~18–41 s before it stops playing.** The play
closed on `track-change` at 81–90% and v1 called it `skipped`; the listener heard every one finish.
Three independent lines agree: the same tracks reach 99–100% on other days (so `duration_ms` is not
overstated), the successor was already playing in 75% of cases against 27% for real skips, and a
natural experiment with unchanged settings gave DJ 3 of 12 skipped, album **0 of 20**, radio
**0 of 16**.

⚠️ **A RATIO CANNOT EXPRESS THIS, AND IT IS THIS FILE'S OWN CONFOUND WARNING.** The effect removes a
near-constant number of seconds; a ratio divides by duration. `ratio < 0.75` whenever
`duration < 4 x tail` — at a 41 s tail every track under 164 s is misfiled, and the corpus's p10
duration is 146 s. So v2 thresholds **milliseconds of unobserved tail** (`durationMs -
maxProgressMs`): `maxUnobservedTailMs = 55_000`, with a `minObservedPositionRatio = 0.75` rail.
The tail populations have an **empty band** — overlap closes 18–41 s, user skips 66 s+ — and any
value in 42–65 s partitions the corpus identically. ⚠️ Chosen **after** seeing the distribution, so
**not pre-registered**; if plays land in the 41–66 s band the question reopens rather than the
number moving.

24 rows re-derived `skipped` -> `completed`, **552 re-derived identical**, live skips **46 -> 22**.

✅ **`skip_attribution` is RETIRED** — v2 subsumes it, and the two rules could contradict each other
(a 5:00 track skipped at 4:00 is `skipped` by tail and `unattributed` by ratio; 0 rows were in that
state, but 31% of tracks are long enough). The column is **nulled, not dropped**, because dropping
it breaks by-image rollback. `skipAttribution.ts` is a tombstone carrying the history.
✅ **U5 handoff item 1 is CLOSED, not inherited** — `BackTestService` reads `outcome` and never read
attribution, so fixing the outcome fixed it for free. **`skip_source` (`user` | `rule`) is
untouched and is still what U5 needs.**

⚠️ **The 2026-09-10 gate ran with those 24 rows counted as skips** — roughly 12 of its 17. **BR-11.7
still forbids a re-run.** Recorded as a defect in the discharged result, not grounds for another
attempt.

## Earlier state (2026-09-10)

**INCEPTION complete. CONSTRUCTION in progress — U2 of 5 units approved. Next: U3.**
**The Phase 2 hypothesis gate was discharged 2026-09-10: R1 NOT SUPPORTED. U3 is unblocked.**

| Unit | Phase | Status |
|---|---|---|
| U0 Display + enrichment | 0 | ✅ Delivered |
| **U1 Listening history + export** | 1 | ✅ **Built, tested, live-verified** |
| **U2 Label enrichment** | 2 | ✅ **Approved 2026-09-05** |
| **U3 Rule model (pure core)** | 3 | ✅ **Built — 620 tests, not wired to anything** |
| U4 Rule observability | 3 | Pending |
| U5 Automated skipping | 4 | Pending |

620 tests passing · 99.19% line · 92.86% branch · typecheck clean · **427 plays recorded**
· schema v4. The `played_at` duplicates were repaired 2026-09-06 — 84 rows re-timed, 41 deleted,
`integrity_check: ok`, all 65 live trails intact. Backup kept in `data/`.

### 🔒 THE HYPOTHESIS GATE IS DISCHARGED — **R1 IS NOT SUPPORTED** (confirmatory, 2026-09-10)

Pre-registration committed at `fd09ad7`, **five days and 240 plays before** the comparison was
computed. Result in `construction/u2-label-enrichment/hypothesis-gate/gate-result-2026-09-10.md`.
BR-11.6a was met for the first time on this run, so under **BR-11.7 this was the single
confirmatory evaluation. It has been spent.**

| Group | n | skipped | skip rate |
|---|---|---|---|
| `major` | 76 | 7 | **9.2%** |
| `independent` | 116 | 10 | **8.6%** |
| `unknown` (BR-11.2) | 125 | 13 | 10.4% |

**+0.6pp · 95% CI [−7.7%, +8.9%] · p = 0.888 · not significant.**

> ⚠️ **NOT SUPPORTED is not DISPROVEN.** The CI rules out about ±8pp — roughly 2× against a ~9%
> baseline — and **nothing smaller**. An effect of 8.6% vs 12% is fully compatible with this result
> and would need several hundred plays per group to see. The pre-registration said in advance that
> this instrument finds a strong effect or nothing.
>
> ⚠️ **Do not re-run the gate hoping for a different answer.** BR-11.7 forbids exactly that; any
> further run is **exploratory** and cannot discharge the gate. The script will happily print a new
> number — that is not permission to treat it as one.
>
> **This does not gate U3**, and that instruction was written *before* the result. Rules are
> user-authored; they must be valuable without R1. Label enrichment stays a legitimate rule input —
> just not one backed by evidence that it predicts this listener's skips.

⚠️ **Open item 4 rides along with the result — and its stated direction was WITHDRAWN 2026-09-22.**
12 of the 30 skips sat at ratio 0.80–0.90. This used to say the confound inflates the *independent*
skip rate, so correcting it *"could only move the result toward R1, never further away"*.
**That is not supported.** Those plays are now labelled `skip_attribution = 'unattributed'`, and
they are **67% of major skips but only 50% of independent** — so the correction removes
proportionally more from the *major* group. ⚠️ Roughly **half the gate's skips are now known not
to be rejections**, which weakens the outcome variable in both arms rather than shifting it one
way. Retroactively correctable — trails are retained.

⚠️ **Open item 3b is UNSETTLED AGAIN.** Label coverage came in pre-2022 **56%** / 2022+ **60%** —
the recency bias measured twice before (86%→44%, 100%→43%) has closed and mildly inverted on the
larger corpus. Both earlier numbers were small-sample. Do not cite them as confirmed.

⚠️ **The runner had no significance test until this run.** Earlier revisions stopped at the
sufficiency check because the answer was fixed at "insufficient data". The §2 test was added
**after** the group rates were visible — thresholds, eligibility and grouping untouched, and the
formula has no free parameters. Recorded in the result doc and `audit.md` rather than hidden.

### ⏸️ U3 was paused to collect data (user, 2026-09-05) — that reason is now spent

The pause existed so the gate could reach its minimum. **It has.** U3 is the next unit, and the
app should keep running regardless: it runs **unattended in a container** on Rancher Desktop
autostart (`application.autoStart` + `startInBackground`, plus `restart: unless-stopped`), so the
chain is Windows login → Rancher Desktop → dockerd → app. **Recording does not need the UI** — the
poll loop is a server-side timer, not something a browser drives.

### ✅ The autostart chain is PROVEN — reboot test passed 2026-09-05

`scripts/post-boot-check.ps1` ran after a real reboot and every check passed: Rancher Desktop and
dockerd came up on their own, and the container **started 82s after the host boot clock, by
itself**. UI `200`, cross-site Origin `403`, `integrity_check: ok`, WAL over the bind mount intact
through a power cycle. The baseline file is gone and the question is closed; the script is kept
because it is the cheapest way to re-check the chain after any Rancher Desktop upgrade. It now
also probes the **WebSocket handshake** in both directions — that surface was its blind spot, and
a `200` on `/` does not imply the live display works.

⚠️ **`unless-stopped` does not restart a container that was explicitly stopped.** If someone ran
`docker stop`, the container will stay down through a reboot and that is *correct* behaviour, not
a failure of the chain — the script says so rather than reporting a false negative.

⚠️ **The app is on `http://localhost:3010`, and `localhost:3000` is a DIFFERENT app.**
`opencodetest-frontend` holds host port 3000. Opening 3000 after a reboot shows something that is
also running, which reads as "the wrong thing started" rather than "wrong URL". This has already
caused one false alarm.

### 📊 Listening statistics panel added 2026-09-06

Per-track play count split by outcome, plus a weekly stacked trend for the primary artist —
adaptive, capped at 26 weeks and anchored on the **corpus** first play so every artist's chart
shares one axis. `GET /api/history/stats?trackId=&artistId=` is read-only and makes **zero**
upstream requests, like `/api/explain`. No migration: `idx_play_track` (v1) and
`idx_play_artist_id` (v2) already cover both queries.

`unknown` is drawn as a hatched neutral, never as a third outcome — 116 of the first 163 plays are
backfilled and have no observation trail, so summing them into `completed` or `skipped` would
assert a judgement the data does not contain. See the two warnings below on artist attribution and
week bucketing before changing anything here.

### ♥ Liked indicator and label-detail fix — 2026-09-06

The liked badge beside the track title is a **button**, and that is not decoration. The saved-track
set is refreshed at startup and then on the **6-hourly** backfill tick (`ensureFresh` hangs off
that timer, not off its own 15-minute TTL), so a `No` can be hours old — and the moment that
matters is right after someone likes a track. `GET /me/tracks/contains` is **403** in Development
Mode, so there is no single-track check to fall back on; clicking re-reads the whole list
(`POST /api/liked/refresh`). Nothing polls it: ~12 requests on a timer to keep a badge warm would
spend rate limit that label resolution needs. The badge's tooltip carries the age of its answer.

⚠️ **The artist-level LABEL verdict is gone (2026-09-06) — see the warning below.** `Label
detail` now renders one level, the release, and `Genres` is what the artist level is for.

⚠️ **`Label detail` looked dead and was not.** It renders the label *names* behind a verdict, and
36 of 177 plays have them; it is empty ~80% of the time because **MusicBrainz coverage on recent
releases is ~44%** (open item 3b). It used to render a bare `—`, which is indistinguishable from a
broken field, and was nearly deleted on that basis. It now says `not yet resolved` or `MusicBrainz
lists no label`. **An empty state that does not explain itself will eventually be removed by
someone who assumes it is broken.**

`artistNames` had been broadcast by the server and silently dropped by the client since U2. Both
levels rendered from 2026-09-06 — and the artist level was removed the same day, because rendering
it is what revealed it was wrong. **Q12 is withdrawn, not amended.**

### Phases are sequenced by risk containment

The rules engine (U3/U4) is the largest, least-certain component; playback control (U5) is the
only part that can cause harm. **They are deliberately in different phases**, so the risky
component ships where being wrong costs nothing and is validated by back-testing before it is
armed. Do not collapse that.

---

## Non-obvious things that will bite you

**`PlayObserver` must consume `tick`, never `change`.** `change` is signature-suppressed and the
signature excludes progress. Feeding the observer from it yields sparse trails and
plausible-but-wrong verdicts, silently. There is an integration test pinning this.

**Pure modules import nothing impure.** `outcomeClassifier`, `serialisers`, `types`,
`parseNowPlaying`. A `Date.now()` in the classifier breaks FR-20 and FR-42 **while every other test
passes**. `test/purity.test.ts` is the only thing that catches it.

**Never clamp `completionRatio` to 1.0.** It measures *listened time*, so replaying a track
legitimately exceeds 1.0. Clamping looks like hygiene and destroys the repeat-listen signal.

**`null` means unknown and is never `false` or `0`.** End to end, including exports, where unknown
renders as the literal token `unknown`. Missing data here correlates with what is being measured
(R2), so a blank cell hides a bias instead of showing it.

**Store observations; derive judgements.** Trails are retained so verdicts can be recomputed
(FR-20). This has already paid off — see the threshold finding in
`construction/u1-listening-history/live-verification.md`.

**`error` is not `unknown`, and a transient failure must never become permanent.** Three separate
U2 defects were all this same mistake, and **all three passed the full test suite** — they were
only found by running the system and watching a real failure get *recorded*. A fixture failure is
deterministic; it never shows you that the row is never retried. Anywhere a failure is written
down, ask whether it can be un-written.

**A proportional threshold over a constant-time effect is a confound generator — and on
2026-09-22 this stopped being a warning and became a measured defect.** The completion ratio
divides by track duration, so anything that removes a fixed number of seconds costs a short track
more ratio than a long one.

The DJ removes 18–41 s of *reporting* (not of playback). Expressed as a ratio,
`ratio < 0.75` whenever `duration < 4 x tail` — at a 41 s tail **every track under 164 s reads as a
user skip**, and the corpus's p10 duration is 146 s. `Mascara` is the proof: 136 s long, 35 s tail,
ratio 0.743, filed as a rejection purely for being short. **No ratio separates a constant-time
effect across a 146–271 s duration spread**, so widening the threshold cannot fix it.

✅ **The fix was to change the axis, not the number.** Classifier v2 thresholds `durationMs -
maxProgressMs` in **milliseconds** (`maxUnobservedTailMs = 55_000`), with a ratio only as a rail
for short tracks (`minObservedPositionRatio = 0.75`). Anywhere a rate or ratio is thresholded, ask
first whether the effect being detected is proportional or constant-time; if it is constant-time,
the ratio is the wrong instrument however it is tuned.

**A wrong denominator is as indistinguishable from absent data as a wrong request shape.** Caught
on 2026-09-05 in the hypothesis gate's own coverage table: it averaged *two different causes* of a
missing label — "no ISRC", a Spotify artefact affecting every backfilled play, and "MusicBrainz has
no label", the actual R2 measure. Because the backfill skews recent, the conflated number read
**28% → 12%** where the truth is **86% → 44%**. It would have been recorded as a coverage collapse
and believed, because it looks like a finding, not a bug. **Before reporting any rate, ask what is
in the denominator and whether every row in it could have been a success.** Same family as the
`inc=releases` 200 — it is the *plausible* wrong answers that get written down.

**SQLite WAL over the Rancher Desktop bind mount works — probed 2026-09-05, don't re-derive it.**
The general advice is that WAL is unsafe on network/virtualised filesystems, because it needs
shared-memory mapping. That advice would have blocked container deployment of the one artefact
that cannot be regenerated. Probed on both C: and D: in a real container: `journal_mode -> wal`,
200 rows written, `wal_checkpoint(TRUNCATE)` clean, reopened and read back. Live since:
`integrity_check: ok` with the container as the writer. **Documentation said no; the probe said
yes.** If this ever needs revisiting, re-probe rather than reasoning.

**`unknown` is TWO facts, and merging them makes the app's downtime look like your listening.**
A backfilled play is `unknown` because the app was not running -- `recently-played` reports no
progress, so there is no trail and never can be. A live play is `unknown` because the app watched
and could not classify. The chart stacked both into one bar until 2026-09-06, and completion read
as **38% of the corpus where it was 74% of what was actually measured**: the app has only ever
*run* on 3 of the corpus's 17 days. Split into `inconclusive` and `not-observed`, decided by
`bucketOf` in `playStats.ts`, where **provenance decides first**. Do not "fix" a future version
of this by filtering backfilled rows out -- their volume is real information about the corpus,
and R2 depends on it being visible.

**`not-observed` is COUNTED EVERYWHERE AND DRAWN NOWHERE, and that asymmetry is deliberate.**
It stopped being a fourth bar on the weekly trend on 2026-09-06 — 84 of 187 plays are backfilled
across seven days the app never ran, so as a series it filled every artist's chart with the
*instrument's downtime*. It is still reported in the note under the legend, the hover tooltip, the
table column and the track panel's breakdown. **Do not tidy it out of those too**: a reader who
sees `Times played 6 · 1 completed` with no fourth number will take it for six observed listens,
which is the 2026-09-06 merge defect wearing a different hat. The chart answers *what did the app
measure*; the numbers beside it answer *how much did it miss*, and R2 needs the second question to
stay askable.

⚠️ **The trend's y-axis scales to the DRAWN total, never `week.total`.** `week.total` still counts
the undrawn `not-observed` plays, so scaling to it shrinks every bar against an axis whose height
comes from columns that are not on the page — a week of 8 observed plays rendering at a third of a
week that was 24 unobserved, for a reason nothing on screen explains.

⚠️ **An artist whose every play is backfilled has a drawn max of zero, and that is NOT "first time
hearing this artist".** Same family as the `Label detail` dash: an empty state that does not
explain itself gets read as broken, or as the wrong fact. It says `N plays, none observed — the app
was not running.`

**Play rows are never deleted to tidy the display, and the backfilled ones least of all.** Asked on
2026-09-06 whether the `not recorded` rows could be marked `completed` or else removed: neither.
Marking them completed is fabrication that reaches R1 — the gate's `ELIGIBLE` predicate is
`outcome IN ('completed','skipped')` with **no provenance guard**, so the moment open item 3
recovers their ISRCs, 84 rows that are completions *by construction* enter the hypothesis test with
zero skips against a live-measured 12% skip rate. Deleting them is worse: **seven of the corpus's
ten days have zero live plays** and exist only as backfilled rows — 73 tracks, 42 artists — and
`recently-played` is a 50-play window, so unlike code, labels or genres, they come back from
nowhere. There is a real derivation available if it is ever wanted (`played_at` is the end, so
`end_B − end_A` is B's listened time; validated at 53:1 in the 0.90–1.05 band, resolving 56 of 83),
but it was declined as complexity the app does not need.

**A coverage percentage cannot see a file no test imports.** V8 coverage only reports modules
that were actually *loaded*, so an untested file is missing from the **denominator** rather than
counted as 0% — it cannot drag the average down. On 2026-09-06 the suite reported **98.96%** while
`server.ts` (952 lines, nine routes, and the home of the WebSocket `403`) had **no tests at all**.
`--test-coverage-include` does not help; it filters the report and cannot conjure coverage for a
module that never ran — probed with both a directory glob and a file glob. Same family as the
denominator traps below, and the most dangerous of them, because it reads as good news.
`test/noOrphanModules.test.ts` now fails on any module nothing executes unless it is in
`ALLOWED_ORPHANS` **with a reason**.

⚠️ **THAT TEST WALKS MODULES, NOT METHODS, AND TWO DEAD WRITERS HID BEHIND IT.** Found 2026-09-22:
`recordSuccessorLag` and `updateSkipAttribution` in `SqliteHistoryRepository` had **zero callers for
their entire lives**, and `successor_lag_ms` is `null` on all 662 rows. The module is imported and
heavily executed, so the orphan check is satisfied and coverage looks fine — the dead code is one
method inside a live file. Both were written for `scripts/attribute-skips.mjs`, which then
**re-implemented the rule in its own SQL** rather than calling either, so the script carried a second
copy of the threshold while the methods built for it sat unused. **A column that is structurally
empty reads as "this never happens"**, which is the absent-data trap again: the 2026-09-22
measurement had to reconstruct successor lag from retained trails because the field designed to hold
it was never wired. Three files are knowingly untested — `diagnostics.ts`,
`export/SnapshotScheduler.ts`, `mcp/spotifyMcpClient.ts` — all constructed only by `server.ts`.

**Routes live in `api.ts`, not `server.ts`, so they can be tested.** `createApi(ApiDeps)` takes
every collaborator by injection, including `now` — `/api/history/stats` anchors a 26-week window
on the current week, and with an ambient clock that behaviour is untestable. `server.ts` keeps
wiring, startup and the `upgrade` handler; **leave the upgrade handler there** — `localGuard.test.ts`
pins it to that file structurally, and it exists because of the `403`.

**`played_at` from `recently-played` is when the track FINISHED, not when it started.** The docs
are silent; the data is not. Across 41 plays this app had observed start *and* end itself,
`played_at` matched the recorded **end** with a median error of 3.0 s, and matched a start once —
by 177 s, itself about a track length. The backfill stored it as `startedAt` **and** `endedAt`
from U1 until 2026-09-06, which put every backfilled row a track-duration late *and* defeated
deduplication: dedup compared that end against stored **starts**, so a play already recorded live
never matched and **every restart re-inserted it as a fresh `unknown` row**. 41 of 125 backfilled
rows are duplicates, going back to 26 August. **Repaired 2026-09-06** by
`scripts/repair-backfill-timestamps.mjs` (user-approved): 84 re-timed, 41 deleted, zero remaining
by the same criterion, and every live observation trail untouched.

⚠️ **It survived because `RecentlyPlayedBackfill` had NO TESTS AT ALL** — the class writing a third
of the corpus, covered by nothing, while 438 tests stayed green. It was found by a human noticing
that one number on a chart moved when it should not have. The asymmetry was the diagnosis:
`completed` can only come from a live trail, `unknown` is what the backfill writes, so inflation
confined to `unknown` points at the backfill and not at the classifier.

**Dedup is keyed on the END, and must stay that way.** `hasPlayNearEnd` replaced `hasPlayNear`
rather than joining it, so the start-based version cannot be reached for this again. `played_at`
is the one value Spotify reports exactly — deduping on a start *derived* from it would repeat the
mistake one layer down.

**The artist credit is a JOINED STRING on the live path, and the split cannot see a comma in a
name.** `parseNowPlaying.ts` reads `artist: field(raw, 'Artist')` — the MCP `getNowPlaying` returns
names already joined, so there is **no `artists[]` array anywhere on the live path**. Splitting on
`', '` is the only signal available, not a shortcut. It is exact today (119 of 119 multi-artist
tracks checked against Spotify's own `artists[]`), and **zero** comma-bearing names are in the
corpus — but `Tyler, The Creator` would silently become two artists, and a split record knows only
the lead's id, so **93 of 234 credited names have no id** and a wrong split is indistinguishable
from a right one. Separately, a **group alias** (`Inpatient` = Ren + Chris Webby;
`Macklemore & Ryan Lewis`) is credited *beside* its own members, so it ranks as an independent
artist — ⚠️ **not** the by-design `SUM(artist_plays) > play count`, which is one play counting for
each *real* collaborator. Both are deferred as **W-4**, affect the derived reporting DB only, and
are **not** rule or gate inputs. ⚠️ Do not "fix" the splitter because `Inpatient` looks like a
track name: it is a real artist with a 10-release discography, and that was probed.

**`artist_id` is the PRIMARY artist, and grouping by it undercounts.** The schema stores one id
per play — `track.artists[0]` — while `artist_name` is the joined display string
(`"Inpatient, Ren, Chris Webby"`). A feature credit is therefore filed under the *lead* artist and
is absent from the guest's totals. Measured 2026-09-06: Ren appears on **34** plays but owns the
primary id on **26**, so any per-artist figure is ~24% low for someone who guests often. Only 14 of
176 plays are multi-artist, but it concentrates on exactly the artist a person would look up. The
statistics panel says `(as primary artist)` on every render for this reason, and
`historyRepository.test.ts` pins the limitation — if a later unit records every artist id, that
test is what should fail. Same family as the denominator trap: it reads as a listening pattern,
not as a schema limit.

**Week buckets are built in JavaScript, never in SQL.** SQLite's `%W` counts weeks from the first
Sunday and `%U` from the first Monday, and neither is the ISO week; at a year boundary they emit a
week `00` that is sometimes partial and sometimes fused with December. That is one wrong week in
fifty-two, drawn as a listening pattern rather than raised as an error. `history/playStats.ts` is
pure and takes `now` as a parameter, which is the only reason the week seam is testable at all.

**MusicBrainz `browse /release?artist=` COUNTS RELEASES THE ARTIST ONLY FEATURES ON.** There is no
flag for this and the field that would tell you (`artist-credit`) is not returned unless you ask
for it. Probed 2026-09-06 on Bad Bunny: 201 official releases, **92 his, 109 other people's records
he guests on**, and **49 of the 64 distinct labels reachable only through a guest credit** —
Atlantic from Cardi B's *I Like It*, El Cartel from Daddy Yankee's *Dura*. An artist-level label
verdict was classified over this until 2026-09-06 and it read *other artists' record deals*.
Because BR-4.3's fold makes one strong `major` vote decisive, **every collaborative artist read
`major`** — bias in the *independent* variable, pushing independents into the major group, which
is the direction that would mask R1. The verdict is **removed, not repaired** (migration 004): the
label a track was released under is a release-level fact answered through the ISRC, and there is
no second label question worth a request. The artist level is **genres and a pointer**. If a later
unit wants an artist-level signal, it must start from `inc=artist-credits` and filter on
`artist-credit[0]`, and `test/resolutionTrace.test.ts` is what should fail first.

⚠️ **That browse was also `limit=100` with no paging, and the 100 was stored as `release_count`.**
Bad Bunny has 205; page 2 alone held 20 labels page 1 never saw, including Universal, Epic and
Warner. 18 of 56 stored resolutions sat exactly at 100 — an arbitrary sample recorded as a
complete count, with nothing marking it truncated. **Any capped fetch whose count is written down
is this bug.** `LikedSetCache` pages; that path never learned to.

⚠️ **A work set needs a terminator that a permanent absence can still satisfy.** The label backfill
asked "does this play still need the artist level?" with `artist_label_verdict IS NULL`, which
terminated only because a not-found artist got the verdict `unknown`. With the verdict gone,
`artist_genres IS NULL` reads as the obvious replacement and is a trap: an artist MusicBrainz has
never catalogued has no genres and never will, so the play would return on every sweep for ever,
spending requests to learn the same nothing. The guard is `artist_resolution_id IS NULL` — a
pointer written even when the answer is empty.

**MusicBrainz throttles at 1 req/sec spacing.** Measured: 6 of 19 tracks took a `503` at 1200 ms —
wider than the policy floor. The bounded retry is load-bearing, not belt-and-braces. Each retry
goes back through the queue, so it spends time, never rate.

**One admission rule, invoked twice — never written twice.** `ws` does not run Express
middleware, so the WebSocket upgrade handler in `server.ts` has to invoke the local-access policy
explicitly. It used to do that by *re-implementing* it, and on 2026-09-05 the copies diverged:
option B (`TRUST_PUBLISHED_PORT`) was added to the HTTP path only. In the container every page
load returned `200` and every handshake returned `403`, so the UI loaded and sat on
"Disconnected — reconnecting…" forever, which reads as *Spotify is down* rather than *the guard
refused my socket*. **All 411 tests passed** — the option-B tests exercised the policy function,
and nothing exercised the upgrade handler. Both paths now go through `decideAccess`, and
`localGuard.test.ts` pins that structurally. Diagnose this class with
`curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" … http://localhost:3010/ws`, and check
`/api/health` to see whether Spotify is actually implicated: it does a real MCP round-trip.

**Check build exit codes directly.** `docker compose build | tail` reports the *pipe's* exit code.
A failing build once read as success here.

**A guard computed the same way as the thing it guards is not a guard.** `MAX_PREDICATE_DEPTH`
exists so a deep predicate tree cannot overflow the stack in `evaluate`. The first `depthOf` was
recursive — the obvious way — and would have **overflowed while computing the guard's own input**,
on exactly the trees the guard exists to refuse. The `RangeError` would have surfaced from the
*validator* rather than the evaluator, and the protection would have been decorative. `depthOf` is
now iterative with an explicit stack and an early exit at the limit, so a pathological tree costs
O(limit) rather than O(tree); `predicate.property.test.ts` nests 50,000 levels and asserts both
that it returns and that it returns fast. Look for this shape anywhere a limit is enforced by
measuring first.

**`exists` cannot exist in a tri-state language.** A field is present (`true`) or absent
(`unknown`) — there is no third input state, so `false` is unreachable and `not(exists(f))` is
`not(unknown)` = `unknown`: precisely the question it was meant to answer, unanswered. The
operator was removed and `is-unknown` (always decisive) put in its place. The general shape: an
operator whose result set is narrower than its name implies will be used as though it were wider.

**`restedOnUnknown` is the raw verdict, never an accumulator.** Under Kleene logic a predicate can
contain an unknown and still resolve decisively — `false AND unknown` is `false`, because the data
answered it. Flagging "an unknown appeared anywhere in the tree" was offered as an option and
rejected, and the tempting implementation (a flag set during the walk) silently implements the
rejected one. `ruleEngine.test.ts` pins it with a predicate that does exactly this.

⚠️ **A property-test generator that recurses per branch is exponential.** `treeOfDepth(d)` calling
itself three times per level builds ~3^d arbitraries; at depth 20 it exhausted the heap and killed
the test process with a V8 stack dump and no useful message. It reads as *"property testing is
slow"*, not *"the generator is wrong"*. Build the child arbitrary **once** and reuse it.

**Genre matching is per element and on word boundaries, and that was measured.** Over the corpus's
110 distinct genres (62 multi-word), plain substring matching makes `contains "rap"` also match
`trap`, `trap latino` and `trap metal` — 4 unintended hits of 7. Worse, joining genres and then
folding punctuation turns `["hip hop","rapcore"]` into `"hiphoprapcore"`, where a match crosses a
boundary that exists in the data but not in the string. Both read as working rules.

**A single-file bind mount binds an INODE.** `./config:/config:ro` mounts the directory for this
reason: write-temp-then-rename, the safe way to save a config file, *replaces* the inode, and
through a single-file mount that rename either fails or silently detaches the container's view
from the host file. U3 only reads, so the bug is invisible here and would surface the first time
the U4 rule editor saves. Same family as `./data` needing a directory mount for SQLite's `-wal`
and `-shm` siblings.

**Run `npm run rules:init` before the first `compose up`.** It creates `config/rules.json` from the
committed template and refuses to overwrite. ⚠️ **The root-ownership rationale is host-specific and
was NOT observed here** — on a Linux host, Docker creating a missing bind-mount source directory
owned by root would leave the app (which drops to `node`) unable to read its own rules. Measured
2026-09-11 on Rancher Desktop / Windows: the bind mount synthesises `rwxrwxrwx root:root`
regardless, so reads work. Keep the script; do not cite the reason as if it had been seen.

**FR-33 is only partly met, deliberately.** `onUnknown: 'no-match'` and `'match'` work; **`'hold'`
does not**, because it needs a deadline and a re-evaluation trigger that a pure synchronous module
cannot have. A rule declaring it is **stored and disabled with a reason**, so rules written now
begin working when U5 lands without being re-authored. Do not mark FR-33 complete on the strength
of U3's tests. The `applyOnUnknown` switch has no `default:` clause on purpose: adding an
`OnUnknown` member is then a compile error at the place that must change.

**U3 is wired to nothing, and `git status src/` proves it.** The unit added `src/rules/` and
changed no existing source file — no route, no `server.ts` change, no poll loop, no schema. If a
later session finds the rules engine affecting app behaviour before U4/U5, that is a regression of
the phase boundary, not progress.

---

## Open items

| # | Item | Owner |
|---|---|---|
| 1 | ~~Container deployment is blocked~~ — **CLOSED 2026-09-05.** User chose **option B**: `TRUST_PUBLISHED_PORT` disables the peer check *only*, keeping Host/Origin. Verified live — UI `200` on `http://localhost:3010`, cross-site Origin still `403`. **The container is now the running deployment**, on Rancher Desktop autostart. Decision and measurements in `construction/build-and-test/security-test-instructions.md` | ✅ |
| 2 | **Liked-status transitions — agreed for U2.** Four states + `unknown`; `kept-unliked` is the reference level, not an observed choice. Design in `research-findings.md` Part 4b | U2 |
| 3 | **⚠️ CORRECTED 2026-09-20 — the old premise was false.** This said *"`recently-played` returns no `external_ids`"*. **It does.** Probed live 2026-09-20: `HTTP 200`, `external_ids.isrc` on 3/3 items. Only **82 rows** lack an ISRC — all backfilled, all dated **2026-08-20 → 08-31**, spanning **72 distinct `track_id`s**. Every other row has one: 457 live + 4 backfilled since 2026-09-03, of 543. So recovery is **72** `GET /tracks/{id}` calls, not 47. ⚠️ **The 2026-09-05 conclusion STANDS and is the decision:** all 82 are `outcome = 'unknown'`, so **0 are gate-eligible** — what the backfill lacks for the gate is the observation trail, which no API returns retroactively. **New in U4**: these 82 are exactly the rows where `label.*` is *unanswerable* rather than *unknown* (BR-27.5b) — discriminator `isrc IS NULL AND label_unknown_reason IS NULL` — so recovering them would improve back-test answerability as well as coverage stats, at 72 Spotify calls plus ~2 MusicBrainz calls each behind a 1 req/sec queue. Decide on that basis → U2 FD **Q7** | Later |
| 3a | **⚠️ Why those 82 lack an ISRC is UNESTABLISHED — and it is not the code.** `RecentlyPlayedBackfill` has read `track.external_ids?.isrc` since **U1** (`a8136d9`), `webApiClient.ts` has exactly one commit, and the wiring never changed. Live rows carried an ISRC from the very first one (row id 51). The break is clean at **row id 120 → 155** (2026-09-01 → 09-03), with **no code change in that window**. Something outside this repo changed, or the original observation misattributed its cause. **Do not invent one.** ⚠️ **The lesson is the project's own rule pointing the other way**: the four documented traps were all *docs said yes, probe said no*. This is **our own notes said no, and the probe says yes** — a recorded negative decays silently, because nothing ever re-tests it. **Re-probe a "the API doesn't return X" note before building on it.** | ✅ measured |
| 3b | **MusicBrainz label coverage is recency-biased, and this is now CONFIRMED TWICE.** Ad-hoc probe 2026-08-26: pre-2022 100%, 2022+ **43%**. Shipped code on a larger corpus 2026-09-05: **86%** / **44%**. The gap is real and stable, not an artefact of the first sample, and stays concentrated on the recent independent releases R1 is about. ⚠️ Measure it **only over ISRC-bearing plays** — see the denominator warning above | ✅ confirmed |
| 4 | **✅ CLOSED 2026-09-22 — the mechanism was found and the data is fixed.** The overlap is real but it is **not crossfade and not a threshold artefact**: in the DJ context Spotify stops *reporting* a track 18–41 s before it stops *playing*, and the listener hears it finish. ⚠️ **Crossfade is OFF on this machine** (Automix on, gapless on), so the old *"crossfade ruled out because Spotify caps it at 12 s"* argument failed twice over — it assumed cut length equals crossfade length, **and the feature was disabled**. A UI fact used as a probe result. Fixed by classifier v2: 24 rows re-derived `skipped` -> `completed`, live skips 46 -> 22. `skip_attribution` retired. See `audit.md` 2026-09-22 | ✅ |
| 4-old | **⚠️ SUPERSEDED, kept for the history. REWRITTEN 2026-09-22 — every number in the original was n≈10 and NONE of them replicated.** The original argued: the AI DJ crossfades → crossfade removes constant seconds → a proportional threshold penalises short tracks → majors run ~30% longer (248s vs 191s) → independents take more false skips → **so correcting it could only move the result toward R1**. Re-measured on 586 plays, **all three premises and the conclusion fail**: ① *crossfade is ruled out* — the affected plays lose **21–41s** and Spotify caps crossfade at 12s; ② *the duration gap dissolved* — majors **213s** vs independents **201s** (n=120/162), a 6% gap, not 30%, exactly the chance the original flagged at n=10/11; ③ *threshold crowding dissolved* — **52 of 443** live track-change plays sit within ±0.05 of 0.90 (**11.7%**), not 13 of 27 (48%); ④ ⚠️ **the direction is BACKWARDS.** Unattributed skips are **67% of major skips (6/9)** but only **50% of independent (6/12)**, so correcting removes proportionally *more* from majors. The rates flip sign: all skips major **8.1%** > independent **7.6%**, but user-only skips major **2.7%** < independent **3.8%**. ⚠️ **EXPLORATORY AND NOISE-DOMINATED** — 3 vs 6 events, computed after seeing the data, and **BR-11.7's confirmatory run is spent**. This is *not* evidence against R1; it is grounds for withdrawing the old claim, nothing more. **The concern is now INSTRUMENTED rather than open**: `skip_attribution` (migration 006) labels these plays directly, so analysis can exclude them without moving the pre-registered threshold. 0.90 stays | ⚠️ restated |
| 5 | **✅ CLOSED 2026-09-22 — R11 probed during active playback.** Context-dependent: album/autoplay/radio expose 20 tracks and predict 8 for 8; **the AI DJ exposes none**. `context.type` cannot distinguish them. FR-36 must probe the queue at runtime rather than infer from context, and FR-34/35 is the majority path at 50–70% DJ listening | ✅ |
| 8 | **Distinguish a rejection-skip from a session end** — user-raised 2026-09-10, **re-raised 2026-09-19**. Backlog item **W-3** in `requirements.md` §5.1. ⚠️ **Probed twice — the corpus has ZERO instances**, at 427 plays and again at **504**: all 31 skips close on `track-change`, all have a successor within 30 s, and the 12 session-enders are **7 `completed`, 5 `unknown`, 0 `skipped`**. It is unreachable by construction — `classify` returns `skipped` *only* on `closeReason === 'track-change'`, and stopping playback yields `pause-idle`/`playback-stopped`, which fall through to `unknown`. ⚠️ **THE COST RUNS THE OTHER WAY.** Those 5 partial session-enders are not contaminating the outcome variable, they are **missing from it** — the gate's `ELIGIBLE` predicate is `outcome IN ('completed','skipped')`, so every abandoned last-track is silently dropped. **W-3 is data recovery, not a false-skip repair**, and anyone implementing it as stated will write code that does nothing and tests that pass for want of anything to fix. Discriminator (gap from `ended_at` to next `started_at`) needs no new collection and applies retroactively | Later |
| 7 | **Playback context is never recorded for live plays.** ⚠️ **Re-measured 2026-09-10 at 427 plays: NULL on all 342 LIVE plays, populated on all 85 BACKFILLED ones** (83 playlist, 2 artist) — the earlier "NULL on all 35" predates the backfill carrying it. The MCP `getNowPlaying` returns no context field; `recently-played` does. **So the field is available exactly where the outcome variable is not**, and a rule over it would back-test as populated while being unknown 100% of the time live — see U3 FD **Q5**. Spotify’s `/me/player/currently-playing` **does** return it — probed 2026-09-02, returning `spotify:playlist:37i9dQZF1EYkqdzj48dyYq` (the AI DJ). A DJ play is otherwise indistinguishable from a playlist play, and the DJ is algorithmic selection into the feed — arguably the closest available proxy for what R1 calls *promoted*. **User declined for now** (2026-09-02) | Later |
| 6 | ~~`label_resolved_at` missing~~ — **closed 2026-08-31.** Superseded by BR-13: resolutions are versioned append-only, and a play stores `label_resolution_id`, the exact version its verdict came from | ✅ |

---

## Git workflow

**Commit directly to `main`.** Single developer, single dev machine, so there are no
multi-developer merge concerns and no reason for feature branches — they only add a merge step.
Remote is `origin` (GitHub). Push when asked.

## Commands

```bash
docker compose up -d          # THE DEPLOYMENT since 2026-09-05 — http://localhost:3010
docker compose down           # stop it before running on the host
docker logs -f spotify-now-playing

npm start          # host deployment — port 3000. See the warning below before using it
npm test           # 851 tests
npm run typecheck  # covers src AND test
npm run auth       # host-side OAuth, once

node scripts/hypothesis-gate.mjs   # the Phase 2 gate (BR-11). Read-only; writes nothing

# The played_at repair. Dry run by default; --apply takes its own backup first.
node scripts/repair-backfill-timestamps.mjs

# Re-derive stored outcomes from retained trails under the current classifier (FR-20).
# Dry run by default and prints the full diff; --apply backs up first. NEEDS the tsx loader,
# because importing the real classifier is the point -- see the header comment.
node --import tsx scripts/reclassify-unobserved-tails.mjs
```

⚠️ **`scripts/attribute-skips.mjs` was DELETED 2026-09-22** with `skip_attribution`. It carried its
own copy of `USER_SKIP_RATIO_CEILING` and would re-derive a judgement classifier v2 supersedes, on
an axis v2 disagrees with. `scripts/measure-confound.mjs` still exists but now **refuses to run**
against a post-retirement database rather than returning zeros that would read as a finding.

⚠️ The gate's thresholds are **pre-registered constants, not parameters**. Change them by amending
`hypothesis-gate/pre-registration.md`, never by editing the script — the point of a
pre-registration is that it cannot be adjusted once results are visible.

> ⚠️ **Never run the container and `npm start` at the same time.** Both poll Spotify and both
> write `data/history.db`. Together they double-record every play and put two writers on one
> SQLite file. The container runs unattended now, so **assume it is running** and
> `docker compose down` first.

Data lives in `data/` (gitignored): `history.db` plus `snapshots/`.

> ⚠️ **`data/` holds the only artefact here that cannot be regenerated.** Code comes back from git,
> labels from MusicBrainz, enrichment from Spotify — months of play records come back from nowhere.
> Being gitignored makes it *more* exposed to `git clean -xdf`, not less.

---

## Working style that has served this project

Say what is verified and what is not. Several findings here came from probing rather than
assuming, and from noticing that a green test was green for the wrong reason. When a design
decision is a security-posture question, surface it rather than deciding it.
