# Pre-public solution review — 2026-10-21 (public-readiness §6 step 2, architecture)

**Reviewer**: a different model from the one that built the project (Claude Fable 5.1), asked by the owner to take a
solution-architect view of the software and solution architecture before the repository and image go public.
Companion to [`pre-public-code-review.md`](pre-public-code-review.md), which holds the file-and-line findings; this
document holds the structural ones. Tree at `fefd768`. **No file other than this one was changed.**

**Verdict in one paragraph.** This is an unusually well-reasoned small system: a pure core with a mechanically
enforced boundary, a data model that keeps evidence rather than conclusions, a safety posture that can be read off
the import graph, and a verification practice that has repeatedly caught its own wrong beliefs. Nothing in the
architecture blocks going public. The review's substantive points are: one dependency that no longer earns its
weight (the MCP connector, §3.1), a composition root and a repository that have grown past the point where the
design's own promises hold cleanly (§3.2, §3.3), a scheduled-job pattern with no heartbeat (§3.5), the absence of an
as-built architecture page for the people a public repository will now attract (§3.9), and a short list of
decisions the owner should make on purpose rather than by default (§5).

---

## 1. What was reviewed

| Source | Read |
|---|---|
| Inception records | `requirements.md` (settled decisions, NFRs, risks R1–R12, backlog W-1…W-16), `research-findings.md` (why MCP, the two restriction waves, Q6), `application-design.md`, `component-dependency.md`, `unit-of-work.md` (U0–U12), `execution-plan.md` |
| As-built code | every file in `src/` by size and import graph; `public/app.js` by section; the three compose files; `Dockerfile`; `scripts/release.mjs`; the structural tests (`purity`, `noOrphanModules`, `knip.jsonc`, `versionSources`, `docs`) |
| Measurements taken | cross-directory import edges (derived from `src/`); file sizes; schema outline from `migrations.ts` (v1–v7); the set of MCP tools and Web API endpoints actually called; design-record volume (172 Markdown files, ~39,600 lines; 590 distinct BR ids, 68 LC, 75 P, 74 PBT) |

Not done: nothing was run except the import-graph and size scripts; the live database was not opened.

---

## 2. The system as built (a one-page as-built view, because none exists in `docs/`)

**Context.** One person, one machine, one Spotify account. The app polls Spotify every 3 s, records every play with
its observation trail, enriches plays from Spotify and MusicBrainz, evaluates user-authored rules, and can skip
tracks under a kill switch and pre-registered safety limits. It is a data-collection instrument first (R1 is unproven
and its one confirmatory run is spent) and a rules engine second.

**Containers (deployment units).**

```
Browser ──HTTP+WS (127.0.0.1:3010)──▶ spotify-companion container
                                        ├── Node 22.23 · Express 5 · ws · node:sqlite · tar
                                        ├── child process: spotify-mcp-server (upstream, pinned SHA, patched 1 line)
                                        │       └── getNowPlaying (markdown) ──▶ Spotify Web API
                                        ├── direct Web API client (enrichment, liked set, context, skip)
                                        └── MusicBrainz client (1 req/s queue)
                                      bind mounts: ./data (history.db + snapshots)  ./config (rules.json)
                                                   ./state (kill switch)            ./secrets/app (credentials)
Developer-only side path: reporting.db (derived) ──▶ Metabase container (separate compose project)
```

**Components (as named in code, not in the 2026-08-25 design).**

| Layer | Modules | Nature |
|---|---|---|
| Composition root | `server.ts` (1,570 lines), `api.ts` (1,022), `config.ts`, `diagnostics.ts` | impure wiring |
| Ingress policy | `localGuard.ts` (`decideAccess`, one rule for HTTP and WS), `ingest/*` (one admission path for files) | pure + thin adapters |
| Playback observation | `nowPlayingService.ts` (`tick`/`change`), `mcp/parseNowPlaying.ts` (pure), `mcp/spotifyMcpClient.ts` | the brittle seam is isolated as designed (NFR-19) |
| History | `history/PlayObserver.ts`, `outcomeClassifier.ts` (pure, v2), `SqliteHistoryRepository.ts` (1,248 lines, 33 methods), `migrations.ts` (v1–v7, forward-only) | the irreplaceable data |
| Enrichment | `spotify/enrichment.ts`, `LikedSetCache.ts`, `musicbrainz/*` (`labelClassifier` pure, `RequestQueue`, `LabelCache`, backfill) | fail-to-null, never on the display path |
| Rules | `rules/predicate.ts`, `RuleEngine.ts`, `fieldCatalogue.ts`, `trackFacts.ts` (pure); `RuleStore`/`RuleSetWatcher` (poll, not watch); `EvaluationCoordinator`; `LoggingExecutor` | tri-state `unknown` end to end |
| Automation | `playback/SkipExecutor.ts`, `skipDrain.ts`, `safetyCounters.ts` (pre-registered constants), `AutomationStateStore.ts`, `spotifyPlayerClient.ts` | two off switches; `rules/` imports nothing from `playback/` |
| Lifecycle & configuration | `maintenance/*` (in-app backup/restore, startup swap), `backup/verifier.ts`, `configuration/RulesWriter.ts`, `CredentialsWriter.ts`, `atomicWrite.ts` | one writer; every write temp+rename |
| Presentation | `ui/*` (server-derived view models), `public/app.js` (2,442 lines, vanilla, no build, no tests) | judgement on the server by rule |
| Operations | `scripts/` (33 files; `release.mjs`, `protect.mjs`, `verify-install.mjs`, `db:*`), `check-image.sh`, `docker-entrypoint.sh` | outside the test suite; `smoke` proves load only |

**The five invariants the architecture actually rests on** (each is enforced by a test, which is the project's best
habit):

1. Pure modules import nothing impure (`test/purity.test.ts`) → re-derivation and back-testing stay faithful.
2. `src/rules/` never imports `src/playback/`; `LoggingExecutor.length === 1` → the engine cannot act by accident.
3. One admission rule (`decideAccess`) for HTTP and WebSocket; one file-admission path (`ingestGuard`).
4. One writer of `history.db`, and restore happens at startup before the database opens.
5. `null` means unknown, never `false` or `0`, from the classifier to the export.

---

## 3. Findings

Ordered by architectural leverage, not by severity. Each ends with what I would do and what it would cost.

### 3.1 The MCP connector is no longer load-bearing — the single highest-leverage simplification

**What is true now.** The app calls exactly **one** connector tool, `getNowPlaying` (`src/mcp/spotifyMcpClient.ts:148`),
plus `listTools` for health. Everything else already goes to the Web API directly: `/tracks/{id}`, `/me/following`,
`/me/tracks`, `/me/player/recently-played`, `/me/player/next`, and, since U5, **`/me/player/currently-playing`
itself** (`src/playback/playbackContext.ts:93`), fetched once per track because the connector's markdown omits the
context. The research record said this plainly on day one: *"For a read-only now-playing display, MCP is not the
minimal path … MCP earns its place here if the intent is to (a) learn/exercise MCP, or (b) leave the door open for an
LLM agent to drive playback later"* (`research-findings.md`, *Worth stating plainly*). Neither intent appears in U10,
U11 or U12.

**What it costs today** (all of it visible in the records of the last three weeks):

- A second OAuth client on the same refresh token, with a second refresh schedule and a second writer of
  `spotify-config.json`, which forced the single-file→directory mount change, the `EBUSY` finding, the
  `credentialsDirectory` startup classifier, and the pause–close–wait-for-exit–write–read-back choreography in
  `CredentialsWriter` (P-49/P-50).
- A build stage that clones upstream at a SHA, **patches one line of its source** (`patchConfigPath.ts`), runs its
  test suite, and fails the build if that line moves; an acceptance ceremony (`connector-acceptance.json`) the release
  script enforces; a CI step that clones upstream source so PBT-66 can scan its error templates; a second licence
  notice in the image.
- The markdown wire format (R6, NFR-19): a parser with a documented unresolvable ambiguity (`| **word**: ` inside a
  title), a *"Spotify: ok"* false green when errors arrived as text (F5), and 1,200 polls/hour whose payload is
  prose meant for an LLM.
- `src/mcp/` (323 lines), `mcpErrorText.ts`, `processExit.ts`, the `@modelcontextprotocol/sdk` dependency, and the
  `/opt/spotify-mcp` tree in the image.

**What replacing it would be.** One method on the existing `SpotifyWebApiClient`: `GET /me/player/currently-playing`
every 3 s (204 when idle, probed 2026-08-25), mapped to the existing `NowPlaying` shape, including `context` for
free. The poll cost is unchanged (one request per tick either way) and the per-track context fetch disappears. The
in-memory token refresh the Web API client already does becomes the only refresh; `spotify-config.json` is then
written only by `auth` and Settings. Dockerfile stage 1, the patch, the acceptance file, the PBT-66 clone step and
the directory-mount classifier all go. **Estimated size**: one unit, smaller than U9, mostly deletion; the
risk is the few fields the connector exposes that the endpoint names differently (`device`, `volume`, `shuffle`,
`repeat` come from `/me/player`, one call, not `/currently-playing`; decide whether the panel keeps them).

**What I would do.** Not before the switch: the pin was just moved and accepted, and the image is stable. But I would
**record the decision explicitly** in `requirements.md` §2 (D1 is dated 2026-08-25 and its premise has changed) and
put a unit on the roadmap, before U11: the NAS deployment inherits every one of the costs above (U11 even carries
*"no MCP server"* in its least-authority note, U9-c). If the owner's intent (a) or (b) still stands, write that down
instead, so the next reviewer does not raise this again.

### 3.2 The composition root has outgrown its name

`src/server.ts` is 1,570 lines. It is the wiring, and it is also: the display label cache and its eviction, the
status-bar derivation (`statusIndicators`, `automationIndicatorState`), `likedFor`, the restore-at-startup sequence
with its fallback, the diagnostics assembly, the broadcast, the shutdown path, and the one place both automation
switches are explained. `api.ts` receives 25 injected fields. The module is excluded from `knip`'s entry list and
reached by no test; the project's own history (the WebSocket 403, nine routes at zero coverage) is the story of
this file.

Nothing is wrong *in* it; the problem is that the one file a newcomer must read to understand the system is the one
file no test exercises, and that U11's trusted-proxy mode and any future second transport will land here too.

**What I would do.** Extract a `composeApp(config, ports) → { app, server, start(), stop(), diagnostics }` from the
module-level statements, leaving `server.ts` as a ten-line `main`. Then a single in-process test can start the whole
composition against a temp `data/`, a stub MCP/Web API and a fake clock, which is the end-to-end test the suite lacks
(§3.7). Move the label-display cache and the indicator derivation into `ui/` beside their pure functions. Cost: a
focused refactor with no behaviour change; the `maintenanceWiring` and `structure.u9` tests pin the orderings that
must survive it.

### 3.3 Layering: the repository has become the system's junction box

Measured import edges that cut against the design's "services → impure → pure" rule:

| Edge | File | Why it matters |
|---|---|---|
| `history → playback` | `SqliteHistoryRepository.ts:48` imports `ruleSkippedThisPlay` (a SQL fragment) from `playback/SqliteSkipAttemptRepository.ts` | the oldest layer now depends on the newest; a change to skip attempts can break play counting |
| `history → reporting` | `playStats.ts:25` imports `localWeekStart` from `reporting/timeBuckets.ts` | a pure core module depends on the developer-only reporting path |
| `history → musicbrainz` | `SqliteHistoryRepository.ts:35,44` implements `LabelRepository` | one class is the persistence for plays, trails, labels, artists, liked evidence and coverage |

`SqliteHistoryRepository` has 33 public methods behind an interface whose stated purpose (NFR-10) is that the engine
can be swapped without touching call sites. At this width the promise is nominal: nobody will re-implement 33
methods, several of which (`recentPlaysForCounting`, `historyCountsBefore`, `labelCoverage`) are shaped by the SQL
that answers them. R10 (`node:sqlite` experimental) is the risk the interface was meant to contain; it is better
contained by the fact that `node:sqlite` has stabilised than by the interface.

**What I would do.** Not a rewrite. (1) Move the two shared pieces (`ruleSkippedThisPlay`, `localWeekStart`) into a
neutral home so the direction of every edge is `later unit → earlier unit`, and add a structural test for that rule,
the way purity is tested. (2) Split the SQLite class along the aggregates that already have their own tables:
plays+trails, label resolutions, liked evidence, coverage queries, each a small class over the one `DatabaseSync`.
The `HistoryRepository` interface shrinks to what `PlayObserver`, `ExportService` and `BackTestService` need. Cost:
mechanical; the 1,700 tests are the net.

### 3.4 Data architecture: right instincts, two questions nobody has had to answer yet

What is right: evidence over verdicts (the trail; classifier versions on every derived column; `reclassify` has
been run for real), forward-only additive migrations with a verified by-image rollback, `null` as unknown
everywhere, the schema allow-list in the verifier replayed from the real migrations, backups that exclude
credentials and the kill switch by construction, and a derived `reporting.db` so a BI tool never touches the writer.

Two questions the design defers and public use will ask:

- **Growth of `observation`.** One row per 3 s poll per play, never pruned (the design says *"prunable later once
  the classifier stabilises"*). At ~60 samples per play and the owner's rate, this is the table that will dominate
  `history.db`, the backup size, the upload cap (64 MB compressed, 256 MB expanded), and the restore comparison. No
  number is recorded for the current size; `/api/maintenance` reports bytes against caps, which is the right
  instrument. **Ask**: a stated retention policy for trails (for example, keep full trails for `unknown` and
  reclassified plays, thin the rest to first/last/max-progress after N days), and a measured projection in U10.
- **`play` is a wide table grown by `ALTER TABLE ADD COLUMN`** across seven versions (label, artist, liked, skip,
  context, explicit…). That is a reasonable SQLite choice and it keeps exports flat. The cost is that every unit adds
  columns to the one table whose rows cannot be regenerated, and the rollback guarantee (an older image tolerates
  newer columns) holds only while additions stay nullable and no column is renamed again (v4 renamed one). **Ask**:
  write the compatibility rule down as a BR: *additive and nullable, or a MAJOR version* (NFR-34 already implies
  it).

### 3.5 Scheduled work has no positive heartbeat — the FR-80 defect is a pattern, not an instance

The snapshot scheduler stopped on 2026-10-03 and diagnostics said `ok` for 15 days: a timer reset by every restart
and never run at startup. The same shape exists for the label backfill interval (`setInterval` in `server.ts:1499`),
the liked-set refresh riding on it, the rules poll and the drain backstop. Each is a `setInterval` with its own
status fields and no notion of *overdue*. The project's own trap list says it: *"detection needs a positive
heartbeat, and the app cannot report its own absence."*

**What I would do.** One small `JobRegistry`: each periodic job registers `{ name, intervalMs, lastRunAt, lastOutcome,
nextDueAt }` and runs through it; diagnostics derives `fail` from *now > nextDueAt + grace* rather than from the
job's own opinion; snapshots schedule from the newest file on disk at startup (FR-80 as planned). This generalises
FR-80 for the cost of FR-80.

### 3.6 Security architecture: the posture is coherent; the population it was designed for is about to change

The trust boundary is the loopback interface, carried by three things: the `127.0.0.1` publish, the Host check, and
the Origin check. NFR-07 (*no authentication*) is explicitly conditional on those three holding. That reasoning is
sound for one developer's machine. Public use changes two inputs:

- **Other local services become the threat model.** Every user's machine has other things on `localhost`; the code
  review's finding on port-agnostic Origin (2.1.1) is the architectural consequence. The fix is small; the point is
  that *"loopback"* and *"same origin"* are not the same claim, and the policy should say which one it enforces.
- **U11 replaces the premise.** NFR-29's trusted-proxy mode (OIDC at a proxy, signed identity on every request,
  through `decideAccess`) is the right seam, and the seam exists. Three things to settle in its design, not after:
  the in-app OAuth sign-in on an appliance (W-10: today `auth` must run where a browser is, which on a NAS means
  the published-port dance or a copied file); the upload and credential routes, which the records already say must
  not be reachable off-machine before Question 11 is decided; and the WebSocket upgrade, which the proxy must
  authenticate too. The single-USER assumption is unchanged by U11: one identity, still no roles.

Also worth stating as architecture rather than code: credentials at rest are a plaintext JSON file with a refresh
token that carries write scopes (code review 2.3.1/2.3.2). NFR-07's scope excludes secret managers, which is
reasonable for a local tool; file mode `0600` and a trimmed scope set are the proportionate response.

### 3.7 Verification architecture: deep on the core, nothing end to end

Strengths: property tests on every pure module with a replayable seed; **structural tests as policy**
(`purity`, `noOrphanModules`, `knip`, `versionSources`, `rulesetMatchesWorkflow`, `secretsTracked`, `docs`,
`structure.u9`); negative controls as a convention (the corrupt snapshot kept on purpose); and a written record of
eight live defects the suite did not catch, which is more honest than most projects manage.

Gaps, by layer:

| Layer | Automated coverage | How it is verified today |
|---|---|---|
| Pure core | property tests | strong |
| Routes with injected deps | unit tests | strong |
| Composition (`server.ts`) | **none** | live deployment, agent cold walks |
| Browser (`app.js`, 2,442 lines) | **none** | the owner's eyes; one Restore button looked enabled while disabled |
| `scripts/` (33 files, incl. `release`, `db:restore`) | load only | hand runs |
| Container + mounts + entrypoint | CI builds it; `verify:up` on `:3011` | the F4 permission defect was found by a walk |

**What I would do.** Two additions, both cheap relative to what they cover: (1) the in-process composition test from
§3.2, which also exercises the WebSocket handshake and the startup-restore order; (2) a four-scenario browser smoke
test (page loads and shows a stubbed track; WebSocket connects; kill switch reads off; Settings opens) with Playwright
against the composed app, run in CI. The mutation-testing item (W-6.1) stays the right next step after those.

### 3.8 Build, release and deployment

- **Release is coupled to the owner's live deployment.** `npm run release -- --apply` verifies, builds, **deploys to
  the live container**, health-checks, then tags (`scripts/release.mjs` header). For one machine that is a feature.
  For a public project with other installers it conflates two acts: *cut a version* (tag, publish) and *deploy here*.
  U10's FR-76 (backup before a release deploys) is about to add more to the same script. **Ask**: split `release`
  (tag + push triggers publish) from `deploy` (pull or build, backup, migrate, health) so the second can also be
  the App-only `update` command FR-79 wants.
- **Three compose files held equal by tests** (`compose.yaml`, `compose.app.yaml`, `compose.verify.yaml`). Acceptable;
  the App-only `setup` writing a version-pinned compose file is a good choice. The hand-edited `image:` line is the
  update path until FR-79.
- **One architecture is published (`linux/amd64`).** Apple Silicon is the most common developer laptop and the NAS
  may be arm64. A `buildx` multi-arch build is a few lines in `publish`, and the base image is multi-arch already.
  Do this before public; a Mac user's first experience would otherwise be emulation or a pull failure.
- **Node 22.23 is pinned for `node:sqlite`'s `backup()`.** Node 22 is in maintenance; plan the move to the current
  LTS line as a deliberate unit (the startup capability check and the pinned minor make it safe to do later).
- **Runtime dependencies are four** (express, ws, tar, MCP SDK). That is a real asset; §3.1 would make it three.
- **The root-then-drop entrypoint** is the conventional answer to bind-mount ownership and is well argued. The
  alternative (named volumes) was rejected for host reachability of `data/`; that trade is still right for a tool
  whose users want their database as a file.

### 3.9 The design record is the project's greatest strength and its highest barrier to entry

172 Markdown files, ~39,600 lines, 590 business-rule identifiers, an append-only audit log, and a state file whose
current line was superseded eighteen times. For an agent resuming work this is excellent, and `CLAUDE.md` routes it
well. For a **person** arriving from a public link there is no as-built architecture page: `application-design.md`
is dated 2026-08-25 and names components that were never built under those names (`SafetyGovernor`,
`PlaybackController`, `EnrichmentPrewarmer`, `HistoryService`); the units were renumbered three times and the records
say so in three places; `README.md` deliberately holds no design (NFR-33). The first thing a reviewing developer will
do is open `src/server.ts` (§3.2).

**What I would do, before the switch.** One `docs/ARCHITECTURE.md` of about two pages: §2 of this document (context,
containers, components as named in code, the five invariants and the tests that hold them), plus *where the
records are* and *the three decisions that explain the shape* (pure/impure, one writer, one admission rule). Link it
from README's *Getting started*. Mark `application-design.md` as the inception-time plan it is, with a one-line
pointer to the as-built page. `test/docs.test.ts` already checks that every path in such a page resolves, so it
cannot rot silently.

### 3.10 Smaller observations

- **`nowPlayingService` is the hub** the design predicted and accepted; it has stayed a plain emitter. Good.
- **`ui/` view models in API responses** (`view`, `haltPanel`, `comparisonView`) are the price of a bundler-free
  browser. The rule *"judgement lives in `src/`"* is sound; the cost is that every panel needs a server change. If
  `app.js` keeps growing, a typed shared module compiled for both sides is the next step, not a framework.
- **Constants that are deliberately not configurable** (safety thresholds, rate spacing, caps) are one of the best
  decisions in the codebase and should be named as a principle in the architecture page.
- **Diagnostics as the operability surface** (no metrics endpoint by decision) is right for a single user; the
  `upstreamMetrics` idle-share signal is the one piece of real telemetry and it is well chosen.
- **In-memory staging maps** (restore tokens, rule stagings) are fine for one process and one user, and the records
  say why; they would be the first casualty of any multi-instance deployment, which the single-USER rule excludes.

---

## 4. What is good enough to leave alone

So the next reviewer does not re-open them: the single-container topology; bind mounts over named volumes; SQLite
with WAL over the bind mount (probed); the poll instead of `fs.watch` (probed); the two off switches for automation;
the typed-word confirmations; the strategy split between `LoggingExecutor` and `SkipExecutor`; the pre-registered
thresholds as code constants; the pinned, SHA-fetched connector *given that it is kept*; GPL-3.0 with the MIT notice
in the image; the one-source version in `package.json`; and the AI-DLC gating itself, which is what produced the
record that made this review possible in a day.

---

## 5. Recommendations and decisions for the owner

**Before the switch** (documents and settings only, no code):

1. Write `docs/ARCHITECTURE.md` as in §3.9 and link it from README.
2. Record the MCP decision (§3.1): keep with a stated reason, or schedule its removal as a unit before U11.
3. Publish `linux/arm64` alongside `amd64` (§3.8), or state in INSTALL-APP that Apple Silicon is untested.

**Next units, in this order of leverage:**

4. Job registry with overdue detection (§3.5) as the shape of FR-80, inside U10.
5. Split `release` from `deploy` (§3.8) while U10 touches the release script anyway.
6. Extract `composeApp` and add the composition test plus the browser smoke test (§3.2, §3.7).
7. Fix the three reversed import edges and add the layering test; then split the repository (§3.3).
8. Observation-trail retention policy and the schema compatibility rule, written as BRs (§3.4).

**Decisions only the owner can make:**

- Is MCP still wanted for intent (a) learning or (b) an LLM agent driving playback? If neither, §3.1 is the plan.
- How much trail to keep, and for how long (§3.4).
- Whether the NAS (U11) is *the* deployment or a second one; it decides whether in-app sign-in (W-10) is on the
  critical path.
- Whether a browser test harness is worth its dependency weight for a project that has, until now, had four runtime
  and eight development dependencies.
