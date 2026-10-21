# Architecture (as built)

What the running system is, as named in the code. For **why** each piece is the way it is, follow the links into
the design records. The inception-time plan ([`application-design.md`](../aidlc-docs/inception/application-design/application-design.md))
names some components that were never built under those names. Where it and this page disagree, the code and this
page win.

## Context

One person, one machine, one Spotify account. The app polls Spotify every few seconds and records every play with
the observations that led to its outcome. It enriches plays from Spotify and MusicBrainz, evaluates rules the user
writes, and can skip tracks. Skipping sits behind a kill switch and pre-registered safety limits, and ships **off**.
It is a data-collection instrument first and a rules engine second.

```
Browser ──HTTP + WebSocket (127.0.0.1 only)──▶ spotify-companion container
                                                 ├── Node · Express · ws · node:sqlite
                                                 ├── child process: spotify-mcp-server (pinned SHA, one-line patch)
                                                 │       └── getNowPlaying ──▶ Spotify Web API
                                                 ├── direct Web API client (enrichment, liked set, context, skip)
                                                 └── MusicBrainz client (rate-limited queue)
                                               bind mounts: data/ (history.db, snapshots)   config/ (rules.json)
                                                            state/ (automation kill switch)  secrets/app/ (credentials)
```

Developers also have a derived `reporting.db` and an optional Metabase container (`reporting/compose.yaml`). Neither
is on the app's path.

## Components

| Area | Where | Nature |
|---|---|---|
| Composition root | `src/server.ts` (wiring, startup, WebSocket upgrade), `src/api.ts` (every route, dependencies injected) | impure; `server.ts` cannot be imported by a test, so its ordering is pinned by source-text tests |
| Ingress policy | `src/localGuard.ts` (`decideAccess`, one rule for HTTP and WebSocket), `src/ingest/` (one admission path for uploaded files) | pure decision, thin adapters |
| Playback observation | `src/nowPlayingService.ts`, `src/mcp/parseNowPlaying.ts` (pure), `src/mcp/spotifyMcpClient.ts` | the connector's text format is isolated behind one parser |
| History | `src/history/` (`PlayObserver`, `outcomeClassifier` (pure), `SqliteHistoryRepository`, `migrations`) | the data that cannot be regenerated |
| Enrichment | `src/spotify/` (Web API client, liked-set cache), `src/musicbrainz/` (`labelClassifier` (pure), request queue, label cache, backfill) | fails to `null`, never blocks the display |
| Rules | `src/rules/` (`predicate`, `RuleEngine`, `fieldCatalogue`, `trackFacts` (pure); `RuleStore`, `RuleSetWatcher`, `EvaluationCoordinator`, `LoggingExecutor`) | tri-state: a rule over unknown data answers *unknown* |
| Automation | `src/playback/` (`SkipExecutor`, `skipDrain`, `safetyCounters`, `AutomationStateStore`, `spotifyPlayerClient`) | two off switches; the only code that changes playback |
| Lifecycle and configuration | `src/maintenance/` (in-app backup and restore, startup swap), `src/backup/` (verifier), `src/configuration/` (`RulesWriter`, `CredentialsWriter`, `atomicWrite`) | one writer per file; every write is temp-then-rename |
| Export | `src/export/` (CSV/JSON export, snapshot scheduler, serialisers (pure)) | the output the analysis depends on |
| Presentation | `src/ui/` (view models derived on the server), `public/` (vanilla JavaScript, no build step) | judgement lives in `src/`, the browser displays it |
| Operations | `scripts/` (release, protect, auth, verification installs, `db:*`), `Dockerfile`, `scripts/docker-entrypoint.sh` | outside the test suite; `npm run smoke` proves they load |

## Invariants, and the tests that hold them

The architecture rests on a few rules. Each one is enforced by a test, so breaking it turns the suite red rather
than relying on a reviewer to notice.

| Invariant | Why | Held by |
|---|---|---|
| Pure modules import nothing impure (no clock, no I/O) | reclassification and back-testing replay exactly what ran live | `test/purity.test.ts` |
| `src/rules/` never imports `src/playback/`; the logging executor takes one collaborator | the rules engine cannot act by accident | `test/playbackBoundary.test.ts`, `test/skipExecutor.test.ts` |
| One access rule for HTTP and WebSocket; one admission path for uploaded files | a rule implemented twice drifts (it did once: a WebSocket `403`) | `test/localGuard.test.ts`, `test/ingestPolicy.test.ts` |
| One writer of `history.db`; a restore is applied at startup, before the database opens | no second process ever writes the irreplaceable file | `test/maintenanceWiring.test.ts` |
| `null` means unknown, never `false` or `0`, from classifier to export | an absent fact must not read as a negative one | property tests on `predicate`, `ruleEngine`, `serialisers` |
| Every source module is reachable, and every export is used | dead code an agent wrote is otherwise invisible | `test/noOrphanModules.test.ts`, `npm run knip` |
| The version has one source; documents name only real commands and paths | copies decay | `test/versionSources.test.ts`, `test/docs.test.ts` |

## The decisions that explain the shape

- **Pure core, impure shell.** Anything that decides (outcomes, labels, rule matches) is a pure function of its
  inputs, so it can be re-run over old data. Inputs that change over time, the clock included, are passed in.
- **Evidence over verdicts.** A play keeps its observation trail and the classifier version that judged it, so a
  better classifier can re-derive old outcomes (`npm run reclassify`).
- **One writer, one admission rule.** Backup and restore run inside the app rather than beside it. Access and
  uploads each have one policy function.
- **Probe, don't reason.** Spotify's Development Mode restrictions are undocumented. The current findings are in
  [`research-findings.md`](../aidlc-docs/inception/research/research-findings.md), and they supersede the
  documentation.
- **Constants on purpose.** Safety thresholds, rate spacing and size caps are code constants, not settings, so a
  configuration change cannot loosen them.
- **Local only.** There is no authentication because the trust boundary is the loopback interface (the `127.0.0.1`
  publish, the Host check and the Origin check). Off-machine access waits for a design that replaces that premise.

## Where to read next

- [`CONTRIBUTING.md`](../CONTRIBUTING.md): how a change gets in, and the traps.
- [`aidlc-state.md`](../aidlc-docs/aidlc-state.md): the current state of the work.
- [`requirements.md`](../aidlc-docs/inception/requirements/requirements.md): requirements, decisions, risks and the
  backlog.
- [`audit.md`](../aidlc-docs/audit.md): every decision, with what was rejected.
