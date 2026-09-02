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

## Current state (2026-09-01)

**INCEPTION complete. CONSTRUCTION in progress — U1 of 5 units done.**

| Unit | Phase | Status |
|---|---|---|
| U0 Display + enrichment | 0 | ✅ Delivered |
| **U1 Listening history + export** | 1 | ✅ **Built, tested, live-verified** |
| U2 Label enrichment | 2 | ✅ **Built, tested, live-verified** |
| U3 Rule model (pure core) | 3 | Pending |
| U4 Rule observability | 3 | Pending |
| U5 Automated skipping | 4 | Pending |

399 tests passing · coverage 98.97% line / 92.14% branch · **120 plays recorded**, 21 with label verdicts.

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

**MusicBrainz throttles at 1 req/sec spacing.** Measured: 6 of 19 tracks took a `503` at 1200 ms —
wider than the policy floor. The bounded retry is load-bearing, not belt-and-braces. Each retry
goes back through the queue, so it spends time, never rate.

**Check build exit codes directly.** `docker compose build | tail` reports the *pipe's* exit code.
A failing build once read as success here.

---

## Open items

| # | Item | Owner |
|---|---|---|
| 1 | **Container deployment is blocked**, and full Rancher Desktop packaging is a **stated goal** (user, 2026-08-31) — so this is a *when*, not an *if*. Host `npm start` is the dev/test deployment meanwhile. **New code must stay container-compatible: no host-only assumptions.** — `localGuard` requires a loopback peer, but published-port traffic arrives from the Docker bridge gateway, so every request is refused. Pre-existing U0 defect. **Security-posture decision for the user**; options in `construction/build-and-test/security-test-instructions.md`. Works today via `npm start` on the host | User |
| 2 | **Liked-status transitions — agreed for U2.** Four states + `unknown`; `kept-unliked` is the reference level, not an observed choice. Design in `research-findings.md` Part 4b | U2 |
| 3 | Backfilled plays carry no ISRC — `recently-played` returns no `external_ids`. They *do* carry `track_id`, so ISRC is recoverable at **47 one-off `GET /tracks/{id}` calls**. Spend them or not → U2 FD **Q7** | U2 |
| 3b | **MusicBrainz label coverage is 58%, and the misses are recency-biased** (pre-2022 100%, 2022+ 43%) — i.e. concentrated on the recent independent releases R1 is about. Measured 2026-08-26, `research-findings.md` Part 5 | U2 |
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
npm start          # run on the host — the working deployment today
npm test           # 193 tests
npm run typecheck  # covers src AND test
npm run auth       # host-side OAuth, once
```

Data lives in `data/` (gitignored): `history.db` plus `snapshots/`.

> ⚠️ **`data/` holds the only artefact here that cannot be regenerated.** Code comes back from git,
> labels from MusicBrainz, enrichment from Spotify — months of play records come back from nowhere.
> Being gitignored makes it *more* exposed to `git clean -xdf`, not less.

---

## Working style that has served this project

Say what is verified and what is not. Several findings here came from probing rather than
assuming, and from noticing that a green test was green for the wrong reason. When a design
decision is a security-posture question, surface it rather than deciding it.
