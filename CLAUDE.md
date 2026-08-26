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
This project has drawn wrong conclusions from documentation **three times**, each caught only by a
live probe:

- `GET /me/following/contains` → **403** despite a valid scope
- `GET /artists/{id}` → returns **no `genres` field at all**
- `GET /me/tracks/contains` → **403**, while `GET /me/tracks` works

**Pattern**: Development Mode blocks the `/contains` membership-check family while leaving list
endpoints open. Workaround is always the same — fetch the set once, cache it, resolve locally.

Credentials are at `secrets/spotify-config.json`; probe scripts follow the pattern in
`research-findings.md`.

---

## Current state (2026-08-26)

**INCEPTION complete. CONSTRUCTION in progress — U1 of 5 units done.**

| Unit | Phase | Status |
|---|---|---|
| U0 Display + enrichment | 0 | ✅ Delivered |
| **U1 Listening history + export** | 1 | ✅ **Built, tested, live-verified** |
| U2 Label enrichment | 2 | ⬅️ **NEXT** |
| U3 Rule model (pure core) | 3 | Pending |
| U4 Rule observability | 3 | Pending |
| U5 Automated skipping | 4 | Pending |

193 tests passing · coverage 99.41% line / 93.00% branch · 68 plays recorded.

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

**Check build exit codes directly.** `docker compose build | tail` reports the *pipe's* exit code.
A failing build once read as success here.

---

## Open items

| # | Item | Owner |
|---|---|---|
| 1 | **Container deployment is blocked** — `localGuard` requires a loopback peer, but published-port traffic arrives from the Docker bridge gateway, so every request is refused. Pre-existing U0 defect. **Security-posture decision for the user**; options in `construction/build-and-test/security-test-instructions.md`. Works today via `npm start` on the host | User |
| 2 | **Liked-status transitions — agreed for U2.** Four states + `unknown`; `kept-unliked` is the reference level, not an observed choice. Design in `research-findings.md` Part 4b | U2 |
| 3 | Backfilled plays carry no ISRC — `recently-played` returns no `external_ids`, so U2's label backfill will skip them unless it fetches per track | U2 |
| 4 | **Completion threshold may misclassify outro skips.** 6 of 17 live plays sit within ±0.03 of 0.90. Retroactively correctable. Revisit with a few hundred plays | Later |
| 5 | R11 — queue lookahead unverified during playback | U5 |

---

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
