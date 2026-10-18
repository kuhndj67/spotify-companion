# User Stories

**Date**: 2026-08-25 · **Stage**: INCEPTION — User Stories
**Personas**: [`personas.md`](personas.md) · **Requirements**: [`../requirements/requirements.md`](../requirements/requirements.md)
**Approach**: Epics for structure, journey-style stories within them (Q3 = C). Given/When/Then
for rules-engine and skip-inference stories; checklists elsewhere (Q4 = C).

**Status key**: ✅ Delivered and live-verified · ⬜ New

---

## Epic 1 — Awareness: *"What am I listening to?"*

Already delivered. Summarised per Q2 = C rather than re-specified.

### US-01 — See what is playing, without asking ✅
**As** the Listener, **I want** the current track, artist, album and progress to appear and stay
current on their own, **so that** I can glance over and know what I'm hearing without breaking
focus.

**Acceptance criteria**
- [x] Track title, artist, album, elapsed time and duration are displayed
- [x] The display updates without user action, pushed from the server
- [x] The progress bar advances smoothly between server updates, not in visible jumps
- [x] When nothing is playing, the display says so plainly — an idle Spotify is not an error
- [x] Readable at a glance: title is the dominant element

*Covers FR-01, FR-02, FR-03, FR-05 · Persona P1*

### US-02 — See the album artwork ✅
**As** the Listener, **I want** the album art shown, **so that** I can recognise what's playing
faster than by reading.

**Acceptance criteria**
- [x] Cover art is displayed alongside the track
- [x] Image size is chosen by measured width, not array position — sizes vary by album
- [x] Art is cleared on track change, so a previous album's cover is never shown against a new title
- [x] Missing artwork degrades gracefully rather than leaving a broken image

*Covers FR-04 · Persona P1*

### US-03 — Confirm the app is actually working ✅
**As** the Curator, **I want** a diagnostic view of the connect / auth / query cycle, **so that**
when something is wrong I learn *where* rather than just *that*.

**Acceptance criteria**
- [x] Each step reports status, detail and timing
- [x] A step whose prerequisite failed reports "skipped", not "failed" — the distinction localises
      the fault
- [x] Available on demand without restarting the app

*Covers FR-06 · Persona P2*

---

## Epic 2 — Understanding: *"What IS this track?"*

### US-04 — Know how old the track is ✅
**As** the Listener, **I want** the release date and the track's age in years, **so that** I can
tell at a glance whether Spotify has slipped an old track into my stream.

**Acceptance criteria**
- [x] Release date and release year are displayed
- [x] Age in whole years is derived and shown
- [x] Year-only release dates are handled — most older catalogue entries carry no full date
- [x] Future-dated releases show age 0, never a negative number

*Covers FR-07 · Persona P1*

### US-05 — Know whether I already follow this artist ✅
**As** the Listener, **I want** to see whether the primary artist is one I follow, **so that** I
can tell a genuine discovery from something I already chose.

**Acceptance criteria**
- [x] Follow status for the primary artist is displayed
- [x] Resolved from the cached followed-artists set, not a per-track call
- [x] A stale cache never blocks the display

*Covers FR-08 · Persona P1*

### US-06 — See the surrounding detail ✅
**As** the Listener, **I want** album type, track number, total tracks and the explicit flag,
**so that** I know whether I'm hearing a single, a deep album cut, or a compilation filler.

**Acceptance criteria**
- [x] Album type, track number / total tracks, and explicit flag are displayed when available

*Covers FR-09 · Persona P1*

### US-07 — Still see something when enrichment partly fails ✅
**As** the Listener, **I want** a failed lookup to blank only its own field, **so that** one
upstream problem doesn't cost me the whole panel.

**Acceptance criteria**
- [x] A per-field failure leaves other fields intact
- [x] Unavailable fields state *why* rather than showing a bare dash
- [x] Partial results are not cached as if complete

*Covers FR-10, FR-11 · Persona P1*

### US-08 — Learn which label released the track ⬜
**As** the Listener, **I want** the record label for the current track, **so that** I have the
raw fact behind the signed-vs-independent question.

**Acceptance criteria**
- [ ] The label is resolved via MusicBrainz, keyed on the track's ISRC
- [ ] The ISRC is taken from the existing `GET /tracks/{id}` response — **no additional Spotify
      request is made**
- [ ] A given ISRC is resolved at most once; the result persists across restarts
- [ ] MusicBrainz requests are serialised to at most ~1 per second and carry an identifying
      `User-Agent`
- [ ] Label lookup **never delays the now-playing display** — it resolves asynchronously and the
      panel fills in when it arrives
- [ ] A MusicBrainz outage degrades the label to unresolved; nothing else is affected

*Covers FR-12, FR-14, FR-15 · Persona P1 · Depends on: nothing*

### US-09 — Know whether that label is major or independent ⬜
**As** the Listener, **I want** the label classified as major, independent, or unknown — with an
indication of how confident that is — **so that** I have the signal I actually care about rather
than a label name I'd have to look up myself.

**Acceptance criteria**
- [ ] Classification is one of exactly three values: `major`, `independent`, `unknown`
- [ ] `unknown` is displayed as its own state and is **never rendered as "independent"**
- [ ] The classification records which signals contributed and how each voted — curated
      major-label list, MusicBrainz label relationships, ISRC registrant code
- [ ] Where signals disagree, the disagreement is preserved rather than silently resolved
- [ ] Confidence is visible to the user
- [ ] A track MusicBrainz has never heard of produces `unknown`, promptly — not a hang

*Covers FR-13, FR-16 · Persona P1 · Depends on: US-08*

> **Note on value**: this story's worth rests on R1 — the unproven assumption that major-label
> placement correlates with promotion, and promotion with dislike. US-25 is the story that tests
> that. If it fails, US-09 still delivers a true fact; it just stops being interesting.

---

## Epic 3 — Remembering: *"What has Spotify actually been playing me?"*

### US-10 — Have every play recorded without doing anything ⬜
**As** the Analyst, **I want** every track that plays recorded automatically with its enrichment
and a timestamp, **so that** months from now I have a dataset instead of an intention.

**Acceptance criteria**
- [ ] Every observed play is recorded: track identity, enrichment snapshot, start timestamp
- [ ] Recording requires no user action and is invisible during normal listening
- [ ] History survives container restart and rebuild — a redeploy never resets it
- [ ] Schema changes migrate existing rows; history is never dropped and recreated
- [ ] A persistence failure degrades the app to display-only rather than crashing it
- [ ] The enrichment snapshot is stored **as it was at play time**, not re-derived later

*Covers FR-17, FR-21 · Persona P3 · Depends on: nothing*

### US-11 — Have skips distinguished from completions ⬜
**As** the Analyst, **I want** each play marked as completed, skipped or unknown —
with the evidence behind that verdict kept — **so that** I have an outcome variable I can trust,
and can recompute it when my classifier improves.

**Given/When/Then** — this is a derived signal with real confounders, so preconditions carry the
meaning.

```gherkin
Given a track is playing
When observed progress reaches at least 90% of its duration
Then the play is recorded as "completed"

Given a track is playing
When the track changes while observed progress is below 90% of its duration
Then the play is recorded as "skipped"

Given a track is playing
When playback is paused and later resumed on the same track
Then the play is NOT recorded as skipped

Given a track is playing
When the user seeks forward or backward within the same track
Then the observed progress jump is not mistaken for completion or skip

Given a track is playing
When the same track restarts from the beginning
Then a replay is recorded rather than the previous play being overwritten

Given a track is playing
When playback stops entirely and the device goes idle
Then the play is recorded as "unknown", not "skipped"

Given any recorded play
When the outcome is written
Then the raw evidence is written with it — last observed progress, duration, and the gap since
     the previous observation

Given a set of historical plays
When the classification logic is later improved
Then every stored play can be re-classified from its retained evidence, with no data loss
```

**Additional criteria**
- [ ] The three outcome values are exhaustive; there is no fourth implicit state
- [ ] `unknown` is a legitimate recorded outcome, not a failure to record
- [ ] **Known limitation, accepted**: tracks under ~30 s that play through are *sometimes*
      recorded as `skipped`, depending on where the final poll lands — the same track can resolve
      differently on different plays. Correctable later via reclassification from the retained
      trail

*Covers FR-18, FR-19, FR-20 · Persona P3 · Depends on: US-10*

> **Why the evidence retention matters**: the first version of this classifier will be wrong. If
> only its verdict is stored, every error is permanent and invisible, and the dataset the entire
> project depends on is quietly corrupted. This is the single most consequential acceptance
> criterion in the document.

### US-12 — Not lose history while the app is down ⬜
**As** the Analyst, **I want** plays that happened while the app wasn't running to be filled in,
**so that** my dataset isn't biased toward the hours I happen to have it open.

**Acceptance criteria**
- [ ] On startup, recent plays are backfilled from `GET /me/player/recently-played`
- [ ] Backfilled plays are marked as such — they carry a timestamp but **no reliable outcome**
- [ ] Backfilled plays are never counted as completions by default
- [ ] Backfill does not duplicate plays already recorded live

*Covers FR-22 · Persona P3 · Depends on: US-10*

### US-13 — Tell my own skips apart from the app's ⬜
**As** the Analyst, **I want** automated skips recorded distinctly from skips I performed,
**so that** my analysis isn't measuring the app's own behaviour and calling it my taste.

**Acceptance criteria**
- [ ] Every skip records whether it was user-initiated or rule-initiated
- [ ] Rule-initiated skips record which rule fired
- [ ] Analyses and back-tests exclude rule-initiated skips from user-preference signal by default

*Covers FR-23 · Persona P3 · Depends on: US-11, US-19*

> Without this, the feedback loop is circular: a rule skips major-label tracks, those skips are
> recorded as dislike, and the data then "confirms" that major-label tracks are disliked.

---

## Epic 4 — Shaping: *"Play me less of what I don't want"*

### US-14 — Write a rule about anything the app knows ⬜
**As** the Curator, **I want** to compose a rule from any field the app knows about a track,
**so that** I can express what I actually want filtered rather than choosing from a fixed menu.

```gherkin
Given I am creating a rule
When I look for something to match on
Then every referenceable field is discoverable, with its name, type and how often it is available

Given I am building a condition
When I choose a field
Then only operators valid for that field's type are offered

Given I am building a rule
When I combine conditions
Then I can use AND, OR and NOT to any depth

Given I save a rule referencing a field that does not exist
When the rule is validated
Then it is rejected at creation time with the reason, not silently at evaluation time

Given I save a rule comparing a field to an incompatible value
When the rule is validated
Then it is rejected at creation time

Given any rule I create
When it is stored
Then it is stored as structured data — never as code, and never evaluated via eval or an
     equivalent
```

**Additional criteria**
- [ ] A saved and reloaded rule evaluates identically to the original
- [ ] Fields from all sources are equally usable: Spotify, derived, MusicBrainz, context, history

*Covers FR-24, FR-26, FR-27, FR-28, FR-29, FR-43, FR-45 · Persona P2*

### US-15 — Run several rules at once ⬜
**As** the Curator, **I want** multiple rules active simultaneously, each independently
switchable, **so that** I can build up filtering gradually instead of maintaining one enormous
condition.

**Acceptance criteria**
- [ ] Multiple rules can be active at the same time
- [ ] Any single satisfied rule causes a skip — combination is OR, with no precedence or ordering
      significance
- [ ] Each rule can be created, edited, enabled, disabled, and deleted independently
- [ ] Disabling a rule takes effect on the next track without a restart
- [ ] Rules persist across restarts

*Covers FR-25, FR-30, FR-31 · Persona P2*

> **Known limitation, accepted (Q-B)**: OR-only cannot express "skip major-label tracks *except*
> by artists I follow" as one rule. The workaround is to fold the exception into the predicate —
> `label = major AND following = false`.

### US-16 — Write rules about my own listening history ⬜
**As** the Curator, **I want** rules that reference what I've done before, **so that** I can say
"stop playing me things I keep skipping" without hand-listing them.

**Acceptance criteria**
- [ ] History-derived fields are referenceable: previous plays of this track, previous skips of
      this track, plays and skips for this artist
- [ ] History fields resolve from local storage and add no external API calls
- [ ] History fields are `unknown` when insufficient history exists — not zero
- [ ] The distinction from US-13 holds: rule-initiated skips do not feed history-based rules,
      or a rule would reinforce itself

*Covers FR-27 (history fields) · Persona P2 · Depends on: US-10, US-11, US-14*

> The last criterion is a genuine trap: a rule that skips a track, records a skip, and then
> matches on "tracks I've skipped twice" would ratchet itself into skipping ever more music.

### US-17 — Decide what a rule does when the data isn't there ⬜
**As** the Curator, **I want** to state what a rule does when a field it needs cannot be
resolved, **so that** coverage gaps don't silently make my rule wrong in a direction I didn't
choose.

```gherkin
Given a rule references a field
When that field cannot be resolved for the current track
Then the condition evaluates to "unknown" — never silently to false

Given a rule containing an unknown condition
When the rule is evaluated
Then the rule's declared unknown-behaviour applies: treat as no-match, treat as match, or hold
     pending resolution

Given I create a rule and do not specify unknown-behaviour
When the rule is evaluated against an unresolvable field
Then the default is no-match, and that default is visible to me — not hidden

Given a track was skipped or kept on the basis of an unknown
When the decision is recorded
Then the record shows the decision rested on unresolved data
```

**Additional criteria**
- [ ] Tri-state logic behaves correctly under composition — an unknown inside a NOT or an OR does
      not collapse to false
- [ ] The UI shows which of a rule's fields are frequently unavailable, before it is armed

*Covers FR-32, FR-33 · Persona P2*

> This exists because **neither default is safe** (R2). "Skip major-label tracks" with
> unknown-as-false fails on exactly the uncatalogued releases the Curator most wants filtered;
> unknown-as-true skips everything MusicBrainz has never heard of. The rule must choose.

### US-18 — Have rules act when the track starts, not later ⬜
**As** the Curator, **I want** a rule to act at the start of a track even when it depends on a
slow field, **so that** filtering feels immediate rather than arriving several seconds in.

```gherkin
Given a track is in the upcoming queue
When the app has spare capacity
Then its enrichment is fetched ahead of time, so slow fields are already resolved when it starts

Given a track starts and all referenced fields are already resolved
When rules are evaluated
Then the decision is made immediately, with no perceptible delay

Given a track starts and a referenced slow field is still resolving
When rules are evaluated
Then fast fields are evaluated at once, and the rule is re-evaluated if the slow field arrives
     within the decision window

Given a track starts and a referenced field has not resolved
When the decision deadline passes
Then the app acts on what is known and records that the decision was made on partial data
```

**Additional criteria**
- [ ] The decision deadline is bounded and configurable
- [ ] A partial-data decision is distinguishable in the log from a complete one

*Covers FR-34, FR-35, FR-36 · Persona P2, benefits P1*

> **Open verification**: `GET /me/player/queue` is confirmed reachable (200 in Development Mode,
> 2026-08-25) but was probed with nothing playing and returned an empty queue. Whether it yields
> useful lookahead during active playback is **unverified** (R11), and the pre-warming criterion
> above depends on it.

### US-19 — Have the unwanted track actually go away ⬜
**As** the Listener, **I want** a matched track skipped automatically and quietly, **so that** I
get the outcome I asked for without being drawn into a conversation about it.

```gherkin
Given automation is enabled and a rule matches the current track
When the rule fires
Then the track is skipped without any confirmation prompt

Given a skip has been requested
When playback does not actually advance
Then the failure is surfaced rather than retried indefinitely

Given a skip failed for the current track
When rules are evaluated again for that same track
Then it is not skipped repeatedly in a loop

Given the app has never had automation explicitly enabled
When a rule matches
Then nothing is skipped — automation is off by default
```

**Additional criteria**
- [ ] Skipping requires no re-authentication — `user-modify-playback-state` is already granted
- [ ] The skip is silent in the moment; the explanation lives in the log (US-23)

*Covers FR-46, FR-47, FR-48 · Personas P1, P2 · Depends on: US-14*

---

## Epic 5 — Control: *"I need to be able to undo this"*

### US-20 — Try a rule without letting it act ⬜
**As** the Curator, **I want** a mode where rules log what they *would* have skipped without
skipping, **so that** I can watch a rule against real listening before trusting it.

```gherkin
Given dry-run mode is active
When a rule matches the current track
Then the match is logged with the rule and the field values that triggered it
And the track continues playing untouched

Given dry-run mode is active
When I review the log after a listening session
Then I can see every track that would have been skipped, and why
```

**Additional criteria**
- [ ] Dry-run can be enabled globally and per rule
- [ ] Dry-run decisions are recorded as such and never counted as user skips (US-13)

*Covers FR-37 · Persona P2*

### US-21 — Stop everything immediately ⬜
**As** the Curator, **I want** one control that halts all automated action at once, **so that**
when something is going wrong I can stop it without diagnosing it first.

**Acceptance criteria**
- [ ] A single control halts all rule-initiated action
- [ ] It takes effect immediately, without a restart
- [ ] Its state is obvious at a glance — no ambiguity about whether automation is live
- [ ] It survives restart: if the user killed automation, it stays killed
- [ ] Display, enrichment and history recording continue while automation is halted

*Covers FR-38 · Persona P2*

### US-22 — Be protected from my own mistake ⬜
**As** the Curator, **I want** the app to stop itself when it is skipping unusually often,
**so that** a rule I wrote wrongly cannot empty my queue while I'm not looking.

```gherkin
Given automation is enabled
When automated skips exceed the configured rate
Then further automated skips are halted and I am told why

Given consecutive automated skips exceed the configured threshold
When the next track would also be skipped
Then automation halts rather than continuing

Given automation has halted itself
When I review what happened
Then I can see which rule was responsible and the tracks it skipped
```

**Additional criteria**
- [ ] Thresholds are configurable but have safe defaults
- [ ] A self-halt is loud — this is the one case where interrupting the Listener is correct

*Covers FR-39, FR-40 · Persona P2*

> A rule matching everything is indistinguishable, from inside the evaluation loop, from a rule
> working perfectly. The only observable difference is the rate.

### US-23 — Find out why a track was skipped ⬜
**As** the Curator, **I want** every evaluation and action logged with the rule and the data it
saw, **so that** I can work out why a rule fired when I didn't expect it to.

**Acceptance criteria**
- [ ] Every automated action records the rule, the field values evaluated, and the verdict
- [ ] Decisions made on partial or unknown data are marked as such
- [ ] The log distinguishes dry-run matches, real skips, and skips that failed
- [ ] Entries are reviewable after the fact without interrupting playback

*Covers FR-41 · Persona P2*

---

## Epic 6 — Hypothesis: *"Is any of this actually true?"*

### US-24 — Test a rule against what actually happened ⬜
**As** the Curator and the Analyst, **I want** to replay a proposed rule over my accumulated
history, **so that** I can see what it would have skipped and whether I'd have agreed.

```gherkin
Given I have accumulated listening history
When I back-test a rule against it
Then I see every historical track the rule would have matched

Given a back-test result
When I compare it with what I actually did
Then I can see how often the rule agreed with my own skips and how often it did not

Given a rule referencing a field that was unavailable historically
When I back-test it
Then those tracks are reported as unknown rather than silently excluded

Given the same rule and the same history
When I back-test it twice
Then the results are identical — evaluation is deterministic and side-effect free
```

**Additional criteria**
- [ ] Back-testing never triggers a real skip
- [ ] Rule-initiated historical skips are excluded from the "what I actually did" comparison

*Covers FR-42 · Personas P2, P3 · Depends on: US-10, US-11, US-13, US-14*

> This is where the rules engine and the promotion hypothesis meet. It converts rule authoring
> from guesswork into measurement.

### US-25 — Get my data out, into whatever tool I want ⬜
**As** the Analyst, **I want** the complete listening history exported in formats standard tools
accept, **so that** I can test the promotion hypothesis in Grafana, a notebook, or a spreadsheet
rather than waiting for this app to grow an analysis feature.

**Acceptance criteria**
- [ ] History exports to **CSV and JSON**
- [ ] The export contains **every recorded field**, including raw outcome evidence and the
      per-signal label votes — not a summarised or pre-aggregated view
- [ ] `unknown` values are represented distinctly and are never coerced to blank, zero, or false
- [ ] Coverage counts are included, so missing-data bias is measurable rather than invisible
- [ ] Each row is marked with its provenance: live-observed, backfilled, or rule-initiated
- [ ] Incremental export is supported — "everything since timestamp T" — so it can be scheduled
- [ ] Exporting never mutates history and never interferes with live recording
- [ ] The export is obtained as a **file download from the local web UI** — one action, no command
      line, no separate tooling
- [ ] A large history exports without stalling the display or timing out

*Covers FR-49, FR-50, FR-51, FR-52, FR-53, FR-54 · Persona P3 · Depends on: US-10, US-11, US-13*

> **Scope boundary set 2026-08-25**: the app collects and exposes data; it does not analyse it.
> The hypothesis test itself happens in an external tool. This story's job is to make sure the
> exported data is honest enough to support that test — particularly the `unknown` and coverage
> criteria, without which R2's missing-data bias would be invisible downstream.

### US-27 — Point a live dashboard at my history ⏸ **DEFERRED — wishlist W-1**
**As** the Analyst, **I want** a reporting tool to query my history live, **so that** dashboards
refresh themselves instead of me re-downloading a file.

**Status**: **Not in scope.** Deferred by user decision on 2026-08-25, pending a security
architecture that this project deliberately does not have.

> ### Why this is deferred rather than built
>
> `isLoopbackAddress` accepts only `127.x` and `::1`. A Grafana **container** on the Compose
> network arrives from a bridge address such as `172.18.0.3` and is refused with 403 — NFR-01
> working correctly, not a defect.
>
> Serving it would mean widening that boundary, and the app's **no-authentication** design
> (NFR-07) is defensible *only* because the boundary is tight. Doing it properly implies
> authentication for API consumers, authorisation, transport security, audit logging, and a
> defined trust boundary for the container network — most of what Q9 explicitly excluded.
>
> **What replaces it**: US-25's download, imported manually. Nothing analytical is lost — only
> liveness, which matters little for a dataset whose purpose is analysis over months.
>
> **Escape hatch, available today**: a dashboard installed **on the host** rather than in a
> container reaches the app over loopback and needs no security change whatsoever.
>
> See requirements §5.1 (W-1) for what adopting this would require.

*Persona P3 · No requirement — deliberately, as this is out of scope*

---

## Epic 7 — Assurance

### US-26 — Know nothing outside this machine can reach it ✅
**As** the Listener, **I want** certainty that the app is unreachable from anywhere but this
machine, **so that** running it without a password is a considered decision rather than an
oversight.

**Acceptance criteria**
- [x] Non-loopback connections are refused
- [x] `Host` and `Origin` headers are validated, including on the WebSocket upgrade
- [x] DNS-rebinding forms are rejected
- [x] Container ports are published to `127.0.0.1` only
- [x] Credentials never appear in logs, UI, or the history database

*Covers NFR-01–NFR-07 · Persona P1*

> The no-authentication decision rests entirely on these holding. A property test already caught
> a real IPv6 bypass here (`[::1].a.com`), which is why this is a story rather than an assumption.

---

## Epic 8 — Operations *(added 2026-10-07, Phase 5)*

### US-28 — Move my listening history to another machine, and back ⬜
**As** the Analyst, **I want** to take a backup of my listening history from the running app and restore
it on another installation, **so that** the months of plays I cannot regenerate survive a new machine, a
NAS, or a mistake — without re-arming anything or exposing my credentials.

**Acceptance criteria**
- [ ] *Create backup* downloads one file, and recording does not stop while it is made
- [ ] *Restore backup* shows what the file contains beside my current history **before** I confirm, and
      states that it replaces rather than merges
- [ ] A file that is not a valid backup from this app is refused, and **nothing changes**
- [ ] After a restore, the automation switch is exactly as it was, and my credentials are untouched
- [ ] I can undo the most recent restore once
- [ ] Nothing accumulates on disk from backing up or restoring, beyond the one previous history
- [ ] ⚠️ Performed for real: a corpus backed up from the live app and restored into a second installation, and
      the restored app runs — **on this machine in U6, and across machines (the NAS) in U10** (split 2026-10-07,
      because off-machine browsers are refused until U10; "U9" before 2026-10-18)

*Covers FR-57–FR-64 · Persona P3*

> ⚠️ **Source, recorded so it is not mistaken for a story invented to justify a unit**: the user's own
> question on 2026-10-06 — *"we could backup the data on Rancher Desktop, start up the NAS hosted app and
> once connected restore the data to that environment?"* — and FD Q6 = A / FQ3 = A, which made U6 a
> first-class unit with a story. Until then U6 was recorded as having none, deliberately.

### US-29 — Change my rules and credentials from inside the app ⬜
**As** the Curator, **I want** to change my rules and my credentials from inside the app, on any machine it
runs on, **so that** I can manage an installation whose files I cannot edit — without ever silently losing
rules or breaking recording.

**Acceptance criteria**
- [ ] From the Rules pop-up I can download my rules, upload a changed file, see what it adds, removes and
      changes **before** I confirm, and have it take effect without a restart
- [ ] An upload that would remove all or most of my rules asks me to type a confirmation; an upload based on an
      out-of-date download is refused; an invalid one changes nothing and tells me which rule and field
- [ ] I can undo my last rules change once
- [ ] Changing rules never arms automation
- [ ] In Settings I can replace my Spotify credentials (fields or the config file) with guidance on where each
      value comes from; secrets are never shown back, and I am told the old ones will not be kept
- [ ] ⚠️ If my Spotify credentials are wrong, the Spotify indicator says so — it never reads "ok"
- [ ] When I restore a backup that holds rules, I can choose to restore them too; if I do not, or the restore
      fails, my current rules are untouched

*Covers FR-66–FR-72 · Persona P2 · Source: U7 FD Q8 = A (2026-10-08)*

---

### US-30 — Install it on my own machine, and know each step worked ⬜
**As** the Listener, **I want** to install the app on my own machine with my own Spotify account by following one
document, **so that** I can run it without the person who wrote it — and know at every step that it worked.

**Acceptance criteria**
- [ ] Every step in `docs/INSTALL.md` has a command and the output to expect
- [ ] I register my **own** Spotify app; nothing is shared with another install
- [ ] It works on Windows + Rancher Desktop and on Docker Engine on Linux
- [ ] I can move my history in with *Restore backup*
- [ ] When I finish, the app is recording and its indicators are green
- [ ] No step needs knowledge outside the document

*Covers FR-65, NFR-33 · Persona P1 · Source: U8 FD Q9 = A, Requirements Question 20 (2026-10-12)*

---

### US-31 — Propose a change that CI judges before it reaches `main` ⬜
**As** the Contributor, **I want** to clone the project, run its checks and propose a change through a pull
request, **so that** what reaches `main` has been judged by CI rather than by trust.

**Acceptance criteria**
- [ ] `CONTRIBUTING.md` says how to set up, how to run `npm run verify`, and which path a change takes (a fix by
      PR; a feature through AI-DLC)
- [ ] CI runs typecheck, tests, `smoke` (stated as a load check), `knip` and the secret scan on my PR, and `main`
      cannot take a change that fails them
- [ ] A credential I commit by mistake fails CI
- [ ] The licence (GPL-3.0) tells me what I may do

*Covers NFR-28, NFR-30–NFR-33 · Persona P4 · Source: U8 FD Q9 = A, Requirements Question 20 (2026-10-12)*

---

### US-32 — Run the app from a published image, without the source ⬜
**As** the Listener, **I want** to install the app from a published image, without the source or a build
toolchain, **so that** running it does not require me to be a developer, and my credentials stay on my machine.

**Acceptance criteria**
- [ ] With only Docker and a read token, the image sets up my folder and runs the Spotify sign-in; I never need
      Node or the source
- [ ] My credentials live only in my folder, never in the image or the registry
- [ ] Each step tells me what I should see, and the install ends with the app recording a play
- [ ] The image tells me its licences: GPL-3.0 for the app, MIT for the bundled connector

*Covers FR-74, FR-75 · Persona P1 · Source: U9 FD Q9 = A (2026-10-18). FR-73 (the connector move) is maintenance
and has no story*

---

## INVEST Validation

| Criterion | Finding |
|---|---|
| **Independent** | Mostly. Real dependencies are stated per story rather than pretended away. The genuine chains are US-08 → US-09, US-10 → US-11 → US-13, and US-14 → US-19. US-16 and US-24 sit downstream of both history and rules — they are the last things buildable, and that is inherent, not a modelling flaw |
| **Negotiable** | Yes. Stories state intent and observable behaviour. Two name a specific mechanism (US-08's ISRC join, US-12's `recently-played`) because the mechanism *is* the value — the ISRC join is what makes labels free, and no other backfill source exists |
| **Valuable** | Yes, with one honest exception: **US-09's value is conditional on R1**. Flagged in the story rather than assumed. US-25 is what determines whether that value is real |
| **Estimable** | Yes, except **US-18**, whose pre-warming criterion depends on unverified queue lookahead (R11). Estimable only once that is probed during playback |
| **Small** | Reasonable. **US-14 is the largest** — field catalogue, predicate composition, validation and storage — and is a candidate for splitting during Workflow Planning. Deliberately left whole here because splitting it produces fragments with no independent user value |
| **Testable** | Yes. Every criterion is objectively verifiable. The Given/When/Then stories (US-11, US-14, US-17, US-18, US-19, US-20, US-22, US-24) map directly onto the property-test practice required by NFR-25/26/27 |

---

## Traceability

### Requirements → Stories

| FR | Story | FR | Story |
|---|---|---|---|
| FR-01, 02, 03, 05 | US-01 | FR-25, 30, 31 | US-15 |
| FR-04 | US-02 | FR-27 (history) | US-16 |
| FR-06 | US-03 | FR-32, 33 | US-17 |
| FR-07 | US-04 | FR-34, 35, 36 | US-18 |
| FR-08 | US-05 | FR-37 | US-20 |
| FR-09 | US-06 | FR-38 | US-21 |
| FR-10, 11 | US-07 | FR-39, 40 | US-22 |
| FR-12, 14, 15 | US-08 | FR-41 | US-23 |
| FR-13, 16 | US-09 | FR-42 | US-24 |
| FR-17, 21 | US-10 | FR-43, 45 | US-14 |
| FR-18, 19, 20 | US-11 | FR-44 | US-14 |
| FR-22 | US-12 | FR-46, 47, 48 | US-19 |
| FR-23 | US-13 | NFR-01–07 | US-26 |
| FR-24, 26, 27, 28, 29 | US-14 | FR-49–54 | US-25 |
| | | FR-57–64 | US-28 |
| | | FR-66–72 | US-29 |
| | | FR-65 | US-30 |
| | | NFR-28, 30–33 | US-31 |
| | | FR-74, 75 | US-32 |

**All in-scope functional requirements are covered.** FR-55 was withdrawn on 2026-08-25 and moved
to the wishlist (§5.1, W-1); US-27 is retained as a **deferred** story documenting why, and is
correctly the one story with no requirement.

### Requirements with no story — and why that is correct

NFR-08 to NFR-27 are infrastructure and quality attributes: persistence engine choice, repository
interfaces, rate-limit handling, property-test coverage, CI seeding. They constrain *how* stories
are built rather than describing observable user value, and forcing them into story form would
produce fiction. They remain binding.

### Stories with no requirement — resolved

**Previously US-25 had none.** Raised on 2026-08-25 and resolved the same day by the user's
decision that analysis happens outside the app. That produced requirements FR-49 to FR-54
(§3.5 Export and external analysis), and US-25 was rewritten from "analyse the hypothesis
in-app" to "export the data honestly, as a download".

**US-27 has no requirement by design** — it is a deferred wishlist item (§5.1, W-1), retained so
the reasoning behind the deferral stays visible rather than being deleted and re-litigated later.

**Every in-scope story traces to at least one requirement.**

---

## Summary

| | Count |
|---|---|
| Epics | 8 |
| Stories in scope | 27 |
| Delivered (✅) | 10 |
| New (⬜) | 17 |
| Deferred (⏸) | 1 (US-27) |
| Given/When/Then criteria | 8 stories |
| Checklist criteria | 19 stories |
| Personas | 3 (modes of one user) |

**Open finding:**

**US-18 is not estimable yet** — its pre-warming criterion rests on queue lookahead that is
confirmed reachable but unverified during active playback (R11). This is a Phase 4 concern; see
the [execution plan](../plans/execution-plan.md).

**Now closed:** the export-vs-local-only conflict. Download-only integration means **NFR-01 to
NFR-07 are untouched**, and no security work sits on any phase's critical path.
