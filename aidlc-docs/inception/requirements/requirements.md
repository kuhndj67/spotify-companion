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

*Caveat*: the queue endpoint was probed while nothing was playing and returned an empty queue.
It is confirmed **reachable**, not confirmed **populated during playback**. Verify against
active playback before FR-36 is designed on the assumption it yields useful lookahead.

#### Safety

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-37 | Provide a **dry-run mode** logging what *would* have been skipped, without acting | Must | ⬜ New |
| FR-38 | Provide a **global kill switch** halting all automated action immediately | Must | ⬜ New |
| FR-39 | **Rate-limit** automated skips and halt after consecutive skips exceed a threshold | Must | ⬜ New |
| FR-40 | Never skip the same track twice within one session — a failed skip must not loop | Must | ⬜ New |
| FR-41 | Log every evaluation and action with the **rule, the field values seen, and the verdict** | Must | ⬜ New |
| FR-42 | **Back-test a rule against accumulated history** — "what would this have skipped last month, and did I actually skip those?" | Should | ⬜ New |

**FR-37 to FR-40 are safety requirements, not conveniences**, and they matter more now that
rules are user-authored over arbitrary fields. A rule that matches everything is
indistinguishable, from inside the loop, from a rule working correctly — the only difference is
that the first one empties the queue in seconds. FR-40 covers the specific failure where a skip
does not take effect and the engine re-evaluates the same track forever.

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

---

## 6. Risks and Open Questions

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **The promotion hypothesis may be false.** Signed-vs-independent may not predict skip behaviour | One rule input loses its value; the engine itself is unaffected | FR-19/FR-20 keep raw data re-analysable; dry-run (FR-37) and back-testing (FR-42) test the hypothesis against real history before rules act on it. Treat as a hypothesis to be *tested*, not an assumption to build on |
| R2 | **MusicBrainz coverage is incomplete**, especially for new and independent releases — precisely the population of interest | Systematic missing-data bias, correlated with the variable being measured; label-based rules misfire on the tracks that matter most | FR-16 records `unknown` as a distinct value, never as "independent"; FR-32/FR-33 make `unknown` an explicit tri-state the rule must handle. Track coverage rate as a first-class metric |
| R3 | **Major/indie has no clean definition.** Distribution deals, imprints and majors' "indie" sublabels blur the line | Classification disagrees with intuition | FR-13 stores per-signal votes rather than a boolean verdict |
| R4 | **Skip inference is heuristic**, with several confounders (§3.3) | Noisy outcome variable weakens the model | FR-19/FR-20; NFR-22 property tests; FR-23 excludes app-initiated skips |
| R5 | **A runaway rule** skips an entire queue. Higher now that rules are user-authored over arbitrary fields | User-visible loss of control | FR-37 dry-run, FR-38 kill switch, FR-39 rate limit, FR-40 no-repeat-skip, FR-47 off by default |
| R11 | **Slow fields cannot be resolved before a track starts.** A label lookup is 2 MusicBrainz calls behind a 1 req/sec queue | Label-based rules fire late or not at all — and those are the rules that test R1 | FR-36 pre-warms from the queue endpoint (verified reachable 2026-08-25); FR-34/FR-35 bound the fallback. **Queue lookahead unconfirmed during active playback** |
| R12 | **A rule language over arbitrary fields invites `eval`** | Arbitrary code execution reachable from the rule store, collapsing the §4.1 posture | FR-43 structured predicate tree, FR-44 prohibits code evaluation, FR-45 validates at creation |
| R6 | Upstream `getNowPlaying` returns **markdown**; a template change breaks parsing silently | Display and data collection both stop | NFR-19; raw text surfaced; parser property-tested |
| ~~R7~~ | `MCP_SERVER_REF` was **unpinned** in `compose.yaml` | Silent upstream drift | ✅ **CLOSED 2026-08-25** — pinned to `7b5fde6309a52a7874768c63deda7880ee85935b` (2026-08-21) during U1 Infrastructure Design. The CI Docker-build job is now a genuine drift detector |
| R8 | Upstream MCP server **declares no license** | Blocks open-sourcing later | Accepted for personal use (Q8 = A) |
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
