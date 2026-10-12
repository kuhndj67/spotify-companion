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
| `aidlc-docs/inception/requirements/requirements.md` | 72 FRs, 33 NFRs, risks, wishlist |
| `aidlc-docs/inception/research/research-findings.md` | **Live API probe results — authoritative** |
| `aidlc-docs/inception/user-stories/` | 29 stories, 3 personas |
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

## ▶ Current state (2026-10-12 UTC) — ✅ U7 APPROVED. ▶ U8 Team Workflow & Onboarding: **Functional Design written, awaiting approval** — read [`construction/u8-team-workflow/HANDOFF.md`](aidlc-docs/construction/u8-team-workflow/HANDOFF.md). GitHub Pro since 2026-10-12 (branch protection available). Requirements Q18 = A → **NFR-34** (SemVer pre-1.0, `package.json` the one source). ⚠️ **Branch protection (NFR-30) returns 403 on this private free-plan repo** — FD Q1. Arming a rule by upload now needs typed `REPLACE` (BR-54.6). Hands-on list complete.

### Earlier (2026-10-08 UTC) — ✅ U7 DEPLOYED AND VERIFIED (Build & Test 2026-10-09, `construction/build-and-test/u7-build-and-test-summary.md`) — awaiting approval; rollback image `u6-rollback`. 1565 tests. ⚠️ `./config` and `musicbrainz.json` are now `:rw` in compose.yaml (deliberate, IN-U7-1/2) — older notes below saying config stays `:ro` describe U3–U6 — read `construction/u7-configuration-management/HANDOFF.md`. FR-66…72 + US-29 ratified. ⚠️ Broken Spotify credentials currently show PAUSED / "Spotify: ok" (fixed by FR-71). App versioning is Requirements Q18, owned by U8.

### Earlier (2026-10-08) — ✅ U6 DEPLOYED AND VERIFIED. Build & Test complete (`construction/build-and-test/u6-build-and-test-summary.md`). Next unit: U7 Configuration Management. Open: BR-52 legacy-backup cleanup awaits confirmation

⚠️ **U6 Build & Test lesson**: the destructive *Restore* button looked ENABLED while disabled — every test passed, because tests asserted the `disabled` STATE, which was right. Only a screenshot saw it. **Click-test and LOOK at destructive controls.**

⚠️ **PROCESS CORRECTED 2026-10-07: Phase 5 is back on the standard AI-DLC path.** Its questions had been put in
a non-standard `phase-5-plan.md` (now a pointer). ▶ **Open now, in order**: Requirements Analysis
**Questions 11–17a** in [`requirement-verification-questions.md`](aidlc-docs/inception/requirements/requirement-verification-questions.md)
— ⚠️ **Question 12 ratifies U6's FR-57…FR-64, which must happen before U6's FD is approved** — then Units
Generation **Questions 4–5** in [`unit-of-work-plan.md`](aidlc-docs/inception/plans/unit-of-work-plan.md).
✅ **Phase 5 Requirements and Units rounds are COMPLETE (2026-10-07).** Build order **U6 → U7 Configuration →
U8 Team Workflow & Onboarding → U9 Off-machine Deployment** (renumbered that day; older `audit.md` entries use
old numbers). New: **FR-65** install routine · **NFR-28** no credentials in the repo, CI-enforced · **NFR-29**
off-machine access = delegated auth with a **signed-token** check in `decideAccess` · **NFR-30–33** branch
protection, smoke in CI, **GPL-3.0**, docs. ⚠️ **The bundled `spotify-mcp-server` has NO licence** (checked
2026-10-07) — **never publish a built image** until that is resolved.
⚠️ **Do not invent new document types**: inception questions go in those two files; unit questions in
`construction/plans/uN-*-plan.md`.

▶ **Read [`construction/u6-data-lifecycle/HANDOFF.md`](aidlc-docs/construction/u6-data-lifecycle/HANDOFF.md) first.**
The settled answers are [`u6-functional-design-plan.md` §10](aidlc-docs/construction/plans/u6-functional-design-plan.md).

✅ **Backup and restore are IN-APP** — a Settings pop-up with *Create backup* (download) and *Restore
backup* (upload → verify → typed confirm → replace). ✅ **No downtime for backup**: `node:sqlite` `backup()`
on the app's own connection, **probed 2026-10-07 under 281 concurrent writes**. Restore is staged, the app
`exit(0)`s, Docker restarts it (**probed**: `unless-stopped` restarts an exit 0), and the swap happens
**before the database opens**. ⚠️ **One writer does both, so the cross-machine guard problem is DISSOLVED** —
reintroduce a second writer and it comes back. A live quiesce was evaluated and **rejected**.

⚠️ **FR-64 / BR-46: ONE admission path for every uploaded file** — allowlisted archive entries, regular
files only, streaming size caps, magic-byte typing, and an **untrusted-SQLite schema allowlist** (no
triggers or views; the app's schema has none). ⚠️ **The upload routes must not be reachable off-machine
until Phase 5 Q1 is decided.**

⚠️ **Never in a backup: `secrets/` or `state/`.** A restore can never arm automation or change credentials.

**New unit U7 — Configuration Management** (rules + credentials in-app; reopens `config/` `:ro`), also
gating U9. ⚠️ **The install routine** (user, 2026-10-06): each user installs on their own machine with their
own Spotify account — Phase 5 **Q8**.

### Earlier state (2026-10-06) — PHASE 5 OPEN. U6 IS ITS GATE. Phases 0–4 delivered.

▶ **Read [`construction/u6-data-lifecycle/HANDOFF.md`](aidlc-docs/construction/u6-data-lifecycle/HANDOFF.md) first** —
U6's single entry point. Then ~~`phase-5-plan.md`~~ (*retired 2026-10-07 — its questions are now Requirements Questions 11–17a and Units Questions 4–5*)
and [`u6-functional-design-plan.md`](aidlc-docs/construction/plans/u6-functional-design-plan.md) (6
questions). **Nothing in Phase 5 is designed until those are answered. `src/` and `scripts/` are untouched
by U6.**

**Phase 5 — *Share*: off this machine, and off one developer.** ⚠️ **The first phase that adds no
user-facing feature**, and the first whose failure mode is **exposure** rather than a wrong number — so its
miss is not recoverable by recomputing.

⚠️ **THE SINGLE-*USER* ASSUMPTION DOES NOT CHANGE.** Each developer or user runs **their own deployment**
with their own Spotify account and corpus. **Not multi-tenancy**, so no user model is needed for
*separation* — only, possibly, for *access*. What changes is single-**developer** and single-**machine**.

⚠️ **Q1 blocks the phase.** `localGuard.ts:141` requires a **loopback `Host`**, so every off-machine
request 403s — page and WebSocket alike. That is option B (2026-09-05) working as specified. **Replacing it
is a security-posture decision**, and the recommendation is to **resist building auth into the app**: it
must then be implemented twice, once for HTTP and once for the WebSocket upgrade, which is the exact split
that caused the `403` incident.

⚠️ **U6 gates everything**, promoted from backlog W-5. **`db:backup`/`db:restore` already work** — U6
EXTENDS them. Three gaps: the writer-guard asks the **local** `docker ps` and is **blind across machines**
(the U4 corruption one layer out) · the backup covers `history.db` **only** · **restore is one-way with no
merge**, so *migrate* and *run both* are different decisions and the second forecloses going back.
⚠️ **`state/automation-state.json` must NOT travel** — a restored stale latch can **silently re-arm
automation**.

⚠️ **`README.md` is 463 lines describing a "walking skeleton" with "enrichment not built yet"** — for an
app with five delivered units and 977 plays. **The decay pattern on the most public surface.** No `LICENSE`
either, so contributors have no granted rights.

⚠️ **A gap owed from U5**: NFR Q9 specified `smoke` and `knip` **in CI**; both shipped as local npm
scripts and **neither is in `ci.yml`** — exactly the *"eleventh thing nobody runs"* the question warned
about. ✅ CI itself exists and is green on every push.

### Earlier state (2026-10-06) — ✅ U5 COMPLETE AND LIVE-VERIFIED. ALL FIVE UNITS DELIVERED.

**Read [`construction/u5-automated-skipping/live-verification.md`](aidlc-docs/construction/u5-automated-skipping/live-verification.md)** —
the record that closes U5. **Seven live sessions · 29 real skips · 6 runaway halts.**
1256 tests · typecheck clean · smoke green · knip clean · schema **v7** · **973 plays**.

✅ **FR-46/BR-43.1 ANSWERED: a skip costs 1–9 s of the outgoing track, not 18–41 s.** ⚠️ **And the figure
tracks ENRICHMENT LATENCY, not the skip mechanism** — every skip decided on complete data, and the 1 s case
had a warm cache. I reported "6–7 s" at 13 skips and "3–9 s" at 19; **both were sample artefacts stated
more confidently than the evidence supported.** The stable claim is the mechanism, not the number.

✅ **Every BR-35 path has fired live** — 5 `consecutive` halts, **1 `hourly-rate`**, both refusal reasons,
BR-35.9's reset, BR-35.6 surviving a restart, P-30's *unknown counts as landed*, FR-48's *never retry*.

⚠️ **`hourly-rate` needed two of three rules DISABLED and hand-paced separators to reach**, because any
rule broad enough for 10 skips/hour produces 3 adjacent first. **The hourly cap is mostly theoretical at a
consecutive limit of 3**, and the pre-POST `rate-limited` refusal is nearly dead — the halt latches at the
same threshold and is checked earlier.

### ⚠️ EIGHT DEFECTS WERE FOUND LIVE AND NONE BY THE SUITE — and two had PASSING TESTS

The full list is in the verification record §4. The one that outlives the unit:

> ⚠️ **A FIXTURE BUILT AROUND A MENTAL MODEL CONFIRMS THE MODEL.** Twice in two days — the halt's
> off-by-one (*"the counter reads closed plays so it must trail by one"*, which BR-43.4's confirmation
> grace defeats) and the time-window key that failed by **11–14 ms**. Both wrong versions had tests that
> **passed**, because the data was written to match the belief rather than the behaviour. **This is
> invisible to coverage**: the line ran, the assertion ran, and the two agreed with each other and not
> with reality. Neither `knip` nor 100% coverage can see it.

⚠️ **And `skip_source` shows why dead-VALUE analysis is not dead-CODE analysis**: the column was read and
written throughout — just never with `'rule'`, so BR-35's consecutive halt **could not fire at all** while
`safetyCounters.ts` sat at 100% on every axis.

### Earlier state (2026-10-03) — U5 BUILT AND DEPLOYED, INERT

**Read [`aidlc-docs/construction/u5-automated-skipping/HANDOFF.md`](aidlc-docs/construction/u5-automated-skipping/HANDOFF.md) before anything else** — U5's single entry point; the current state is its top block.

✅ **All 13 code-generation steps are done. Migration 007 ran. Schema v7. The container is live on the
new image.** 1228 tests · typecheck clean · `npm run smoke` green · `npm run knip` clean · **885 plays**
· `integrity_check: ok`. **`npm run verify`** runs all four.

⚠️ **NOTHING CAN SKIP A TRACK RIGHT NOW, and that is the delivered state, not an oversight.**
`SKIP_EXECUTOR_ENABLED: "false"` means `SkipExecutor` is **never constructed** — no player client, no
drain, no attempt rows — while the rules engine keeps evaluating and logging exactly as in U4. This is
**BR-40.1's arming gate**: U5 ships inert so the dry-run log can be reviewed *before* anything acts.

⚠️ **TWO OFF SWITCHES, and they are not redundant.** `SKIP_EXECUTOR_ENABLED` answers *is the machinery
built?* (this file + a restart, checked once at startup); `globalAutomationEnabled` answers *may a built
attempt fire?* (one UI click, re-read at **every action point**). Collapsing them breaks FR-38 — a
control needing a restart cannot satisfy *no skip is issued after the switch is thrown*.

▶ **NEXT: THE DRY-RUN REVIEW. It is not code.** Two of the three non-CI exit criteria are now closed:

- ✅ **`probeWritable` against the real `/state` mount, through the container** — `/api/diagnostics`
  reports `writable` as the `node` user, and the kill switch was written and read back **both ways**
  with host and container seeing identical content. ⚠️ **So the write-temp-then-rename survived the bind
  mount** — the inode hazard U3 and U4 could only describe, verified live. A single-file mount would
  have broken on the first kill-switch change.
- ⚠️ **OPEN: the dry-run review that arms the first rule** (BR-40.1). User judgement.
- ⚠️ **OPEN: the first real skip, heard by the user**, confirming it costs 2–3 s rather than 18–41 s.

⚠️ **The BR-35 thresholds are PRE-REGISTERED** —
[`safety-thresholds/pre-registration.md`](aidlc-docs/construction/u5-automated-skipping/safety-thresholds/pre-registration.md),
its own commit, written while `skip_attempt` held 0 rows. It fixes **3 consecutive / 10 per rolling
hour** and what would count as evidence either is wrong. ⚠️ **Expect `3 consecutive` to trip first, not
`10/hour`**: the broadest armed rule matches **145 of 885 plays (16.4%)** against the ~37% needed to
trip the hourly limit at peak — but 16.4% says nothing about **adjacency**, and three consecutive
major-label tracks is an ordinary run inside an album.

⚠️ **A draft of that document said 40%, from `76 / 192`.** Stale gate figures *and* the wrong
denominator — a rule is evaluated against **every** play, and with `onUnknown: 'no-match'` the 482
plays whose label never resolved cannot match, so they belong in the denominator. **It nearly went into
a pre-registration**, the one document whose value is that it was not fitted afterwards.

✅ **ROLLBACK IS VERIFIED LIVE.** U4's image is tagged **`spotify-now-playing:u4-rollback`**. Against a
**v7 copy** it reports `{from: 7, to: 7, applied: []}`, every U4 read path works, and ⚠️ **a U4 INSERT
into a v7 `decision_log` succeeds with `trigger` defaulting to `'initial'`** — the clause that would
have broken had that column been `NOT NULL` with no default. `integrity_check: ok` after that write.
⚠️ **Reading the skip line alone would have proved only that 007 is skipped**, not that U4's code runs
against an unread table and three unread columns.

⚠️ **The UI was click-tested through the container** (Chrome, `localhost:3010`): five status dots with
automation last, `Automation off / disabled / ⊘` and an aria-label carrying the level; the Rules pop-up's
*Automated skipping* section renders the **disabled** button with the server-derived explanation naming
`SKIP_EXECUTOR_ENABLED`; **no console errors or warnings.** WebSocket handshake **101** local and
**403** cross-site Origin — the U4 blind spot still guarded both ways.

### Earlier state (2026-09-27) — U5 FUNCTIONAL DESIGN COMPLETE. PROBE P-U5-1 DISCHARGED.
✅ **All 9 Functional Design questions are answered.** The authoritative reading is
[**`u5-functional-design-plan.md` §5.1**](aidlc-docs/construction/plans/u5-functional-design-plan.md) — not the raw answers in §5.
✅ **Probe P-U5-1 is DISCHARGED (2026-09-27), and BR-43 is written.** Record:
[`aidlc-docs/construction/u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md`](aidlc-docs/construction/u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md).

✅ **THE PREDICTED HAZARD IS FALSE. FR-46 needs no lag guard.** Audio follows the reported track
boundary within **~2 s** in the DJ and essentially simultaneously in radio and album, so a skip at that
boundary costs **2–3 s** of the outgoing track — not the 18–41 s the design plan predicted.

⚠️ **Because the original hypothesis was backwards.** The API never lagged: **the DJ stops *playing*
18–50 s before nominal end and reports it accurately.** `B@first` is the proof — radio/album name the
incoming track at ~1 s of progress, **the DJ at up to 23.6 s**. Classifier v2's **fix stands; its
stated mechanism does not.** No re-derivation needed, and **BR-11.7 is untouched by a change of
explanation.**

✅ **The discriminator is PRE-DETERMINED vs PRODUCED-LIVE** (user's observation) — *not* algorithmic:
radio is algorithmic and behaves exactly like an album. Radio's tracks are chosen ahead of time, the
DJ's as it goes. **This explains R11 with the same cause**: a pre-determined list can be exposed to the
queue endpoint, a live mix has nothing to expose. ⚠️ **So the queue probe FR-36 already performs is
also the transition-regime probe** — `context.type` cannot do it (DJ and radio share the
`37i9dQZF1E` prefix), the queue can. No new field.

⚠️ **New API fact: DJ commentary returns `200` with `item: null`** — not a 204 — for 6.5–7.2 s.
⚠️ **Open question, deliberately NOT concluded**: the live path parses MCP *text*, not this endpoint, so
if a gap there reads as *nothing playing* a commentary gap would close the play and fall through to
`unknown` — meaning part of the `unknown` population would be commentary, not app downtime. **Probe the
MCP surface; do not assert it from P-U5-1.**

✅ FR-48's confirmation is validated: `progress_ms` reset **+** track-id change, with a **~3 s grace**.

✅ **Two `requirements.md` amendments were approved and APPLIED 2026-09-26** (§5.2 of the plan):
- **FR-40 amended.** *"Never skip the same track twice within one session"* is **withdrawn** — it
  would refuse a genuine repeat listen for ever, which is the same mistake as clamping
  `completionRatio` to 1.0. Replaced by **one skip attempt per PLAY ROW**, never per `track_id`: a
  repeat listen is a new row so it stays skippable, while a skip that did not land cannot re-fire.
  ⚠️ **It needs no definition of "session" at all**, which the corpus has never modelled — requiring
  one was the withdrawn clause's hidden cost.
- **R11's caveats discharged** — §FR-36's *"Verify against active playback"* and the R11 risk row's
  *"unconfirmed during active playback"* had read as open since **2026-09-22**.

⚠️ **A probe that WRITES to the player must run with the container DOWN.** P-U5-1 did
(2026-09-27). Each trial skips a track ~0–3 s in, which `outcomeClassifier` files as **`skipped`**, so
4–6 trials would inject artefact skips into a corpus of only 22 real ones. ⚠️ **But "container down"
does not mean nothing records** — `recently-played` remembers, and the backfill imports it on restart.
What protects the evidence base is that backfilled rows are **`unknown`**, which the gate's `ELIGIBLE`
predicate and `BackTestService` both exclude. **Verified after the probe: 0 skipped rows on 2026-09-27.**
A read-only probe (`probe:p-u5-1:mark`) needs no shutdown.

✅ **A backup is NOT a file copy, and the BACKUP + VERIFIED RESTORE PAIR NOW EXISTS** (2026-09-27):
`npm run db:backup -- --label x`, `npm run db:restore -- <dir> --verify-only`,
`npm run db:verify-backups`. Round trip rehearsed end to end on a scratch copy: 850 plays → damaged
to 0 → restored to 850, `integrity_check: ok`.

✅ **AND THE `before-migration-007` BACKUP IS TAKEN AND VERIFIED (2026-09-29)** —
`data/backup-before-migration-007-20260929T172027Z`, schema v6, **all eight checks pass**, 850 plays /
900 decision rows. **Migration 007 is no longer blocked.** Sweep: **1 fully verified · 10 intact but
unverifiable · 1 CORRUPT.**

⚠️ **`npm run reclassify` HAD BEEN DEAD FOR A WEEK — fixed 2026-09-29.** Commit `f864e4e` (classifier
v2) retired `skip_attribution` and removed `ATTRIBUTION_VERSION`/`attributeSkip` from `src/`, but left
the script **importing both**, so the FR-20 re-derivation tool **could not start at all** — a
`SyntaxError` before line one of work. Seven days, and **891 tests stayed green**, because
`test/noOrphanModules.test.ts` walks **`src/`** and `scripts/` is outside it entirely.
⚠️ **`scripts/` is wholly untested and outside every guard**, and this is the **third instance of that
shape in eight days**: `recordSuccessorLag` (dead method in a live file), ten backups with no restore
path, and now a dead entry point. ✅ Repaired by *removing* the attribution half, not restoring the dead
imports (`domain-entities.md` §6 — do not reintroduce it, do not read it). ✅ The repaired script reports
**762 of 762 live plays re-derive identical under v2 — 0 changes**, so the week cost nothing.

⚠️ **THE "LOSES OVER HALF THE CORPUS" FIGURE WAS WRONG — corrected 2026-09-27 by measurement.** The
WAL really can be larger than the `.db` (3673 KB vs 3396 KB, re-measured), but the inference drawn
from that was **false**: a `.db`-only copy of the live database held **824 of 850 plays**. WAL size
tracks **page churn**, not row count. ⚠️ **The corrected reading is MORE dangerous, not less** — the
loss is 3%, confined to the *newest* rows, and the truncated copy reports `integrity_check: ok`. A 50%
loss announces itself; three percent of the most recent plays does not. **Checkpoint first** still
stands; only the stated reason changes. Same shape as the classifier-v2 mechanism correction, and the
same family as the denominator traps below: **a plausible inference from file sizes, recorded as
though it were a measurement.**

⚠️ **ROW COUNTS ARE NOT VERIFICATION, and `data/CORRUPT-snapshot-20260921-201444` is the proof** —
it reports a plausible **586 plays / 126 decision rows** and **fails `integrity_check`**. It is kept
deliberately as the negative control `npm run db:restore -- --self-test` is tested against; the
script errors out if it is missing. ⚠️ And the converse holds: a backup with one play deleted returns
`integrity_check: ok`. **Integrity sees damage, the manifest sees incompleteness, and neither sees the
other's failure** — so verification is both, plus a three-way verdict (`corrupt` / `mismatch` /
`unverifiable`) because conflating them is its own bug.

⚠️ **First sweep result: 0 of 11 existing backups are fully verified and 1 is CORRUPT.** The other ten
are intact-but-unknown — none carried a manifest. The full-inventory version is backlog **W-5**
(the `metabase-app-db` **named Docker volume** that no tree-walking backup would find).

**Functional Design is COMPLETE**: `business-rules.md` (BR-33…BR-43), `domain-entities.md`,
`business-logic-model.md`, `frontend-components.md`. Still documentation-only — `src/` untouched, no
migration, container healthy and recording. **Corpus: 850 plays, 900 decision rows** (2026-09-27).

⚠️ **STAGE SEQUENCE CORRECTED 2026-09-27 — this used to say "Next: the Code Generation plan", which
SKIPS TWO STAGES.** U1–U4 each ran **NFR Design** and **Infrastructure Design** between Functional
Design and Code Generation, and those are where the **LC-\*, P-\* and PBT-\*** numbers are allocated —
the U4 code-generation plan references LC-13…LC-22 and PBT-21…PBT-33 as *inputs*. U5 has none yet, and
it has real infrastructure content (`config/` `:ro` → `:rw`, migration 007). **The user chose the full
sequence**: **NFR Design → Infrastructure Design → Code Generation.** Both stages are *conditional* in
AI-DLC, so skipping them was permissible — but it would have left U5 the only unit with no logical
components, no design patterns and no property obligations, and the `:rw` mount decided inside a code
plan rather than surfaced as posture.

✅ **U5 NFR DESIGN IS COMPLETE (2026-10-01)** — all nine questions answered as recommended, and the
deliverables written: `construction/u5-automated-skipping/nfr-design/` holds **P-27…P-37** and
**LC-23…LC-31** with **PBT-34…PBT-50**. Authoritative reading of the answers:
[`u5-nfr-design-plan.md` §5.1](aidlc-docs/construction/plans/u5-nfr-design-plan.md).

⚠️ **P-30 AMENDS NFR-17 rather than satisfying it**, and this is the one thing in U5 most likely to
be "fixed" by a later reader. NFR-17 says *retry a 429 with `Retry-After`*; for the skip path that
would mean **"skip whatever is playing in 30 seconds"**, so it is declined. The discriminator is **did
the request reach the device?** — a 401 provably did not, so re-issuing *completes* the first attempt;
anything whose landing is **unknown** counts as **landed**. It needs a new `RefusalReason`,
`upstream-rate-limited`, kept distinct from BR-35.2's own hourly cap or the halt's evidence becomes
unreadable. **An NFR quietly not met is a defect; one explicitly amended with a reason is a decision.**

⚠️ **PBT-41 is the only property that can ever catch the P-27 defect.** The safety predicate must be
re-read **at drain time**, not captured when the decision was taken — and checking it at decision time
is **correct in every ordinary test**, diverging only when automation is switched off *during* the 10 s
enrichment wait, which is exactly the case FR-38 exists for. ⚠️ **PBT-34a is a positive control, not
garnish**: a `drain` that posted nothing, ever, would satisfy all six refusal properties perfectly.

Two more answers worth knowing: **Q3** resolves a real conflict between **NFR-17's
*retry a 429* and BR-43.5's *never retry a skip*** — the discriminator is *did the request reach the
device?*, and honouring a 30 s `Retry-After` would mean *"skip whatever is playing in 30 seconds"*;
and **Q5** keeps the kill switch **asymmetric**, because the obvious *"don't change state if you
couldn't persist it"* means **the user pressed stop and the system kept going.**

✅ **ALL THREE U5 DESIGN STAGES ARE COMPLETE (2026-10-01)** — Functional, NFR and Infrastructure,
every question answered as recommended.

▶ **NEXT: [the U5 Code Generation plan](aidlc-docs/construction/plans/u5-code-generation-plan.md) —
written 2026-10-01, 2 scoping questions open.** It is the first U5 stage that touches `src/`.

✅ **Infrastructure Q1 = C overturned a settled FD answer.** The kill-switch state file moves from
`config/automation-state.json` to a **new `./state:/state:rw` mount**, and **`config/` stays `:ro`**.
`:rw` on `config/` would have granted the app permission to overwrite the user's hand-authored
`rules.json` — a permission no U5 code would use. ⚠️ **And BR-20.8 would not have protected it**: that
path reloads the last-known-good set when a new file **fails to parse**, and a file truncated to
valid-but-empty JSON parses fine. ⚠️ **`data/` was rejected because of restore** — once W-5's
full-inventory backup exists, restoring a week-old backup would restore the week-old latch and
**silently re-arm automation**. Seven already-written statements were amended as a consequence (BR-34.1,
34.3, 34.4, the BR header, `domain-entities.md` §2, `frontend-components.md` §2, LC-29, W-5's inventory).

✅ **The planned AI-authored rules system strengthens that split rather than weakening it**: a kill
switch stored in the same writable directory as the file an AI agent edits is a kill switch that agent
can disable.

⚠️ **Three U5 items are open that are neither code nor design.** Do not let code generation close them
by implication: the two `compose.yaml` comment corrections, the **live rollback check** (U4's image
against a v7 copy, expecting `from: 7, to: 7`), and the **BR-35 pre-registration**, which must be
written before any rule is armed.

▶ **NEXT: [the U5 Infrastructure Design plan](aidlc-docs/construction/plans/u5-infrastructure-design-plan.md) — written 2026-10-01, 6 questions open.**

⚠️ **Its Q1 deliberately revisits a settled answer.** NFR Q5 settled `config/automation-state.json`,
and that stands on everything it considered — **but `./config:/config:rw` grants the app write access
to the user's hand-authored `rules.json`**, which U3 and U4 deliberately prevented and which BR-20.8's
last-known-good path does not protect (it survives a *malformed* rules file, not a *truncated* one the
app wrote). Recommendation is a separate **`./state`** mount. ⚠️ **`data/` is the trap**: a future W-5
full-inventory **restore could silently re-arm automation**, and a kill switch resurrectable by a
database restore is not a kill switch.

⚠️ **`compose.yaml:174–182` is right in outcome and wrong in reasoning.** It says `:rw` arrives
*"in the unit that adds RULE EDITING"*. Under Q1 = C that conclusion holds — U5 writes nothing to
`config/` — but the reasoning implies rule editing is the only thing that could make the directory
writable. **The rule to state instead: `config/` holds user-authored intent and the app never writes
it; app-written state lives in `./state`.** That comment was already corrected once (2026-09-21) for
naming the wrong *unit*; leaving the wrong *reason* is how it goes stale a third time.

⚠️ **The BR-35 safety thresholds must NOT become env values** (Q4). Every other cadence here is one,
which is exactly why it needs saying — and the limit is **reachable by a legitimate rule**: the
busiest rolling hour holds **27 plays**, so 10/hour trips on anything matching **>37%** at peak. The
moment it is an env var, the obvious fix is to raise it and the guard becomes decorative. Precedent:
the gate's thresholds are *"pre-registered constants, not parameters"*, and `MAX_PREDICATE_DEPTH` is
*"only the PATH is configurable; the bounds are not."*

⚠️ **Once armed, a REBOOT RESUMES SKIPPING** (Q5) — unattended, on the autostart chain. FR-47's
*"off by default"* means fresh install, not fresh boot.

⚠️ **THE 3 s POLL IS 98.4% OF THE APP'S SPOTIFY FOOTPRINT, AND NOTHING COUNTS REQUESTS AT ALL.**
Measured 2026-09-30 for Q8's addendum: **1,200 of ~1,220 requests/hour** is the `getNowPlaying` poll;
`GET /tracks/{id}` is **≤16/hr** because enrichment is cached per *distinct* track. ✅ **Everything
except the poll is already a light touch, and Development Mode is why** — the `/contains` 403s forced
*fetch the set once, cache it, resolve locally*, so follow and liked status cost **zero** per-track
requests. **The sandbox accidentally produced the efficient design.**

⚠️ **The poll never stops.** The 2026-09-29 scare showed ~**2.5 days with no play recorded** while the
container ran healthy — roughly **86,000 requests spent learning *"nothing is playing"*.** Idle backoff
is backlog **W-7**, deliberately *not* in U5 because it changes the **recording instrument**.

⚠️ **"What is a reasonable rate?" is UNANSWERABLE TODAY, and that is the finding.** MusicBrainz
publishes 1 req/sec (complied with, and **already probed tighter than the published floor** — 6 of 19
tracks took a 503 at 1200 ms spacing). **Spotify publishes no number at all** — only *"rolling 30-second
windows"*, differing by app mode. The app sits at **10 requests per 30 s window**; whether that is 10%
or 90% of the ceiling is not derivable from documentation. The only possible evidence is observed 429s,
and `webApiClient.ts:125` **throws the `Retry-After` away inside a message string**. So metrics
**M1–M4** are the prerequisite for the research, not a parallel task — pattern **P-37: a limit you
cannot see is a limit you cannot respect.** ⚠️ **And a clean counter would bound nothing except "below
the limit"** — do not read zero 429s as headroom.

## Earlier state (2026-09-22)

**U5 STARTED. R11 DISCHARGED. THE OUTCOME VARIABLE WAS WRONG AND IS FIXED.**
851 tests · typecheck clean · schema v6 · **662 plays** · `src/playback/` still absent.
*(as of 2026-09-22. Now **891 tests**, **850 plays**, 900 decision rows — 2026-09-27.)*

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

⚠️ **THIS MECHANISM STATEMENT IS BACKWARDS — corrected 2026-09-27 by probe P-U5-1. The FIX below
stands unchanged; only the explanation was wrong.** The API never lagged: **the DJ stops *playing* a
track 18–50 s before its nominal end, and reports that accurately.** Proof is `B@first` — radio and
album name the incoming track at ~1 s of progress, the DJ at up to **23.6 s**. So `progress_ms` is
accurate in pre-determined contexts and the tails are **real edits**. Record:
`construction/u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md`. The original
text follows.

~~**In the DJ context the API stops reporting a track ~18–41 s before it stops playing.**~~ The play
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
| **U5 Automated skipping** | 4 | ✅ **Complete and live-verified 2026-10-06** |

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

### ✅ The autostart chain is PROVEN for REBOOT — and that is narrower than it reads

⚠️ **Scoped 2026-10-01.** The 2026-09-05 reboot test below is sound and is **not withdrawn**. But it
proved **reboot**, and on **2026-09-30 recording was silently down ~13 hours** from a failure mode it
has never exercised: **a WSL update installed by Windows Update *during Modern Standby* tore down the
WSL VM** (`Windows Subsystem for Linux` service set to `disabled` at 13:06:39, vmswitch port deleted
at 14:42:40). `dockerd` stops mid-sentence — no SIGTERM, no shutdown message. **Resume plus a
host-component update is far more common than a reboot.**

⚠️ **Modern Standby alone is NOT the cause.** The machine enters standby dozens of times a week and
recording survives nearly all of it, **including a 5 h 07 m standby the same morning**. Nor is
duration the discriminator. **Check the standby base rate before blaming a sleep** — it is one query,
and it refutes the obvious story.

✅ **`restart: unless-stopped` did its job** — the container revived **by itself** once dockerd
returned, with **zero data loss** (853 plays, `integrity_check: ok`, identical either side; the
morning's plays sat safely in an uncheckpointed WAL, which is a committed log).

⚠️ **`post-boot-check.ps1` returns `INCONCLUSIVE` for this failure mode even when everything is
healthy**, and its own INFO line asks *"was it started by hand?"*. **It cannot distinguish *started by
hand* from *restarted by the restart policy after the engine returned*** — and the second is the chain
**working**. It is a reboot test being asked a resume question. Read the individual `[PASS]` lines,
not the verdict, after a Rancher or WSL upgrade.

⚠️ **THE REAL GAP IS DETECTION: the app cannot report its own absence.** Nothing noticed for 13 hours;
it surfaced because a human queried a timestamp. And **"no new rows" is indistinguishable from "the
user did not listen"** — demonstrated twice in two days, once as a false alarm and once as a real
outage. **Absence of data is not a signal in either direction.** The discriminator must be a
*positive* heartbeat, which is what metric **M4** (share of polls returning nothing playing) provides —
so M1–M4 are load-bearing for outage detection as well as for W-7, not merely diagnostics.
⚠️ Any monitor for this **cannot live in the container**, because the failure mode is *the container is
not running*. See `audit.md` 2026-10-01.

### The reboot test itself, 2026-09-05

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

⚠️ **Corrected 2026-09-27**: the DJ removes 18–50 s **of playback**, not of reporting — it plays the
track short and the API reports that accurately (probe P-U5-1). **The arithmetic below is unaffected**,
because a constant-time effect is a constant-time effect whichever layer produces it, and that is the
point the warning exists to make. Expressed as a ratio,
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

**The host is UTC-4 (EDT), file mtimes over the bind mount ARE faithful, and `data/snapshots/` proves
both in one command.** Those filenames carry **UTC**; their mtimes carry **local**. So
`ls --time-style=full-iso data/snapshots/` establishes the offset *and* shows mtimes are trustworthy —
`history-snapshot-2026-09-29T15-07-54-884.csv` has mtime `2026-09-29 11:07:55 -0400` = `15:07:55Z`,
matching to the second. **Run that before reasoning about any file time here.**

⚠️ **This exists because an entry in `audit.md` claimed the opposite and was wrong.** On 2026-09-29 a
*"bind-mount mtimes are not a liveness signal"* finding was recorded, reasoning that a play timestamp
was later than the `-wal` mtime and so *"impossible if mtimes were faithful"*. The offset had been
**inferred from one coincidence** as UTC-3 and never measured; at the real UTC-4 the mtime is 45
minutes *after* the play and nothing was impossible. **Withdrawn 2026-10-01.** ⚠️ The distrusted
signal was then read anyway two days later, producing a second wrong conclusion — *"recording stopped
at 09:04"*, which was a **local** mtime compared against a **UTC** play time. ⚠️ **A WAL mtime is the
last time there was anything to WRITE, never a heartbeat**; with no music playing the app can poll for
hours and write nothing. **Plausible inference recorded as measurement, inside the log that exists to
catch it** — same family as *"loses over half the corpus"* and the lock guard's docstring.

**SQLite WAL over the Rancher Desktop bind mount works — probed 2026-09-05, don't re-derive it.**
The general advice is that WAL is unsafe on network/virtualised filesystems, because it needs
shared-memory mapping. That advice would have blocked container deployment of the one artefact
that cannot be regenerated. Probed on both C: and D: in a real container: `journal_mode -> wal`,
200 rows written, `wal_checkpoint(TRUNCATE)` clean, reopened and read back. Live since:
`integrity_check: ok` with the container as the writer. **Documentation said no; the probe said
yes.** If this ever needs revisiting, re-probe rather than reasoning.

⚠️ **BUT SQLITE'S LOCKS DO NOT CROSS THAT MOUNT, AND THAT BREAKS THE GUARD THAT WAS SUPPOSED TO
PREVENT THE U4 CORRUPTION.** Probed 2026-09-27: with `spotify-now-playing` **up, healthy and actively
recording**, a host process **successfully acquired `BEGIN EXCLUSIVE`** on `data/history.db`. The app
holds its connection open for its whole process lifetime (`SqliteHistoryRepository.ts:192`), so there
is no race here — the lock simply is not visible across the Windows-host ↔ Linux-VM boundary.

⚠️ **So `reclassify-unobserved-tails.mjs`'s docstring — *"This script refuses to apply if it can see
the app holding the database"* — was FALSE against the real deployment**, which the container has been
since 2026-09-05. It was not a weak guard, it was a **blind** one, passing exactly when the danger
is present. **This mechanically explains the U4 incident**: the guard said yes, so two writers hit one
file. It is the same family as *"a guard computed the same way as the thing it guards is not a
guard"* — here, **a guard that cannot observe the condition it guards** — and it is worse than having
no guard, because it produced a green light.

✅ **FIXED 2026-09-29.** That script now delegates to the same `assertNobodyElseHoldsIt` the backup
scripts use — **imported, never re-implemented**, because this project has already shipped a policy
that was copied and then diverged (the WebSocket `403`). Verified against the exact case the old guard
passed: with the container up, `npm run reclassify -- --apply` exits **2** with a refusal naming the
container.

> ⚠️ **The lesson outlives the bug: a recorded reassurance decays exactly like a recorded negative,
> because nothing ever re-tests it.** This one **survived the corruption incident it had failed to
> prevent**. Open item 3a is its mirror image — *our own notes said the API doesn't return X, and it
> does.* Same defect: a claim written once and never re-probed.

✅ The working check is `docker ps`, and it **fails closed**: if `docker` cannot be reached the answer
is *unknown*, and unknown refuses. `backup-history.mjs` does both — `docker ps` for the container,
the lock probe for a host writer like `npm start` — because **neither check sees the other's writer**.
⚠️ The lock probe was kept rather than deleted: it is incomplete, not useless.

⚠️ **This was found by accident, by running the new backup script while the container was up and
watching it succeed.** It checkpointed the live WAL; nothing was lost (850 plays and
`integrity_check: ok` before and after), but that is luck, not design. ⚠️ **`docker compose down`
remains the only real protection**, and the script-level guard that appeared to back it up did not.

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

**⚠️ A GUARD THAT READS A LABEL IS A GUARD A LABELLING BUG DISABLES — measured 2026-10-04, twice.**
BR-35's 3-consecutive halt counted `play.skip_source === 'rule'`, and **nothing ever wrote `'rule'`**:
`PlayObserver` hardcoded `'user'` from U1, sound while nothing else could skip. So the primary runaway
guard **could not fire at all**, through four live skips. ⚠️ `safetyCounters.ts` was at **100% on every
axis** and PBT-46/47 passed — they test the counter against *supplied* input, and nothing asserted that
anything ever supplies `true`. **A structurally empty column reads as *this never happens*.**
✅ The counter now joins `skip_attempt` **directly** and never reads the label.

⚠️ **AND THE FIRST FIX FAILED LIVE BY 11–14 MILLISECONDS.** It matched the attempt to the play by TIME
WINDOW, reasoning that `play_id` is backfilled in a try/catch and could be missing. But `ended_at` is **the
last observation in the trail**, and the attempt is enqueued from the decision taken on that same tick —
*just after it*. All four real skips landed 11–14 ms outside their own window. ⚠️ **It worked for
refusals**, whose plays run on for minutes, so the broken case was exactly a SKIP — which by definition
ends the play it fired during. **The fixtures used generous windows: a fixture never shows you a 14 ms
race.** The reasoning was sound and the measurement said the opposite; `play_id` was populated correctly
every time. ✅ Keyed on `play_id` now, with a missing link **surfaced** on `/api/diagnostics` rather than
designed around — **a visible failure beats a clever key.**

✅ **THE HALT WORKS, AND "3 CONSECUTIVE" MEANS 3** — measured on the first live halt, 2026-10-04. Three
tracks were skipped, the halt latched at `observedCount: 3`, and the **fourth matching track was refused
`runaway-halted` rather than skipped.** ⚠️ **A docstring, the UI, the pre-registration and a test all
briefly claimed the FOURTH skip latched it** — reasoned from "the counter reads closed plays so it must
trail by one", which BR-43.4's 3-second confirmation grace defeats: the play has closed by the time
`#checkHalt` runs. ⚠️ **The wrong claim had a PASSING TEST**, whose fixture inserted the play row after
the check — modelling the belief rather than the code. **A fixture built around a mental model confirms
the model**, which happened twice in one day here.

⚠️ **A halt's `attemptIds` must match its TRIGGER.** The first live halt listed **7 ids for a run of 3**,
because the field was filled from the *hourly* window regardless of what fired — four of them were an
unrelated test an hour earlier. BR-35.8 exists so the user can review *which skips counted*; evidence
that includes rows the trigger did not count is worse than no list, because it reads as authoritative.

⚠️ **`globalAutomationEnabled` stays `true` through a halt** (BR-33.4 — separate latch, never a write to
the switch), so **halted-and-still-armed is a real state** and had no UI branch: the button read *"Turn
automation off"* while the text said *"before turning it back on"*. It **was** on.

**✅ THE INODE HAZARD IS NOW VERIFIED LIVE, not merely described — 2026-10-03.** U5's
`AutomationStateStore.write` does write-temp-then-rename into `/state`, and after a kill-switch change
the **host and the container see identical file content**. So the directory mount is what makes that
rename work, and a single-file mount would have detached the container's view on the **first** change.
U3 and U4 could only warn about this; U5 is the first unit that would have hit it. The warning below is
unchanged and is now evidence rather than inference.

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
| 2 | ~~Liked-status transitions~~ — **CLOSED; verified 2026-10-06.** Delivered in U2 and the table was never updated. `liked_transition` is populated on **835 of 977 plays**: `kept-unliked` 601, `kept-liked` 146, `liked-during` 65, `unknown` 23 — the four states plus `unknown`, with `kept-unliked` as the reference level exactly as designed. ⚠️ It read as open for five weeks after shipping, which is this file's own *a recorded claim decays because nothing re-tests it* — applied to a TODO rather than to a finding | ✅ |
| 3 | **⚠️ CORRECTED 2026-09-20 — the old premise was false.** This said *"`recently-played` returns no `external_ids`"*. **It does.** Probed live 2026-09-20: `HTTP 200`, `external_ids.isrc` on 3/3 items. Only **82 rows** lack an ISRC — all backfilled, all dated **2026-08-20 → 08-31**, spanning **72 distinct `track_id`s**. Every other row has one: 457 live + 4 backfilled since 2026-09-03, of 543. So recovery is **72** `GET /tracks/{id}` calls, not 47. ⚠️ **The 2026-09-05 conclusion STANDS and is the decision:** all 82 are `outcome = 'unknown'`, so **0 are gate-eligible** — what the backfill lacks for the gate is the observation trail, which no API returns retroactively. **New in U4**: these 82 are exactly the rows where `label.*` is *unanswerable* rather than *unknown* (BR-27.5b) — discriminator `isrc IS NULL AND label_unknown_reason IS NULL` — so recovering them would improve back-test answerability as well as coverage stats, at 72 Spotify calls plus ~2 MusicBrainz calls each behind a 1 req/sec queue. Decide on that basis → U2 FD **Q7** | Later |
| 3a | **⚠️ Why those 82 lack an ISRC is UNESTABLISHED — and it is not the code.** `RecentlyPlayedBackfill` has read `track.external_ids?.isrc` since **U1** (`a8136d9`), `webApiClient.ts` has exactly one commit, and the wiring never changed. Live rows carried an ISRC from the very first one (row id 51). The break is clean at **row id 120 → 155** (2026-09-01 → 09-03), with **no code change in that window**. Something outside this repo changed, or the original observation misattributed its cause. **Do not invent one.** ⚠️ **The lesson is the project's own rule pointing the other way**: the four documented traps were all *docs said yes, probe said no*. This is **our own notes said no, and the probe says yes** — a recorded negative decays silently, because nothing ever re-tests it. **Re-probe a "the API doesn't return X" note before building on it.** | ✅ measured |
| 3b | **MusicBrainz label coverage is recency-biased, and this is now CONFIRMED TWICE.** Ad-hoc probe 2026-08-26: pre-2022 100%, 2022+ **43%**. Shipped code on a larger corpus 2026-09-05: **86%** / **44%**. The gap is real and stable, not an artefact of the first sample, and stays concentrated on the recent independent releases R1 is about. ⚠️ Measure it **only over ISRC-bearing plays** — see the denominator warning above | ✅ confirmed |
| 4 | **✅ CLOSED 2026-09-22; MECHANISM CORRECTED 2026-09-27.** The overlap is real and the data fix stands — 24 rows re-derived `skipped` -> `completed`, live skips 46 -> 22, `skip_attribution` retired. ⚠️ **But the mechanism was stated backwards**: it is not that Spotify stops *reporting* early, it is that **the DJ stops *playing* early** (18–50 s) and reports it accurately. Probe P-U5-1, 2026-09-27. ⚠️ **And the crossfade argument has now failed a THIRD time.** It previously read *"crossfade is OFF on this machine, so the old argument failed twice over — it assumed cut length equals crossfade length, **and the feature was disabled**."* The setting **is** off, and **the DJ crossfades anyway, ~5 s, on 3 of 8 transitions.** So the setting was never the relevant fact in the DJ context — the only context where the anomaly appears. A UI fact used as a probe result, twice over. See `audit.md` 2026-09-22 and 2026-09-27 | ✅ |
| 4-old | **⚠️ SUPERSEDED, kept for the history. REWRITTEN 2026-09-22 — every number in the original was n≈10 and NONE of them replicated.** The original argued: the AI DJ crossfades → crossfade removes constant seconds → a proportional threshold penalises short tracks → majors run ~30% longer (248s vs 191s) → independents take more false skips → **so correcting it could only move the result toward R1**. Re-measured on 586 plays, **all three premises and the conclusion fail**: ① *crossfade is ruled out* — the affected plays lose **21–41s** and Spotify caps crossfade at 12s; ② *the duration gap dissolved* — majors **213s** vs independents **201s** (n=120/162), a 6% gap, not 30%, exactly the chance the original flagged at n=10/11; ③ *threshold crowding dissolved* — **52 of 443** live track-change plays sit within ±0.05 of 0.90 (**11.7%**), not 13 of 27 (48%); ④ ⚠️ **the direction is BACKWARDS.** Unattributed skips are **67% of major skips (6/9)** but only **50% of independent (6/12)**, so correcting removes proportionally *more* from majors. The rates flip sign: all skips major **8.1%** > independent **7.6%**, but user-only skips major **2.7%** < independent **3.8%**. ⚠️ **EXPLORATORY AND NOISE-DOMINATED** — 3 vs 6 events, computed after seeing the data, and **BR-11.7's confirmatory run is spent**. This is *not* evidence against R1; it is grounds for withdrawing the old claim, nothing more. **The concern is now INSTRUMENTED rather than open**: `skip_attribution` (migration 006) labels these plays directly, so analysis can exclude them without moving the pre-registered threshold. 0.90 stays | ⚠️ restated |
| 5 | **✅ CLOSED 2026-09-22 — R11 probed during active playback.** Context-dependent: album/autoplay/radio expose 20 tracks and predict 8 for 8; **the AI DJ exposes none**. `context.type` cannot distinguish them. FR-36 must probe the queue at runtime rather than infer from context, and FR-34/35 is the majority path at 50–70% DJ listening | ✅ |
| 8 | **Distinguish a rejection-skip from a session end** — user-raised 2026-09-10, **re-raised 2026-09-19**. Backlog item **W-3** in `requirements.md` §5.1. ⚠️ **Probed twice — the corpus has ZERO instances**, at 427 plays and again at **504**: all 31 skips close on `track-change`, all have a successor within 30 s, and the 12 session-enders are **7 `completed`, 5 `unknown`, 0 `skipped`**. It is unreachable by construction — `classify` returns `skipped` *only* on `closeReason === 'track-change'`, and stopping playback yields `pause-idle`/`playback-stopped`, which fall through to `unknown`. ⚠️ **THE COST RUNS THE OTHER WAY.** Those 5 partial session-enders are not contaminating the outcome variable, they are **missing from it** — the gate's `ELIGIBLE` predicate is `outcome IN ('completed','skipped')`, so every abandoned last-track is silently dropped. **W-3 is data recovery, not a false-skip repair**, and anyone implementing it as stated will write code that does nothing and tests that pass for want of anything to fix. Discriminator (gap from `ended_at` to next `started_at`) needs no new collection and applies retroactively | Later |
| 7 | ~~Playback context is never recorded for live plays~~ — **CLOSED BY U5, verified 2026-10-06.** `context_type` and `context_uri` are now fetched from `GET /me/player/currently-playing` **once per track** (BR-41.1) and written on every live play: **87 live plays carry them**, all since U5 deployed, where previously it was NULL on all 342. ⚠️ **EVIDENCE ONLY, never a rule input** (BR-41.3/41.5): `context_uri` goes stale on its own, and `context_type` **cannot tell the AI DJ from a radio station** — both are `type: playlist` sharing the `37i9dQZF1E` prefix. The DJ-vs-radio discriminator is whether the **queue** exposes tracks, which is why FR-36 asks at runtime | ✅ |
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
npm test           # 1228 tests (2026-10-03)
npm run typecheck  # covers src AND test

# ⚠️ RUN THIS, not `npm test` alone. A green suite has never been sufficient here.
npm run verify     # typecheck + test + smoke + knip

# Q9's two guards, added 2026-10-03 because `scripts/` is outside every other one.
#
# ⚠️ `smoke` invokes each script's SAFE MODE and fails only if a module cannot LOAD. A non-zero
# exit is NOT a failure -- backup-history.mjs correctly refuses while the container is up. Writers
# are skipped with a reason; every flag is checked against the target script's source, because a
# draft of this runner passed `--dry-run` to a script that has no such flag.
npm run smoke
npm run knip       # dead files/exports/deps over src/ AND scripts/. Config: knip.jsonc
npm run auth       # host-side OAuth, once

node scripts/hypothesis-gate.mjs   # the Phase 2 gate (BR-11). Read-only; writes nothing

# The played_at repair. Dry run by default; --apply takes its own backup first.
node scripts/repair-backfill-timestamps.mjs

# Re-derive stored outcomes from retained trails under the current classifier (FR-20).
# Dry run by default and prints the full diff; --apply backs up first. NEEDS the tsx loader,
# because importing the real classifier is the point -- see the header comment.
node --import tsx scripts/reclassify-unobserved-tails.mjs

# Backup and VERIFIED restore (2026-09-27). --label is mandatory; refuses while the container is up.
npm run db:backup -- --label before-migration-007

# The command that matters. Read-only, safe any time. Run it the DAY YOU TAKE a backup,
# not the day you need one -- an unverified backup is a belief about a file.
npm run db:restore -- data/backup-before-migration-007-<stamp> --verify-only

# Prove the verifier can FAIL, against the deliberately-kept corrupt snapshot.
npm run db:restore -- --self-test

# Which of my backups are actually restorable? Read-only sweep over all of data/.
npm run db:verify-backups

# Restore. Dry run by default; --apply backs up what is there now first.
npm run db:restore -- <dir> --apply

# ⚠️ U6 (2026-10-07): the db:* scripts above now run under `node --import tsx` — the verifier MOVED to
# src/backup/ so the app and the scripts share one copy. They are the DEVELOPER path and still need
# `docker compose down` (they are a second process). The USER path is in-app: Settings -> Create backup /
# Restore backup, which needs no downtime (the app backs itself up on its own connection, and applies a
# restore at startup before opening the database).

# U6's verification installation: a second, throwaway copy on http://localhost:3011 for the exit test.
# Refuses unless compose.verify.yaml resolves to project `spotify-verify`; `down` PROVES the live
# deployment unchanged. Never run compose.verify.yaml together with compose.yaml.
npm run verify:up
npm run verify:down
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

**U5's kill switch lives in `state/automation-state.json`**, on its own `./state:/state:rw` mount.
⚠️ **NOT under `data/`, and the reason is RESTORE**: once W-5's full-inventory backup exists, restoring
a week-old backup would restore the week-old latch, and a kill switch a database restore can silently
re-arm is not a kill switch. ⚠️ **NOT under `config/`** either — that stays `:ro` so no route can
overwrite the hand-authored `rules.json`, and BR-20.8 would not protect it (it reloads on a *parse
failure*, and a file truncated to valid-but-empty JSON parses fine).

⚠️ **The directory is tracked (`state/.gitkeep`) while its contents are gitignored**, unlike `data/`.
A committed `globalAutomationEnabled: true` would arm automation on any checkout — the one default in
this project that must not travel.

> ⚠️ **`data/` holds the only artefact here that cannot be regenerated.** Code comes back from git,
> labels from MusicBrainz, enrichment from Spotify — months of play records come back from nowhere.
> Being gitignored makes it *more* exposed to `git clean -xdf`, not less.

---

## Working style that has served this project

Say what is verified and what is not. Several findings here came from probing rather than
assuming, and from noticing that a green test was green for the wrong reason. When a design
decision is a security-posture question, surface it rather than deciding it.
