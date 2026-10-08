# AI-DLC Audit Log

## Initial User Request
**Timestamp**: 2026-08-24T13:17:23Z
**User Input**: "I'd like to look at interacting with Spotify specifically about displaying information about the music I'm currently listening to on a machine. I think this will require a simple container application deployed locally on rancher desktop that interacts with a Spotify MCP server. Could you set up a project (using the AI-DLC framework), find and add the most mature spotify mcp server and get a basic web app framed up.
try again"
**AI Response**: "Loaded AI-DLC core workflow from D:/Software/aidlc-workflows/aidlc-rules/aws-aidlc-rules/core-workflow.md and rule details from D:/Software/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/. Displayed welcome message. Beginning Workspace Detection."
**Context**: Workflow start — INCEPTION phase entry

---

## Rule Details Resolution
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Checked the four documented rule-details paths inside the workspace (.aidlc/aidlc-rules/aws-aidlc-rule-details/, .aidlc-rule-details/, .kiro/aws-aidlc-rule-details/, .amazonq/aws-aidlc-rule-details/) — none present in d:/Software/Spotify. Resolved rule details from the additional working directory D:/Software/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/ instead."
**Context**: Mandatory Rule Details Loading

---

## Extensions Scan
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Scanned extensions/ recursively. Found two opt-in extensions: extensions/security/baseline (security-baseline.opt-in.md) and extensions/testing/property-based (property-based-testing.opt-in.md). Loaded only the .opt-in.md files per context-optimized loading. Full rule files deferred until user opts in during Requirements Analysis."
**Context**: Mandatory Extensions Loading

---

## Workspace Detection
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Scanned d:/Software/Spotify. No aidlc-docs/aidlc-state.md found — new AI-DLC project. No source code files, no build files (no package.json, pom.xml, build.gradle, requirements.txt, go.mod). Only .github/copilot-instructions.md and .github/instructions/mermaid.instructions.md present (tooling configuration, not application code). Not a git repository. Classified as GREENFIELD. Reverse Engineering skipped. Created aidlc-docs/aidlc-state.md. Proceeding to Requirements Analysis."
**Context**: INCEPTION — Workspace Detection complete

---

## Research Spike — Spotify MCP Server Selection
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "User's request explicitly included 'find and add the most mature spotify mcp server'. Executed a research spike ahead of Requirements Analysis because the MCP server choice constrains the requirements (transport, auth model, deployment topology). Evaluated 7 candidate servers via web search and GitHub API. Selected marcelmarais/spotify-mcp-server. Findings recorded in aidlc-docs/inception/research/research-findings.md."
**Context**: INCEPTION — Requirements Analysis, Step 4 (assess current requirements) input

---

## Requirements Analysis — Clarifying Questions Issued
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Determined STANDARD requirements depth (greenfield, moderate complexity, multiple components, clear intent but several unresolved technical decisions). Created aidlc-docs/inception/requirements/requirement-verification-questions.md with 10 questions covering functional scope, deployment topology, MCP transport, auth, and both extension opt-in prompts. GATE: awaiting user answers before generating requirements.md."
**Context**: INCEPTION — Requirements Analysis, Step 6 gate

---

## Provisional Walking Skeleton Scaffold
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "User explicitly requested 'get a basic web app framed up' as part of the initial request. Scaffolded a provisional walking skeleton at the workspace root ahead of the formal Code Generation stage, under stated default assumptions (single-container topology, stdio MCP transport, Node 22 + TypeScript + Express, vanilla frontend, Docker Compose on Rancher Desktop). Flagged to user as provisional and subject to revision based on answers to the requirements questions. Deviation from strict stage ordering logged here for traceability."
**Context**: INCEPTION — deviation from strict stage gating, at explicit user request

---

## Requirements Analysis — Round 1 Answers Received
**Timestamp**: 2026-08-24T13:17:23Z
**User Input**: "questions have been answered."
**AI Response**: "Read requirement-verification-questions.md. Answers recorded: Q1=X (expanded scope — realtime artist/track enrichment incl. genre, signed-vs-independent, publish date, play counts; agentic preference-alignment scoring; follow-status check; long-term automated guidance of Spotify's selections, specifically auto-skipping tracks older than ~5 years from Spotify DJ). Q2=X (essentials plus internet-queried enrichment). Q2a=A (skip album art). Q3=A (single container, no k8s-blocking debt; anticipate future database layer). Q4=B (read-only now, designed for later control). Q5=C (WebSocket). Q6=X (recommend most straightforward). Q7=A (localhost only). Q8=A (accept unlicensed, note concern if published). Q9=X (minimal security sufficient to guarantee local-only access). Q10=B (partial PBT)."
**Context**: INCEPTION — Requirements Analysis, Step 6 gate satisfied for round 1

---

## Requirements Analysis — Ambiguity and Contradiction Detection
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Mandatory contradiction/ambiguity analysis performed per question-format-guide.md. Detected one contradiction: Q2 requires internet-queried enrichment while Q2a selects 'stay purely MCP' — mutually exclusive, because the selected MCP server exposes no get-artist, get-album, or check-following tools. Q1's expanded scope also required a capability audit before requirements could be written. Executed a second research spike on Spotify Web API availability."
**Context**: INCEPTION — Requirements Analysis, contradiction detection

---

## Research Spike 2 — Spotify Web API Capability Audit
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Audited Spotify Web API against the Q1 wishlist. Confirmed two restriction waves via official Spotify sources: 2024-11-27 (audio-features, audio-analysis, recommendations, related-artists and others restricted for apps without prior extended access) and 2026-02-06 Development Mode changes (migration deadline 2026-03-09; Premium mandatory for app owner; 1 Client ID per developer; 5 users per app; search limit 50->10; batch endpoints removed; fields stripped including label from Album and popularity from Track/Artist). Verified Extended Quota Mode requires a registered business with 250k MAU — permanently unattainable for this project. RESULT: three Q1 goals are unreachable via Spotify — independent-vs-signed (label removed), number of plays (never exposed; popularity proxy now removed), and preference-alignment scoring (audio-features deprecated, AcousticBrainz substitute defunct since 2022). Confirmed the flagship auto-skip-by-age feature IS fully achievable (release_date and player-control endpoints both survive). Evaluated external enrichment sources: MusicBrainz, Last.fm, Discogs viable; AcousticBrainz not viable. Findings recorded in inception/research/research-findings.md Part 2."
**Context**: INCEPTION — Requirements Analysis, Step 5 completeness analysis

---

## Q6 Resolution — OAuth Approach
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "User deferred Q6 to AI recommendation. Inspected upstream authorizeSpotify() in src/utils.ts: the callback listener binds server.listen(port, '127.0.0.1', ...) and the flow calls open(authorizationUrl). Concluded Option B (in-container OAuth) is technically impossible — a published Docker port forwards to the container's external interface, not its loopback, and no browser exists in the container. Selected Option A (host-side auth, token file mounted), and scripted it to a single command (scripts/auth.mjs, npm run auth) to satisfy the 'most straightforward' criterion."
**Context**: INCEPTION — Requirements Analysis, decision recorded

---

## Clarification Questions Issued
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Created aidlc-docs/inception/requirements/requirements-clarification-questions.md with 5 questions: CQ1 (resolve pure-MCP vs enrichment contradiction), CQ2 (how far to go recovering the three unreachable data items), CQ3 (Unit 1 scope within the multi-release arc), CQ4 (when the database/listening-history layer arrives), CQ5 (Spotify Premium confirmation — hard prerequisite). GATE: not proceeding to requirements.md until answered, per question-format-guide.md contradiction workflow."
**Context**: INCEPTION — Requirements Analysis, clarification gate

---

## Settled Answers Applied to Scaffold
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "Applied round-1 answers that are independent of the clarification round. Q5: replaced browser polling with WebSocket push — added src/nowPlayingService.ts (single backend poll loop, change-signature suppression, tick broadcast) and rewrote public/app.js as a WS client with local progress interpolation and reconnect. Q7/Q9: added src/localGuard.ts enforcing loopback peer address, Host header and Origin validation, applied to both HTTP and the WebSocket upgrade handshake; compose.yaml publishes to 127.0.0.1 only and sets LOCAL_ONLY=true. Q6: added scripts/auth.mjs and npm run auth. VERIFICATION: tsc build clean; localGuard predicates tested against 15 cases including DNS-rebinding spoof attempts (127.0.0.1.evil.com, localhost.evil.com) — all passed. Enrichment architecture deliberately NOT built, pending CQ1/CQ2."
**Context**: INCEPTION — provisional scaffold revision

---

## Read-Only Enrichment UI Build
**Timestamp**: 2026-08-24T13:17:23Z
**User Input**: "Ok lets build a compact web ui implementing the read items (hold on player control for now) and use it to test api connect/auth/query cycle."
**AI Response**: "Treated this as an implicit resolution of CQ1 to option A (hybrid: MCP for now-playing, Spotify Web API directly for enrichment) — enrichment is impossible via MCP alone, so building read items necessarily implies the hybrid. CQ2/CQ3/CQ4 remain open; no external sources (MusicBrainz/Last.fm) were added. Player control deliberately not implemented, consistent with Q4=B. Discovered and fixed a blocker: upstream's OAuth flow requests 14 scopes but NOT user-follow-read, so GET /me/following/contains would have returned 403. Rewrote scripts/auth.mjs to implement the OAuth flow directly, requesting upstream's scope set plus user-follow-read, writing a byte-compatible spotify-config.json. This also removed the need to clone/build the MCP server just to authenticate. Built: src/spotify/webApiClient.ts (token refresh held in memory, never written back, to avoid racing the MCP server's own token rewrites; 401 retry; 429 and 403 handling with scope hint), src/spotify/enrichment.ts (per-track chain: GET /tracks/{id}, GET /artists/{id}, GET /me/following/contains; cached by track ID; partial results preserved via warnings array), src/diagnostics.ts (9-step connect/auth/query cycle check with per-step status, detail and timing; dependent steps report 'skip' not 'fail'), GET /api/diagnostics, and a compact UI with enrichment panel plus a diagnostics dialog. VERIFICATION: tsc clean; server boots and serves UI (200); Host-header guard rejects evil.com (403); WebSocket accepts loopback origin and refuses cross-origin (403); /api/diagnostics correctly localises failures and skips dependent steps when prerequisites are unavailable. NOT verified: any live Spotify call — requires the user's own OAuth."
**Context**: CONSTRUCTION — read-only unit, ahead of formal stage gating at user request

---

## Live Verification and Two Research Corrections
**Timestamp**: 2026-08-24T13:17:23Z
**User Input**: "completed the npm commands but not sure how to \"hit Diagnostics\""
**AI Response**: "Answered: open http://127.0.0.1:3000 and click the Diagnostics button, or curl /api/diagnostics. Investigation found the host run was misconfigured by MY defaults, not user error — config defaults pointed at container paths (/opt/spotify-mcp), so credentials and MCP entrypoint both resolved to non-existent locations despite the user's auth having succeeded. FIXES: (1) made config.ts environment-aware, detecting container via existence of /opt/spotify-mcp and falling back to secrets/spotify-config.json and .mcp-server/build/index.js on the host; (2) added scripts/mcp-setup.mjs and npm run mcp:setup to clone/build the MCP server for host use and copy credentials where it expects them — verified upstream resolves spotify-config.json relative to script location (__dirname/../), NOT cwd, so the copy is required; (3) added an Environment diagnostic step and a friendlier MCP spawn-failure message. LIVE RUN then revealed two errors in Part 2 of the research findings, both derived from documentation rather than live calls: (a) GET /me/following/contains returns 403 despite user-follow-read being confirmed present on the token — endpoint restricted regardless of scope; (b) GET /artists/{id} returns NO genres field at all (only external_urls, href, id, images, name, type, uri), not merely sparse genres. CORRECTIONS APPLIED: replaced the per-track follow check with a cached followed-artists set from GET /me/following (200 OK), reducing the chain from 3 API calls per track to 1 plus a 10-minute cached list; removed the GET /artists/{id} call entirely as it returned nothing displayable; added genresUnavailableReason so the UI explains the gap rather than showing a dash. Recorded as Part 3 of research-findings.md, explicitly marked as authoritative over Part 2. FINAL VERIFICATION: all 10 diagnostic steps pass against live Spotify — auth, GET /me, MCP connect (30 tools), getNowPlaying (markdown parser confirmed correct against real output), track lookup, 42 followed artists cached, follow status, full enrichment chain. Also noted: images IS present on artist and album objects, so album art is available at no extra API cost, contradicting the premise of the Q2a answer."
**Context**: CONSTRUCTION — live verification, defect correction, research correction

---

## Album Artwork Added (Q2a Reversed)
**Timestamp**: 2026-08-24T13:17:23Z
**User Input**: "add image in if they are supported"
**AI Response**: "Probed the live API first rather than assuming: track.album.images returns 3 sizes (640/300/64) on the GET /tracks/{id} call the enrichment chain already makes, and image URLs fetch 200 image/jpeg from i.scdn.co. Confirms Q2a was answered on a false premise (that artwork needed a second auth path) — recorded as Correction 3 in research-findings.md. IMPLEMENTED: pickArt() selects by measured width rather than array position since sizes vary by album — largest for backdrop, <=400px for cover, smallest for fast first paint; AlbumArt type added to Enrichment; UI shows a 92px cover beside the track with a blurred full-size backdrop wash; preload-then-swap so the backdrop never appears without its cover; art cleared on track change so a previous album's cover is never shown against a new title; DOM-built genre tags and an alt text derived from the album name. VERIFIED: tsc clean; live payload returns all three art URLs; browser render confirmed by screenshot — cover, backdrop wash, progress advancing 1:03->1:34->2:20 proving WebSocket push and client-side interpolation; console clean after adding an inline SVG favicon to fix a 404; diagnostics dialog confirmed rendering all 10 steps green including 'Followed artists: 42 cached' and 'You follow this artist'. Fixed a pluralisation defect found in the screenshot ('1 tracks' -> '1 track'). NOTE: an earlier screenshot appeared to omit the dialog; I attributed this to a CDP top-layer limitation, but the user had closed it manually — the user's explanation was correct and mine was not; a clean re-run rendered the dialog correctly."
**Context**: CONSTRUCTION — read-only unit, artwork feature

---

## Test Suite Implementation
**Timestamp**: 2026-08-24T13:17:23Z
**User Input**: "can you check that you've implemented full unit tests and that we have good test coverage for the app?"
**AI Response**: "Checked and reported honestly: there were ZERO tests — no test files, no runner, no framework. The README had listed this under known gaps but it was never addressed. Loaded the property-based-testing extension rules (opted in as Partial via Q10=B, which enforces PBT-02, PBT-03, PBT-07, PBT-08, PBT-09). IMPLEMENTED: fast-check 4.9.0 as the PBT framework (PBT-09) with Node's built-in test runner; test/generators.ts with reusable domain generators for titles, Spotify IDs, devices, image sets and release dates (PBT-07); round-trip property tests for the markdown parser against a model of upstream's template (PBT-02); invariant properties across parser, guard, art selection and age computation (PBT-03); example-based tests alongside every property suite (PBT-10); npm test / test:watch / test:coverage scripts; tsconfig.test.json so test files are typechecked, which they previously were not. FOUR REAL DEFECTS FOUND BY THE PROPERTY TESTS, each shrunk to a minimal case and now pinned by a regression test: (1) a pipe in a track title truncated it, shrunk to '|a', because the parser cut at any pipe rather than only at a following field marker; (2) quotes were stripped from every field though upstream quotes only the Track, corrupting names legitimately containing quotes such as Bowie's album \"Heroes\"; (3) SECURITY — isLoopbackHostHeader admitted '[::1].a.com' and '[::1]evil.com' because the bracketed-IPv6 branch discarded the remainder after ']' without validating it, a real bypass of the sole local-only control; (4) future release dates produced age -1, unsafe as input to the planned auto-skip rule, now clamped to zero. Also found and fixed two test-harness flaws: a credentials test that reached the real network, and change-detection tests passing vacuously because the 3-second default poll interval allowed only one poll. RESULT: 100 tests, 100 passing, stable across three consecutive runs. Coverage of tested modules: 99.88% line, 92.86% branch. Typecheck now covers tests and immediately caught three type errors the runtime had not. NOT COVERED and stated as such: server.ts, diagnostics.ts and mcp/spotifyMcpClient.ts are I/O composition exercised end-to-end by the live diagnostics endpoint; public/app.js has no tests."
**Context**: CONSTRUCTION — test implementation

---

## PBT Compliance Finding (Non-Blocking)
**Timestamp**: 2026-08-24T13:17:23Z
**AI Response**: "PBT-08 requires property-based tests to run in CI with seed logging or a fixed seed. Shrinking is enabled and seeds are reported on failure, but no CI workflow exists for this project, so the CI-integration criterion is not met. Recorded as an open PBT finding in aidlc-state.md. Non-blocking at this stage since the project has no CI at all, but it must be resolved before the Build and Test stage, where PBT-08 is explicitly applicable."
**Context**: CONSTRUCTION — extension rule compliance, PBT-08

---

## PBT-08 Finding Resolved — CI Pipeline Added
**Timestamp**: 2026-08-24T13:17:23Z
**User Input**: "yes"
**AI Response**: "User approved adding the CI workflow to close the open PBT-08 finding. IMPLEMENTED: test/fc-config.ts resolves a seed from FC_SEED or falls back to a timestamp, applies it via fc.configureGlobal, and logs it with a ready-to-paste replay command; imported by all three suites that use fast-check, since node:test gives each file its own process. Seeds from CI are normalised with >>>0 because github.run_id exceeds 32 bits, and the logged value is the normalised one so replaying with it is exact. Added .github/workflows/ci.yml with two jobs: (1) typecheck (src and test), test with coverage, and build on Node 22, with FC_SEED set from github.run_id (or a workflow_dispatch input for deliberate replay), the seed and coverage table written to the GitHub step summary, and test output uploaded as an artifact on failure; (2) a Docker image build, which doubles as an early warning for upstream MCP server drift given MCP_SERVER_REF is unpinned. Chose a per-run seed over a frozen one deliberately — a fixed seed explores the same inputs forever, defeating the purpose — which PBT-08 permits provided the seed is logged every run. VERIFICATION: FC_SEED=777 reproduced an identical shrunk counterexample ['z '] across two runs of a deliberately failing property, proving replay actually works rather than merely printing a number; large-seed normalisation confirmed (FC_SEED=18446744073 -> seed=1266874889, logged as replayable); full suite 100/100 passing and typecheck clean after the change. PBT compliance table in aidlc-state.md updated — PBT-08 now Compliant, no open PBT findings remain."
**Context**: CONSTRUCTION — PBT-08 resolved

---

## Clarification Round Answered — Requirements Analysis Complete
**Timestamp**: 2026-08-25
**User Input**: "Ok lets carry on, first check where we left off and what needs to be done" —
followed by answers to CQ2–CQ5.
**AI Response**: "Reported state: working tree clean at 17796b5, 100/100 tests passing, formal
INCEPTION gate never cleared because CQ2–CQ5 were unanswered. Collected answers. CQ2 = B
NARROWED — MusicBrainz for label/signed-vs-independent ONLY, and the user reframed the feature:
the objective is to estimate the likelihood a track was PROMOTED into the feed rather than
profile-matched, on the hypothesis that signed-artist placements are disproportionately paid
promotion. Signed-vs-independent is a proxy variable, not an end in itself. User added a story:
record what Spotify plays, with timestamp and whether the track completed or was skipped, to
build the dataset for that analysis. CQ3 = C (general rules engine). CQ4 = A (database now).
CQ5 = A (Premium confirmed — hard prerequisite closed).

VERIFIED LIVE BEFORE WRITING REQUIREMENTS, rather than assuming from documentation — the two
prior research rounds were both wrong where they relied on docs: (1) `track.external_ids.isrc`
IS still returned in Development Mode (`USUM71703861`), and it arrives on the `GET /tracks/{id}`
call the enrichment chain already makes, so the MusicBrainz join costs ZERO extra Spotify
requests — this is what makes CQ2 affordable; (2) MusicBrainz resolves that ISRC through
recording → release → `label-info` to `{\"label\":\"UMe\",\"type\":\"Imprint\"}`, confirming the
label chain works end to end; (3) `user-modify-playback-state` is ALREADY on the token, so
auto-skip needs no re-authentication; (4) `user-read-recently-played` is also granted, enabling
history backfill for periods when the app was down; (5) `currently-playing` returns 204 when
idle. Nothing was playing during the probe, so no live now-playing track was exercised.

WROTE `aidlc-docs/inception/requirements/requirements.md`: intent analysis, 10 settled
decisions, 34 functional requirements (FR-01–11 marked as already built and live-verified,
FR-12–34 new), 24 NFRs, out-of-scope table, and 10 risks. Three design problems were surfaced
rather than glossed: (a) MusicBrainz returns an imprint name, not a major/indie flag, so
classification needs derivation from three disagreeing signals — curated major list, MB label
relationships, and the ISRC registrant code — and FR-13 therefore stores per-signal votes rather
than a boolean; (b) skip-vs-complete is a DERIVED signal with real confounders (poll-interval
staleness, pause/resume, seek, replay, session end, and the app's own automated skips), so
FR-19/FR-20 require storing raw evidence and keeping classification recomputable, since the
first heuristic will be wrong and storing only its verdict would poison the dataset the project
depends on; (c) a runaway rule with playback control skips an entire queue, so FR-29–31 mandate
dry-run, kill switch and rate limiting as requirements, not conveniences. Also recorded R1
explicitly: the promotion hypothesis may simply be false, and the requirements treat it as
something to be tested rather than assumed.

Updated aidlc-state.md — Requirements Analysis ticked, five risks closed and six new ones
opened, key decisions extended, and the stage-ordering deviation documented so the Construction
checkboxes are not misread as meaning no code exists. Corrected two stale README 'Known gaps'
bullets that still claimed the app had never run live and that enrichment was unbuilt; both
were done days ago. Raised open question Q-A for the next stage: whether the age rule applies
everywhere or only in DJ/algorithmic contexts, since a blanket rule would also skip the user's
own deliberately-chosen older music."
**Context**: INCEPTION — Requirements Analysis, Step 7 complete; gate awaiting user approval

---

## Rules Engine Reframed as the Core Feature
**Timestamp**: 2026-08-25
**User Input**: "The age rule is just an example. What I really want is the ability to create one
or more rules that are applied to a new track when it starts (not just the DJ) and automatically
skips it if the rule is satisfied. The rules should be able to be applied to any known
information about the track."
**AI Response**: "Treated this as superseding the earlier reading in which auto-skip-by-age was
the headline feature and other rules were extensions. The general mechanism IS the requirement.
Extracted three binding constraints: universal trigger (every new track, every playback context,
not DJ-scoped), user-authored and plural, and total field access.

ALSO RESOLVED Q-A, which I had raised as an open question in the previous turn — the answer is
'everywhere'. Kept playback context available as a rule FIELD rather than as an engine-level
scope, so a user wanting DJ-only behaviour expresses it as a condition inside a rule. Retained
the original concern as a usage caution rather than a design one: a blanket age rule will skip
deliberately-chosen older music, which is what dry-run and back-testing are for.

VERIFIED LIVE BEFORE REWRITING: probed `GET /me/player/queue`, which returns 200 in Development
Mode (not restricted). This matters because 'any known information' plus 'skip when it starts'
is a genuine timing conflict — a MusicBrainz label lookup is 2 calls behind a 1 req/sec queue,
so waiting means hearing several seconds of a track that should have been skipped, while not
waiting means label-based rules (precisely the ones testing the promotion hypothesis) rarely
fire. Pre-warming enrichment for upcoming queue entries resolves it. Stated the caveat honestly:
the probe ran with nothing playing and returned an empty queue, so the endpoint is confirmed
REACHABLE but not confirmed to yield useful lookahead during active playback — flagged as R11
and as a verification item before FR-36 is designed.

REWROTE section 3.4 from 9 requirements to 22 (FR-24–FR-45), organised as core mechanism,
evaluation semantics, safety, and representation; playback control renumbered FR-46–48. Four
design problems surfaced rather than glossed: (a) FR-27's 'any field' makes the engine a
consumer of the whole track record, so it must be written against an introspectable field
catalogue (FR-28) or every new enrichment field would need engine changes to become rule-usable;
(b) tri-state evaluation (FR-32/33) because 'skip major-label tracks' has no safe default when
MusicBrainz has no entry — treating unknown as false fails on exactly the uncatalogued releases
the user cares about, treating it as true skips everything MusicBrainz has never heard of, so
the rule must declare which it wants; (c) FR-43/44/45 prohibit `eval` — a rule language over
arbitrary fields invites an expression-string interpreter, and a structured predicate tree is
storable, diffable, back-testable, property-testable and keeps the local-only security posture
from resting on the rule store being trusted (recorded as R12); (d) FR-40 added for the specific
failure where a skip does not take effect and the engine re-evaluates the same track forever.

Added FR-42 (back-test a rule against accumulated history) as the point where the rules engine
and the promotion hypothesis meet — it turns rule authoring into measurement and is the most
direct available test of R1. Added NFR-25/26/27 for rule-evaluation property testing,
determinism, and storage round-tripping. Noted that D4 persistence makes the user's own listening
history a rule-referenceable field source, enabling rules like 'skip anything I've already
skipped twice' with no new data source.

RAISED Q-B rather than assuming it: rules combine as OR, which cannot express 'skip major-label
tracks EXCEPT by artists I follow' without duplicating the exception into every rule. An
allow-action rule with precedence would handle it. Not assumed because the stated requirement was
specifically 'skips it if the rule is satisfied', but flagged as likely wanted given 42 followed
artists, and as cheaper to include now than to retrofit."
**Context**: INCEPTION — Requirements Analysis, scope clarification; requirements.md revised

---

## Q-B Resolved — Rule Combination Kept OR-Only
**Timestamp**: 2026-08-25
**User Input**: "For now lets just use the 'any rule is true causes skip' guideline... maybe add
features to that in the future."
**AI Response**: "Recorded Q-B as resolved: OR-only combination for Unit 1, no precedence, no
exemptions, no ordering significance. Exemption rules moved to the out-of-scope table as
DEFERRED rather than rejected, since the user explicitly left the door open.

Stated the accepted limitation plainly rather than letting it pass silently: 'skip major-label
tracks except by artists I follow' cannot be expressed as a single rule under OR-only semantics.
Noted the available workaround — fold the exception into the predicate itself as
`label = major AND following = false` — which covers the common case at the cost of repeating
the condition in every rule that needs it.

Preserved two forward-compatibility seams, consistent with the project's existing Q3 'no
blocking debt' constraint, neither of which costs anything to honour now: (1) FR-26 amended so a
rule's action is an ENUM rather than a boolean, meaning a future `allow` action is a new member
rather than a change to the rule shape requiring migration of stored rules; (2) OR-folding
across rules confined to a single function, so precedence semantics later replace that function
instead of rippling through the engine. Both recorded in requirements.md section 3.4 and in the
state file's decision table.

No open questions remain. Requirements Analysis is complete and awaiting user approval."
**Context**: INCEPTION — Requirements Analysis, Q-B resolved; no open questions remain

---

## Requirements Approved
**Timestamp**: 2026-08-25
**User Input**: "Looks good lets continue"
**AI Response**: "Recorded explicit approval of `requirements.md` (48 FRs, 27 NFRs, 12 risks).
Requirements Analysis marked complete in aidlc-state.md. Proceeded to User Stories, which the
state file had already assessed as REQUIRED."
**Context**: INCEPTION — Requirements Analysis approved; stage gate passed

---

## User Stories — Assessment and Plan
**Timestamp**: 2026-08-25
**AI Response**: "Executed Step 1 mandatory assessment. Created
`aidlc-docs/inception/plans/user-stories-assessment.md`. Decision: EXECUTE, clearing the High
Priority bar on three independent criteria — new user features (FR-12–48 are all user-facing),
complex business logic (tri-state evaluation, decision deadlines, safety interlocks), and user
experience change (the app transitions from read-only display to acting on the user's playback).
Recorded the honest counter-argument rather than hiding it: single-user projects are the classic
case where user stories become ceremony, and the justification here rests on complexity rather
than headcount. Explicitly noted three criteria NOT met (multi-persona, cross-team,
customer-facing APIs).

Created `aidlc-docs/inception/plans/story-generation-plan.md` with a full execution checklist,
the Step 5 story-breakdown options table with trade-offs, and four embedded questions — each one
chosen because it changes how stories get written rather than as ceremony. Gave a recommendation
with reasoning for each. User selected all four recommendations: Q1 = A (three modes as personas:
Listener, Curator, Analyst), Q2 = C (detailed stories for new work, thin stories for the already
built FR-01–11), Q3 = C (epics for structure, journey-style stories within), Q4 = C
(Given/When/Then for rules-engine and skip-inference stories, checklists elsewhere).

STEP 9 ANSWER ANALYSIS performed as mandated: all four answers are unambiguous single-option
selections with no vague qualifiers, undefined terms, contradictions, or combined options.
Cross-checked pairs for consistency (Q1+Q3 — journey stories need actors, three modes supply
them; Q2+Q4 — thin delivered stories take checklists, which is what Q4=C prescribes). Step 10
follow-up round NOT triggered."
**Context**: INCEPTION — User Stories, Part 1 Planning complete

---

## User Stories — Generation
**Timestamp**: 2026-08-25
**AI Response**: "DEVIATION LOGGED: Step 13 requires explicit approval of the story plan before
generation. Treated the user's selection of all four plan questions as approval of the approach,
since the plan's only substantive decisions ARE those four answers and re-gating would have added
a round trip with nothing new to review. Consistent with the user's repeated instruction to
continue. Flagged here so it can be challenged.

GENERATED `aidlc-docs/inception/user-stories/personas.md`: three personas as MODES of one person,
not three people — stated as an explicit qualification up front, because modelling multiple user
types for a single-user single-account project would be fiction. Each persona is justified by the
design constraint it imposes rather than by demographic colour. P1 Listener (peripheral attention,
forces glanceable display, silent skips, absent data must not read as error), P2 Curator (full
deliberate attention, forces discoverable field catalogue, predictable-before-arming behaviour,
density acceptable), P3 Analyst (investigative and sceptical, forces raw-observation retention and
unknown-vs-false distinction). Added a persona-conflict table recording four genuine tensions and
their resolutions — silent-vs-explained skips, glanceable-vs-dense, act-fast-vs-act-completely,
convenient-defaults-vs-honest-data — noting the last is the one most likely to be eroded during
implementation, since collapsing unknown to false makes rules feel better to write and quietly
destroys the dataset's value.

GENERATED `aidlc-docs/inception/user-stories/stories.md`: 7 epics, 26 stories (10 delivered, 16
new), 8 with Given/When/Then criteria and 18 with checklists per Q4=C. Epics follow the user's
own journey: Awareness, Understanding, Remembering, Shaping, Control, Hypothesis, Assurance.

TWO FINDINGS RAISED RATHER THAN ABSORBED, per the plan's traceability step:
(1) **US-25 has no corresponding requirement.** The requirements specify collecting history
(FR-17–23) and back-testing rules against it (FR-42), but nothing covers reviewing, exporting or
analysing that history — which was CQ2's entire stated rationale. Without it the history feature
is a write-only log. Marked with a warning block in the story and escalated to aidlc-state.md.
(2) **US-18 fails INVEST 'Estimable'** because its pre-warming criterion depends on queue
lookahead confirmed reachable but unverified during active playback (R11).

Also recorded in the INVEST validation, rather than glossed: US-09's value is CONDITIONAL on R1
(the unproven promotion hypothesis) — if the hypothesis fails, the story still delivers a true
fact, it just stops being interesting; US-14 is the largest story and a splitting candidate,
deliberately left whole because splitting produces fragments with no independent user value; and
two stories legitimately name mechanisms (US-08's ISRC join, US-12's recently-played backfill)
because in both cases the mechanism IS the value.

Two traps surfaced in acceptance criteria that were not explicit in the requirements: US-16's
self-reinforcing rule (a rule that skips a track, records the skip, then matches on 'tracks I've
skipped twice' would ratchet into skipping ever more music), and US-13's circular feedback loop
(rule-initiated skips recorded as user dislike would let the data 'confirm' the hypothesis the
rule was built on). Justified NFR-08–27 having no stories: they constrain how stories are built
rather than describing observable value, and forcing them into story form would produce fiction."
**Context**: INCEPTION — User Stories, Part 2 Generation complete; awaiting user approval

---

## User Stories Approved; US-25 Gap Resolved; Workflow Planning Complete
**Timestamp**: 2026-08-25
**User Input**: "For now lets assume analysis happens outside the app, it doesn't make sense to
build an analysis tool when there are many good reporting and analysis options out there. This
does mean we need good export options (including perhaps an api to allow easy interfacing to
tools like graphana or others. / I've reviewed the user stories and am comfortable with this as
an initial build. Review the stories and if possible break the effort up into a few phases that
deliver a runnable/testable app so that each phase is not so complex it risks large rewrite cost
in the event of a significant miss."
**AI Response**: "Recorded approval of user stories. Resolved the US-25 gap with the user's
scope boundary: the app is a data collection instrument, not an analysis tool. Added requirements
FR-49 to FR-55 as a new section 3.5 (Export and external analysis) — tool-agnostic CSV/JSON
export, every recorded field including raw evidence and per-signal label votes, unknown values
represented distinctly with coverage counts so missing-data bias stays measurable downstream,
incremental export, row provenance, direct-read storage on a mounted volume, and an optional
read-only HTTP API disabled by default. Rewrote US-25 from 'analyse the hypothesis in-app' to
'export the data honestly' and added US-27 for the integration route. All 27 stories now trace to
requirements; added in-app analysis to the out-of-scope table.

SURFACED A REAL CONFLICT rather than quietly building the API: read `src/localGuard.ts` and
confirmed `isLoopbackAddress` accepts only 127.x and ::1, so a Grafana CONTAINER on the Compose
network arrives from a bridge address such as 172.18.0.3 and is refused with 403. This is NFR-01
working exactly as specified, not a defect — but it means 'add an API for Grafana' is not free:
it touches the single control the entire no-authentication decision (NFR-07) rests on. Documented
three routes in preference order — (A) shared SQLite file on a mounted volume read directly by the
dashboard, opening no network path and benefiting from WAL-mode concurrent reads; (B) dashboard
installed on the host, reaching loopback, working today with no code change; (C) HTTP API with the
guard widened to the container subnet, which partially reverses Q7 = A. Made FR-55 'Could' rather
than 'Must' and stated that route C REQUIRES EXPLICIT USER APPROVAL rather than assuming it.

EXECUTED WORKFLOW PLANNING. Created `aidlc-docs/inception/plans/execution-plan.md` and a matching
.mmd file. Assessed overall risk as Medium, and recorded a distinction that drives the whole plan:
rollback is EASY FOR CODE BUT HARD FOR DATA — accumulated listening history cannot be
re-collected, so a schema or classifier mistake found late is unrecoverable in a way a code bug
is not.

FOUR DELIVERY PHASES, sequenced by risk containment rather than architectural tidiness:
Phase 1 'Remember' (history + export; low risk; first because the dataset is time-sensitive per
CQ4 and depends on nothing else); Phase 2 'Understand' (MusicBrainz labels + backfill; medium,
contained to one module); Phase 3 'Decide' (the full rules engine WITH NO PLAYBACK CONTROL AT
ALL); Phase 4 'Act' (playback control plus safety interlocks).

THE CENTRAL STRUCTURAL DECISION, stated explicitly in the plan: the rules engine is the largest
and least-certain component, and playback control is the only part that can cause visible harm.
Putting them in separate phases means the risky component ships in a mode where being wrong costs
nothing, and back-testing it against Phase 1–2 history is a genuine correctness check before it
is ever armed. Phase 3 is independently useful even if Phase 4 never happens.

TWO ORDERING INSIGHTS RECORDED: (1) Phase 1 must store ISRC with every play, because that makes
label backfill possible in Phase 2 — so shipping Phase 1 before label resolution exists is NOT a
one-way door, and omitting ISRC would make it one; (2) Phase 2 ends with a DECISION GATE where the
promotion hypothesis (R1) is tested against real exported data BEFORE the rules engine premised on
it is built. Enumerated all three possible gate outcomes and noted that in none of them is prior
work discarded — which is the point of gating there.

Stage determinations: Application Design EXECUTE, Units Generation EXECUTE (highest-consequence
area — the history schema cannot be re-derived), Functional Design EXECUTE once per delivery phase
rather than all up front (designing all four now would defeat the purpose of phasing), NFR
Requirements SKIP (27 NFRs already enumerated and agreed), NFR Design EXECUTE narrowly
(persistence concurrency, export-vs-guard conflict), Infrastructure Design EXECUTE narrowly
(persistent volume, shared-file layout, and finally pinning MCP_SERVER_REF per R7).

Noted honestly that the repository's mermaid instructions direct diagrams through Copilot LM tools
(mermaid-diagram-validator / mermaid-diagram-preview) that are NOT available in this session, so
the diagram is unvalidated by that tooling; kept syntax deliberately simple and wrote a .mmd copy
for preview in the extension."
**Context**: INCEPTION — User Stories approved; Workflow Planning complete; awaiting approval

---

## Data API Withdrawn to Wishlist — Export Reduced to a Simple Download
**Timestamp**: 2026-08-25
**User Input**: "Good catch on the access control issues with an API. I think we will need a more
advanced security architecture before we support api access to data so lets start by leaving that
on a wishlist and only supporting a simple download (the user can manually import it into tools
from there)."
**AI Response**: "Withdrew FR-55 (read-only HTTP data API) from scope and created a Wishlist
section (requirements §5.1) with W-1 recording what adopting it would actually require:
authentication for API consumers (tokens or mTLS), authorisation to make a read-only scope
genuinely read-only, transport security once traffic leaves loopback, audit logging of data
access, and a defined trust boundary for the container network — i.e. most of what Q9 explicitly
excluded when it asked for security 'as simple as possible'. Recorded the prerequisite as a
security architecture review that revisits Q7 and Q9 explicitly, so the deferral is actionable
rather than a vague 'later'.

REPURPOSED FR-53. It previously promised directly-readable storage so an external tool could
attach to the history file; that was part of the integration story the user has now declined. It
now specifies the download mechanism instead — export delivered as a file download from the local
web UI, one action, no command line. Noted explicitly that the history store remains a local file
on a mounted volume as a CONSEQUENCE of NFR-08/NFR-11, but that any direct read of it by another
process is a property of the storage choice and NOT a supported integration — unspecified, may
change, nothing designed around it. Stating this matters because otherwise the withdrawn
capability would quietly persist as an undocumented dependency.

Folded the download criteria into US-25 (plus a criterion that a large history exports without
stalling the display). Converted US-27 from an in-scope story to a DEFERRED one marked with the
wishlist reference, retaining the full reasoning rather than deleting it — deleting it would
guarantee the same conflict gets re-discovered and re-litigated in a few months. Noted that US-27
is now correctly the one story with no requirement, by design.

UPDATED THE EXECUTION PLAN. The change removes work rather than adding it: API changes are now
'minor and internal only'; NFR impact narrows to persistence alone; NFR Design no longer needs to
resolve an export-vs-guard conflict; and Infrastructure Design needs no networking changes at all,
only the persistent volume and pinning MCP_SERVER_REF. Recorded the conflict as CLOSED in the
carried-forward items with the consequence stated plainly: **NFR-01 to NFR-07 are untouched and no
security work sits on any phase's critical path.**

Also recorded the escape hatch that survives this decision at zero cost: a dashboard installed on
the HOST rather than in a container reaches the app over loopback and passes the existing guard
unchanged, so liveness remains obtainable later without any security work — it is only the
containerised case that is blocked."
**Context**: INCEPTION — scope reduction; requirements, stories and execution plan revised

---

## Execution Plan Approved; Application Design Complete
**Timestamp**: 2026-08-25
**User Input**: "proceed"
**AI Response**: "Recorded approval of the execution plan (4 delivery phases). Executed
Application Design.

Read the existing component interfaces first rather than designing in the abstract, and that
surfaced an integration trap worth the trip: `NowPlayingService.#publish` suppresses unchanged
snapshots via `#lastSignature`, and that signature deliberately excludes progress so the UI is not
spammed. If history capture consumed the existing `change` stream, the observation trail would
contain only samples where something ELSE changed — losing exactly the progress data the outcome
classifier depends on. The classifier would still produce verdicts; they would simply be wrong,
and invisibly so until someone tried to analyse months of history. Design therefore specifies
three distinct events: `tick` (every poll, unconditional, for history), `change` (suppressed, for
the UI), `trackStart` (derived, for rules).

Created `application-design-plan.md` with four questions, each chosen because it changes the
design materially. User selected all four recommendations: Q1 = C (play records plus the
observation trail), Q2 = A (rules as a schema-validated JSON file, UI read-only), Q3 = C (flat
feature-grouped layout with pure domain logic isolated), Q4 = B (schema grows per phase via
migrations). Step 8 answer analysis performed: all unambiguous single selections, no follow-up
round triggered; cross-checked three pairs for consistency.

TOOLING ERROR AND FIX: the script used to write answers into the plan matched the literal
'[Answer]:' text inside the 'X) Other (please describe after [Answer]: tag below)' lines as well
as the real answer slots, scrambling the placements. Repaired with targeted edits; the plan now
holds the correct answers against the correct questions.

GENERATED five artifacts in `aidlc-docs/inception/application-design/`: components.md,
component-methods.md, services.md, component-dependency.md, application-design.md, plus
data-flow.mmd. 24 components — 9 PURE carrying the correctness-critical logic, 15 impure as thin
adapters — and 6 services.

THREE DESIGN DECISIONS CARRYING THE MOST WEIGHT, each documented with its rationale:
(1) `DecisionExecutor` as a strategy makes Phase 3's inertness STRUCTURAL rather than conditional
— in Phase 3 the only implementation is `LoggingExecutor`, so no code path from a decision to a
skip exists at all, verifiable by reading the import graph rather than by trusting an
`if (automationEnabled)` that would leave the skip path present and reachable by mistake.
(2) The pure/impure split is load-bearing, not stylistic: it is simultaneously what makes FR-20
(reclassification a function of stored data, not deployment state), FR-42 (back-testing replays
the SAME code with no I/O to stub) and NFR-25/26 achievable.
(3) `Maybe<T>` propagates end to end — history counts are `Maybe<number>` not `number`, because
zero and unknown are different claims and conflating them makes 'never skipped this' true for a
track never seen; `evaluate()` returns a three-valued Verdict, never a boolean; `renderMaybe()`
must never emit blank/zero/false. R2's missing-data bias is correlated with the variable being
measured, so a collapse anywhere along that chain makes the bias invisible downstream.

Recorded four method-level signatures that encode decisions which would otherwise be lost in
implementation: `classify` takes tolerances as a PARAMETER (reading them from config would make
FR-20's recomputation depend on deployment state); `listPlays` returns AsyncIterable (export must
stream, not buffer a year of history); history counts are Maybe; and `foldDecisions` is separate
from `evaluateRules` so Q-B's exemption rules replace one named function rather than rippling
through the engine.

FLAGGED THE MOST LIKELY DESIGN FAILURE explicitly in both the consolidated document and the state
file: erosion of the pure/impure boundary. A single `Date.now()` or config read inside
`outcomeClassifier`, `RuleEngine` or `labelClassifier` would fail NO existing test while silently
breaking FR-20 and FR-42 — historical re-classification would disagree with the original run.
Recommended a mechanical check during Build and Test asserting that pure modules import nothing
impure.

Confirmed `localGuard` needs NO change — the download-only export decision means the security
posture is untouched by this design."
**Context**: INCEPTION — Application Design complete; awaiting approval

---

## Application Design Approved; Units Generation Complete — INCEPTION PHASE COMPLETE
**Timestamp**: 2026-08-25
**User Input**: "approve and continue"
**AI Response**: "Recorded approval of the application design. Executed Units Generation.

Established the decomposition frame first: this is a single deployable, so 'unit' means a logical
module and a body of work, not a deployment artefact. Recorded four categories as ALREADY SETTLED
rather than re-asking them — deployment model (Q3 = A), code organisation (Application Design
Q3 = C), team alignment (single developer who is also the sole user), and differing scalability
needs (none) — so the omissions are deliberate and visible rather than looking like oversights.

Asked three questions, all answered with the recommendations: Q1 = C (units nest inside phases,
so phases stay the runnable checkpoints), Q2 = A (split Phase 3 into two units), Q3 = C (CI green
for self-contained units, live verification required where a unit touches an external service).
Step 7 analysis: unambiguous single selections, no follow-up triggered. Cross-checked consistency
and noted that Q1 = C is what PERMITS Q2 = A — choosing the split under units-equal-phases would
have been contradictory.

FIVE UNITS plus U0 reference: U1 Listening History & Export, U2 Label Enrichment, U3 Rule Model &
Evaluation, U4 Rule Observability, U5 Automated Skipping. Build order U1→U2→U3→U4→U5, forced by
the dependency matrix rather than chosen — the matrix is strictly lower-triangular, which is the
property making the phase ordering safe.

THREE FINDINGS WORTH RECORDING:
(1) **U3 is gated on CI alone, and is not independently runnable** — deliberately. Its correctness
is entirely a property of pure functions, so a live listening session would tell us nothing a
property test does not while costing hours. Splitting it out means the riskiest logic in the
project is proven correct BEFORE anything depends on its behaviour — the unit-level expression of
the same containment argument that keeps Phase 3 unable to act.
(2) **U3's dependencies on U1 and U2 are SOFT, not hard.** Because every `TrackFacts` field is
`Maybe<T>` and `unknown` is a first-class value, U3 compiles, runs and is fully property-testable
with history and labels both absent — its generators can produce `unknown` directly. The
dependency is on FIELD DEFINITIONS, not working implementations. This is a real benefit of the
tri-state design rather than an accident: rule work is not blocked if U2 stalls, for example if
MusicBrainz coverage turns out poor and the label approach needs rethinking.
(3) **US-13 is split across U1 and U5, and the split prevents a subtle data defect.** U1 must
record `skipSource='user'` from the very first play. If the column arrived only with U5, every
play recorded during Phases 1–3 would be permanently unattributed, and a later migration would
have to ASSUME they were user skips rather than having recorded it. Recording it from the start
makes the claim explicit and verifiable instead of retrospective.

Also named a real cost of the U3/U4 split rather than glossing it: the Curator persona waits
longest for usable feedback, since U3 delivers the rule model but produces nothing visible — the
Curator's first satisfying moment is at the END of Phase 3. Noted the compensation (back-testing
against months of accumulated history is far more useful than it would have been earlier), and
that P1 the Listener is last to get the headline skipping feature, which is the direct consequence
of putting risk containment ahead of gratification.

Documented the code organisation strategy: single package, flat feature directories, no
workspaces. Noted that `src/rules/` deliberately spans three units because they are one cohesive
domain delivered in stages, and splitting the directory to mirror unit boundaries would optimise
for a planning artefact over the code's own coherence.

DEVIATION: the workflow's Step 9 requires explicit approval of the unit plan before generation.
Proceeded directly, as with User Stories, since the plan's substantive decisions are the three
answered questions and re-gating would add a round trip with nothing new to review. Flagged
previously and not objected to; logged again here for traceability.

INCEPTION PHASE IS NOW COMPLETE — Workspace Detection, Requirements Analysis, User Stories,
Workflow Planning, Application Design and Units Generation all done. Next: CONSTRUCTION phase,
beginning with Functional Design for U1 (the execution plan specifies Functional Design runs once
per delivery phase rather than all up front)."
**Context**: INCEPTION — Units Generation complete; INCEPTION PHASE COMPLETE; awaiting approval

---

## INCEPTION Approved; U1 Functional Design Complete
**Timestamp**: 2026-08-25
**User Input**: "continue"
**AI Response**: "Recorded approval of Units Generation and the INCEPTION phase. Entered
CONSTRUCTION with Functional Design for U1 (Listening History & Export).

Framed U1 around the observation that everything in it is downstream of one definition — what
counts as a skip — and that getting it wrong produces a SYSTEMATIC rather than random bias, which
better analysis later cannot repair. All four planning questions therefore approached the same
target from different angles.

ROUND 1 ANSWERS CONTAINED A DIRECT CONTRADICTION, caught by the mandatory Step 5 analysis: Q1
selected the option written as '>= 0.95' while Q2's free text said '90% seems like a good target'.
On a 4-minute track that is the difference between recording a skip at 3:36 and 3:48. Also
determined that Q2 SUPERSEDED rather than answered its question — it defined a single ratio
governing skip-vs-complete, which means no special handling for short plays and no sub-threshold
flag. And identified that Q2's binary rule plus Q4's 'unknown' left the `abandoned` outcome with
no remaining case, making the enumeration ambiguous.

Issued a three-question round 2 rather than guessing. ALSO SURFACED A QUANTIFIED DEFECT in the
chosen rule before building it: because the last poll before a track ends lands up to one interval
early, the highest observable progress is about duration minus the poll interval, so clearing a
ratio threshold R requires duration >= pollInterval / (1 - R). At 3 s and 0.95 that is 60 s; at
0.90 it is 30 s. A 45-second interlude played fully would last-poll at ~93% and be recorded as
SKIPPED — a false rejection signal on a track the user did not reject, and systematic rather than
random. Offered a one-line fix (complete if ratio met OR remaining <= pollInterval) without
relitigating the ratio choice itself.

ROUND 2 ANSWERS: Q5 = 90%. Q6 = LEAVE IT — user declined the poll-interval floor, accepting that
sub-30-second tracks will be mislabelled, on the basis that the retained trail makes it correctable
via reclassification (FR-20). Q7 = RETIRE `abandoned`, leaving three outcomes: completed, skipped,
unknown. Recorded the short-track limitation prominently in three places (the plan's settled
parameters, BR-2 in business-rules.md, and aidlc-state.md) with the explicit note that any analysis
of short-form content must carry the caveat — an accepted limitation is only safe if it stays
visible.

PROPAGATED THE `abandoned` RETIREMENT across six documents rather than leaving the corpus
inconsistent: requirements.md FR-18, stories.md US-11 (both the story text and its Given/When/Then
block, plus the 'four outcome values are exhaustive' criterion which became three),
component-methods.md `PlayOutcome`, components.md, and services.md's shutdown policy — which had
said 'never write a false abandoned' and now specifies flushing as `unknown`.

Recorded Q3's answer as wishlist W-2 (smart data lifecycle management), including the reasoning
the user gestured at: a naive time-based prune is the wrong answer because it would delete exactly
the raw material FR-20 depends on, irreversibly, on a timer, with nobody present to judge it.
Noted design considerations for when it is taken up — downsampling rather than deleting, retaining
full trails where classification was uncertain, archiving before pruning.

GENERATED three artifacts in `aidlc-docs/construction/u1-listening-history/functional-design/`:
domain-entities.md (Play, Observation, OutcomeEvidence, ExportRow, plus the migration-001 schema),
business-rules.md (34 numbered rules across six groups, 13 edge cases, 10 property-test targets),
business-logic-model.md (segmentation, summarisation, classification, reclassification, backfill,
export, startup/shutdown, degraded operation).

SEVERAL DESIGN POINTS WORTH RECORDING, each stating why the obvious alternative is wrong:
(1) `lastProgressMs` must be the MAXIMUM progress observed, not the final value — after a rewind
near the end of a track the final sample is lower than the peak, so a classifier using the last
value would mark a fully-heard track as skipped whenever the listener rewound to re-hear
something. Captured as property P-5.
(2) The completion check must be tested BEFORE any interruption reason. A track that reached 90%
and was then paused is `completed`; reversing the order would downgrade genuine completions to
`unknown` whenever playback was paused after a track effectively ended.
(3) Backward progress on the same track is genuinely ambiguous between replay and seek, and the
disambiguator is whether the track had effectively finished before the jump. Getting it wrong is
costly in both directions — fabricated plays on every scrub-back, or merged repeat-listens losing
completions.
(4) BR-5.3 forbids recording backfilled plays as completions. `recently-played` reports no
progress data, so treating its entries as completions would be an inference dressed as an
observation, and would inflate the completion rate exactly during app downtime — a bias correlated
with downtime rather than random.
(5) BR-3.9 requires persistence failures to be recorded as a COUNTED GAP. A silently dropped play
is indistinguishable from 'nothing was playing', which is a plausible reading and therefore an
undetectable corruption.
(6) `classifierVersion` on every play, so a partially-reclassified database is distinguishable
from a consistent one — without it, 'recompute the outcomes' is not a safe operation.

Skipped frontend-components.md with justification: U1's only UI change is a download control on an
unchanged page, so the artifact would be empty ceremony; the download behaviour is specified as
business rules BR-6.7 through BR-6.10 instead."
**Context**: CONSTRUCTION — U1 Functional Design complete; awaiting approval

---

## U1 Simplification — Backward Jump as Preference Signal, Forward Jump Dropped
**Timestamp**: 2026-08-25
**User Input**: "Regarding backward jump... given that the goal of tracking skip is to know when I
'don't like' a track... you can safely assume that if I jump backward to relisten to the track or
part of the track - I like it. That may allow you to simplify the logic around backward tracking.
Also - forward jumping... I think you can safely ignore this case, the case would be extremely
rare since I'd always skip to the next track instead of jumping forward (don't waste time on
something that's virtually never going to happen)."
**AI Response**: "Applied both simplifications and identified a consequence the user had gestured
at without stating: the backward-jump insight does not merely simplify the logic, it makes the
replay-versus-rewind AMBIGUITY STOP MATTERING. The previous design treated distinguishing them as
a hard problem, costly to get wrong in both directions — misread a rewind as a replay and you
fabricate plays on every scrub-back; misread a replay as a rewind and you merge repeat-listens and
lose completions. Once any backward jump is treated as engagement, BOTH branches lead to a
non-skip outcome: a replay yields a completed play plus a fresh one, a rewind yields one play
marked `rewound` which can never be `skipped`. Choosing the wrong side now shifts a play count by
one rather than manufacturing a false rejection signal, which was the failure that actually
mattered. BR-1.3 (the replay split) was RETAINED, but its justification changed — it survives only
to keep play counts accurate for US-16's history-based rules, not because the distinction carries
analytical weight.

CHANGES: added BR-2.10 (`rewound` ⇒ `completed`, never `skipped`) and BR-2.11 (forward seeks not
detected). Renamed `sawBackwardJump` to `rewound` because the field now carries meaning rather
than recording an event. Removed `sawForwardJump` from OutcomeEvidence, the `ev_saw_forward`
column, and the forward-detection logic from `summarise()`. Simplified BR-1.4 to 'any other
backward jump keeps the same play and sets rewound' — no threshold reasoning needed.

PLACED THE `rewound` CHECK ABOVE THE TRACK-CHANGE CHECK in the classifier, and flagged that
ordering as the whole of BR-2.10: a listener who rewinds to re-hear a passage and then moves on at
40% produces exactly the observation pattern of a skip — below threshold, ended by track change —
so testing `rewound` first is what stops that being recorded as a rejection.

FLAGGED HONESTLY that BR-2.10 is the one rule in U1 that encodes a PREFERENCE JUDGEMENT rather
than an observation, a departure from the project's usual separation of the two. Argued it is safe
here specifically because the raw trail is retained: the inference is visible as a flag, reversible
by reclassification, and never destroys the evidence it was drawn from, so an analyst who disagrees
can recompute without it. Recorded that reasoning in business-rules.md rather than leaving the
departure silent.

RECORDED THE ACCEPTED CONSEQUENCE of dropping forward detection: a forward seek would inflate
`lastProgressMs` and could produce a false `completed`. Noted once, without relitigating — the
user's judgement that the case does not occur is theirs to make, and the retained trail covers
revisiting it.

Also noted that `lastProgressMs` must STILL be the maximum rather than the final value even though
BR-2.10 now guards the rewind case from the other direction — the maximum is what makes a replayed
track resolve as `completed` rather than depending on where the final sample landed.

Propagated to component-methods.md (OutcomeEvidence interface) and aidlc-state.md. Added property
P-11: a rewound trail never classifies as skipped, for any progress sequence."
**Context**: CONSTRUCTION — U1 Functional Design revised

---

## U1 Ratio Redefined — Listened Time Replaces Position, Removing Three Rules
**Timestamp**: 2026-08-25
**User Input**: "Regarding BR2.10 - I don't know if a specific rule needs to be created for this,
just that we likely don't need specific logic to handle it. rewinding will just extend the play
time of the track which will increase it's ratio (making it possible for the play to duration
ratio to exceed 1.0), that will not conflict with the 90% skip vs. compete tasks."
**AI Response**: "Identified that the user's reasoning was correct but rested on a different
metric than the one designed, and said so rather than accepting or rejecting the premise as
stated. The design defined `completionRatio` as FURTHEST POSITION REACHED
(`max(progress) / duration`); under that definition rewinding does NOT raise the ratio — the
position moves backwards while the maximum stays put — which is precisely why I had reached for a
special rule. The user's statement holds under ACCUMULATED LISTENING TIME, where re-hearing a
passage adds to the numerator and the ratio can exceed 1.0.

Adopted the user's metric. `completionRatio` is now `listenedMs / durationMs`, where `listenedMs`
is the sum of forward progress, seeded with the first sample's position.

THIS REMOVED THREE THINGS RATHER THAN ADDING ONE: the replay-versus-rewind segmentation branch
(BR-1.3/1.4), the rewind classification rule (the old BR-2.10), and forward-seek detection. The
classifier went from five branches to four with no special cases. All the subtlety moved into
`summarise`, which is arithmetic over a trail and exhaustively property-testable — a better home
than a branch in `classify`, which is a judgement that has to be argued for. This also removed the
one rule in U1 that encoded a PREFERENCE JUDGEMENT rather than an observation, restoring the
project's separation of the two.

THREE DETAILS IN THE SUMMATION CARRY THE DESIGN, each recorded with why:
(1) Clamping each step at zero is what makes rewinds free — a negative step contributes nothing
rather than subtracting, so re-listening adds its time again. That single clamp is the entire
replacement for the deleted rewind rule.
(2) Capping each step at elapsed wall-clock time is ACCOUNTING, NOT SEEK DETECTION — you cannot
listen to more audio than time has passed. Without it, an undetected forward seek would add its
whole jump as though heard. With it, forward seeks are harmless without any of the detection logic
the user rejected. Retained as a new BR-2.10 and framed explicitly as arithmetic.
(3) Seeding `listenedMs` with the first sample's position, because the listener heard everything up
to the first poll; starting at zero would systematically undercount every play by up to one poll
interval.

FLAGGED PROMINENTLY, in three documents, that `completionRatio` MUST NOT BE CLAMPED to 1.0 —
clamping looks like defensive hygiene and would silently destroy the repeat-listen signal, since a
ratio of 2.4 means the track was heard nearly two and a half times. Updated property P-3 from 'in
[0,1]' to '>= 0, not bounded above', and noted it as the property most likely to be got wrong.

RECORDED TWO CONSEQUENCES rather than letting them surface later: (a) a track played twice in a row
is now ONE play record with ratio ≈ 2.0 instead of two records, so play counts undercount repeats
and the ratio carries that signal instead — relevant to US-16's history-based rules; (b) listened
time RAISES a rewound play's ratio but does not GUARANTEE it clears 0.90 — rewinding at 40%,
re-hearing 20–40%, then leaving gives ≈ 0.60 and still classifies as `skipped`. Deliberately added
no rule for the second case: the premise 'a rewind means I like it' is a statement about intent,
and encoding it would put back exactly what removing the old BR-2.10 achieved. Also noted the case
is arguably classified correctly — the listener heard 60% and chose to leave — and that `rewound`
is retained as evidence so reclassification can revisit it if it proves to matter.

Retained `maxProgressMs` and `rewound` as EVIDENCE ONLY, explicitly marked as not read by the
classifier, so they stay useful to an analyst without becoming triggers. Replaced property P-5
(maximum vs final progress — now moot) with 'listenedMs counts only forward movement', and added
P-11: adding a rewind followed by re-listening never DECREASES the ratio. P-11 is the formal
statement of what makes the special case unnecessary — if it ever fails, the simplification is
unsound and explicit rewind handling has to return.

Propagated through business-rules.md, business-logic-model.md, domain-entities.md (including the
migration-001 schema columns), component-methods.md and aidlc-state.md."
**Context**: CONSTRUCTION — U1 Functional Design revised; three rules removed

---

## U1 NFR Design and Infrastructure Design Complete; R7 Closed
**Timestamp**: 2026-08-25
**User Input**: "looks good... lets move on"
**AI Response**: "Recorded approval of U1 Functional Design. Ran NFR Design and Infrastructure
Design together as a single question round, since the execution plan marks both EXECUTE (narrow)
for U1 and neither had enough independent content to justify two gates.

Recorded explicitly, in both plans, which mandatory question categories were evaluated and found
NOT APPLICABLE rather than skipping them silently: security (no change — download-only export
opens no network path), scalability (one user, one process, ~200 plays/day — no load exists),
availability (a local tool with no uptime obligation), messaging, networking, shared
infrastructure. Also recorded what U1 deliberately does NOT introduce — no queue, cache, circuit
breaker, connection pool, load balancer or rate limiter — and why retrying a failed write is
actively wrong here: a locked or full database does not resolve within a poll interval, so
retrying inside the poll loop would delay the display to save one sample of many.

Answers, all matching recommendations: Q1 = C (`node:sqlite` behind the NFR-10 repository
interface), Q2 = A (buffer in memory, one transaction per play), Q3 = A (bind mount `./data/`),
Q4 = B (automatic dated snapshots).

NOTED THAT Q1 AND Q2 PAIR RATHER THAN BEING INDEPENDENTLY DEFENSIBLE: `node:sqlite` is
synchronous, which would be a real event-loop concern at option B's ~28,800 writes/day, but is
irrelevant at ~200 batched transactions/day. The two choices make each other safe.

Q4 = B INTRODUCED CAPABILITY NOT COVERED BY EXISTING REQUIREMENTS — FR-49–54 describe
user-initiated export only. Recorded it as **FR-56** (automatic dated export snapshot on a
schedule) rather than smuggling it in as an implementation detail, with its justification stated:
listening history is the only artefact in the project that cannot be regenerated.

CLOSED R7 CONCRETELY rather than restating the action. Resolved the upstream head via the GitHub
API: `7b5fde6309a52a7874768c63deda7880ee85935b`, dated 2026-08-21, 'fix: add offset param to
getMyPlaylists (#72)'. Specified pinning it in compose.yaml and noted the secondary benefit — the
CI Docker-build job becomes a genuine drift detector, because against `main` a build failure was
ambiguous (our change, or upstream moved?) whereas against a pinned SHA it is unambiguously ours.
Marked R7 closed in requirements.md, execution-plan.md and aidlc-state.md.

FOUR ARTIFACTS GENERATED: nfr-design-patterns.md (9 patterns), logical-components.md (6 logical
components plus sizing), infrastructure-design.md, deployment-architecture.md.

THREE FINDINGS WORTH RECORDING:
(1) **Mount the directory, not the file.** SQLite's `-wal` and `-shm` files live beside the
database, so a mount capturing only `history.db` would break crash recovery. This differs from the
existing `secrets/` mount, which binds a single file — copying that pattern here would be a subtle
and hard-to-diagnose mistake, so it is called out explicitly.
(2) **The gitignore paradox, stated rather than glossed.** `./data/` sits inside the project tree
and is gitignored — which makes it invisible to git and therefore MORE exposed to `git clean
-xdf`, not less. Database and snapshots share one deletion event, so FR-56 protects against
corruption but NOT against losing the directory. Recorded as an accepted residual risk with two
cheap escape hatches (point SNAPSHOT_DIR outside the tree, or move the mount per Q3 = B), neither
requiring redesign. Not resolved unilaterally, since Q3 = A was chosen with the trade-off visible.
(3) **Startup step 4 probes writability rather than assuming it.** Bind-mount permission problems
on Windows otherwise surface as write failures at the first play boundary — minutes after startup,
with the user having already seen a healthy-looking UI. Failing at startup makes it immediate and
diagnosable.

Also recorded the retention ASYMMETRY as the whole of the lifecycle policy: snapshots rotate
freely because they are derived and regenerable from the database, while trails are not pruned on
a timer because they are the raw material FR-20 depends on. That asymmetry is precisely why W-2
defers trail pruning to a considered routine rather than a cron job.

Confirmed U1 requires NO SECURITY REVIEW — export is a download over the existing loopback
listener, so NFR-01–07 are untouched. The §3.5 download-only decision holds all the way through to
infrastructure, which was its purpose."
**Context**: CONSTRUCTION — U1 NFR + Infrastructure Design complete; R7 closed; awaiting approval

---

## U1 Code Generation Complete
**Timestamp**: 2026-08-25
**User Input**: "continue"
**AI Response**: "Recorded approval of U1 NFR and Infrastructure Design. Created the code
generation plan (26 numbered steps with story traceability) and executed it. Proceeded through the
Step 7 plan-approval gate as with previous stages, since the design was already fully specified
across seven approved documents and the plan introduced no new decisions.

CREATED 10 source files, MODIFIED 8, added 7 test files. Suite grew 100 → 184 tests, all passing;
typecheck and build clean.

LIVE SMOKE TEST against the real account rather than trusting the unit tests: server started,
migration applied (schema v1), backfill inserted 50 real plays all correctly marked
`outcome: unknown`, CSV and JSON export streamed with coverage headers, an invalid filter returned
400 before any output, diagnostics reported all three new steps ok, and — importantly — the
Host-header guard still returned 403 for evil.com, confirming NFR-01–07 survived the change.

FOUR FINDINGS, all recorded in the code summary:

(1) **The short-track limitation is INTERMITTENT, not systematic — the design documents were
wrong and have been corrected.** They stated that tracks under ~30s played in full would be
*consistently* recorded as skipped. Writing the tests disproved it. The final poll of a play lands
somewhere in the last poll interval, so a fully-played track clears the threshold reliably only
when duration >= pollInterval / (1 - threshold) = 30s; below that the observed ratio for a 20s
track lands anywhere in 0.85–1.00, so it is SOMETIMES skipped and sometimes completed. The same
short track played identically can be recorded differently on different occasions. That is better
than a uniform bias in one respect and worse in another — an inconsistency is harder to notice and
harder to correct for than a systematic one. Corrected in business-rules.md, aidlc-state.md,
stories.md and the functional design plan; both outcomes now pinned by tests including one
asserting the same duration resolving each way.

(2) **Backfilled plays cannot carry an ISRC, which constrains U2.** Probed the live API rather
than assuming: `GET /me/player/recently-played` returns NO `external_ids` field at all — the track
object carries only album, artists, disc_number, duration_ms, explicit, external_urls, href, id,
is_local, name, preview_url, track_number, type, uri. The 50 backfilled rows therefore have
isrc = null and U2's label backfill will silently skip them. Not a U1 defect, but recorded as an
open item so U2 chooses deliberately between an extra GET /tracks/{id} per backfilled row and
accepting label-less backfilled history.

(3) **A test helper initially modelled an impossible trace.** The first `completeTrail` emitted a
final observation exactly at the track's duration, which never occurs — polls do not coincide with
track endings. It made three tests pass that should have failed and hid finding (1). Replaced with
a helper taking the final gap as a parameter, plus worstCaseTrail and replayTrail. Worth recording
because a generator that models an impossible state produces confidently green tests about
behaviour that cannot happen.

(4) **Ratios above 1.0 require a replay, not merely long listening** — progress cannot exceed
duration, so the unclamped ratio only passes 1.0 when progress resets and advances again. The
first property test asserted otherwise and failed correctly.

THREE DEVIATIONS FROM DESIGN, each recorded with reasoning: `T | null` instead of a `Maybe<T>`
wrapper (identical semantics, matches the existing Enrichment shape and nullable columns; the
wrapper's only extra was a per-field reason that `warnings` already supplies; the rule is enforced
where it matters, in renderMaybe, and property-tested by P-10); `nowPlayingService` already emitted
`tick` from the WebSocket work so no change was needed, only a consumer; and `listPlays` returns
IterableIterator rather than AsyncIterable because node:sqlite is synchronous and an async iterator
would add ceremony without adding concurrency — streaming and constant memory are unaffected.

Wrote `test/purity.test.ts` implementing LC-6, including meta-tests asserting the detector itself
still detects — a green check that verifies nothing would be worse than no check. R7 closed in
compose.yaml with the pinned SHA. Recorded the gitignore exposure caveat directly in .gitignore
and the README, where someone about to delete the directory might actually see it."
**Context**: CONSTRUCTION — U1 Code Generation complete; awaiting approval

---

## U1 Build and Test — Three Defects Found, Two Fixed, One Escalated
**Timestamp**: 2026-08-26
**User Input**: "lets proceed to build and test"
**Build Status**: Success (after two fixes)
**Test Status**: Pass — 193/193, coverage 99.41% line / 93.00% branch
**AI Response**: "Recorded approval of U1 Code Generation. Ran Build and Test, treating the two
open verification items from code generation as the point of the stage: live playback recording,
and the container bind mount.

Checked first whether each was verifiable. Nothing was playing (204 from currently-playing), so
**live playback recording remains UNVERIFIED and is reported as outstanding rather than assumed**.
Docker was available, so the container item could be closed — and closing it found real defects.

Wrote `test/historyIntegration.test.ts` (9 scenarios) to cover the units-fit-together question
that unit tests cannot: tick stream → observer → classifier → repository → export, driven by a
scripted source so it runs in CI.

THREE DEFECTS FOUND BY ACTUALLY RUNNING THINGS:

(1) **The R7 SHA pin broke the container build.** `git clone --depth 1 --branch <ref>` fails with
exit 128 on a commit SHA — `--branch` accepts only branch and tag names. Closing R7 in
Infrastructure Design broke the build in the same change. Fixed with git init + git fetch --depth 1
origin <ref> + checkout FETCH_HEAD, which handles SHA, branch and tag identically.
**NEARLY MISSED**: the build ran as `docker compose build 2>&1 | tail -25`, so the reported exit
code was the PIPE's, not the build's, and it read as success. The failure was visible only in the
log text. Recorded prominently in the build instructions, because it would have shipped a
'verified' build that does not build.

(2) **The bind mount was unwritable by the container's runtime user.** The image ran as `node`
(uid 1000) while the Windows bind mount arrived root-owned 755, producing 'History: DISABLED —
unable to open database file'. This is EXACTLY the failure the infrastructure design named as most
likely, and the startup writability probe worked as intended: the app degraded to display-only and
said so, rather than failing minutes later at the first play boundary behind a healthy-looking UI.
Fixed with scripts/docker-entrypoint.sh — starts as root, chowns only the mount points, drops to
node via setpriv (no extra package, and the app keeps PID 1 so SIGTERM still reaches the shutdown
handler that flushes the in-progress play). VERIFIED AFTERWARDS rather than assumed: /data owned
1000:1000, and PID 1 is `node dist/server.js` running as Uid 1000 — confirmed via /proc, because
`docker exec ... id` reports the image default (now root) and would have been misleading evidence.

(3) **ESCALATED, NOT FIXED — the local-only guard rejects all published-port traffic.** A
pre-existing U0 defect, surfaced only because the container was exercised for the first time.
`localGuard` requires `req.socket.remoteAddress` to be loopback, but traffic reaching a container
through a published port arrives from the Docker bridge gateway, so every request is refused with
'This application only accepts local connections.' Proven in both directions rather than inferred:
the same /api/health request SUCCEEDS from inside the container ({"status":"ok","mcp":"connected",
"toolCount":30}) and is REFUSED from the host via the published port. **The containerised
deployment has therefore never been able to serve its UI.** compose.yaml records the original
assumption — 'LOCAL_ONLY rejects anything non-loopback that arrives anyway' — which turns out to
reject the legitimate path too. It fails closed, which is the safe direction.

Deliberately did NOT fix it. Any change relaxes the single control that NFR-07's
no-authentication decision rests on, which makes it a posture question for the user rather than a
bug fix — the same reasoning that kept §3.5 route C and wishlist W-1 out of scope. Documented four
options in security-test-instructions.md WITH the argument on each side, including the genuine
counter-argument to the recommended in-container relaxation: any container on the same bridge
network could then reach an app that exposes listening history and playback data without
authentication. Recommended option A (run on the host, works today at zero cost) until
containerised deployment is actually wanted.

(4) **An integration test modelled the sparse stream wrongly and passed for the wrong reason.**
The first version fed the change-suppressed observer a first AND last sample; a real
change-suppressed stream yields roughly one sample at track start, since signature() excludes
progress. Corrected — the fixed test now demonstrates the actual defect, that a fully played track
would be recorded as `unknown`. Second instance in this unit of a test modelling an impossible
state while looking green; noted in the unit-test instructions as a pattern to watch.

GENERATED five artifacts in `aidlc-docs/construction/build-and-test/`: build-instructions.md,
unit-test-instructions.md, integration-test-instructions.md, security-test-instructions.md,
build-and-test-summary.md. Performance tests were SKIPPED with justification rather than
fabricated: one user, ~200 plays and ~200 write transactions per day, no load to test, and the
single performance constraint is structural rather than something a load test would reveal.

Marked live playback recording as outstanding with eight specific manual scenarios, so it is a
named gap rather than a silent one."
**Context**: CONSTRUCTION — U1 Build and Test complete; one open decision escalated to the user

---

## Capability Probe — Saved-Track ("Liked") Status
**Timestamp**: 2026-08-26
**User Input**: "one thing to check... can the API show the 'favorite' status for a track?"
**AI Response**: "Probed live rather than answering from documentation, given this project's
record of documentation-derived conclusions being wrong twice.

RESULT: liked status IS available, but only via the list endpoint. `GET /me/tracks/contains` is
403 Forbidden despite `user-library-read` being confirmed present on the token; `GET /me/tracks`
returns 200 with 596 saved tracks. `GET /me/albums/contains` is also 403.

IDENTIFIED A GENERALISABLE PATTERN rather than treating this as an isolated fact: this is now the
THIRD `/contains` endpoint found blocked while its list counterpart works — `/me/following/contains`
(Part 3), `/me/tracks/contains` and `/me/albums/contains` (Part 4). Development Mode appears to
restrict the membership-check family generally while leaving list endpoints open. Recorded as a
rule of thumb because it predicts behaviour for endpoints not yet tried, and because the workaround
is always identical: fetch the set once, cache it, resolve membership locally. Noted the irony that
the restricted endpoints are the cheaper ones — blocking them forces clients to download whole
collections to answer a one-bit question.

COST: 596 saved tracks = 12 requests at limit=50, cached with a TTL — the same shape as the
existing FollowedArtistsCache, so a track change would cost zero additional API calls.

ARGUED WHY THIS MATTERS MORE THAN FOLLOW STATUS: liking is an explicit PER-TRACK positive
judgement, whereas following an artist is a coarser signal about a body of work. For the promotion
hypothesis (R1) it is also a CONTROL VARIABLE — an already-liked track is self-evidently
profile-matched rather than promoted, so it separates 'Spotify played me something I already chose'
from 'Spotify introduced something new', which is the population the hypothesis is actually about.

SURFACED A SECOND-ORDER SIGNAL that would otherwise be lost: a track not liked when it started
playing and liked shortly afterwards was almost certainly liked BECAUSE of that play. That
transition is arguably the strongest positive signal the Spotify API can yield — stronger than a
completion, because a completion can be passive and a like cannot. Capturing it needs the
before-value snapshotted per play (which the existing snapshot pattern already provides) plus a
later comparison against the refreshed set.

Recorded as research-findings.md Part 4 and flagged in aidlc-state.md as a DECISION NEEDED —
whether to add `liked` as an enrichment field, a PlayRecord column via migration 002, and a rule
field. Not added unilaterally: the user asked whether the capability exists, which is a question,
not an instruction to build it."
**Context**: CONSTRUCTION — capability probe; scope decision pending

---

## U1 Live-Verified; Liked-Transitions Agreed for U2; Session Wrap-Up
**Timestamp**: 2026-08-26
**User Input**: "I agree regarding 'kept-unliked' - analytic value is significantly less than the
active change values. / I agree to include this in U2. / I have now played a number of tracks and
the app appears to be working flawlessly. I think we can say that U1 is running well (though it's
not yet containerized and deployed on Rancher Desktop). / Some Wrapup tasks: -It think it's worth
taking a look at the database to look for expected behavior. -Update the project documentation for
current state, record the recommended updates from our current discussion. (We will start a fresh
claude session so make sure you can restart cleanly) -Project Git Commit"
**AI Response**: "Recorded two decisions: liked-status transitions go into U2 with the four-state
model plus `unknown`, and `kept-unliked` is treated as the reference level rather than an observed
choice.

INSPECTED THE DATABASE DIRECTLY rather than accepting 'working flawlessly' on trust — the user
asked for expected-behaviour checking, and the value of the exercise is in what it might
contradict. 68 plays (18 live, 50 backfilled), 0 counted gaps, max observation gap 3–4 s across
every play confirming no missed polls. Verified: ISRC and follow status present on EVERY live play
(unknownIsrc = 50 = exactly the backfilled rows), 12 completions at ratios 0.910–0.995, 3 skips all
attributed `skipSource = user`, pause correctly producing `unknown` rather than `skipped`, trail
length proportional to duration (320 s track → 104 observations ≈ 320/3), and
`listenedMs == maxProgressMs` throughout, which is exactly right given no rewinds occurred. Also
triggered an FR-56 snapshot manually rather than leaving the mechanism untested, since the 24 h
timer had not fired: 68 rows written with the coverage header, dated filename correct.

FOUND A SUBSTANTIVE ISSUE THE SUMMARY STATISTICS HID. Sorting live plays by *seconds remaining at
play end* rather than by ratio revealed a sharply bimodal distribution: plays end either ≤ 23 s
from the end (14 of 17) or ≥ 194 s from the end (3 of 17), with a 178-second gap containing
nothing. The genuine rejections are unmistakable and nowhere near the boundary — but the 0.90
threshold cuts straight through the *dense* cluster, separating 'moved on with 16 s left'
(completed) from 'moved on with 20 s left' (skipped). A four-second difference decides a
categorical outcome in the region where behaviour is most concentrated and least meaningful.
6 of 17 live plays sit within ±0.03 of the threshold, and two tracks skipped after roughly 88% are
recorded as rejections — false negatives in the very outcome variable the promotion hypothesis is
tested against.

Noted that a fixed ~30 s tail window would separate this listener's behaviour with 178 s of margin,
which is option D from U1 FD Q1 — recommended then and not chosen. Presented it as MEASUREMENT
rather than vindication: the earlier discussion had no data, and now there is some. Did NOT change
it: the threshold was an explicit user decision and 18 plays is a small sample. Recommended
revisiting at a few hundred plays, and recorded that it is fully correctable retroactively because
trails are retained — the first time Application Design Q1 = C has actually paid off.

Also recorded two secondary observations that would otherwise mislead an analyst: a brief false
start creates its own very-low-ratio `unknown` record (`.CoDA.` at 0.022 with 2 observations),
distinguishable by `observationCount`; and a long pause splits one listen into two records
(`Duality`). And one honest gap: rewind/replay has NEVER fired against real listening —
`rewound = false` on all 18 plays — so that path remains unit- and property-tested only.

CREATED `CLAUDE.md` for clean session restart, since none existed. It orients a fresh session on
what the project actually is (a hypothesis-testing instrument, not a now-playing display), states
the single most important working rule — probe the live API, do not reason from documentation,
with the three times that has caught an error — and lists the non-obvious traps: tick-vs-change,
the purity constraint, never clamping the ratio, null-means-unknown, and checking build exit codes
directly rather than through a pipe.

CREATED `construction/u1-listening-history/live-verification.md` with the full evidence, closing
the verification item left open at Build and Test.

Updated aidlc-state.md to current: U1 complete and live-verified, U2 next, the threshold finding,
and the liked-transition decision with what U2 must now deliver."
**Context**: CONSTRUCTION — U1 complete and live-verified; documentation prepared for a fresh session

---

## U2 Functional Design — MusicBrainz First Live Probe; Questions Written
**Timestamp**: 2026-08-26
**User Input**: "Starting an new session so we have clean context for the U2 work... so review
project state and lets get going."
**AI Response**: "Reviewed aidlc-state.md, the last audit entries, the U2 unit definition and
FR-12-16, then STOPPED BEFORE WRITING FUNCTIONAL DESIGN QUESTIONS because of a gap the review
exposed: MusicBrainz had never been called by this project. Every U2 assumption -- that ISRC
lookup works, that labels come back, that coverage is adequate, that the three FR-13 classification
signals exist -- was documentation-derived, which is the exact pattern that has produced a wrong
conclusion three times here. Probed it live against the 19 distinct ISRCs actually in history.db
rather than a curated sample. 47 requests, 1.2 s spacing, descriptive User-Agent (NFR-14/15).

CAUGHT A FOURTH DOCUMENTATION-VS-REALITY FAILURE, and the first one that was PLAUSIBLE rather than
an error code. `GET /ws/2/isrc/{isrc}?inc=releases` returns 200 with recordings and NO releases --
the inc parameter is silently dropped. All 19 ISRCs came back looking like MusicBrainz has no
releases for anything the user listens to. That is false, and it would have been recorded as a
coverage finding had it not been checked against Audioslave, known to have 44 releases. Noted the
general hazard: a wrong request shape is indistinguishable from absent data. The chain that works
is /isrc/{isrc} -> recording MBID, then /release?recording={mbid}&inc=labels -- a browse, where inc
IS honoured. Two requests per track, matching R11's estimate exactly.

MEASURED R2 INSTEAD OF FEARING IT. End-to-end label coverage is 57.9% (11/19). Crucially the
missingness is not random: pre-2022 releases resolved 5/5 (100%), 2022-onward 6/14 (43%). The
misses are recent independent singles -- Prof, Ren, BOVSKI, Ark Woods -- precisely the population
the promotion hypothesis is about. All five QZ* ISRCs missed while USUM/USSM/GBUM (major
registrants) all resolved. Consequence recorded plainly: any analysis that drops `unknown` rows
silently drops the newest independent music first.

FOUND THAT FR-13'S PREMISE IS ONE STEP TOO LATE. FR-13 says store per-signal votes rather than a
boolean, anticipating that CLASSIFICATION is ambiguous. The probe shows the INPUT is ambiguous:
a recording maps to many releases carrying different labels. Audioslave -- Like a Stone yields 44
releases and 10 labels spanning TWO DIFFERENT MAJORS (Epic/Sony and Interscope/Universal);
Slipknot -- Duality yields 50 releases and 12 labels. There is no single 'the label'. Tested
narrowing by the album title and release date Spotify already gives us: title-only fires on 13/13
and cut Slipknot from 12 labels to the one correct one (Roadrunner); title+date is more precise
(Audioslave 44 -> 1) but fires on only 8/13, failing on year-only Spotify dates and deluxe
reissues.

CONFIRMED ALL THREE FR-13 SIGNALS EXIST, AND THAT THEY DISAGREE ON REAL DATA. Label `type`
(Imprint / Original Production / Distributor / Publisher / null) -- and found that Publisher is NOT
a record label: Faouzia's only entry is `Faouzia Music`, type Publisher, disambiguation SOCAN, a
publishing entity, while she records for Atlantic. Flagged the direction of that error as the
dangerous part -- majors routinely use publishing subsidiaries, so including publishers
over-counts independence in exactly the direction that would FALSELY SUPPORT the hypothesis.
Relationships (inc=label-rels) return three non-interchangeable, directional types -- imprint,
label ownership, label distribution. Epic->Sony, Interscope->UMG and Roadrunner->Warner all walk
correctly, but Spinefarm's distribution relationship points at [PIAS], an independent, while
Spinefarm is Universal-owned. That is R3 occurring on real data, and it is why ownership and
distribution must be voted separately rather than merged. The ISRC registrant prefix is the
weakest signal but the only one with 100% coverage -- it is available for the six tracks
MusicBrainz cannot resolve at all.

ESTABLISHED THAT THE OBVIOUS FIX FOR THE COVERAGE GAP IS UNSAFE. Tested artist+title search
fallback on the six ISRC misses: 2 clean recoveries, 2 count=0, 1 found with no releases (so no
label obtainable), and 1 CONFIDENTLY WRONG -- for Ren's 'Vincent's Tale - Starry Night - Act III'
the top TWO hits score 100 and are DIFFERENT TRACKS ('The Bedroom', 'Self Portrait'), while the
near-correct 'Starry Night, Act II' scores 95. `score` does not rank correctness, so any
threshold rule will occasionally attach another track's label to a play, and nothing downstream
could detect it. Stated the asymmetry that follows and made it the organising principle of the
unit: a wrong label is invisible, `unknown` is counted in the coverage figures (FR-51). U2's
failure mode is not missing data but confident wrong data.

RECORDED the probe as research-findings.md Part 5 (authoritative, with Correction 4), summarised
it in aidlc-state.md, and WROTE construction/plans/u2-functional-design-plan.md with NINE questions
-- three of which exist only because of the probe (which release's label counts; whether to use
search fallback; whether Publisher entries are excluded) -- each with options grounded in measured
numbers rather than speculation, plus a recommendation and its reasoning. Also carried forward the
already-agreed liked-status work as Q8, raising the one functional detail still open (liking often
happens just AFTER a track ends, so sampling at the exact play boundary would record the strongest
positive signal available as `kept-unliked`), and Q9 on pre-registering the Phase 2 hypothesis-gate
criterion before results are seen rather than after.

Did NOT proceed to generate functional design artifacts -- the stage gates on user answers."
**Context**: CONSTRUCTION — U2 Functional Design, questions awaiting user answers

---

## U2 Functional Design — Round 1 Answers; Two Recommendations Reversed by Further Probing
**Timestamp**: 2026-08-26
**User Input**: "completed questionaire - if I didn't enter a value use the recommended value for
that question." (Q5 = A, with "in general we should prioritize accuracy in the 'Artist Is
Independant' determination even if it ultimately misses some independant products."; Q6 = A, "we
shouldn't imply precision that doesn't exist.")
**AI Response**: "Recorded Q1-Q9, applying recommended defaults to the seven blanks as instructed.
Both explicit answers DEPARTED from my recommendation (Q5 = A not C, Q6 = A not D), and both
departures turned out to be better than what I proposed.

TREATED THE Q5 ANSWER AS CARRYING MORE THAN AN OPTION LETTER. Two things in it warranted live
testing rather than interpretation: the precision-over-recall principle, and the fact that it is
framed at the ARTIST level while U2 had been designed entirely at the RELEASE level. Probed both
rather than reading them as phrasing.

REVERSED MY OWN Q4 RECOMMENDATION ON EVIDENCE. I had argued that MusicBrainz's `[no label]`
sentinel is an assertion of self-release and should count as `independent`. Tested it by asking
whether the two affected artists carry real labels on their OTHER MusicBrainz releases. They do:
Imminence has 41 of 66 releases with named labels including Arising Empire, Sumerian and VIRGIN
MUSIC GROUP -- i.e. Universal -- and Red Leather has 6 of 25 including EMPIRE. The sentinel
reflects incomplete per-release data entry, not a claim of self-release. Under my recommendation
both plays would have been classified `independent`, which is wrong, and wrong in the direction
that FALSELY SUPPORTS the promotion hypothesis. Withdrew Q4 = A as Q10 and recommended `unknown`.
Noted the irony plainly: this is the 'confident wrong data' failure mode that the unit's whole
framing warns about, arriving in the one place a recommendation had waved it through, and it was
the user's precision principle that exposed it.

FOUND AN EXACT SPOTIFY-TO-MUSICBRAINZ ARTIST JOIN THAT WAS NOT KNOWN AT APPLICATION DESIGN.
MusicBrainz stores streaming links as first-class `url` entities, so
GET /ws/2/url?resource=https://open.spotify.com/artist/{id}&inc=artist-rels maps the Spotify artist
ID the app already holds directly to a MusicBrainz artist MBID. No name matching, no `score`, and
therefore none of the misattribution hazard that made search fallback unsafe in Part 5. Demonstrated
the hazard it removes rather than asserting it: MusicBrainz holds THREE artists named `Prof`, and
while name search happened to rank the right one first, the join returns it by construction rather
than by luck -- and the join also resolved `Mjhanks`, which name search failed to find at all.

MEASURED artist-level coverage on the SAME 19 tracks so the numbers are directly comparable rather
than extrapolated: Spotify artist URL resolves to a MusicBrainz artist for 15/17 distinct artists
(88.2%), and 13/17 (76.5%) yield at least one named label, against 57.9% at release level. It
recovers 5 of the 6 ISRC 404s and both `[no label]` cases.

DID NOT PRESENT THIS AS A STRICT UPGRADE. Artist-level answers a DIFFERENT question, and one track
in the sample proves it: Token -- 'Full Bag' is `Never Too Different` (independent) at release
level and ATLANTIC at artist level. Both are true -- an Atlantic artist who released this one
independently. For R1 that is plausibly a control variable (is the artist signed?) versus the
treatment (was this release a label push?), so the recommendation is two SEPARATE fields, never
merged. Also recorded two artist-level noise sources found in the data: bootlegs and regional
licensees inflate the label set (Slipknot's 100 releases yield Roadrunner alongside Smokin' Cactus
and Jigu Records Corporation), and career aggregation ignores time (Audioslave spans Epic,
Interscope, Columbia, Polydor, Geffen).

FLAGGED ONE AMBIGUITY IN Q6 RATHER THAN RESOLVING IT SILENTLY. The user's reasoning is decisive
against a numeric score, but option A read literally as 'band only, discard votes' would contradict
FR-13's explicit requirement to record which signals fired and how they voted, the U2 exit
criterion, and the store-observations-derive-judgements rule whose value U1's threshold finding
already demonstrated. Almost certainly not the intent; asked as Q11 rather than assumed.

ASKED whether the user's own precision principle should move Q5 from A to C (treating `Distributor`
as a weaker signal than `Imprint`/`Original Production`), since C is the direct application of the
principle they stated and they may simply have been endorsing A's core content.

RECORDED the second probe as research-findings.md Part 6 with Correction 5, and wrote four
follow-ups (Q10 withdrawal, Q11 clarification, Q12 artist-level join, Q13 distributor weighting).
Did not generate design artifacts -- Step 5 forbids proceeding while ambiguity is open."
**Context**: CONSTRUCTION — U2 Functional Design, round 2 questions awaiting answers

---

## U2 Functional Design — Complete
**Timestamp**: 2026-08-26
**User Input**: "Updated" (Q10 = A, Q11 = A, Q12 = A, Q13 = A — all recommended)
**AI Response**: "All 13 questions now answered across two rounds, no ambiguity remaining, so
generated the three functional design artifacts.

CONFIRMED THE FULL ANSWER SET before generating: Q1 = A cascade, Q2 = A+C store all and mark
contested, Q3 = B+D single-hit fallback with match method recorded, Q4 WITHDRAWN and superseded by
Q10 = A ([no label] is unknown), Q5 = A extended by Q13 = A (Publisher ineligible, Distributor
weak), Q6 = A with Q11 = A (ordinal band, votes retained underneath), Q7 = A backfill ISRCs,
Q8 = A grace window, Q9 = C pre-registered gate with unknown reported alongside, Q12 = A
artist-level as a separate never-merged field.

ELEVATED THE USER'S Q5 SENTENCE TO A STANDING RULE FOR THE UNIT rather than treating it as a
comment on one question. 'Prioritise accuracy in the Artist Is Independent determination even if it
ultimately misses some independent products' is a precision-over-recall directive, and it is stated
at the top of both business-rules.md and domain-entities.md as the rule governing the other rules.
Made its asymmetry explicit as arithmetic in BR-4.3/4.4: any strong major vote makes the verdict
major, while independent requires the ABSENCE of any major vote at any strength. Stated the
justification in terms of the hypothesis rather than in terms of tidiness -- missing an independent
track costs one row, whereas calling a major track independent manufactures support for the very
hypothesis under test, and does so invisibly. Noted that the principle has already caught one live
error: it is what exposed that my own round-1 `[no label]` recommendation was wrong.

GENERATED domain-entities.md (7 entities), business-logic-model.md (8 flows) and business-rules.md
(BR-1 to BR-11, 60 numbered rules), each carrying the measured evidence for why the rule exists
rather than asserting it. Two entities -- ArtistLabelResolution and SignalVote -- would not exist
had the design been written from documentation.

DEFINED MIGRATION 002 as additive only: 5 new tables (label_resolution, label_candidate,
artist_label_resolution, artist_label, label_signal_vote), 14 new nullable play columns, 2 indexes.
No existing column altered or dropped, so U1 data is untouched and every existing row simply
becomes a row with unresolved labels -- which is exactly what it is. Every new column is nullable
and NULL means unknown, never false or 0, end to end including exports.

CARRIED THE OBSERVATION-VERSUS-JUDGEMENT SPLIT THROUGH DELIBERATELY. Cached MusicBrainz facts
(resolutions, candidates, votes) live in their own tables keyed by ISRC and artist, satisfying
FR-14 and the rate limit; the derived verdict is snapshotted onto the play with a
label_classifier_version, so exports need no join (FR-50) and a re-tuned classifier cannot silently
rewrite what was believed at the time. Consequence recorded as BR-8.7: reclassification recomputes
verdicts from stored candidates and votes with ZERO MusicBrainz requests -- the same structure that
let U1's completion threshold be revisited without re-collecting a play. R3 guarantees this
classifier will be re-tuned, so that property is the difference between cheap and impossible.

PINNED THE SILENT-FAILURE TRAPS AS RULES RATHER THAN PROSE. BR-1.2 requires the two-call chain and
asks for a test against a recording known to have many releases, because folding it into one call
reintroduces a 200-with-inc-ignored response that is indistinguishable from absent data -- a
plausible wrong answer being worse than a loud one. BR-4.8 requires labelClassifier purity and
names test/purity.test.ts as the only thing that catches a Date.now() there, since FR-42 would
break while every other test passed. BR-7.7 keeps `pending` distinct from `unknown`, because
collapsing them would corrupt the very coverage metric that exists to measure R2.

MADE THE HYPOTHESIS GATE FALSIFIABLE IN THE ARTIFACTS, not just in intent: BR-11.1 pre-registers
the comparison before results are seen, BR-11.5 requires the result be recorded either way, and
BR-11.6 requires 'insufficient data' rather than a verdict below a stated minimum sample. Argued
BR-11.2 (report the unknown group alongside) as substantive rather than procedural -- if the
unknown group's skip rate resembles the independent group's, that is evidence about who the
unknowns are, and given the measured recency bias it is the single most informative check
available.

Skipped frontend-components.md with justification rather than producing an empty artifact: the U0
component hierarchy is unchanged, and the one new UI behaviour is specified as BR-7.7."
**Context**: CONSTRUCTION — U2 Functional Design complete, awaiting approval

---

## U2 Functional Design APPROVED — Resolution Trace Added at the Gate
**Timestamp**: 2026-08-31
**User Input**: "Approve the design but include a debug output that shows how the data for a track
was collected (perhaps showing the rules applied so different rule path's can be tested). The app
has a diagnostics pop-up and I think that likely could be used for debug data." · plus "Commit now
to main"
**AI Response**: "Approved the U2 Functional Design and folded the new requirement into the
artifacts rather than deferring it to Code Generation, since it changes what the unit must produce.

COMMITTED THE EXISTING U2 WORK FIRST as 297d06b, before amending anything. Four modified files and
the whole u2-label-enrichment tree had been sitting uncommitted since 2026-08-26 — a week of design
work living only in the working tree, on a project whose stated rule is commit directly to main.
Kept the amendment as a separate change so the approval is legible in history.

ADDED BR-12 (8 rules), FLOW 9 `explain(playId)`, AND THE ResolutionTrace ENTITY. Traced the
derivation in order: join and match method, narrowing tier, candidates with eligibility, per-signal
votes, the fold, and the confidence caps — each step naming the rule IDs that fired.

THE AMENDMENT COSTS NO SCHEMA, AND THAT IS NOT LUCK. The trace is recomputed by re-running the pure
classifier over `label_candidate` and `label_signal_vote` — exactly the data BR-8.7 already required
so reclassification could run without MusicBrainz requests. Migration 002 is unchanged. This is the
second time the store-observations-derive-judgements split has paid for itself; the first was U1's
completion threshold, which could be revisited without re-collecting a play.

READ THREE THINGS OUT OF THE REQUEST THAT IT DID NOT SAY LITERALLY.

First, 'so different rule paths can be tested' cannot be satisfied by a now-playing-only view. The
paths that most need inspection are the rare ones — contested (two majors on one release), the
`all` narrowing tier, a search-fallback match, a Distributor-only weak vote — and none of them can
be summoned on demand by playing a track. BR-12.4 makes the trace work for any play in history.
Recomputation is what makes that affordable, so the requirement and its feasibility come from the
same property.

Second, the trace has to show what the rules REFUSED, not only what they found. The standing
precision-over-recall rule operates almost entirely by exclusion — BR-3.1 discards Publisher
candidates, BR-3.2 turns [no label] into unknown, BR-4.4 requires the absence of any major vote —
and exclusion leaves no mark in a verdict. `unknown` because MusicBrainz knew nothing and `unknown`
because a Publisher candidate was found and deliberately discarded are the same output with
completely different meanings. BR-12.3 records the suppressing rule ID per candidate. Faouzia is
the worked case: her only MusicBrainz label is Faouzia Music, type Publisher, and she records for
Atlantic.

Third, a recomputed trace can lie about history, and this one is a certainty rather than a risk. R3
guarantees the classifier will be re-tuned; after that, tracing an old play explains it with today's
rules and produces a derivation that never actually ran. It would be internally consistent,
plausible, and wrong — the same failure shape as MusicBrainz returning 200 with `inc` silently
ignored, which this project was caught by four times. BR-12.5 requires the stored and running
label_classifier_version both be shown with divergence flagged. Anticipated this time rather than
discovered.

DECLINED TO REUSE THE DIAGNOSTIC STEP FORMAT while keeping the user's placement. The existing dialog
is a connect/auth/query health check: a flat DiagnosticStep[] of ok/fail/skip. A derivation is not
pass/fail, and forcing it into that shape would let every step read 'ok' while the verdict is wrong
— which is exactly U2's stated failure mode. BR-12.6 gives the trace its own structure as a second
section in the same dialog.

STATED ONE ASSUMPTION RATHER THAN BLOCKING ON IT: the trace is always available, not behind a
dev-only flag, on the grounds that this is a local single-user app whose premise is inspectable
evidence. Flagged for reversal if wrong.

VERIFIED THE BACKFILL NUMBER AGAINST THE LIVE DATABASE instead of trusting the document. 50 rows
lack an ISRC but resolve to 47 distinct track_ids, so Q7's '47 one-off GET /tracks/{id}' is correct.

ALSO CORRECTED A STALE LINE IN CLAUDE.md that still described U2 as having questions awaiting
answers, contradicting aidlc-state.md. It is the first file a new session reads.

Repo state on restart: 193/193 tests, typecheck clean, 71 plays, database untouched since
2026-08-26."
**Context**: CONSTRUCTION — U2 Functional Design APPROVED with BR-12 added. Next: NFR Design,
scoped to the MusicBrainz integration and the trace's delivery route

---

## U2 NFR Design Complete — Cache Lifetime Recognised as a Measurement Decision
**Timestamp**: 2026-08-31
**User Input**: "alright lets continue" · Q1 = A (retry unknowns on a 30-day TTL) · Q5 = A (proceed
as designed); remaining five taken at the recommended defaults per the user's standing instruction
**AI Response**: "Generated the U2 NFR Design plan with seven questions across all five mandated
categories, then the two artifacts. NFR Requirements stayed SKIP per the execution plan.

FRAMED THE UNIT'S ONE NEW NFR PROBLEM PRECISELY: the app now depends on a third-party service it
does not own, cannot authenticate to, and can be banned from. U0 and U1 talked only to Spotify --
authenticated, quota'd per user, failing loudly with status codes. MusicBrainz is free,
unauthenticated and community-run, its rate limit is policy rather than enforcement, and it signals
rejection with 503 rather than 429. Every pattern follows from that plus two measured facts:
latency 0.1-6.7s, and 58% coverage whose misses are recency-biased.

Q1 WAS THE QUESTION WORTH ASKING, AND IT IS NOT A PERFORMANCE QUESTION. FR-14 says an ISRC is
resolved at most once, which read literally means a 404 today is a 404 forever. But MusicBrainz is
crowd-sourced and still growing, and the probe measured exactly where it is thin -- 2022-onward
releases resolved 43% against pre-2022's 100%. Caching negatives permanently would freeze the
measured coverage bias into the dataset permanently, turning a temporary property of an upstream
database into a fixed property of this project's data, in precisely the population R1 is about. The
user chose the asymmetric TTL: successes cached indefinitely because a resolved label is a stable
fact, unknowns retried after 30 days because a 404 is a statement about MusicBrainz's completeness
rather than about the release.

FOLLOWED THAT ANSWER THROUGH TO A CONSEQUENCE IT CREATES, RATHER THAN STOPPING AT THE DECISION.
Under Q1 = A, coverage becomes time-dependent: the same query run twice can legitimately differ, so
a coverage figure is only meaningful with an as-of date. More importantly, a play's stored verdict
can change months after the play when a previously-unknown ISRC resolves. That is desirable -- it is
the coverage bias correcting itself -- but it is currently invisible. label_classifier_version
records when the RULES changed; nothing records when the FACT arrived, so a verdict filled in later
is indistinguishable from one known at play time. Flagged label_resolved_at as a recommended
addition to migration 002 (14 to 15 columns, still additive) and marked it explicitly as flagged,
not decided. BR-12.5 guards classifier drift; this is the same gap in a different variable.

PUT THE POSTURE CHANGE TO THE USER RATHER THAN DECIDING IT, consistent with how the localGuard item
was handled. U2 is the first thing to send data anywhere other than Spotify: an ISRC per distinct
track plus a User-Agent that NFR-14 REQUIRES to carry a contact address, so anonymity is not
available without violating a policy the app is choosing to honour. Stated the real mitigation
honestly -- caching means each ISRC is sent once, so what leaves the machine resembles a library
rather than a listening timeline. User chose to proceed as designed. Recorded in P-6 that the
contact address is read from configuration and never committed to source, since NFR-14 requires a
real contact and the repository is on GitHub; a missing address is a startup error rather than a
silent fallback to anonymous traffic.

MADE THE 503 RESPONSE A SHARED QUEUE PAUSE RATHER THAN PER-REQUEST BACKOFF. Per-request retry gets
this backwards: it increases pressure exactly when the service is signalling overload. There is no
API key here and therefore no per-key throttle to absorb the mistake -- being blocked would take out
the whole unit rather than degrade it. Also required that a pause leaves items pending, never
unknown, because a pause is a delay and not an answer.

SEPARATED notFound FROM error THROUGHOUT. Both render as unknown to a reader, but notFound is a
finding about MusicBrainz's catalogue while error is a finding about the network on Tuesday. Folding
the second into the first would inflate the apparent coverage gap with noise, and that gap is the
measurement R2 depends on. BR-10.2 already had the field; the patterns now say when each is written
and which are retried. A 404 is never retried because it is an answer.

GAVE THE QUEUE TWO PRIORITY CLASSES BUT CONSTRAINED PRIORITY TO ORDERING ONLY, never rate. Backfill
has real volume, and under strict FIFO the track playing right now queues behind all of it, showing
the user a pending panel that never settles. A priority that bypassed the limiter would defeat
NFR-15 exactly when the app is busiest.

DECLINED QUEUE PERSISTENCE BECAUSE THE DATABASE ALREADY IMPLIES THE WORK SET. BR-8.3's backfill
scans for plays with an ISRC and no resolution, which is exactly what a dropped in-memory queue
leaves behind, so the system self-heals with no new machinery. Persisting a queue would add durable
state duplicating what the play table implies and introduce a way for the two to disagree. Same
shape as BR-8.7: a decision made for other reasons paying off again.

KEPT THE TRACE ON ITS OWN ROUTE WHILE KEEPING THE USER'S UI PLACEMENT. /api/diagnostics runs a fixed
system sweep hitting Spotify and MCP on every call; adding a playId mode would mean either a trace
re-runs the live health check, violating BR-12.7, or the endpoint grows a switch that changes
whether it touches the network -- the kind of switch that later gets set by accident. The split is
in the route, not the interface: the trace still renders inside the diagnostics dialog.

RECORDED WHAT WAS NOT ADOPTED as decisions rather than omissions -- no message broker, no
circuit-breaker library, no external cache, no parallelism, no latency target -- each with the
reason. Also recorded that scalability patterns are not applicable, with the arithmetic: the 1
req/sec ceiling is 86,400 requests/day against a working set of a few hundred distinct ISRCs.

Stated the design's load-bearing claim explicitly: with MusicBrainz entirely down, display,
recording and export are all unaffected and U2's total failure costs the label column and nothing
else."
**Context**: CONSTRUCTION — U2 NFR Design complete, awaiting approval. Next: Infrastructure Design
(narrow). One finding open for decision: `label_resolved_at` column

---

## BR-13 — Versioned Resolutions; Q1 Revised A → C After Testing the Proposal Against the Schema
**Timestamp**: 2026-08-31
**User Input**: "So the back-correcting of any of our data fields raises a bigger issue given the
fact that some of that data can change (an artist can sign with a a label for instance). I'm
thinking maybe we just stick to the data that is available at the time the track is played (or
within some small time window) and then ONLY edit that data if the track is played again at a later
date and the data has changed (update at that point). I'm not sure if there's enough value in that
chain of changes to make it worth the added complexity." Then, on the proposal: "Depending on the db
schema it may be straightforward to have a track details stored in a table that's a many
relationship with the track itself… The details record is timestamped so to see the details for the
last time a track was played we'd just query for the latest details record?" — with the explicit
instruction: "don't just assume this is the right path, test against the current architecture to
make sure it works". Answers: versioned + TTL on everything; release = latest, artist = as-of-play
**AI Response**: "The user identified a problem larger than the label_resolved_at column I had
flagged, and was right to.

SEPARATED TWO THINGS BOTH CALLED 'THE DATA CHANGED', which is what made the problem tractable. Our
knowledge changing (a volunteer catalogues a release we could not see) means the old verdict was
wrong and the new one is better. The world changing (the artist signs to a major) means the old
verdict was RIGHT FOR ITS TIME and must be kept. These need opposite handling, and MusicBrainz
cannot tell you which occurred -- a lookup that 404'd in August and returns Atlantic in January is
byte-identical in both cases. So the design stops trying to decide at write time and keeps both
readings.

THAT CHOICE IS ONLY EXPRESSIBLE BECAUSE Q12 KEPT THE TWO LEVELS SEPARATE. A release's label is a
fact about a past event -- this pressing, on this date, carried this label -- so a later change means
we learned something and the latest reading is strictly better measurement. An artist's label is a
fact about now, so a later change may be the world moving. Hence BR-11.1a: latest for release,
as-of-play for artist. Using the latest artist verdict would count an artist who signed AFTER the
play as signed at the time, which is the direction that fabricates support for R1 -- exactly what
the standing precision rule forbids. The temporal asymmetry was already latent in the two-level
split; it had simply never been named.

TESTED THE USER'S PROPOSAL AGAINST THE ACTUAL SCHEMA AS INSTRUCTED, rather than accepting it. Four
findings, two favourable and two corrective. Favourable: the pattern already exists in this codebase
-- the observation table is many timestamped rows keyed to a parent, so this is the shape already in
use, not a novelty. And migration cost is zero: schema_version is still 1, migration 002 was designed
but never written, so restructuring five tables is a design edit rather than a migration. Corrective:
there is no track table -- play denormalises track fields -- so 'pointing back to the same track
record' maps to a key (isrc, spotify_artist_id) rather than a row. And candidates and votes must key
to resolution_id rather than isrc, or BR-8.7's reclassification would fold 2026 and 2027 facts
together and vote on a union representing a state of the world that never existed at any moment.

CHECKED STORAGE RATHER THAN ASSERTING IT WAS FINE. The observation table already holds 1,296 rows
for 71 plays, about 3,600/day at this project's rate. A quarterly re-resolution of 1,000 ISRCs
appending roughly 4 candidates each is 4,000 rows per quarter -- two to three orders of magnitude
below what the database already absorbs daily.

FOUND THAT THE PROPOSAL WAS INERT UNDER THE ANSWER GIVEN EARLIER THE SAME DAY, which is the finding
that mattered. Q1 = A cached successes indefinitely, so the app would never look again after a first
success. A version chain under that policy could only ever record unknown-to-known -- our own
catalogue gaps filling in -- and could NEVER record independent-to-major, which is the precise case
that prompted the user's question. It would have appeared to work while being structurally incapable
of observing what it was built for. Q1 revised A to C, and priced the revision instead of hand-waving
it: at 1,000 distinct ISRCs a full sweep is about 2,000 requests, roughly 33 minutes of LOW-priority
queue, once per quarter. The current corpus is 19 distinct ISRCs.

PUSHED BACK ON ONE PART OF THE ORIGINAL PROPOSAL. Making REPLAY the update trigger would make
re-resolution conditional on the user playing a track again -- and replay is downstream of whether
they liked it. That would correlate missingness with the outcome variable, which is methodologically
worse than the recency bias it was trying to avoid, because recency bias is at least independent of
the thing being measured. A scheduled TTL sweep is blind to user behaviour, which is the property
that matters.

ANSWERED THE USER'S ACTUAL DOUBT -- whether the chain is worth the complexity -- with the observation
that the expensive version is not needed. A track's sequence of plays is ALREADY a sparse time
series, sampled at exactly the moments that mattered; versioning the resolutions is what makes that
series legible rather than collapsing it to whatever was true last. No revision log, no temporal-join
machinery, and deliberately no is_current flag, since a maintained flag can end up with two rows both
claiming to be current and that reads as valid data. ORDER BY resolved_at DESC LIMIT 1 cannot be
wrong.

MADE BR-13.5 A POINTER RATHER THAN A TIMESTAMP COMPARISON, which is not obvious. 'The resolution as
of the play's started_at' is not well defined: a track is pending at play start and its resolution
lands seconds to minutes later, so a timestamp query would return nothing for the common case and
silently pick a stale version for a re-resolved track. The play stores the version it actually used
-- a fact about what the app did, not an inference about what it might have seen.

CLOSED THE label_resolved_at FINDING by superseding it. A pointer to the exact version is strictly
more informative than a timestamp and cannot drift out of step with the row it describes. It also
makes BR-12's trace strictly better: the derivation is reconstructed from the candidates that
version actually held, so re-resolving a track can no longer silently change the explanation of an
older play.

SPLIT label_signal_vote INTO TWO TABLES as a consequence rather than a preference: once votes key to
a resolution_id, a single column would have to point into two different tables, which SQLite cannot
express and therefore cannot enforce. Six columns of duplication buys a real foreign key with
cascade on both.

RECORDED THE REQUIREMENT DRIFT rather than leaving it silent: FR-14's 'resolved at most once' now
means at most once per TTL window.

Migration 002 is now 6 tables and 16 play columns, still additive, still unimplemented."
**Context**: CONSTRUCTION — U2 FD + NFR Design complete with BR-13. Awaiting approval.
Next: Infrastructure Design (narrow)

---

## U2 Infrastructure Design Complete — Contact Address to `secrets/`, Container Guard Deferred Deliberately
**Timestamp**: 2026-08-31
**User Input**: "continue" · Q1 = B (`secrets/musicbrainz.json`) · Q2 = A (host deployment stays
real); Q3, Q4, Q5 at recommended defaults
**AI Response**: "Generated the U2 Infrastructure Design plan with five questions across all seven
mandated categories, then the two artifacts.

FRAMED THE DELTA HONESTLY AND NARROWLY: U1 needed somewhere durable for a database; U2 needs a way
out of the machine plus one secret that is not a credential. No new inbound port, no new listener,
no new process, no broker, no external cache. The entire infrastructure change is outbound egress to
one host and configuration.

Q1 -- CHOSE secrets/ OVER .env FOR A PROJECT-SHAPED REASON, NOT A TECHNICAL ONE. Verified that
`node --env-file-if-exists=.env` works on this machine's Node 22.17.0 and degrades gracefully with a
notice when the file is absent, so option A was technically sound rather than dismissed. Rejected it
because the project already has exactly one place where uncommittable things live, and a second
means two places to check before publishing. Recorded that extending spotify-config.json was the
option to avoid: the MCP server rewrites that file on every token refresh, so a hand-added field
would be clobbered by a process we do not control -- silently and intermittently, the worst
combination. Required the contact address to FAIL CLOSED at startup rather than falling back to an
anonymous User-Agent, on the grounds that traffic which is unidentified while believed compliant is
worse than a refusal to start.

Q2 -- RE-RAISED OPEN ITEM 1 AT THE POINT IT STARTED TO MATTER, AND THEN DELIBERATELY DID NOT FIX IT.
U2 is the first unit that wants a long-running unattended process (scheduled sweeps, TTL
re-resolution, the 30-second grace window), which makes `restart: unless-stopped` genuinely
attractive -- and that is precisely the argument for keeping the decision standalone. Relaxing the
single control NFR-07's no-authentication decision rests on, inside a unit about label enrichment,
is how a security posture gets changed as a side effect. User chose to keep the host deployment.
Accepted the consequence in writing: on the host, scheduled work runs only while the terminal is
open, which degrades TIMELINESS, NOT CORRECTNESS, because P-5 already makes the database the queue
of record and a startup sweep catches up.

Q4 -- DREW THE CONFIGURATION LINE AT MEASUREMENT VERSUS COMPLIANCE. Both TTLs, the backfill interval
and the batch size are tunable and belong beside COMPLETION_THRESHOLD, whose configurability is the
only reason U1's threshold finding is actionable rather than academic; R2 guarantees the TTLs will
need revisiting. The 1 req/sec spacing and the retry policy stay constants in code, because there is
no legitimate value other than 1 and a knob there would exist only to violate NFR-15 -- most likely
while debugging, and then forgotten. Added MUSICBRAINZ_BASE_URL as configurable for exactly one
reason: BR-1.2's regression test needs a fixture whose correct answer is KNOWN TO BE NON-EMPTY,
because a test asserting 'no releases' would pass against the inc-silently-ignored bug.

Q3 -- REFUSED TO ASSUME CONTAINER EGRESS WORKS even though compose.yaml declares no networks block
and the Docker default permits it. The project has drawn wrong conclusions from documentation four
times, and the container has already produced one silent networking failure in this exact area --
localGuard and the bridge gateway. Recorded it as a Build and Test step rather than a design
assertion.

Q5 -- KEPT COVERAGE OUT OF THE PASS/FAIL RENDERER. /api/diagnostics gains a `coverage` block
alongside `steps`, rendered as its own dialog section beside the trace. The existing renderer only
speaks ok/fail/skip, and presenting a 58% coverage rate as a green tick would render the instrument
R2 is measured with as a verdict about system health. Required an `asOf` timestamp as load-bearing
rather than decorative: under BR-13 the same coverage query run twice can legitimately differ, so a
figure without a timestamp is not interpretable.

NOTICED ONE SMALL THING WORTH GETTING RIGHT NOW: the new secrets mount is read-only while the
existing one is read-write. spotify-config.json is rw because the MCP server rewrites it;
musicbrainz.json has no writer. Copying the rw out of habit would grant a write capability with no
use -- free to get right at design time, awkward to notice later.

RECORDED STORAGE RETENTION AS A DECISION RATHER THAN AN OMISSION: the versioned tables are
append-only and never pruned, because BR-8.7 recomputes verdicts from them and BR-12 traces over
them, so eviction would break both capabilities the storage exists for. Measured growth is ~4,000
rows per quarter against the ~3,600 rows/day observation already absorbs.

Carried five verification items forward into Build and Test explicitly so they are not lost between
stages, including that BR-1.2's fixture must be a known-non-empty case."
**Context**: CONSTRUCTION — U2 Functional, NFR and Infrastructure Design all complete.
Awaiting approval. Next: Code Generation. Open item 1 deliberately still open

---

## U2 Build and Test Complete — Three Defects Found by Running, Not by Testing
**Timestamp**: 2026-09-01
**User Input**: "lets build and test" · authorised creating `secrets/musicbrainz.json` with
kuhndj67@gmail.com, and attempting the container egress check
**AI Response**: "Ran the stage against the real service rather than against fixtures, which is
where all of its value turned out to be.

FOUND THREE DEFECTS, EVERY ONE OF WHICH PASSED THE FULL TEST SUITE. None was reachable from a
fixture, and all three are the same underlying mistake: a transient failure becoming permanent.

FIRST, a transport error wrote an IMMUTABLE verdict. Running the server against an unreachable
endpoint recorded 21 plays as unknown/error in a single sweep. The play snapshot is immutable under
BR-8.4a and the backfill work set is 'plays with no verdict', so every one of those rows would have
stayed unresolvable forever -- from one network blip, in the dependent variable of the experiment.
Fixed by making toSnapshot return null for a transient failure, so it CANNOT be written; changing
the return type forced every caller to handle it rather than trusting anyone to remember the rule.

SECOND, and this one hid inside the fix for the first: LabelCache.isFresh still gave an errored
resolution the full 30-day unknown TTL. I had corrected the SQL sweep to treat error as
always-stale and stopped there -- but THE LIVE PATH NEVER CONSULTS THE SWEEP. It calls isFresh.
Surfaced by noticing 17 artist resolutions left over from the unreachable-endpoint run, each of
which would have suppressed retries for a month. Three statuses now genuinely have three lifetimes.

THIRD, the backfill work set keyed only on the release verdict. The two levels resolve
independently -- release through the ISRC chain, artist through the Spotify-URL join -- and can
fail independently, so a play whose artist lookup failed was permanently unfinished and invisible.
Observed live: 21 real plays sat with a release verdict, no artist verdict, and the work set
reported ZERO rows remaining. Fixed so either level missing puts the play back; the next run picked
all 21 up automatically.

The common thread is worth recording as a rule rather than three bug fixes. The design was careful
that `unknown` and `pending` stay distinct. It was not careful that `error` stays distinct from
both. A fixture failure is deterministic, so it can prove the failure is HANDLED but never that the
resulting row is never RETRIED -- you have to watch a real failure be recorded.

DISCOVERED THAT P-4's BOUNDED RETRY HAD NEVER BEEN IMPLEMENTED. Only the queue-wide pause was, and
I had not noticed the gap between the design and my own code. The live run made it obvious: at 1200
ms spacing -- WIDER than the 1 req/sec policy floor, and the same spacing an earlier research probe
used without rejection -- 6 of 19 tracks took a 503. Without a retry, a third of the corpus failed
on one pass for reasons that said nothing about MusicBrainz's catalogue, which would have swamped
the coverage signal R2 is measured with. With retry added: 0 errors, 0.46 req/sec. Each attempt
goes back through the queue, so retrying spends time and never rate.

VERIFIED THAT THE SHIPPED CODE REPRODUCES THE RESEARCH MEASUREMENT EXACTLY: 13/19, 68.4%,
identical to the 2026-08-26 ad-hoc probe. That is the strongest available evidence that the
implementation matches what the design was reasoning about. BR-1.2 passed with Slipknot returning
50 releases and Audioslave 44 -- a single-call form would have returned zero with a 200, and a test
asserting 'no releases' would have passed against the bug.

EVERY MEASURED CLASSIFIER CASE REPRODUCED ON REAL DATA: Audioslave contested across Epic and
Interscope with confidence capped to low, Faouzia unknown because the Publisher entry was refused,
Imminence unknown because [no label] was refused, NF major-high and correctly NOT contested because
Capitol and Caroline are both Universal, Spinefarm caught as Universal despite its distribution
pointing at an independent, broke voting independent at reduced confidence as a Distributor.

THE TWO-LEVEL SPLIT EARNED ITS KEEP: 8 plays have release and artist verdicts that disagree. That
is the Token case at scale -- an artist signed to a major releasing a particular track
independently -- and merging the levels would have silently picked one. Artist confidence never
exceeded medium across all 19, so that cap holds in production.

DEMONSTRATED BR-12.3 ON REAL DATA rather than asserting it. The trace for Imminence reads 'refused
1: [no label] (BR-3.2) - unknown by BR-4.6'. Without it that unknown is indistinguishable from
'MusicBrainz knew nothing', and this is the very artist whose [no label] handling was wrong in the
first round of design.

VERIFIED CONTAINER EGRESS rather than assuming it: HTTP 200 in 0.373s from inside a container on
the default bridge, no networks configuration needed. Deferring this to Build and Test was the
right call precisely because the container has produced one silent networking failure already.

PROTECTED THE DATA THROUGHOUT. Migration 002 was rehearsed against a copy before touching the real
database. Every destructive cleanup was preceded by a backup and followed by a row-count check --
120 plays and 1,296 observations verified intact each time. A bare delete of artist resolutions was
refused by a foreign key because plays pointed at them, which is the constraint doing exactly what
the test I wrote for it says it should.

REPORTED WHAT IS STILL OWED rather than declaring completion: liked-status capture has never fired
against real listening, the search fallback path never triggered live, 2 plays remain in the
bounded work set, and localGuard still blocks the container UI even though egress now works."
**Context**: CONSTRUCTION — U2 complete: built, tested, live-verified. 399 tests, 98.97% line
coverage, 120 plays. Next: the Phase 2 hypothesis gate (BR-11), then U3

---

## Genres from MusicBrainz; Crossfade Identified as a Possible Confound
**Timestamp**: 2026-09-02
**User Input**: reported the Artist label field always showing "—" and the Spotify-genres notice
appearing under Label detail; asked for genres "if available from any source"; then noted *"I'm
using the Spotify AI DJ feature and that does a crossfade between old/new tracks"* and asked
whether it affects completion detection. Declined context capture; chose to keep the 0.90 ratio.
**AI Response**: "Three pieces of work, and the last one is the one that matters.

FIXED A REAL DEFECT BEHIND THE 'ARTIST LABEL ALWAYS DASH' REPORT. The code was running; it was
resolving from the WRONG SAMPLE. `snapshot.enrichment` is null on the first tick of a new track --
U1's own PlayObserver says so in as many words -- so resolving from the play-start hook meant
resolving with no ISRC and no artist id, caching a permanent noIsrc answer, and never looking
again. Moved the trigger to the tick, gated on enrichment having landed, with an in-flight guard
and no caching of failures. Same family as the three Build-and-Test defects: a premature answer
becoming sticky.

ADDED GENRES FROM MUSICBRAINZ. Probed before building, per the standing rule, and the probe earned
its keep: `inc=genres` and `inc=tags` look interchangeable and are not. Tags is the raw folksonomy
and returned `supergroup` for Audioslave and `2008 universal fire victim` for Dolly Parton; genres
is the curated subset. Kept MusicBrainz's vote count rather than discarding it -- it is the only
quality signal the source gives, and U3's rules will want to threshold on it. Migration 003,
rehearsed on a copy first. Existing artist resolutions predated genre collection and were cached
fresh for 90 days, so added a one-off sweep; 26 artists and 101 plays now carry genres. Recorded
explicitly that filling `artist_genres` on old plays is NOT a BR-8.4a violation: that rule protects
the VERDICT, a judgement that must reflect what was believed at the time, whereas genres are
descriptive metadata and the column is only written when NULL.

ANSWERED THE CROSSFADE QUESTION WITH MEASUREMENT RATHER THAN REASSURANCE, and the answer was not
the expected one. The DJ does NOT truncate observation -- eight plays ended within two seconds of
the track end, so there is no systematic early switch. But the interaction it exposes is worse than
truncation would have been.

A crossfade removes roughly CONSTANT SECONDS. The completion ratio DIVIDES BY TRACK DURATION. So a
fixed-time effect becomes a penalty that scales inversely with track length. Measured: 13 of 27
track-change plays sit within +/-0.05 of the 0.90 threshold, and major-label tracks are longer
(median 248s) than independent ones (191s), so an identical crossfade costs independents about 1.3
times more ratio than majors.

That is the shape that matters: the OUTCOME variable is biased by track length, and track length
correlates with the INDEPENDENT variable U2 exists to measure. It would make independents look more
skipped than they were, which could mask a real effect or manufacture the appearance of none.
Stated the caveat plainly rather than burying it -- n=10 and n=11, so the duration gap itself could
be chance. The mechanism is deterministic regardless of whether this sample demonstrates it.

DID NOT CHANGE THE THRESHOLD. The user chose to keep 0.90, and deferring costs nothing here because
trails are retained (FR-20) and all 120 plays can be reclassified retroactively. That is the second
time the store-observations-derive-judgements decision has paid for itself. Logged the confound as
open item 4 with the measurement, and generalised the lesson into CLAUDE.md's non-obvious section:
a proportional threshold over a constant-time effect is a confound generator wherever the divisor
correlates with what is being measured.

ALSO FOUND, WHILE INVESTIGATING: context_type is NULL on all 35 live plays because the MCP
getNowPlaying returns no context field at all. Spotify's /me/player/currently-playing does -- probed
live, returning spotify:playlist:37i9dQZF1EYkqdzj48dyYq, the AI DJ. So a DJ play is currently
indistinguishable from a playlist play, and the DJ is algorithmic selection into the feed, which is
arguably the closest available proxy for what R1 calls promoted. Surfaced it rather than building
it; user declined for now. Recorded as open item 7 so the gap is not silently inherited."
**Context**: CONSTRUCTION — U2 complete and live-verified. Genres added (migration 003). Two
findings logged for later: the crossfade/ratio confound (item 4) and unrecorded playback context
(item 7)

---

## U2 Approved; the Phase 2 Hypothesis Gate Pre-Registered and Run — INSUFFICIENT DATA
**Timestamp**: 2026-09-05
**User Input**: asked to pick up where we left off; chose to review U2 before approving, then
approved it; chose to pre-register the BR-11 gate and run it now rather than defer or peek first.
**AI Response**: "Two gates closed, and the second one produced a result worth having even though
it is not a verdict.

APPROVED U2 AFTER VERIFYING RATHER THAN RELAYING. Ran the suite (404 passing, not the 399 the docs
claimed -- the genres commit added 5) and the typecheck, then read the three defect fixes in the
shipped code rather than trusting the summary that described them.

The verification found something better than agreement with the documents. A REAL TRANSIENT
FAILURE HAD OCCURRED IN PRODUCTION since sign-off: artist_label_resolution id 40 errored at
20:54:23 on 2026-09-02. Zero plays point at it, and id 41 for the same artist resolved 38 seconds
later. That is all three Build-and-Test fixes firing at once against a live failure -- the error
was never written to a play, was never treated as a fresh cache entry, and the work set now reports
zero remaining across both levels. The U2 summary said these fixes were only provable by watching a
real failure be recorded. One has now occurred and was correctly UN-recorded. A lone `error` row
that had not existed on 2026-09-01 turned out to be evidence FOR the fixes rather than against
them.

Two owed items had also closed on their own since sign-off: liked capture has now fired live (9
kept-liked, 8 kept-unliked, 1 liked-during, 2 unknown) and the work set is empty. The claims
re-checked on the grown corpus all held or strengthened -- artist confidence still never exceeds
medium, and release-vs-artist disagreement has gone from 8 plays to 20.

PRE-REGISTERED THE GATE BEFORE COMPUTING ANYTHING, AND COMMITTED IT SEPARATELY SO THE ORDERING IS A
FACT ON THE RECORD RATHER THAN A CLAIM IN PROSE (fd09ad7). Only marginals had been queried at that
point -- group sizes, verdict counts, coverage by year, the corpus-wide skip count. The skip rate
BY VERDICT GROUP, which is the quantity the gate turns on, was not known.

BR-11.6 had always required a minimum sample stated in advance and one had never been stated. Fixed
it at n >= 50 per group AND >= 10 skips (BR-11.6a), from a power calculation run on no project
data: at n=50 and a ~15% baseline, the smallest detectable difference is about 15% vs 40%. Recorded
plainly what that admits -- this instrument can find a strong effect or nothing. Detecting 15% vs
25% would need 250 per group. If R1's effect is subtle, this instrument will never resolve it.
Better stated now than discovered afterwards. Added a stopping rule (BR-11.7) so the gate is
evaluated once rather than repeatedly as data accrues, and fixed the robustness checks in advance
(BR-11.8) so a disagreeing primary result cannot be re-cut until it agrees.

R-B is the robustness check that matters, and pre-registering it was only possible because the
crossfade confound was identified on 2026-09-02, BEFORE any result was seen, and only actionable
because FR-20 retains the trails. Third time store-observations-derive-judgements has paid for
itself. Stated in advance that if R-B materially changes the answer, the primary result does not
stand.

THE RESULT IS INSUFFICIENT DATA, and that was foreseeable from the marginals alone: 4 skips in the
entire eligible corpus, major n=8, independent n=13 against a required 50 each. Recorded the three
skip rates anyway, because BR-11.2 and BR-11.3 make them unconditional and concealing them would be
worse than reporting them with the caveat attached -- major 25.0%, independent 15.4%, unknown 7.1%.
The ordering is nominally the direction R1 predicts and it is worth nothing; two skips against two
skips is indistinguishable from a coin. Quoted no test statistic, because at these counts a p-value
would lend arithmetic authority to noise. Writing the numbers down now is what stops a later run
claiming the criterion was met all along.

ONE OBSERVATION DID NOT GO AS THE PRE-REGISTRATION ANTICIPATED. BR-11.2 reasoned that if the
unknown group's skip rate RESEMBLED the independent group's, that would be evidence the unknowns
are predominantly uncatalogued independent releases. It sits below BOTH named groups. At n=14 with
a single skip that is evidence of nothing, but it is the first observation pointing away from the
assumed composition of the unknowns, and it is the check the pre-registration named as the most
informative available on R2.

CAUGHT A DENOMINATOR TRAP IN MY OWN FIRST COVERAGE TABLE. It folded two different causes of a
missing verdict into one number: no ISRC (a Spotify artefact -- recently-played returns no
external_ids, so all 104 backfilled plays lack one) and ISRC present but MusicBrainz has no label
(the actual R2 measure). Because the backfill is weighted to recent releases, the conflated version
reported coverage as 28% pre-2022 falling to 12% for 2022+. The corrected measure, taken only over
ISRC-bearing plays, is 86% and 44%.

That is the inc=releases shape again -- the one CLAUDE.md warns is the dangerous one. It would have
been recorded as 'MusicBrainz coverage has collapsed to 12% on recent music' and believed, because
it reads as a coverage finding rather than a bug. A wrong DENOMINATOR is as indistinguishable from
absent data as a wrong request shape.

Corrected, it independently confirms open item 3b: the shipped code on a larger, differently
composed corpus reproduces the 2026-08-26 ad-hoc probe almost exactly for 2022+ (43% then, 44%
now). The recency-biased coverage gap is real and stable, not an artefact of the original probe's
sample, and it remains concentrated on exactly the recent independent releases R1 is about.

QUANTIFIED WHAT REACHING THE THRESHOLD WOULD TAKE rather than leaving 'more data' as a gesture:
about 215 more live plays, with the major group binding, which is on the order of 11 more listening
sessions. The real bottleneck is session count, not listening -- live capture has run on exactly
two days because the app only records while running. Also established that spending the 47
GET /tracks/{id} calls from open item 3 would improve label coverage statistics and add ZERO
eligible plays to this gate, because what the backfill lacks for the gate is the observation trail,
not the ISRC. Worth knowing before spending the calls.

Recorded explicitly that this does not gate U3. The rules engine evaluates user-authored rules and
its value does not depend on R1 being true. The execution plan asks that Phase 3 be designed AFTER
the gate, which it now has been -- with the honest input that the hypothesis is untested and the
instrument is months of listening from testing it. That is itself a design constraint for U3: rules
must be authorable and valuable without R1 being settled."
**Context**: CONSTRUCTION — U2 **approved**. Phase 2 hypothesis gate pre-registered (`fd09ad7`)
and run: **INSUFFICIENT DATA**, still open under BR-11.7. Next: **U3 — Rule Model & Evaluation**

---

## U3 Paused to Collect Data; Container Deployment Live; Open Item 1 Closed
**Timestamp**: 2026-09-05
**User Input**: *"We are not in any sort of time constraint so maybe it makes sense to pause and
run the app for some time in order to collect the needed test data? To do this can we configure
Rancher Desktop to run on startup and also make sure the app starts automatically when rancher
desktop starts?"* Then chose `localGuard` **option B** and host port **3010**.
**AI Response**: "The right call, and the investigation changed what the request even required.

FOUND THAT RECORDING DOES NOT DEPEND ON THE UI, which reframed the whole task. The poll loop is a
server-side setInterval started at boot; the PlayObserver is fed from `tick`; the WebSocket only
pushes to whoever happens to be connected. So localGuard -- open item 1, blocking every container
request for weeks -- blocks VIEWING, not COLLECTING. The container would have collected data
perfectly while returning 403 to every browser. That made option B a convenience decision rather
than a prerequisite, which is a much easier decision to take honestly.

PROBED THE RISK THAT COULD HAVE COST THE IRREPLACEABLE ARTEFACT INSTEAD OF REASONING ABOUT IT.
SQLite in WAL mode needs shared-memory mapping, and the standard advice is that this is unsafe on
network or virtualised filesystems -- which is exactly what a Windows bind mount through WSL2 is.
Believing the documentation would have blocked container deployment of `data/`. Probed on both C:
and D: in a real container: journal_mode -> wal, 200 rows, wal_checkpoint(TRUNCATE) clean, reopened
and read back. Documentation said no; the probe said yes. Fifth time the standing rule has paid,
and the first time it went in the permissive direction.

FOUND AN IMMEDIATE BLOCKER BY LOOKING RATHER THAN ASSUMING: host port 3000 was already held by the
user's own opencodetest-frontend container, published on 0.0.0.0. Neither the container NOR
`npm start` could have bound it. Moved the Spotify publish to 127.0.0.1:3010; container-internal
port unchanged.

MEASUREMENT MADE THE SECURITY DECISION EASIER THAN THE DOCUMENT HAD IT. The written
counter-argument to option B was that any container on the same bridge network could reach the
app. Checked: the default bridge is EMPTY, the machine's other compose projects are on their own
networks, and the app came up on its own network spotify_default (gateway 172.20.0.1). With the
127.0.0.1 publish, no container can reach it -- container-to-container would have to route through
host loopback, which containers cannot reach. Residual exposure is host-local processes, which is
precisely what the host `npm start` deployment already exposed and which was accepted there.

IMPLEMENTED OPTION B AS OPT-IN RATHER THAN INFERRED. TRUST_PUBLISHED_PORT defaults false and is set
only in compose.yaml. It was tempting to key it off the existing `inContainer` detection, and that
would have been wrong: a security relaxation that switches on silently depending on where the
process happens to run is one nobody reviews. Set explicitly in the deployment file, it is visible
where it can be argued with, and the host deployment keeps the strict check it can genuinely
satisfy.

PINNED BOTH HALVES OF THE DECISION, not just the half that was asked for. Seven new tests, and the
one that matters is a property replacing PBT-03 for this deployment: under trustPublishedPort ANY
peer is admitted, but ONLY with a loopback Host. Host/Origin is now the entire remaining defence,
so if that property ever fails, option B has silently become 'no guard at all'. Also pinned that
the same request is still REJECTED under the host policy, because a relaxation that leaks across
deployments is not scoped.

VERIFIED LIVE RATHER THAN TRUSTING THE TESTS: GET / returned 200 where every request used to
return 403, and GET / with Origin: http://evil.com still returned 403. Both halves, against the
running container.

BACKED UP THE DATABASE BEFORE LETTING A NEW WRITER TOUCH IT. First time a container has written
data/. Afterwards: 145 -> 155 plays, integrity_check ok, and the startup logs show the system
working end to end from inside the container -- 10 plays backfilled, 10 label resolutions with ZERO
errors against real MusicBrainz, 603 liked tracks cached, and the OAuth access token refreshed
headlessly, which is what unattended running depends on.

ADDED A .dockerignore, which did not exist. The build context was shipping node_modules, .git and
data/ to the daemon on every build.

DID NOT RE-RUN THE HYPOTHESIS GATE after the corpus grew to 155. Under BR-11.7 a run at or above
the minimum is the single confirmatory evaluation, and casually re-running it to see the new
numbers is exactly the repeated peeking the stopping rule exists to prevent. Counted rows directly
instead.

DID NOT RESTART RANCHER DESKTOP to prove the login-boot chain end to end, because that would have
taken down the user's unrelated immich and opencodetest containers. Settings are verified read-back
true and the restart policy is verified unless-stopped; the boot test happens at the next login.
Said so rather than implying it was proven.

RECORDED THE HAZARD THE NEW DEPLOYMENT CREATES: the container now runs unattended, so `npm start`
is no longer a free action. Two pollers, two SQLite writers, every play recorded twice. Warned in
CLAUDE.md, README and the state file, because the failure mode is silent duplication in the
dependent variable of the experiment."
**Context**: CONSTRUCTION — **U3 paused by user decision** to accumulate the ~215 live plays the
hypothesis gate needs. Container deployment **live and unattended**; **open item 1 CLOSED**.
411 tests. 155 plays and growing

---

## Reboot Test Run — Autostart Chain CONFIRMED End to End
**Timestamp**: 2026-09-05
**User Input**: *"Ok I restarted the computer... now you should be able to check to determine if
rancher desktop started and if the app started. (it appears one or both did not)"*
**AI Response**: "Ran `scripts/post-boot-check.ps1`. **Every check passed; exit code 0.** The
user's impression that something had not started was wrong, and the check is the reason we can say
that rather than guess.

THE OPEN QUESTION FROM THE PREVIOUS SESSION IS NOW CLOSED. That session verified the *settings*
were written and the restart policy was `unless-stopped`, and said explicitly that the chain itself
was unproven because proving it would have taken down the user's unrelated containers. This is the
missing half. Measured, not inferred:

- Host booted 2026-09-05 20:52:52, 2.9 min before the check.
- Rancher Desktop running, started automatically.
- dockerd up and responding.
- Container **started 82s after boot, by itself** — after the boot clock, so it was the autostart
  chain and not a hand start. This is the check that actually distinguishes a working chain from a
  coincidence, and it is why the baseline file was needed.
- Healthcheck healthy; no errors in the startup logs.
- UI `200` on `http://localhost:3010`; cross-site `Origin` still `403`. **The option-B relaxation
  survived a cold start** — it is set in `compose.yaml`, so it had to.
- Database opened through the bind mount, schema v3, `integrity_check: ok`. WAL over the bind mount
  survived a real power cycle, which the earlier probe could not show.

WHY THE USER THOUGHT IT HAD FAILED — the likely cause is the port. `opencodetest-frontend` holds
host **3000**, and this app is on **3010**. Opening `localhost:3000` after a reboot shows a
different app that is *also* up, which reads as 'the wrong thing started'. Recorded because it will
recur: the port move was forced by a collision, so the intuitive URL now belongs to something else.

`+0 PLAYS SINCE THE BASELINE, AND THAT IS NOT A FAILURE.` Most recent play start is
2026-09-03T12:34:55Z; nothing has been played since. The poll loop is running (backfill ran,
603 liked tracks cached). An empty result from a working instrument looks identical to a broken
instrument if you only look at the count — the startup log is what separates them.

DELETED `.boot-check-baseline.json` and removed the 'FIRST THING IN A NEW SESSION' block from
CLAUDE.md. A standing instruction to run a check whose question has been answered trains the next
session to ignore standing instructions.

THEN THE USER OPENED THE PAGE AND FOUND A REAL DEFECT THE CHECK HAD MISSED. The UI showed
'Disconnected - reconnecting...'. The user read that as 'it cannot connect to Spotify'. It was not
Spotify: `/api/health` did a real MCP round-trip and returned `mcp: connected, toolCount: 30`. It
was the browser's own WebSocket to the app, and the handshake was being refused with 403.

CAUSE: THE ADMISSION RULE EXISTED TWICE AND THE COPIES DIVERGED. `ws` does not run Express
middleware, so `server.ts`'s `upgrade` handler invoked the local-access policy explicitly -- by
re-implementing it inline. Option B (`trustPublishedPort`) was added to `applyAccessPolicy` only.
In the container the peer is always the Docker bridge gateway, so the HTTP path admitted
everything and the WebSocket path refused everything. The comment above the handler asserted 'the
same local-only rules apply to the WebSocket handshake as to HTTP' -- true when written, silently
false the moment option B landed.

THE PREVIOUS SESSION'S OWN VERIFICATION IS WHAT MISSED IT, AND THE REASON IS INSTRUCTIVE. It
verified option B live, against the running container, in both directions -- `GET /` returned 200,
and `GET /` with a cross-site Origin returned 403. Both correct. Both HTTP. The relaxation was
verified on the surface it was written on, not on every surface it governed. 'Verified live'
constrains only the paths actually exercised.

ALL 411 TESTS PASSED THROUGHOUT, including the seven written specifically for option B. They
exercised the policy function; the upgrade handler was covered by nothing, and no test asserted
the two agreed. Same shape as the three U2 defects: green for the wrong reason.

FIXED BY MAKING DIVERGENCE IMPOSSIBLE RATHER THAN BY MAKING THE COPIES MATCH. Extracted
`decideAccess(AccessRequest, AccessPolicy)` as the single source of truth; `applyAccessPolicy` now
delegates to it and maps the refusal reason back to its distinct 403 body, and the upgrade handler
calls the same function. Patching the second copy would have fixed today's bug and left the
mechanism that produced it in place.

WROTE THE TEST AND THEN CHECKED THAT IT ACTUALLY CATCHES THE BUG. Four structural tests, in the
idiom of `purity.test.ts`: the handler must call `decideAccess`, must pass BOTH policy flags, must
not name `isLoopbackAddress`/`isLoopbackHostHeader`/`isAllowedOrigin` at all, and must still refuse
any URL but `/ws`. A behavioural test would have to boot MCP, SQLite and the poll loop. Then
stashed the fix and re-ran them against the original `server.ts`: 3 of 4 failed. A regression test
never run against the regression is an assumption.

VERIFIED LIVE, ON EVERY SURFACE THIS TIME. Rebuilt (checking `PIPESTATUS[0]`, not the pipe's exit
code) and restarted. WebSocket same-origin -> **101 Switching Protocols**, and the socket
immediately streamed real now-playing frames. Cross-site Origin on the WebSocket -> 403. Cross-site
Origin on HTTP -> 403. Upgrade to a URL other than `/ws` -> 403. Normal HTTP -> 200. The
relaxation is still scoped to exactly the peer check.

WHY THE POST-BOOT CHECK PASSED ANYWAY, WHICH IS WORTH KEEPING: it asserts the UI returns 200 and
that cross-site Origin is refused. Both were true. **Recording never depended on the WebSocket** --
the poll loop is server-side, and the socket only pushes to a connected browser. So the instrument
was collecting correctly the whole time and only the display was broken. That is the deployment
working as designed, and it is also why nothing flagged it."
**Context**: CONSTRUCTION — U3 still paused to collect data. Autostart chain **proven**. WebSocket
admission defect found by opening the page and fixed. **415 tests** (411 + 4), typecheck clean

---

## Listening Statistics Panel — Play Count and a Weekly Artist Trend
**Timestamp**: 2026-09-06
**User Input**: *"Ok restart looks good. As I use the app one thing I think would be interesting
would be to display some statistics. One would be the play count from the database for the track
being played and maybe a small chart showing the weekly play count for the artist over the last 6
months. (showing a view of my interest trend)"*
**AI Response**: "Built it, read-only over `history.db`. Three design questions were put to the
user first, because the live data contradicted parts of the request in ways that changed the work.

PROBED THE DATABASE BEFORE DESIGNING, AND IT CHANGED ALL THREE ANSWERS. The request assumed six
months of history; the corpus is **17 days** (2026-08-20 → 2026-09-06, 163 plays, 98 tracks, 53
artists). A fixed 26-week axis would have been 23 empty bars.

THE FINDING THAT MATTERED: `artist_id` IS THE PRIMARY ARTIST, AND THAT IS A KNOWN UNDERCOUNT.
The schema stores one id per play — `track.artists[0]` — while `artist_name` is the joined display
string. Measured on the corpus:

```
Ren                            23   artist_id 0Repe2Ei…
Ren, Eden Nash                  2   same id
Ren, The Skinner Brothers       1   same id
Inpatient, Ren, Chris Webby     7   filed under INPATIENT
Prof, Ren                       1   filed under PROF
```

Ren is on **34** plays; a chart keyed on `artist_id` shows **26**. The 8 feature credits appear on
someone else's trend line. Across the corpus only 14 of 163 plays are multi-artist, but it
concentrates precisely on the artist a user would look up. **This is the denominator family
again** — a plausible number that reads as a listening pattern rather than as a limitation of the
schema.

USER CHOSE PRIMARY-ARTIST ONLY (option A of three), over recording every artist id (schema change,
not retroactive) or that plus a 98-call backfill. **So the panel says `(as primary artist)` on
every render**, not in a footnote. A repository test pins the limitation rather than the fix: if a
later unit records every artist, that test is what should fail.

WINDOW: ADAPTIVE, CAPPED AT 26 WEEKS. Anchored on the **corpus** first play, not the artist's, so
every artist's chart shares one x-axis and two can be compared; anchoring per artist would rescale
the axis silently between track changes. `capped` is returned as a distinct flag because 'the axis
stopped at the limit' and 'the axis stopped because there is no more history' are different facts
— the caption reads *all history, from 17 Aug* or *last 26 weeks* accordingly.

BARS STACKED BY OUTCOME, WITH `unknown` KEPT SEPARATE. 116 of the 163 plays are backfilled and
therefore `unknown` — not skipped, not completed, never observed. Filtering to `completed` would
have erased 71% of the history and drawn listening as beginning the day live recording started;
summing them would assert a judgement the data does not contain. `unknown` is drawn as a
low-chroma **neutral with a 45° hatch**, not a third hue: it is the absence of an observation
trail, and must not compete with the two real verdicts.

WEEK BUCKETING IS PURE AND IN JAVASCRIPT, NOT SQL, ON PURPOSE. SQLite's `%W` counts from the
first Sunday and `%U` from the first Monday, and neither is the ISO week; at a year boundary they
produce a week `00` that is sometimes partial and sometimes fused with December. That is one wrong
week in fifty-two, rendered as a listening pattern rather than as an error — the `inc=releases`
shape. `history/playStats.ts` is registered in `purity.test.ts`; `now` is a parameter, so the week
seam is testable, and the tests cover Sunday-at-23:59, the Monday boundary, and 2026-12-28 →
2027-01-04.

NO MIGRATION WAS NEEDED. Both queries are already covered: `idx_play_track` from v1 and
`idx_play_artist_id` from v2. Schema stays at **v3**.

THE PANEL COSTS NOTHING UPSTREAM. `/api/history/stats` makes zero external requests, like
`/api/explain` and for the same reason: the display calls it on every track change, and a route
that could reach Spotify or MusicBrainz would put a third-party outage in the path of a local
count.

THE SETTLE PASS IS NOT BELT-AND-BRACES. `PlayObserver` writes the previous play on the same track
change that triggers the fetch, so an immediate read can beat the write and report a count one too
low — most visibly on a repeat, where the panel would then sit on the stale number for the whole
track. The client re-reads once at +6s.

COLOURS WERE COMPUTED, NOT CHOSEN. `#1baf7a` / `#eb6834` (light) and `#199e70` / `#d95926` (dark)
pass the lightness band, chroma floor, CVD separation (ΔE 9.2 light, 9.4 dark) and normal-vision
floor in both modes. Light-mode contrast for the green is 2.82:1, below 3:1, which obliges relief:
the legend prints every count and there is a table view. Both shipped.

VERIFIED BY RUNNING IT, NOT ONLY BY TESTING IT. Rebuilt the container (checking the build's own
exit code, not a pipe's) and probed live: `Madhouse` → 6 plays, 2 completed / 4 unknown, matching
a direct SQL count; Inpatient → 23 plays across three weeks summing to the reported total; no
params → 400; an unplayed track → zeros rather than null. Then opened the page in both colour
schemes: panel renders, no console errors, table view correct. The first render exposed a real
defect no test would have — every axis tick read `Aug`, because a 17-day window is entirely within
one month. Fixed: the ends are always labelled with week dates, month ticks appear only once the
window spans months.

**438 tests** (415 + 23), typecheck clean, schema unchanged at v3."

**Decision**: Statistics panel delivered — per-track play count split by outcome, and a weekly
stacked trend for the primary artist, adaptive up to 26 weeks. Read-only, no migration, no
upstream calls. Primary-artist attribution accepted as a **documented undercount** rather than
fixed, per user choice; the alternative (recording every artist id) remains available and is not
retroactive.
**Context**: CONSTRUCTION — U3 still paused to collect data; this is a display addition outside
the unit plan and does not touch the recording path or the hypothesis gate. **438 tests**,
typecheck clean, schema v3, container rebuilt and live on `http://localhost:3010`

---

## Liked Indicator Added; "Label Detail" Kept — It Was Never Blank, Only Unexplained
**Timestamp**: 2026-09-06
**User Input**: *"Couple other style items... not sure what the 'Label Details ---' item is supposed
to show but it's always blank so perhaps it can be removed. Also I don't see any indicator that
the track has been favorited?"*
**AI Response**: "Both premises turned out to be wrong in useful ways, and checking before acting
is what kept a working field from being deleted.

**'LABEL DETAIL' IS NOT ALWAYS BLANK — IT IS BLANK 80% OF THE TIME, WHICH IS A MEASUREMENT.** It
renders the label *names* behind the verdict, and **36 of 177 plays have them** (Inpatient →
`EightyHD`, `Sick Boi`). It is empty whenever the verdict is `unknown` or `pending`, and that is
the common case precisely because **MusicBrainz label coverage on recent releases is ~44%** — open
item 3b, the recency bias R2 measures. Deleting the field would have deleted the only place the
user can see *which* labels produced a verdict, and `major` is worth very little without being
able to see that it was Spinefarm resolving to Universal.

WHY IT READ AS BROKEN: it rendered a bare `—`. A dash asserts nothing, so an empty field is
indistinguishable from a dead one. Now it explains itself the way the genres row already did:
`not yet resolved` for pending, `MusicBrainz lists no label` for unknown. Same distinction the
verdict row has always made — **`pending` is not `unknown`** — applied to the place the user
actually looks.

**FOUND A REAL GAP WHILE LOOKING: `artistNames` WAS IN THE PAYLOAD AND SILENTLY DROPPED.** The
server has computed and broadcast artist-level label names all along; the client rendered only the
release level. So the panel showed two verdicts and one set of names. Both levels now appear,
separately labelled and **never merged** (Q12) — Token's *Full Bag* is `Never Too Different` at
release level and `Atlantic` at artist level, and both are true.

**THE LIKED INDICATOR WAS GENUINELY MISSING FROM THE DISPLAY, THOUGH NOT FROM THE DATA.**
`LikedSetCache` has been live since U2 and every play records `likedAtStart` / `likedAtEnd` /
`likedTransition`. Nothing ever put it on screen. Added: a ♥/♡/? badge beside the track title, and
a `Liked` row showing `Yes · 6 Sep 2026` from `added_at`.

**`null` RENDERS AS THE WORD `unknown`, NEVER AS `No`.** If the saved-track set is unavailable the
answer is unknown, and a `No` in its place would be an observed choice that was never observed —
the same rule the recorded column follows, applied to the display.

⚠️ **THE STALENESS IS THE INTERESTING PART, AND IT IS WHY THE BADGE IS A BUTTON.** The set is
refreshed at startup and then on the **6-hourly** label-backfill tick (`ensureFresh` is called
from that timer, not on the 15-minute TTL). So a `No` can be hours old — and the moment that
matters is right after someone has liked the track and wants to see it register. There is no
cheap fix available: **`GET /me/tracks/contains` is 403** in Development Mode, which is why this
is a cached set and not a membership check. So: the badge carries the age of its answer in its
tooltip, and clicking it re-reads the list. Nothing polls it — ~12 requests on a timer to keep a
badge warm would spend the rate limit label resolution needs.

**A RACE WAS FOUND BY CLICKING THE BUTTON, NOT BY TESTING IT.** A full re-read takes seconds, long
enough for the track to change underneath it. The first version applied whatever came back, which
would have shown one track's liked status under another track's name — the failure this project
keeps meeting in other forms. The request now pins the track id at click time and discards the
answer if the track has moved on.

VERIFIED LIVE, ALL THREE STATES. `♥ Yes · 6 Sep 2026` on a liked track; clicking mid-session
picked up **two likes made during the session** (607 → 609 cached) and the badge flipped to `♡ Not
liked` when the track changed; `POST /api/liked/refresh` returns correct payloads with a trackId,
without one, and for an unliked id. Label detail verified showing the explained-empty state live
and the two-level tag layout by injection. No console errors.

**438 tests**, typecheck clean, schema unchanged."

**Decision**: `Label detail` **kept** — the premise that it is always blank was wrong; it is empty
80% of the time because MusicBrainz coverage is, and it now says so instead of showing a dash.
Artist-level label names surfaced (already in the payload, never rendered). Liked indicator added
as a badge plus a Track detail row, with the age of the answer exposed and an on-demand re-read,
because the cached set can be six hours stale and `/me/tracks/contains` is 403.
**Context**: CONSTRUCTION — U3 still paused to collect data. Display-only changes; the recording
path, the classifier and the hypothesis gate are untouched. **438 tests**, typecheck clean,
schema v3, container rebuilt and live on `http://localhost:3010`

---

## `played_at` Is the END of a Play — the Backfill Duplicated Every Restart
**Timestamp**: 2026-09-06
**User Input**: *"There's something odd going on with the 'Unknown' number on Weekly plays... it
seems to be increasing when it really shouldn't be. The 'completed' number seems accurate
though."*
**AI Response**: "The user was right, and the asymmetry they noticed — unknown climbing, completed
accurate — was the diagnosis. `completed` can only come from a live observation trail. `unknown`
is what the backfill writes. So a number that inflates *only* in the unknown column points at the
backfill, not at the classifier.

**`GET /me/player/recently-played` RETURNS `played_at`, AND IT IS WHEN THE TRACK FINISHED.** The
documentation does not say so. `RecentlyPlayedBackfill` stored it as **both** `startedAt` and
`endedAt` since U1.

**MEASURED, NOT INFERRED — AND THE APP HAD THE EVIDENCE ALL ALONG.** For 41 plays this app had
itself observed start *and* end, `played_at` was compared against both:

```
closer to a live play START:  n=1   median 176.9s
closer to a live play END  :  n=41  median 3.0s   max 8.8s
```

One match to a start, off by 177 s — itself about a track length, so almost certainly an
end-match assigned to the wrong instance. **The project's own recorded data was the probe.**

**TWO CONSEQUENCES, AND THE SECOND IS THE ONE THAT COMPOUNDED.**

1. Every backfilled row started about one track duration late, with `started_at == ended_at` —
   a zero-span play.
2. Dedup (`hasPlayNear`) compared that end-timestamp against stored **starts**, putting a whole
   track between the two instants being compared, with a 60 s tolerance. A play already recorded
   live therefore never matched, and **every restart re-inserted it as a fresh `unknown` row**.

⚠️ **THE DUPLICATES GO BACK TO 26 AUGUST, NOT TO THIS SESSION.** 41 of 125 backfilled rows —
**33%** — duplicate a play already recorded live. Four container rebuilds during this session
added 11 of them, which is what made the number move fast enough for the user to notice, but the
mechanism has run on every restart since the beginning.

**WHY IT SURVIVED: `RecentlyPlayedBackfill` HAD NO TESTS. NONE.** 438 tests were green. The
integration test exercises the observer, not this. The class that writes a third of the corpus was
covered by nothing, and the defect it contained was invisible in every way except as a number on a
chart that a human recognised as wrong. Same family as the three U2 defects and the WebSocket 403:
**green for the wrong reason.**

**FIXED IN TWO PLACES, BECAUSE ONE WOULD HAVE LEFT THE TRAP.** `startedAt` is now derived as
`played_at - duration_ms` (validated against the same 41 plays: median error 5.7 s, 38 of 41
inside the dedup window), and `endedAt` is `played_at`, the value Spotify actually reports.
Dedup was rekeyed onto the **end** — `hasPlayNear` became `hasPlayNearEnd`, replaced rather than
supplemented, so the start-based version cannot be reached for this purpose again. Deduping on a
derived value when an exact one is available would have been the same mistake one layer down.

**WROTE THE TESTS, THEN RE-INTRODUCED THE DEFECT TO CHECK THEY CATCH IT.** 9 new tests in
`recentlyPlayedBackfill.test.ts`. With the original code restored, 3 fail — including the one that
matters, *does NOT re-insert a play the observer already recorded live*, and *is idempotent across
repeated runs, which is what a restart is*. A regression test never run against the regression is
an assumption.

**VERIFIED LIVE, WHICH IS THE ONLY PROOF THAT COUNTS HERE.** Rebuilt and restarted the container:
`[backfill] 0 inserted, 33 already known`, and the backfilled row count stayed at 125. The same
restart before the fix added rows every time.

**THE HYPOTHESIS GATE IS UNAFFECTED, AND THIS WAS CHECKED RATHER THAN ASSUMED.** All 125
backfilled rows have `observation_count = 0`; the gate requires a trail. `SELECT ... GROUP BY
provenance, outcome` confirms no backfilled row has ever carried one. The gate's INSUFFICIENT DATA
result stands.

**WHAT IS INFLATED**: play counts (including the new statistics panel), `coverage()`, and exports
— by 41 rows, 22% of the corpus. **What is not**: anything derived from observation trails.

**THE DATA REPAIR IS NOT MINE TO RUN.** `scripts/repair-backfill-timestamps.mjs` is written,
dry-run by default, refuses to run without taking its own backup, and refuses outright if any row
marked for deletion turns out to carry a trail. It reports 84 rows to re-time and 41 to delete.
**Deleting rows from the one artefact in this project that cannot be regenerated is a user
decision**, so it is presented, not executed.

**447 tests** (438 + 9), typecheck clean, schema unchanged."

**Decision**: `played_at` semantics corrected — start derived, end measured; deduplication rekeyed
onto the end timestamp and the start-based method removed. `RecentlyPlayedBackfill` has tests for
the first time, verified against the reintroduced defect. Data repair **written but not run**,
awaiting the user: 84 rows to re-time, 41 duplicates to delete.
**Context**: CONSTRUCTION — U3 still paused. Hypothesis gate verified unaffected (no backfilled
row has ever had a trail). **447 tests**, typecheck clean, schema v3, container rebuilt and live

**Addendum — repair APPLIED 2026-09-06.** User chose the full repair. `docker compose down` first,
because two writers on one SQLite file is the failure this project warns about. Backup taken
automatically (`data/history.db.backup-2026-09-06T02-07-53-966Z`). **84 re-timed, 41 deleted;
187 -> 149 plays.** Verified after: `integrity_check: ok`, no foreign-key violations, **no orphan
observations**, all **65 live rows still carrying their trails**, zero backfilled rows with
`started_at >= ended_at`, and **zero remaining duplicates** by the same criterion. Container
restarted: `[backfill] 0 inserted, 35 already known`. The symptom the user reported is gone —
Inpatient's current week went from `completed 7 / unknown 8` to `completed 7 / unknown 1`.

---

## Coverage Evaluation — 98.96% Was Computed Over a Denominator That Excluded the Untested Code
**Timestamp**: 2026-09-06
**User Input**: *"Do we need to do a full test coverage evaluation and update our tests? (I know
we've made a number of changes so testing being out of date is to be expected)."*
**AI Response**: "Ran it rather than guessed, and the report contained the answer — as a trap
this project has already met twice.

**THE HEADLINE FIGURE COULD NOT SEE THE UNTESTED CODE.** 447 tests, **98.96% line / 92.17%
branch**. But `src/server.ts` — **952 lines, nine HTTP routes** — was **absent from the report
entirely**, not reported as 0%. V8 coverage only reports modules that were actually *loaded*, so a
file no test imports is missing from the **denominator** rather than dragging the average down.
Confirmed: no test imports `server.ts`, and the string appears nowhere in the report (the single
grep hit was `PlayObserver.ts`).

**IT IS NOT FIXABLE WITH A FLAG, AND THAT WAS PROBED RATHER THAN ASSUMED.** Both
`--test-coverage-include` with a directory glob and with a `.ts` file glob **narrowed** the report
instead of widening it. Coverage cannot be conjured for a module that never executed.

> This is the same shape as the `inc=releases` 200 and the 28%→12% label-coverage figure, and it
> is the most dangerous of the three, because the other two looked like findings and this one
> looks like good news.

**THE USER'S ACTUAL QUESTION HAD A NARROWER ANSWER: NO, THE TESTED CODE IS NOT OUT OF DATE.**
Everything changed in this session that a test could reach was already covered — `playStats.ts`
100%, the repository statistics methods, the dedup rekey verified against the reintroduced defect.
The gap was never staleness. It was four files that had never had tests at all, dominated by the
one with the worst defect history here: the WebSocket `403` lived in `server.ts` and passed all
411 tests.

**USER CHOSE THE FULL EXTRACTION** over testing only the logic, structural tests, or deferring.
That was the right call for a specific reason: the WebSocket `403` was a **wiring** bug, and the
two cheaper options would not have caught it either.

**`createApi(deps)` — 302 LINES OF ROUTES MOVED OUT OF `server.ts` INTO `api.ts`.** Everything the
routes need arrives through `ApiDeps`; nothing in the module reaches for module state, a clock or
the network. `server.ts` keeps the wiring, the startup sequence and the `upgrade` handler — the
last deliberately, because `localGuard.test.ts` structurally pins that handler to `server.ts` and
moving it would have silently voided the test that exists *because* of the `403`.

**`now` IS INJECTED, AND THAT IS THE POINT, NOT TIDINESS.** `/api/history/stats` anchors its
26-week window on the current week. With an ambient clock the one assertion worth making — that
the window ends on the week containing now, and reports whether it was clipped by the cap or by
the start of the corpus — cannot be written at all.

**30 ROUTE TESTS, OVER REAL HTTP ON AN EPHEMERAL PORT.** Not handler calls: the defect this is
answering was wiring, and a handler-level test would have missed it again. They cover the 503
degradation path on every history route (NFR-13), `502` for an unreachable MCP on `/api/now-playing`
versus `503` on `/api/health`, `400` before the first byte on export, `404`/`400` on `/api/explain`,
the window-end and capped/uncapped distinction, `asOf` being stamped, and — the rule that matters
most — **`/api/liked/refresh` returning `null` rather than `false` when no track is named**, and
still answering with the set it holds when the refresh itself throws.

**THE BLIND SPOT ITSELF IS NOW A TEST.** `noOrphanModules.test.ts` walks `src/`, builds the
runtime import graph from the tests and closes over it, and fails on any module nothing executes
unless it is in `ALLOWED_ORPHANS` **with a written reason**. Type-only imports are excluded
deliberately — `import type` is erased at compile time, and counting it would have made
`diagnostics.ts` look reached while running zero lines. Verified load-bearing: deleting one
allowlist entry fails the test and names the file.

Four entries remain, each now explicit rather than invisible: `server.ts` (cannot be imported
without starting the process), `diagnostics.ts`, `export/SnapshotScheduler.ts` and
`mcp/spotifyMcpClient.ts` (constructed only by `server.ts`). Four more are interface/type-only,
where absence is correct.

**`RecentlyPlayedBackfill` BRANCH COVERAGE 69.70% → 92.11%**, by testing what Spotify actually
omits: an item with no `artists`, `album`, `external_ids` or `context`. Not hypothetical — the
missing `external_ids` is why backfilled plays carry no ISRC (open item 3).

**483 tests · 99.12% line · 92.70% branch.** `api.ts` went from *invisible* to 98.90%.

**VERIFIED LIVE, BECAUSE THIS REFACTORED THE DEPLOYMENT-CRITICAL FILE.** Rebuilt and restarted;
all nine routes probed against the running container — `200/400/404/503` each where expected — and
the admission guard still enforced on **both** surfaces (cross-site HTTP `403`, cross-site WS
`403`). Browser: WebSocket connected and streaming (`Playing`, not `Disconnected —
reconnecting…`), no console errors. The page also showed real artist-level label names for the
first time — *The Bearded Man*, *Ineffable* — the `artistNames` that had been broadcast and
dropped since U2."

**Decision**: Routes extracted to `src/api.ts` behind `createApi(ApiDeps)` and tested over real
HTTP; coverage's structural blind spot closed by `noOrphanModules.test.ts` with a reasoned
allowlist. Three files remain knowingly untested (`diagnostics.ts`, `SnapshotScheduler.ts`,
`spotifyMcpClient.ts`) — now recorded rather than invisible.
**Context**: CONSTRUCTION — U3 still paused. **483 tests**, 99.12% line, 92.70% branch, typecheck
clean, schema v3, container rebuilt and live on `http://localhost:3010`

---

## The Chart Was Reporting the App's UPTIME as Though It Were Listening
**Timestamp**: 2026-09-06
**User Input**: *"So I've seen a number of different artists play and it looks like the Weekly
plays data is still off. I see a LOT of 'unknown' entries and I've been pretty careful to not quit
in the middle of tracks so there should be few or no unknowns. (and only a few skips... most plays
in the database should resolve to completed but most are resolving to Unknown)"*
**AI Response**: "The user was right that the display was wrong, and wrong about the cause — which
is the useful kind of report, because it pointed at a defect neither of us had named.

**THE DATA IS CORRECT. THE CLASSIFIER IS CORRECT. THE CHART WAS LYING.**

Live plays, the ones the app actually watched:

```
completed  track-change       50   ratio 0.90-1.00
skipped    track-change        5
completed  playback-stopped    5
unknown    app-shutdown        8   <- MY container rebuilds today
unknown    playback-stopped    5
unknown    pause-idle          2
```

**56 of 76 live plays complete — 74%, exactly what the user expected.** The classifier never had
a problem.

**THE 84 'UNKNOWN' ROWS ARE DAYS THE APP WAS NOT RUNNING.**

```
app ran on 3 days   ->  76 live  + 14 backfilled
app off on 7 days   ->  70 backfilled  (all necessarily unknown)
```

The corpus spans 17 days; the app has only ever *run* on three of them, because the container
autostart deployment is one day old. Everything else came from `recently-played`, which reports
**no progress data at all**, so `unknown` is the only honest verdict those rows can carry — and
they can never become anything else.

⚠️ **THE DEFECT: `unknown` MERGED TWO COMPLETELY DIFFERENT FACTS, AND I BUILT IT THAT WAY.**

- **not observed** — the app was off. No trail, none possible. 84 rows.
- **observed, inconclusive** — the app *was* watching and could not classify: a pause, a stop, a
  shutdown mid-track. A real measurement that happens to be indeterminate. 15 rows, 8 of them
  caused by my own rebuilds today.

Stacked into one bar, **a chart of listening was silently reporting the instrument's uptime**.
Completion read as 38% of the corpus where it is 74% of what was actually measured. This is the
project's own `null` ≠ `0` rule, which I quoted while designing this panel and then broke in the
same commit: **the absence of a measurement is not a measurement with an absent value.**

It is also the third member of the family already on the record — the `inc=releases` 200, the
28%→12% denominator, and now this. All three produce a plausible number that reads as a finding.

**FIXED BY SPLITTING THE SERIES, NOT BY FILTERING.** Four buckets — `completed`, `skipped`,
`inconclusive`, `not-observed` — decided in the pure module by `bucketOf`, where **provenance
decides first** because it is the stronger fact: a backfilled row has no trail, so no outcome it
carries could have been measured. Hiding the backfilled rows instead would have been the other
error, since "the app was not running" is real information about the corpus and matters directly
to R2.

`not-observed` keeps the low-chroma hatched neutral: it is an absence, not an outcome.
`inconclusive` gets a real hue — validated, not eyeballed: the three-hue set passes the lightness
band, chroma floor, CVD separation (worst adjacent ΔE 9.2 light / 9.4 dark) and the normal-vision
floor in both modes. The track panel got the same treatment — `Times played 6 · 5 not recorded,
1 completed` rather than a bare 6.

**486 tests.** The regression is pinned by name: *NEVER merges "the app was off" with "the app
could not tell"*, and *files a backfilled play as not-observed even if its outcome were somehow
set*.

**VERIFIED LIVE.** Rebuilt; Inpatient's trend now reads `2026-08-31: 8 completed, 1 not-recorded`
against older weeks that are almost entirely `not-recorded` — which is the true story of when the
instrument was running. Browser confirms four series, four legend counts, four table columns, no
console errors."

**Decision**: `unknown` split into `inconclusive` (observed, indeterminate) and `not-observed`
(the app was not running) across the pure bucketing module, the repository, the API and both the
chart and the track panel. Backfilled plays are shown, never filtered — their volume is real
information about the corpus.
**Context**: CONSTRUCTION — U3 still paused. Display-only; no schema change, no data change.
**486 tests**, typecheck clean, schema v3, container rebuilt and live


---

## The Artist-Level Label Verdict Was Reporting Who the Artist's GUESTS Are Signed To
**Timestamp**: 2026-09-06
**User Input**: *"As I collect data for test/debug... I see potential issues with the data for
this track: The current playing track is from 'Bad Bunny' but the 'Artist' field has a TON of
media companies (I'm guessing incorrectly). Interestingly... the Label listed is 'Independant'
which I believe is true (so not sure why all the music companies in the artist field."*
Then, on scope: *"I don't care about artist-credits... the ONLY details at that level that are of
interest are the artist name and the label that the track was released under... we don't need any
additional complexity there. I think we'd also not want to perform unnecessary queries (increasing
the overhead of running the app) so I'd expect the app to do the minimum work required to pin down
those two values then stop digging."*
**AI Response**: "The user read the panel correctly and diagnosed it correctly: the release-level
verdict was right and the artist level was junk. The cause was worse than cosmetic.

**`browse /release?artist=<mbid>` RETURNS RELEASES THE ARTIST ONLY FEATURES ON.**

Probed live, Bad Bunny, all three pages (205 releases, 201 official):

```
official releases where he is the FIRST artist credit (lead)    92
official releases where he is a JOINT / FEATURE credit         109

Cardi B, Bad Bunny & J Balvin           - I Like It          -> Atlantic
Daddy Yankee feat. Becky G, Bad Bunny   - Dura (remix)       -> El Cartel
Maluma feat. Bad Bunny, Nengo Flow      - 1 polvo            -> Sony Music | Latin
Nicky Jam feat. Ozuna & Bad Bunny       - El amante (remix)  -> Sony Music

distinct labels overall                                         64
labels reachable ONLY through a guest credit                    49
```

His own lead catalogue is 15 labels: `Rimas` 46, `NFL` 17, `Hear This Music` 8, `Rimas
Entertainment LLC` 7. That is the same independent story the release level already told through
the ISRC. The 42 names on the panel were **other artists' record deals.**

WARNING: **THIS IS BIAS IN THE INDEPENDENT VARIABLE, NOT NOISE IN THE OUTCOME.** BR-4.3's fold
makes ONE strong `major` vote decisive, so any artist who had ever featured on a major-label
single read `major`. Feature-heavy catalogues are exactly where the independents are, so the error
pushes independents into the `major` group — the direction that would **mask R1**. Ran the shipped
`classify` over four candidate sets to measure it rather than assert it:

```
candidate set                              verdict      conf    contested  names  major votes
first 100, lead + guest  <- what shipped    major        low     yes          42       29
all 205, lead + guest                       major        low     yes          61       52
all 205, LEAD credits only                  major        medium  no           13        2
first 100, LEAD credits only                independent  medium  no            5        0
```

**A SECOND DEFECT RODE ALONG: `limit=100` WITH NO PAGING, RECORDED AS A TOTAL.** Bad Bunny has
205 releases; the app fetched 100 and stored `release_count: 100` as though that were his
catalogue. Page 2 alone held 20 labels page 1 never saw (Universal Music Group, Epic, Warner
Records). **18 of 56 stored artist resolutions sat exactly at 100** — Slipknot, Radiohead, Tame
Impala, Goo Goo Dolls, Ren, Dolly Parton, bbno$, Audioslave. The bottom two rows of that table
disagree for this reason: the verdict depended on which arbitrary half of a catalogue came back.
Same family as the 28% -> 12% denominator and the `inc=releases` 200 — an arbitrary sample written
down as a complete count, with nothing marking it truncated.

**REMOVED RATHER THAN FIXED, ON THE USER'S SCOPE CALL.** Filtering to lead credits and paging
would have cost a request per prolific artist and still answered a question the release level
already answers better. The user asked for the minimum work to pin down the artist name and the
label the track was released under, so the browse is **deleted, not filtered** — and deleted
rather than fetched-and-discarded, because the cheapest request is the one not made.

**GENRES WERE ENTANGLED AND WERE NOT DROPPED SILENTLY.** The artist level cost three requests: the
Spotify-URL join for the MBID, the release browse, and the genre lookup. Only the browse is the
defect, but the URL join exists solely to feed genres — so the choice was surfaced rather than
decided. User: *"I also would like Genre so maybe we need to keep the queries."* Kept. **Five
requests per new artist drop to four**, and the artist level is now genres and a pointer.

**Q12 IS WITHDRAWN, NOT AMENDED.** "Two levels, side by side, never merged" was a sound rule about
a level that should not have existed. Gone from the panel, the export (`artist_label_verdict`,
`artist_label_confidence`, `artist_label_names`), the JSON `artist_label` block, and
`/api/explain`, whose artist trace made the wrong question look like a careful answer.

WARNING: **THE WORK-SET TERMINATOR MOVED, AND THE OBVIOUS REPLACEMENT WAS A TRAP.**
`listPlaysNeedingLabels` keyed on `artist_label_verdict IS NULL`, which only terminated because a
not-found artist was written down as verdict `unknown`. `artist_genres IS NULL` looks equivalent
and is not: an artist MusicBrainz has never catalogued has no genres and never will, so every
sweep would re-look-up the same nothing for ever. The guard is `artist_resolution_id IS NULL` —
the pointer is written even when there are no genres.

**MIGRATION 004, APPLIED TO THE LIVE DATABASE.** Dropped `artist_label` and
`artist_label_signal_vote`; dropped the three verdict columns; renamed `artist_label_resolution`
-> `artist_resolution` and `artist_label_resolution_id` -> `artist_resolution_id`. Renamed rather
than left in place: a table called `artist_label_resolution` holding only genres is a name someone
later reads as evidence that a verdict exists somewhere. The rows went rather than being kept —
they are derived, not observed, and a wrong verdict left in a research database is a liability,
because it reads as a finding.

Every DDL step probed on a copy first (SQLite 3.50 drops a column carrying a CHECK constraint;
`RENAME TO` rewrites `play`'s foreign key), then the real migration code was dry-run against a
copy of the live file, then applied. **181 plays, 5,359 observations, 140 plays with genres and 34
resolutions with genres all preserved; `integrity_check: ok`, `foreign_key_check` zero
violations.** Backup at `data/backup-before-migration-004-20260906T231755Z/`.

**VERIFIED LIVE.** Rebuilt and running on schema v4: UI `200`, WebSocket handshake `101`,
cross-site Origin `403`, startup sweep `1 resolved, 0 refreshed, 5 genres, 0 errors`. Bad Bunny's
`EoO` now reads `independent` / `Rimas` with genres `reggaeton, trap latino, latin, hip hop` — and
no media companies. `/api/explain/224` returns `play` and `release` only."

**Decision**: The artist-level label verdict is **removed**, not repaired — its evidence came from
`browse /release?artist=`, which counts features as the artist's own and biased the independent
variable toward `major`. The artist level is genres and a resolution pointer; the label question
is answered once, at release level, through the ISRC. Genres kept at the user's request. Migration
004 drops the tables, columns and export fields.
**Context**: CONSTRUCTION — U3 still paused. Schema v3 -> v4 with data removal (derived rows
only); play and observation records untouched.
**486 tests**, 99.19% line / 92.86% branch, typecheck clean, schema v4, container rebuilt and live


---

## `Not recorded` Stops Being a Bar and Becomes a Number — the Rows Stay
**Timestamp**: 2026-09-06
**User Input**: *"every artist 'Weekly plays' has a number of 'not recorded' plays, all older than
our set up updates yesterday. Is it possible to update those 'not recorded' records to
'Completed'? For artists like Prof I know I've not skipped any plays so all those old plays are
definitely completed but likely an issue in the app caused them to not cleanly get recorded as
completed."* Then, after the analysis: *"maybe it would be cleaner to remove those 'Not Recorded'
entries... If those 'Not Recorded' entries are truly incomplete and can't be repaired then they
should be removed perhaps?"*
**AI Response**: "The complaint was real and the diagnosis was wrong, twice over — and the second
proposal would have been worse than the first.

**THERE IS NO DEFECT. ALL 84 ARE `backfilled` WITH ZERO OBSERVATIONS.** The app was not running;
`recently-played` reports no progress at all. There is no trail that failed to be written.

**THE REQUESTED WRITE WOULD HAVE CHANGED NOTHING ON SCREEN.** `bucketOf` tests provenance FIRST:

```ts
if (play.provenance === 'backfilled') return 'not-observed';
```

Setting `outcome='completed'` on those rows leaves the chart byte-identical. The visible problem
was never in the `outcome` column.

⚠️ **AND IT WOULD HAVE PLANTED A DELAYED TRAP IN THE HYPOTHESIS GATE.** `ELIGIBLE` is
`outcome IN ('completed','skipped')` with **no provenance guard**. Only 1 backfilled row carries a
verdict today, so the damage would have looked like nothing — but open item 3 is *recover ISRCs for
backfilled plays at 47 calls*. The moment anyone spends them, 84 rows that are completions **by
construction** enter the gate with zero skips, against a live-measured skip rate of 12%. Both group
rates collapse toward zero and it reads as a finding. The project's recurring shape, on a fuse.

**A REAL DERIVATION WAS AVAILABLE AND WAS STILL NOT GOOD ENOUGH.** `played_at` is the END of a
play, so for consecutive plays the listened time of B is `end_B - end_A`. Validated against the 83
live plays where the trail is ground truth: in the 0.90-1.05 band, **53 completed against 1
skipped**, 98% precision, resolving 56 of 83 backfilled rows. Offered and declined — correctly, on
the grounds that it adds a concept to the app for a benefit the user did not want.

**THEN DELETION WAS PROPOSED, AND THE DAY BREAKDOWN KILLED IT:**

```
2026-08-20  live  0   backfilled 10      2026-08-27  live  0   backfilled 19
2026-08-21  live  0   backfilled  1      2026-08-31  live  0   backfilled  1
2026-08-24  live  0   backfilled 25      2026-09-02  live 20   backfilled  0
2026-08-25  live  0   backfilled 14      2026-09-03  live  0   backfilled  1
2026-08-26  live 21   backfilled 12      2026-09-06  live 62   backfilled  1
```

**Seven of the ten days in the corpus have zero live plays.** Deleting the backfilled rows does not
thin those days, it erases them — 73 distinct tracks, 42 artists, 55 rows carrying genres. And
they are the one thing in this project that does not come back: `recently-played` is a 50-play
window and these reach back 17 days. Code returns from git, labels from MusicBrainz, genres on
re-resolve. These return from nowhere.

**THE COMPLAINT WAS A DISPLAY COMPLAINT AND GOT A DISPLAY FIX THAT REMOVES CODE.** `not-observed`
is no longer a drawn series — three bars, not four — and is reported as a line under the legend:
*7 plays not observed — the app was not running.* The SVG hatch pattern and both
`--series-unknown*` tokens are deleted with it.

⚠️ **IT IS REMOVED FROM THE PLOT ONLY, AND THAT DISTINCTION IS THE WHOLE POINT.** The count stays
in the note, the hover tooltip, the table column and the track panel's breakdown. Dropping it from
those would be the 2026-09-06 merge defect again in a quieter form — a reader would take
`Times played 6 · 1 completed` for six observed listens. The chart answers *what did the app
measure*; the numbers beside it still answer *and how much did it miss*, which is what R2 needs.

⚠️ **TWO MAXIMA, AND THE WRONG ONE WAS THE EASY MISTAKE.** The y-axis scaled to `week.total`, which
still counts plays the chart no longer draws. Left alone, a week of 8 observed plays would render
at a third the height of a week that was 24 unobserved — the bars would shrink for a reason
invisible on the page. The axis now scales to the drawn total.

⚠️ **AND THE EMPTY STATE HAD TO BE SPLIT.** An artist whose every play is backfilled now has a
drawn max of zero, which would have fallen into `First time hearing this artist.` — false, and
exactly the `Label detail` failure where an unexplained empty state gets read as a broken one. It
says `2 plays, none observed — the app was not running.` instead. Verified by driving the panel at
an all-backfilled artist.

**VERIFIED IN THE BROWSER, NOT ONLY IN TESTS** — `public/app.js` still has no test harness (open
thread 2), so this was checked by looking. Prof, live: three series reading Completed 5, Skipped 0,
Inconclusive 3, the note `7 plays not observed`, axis maximum 6 (the drawn max, not 13), no console
errors. The all-backfilled path checked separately."

**Decision**: `not-observed` is **not drawn** on the weekly trend and is reported as a count
beneath it. No play rows were altered or deleted; `outcome`, `bucketOf`, the API and the hypothesis
gate are untouched. The proposal to write `completed` onto backfilled rows was declined as
fabrication that would reach R1; the proposal to delete them was declined because seven of the
corpus's ten days exist only in those rows and `recently-played` cannot return them.
**Context**: CONSTRUCTION — U3 still paused. View-only change; no schema change, no data change.
**486 tests**, typecheck clean, schema v4, container rebuilt and live

---

## 2026-09-10 — 🔒 THE PHASE 2 HYPOTHESIS GATE, RUN CONFIRMATORY: **R1 IS NOT SUPPORTED**

**Trigger**: user asked for a status check on data collection. The corpus had reached **427 plays**
(from 187 on 2026-09-06, +240 in four days), and the BR-11.6a minimum was met for the first time:
`major` **76**, `independent` **116**, eligible skips **17**. Under BR-11.7 the next run was
therefore the single confirmatory evaluation, so it was **not run on discovery** — the readiness
check deliberately computed group sizes and the *combined* skip count only, never the per-group
rates, and the decision to spend the one run was put to the user. The user chose to run it.

**Result** — full document at `construction/u2-label-enrichment/hypothesis-gate/gate-result-2026-09-10.md`:

| Group | n | skipped | skip rate |
|---|---|---|---|
| `major` | 76 | 7 | **9.2%** |
| `independent` | 116 | 10 | **8.6%** |
| `unknown` (BR-11.2) | 125 | 13 | 10.4% |

**Difference +0.6pp · 95% CI [−7.7%, +8.9%] · z = 0.141 · p = 0.888 · NOT SIGNIFICANT.**

**R1 is recorded as NOT SUPPORTED at the resolvable effect size.** Not disproven — the CI rules out
roughly ±8pp, about 2× against a ~9% baseline, and nothing smaller. The pre-registration said in
advance that this gate could find a strong effect or nothing; it found nothing. ⚠️ The observed
baseline (8.9% pooled) came in at the **bottom** of the 10–20% the power table assumed, so n = 50
per group bought less resolution than designed.

⚠️ **BR-11.2's most informative check also returned nothing.** The `unknown` group was expected to
resemble `independent` if unknowns are uncatalogued independents. All three groups sit within 1.8
points of each other.

⚠️ **Open item 3b is UNSETTLED AGAIN, not confirmed.** Label coverage among ISRC-bearing plays came
in at pre-2022 **56%** / 2022+ **60%** — the recency bias measured twice before (86%→44%, 100%→43%)
has closed and mildly inverted on the larger corpus. The earlier numbers were small-sample.

⚠️ **Open item 4 rides along with this result and is not resolved.** 12 of 30 skips sit at ratio
0.80–0.90. The confound's direction **inflates the independent skip rate**, i.e. works *against*
R1 — correcting it could only move the result toward R1, never further from it. Retroactively
correctable; trails are retained.

**PROVENANCE, RECORDED RATHER THAN HIDDEN**: the runner never implemented the two-proportion test
and CI that pre-registration §2 requires — earlier revisions stopped at the sufficiency check
because the outcome was fixed at "insufficient data". It was added **after** the group rates were
visible, in this session. `MIN_PER_GROUP`, `MIN_SKIPS`, the eligibility predicate and the grouping
were **not touched**; the added formula is the one named in §2 and has no free parameters, so no
degree of freedom existed to tune post hoc. Stated in the result document too.

**Decision**: the Phase 2 gate is **discharged**. R1 must not be re-tested hoping for a different
answer — BR-11.7 forbids exactly that. **U3 is unaffected**: the pre-existing instruction that
rules must be valuable without R1 being settled was written before the result and stands. U2's
label enrichment remains a legitimate rule *input*, simply not one backed by evidence that it
predicts this listener's skips. **R1 was built to be disconfirmable. It was disconfirmed, and the
design held.**

**Context**: CONSTRUCTION — U3 still paused. No schema change, no data change; the gate is
read-only. Corpus 427 plays, schema v4.

---

## 2026-09-10 — W-3 added to the backlog: rejection-skip vs session end

**Trigger**: user, from lived experience while collecting data — *"when I want to stop listening to
music whatever song is playing is getting marked as a skip"* — asking to distinguish "I don't want
to hear this track" from "I need to do something else". Requested before the gate run.

**Recorded at `requirements.md` §5.1 as W-3**, cross-referenced from risk **R4** (skip inference is
heuristic) and as open item 8 in `CLAUDE.md`.

⚠️ **PROBED BEFORE WRITING IT UP, AND THE CORPUS SHOWS ZERO INSTANCES.** Two candidate mechanisms
were formed and **both were disconfirmed**:

1. *A paused track keeps returning a payload, so the play stays open and is later closed by
   `track-change`.* Structurally real — `PlayObserver.observe` closes only on a `null` sample or a
   changed `trackId`, and a paused track is neither — but it has **never fired**: no skip outlasts
   its own track in wall-clock, and the largest observation gap inside any skip is **6 seconds**.
2. *Session ends are being closed as track changes.* Disconfirmed: **all 30 skips have a successor
   within 30 s**, and every session end (≥30 min gap) landed on `completed` (5) or `unknown` (4),
   **never on `skipped`**.

`classify` is correct here **by construction**: stopping yields `playback-stopped` or `pause-idle`,
both routed to `unknown`. So the item is a **design guard, not a repair**, and the write-up says so
— had it been recorded as a bug, someone would later have "fixed" a classifier that was right.

**The user's perception and the recorded data disagree, and reconciling that is task #1** of W-3.
The likeliest explanation is that the eight low-ratio skips (0.09–0.27) are *remembered* as "I
stopped listening"; that is unverified and W-3 must not be built on it.

**The discriminator, for when it is taken up**: the gap from play *N*'s `ended_at` to play *N+1*'s
`started_at`. In the corpus 276 of 286 continuations fall under 30 s while every session end
exceeds 30 min — almost no mass in between. It needs **no new field, no new collection and no
upstream request**, and applies **retroactively** to every live play, so deferring it costs
nothing. Design notes recorded: it must not put a clock or a repository lookup inside
`outcomeClassifier` (breaks FR-20/FR-42 while every test passes); the last play of a session has no
successor and must stay `unknown`; a fourth outcome value is probably the wrong shape.

**Decision**: deferred to the wishlist, sequenced **after** the Phase 2 gate — so the outcome
variable could not be changed while a result depending on it was being decided. No code changed.

---

## 2026-09-10 — U3 Functional Design APPROVED

**Stage**: CONSTRUCTION — Functional Design, Unit U3 (Rule Model & Evaluation).
**User response**: *"approved, continue"* (2026-09-10).

**Plan**: `construction/plans/u3-functional-design-plan.md` — 11 questions, then 3 follow-ups
raised because three answers had consequences their questions had not spelled out.

**Answers**: Q1 **A** Kleene strong · Q2 **B** `is-unknown` operator · Q3 **A** `note` on
`FieldDefinition` · Q4 **D** case-insensitive + punctuation-folded · Q5 **A** exclude
`context.type` · Q6 **A** partial dates `unknown` for ordering · Q7 **A** unevaluable rule disabled
with a reason · Q8 **B** genres as a string field · Q9 **B** `hold` deferred to U5 · Q10 **B**
last-known-good on reload · Q11 **A** order is presentational.
**Follow-ups**: FQ1 **A** drop `exists` · FQ2 **A** per-element word-boundary genre matching ·
FQ3 **C** `hold` stored, rule disabled with a reason.

**Artifacts**: `construction/u3-rule-model/functional-design/` — `domain-entities.md`,
`business-logic-model.md`, `business-rules.md` (**BR-14 … BR-21**, continuing from U2's BR-13).

### Three findings that changed the design, each caught before it was written down

⚠️ **A tri-state `exists` can never return `false`.** A field is present (`true`) or absent
(`unknown`) — there is no third input state, so `not(exists(f))` evaluates to `not(unknown)` =
`unknown`: exactly the question it was meant to answer, unanswered. `exists` was **removed from the
operator set** (FQ1), leaving `is-unknown` and `not(is-unknown)` as one obvious way to write each
direction.

⚠️ **Joining genres and then folding punctuation lets a match cross a boundary.**
`["hip hop","rapcore"]` → `"hiphoprapcore"`. Measured over the corpus's **110 distinct genres, 62
multi-word**: plain substring matching also makes `contains "rap"` match `trap`, `trap latino` and
`trap metal` — 4 unintended hits of 7. It reads as a working rule. Resolved by matching **per
element on word boundaries** (FQ2), with folding applied per value and never across a join.

⚠️ **Q7=A forces validation to run at load, not only at creation.** FR-45 specifies creation-time
validation, which cannot catch a field that vanishes afterwards — and one did, when migration 004
removed the artist-level label verdict on 2026-09-06. `validateRuleSet` now runs on every load and
reload; `LoadedRule.status` carries the answer. **FR-45 is exceeded, not merely met.**

### Two distinctions written into the model to stop a known defect shape recurring

- **`enabled` vs `status`** (BR-18.2). `enabled: false` is *the user turned this off*;
  `status: disabled` is *the system cannot evaluate this*. Merging them loses the reason and shows
  the user their own toggle switched off by something else.
- **`genres == null` vs `genres == []`** (BR-17.6). "Never asked" vs "asked, there are none" —
  39 and 131 plays respectively. Merging them is the 2026-09-06 `unknown`-merge defect again.

⚠️ **`restedOnUnknown` is set from the RAW VERDICT, never accumulated while walking the tree**
(BR-19.6). Q1 offered option C — Kleene's answers with Bochvar's flagging — and it was **not
chosen**. The tempting implementation, a flag accumulated during the walk, silently produces the
rejected option. A one-line difference in code, a large one in meaning.

⚠️ **FR-33 is knowingly PARTIALLY met by U3.** `no-match` and `match` are implemented; **`hold` is
not**, because it needs a deadline and a re-evaluation trigger that a pure synchronous module
cannot have (Q9 = B). Rules declaring it are stored and disabled with a reason (BR-18.6, FQ3 = C),
so they begin working when U5 lands without being re-authored. **FR-33 is discharged by U5, not
U3** — recorded so the requirement is not marked complete on the strength of this unit's tests.

**The execution plan's Phase 2 gate anticipated this branch.** Its "hypothesis fails" case reads:
*"Phase 3 still proceeds; the engine's value never depended on this one field. Age, artist and
history-based rules remain useful."* That is now the actual situation, and the design holds without
amendment.

**Context**: CONSTRUCTION — U3 Functional Design complete. No code written, no schema change, no
data change. 486 tests, typecheck clean, corpus 427 plays and recording throughout.

---

## 2026-09-10 — U3 NFR Design APPROVED

**Stage**: CONSTRUCTION — NFR Design, Unit U3. **User response**: *"approve"* (2026-09-10).
**Plan**: `construction/plans/u3-nfr-design-plan.md` — 5 questions.
**Answers**: Q1 **A** depth bound at validation · Q2 **B** `config/rules.json` · Q3 **D** no
watching in U3 · Q4 **B** `partialData` is an input, plus report unknown fields · Q5 **C**
assemble eagerly, cache per play.

**Artifacts**: `construction/u3-rule-model/nfr-design/` — `nfr-design-patterns.md` (**P-10…P-18**)
and `logical-components.md` (**LC-7…LC-12**, **PBT-11…PBT-20**).

### Only five questions were asked, deliberately

Most NFR categories were **answered by existing convention** and asking again would have been
noise: `fast-check` 4.9 with `test/fc-config.ts` (`FC_SEED`, shrinking on, PBT-08), per-unit
generator modules, `purity.test.ts`'s `PURE_MODULES` list, `noOrphanModules.test.ts`. Scalability,
availability, concurrency, caching and circuit breakers were evaluated and recorded as **not
applicable with justification** rather than skipped silently — single user, single process,
synchronous pure function, no upstream.

### ⚠️ "Never throws" had a hole, and it was the stack

BR-21.1 declares every pure function total. A predicate is a **tree**, the natural evaluator is
**recursive**, and a deep enough tree overflows the stack — **which is a throw, from a function
documented as unable to throw.** Reachable without malice, and a property test with a tree
generator would have found it. Closed by **P-10**: `MAX_PREDICATE_DEPTH = 32`, enforced at
validation, evaluator stays recursive so it reads against the Kleene tables. `too-deep` is a **new
`DisabledReason`**, not a reuse of `type-mismatch` — a wrong reason is worse than a generic one.

### ⚠️ Q3 = D removes `watch()` from U3, with two consequences recorded rather than discovered

1. **BR-20.8 (last-known-good on reload) cannot fire in U3.** No watcher means no reload, so only
   cold start (BR-20.7) applies. Marked **specified and deferred to U4**, not implemented-but-dead
   — a rule that cannot fire is the "stored setting that does nothing" trap the user rejected at
   Q9 = C.
2. **This diverges from the inception design.** `component-methods.md` specifies
   `RuleStore.watch(onChange)`. Construction refining inception is permitted, but a silently
   narrowed interface is how a requirement goes missing, so LC-11 states it. The half-written-file
   race leaves U3 with the watcher and becomes U4's to design.

### Two decisions taken without asking, both recorded as design constraints

- **The fact cache lives OUTSIDE the pure modules** (LC-12, BR-21.7). Caching inside
  `assembleFacts` would give a pure function a memory and NFR-26 would be gone.
- **`playsOfTrack` excludes the play being evaluated** (BR-21.8). At track start it is not yet
  recorded, so the counts mean *"before this one"*. The other reading is equally natural and the
  difference is invisible in the value.

⚠️ **`partialData` is supplied by the caller and NEVER inferred** (P-17). Inferring it from
`often-unknown` fields reading `unknown` cannot distinguish *"not yet resolved"* from *"resolved,
and the answer is nothing"* — the distinction that has caught this project three times. R11 makes
this the common case, not the edge: a label lookup is two MusicBrainz calls behind a 1 req/sec
queue, so `label.classification` will usually be `unknown` at track start.

**Amendments to the approved functional design**, made for consistency rather than left
contradicting: `DisabledReason` gains `too-deep`; `Decision` gains `unknownFields`; `RuleStore`
loses `watch()` and names `config/rules.json`; BR-18.6a and BR-21.7–21.9 added; BR-20.8 marked
deferred.

**Context**: CONSTRUCTION — U3 NFR Design complete. No code written, no schema change, no data
change. 486 tests, typecheck clean.

---

## 2026-09-10 — U3 Infrastructure Design APPROVED

**Stage**: CONSTRUCTION — Infrastructure Design, Unit U3. **User response**: *"approve"*.
**Plan**: `construction/plans/u3-infrastructure-design-plan.md`.
**Answers**: Q1 **A** `:ro` mount · Q2 **A** directory mount · Q3 **C** *(conflicted — see below)* ·
Q4 **A** gitignored with a committed example · Q5 **A** bounded at 1 MB / 1000 rules.
**Artifact**: `construction/u3-rule-model/infrastructure-design/infrastructure-design.md`.

U3 adds **one file and one mount**. Container, port binding, access posture, database mount and
snapshot schedule are untouched.

### ⚠️ Q1 = A and Q3 = C were in DIRECT CONFLICT, and it was raised rather than resolved silently

Q3 = C asked the **app** to write a default rules file when none exists. Q1 = A mounts `config/`
**read-only**. Option C's own text carried the dependency — *"Requires `:rw` (Q1)"* — and on a
read-only mount that write fails `EROFS` at **every startup of a fresh install**, logging an error
each time: the exact noisy-fresh-install outcome Q3 existed to prevent, reached from the other
direction.

Resolved by **FQ1 = A**: keep `:ro`, and move creation off the app onto an explicit
`npm run rules:init`, the same shape as `npm run auth` creating `secrets/spotify-config.json`. C's
intent — the file should always exist and be discoverable — is preserved; the app never writes a
byte through U3.

⚠️ **FQ1 WAS ANSWERED BY RECOMMENDATION, NOT EXPLICITLY.** The user replied *"continue"* with the
tag left blank, and A was the stated recommendation. Recorded in both the plan and the artifact as
an **assumption rather than a decision**. Reversal to B is a one-word compose change (`:ro` →
`:rw`) plus restoring the auto-create in `RuleStore`.

### ⚠️ A single-file bind mount binds an INODE — caught before U4 could hit it

Q2 = A mounts the **directory** `./config:/config`, not the file. The safe way to write a config
file is write-temp-then-rename, which **replaces the inode**; through a single-file bind mount that
rename either fails or silently detaches the container's view from the host file. **U3 only reads,
so the bug would be invisible here and would surface the first time the U4 editor saves.** Same
family as `compose.yaml`'s existing warning that `./data` must be mounted as a directory because
SQLite's `-wal` and `-shm` siblings have to live beside the database.

### ⚠️ Docker creates a missing bind-mount source directory OWNED BY ROOT

The entrypoint drops privileges to `node`, so a root-owned `config/` would leave the app unable to
read its own rules — with a permissions error that reads like a code fault. `rules:init` creates
the directory as the invoking user, which is why the setup step earns its place rather than being
a README line.

### Decisions

| Decision | Source |
|---|---|
| `config/rules.json` — its own directory, **never `data/`** | NFR Q2 = B (P-15) |
| `./config:/config` — the **directory** | Q2 = A |
| **`:ro`** at U3, `:rw` at U4 | Q1 = A |
| The app **never** creates the file; `npm run rules:init` does | FQ1 = A |
| Absent **file** is quiet/info; absent **directory** is warn; invalid is error | Q3 reporting |
| `config/*` gitignored, `config/rules.example.json` committed | Q4 = A |
| 1 MB / 1000 rules / depth 32 — **constants in code, not settings** | Q5 = A, NFR Q1 |

**The bounds are deliberately not environment variables**, following the precedent set for
MusicBrainz request spacing: a knob exists only to violate the policy, most likely while debugging
and then forgotten. A depth limit that can be raised from the environment will be raised at the
moment it first refuses something — the moment it is doing its job.

**An absent file and an absent directory are different facts** and get different log levels. A
missing file on a fresh install is normal; a missing directory means the mount did not happen, and
quiet would be exactly wrong. Both name the path. The two-facts pattern in infrastructure clothing.

**Nothing was applied.** The `compose.yaml`, `.gitignore`, `config/rules.example.json`,
`scripts/rules-init.mjs` and `package.json` changes are recorded as a list to apply at Code
Generation.

**Context**: CONSTRUCTION — U3 Infrastructure Design complete. No code written, no schema change,
no data change. 486 tests, typecheck clean.

---

## 2026-09-10T00:00:00Z — U3 Code Generation plan presented for approval

**Stage**: CONSTRUCTION — Code Generation Part 1 (Planning), Unit U3.
**Plan**: `construction/plans/u3-code-generation-plan.md` — **13 steps**, 7 new source modules,
6 new test files, 1 test file extended, 5 deployment artifacts, 2 documents.

**Approval prompt logged before asking**, per the stage rules. One scoping decision is embedded in
the plan rather than assumed: whether **LC-12 `FactCache`** is built now or deferred to the unit
that first evaluates rules on the poll path. U3 has no caller, so building it now would land an
impure component a unit early, shaped by guesses about a caller that does not exist. Deferral is
recommended and is the same treatment `watch()` and BR-20.8 already received.

**Awaiting explicit approval of the whole plan and generation sequence.**

**APPROVED** 2026-09-11 — user response: *"continue"*. The `FactCache` scoping tag was left
blank, so option **A (defer)** was taken by recommendation and recorded in the plan as an
assumption. Proceeding to Code Generation Part 2.

---

## 2026-09-11 — U3 Code Generation COMPLETE — the rules core exists and is wired to nothing

**Stage**: CONSTRUCTION — Code Generation Part 2, Unit U3. Plan approved 2026-09-11 (*"continue"*).
**Summary**: `construction/u3-rule-model/code/u3-code-summary.md`.

**620 tests passing** (from 486) · typecheck clean · `purity.test.ts` clean with six new modules ·
`noOrphanModules.test.ts` clean with **no new `ALLOWED_ORPHANS`**.

### The containment claim is verified, not asserted

> **`git status src/` shows only `src/rules/`. Not one existing source file changed.**

No route, no `server.ts` wiring, no poll-loop change, no UI, no schema change, no migration. The
app behaves exactly as before. `Decision` values are produced and consumed by nothing until U4.
That was the whole point of putting the largest, least-certain component where being wrong costs
nothing.

**Seven modules**: `types`, `fieldCatalogue`, `trackFacts`, `predicate`, `ruleValidator`,
`RuleEngine` (all pure) and `RuleStore` (impure). **Seven test files** including
`ruleGenerators.ts`. Deployment: `./config:/config:ro`, `RULES_PATH`, `.gitignore`,
`config/rules.example.json`, `scripts/rules-init.mjs`, `npm run rules:init`.

### ⚠️ THE DEPTH GUARD COULD NOT BE REACHED — found while writing it

`depthOf` was written recursively, the obvious way. **It is the guard that stops `evaluate` from
overflowing the stack, and a recursive implementation overflows while computing the guard's own
input** — on exactly the trees the guard exists to refuse. The `RangeError` would have escaped
from the *validator* rather than the evaluator, and P-10 would have been strictly decorative.

Rewritten iteratively with an explicit stack and early exit at the limit: a pathological tree now
costs O(limit), not O(tree). `predicate.property.test.ts` nests **50,000 levels** and asserts both
that it returns and that it returns in under 50 ms.

> **A guard computed the same way as the thing it guards is not a guard.** Look for this shape
> anywhere a limit is enforced by measuring first.

### ⚠️ A property-test generator that recurses per branch is exponential

`treeOfDepth(d)` called itself three times per level — ~3^d arbitraries. At depth 20 it exhausted
the heap and killed the test process with a V8 stack dump and **no useful message**: it read as
*"property testing is slow"*, not *"the generator is wrong"*. Fixed by building the child
arbitrary once. Same bug in `predicateTree`.

### `applyOnUnknown` threw on an unreachable branch, and totality won

The first draft threw on `'hold'` to make the U5 seam loud. But **BR-21.1 says every pure function
is total** and PBT-13 asserts no input throws — a test constructing a `LoadedRule` directly,
bypassing the validator, would have hit it. The compile-time tripwire comes from the switch having
**no `default:`**, which is what actually makes adding an `OnUnknown` member a compile error; the
throw added nothing but a failure mode.

### One test was wrong rather than one behaviour

A property asserted every catalogue field reads `unknown` on blank facts. `track.title`,
`artist.name` and `album.name` are `availability: 'always'` and never absent. Rewritten to
condition on whether the field *actually* reads null — testing more, not less — plus a companion
check that any never-absent field is declared `always`.

### `noOrphanModules` earned its keep immediately

It failed on `rules/trackFacts.ts`, which had no test. **Filled the gap rather than allowlisting
it** — `trackFacts.test.ts` now pins the rule that matters there: an absent history count stays
`null` and never becomes `0`, and an empty genre list stays `[]` and never becomes `null`.

### Requirements

FR-26–32, FR-43–45, NFR-25–27 ✅. **FR-33 remains PARTIAL**: `no-match` and `match` implemented,
**`hold` is U5's**. A rule declaring it is stored and disabled with a reason, so rules written now
begin working when U5 lands without being re-authored. **Do not mark FR-33 complete on the
strength of U3's tests.**

**Exit criteria all met.** Tri-state property-tested, De Morgan holds both ways, no input throws,
invalid rules rejected with usable messages, rules round-trip by **behaviour not bytes**,
evaluation deterministic and side-effect free, and no I/O, clock, network or database in any of
the six pure modules.

**Context**: CONSTRUCTION — U3 built. Container not rebuilt and does not need to be: nothing reads
`RULES_PATH` yet. Corpus 427 plays, recording throughout.

---

## 2026-09-11 — U3 Build and Test: PASS

**Stage**: CONSTRUCTION — Build and Test, Unit U3.
**Summary**: `construction/build-and-test/u3-build-and-test-summary.md`.

| | |
|---|---|
| Typecheck | ✅ clean |
| Compile | ✅ exit **0** → `dist/rules/` |
| Tests | ✅ **620 passing**, 0 failing (486 before U3) |
| Coverage | **99.26% line · 93.10% branch · 97.53% function** (was 99.19 / 92.86) |
| Purity | ✅ six new pure modules enforced |
| Orphans | ✅ no new `ALLOWED_ORPHANS` |
| Container build | ✅ exit **0** |
| Container runtime | ✅ recreated and verified |
| App behaviour | ✅ **unchanged** |

⚠️ **Every exit code captured directly, not through a pipe** — `docker compose build | tail`
reports the pipe's status, and a failing build has read as success here once before.

### The containment claim was checked, not asserted

`git status src/` showed **only `src/rules/`**; `grep -c rules src/api.ts` is **0**; the single hit
in `server.ts` is an unrelated comment about local-access rules; the container logs carry **no
rules line** because nothing reads `RULES_PATH`; schema stays **v4** with no migration. If a later
session finds the rules engine affecting app behaviour before U4/U5, that is a regression of the
phase boundary rather than progress.

### The container was recreated deliberately, to close a latent failure

The running deployment was still on the **old** compose file, so the new `./config:/config:ro`
mount would first have been exercised at an **unattended reboot** — and a broken mount means the
app does not start, which means **recording stops silently**. Corpus recorded before and after.

UI **200** · `/api/health` a real MCP round-trip · **WebSocket handshake 101** · cross-site Origin
**403** · `/config` mounted with both files · a write to it **refused, "Read-only file system"** ·
`integrity_check: ok` · `journal_mode: wal` · **428 rows before and after**, 343 live trails
intact. The WebSocket check is included because a `200` on `/` does not imply the live display
works — that was the blind spot behind the 2026-09-05 `403`.

### ⚠️ A claim from the infrastructure design was NARROWED because it did not reproduce

The design warned that Docker creates a missing bind-mount source directory **owned by root**,
leaving the app — which drops privileges to `node` — unable to read its own rules, with a
permissions error that reads like a code fault. **Measured on this host it does not happen**:
Rancher Desktop / Windows synthesises `rwxrwxrwx root:root` on the bind mount regardless, so the
files are world-readable and reads work.

The hazard is real on a **Linux** host. `npm run rules:init` keeps its place — it creates the file
from the committed template and refuses to overwrite — but `CLAUDE.md` has been corrected so the
root-ownership rationale is not cited as though it had been observed here. **An untested
justification repeated confidently is how a wrong reason outlives the decision it justified.**

### Defects

Four, all during code generation, all in `u3-code-summary.md`: the depth guard that could not be
reached, the exponential tree generator, the throw on an unreachable branch, and one test that was
wrong rather than a behaviour. **None were found by running the system** — the expected shape for a
unit with no runtime, and the inverse of U2, where all three defects were only reachable live.
`noOrphanModules.test.ts` caught an untested module (`trackFacts.ts`) immediately; the gap was
filled rather than allowlisted.

### Requirements

FR-26–32, FR-43–45 ✅ · NFR-25–27 ✅ (PBT-11 … PBT-20) · **FR-33 PARTIAL — `hold` is U5's, and must
not be marked complete on this unit's tests.**

**All seven U3 exit criteria met. Done means CI green, and it is.**

**Context**: CONSTRUCTION — U3 complete through Build and Test. Container rebuilt and running on
the new compose. Corpus 428 plays, recording resumed.

---

## 2026-09-19 — U3 APPROVED by the user

**Stage**: CONSTRUCTION — Unit U3 (Rule Model, pure core) approved. **U4 is the next unit.**

Approval followed a re-verification pass eight days after the build, not a reading of the build
summary:

| Check | Result |
|---|---|
| Test suite, re-run on the day of approval | ✅ **620 passing, 0 failing** |
| Working tree | ✅ clean at `ded71b2` |
| Container | ✅ `spotify-now-playing` up and **healthy** |
| `/api/health` | ✅ real MCP round-trip — `mcp: connected`, 30 tools |
| Recording continuity | ✅ corpus **428 → 504 plays**, latest recorded minutes before approval |

**Recording did not stop while the project was idle**, which is the thing the autostart chain
exists to guarantee and the only claim here that eight days of silence could have falsified.

Carried into U4 unchanged: **FR-33 remains PARTIAL** (`hold` is U5's, and must not be marked
complete on U3's tests); `RuleStore.watch()` and **BR-20.8** were deferred to U4; and U3 stays
**wired to nothing** until U4 wires it.

⚠️ A stale sentence was removed from the Build and Test checklist while approving: *"One open
decision blocks container use"* sat inside U3's entry but belonged to **U1** — open item 1 closed
2026-09-05. It read as a live blocker on U3.

**Context**: CONSTRUCTION — U3 approved. 7 commits pushed to `origin/main`; the repository had
existed only on this machine since 2026-09-10.

---

## 2026-09-19 — W-3 re-raised and re-probed: the confounder runs the other way

**Stage**: CONSTRUCTION — backlog maintenance. No code changed.

The user re-raised the session-end confounder independently, in the same words as 2026-09-10:
the last track of a session plays incompletely and is suspected of being recorded as a skip.
The corpus had grown **427 → 504 plays** since the first probe, so it was **re-measured rather
than answered from the existing entry**.

**Still zero instances.** All 31 skips close on `track-change`, all have a successor within 30 s,
none has `ev_ended_with_idle`. The twelve session-enders — the play before each ≥30 min gap, plus
the final play in the corpus — resolve **7 `completed`, 5 `unknown`, 0 `skipped`**.

The mechanism is one branch in `classify`: `skipped` is returned **only** when
`closeReason === 'track-change'`. Ending playback yields `playback-stopped` or `pause-idle`, both
of which fall through to `unknown`. The feared contamination cannot occur without editing that
branch.

### ⚠️ The direction was inverted, and that changes the deliverable

The five partial session-enders (ratios 0.02, 0.12, 0.24, 0.32, 0.34) are not contaminating the
outcome variable — they are **missing from it**. The gate's eligibility predicate is
`outcome IN ('completed','skipped')`, so each abandoned last-track is silently dropped from
analysis. **The user's instinct that this data is wrong was correct; the direction was not.**

W-3's value is therefore **recovering `unknown` rows into a decidable outcome**, not preventing
false skips. Recorded explicitly because someone implementing the item as stated would write code
that does nothing and tests that pass for want of anything to fix — the same shape as a green test
that is green for the wrong reason.

The item stays in the backlog at the user's request rather than being taken up now. It remains
**retroactively applicable** (a window function over `play`, no new collection, no upstream
requests), so deferring it costs nothing.

⚠️ **Not re-litigated**: the 2026-09-10 reconciliation — that low-ratio skips are *remembered* as
session ends while the instrument saw a genuine track change — is unresolved after three probes.
Further probing of *why* the perception differs is explicitly not worth a fourth cycle.

**Context**: CONSTRUCTION — U3 approved, U4 next. Corpus 504 plays, recording continuously.

---

## 2026-09-19 — U4 Functional Design complete (awaiting approval)

**Stage**: CONSTRUCTION — Functional Design, Unit U4 (Rule Observability).
**Artifacts**: `construction/u4-rule-observability/functional-design/` — **BR-22 … BR-31**.
**Plan**: `construction/plans/u4-functional-design-plan.md` — 11 questions + 7 follow-ups.

**Answers**: Q1 A · Q2 A · Q3 A · Q4 B · Q5 A · Q6 *question* · Q7 B · Q8 C · Q9 atomic swap +
version indicator · Q10 C · Q11 *2 questions*.

⚠️ **All seven follow-ups were taken BY RECOMMENDATION** — the user replied *"ok commit and
continue"* rather than answering them individually. Two of those recommendations **modify answers
the user gave explicitly** and are flagged in the plan and the state doc as the first thing to
revisit at approval.

### Two probes changed the design, and one number was wrong in the house pattern

**The user's Q1 assumption was correct and is now measured.** Every live play was joined to the
label resolution it used and the timestamps compared: a resolution already existed before the
track started for **94.9% of repeat plays** and **0.5% of first plays**. The lookup
(`LabelCache.getRelease`) is a synchronous SQLite read, so on a repeat there is no network at all.
But **first plays are 86.6% of live plays**, so a track-start trigger reads
`label.classification` as absent on roughly seven plays in eight.

⚠️ **A first-draft number said resolutions complete a median of 0.2 s after track start**, which
would have made a track-start trigger look nearly free. `resolvedAt` is stamped **before** the two
MusicBrainz calls, at the top of `resolveRelease` — it records *initiation*, not completion.
**The true availability latency is recorded nowhere**, and R11's floor (2 calls behind a 1 req/sec
queue, with observed 503 retries) is the only evidence. Caught by reading the code rather than
trusting the number; recorded rather than quietly corrected. `ENRICHMENT_WAIT_MS = 10 000` is
therefore **a guess made explicit**, and `partialData` counts how often it fires — the first real
measurement of that latency, taken during U4's live verification.

**`track.explicit` and `album_type` are not missing from the source.** The user asked whether the
data is never reported. It is: both come back from the `GET /tracks/{id}` call the app **already
makes for every enriched track** (`enrichment.ts:293` and `:296`) and both already flow into
`TrackFacts`. They were simply never written to `play`. The choice was therefore not "recover
unavailable data" but "stop discarding data we already pay for" — one migration, **zero** extra
requests. Removing them from the catalogue, the user's suggestion, would have discarded a live
field on the strength of a wrong premise.

### FQ1 and FQ3 are one decision wearing two numbers

Taken separately they read as two reversals; together they are one design. **A-prime waits for
enrichment**, so *"not yet resolved"* largely stops happening; what remains is the case where the
10 s cap fires, and that is exactly what `partialData` now means. It is a single caller-supplied
fact satisfying P-17, far narrower than the original option, and it preserves the user's own Q1
concern rather than accepting it. **If either is unwanted, both revert together.**

The trade accepted: under A-prime, U5 skips a few seconds into a track rather than at its start —
chosen in the direction of *knowing the label* over *acting instantly*.

### Decisions worth recording

- **Point-in-time history counts** (Q5 = A). As-of-now counts fail US-24's own determinism
  criterion and **would pass every unit test**, because fixture history does not grow. It would
  surface months later as drift. The window must also exclude the current row, or
  `history.playsOfTrack >= 1` is true for every row in existence.
- **`playId` is nullable and stays nullable** (BR-24). A decision is taken *during* a play; the
  play row is written when it *closes*. `NOT NULL` would force a decision to wait for its own
  consequence, and plays that never close cleanly are exactly the W-3 cases.
- **Q2's caveat became BR-23.6**: each row carries the rule's **content hash**, so a stored
  decision diverging from a recomputed one is attributable rather than a mystery during reporting.
- **BR-28.4 is inert**: 0 rows have `skip_source = 'rule'` and will until U5. Built now because
  the first row it must exclude appears the moment automation runs, by which time the back-test
  will already have been trusted.

### ⚠️ U3's containment guarantee is retired by this unit, on purpose

U3's was *"`git status src/` shows only `src/rules/`"*. U4 necessarily changes the poll loop,
`api.ts`, the schema and the UI, so that guarantee **cannot survive** — from here the phase
boundary rests entirely on **`src/playback/` not existing** (BR-30.3), a weaker guard. Stated
rather than discovered. `LoggingExecutor` takes **no** playback collaborator, because an injected
but uncalled one would reduce the boundary to a runtime flag.

### Not settled by this unit

**FR-33 `hold` remains PARTIAL** — unchanged, still U5's. **BR-20.8 is discharged** (BR-26.3) and
will be exercised for the first time ever during live verification: it has been specified since U3
and has never run.

**Context**: CONSTRUCTION — U4 Functional Design complete, awaiting approval. No code written; no
schema change applied. Corpus 528 plays, container healthy and recording.

---

## Clarifications — 2026-09-20

The user declined a full document review (*"I don't think I'll be able to do an efficient review
of the model and rules in a reasonable amount of time"*) in favour of building and evaluating
hands-on, and asked three questions about the decisions flagged as uncatchable that way.

### CQ1 — BR-31.3: is `explicit` / `album.type` permanently unresolvable?

> *"does this mean that both new columns are never able to resolve to t/f? OR does it mean that if
> the field is null/unanswerable then it cannot resolve?"*

**The second, and narrower still: the limitation is temporal and affects only back-tests.**

| Context | Behaviour |
|---|---|
| **Live evaluation** (once U4 wires it) | Fully answerable, resolves `true`/`false` normally |
| **Back-test over post-v5 plays** | Answerable, resolves normally |
| **Back-test over pre-v5 plays** | Unanswerable → `unknown` |

Both values already come from enrichment and already pass through `assembleFacts` untouched
(`trackFacts.ts` — `explicit: input.explicit`, `type: input.albumType`). The v5 columns exist
**only so history can answer them later**; they have nothing to do with live evaluation. Everything
recorded from migration 005 forward is answerable, and the blind window is the corpus that already
exists.

⚠️ **And `unknown` does not mean the rule is useless**, because Kleene logic is decisive whenever
the data answers the question (BR-14.3). `album.type == 'single' AND artist.following == false`
resolves to **`false`** on a pre-v5 row if the artist *is* followed — the unknown never mattered.
A rule is only stuck when the unanswerable field is the one that would have decided it.

⚠️ **One case is not temporal and became BR-31.3b**: `explicit` arrives as `boolean | null` from
enrichment, and it is `null` when `GET /tracks/{id}` **failed**. That is a transient error, not an
absent fact, and it must never be persisted as `false`. This is the `error` is not `unknown`
family — three separate U2 defects, all of which passed the full test suite.

### CQ2 — BR-29.3: does fencing the pruner off `play` cost anything?

> *"are there negative consequences of that? If there are good reasons to be able to join in
> 'play' records, can it be done in a read only mode?"*

**Yes, there is a real cost, and the suggested fix is the right one. BR-29.3 is revised.**

Every retention policy keyed on the decision itself — keep matches, keep the last N per rule, prune
oldest — needs only the decision table. **The one policy that needs the join is *"keep the
decisions where the rule and I disagreed"***, which is precisely the subset worth keeping while
authoring rules. A blanket ban would have quietly pruned the interesting rows first.

**The safety property was never about the module; it is about the DELETE.** A `SELECT` cannot
destroy anything. Revised to:

- **BR-29.3** — the **DELETE** names only the decision table and deletes by an explicit id list
- **BR-29.3a** — the pruner **may read `play`** in a `SELECT` to decide which ids to prune
- **BR-29.3b** — read and delete are **separate statements**; no `DELETE … WHERE id IN (SELECT …
  JOIN play …)`

⚠️ **Pinned on the SQL text, not on behaviour**, the way `localGuard.test.ts` pins the upgrade
handler. A single statement that joined and deleted would satisfy every behavioural test and lose
the property entirely — the *"guard computed the same way as the thing it guards"* shape.

`PRAGMA query_only = 1` on a dedicated read connection was considered and **not** specified: it
buys enforcement the text assertion already provides, at the cost of a second connection to a file
with one writer.

### CQ3 — BR-27.2: *"I THINK this will be fine… will need to see it in action."*

**No change needed — the design already takes the safe option (point-in-time, Q5 = A).**

⚠️ **But it will not be visible in action, and that is the entire hazard.** As-of-now counts
produce plausible numbers today; the defect is that the *same back-test over the same range returns
a different answer months later*, as the corpus grows underneath it. There is no moment where
looking at the screen reveals it.

**It can be made visible by a test rather than by looking**, and that becomes an NFR Design
obligation: *inserting plays dated after a back-test's range must not change that back-test's
result.* That property fails loudly under as-of-now counts and passes under point-in-time — which
is the only way this decision ever gets checked.

### Execution trace scope: rule-level (BR-32)

Chosen over per-node. Renders from the stored `Decision`, so **no second evaluation and no engine
change**.

⚠️ `RuleOutcome` carries a rule-level verdict and a flat `fieldsSeen` map — **not** a tree. A
per-node trace needs a second walk of the predicate, and a second walk is a second implementation
of the evaluator: the WebSocket `403` exactly, where the admission rule was re-implemented rather
than reused, the copies diverged, and **all 411 tests passed** while every handshake failed.

What this gives up: *"which branch of the AND decided it"* is not stated, though it is usually
inferable from `fieldsSeen`. The upgrade is additive and needs no rework — but if taken, it must
come from the **same walk** that produces the verdict.

**Context**: CONSTRUCTION — U4 Functional Design revised. Document review declined in favour of
hands-on evaluation; the three flagged decisions were answered rather than skipped, and one of
them (BR-29.3) changed as a result.

---

## 2026-09-20 — U4 NFR Design started; `fs.watch` disproven on the deployment

**Stage**: CONSTRUCTION — NFR Design, Unit U4. Plan: `construction/plans/u4-nfr-design-plan.md`.

The user declined the Fable design review for now (*"lets push the fable review... we'll do that
later"*) and chose to continue to the next stage. The review remains available and non-blocking —
the functional design is committed and pushed.

### 🔴 `fs.watch` DOES NOT FIRE through the Rancher Desktop bind mount

Probed **before** designing the watcher, not discovered during code generation. A watcher started
inside the running container on `/config` and on `/config/rules.json`, while the host modified
`./config/rules.json` by in-place append **and** by write-temp-then-rename:

| Check | Result |
|---|---|
| `fs.watch('/config')` directory events in 12 s | **0** |
| `fs.watch('/config/rules.json')` file events | **0** |
| Did `watch()` throw? | **No — it registers silently** |
| **Control: does the container see the new content?** | ✅ **Yes, within 1 s** |

**The control is what makes this conclusive.** Content propagates through the mount correctly and
immediately; only the change *events* are absent. This is not a mount failure — it is inotify not
crossing the virtualised filesystem boundary.

⚠️ **The dangerous variant of the project's recurring shape.** `watch()` registers successfully,
throws nothing, and never calls back — there is **no error to see**. A rules file edited on the
host would take effect **never**, while the app looked healthy. Same profile as the WebSocket
`403`: every page load `200`, every handshake refused.

⚠️ **It would have passed every test.** A unit test watching a `tmp` directory on a normal
filesystem fires correctly; the defect exists only over the bind mount, which is the only place
the app actually runs. Same family as the option-B divergence — tested in the shape that works,
deployed in the shape that does not.

**Consequence**: BR-26.1's 500 ms debounce is not the mechanism. It has to be polling (`stat` on
`mtime`/`size`, hashing only when they move) or an explicit reload control. Q1 of the NFR plan
settles it; the recommendation is **both**, entering the same loader — one admission rule, invoked
twice, never written twice.

⚠️ **Do not resolve this later by moving `rules.json` into the image or onto a named volume.**
Host-editability is the point of the mount.

**Context**: CONSTRUCTION — U4 NFR Design plan written, 5 questions open. No code written. Corpus
528 plays; `config/rules.json` restored to its committed content after the probe.

---

## 2026-09-20 — U4 NFR Design complete (awaiting approval)

**Stage**: CONSTRUCTION — NFR Design, Unit U4.
**Artifacts**: `construction/u4-rule-observability/nfr-design/` — **P-19…P-26**, **LC-13…LC-20**,
**PBT-21…PBT-30**.

**Answers**: Q1 **C** · Q2 **C** · Q3 **A** · Q4 **B** · Q5 **C** — all as recommended, none
vague, **no follow-ups required**. The first stage in this unit to need none.

### What the answers settled

- **P-19 change detection is polling**, 5 s `stat` on `mtime`/`size` with a hash only when those
  move, plus a reload button. **Both enter the same `load()`** — the one-admission-rule lesson,
  which the WebSocket `403` taught by having the policy re-implemented rather than reused.
- **P-20 ordering is fixed**: evaluate → broadcast → write. `node:sqlite` is synchronous and the
  caller is the poll loop, so sequencing the write after the broadcast makes "the display is never
  behind the record" a structural claim rather than a measurement that could drift.
- **P-21 contains derived failure**: a decision-log write failure drops the row, counts it, and
  never shares a transaction with the `play` write. A rules defect must be unable to abort the one
  artefact that cannot be regenerated. **The drop is counted, never silent** — a gap in the log
  reads as *"the rule did not match"*.
- **P-24 makes truncation unavoidable at the type level**: `truncated` is a **required** field of
  `BackTestReport`. This is the `release_count = 100` bug pre-empted — an arbitrary sample recorded
  as a complete count, which happened to 18 of 56 stored resolutions and was believed.
- **P-25 composes rather than enlarges**: rules diagnostics live in a separate tested module that
  `diagnostics.ts` calls, so the new surface is tested and the existing `ALLOWED_ORPHANS` entry
  does not grow.

### ⭐ PBT-22 exists because BR-27.2 has no observable failure mode

The point-in-time decision cannot be validated by hands-on evaluation — as-of-now counts produce
plausible numbers today and diverge only over months, as the corpus grows underneath a range that
has not changed. The property makes it immediate: take a report, insert plays dated **after** the
range, take it again. Point-in-time is stable; as-of-now is not.

**It fails loudly under the wrong implementation and is silent under the right one.** The user's
answer on this was *"I THINK this will be fine… will need to see it in action"* — and the honest
answer is that it will never be seen in action, which is why it is pinned by a property instead.

### Purity discipline moved rather than relaxed

U3 was five pure modules of six. U4 is mostly wiring and mostly impure — so the claim narrowed to
**everything that decides anything stays pure**: `factReconstructor`, the back-test fold,
`decisionTrace` and `rulesDiagnostics`. Impure code *moves* data; it never *judges* it.
⚠️ `test/purity.test.ts` must be **extended** to the new pure modules, not merely left passing — a
`Date.now()` in `factReconstructor` would break NFR-26 while every other test passed.

### Three exit criteria cannot be closed by tests

The dry-run agreement gate, the `partialData` rate that says whether `ENRICHMENT_WAIT_MS = 10 000`
is right, and **BR-20.8's last-known-good path — specified since U3 and never once run**.

**Context**: CONSTRUCTION — U4 through NFR Design, awaiting approval. Next is Infrastructure
Design. No code written; schema still v4. Corpus 528 plays, container healthy.

---

## 2026-09-20 — U4 Infrastructure Design complete (awaiting approval)

**Stage**: CONSTRUCTION — Infrastructure Design, Unit U4.
**Artifacts**: `construction/u4-rule-observability/infrastructure-design/infrastructure-design.md`
plus **`functional-design/frontend-components.md`**, added after Q4.

**Answers**: Q1 **A** · Q2 **as tabled** · Q3 **A** · Q4 **A** + status-bar elaboration.

**U4 adds no infrastructure** — no mount, no volume, no port, no container. One migration and two
environment values. U3's was *"one file, one mount"*; U4's is *"one migration, no mount"*.

### ✅ Rollback verified rather than assumed

`migrate()` skips every migration at or below the current version, so **U3's image against a v5
database finds nothing to apply** and ignores the new table and columns. That is the real recovery
path if U4 misbehaves: `compose up -d` on the previous image, no data surgery, no down-migration.

⚠️ **The guarantee holds only while migrations stay additive.** A future migration that rewrites or
drops would break rollback **silently** — the old image would start happily against data it can no
longer interpret. Any non-additive migration must retire this explicitly.

### ⚠️ `compose.yaml` anticipated U4 wrongly, and the comment would have been followed

The `./config` mount says *"this becomes `:rw` at U4 when the editor needs to write"*. **U4 has no
editor** — the UI is read-only by Application Design Q2 = A, and the reload button re-reads. The
mount stays `:ro` and the comment is retargeted at the unit that actually adds editing. Left alone
it would have granted a write capability a whole unit early, which is precisely what the
`musicbrainz.json` comment beside it warns against.

A second comment on the same mount still states the root-ownership hazard as fact. **Measured
2026-09-11 not to occur on this host**; CLAUDE.md was corrected then and `compose.yaml` was not.
Both corrections apply at code generation.

### Q4 became a status bar rather than a banner

A failed migration leaves `repository` null: display works, WebSocket connects, **nothing is
recorded**, and it is said only in the startup log — which nobody reads at an autostart. The user,
from a rich-application background, asked for the standard shape: a compact status strip with an
error field and short red/green indicators.

That is a better answer than a one-off banner, because U4 was already going to add a rules version
indicator — three separate one-off indicators was the alternative. **Recording · Rules · Connection
· Spotify**, in one bar.

⚠️ **Four states, not three.** An indicator that has not yet heard from its subsystem renders
**unknown, never green**. A status dot that is green because nothing has reported yet is this
project's central defect wearing a UI hat — and it matters most on *Recording*, where a false green
says "your listening is being saved" about the one artefact that cannot be regenerated.

⚠️ **Colour is never the only channel**: every indicator carries a text label and a distinct glyph
per state. A bar that is *only* red and green fails outright for red-green colour deficiency.

⚠️ **State derivation lives in `src/` as tested pure functions**, not in `public/app.js`. That file
has no tests and is outside the orphan check, and both defects ever found in it were found by
clicking. The DOM wiring may stay there; the *judgement* may not — a false green would come from
exactly that judgement.

**Context**: CONSTRUCTION — U4 through Infrastructure Design, awaiting approval. **Next: Code
Generation.** No code written; schema still v4. Corpus 528 plays, container healthy.

---

## 2026-09-20 — Stale watcher rules corrected; U4 blind spot measured; handoff written

**Stage**: CONSTRUCTION — end of U4 design, before Code Generation. Context break point.

### Two rules were stale and are marked superseded, not silently rewritten

BR-26.1 and `business-logic-model.md` §4 described an **event-driven watcher with a 500 ms
debounce**. They were written **before** the `fs.watch` probe disproved that mechanism. Both now
carry the supersession explicitly, pointing at P-19's polling.

⚠️ **This is the cost of probing between stages**: the Functional Design was correct when written
and wrong two days later. Marking it beats rewriting it — a reader who finds only the polling
design cannot tell whether the event-driven option was considered and rejected, or never thought
of.

### ⚠️ BR-22.7's blind spot is real, and now measured

A play that **ends** before the 10 s enrichment cap produces **no decision row at all**. Measured
over 457 live plays:

| | |
|---|---|
| Plays ending under 10 s | **13 — 2.8%** |
| **Skips** ending under 10 s | **4 of 31 — 13%** |
| Median skip duration | **87.6 s** |
| At a 15 s cap | 3.5% of plays, 5 of 31 skips |

**Bounded and accepted.** Back-testing is unaffected — it reconstructs from stored plays, not from
decisions — and in U5 a skip made inside 10 s is one the user already acted on. ⚠️ **But a missing
row is not a "no match"**: anything counting decisions must use its own denominator rather than the
play count, or it reproduces the denominator trap that read 28%→12% where the truth was 86%→44%.

⚠️ **The blind spot scales with `ENRICHMENT_WAIT_MS`.** Re-measure before raising it.

### Handoff written

`construction/u4-rule-observability/HANDOFF.md` — reading order, the five things most likely to be
got wrong, Code Generation scope, the deployment sequence, and the three exit criteria CI cannot
close. Written so a cold session can start Code Generation without re-deriving the unit.

**Context**: CONSTRUCTION — U4 designs complete and awaiting approval. Clean break point: tree
clean, everything pushed, no code written, schema v4, container healthy on the U3 image. Corpus
**528+ plays** and still recording.

---

## 2026-09-20 — Fable design review settled: four decisions, nine corrections, one stale fact found

**Stage**: CONSTRUCTION — end of U4 design, immediately before Code Generation. **Still no code.**

### Every finding was checked against the source before being acted on

The review's fourteen findings were verified against `src/` rather than accepted. **Thirteen held
exactly as written.** One rested on an unprobed premise, so it was probed — and the probe
disproved a standing claim in CLAUDE.md.

Three findings were **worse than the review stated**:

| # | As written | As measured |
|---|---|---|
| 1 | `RuleStore.load()` wipes on `failed` | Wipes on `failed`, `absent` **and** `no-directory` — and two `current()` methods would have been the live trap |
| 3 | Two segmenters must agree | **`onPlayRecorded` fires only after `recordPlay` succeeds** — on a write failure `playId` stays null for ever, identical to "the play never closed" |
| 5 | Two confusable resolver exits | **Four**, including `labelEnrichment === null`, which makes *every* play wait the full 10 s cap |

One finding was **over-argued**: item 2's remedy (add a `trigger` column now because migrations
are forward-only) is not load-bearing — `ALTER TABLE ADD COLUMN` is O(1) in U5 as well, and U4's
value is derivable from `partialData`. ⚠️ **The irreversible risk is a `UNIQUE` constraint**, which
U5 would have to *drop* — a non-additive migration, which would retire the by-image rollback
guarantee migration 005 currently enjoys. BR-22.1a forbids the constraint; the column is not added.

### Four decisions, taken by the user

| Settled | Written to |
|---|---|
| **`RuleSetWatcher` owns the rule set**; `RuleStore` becomes a stateless parser | BR-26.3a/3b · LC-16 |
| **BR-22.1 scoped to U4**; no uniqueness constraint may encode it | BR-22.1a · migration 005 |
| **`PlayObserver` owns play segmentation**; the coordinator consumes its hooks | BR-22.8/8a · LC-14 |
| **Answerability is per row**, over a schema era *and* a backfill gap | BR-27.5a/5b/5c/5d · LC-17 |

Two review items had no competing option and were applied directly: **LC-22**
(`historyCountsBefore`, one method for live and replay) and **LC-21** (`liveFactSource`, a real
`enrichmentSettled` moved out of `server.ts`).

### ⚠️ The probe disproved CLAUDE.md open item 3

Open item 3 states *"Backfilled plays carry no ISRC — `recently-played` returns no
`external_ids`."* **It does return them** — probed live, HTTP 200, `external_ids.isrc` on 3/3
items — and `RecentlyPlayedBackfill.ts:109` has read the field since **U1** (`a8136d9`):

| Backfilled rows | ISRC present | `label_verdict` | `label_unknown_reason` |
|---|---|---|---|
| 2026-08-20 → 08-31 | **0 of 82** | NULL ×82 | NULL ×82 |
| 2026-09-03 → 09-16 | **4 of 4** | populated | populated |
| *(live, all dates)* | 457 of 457 | populated ×457 | — |

A clean break — and ⚠️ **the cause is UNESTABLISHED, and it is not the code.** `webApiClient.ts`
has exactly one commit, the backfill's wiring never changed, live rows carried an ISRC from the
very first one (row id 51), and the transition is clean at **row id 120 → 155** (2026-09-01 →
09-03) with **no code change in that window**. Something outside this repo changed, or the
original 2026-09-05 observation misattributed its cause. **An explanation was drafted and
withdrawn** — *"the nulls predate the code that reads the field"* — because `git log -L` disproved
it. Recording the withdrawal rather than the tidy story, since a plausible wrong cause is exactly
what this project keeps getting caught by.

⚠️ **No `ALTER TABLE` marks the boundary, so no schema-derived watermark can find it** — which is
what made the review's item 6 (schema era) only half the problem, and why the predicate is keyed
on the row's own state rather than on a date or a supposed cause (BR-27.5d).

**Why it reaches the back-test.** On those 82 rows `label.classification` is null because *there
was never a key to ask MusicBrainz with*. Reported as an unknown **value**, they become 82 plays
that "read the field absent" — which a reader takes for **coverage**. That is the
28%→12%-where-the-truth-was-86%→44% denominator bug, reappearing inside the instrument built to
avoid it. The discriminator already exists: an attempted row carries a verdict or a reason
(`notFound` 151, `noEligibleCandidate` 48); never-attempted is the **pair** of nulls.

✅ **CLAUDE.md open item 3 was corrected**, and item **3a** added for the unestablished cause.
Recovery is **72 distinct `track_id`s**, not 47 one-off calls. ⚠️ **The 2026-09-05 conclusion is
unchanged and remains the decision**: all 82 rows are `outcome = 'unknown'`, so **0 are
gate-eligible** — what the backfill lacks for the gate is the observation trail, not the ISRC.

⚠️ **The lesson runs opposite to this project's four documented traps.** Those were all *docs said
yes, probe said no*. This one is **our own notes said no, and the probe says yes**: a recorded
negative decays silently, because nothing ever re-tests it. It sat in CLAUDE.md for 15 days and
was only caught because an unrelated review made an unprobed claim about the same endpoint.

### One gap neither the review nor the design had

`BackTestReport` in `domain-entities.md` was **missing `truncated`**, which P-24 declares a
required field — *"a truncation that does not announce itself is a lie"*. The pattern document
specified it and the entity that defines the report did not list it. That is precisely how
`release_count = 100` happened: the cap was real, the disclosing field was never written down, and
18 of 56 resolutions recorded an arbitrary sample as a complete count.

### ⚠️ Two `play` columns had no writer anywhere in scope

Migration 005 was fully specified and **nothing was going to populate `explicit` or `album_type`**.
They would have shipped, stayed null on every row, and been read back as *unanswerable* for ever,
with the migration reporting success. Six places change, and the **export serialisers** are the
easiest to forget because nothing fails without them — a CSV silently missing two columns is
indistinguishable from a CSV that predates them. Probed and confirmed available on
`recently-played` (`album`, `album`, `single` on 3/3 items), so the backfill can populate both.

### New property obligations

**PBT-22a** (positive control — PBT-22 passes trivially against counts that are always zero),
**PBT-30a** (never-asked vs `notFound`), **PBT-31** (`fieldsSeen` survives serialisation —
`JSON.stringify` drops `undefined` keys; a pin, since `Maybe<T> = T | null` makes it currently
unreachable), **PBT-32** (`enrichmentSettled` is immediate for a keyless track), **PBT-33**
(`absent` on reload changes nothing).

**Context**: CONSTRUCTION — U4 designs revised and awaiting approval. `git status src/` clean,
schema still v4, container healthy on the U3 image, corpus **543 plays** (457 live, 86 backfilled).

---

## 2026-09-21 — U4 Code Generation complete; migration 005 deployed; awaiting the dry-run gate

**Stage**: CONSTRUCTION — U4 Code Generation. **Eight batches, 811 tests, schema v5 live.**

### Two scoping questions were answered before any code was written

**`FactCache` (LC-12, P-16) is CLOSED as superseded.** U3 deferred it *"to the unit that first
evaluates rules on the poll path"* — which is U4 — and U4's design never mentioned it, so it
would have been dropped by omission. BR-22.1's one-decision-per-play already assembles the four
aggregates exactly once, so the cache has nothing to save. ⚠️ **It becomes live again in U5**,
where FR-34's re-evaluation means a second assembly for the same play.

**Back-testing ships API-only.** FQ6's UI is the rules panel and the decision log; `curl`
satisfies the exit criterion and PBT-21/22, and back-testing lands beside the rule editor in U5.
⚠️ **US-24 is therefore delivered but not *surfaced*** — reading the UI alone will not find it.

### What the type system and the guards caught

The write path for `explicit` / `album_type` **was in no scope table**, and `tsc` found every one
of its six call sites the moment the fields became non-optional. Without that they would have
shipped, stayed null on every row, and been read back as *unanswerable* for ever — with the
migration reporting success.

`noOrphanModules.test.ts` refused three new modules in turn until they had tests. `purity.test.ts`
now covers `factReconstructor`, `decisionTrace`, `rulesDiagnostics`, `ruleHash` and `statusBar`.

### ⚠️ The point-in-time counter was MUTATION-CHECKED, and it needed to be

BR-27.2 has no observable failure mode, so a green test proves nothing by itself. Two mutations:

| Mutation | PBT-22 | PBT-22a (positive control) |
|---|---|---|
| counts always `null` | **PASSES** | fails ✅ |
| as-of-now (ignores the instant) | fails ✅ | passes |

**PBT-22 alone is vacuous** — an implementation returning zero for everything satisfies it
perfectly. The audit's item 12 was the difference between a real test and a decorative one.
Both mutations were reverted and the suite re-verified clean.

### Three self-inflicted defects, found and fixed rather than worked around

- A fixture that never spread its overrides — **7 tests were passing for the wrong reason**.
- An invented `play_id` that the live foreign key correctly refused. The FK is on; good to know.
- A JSON export expectation that contradicted the established `renderMaybe` convention. The
  convention won: a raw boolean would have made `explicit` the one field whose absent value is
  JSON `null`, which a consumer coerces to `false` without noticing.

⚠️ **A stray `prettier` run** reformatted `LoggingExecutor.ts` to double quotes. **The project has
no prettier config**, so that was prettier's defaults rather than house style, and it was reverted.
It did surface a real bug it had nothing to do with: `outcome.rule.id` where `RuleOutcome` carries
only `ruleId`.

### `PlayObserver` gained `onPlayDropped`, which the design did not have

`onPlayRecorded` fires **only after a successful write**, so its *absence* was the only signal a
consumer got — and absence is indistinguishable from *"the play has not closed yet"*. For the
decision log those mean opposite things: a fault on the artefact that cannot be regenerated,
versus an ordinary W-3 case. Without the hook, `playLink` could never leave `pending`.

### Deployment — migration 005, 2026-09-21

```
docker compose down                                  # the writer stopped first
data/backup-before-migration-005-20260921-093911/    # integrity_check: ok, v4, 543 plays
docker compose build                                 # exit code read DIRECTLY: 0
docker compose up -d
"migrated 5: ..."                                    # exactly once
```

| Check | Result |
|---|---|
| Schema | **v5** |
| `integrity_check` | **ok** |
| Plays | **543**, intact |
| v5 watermark | **584** = `MAX(play.id)` — every pre-existing row correctly pre-v5 |
| UI | `200` |
| WS handshake, same-origin | **`101`** |
| WS handshake, cross-site `Origin` | **`403`** |
| `GET /api/rules` | v1, `applied`, 3 active |
| `GET /api/decisions` | empty — correct, nothing has played since restart |
| Status indicators over the socket | recording `ok`, rules `ok`, spotify `ok` |

⚠️ **Both WebSocket directions were checked**, because a `200` on `/` does not imply the live
display works — that was the shape of the `403` that made the UI sit on "Disconnected" for a whole
deployment while all 411 tests passed.

⚠️ **`/api/now-playing` carries no `status` field.** `decorate()` runs on the WebSocket broadcast
only, which is what the UI uses. The REST endpoint stays the raw snapshot it has always been.

### 🔴 Three exit criteria remain, and CI cannot close any of them

1. **The dry-run agreement gate** — a real session whose match log the user agrees with.
2. **The `partialData` rate** — the first real measurement of enrichment latency, and the only
   evidence for whether `ENRICHMENT_WAIT_MS = 10 000` is right.
3. **BR-20.8's last-known-good path** — implemented and unit-tested for the first time in this
   unit, but **never once run against the real deployment**.

**Context**: CONSTRUCTION — U4 code complete and deployed, awaiting hands-on verification.
811 tests, typecheck clean, schema v5, container healthy, 543 plays, 3 rules active in dry-run.
`src/playback/` does not exist.

---

## 2026-09-21 — `skip_source = 'user'` was an assertion, and it was wrong on half the skips

**Raised by the user**: *"I've not skipped any NF tracks yet it's showing one. I NEVER skip Ren
tracks yet it's showing multiple skips for him."*

⚠️ **No test could have found this.** The code did exactly what it said:

```ts
skipSource: outcome === 'skipped' ? 'user' : null,   // "every live-observed skip is the user's"
```

An assumption written where an observation belongs, and the only thing that could contradict it
was a listener's knowledge of their own behaviour.

### The data is bimodal, with an empty band

```
0.01 0.01 0.08 0.09 0.12 0.12 0.14 0.15 0.23 0.24 0.25 0.25 0.27 0.30 0.44 0.49 0.49
                          <- nothing between 0.489 and 0.807 ->
0.81 0.82 0.84 0.85 0.85 0.85 0.85 0.85 0.86 0.86 0.86 0.87 0.87 0.87 0.88 0.89 0.89 0.90
```

**A second, independent measurement agrees**: how far into the *next* track the app was when it
first saw it.

| group | median | max |
|---|---|---|
| ratio < 0.75 | 2 s | **3 s — not one exceeds a single poll** |
| ratio ≥ 0.75 | 7 s | **31 s** |

### What was ruled out, and how

| Hypothesis | Verdict |
|---|---|
| Recording lost samples | ❌ Trails are regular 3 s polls to the last instant; `listenedMs == maxProgressMs` exactly |
| The app systematically undercounts | ❌ Median live track-change play leaves only **2.0 s** unplayed across 425 plays |
| Crossfade | ❌ Spotify caps it at 12 s; these lose **21–41 s** |
| Wrong `duration_ms` metadata | ❌ The same tracks reach full length on other plays — Ren's *Humble* stopped at 175 s of 176 s once, 142 s another time |
| The listener skipped them | ❌ Reported behaviour, and the bimodality supports it — genuine skipping would smear, not cluster |

⚠️ **The mechanism remains UNPROVEN.** Successor lag (7–31 s) and unplayed time (21–41 s) are both
elevated but do not match one-for-one. The strong indication is that the app learns of the
transition late while the old track's progress keeps advancing (Spotify interpolates it from a
timestamp) — but that is indicated, not established, and the column value says so by naming no
cause.

### What was built

`src/history/skipAttribution.ts` ⚙️ PURE — `attributeSkip(outcome, evidence)` → `user` |
`unattributed` | `null`. **Decided from the ratio alone**, at close, so it needs nothing that has
not happened yet.

⚠️ **The successor lag is recorded and NOT used as a condition.** One hand-checked play sat at
ratio 0.858 with a lag of only 2 s; ANDing the two signals would have mis-attributed it.
`skipAttribution.test.ts` pins that `attributeSkip` takes no successor argument at all.

⚠️ **The threshold sits inside the empty band and is not a tuned parameter.** A test asserts it
stays between 0.489 and 0.807, so moving it into occupied territory has to be deliberate.

### ⚠️ Why a new column instead of a third `skip_source` value

```sql
skip_source TEXT CHECK (skip_source IN ('user','rule'))
```

SQLite has no `ALTER TABLE ... DROP CONSTRAINT`, so widening that CHECK means rebuilding `play`
through the 12-step procedure — **on the one table that cannot be regenerated** — and it would
make the migration **non-additive**, retiring the by-image rollback guarantee migration 005 still
enjoys. Two `ADD COLUMN`s buy the same semantics for none of that risk.

Overloading `NULL` was the other option and is worse: `skip_source` is already NULL for *"this
play was not a skip"*. Making it also mean *"a skip by an unknown actor"* merges two facts into
one value — the exact defect being corrected.

⚠️ **`skip_source` is NOT rewritten, on historical rows or new ones.** It keeps saying `user`,
because that is what the app claimed and erasing it would destroy the evidence that the claim was
ever made. `skip_attribution` is the answer; `skip_source` is the claim.

### The chart was the visible symptom, so it was fixed too

`PlayBucket` gains **`ended-early`**. `bucketOf` no longer maps every `skipped` outcome to the
skipped bar. ⚠️ A skip with **no** attribution stays in `skipped` rather than being promoted —
inventing an attribution is the mistake being corrected.

### `outcome` was deliberately NOT changed

The hypothesis gate's eligibility is `outcome IN ('completed','skipped')` and its thresholds are
pre-registered constants. Reclassifying after the confirmatory run is precisely what
pre-registration exists to prevent. The attribution is additive; analysis can now filter, and the
gate is untouched.

⚠️ **Open item 4 needs revisiting.** It attributes this shape to crossfade and reasons that
correcting it could only move R1's result *toward* support. Crossfade is now ruled out, and the
effect is neither small nor obviously constant-time — **so that direction is no longer
established**.

### Deployed — migration 006, 2026-09-21

`docker compose down` → `data/backup-before-migration-006-20260921-200739/` (`integrity_check: ok`,
v5, 581 plays) → build (exit code read directly: 0) → up → `migrated 6:` exactly once.

`scripts/attribute-skips.mjs` dry-run first, then `--apply` with its own backup:

| | |
|---|---|
| Skipped plays | 36 |
| `user` | **17** |
| `unattributed` | **19** |
| `skip_source` still `user` | 36 — untouched, as designed |
| After | schema v6, `integrity_check: ok`, 581 plays |

All five Ren tracks and the NF track reattributed.

**Context**: CONSTRUCTION — U4 complete and deployed. 866 tests, typecheck clean, schema v6.

---

## 2026-09-21 — ⚠️ I CORRUPTED `history.db` BY RUNNING A SCRIPT AGAINST THE LIVE CONTAINER

**Fully recovered — 586 plays, 31,336 observations, `integrity_check: ok`, nothing lost.** The
record below is kept because the mistake was in ignoring a rule this file already contained.

### What happened

`scripts/attribute-skips.mjs --apply` was run **while the container was up**. Two writers on one
SQLite file — the hazard CLAUDE.md states in capitals:

> ⚠️ **Never run the container and `npm start` at the same time.** ... two writers on one SQLite
> file. The container runs unattended now, so **assume it is running** and `docker compose down`
> first.

The rule was read as being about `npm start`. It is about **writers**, and a maintenance script
holding a write handle is a writer. ⚠️ **The generalisation is the lesson**: "assume it is
running" applies to every process that opens the database for writing, not to one command.

### How it presented — and why the first reading was wrong

The script reported `Wrote 36 row(s). integrity_check: ok`, and a verification query immediately
afterwards showed the correct 19/17 split. **It looked like a clean success.**

The damage surfaced later as `skip_attribution` reading `null` on a row that had just been
written. The tempting conclusion was *"the write did not land"*. It had; the **index** had come
apart, so a query using `idx_play_skip_attribution` returned wrong rows rather than erroring.

⚠️ **A corrupt index answers queries.** It does not throw until something forces a check. The
first symptom was a plausible wrong answer, which is this project's recurring shape.

### Extent

`PRAGMA integrity_check` on the live file:

```
Tree 3 page 3 cell 66: 2nd reference to page 555
wrong # of entries in index idx_play_skip_attribution / idx_play_artist_id / idx_play_outcome
  / idx_play_isrc / idx_play_track / idx_play_started / idx_play_label_verdict
... rows missing from indexes ...
```

⚠️ **`VACUUM INTO` did not fix it and must not be trusted here.** The rebuilt file inherited
worse damage — `Rowid out of order`, and NULLs in NOT NULL columns on rows 370/371. VACUUM
rebuilds from the b-tree it is given; if that is damaged it propagates the damage into a file
that *looks* fresh.

### Recovery

1. `docker compose down` **first**, before any diagnosis, to stop further writes.
2. Snapshot the corrupt file to `data/CORRUPT-snapshot-20260921-201444/` — never diagnose on the
   only copy.
3. Full table scans read cleanly (586 / 31,336 / 126), confirming the table data survived.
4. Restore `data/backup-before-migration-006-20260921-200739/history.db` — verified `ok`, v5,
   581 plays, max id 622.
5. Migrate it to v6 offline.
6. Carry plays **623–627** and their 128 observations out of the corrupt snapshot.
   ⚠️ **Parents before children**: play 624 referenced `label_resolution` 460, created after the
   backup. Nulling the pointer was the shortcut and would have left a verdict with no
   provenance, which BR-13 exists to prevent — the resolution row was carried instead.
7. Re-run the attribution **with the container down**.

`integrity_check: ok`, `foreign_key_check` empty, counts identical to the corrupt file.
**Zero rows lost.**

⚠️ Decision-log rows from the gap were **not** recovered, deliberately: a decision is
recomputable from rules plus history, a play row is recomputable from nothing.

### What made recovery possible

The backup taken 7 minutes earlier, as part of the migration-006 checklist. ⚠️ **The checklist
step that felt like ceremony is the only reason this was a 20-minute detour rather than a
permanent loss.** `data/` is gitignored; there is no other copy.

### A second defect, found while fixing the first

`trackPlayStats` **re-implemented `bucketOf` inline**. Teaching `bucketOf` that an unattributed
skip is not a skip therefore fixed the weekly chart and left the per-track panel — the surface
the user was actually looking at — still reporting skips of artists they never skipped.
`public/app.js` had no rendering for the new bucket either.

⚠️ Same shape as the WebSocket `403`: one rule, two implementations, and the tests passed because
they exercised the copy that had been updated. The duplicate is removed — `trackPlayStats` now
calls `bucketOf`.

**Context**: CONSTRUCTION — U4 complete and deployed. 866 tests, typecheck clean, schema v6,
586 plays, `integrity_check: ok`, UI `200`.

---

## 2026-09-22 — Open item 4 rewritten: four numbers, all n≈10, none replicated

Item 4 stood in CLAUDE.md for 20 days. **Every quantitative claim in it has now failed**, and the
conclusion it drew points the wrong way.

### The original argument, and what it costs

> The AI DJ crossfades → crossfade removes constant seconds → a proportional threshold penalises
> short tracks → majors run ~30% longer → independents take more false skips → **so correcting it
> could only move the result toward R1, never further away.**

That last clause was load-bearing. It appeared in CLAUDE.md, `aidlc-state.md` and the
**hypothesis-gate result document**, where it functioned as a reason not to worry about the
confound.

### Re-measured on 586 plays

| Claim (2026-09-02) | Sample then | Measured 2026-09-22 | Verdict |
|---|---|---|---|
| Crossfade is the mechanism | — | Affected plays lose **21–41 s**; Spotify caps crossfade at **12 s** | ❌ ruled out |
| Majors ~30% longer: 248 s vs 191 s | n=10/11 | **213 s vs 201 s** (n=120/162) — a **6%** gap | ❌ dissolved |
| 13 of 27 crowd the threshold (48%) | n=27 | **52 of 443** (**11.7%**) | ❌ dissolved |
| Correction moves the result **toward** R1 | — | Removes proportionally more from **majors** | ❌ backwards |

### ⚠️ The direction is the important one

The affected plays now carry `skip_attribution = 'unattributed'` (migration 006), so the question
can be asked directly instead of inferred:

| Group | eligible | all skips | user-attributed only | unattributed share of skips |
|---|---|---|---|---|
| `major` | 111 | 9 (8.1%) | **3 (2.7%)** | **6/9 = 67%** |
| `independent` | 158 | 12 (7.6%) | **6 (3.8%)** | 6/12 = 50% |
| `unknown` | 211 | 19 (9.0%) | 11 (5.2%) | 8/19 = 42% |

Correcting removes a **larger share** from the major arm, and the sign of the difference flips:
all skips put `major` above `independent`; user-attributed skips put it below.

⚠️ **EXPLORATORY AND NOISE-DOMINATED.** Three versus six events, computed *after* the data was
seen. **BR-11.7 spent the single confirmatory evaluation on 2026-09-10** and nothing here re-opens
it. This is grounds for **withdrawing the old claim and nothing else** — it is emphatically not
evidence against R1, and treating it as such would be the same error in the opposite direction.

⚠️ **The real consequence is to the instrument.** Roughly half the gate's skips are now known not
to be rejections, which weakens the outcome variable in **both** arms rather than shifting it one
way. A future evaluation must decide **in advance and in writing** whether `unattributed` skips
are eligible.

### The pattern worth carrying forward

⚠️ **Item 4 flagged its own weakness and was believed anyway.** It said, in its own text,
*"n=10/11, so the duration gap may be chance"* — and that caveat travelled with the number into
three documents while the number was read as fact.

**A measurement written into prose stops being a measurement and becomes a claim.** Nothing
re-derives it, and the sample it came from is invisible at the point of reading. The same shape as
the `release_count = 100` bug and the stale `recently-played` note: *a plausible number, recorded
once, believed indefinitely.*

`scripts/measure-confound.mjs` now re-derives all four on demand and prints the original claim
beside each current figure, so the comparison is unavoidable rather than optional.

⚠️ Writing that script surfaced a small instance of the same family: its quantile helper indexed
one past the end and reported `max 0.0s` — **a plausible wrong number rather than an error**. Fixed
and noted in place.

### Applied

- **CLAUDE.md** open item 4 — rewritten; the gate section's copy of the direction claim corrected.
- **`aidlc-state.md`** — the same claim marked withdrawn.
- **`gate-result-2026-09-10.md`** — ⚠️ an **addendum appended, the original untouched**. It records
  a confirmatory evaluation, and editing a result after the fact is what pre-registration exists
  to prevent.
- **`u4-rule-observability/HANDOFF.md`** — item 4 no longer described as "the crossfade confound".

**Context**: CONSTRUCTION — U4 complete, deployed and verified. 866 tests, schema v6, 591 plays.

---

## 2026-09-22 — U4 closed out: Build and Test complete, U5 handoff written

**Stage**: CONSTRUCTION — U4 Build and Test. **U4 is complete, deployed and verified.**

### All three exit criteria CI could not close are closed

| Criterion | Result |
|---|---|
| Dry-run agreement | ✅ 65 decisions, 195 rows, 37 matches, over a full day. The user read it and agreed |
| `partialData` rate | ✅ **0 of 65**. Median settle 4.1 s, p90 7.2 s, **max 9.0 s** |
| BR-20.8 last-known-good | ✅ **Run for the first time since U3 specified it** |

⚠️ **The agreement gate did more than pass** — reading the log is what exposed the `skip_source`
defect. That is the argument for the gate existing at all, and no test could have substituted.

### ⚠️ `ENRICHMENT_WAIT_MS` is correct but NOT generous

Max observed settle is **9.0 s** against a 10 s cap — 1.0 s of headroom.

An earlier reading of the *same measurement* showed max 6.9 s and suggested 7–8 s was safe. A few
hours more listening produced 9.0 s. **The tail moved and the median did not.** Recorded because
the earlier advice is in this log and would otherwise be followed.

### 866 tests, 99.39% line / 93.27% branch

⚠️ Function coverage fell 97.53% → 95.82%. Not a regression in what is tested: U4 adds impure
wiring with defensive branches, where U3 added pure functions exercised exhaustively.

`RuleSetWatcher` is the lowest-covered module at 93.42%, knowingly — its uncovered lines are the
polling timer's callback, and **a unit test of that timer proves nothing about the only place it
runs**. Verified live twice instead.

### Five defects, four invisible to the suite

1. `skip_source = 'user'` asserted rather than observed — found by the **user**, not a test.
2. `trackPlayStats` re-implementing `bucketOf`, so the fix reached the chart and not the panel.
3. `history.db` corrupted by a maintenance script run against the live container.
4. Open item 4's four numbers, all n≈10, none replicating.
5. The `explicit`/`album_type` write path missing from every scope table — caught by `tsc`.

### U5 handoff written

`construction/u5-automated-skipping/HANDOFF.md`. ⚠️ **Its first item is the one that matters**:
`BackTestService` counts every `skipped` row regardless of attribution, and skips are now **22
user / 21 unattributed**. U5 arms rules on those agreement numbers, so it must decide **in
writing** whether an `unattributed` skip counts as agreement. Inheriting the current behaviour
silently means arming rules against a target that is half noise.

**Context**: CONSTRUCTION — **U4 COMPLETE**, awaiting user approval. U5 next. 866 tests, schema
v6, 613 plays, `integrity_check: ok`, `src/playback/` absent.

## 2026-09-22 — R11 probed; the outcome variable was WRONG, not noisy; classifier v2

**Stage**: CONSTRUCTION — start of U5. R11 discharged. A correctness defect in U1's classifier
found, fixed, and applied retroactively to the corpus **before** U5 design begins.

### R11 is discharged, with an answer neither branch of the execution plan anticipated

`GET /me/player/queue` during active playback **depends on the playback context**:

| Context | `context.type` | Queue depth | `queue[0]` predicts next |
|---|---|---|---|
| AI DJ | `playlist` | **0** on all 88 samples | n/a |
| Album | `album` | 7–20 | **4/4** |
| Autoplay continuation | `album` (stale) | 20 | 8 tracks in exact order |
| Spotify radio station | `playlist` | 20, never depleting | — |

⚠️ **The album run is the positive control, and without it the DJ result is unusable** — an empty
queue alone is equally consistent with Development Mode, a missing scope or a malformed request.
Same credentials, same endpoint, minutes apart, 10 vs 0. The DJ run's own `currently_playing`
field was populated with the correct track while `queue` was `[]`.

🔑 **`context.type` cannot predict lookahead.** The DJ and a radio station are both
`type: playlist` with the same `37i9dQZF1E` prefix and give opposite answers. Nor is "algorithmic"
the discriminator — autoplay and radio are algorithmic and fully exposed. **Only the DJ hides its
queue.** FR-36 must therefore ask the queue at runtime; hardcoding the DJ URI would be a recorded
negative that decays silently.

⚠️ **`context.uri` goes stale.** The album ran to exhaustion and autoplay continued for 33 minutes
while `context.uri` still reported the album, playing four artists who are not on it. Open item 7's
`context_type` is necessary but **not sufficient** for a rule input.

⚠️ At 50–70% DJ listening, FR-34/35 is the **majority path**, not the fallback `requirements.md`
describes. Full record: `construction/u5-automated-skipping/probes/r11-queue-lookahead-2026-09-22.md`.

### The probe found something bigger: 24 of 46 live skips were not skips

Three of four DJ transitions were recorded `skipped` while the listener was demonstrably not
touching playback — and reported hearing every track finish. The stored data agrees: the same
tracks reach 99–100% on other days, so `duration_ms` is not overstated.

Reconstructed from retained trails (FR-20), a play's *first* observed progress shows how far the
successor had already run:

| A closed as | n | A's unplayed remainder | B's head start | B already >2s in |
|---|---|---|---|---|
| `completed` | 455 | 2.0s | 2.0s | 38% |
| `user` skip | 22 | 145.0s | **2.0s** | **27%** |
| `unattributed` | 24 | 24.0s | **7.0s** | **75%** |

Opposite shapes. **The audio does not stop; the reporting does.** Confirmed by a natural
experiment across one afternoon, global settings unchanged:

| Mode | plays | skipped | unattributed | shortfall median |
|---|---|---|---|---|
| **AI DJ** | 12 | 3 | **3** | **17.0s** |
| Album / autoplay | 20 | 0 | **0** | 1.0s |
| Radio | 16 | 0 | **0** | 2.0s |

⚠️ **Crossfade is OFF on this machine**, Automix is on globally and produces no overlap on album or
radio. So open item 4's *"crossfade is ruled out because Spotify caps it at 12 s"* failed twice
over: the inference assumed cut length equals crossfade length, **and the feature was disabled**. A
UI fact used as a probe result.

### Classifier v2 — the fix is in the outcome, on the axis the mechanism lives on

⚠️ **A RATIO CANNOT WORK HERE, AND THIS IS THE PROJECT'S OWN DOCUMENTED CONFOUND.** The effect
removes a near-constant number of seconds; a ratio divides by duration. `ratio < 0.75` whenever
`duration < 4 x tail`, so at a 41 s tail every track under 164 s is misfiled — and the corpus's p10
duration is 146 s. `Mascara` is the proof: 136 s, 35 s tail, ratio 0.743, filed as a user skip
purely for being short.

So the threshold is **milliseconds of unobserved tail**, `durationMs - maxProgressMs`:

- `maxUnobservedTailMs = 55 000` — the observed populations have an **empty band**: overlap closes
  run 18–41 s, user skips 66 s+ (plus `Mascara` at 35 s). Any value in 42 000–65 000 partitions the
  corpus identically; 55 000 weights the margin toward the tail side, whose upper end is unknown.
- `minObservedPositionRatio = 0.75` — a rail, not a discriminator. **Raised from a proposed 0.50
  after the test suite caught it**: 0.50 would have accepted any track under 110 s abandoned at its
  midpoint, fabricating completions from genuine skips. Both rails capture all 24 measured rows.

⚠️ Chosen **after** seeing the distribution, therefore **not pre-registered**. If plays appear in
the 41–66 s band the question reopens rather than the number moving.

⚠️ `USER_SKIP_RATIO_CEILING`'s own empty band **stopped being empty**, exactly as its comment
warned: `Mascara` at 0.7426 landed in the documented 0.489–0.807 gap.

**Result**: 24 of 576 live rows re-derived `skipped` -> `completed`; **552 re-derived identical**.
Live skips **46 -> 22**. Backups plus a `changes.json` manifest and a 17-column pre-change CSV
snapshot. `integrity_check: ok`, 662 rows and 36 404 observations intact.

⚠️ **`Mascara` is knowingly left as `skipped`** — its tail is inside the overlap range but its
position is below the rail. The single ambiguous row. Leaving one over-counted skip is recoverable
from the trail; inventing a completion is not.

### `skip_attribution` retired — v2 subsumes it, and they contradicted each other

The two rules answered the same question on different axes and could disagree: a 5:00 track skipped
at 4:00 has a 60 s tail (v2: `skipped`, a rejection) and a 0.80 ratio (attribution:
`unattributed`, not one). **Zero rows were in that state, but 31% of the corpus's tracks are long
enough to reach it.** The statistics panel routes on attribution and `BackTestService` counts every
`skipped` row regardless — display and back-test would have disagreed about the same row, silently.

User decision: rely on v2 for user skips; rule skips are a separate question. So:

- `attributeSkip`, `USER_SKIP_RATIO_CEILING`, `LATE_SUCCESSOR_MS`, `ATTRIBUTION_VERSION` and
  `updateSkipAttribution` are gone. `skipAttribution.ts` is kept as a **tombstone** carrying the
  2026-09-21 history — the same reason `skip_source` was kept when it proved to be an assertion.
- Columns **nulled (22 rows), not dropped**. Migration 004 dropped columns for a comparable
  removal, but dropping these breaks the by-image rollback guarantee the U4 handoff depends on.
  Nulling is rollback-safe *and* correct under old code: the pre-v2 `bucketOf` maps a null
  attribution to `skipped`, and after v2 every remaining skip is one.
- `ended-early` display bucket removed from `playStats`, the repository, `TrackPlayStats` and the UI.
- `scripts/attribute-skips.mjs` **deleted** — it carried a second copy of
  `USER_SKIP_RATIO_CEILING` and would re-derive the retired judgement.
- `scripts/measure-confound.mjs` now **refuses to run** rather than returning zeros from a nulled
  column, which would have read as "the confound disappeared".

✅ **U5 handoff item 1 is CLOSED, not inherited.** `BackTestService` needed no change — it reads
`outcome` and never read attribution, so fixing the outcome fixed it for free. `skip_source`
(`user` | `rule`) is untouched and is still what U5 needs.

### Two dead writers, both invisible to the suite

`recordSuccessorLag` and `updateSkipAttribution` had **zero callers for their entire lives**, and
`successor_lag_ms` is null on all 662 rows. Both were built for `attribute-skips.mjs`, which then
re-implemented the rule in its own SQL instead of calling either. ⚠️ `noOrphanModules.test.ts`
cannot catch this: **it walks modules, not methods.** `recordSuccessorLag` is still worth wiring —
the 2026-09-22 measurement had to reconstruct it from trails.

### Other things worth recording

- **U1 FD Q6's short-track limitation is CLOSED**, as a side effect. A short track played in full
  has a tail of about one poll interval, so poll alignment no longer changes its verdict. The tests
  that pinned the limitation now pin its absence, under the original heading.
- **P-7 was retired and narrowed.** "Never reaching the threshold is never a completion" is no
  longer true; the property now asserts that below the threshold, `completed` requires the tail
  rule — so there is still exactly one way in.
- ⚠️ **The gate's inputs were wrong.** The 2026-09-10 confirmatory run's eligibility predicate is
  `outcome IN ('completed','skipped')`, so those 24 rows entered it as skips. Roughly 12 of its 17
  skips were affected. **BR-11.7 still forbids a re-run**; this is recorded as a defect in the
  discharged result, not grounds for another attempt.
- **Pause tracking**: user decision — the *cause* of a pause is not tracked, only that one occurred
  and that listened time excludes it. Verified correct on a real 3-minute external pause (204 s
  listened against 362 s of wall clock).
- ⚠️ **My own write guard was wrong and was fixed rather than overridden.** It checked for
  `history.db-wal`, but any *read-only* open recreates that file, so it fired on the normal case. It
  now takes a real `BEGIN EXCLUSIVE` lock. A guard that cries wolf gets habitually bypassed.
- ⚠️ **The piped-exit-code trap bit again**: `npm run typecheck | tail && echo OK` reported success
  while typecheck was failing. CLAUDE.md documents this for `docker compose build`; it applies to
  every pipe.

**Context**: 851 tests, typecheck clean, schema **v6** (no migration needed), 662 plays, container
rebuilt and verified — UI `200`, WS same-origin `101`, WS cross-site `403`, `integrity_check: ok`.
**R11 discharged. U5 Functional Design is the next step.**

---

## 2026-09-23 — Artist credit: a false alarm, a real reporting defect, and a new API trap

**User observation**: in `Inpatient, Ren, Chris Webby`, `Inpatient` looked like the *track* name
sitting in the artist slot — suspected to be an album mis-set-up in Spotify.

### The premise was wrong, and probing is what showed it

Reasoned from the display it is a plausible reading. It does not survive a probe:

- `GET /artists/5Qqx3JIJnK5mtk7U4tC4Vb` -> **200**, `name: "Inpatient"`, own `uri` and `images`.
- It is `artists[0]` on **all 15 tracks** of the album **Asylum** (2026-07-22) *and* on the album.
- The album is `Asylum`; `Asylum` is **track 6**. **There is no track called `Inpatient`.**
- `GET /artists/5Qqx.../albums` -> **10 releases, every one `Inpatient | Ren | Chris Webby`.**

So `Inpatient` is a **project alias** — the name Ren and Chris Webby release under — and that is
verified from the discography, not inferred from the credit pattern. **Spotify is right, the album
is set up correctly, and the comma-split is exact here.** ⚠️ Do not "fix" the splitter on the
strength of this example; the example is not a defect.

### But it exposed one: aliases rank as independent artists

`artist_credit_totals` has no notion of an alias, so a duo entity is counted beside its own
members. Two of the top 13 rows are aliases of other rows in the same table — `Inpatient` at rank 8
(24 plays, = Ren + Chris Webby) and `Macklemore & Ryan Lewis` at rank 12 (17 plays; Ryan Lewis's
entire 17 are the duo's tracks).

⚠️ **This is NOT the by-design overcount.** `SUM(artist_plays) > play count` is correct — a
collaboration counts for each *real* collaborator, and a test pins it. This is a single credit
denoting a **set of the other credits on the same row**, which is a different thing.

⚠️ **The structural detector is not trustworthy enough to automate.** "Always lead, identical
co-credit set, >= 2 tracks" returns 4 candidates and **3 are false positives** (`Rudimental`,
`Petravita`, `Dal Av` — real bands with fixed collaborators at this sample size). A flag for
review, never a rule.

### The larger, prospective risk: `", "` inside an artist name

`parseNowPlaying.ts:108` reads `artist: field(raw, 'Artist')` — the MCP `getNowPlaying` returns a
**pre-joined string**, and the live path has **no `artists[]` array at any point**. Splitting on
`', '` is the only signal available, not a shortcut that could be removed. `Tyler, The Creator`,
`Earth, Wind & Fire` and `Crosby, Stills & Nash` would each silently become two artists.

⚠️ **A wrong split is indistinguishable from a right one once stored** — a split record knows only
the lead's id, so **93 of 234** credited names carry no id at all. Same family as the
`inc=releases` 200: plausible wrong data rather than a loud failure. **Zero instances in the corpus
at 2026-09-23** — all six `The ...` fragments present are real bands in lead position, checked
individually. The risk is prospective, which is precisely why it is written down now.

### ⚠️ NEW API TRAP — `GET /artists/{id}/albums` rejects `limit > 10`

`limit=10` -> **200**. `limit=20` -> **400 `{"error":{"status":400,"message":"Invalid limit"}}`**.
`limit=50` (the documented maximum) -> **400**. Also `album_group` is **absent** from the items,
the same shape as `genres` missing from `GET /artists/{id}`.

⚠️ **The message is the trap**: "Invalid limit" reads as a malformed request, so it sends you
checking your own query string rather than suspecting Development Mode. Same family as the
`/contains` and `GET /tracks?ids=` findings — the restriction is real, the error does not name it.

### Decision (user, 2026-09-23): note it, do not build it

Recorded as wishlist **W-4**. Two future mechanisms named, not mutually exclusive:

1. **A manual alias tag** — an authored mapping; cheap, exact, auditable.
2. **A GenAI resolver** — the user's point being that "is `Earth, Wind and Fire` one band or
   three?" is answerable by a language model and **not answerable by a parser at all**, because the
   information is not in the string. ⚠️ It must write a **suggestion for review, never a fact**, as
   a third provenance beside `split-live-credit` and `spotify-track`.

Authoritative fallback if neither is wanted: `GET /tracks/{id}` carries the true `artists[]`, at
**119 requests** for the split-derived multi-artist tracks — `GET /tracks?ids=` is 403.

**Interim posture: mark, do not merge.** Folding an alias's plays into its members would destroy
the fact that the user played the duo's record.

**Nothing was changed.** `history.db` untouched, reporting DB untouched, no code change, no
migration. The defect is confined to the derived reporting database and is **not** a rule input or
a gate input; `artist_id` remains the lead artist throughout the app.

**Next**: U5 Functional Design.

---

## 2026-09-26 — A stated reason was false, and it had propagated to six places

**Found while pushing.** `.gitignore` justified ignoring `config/` with *"this repository is
public"*. `gh repo view` says `"visibility": "PRIVATE"`.

### The decisions were right; only the reason was wrong

Nothing leaked and nothing needed re-deciding. `secrets/`, `data/` and `config/` are all correctly
ignored, and only the three `*.example.json` templates are tracked. **Every affected decision
stands on a better reason than the one recorded**: a personal contact address and user-authored
rules are *the user's data rather than project configuration*, and `compose.yaml` is *tracked in
git*. Neither depends on the repository's visibility, so neither changes if that visibility does.

### ⚠️ The propagation is the finding, not the error

One unverified assertion became the stated basis for a decision in three documents:

```
compose.yaml            asserted "the repository is public"
  -> u3-infrastructure-design-plan.md  cited compose.yaml AS THE AUTHORITY, verbatim
     -> the Q4 decision on tracking config/rules.json rested on it
u2 .../infrastructure-design.md        asserted it independently
.gitignore, README.md, u3-rule-model   repeated it
```

Nobody checked it, because it had a citation. ⚠️ **A claim with a source inside the repo reads as
verified, and a repo is not a source for a fact about itself.** Same family as open item 3a — *our
own notes said no, and the probe says yes* — and it is the **second** instance, so the pattern is
now confirmed rather than anecdotal: **a recorded premise decays silently, because nothing ever
re-tests it.** The first instance was an API note. This one was a fact about our own infrastructure,
which is if anything easier to check and was checked less.

⚠️ It is also the **divergent-copies** shape that caused the `localGuard` `403`: the same statement
written in six places, where correcting one and leaving five is the likely half-fix.

### What changed

- **Live files corrected** — `.gitignore`, `compose.yaml`, `README.md`. Each now gives the reason
  that holds (tracked-in-git / user data) and records what the old one said and why it was wrong.
- **Design documents marked, not rewritten** — `u3-infrastructure-design-plan.md`,
  `u2-label-enrichment/infrastructure-design.md`, `u3-rule-model/infrastructure-design.md` carry a
  ⚠️ **CORRECTED 2026-09-26** note above the original text. They are records of decisions taken;
  the decisions did not change, so the prose stays and the premise is annotated.
- `docker compose config --quiet` -> exit 0. Comments only; no code, no schema, no behaviour.

**Do not "fix" this by making the repository public.** The reason was wrong; the posture was right.

---

## 2026-09-26 — Two "read this first" files in one directory; consolidated to one

**User raised it**: `u5-automated-skipping/` held both `HANDOFF.md` and `RESUME-HERE.md`, and asked
whether `HANDOFF.md` could be removed.

### ⚠️ The disposable file was the NEW one, not the old one

`HANDOFF.md` is the AI-DLC process deliverable — **U4 has one too** — and is referenced from
`aidlc-state.md`, `audit.md` (an append-only entry) and `u4-code-generation-plan.md`.
`RESUME-HERE.md` was invented in the 2026-09-23 session and referenced from nothing but the two
pointers that session wrote.

**Deleting `HANDOFF.md` would have lost content that exists nowhere else** — checked by grep across
all three U5 documents before touching anything:

| Only in `HANDOFF.md` | |
|---|---|
| `fs.watch` over the bind mount | **Dead** — 0 events in 12 s. *Do not retry it* |
| `partialData` rate | 0 of 65 |
| Blind spot | Plays ending before the cap log nothing: 2.8% of plays, 4 of 31 skips |
| `FactCache` (LC-12, P-16) | Closed as superseded by U4; **U5 re-opens it** |
| `DecisionLogRepository` | 195 rows, retention capped at 100,000, pruner fenced |

Several are explicit *"do not re-derive this"* measurements. ⚠️ **The newer file looked more
current, which is exactly why it was the more dangerous one to trust** — recency is not authority.

### What changed

- **`HANDOFF.md` is now U5's single entry point.** A `▶ CURRENT STATE AND NEXT STEP` block was
  added at the top: the pause, probe P-U5-1 and why it gates FR-46, and open item 7.
- ⚠️ **Its item 1 was STALE AND FIRST.** It opened *"The outcome variable is half noise — this is
  the most important thing on the page"*, which classifier v2 closed **hours after the handoff was
  written**. Marked ✅ CLOSED in place with the correction above it and the original text kept
  below, per the convention used elsewhere. A wrong statement that announces itself as the most
  important thing on the page is the worst possible thing to leave stale.
- **The P-U5-1 protocol moved into the design plan §3**, beside the hazard it tests.
- **`RESUME-HERE.md` deleted.** Recoverable at `73e3ce0`; nothing referenced it after the two
  pointers in `aidlc-state.md` and `CLAUDE.md` were repointed. Verified by grep.

### The rule going forward

**One entry point per unit: `<unit>/HANDOFF.md`.** A session pausing mid-unit updates the top of it
rather than adding a parallel file. ⚠️ **Before deleting any document, grep for inbound references
and for content that exists nowhere else** — the obvious-looking duplicate is not always the
disposable one.


---

## 2026-09-26 — U5's nine design questions answered, and three stale statements found in the handoff

**Stage**: CONSTRUCTION · U5 Functional Design. **Documents only.** `src/` untouched, no migration,
container healthy throughout.

### The answers, and the three that changed the design

All nine answered. §5.1 of the design plan is now the authoritative reading; §5 keeps the user's own
words with a ⚙ note where a clarification changed something. Six were accepted as recommended
(Q1 dry-run-as-gate, Q2 depth-3 pre-warm, Q3 asymmetric re-evaluation, Q4 hold deadline, Q5 kill
switch, Q9 record `context_type`). Three moved:

**Q6 — the runaway halt is a THIRD latch, not the kill switch.** The recommendation was (b) **+** (c);
the user chose **(c) only**, scope **global**: *tripping the halt indicates something isn't working
right, and the user should review*. ⚠️ Declining (b) has a design consequence that had to be written
down rather than inferred: the halt **must not** be implemented by flipping the FR-38 kill switch,
because that makes the system's own halt indistinguishable from a choice the user made, and clearing
it would read as *re-arming* rather than *acknowledging*. Two independent latches; automation is live
only when neither is set. Both persist, both fail closed.

**Q7 — FR-40 declined as written, and the guard re-keyed onto the PLAY ROW.** Two things were tangled
in one `Must`. The user rejected *"never skip the same track twice within one session"* on the
grounds that if the rules match a track, it should be skipped — **the same reasoning that forbids
clamping `completionRatio` to 1.0**: a recurring track is a real listening signal. That correctly
kills the recommended *(A)+(D)* (one attempt per `track_id` per process), which would have refused a
genuine repeat listen permanently. But `requirements.md` says FR-40 exists for a *different* failure:
*"a skip does not take effect and the engine re-evaluates the same track forever."* Against a 3 s poll
that is an unbounded `POST /me/player/next` stream.

✅ **Keying the cap on the PLAY ROW rather than the `track_id` satisfies both, and needs no session
definition at all** — which is what made the original question hard. A repeat listen is a new row, so
it stays skippable; a skip that did not land cannot re-fire against the same row. ⚠️ §3's hazard makes
an ineffective skip **more** likely, not less, and Q8 establishes the obvious confirmation cannot
reliably detect it — so the row-keyed cap is the backstop that holds regardless of how P-U5-1
resolves.

**Q8 — clarified, and the clarification does NOT retire the probe.** The user was not proposing new
instrumentation, but that *at some point we review the monitor data for the occurrence of this issue*.
Three separate consequences: (a) FR-48's confirmation is still **built** — it is a `Must`, and it is
one read on a path already reading player state; (b) the skip path must **record what it saw** —
reported track id and `progress_ms` before *and* after the `POST` — or the later review has nothing
to review, which is `successor_lag_ms` again: a column nothing wrote, so the mechanism it existed to
measure had to be reconstructed from trails; and (c) ⚠️ **the review cannot substitute for P-U5-1**,
because §3 establishes that the log's own signal is the suspect one. In the DJ context the reported
track already changed 18–41 s before the audible one, so a logged *"different track reported now"*
reads as success when nothing audible happened. **Measuring the suspect effect with the suspect
instrument returns a plausible answer that means nothing** — the `inc=releases` 200 and
`measure-confound.mjs` zeros, a third time. The costs are asymmetric: the probe is 4–6 read-mostly
trials with the user's ear; the review pays for its evidence in real truncations of tracks the
listener was enjoying, in the context used 50–70% of the time.

### ⚠️ Q4's colour cue collides with a colour scheme that already exists

The user asked for the hold/evaluation state to show as colour on the `Rules v#` indicator rather
than more text on the primary screen — explicitly *not dictating the solution*. **Checked the code
before designing to it, and all four `IndicatorLevel` values are already allocated** in
`rulesIndicator` (`src/ui/statusBar.ts`) to **rules-file load health**: `unknown` = not running or
nothing loaded, `warn` = reloading, `fail` = a newer file was **rejected**, `ok` = applied. Its
docstring pins why: **red names the version still in force (FQ5)**, because a light that only says
*"something failed"* leaves exactly the ambiguity the indicator exists to remove, and a silent
last-known-good is indistinguishable from a successful reload.

Recolouring it would make **red ambiguous between *your rules file is broken* and *a rule matched and
the skip failed*** — two independent variables on one light, destroying the distinction it was built
to carry. ✅ **Resolved as a second, adjacent compact indicator**, which still meets the stated goal
of no added prose. ⚠️ The user's six states exceed the four `IndicatorLevel` members, so the union
widens — it has no `default:`, so the compiler names every site that must change, the same deliberate
pattern as `applyOnUnknown`.

### ⚠️ Three stale statements in `HANDOFF.md`, all saying R11 had never been probed

R11 was discharged **2026-09-22**. `CLAUDE.md` open item 5 is ✅, `aidlc-state.md` records it, the
probe record exists, and the design plan's Q2 opens *"R11 is discharged"*. `HANDOFF.md` nonetheless
still said, in two places, that it *"has never been probed while music is playing"* — **one of them
under the heading *The rule that has not changed***, which is the sharpest possible place for a stale
claim to stand. It also said *five* wrong conclusions where `CLAUDE.md` now lists **six**. All three
corrected in place with the correction visible.

⚠️ **`ec73798` fixed this same file's item 1 for exactly this reason, four days ago, and left R11
stale two sections further down in the same pass.** The lesson is narrower than *documents go stale*:
**a correction pass that fixes the one stale statement it was looking for, and does not re-check the
rest of the file against current state, leaves the file still wrong while appearing freshly
reviewed** — and dated *Updated 2026-09-26*, which reads as authority. Recency is not authority; that
is the rule `ec73798` itself recorded, applied to its own output.

### ✅ `requirements.md` amended — held for sign-off, then approved the same day

Two items needed amending in an **approved inception deliverable**, so they were **not** applied
unilaterally; they were recorded as §5.2 of the design plan and put to the user, who approved both.

**FR-40** now reads *"a failed skip must not loop — at most one skip attempt per play"*, with the
withdrawal reasoned in place. ⚠️ The note records that the session clause was **wrong, not merely
unnecessary** — suppressing a skip because the same `track_id` was attempted earlier would refuse a
rule the user authored, for a track they chose to hear again, which is the `completionRatio` clamp
mistake in another costume. It also records the clause's **hidden cost**: it silently required a
*"session"* entity the corpus has never modelled, and the amended guard needs none.

**R11's caveats discharged** in §FR-36 (struck through, with the context-dependent result and the
runtime-query consequence in place) and in the R11 risk row.

⚠️ **Applying them made FOUR OTHER PLACES stale in the same breath** — `CLAUDE.md`, `aidlc-state.md`
(twice: the current-state block **and** a second R11 row in its own *Known Risks* table) and the plan's
own Q7 note all said *"awaits sign-off"* or *"still reads"*. Caught by re-grepping for the old strings
**after** editing rather than before. **That is the discipline item 3 above is about, applied
immediately to this session's own output**: the second `aidlc-state.md` row would have been missed by
anyone grepping only the section they had just edited.

### Next step

**Probe P-U5-1**, protocol in the design plan §3. It gates **FR-46 and FR-48** and is now the only
thing blocking the FD documents. It needs the user present and listening — no endpoint reports what
it measures.


---

## 2026-09-26 (later) — P-U5-1 does not need the container, and W-5 is opened

**Stage**: CONSTRUCTION · U5 Functional Design. **Documents only.**

### ⚠️ The probe protocol would have contaminated the corpus, and the plan said it was safe

§3 of the U5 plan said *"the container may stay up. This probe does not write to `history.db`."*
**That was inherited from R11 and is wrong for this probe.** R11 only **read**, so the container was
irrelevant to it. P-U5-1 **writes to the player**, and the container is recording, so it writes down
the consequences.

Each trial POSTs `next` about 0–3 s into track B. `PlayObserver` closes that play on `track-change`
at near-zero progress, and in `outcomeClassifier.ts` **both v2 conditions fail** — `unobservedTailMs`
is nearly the whole duration against the 55 s cap, `observedPositionRatio` is ~0.01 against the 0.75
rail — so it records **`skipped`**, `skip_source = 'user'`.

⚠️ **4–6 trials inject 4–6 artefact skips into a corpus of 22** — up to **27% contamination of the
entire evidence base Q1 depends on**, and `BackTestService` counts every `skipped` row. **The same
defect class classifier v2 had just spent a day removing.** A protocol that reassures the reader about
the hazard it does not have is worse than one that says nothing.

✅ **Resolved without new code: `docker compose down` for the duration.** The probe needs no container
— `webApiClient.ts` documents that token handling **deliberately never writes back** to
`spotify-config.json` (the MCP server rewrites it on its own schedule, and two writers would clobber
each other's refresh token), and Spotify's refresh tokens are long-lived and reusable. So a host-side
script reads the credential file, holds its access token in memory, and cannot race the container. The
music comes from Spotify, not from this app. Cost: ~15 minutes of unrecorded listening.

### The user proposed a swap-in test database; rejected for this, and it opened a real gap

**Proposal (user, 2026-09-26)**: back up the live database, stand up a temporary test database for the
probe, restore afterwards, accepting the loss of activity during the test.

**Rejected for this probe**, for two reasons and neither is the idea's merit:

1. It keeps a writer running against a database to be discarded, then restores the real one while the
   engine may still hold it open. ⚠️ **That is the shape of the U4 incident** — which reported
   `integrity_check: ok` at the time and surfaced later as a just-written value reading `null`.
2. ⚠️ **It is not one file.** `history.db-wal` is **currently 4.1 MB against a 3.3 MB `history.db`**
   — the write-ahead log is **larger than the database it belongs to**. A swap that does not
   checkpoint first moves **less than half the corpus**, and the result opens cleanly and looks
   plausible. The absent-data trap, in the one artefact that comes back from nowhere.

**An untested restore path is more risk than the fifteen-minute window it protects.**

### ✅ But the instinct was right, and the gap is worse than it looked — W-5 opened

The user extended the proposal to a general facility: *"We eventually need a way to FULLY back up all
the user specific information (configuration, data, etc…) and restore it."* Recorded as **W-5** in
`requirements.md` §5.1, with the inventory taken rather than guessed. Three findings from taking it:

⚠️ **`data/` already holds TEN backups in FIVE naming conventions**, written by three different
scripts, plus `CORRUPT-snapshot-20260921-201444` and `history-rebuilt.db` left from the U4 incident.
Nothing records which is good, what schema version each holds, or how to restore one. **The ad-hoc
approach has already failed; the pile is the evidence.**

⚠️ **RESTORE HAS NEVER BEEN WRITTEN.** Every one of those scripts backs up; **not one reads a backup
back.** A backup that has never been restored is a hypothesis, not a backup — the standing this
project gives anything unprobed. The half nobody built is the half needed under pressure.

⚠️ **`metabase-app-db` is a named Docker volume in a DIFFERENT compose project** (`reporting/`),
holding the dashboards and questions built over the Metabase API in `b299bf7`. It is **not** a bind
mount, so it appears nowhere in `data/` and **any backup that walks the project tree would silently
miss it.** Restoring it needs `docker run --rm -v metabase-app-db:/v …` tar work — a different
mechanism from copying a file.

**Surfaced, not decided — the `secrets/` question.** `secrets/spotify-config.json` is mounted **`rw`**
and holds a long-lived reusable refresh token. Including it puts live plaintext credentials in an
archive whose purpose is to be copied somewhere else; excluding it is safe precisely because
credentials are the **only** category that is recoverable without a backup (`npm run auth`). Per the
project's standing rule, this is put to the user rather than answered. ⚠️ It must be settled **before
the first archive is written** — changing your mind later means the existing archives are already the
thing you decided against.

### Sequencing

W-5 is the full-inventory version and is deferred. ⚠️ **Its near-term slice is not**: a minimal
`history.db` backup **and restore** — WAL checkpointed, refusing to run against a live writer, and
**with the restore actually verified** — is now a §4 checklist entry as a **migration 007
prerequisite**. `CLAUDE.md` records that the U4 incident was *"a detour rather than a loss"* **only
because a backup happened to exist**; migration 007 should not depend on that happening again.


---

## 2026-09-26 (later still) — U5 Functional Design written, except the two things the probe gates

**Stage**: CONSTRUCTION · U5 Functional Design. **Documents only.** `src/` untouched, no migration.

Four documents in `construction/u5-automated-skipping/functional-design/`: `business-rules.md`
(**BR-33 … BR-43**, continuing from U4's BR-32.4), `domain-entities.md`, `business-logic-model.md`,
`frontend-components.md`.

⚠️ **BR-43 is deliberately empty of specification.** FR-46's action point and FR-48's confirmation
depend on probe P-U5-1 and are recorded as unspecified rather than guessed past. What *is* specified
there is only what holds either way: an unconfirmed skip is **failed, surfaced, never retried**; the
before/after evidence fields; and BR-36's one-attempt-per-play backstop.

### ⚠️ Three things the FD found in the CODE, not in the requirements

**1. `DecisionExecutor.execute` is SYNCHRONOUS, and U5's action is not.** `execute` returns `string`,
not `Promise<string>` (`LoggingExecutor.ts:31`), and `EvaluationCoordinator` calls it **unawaited**
(`EvaluationCoordinator.ts:228`). An HTTP `POST` cannot live there. **The contract as it stands cannot
express U5's action at all.**

Resolved by **BR-42**: `SkipExecutor.execute` writes the decision rows and **enqueues a `SkipAttempt`**;
a separate asynchronous path drains it. Making `execute` async was the obvious move and was rejected
for three reasons, the third being the one that matters:

- It changes `LoggingExecutor`'s signature to serve a collaborator it does not have — exactly what
  **BR-30** exists to prevent (*added alongside, never grown out of*).
- An unawaited promise inside a **timer** is how a swallowed rejection becomes a skip that silently
  never happened.
- ⚠️ **It would put the safety check in the wrong place.** An awaited `execute` checks the kill switch
  where the *decision* is taken — but a decision is taken up to 10 s before anything could act on it,
  and FR-38 requires that **no skip is issued after the switch is thrown**. Queueing makes the action
  point the only place the check can live.

✅ The queue also makes Q3's *"re-evaluation may cancel a pending skip"* implementable rather than
aspirational: there is a pending entry to cancel.

**2. ⚠️ `config/` is mounted `:ro`, and U5 is the first unit that writes to it.** `compose.yaml:202`.
CLAUDE.md predicted this exact surfacing — *"U3 only reads, so the bug is invisible here and would
surface the first time the U4 rule editor saves"* — and U4 shipped a **read-only** panel, so it still
has not. **U5 is where it comes due.**

⚠️ **It will present as a kill switch that works in the UI and does not persist**, which is the worst
failure mode this particular control could have: the button flips, the page re-renders from client
state, and a restart silently re-arms automation. So FC-U5-2 requires the button to reflect **what was
read back from disk**, never optimistic client state, and Phase 4's exit criterion 3 must be verified
**through the container** — on the host the write succeeds and the bug is invisible.

**3. ⚠️ Q4's colour cue collides with a scheme that already exists, and the collision destroys a
deliberate distinction.** Checked the code before designing to the request. `rulesIndicator`
(`src/ui/statusBar.ts`) already binds **all four** `IndicatorLevel` values to rules-**file** load
health, and its docstring pins why `fail` is load-bearing (**FQ5**): *a light that only says "something
failed" leaves exactly the ambiguity the indicator exists to remove, and a silent last-known-good is
indistinguishable from a successful reload.* Red **names the version still in force**.

Recolouring it would make red mean either *your rules file is broken* or *a rule matched and the skip
failed* — and a user seeing red would not know whether to open their rules file or their decision log.
✅ Resolved as a **second, adjacent compact indicator**, which still meets the stated goal of no added
prose on the primary screen.

⚠️ **And the `Indicator` contract already says colour cannot be the only channel** — `glyph` exists as
*"a distinct glyph per level, for the same reason"*. So each new state needs a glyph as well as a
colour. That is not a departure from the request; it is what keeps the indicator readable to someone
who cannot distinguish the proposed `Green` from `Yellowgreen`, which is the hardest pair in it.

⚠️ **Flashing recommended against, and said so rather than quietly dropping it**: an accessibility
hazard on a display meant to sit visible for hours, unable to encode seven states, and on an
always-on display motion reads as *something is wrong* whichever state is flashing. Offered instead as
a transient pulse on change, with sustained flashing available for `failed` and `halted` if the user
wants it — the two states where demanding attention is the point. **The user's call, not the FD's.**

### Two smaller design decisions worth recording

**`SafetyCounters` are derived, never stored.** A stored counter is a second source of truth that
drifts invisibly from the rows it summarises. Consequence accepted: counters reset on restart, but the
**halt itself persists** (BR-35.7) — a restart cannot clear a halt, only the count that would have led
to one.

**⚠️ `FactCache` re-opens, and a cache would make FR-34 a silent no-op.** U4 closed it as superseded
because one decision per play calls `historyCountsBefore` once; re-evaluation is a second assembly for
the same play, which is the case it was specified for. **But the point of re-evaluating is that the
facts changed** — a cache serving the first assembly's values to the second makes FR-34 do nothing
while every test passes. BR-37 permits caching the point-in-time history counts and **never the
enrichment fields**.

### ⚠️ A new instance of an old trap, flagged in advance

BR-43.2's before/after evidence fields are **`successor_lag_ms` wearing a different hat**.
`recordSuccessorLag` had **zero callers for its entire life**, so the field designed to hold successor
lag was never wired and the 2026-09-22 measurement had to reconstruct it from trails. **A column that
is structurally empty reads as "this never happens."** If BR-43.2's fields are specified and not
written, the user's later review finds nothing and concludes the hazard is absent — *"we'll look at
the data later"* silently becoming *"there is no data."* BR-43.3 makes writing them a rule rather than
an intention.

### Next step, unchanged

**Probe P-U5-1**, with the container **down**. It is the only thing left blocking the FD.


---

## 2026-09-27 — Probe P-U5-1: the hazard is false, and classifier v2's mechanism was backwards

**Stage**: CONSTRUCTION · U5 Functional Design — **now COMPLETE.** Documents and probe scripts only;
`src/` untouched, no migration. Record:
`construction/u5-automated-skipping/probes/p-u5-1-transition-behaviour-2026-09-27.md`.

### ✅ The answer: FR-46 needs no lag guard

The design plan predicted that a skip at the reported track boundary would truncate **18–41 s** of a
track the listener was enjoying, in the context used 50–70% of the time. **It does not.**

| | AI DJ (n=8) | radio (n=3) | album (n=4) |
|---|---|---|---|
| **audio lag** behind the reported flip | **+0.9 to +2.2 s** | −0.3 to +0.5 s | −0.4 to −0.5 s |
| reported tail | 1.4 – 50.9 s | 0.0 – 0.7 s | 0.0 – 0.3 s |
| **`B@first`** | 0.6 – **23.6 s** | 0.0 – 0.7 s | 0.8 – 1.2 s |

**A skip at the reported boundary costs at most ~2–3 s.** BR-43 is written; FR-48's provisional
confirmation (`progress_ms` reset **+** track-id change) is validated with a **~3 s grace**.

### ⚠️ The hypothesis was BACKWARDS, and that is the bigger finding

`CLAUDE.md` recorded *"in the DJ context the API stops reporting a track 18–41 s before it stops
playing."* **The API never lagged. The DJ stops PLAYING the track 18–50 s before its nominal end and
reports that accurately.**

**`B@first` is what settled it** — how far into the incoming track the API already is the first time it
names it. Radio and album: **~1 s**. The DJ: **up to 23.6 s**. On one transition the API went from
*"Can't Deny, 50.9 s remaining"* to *"Not Today, already 23.6 s in"* across a **1.1 s** poll interval.
So `progress_ms` is accurate in pre-determined contexts, and the DJ's tails are **real edits**.

✅ **Classifier v2's FIX STANDS UNCHANGED.** `maxUnobservedTailMs = 55_000` thresholds the right
quantity for the wrong stated reason; the 24 re-derived rows stay correct, because the listener heard
those tracks finish — as the DJ presented them, they did. **No re-derivation. And BR-11.7 is untouched
by a change of explanation** — a better story about the mechanism is not grounds to re-run anything.

⚠️ **This was very nearly the opposite conclusion.** Mid-probe, `B@first` looked like evidence that
`progress_ms` was unreliable *generally*, which would have put a question mark on v2's threshold input.
The album and radio controls are the only reason that reading was rejected: they show `B@first` ≈ 1 s.
**Without the control the probe would have produced a plausible, wrong, and much more alarming answer.**

### ✅ The mechanism came from the user, and it unifies this probe with R11

⚠️ **"Algorithmic" is not the discriminator** — radio is algorithmic and behaves exactly like an album.

The user's observation: **radio's tracks are chosen ahead of time** (the full tracklist is shown, as
with an album) **while the DJ chooses as it goes.** So the discriminator is **pre-determined vs
produced-live**. A pre-determined list plays sequentially and the API reports each change as it
happens; a mix composed live must *produce* each transition — which is exactly when trimming,
crossfades and an already-running incoming `progress_ms` are what you would expect.

✅ **It explains R11 with the same cause.** R11 found album/autoplay/radio expose a 7–20 track queue
while the DJ exposes none, and could not say why: **a pre-determined list can be exposed; a live mix
has nothing to expose yet.** One mechanism, two findings.

✅ **So FR-46 needs no new signal.** The queue probe FR-36 already performs discriminates the regimes,
and it sidesteps R11's blocker that `context.type` cannot tell the DJ from a radio station —
re-confirmed here (`37i9dQZF1EYkqdzj48dyYq` DJ vs `37i9dQZF1E4xunLN1DdaFF` radio). `context_type` stays
evidence only.

### ⚠️ New API fact: DJ commentary returns `200` with `item: null`

Not a 204 — a **200 with no track in the body**, for **6.5–7.2 s**, on 3 of 8 DJ transitions.

**An open question follows, and it is deliberately NOT concluded.** The live path parses the MCP
`getNowPlaying` **text**, not this endpoint. If a gap there reads as *nothing playing*, `PlayObserver`
would close the play on `pause-idle`, and since `classify` returns `skipped` only on `track-change`
such plays fall through to **`unknown`** — systematically. That would mean a slice of the `unknown`
population is DJ commentary rather than instrument downtime, which reaches R2 and open item 8.
⚠️ **It must be probed on the MCP surface and must not be asserted from P-U5-1**, which never observed
that surface.

### ⚠️ The crossfade argument has failed a THIRD time

CLAUDE.md ruled crossfade out partly because *"the feature was disabled"*. The setting **is** off — and
**the DJ crossfades anyway, ~5 s, on 3 of 8 transitions.** The setting was never the relevant fact in
the DJ context, which is the only context where the anomaly appears. **A UI fact used as a probe
result, twice over.**

### The DJ has at least three transition behaviours, and the sign of the offset varies

| type | n | tail (median) | audio lag |
|---|---|---|---|
| hard-cut | 3 | 8.0 s | +0.9 s |
| crossfade | 3 | 25.1 s | +2.0 s |
| **dj-talk** | 2 | 1.6 s | **−6.9 s** — the audio changes *before* the API names the next track |

Nothing in the API predicts which is coming, so **BR-43.1 compensates for nothing rather than
compensating by an average.** R11's shape again: the answer is *it depends*, and the field you would
branch on does not exist.

### ⚠️ EIGHT instrument failures, recorded because each nearly cost the result

| | Failure | Fix |
|---|---|---|
| 1 | Operator polled then **asked** the listener what they heard. ⚠️ The round trip was slower than the effect — *"I hear the new track"* 12 s after an 8 s lag is consistent with a lag **and** with no lag | Listener marks by keypress; correlate afterwards |
| 2 | Read the reported tail as if it were a lag. ⚠️ **A tail is not a lag** — an 8.3 s tail sounded perfectly natural on video | Measure the audio separately |
| 3 | ⚠️ Marks went to the **Spotify window, where SPACE is play/pause**, stopping the music instead of recording it | `a` is the key; banner explains focus vs visibility; script watches `is_playing` and reports a probable leaked mark |
| 4 | ⚠️ Flip detection needed two consecutive samples carrying a track, so **commentary-gap transitions were invisible** | `lastWithTrack`; `nullGapMs` recorded |
| 5 | ⚠️ Context **inferred** from a uri containing `37i9dQZF1E` — **which radio also matches** | `--context` is declared; the analyser prints `dj-or-radio?` rather than guess |
| 6 | ⚠️ A **manual context switch** pooled as a transition. One 149 s row moved the radio mean tail from 0.4 s to **37.6 s** | Auto-excluded on tail > 60 s with no marks, or a changed context uri; printed, never silent |
| 7 | ⚠️ Verdicts hardcoded to say "DJ", so a control run printed *"FAILED — audio the DJ never played"* when trim ≈ 0 is the account **confirmed** | Verdicts name the declared context |
| 8 | ⚠️ The analyser computed **pooled medians** while its own header carried R11's *"do not average a context-dependent answer"* warning | Groups by declared type; never pools |

**Failures 4 and 5 are this project's own recurring traps.** 4 is absent data reading as a negative
finding. **5 is worse: R11's own finding — that the DJ and radio are indistinguishable by uri —
reproduced as a defect inside the tool built to test it.** The user caught it only by volunteering
*"this is a radio station"*; had they not, radio would have been pooled into the DJ group invisibly and
the control would have vanished into the treatment.

### Pre-registered predictions, and one that failed usefully

Committed at `53f15ff` **before** the repetitions were read.

| # | Verdict |
|---|---|
| 1 | ⚠️ **FAILED** — value wrong (~2 s, not ~5 s) and `dj-talk` is *negative*, which the prediction never contemplated |
| 2 | ✅ HELD |
| 3 | ✅ HELD for the DJ, ≈ 0 for radio/album — the control direction |
| 4 | ✅ HELD — ui lag median −0.2 s; the UI moves with the API |
| 5 | ✅ **HELD** — album tail median 0.3 s vs DJ 8.0 s |

⚠️ **`impliedTrim = tail − audioLag` is invalid for negative lags.** On a `dj-talk` row the audio mark
is A's *end* while the flip is B's *start*, with commentary between, so the subtraction conflates two
intervals. The 9.9 s there is arithmetic, not measurement — my metric, my error.

### Corpus protection, and a claim of mine that was wrong

Two real `POST /me/player/next` calls were issued with the container **down**. ⚠️ **"Container down
means nothing records" was not quite true**: `recently-played` remembers and the backfill imports on
restart. What protects the evidence base is that backfilled rows are **`unknown`**, excluded by both
the gate's `ELIGIBLE` predicate and `BackTestService`. **Verified afterwards: 0 skipped rows on
2026-09-27**, and the 22→30 live-skip increase is the user's own listening on 09-25 and 09-26.

### Limits

**n is small**: 8 DJ / 3 radio / 4 album, one machine, one account, one evening. Enough to separate
~2 s from ~25 s; **not** enough to characterise the distribution of DJ trim lengths (observed
6.8–48.7 s implied, on 6 transitions). **Autoplay was never tested** — R11 says it exposes a queue, so
it *should* be pre-determined, but that is inference.

### Next

**The Code Generation plan.** The FD is complete: `business-rules.md` (BR-33…BR-43),
`domain-entities.md`, `business-logic-model.md`, `frontend-components.md`.

---

## 2026-09-27 (later) — The backup/restore pair is built, and TWO recorded claims were measured wrong

**Stage**: CONSTRUCTION — U5, migration-007 prerequisite (design plan §4)
**Decision**: user approved the full stage sequence (NFR → Infrastructure → Code Generation), the
minimal backup scope, and correcting the documents.

### ✅ Built: `backup-history.mjs`, `restore-history.mjs`, `verify-all-backups.mjs`

`npm run db:backup -- --label x` · `npm run db:restore -- <dir> --verify-only` ·
`npm run db:verify-backups`. **The restore half has never existed before** — `data/` held ten backups
written by three scripts and nothing ever read one back.

**Round trip rehearsed end to end** on a scratch copy of the live database: 850 plays → damaged to 0 →
restored to 850, `integrity_check: ok`, with the damaged version preserved first. That discharges the
plan's *"⚠️ Verify the restore — an unverified restore path is the defect this item exists to fix."*

### ⚠️ CLAIM 1 CORRECTED: "copying the `.db` alone loses over half the corpus" is FALSE

The WAL really can be larger than the `.db` — **3673 KB vs 3396 KB**, re-measured. But the inference
drawn from that size comparison was wrong. Measured on the live database:

| | plays | decision rows | `integrity_check` |
|---|---|---|---|
| live (read-only, authoritative) | **850** | **900** | — |
| `.db`-only copy | 824 | 825 | **`ok`** |
| `.db` + `-wal` | 850 | 900 | `ok` |

**3.1% lost, not >50%.** WAL size tracks **page churn**, not row count. Confirmed against the one
pre-existing backup with a 4 MB WAL: 139 of 145 plays survive a `.db`-only copy.

⚠️ **The correction makes the hazard worse, not milder.** A 50% loss announces itself. A 3% loss
confined to the *newest* rows, reporting `integrity_check: ok`, does not. **"Checkpoint the WAL first"
stands; only the stated reason changes** — same shape as classifier v2, where the fix stood and the
mechanism was backwards.

⚠️ **This is the denominator-trap family again**: a *plausible inference from file sizes*, recorded in
CLAUDE.md as though it were a measurement, and repeated into four other documents. It is the
project's own rule pointing at its own notes — **a recorded quantity decays as silently as a recorded
negative, because nothing ever re-measures it.**

### ⚠️ CLAIM 2 CORRECTED, and this one is a live SAFETY DEFECT: the lock guard is BLIND

`reclassify-unobserved-tails.mjs` says *"This script refuses to apply if it can see the app holding
the database."* **It cannot see it.** Probed 2026-09-27: with `spotify-now-playing` **up, healthy and
actively recording**, a host process **successfully acquired `BEGIN EXCLUSIVE`** on
`data/history.db`. The app holds its connection for its whole process lifetime
(`SqliteHistoryRepository.ts:192`), so this is not a race — **SQLite's locks do not cross the
Rancher Desktop bind mount** between the Windows host and the Linux VM.

⚠️ **This mechanically explains the U4 corruption incident (audit 2026-09-21).** The guard passed, so
two writers hit one file. It is not a weak guard, it is one that **returns green exactly when the
danger is present** — the same family as *"a guard computed the same way as the thing it guards is not
a guard"*, here **a guard that cannot observe the condition it guards**. Worse than no guard.

⚠️ **Found by accident**: the new backup script ran while the container was up and *succeeded*. It
checkpointed the live WAL. Nothing was lost — 850 plays and `integrity_check: ok` before and after —
but that is luck. **`docker compose down` is the only real protection, and the script-level guard that
appeared to back it up did not.**

✅ The new scripts check **`docker ps`** and **fail closed**: if `docker` cannot be reached the answer
is *unknown*, and unknown refuses (`--i-have-stopped-the-container` is the deliberate override). The
lock probe is **kept alongside** it, because neither check sees the other's writer — `docker ps` cannot
see `npm start`, and the lock cannot see the container. It is incomplete, not useless.

⚠️ **NOT YET FIXED: `reclassify-unobserved-tails.mjs` still carries the blind guard and the false
docstring.** Left for a decision rather than patched silently, because it is a tool that has been run
in anger.

### What verification means, established by two complementary negative controls

| | `integrity_check` | manifest counts |
|---|---|---|
| `CORRUPT-snapshot-20260921-201444` — damaged b-tree | ✖ **fails** | plausible: 586 plays, 126 decisions |
| a backup with one play deleted | ✅ **`ok`** | ✖ fails: 849 ≠ 850, max(id) 890 ≠ 891 |

⚠️ **Integrity sees damage; the manifest sees incompleteness; neither sees the other's failure.** So
verification is both. Row counts alone would have passed the corrupt file; integrity alone would have
passed a database missing a play.

✅ **The verifier is itself verified.** `--self-test` runs it against the CORRUPT snapshot and **fails
if it passes** — a checker that has only seen good input is indistinguishable from one that returns ok
unconditionally, which this project has already been bitten by (PBT-22 passing trivially against
counts that were always zero). The CORRUPT directory is therefore **load-bearing and must not be
tidied away**; the script errors out if it is missing.

⚠️ **A third verdict was needed, and its absence was a real bug in the first version.** It printed
*"could not be checked against a manifest"* for a backup whose manifest **was present and
disagreed** — found by the tamper rehearsal. Now `corrupt` / `mismatch` / `unverifiable` are distinct,
and `mismatch` is flagged as **more** serious than a missing manifest: the file is internally
consistent, so nothing else will ever complain about it.

### ⚠️ First sweep: 0 of 11 existing backups are fully verified, and 1 is CORRUPT

Ten are intact-but-unknown — none carried a manifest, so their *completeness* cannot be checked.
`unverifiable` is deliberately **not** reported as a failure: calling it one would train the reader to
ignore the output, and then the single real corrupt file goes unnoticed. `null` is unknown, and
unknown is never `false`.

### Stale statements found and fixed in the same pass

⚠️ Three places still said BR-43.5 was *provisional pending P-U5-1* and repeated the **backwards**
mechanism (*"the reported track changes 18–41 s before the audible one"*) — `domain-entities.md` §1
twice and `frontend-components.md` §5 — while `business-rules.md` had already recorded the probe as
discharged. Two BR cross-references pointed at BR-43.1 where BR-43.5 was meant.

**This is exactly the §5.2 lesson being obeyed rather than re-learned**: a correction pass that fixes
only the statement it went looking for leaves the document wrong *and freshly reviewed*.

### Corpus note

**850 plays, 900 decision rows** as of 2026-09-27 — CLAUDE.md and `aidlc-state.md` still said 662/664.

### Next

**The U5 NFR Design plan**, then Infrastructure Design, then Code Generation. ⚠️ The
`before-migration-007` backup itself still has to be **taken with the container down**.

---

## 2026-09-29 — The before-migration-007 backup is taken and verified; the blind guard is fixed; and `npm run reclassify` had been DEAD for a week

**Stage**: CONSTRUCTION — U5, closing the two items left open on 2026-09-27.

### ✅ The `before-migration-007` backup exists and is VERIFIED

`data/backup-before-migration-007-20260929T172027Z` — schema **v6**, `integrity_check: ok`, **850
plays · 900 decision rows · 49,582 observations**, and **all eight verification checks pass** (manifest,
sha256, integrity, schema match, every table count, every max id).

Taken with `docker compose down`, restored-verified while the original was still present, container back
up and healthy: UI `200`, `mcp: connected`, `integrity_check: ok`, **850 plays / 900 decisions /
maxPlayId 891 before and after**. Sweep now reads **1 fully verified · 10 intact but unverifiable ·
1 CORRUPT**.

⚠️ **Cost: zero unrecorded listening**, because nothing was playing. Checked first rather than assumed
— see the recording scare below.

### ✅ The blind guard in `reclassify-unobserved-tails.mjs` is FIXED

It now delegates to `assertNobodyElseHoldsIt`, which checks **`docker ps`** *and* keeps the lock probe
for a host writer, and **fails closed** on an unreachable `docker`. **Verified against the exact case
the old guard passed**: with the container up, `npm run reclassify -- --apply` now exits **2** with a
refusal naming the container.

⚠️ **Imported, not re-implemented.** *One admission rule, invoked twice, never written twice* — this
project has already shipped a divergence of that shape, where the WebSocket upgrade handler
re-implemented the local-access policy, the copies drifted, and every page load returned `200` while
every handshake returned `403` with all 411 tests passing.

The false docstring — *"refuses to apply if it can see the app holding the database"* — is replaced with
the correction **and the history of both wrong versions**, because both looked right.

> ⚠️ **The general lesson: a recorded reassurance decays exactly like a recorded negative, because
> nothing ever re-tests it.** This one survived a corruption incident that it had failed to prevent.
> Open item 3a already recorded the mirror-image case (*our own notes said the API doesn't return X, and
> it does*). **Both are the same defect: a claim written once and never re-probed.**

### ⚠️ THIRD DEAD-TOOL FINDING: `npm run reclassify` has been BROKEN SINCE 2026-09-22

Found while testing the guard fix — the script **could not start at all**:

```
SyntaxError: The requested module '../src/history/types.js'
             does not provide an export named 'ATTRIBUTION_VERSION'
```

⚠️ **Proven pre-existing, not caused by the guard edit**: stashing the edit and re-running reproduces it
on `HEAD`. Commit **`f864e4e`** (classifier v2) retired `skip_attribution`, removed
`ATTRIBUTION_VERSION` and `attributeSkip` from `src/`, and **left the script importing both**.

⚠️ **This is the FR-20 re-derivation tool** — the instrument for *"store observations; derive
judgements"*, the one that re-derived the 24 rows classifier v2 corrected, and a documented command in
`CLAUDE.md`. It was **dead for seven days and nothing noticed.**

**Why nothing noticed, stated as the pattern rather than the instance:**

| | |
|---|---|
| `test/noOrphanModules.test.ts` | walks **`src/`** only — `scripts/` is outside it entirely |
| Coverage | cannot see a file no test imports; an untested file is missing from the **denominator** |
| The retirement commit | changed `src/` and its tests, and **891 tests stayed green** |

⚠️ **`scripts/` is wholly untested and outside every guard**, and it now holds 19 files including the
hypothesis-gate runner, the `played_at` repair, the probes and the new backup/restore pair. **This is
the third instance of the same shape in eight days**: `recordSuccessorLag` (a dead method inside a live
file), the ten backups with no restore path, and now a dead entry point. Each was invisible for the same
reason — **the guards watch `src/` and the tools live somewhere else.**

**Repaired** by removing the attribution half rather than restoring the dead imports, per
`domain-entities.md` §6: *"Do not reintroduce it, and do not read it: classifier v2 subsumes it, and the
two rules could contradict each other."* The script no longer reads **or writes** `skip_attribution` /
`attribution_version`; those columns stay nulled-not-dropped for by-image rollback.

✅ **And the repaired script reports the corpus is stable**: **762 live plays, 762 re-derived identical,
0 changes** under classifier v2. So the week of deadness cost nothing — but that is the *outcome*, not a
defence. ⚠️ It also means `--apply` would have been a no-op, so the guard fix was verified on a run that
could not have damaged anything either way. **The guard was not proven by risking the corpus.**

### ⚠️ A recording scare, resolved: nothing was wrong

No play or decision had been written since **2026-09-27T02:46Z** — ~2.5 days — while the container
reported `Up 2 days (healthy)`. The `.db` and `-wal` mtimes had also not moved.

**Recording was fine.** `/api/diagnostics`: `MCP getNowPlaying → "Connected — nothing currently
playing"`, `Database → schema v6`, `Listening history → 850 plays · 0 gaps`, and the **snapshot
scheduler had run at 2026-09-29T15:07:54Z**, proving the background timers were alive. The user simply
had not played music.

⚠️ **Two false signals to distrust next time.** ① **Bind-mount mtimes are not a liveness signal** — the
last play (`02:46Z`) is *later* than the `-wal` mtime (`02:31Z`), which is impossible if mtimes were
faithful. ② **"No new rows" is indistinguishable from "no listening"** without asking the app what it
can see. The discriminator is a *positive* check that the timers are alive — the snapshot timestamp —
not the absence of data. **Absent data reading as a fault is this project's own trap inverted.**

### Verified after all of it

**891 tests · typecheck clean · schema v6 · 850 plays · 900 decision rows · `integrity_check: ok` ·
`src/` untouched · `src/playback/` still absent.**

### Next

**The U5 NFR Design plan's 8 questions** — [`../plans/u5-nfr-design-plan.md`](../plans/u5-nfr-design-plan.md).
⚠️ **Candidate P-32 (*a guard must be able to observe the condition it guards*) has now earned a second
citation**, and a candidate joins it: ⭐ **a tool outside `src/` is outside every guard** — three
instances in eight days.

---

## 2026-09-29 (later) — W-6 opened: the suite has never caught an "unforced error", and that is structural

**Stage**: INCEPTION amendment (`requirements.md` §5.1) + CONSTRUCTION (U5 NFR Design plan).
**Raised by the user** after three dead-or-broken artefacts surfaced in eight days without the test
suite noticing: *"What is the best practice when working with a primarily agent coded app to review
the code and detect problems with it, the pipeline, the test suite or other project tools and
artifacts?"*

⚠️ **`requirements.md` is a stage-gated inception deliverable and was amended on the user's explicit
instruction**, not unilaterally — the same handling as the FR-40 and R11 amendments of 2026-09-26.

### The finding that motivates it

Going through the project's own defect record and asking *what found this*: **essentially none were
caught by the 891 tests.** They were found by the user noticing a wrong number, by running the
container, by watching a real failure get recorded, by probes — and twice **by accident**.

⚠️ **This is not a quality problem with the suite.** It does real regression work invisibly. The class
is outside its reach, and **coverage actively conceals it**: `noOrphanModules.test.ts`'s own docstring
already records why — an untested file leaves the **denominator** rather than scoring zero.

Five categories, in `requirements.md` §5.1 W-6. The one worth repeating here is **D — assertions
recorded as observations** — because **tests can never catch it: the code does exactly what it says.**
`skip_source`, `played_at`, *"loses over half the corpus"*, and the lock guard's docstring are all
this, and all four were written confidently.

### ⚠️ What is specifically amplified by agent authorship

1. ⭐ **Co-generated tests share the author's misconception.** One pass writing both code and tests
   encodes the same mental model twice, so when the model is wrong **both are wrong and they agree**.
   The WebSocket `403` is the exact case: the tests exercised the policy function (correct), nothing
   exercised the handler (which held a copy), and **all 411 tests passed**.
2. ⚠️ **A confident comment is the most dangerous artefact in an agent codebase** — more dangerous
   than the code, because it stops the next reader from checking. The lock guard shipped with a
   docstring arguing why it was *"a real test of the dangerous condition rather than a proxy for it"*,
   and it **outlived the corruption incident it had failed to prevent**.
3. **Agents re-implement rather than retrieve** — three instances (the access policy, `bucketOf`,
   `USER_SKIP_RATIO_CEILING`).
4. **Agents run the tests, not the app** — which is why the found-by column is dominated by *running
   the system*.

### The split: two guards into U5, four analyses into the backlog

**Into the U5 NFR Design plan as Q9**, because they are cheap, they are guardrails, and **they would
have caught two of the last three findings**:

- **Execute every entry point in CI.** ⚠️ `node --check` is **not** sufficient — the reclassify
  breakage was a missing *named export*, a link-time failure, so the module must actually be
  evaluated. ⚠️ And evaluating is only safe for scripts that guard `main()`;
  `reclassify-unobserved-tails.mjs` does **not**, so the convention must be *invoke the safe mode*,
  never *import the file*.
- **`knip` over `src/` AND `scripts/`** — the method-level half `noOrphanModules` structurally cannot
  do, since it walks **modules, not methods**.

**Deferred as W-6**, triggered at the **end of U5**: mutation testing on the pure core (**W-6.1**),
⭐ **BR-derived tests written without reading `src/`** (**W-6.2**), the negative-control convention
(**W-6.3**), and container-parity probes (**W-6.4**).

⚠️ **W-6.2 is the strongest lever and it is nearly free**, because `business-rules.md` already exists
as numbered, individually testable statements written *before* the code. It is deferred only because
it wants BR-33…BR-43 backed by **shipped** code — generated today it would test a design.
⚠️ **Its process constraint cannot be relaxed**: the session writing those tests must not have read
the implementation, or it becomes the co-generation problem it exists to break.

**Explicitly rejected**: chasing a coverage percentage. Wrong question, and this project has been
bitten by its denominator twice.

⚠️ **One claim in W-6.1 is documentation-derived and is flagged as such**: that Stryker has no
first-class `node:test` runner and would need the command runner. **Probe it before scheduling** —
recording an unverified claim inside the item that exists to catch unverified claims would be its own
punchline.

### Next

**Nine questions** now await answers in
[`../plans/u5-nfr-design-plan.md`](../plans/u5-nfr-design-plan.md).

---

## 2026-09-30 — U5 NFR Design answered (9 of 9, all as recommended), and Q8's addendum found the real footprint

**Stage**: CONSTRUCTION — NFR Design, U5. Authoritative reading:
[`../plans/u5-nfr-design-plan.md`](../plans/u5-nfr-design-plan.md) **§5.1**.

All nine settled by the user **as recommended**. The ones worth recording beyond the table:

- **Q3 = B** resolves a genuine conflict between **NFR-17** (*retry 429 with `Retry-After`*) and
  **BR-43.5** (*never retry a skip*). The distinction that resolves it: **did the request reach the
  device?** 401 provably did not, so re-issuing *completes* the first attempt; a 429 did not either,
  but honouring a 30 s `Retry-After` would mean *"skip whatever is playing in 30 seconds"*.
  ⚠️ **Needs a new `RefusalReason`, `upstream-rate-limited`**, distinct from BR-35.2's own hourly
  limit — conflating them would make the runaway halt's evidence unreadable.
- **Q5 = C** keeps the kill switch **asymmetric**: a write failure never blocks *disarming*, always
  blocks *arming*. ⚠️ The symmetric "don't change state if you couldn't persist it" is ordinary
  transactional hygiene and, applied to a kill switch, means **the user pressed stop and the system
  kept going.** Same asymmetry as BR-37.5/37.6.
- **Q4 = A and A** gives the playback client **exactly one method**. An unused `pause` on a live
  device is indistinguishable from an intended one the day someone calls it — BR-30's argument,
  applied to a method rather than a constructor parameter.

### ⚠️ Q8 carried a new requirement, and the two halves turned out to be one item

The user added: *"metrics that let the dev (during live debug) check that the app is not abusing the
external api's… Ideally the app has a 'light touch'… I'd also like a little thought/research put into
'can we determine what a reasonable app bandwidth/hit rate to external sites should be'."*

**The research cannot be done yet, because nothing counts the requests.**
`webApiClient.ts:125` throws on a 429 with the `Retry-After` **inside a message string** and records
nothing, so the app cannot say whether it has ever been rate-limited. ⚠️ **Zero 429s in the container
log proves nothing** — the container had been recreated 30 minutes earlier for the backup.
**The metric is the prerequisite for the research, not a parallel task.**

### The measured footprint — and the poll is 98.4% of it

| Upstream call | Rate/hr | Share |
|---|---|---|
| **MCP `getNowPlaying` poll** @ 3 s | **1,200** | **98.4%** |
| `GET /tracks/{id}` — once per *distinct* track | ≤16 | 1.3% |
| Token refresh · liked set (663÷50, 6-hourly) · followed · `recently-played` | ~4 | 0.3% |
| **Spotify total** | **≈1,220/hr · ≈29,300/day** | |

✅ **Everything except the poll is already a light touch, and Development Mode is why.** The
`/contains` family returning 403 forced *fetch the set once, cache it, resolve locally*, so follow and
liked status cost **zero** per-track requests and enrichment is **one** call per distinct track.
⚠️ **The sandbox restriction accidentally produced the efficient design** — worth noting, because the
restriction is recorded in this project only as a cost.

⚠️ **The poll never stops, and that was observed rather than projected**: the 2026-09-29 scare showed
**~2.5 days with no play recorded** while the container ran healthy — roughly **86,000 requests spent
learning *"nothing is playing"* 86,000 times.**

### What is knowable about a "reasonable" rate

| Vendor | Published limit? | Position |
|---|---|---|
| **MusicBrainz** | ✅ 1 req/sec sustained with an identifying `User-Agent` | Compliant (NFR-14/15), **and already probed tighter than the published floor** — at 1200 ms spacing 6 of 19 tracks still took a 503 |
| **Spotify** | ❌ **No numeric limit published** — documented only as a rolling 30-second window, differing by app mode | The app sits at **10 requests per 30-second window**. ⚠️ Whether that is 10% or 90% of the ceiling is **not derivable from documentation** |

⚠️ **So the honest answer is: for MusicBrainz yes, and we already have it; for Spotify no — not from
documents.** The only evidence that can ever exist is observed 429s and their `Retry-After` values,
which is exactly what is not recorded. ⚠️ **And a clean counter would bound nothing except "below the
limit"** — the same logic as the gate's CI ruling out ±8pp *and nothing smaller*. **Do not let zero
429s be read as headroom.** ⚠️ And do not resolve this by reading Spotify's docs harder: six wrong
conclusions have come from those docs, every one caught by a probe.

### The work it creates

**In U5**: metrics **M1** (per-upstream rate in a rolling 30 s window *and* per hour — an hourly mean
hides a burst), **M2** (429/503 **counted and persisted** with the last `Retry-After`), **M3**
(requests per play — the efficiency ratio), **M4** (share of polls returning nothing playing).
⚠️ **M2 must count, never just log** — a failure written down and never aggregated is the
`successor_lag_ms` shape, where a structurally empty field reads as *this never happens*. New pattern
**P-37: a limit you cannot see is a limit you cannot respect.**

**Deferred as W-7** — *adaptive poll backoff when idle*, the change that would cut ~98% of the
footprint. ⚠️ **Deliberately not in U5**: it alters the **recording instrument**, the one output that
cannot be regenerated, and U5 exists because phases are sequenced by risk containment. Its own
analysis is needed — backoff only while *nothing is playing* (a longer interval during playback thins
`PlayObserver`'s trail); a late `startedAt` on the first play after idle, where **classifier v2 is
*probably* robust** because it thresholds `durationMs − maxProgressMs` from Spotify's own
`progress_ms` rather than trail density, ⚠️ **and "probably" must be probed**; a longer FR-34 blind
spot; and ⚠️ **a backoff that fails to exit is a silent recording outage that looks exactly like "the
user did not listen"** — which the 2026-09-29 scare demonstrated.

⚠️ **W-7 is blocked on the U5 metrics**, not merely sequenced after them: without a counter there is no
before-and-after, and without M4 the waste it targets is not even visible.

### Next

**The U5 Infrastructure Design plan**, then Code Generation. ⚠️ Infrastructure owns the `config/`
**`:ro` → `:rw`** change and **migration 007**; the backup it needs is **taken and verified**.

---

## 2026-10-01 — ⚠️ CORRECTION: the "bind-mount mtimes are not a liveness signal" finding of 2026-09-29 is FALSE

**Raised by the user**, querying a claim of mine that recording had *"stopped around 09:04 today"*:
**"Hmm 9:04 AM?"** — at 22:05 local. The query was right, and chasing it found that **the underlying
finding recorded in this log on 2026-09-29 is wrong.**

### ✅ mtimes over the bind mount ARE faithful, and the proof was sitting in `data/snapshots/`

`history-snapshot-2026-09-29T15-07-54-884.csv` carries **UTC in its filename** and **local in its
mtime**: `2026-09-29 11:07:55 -0400` = **15:07:55Z**. Match to the second.

⚠️ **So the offset is self-evident from a single `ls` of that directory**, and it is **UTC-4 (EDT)** —
not the UTC-3 I had inferred from one coincidence on 2026-09-27 and then never checked.

### What the withdrawn claim said, and why it was wrong

> ⚠️ ~~**Bind-mount mtimes are not a liveness signal** — the last play (`02:46Z`) is *later* than the
> `-wal` mtime (`02:31Z`), which is impossible if mtimes were faithful.~~ **WITHDRAWN.**

Recomputed at UTC-4: that `-wal` mtime was **Sep 26 23:31 EDT = 2026-09-27T03:31Z**, which is **45
minutes AFTER** the 02:46Z play, exactly as a trail being appended as the track finished would be.
**Nothing was impossible. The comparison was across two timezones, and the direction came out
backwards.**

⚠️ **Claim ② of that entry stands and is the one that mattered**: *"no new rows" is indistinguishable
from "no listening"* without a positive check that the timers are alive.

### ⚠️ And then I used the invalidated signal anyway, today

Reading `-wal` mtime `09:04` I reported *"recording stopped around 09:04 today"*. At UTC-4 that is
**13:04:19Z**, which is **11 minutes AFTER** the newest play started (`2026-09-30T12:53:44Z`) — again
perfectly coherent, and again a local mtime compared against a UTC timestamp.

⚠️ **`09:04` is the last time there was anything TO write, not the last heartbeat.** Three plays were
recorded 08:47–08:53 EDT and then listening stopped; the container could have polled for hours
afterwards writing nothing. ⚠️ **The files cannot date the container's stop**, and with dockerd down
its logs are unreachable, so **when it stopped is unknown** — stated as unknown rather than estimated.

### The shape of the error, which is this project's own and is why it is worth a whole entry

1. An offset was **inferred from a single coincidence** and never measured.
2. It was used to **invalidate a reliable instrument** — and the invalidation was written into the
   append-only log as a *finding*, with a confident mechanism (*"impossible if mtimes were faithful"*).
3. The now-distrusted instrument was then **read anyway**, two days later, and produced a second wrong
   conclusion about whether the recording instrument was alive.

⚠️ **This is the plausible-inference-recorded-as-measurement trap, committed in the log that exists to
catch it** — the same family as *"loses over half the corpus"* and the lock guard's docstring, and the
third time in this session that a confident claim of mine needed measuring rather than reasoning.
⚠️ **It is also W-6 category D exactly**: an assertion recorded as an observation, which no test can
ever catch because nothing executes it.

✅ **The usable instrument, recorded so it is not re-derived**: `data/snapshots/` filenames are UTC and
their mtimes are local, so **one `ls --time-style=full-iso data/snapshots/` establishes the offset and
proves mtimes are trustworthy.** Do that before reasoning about any file time.

### State at the time of writing

**853 plays · 909 decision rows · `integrity_check: ok`** — three new plays this morning, newest
`2026-09-30T12:53:44Z`, held in a 478 KB uncheckpointed WAL. ⚠️ **Nothing lost.** The container is
**down** because the Docker daemon is unreachable (Rancher Desktop's processes are alive, its backend
is not); `restart: unless-stopped` should recover it when dockerd returns.

---

## 2026-10-01 — Recording was silently down ~13 hours: a WSL update during Modern Standby destroyed the VM

**Not a project defect.** Recorded because it falsifies a claim in `CLAUDE.md`, and because of how it
was found.

### Root cause, from the Windows event log

| Time (EDT) | Event |
|---|---|
| **11:32:16** | Machine enters Modern Standby. WSL VM suspended — this is why `k3s.log`, `docker.log` and the guestagent log all stop here. ⚠️ **Suspension, not death** |
| **13:06:39** | `Installation Started: MicrosoftCorporationII.WindowsSubsystemForLinux`, and the **`Windows Subsystem for Linux` service start type set to `disabled`** |
| **13:10:40** | **`WSL Service` start type set to `disabled`** |
| **14:11:41** | Hyper-V vmswitch: NIC **disconnected from port** |
| **14:42:40** | Hyper-V vmswitch: **port deleted** — the VM is gone |
| 15:39 / 16:42 | Resume |
| **16:50:11** | Rancher's `host-switch.exe` and `Ubuntu-24.04 socket proxy` exit **status 1**; Rancher relaunches, then stops logging |

**Windows Update installed a WSL update (now 2.7.14.0) while the machine was in Modern Standby, and
the WSL VM was torn down with it.** `dockerd` stops mid-sentence in a 10-second warning loop — no
SIGTERM, no shutdown message. That is a VM kill, not a daemon exit.

⚠️ **Modern Standby alone is NOT the cause, and checking that mattered.** The machine enters standby
dozens of times a week and recording survived nearly all of it — including a **5 h 07 m** standby the
same morning (03:22→08:29), after which it recorded normally. **Duration is not the discriminator
either.** What distinguishes this one is that a **WSL version update landed inside it**.

> ⚠️ **I nearly asserted "Modern Standby killed it" from a single clean coincidence** — the standby
> beginning at 11:32:16 against logs stopping at 11:32:38. That is the same error as the timezone
> finding corrected hours earlier in this same log. **The standby history is what refuted it**, and it
> cost one query. **Check the base rate before believing a coincidence.**

### Why the UI hung while Rancher's own diagnostics was clean

The Containers and Volumes panes query the container engine over a socket with no daemon behind it, so
they wait forever. ⚠️ **Rancher's diagnostics has no "is the engine answering" probe**, so a dead
backend is invisible to it. **This is the project's own `localGuard` lesson in someone else's
product**: a clean report on one surface says nothing about a surface nobody checked.

### Recovery, and what it proves

`rdctl shutdown` + `wsl --shutdown` + relaunch. ✅ **`restart: unless-stopped` worked**: the container
revived **by itself** once dockerd returned — it was not started by hand.

✅ **Zero data loss.** 853 plays · 909 decision rows · max play id 894 · `integrity_check: ok` ·
0 recording gaps — identical either side, with this morning's three plays (892–894) intact. They were
in a 478 KB uncheckpointed WAL throughout, which is a committed log and was never at risk.
⚠️ **Note the WAL did not "fold in" on restart** — it is 585 KB and growing, and `history.db`'s mtime
is still the 2026-09-29 backup checkpoint. That is normal WAL operation, not a pending problem.

### ⚠️ `CLAUDE.md`'s "the autostart chain is PROVEN" is TRUE BUT NARROWER THAN IT READS

The 2026-09-05 reboot test is sound and is not withdrawn. But it proved **reboot** — and this failure
was **resume plus a host-component update**, which is far more common and had never been exercised.

⚠️ **`post-boot-check.ps1` returned `INCONCLUSIVE` (exit 2) today, and every substantive check passed**:
dockerd up, container healthy, no startup errors, schema v6 through the bind mount, UI `200`, WebSocket
`101`, cross-site Origin `403` on **both** surfaces, `integrity_check: ok`. The verdict came only from
its autostart heuristic — *"container started 614,154s after boot — too long to credit the chain; was
it started by hand?"*

⚠️ **Its one weak inference is exactly today's case.** The host never rebooted; only the VM died. The
script cannot distinguish *"started by hand"* from *"restarted by the restart policy after the engine
returned"* — and the second is what happened, which is the chain **working**. It is a reboot test being
asked a resume question. **Not a bug; a scope limit that should be stated rather than read as a
failure.**

### ⚠️ The detection gap is the real finding

Recording stopped for ~13 hours and **nothing noticed**. It surfaced only because the user queried a
timestamp in a status line — *"Hmm 9:04 AM?"*. `restart: unless-stopped` cannot help when dockerd
itself never returns, and the app cannot report its own absence.

⚠️ **And "no new rows" is indistinguishable from "the user did not listen"** — the one surviving claim
from the withdrawn 2026-09-29 entry, now demonstrated twice: once as a false alarm (09-29, nothing
wrong) and once as a real outage (09-30). **Absence of data is not a signal in either direction.**

✅ **The discriminator has to be a positive liveness heartbeat**, and the instrument for it is already
specified: **M4** (share of polls returning nothing playing) distinguishes *polling and hearing
silence* from *not polling*. ⚠️ **So M1–M4 are now load-bearing for two separate items** — W-7's
before-and-after, and outage detection. They were costed as diagnostics; they are infrastructure.

**Candidate backlog item, not opened without a decision**: external monitoring of recording liveness.
⚠️ It cannot live in the container, because the failure mode is *the container is not running*.

---

## 2026-10-01 — U5 NFR Design COMPLETE: P-27…P-37, LC-23…LC-31, PBT-34…PBT-50

**Stage**: CONSTRUCTION — NFR Design, U5. Deliverables:
`construction/u5-automated-skipping/nfr-design/{nfr-design-patterns.md,logical-components.md}`.
Written from the plan's §5.1 (nine answers, all as recommended) and §5.2 (Q8's addendum).

### The one NFR this unit AMENDS rather than satisfies

⚠️ **P-30 declines NFR-17's `Retry-After` clause for the skip path**, and that is a decision rather
than a gap. NFR-17 says *handle 429 with `Retry-After`*; BR-43.5 says *never retry a skip*. The
discriminator neither rule contains: **did the request reach the device?**

| Failure | Reached it? | Therefore |
|---|---|---|
| 401 | **No** — edge | re-issue once; it *completes* the first attempt |
| 429 | **No** — edge | ⚠️ **refuse without waiting** — honouring 30 s means *"skip whatever is playing in 30 seconds"* |
| 5xx / network / unconfirmed | ⚠️ **Unknown** | failed, surfaced, never retried |

⚠️ **Unknown landing counts as landed** — `null` is unknown and unknown is not `false`, the project's
rule applied to an action rather than a field. ⚠️ **Needs a new `RefusalReason`,
`upstream-rate-limited`**, distinct from BR-35.2's own hourly cap: conflating them makes the runaway
halt's evidence unreadable, and the halt's only job is to say what tripped it.

> ⚠️ **Recorded prominently in the coverage table, `CLAUDE.md` and the HANDOFF** because the next
> person to read NFR-17 will otherwise see a contradiction and "fix" it. **An NFR quietly not met is a
> defect; an NFR explicitly amended with a reason is a decision.**

### The two properties that earn their place, and why the other sixteen would pass without them

⚠️ **PBT-34a — the positive control.** Six properties (PBT-34…39) prove the six refusal points fire.
**A `drain` that posted nothing, ever, satisfies all six perfectly.** One property must prove the
action *fires*, or the suite is green on a system that cannot skip. This is the third time this
project has needed the same lesson: PBT-22 passed trivially against counts that were always zero, and
`restore-history.mjs` needed `--self-test` against a known-corrupt file.

⚠️ **PBT-41 — the only thing that can catch the P-27 defect.** The safety predicate must be re-read
**at drain time**. Checking it when the decision was taken produces **correct behaviour in every
ordinary test**, because the two states agree whenever nothing changed in between. It diverges only
when automation is switched off *during* the 10 s enrichment wait — which is exactly the case FR-38
exists for, and exactly the case no hands-on session reproduces on purpose. **Same shape as PBT-22:
a defect with no observable failure mode under normal use.**

### What replaces U4's phase guard

U4's was **`src/playback/` does not exist**. U5 ends it, so **P-33** makes the boundary two structural
properties: a single import path (`src/rules/` → `DecisionExecutor` → `SkipExecutor` → `src/playback/`
→ the write client), and **the client exposing exactly one method, `skipToNext()`**.

⚠️ **A general `PlayerClient` is how a skip-only unit acquires the ability to pause the user's music.**
BR-30 already makes this argument about a constructor parameter — *"an injected-but-uncalled one
reduces the boundary to one line of restraint"* — and it applies unchanged to a method.
⚠️ **Asserted on the client's exported shape, NOT via the orphan check**, which walks modules and let
two dead methods live inside a heavily-executed file for their entire lives. **A second method would
be invisible to it** — P-33 and P-36 meeting.

### Patterns that came from defects rather than from design

⚠️ **P-32** (*a guard must be able to observe the condition it guards*) and **P-36** (*a tool outside
`src/` is outside every guard*) are the two most likely to be dropped as obvious, and both were earned
this week: the blind lock guard that **outlived the corruption incident it failed to prevent**, and
three dead-tool findings in eight days. **P-37** (*a limit you cannot see is a limit you cannot
respect*) joins them from Q8's addendum.

⚠️ **P-32 is applied to three U5 guards concretely**, not just stated: the action-point predicate must
re-read state, the loop guard must key on the **play row** and never `track_id`, and the phase guard
must observe the **import graph and exported shape** rather than the file tree.

### LC-28 outgrew its brief

The M1–M4 metrics were costed under Q8 as *diagnostics*. **M4 — share of polls returning nothing
playing — is the positive liveness signal** that distinguishes *polling and hearing silence* from *not
polling*, which is precisely what the 2026-09-30 outage lacked while recording was down ~13 hours.
**So M1–M4 are load-bearing for W-7's before-and-after AND for outage detection.** ⚠️ It makes the
state *visible*; it does not *alert* — a monitor cannot live in the container when the failure mode is
*the container is not running*.

### Verified

**891 tests · typecheck clean · `src/` untouched · `src/playback/` still absent.** Documentation-only,
as every U5 stage has been so far. The phase boundary is intact at the end of NFR Design.

### Next

**The U5 Infrastructure Design plan.** ⚠️ It owns the `config/` **`:ro` → `:rw`** change — a
security-posture change to a deliberately read-only mount — and **migration 007**, additive only. The
`before-migration-007` backup is **taken and verified**.

---

## 2026-10-01 — U5 Infrastructure Design COMPLETE, and Q1 overturned a settled FD answer

**Stage**: CONSTRUCTION — Infrastructure Design, U5. Deliverable:
`construction/u5-automated-skipping/infrastructure-design/infrastructure-design.md`.
All six questions answered as recommended: Q1 **C** · Q2 **A** · Q3 **A** · Q4 **A** · Q5 **A** ·
Q6 **A**.

### ✅ Q1 = C — a new `./state:/state:rw` mount, and `config/` STAYS `:ro`

⚠️ **This reverses NFR Q5**, which had settled `config/automation-state.json`. Q5 stands on everything
it considered; **it did not consider what `:rw` on `config/` grants** — permission to overwrite
`config/rules.json`, the user's hand-authored rule set, which U3 and U4 deliberately protected.
**No U5 code would ever use that permission**, and BR-30 rejects the same shape one level down: it
forbids an injected-but-uncalled playback collaborator because an unused capability leaves one line of
code preventing its use.

⚠️ **BR-20.8 would not have protected `rules.json`, and that is worth knowing independently of this
decision.** Its last-known-good path reloads the previous rule set when a new file **fails to parse**.
A file truncated to valid-but-empty JSON **parses successfully**, so it would be accepted as a
deliberate empty rule set rather than rejected.

⚠️ **`data/` was rejected because of RESTORE, not because of tidiness.** Today `backup-history.mjs`
copies only `history.db*`. But **W-5** is specified as a *full-inventory* backup of `data/`. Once that
exists, restoring a week-old backup would also restore the week-old automation latch — **so if
automation was armed then and has since been turned off, the restore turns it back on and nothing says
so.** `requirements.md` W-5 now records that the state file must **not** be backed up: a kill switch
recoverable from an archive is not reliably off.

### ✅ The user's AI-rules question, answered: it strengthens C rather than weakening it

The user asked whether the planned move to an AI-authored rule system — after which `rules.json` will
eventually need to be writable by *some* app — changes the recommendation. **It does not:**

1. The future change stays a one-word edit (`./config:/config:ro` → `:rw`) in the unit that adds rule
   editing. C declines to pre-pay for it; it does not obstruct it.
2. The two files want different permissions even once both are writable — one is a machine-written
   safety latch, the other is authored intent, changed rarely and costly to lose.
3. "Eventually" is an unbounded window, and BR-30's argument applies throughout it.
4. ⚠️ **The strongest reason, and it is specific to that plan: a kill switch stored in the same
   writable directory as the file an AI agent edits is a kill switch that agent can disable** — by a bug
   or a bad generation pass. **That argument gets stronger as the rule author becomes less predictable.**

⚠️ And if the rule system becomes a *separate app*, separate mounts express it cleanly: this app holds
`state:rw` + `config:ro`, the rules app holds `config:rw`. Under option A this app would hold a write
permission it never exercises while a different process does the writing.

### FD documents AMENDED as a consequence

Q1 = C made four FD statements wrong, and they were corrected rather than left to be discovered:

| Document | Was | Now |
|---|---|---|
| `business-rules.md` BR-34.1 | `config/automation-state.json` | **`/state/automation-state.json`** |
| `business-rules.md` BR-34.3/34.4 | *"`config/` … must become `:rw`"* | **`./state:/state:rw` is new; `config/` stays `:ro`** |
| `business-rules.md` header summary | *"kill switch in `config/`"* | **`/state/`** |
| `domain-entities.md` §2 | *"the first unit that writes to `config/`"* | **writes to `./state`; `config/` untouched** |
| `frontend-components.md` §2 | read from `config/…` | read from **`/state/…`** |
| `nfr-design/logical-components.md` LC-29 | `config/…` | **`/state/…`** |
| `requirements.md` W-5 inventory | `config/automation-state.json` | **`state/…`, and must NOT be backed up** |

⚠️ **The latent-failure warning moved with the file rather than disappearing.** An unwritable `./state`
still presents as *a kill switch that works in the UI and does not persist* — the worst failure mode
this control could have. `probeWritable` (LC-29) tests it at startup, and verification must write
**through the container**, never on the host.

### ⚠️ The `compose.yaml` comment is now right in outcome and wrong in reasoning

It says `:rw` arrives *"in the unit that adds **RULE EDITING**, and not before."* Under Q1 = C that
**conclusion is correct** — U5 writes nothing to `config/`. **But the reasoning implies rule editing is
the only thing that could make the directory writable**, which is what sent this plan looking for a
`:rw` change in the first place.

⚠️ **That comment has now been wrong twice in different ways**: it named the wrong **unit** in
2026-09-21 (*"becomes `:rw` at U4"*, and U4 had no editor), and the wrong **reason** now. The rule to
state instead is narrower and does not decay: **`config/` holds user-authored intent and the app never
writes it; app-written state lives in `./state`.** Correction to apply at code generation.

### Q2–Q6, briefly

- **Q2 = A**: migration 007 runs automatically at startup. Running it by hand against a stopped
  container was rejected — during U4 a maintenance script wrote to `history.db` alongside the container
  and corrupted an index, and the guard meant to catch that **could not see the container** until
  2026-09-29. The app at startup is the one writer we can be certain is alone.
- **Q3 = A**: rollback is **verified live**, not read from the code. ⚠️ The skip line proves *007 is
  skipped*; it does not prove *U4's code runs correctly against an unread table and three unread
  columns*. Separate claims, and the rollback guarantee is the second. Run it against a **copy**.
- **Q4 = A**: `MAX_CONSECUTIVE_RULE_SKIPS = 3` and `MAX_RULE_SKIPS_PER_HOUR = 10` are **constants in
  source**, not env values — an explicit exception to this project's habit, since `compose.yaml` already
  holds three operational numbers. ⚠️ The halt is reachable in normal use: the busiest hour held
  **27 plays**, so 10/hour trips on any rule matching **>37%** of tracks. If the number were a one-line
  edit, the easy response to a halt would be to raise it, after which it never fires again.
- **Q5 = A**: automation state survives a restart. ⚠️ **So once armed, a reboot resumes skipping**,
  unattended, on the autostart chain. FR-47's *"off by default"* means fresh install, not fresh boot.
  Requiring re-arming was rejected because the app runs unattended and the machine sleeps dozens of
  times a week — automation would be off most of the time **without saying so**.
- **Q6 = A**: M1–M4 on `/api/diagnostics` only. **No new route, no new WebSocket surface.** A second
  route would duplicate the local-access check, which is what caused the WebSocket `403`.

### Still open, and none of it is design work

1. The two `compose.yaml` comment corrections, at code generation.
2. ⚠️ **The live rollback check** — U4's image against a v7 copy, expecting `from: 7, to: 7`.
3. ⚠️ **The BR-35 pre-registration**, which must be written before any rule is armed.

### Verified

**891 tests · typecheck clean · `src/` untouched · `src/playback/` still absent.** Documentation-only,
as every U5 stage has been. **Next: the Code Generation plan.**

---

## 2026-10-01 — U5 Code Generation plan written; all three design stages complete

**Stage**: CONSTRUCTION — Code Generation, U5.
[`../plans/u5-code-generation-plan.md`](../plans/u5-code-generation-plan.md) — 13 steps,
2 scoping questions open. **`src/` is still untouched.**

### Two scoping questions, both found by reading the code rather than the designs

**Q1 — `DecisionExecutor` is declared inside `src/rules/LoggingExecutor.ts:24`.** So `SkipExecutor`
would have to import the interface from the *other implementation's* module.

⚠️ **That is not merely untidy; it contradicts BR-30 in the import graph.** BR-30 says `SkipExecutor` is
*added alongside, never grown out of* `LoggingExecutor`, and an import edge between them says the
opposite to any reader — including the **P-33 structural test**, which has to distinguish *imports the
interface* from *imports the other implementation*. Recommendation: move the interface and
`ExecutionContext` to `src/rules/types.ts`, a pure type move with no behavioural risk, so the test can
be stated as *nothing in `src/rules/` imports `src/playback/`* without an exception clause.
⚠️ **Declaring a second copy in `src/playback/` was explicitly rejected** — two declarations of one
contract drift, which is the WebSocket `403` defect exactly.

**Q2 — confirming that two off switches is deliberate.** `SKIP_EXECUTOR_ENABLED` decides whether
`SkipExecutor` is **constructed** (deployment-time, restart required, checked once at startup);
`globalAutomationEnabled` decides whether a queued attempt **fires** (runtime, checked at the action
point, every attempt).

⚠️ **They read as redundant and are not**, and the risk is a later session "simplifying" by deleting
one. Collapsing them **breaks FR-38**: a restart-requiring control cannot satisfy *"no skip is issued
after the switch is thrown."* ⚠️ **And dropping the env flag loses the ability to deploy U5 inert** —
which is how BR-40.1's dry-run review happens with the action path never constructed at all.

### Ordering: the action point is written before anything can reach it

Pure → storage → **action point (Step 6)** → wiring (Step 9) → UI. `skipDrain` is fully tested against a
fake player client before `server.ts` ever constructs the real one, and **the app's behaviour is
unchanged until Step 9**.

### The phase guard U4 relied on retires, and two structural tests replace it

U4's guard was *`src/playback/` does not exist*. Step 12 asserts instead: nothing in `src/rules/` imports
`src/playback/` · only `SkipExecutor` imports `src/playback/` · **`spotifyPlayerClient`'s exported
surface is exactly one method** · `LoggingExecutor.length === 1` still passes.

⚠️ **The one-method rule is asserted on the client's exported shape, not via the orphan check**, because
`noOrphanModules.test.ts` walks **modules, not methods** — `recordSuccessorLag` and
`updateSkipAttribution` had zero callers for their entire lives inside a heavily-executed file and the
check was satisfied throughout. **A second method would be invisible to it.**

### Three items that code generation must not close by implication

1. The two `compose.yaml` comment corrections — the `:rw` **reason**, and the inode hazard moving to
   `./state`.
2. ⚠️ **The live rollback check**: U4's image against a **v7 copy**, expecting `from: 7, to: 7`. Reading
   the skip line proves *007 is skipped*, not *U4's code runs correctly against an unread table and
   three unread columns*.
3. ⚠️ **The BR-35 pre-registration**, written before any rule is armed — carried on the FD plan's
   checklist since 2026-09-26.

### What CI still cannot close

1. **The dry-run review** that arms the first rule — BR-40.1's actual gate.
2. **The first real skip, heard by the user**, confirming it costs 2–3 s rather than 18–41 s.
3. **`probeWritable` against the real `/state` mount**, verified through the container — on the host the
   write succeeds and the bug is invisible.

⚠️ **Three separate U2 defects all passed the full suite** and were found only by running the system and
watching a real failure get *recorded*. **U5's equivalent failure is audible.**

### Verified

**891 tests · typecheck clean · `src/` untouched · `src/playback/` still absent.** Every U5 stage so far
has been documentation-only, and the phase boundary is intact going into code generation.

## 2026-10-02 — U5 step 10: WIRED. The phase boundary is now a test, not a repository fact

**1162 tests · typecheck clean · schema still v6 · 878 plays · container up 47 h, healthy and recording.**

`src/playback/` is now reachable from the running process. U3's containment guarantee was *"`git status
src/` shows only `src/rules/`"* and U4's was *"`src/playback/` does not exist"*. **Both are spent.** What
replaces them is `test/playbackBoundary.test.ts`, which asserts over the source text:

- nothing under `src/rules/` **imports** `src/playback/` (P-33),
- `SpotifyPlayerClient.prototype` exposes **exactly `skipToNext`**, and the module names no other
  `/me/player/*` endpoint,
- `new SkipDrain(` appears **once**, with both entry points calling that one drain,
- `sweepOrphaned()` precedes `new SkipExecutor(` in file order (P-29's ordering *is* the guarantee).

⚠️ **The import check strips comments first, and that is load-bearing.** `LoggingExecutor.ts` and
`DecisionLogRepository.ts` both *discuss* `src/playback/` at length, explaining the very rule the test
enforces. A naive `includes('playback/')` fails on them — and the natural "fix" is to delete the
sentences rather than the import. There is a second test asserting that those files still mention it,
so the first cannot pass by the two trees simply never meeting.

### 🔧 A defect found in review, not by a test: `attachPlayId` had TWO call sites

The first draft called `skipAttempts.attachPlayId` from `PlayObserver`'s `onPlayRecorded` hook, reading
the evaluation id from `coordinator.inProgress`. ⚠️ **`EvaluationCoordinator.onPlayRecorded` guards with
`play.trackId === trackId && play.decided` — and the hook-side copy had no such check.** `onPlayRecorded`
fires when a play **closes**, by which point `#current` may already be the next track, so on a fast
transition it would have attached the **closing play's `play_id` to the NEXT play's attempt row**.

**Fixed by removing the second copy, not by adding the missing term**: both links now travel through the
`attachPlayId` callback the coordinator already gates, so there is one rule and one call site. P-33 is
unaffected — the coordinator only knows it was handed a function.

⚠️ **This is the WebSocket `403` shape for the fourth time in this project**: one admission rule
implemented twice, with the second copy missing a term. It would have passed the suite, and the damage
is a *plausible* wrong join rather than a crash. The pin is now structural (`one rule, one call site`),
because the thing being prevented is a future edit.

⚠️ **It was also not load-bearing, and that nearly hid it.** The one-attempt guard keys on
`evaluationId` and never reads `play_id`. A mis-attached id costs a convenient join and nothing else —
which is exactly why nobody would have noticed, and why `successor_lag_ms` sat `null` on 662 rows.

### `automationDiagnosticSteps` was EXTRACTED so its branches are reachable from a test

`diagnostics.ts` is in `ALLOWED_ORPHANS` — it reaches for the MCP client, the Web API and the
credentials file, so no test loads it. Inlining U5's five steps would have put **the halt banner, the
unwritable-`/state` fault and the stale-queue threshold** inside that untested region: live, reachable
code covered by nothing. The new function takes **plain data only** — no clients, no clock, no
filesystem — and `automationDiagnostics.test.ts` drives every branch, including the `fail` ones.

⚠️ **A state no test can enter is the `recordSuccessorLag` trap**, and the same instruction already
stands for FC-U5-1's `failed` state in step 11.

What the steps assert, and why each distinction exists:

| Condition | Status | Why not the other thing |
|---|---|---|
| `globalAutomationEnabled: false` | **ok** | FR-47's default. A red cross trains the reader to ignore red crosses on the page where the harmful unit reports itself |
| a standing `runawayHalt` | **fail** | It clears only on explicit acknowledgement, so green would hide the one thing the user must act on |
| `/state` unwritable, executor built | **fail** | The switch would appear to change in the UI and not persist |
| `/state` unwritable, executor **not** built | **skip** | Harmless if nothing can write it; a cross for an unused mount devalues the real one above |
| queue depth > 0, oldest < 60 s | **ok** | ⚠️ Depth is **not** the signal — a depth of 1 is the normal second between decision and `POST` |
| oldest queued > 60 s | **fail** | The drain runs from the 3 s tick too, so 60 s is ~20 missed ticks: it is not running |
| last attempt `refused` | **ok** | Most refusals **are** the system working — `automation-off`, `already-attempted`, `no-active-device` |

⚠️ **`QUEUE_STALE_MS = 60_000` is arbitrary and is documented as such.** It is a liveness heuristic for a
human reading a page; nothing measured depends on it. **Contrast `maxUnobservedTailMs`, which must not be
tuned.** Recording the difference is the point — a project that has one pre-registered constant and one
adjustable one needs to say which is which at each site.

### The control surface: three routes, and the first WRITE this app has ever exposed

`GET /api/automation` · `POST /api/automation` · `POST /api/automation/acknowledge-halt`, all in
`api.ts` with collaborators injected, including `now`. Every other route in this app reads, and the one
apparent exception — `POST /api/rules/reload` — re-*reads*. Decisions worth recording:

- ⚠️ **Every response is READ BACK FROM DISK, never echoed from the request.** A failed write returns
  **503 carrying the previous value**. An optimistic echo would draw the switch as *on* over a read-only
  `/state` — the one case where the user most needs to know it did not take.
- ⚠️ **Arming while halted is `409`, and writes nothing.** A latch cleared as a side effect of flipping a
  switch is not an acknowledgement (BR-35.6).
- ⚠️ **Disarming while halted still succeeds**, and leaves the halt standing. Turning automation off must
  work in every state the app can reach; disarming is not acknowledging.
- ⚠️ **`reArm` has no default.** *"I have reviewed this"* and *"turn automation back on"* are different
  statements (BR-35.5), so a missing field is `400` rather than a guess.
- ⚠️ **Acknowledging when nothing is halted is `409`, not an idempotent success.** Otherwise
  `{reArm: true}` is a second path to `globalAutomationEnabled: true` that skips the check the other
  route makes. The body carries the real state so the UI re-renders rather than showing an unexplainable
  error.
- ⚠️ **`enabled` must be a boolean.** `'false'`, `0` and `null` are all coercible, on the surface that
  decides whether this app touches playback.
- **The route computes no state name.** FC-U5-1's seven states are derived in `statusBar.ts`, which is
  pure and tested. A server-named state cannot be driven into that state by a test, and gives the client
  a second opinion to disagree with.

**M1–M4 ride on `/api/diagnostics`** alongside `steps`, for the same reason `coverage` does: *1,216
Spotify requests in the last hour* is neither a tick nor a cross, and Spotify publishes no limit to
compare it against. **No metrics route and no new WebSocket surface** (Infrastructure Q6).

### Two off switches, still not redundant

| | answers | changing it | checked |
|---|---|---|---|
| `SKIP_EXECUTOR_ENABLED` | *is the skip machinery built at all?* | `compose.yaml` + restart | once, at startup |
| `globalAutomationEnabled` | *may a built attempt fire?* | one UI click | every attempt, at the action point |

With the first unset, **nothing is constructed**: no player client, no drain, no attempt rows. That is
how U5 ships **inert** for the dry-run review, which is BR-40.1's actual arming gate. `GET
/api/automation` reports both, so the UI can say *the machinery is not built* instead of drawing a switch
that would do nothing if thrown.

### `context_type` and `context_uri` are populated on the live path for the first time

Fetched **once per track** from `GET /me/player/currently-playing` — ~16 requests/hour against the
poll's 1,200. ⚠️ `null` on a track's first tick, because the fetch has not returned; the play row is not
written until the play **closes**, by which time the value has arrived. **Evidence only, never a rule
input** (BR-41.3/41.5).

### M4 is recorded on EVERY tick, including the ones that find nothing

An early return on *nothing playing* would delete the signal the metric exists to produce. ⚠️ **"No new
play rows" cannot distinguish *polling and hearing silence* from *not polling at all*** — and the
2026-09-30 outage ran ~13 hours unnoticed for exactly that reason. A high idle share with a non-zero
total says the instrument is alive; a total of **zero** says it is down.

### Verified, and what is NOT

**1162 tests · typecheck clean.** `skip_attempt` does **not** exist in `data/history.db`, the live
schema is still **v6**, and the container is running the **old image** — so none of this code is
executing against the corpus yet. Migration 007 runs at step 13, after the verified backup.

**Still open, unchanged by this step:** the two `compose.yaml` comment corrections · the **live rollback
check** (U4's image against a v7 copy, expecting `from: 7, to: 7`) · the **BR-35 pre-registration**,
in writing before any rule is armed.

⚠️ **`probeWritable` has still never run against the real `/state` mount.** On the host the write
succeeds, so the bug this probe exists to catch is invisible until it is run **through the container**.

## 2026-10-02 — U5 step 11: the UI, and the discovery that "put the judgement in `src/`" has a harder meaning than it reads

**1219 tests · typecheck clean · schema still v6 · container still on the U4 image.**

FC-U5-1, FC-U5-2 and FC-U5-3 are built. `IndicatorLevel` widened by five members, and **the compiler
named every site that had to change** — five `statusBar({…})` literals in `statusBar.test.ts` — which is
the no-`default:` pattern doing exactly its job. No `default:` was added.

### ⚠️ `public/app.js` CANNOT IMPORT FROM `src/`, and that changes what the FD's rule can mean

The FD says the judgement goes in a tested module and the DOM wiring goes in `app.js`. For FC-U5-1 that
was already satisfied by accident: indicators are derived server-side and **arrive pre-derived on the
WebSocket snapshot**.

⚠️ **FC-U5-2 has no snapshot.** The kill switch is driven by `GET /api/automation`, and `app.js` is a
browser script served statically with **no bundler** — so there is no import to make. The choice was:

1. derive the button's label / `disabled` / warning **in `app.js`** — putting *"a kill switch that works in
   the UI and does not persist"*, the documented worst case for this exact control, in the one file
   nothing can test; or
2. derive it in `src/ui/automationPanel.ts` and **have the route ship it**.

**Option 2.** `/api/automation` now returns `view` and `haltPanel` *alongside* the raw facts. ⚠️ **The
facts are kept, not replaced** — `enabled`, `halt`, `source`, `writable` are what a script or a probe
wants, and dropping them would leave the route testable only through its own prose.

⚠️ **An earlier comment in `api.ts` claimed this route "computes no state name" — amended, because it now
computes the panel's view.** What stays true is narrower and worth stating precisely: **FC-U5-1's seven
states are still named only by `automationIndicator`**, and travel on the snapshot, because that
indicator belongs to the status bar rather than to this panel.

### ⚠️ One judgement genuinely exists twice, and it is now pinned

`app.js` assembles the indicator array itself, because the **Connection** dot's input is the browser's own
socket state and no server can know it. So the *message precedence* — which indicator owns the single
message slot — exists in both files. It already did, for `fail`.

`test/statusBarPrecedence.test.ts` reads **both files** and fails if the orderings disagree. ⚠️ **This is
the WebSocket `403` shape pre-empted**: one admission rule written twice, with `TRUST_PUBLISHED_PORT`
added to one copy only, and **all 411 tests passing** because they exercised the policy function and
nothing exercised the copy. `attachPlayId` repeated the shape in step 10, found by reading.

### `fail` outranks `halted`, and the reason is duration

Two passes, not one. A halt **clears only on a deliberate acknowledgement**, so it can stand for days — a
single pass accepting either level would let it permanently occupy the one message slot and hide every
later fault, including a Recording failure, which is the only one that loses something unrecreatable.
⚠️ And the automation dot sits **last**, so position alone would not have saved it.

### The seven states, and the two distinctions that would have been collapsed

| State | Level | Glyph | What it would have been wrongly merged with |
|---|---|---|---|
| idle | `idle` | `·` | ⚠️ `ok` — which would claim a decision was made |
| disabled | `disabled` | `⊘` | `warn` — but this is the FR-47 default, not a fault |
| hold | `hold` | `…` | `warn` — holding is the feature working |
| passed-partial | `passed-partial` | `◎` | ⚠️ **`ok` — which would hide that a fact never arrived** |
| passed | `ok` | `●` | — |
| failed | `fail` | `✕` | — |
| halted | `halted` | `‼` | ⚠️ **`fail` — *the system protected you* is not *something is broken*** |

⚠️ **`passed-partial` is why the glyphs are load-bearing rather than decorative.** The user's palette put
*Green-passed* beside *Yellowgreen-passed-with-missing-info* — **the hardest pair in it to tell apart**,
and the pair where being wrong means believing a decision rested on facts that never arrived. `●` against
`◎` carries it with no colour at all.

⚠️ **A second test asserts no glyph is an emoji.** An emoji renders at a different size and baseline from
the geometric shapes, so the whole row would visibly jump on a state change, and colour fonts vary by
platform. `halted` gets a **background badge** instead of a louder hue, because it sits next to `fail` in
the palette and hue alone would make two states that demand *different actions* nearly interchangeable.

⚠️ **Sustained motion on `fail` and `halted` only.** The FD recommends against flashing as a general state
channel — accessibility hazard on an always-on display, cannot encode seven states, and any motion reads
as *something is wrong* regardless of which state is moving. These are the two where demanding attention
is the point, and `prefers-reduced-motion` still removes it.

### `disabled` has THREE causes and three different details

The machinery is not built · the switch is off · every rule is dry-run or disabled. A test asserts the
three details are **distinct strings**. ⚠️ **A rule set of ten dry-run rules looks busy in `Rules v#` and
can skip nothing**, and the honest word for that is *off* — `idle` would wrongly suggest armed and
waiting.

⚠️ And *off* does **not** mean *doing nothing*: rules are still evaluated and logged, which is the whole of
U4. The label says so.

### 🔧 Two defects found while building this

**1. `switchView`'s *machinery not built* branch hard-coded `warning: null`.** So a **failed save vanished
behind the greyed control** — the user presses a button, the write fails, and the only channel that would
have said so was suppressed. ⚠️ `explanation` and `warning` are **separate channels**: the first says why
the button is dead, the second says something went wrong, and the user had just caused the second. Caught
by a route test, pinned by a panel test.

**2. `decorate()` called `statusIndicators()` TWICE per tick.** Pre-existing and harmless while every
input was an in-memory counter. ⚠️ **No longer**: from U5 the automation indicator **reads the state file
and queries `skip_attempt`**, so the second call doubled both on every 3-second tick. ⚠️ **And the two
calls could have DISAGREED**, since the file can change between them — a payload whose dot and whose
message came from different reads of the same question. Same family as the duplicated `attachPlayId`: a
second invocation of something that was supposed to happen once.

### Why the state file is re-read on every tick, deliberately

One small file read every 3 s, against the **1,200 Spotify requests/hour** the poll already spends. The
alternative is a dot that lags the switch — and *an indicator reading cached state* is the documented
worst case one layer up. The drain re-reads at the action point for the same reason.

### ⚠️ NOT VERIFIED BY CLICKING, and that is where this component's defects live

**Both** real defects ever found in `app.js` — the liked-refresh race and *"every axis tick says Aug"* —
were found by a human **using the page**, not by a test. The container still runs the **U4 image**, so
none of this UI is reachable. The structural tests pin the contract (`app.js` keeps no optimistic state,
takes label/`disabled`/warning from the server, names none of the seven states itself); they cannot
confirm it renders.

**The click-through belongs to step 13**, against the real `/state` mount — and ⚠️ **it must be verified
THROUGH THE CONTAINER**, because on the host the write succeeds and the bug is invisible.

## 2026-10-03 — U5 step 12: the two CI guards, and the smoke test that shipped the defect it exists to catch

**1228 tests · typecheck clean · `npm run smoke` green · `npm run knip` clean · schema still v6.**
`npm run verify` = typecheck + test + smoke + knip, and all four stages pass.

### 🔧 The smoke runner's FIRST DRAFT contained the exact failure mode it was built to prevent

`scripts/smoke-entry-points.mjs` exists because **`scripts/` is outside every guard** —
`noOrphanModules.test.ts` walks `src/` only, and `npm run reclassify` was dead for a week while 891 tests
stayed green. Its job is to invoke each script's safe mode and fail if one cannot start.

⚠️ **The first draft invoked `backup-history.mjs --label smoke-test-dry-run --dry-run`. That script has
no `--dry-run` flag.** The argument was silently ignored. The run came back green **only because the
container was up and the `docker ps` guard refused** — with the container down, a CI check would have
written a real backup directory on every run.

⚠️ **And it ran three genuine writers**, because *"safe mode"* was assumed rather than checked:

| Script | What it actually did |
|---|---|
| `build-reporting-db.mjs` | rebuilt `data/reporting/reporting.db` |
| `resolve-artist-credits.mjs` | rewrote `data/artist-credits.json`, and would have made a live `GET /tracks/{id}` per uncached track |
| `metabase-setup.mjs` | POSTed `/api/database` and a schema sync to the running Metabase |

**Verified afterwards: `history.db` and its WAL were NOT touched** (mtimes still 2026-10-02 20:50 and
21:11), and **zero upstream requests were spent** — because the credit cache happened to be warm.
⚠️ **That is luck, not design.** Cold, the same run would have spent hundreds of Spotify requests.

**Fixed two ways.** Writers are **skipped with a reason**, not invoked and hoped about. And every flag in
the table is now checked against the target script's own source before the script runs — with a
`--self-test` that proves the guard rejects an unknown flag, because *a guard that never fires is
decorative* and this project has already shipped two of those.

> ⚠️ **The lesson is not "check your flags".** It is that the NFR plan's warning was **literal** and I
> read it as a caution: *"`--apply` paths stay out of CI — several of these are writers, and CI is not a
> place to discover that."* I built the thing that discovers it in CI. **An unrecognised flag is the worst
> kind of argument, because the run comes back green** — same family as the `inc=releases` 200 and the
> lock probe that could not see the container.

### ⚠️ A non-zero exit is NOT a failure, and that is the design

`backup-history.mjs` exits 2 while the container is up; `measure-confound.mjs` exits 2 against a
post-retirement database; three probes exit 1. **Every one of those is a guard working.** A smoke test
demanding exit 0 would either fail on a healthy machine or pressure someone into weakening a guard. So
the discriminator is **did the module LOAD** — `SyntaxError`, `ERR_MODULE_NOT_FOUND`,
`does not provide an export named`, `ReferenceError`. The third of those is the reclassify breakage
exactly, and ⚠️ **`node --check` would not have caught it**: a missing named export is a *link-time*
failure, not a parse error.

⚠️ **`backup-history.mjs` is skipped and its load check is NOT lost**, because
`restore-history.mjs --self-test` and `reclassify-unobserved-tails.mjs` both import
`assertNobodyElseHoldsIt` from it, so its module body is evaluated either way.

### knip found four dead exports and one undeclared dependency on its FIRST RUN, and none was noise

The NFR plan predicted *"expect a first run to be noisy, and expect some of that noise to be real."* It
was not noisy — five findings, all real:

| Finding | Verdict |
|---|---|
| `PLAY_BUCKETS` (`playStats.ts`) | ⚠️ **Worse than dead.** Removed — see below |
| `STATES_THAT_REACHED_THE_PLAYER` | An alias of `REACHED_THE_PLAYER`, exported in step 5, imported by nothing. Removed |
| `export type { DecisionTrigger }` (`decisionRows.ts`) | A compatibility shim from the U5 move with no consumer. Removed |
| `export type { DecisionExecutor, ExecutionContext }` (`LoggingExecutor.ts`) | The same shim; every caller takes them from `./types.js`. Removed |
| `ajv/dist/2020.js` in `check-rules-schema.mjs` | **Undeclared dependency.** Now a devDependency |

⚠️ **`PLAY_BUCKETS` is the one worth understanding.** It declared *"the four display buckets, in stack
order"* and **nothing had ever imported it.** The order it claimed to own actually lives in
`public/app.js` as `DRAWN_SERIES`, which carries a label and a fill per bucket and **deliberately omits
`not-observed` from the plot** while still counting it everywhere else. So it was not merely dead: it read
as the source of truth for a stack order a different file decides, and **the two could have diverged
silently.** The same shape as the message precedence pinned in step 11 — except this copy had no consumer
at all, which is why nobody noticed. The `PlayBucket` *type* is unaffected.

⚠️ **The `ajv` finding is the reclassify class.** `npm run check:rules-schema` imported a package the
project never declared, working only by hoisting from `@modelcontextprotocol/sdk`. ✅ **The script already
failed closed** — *"Refusing to skip: a check that quietly does nothing is worse than one that is
absent"*, exit 2 — so it was never going to pass by not running. But it would have stopped working the
moment the SDK changed its tree. Declared now.

⚠️ **knip introduced no vulnerabilities.** `npm audit` reports 4 (1 high, 3 moderate) and **all of them
are pre-existing**, from `@modelcontextprotocol/sdk` (`fast-uri`, `hono`, `ip-address`) and `express`
(`qs`). Worth stating precisely, because the audit output appears immediately after the install and reads
as though the install caused it. Both new dev dependencies are pruned from the image —
`npm prune --omit=dev` in the Dockerfile.

### 🔧 PBT-35, PBT-36 and PBT-38 were covered and named by nothing

All seventeen U5 obligations were behaviourally discharged. **Three were labelled nowhere**: PBT-35 and
PBT-38 by rows of `skipDrain.test.ts`'s refusal table, PBT-36 by four rows of
`automationPredicate.test.ts`'s sixteen-combination enumeration.

**The behaviour was right; the traceability was absent** — and an obligation satisfied by a row nobody has
labelled is one that survives a refactor of the table **by accident**. Labels added. PBT-36's second half
(BR-33.3, *a rule cannot opt out of a global dry-run*) is now asserted directly rather than left implicit.

✅ **`test/propertyObligations.test.ts`** reads the obligations table from `logical-components.md` and fails
if a declared PBT is named by no test. It also checks the range **PBT-34 … PBT-50** has no gaps, so a row
cannot be deleted instead of discharged.

⚠️ **IT EXCLUDES ITSELF FROM THE SEARCH, and that is load-bearing.** Its own docstring names PBT-35,
PBT-36 and PBT-38 while explaining why they needed labels — so without the exclusion, **deleting those
labels from the real tests would leave the check green, satisfied by its own prose.** A check whose input
includes its own output reports success exactly when it is useless: the same family as *a guard computed
the same way as the thing it guards is not a guard*, and as the lock probe. The exclusion is itself
asserted, twice.

⚠️ **And it states what it does NOT prove**: that a reference is *honest*. A `PBT-41` comment above a test
that asserts nothing would satisfy it. That limit is written in the file rather than left for someone to
discover.

### `upstreamMetrics` was missing from `PURE_MODULES`

Added. ⚠️ It holds mutable records, which is **not** impurity: every window is a function of
`(records, nowMs)` and `nowMs` is a **parameter**. PBT-50 asserts the answer moves when the parameter
moves; `purity.test.ts` is what stops a `Date.now()` being added inside — **in the one metric whose job is
to prove this app is a good citizen of the vendor APIs.** ⚠️ The plan also named `armingProjection`, which
does not exist: that derivation became `ui/automationPanel.ts` in step 11, and is listed.

### Still open, unchanged

The two `compose.yaml` comment corrections · the **live rollback check** (U4's image against a v7 copy,
expecting `from: 7, to: 7`) · the **BR-35 pre-registration**, in writing before any rule is armed · and
the **click-through of step 11's UI**, which must be done through the container.

⚠️ **W-6 is NOT closed by this.** These two are *guards*, not the analysis: mutation testing,
BR-derived tests, the negative-control convention and container-parity probes remain W-6, and W-6.2 wants
BR-33…BR-43 backed by shipped code, which is the end of this unit.

## 2026-10-03 — U5 step 13: DEPLOYED, schema v7, and shipped INERT on purpose

**1228 tests · typecheck clean · `npm run smoke` green · `npm run knip` clean · schema **v7** ·
`integrity_check: ok` · **885 plays** · 987 decision rows · **0 skip attempts**.**

`migrated 7:` appears in the startup log **exactly once**. The container is live on the new image.

⚠️ **NOTHING CAN SKIP A TRACK, and that is the delivered state.** `SKIP_EXECUTOR_ENABLED: "false"`
means `SkipExecutor` is **never constructed** — no player client, no drain, no attempt rows — while the
rules engine evaluates and logs exactly as in U4. **This is BR-40.1's arming gate**, not an oversight:
U5 ships inert so the dry-run log can be reviewed before anything acts.

### Order of operations, recorded because it is the part that cannot be redone

1. `compose.yaml`: `+ ./state:/state:rw`, two env values, **both comment corrections**.
2. `docker compose down` — the container holds `history.db` open and **SQLite's locks do not cross the
   bind mount**, so this is the only real protection.
3. **Backup + verify**, before any schema change: `backup-before-migration-007-deploy-20261003T135418Z`,
   schema v6, 879 plays, **all eight checks pass**.
4. **Tag U4's image** `spotify-now-playing:u4-rollback` — ⚠️ *before* the rebuild overwrote `:0.1.0`.
   Without this, the rollback check would have had nothing to roll back to.
5. `docker compose build` — exit code checked **directly**, not through a pipe.
6. **Rollback verified on a throwaway v7 copy**, before the real database was touched.
7. `docker compose up -d` → migration 007 → verification.

### ⚠️ ROLLBACK IS VERIFIED BY A WRITE, not by reading the skip line

The plan's warning was specific: *"Reading the skip line proves 007 is skipped, not that U4's code runs
correctly against an unread table and three unread columns."*

Against a v7 copy, U4's image:

- reports `{from: 7, to: 7, applied: []}` — 007 skipped, nothing downgraded
- reads everything: `listPlays`, `getTrail`, `decisionLog.list`, `count`, `coverage`, `trackPlayStats`
- ⚠️ **INSERTs into a v7 `decision_log` successfully**, and `trigger` **defaults to `'initial'`**
- `integrity_check: ok` after that write

⚠️ **That default is the whole clause.** U4's INSERT names 20 columns and omits `trigger`; had migration
007 added it `NOT NULL` with no default, **rollback would have been impossible to use** — the old image
would start, read fine, and fail on the first decision it tried to record. Which is the worst shape: a
rollback that appears to work.

### ⚠️ THE INODE HAZARD IS NOW EVIDENCE, after two units of being inference

`compose.yaml` has warned since U3 that *a single-file bind mount binds an INODE*, and that
write-temp-then-rename **replaces** the inode. U3 and U4 only ever read their config, so the warning
could not be tested.

**`AutomationStateStore.write` is the first code in this project that does that rename into a mount.**
After flipping the kill switch, the **host and the container see identical file content** — so the
directory mount is what makes it work, and a single-file mount would have detached the container's view
on the **first** kill-switch change. ✅ Measured, not reasoned.

### The third non-CI exit criterion is CLOSED

*"`probeWritable` against the real `/state` mount, verified through the container — on the host the
write succeeds and the bug is invisible."*

- `/api/diagnostics` reports **`/state/automation-state.json · writable`**, probed by the app **as its
  own `node` user**. ⚠️ A `docker exec` check ran as **root** and was therefore meaningless; the app's
  own probe is the authoritative one.
- The switch was written and read back **in both directions** — `false → true → false` — each response
  carrying the value **read back from disk**, with `source` moving `absent → file`.
- ⚠️ **Safe to exercise with automation still unarmable**: `SKIP_EXECUTOR_ENABLED` is false, so no
  executor exists and no skip could fire whatever the switch momentarily said. Automation ends **off**.

**Still open, and neither is a test:** the dry-run review that arms the first rule (BR-40.1), and the
first real skip heard by the user confirming it costs 2–3 s rather than 18–41 s.

### The UI was click-tested through the container, which is where its defects live

Both real defects ever found in `app.js` — the liked-refresh race and *"every axis tick says Aug"* —
were found by a human **using the page**. Driven in Chrome against `localhost:3010`:

- **Five status dots**, automation last: `Automation off` / `disabled` / `⊘`, and the **level is in the
  aria-label**, so the glyph is not the only non-colour channel.
- The Rules pop-up's **Automated skipping** section is first, above the rule set, with the **disabled**
  button, the server-derived label *Automation unavailable*, and the explanation naming
  `SKIP_EXECUTOR_ENABLED` and the restart. No warning, no halt panel — both correct.
- ⚠️ **No console errors or warnings.**
- Route guards live: acknowledge-with-nothing-halted **409**, `enabled: "true"` **400**, `reArm`
  omitted **400**. WebSocket **101** local / **403** cross-site `Origin` — the U4 blind spot still
  guarded both ways.

### 🔧 The `:rw` comment was right in OUTCOME and wrong in REASON — corrected, second time

`compose.yaml` said `:rw` arrives *"in the unit that adds RULE EDITING"*. Under Q1 = C the conclusion
holds — U5 writes nothing to `config/` — but the framing implies **rule editing is the only thing that
could make the directory writable**, and U5 adds app-written state while that mount stays `:ro`. So the
sentence would have invited the wrong change.

The rule now stated, which does not depend on which unit comes next:

> **`./config` holds user-authored intent and the app never writes it. App-written state lives in
> `./state`.**

⚠️ That comment had already been corrected once (2026-09-21) for naming the wrong *unit*. **Leaving the
wrong reason is how it goes stale a third time** — a recorded justification decays exactly like a
recorded negative, because nothing re-tests it.

### ⚠️ A WRONG DENOMINATOR NEARLY WENT INTO THE PRE-REGISTRATION

The BR-35 pre-registration is committed (`fc3240b`) **in its own commit**, ahead of anything that could
arm automation — the same discipline as the hypothesis gate's, committed at `fd09ad7` five days and 240
plays before the comparison it governed. It fixes **3 consecutive / 10 per rolling hour** and **what
would count as evidence that either is wrong**, written while `skip_attempt` held 0 rows.

⚠️ **A draft of its §2 said the broadest armed rule matches 40% of plays, from `76 / 192`.** Both halves
were wrong: the **stale** gate figures (2026-09-10, 427 plays), and the **wrong denominator**. A rule is
evaluated against *every* play, and with `onUnknown: 'no-match'` the **482** plays whose label never
resolved **cannot match** — so they belong in the denominator.

**Re-measured on the live v7 database: 145 of 885 = 16.4%**, against the ~37% needed to trip the hourly
limit at a 27-play peak hour. ⚠️ **That changes which limit to expect:**

- **`10/hour` is NOT expected to trip** on the currently-armed rules — roughly half the trip point.
- **`3 consecutive` IS the one to expect first.** 16.4% overall says nothing about **adjacency**, and
  three consecutive major-label tracks is an ordinary run inside an album. BR-35.9 resets only on a play
  **not** skipped by a rule.

> ⚠️ **This is the project's own denominator warning, inside the one document whose entire value is that
> it was not fitted afterwards.** *"Before reporting any rate, ask what is in the denominator and whether
> every row in it could have been a success."* Recorded in the document rather than quietly corrected —
> and the correction is what makes §3.1 name its denominator explicitly.

### What is now true that was not

| | |
|---|---|
| **FR-33 `hold`** | ✅ **complete.** PARTIAL since U3 — a rule declaring `onUnknown: 'hold'` was stored and *disabled with a reason*. It now holds, bounded by `min(label resolved, 30 000 ms, 50% of duration)` |
| **`context_type` / `context_uri`** | ✅ populated on the **live** path for the first time, once per track. Previously NULL on every live play since v1 while backfilled rows carried it — *available exactly where the outcome variable was not* |
| **M1–M4** | ✅ live on `/api/diagnostics`. ⚠️ Before this, `webApiClient` threw the `Retry-After` away inside a message string, so the app could not say whether it had **ever** been rate-limited |
| **`skip_source`** | Still `user` \| `rule`, untouched since migration 006 — and now something can actually write `'rule'` |

### Still open after this step

1. **The dry-run review** that arms the first rule — the next step, and it is user judgement.
2. **The first real skip, heard.**
3. **W-6** — mutation testing, BR-derived tests, the negative-control convention, container-parity
   probes. ⚠️ `smoke` and `knip` are *guards*, not that analysis. W-6.2 wants BR-33…BR-43 backed by
   shipped code, which is only now true.
4. **W-5** — the full-inventory backup including the `metabase-app-db` **named Docker volume** that no
   tree-walking backup would find. ⚠️ And when it lands, `./state` must stay **outside** it, or a
   history restore re-arms automation.
5. **W-7** — idle poll backoff. Blocked on M1–M4, which now exist, so this is unblocked for the first
   time. ⚠️ It changes the **recording instrument**, which is why it was deliberately not in U5.

## 2026-10-03 — The dry-run review's input: ALL THREE LOADED RULES TRIP THE 3-CONSECUTIVE HALT

Measured read-only over the **329 plays U4 has evaluated** (2026-09-21 → 2026-10-03), reconstructed from
`decision_log.fields_seen`. Nothing was armed and nothing was changed.

### ⚠️ The pre-registration's prediction was right in direction and badly understated in magnitude

Written hours earlier: *"expect `3 consecutive` to trip first, not `10/hour`"*, on the reasoning that
16.4% overall says nothing about adjacency. ✅ Direction confirmed. ⚠️ **But not as an edge case — as the
normal case:**

| armed | would skip | rate | longest run | times it reached 3 |
|---|---|---|---|---|
| `hip-hop` | 85 / 329 | **25.8%** | **9** | **7** |
| `major-label` | 31 / 329 | **9.4%** | **4** | **3** |
| both | 112 / 329 | **34.0%** | **12** | **11** |
| all three | 112 / 329 | 34.0% | 12 | 11 |

⚠️ **Arming `hip-hop` alone would have latched the halt roughly every 1.7 days** over the measured
window. `major-label`, the rule that looked safest on its hourly rate, still reaches 3 three times.

⚠️ **`10/hour` never trips on any of these** — consistent with the pre-registration's 16.4% vs ~37%
arithmetic. The hourly cap is not the binding constraint; **adjacency is**, and nothing before this
measured it.

### Which candidate narrowings actually survive

| candidate | skips | rate | longest run | verdict |
|---|---|---|---|---|
| `hip hop` (as armed) | 85 | 25.8% | 9 | ❌ halts |
| `major` (as armed) | 31 | 9.4% | 4 | ❌ halts |
| **`hip hop AND major`** | **4** | **1.2%** | **1** | ✅ **never halts, and matches something** |
| `major AND age > 5` | 11 | 3.3% | 3 | ❌ halts once |
| `major AND NOT following` | **0** | 0.0% | 0 | ⚠️ never halts because it never matches |
| `hip hop AND NOT following` | **0** | 0.0% | 0 | ⚠️ same |

✅ **`hip hop AND major` is the only candidate that both matches plays and never reaches 3.** That is
what BR-35's remedy looks like in practice: *narrow the rule, do not raise the limit.*

⚠️ **The two `NOT following` variants match ZERO**, and that is a finding rather than a safe option: this
listener follows essentially every artist they play, so `artist.following === false` is an empty
population. A rule that never fires is not a safe rule, it is a rule that does nothing — the same shape
as `old-and-major` below.

### 🔎 `old-and-major` matched 0 of 329 and is NOT broken

Worth recording because *"a rule that matched nothing"* reads as a defect:

- `album.ageYears` resolved on **329 of 329** — the field works, the comparison works.
- Only **1** play is over 20 years old. **Median age is 1 year**; just 3 plays exceed 15.
- The intersection with `label = major` is empty.

The three oldest plays explain it exactly:

| age | track | label |
|---|---|---|
| 23y | *Graveyard* — The Devil Makes Three | `unknown` |
| 18y | *Babylon* — Daron Malakian and Scars on Broadway | **`major`** |
| 16y | *Find The Door* — The Haunted Windchimes | `unknown` |

⚠️ **The 18-year-old track IS major** — so this rule misses its only candidate by **two years of
threshold**, not by any defect. It is correctly narrow against a corpus of new music.

### `hip-hop`'s unknown behaviour, since it is the rule most likely to be armed

**304 of 329** plays have known genres; **25** do not. With `onUnknown: 'no-match'` those 25 are not
skipped, so the rate is **25.8% of all plays** and **28.0% of plays with genres**. ⚠️ If genre coverage
improves the rate drifts toward the second figure — modest headroom, not a cliff.

### ⚠️⚠️ THE LIMITATION THAT BOUNDS EVERY NUMBER ABOVE, and it is worse for adjacency than for rates

**This is a back-test over plays recorded while automation was OFF.** The pre-registration already calls
the arming projection *"a projection, not a prediction"* — but **adjacency is affected far more severely
than a rate is**:

> **Skipping a track changes what plays next.** In the DJ context — 50–70% of listening, and the context
> whose tracks are chosen *as it goes* (P-U5-1) — a skip alters the subsequent selection. So a run of 9
> consecutive matches in un-skipped history **would not have occurred** once the first skip fired: the
> feed would have diverged at play 1.

⚠️ So *"longest run 9"* is **not** a prediction that automation would reach 9. The defensible reading is
narrower and still decisive:

- **A run of ≥ 3 is reachable, repeatedly, and from more than one rule.** That does not depend on what
  the feed would have done afterwards — the first three are already in the record.
- **Everything past 3 is hypothetical**, because the halt would have fired and stopped the sequence.
- **`hits3` assumes immediate re-arming** after each halt. Live, automation stays off until
  acknowledged, so the counts are an upper bound on *occasions requiring acknowledgement*.

⚠️ **Which is also why `hip hop AND major` showing a longest run of 1 is weaker evidence than it looks.**
It says the predicate did not match adjacent plays in *this* history; it cannot say the same would hold
once the feed starts diverging. **It is the best-supported option, not a guarantee.**

### What this does NOT decide

**Which rule to arm, and whether `3` is the right limit.** Both are the user's. ⚠️ And the
pre-registration's §3.2 defines the only path by which `3` may be raised — *three separate halts where
the user affirms all three skips were correct* — so if these halts turn out to be correct skips, that is
**evidence to be gathered under the stated procedure**, not a reason to edit the constant now. The limits
were fixed before any of this was measured, which is the whole point of fixing them then.

Nothing was armed. `skip_attempt` still holds **0 rows**, `SKIP_EXECUTOR_ENABLED` is still `false`, and
`globalAutomationEnabled` is still `false`.

## 2026-10-04 — 🔧 THE 3-CONSECUTIVE RUNAWAY HALT COULD NOT FIRE. Found before arming, fixed.

**Found while answering a user question**, not by a test — they asked whether the next step was to arm
the rules and see three skips, and checking what *three* meant exposed this.

### The defect

`recentPlaysForCounting` derived `skippedByRule` from `play.skip_source === 'rule'`. **Nothing in the
codebase ever wrote `'rule'`.** `PlayObserver.ts:235` hardcoded:

```ts
skipSource: outcome === 'skipped' ? 'user' : null,
```

— a U1 simplification (*"every live-observed skip is the user's"*) that was **sound while nothing else
could skip, and wrong the moment U5 shipped**. Measured on the live database: 56 `'user'`, 831 `null`,
**0 `'rule'`**.

So `skippedByRule` was `false` for every play, `consecutiveRuleSkips` could only ever return `0`, and
**BR-35.1's 3-consecutive halt was inert.**

⚠️ **The hourly cap still worked** — it counts `skip_attempt` rows via `firedSince`, not play rows. But
the 2026-10-03 back-test had already shown `10/hour` never trips on the loaded rules. **So arming
`hip-hop` at a 25.8% match rate would have run with no effective runaway guard at all.**

### ⚠️ Why it passed everything, and why that is the familiar shape

`safetyCounters.ts` is at **100% line, branch and function**, and PBT-46/47 pass. They test the counter
against **supplied** input; **nothing asserted that anything ever supplies `true`.** A column that is
structurally empty reads as *this never happens*.

That is the **`recordSuccessorLag` shape for the third time** — after the two dead writers in a live file
and `npm run reclassify` being unable to start for a week. ⚠️ **And the first time it disabled a safety
limit rather than losing a measurement.**

⚠️ **`knip` did not see it either**, and could not: `skip_source` is both read and written — just never
with that value. Dead-*value* analysis is not dead-code analysis.

⚠️ **The comment directly above the defective line already said so**: *"`user` vs `rule` remains a real
question, and it is U5's."* U5 shipped without it. **A recorded intention is not an implementation**, and
a note sitting immediately above the wrong line did not stop it — the same decay as a recorded negative.

### The fix: `skip_attempt` is the single authority, and the guard does not depend on the label

| | Reads | Why |
|---|---|---|
| **Safety counter** (`recentPlaysForCounting`) | `skip_attempt` **directly** | ⚠️ **A guard that depends on a label is a guard that a labelling bug disables.** Which is exactly what just happened |
| **`skip_source` label** (`PlayObserver`) | `skip_attempt` via `firedDuring` | Denormalised for exports and R1 eligibility |

One SQL definition, `ruleSkippedThisPlay`, **imported rather than re-expressed**.

⚠️ **Keyed on the track and the play's TIME WINDOW, never on `skip_attempt.play_id`.** `play_id` is
backfilled by `attachPlayId`, inside a try/catch that is *explicitly allowed to fail* because it is not
load-bearing. A safety limit reading it would **under-count whenever that backfill failed** — and a halt
that under-counts is a halt that does not fire. Both ends of the window are columns on the play row, so
they cannot be missing.

⚠️ A **repeat listen is a different window**, so it cannot inherit an earlier play's attempt — which a
track-id-only match would have allowed, making every later play of a once-skipped track count toward the
halt.

### `test/ruleSkipAgreement.test.ts` — 9 tests, and what each is for

1. **The counter counts.** A fired attempt makes `skippedByRule` true. *This is the assertion whose
   absence was the entire defect.*
2. **`consecutiveRuleSkips` reaches `MAX_CONSECUTIVE_RULE_SKIPS`** end to end — the halt can fire.
3. **The two call sites agree** over six window cases (inside, absent, before, after, at-start, at-end),
   **and** the expected answers are asserted separately, so *"they agree"* cannot be satisfied by both
   being wrong.
4. **The counter works with `skip_source` still saying `'user'`** — the exact state the corpus was in.
5. **And with `play_id` never backfilled.**
6. A **refused** attempt does not count; an **unconfirmed** one does (P-30: unknown counts as landed).

### What was NOT contaminated

**Nothing.** `skip_attempt` still holds **0 rows** and no rule has ever skipped a track, so no play row
was ever mislabelled. The fix landed **before** the first arming — which is the only reason this is a near
miss rather than a repair.

⚠️ Had it not been caught: rule-skips filed as `skip_source = 'user'`, entering R1's data as genuine
rejections through an `ELIGIBLE` predicate (`outcome IN ('completed','skipped')`) that has **no
`skip_source` guard**. Arm a rule that skips major-label tracks and the corpus then *"shows"* the listener
skipping major-label tracks — **circular by construction**, and in the direction that would appear to
support R1.

### Verified live after the rebuild

1243 tests · typecheck clean · smoke green · knip clean · schema **v7** · `recentPlaysForCounting` runs
against the live database · `enabled: false`, `executorEnabled: true`, `halt: null`, `skip_attempt` **0
rows**. The button reads **"Turn automation on"** and nothing is armed.

## 2026-10-05 — The Rules pop-up went stale, and the `unconfirmed` check is understood but left alone

Two sessions, two findings. **1256 tests · verify green · 19 rule-skips across five live sessions.**

### 🔧 The Rules pop-up did not refresh, and showed the OPPOSITE of the truth

Reported by the user, who left the browser in the failing state so it could be observed directly. A halt
latched **while the Rules pop-up was already open**:

| Surface | Said |
|---|---|
| Status bar | `Automation HALTED` ✅ |
| Rules panel | `Turn automation off` — *"Rules that match will skip the track."* ❌ |

⚠️ **Worse than a missing alert.** The panel was not merely out of date, it was **asserting the opposite
of the truth** — rules would NOT skip, the halt guaranteed it — and offering a switch that FC-U5-3
deliberately suppresses while halted. **Two surfaces contradicting each other** is the defect this
component was built to prevent, reappearing one layer up: the component guards against a stale *control*,
and nothing guarded against a stale *panel*.

**Cause**: `loadAutomation()` ran only from the dialog's open handler. The status bar updates because it
rides the WebSocket snapshot; the panel had no feed.

**Fix**: driven off that same snapshot, which already carries the pre-derived automation indicator every
3 s. No new timer and **no new WebSocket surface** (Infrastructure Q6).

⚠️ **On a LEVEL CHANGE only, not every snapshot.** `loadAutomation()` replaces the panel's DOM children,
so re-rendering every 3 s would move focus out from under someone reaching for a button. The level encodes
every state that alters what the panel renders.

⚠️ **Stated limit**: a change that does not move the level — `/state` becoming unwritable — leaves the
panel's warning stale until reopened. That one is reported on `/api/diagnostics`, and it is not worth
re-rendering under the user's cursor for.

⚠️ **`renderAutomation` also updates the staleness marker**, so a change the user made *themselves* does
not arrive on the next snapshot as a level change and trigger a redundant re-render a moment after their
click.

**Verified by reproducing it**: halt cleared, pop-up opened, then a halt written into the state file by
write-temp-then-rename exactly as `AutomationStateStore` does. The panel flipped in place — switch gone,
halt panel shown, one button — **without the dialog being closed**.

### 🔎 `confirmed()`'s false negative is now fully characterised — and DELIBERATELY NOT FIXED

Across **all 19 fired attempts to date**:

| `before` | n | result |
|---|---|---|
| 3000 ms | 1 | ⚠️ `unconfirmed` |
| 5000–9000 ms | 18 | `confirmed` |

`after` is **always 3000 ms** — the incoming track's first poll sample. So `after < before` fails
**precisely and only** when the skip fired at 3000 ms, the earliest possible sample. **Deterministic, not
flaky.**

⚠️ **And the condition is arguably ill-founded rather than merely unlucky.** It compares `progressMs`
across a **track change** — two positions in two *different* tracks, which is not a meaningful ordering.
It read as correct because a natural boundary also yields a smaller number, so it **passed 18 times by
arithmetic coincidence** rather than by measuring what it claims to.

✅ **Left alone (user decision).** No unexpected behaviour across five sessions, and ⚠️ **the edit that
would fix it is the same shape as the edit that once made this function always return `true`** — a
permanently green light on the only unit that can cause harm. A cosmetic false negative does not justify
touching a safety-adjacent predicate freshly in service.

**Cost of leaving it, bounded**: safety is unaffected (P-30 counts unknown as landed, and #20 did count
toward its halt). The only consequence is FC-U5-1 reading red `Skip unconfirmed` for a skip that landed,
when such an attempt is the most recent.

⚠️ **Recorded with the trap for whoever revisits it**: `<` → `<=` is the WRONG fix. Since `after` is
always 3000 that makes the condition **unfalsifiable while still looking like a check** — a decorative
guard, which this project has shipped twice and has a standing warning about. The defensible change is to
confirm on the track-id change alone and keep both progress values as recorded evidence. Backlog **W-8**,
with the full table in `confirmed()`'s own docstring where someone would look.

### What the five live sessions established

| | |
|---|---|
| Sessions | 5 · **19 rule-skips** · 6 halts |
| Cost per skip | **3–9 s**, and ⚠️ **driven by enrichment settle time, not the skip mechanism** — all decided on complete data, `trigger: initial`. The "6–7 s" reported earlier was an artefact of the first sample |
| Halt | latches on the **3rd** consecutive skip; the 4th matching track is refused `runaway-halted` |
| `attemptIds` | names the consecutive run only |
| `skip_source` | `rule` on every one, written by the live path |
| `unlinkedFiredAttempts` | **0** throughout |

⚠️ **Still never exercised live**: the `hourly-rate` trigger (the consecutive halt fires first and
prevents reaching 10/hour) and the `no-active-device` refusal.

## 2026-10-06 — ✅ U5 IS COMPLETE AND LIVE-VERIFIED. All five units delivered.

**7 live sessions · 29 real skips · 6 runaway halts · 1256 tests · schema v7 · 973 plays ·
`integrity_check: ok`.** Record:
[`construction/u5-automated-skipping/live-verification.md`](construction/u5-automated-skipping/live-verification.md).

### The three exit criteria CI could not close are closed

| | Criterion | Closed |
|---|---|---|
| 1 | `probeWritable` against the real `/state` mount, **through the container** | 2026-10-03 |
| 2 | The dry-run review that armed the first rule | 2026-10-04 |
| 3 | **The first real skip, heard** | 2026-10-04 |

### ⭐ FR-46/BR-43.1 answered: 1–9 s, and the number is not what matters

The design plan feared **18–41 s** of the outgoing track; probe P-U5-1 predicted **2–3 s**. Measured over
29 real skips: **min 1,000 ms · median 6,000 ms · max 9,000 ms.** No lag guard needed.

⚠️ **But the cost is ENRICHMENT LATENCY, not a property of the skip mechanism**, and I reported it twice
before understanding that:

- after 13 skips: *"6–7 s"*
- after 19 skips: *"3–9 s"*
- actual, 29 skips: **1–9 s**, bounded by `ENRICHMENT_WAIT_MS`

Every skip decided on **complete** data (`partialData: 0`, `trigger: initial`) — none timed out. The 1 s
case was a track played minutes earlier, so its enrichment was **cached** and the decision fired on the
first tick. ⚠️ **Both earlier figures were sample artefacts stated more confidently than the evidence
supported.** The durable claim is the mechanism: the cost tracks a latency this project already tunes.

### Every BR-35 path has now fired live

5 `consecutive` halts · **1 `hourly-rate`** · `runaway-halted` (5) · `automation-off` (8) · BR-35.9's reset
across 4 separators · BR-35.6 surviving `compose up --build` · P-30's *unknown counts as landed* (all 3
`unconfirmed` attempts counted) · FR-48's *surface, never retry*.

⚠️ **`attemptIds` differs by trigger, and that is the point**: `consecutive` names the run (`[31,32,33]`),
`hourly-rate` names the whole window (ten ids). Both confirmed live.

### ⚠️ `hourly-rate` is near-unreachable in production — a real property, not a coverage gap

Reaching it needed **two of three rules disabled** and hand-paced separators. Any rule broad enough to
produce 10 skips in an hour will almost certainly produce **3 adjacent first**, so the consecutive guard
pre-empts it. **`MAX_RULE_SKIPS_PER_HOUR = 10` is therefore mostly theoretical at
`MAX_CONSECUTIVE_RULE_SKIPS = 3`.**

⚠️ **Corollary: the pre-POST `rate-limited` refusal is nearly dead.** The halt latches at the same
threshold and is checked earlier in `#process`. It is reachable only by acknowledging a halt while ≥10
skips remain in the window.

### ⚠️ EIGHT DEFECTS FOUND LIVE. NONE BY THE SUITE. TWO HAD PASSING TESTS.

Full table in the record §4. Summary of how each was found:

| Found by | Count |
|---|---|
| The user, using the app | **3** (prose on the primary screen · three-button recovery · stale pop-up) |
| Reading code or a real record | **3** |
| Answering a user question | **1** (the halt could not fire at all) |
| A tool added for exactly this (`knip`) | **1** |
| **The test suite** | **0** |

> ⚠️ **A FIXTURE BUILT AROUND A MENTAL MODEL CONFIRMS THE MODEL.** Two defects were documented *wrongly
> first*, and both wrong versions **had passing tests**:
>
> - **The halt's off-by-one.** I reasoned *"the counter reads closed plays, so it must trail by one"* and
>   wrote *the 4th skip latches it* into a docstring, the UI, the pre-registration and a test. BR-43.4's
>   3-second confirmation grace defeats it — the play has closed by the time `#checkHalt` runs. **3 means 3.**
> - **The time-window key**, which failed live by **11–14 ms** because `ended_at` is the last observation
>   and the attempt is enqueued from the decision taken on that same tick.
>
> Both tests passed because the data was written to match the belief rather than the behaviour. ⚠️ **This
> is invisible to coverage**: the line ran, the assertion ran, and the two agreed with each other and not
> with reality. It is a distinct failure mode from an untested path, and neither coverage nor `knip` can
> see it.

⚠️ **And `skip_source` shows why dead-VALUE analysis is not dead-CODE analysis.** The column was read and
written throughout — just never with `'rule'` — so BR-35's consecutive halt **could not fire at all** while
`safetyCounters.ts` sat at **100% line, branch and function** and PBT-46/47 passed. They tested the counter
against *supplied* input; nothing asserted that anything ever supplies `true`.

### The UX revision, and why it was structural

Defects #4–#7 were one shape: **surfaces disagreeing about state.** Controls during a halt went **3 → 1**;
the primary screen lost the prose and kept the dot; the switch is **not rendered** while halted; the panel
refreshes off the snapshot.

⚠️ **Acknowledging now unconditionally disarms**, so resuming is a second deliberate act — **stricter than
FC-U5-3's original two buttons**, because the old `reArm` parameter let one request clear a safety latch
*and* re-arm, which is what BR-35.5 exists to prevent. FC-U5-3 revised in place, struck through, with the
reasoning. **BR-35.5 and BR-35.6 unchanged.**

### ⚠️ Five paths still NOT verified live

`no-active-device` · `upstream-rate-limited` (Spotify 429 — ⚠️ zero observed is **not** headroom, Spotify
publishes no limit) · **P-30's 401 refresh-and-reissue**, which is **indistinguishable from a proactive
refresh because that path logs nothing** · `rate-limited` · FR-33 `hold`.

**All five are covered by tests.** Listed because *covered by a test* and *observed in service* are
different claims, and this unit's history is that the second keeps finding what the first did not.

### A rule that was right while the intent was wrong

⚠️ The user disabled `hip-hop` on 2026-10-06 after it skipped a bbno$ track. **The rule fired correctly** —
`artist.genres contains "hip hop"`, and that genre led the list with count 4. The other two rules correctly
declined the same track (`independent`, age 0). **The rule was right and the intent was wrong**, which is
exactly what a user-authored rules file and the dry-run review exist to surface rather than prevent.

### Open backlog from U5

**W-6** — defect-class detection; `smoke` and `knip` were its first two guards, and §4 is the argument for
the rest of it · **W-7** — idle poll backoff, now unblocked by M1–M4 · **W-8** — `confirmed()` compares
progress across a track change, deliberately not fixed.

⚠️ **The user also flagged the primary screen as \"currently sloppy\"** and deferred its cleanup until after
the full alpha build. Nothing beyond the halt message has been touched there.

## 2026-10-06 — Phase 5 opened, and U6 was promoted from backlog to its gate

**Phases 0–4 are delivered. This is the first phase that adds no user-facing feature**, and that is the
point: the deliverable is that a second person can review, run and contribute without the project's
accumulated tacit knowledge, and that a deployment can live somewhere other than this laptop.

### The distinction that bounds the phase

| | |
|---|---|
| Single **user** | **UNCHANGED** — one listener, one Spotify account, one corpus per deployment |
| Single **developer** | **CHANGES** — several people may review, test, contribute |
| Single **machine** | **CHANGES** — a deployment moves to a Synology Docker host on the same LAN |

**Each person runs their own deployment** (user). ⚠️ **So this is NOT multi-tenancy and needs no user model
for separation** — only, possibly, for *access*. Getting that distinction wrong would have scoped a user
system into an app that is single-user by design.

⚠️ **Containment is deliberate** (user): the off-machine target is on their own network, so the security
model gets worked out without internet exposure in the same step.

### 🔧 A gap I own: two Q9 guards were specified for CI and shipped as local scripts

NFR Q9 chose *"run each script's safe mode **in CI**"* and *"`knip` … **in CI**"*, and warned that the
alternative *"is how this becomes the eleventh thing nobody runs."* I added `npm run smoke` and
`npm run knip` and **wired neither into `ci.yml`** — building precisely the thing the question told me not
to.

⚠️ **And I had been treating CI as absent.** It exists, runs typecheck + coverage + build + a container
build, and has been **green on every push**. Correcting that is what exposed the gap.

### ⚠️ The blocker for off-machine deployment, measured

`localGuard.ts:141` requires a **loopback `Host` header**. A request reaching the NAS carries
`Host: <nas>:3010`, so **every page load and every WebSocket upgrade 403s.** That is option B (2026-09-05)
working exactly as specified, not a defect — and replacing it is a **security-posture decision**, surfaced
rather than decided (Phase 5 Q1).

⚠️ **The recommendation is to resist building auth into the app** (option D). It is the only option that
adds attack surface to the app itself, and it **must be implemented twice** — once for HTTP, once for the
WebSocket upgrade, because `ws` does not run Express middleware. **That exact split caused the `403`
incident, where every page returned 200 and every handshake 403 and it read as *Spotify is down*.**

### ⚠️ `README.md` is the project's decay pattern on its most public surface

463 lines opening with *"Status: walking skeleton, requirements in progress"* and *"the enrichment layer is
**not built yet**"*, pointing at a clarification round that closed in August — for an app with **5
delivered units, 1256 tests, automated skipping and 977 recorded plays**.

Same shape as open item 2 reading stale for five weeks after shipping, and the `compose.yaml` `:rw` comment
going stale twice. ⚠️ **A reviewer's first impression is a document that is wrong about what the software
is.** Also absent: `LICENSE` (⚠️ contributors have no granted rights), `CONTRIBUTING`, `SECURITY`.

---

### ⭐ U6 — User-Data Lifecycle, promoted from W-5 by one question

The user asked: *"does this raise a required prerequisite? … we could backup the data on Rancher Desktop,
start up the NAS hosted app and once connected restore the data to that environment?"*

**Yes.** And the proposed sequence is feasible **today** — `db:backup` / `db:restore` have existed since
2026-09-27 with a rehearsed round trip (850 plays → damaged to 0 → restored to 850) and have been used in
anger twice. ⚠️ **So U6 EXTENDS a working pair.** Starting over would discard a verifier that has already
caught a real corrupt snapshot and a self-test that proves it can fail.

**Three gaps make the migration unsafe**, and W-5 anticipated only part of one:

**1. ⭐ The writer-guard goes blind across machines.** `assertNobodyElseHoldsIt` runs `docker ps` against
the **local** daemon. Run a restore here against a NAS-mounted path and local `docker ps` reports
*"nothing is running"* **about the wrong computer**, while the NAS container holds the file open.

> ⚠️ **This is the U4 corruption's shape one layer out.** The original guard was an exclusive-lock probe
> that could not see the container because **SQLite's locks do not cross the Rancher Desktop bind mount** —
> it *"returned green exactly when the danger was present"* and mechanically explained the U4 incident.
> `docker ps` fixed that. **Crossing machines reintroduces the same blindness**, because `docker ps` can
> only interrogate one daemon and it must be the one that owns the file.

⚠️ `SPOTIFY_CONTAINER_NAME` is configurable and does **not** help: the question is *which daemon*.

⚠️ **The FD's recommendation (U6 Q1) is deliberately the boring option — refuse cross-machine operation
entirely.** Every alternative replaces a guard that is *blind* with one that can be *wrong*: a database
heartbeat goes stale and reads as dead (the WAL-mtime lesson), and an HTTP health check needs reachability
that Phase 5 Q1 has not settled. **This project has already shipped two decorative guards.**

**2. The backup covers `history.db` only.** `config/rules.json`, `secrets/*`, `data/artist-credits.json`,
`snapshots/`, `reporting/` and the `metabase-app-db` **named Docker volume** do not travel.

> ⚠️⚠️ **And `state/automation-state.json` MUST NOT.** The kill switch is on its own mount *specifically*
> because restoring a week-old backup *"would restore the week-old latch and **silently re-arm
> automation**"*. **A backup that helpfully includes `state/` is a backup that can re-arm playback
> control.** U6 Q2 therefore prefers an **allowlist of travel tiers** over a denylist: a denylist includes
> a newly-added state file **by default**, which fails silently; an allowlist misses it, which is visible.

**3. ⚠️ There is no merge, and restore is one-way.** Dedup is keyed on `played_at` **within one database**,
and two deployments recording the same account produce overlapping plays **plus colliding `observation` /
`decision_log` / `skip_attempt` ids**. **So *migrate to the NAS* and *run both* are different decisions,
and the second forecloses going back.** U6 Q3 refuses merge tooling **explicitly**, so it is not attempted
after two corpora have already diverged — the worst possible moment.

### Two things about U6 worth recording because they are firsts

⚠️ **It is the first unit with NO user story.** No user asked for it; **U7 did**. Recorded so nobody later
invents a story to justify it.

⚠️ **It is the first unit typed `Infrastructure` rather than `Feature`**, because its output is a *property*
— the corpus can move — rather than something on a screen. Its exit criterion is therefore **an operation
performed, not a screen verified**: *a corpus backed up on one machine, restored on another, and the
restored app runs.* **No test can prove that**, and ⚠️ the guard must be **demonstrated refusing** rather
than asserted — a guard nobody has watched say no is decorative.

⚠️ **U6 Q6 asks whether it gets FRs at all.** Every prior unit traced to numbered FRs; W-5 is a wishlist
entry, and the wishlist is explicitly *not* requirements. Leaving it would break the traceability every
build-and-test summary closes with — a unit with nothing to map can only be *asserted* complete.

### Artefacts created

`inception/plans/phase-5-plan.md` (7 questions) · `construction/u6-data-lifecycle/HANDOFF.md` ·
`construction/plans/u6-functional-design-plan.md` (6 questions) · Phase 5 added to `execution-plan.md`
with its units · U6 declared in `unit-of-work.md` and `unit-of-work-plan.md` · W-5 linked to U6 ·
`aidlc-state.md` updated.

**Nothing is built. `src/` and `scripts/` are untouched by this unit.**

---

## 2026-10-06 (later) — Phase 5 / U6 questions teed up; U6 Q5a measured

Re-verified the facts both plans rest on, same day: `localGuard.ts:141` still requires a loopback `Host` ·
`ci.yml` still runs neither `smoke` nor `knip` · `README.md` still 463 lines opening on the walking
skeleton · no `LICENSE`, `CONTRIBUTING` or `SECURITY`. All reproduce.

✅ **U6 Q5a answered by measurement rather than asked.** Metabase's API reports 32 cards / 3 dashboards:
6 + 2 are the Spotify reports, all built by `npm run reporting:report`; the rest is Metabase's sample
content. **No hand-authored work lives only in the `metabase-app-db` volume.**

⚠️ **And the question's premise was wrong**: it said the volume is *"recreated by `npm run
reporting:metabase`"*, which only registers the database. Recreation is `reporting:metabase` **then**
`reporting:report`. Recorded in the plan under Q5. No `[Answer]` filled — that remains the user's.

---

## 2026-10-06 (later) — U6 Q1–Q6 answered; three follow-ups raised; install routine added to Phase 5

**Answers**: Q1 **A** (refuse cross-machine; stage the backup on the target, restore there) · Q2 **A**
(tiered allowlist; `state/` never) · Q3 **A** — ⚠️ provenance **declined**: *a restore never merges, it
replaces what is on the host, except credentials unless opted in* · Q4 **C** — ⚠️ **delete** the
unverifiable legacy backups, overriding the recommendation (A) · Q5 **A** · Q6 **A** — *"a first-class
unit of work… follow the same process as prior units."*

**Follow-ups (U6 plan §6), per the FD rule to resolve ambiguity before designing:**
- **FQ1** — Q1 = A needs the restore to run **on the target host**, which needs Node there (unchecked on a
  NAS). Proposed alternative: **the app restores itself at startup** from `data/restore-pending/`, so the
  one writer does it before it writes and the cross-machine guard question disappears. `config/` stays `:ro`,
  so non-DB tiers become an operator file copy.
- **FQ2** — Q4 = C's scope. ⚠️ `CORRUPT-snapshot-20260921-201444` is `--self-test`'s negative control,
  not a backup. Sweep today: **3 verified · 10 unverifiable · 1 corrupt**; newest verified holds **901 of
  977** plays. **Nothing deleted** — irreversible, awaits the confirmed list.
- **FQ3** — does *"same process"* include a user story and every stage (NFR Req/Design, Infra Design)?

**User direction**: no multiple Spotify accounts are needed; what is needed is an **install routine**
(manual or AI-executed) every user follows to configure **their own** install on **their own** machine.
Multiple users on one instance remains out of scope. Recorded as **Phase 5 Q8**, with the reading that each
user brings their own developer app registration — which would make §2's Development Mode user-cap probe
moot. Flagged for confirmation rather than assumed.

---

## 2026-10-07 — "Why take the whole app down?" — online backup probed; live quiesce not recommended

FQ1/FQ2 came back with the user's counter-question: maintenance should not need `docker compose down`;
is an app **quiesce** needed, and what would it cost? FQ3 = **A** (full unit process, with a story).

✅ **Probed, scratch copy only**: `node:sqlite`'s `backup()` (Node 22.17) copied the 901-play verified
backup **while the same connection made 281 interleaved writes** — 145 ms, `integrity_check: ok`, 901/901
plays, clean point-in-time. **In-process backup needs no quiesce at all.**

⚠️ **The real cause of `compose down` is that the scripts are a second process on the host** across a
mount SQLite's locks do not cross — not anything about SQLite itself.

⚠️ **A live quiesce is recommended AGAINST**: six independent writer drivers (poll/`PlayObserver` with an
in-memory open play, backfill timer, label queue, decision log, skip drain, liked refresh), and since
restore *replaces* (Q3), it would protect nothing a restore does not already discard. Proposed instead:
**in-app online backup** + **staged restore applied at restart before the DB opens**. Restart duration
**not measured** (live container deliberately not restarted). Four questions M1–M4 in plan §7.

---

## 2026-10-07 (later) — M1–M4 answered: maintenance becomes an in-app Settings surface

**Answers**: M1 — backup/restore and user-facing maintenance are **app-integrated**, on a **Settings**
surface linked from the main screen; **Diagnostics moves there**. M2 — **no scheduled backups**; recorded
as backlog **W-9** (*considered, not now*: its only value is off-site upload). M3 — repair/reclassify stay
**developer-only**. M4 — backups folder **+ zip-and-download**; the user chooses where they live.

✅ **Probed**: a container under `restart: unless-stopped` that **exits 0** is restarted (5× in 20 s,
throwaway alpine container). So the staged restore can **restart itself** — no user action under Docker;
under `npm start` nothing restarts it.

⚠️ **Two mount facts the in-app design runs into**: `config/` is `:ro` to the app, so **restore cannot
write `rules.json`**; and `secrets/spotify-config.json` is a **single-file `:rw` mount**, so any restore
of it must write in place (inode hazard). Five clarifying questions S1–S5 in plan §8 — Settings page vs
pop-up, upload, rules on restore, credentials in a downloadable zip, pruning.

---

## 2026-10-07 (later) — S1–S5: backup/restore becomes two buttons; rules and credentials surface as a second subject

**Settled**: Settings is a **pop-up** (S1). The user path is **"Create backup" (download) / "Restore
backup" (upload + replace)** with **no user-visible backups folder** — `data/` backup dirs stay
developer-only, the user path uses disk only as temp and removes it on completion (S2, S5). **Credentials
are excluded from backup entirely** — each installation manages its own; Q3's opt-in clause is withdrawn
(S4). Archive: Node has gzip but **no multi-file archive writer** (zip or tar), so a package is needed —
proposed `tar` (.tar.gz), with untrusted-upload extraction rules.

**New subject raised by S3/S4**: on an appliance the user cannot edit host files, so **rules and
credentials need in-app management**. Four questions T1–T4 (plan §9): separate *Configuration management*
unit vs fold into U6 · rules download/upload vs editor · credentials (⚠️ the OAuth redirect is
`http://127.0.0.1:8888/callback`, which cannot work from a NAS; Spotify's docs say non-loopback redirects
need HTTPS — **unprobed**) · a single bounded *previous database* as restore undo.

---

## 2026-10-07 (later) — T1–T4 answered; U6 Functional Design WRITTEN; U8 declared

**Answers**: T1 = **A** — rules/credentials management becomes **U8 Configuration Management**, also gating
U7. T2 = **C** (rules upload/download now, editor later) *"and use secure patterns for ALL file ingest
activities"* → **FR-64 / BR-46**, one admission path. T3 = **A**, after asking what install-time-only
means: **not a reinstall** — re-run the auth step where the browser is and put the file in place (U8: by
upload); TLS for in-app OAuth → **W-10**, later. T4 = **A** — one previous database, *Undo last restore*.

**Written**: `construction/u6-data-lifecycle/functional-design/` — BR-44…BR-52 · business-logic-model ·
domain-entities · frontend-components. **FR-57…FR-64** (requirements §3.7 *Operations*), **US-28** (Epic 8,
persona P3), **W-10**. U6 entry in `unit-of-work.md` rewritten (it said *no feature, no story, scripts
only* — all three overturned); **U8** declared; execution plan updated. Plan §10 is the settled reading.

**Measured for the design**: the app's schema holds **12 tables, 21 indexes, no triggers or views** — so
BR-47.4 can refuse any uploaded database containing a trigger or view outright (a trigger in an untrusted
SQLite file fires on the app's own later writes). `localGuard`'s `isAllowedOrigin` **admits a missing
`Origin`**; BR-46.2 makes ingest routes stricter than the general policy on purpose.

⚠️ **Not decided by this FD**: Phase 5 Q1 (off-machine access). The ingest routes are local-only until it is.

---

## 2026-10-07 (later) — PROCESS CORRECTION: Phase 5 returned to the standard AI-DLC stages

The user asked whether Phase 5's questions belonged in the U6 FD and said: *"I don't want to introduce any
non-standard processes."* Checked against the rules and the repo: **no earlier phase has a "phase plan"** —
Phases 1–4 were planned in the original Inception. `inception/plans/phase-5-plan.md` (2026-10-06) was an
invented document type.

**Two deviations, both corrected:**
1. **Phase 5's questions** moved to the standard stages — Requirements Analysis **Questions 11–17a**
   (`requirement-verification-questions.md`, new dated round, with the old plan's context and facts) and Units
   Generation **Questions 4–5** (`unit-of-work-plan.md`). Old Q2/Q5 were unit design questions: recorded there
   as *carried to U7's design plan* (U7-a, U7-b), not asked now. Exit criteria moved to `execution-plan.md`;
   the U6 exit criterion re-worded, since the guard it named was dissolved by the FD. `phase-5-plan.md` is a
   pointer; none of its questions had been answered, so nothing was lost.
2. ⚠️ **Mine**: when W-5 became U6 I wrote **FR-57…FR-64 and US-28 during Functional Design**, skipping
   Requirements Analysis. Content stands (it comes from the user's FD answers), but it now goes through
   **Question 12** for ratification **before** the U6 FD is approved. U8 was likewise declared without Units
   Generation — Question 4 now covers it.

Also found: `unit-of-work-dependency.md` and `unit-of-work-story-map.md` contain **no Phase 5 units at all** —
listed in the Units round's checklist.

---

## 2026-10-07 (later) — Phase 5 requirements & units rounds: first answers, four follow-ups

**Requirements round**: Q12 = **A — FR-57…FR-64 and US-28 ratified** (closing the skipped step; U6's FD is
now approvable) · Q13 = B · Q14 = A · Q15 = A · Q17 = C · Q17a = **A** (each user registers their own Spotify
app — the Development Mode per-registration limit needs no probe) *"and also we should insure credentials are
never written to the repo."* Q16 (licence) left blank.

**Q11 answered with a question**: long term the user wants industry-standard web security that allows AWS/cloud
hosting — *what short-term pattern adds the least debt?* Answered in **Q11a**: delegated authentication (OIDC
at a proxy or load balancer, TLS terminated there), with the app's half — a **trusted-proxy mode in
`decideAccess` that verifies a signed identity token on HTTP and the WebSocket upgrade** — built now. In-app
login is identified as the debt. Product details (ALB OIDC action, oauth2-proxy, etc.) recorded as documented,
to be verified in the deployment unit's design.

**Measured for Q17b**: `.gitignore` ignores `secrets/` except three `*.example.json`; a scan of **every commit**
for credential values found **none** — the two matches were the templates' placeholders. ⚠️ Nothing enforces
it; NFR-05 does not cover the repository. Q17b proposes NFR-28 with a CI secret scan.

**Units round**: Q4 = **A** — **U9 Team Workflow & Onboarding** added. Q5 answered with *"why not just swap the
numbers?"* — no strong reason, and nothing is designed for U7–U9 yet; Q5a offers renumbering to build order
(U7 Configuration · U8 Onboarding · U9 Deployment) with this log keeping the mapping, since its earlier entries
keep the old numbers.

---

## 2026-10-07 (later) — Phase 5 units RENUMBERED to build order; Units Generation complete

User: *"go ahead and swap the numbers so the numbers stay sequential."* → Units **Question 5a = A**.

**Mapping — entries ABOVE this one use the old numbers:**

| Old | New | Unit |
|---|---|---|
| U8 | **U7** | Configuration Management |
| U9 | **U8** | Team Workflow & Onboarding |
| U7 | **U9** | Off-machine Deployment |

**Build order: U6 → U7 → U8 → U9.** Renumbered everywhere except this log (append-only) and the units-round
Questions 4/5/5a with their answers (kept as asked, with a note). Memory updated too.

**Units Generation outputs completed** — the round's checklist: `unit-of-work.md` gains **U8** and **U9**
entries, sections put in build order, and U6 re-typed *Feature* (its FD made it user-facing);
`unit-of-work-dependency.md` and `unit-of-work-story-map.md` gain Phase 5 for the first time (**US-28 → U6**,
FR-57–64 → U6; matrix still lower-triangular); `execution-plan.md` units table rewritten, and its stale
*"the writer-guard goes blind"* sentence struck as dissolved by U6's FD.

**Still open in the requirements round**: Q11a (security pattern), Q16 (licence), Q17b (enforce no credentials
in the repo). **U6's FD is approvable now** (FR-57…64 ratified).

---

## 2026-10-07 (later) — Phase 5 Requirements round COMPLETE; the bundled MCP server has no licence

**Answers**: Q11a = **B** (delegated authentication — OIDC at a proxy, TLS there, a **signed-token** check in
`decideAccess` for HTTP and the WebSocket upgrade) · Q16 = **C (GPL-3.0)** · Q17b = **B** (CI secret scan + a
test on tracked `secrets/` files). With the earlier answers the round is complete.

**Written into `requirements.md`**: **FR-65** (install routine — one step list for a person and an agent, every
step verifiable, own Spotify registration, walked cold) and a new **§4.1a**: **NFR-28** credentials never
committed · **NFR-29** delegated authentication off-machine (amends NFR-07 rather than repealing it) ·
**NFR-30** protected `main` · **NFR-31** smoke in CI as a link check · **NFR-32** GPL-3.0 · **NFR-33** the docs set.

⚠️ **Found while checking Q16**: `marcelmarais/spotify-mcp-server` — cloned and built into our image by the
`Dockerfile` — has **no LICENSE file and GitHub reports `license: null`**. This repo does not contain its code,
and each user builds their own image, so the GPL-3.0 choice is unaffected; but **publishing a built image would
redistribute unlicensed code**. NFR-32 forbids that until resolved; options recorded for U8. Our 95 runtime
dependencies are MIT/ISC/BSD — all GPL-compatible. *(Plain-language reading, not legal advice.)*

**From the Q11a answer, recorded for U9's design and not decided**: the user's Synology NAS has its OAuth/SSO
service installed but unconfigured — a candidate identity provider, to be probed; and a Synology MCP server
could let the agent configure the NAS directly — ⚠️ an administrator credential, so NFR-28 and least privilege
apply. The NAS's hostname and address were **kept out of the repository** (it is about to be shared) and noted
locally instead. ⚠️ The address as given, `192.160.0.223`, is in a **public** range; `192.168.x.x` is the
private one — to confirm before use.

**Correction (same day)**: the NAS address was a typo — it is `192.168.0.223`, a private LAN address. ⚠️ And
*"kept out of the repository"* above was **wrong**: the hostname and address are in the user's own Q11a answer
in `requirement-verification-questions.md`, and this log quotes the mistyped address. Neither is committed yet.

**Decision (user, same day)**: the NAS hostname and address **stay in the repository**. The LAN is private and
non-forwarding, anyone already on it could find the NAS with a scan, and a concrete hostname helps readers of
the install documentation. Added to U9's entry in `unit-of-work.md`: target **`SYNNAS` (192.168.0.223)**.

---

## 2026-10-07 (later) — ✅ U6 Functional Design APPROVED

User: *"Approved."* FR-57…FR-64 had been ratified first (Requirements Question 12), so the standard order holds.
Artifacts: `construction/u6-data-lifecycle/functional-design/` (BR-44…BR-52). **Next: U6 NFR Requirements.**
Committed with this session's Phase 5 work at the user's request.

---

## 2026-10-07 (later) — Pushed; NFR Requirements SKIPPED for U6; NFR Design plan written

Pushed `07e0e93` to `origin/main`.

⚠️ **Correction of my own FQ3 text**: it claimed prior units ran *"FD → NFR Requirements → NFR Design → …"*.
**False** — `execution-plan.md` sets NFR Requirements to **SKIP** for every unit (the 27 NFRs were settled in
`requirements.md`), and U1–U5 all skipped it. Asked rather than assumed; user: **skip it, as U1–U5 did.**
FQ3's text annotated with the correction.

**U6 NFR Design plan** (`construction/plans/u6-nfr-design-plan.md`) — 10 questions. Measured for it:
`backup()` copy 5.0 MB → **1.6 MB** gzipped · app start → listening **0.5 s**, → recent plays re-imported
**0.9 s** (from container `StartedAt` and `docker logs -t`) · Docker stop/start overhead **not measured** ·
`tar` 7.5.22, **BlueOak-1.0.0**, 5 transitive deps (GPL-3.0 compatibility to be confirmed, not assumed) · the
image ships `dist/` only; three scripts already import `src/` via `--import tsx`.

⚠️ **Finding**: U6's exit criterion (*restored on another machine*) **cannot be run on the NAS before U9** —
a browser off-machine is refused by `localGuard` until NFR-29 is built. Raised as Q10 rather than discovered
at Build & Test.

**NFR Design Q10 = A** (user, in conversation): *"Agree with splitting the test to allow it to be locally
checked at U6 and then remotely checked with U9."* U6's exit criterion is now a round trip into a **second
installation on this machine**; the **cross-machine** restore on the NAS becomes a **U9** exit criterion.
Propagated to U6's HANDOFF, US-28, `unit-of-work.md` (U6 and U9) and `execution-plan.md`. Q1–Q9 still open.

---

## 2026-10-07 (later) — U6 NFR Design answered (all A) and WRITTEN

User: *"all recommendations accepted and plan saved"* — Q1–Q9 = **A** in the file, Q10 = A from conversation.

**Q1's promised check, done**: `tar`'s licence **BlueOak-1.0.0** — the Blue Oak Council's FAQ states BlueOak
software can be used, combined and distributed with GPLv3 software; OSI-approved 2024-01-19. Recorded as
compatible with NFR-32, with that source (not FSF's list, which was not checked).

**Written**: `construction/u6-data-lifecycle/nfr-design/nfr-design-patterns.md` — **P-38…P-48** (one writer
does maintenance · parse never extract · validate then act · the body is the file · stricter guard composed
after `decideAccess` · journaled idempotent swap · cleanup on every path · allowlist what travels · visible
headroom · a restart that does not come back says so · split verification) and `logical-components.md` —
**LC-32…LC-39** with **PBT-51…PBT-58**, each with a negative control (PBT-57's is a positive control: a guard
that refuses everything would pass every refusal). The plan's candidate P-38…P-44 grew to P-48; noted in §5.1.

**Awaiting approval. Next: Infrastructure Design.**


---

## 2026-10-07 (later) — ✅ U6 NFR Design APPROVED; Infrastructure Design plan written

User: *"continue"* at the NFR Design review prompt — the *Continue to Next Stage* option, i.e. approval.

**Infrastructure Design plan** (`construction/plans/u6-infrastructure-design-plan.md`) — 6 questions. U6 needs
**no new mount, port, service or migration** (P-38 keeps maintenance inside the process; its working dirs live in
the existing `./data` directory mount). Measured: container Node **v22.23.3** with `backup()` ✅, but
`NODE_VERSION=22` **floats**; the image builds with **`npm install`, not `npm ci`** — the lockfile is not
enforced, which matters now that `tar` is a new runtime dependency; **no polling off-switch** exists
(`POLL_INTERVAL_MS` is the only knob); `container_name` is fixed, so the verification installation needs an
override. ⚠️ U6 is the **first unit whose startup can rename `history.db`** — hence the rollback-image and
pre-deploy-backup questions.

**Infrastructure Q3 rewritten as an isolation contract** (user requirement: the second deployment must install
and remove cleanly *"without impacting the primary deployment at all (either the deployment or the project
artifacts that enable it)"*). ⚠️ **Measured trap**: the live Compose project is named `spotify`, derived from the
directory — a second Compose file in the same directory would share it by default, so its `down` could act on
the live project. Contract: standalone `compose.verify.yaml` with `name: spotify-verify`, no `build:` (references
the live image tag), port 3011 (free), all state in one gitignored `verify-install/`, **no Spotify credentials**
(designs out an unverified refresh-token-rotation risk to the live token; relies on the app starting without
Spotify — to be seen in Build & Test), labels/snapshots/skip executor off; `verify:up`/`verify:down` refuse a
wrong project name and prove the live container's id, start time, restart count, image and health are unchanged
and no tracked file changed. User will answer Q1–Q6 in the file.

---

## 2026-10-07 (later) — U6 Infrastructure Design answered (all A) and WRITTEN

Q1 pin Node minor 22.23 + startup capability check · Q2 `npm ci` · Q3 the isolated verification installation ·
Q4 tag `u5-rollback`, verify live · Q5 verified backup before the first U6 deploy · Q6 Diagnostics + container
log only. The user's Q3 note asked whether the copy needs Spotify to complete the validations — **no**: every
U6 exit check (backup, restore, verify, counts, integrity, automation off, undo, reverse backup) runs without it;
live display and recording are untouched by U6 and stay proven by the live deployment. The one assumption — the
app starts without Spotify — is Build & Test step 1.

**Written**: `infrastructure-design/infrastructure-design.md` (IN-U6-1…6, deployment steps) and
`deployment-architecture.md` (the live deployment, and the verification installation's isolation contract with
`verify:up`/`verify:down` and their no-impact proof). **Awaiting approval. Next: Code Generation.**

---

## 2026-10-08T01:47:42Z — ✅ U6 Infrastructure Design APPROVED; Code Generation plan written, approval requested

User: *"approve and continue"*.

**Code Generation Part 1** — `construction/plans/u6-code-generation-plan.md`, **13 steps**, pure before impure:
dependency/build · pure admission core (PBT-51/52/57) · verifier moved into `src/backup/` **unchanged first**, with
a checkpoint that `--self-test` still fails the CORRUPT snapshot, then BR-47.4's schema allowlist (PBT-53/54) ·
archive parser/writer (PBT-51/56) · online backup · journaled startup swap + sweeper (PBT-55) · MaintenanceService ·
routes + `ingestGuard` (PBT-58) · `server.ts` wiring (restorer before the repository, pinned) · Settings pop-up ·
verification installation (`compose.verify.yaml`, `verify:up`/`verify:down` with a `--plan` safe mode for smoke) ·
docs · `npm run verify` gate. ⚠️ No deploy and no `docker compose` in code generation — that is Build & Test.
**Approval prompt issued**; no code written.

---

## 2026-10-08T01:49:28Z — U6 Code Generation plan APPROVED

User: *"yea go"*. Part 2 (generation) begins at Step 1.

---

## 2026-10-08T02:14:55Z — ✅ U6 Code Generation COMPLETE (Part 2), awaiting review

All 13 plan steps done; `npm run verify` green — **1400 tests** (was 1256), typecheck, smoke, knip. Schema v7, no
migration. **Nothing deployed**: no `docker compose` ran; the live container still runs U5's image.

**Five defects found during generation, all by tests or by walking fault points, none reaching production**: a
damaged backup THREW (a crash path by upload) · an unclosed handle → Windows `EBUSY` · a lost journal after step 2
would have **replaced `previous/` with an empty one** (deleting the old corpus) · an error mid-swap could
**discard the old database's `-wal`** (its newest rows) — found by PBT-55 · an interrupted download raised an
**uncaught `ENOENT`** (`tar` reads lazily). Plus two design findings: **two verifier classifiers disagreed**
(unified) and the schema allowlist must be a **union across versions** (migration 004 dropped tables).

Recorded for U8: `npm audit` — **6 pre-existing vulnerabilities** in the Express/MCP SDK chain, identical before
`tar` was added, none in `tar`. Summary: `construction/u6-data-lifecycle/code/code-summary.md`.

---

## 2026-10-08T02:21:12Z — U6 Code Generation APPROVED; Build & Test begins

User: *"approve/proceed"*. Following IN-U6 deployment steps in order.

---

## 2026-10-08T02:27:41Z — ✅ U6 Build & Test COMPLETE — deployed and verified (local half)

Deployment per IN-U6: `u5-rollback` tagged · `compose down` → `db:backup --label before-u6` (1057 plays, all 8
checks ✅) · build **exit 0** → live healthy (gap ~61 s, 0 plays missed) · guards in the real container: uploads
403 without header / Origin / cross-site / rebinding Host; WebSocket **101 local, 403 cross-site**.

**Rollback verified LIVE**: U5's image on a copy with U6's `previous/`, a ready `restore-pending/` and `.work/`
planted — started on v7, UI 200, left all three untouched; copy `integrity_check: ok`, 1057 plays.

**Exit test** (verification installation, `:3011`): ⚠️ **the app starts with no Spotify credentials** (degrades,
does not crash) · live *Create backup* while recording (1.93 MB; entries exactly manifest/history/rules; no
hostname) · restore into the copy: wrong word 400, `RESTORE` 202, **back in 3.8 s** · counts identical across all
11 tables, integrity ok, automation off · undo ×2 (1057→0→1057) · reverse backup verified by the developer
verifier · Settings click-tested in Chrome, no console errors · **`verify:down` no-impact proof ✅**.

**Defects found in B&T, fixed, redeployed (~10 s gap)**: ⚠️ the disabled *Restore* button **looked enabled**
(tests asserted the state, which was right — only a screenshot saw it) · the after-restore text claimed a
re-import that cannot happen without Spotify · `db:backup`'s printed hint no longer ran after the verifier moved.

**Observation, not U6's**: the credential-less copy reported *"Spotify: ok"* and *PAUSED* — absent data reading as
"nothing playing". Pre-existing; relevant to U8's install routine. Not fixed.

**Open**: BR-52 cleanup — list shown to the user, deletion awaits confirmation. Nothing committed.

---

## 2026-10-08T02:28:55Z — ✅ U6 Build & Test APPROVED

User: *"approve and continue"*. U6 complete (local half; cross-machine restore is U9's). BR-52 deletion and the commit asked separately — the approval did not name them, and deletion is irreversible.

**2026-10-08T02:31:07Z — BR-52 done** (user confirmed): re-checked that the `unverifiable` set was exactly the 10 listed, deleted them; sweep now **4 verified · 0 unverifiable · 1 CORRUPT**; `--self-test` passes. In-app archive copied to the user's Downloads (`spotify-backup-20261008T022355Z.tar.gz`). Committing and pushing at the user's request.

---

## 2026-10-08T02:34:59Z — U7 Configuration Management: Functional Design plan written

User: *"yes"* to starting U7. Plan: `construction/plans/u7-functional-design-plan.md` — 9 questions (rules storage,
write guards incl. valid-but-empty and stale-hash, upload UX, which credentials, probe-before-apply, the defect
below, applying a backup's rules, a story, and requirements-first ordering). Entry point:
`construction/u7-configuration-management/HANDOFF.md`.

⚠️ **Defect found while gathering facts — traced to its cause.** The MCP server returns a failed `getNowPlaying`
as **plain text without `isError`** (`.mcp-server/src/read.ts:283–291`), so the app parses broken credentials as
**"nothing playing"** and reports **"Spotify: ok"** — the exact display U6's credential-less copy showed. Metric
**M4** therefore counts credential failures as idle polls. Not yet fixed; plan Q6 proposes fixing it in U7.

⚠️ **Q5 flags an unverified Spotify behaviour** — whether a refresh token survives being used — that must be
**probed** before a probe-before-apply design is written.

---

## 2026-10-08T13:11:55Z — App versioning raised; assigned to U8 (Requirements Question 18)

User asked, before starting U7, whether the app has a Major.Minor scheme like the schema's whole-number one.
**Measured: no.** `package.json` is `0.1.0` since the first commit (114 commits, U0–U6). The version appears in
four places, none managed: `package.json`; the image tag `spotify-now-playing:0.1.0`, which every build
overwrites (hence the hand-made `u4-rollback`/`u5-rollback` tags); U6's backup manifest `appVersion`, which
therefore always says `0.1.0`; and the MusicBrainz User-Agent, read from a **second, per-install copy** in the
gitignored `secrets/musicbrainz.json`. No git tags.

User: *"Add to Unit 8 since that's the logical place for it and that's also when using it will start to be
important."* Recorded as **Requirements Question 18** (an addendum to the completed Phase 5 round, per the
standard process — new scope re-enters Inception) and noted in U8's unit entry. Recommendation: SemVer with
`0.x` for development, `-beta.N` pre-releases once others install, `1.0.0` after FR-65's cold walk, one source
of truth in `package.json`. ⚠️ Accepted consequence: backups taken before U8 (U7's included) record `0.1.0`.
U7 proceeds unchanged.

---

## 2026-10-08T13:37:23Z — U7 FD plan: Q1–Q9 answered; follow-ups Q4a and Q7a

Answers: Q1 A · Q2 A · Q3 A · **Q4 A + "the settings screen should have sections for user entry of both spotify
and musicbrainz configs (with appropriate masking)"** · **Q5 B** — *"entering new auth information wipes the old
information and if the user wants to backtrack they need to do it themselves"* · Q6 A · **Q7 A, with the user's
reading of an opt-in "replace the rules" choice in the restore flow** · Q8 A · Q9 A.

Analysis (plan §3a): ⚠️ the user's Q7 reading matches **BR-48.7** ("U7 will add that option to this same flow");
the plan's option A had wrongly moved it to a separate post-restore action — corrected, not argued. Q4's note
extends T3 = A to entry fields and reverses 4c → **Q4a**. **Q5 = B depends on Q6 = A**: without the fix a bad
credential shows "Spotify: ok", so the fix must ship no later than the credentials feature. Q5 = B drops the
refresh-token rotation probe and the "probed before applied" exit criterion. Q7a asks when restored rules take
effect, given a restore can fall back at startup (BR-48.6).

---

## 2026-10-08T13:44:31Z — U7 follow-ups answered; requirements round opened (Questions 19–19a)

Q4a: *"A - and if the process to get spotify authenticated is not trivial we should include text guidance for
users."* · Q7a: A. Per Q9 = A, U7's requirements go to ratification **before** the FD: Question 19 proposes
**FR-66…FR-72 and US-29** (not yet written into `requirements.md`); Question 19a asks where the rules transfer
controls go, because ratified FR-63 keeps rules on the main screen. The guidance text from Q4a is folded into FR-69.

---

## 2026-10-08T13:56:45Z — ✅ U7 requirements RATIFIED (Question 19 = A, Question 19a = A)

Q19: A. Q19a: *"A - the backup restore process can affect rules as part of it... but all other rules processes
should be in the rules pop-up to keep it straightforward for users."* Written into `requirements.md` §3.8
(**FR-66…FR-72**, 72 FRs total) and `stories.md` (**US-29**, P2; traceability row added; P2's story list updated).
FR-72 amends FR-58 / BR-48.7. Question 18 (app versioning, U8) remains open — not needed for U7.
▶ Next: U7 Functional Design artifacts.

---

## 2026-10-08T14:01:53Z — U7 Functional Design written, awaiting approval

`construction/u7-configuration-management/functional-design/`: **BR-53…BR-60**, domain entities, logic model,
frontend components. No migration (schema v7); `config/` `:ro`→`:rw` and `musicbrainz.json` `:ro`→`:rw` are left
to Infrastructure Design.

**Found while designing, from source (not yet probed):**
- ⚠️ **A `spotify-config.json` without `accessToken` does not work** — the MCP server falls back to
  client-credentials and never refreshes. FR-69's four fields alone would write a dead file. BR-56.4 writes a
  placeholder token + `expiresAt: 0`; **probe P-U7-1** must confirm before that code is written.
- ⚠️ **Correction to the plan's own §2 claim** (*"M4 counts auth failures as idle"*): the text error parses to
  `playing: true` with null fields → counted as **playing**, MCP recorded **ok**. Separately, a *thrown* MCP error
  **is** counted idle today. Inference recorded as measurement — caught by reading `recordPollMetrics` before
  designing the fix. FR-71 therefore needs a three-way poll outcome (BR-58.3). Plan §2 and `requirements.md`
  corrected with dated notes.
- The server reports errors as text in 20 places, so BR-58.1 sits at the one MCP call site.
- **Evidence that a refresh token survives reuse** (the question once proposed as a probe for Q5): the server
  refreshes hourly with the same token and never stores a new one, and has run for weeks.

Flagged for the user's review: **BR-54.4** (unknown base → `REPLACE` confirmation, not refusal — the limit of
FR-67's staleness check) and **BR-59.3** (one typed `RESTORE` confirms database and rules together).

---

## 2026-10-08T14:14:50Z — ✅ U7 Functional Design APPROVED

User: *"Agree with 54.4 and 59.3 business rules. approve design, commit then continue"*. Both flagged decisions
accepted as written. NFR Requirements skipped as for U1–U6; next: U7 NFR Design plan.

---

## 2026-10-08T14:15:59Z — U7 NFR Design plan written (7 questions)

`construction/plans/u7-nfr-design-plan.md`. ⚠️ **Found while gathering facts**: the MCP server's token refresh is
read → network round trip → write the whole object, so credentials the app writes during that window are
**overwritten with the old ones plus a fresh token — silently, and working**. Q1 proposes stopping the MCP
process before writing. Q5 proposes a test that scans the MCP server source for its error templates, because the
server is fetched at image build and its wording can change. ⚠️ The Docker CLI on Windows has failed since the
reboot (engine healthy in the VM), which blocks the `:3011` probes.

---

## 2026-10-08T15:44:21Z — Docker CLI failure diagnosed: Windows 11 26H2 feature update, not this project

User asked for the cause before a restart, and to make sure it was not something we did. **It was not.** Timeline
(local, from the System log and Rancher Desktop logs): 26H2 downloaded 00:09 and installed 00:10; `MoUsoCoreWorker`
restarted the machine at 01:30:27. Seconds after boot the machine entered **Modern Standby** (01:31:28). During it
the Hyper-V switches were deleted and the **WSL Service was set to disabled, then reinstalled** (01:31:32–42).
Rancher Desktop started at 01:31:51; its Win32 socket proxy crashed 8× (*timed out dialing Hyper-V socket*), then
connected at 01:32:08. There were six standby cycles to 08:54. At **08:57:07** the first `docker` call since boot
found the in-VM listener dead: `docker-proxy: … accept() … bad file descriptor` in a **tight loop with no
backoff**. When it died is unknowable, because nothing connected before.

Only read-only commands were run today (`docker ps`, `context ls`, `version`, `rdctl shell`, `curl`); no
Rancher/WSL/Docker setting was changed. **The app was unaffected throughout** — port forwarding is a separate
path; `/api/health` stayed ok.

⚠️ **Side effect: `docker.log` reached 4.8 GB, growing ~0.5 MB/s (~1.8 GB/h), on C: (110 GB free).** The user quit
Rancher Desktop, it would not relaunch, so the user is **rebooting**. This is a third variant of the 2026-09-30
pattern: **a host component updated under Modern Standby breaks the WSL plumbing while recording survives.**

▶ **After the reboot, check**: `docker ps` works from Windows · `%LOCALAPPDATA%/rancher-desktop/logs/docker.log` is
small and **not growing** (if the 4.8 GB file survived, ask the user before deleting it) · the container is up and
`/api/health` ok · plays are recording. If the Hyper-V socket error recurs on a clean boot, suspect a 26H2 ×
Rancher Desktop 1.24.0 / WSL 3.0.1 incompatibility rather than standby.

---

## 2026-10-08T15:50:11Z — Post-reboot checks PASS; U7 NFR questions answered (all A)

Reboot at 11:46 local. ✅ `docker ps` works from Windows (client 29.6.2-rd, server 29.5.3) · ✅ Rancher started a
fresh `docker.log` (160 KB, growing ~0.6 KB/s, the normal k3s noise) — **the 4.8 GB file is gone**, nothing needed
deleting · ✅ `spotify-now-playing` up and healthy, `/api/health` ok, UI 200 · ✅ polling, nothing playing at check time
(so a new play row could not be observed yet).

⚠️ **One `docker-proxy … bad file descriptor` line at 11:48:24, during startup**, with two brief Hyper-V socket
timeouts in `wsl-helper.log`. It did **not** loop (count stayed 1). So the same error appears transiently at startup and
normally recovers; this morning's state was the case where it did not.

⚠️ **A misreading, corrected the same minute**: I read `pollsReturningNothingPlaying = 1` as a count (*"38 of 39
playing"*) and suspected F5. It is a **share** (`upstreamMetrics.ts:162`) — 100% idle, consistent with the snapshot.
A name that reads as a count but holds a ratio; worth renaming when BR-58.3 touches this code.

U7 NFR Design plan: **Q1–Q7 all A.** Writing the deliverables.

---

## 2026-10-08T16:16:21Z — ✅ U7 NFR Design APPROVED

User: *"Continue"* after the deliverables were presented as awaiting approval — taken as approval, and recorded
in those words so the reading can be checked. P-49…P-57, LC-40…LC-48, PBT-59…PBT-67. Next: Infrastructure Design plan.

---

## 2026-10-08T16:16:32Z — U7 Infrastructure Design plan written (6 questions)

`construction/plans/u7-infrastructure-design-plan.md`. Q1/Q2 are the deliberate reversal of `./config`'s and
`musicbrainz.json`'s `:ro` — surfaced as posture, with the compose comments to be rewritten, not edited. ✅ In-place
writes through a single-file mount are **already proven on this host** (the MCP server's hourly token rewrite).
⚠️ Q3: P-U7-1 needs **real** credentials on the `:3011` copy, which IN-U6-3 forbade — proposed as a written,
probe-only amendment.

---

## 2026-10-08T19:08:27Z — U7 Infrastructure Design answered (Q1–Q6 all A); deliverables written

User: *"accept recommended values, doc updated"*. Written: `infrastructure-design/infrastructure-design.md`
(**IN-U7-1…6**) and `deployment-architecture.md`. ⚠️ IN-U7-3 is a **written, probe-only amendment** to IN-U6-3:
a reduced copy of the real credentials on the `:3011` copy for P-U7-1/2, removed by `verify:down`; the
no-credentials contract applies again for everything else. Awaiting approval.

---

## 2026-10-08T19:12:37Z — ✅ U7 Infrastructure Design APPROVED

User: *"approve and continue"*. IN-U7-1…6. Next: U7 Code Generation plan.

---

## 2026-10-08T19:13:55Z — U7 Code Generation plan written (13 steps, 2 scoping questions)

`construction/plans/u7-code-generation-plan.md`. Step 1 is the three probes on `:3011` (P-57), gated: if P-U7-2
fails, return to NFR Design. FR-71 (Step 4) precedes FR-69 (Step 6). Q1: fallback if the placeholder token does not
trigger a refresh (recommend: the app refreshes once immediately after writing). Q2: ship FR-71 early or with the rest
(recommend: one deployment).

---

## 2026-10-08T19:15:58Z — ✅ U7 Code Generation plan APPROVED (Q1 = A, Q2 = A)

User answered both scoping questions A in the plan, then *"continue"* — taken as approval. Q1: if P-U7-1 fails, the
app refreshes once itself immediately after writing. Q2: one deployment at Build & Test. Starting Step 1 (probes).

---

## 2026-10-08T19:19:36Z — U7 Code Generation Step 1: probes P-U7-1…3 ALL PASS

On the `:3011` copy (U6 image), with a reduced credential copy (`verify:up --probe-credentials`, IN-U7-3; no value
printed). ✅ **P-U7-1**: four values + placeholder token → the MCP server refreshed on the first poll; real token,
expiry +59.8 min, refresh token unchanged — BR-56.4 confirmed, Q1's fallback unneeded. ✅ **P-U7-2**: `close()` ends
the child — **after ~2004 ms**, not instantly, so awaiting the exit is load-bearing. ✅ **P-U7-3**: a corrupted
refresh token yields `Error getting current track: Failed to refresh access token…`; snapshot `playing: true`,
fields null, counted as a **playing** poll, MCP errors 0 — **F5 confirmed live**; BR-58.1's pattern matches, negative
controls do not. `verify:down` no-impact proof passed; the credential copy is gone; live `/api/health` ok.
`scripts/verify-install.mjs` gained `--probe-credentials`. Record: `probes/p-u7-1-3-2026-10-08.md`.

---

## 2026-10-08T19:24:48Z — U7 Code Generation Steps 2–3 done; PBT-66 corrected F7 on its first run

Step 2: `configuration/atomicWrite.ts` extracted from `AutomationStateStore` — its 19 tests pass **unchanged**.
Step 3: `rulesComparison`, `masking`, `mcpErrorText` (pure), 28 tests, purity 80/80.

⚠️ **PBT-66 failed on its first run, and the test was right.** FD fact F7 (*"20 error templates, all `Error
<verb>ing …:`"*) was a grep over backtick templates only; the server has **25**, six of them single-quoted `Error: …`.
A pattern built on F7 would have read those as data. Pattern widened to `^Error[^
]*:` (no non-error text starts
with `Error`); F7′ recorded. Same family as the plan's M4 claim this morning: **a count from a grep, recorded as
though it were the population.** ⚠️ CI now fetches the MCP source at the Dockerfile's ref so PBT-66 can run there —
and `MCP_SERVER_REF=main` floats, which is exactly why the scan earns its place.

---

## 2026-10-08T19:28:00Z — U7 Code Generation Step 4 done: FR-71 (a Spotify failure is a failure)

Text errors from the MCP server throw `McpToolError`; the poll publishes *"Spotify returned an error: …"*; polls are
three-way and M4 is `idleShare` (null for an all-error run). Tests use P-U7-3's real strings. Full suite 1450/1450.

---

## 2026-10-08T19:31:24Z — U7 Code Generation Step 5 done: RulesWriter

`configuration/RulesWriter.ts` — stage (shared parser → compare), confirm under a lock with BR-54's hash checks
and `REPLACE` rule, atomic previous + current, the watcher's reload as the verdict; undo swaps; `applyAtStartup` for
BR-59.5. 21 tests on a real store and watcher, including PBT-63 (positive control) and PBT-64 (N concurrent tabs →
exactly one applies). Deviation: stagings keyed per token, not one slot.

---

## 2026-10-08T19:35:23Z — U7 Code Generation Step 6 done: CredentialsWriter — and the app-side twin of F1

`configuration/CredentialsWriter.ts`: P-49's sequence with the child's exit awaited (`mcp/processExit.ts`), in-place
writes, read-back, views only. Suite 1486/1486. ⚠️ **Found from the code**: `SpotifyWebApiClient` caches the whole
credentials file for the process lifetime, so the planned *"drop the token"* would have kept using the OLD
credentials — `forgetCredentials()` added. Same shape as F1 (the MCP server's in-memory client), one layer over:
**a cache nobody listed is a second copy of the state you are replacing.**

---

## 2026-10-08T19:39:04Z — U7 Code Generation Step 7 done: restore can restore rules, only if asked

Restorer carries an opted-in rules file out of `restore-pending/` (never writes `config/`); `finishRestoreRules`
applies it after the restored database opens and only if the current rules are unchanged since confirm. PBT-67 at
every fault point. Suite 1508/1508.
