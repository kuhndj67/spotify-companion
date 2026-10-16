# Requirements — Spotify Now Playing

**Status**: Draft for review · **Date**: 2026-08-25 · **Stage**: INCEPTION — Requirements Analysis

Sources: [`requirement-verification-questions.md`](requirement-verification-questions.md) (round 1),
[`requirements-clarification-questions.md`](requirements-clarification-questions.md) (round 2),
[`../research/research-findings.md`](../research/research-findings.md) Parts 1–3.

---

## 1. Intent Analysis

| Aspect | Assessment |
|---|---|
| **User request** | A locally-deployed container app that displays what Spotify is playing, enriches it with information Spotify's own client does not show, and ultimately intervenes in Spotify's selections to filter out music the user is unlikely to enjoy |
| **Request type** | New Project (greenfield) |
| **Scope estimate** | Multiple Components — web UI, MCP client, Spotify Web API client, external enrichment client, persistence layer, rule engine |
| **Complexity estimate** | Moderate, trending Complex — the display is simple; the promotion-likelihood model and the automated intervention are not |
| **Requirements depth** | **Standard** |

### 1.1 The actual goal, restated

The round-2 answers reframed this project. It is **not** a now-playing display with extras.

> The user's stated aim is to estimate **the likelihood that a given track was *promoted* into
> their feed rather than selected because it fits their profile**, and then to act on that
> estimate by filtering the stream.

The working hypothesis, supplied by the user, is that **signed-artist placements are
disproportionately paid promotion**, and are therefore more likely to be tracks the user won't
enjoy. Signed-vs-independent is a **proxy variable**, not an end in itself.

This has three consequences that drive everything below:

1. The app is a **data collection instrument** first. The statistical model needs play history,
   which needs months of accumulation, which is why persistence is in Unit 1 (CQ4 = A).
2. The **outcome variable is skip behaviour** — whether the user let a track play or skipped it.
   That is the signal the promotion hypothesis is tested against.
3. Stored records must remain **re-analysable**. The hypothesis may be wrong, and the
   classification heuristics will improve. Raw observations are the asset; derived judgements
   are disposable.

---

## 2. Settled Decisions

| # | Decision | Source |
|---|---|---|
| D1 | Hybrid data access — MCP for now-playing and playback control, Spotify Web API direct for enrichment | CQ1 = A |
| D2 | MusicBrainz as the only external source, pulling **label / signed-vs-independent only** | CQ2 = B, narrowed |
| D3 | Unit 1 delivers a **general rules engine** — user-authored rules over any known track field, applied to every new track in every context. The age rule is one instance, not the feature | CQ3 = C, clarified 2026-08-25 |
| D4 | Persistence lands **now**, in Unit 1 | CQ4 = A |
| D5 | Spotify Premium confirmed — the hard prerequisite is satisfied | CQ5 = A |
| D6 | Localhost-only, enforced in code; no authentication | Q7 = A, Q9 = X |
| D7 | WebSocket push for UI updates | Q5 = C |
| D8 | Single container via Compose; no Kubernetes-blocking debt | Q3 = A |
| D9 | Host-side OAuth, token file mounted (`npm run auth`) | Q6 = X → A |
| D10 | Album artwork included | Q2a reversed on evidence |

### 2.1 Capability findings verified live (not from documentation)

Two prior research rounds were wrong where they relied on documentation. Everything below was
confirmed against a live Development Mode token.

| Capability | Status | Verified |
|---|---|---|
| `track.external_ids.isrc` | ✅ Returned — `USUM71703861` | 2026-08-25 |
| MusicBrainz ISRC → release → `label-info` | ✅ Returns `{"label":"UMe","type":"Imprint"}` | 2026-08-25 |
| `user-modify-playback-state` scope | ✅ Already granted — **auto-skip needs no re-auth** | 2026-08-25 |
| `user-read-recently-played` scope | ✅ Already granted — enables history backfill | 2026-08-25 |
| `GET /me/player/currently-playing` when idle | Returns **204 No Content**, not an error | 2026-08-25 |
| `GET /artists/{id}` genres | ❌ Field absent entirely in Development Mode | 2026-08-24 |
| `GET /me/following/contains` | ❌ 403 despite valid scope; use `GET /me/following` | 2026-08-24 |
| `album.label`, `track.popularity` | ❌ Removed Feb 2026 | 2026-08-24 |

**The ISRC finding is what makes D2 affordable.** The join key to MusicBrainz arrives on the
`GET /tracks/{id}` call the enrichment chain already makes — the signed-vs-independent feature
costs **zero additional Spotify requests**.

---

## 3. Functional Requirements

### 3.1 Now-playing display — *implemented and live-verified*

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-01 | Display current track: title, artist, album, progress, duration | Must | ✅ Built |
| FR-02 | Update the display without user action, pushed over WebSocket | Must | ✅ Built |
| FR-03 | Interpolate progress client-side between server ticks, so the bar moves smoothly | Should | ✅ Built |
| FR-04 | Display album artwork, size-selected by measured width | Should | ✅ Built |
| FR-05 | Represent the idle state distinctly — Spotify returns 204, which is not an error | Must | ✅ Built |
| FR-06 | Expose a diagnostics view covering the connect / auth / query cycle | Should | ✅ Built |

### 3.2 Enrichment

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-07 | Show release date, release year and age in whole years | Must | ✅ Built |
| FR-08 | Show whether the user follows the primary artist, via the cached `GET /me/following` set | Must | ✅ Built |
| FR-09 | Show album type, track number, total tracks, explicit flag | Could | ✅ Built |
| FR-10 | Preserve partial enrichment — a failed field must not blank the panel | Must | ✅ Built |
| FR-11 | State *why* a field is unavailable rather than showing a bare dash | Should | ✅ Built |
| FR-12 | Resolve the track's **record label** via MusicBrainz, keyed on ISRC | Must | ⬜ New |
| FR-13 | Classify the label as **major / independent / unknown**, with an explicit confidence | Must | ⬜ New |
| FR-14 | Persist MusicBrainz lookups so a given ISRC is resolved at most once | Must | ⬜ New |
| FR-15 | Serialise MusicBrainz requests to respect its ~1 req/sec limit, off the display path | Must | ⬜ New |
| FR-16 | Degrade to `unknown` when MusicBrainz has no coverage — never block or guess silently | Must | ⬜ New |

**FR-13 design note.** MusicBrainz returns an *imprint name* (`UMe`), not a major/indie flag.
Classification therefore needs a derivation step, and three independent signals are available:

1. **Curated major-label root list** — Universal, Sony, Warner and their known imprints.
2. **MusicBrainz label relationships** — walk `label-rels` to a parent label.
3. **ISRC registrant code** — `USUM71703861` → registrant `UM7` = Universal. Free, already in
   hand, no extra call. Imperfect: distributors register on behalf of independents.

These disagree on real data. FR-13 must record **which signals fired and how they voted**, not
just the verdict, so the classifier can be re-tuned against accumulated history later.

### 3.3 Listening history — *new, the dataset for the promotion hypothesis*

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-17 | Record every observed play: track identity, enrichment snapshot, start timestamp | Must | ⬜ New |
| FR-18 | Record the **play outcome** — `completed`, `skipped`, or `unknown` (three values; `abandoned` retired 2026-08-25, U1 Functional Design Q7) | Must | ⬜ New |
| FR-19 | Store the **raw evidence** behind each outcome (last observed progress, duration, observation gap) alongside the derived verdict | Must | ⬜ New |
| FR-20 | Make outcome classification **recomputable** from stored evidence without data loss | Must | ⬜ New |
| FR-21 | Survive container restart — history is cumulative and must never be reset by a redeploy | Must | ⬜ New |
| FR-22 | Backfill gaps from `GET /me/player/recently-played` when the app was not running | Should | ⬜ New |
| FR-23 | Distinguish a user skip from an app-initiated automated skip | Must | ⬜ New |

**FR-18 is the hard requirement here**, and it is a *derived* signal, not an observed one.
Spotify reports no skip event; outcome must be inferred from the poll loop. Confounders that a
naive "did progress reach duration" check gets wrong:

- The poll interval (3 s default) makes the last observed progress **up to one interval stale**,
  so "completed" needs a tolerance window rather than an equality test.
- **Pause and resume** is not a skip.
- **Seeking** forward can look like natural progression; seeking backward like a restart.
- **Replaying** the same track leaves the track ID unchanged while progress resets.
- **Session end** (device off, 204) is abandonment, not a skip.
- The app's **own automated skips** must never be counted as user dislike — that would
  contaminate the training data with the model's own output (FR-23).

This is why FR-19 and FR-20 exist. The heuristic *will* be wrong at first; storing only its
verdict would silently poison the dataset the whole project depends on.

### 3.4 Rules engine — *new; this is the core feature*

> **User statement, 2026-08-25**: *"The age rule is just an example. What I really want is the
> ability to create one or more rules that are applied to a new track when it starts (not just
> the DJ) and automatically skips it if the rule is satisfied. The rules should be able to be
> applied to any known information about the track."*

This supersedes the earlier reading in which auto-skip-by-age was the headline and other rules
were extensions. The **general mechanism is the requirement**; the age rule is one instance of
it. Three constraints follow directly from that statement and are treated as binding:

- **Universal trigger** — every new track, in every playback context. Not scoped to the DJ.
- **User-authored, plural** — one or more rules, created and managed by the user.
- **Total field access** — a rule may reference *any* known information about the track.

#### Core mechanism

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-24 | Evaluate all enabled rules when a **new track starts**, in every playback context — DJ, playlist, album, radio, search, queue | Must | ⬜ New |
| FR-25 | Support **multiple concurrently active rules**, each independently enabled or disabled | Must | ⬜ New |
| FR-26 | Model a rule as a **structured predicate plus an action**, both stored as data. The action is an **enumerated value**, not a boolean — `skip` is the only member in Unit 1 | Must | ⬜ New |
| FR-27 | Allow a predicate to reference **any field in the track record** — Spotify fields, derived fields, and external-source fields alike | Must | ⬜ New |
| FR-28 | Expose an **introspectable field catalogue** — name, type, domain, and typical availability of every referenceable field | Must | ⬜ New |
| FR-29 | Support composition with **AND / OR / NOT** and comparison operators appropriate to each field's type | Must | ⬜ New |
| FR-30 | Combine independent rules as **OR** — any satisfied rule skips the track. This is the whole combination semantics for Unit 1 | Must | ⬜ New |
| FR-31 | Let the user **create, edit, enable, disable, delete and reorder** rules, persisted across restarts | Must | ⬜ New |

**FR-27 is the demanding one.** "Any known information" makes the rules engine a consumer of
the *entire* track record rather than of a fixed handful of fields, and that record grows as
enrichment sources are added. The engine must therefore be written against the field catalogue
(FR-28), not against a hard-coded field list — otherwise every new enrichment field needs engine
changes to become rule-usable. Fields available at Unit 1:

| Source | Fields |
|---|---|
| Spotify track | title, artist(s), album, duration, explicit, track number, total tracks, album type, ISRC |
| Derived | release date, release year, **age in years** |
| Spotify user | **follow status** for the primary artist |
| MusicBrainz | **label name**, **major/independent classification**, classification confidence |
| Context | playback context type, device, timestamp, time of day |
| History | previous plays of this track, previous skips, plays of this artist |

The **history** row is worth noting: because persistence lands in Unit 1 (D4), rules can
reference the user's own past behaviour — *"skip anything I've already skipped twice"* — without
any new data source.

**FR-30 is deliberately the simplest possible semantics** (user decision, 2026-08-25): any true
rule skips, full stop. No precedence, no exemptions, no ordering significance. Combination
richness may be added later.

Two cheap seams keep that door open without building anything now, consistent with the Q3
"no blocking debt" constraint:

- **FR-26's action is an enum, not a boolean.** An `allow` action, or any other future action,
  becomes a new member rather than a change to the rule shape and a migration of stored rules.
- **Combination lives in one place.** OR-folding across rules is a single function, so
  precedence semantics later replace that function rather than rippling through the engine.

Neither costs anything to honour in Unit 1. Both are considerably cheaper than retrofitting.

#### Evaluation semantics

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-32 | Evaluate predicates as **tri-state — true / false / unknown**. A missing field yields `unknown`, never a silent `false` | Must | ⬜ New |
| FR-33 | Let each rule declare its **behaviour on `unknown`**: treat as no-match (default), treat as match, or hold pending resolution | Must | ⬜ New |
| FR-34 | Evaluate against **fast fields immediately** on track start, then **re-evaluate** if slow enrichment resolves within a bounded window | Must | ⬜ New |
| FR-35 | Enforce a **decision deadline** — past it, act on what is known and record that the decision was made on partial data | Must | ⬜ New |
| FR-36 | **Pre-warm enrichment for upcoming queue entries**, so slow fields are usually resolved before the track starts | Should | ⬜ New |

**FR-32 and FR-33 exist because of R2.** Consider *"skip tracks on major labels"* when
MusicBrainz has no entry. Treating `unknown` as `false` means the rule systematically fails on
exactly the uncatalogued releases the user most wants filtered. Treating it as `true` means
skipping everything MusicBrainz has never heard of. **Neither default is safe**, so the rule
must state which it wants — and the stored record must show that the decision rested on an
unknown, so it can be revisited.

**FR-34 to FR-36 resolve a genuine timing conflict.** The requirement is to skip a track *when
it starts*, but a label lookup is two MusicBrainz calls behind a 1 req/sec queue. Waiting means
the user hears several seconds of a track that should have been skipped; not waiting means
label-based rules — the ones that test the promotion hypothesis — rarely fire at all.

The resolution is to **pre-warm rather than wait**. `GET /me/player/queue` was verified as
**200 / available in Development Mode on 2026-08-25**, so upcoming tracks can be enriched before
they start, making the label known by the time the rule runs. FR-34/FR-35 remain the fallback
for the cases pre-warming cannot cover — a manually chosen track, a context switch, an empty
queue.

~~*Caveat*: the queue endpoint was probed while nothing was playing and returned an empty queue.
It is confirmed **reachable**, not confirmed **populated during playback**. Verify against
active playback before FR-36 is designed on the assumption it yields useful lookahead.~~

##### ✅ CAVEAT DISCHARGED 2026-09-22 — probed during active playback, and the answer is *it depends*

Record: [`../../construction/u5-automated-skipping/probes/r11-queue-lookahead-2026-09-22.md`](../../construction/u5-automated-skipping/probes/r11-queue-lookahead-2026-09-22.md).
⚠️ **Neither outcome the execution plan anticipated.** Lookahead is **context-dependent**:

| Context | Queue depth | Prediction |
|---|---|---|
| Album, autoplay, radio | **7–20 tracks** | Correct **8 for 8**, in order, across a context boundary |
| **The AI DJ** | **0, always** | ⚠️ **0 on all 88 samples**, including at track boundaries |

⚠️ **`context.type` CANNOT tell them apart.** The DJ and a radio station are both `type: playlist`
with the same `37i9dQZF1E` prefix. Nor is *"algorithmic"* the discriminator — autoplay and radio are
algorithmic and fully exposed. **So FR-36 must ask the queue at RUNTIME** and adapt to the answer; it
cannot infer lookahead from the context. Pre-warm depth settled at **3**, re-checked each poll
(U5 plan Q2) — the queue offers up to 20, but each unresolved label is ~2 MusicBrainz calls behind a
1 req/sec queue that label backfill also needs.

⚠️ **This makes the FR-34/FR-35 "fallback" above a heavily-used path, not an edge case** — DJ
listening runs at **50–70%**. **User decision 2026-09-26**: the DJ path is deliberately **not**
relabelled *primary*, because the listening mix will change over time — but **both paths get equal
design attention, and neither may be built as a degraded catch-all.**

⚠️ **The probe also found something bigger than what it was sent to measure**: in the DJ context the
API stops *reporting* a track **18–41 s before it stops playing**. That invalidated 24 of 46 recorded
skips (classifier v2 re-derived them to `completed`) and it now gates **FR-46 and FR-48** — see probe
**P-U5-1** in the U5 Functional Design plan §3.

#### Safety

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-37 | Provide a **dry-run mode** logging what *would* have been skipped, without acting | Must | ⬜ New |
| FR-38 | Provide a **global kill switch** halting all automated action immediately | Must | ⬜ New |
| FR-39 | **Rate-limit** automated skips and halt after consecutive skips exceed a threshold | Must | ⬜ New |
| FR-40 | **A failed skip must not loop** — at most **one skip attempt per play**. ⚠️ **AMENDED 2026-09-26**, see below | Must | ⬜ New |
| FR-41 | Log every evaluation and action with the **rule, the field values seen, and the verdict** | Must | ⬜ New |
| FR-42 | **Back-test a rule against accumulated history** — "what would this have skipped last month, and did I actually skip those?" | Should | ⬜ New |

**FR-37 to FR-40 are safety requirements, not conveniences**, and they matter more now that
rules are user-authored over arbitrary fields. A rule that matches everything is
indistinguishable, from inside the loop, from a rule working correctly — the only difference is
that the first one empties the queue in seconds. FR-40 covers the specific failure where a skip
does not take effect and the engine re-evaluates the same track forever.

##### ⚠️ FR-40 AMENDED 2026-09-26 — the session clause is withdrawn; the guard is keyed on the PLAY

**It previously read**: *"Never skip the same track twice within one session — a failed skip must not
loop."* **User decision 2026-09-26** (U5 Functional Design plan, Q7), approved for amendment.

⚠️ **Two different things were tangled in one `Must`, and only one of them was the real requirement.**

| | |
|---|---|
| *"Never skip the same track twice within one session"* | **Withdrawn.** |
| *"A failed skip must not loop"* | **Kept — and it was always the point**, as the paragraph above already says |

**Why the session clause is wrong, not merely unnecessary.** A recurring track is a **real listening
signal**, which is why `completionRatio` is deliberately never clamped to 1.0. Suppressing a skip
because the same `track_id` was attempted earlier would refuse a rule the user authored, silently,
for a track they chose to hear again — the same class of error as clamping the ratio: hygiene that
destroys signal. The user's words: *if it DOES happen and the rules say skip the track — we should
skip the track.*

**Why the loop guard still has to exist.** Against a 3 s poll loop, a skip that does not take effect
is an unbounded `POST /me/player/next` stream. ⚠️ U5 established that this is **more** likely than it
looked: in the AI DJ context a track stops playing 18–50 s before its nominal end (⚠️ **corrected
2026-09-27** — originally described as the API reporting early; probe P-U5-1 established the reverse, that
**the DJ stops *playing* early and the API reports it accurately**). The obvious confirmation check
(*"is a different track reported now?"*) was feared to **pass when nothing audible happened**; P-U5-1
validated it instead, with a **~3 s grace**, because the audio follows the reported state within ~2 s.
⚠️ **The loop guard is still required** — a skip can still fail for other reasons, and BR-43.9 keeps it
regardless of how the hazard resolved.

✅ **The amended guard: at most one skip attempt per PLAY ROW, never per `track_id`.** A repeat listen
is a new play row, so it stays skippable; a skip that did not land cannot re-fire against the same
row. ⚠️ **And it needs no definition of "session" at all** — the corpus has no session concept, and
the term was the user's informal name for one continuous listening period, never a modelled entity.
Requiring one was the clause's hidden cost.

**FR-42 is where the rules engine and the promotion hypothesis meet.** Once history accumulates,
a proposed rule can be replayed against real listening and scored against what the user actually
skipped. That turns rule authoring from guesswork into measurement, and it is the most direct
test available of whether major-label placement predicts dislike (R1).

#### Representation

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-43 | Represent rules as **structured data** — a predicate tree of field / operator / value nodes | Must | ⬜ New |
| FR-44 | **Never evaluate user input as code.** No `eval`, no `new Function`, no expression-string interpreter with host access | Must | ⬜ New |
| FR-45 | Validate a rule against the field catalogue **at creation time**, rejecting unknown fields and type-mismatched comparisons | Must | ⬜ New |

FR-43 and FR-44 go together. "Rules over any field" invites an expression language, and the
quickest implementation is to `eval` a string. That is rejected: a structured predicate tree is
storable, diffable, back-testable (FR-42), property-testable, and safely renderable in a UI —
and it keeps the local-only security posture (§4.1) from resting on the assumption that nothing
untrusted ever reaches the rule store.

### 3.5 Export and external analysis — *new; added 2026-08-25*

> **User decision, 2026-08-25**: *"Analysis happens outside the app — it doesn't make sense to
> build an analysis tool when there are many good reporting and analysis options out there. This
> does mean we need good export options (including perhaps an API to allow easy interfacing to
> tools like Grafana or others)."*

This closes the gap raised by story US-25 and sets the boundary: **the app is a data collection
instrument, not an analysis tool.** Its obligation is to make the data easy to get at and honest
about its own gaps.

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-49 | Export listening history in **tool-agnostic formats** — CSV and JSON at minimum | Must | ⬜ New |
| FR-50 | Export **every recorded field**, including raw outcome evidence (FR-19) and per-signal label votes (FR-13) — not a summarised view | Must | ⬜ New |
| FR-51 | Represent `unknown` distinctly in exports, and include **coverage counts**, so missing-data bias is measurable downstream | Must | ⬜ New |
| FR-52 | Support **incremental export** ("everything since timestamp T") so it can be scheduled without re-exporting the whole history | Should | ⬜ New |
| FR-53 | Deliver exports as a **file download from the local web UI** — one action, no command line, no separate tooling | Must | ⬜ New |
| FR-54 | Mark exported rows with their **provenance** — live-observed, backfilled (FR-22), or rule-initiated (FR-23) | Must | ⬜ New |
| ~~FR-55~~ | ~~Read-only HTTP data API for dashboard tools~~ — **withdrawn 2026-08-25, moved to §5.1 Wishlist** | — | ❌ Deferred |
| FR-56 | Write a **dated export snapshot automatically on a schedule**, so a backup exists without the user remembering to make one | Should | ⬜ New |

**FR-56 added 2026-08-25** during U1 Infrastructure Design. FR-49–54 describe *user-initiated*
export; automatic snapshotting is a distinct capability and is recorded as a requirement rather
than smuggled in as an implementation detail. Its justification is that **listening history is the
only artefact in this project that cannot be regenerated** — code can be rewritten, labels
re-resolved, but months of play records cannot.

**Scope decision, 2026-08-25**: *"I think we will need a more advanced security architecture
before we support api access to data so lets start by leaving that on a wishlist and only
supporting a simple download (the user can manually import it into tools from there)."*

**The integration mechanism is a download. That is the whole of it.** The user exports a file and
imports it into whatever tool they prefer. No live connection, no data API, no dashboard
integration.

#### Why this is the right call, and what it buys

The alternative — an HTTP data API so a tool like Grafana could query live — ran into a genuine
conflict. `isLoopbackAddress` (`src/localGuard.ts`) accepts only `127.x` and `::1`, so a Grafana
**container** on the Compose network arrives from a bridge address such as `172.18.0.3` and is
refused with 403. That is NFR-01 working exactly as specified, not a defect. Serving a
containerised dashboard would have meant widening the guard — and that guard is the single control
the entire no-authentication decision (NFR-07) rests on.

Choosing download-only means:

- **NFR-01 to NFR-07 remain untouched.** No new network path, no new listener, no exposure
  decision to revisit. The security posture agreed in Q7/Q9 stands exactly as built.
- **No security work is on the critical path** for any delivery phase.
- **Nothing is lost analytically.** A downloaded CSV imports into Grafana, a notebook, Excel or
  anything else. What is given up is *liveness* — dashboards do not auto-refresh — which matters
  little for a dataset whose whole purpose is analysis over months.

The history store remains a local file on a mounted volume as a consequence of NFR-08 and NFR-11.
That it *could* be read directly by another process is a property of the storage choice, **not a
supported integration** — it is unspecified, may change, and nothing is designed around it.

### 3.6 Playback control — *new; this is where the app stops being read-only*

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-46 | Skip to the next track via `POST /me/player/next` | Must | ⬜ New |
| FR-47 | Keep control **off by default** — the app is read-only until explicitly enabled | Must | ⬜ New |
| FR-48 | Confirm a skip took effect; surface a failed skip rather than silently retrying | Must | ⬜ New |

Q4 answered "read-only now, designed for later control". CQ3 = C brings that later forward:
the rules engine is inert without it. The scope (`user-modify-playback-state`) is already
granted, so this is a code change only, with **no re-authentication required**.

### 3.7 Operations — *new 2026-10-07; U6 (Phase 5)*

Added when backlog **W-5** was promoted to unit **U6** (FD Q6 = A). ✅ **Ratified 2026-10-07** in Requirements Analysis (Phase 5 round, Question 12 = A) — they had been written during FD, skipping this step. ⚠️ **FR numbering has so far meant
user-visible behaviour; these are too** — each is something the user does or sees in the Settings pop-up.
Rules: `construction/u6-data-lifecycle/functional-design/business-rules.md` (BR-44…BR-52).

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-57 | **Create backup**: one action produces and downloads a single archive of the listening history (and the authored rules), taken from the running app **without stopping recording** | Must | ⬜ New |
| FR-58 | **Restore backup**: upload an archive, see what it contains beside the current history, confirm, and have it **replace** the active history. An archive that fails verification is refused and **nothing changes** | Must | ⬜ New |
| FR-59 | **Undo last restore**: the history replaced by the most recent restore is kept (exactly one) and can be restored the same way | Must | ⬜ New |
| FR-60 | Credentials are **never** written into a backup, and restore **never** changes them | Must | ⬜ New |
| FR-61 | The automation switch and halt latch are **never** written into a backup, and restore **never** changes them | Must | ⬜ New |
| FR-62 | Backup and restore **leave no files behind** beyond the one previous history (FR-59), including after a failure or crash | Must | ⬜ New |
| FR-63 | A **Settings** pop-up holds backup/restore, export and diagnostics; rules and the automation switch stay on the main screen | Should | ⬜ New |
| FR-64 | **Every file the app accepts from outside** passes one shared admission path that validates it completely before it can affect anything | Must | ⬜ New |

⚠️ **FR-64 is written once here and reused by U7** (rules and credentials ingest). It is a requirement
rather than an NFR because the user asked for it as behaviour: *"use secure patterns… for ALL file ingest
activities"* (FD T2, 2026-10-07).

| FR-65 | **Install routine**: one step list that a person can follow **and** an AI agent can execute — every step carries its **verification command and expected output**. Each user registers **their own** Spotify developer app; nothing is shared between installs. It must be **walked cold** on a clean machine by someone who did not write it | Must | ⬜ New |

**FR-65 added 2026-10-07** (Phase 5 requirements round, Q17 = C, Q17a = A). Owner: **U8**.

⚠️ **FR-56** (*"a dated export snapshot on a schedule… so a backup exists"*) is **not** superseded: it writes
CSV/JSON *exports*, and an export is not a restorable backup. Scheduled **backups** are W-9.

### 3.8 Configuration management — *new 2026-10-08; U7 (Phase 5)*

✅ **Ratified 2026-10-08** in Requirements Analysis (U7 round, Question 19 = A, Question 19a = A) — **before** U7's
Functional Design, from the answers in `construction/plans/u7-functional-design-plan.md` §3/§3a. On an appliance
the user cannot edit host files, so rules and credentials become manageable from inside the app.
**Placement (Q19a = A)**: every rules action is in the **Rules pop-up**, except the opt-in rules choice inside a
backup restore (FR-72); credentials are in **Settings**. FR-63 is unchanged.

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-66 | **Download and upload the rules.** Download gives the current `rules.json`. An upload passes FR-64's admission path and U3's validator **before anything is written**; the user then sees a **comparison** — rules added, removed and changed, by id, and any that would become *disabled with a reason* — and confirms. Applied **without a restart**. A refused upload changes nothing, and the refusal names the rule and field | Must | ⬜ New |
| FR-67 | **A rules write can never silently lose rules.** An upload that removes **every** rule, or **more than half**, needs a typed confirmation. An upload based on an **older version** than the file now on disk is **refused**. A rules write **never** changes the automation switch or halt latch | Must | ⬜ New |
| FR-68 | **Undo last rules change**: exactly one previous rules file is kept and can be put back | Must | ⬜ New |
| FR-69 | **Spotify credentials in Settings**: fields for client id, client secret, redirect URI and refresh token, plus *Upload spotify-config.json* that fills the same form. Saving **requires every field** and **replaces the whole set** — nothing is carried over and **no previous copy is kept**, which the UI states before saving. The secret and refresh token are **never shown back**; the client id is shown partly, the redirect URI in full. **Guidance text** explains how to obtain each value | Must | ⬜ New |
| FR-70 | **MusicBrainz contact in Settings**: one field, shown masked, refused if empty or a placeholder — the rule the app already applies at startup (NFR-14) | Should | ⬜ New |
| FR-71 | **A Spotify failure is never reported as "nothing playing".** When the Spotify connection returns an error, the poll is a **failure**: the Spotify indicator shows it with the reason, and it is not counted as an idle poll (M4). A genuine *nothing playing* still reads as healthy | Must | ⬜ New |
| FR-72 | **Restore can also restore rules — only if asked.** When a backup holds rules, the restore dialog says whether they are identical to or differ from the current ones and offers an **opt-in, unchecked** *"also replace my rules"*, with FR-66's comparison and FR-67's guards. Applied **only if the database restore succeeds**; otherwise, and when not ticked, the current rules are untouched. **Amends FR-58** (U6's BR-48.7 discarded backup rules) | Should | ⬜ New |

⚠️ **FR-71 is a precondition of FR-69, not a companion.** FR-69 writes credentials without checking them first
(U7 FD Q5 = B — *"if the user wants to backtrack they need to do it themselves"*), so the user finds out about a
bad credential **only** through FR-71. It ships no later than FR-69. ⚠️ **Historic M4 figures are unreliable in
both directions** — corrected 2026-10-08 from the source: a text-error poll was counted as **playing**, a thrown
error as **idle** (U7 FD F5–F6). M4 has not yet been used to conclude anything.

Still binding: **FR-60** (restore never changes credentials), **FR-61** (nor the automation state), **NFR-01…04**
(every new route local-only until NFR-29 / U9). Out of scope: a built-in rules editor (later) · in-app Spotify
OAuth (**W-10**).

---

## 4. Non-Functional Requirements

### 4.1 Security and access control

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | Reachable only from the local machine — loopback peer address enforced | ✅ Built |
| NFR-02 | Validate the `Host` header; reject DNS-rebinding forms | ✅ Built |
| NFR-03 | Validate `Origin` on the WebSocket upgrade | ✅ Built |
| NFR-04 | Publish container ports to `127.0.0.1` only | ✅ Built |
| NFR-05 | Never write Spotify credentials into logs, UI, or the history database | ✅ Built |
| NFR-06 | Hold refreshed access tokens in memory only, never written back to `spotify-config.json` | ✅ Built |
| NFR-07 | No authentication — justified solely by NFR-01 through NFR-04 holding | ✅ Accepted |

Per Q9, security is scoped to *guaranteeing local-only access*. Production controls (authn/authz,
TLS, secret managers, audit logging) are deliberately out of scope. **NFR-07 depends entirely on
NFR-01 to NFR-04**: if local-only enforcement is ever weakened, the no-auth decision collapses
with it. A property test already covers this boundary — it caught a real IPv6 bypass.

### 4.1a Phase 5 — sharing, deployment and the repository *(added 2026-10-07)*

From the Phase 5 requirements round (`requirement-verification-questions.md`, Questions 11–17b).

| ID | Requirement | Status |
|---|---|---|
| NFR-28 | **Credentials are never committed.** `secrets/` stays ignored except `*.example.json`; **CI runs a secret scanner on every push**, and a test fails if any tracked file under `secrets/` is not a `*.example.json` | ⬜ New (Q17b = B) |
| NFR-29 | **Off-machine access uses delegated authentication.** The app never handles passwords. Behind a proxy or load balancer that signs the user in (OIDC) and terminates TLS, the app runs in a **trusted-proxy mode** that requires a **verified, signed identity token** on every request — HTTP **and** the WebSocket upgrade, through **one** policy function (`decideAccess`). Local-only stays the default mode | ⬜ New (Q11a = B) |
| NFR-30 | `main` is protected: changes arrive by pull request with required CI checks (typecheck, tests, `smoke`, `knip`, the secret scan); the owner may push directly | ⬜ New (Q13 = B) |
| NFR-31 | `npm run smoke` runs in CI, and the workflow states that there it proves scripts **load**, not that they behave | ⬜ New (Q14 = A) |
| NFR-32 | The project is licensed **GPL-3.0** (`LICENSE` at the root). ⚠️ **No built image is published** while the bundled `spotify-mcp-server` has no licence. *Status 2026-10-16: upstream added **MIT** at `6065ce5c` (issue #106), but `compose.yaml` pins `7b5fde63`, 17 commits earlier and unlicensed. The condition therefore still holds until the pin moves (**W-15**); publishing is then a separate decision* | ⬜ New (Q16 = C) |
| NFR-33 | A short `README` (what it is, status, where to read more), `docs/INSTALL.md`, `CONTRIBUTING.md` and `SECURITY.md` exist and are **accurate** | ⬜ New (Q15 = A) |
| NFR-34 | **Application versions follow Semantic Versioning, pre-1.0 = development.** `0.MINOR.PATCH` — MINOR per delivered unit, PATCH per fix release; `1.0.0-beta.N` once someone else installs it; **`1.0.0` when FR-65's install routine has been walked cold**. After 1.0, MAJOR means *an existing user must act by hand* (an existing `rules.json` no longer loads, an older backup cannot be restored, or credential setup changes); the UI's own HTTP API is not a public interface. **One source of truth, `package.json`**: the image tag, the backup manifest's `appVersion` and the MusicBrainz User-Agent derive from it (`appVersion` leaves `musicbrainz.json`); each release gets a git tag `vX.Y.Z`; rollback uses the previous version's image rather than hand-made `uN-rollback` tags; the version is shown in the UI and `/api/diagnostics`. The **schema version stays separate** | ⬜ New (Q18 = A, 2026-10-12) |
| NFR-35 | **GitHub Issues is the backlog.** Each open W-item and open item migrates to one issue; `requirements.md` §5.1 keeps a **pointer table** (W-id → issue) so old references resolve; new ideas start as issues. A **feature** issue still re-enters AI-DLC before design, and AI-DLC records cite the issue number | ⬜ New (Q21 = A) — U10 |
| NFR-36 | **The AI-DLC records merge cleanly with several writers.** `audit.md` stays append-only and is marked **`merge=union`** in `.gitattributes` (⚠️ **probed** before relied on); `aidlc-state.md` holds **one section per unit**, so concurrent work edits different lines; `CLAUDE.md` holds no current state. The standard AI-DLC file layout is kept | ⬜ New (Q22 = A) — U10 |
| NFR-37 | **Reviews and gates.** The owner approves every AI-DLC gate. `CODEOWNERS` makes the owner a **required reviewer** on `aidlc-docs/` and the security-sensitive paths (local-access guard, upload admission, configuration and credential writers, playback control); any other path needs **one approving review**. The owner may push directly (NFR-30) | ⬜ New (Q23 = A) — U10 |
| NFR-38 | **`CHANGELOG.md`** in Keep a Changelog form: each PR adds its line under *Unreleased*; the **owner cuts a release** — moves *Unreleased* under the version, bumps `package.json`, tags (NFR-34) | ⬜ New (Q24 = A) — U10 |
| NFR-39 | **Contributor tooling**: PR and issue templates (the PR template asks which path — fix or feature — which requirement or BR, and the `npm run verify` result) · **Dependabot** for npm and GitHub Actions, weekly and grouped; ⚠️ the pinned MCP server ref is **never** updated automatically · **one agent-instruction source**: `CLAUDE.md`, with `.github/copilot-instructions.md` and `AGENTS.md` pointing to it · **GitHub Discussions** for questions that are not work items | ⬜ New (Q25 = A+B+C+D) — U10 |

⚠️ **NFR-29 amends NFR-07, it does not repeal it.** In local-only mode, *no authentication* is still justified
by NFR-01…04. Off-machine, that justification is gone, and NFR-29 is what replaces it. ⚠️ **And NFR-28 is not
covered by NFR-05**, which protects logs, the UI and the database — not the repository.

### 4.2 Data and persistence

| ID | Requirement |
|---|---|
| NFR-08 | Persistence must be local, file-backed, and require no separate server process |
| NFR-09 | The store must be schema-aware and queryable for later statistical analysis |
| NFR-10 | Reach the store through a repository interface, so a move to Postgres/k8s needs no call-site changes (Q3 constraint) |
| NFR-11 | Store the database on a mounted volume — a container rebuild must not destroy history |
| NFR-12 | Schema changes must migrate existing rows, never drop and recreate |
| NFR-13 | Persistence failure must degrade the app to display-only, never crash it |

**Recommendation for NFR-08/09**: SQLite via `node:sqlite`, built into Node 22.17 — no native
build step, no extra container. It is flagged **experimental** in this Node version, which
NFR-10's repository interface contains: if the flag becomes a problem, `better-sqlite3` or
Postgres substitutes behind the same interface.

### 4.3 External service behaviour

| ID | Requirement |
|---|---|
| NFR-14 | Send a compliant `User-Agent` identifying the app to MusicBrainz, as their policy requires |
| NFR-15 | Never exceed ~1 request/second to MusicBrainz; serialise through a single queue |
| NFR-16 | MusicBrainz latency must never delay the now-playing display — enrich asynchronously |
| NFR-17 | Handle Spotify 429 with `Retry-After`, and 401 with a single token-refresh retry |
| NFR-18 | Treat every upstream failure as partial data, never as a fatal error |

### 4.4 Reliability, testing, operability

| ID | Requirement |
|---|---|
| NFR-19 | Isolate the markdown parsing of `getNowPlaying` in one module — upstream template changes must fail in a single, tested place |
| NFR-20 | Property-based tests for pure functions and serialisation round-trips (Q10 = B, Partial) |
| NFR-21 | Run the full suite in CI with a logged, replayable seed (PBT-08) |
| NFR-22 | Cover the new outcome-classification logic with property tests — it is pure, derived, and correctness-critical |
| NFR-23 | Recover automatically from MCP subprocess death and WebSocket disconnection |
| NFR-24 | Keep the diagnostics endpoint authoritative as new subsystems are added |
| NFR-25 | Cover **rule evaluation** with property tests: tri-state logic must never collapse `unknown` to `false`, composition must obey De Morgan's laws, and no field value may throw |
| NFR-26 | Rule evaluation must be **deterministic and side-effect free**, so back-testing (FR-42) reproduces live decisions exactly |
| NFR-27 | Rule storage must **round-trip** — a saved and reloaded rule must evaluate identically (PBT-02 serialisation round-trip) |

NFR-22 and NFR-25 are called out specifically. **FR-18's classifier and the rule evaluator are
exactly the kind of code property testing catches bugs in** — both pure, both total, one a state
machine over noisy observations and the other a tri-state logic where the classic failure is
silently collapsing `unknown` into `false`. The existing suite already found four real defects
this way, one of them a security bypass.

---

## 5. Out of Scope

| Item | Reason |
|---|---|
| Genre data | Spotify no longer returns it; user narrowed CQ2 to label only |
| Play counts | Never exposed; `popularity` proxy removed Feb 2026; explicitly dropped |
| Audio-features preference vector | Deprecated Nov 2024, no replacement; AcousticBrainz defunct since 2022 |
| Last.fm integration | Considered as CQ2 option C, not selected |
| Replacing the Spotify client as a player | Q1 named it as the less desirable path |
| LAN or remote access | Q7 = A |
| Kubernetes manifests | Q3 = A — but no k8s-blocking debt permitted |
| Multi-user support | Development Mode caps at 5 users; single-user by design |
| **Exemption / allow rules and rule precedence** | Q-B = OR-only for Unit 1. Deferred, not rejected — seams preserved in §3.4 |
| **In-app analysis, dashboards, charts, statistical modelling** | User decision 2026-08-25 — mature tools exist. The app's obligation is export quality (§3.5), not analysis |
| **HTTP data API / live dashboard integration** | User decision 2026-08-25 — needs a security architecture this project does not have. See §5.1 |
| **Group-alias and comma-in-name artist resolution** | User decision 2026-09-23 — noted, not built. Affects the derived reporting DB only, no rule or gate input. See §5.1 **W-4** |
| **Full user-data backup and restore** | User decision 2026-09-26 — deferred, not dismissed. See §5.1 **W-5**. ⚠️ A **minimal** `history.db` backup/restore is a **U5 prerequisite** for migration 007; W-5 is the full-inventory version, and it includes the `metabase-app-db` named volume that no tree-walking backup would find. ✅ The minimal half was **built and verified 2026-09-27/29** |
| **Adaptive poll backoff when idle** | Measured 2026-09-30 while answering U5 NFR Q8: the 3 s poll is **98.4%** of the app's Spotify footprint and never stops — ~86,000 requests over the 2.5-day idle of 2026-09-29. See §5.1 **W-7**. ⚠️ Deferred because it changes the **recording instrument**, and it is **blocked on the U5 M1–M4 metrics** — without a counter there is no before-and-after |
| **Systematic defect-class detection for an agent-authored codebase** | User question 2026-09-29, after three dead artefacts in eight days that the suite never saw. See §5.1 **W-6**, triggered at the **end of U5**. ⚠️ Two of the six recommendations were **not** deferred — CI entry-point execution and `knip` went into the U5 NFR Design plan (**Q9**, **P-36**) |

### 5.1 Wishlist — deferred, not rejected

Items with a real use case, held back because the work they imply is out of proportion to the
current design.

#### W-1 — Read-only HTTP data API for dashboard tools

**What it would enable**: a tool such as Grafana querying history live, with auto-refreshing
dashboards, instead of the user re-downloading a file.

**Why it is deferred**: the app currently has **no authentication and no authorisation**, by
design. That is safe only because nothing outside the local machine can reach it (NFR-01–04).
Opening a data API to a containerised dashboard means widening that boundary, and once the
boundary is wider, "no auth" stops being defensible. Serving it properly implies most of what
Q9 deliberately excluded:

- Authentication for API consumers — tokens, or mutual TLS
- Authorisation, since a read-only data scope must be genuinely read-only
- Transport security, once traffic leaves the loopback interface
- Audit logging of data access
- A defined trust boundary for the container network, rather than "loopback or nothing"

That is a different security posture from the one agreed in Q9 ("as simple as possible, but
enough to ensure it is only ever accessed by the local system"), and adopting it should be a
deliberate decision, not a side effect of wanting a chart to refresh itself.

**Prerequisite**: a security architecture review that revisits Q7 and Q9 explicitly.

**Interim answer**: FR-53's download, imported manually. If liveness later proves genuinely
necessary, running the dashboard **on the host** rather than in a container reaches the app over
loopback and needs no security change at all — that remains available without any of the above.

#### W-2 — Smart data lifecycle management

**What it would enable**: bounded database growth without losing analytical value.

**Why it is deferred** (user decision, 2026-08-25): *"For now let's keep indefinitely, but a
future task will be to lifecycle manage our data — I think we'll want a smart management routine
and that will take some thought."*

Observation trails accumulate at roughly 28,800 rows/day (~10 M/year at a 3 s poll). SQLite
handles that comfortably, so there is no near-term pressure — and a naive time-based prune is the
wrong answer, because it would delete exactly the raw material FR-20 depends on, irreversibly, on
a timer, with nobody present to judge it.

**Design considerations for when it is taken up**: downsampling trails rather than deleting them
(keeping a sparse progress curve); retaining full trails for plays whose classification was
uncertain; retaining more around tracks that rules acted on; archiving to a cold export before
pruning. Play records themselves are small and should be kept indefinitely regardless.

**Interim policy**: no automatic pruning. A manual prune capability may be added at any time
without a design decision, since it is user-initiated.

#### W-3 — Distinguish a rejection-skip from a session end

**Raised by the user, 2026-09-10**, from lived experience while collecting data for the Phase 2
gate: *"when I want to stop listening to music whatever song is playing is getting marked as a
skip… I'd like to add an algorithm to detect the difference between 'skipping and continuing to
listen' (I don't want to hear this track) and 'ending playback because I need to do something
else' (I may really like the track but have other tasks)."*

**What it would enable**: a `skipped` verdict that means *rejection* and nothing else. That is the
outcome variable R1 is tested against, so a session end recorded as a skip is not noise — it is
contamination of the dependent variable by an event that carries no opinion about the track.

**Why this matters more than an ordinary accuracy improvement**: R4 already records that skip
inference is heuristic. This is a *specific, nameable* confounder within R4, and unlike most of
them it has a clean discriminator available (below).

---

##### ⚠️ Probed 2026-09-10 before the gate run — the corpus shows ZERO instances

This item is recorded as a **design guard, not a repair**, and the distinction must not be lost:

| Check | Result |
|---|---|
| Skips whose `close_reason` is not `track-change` | **0 of 30** — `classify` only ever calls a track change a skip |
| Skips followed by ≥30 min of silence (session-end shaped) | **0 of 30** |
| Skips followed by another play within 30 s | **30 of 30** |
| Session ends in the corpus (≥30 min gap) | 5 landed on `completed`, 4 on `unknown`, **0 on `skipped`** |
| Skips outlasting their own track in wall-clock (paused-and-abandoned shape) | **0 of 30** |
| Max observation gap within any skip | **6 seconds** |

The classifier is currently correct here **by construction**: stopping playback yields
`playback-stopped` or `pause-idle`, and `classify` routes both to `unknown`, never to `skipped`.
Two candidate mechanisms were formed and **both were disconfirmed by probe**:

1. *A paused track keeps returning a payload, so the play stays open and is later closed by
   `track-change`.* Structurally real — `PlayObserver.observe` only closes on a `null` sample or a
   changed `trackId`, and a paused track is neither — but it **has never fired**: every skip's
   wall-clock duration fits inside its own track length.
2. *Session ends are being closed as track changes.* Disconfirmed: every skip has a successor
   within 30 seconds.

**So the user's perception and the recorded data disagree, and that gap is itself the first task.**
The most likely reconciliation is that the low-ratio skips (0.09–0.27, eight of them) are
*remembered* as "I stopped listening" while the instrument saw a genuine track change — but this
is unverified, and W-3 must not be implemented on the assumption that it is right.

##### ⚠️ RE-RAISED by the user 2026-09-19 — re-probed at 504 plays, still ZERO instances

The user raised this again independently, in the same words as before: *"when I'm done listening
the last track ends up incompletely played and I suspect will end up marked as a skip."* The
corpus had grown 427 → **504 plays** (419 live) since the first probe, so it was re-measured
rather than answered from the earlier result.

| Check | 2026-09-10 | 2026-09-19 |
|---|---|---|
| Skips whose `close_reason` is not `track-change` | 0 of 30 | **0 of 31** |
| Skips followed by ≥30 s before the next play | 0 of 30 | **0 of 31** |
| Skips with `ev_ended_with_idle` set | 0 of 30 | **0 of 31** |
| Session-enders (play before a ≥30 min gap, plus the final play) landing on `skipped` | 0 of 9 | **0 of 12** |

The twelve session-enders resolve **7 `completed`, 5 `unknown`, 0 `skipped`**. The five that land
on `unknown` are exactly the partial ones — ratios 0.02, 0.12, 0.24, 0.32, 0.34 — and they close
on `pause-idle` or `playback-stopped`, never on `track-change`.

**The suspected contamination is structurally unreachable**, and the reason is one branch in
`classify`: `skipped` is returned *only* when `closeReason === 'track-change'`. Ending playback
produces `playback-stopped` or `pause-idle`, both of which fall through to `unknown`. A session
end cannot become a skip without that branch being edited.

**But the inverse cost is real, and it is what W-3 should now be scoped against.** Those five
partial session-enders are not contaminating the outcome variable — they are **absent from it**.
The gate's eligibility predicate is `outcome IN ('completed','skipped')`, so every abandoned
last-track is silently dropped from any analysis. At 504 plays that is 5 rows; it grows with
every listening session, and it grows *fastest* for the listener who stops mid-track often.

> **The user's instinct that this data is wrong was right; the direction was inverted.** The
> instrument is not inventing skips — it is discarding session-enders. That reframing changes the
> deliverable: W-3's value is **recovering `unknown` rows into a decidable outcome**, not
> preventing false skips. Anyone picking this up who implements "stop marking session ends as
> skips" will write code that does nothing, and tests that pass because there was never anything
> to fix.

The 2026-09-10 reconciliation paragraph above still stands unresolved: the low-ratio skips are
probably *remembered* as session ends while the instrument saw a real track change. Three cycles
of probing have not moved it, so **do not spend a fourth on the question of why** — the corpus
answers what happened, not what it felt like.

##### The discriminator, when this is taken up

**Do not add a new field first.** The signal is already in the data and is computable
retroactively over the whole corpus, which is exactly the `store observations, derive judgements`
principle (FR-20):

> A rejection-skip is followed by **another play, within seconds**. A session end is followed by
> **silence**. The gap between play *N*'s `ended_at` and play *N+1*'s `started_at` separates them
> cleanly — in the current corpus, 276 of 286 continuations fall under 30 s while every session
> end exceeds 30 min. There is close to no mass in between.

Consequences that make this cheap:

- It needs **no new collection** and **no upstream requests**. It is a window function over `play`.
- It is **retroactively applicable** to every live play ever recorded, so taking it up later costs
  nothing that taking it up now would save.
- It belongs in a **new `CLASSIFIER_VERSION`**, not in a schema change, and `reclassify` already
  exists to re-derive stored verdicts from retained trails.

##### Design considerations

- **The successor gap is not available at close time.** The classifier is pure and per-play; it
  cannot see the next play, which has not happened yet. Either this becomes a derived column
  computed on read, or a deferred second-pass reclassification. **It must not be solved by putting
  a clock or a repository lookup inside `outcomeClassifier`** — that breaks FR-20 and FR-42 while
  every existing test passes (`test/purity.test.ts` is the only guard).
- **The last play of a session has no successor and never will.** It is the one play where the
  discriminator is structurally unavailable, and it is *also* the play most likely to be a session
  end. It must resolve to `unknown` — a fourth outcome value asserting "session-ended" would be a
  judgement the data does not contain, the same error as the 2026-09-06 `unknown` merge.
- **A third outcome value is probably wrong.** `abandoned` looks attractive and would need every
  consumer, export and rule predicate to handle it. Prefer keeping the outcome tri-state and
  recording the session boundary as *evidence*, letting the gate's eligibility predicate exclude
  it — the same shape as BR-11.4's `skip_source <> 'rule'` exclusion.
- **U5 raises the stakes.** Automated skipping introduces a second non-rejection cause of a skip.
  BR-11.4 already excludes `skip_source = 'rule'`; this is the *user-initiated* twin of that
  exclusion and should be designed alongside it, not after.
- **Interaction with open item 4.** Twelve of the thirty skips sit at ratio 0.80–0.90, immediately
  below the completion threshold — the crossfade confound. W-3 and open item 4 both act on the
  same small set of near-threshold plays, and fixing either one changes what the other is looking
  at. Whichever is taken up second must be re-measured, not assumed still valid.

**Prerequisite**: none technically. But it should be sequenced **after** the Phase 2 gate is
discharged, so that a change to the outcome variable cannot be made while a result that depends on
it is being decided.

#### W-4 — Resolve artist-credit ambiguity: group aliases, and commas inside a name

**Raised by the user, 2026-09-23**, on seeing `Inpatient, Ren, Chris Webby` in the display and
reading `Inpatient` as the track name rather than an artist.

**That reading was wrong, and the probe is worth keeping.** `Inpatient` is a genuine Spotify
artist (`5Qqx3JIJnK5mtk7U4tC4Vb`, `GET /artists/{id}` -> 200) and is `artists[0]` on all 15 tracks
of the album **Asylum** *and* on the album itself. It is a **project alias**: its entire
discography is 10 releases, every one of them `Inpatient | Ren | Chris Webby`. There is no track
called `Inpatient`. ⚠️ **So neither Spotify nor the comma-split is wrong here** — do not "fix" the
splitter on the strength of this example.

**What it would enable**: an artist ranking in which every row is a distinct act.

There are **two separate problems**, and they need different mechanisms.

**(a) Group aliases are counted as independent artists.** A duo entity is credited *alongside* its
own members, so one play yields three credits, one of which denotes the other two. Measured over
the 662-play corpus in `artist_credit_totals`:

| rank | artist | artist_plays | |
|---|---|---|---|
| 1 | Ren | 87 | |
| 3 | Macklemore | 50 | |
| 7 | Chris Webby | 24 | |
| **8** | **Inpatient** | **24** | alias of Ren + Chris Webby |
| **12** | **Macklemore & Ryan Lewis** | **17** | alias of Macklemore + Ryan Lewis |
| 13 | Ryan Lewis | 17 | all 17 are the duo's tracks |

⚠️ **This is NOT the by-design overcount.** `SUM(artist_plays) > play count` is correct and pinned
by a test, because a collaboration counts for each *real* collaborator. This is different: a single
credit that denotes a **set of the other credits on the same row**.

⚠️ **A structural detector is not sufficient.** The signature "always lead, identical co-credit set,
>= 2 tracks" finds 4 candidates in this corpus and **3 are false positives** — `Rudimental`,
`Petravita` and `Dal Av` are real bands that merely have fixed collaborators at this sample size.
It is a flag for review, never an automatic rule.

**(b) An artist whose name contains `", "` splits into two artists, silently.** The live path has
**no `artists[]` array at all**: `parseNowPlaying.ts` reads `artist: field(raw, 'Artist')`, and the
MCP `getNowPlaying` returns a pre-joined string. Splitting on `', '` is therefore the only signal
available, not an implementation shortcut, and `Tyler, The Creator` / `Earth, Wind & Fire` /
`Crosby, Stills & Nash` would each become two names.

⚠️ **A wrong split is indistinguishable from a right one in the stored data** — 93 of 234 credited
names carry no Spotify id, because a split record only knows the lead's. Same family as the
`inc=releases` 200: plausible wrong data, not a loud failure. **None are present in the corpus as
of 2026-09-23** — all six `The ...` fragments (`The Big Push`, `The Skinner Brothers`,
`The Plot In You`, `The Devil Makes Three`, `The Haunted Windchimes`, `The Goo Goo Dolls`) are real
bands in lead position, verified. The risk is prospective.

**Two mechanisms proposed (user, 2026-09-23), not mutually exclusive:**

1. **A manual alias tag.** An authored mapping that marks a credit as an alias of a set of other
   credits. Cheap, exact, and auditable; scales with the user's attention rather than the corpus.
2. **A GenAI resolver.** Ask a model whether `Earth, Wind and Fire` is one band or three artists,
   and whether a credit is a group alias. The user's point is that this is a question a language
   model answers well and a parser cannot answer at all, because the information is not in the
   string. ⚠️ **It must write a suggestion for review, never a fact** — `null` means unknown here
   as everywhere else, and a fabricated resolution reaches the artist ranking with nothing marking
   it as inferred. Treat its output as a third provenance alongside `split-live-credit` and
   `spotify-track`.

**Authoritative fallback, if neither is wanted**: `GET /tracks/{id}` returns the true `artists[]`
with ids. ⚠️ **The batch form `GET /tracks?ids=` is 403 in Development Mode** (confirmed with a
single id), so verifying the 119 split-derived multi-artist tracks costs **119 requests**, not one.

**Why it is deferred**: it affects only the *derived* reporting database, not `history.db`, and it
changes no rule input and no gate input. `artist_id` remains the lead artist throughout the app.

**Recommended interim posture**: **mark, do not merge.** Folding an alias's plays into its members
would destroy the fact that the user played the duo's record, which is real listening information.

**Prerequisite**: none. Independent of U5.

---

#### W-5 — Full user-data backup and restore

> ⚠️ **PROMOTED TO A UNIT, 2026-10-06. This is now [U6 — User-Data Lifecycle](../../construction/u6-data-lifecycle/HANDOFF.md)**,
> and it **gates Phase 5**: an off-machine deployment cannot responsibly touch a corpus that cannot be
> moved back. The user asked whether moving a corpus was a prerequisite; it is.
>
> ⚠️ **Three gaps were measured that this entry did not anticipate:** the writer-guard asks the **local**
> `docker ps` and is therefore **blind across machines** (the U4 corruption's shape one layer out); the
> backup covers `history.db` **only**; and **restore is one-way with no merge**, so *migrate* and *run both*
> are different decisions and the second forecloses going back.
>
> ⚠️ **And one thing this entry gets right that must not be lost**: `state/automation-state.json` **must
> not travel**, because restoring a stale latch can **silently re-arm automation**.
>
> Design questions: [`u6-functional-design-plan.md`](../../construction/plans/u6-functional-design-plan.md).
> The text below is the original backlog entry, kept for the record.


**Raised by the user, 2026-09-26**, while deciding how to protect `history.db` during probe P-U5-1:
*"We eventually need a way to FULLY back up all the user specific information (configuration, data,
etc…) and restore it."*

**What it would enable**: one command to capture everything this machine holds that cannot be
rebuilt, and one command to put it back — before a migration, before a risky probe, or after a
failure.

### ⚠️ Why this is not "copy `history.db`" — measured 2026-09-26

| File | Size |
|---|---|
| `data/history.db` | **3.3 MB** |
| `data/history.db-wal` | **4.1 MB** |

**The write-ahead log is currently LARGER than the database it belongs to.** A naive copy of
`history.db` alone would capture **less than half** the corpus, and the copy would open cleanly and
look plausible — the absent-data trap again, in the one artefact that comes back from nowhere.
`reclassify-unobserved-tails.mjs` already knows this and checkpoints the WAL before copying; that
knowledge lives in one script rather than in a shared facility.

### ⚠️ The evidence that the ad-hoc approach has already failed

`data/` currently holds **ten** backups in **five** naming conventions, written by three different
scripts, plus `CORRUPT-snapshot-20260921-201444` and `history-rebuilt.db` left over from the U4
index-corruption incident. **Nothing records which of them is good, what schema version each holds,
or how to restore one.**

⚠️ **And restore has never been written, let alone run.** Every one of those scripts backs up; **not
one reads a backup back.** A backup that has never been restored is a hypothesis, not a backup — the
same standing the project applies to anything unprobed.

### What "fully" has to include — inventory taken 2026-09-26

**Irreplaceable — comes back from nowhere:**

| | |
|---|---|
| `data/history.db` **+ `-wal` + `-shm`** | The play corpus. ⚠️ WAL checkpoint required first — see above |
| `config/rules.json` | User-authored rules |
| **`metabase-app-db`** | ⚠️ **A named Docker volume in a DIFFERENT compose project** (`reporting/compose.yaml`), holding the dashboards and questions built over the Metabase API. It is **not** a bind mount, so it does not appear anywhere in `data/` and would be missed by any backup that walks the project tree. Restoring it needs `docker run --rm -v metabase-app-db:/v …` tar work — a different mechanism from copying a file |
| `state/automation-state.json` | **From U5** — the kill switch and runaway-halt latches. Does not exist yet. ⚠️ **Path amended 2026-10-01** (was `config/`): it lives on a separate `./state:/state:rw` mount so `config/` stays read-only. ⚠️ **W-5 must NOT back this up** — restoring an old latch would silently re-arm automation, and a kill switch recoverable from an archive is not reliably off |

**Derived — regenerable, so restore may skip it:** `data/reporting/reporting.db` (rebuilt in place),
`data/snapshots/` (re-exportable from `history.db`), `data/artist-credits.json`.

**⚠️ Credentials — and this is a SECURITY-POSTURE DECISION, not a packaging detail:**
`secrets/spotify-config.json` is mounted **`rw`** because the MCP server rewrites the refresh token
on its own schedule, and that token is **long-lived and reusable**
([`webApiClient.ts`](../../../src/spotify/webApiClient.ts) documents why nothing else may write the
file). `secrets/musicbrainz.json` and `secrets/metabase.json` sit beside it.

A backup that includes `secrets/` puts **live reusable credentials in plaintext outside the
gitignored tree**, in an archive whose whole purpose is to be copied somewhere safer — which is also
somewhere else. ⚠️ They are also the **only** category that is genuinely recoverable without them
(`npm run auth` re-authorises). **Surfaced, not decided**, per the project's standing rule on
security-posture questions. The obvious candidate answer — *exclude `secrets/`, and have restore
print "now run `npm run auth`"* — should still be chosen deliberately rather than by default.

**Why it is deferred**: the immediate need it was raised against dissolved — probe P-U5-1 does not
need the container running, so `docker compose down` protects the corpus with no new code. Building
an untested restore path to protect a fifteen-minute window would have added risk rather than removed
it.

⚠️ **But it is deferred, not dismissed, and it has a near-term trigger: migration 007.** The U5 plan
and `CLAUDE.md` both require a backup of `data/` before it, and `CLAUDE.md` records that the U4
incident was *"a detour rather than a loss"* **only because a backup happened to exist**. A minimal
`history.db`-only backup/restore with a WAL checkpoint and a refusal to run while the container is up
is therefore a **U5 prerequisite**, tracked on the U5 plan's §4 checklist. W-5 is the full-inventory
version that follows it.

**Requirements this would imply** (numbered when W-5 is scheduled, not before): capture and restore
the full inventory above § checkpoint WAL before any copy § refuse to run against a live writer §
record schema version and app commit in the archive § **verify a restore, because an unverified
restore path is the defect this item exists to fix** § decide the `secrets/` question explicitly.

**Prerequisite**: none technically. ⚠️ The `secrets/` question should be settled before the first
archive is written, because changing your mind afterwards means the earlier archives are already the
thing you decided against.

---

#### W-6 — Defect-class detection for an agent-authored codebase

**Raised by the user, 2026-09-29**, after three dead-or-broken artefacts surfaced in eight days
without the test suite noticing any of them: *"So we seem to be getting a LOT of 'unforced errors'
emerging from the codebase. Things that are dead or don't work as expected and are not being caught
by our test suite. What is the best practice when working with a primarily agent coded app to review
the code and detect problems with it, the pipeline, the test suite or other project tools and
artifacts?"*

**What it would enable**: catching the class of defect this project keeps finding *by accident*,
before it is found by accident.

### ⚠️ The evidence this was raised against — the suite has never caught one of these

Every notable defect in the project record, with how it was actually found:

| Defect | Found by |
|---|---|
| `skip_source` asserted rather than observed | the user noticing *"I never skip Ren"* |
| `played_at` is the END, not the start — 41 duplicate rows | a human seeing one chart number move |
| `RecentlyPlayedBackfill` untested while writing ⅓ of the corpus | the same observation |
| WebSocket `403` — access policy re-implemented and diverged | running the container |
| Three U2 `error`-vs-`unknown` defects | watching a real failure get *recorded* |
| `recordSuccessorLag` / `updateSkipAttribution` dead their whole lives | a manual measurement that needed the field |
| Ten backups with no restore path | reading the U5 plan |
| `npm run reclassify` dead for a week | accident, while fixing the lock guard |
| Six API traps · `fs.watch` · WAL-on-bind-mount · the blind lock guard | probes |

⚠️ **Essentially none were caught by the 891 tests, and that is structural rather than a quality
problem.** The suite does real regression work invisibly; this class is simply outside its reach,
and **coverage actively conceals it** — `test/noOrphanModules.test.ts`'s own docstring records why
(an untested file leaves the *denominator* rather than scoring zero).

### The five categories, and why tests cannot see them

| | Category | Why the suite is blind to it |
|---|---|---|
| **A** | Code nothing executes — dead files, methods, entry points | Untested code leaves the coverage denominator; the orphan check walks **modules, not methods**, and **`src/` only** |
| **B** | Code executed only with inputs that cannot fail it | A check that has never seen bad input is indistinguishable from one that always passes — PBT-22 against always-zero counts |
| **C** | Duplicated knowledge that drifts | Both copies pass their own tests. The WebSocket `403`, `bucketOf`, `USER_SKIP_RATIO_CEILING` |
| **D** | Assertions recorded as observations | **The code does exactly what it says.** `skip_source`, `played_at`, *"loses over half the corpus"*, the lock guard's docstring |
| **E** | Environment mismatches | Tests do not run in the container. SQLite locks not crossing the bind mount, `fs.watch`, `:ro`, Development Mode |

### ⚠️ What is specifically amplified by agent authorship

**1. Co-generated tests share the author's misconception.** When one pass writes both the
implementation and its tests, the tests encode the same mental model — so if the model is wrong,
both are wrong **and they agree**. This is exactly the WebSocket `403`: the tests exercised the
policy function (correct) and nothing exercised the handler (which held a copy), and **all 411 tests
passed**. A human writing tests a week later brings a fresh model; an agent writing them in the same
breath does not.

**2. Agents make things look finished, and a confident comment is the most dangerous artefact in the
repo.** The lock guard shipped with a docstring arguing why it was *"a real test of the dangerous
condition rather than a proxy for it"*. It was blind, and it **outlived the corruption incident it
had failed to prevent**. `reclassify`'s header said it refuses to apply; it could not. ⚠️ A human
writing that sentence is making a claim they feel accountable for; an agent is pattern-matching to
what such a comment usually says — **and the comment then stops the next reader from checking.**

**3. Agents re-implement rather than retrieve.** Three instances: the access policy copied into the
upgrade handler, `bucketOf` re-implemented in `trackPlayStats`, `USER_SKIP_RATIO_CEILING` copied into
`attribute-skips.mjs`.

**4. Agents run the tests, not the app.** Which is why the table above is dominated by *running the
system* and *probing* rather than by CI.

### The deferred items — W-6 proper

⚠️ **Two of the six recommendations were NOT deferred**: *execute every entry point in CI* and
*`knip` for unused exports across `src/` and `scripts/`* went into the **U5 NFR Design plan** (Q9,
P-36) on 2026-09-29, because they are ~an hour together and would have caught two of the last three
findings. **W-6 is the remaining four.**

| | Item | Targets | Note |
|---|---|---|---|
| **W-6.1** | **Mutation testing on the pure core** — `outcomeClassifier`, `predicate`/`ruleEngine`, `playStats`, `factReconstructor`, `statusBar`, `serialisers` | **B** | Measures *would my tests notice if the code were wrong* — the question coverage cannot ask. ⚠️ Direct evidence it is needed: PBT-22 passed trivially against always-zero counts, and that was caught **by hand**. ⚠️ Stryker has **no first-class `node:test` runner**; it would run through the command runner — slower, acceptable on pure modules. ⚠️ **Probe that claim before scheduling** — it is read from documentation, which is exactly what this project does not trust |
| **W-6.2** | **Generate tests from the BR numbers, not from the code** — a session writes tests from `business-rules.md` **without reading `src/`** | **B, C, D** | ⭐ The strongest lever available, and nearly free: the artefact already exists as numbered, individually testable statements written *before* the code. Makes two things measurable — a BR with no test is the coverage gap that matters, and a test not traceable to a BR is probably testing what the code *does* rather than what it *should* |
| **W-6.3** | **Negative control as a convention** — every guard, validator or classifier ships with a case proving it **rejects** | **B** | ⚠️ Independently invented twice already (PBT-22a; `restore-history.mjs --self-test` against the CORRUPT snapshot). Promoting it to a rule is recognising a pattern, not adding one |
| **W-6.4** | **Environment-parity probes in the container** — any claim about locks, mounts, watchers or permissions is probed where the app runs | **E** | The API probe rule, applied to the runtime. ⚠️ The blind lock guard was reasoned about on the **host**. `scripts/post-boot-check.ps1` is the right instrument — **grow it** rather than writing new ad-hoc probes |

**Explicitly rejected**: chasing a coverage percentage. It answers the wrong question, and this
project has already been bitten by its denominator twice.

**Review questions for an agent-authored diff** (cheap, and they catch most of the above):

> *What did this make unreachable? What does it duplicate? What behavioural claim does a comment
> make, and is it tested? Where does this behave differently in the container?*

**Why it is deferred**: none of it blocks U5, and W-6.2 in particular wants a stable business-rules
corpus to work from — U5's BR-33…BR-43 are written but the unit is not built, so tests generated now
would be testing a **design** rather than an implementation. ⚠️ **Deferred, not dismissed**: the
trigger is **the end of U5**, when Phase 4 closes and BR-01…BR-43 are all backed by shipped code.

**Prerequisite**: none technically. ⚠️ W-6.2 must be done by a session that has **not** read the
implementation. That is a process constraint rather than a technical one, and it is the entire point
of the item — **it cannot be relaxed for convenience without becoming the co-generation problem it
exists to break.**

---

#### W-15 — Move the MCP server pin to the MIT-licensed commit

**Raised 2026-10-16** after upstream added an **MIT** licence at `6065ce5c` (issue #106, opened by the owner). ⚠️
**Logged, not built**, and deliberately **not** part of U8's cold walk, which walks `v0.8.1` at the old pin.

**Why it is not a one-line bump**: `7b5fde63` → `6065ce5c` is **17 commits**, including:

1. ⚠️ **`b56bb07` "write the config atomically"**. `compose.yaml` mounts `spotify-config.json` as a **single-file**
   bind mount, and the U7 records rely on the server rewriting it **in place** every hour. A temp-then-rename write
   through a single-file mount fails or **detaches the container's view** (CONTRIBUTING.md, *a single-file bind mount
   binds an inode*). That would break token refresh, possibly silently. **Probe in the `:3011` verification install
   first.** The likely fix is a directory mount for the Spotify config, which touches `CredentialsWriter`'s
   in-place assumption too.
2. **`d7445af` "Migrate to MCP v2"**: protocol and dependency changes against our `@modelcontextprotocol/sdk` client.
3. **Output format** (`10e11f0` "show explicit flag and album name", `read.ts` +115/−83). The live path parses the
   server's **text** (R6), so `parseNowPlaying` may break, and **PBT-66**'s error-template scan must be re-run against
   the new source.

**Then, separately**: whether to **publish** a built image. NFR-32's blocker is gone once the pin moves, but
publishing is a distribution decision, and it touches U9 (could the NAS pull rather than build?) and W-14.

---

#### W-14 — Make the repository public, then move vulnerability reports to GitHub

**Raised 2026-10-12** by the user (U8 FD Q10: *"since the plan is to make the repo public we should have a work item
to shift to GitHub reporting once we do"*). ⚠️ **Logged, not built.** U8 ships `SECURITY.md` with an email address
(Q10 = B) and keeps the repository private on GitHub Pro (Q1 = B).

**Before going public** — an **exposure** decision, and history cannot be un-published:
1. A **full-history secret scan** passes (U8 runs one; re-run it on the day).
2. A review of what the docs disclose: `audit.md` and the design records quote the owner's **listening history**
   (track and artist names with dates), the NAS's **LAN address** (`192.168.0.223`), and the owner's identity. Decide
   per item: accept, redact going forward, or rewrite history (⚠️ rewriting breaks every clone and commit reference).
3. NFR-32 still holds: **no built image is published** while the bundled MCP server has no licence. *(2026-10-16: MIT
   upstream since `6065ce5c`; our pin predates it. See **W-15**.)*

**After going public**: enable **GitHub private vulnerability reporting**, point `SECURITY.md` at it, and keep the
email only as a fallback (or remove it). Branch protection needs no change — public repositories have it free.

---

#### W-13 — A readable JSON export (and a review of how its values are typed)

**Raised 2026-10-09** by the user during hands-on testing (U1-3). ⚠️ **Logged, not built** (no code changes while
testing).

**Part A — DO: make the JSON readable.** The JSON export is valid but written as **one line** (1.36 MB, 1,111 plays,
zero line breaks): `ExportService.ts` streams `{"coverage":…,"plays":[` and then each play as `JSON.stringify(...)`
with no separator. VS Code stops syntax colouring on lines over 20,000 characters (`editor.maxTokenizationLineLength`),
so the file opens looking unrecognised; workaround today is *Format Document* (Shift+Alt+F). Options: indent each play
(still one document, still streamed — write a newline and indentation between records), or **NDJSON** (one play per
line — streams and diffs better, but a different file shape that downstream tools must expect). Size grows modestly.
⚠️ Keep the streaming (memory stays constant regardless of history size) and the `coverage` header.

**Part B — REVIEW, not a required change: are values typed the best way?** Booleans and ids are exported as strings
(`"at_start":"false"`, `"artist_resolution_id":"167"`), because `null` renders as the literal token `unknown`
(`UNKNOWN_TOKEN`, `src/export/serialisers.ts`) and a field must hold either. The user's view (2026-10-09): **if
`unknown` is a valid value, text may well be the right format** — so this is *review to determine the best pattern*,
not a defect. Options to weigh: keep strings (one rule for CSV and JSON, explicit `unknown`) · native types with
`"unknown"` only where unknown (mixed types per field — awkward for typed readers) · native types with JSON `null` plus
the coverage block explaining it (⚠️ conflicts with the project rule that unknown is shown explicitly, never blank).
Whatever is chosen must keep **unknown distinguishable from false and 0** (CLAUDE.md, R2).

#### W-12 — A proper Export dialog instead of a typed format

**Raised 2026-10-09** by the user during hands-on testing (U1-3). ⚠️ **Logged, not built** (user decision, same day —
*"no code changes while I'm testing"*).

**Today**: Settings → **Export history…** calls the browser's `window.prompt('Export format — csv or json?')`, so the
format is **typed**; anything else gets a `window.alert`. It is also the only place in the app that uses the
browser's native dialogs rather than the app's own pop-ups (`public/app.js`, the `export-open` handler).

**Wanted**: choose the format with radio buttons or a dropdown (CSV / JSON) in an app-styled section or pop-up, then
an **Export** button. While there, the route already accepts filters the UI never offers — `since`, `until`
(dates) and `outcome` (`completed` / `skipped` / `unknown`), validated by `validateFilter` in
`src/export/ExportService.ts` — so the dialog could expose them at little cost. ⚠️ Keep the decision text in a pure
`src/ui/` view module, as U6/U7 did — `app.js` has no tests.

**Revisit**: any UI pass; small and self-contained.

#### W-11 — Show a mid-play like without a click

**Raised 2026-10-09** by the user during hands-on testing: a track liked in Spotify **during playback** is not
reflected by the companion's ♥ badge. ⚠️ **Logged, not built** (user decision, same day — *"no code changes at this
time"*).

**It is the display only — the recorded data is right.** `GET /me/tracks/contains` is **403** in Development Mode,
so the badge reads a cached liked set, refreshed at startup and on the 6-hourly backfill tick; the badge is a
**button** that re-reads it (`POST /api/liked/refresh`, hands-on test U0-2). Separately, at every play's close
`captureAtClose` reads **page 1 of `GET /me/tracks`**, whose `added_at` attributes a like to the play window exactly,
plus a 30 s grace for a like made just after the track (BR-9.4). So `liked_transition = liked-during` is recorded
correctly — 65 plays carry it.

**The option**: while a track is playing, re-read page 1 (one request, `limit=50`) about once a minute and update
the badge. Cost ≈ **60 requests/hour**, ~5% on top of the measured ~1,220/hour (98% of which is the 3 s poll).
⚠️ It changes the app's Spotify footprint, so weigh it with **W-7** (idle poll backoff), which reduces it; doing
W-7 first would more than pay for this. Never a per-track `/contains` — that is the 403.

**Revisit when** the badge's lag is observed to mislead in practice, or alongside W-7.

#### W-10 — TLS, so the Spotify sign-in can run inside the app on another machine

**Raised 2026-10-07** in U6 FD (T3). ⚠️ **Accepted as later** (user, same day).

The OAuth redirect is `http://127.0.0.1:8888/callback`, so the sign-in must run on the machine with the
browser; on a NAS the callback lands on the wrong computer. Spotify's documentation says non-loopback
redirect URIs must be **HTTPS** — ⚠️ **unprobed; this project has been wrong about Spotify's docs six
times.** Until then, re-authenticating is *re-run `npm run auth` where the browser is, and put the resulting
file in place* — under **U7**, by upload through FR-64's admission path. Not a reinstall.

**Ties to Phase 5 Q1** (security posture): TLS on the app is a step toward the reverse-proxy option.

#### W-9 — Scheduled backups with off-site upload

**Raised 2026-10-07** in U6 Functional Design (M2). ⚠️ **Considered and deliberately NOT done now**
(user decision, same day).

**Why it is possible now when it was not before**: U6 moves backup **into the app's own process**
(`node:sqlite` `backup()`, probed 2026-10-07 under concurrent writes), so a timer no longer means a second
writer — the reason the U6 plan originally excluded scheduled backups is gone.

**Why it is deferred**: a scheduled backup on the same disk is a copy, not protection against losing that
disk. Its only value is **off-site**, which means building a share-drive or object-store interface — new
credentials, new failure modes, a new outbound surface. U6 instead ships **zip-and-download** (M4): the
user stores the backup wherever they choose.

**Revisit when** the app is "in production" on a host where the user would not notice the disk failing
(e.g. the NAS), or if a manual download is observed to be skipped in practice.

#### W-8 — `confirmed()` compares progress across a track change

**Raised 2026-10-05**, from the live skip sessions. ⚠️ **Deliberately NOT fixed** (user decision, same
day): no unexpected behaviour was observed across five sessions and nineteen skips.

**The measurement.** `confirmed()` requires a track-id change **and** `after.progressMs <
before.progressMs`. Over all 19 fired attempts, `after` was **always 3000 ms** — the incoming track's
first poll sample — so the second condition fails **precisely and only** when the skip fired at 3000 ms,
the earliest sample. One attempt (#20) did, and was recorded `unconfirmed`. Deterministic, not flaky.

⚠️ **The condition is arguably ill-founded rather than merely unlucky**: it compares two positions in
**two different tracks**, which is not a meaningful ordering. It read as correct because a natural
boundary also yields a smaller number, so it passed 18 times by arithmetic coincidence.

**Cost of leaving it.** Bounded and understood. Safety is unaffected — P-30 counts unknown as landed and
#20 did count toward its halt. The only consequence is that FC-U5-1 shows red `Skip unconfirmed` for a
skip that landed, if such an attempt is the most recent.

**Why it is deferred rather than fixed.** ⚠️ **The edit that would fix it is the same shape as the edit
that once made this function always return `true`** — a permanently green light on the one unit that can
cause harm. A cosmetic false negative does not justify touching a safety-adjacent predicate while it is
freshly in service.

⚠️ **If revisited, `<` → `<=` is the WRONG fix.** Since `after` is always 3000 that makes the condition
unfalsifiable while still looking like a check — a decorative guard, which this project has shipped twice
and warns about. The defensible change is to confirm on the track-id change alone and keep both progress
values as recorded evidence (*store observations; derive judgements*).

**Where the detail lives**: the docstring on `confirmed()` in `src/playback/skipDrain.ts`, which carries
the full table.

#### W-7 — Adaptive poll backoff when nothing is playing

**Raised 2026-09-30**, measuring the app's upstream footprint to answer the user's U5 NFR **Q8**
addendum: *"Ideally the app has a 'light touch' on the vendor sites reflecting efficient design."*

**What it would enable**: cutting roughly **98%** of the app's Spotify request volume without
changing what it records.

### The measurement that motivates it

At `POLL_INTERVAL_MS: 3000`, steady state:

| Upstream call | Rate/hr | Share |
|---|---|---|
| **MCP `getNowPlaying` poll** | **1,200** | **98.4%** |
| `GET /tracks/{id}` — once per *distinct* track | ≤16 | 1.3% |
| Token refresh · liked set · followed · `recently-played` | ~4 | 0.3% |

✅ **Everything except the poll is already a light touch, and Development Mode is why.** The
`/contains` family returning 403 forced *fetch the set once, cache it, resolve locally*, so follow and
liked status cost **zero** per-track requests. The sandbox accidentally produced the efficient design.

⚠️ **The poll never stops, and this was observed rather than projected.** On 2026-09-29 no play was
recorded for **~2.5 days** while the container ran healthy — roughly **86,000 requests spent learning
*"nothing is playing"* 86,000 times.** 28,800/day, continuously, music or not.

⚠️ **This is the *efficiency* question and it is independent of Spotify's ceiling.** "Light touch" is
requests per unit of information, not merely staying under a limit — and by that measure the idle poll
is the entire problem.

### Why it is deferred rather than done in U5

⚠️ **It changes the behaviour of the recording instrument** — the one function whose output cannot be
regenerated — and U5 is the unit that exists *because* phases are sequenced by risk containment.
Shaving requests is not worth risking the corpus, and the analysis it needs is its own:

- Backoff may apply **only when nothing is playing**. A longer interval *during* playback would thin
  `PlayObserver`'s trail, and the observer's density is what FR-20's re-derivation depends on.
- ⚠️ **Returning from idle costs precision on the first play**: `startedAt` would be late by up to the
  backoff interval. **Classifier v2 is *probably* robust** — it thresholds `durationMs − maxProgressMs`
  and a max-progress rail, both from Spotify's own `progress_ms` rather than from trail density, and
  dedup keys on the **end**. ⚠️ **"Probably" is doing real work in that sentence. Probe it.**
- ⚠️ It would lengthen the FR-34 blind spot — plays ending before `ENRICHMENT_WAIT_MS` log nothing,
  currently 2.8% of plays.
- ⚠️ A backoff that fails to *exit* is a silent recording outage. The 2026-09-29 scare showed how that
  reads: a healthy container, a live snapshot timer, and no plays — **indistinguishable from "the user
  did not listen"** without a positive liveness signal.

**Prerequisite**: ⚠️ **The U5 M1–M4 metrics come first.** Without a request counter there is no
before-and-after, so the change could not be shown to have worked — and without M4 (share of polls
returning nothing) the waste it targets is not even visible. **Do not implement this before the
metrics that measure it.**

---

## 6. Risks and Open Questions

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **The promotion hypothesis may be false.** Signed-vs-independent may not predict skip behaviour | One rule input loses its value; the engine itself is unaffected | FR-19/FR-20 keep raw data re-analysable; dry-run (FR-37) and back-testing (FR-42) test the hypothesis against real history before rules act on it. Treat as a hypothesis to be *tested*, not an assumption to build on |
| R2 | **MusicBrainz coverage is incomplete**, especially for new and independent releases — precisely the population of interest | Systematic missing-data bias, correlated with the variable being measured; label-based rules misfire on the tracks that matter most | FR-16 records `unknown` as a distinct value, never as "independent"; FR-32/FR-33 make `unknown` an explicit tri-state the rule must handle. Track coverage rate as a first-class metric |
| R3 | **Major/indie has no clean definition.** Distribution deals, imprints and majors' "indie" sublabels blur the line | Classification disagrees with intuition | FR-13 stores per-signal votes rather than a boolean verdict |
| R4 | **Skip inference is heuristic**, with several confounders (§3.3) | Noisy outcome variable weakens the model | FR-19/FR-20; NFR-22 property tests; FR-23 excludes app-initiated skips. **W-3** names the session-end confounder specifically and records the discriminator for it (probed 2026-09-10 and **re-probed 2026-09-19 at 504 plays: still zero instances**). ⚠️ The measured cost runs the *other* way — session-enders land in `unknown` and are excluded from the gate's eligible set, so W-3 is a data-**recovery** item, not a false-skip repair |
| R5 | **A runaway rule** skips an entire queue. Higher now that rules are user-authored over arbitrary fields | User-visible loss of control | FR-37 dry-run, FR-38 kill switch, FR-39 rate limit, FR-40 no-repeat-skip, FR-47 off by default |
| R11 | **Slow fields cannot be resolved before a track starts.** A label lookup is 2 MusicBrainz calls behind a 1 req/sec queue | Label-based rules fire late or not at all — and those are the rules that test R1 | ✅ **DISCHARGED 2026-09-22 — probed during active playback** (this cell read *"Queue lookahead unconfirmed during active playback"* until 2026-09-26). **Lookahead is context-dependent**: album/autoplay/radio expose 7–20 tracks and predict 8 for 8 in order; **the AI DJ exposes none, ever** (0 on all 88 samples). ⚠️ `context.type` cannot distinguish them — both are `type: playlist`. **So FR-36 must ask the queue at runtime**, pre-warming depth 3; and FR-34/FR-35 is a **heavily-used path at 50–70% DJ listening**, not an edge case. ⚠️ The same probe found the effect that invalidated 24 of 46 recorded skips — **originally described as an 18–41 s *reporting* lag, corrected 2026-09-27: the DJ stops *playing* 18–50 s before nominal end and the API reports that accurately** (probe P-U5-1, which also found the FR-46 hazard to be **false**). ✅ **The same probe also explains R11 itself**: the discriminator is **pre-determined vs produced-live**, not *algorithmic* — a pre-determined tracklist can be exposed to the queue endpoint, a live mix has nothing to expose yet. §[R11 record](../../construction/u5-automated-skipping/probes/r11-queue-lookahead-2026-09-22.md) §[P-U5-1 record](../../construction/u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md) |
| R12 | **A rule language over arbitrary fields invites `eval`** | Arbitrary code execution reachable from the rule store, collapsing the §4.1 posture | FR-43 structured predicate tree, FR-44 prohibits code evaluation, FR-45 validates at creation |
| R6 | Upstream `getNowPlaying` returns **markdown**; a template change breaks parsing silently | Display and data collection both stop | NFR-19; raw text surfaced; parser property-tested |
| ~~R7~~ | `MCP_SERVER_REF` was **unpinned** in `compose.yaml` | Silent upstream drift | ✅ **CLOSED 2026-08-25** — pinned to `7b5fde6309a52a7874768c63deda7880ee85935b` (2026-08-21) during U1 Infrastructure Design. The CI Docker-build job is now a genuine drift detector |
| R8 | Upstream MCP server **declares no license** | Blocks open-sourcing later | Accepted for personal use (Q8 = A). ✅ **Resolved upstream 2026-10-16**: **MIT** at `6065ce5c`, after the owner's request (marcelmarais/spotify-mcp-server#106). ⚠️ **Our pin `7b5fde63` predates it**, so the risk is discharged only when the pin moves (**W-15**) |
| R9 | Development Mode restrictions are **permanent** — Extended Quota needs 250k MAU | No route to richer data | Accepted; external sources fill gaps |
| R10 | `node:sqlite` is **experimental** in Node 22.17 | API may change | NFR-10 repository interface makes the engine swappable |

**Closed since round 1**: Spotify Premium (CQ5 = A) and the Q2/Q2a contradiction (CQ1 = A).

### 6.1 Resolved question

**Q-A: Does the age rule apply everywhere, or only to Spotify DJ / algorithmic contexts?**
**Resolved 2026-08-25 — everywhere.** The user clarified that the age rule is only an example,
and that rules apply to every new track regardless of context. Playback context remains
*available* as a field (FR-27), so a user who wants DJ-only behaviour can express that as a
condition within a rule rather than having it imposed by the engine. FR-24 states the universal
trigger.

The original concern still stands as a **usage** caution rather than a design one: a blanket
"skip anything over 5 years old" will also skip deliberately chosen older music. FR-37 dry-run
and FR-42 back-testing exist so that gets discovered before the rule is armed, not after it
skips a favourite album.

### 6.2 Resolved question

**Q-B: Are exemption rules needed — rules that *protect* a track from being skipped?**
**Resolved 2026-08-25 — no, not for Unit 1.** The user chose to keep "any rule is true causes
skip" as the whole semantics, with combination features as a possible future addition.

The known limitation is accepted, not overlooked: *"skip major-label tracks **except** by artists
I follow"* cannot be expressed as one rule under OR-only semantics. It can still be approximated
by folding the exception into the predicate itself — `label = major AND following = false` —
which covers the common case at the cost of repeating the condition in each rule that needs it.

Two forward-compatibility seams are recorded in §3.4 (action as an enum, combination logic
isolated to one function) so exemptions can be added later without migrating stored rules or
reworking the engine. **No open questions remain.**

---

## 7. Summary

The build so far — display, enrichment, artwork, local-only enforcement, diagnostics, 100 tests
and CI — satisfies **FR-01 to FR-11** and most of the security NFRs, verified against live
Spotify.

Round 2 adds four genuinely new capabilities: **label resolution via MusicBrainz** (FR-12–16),
**persistent listening history with skip detection** (FR-17–23), a **general rules engine**
(FR-24–45), and **playback control** (FR-46–48).

The centre of gravity has moved twice. First, this stopped being a display with enrichment
attached and became an instrument for testing a hypothesis about how Spotify fills a feed. Then
the 2026-08-25 clarification moved it again: **the rules engine is the product**. Auto-skip by
age is one instance of a general mechanism in which the user composes rules over any known
property of a track — Spotify's own fields, derived values, external label data, and the user's
own listening history — and the app acts on them automatically.

That reframing is why §3.4 is the largest section, and why it spends most of its length on
things other than matching: what a predicate does when a field is `unknown` (FR-32/33), how a
decision gets made when the data needed to make it is still in flight (FR-34–36), what stops a
mistaken rule from emptying a queue (FR-37–40), and why rules are data rather than code
(FR-43–45). Matching is the easy part. The engine's value depends on the answers to those four
questions being right.

The requirements remain biased toward **keeping raw observations intact** and **treating every
derived judgement as provisional** — now for two reasons. The statistical model that consumes
this data does not exist yet and its first version will be wrong; and the rules the user writes
will also be wrong at first, which is why they can be dry-run (FR-37) and back-tested against
real history (FR-42) before they are ever allowed to skip anything.
