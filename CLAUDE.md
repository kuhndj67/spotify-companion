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
This project has drawn wrong conclusions from documentation **four times**, each caught only by a
live probe:

- `GET /me/following/contains` → **403** despite a valid scope
- `GET /artists/{id}` → returns **no `genres` field at all**
- `GET /me/tracks/contains` → **403**, while `GET /me/tracks` works
- MusicBrainz `GET /ws/2/isrc/{id}?inc=releases` → **200 with the `inc` silently ignored**

**Pattern (Spotify)**: Development Mode blocks the `/contains` membership-check family while
leaving list endpoints open. Workaround is always the same — fetch the set once, cache it, resolve
locally.

⚠️ **The fourth one is the dangerous shape.** The first three failed loudly. MusicBrainz returned
**200 and plausible-looking data** — 19 ISRCs that appeared to have no releases at all. It read as
a coverage finding, not a bug, and was caught only by checking a track *known* to have 44 releases.
**A wrong request shape is indistinguishable from absent data.** When a probe says "no data",
verify against a case where you know what the answer must be.

Credentials are at `secrets/spotify-config.json`; probe scripts follow the pattern in
`research-findings.md`.

---

## Current state (2026-09-05)

**INCEPTION complete. CONSTRUCTION in progress — U2 of 5 units approved. Next: U3.**

| Unit | Phase | Status |
|---|---|---|
| U0 Display + enrichment | 0 | ✅ Delivered |
| **U1 Listening history + export** | 1 | ✅ **Built, tested, live-verified** |
| **U2 Label enrichment** | 2 | ✅ **Approved 2026-09-05** |
| **U3 Rule model (pure core)** | 3 | ⬅️ **Next** |
| U4 Rule observability | 3 | Pending |
| U5 Automated skipping | 4 | Pending |

483 tests passing · 99.12% line · 92.70% branch · typecheck clean · **149 plays recorded** (47 completed, 5 skipped, 97 unknown)
· schema v3. The `played_at` duplicates were repaired 2026-09-06 — 84 rows re-timed, 41 deleted,
`integrity_check: ok`, all 65 live trails intact. Backup kept in `data/`.

### 🔒 The hypothesis gate has been pre-registered and run — **INSUFFICIENT DATA**

Pre-registration committed at `fd09ad7` **before** the comparison was computed;
result in `construction/u2-label-enrichment/hypothesis-gate/`. **BR-11.6a**: `n ≥ 50` per group and
`≥ 10` skips. Actual: `major` 8, `independent` 13, **4 skips**. The gate stays open under BR-11.7 —
this run was not the single confirmatory evaluation.

> **R1 is untested, and roughly 215 more live plays (~11 listening sessions) away from being
> testable.** Only 21 of 145 plays can enter the gate; the 104 backfilled plays never will, because
> they lack the observation trail as well as the ISRC. **The instrument can find a strong effect or
> nothing** — detecting 15% vs 25% would need 250 per group.
>
> **This does not gate U3.** Rules are user-authored; they must be valuable *without* R1 being
> settled. Design U3 on that assumption.

### ⏸️ Deliberately paused to collect data (user, 2026-09-05)

U3 is **on hold, not abandoned**. There is no time constraint, and the gate needs listening more
than it needs code. The app now runs **unattended in a container** on Rancher Desktop autostart
(`application.autoStart` + `startInBackground`, plus `restart: unless-stopped`), so the chain is
Windows login → Rancher Desktop → dockerd → app. **Recording does not need the UI** — the poll
loop is a server-side timer, not something a browser drives.

Before resuming U3, check the corpus: `node scripts/hypothesis-gate.mjs`. ⚠️ Under **BR-11.7**,
running it is fine below the minimum but any run *at or above* it is the single confirmatory
evaluation — treat that one deliberately.

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

⚠️ **`Label detail` looked dead and was not.** It renders the label *names* behind a verdict, and
36 of 177 plays have them; it is empty ~80% of the time because **MusicBrainz coverage on recent
releases is ~44%** (open item 3b). It used to render a bare `—`, which is indistinguishable from a
broken field, and was nearly deleted on that basis. It now says `not yet resolved` or `MusicBrainz
lists no label`. **An empty state that does not explain itself will eventually be removed by
someone who assumes it is broken.**

`artistNames` had been broadcast by the server and silently dropped by the client since U2 — two
verdicts, one set of names. Both levels now render, separately labelled and never merged (Q12).

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

**A proportional threshold over a constant-time effect is a confound generator.** The completion
ratio divides by track duration, so anything that removes a fixed number of seconds — a
crossfade, a fade-out, an early track change — costs a short track more ratio than a long one.
If track length correlates with the variable being measured, that is bias rather than noise.
Measured here: majors run ~30% longer than independents. Watch for this shape anywhere a rate
or ratio is thresholded.

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

**A coverage percentage cannot see a file no test imports.** V8 coverage only reports modules
that were actually *loaded*, so an untested file is missing from the **denominator** rather than
counted as 0% — it cannot drag the average down. On 2026-09-06 the suite reported **98.96%** while
`server.ts` (952 lines, nine routes, and the home of the WebSocket `403`) had **no tests at all**.
`--test-coverage-include` does not help; it filters the report and cannot conjure coverage for a
module that never ran — probed with both a directory glob and a file glob. Same family as the
denominator traps below, and the most dangerous of them, because it reads as good news.
`test/noOrphanModules.test.ts` now fails on any module nothing executes unless it is in
`ALLOWED_ORPHANS` **with a reason**. Three files are knowingly untested — `diagnostics.ts`,
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

---

## Open items

| # | Item | Owner |
|---|---|---|
| 1 | ~~Container deployment is blocked~~ — **CLOSED 2026-09-05.** User chose **option B**: `TRUST_PUBLISHED_PORT` disables the peer check *only*, keeping Host/Origin. Verified live — UI `200` on `http://localhost:3010`, cross-site Origin still `403`. **The container is now the running deployment**, on Rancher Desktop autostart. Decision and measurements in `construction/build-and-test/security-test-instructions.md` | ✅ |
| 2 | **Liked-status transitions — agreed for U2.** Four states + `unknown`; `kept-unliked` is the reference level, not an observed choice. Design in `research-findings.md` Part 4b | U2 |
| 3 | Backfilled plays carry no ISRC — `recently-played` returns no `external_ids`. They *do* carry `track_id`, so ISRC is recoverable at **47 one-off `GET /tracks/{id}` calls**. ⚠️ **Established 2026-09-05: spending them adds ZERO eligible plays to the hypothesis gate.** What the backfill lacks for the gate is the **observation trail** (`outcome` is `unknown`), not the ISRC, and no API returns that retroactively. The calls would improve label-coverage statistics only. Decide on that basis → U2 FD **Q7** | Later |
| 3b | **MusicBrainz label coverage is recency-biased, and this is now CONFIRMED TWICE.** Ad-hoc probe 2026-08-26: pre-2022 100%, 2022+ **43%**. Shipped code on a larger corpus 2026-09-05: **86%** / **44%**. The gap is real and stable, not an artefact of the first sample, and stays concentrated on the recent independent releases R1 is about. ⚠️ Measure it **only over ISRC-bearing plays** — see the denominator warning above | ✅ confirmed |
| 4 | **⚠️ The completion threshold is a possible CONFOUND, not just noise.** User listens via Spotify's **AI DJ**, which crossfades. Crossfade removes roughly *constant seconds*; a *proportional* threshold converts that into a penalty scaling inversely with track length. Measured 2026-09-02: **13 of 27** track-change plays sit within ±0.05 of 0.90, and **major tracks are longer** (median 248s) than independent (191s), so an identical crossfade costs independents **~1.3× more ratio**. That biases the *outcome* variable by the *independent* variable. ⚠️ n=10/11, so the duration gap may be chance — the mechanism is not. **User chose to keep 0.90** (2026-09-02); fully correctable retroactively because trails are retained. Revisit once the duration difference is confirmed or dissolved | Later |
| 5 | R11 — queue lookahead unverified during playback | U5 |
| 7 | **Playback context is never recorded for live plays.** `context_type` is NULL on all 35: the MCP `getNowPlaying` returns no context field. Spotify's `/me/player/currently-playing` **does** — probed 2026-09-02, returning `spotify:playlist:37i9dQZF1EYkqdzj48dyYq` (the AI DJ). A DJ play is therefore indistinguishable from a playlist play, and the DJ is algorithmic selection into the feed — arguably the closest available proxy for what R1 calls *promoted*. **User declined for now** (2026-09-02) | Later |
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
npm test           # 483 tests
npm run typecheck  # covers src AND test
npm run auth       # host-side OAuth, once

node scripts/hypothesis-gate.mjs   # the Phase 2 gate (BR-11). Read-only; writes nothing

# The played_at repair. Dry run by default; --apply takes its own backup first.
node scripts/repair-backfill-timestamps.mjs
```

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
