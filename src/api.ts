/**
 * The HTTP API, as a router built from injected dependencies.
 *
 * ## Why this is not in `server.ts`
 *
 * Importing `server.ts` starts everything — it connects to the MCP server, opens SQLite, starts
 * the poll loop and calls `listen()`. So nothing could import it, so nothing tested it, and a
 * **952-line file holding nine routes had zero test coverage while the suite reported 98.96%**.
 * That figure was not lying about the routes; it could not see them. V8 coverage only reports
 * modules a test actually loaded, so a file nothing imports is missing from the *denominator*
 * rather than dragging the average down — the same shape as this project's other denominator
 * traps, and considerably more dangerous because it reads as good news.
 *
 * It is also the file with the worst defect history here: the WebSocket `403` that made the UI
 * sit on "Disconnected — reconnecting…" for the life of a deployment lived in `server.ts`, and
 * passed all 411 tests because nothing exercised the handler.
 *
 * Everything the routes need arrives through `ApiDeps`. Nothing in this module reaches for a
 * module-level binding, a clock, or the network.
 *
 * ## `now` is injected
 *
 * Not ceremony: `/api/history/stats` anchors its 26-week window on the current week, so with an
 * ambient clock the one thing worth asserting — that the window ends on the week containing now,
 * and reports whether it was clipped by the cap or by the start of the corpus — is untestable.
 */

import express, { type Response as ExpressResponse, type Router } from 'express';
import type { Snapshot } from './nowPlayingService.js';
import type { SqliteHistoryRepository } from './history/SqliteHistoryRepository.js';
import type { ExportService } from './export/ExportService.js';
import type { LikedSetCache } from './spotify/LikedSetCache.js';
import type { DiagnosticsReport } from './diagnostics.js';
import type { PlayObserver } from './history/PlayObserver.js';
import {
  ExportValidationError,
  parseFormat,
  suggestedFilename,
  validateFilter,
} from './export/ExportService.js';
import { buildTrace, summariseTrace } from './musicbrainz/resolutionTrace.js';
// ⚠️ Aliased: `resolutionTrace` (U2, why a LABEL was chosen) already owns the name
// `buildTrace`, and this is a different thing entirely (U4, why a RULE fired).
import { groupIntoTraces } from './rules/decisionTrace.js';
import type { BackTestService } from './rules/BackTestService.js';
import type { DecisionLogRepository } from './rules/DecisionLogRepository.js';
import type { LoadOutcome } from './rules/RuleStore.js';
import type { DecisionFilter, LoadedRuleSet } from './rules/types.js';
import type { ReadResult as AutomationReadResult } from './playback/AutomationStateStore.js';
import type { SkipAttemptRepository } from './playback/SkipAttemptRepository.js';
import type { AutomationState, WriteOutcome } from './playback/types.js';
import { haltPanel, switchView } from './ui/automationPanel.js';
import { ingestGuard } from './ingest/ingestGuard.js';
import { RULES_UPLOAD_CAP_BYTES } from './ingest/types.js';
import { REPLACE_WORD, type RulesRefusal, type RulesWriter } from './configuration/RulesWriter.js';
import type { CredentialsRefusal, CredentialsWriter } from './configuration/CredentialsWriter.js';
import { appliedMessage, comparisonPanelView, rulesConfirmView, rulesFileStatusView } from './ui/rulesFilePanel.js';
import { musicbrainzSectionView, spotifySectionView } from './ui/credentialsPanel.js';
import { CONFIRM_WORD, type MaintenanceService, type Refused } from './maintenance/MaintenanceService.js';
import { comparisonView, statusView } from './ui/maintenancePanel.js';
import { MAJOR_ROOTS } from './musicbrainz/majorRootList.js';
import { isrcPrefixVote } from './musicbrainz/isrcPrefix.js';
import { LABEL_CLASSIFIER_VERSION } from './musicbrainz/LabelEnrichmentService.js';
import { UNKNOWN_VERSION } from './version.js';
import {
  trendWindow,
  weeklyBuckets,
  type TrendWindow,
  type WeekBucket,
} from './history/playStats.js';

/** Saved-track status as the display needs it. See `likedFor` in `server.ts`. */
export interface DisplayLiked {
  isLiked: boolean | null;
  addedAt: string | null;
  asOf: string | null;
}

export interface ApiDeps {
  /** Null when history failed to open — the app runs display-only (NFR-13). */
  repository: SqliteHistoryRepository | null;
  historyStartupError: string | null;
  exportService: ExportService | null;
  likedSet: LikedSetCache | null;
  labelStartupError: string | null;
  /** Live recording counters, folded into the coverage response. Null when history is off. */
  observerStats: PlayObserver['stats'] | null;
  nowPlaying: { readonly current: Snapshot };
  /** A real MCP round-trip, which is what actually tends to break. */
  listToolNames: () => Promise<string[]>;
  /** The diagnostics sweep, wired in `server.ts` where its many collaborators live. */
  diagnostics: () => Promise<DiagnosticsReport>;
  likedFor: (trackId: string) => DisplayLiked | undefined;
  /** ISO 8601. Injected so the trend window is a function of its inputs. */
  now: () => string;
  /**
   * Zone for calendar bucketing. Injected for the same reason as `now`: a bucket that depends on
   * the host's zone cannot be tested for the boundary that actually goes wrong.
   */
  reportTimeZone: string;

  // -- U4: rule observability ------------------------------------------------
  /**
   * The rule set in force. ⚠️ Comes from `RuleSetWatcher`, which owns it — `RuleStore` holds
   * none (BR-26.3b), so there is no second `current()` to wire this to by mistake.
   */
  ruleSet: (() => LoadedRuleSet) | null;
  decisionLog: DecisionLogRepository | null;
  backTest: BackTestService | null;
  /** Re-reads the rules file. ⚠️ Re-reads only: nothing in U4 writes rules. */
  reloadRules: (() => Promise<LoadOutcome>) | null;

  // -- U5: automated skipping ------------------------------------------------
  //
  // ⚠️ **The first WRITE surface this app has ever exposed**, and it writes to `/state`, never to
  // `./config` — which stays mounted `:ro` so no route can reach the user's hand-authored rules.
  //
  // ⚠️ **No route for metrics and no new WebSocket surface** (Infrastructure Q6). M1–M4 ride on
  // `/api/diagnostics`, which already exists and is already on-demand.

  /**
   * The kill switch's durable state. `null` when U5 is not deployed at all.
   *
   * ⚠️ Narrow on purpose — these three methods are all `AutomationStateStore` exposes that a route
   * needs, and a route that could reach the whole store could reach the file path.
   */
  automation: AutomationControl | null;

  /**
   * ⚠️ **Is `SkipExecutor` CONSTRUCTED** — which is not the same question as whether automation is on.
   *
   * `SKIP_EXECUTOR_ENABLED` is a deployment-time posture fixed at startup; `globalAutomationEnabled` is
   * the operating switch, changed by one click and re-read at every action point. Reported so the UI can
   * say *the machinery is not built* rather than drawing an off switch that would do nothing if thrown.
   */
  skipExecutorEnabled: boolean;

  /** Attempt rows, for the queue depth and the last attempt. `null` when history is off. */
  skipAttempts: SkipAttemptRepository | null;

  // -- U6: user-data lifecycle -------------------------------------------------
  //
  // ⚠️ **The first routes that accept a FILE from outside**, and the first that can REPLACE the corpus. Every
  // one is behind `ingestGuard` (P-42) in addition to the app-wide `localGuard`, and none may be reachable from
  // another machine until NFR-29 is built (U9). Optional so the U0–U5 test harnesses need not construct it.
  maintenance?: MaintenanceService | null;

  // -- U7: configuration management --------------------------------------------
  //
  // ⚠️ The first routes that WRITE configuration — `rules.json` and the credential files. Every POST is behind
  // `ingestGuard` after `localGuard`, and none is reachable off-machine until NFR-29 (U9). Optional, as U6's.
  rulesWriter?: RulesWriter | null;
  credentials?: CredentialsWriter | null;
  /** Whether label enrichment is running — a contact saved while it is OFF needs a restart (Step 6's limit). */
  labelsActive?: boolean;
  /**
   * U8 (LC-57, NFR-34) — the app version from `src/version.ts`, shown at the bottom of Settings. Injected like `now`
   * so the route is testable; absent reads as `unknown`, which the UI shows as `Version unknown`, never blank.
   */
  appVersion?: string;
}

/**
 * What a route may do to the automation state.
 *
 * ⚠️ `probeWritable` is named to match `AutomationStateStore`, so the store satisfies this
 * structurally and `server.ts` passes it with no adapter. **One implementation, reached one way** — the
 * WebSocket `403` happened because one admission rule was implemented twice and the copies diverged.
 */
export interface AutomationControl {
  read(): AutomationReadResult;
  write(next: AutomationState): WriteOutcome;
  probeWritable(): boolean;
}

export function createApi(deps: ApiDeps): Router {
  const router = express.Router();

  // ⚠️ Body parsing belongs to the ROUTER, not to `server.ts`. `POST /api/backtest` is the
  // only route that takes a body, and mounting the parser beside the route means the router
  // works wherever it is mounted — including in tests, which is the whole reason the routes
  // live in this file. Bounded: an unbounded body on a local service is still a way to spend
  // memory by accident.
  router.use(express.json({ limit: '64kb' }));

  /** REST snapshot. The UI uses the WebSocket; this stays for scripting and debugging. */
  router.get('/api/now-playing', (_req, res) => {
    const snapshot = deps.nowPlaying.current;
    if ('error' in snapshot) {
      res.status(502).json(snapshot);
      return;
    }
    res.json(snapshot);
  });

  /**
   * End-to-end check of the connect / auth / query cycle. Each step reports independently so
   * a failure localises the problem. Not cached — it exists to be run on demand.
   */
  router.get('/api/diagnostics', async (_req, res) => {
    const report = await deps.diagnostics();
    res.status(report.ok ? 200 : 503).json(report);
  });

  /** Liveness plus a real MCP round-trip, which is what actually tends to break. */
  router.get('/api/health', async (_req, res) => {
    try {
      const tools = await deps.listToolNames();
      res.json({ status: 'ok', mcp: 'connected', toolCount: tools.length });
    } catch (error) {
      res.status(503).json({
        status: 'degraded',
        mcp: 'disconnected',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Export download (FR-49–54, US-25).
   *
   * Streams rather than buffering — a year of history is ~73k rows, and materialising that would
   * stall the event loop and with it the display. The filter is validated *before* the first byte
   * is written, because once output has begun there is no status code left to change.
   *
   * Served on the existing loopback listener behind `localGuard`: no new port, no new exposure.
   * That is the §3.5 download-only decision, and it is why U1 needed no security review.
   */
  router.get('/api/history/export', async (req, res) => {
    if (!deps.exportService) {
      res.status(503).json({ error: 'History is unavailable.', detail: deps.historyStartupError });
      return;
    }

    let format: ReturnType<typeof parseFormat>;
    let filter;
    try {
      format = parseFormat(req.query.format);
      filter = validateFilter(req.query as Record<string, unknown>);
    } catch (error) {
      if (error instanceof ExportValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }

    const filename = suggestedFilename(format, deps.now());
    res.setHeader('Content-Type', deps.exportService.contentType(format));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    try {
      await deps.exportService.writeTo(res, { format, filter });
      res.end();
    } catch (error) {
      // Headers are already sent, so there is no status code to change. Terminate and log.
      console.error('[export] stream failed:', error);
      res.destroy();
    }
  });

  /** Coverage counts without downloading anything — cheap enough for the UI to poll. */
  router.get('/api/history/coverage', (_req, res) => {
    if (!deps.repository) {
      res.status(503).json({ error: 'History is unavailable.', detail: deps.historyStartupError });
      return;
    }
    res.json({ ...deps.repository.coverage(), ...deps.observerStats });
  });

  /**
   * The resolution trace (BR-12) — how a track's label verdict was reached.
   *
   * A **separate route from `/api/diagnostics`** on purpose. Diagnostics runs a fixed system sweep
   * that hits Spotify and MCP on every call; a trace must make **zero** upstream requests
   * (BR-12.7). Folding it in would mean either a trace re-runs the live health check, or the
   * endpoint grows a mode switch that changes whether it touches the network — the kind of switch
   * that later gets set by accident.
   *
   * Works for **any play in history** (BR-12.4), not just the current one: the rule paths worth
   * inspecting — `contested`, tier `all`, a search-fallback match — cannot be summoned on demand by
   * playing a track.
   *
   * Behind the same `localGuard` as everything else. It reads data the machine already holds, so it
   * adds a route, not exposure.
   */
  router.get('/api/explain/:playId', (req, res) => {
    if (deps.repository === null) {
      res.status(503).json({ error: 'History is unavailable.' });
      return;
    }

    const playId = Number.parseInt(req.params.playId ?? '', 10);
    if (Number.isNaN(playId)) {
      res.status(400).json({ error: 'playId must be an integer.' });
      return;
    }

    const play = deps.repository.getPlay(playId);
    if (play === null) {
      res.status(404).json({ error: `No play with id ${playId}.` });
      return;
    }

    const raw = deps.repository.getPlayLabelPointers(playId);

    const releaseResolution =
      raw.labelResolutionId === null
        ? null
        : deps.repository.getLabelResolutionById(raw.labelResolutionId);

    const release = buildTrace({
      playId,
      resolution: releaseResolution,
      storedClassifierVersion: raw.labelClassifierVersion,
      runningClassifierVersion: LABEL_CLASSIFIER_VERSION,
      majorRoots: MAJOR_ROOTS,
      isrcVote: isrcPrefixVote(play.isrc),
      unknownReason: raw.labelUnknownReason,
    });

    res.json({
      play: {
        id: playId,
        title: play.title,
        artistName: play.artistName,
        albumName: play.albumName,
        startedAt: play.startedAt,
        isrc: play.isrc,
      },
      // One level. The artist-level trace was removed on 2026-09-06 with the verdict it
      // explained: it derived a label from `browse /release?artist=`, which counts releases the
      // artist merely features on, so it was a tidy derivation over other artists' record deals
      // (migration 004). The label a track was released under is this one, via the ISRC.
      release: { ...release, summary: summariseTrace(release) },
    });
  });

  /**
   * Listening statistics for the now-playing panel: how often this track has come up, and the
   * weekly trend for its artist.
   *
   * **Zero upstream requests**, like `/api/explain` and for the same reason — it reads rows the
   * machine already holds. The display calls it on every track change, and a route that could
   * reach Spotify or MusicBrainz would put a third-party outage in the path of a local statistic.
   *
   * Both parameters are optional and answered independently: a track with no `artistId` (Spotify
   * occasionally supplies no artist) still gets its play count rather than an error.
   */
  router.get('/api/history/stats', (req, res) => {
    if (deps.repository === null) {
      res.status(503).json({ error: 'History is unavailable.', detail: deps.historyStartupError });
      return;
    }

    const readId = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      // Spotify ids are 22-char base62; the bound is a sanity check, not a format assertion.
      return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
    };

    const trackId = readId(req.query.trackId);
    const artistId = readId(req.query.artistId);
    if (trackId === null && artistId === null) {
      res.status(400).json({ error: 'Supply trackId, artistId, or both.' });
      return;
    }

    // `asOf` is required for the same reason it is on the coverage figures: these counts move as
    // plays are recorded, so a number without a timestamp is not interpretable later.
    const asOf = deps.now();

    let artist: {
      artistId: string;
      playsInWindow: number;
      firstPlayedAt: string | null;
      window: TrendWindow;
      weeks: WeekBucket[];
    } | null = null;

    if (artistId !== null) {
      // Anchored on the CORPUS start, not this artist's first play, so every artist's chart shares
      // one x-axis and two of them can be compared.
      const window = trendWindow(
        deps.repository.firstPlayStartedAt(),
        asOf,
        deps.reportTimeZone,
      );
      // ⚠️ `window.start` is a LOCAL Monday, and this filter treats it as a UTC instant. That is
      // deliberate and it over-fetches rather than under-fetching: local midnight is 04:00-05:00Z,
      // so starting at 00:00Z picks up a few hours that belong to the previous local week, and
      // `weeklyBuckets` drops anything outside the window. Narrowing this to the exact local
      // instant would risk excluding real plays for no benefit.
      const plays = deps.repository.listPlayTimesForArtist(artistId, `${window.start}T00:00:00.000Z`);
      artist = {
        artistId,
        playsInWindow: plays.length,
        firstPlayedAt: plays[0]?.startedAt ?? null,
        window,
        weeks: weeklyBuckets(plays, window, deps.reportTimeZone),
      };
    }

    res.json({
      asOf,
      // ⚠️ Sent so the client never infers it. The browser's own zone is *probably* the same as
      // the server's on a single-user machine, and "probably the same" is how a one-day
      // disagreement between a date label and the chart beside it would survive unnoticed.
      timeZone: deps.reportTimeZone,
      track: trackId === null ? null : deps.repository.trackPlayStats(trackId),
      artist,
    });
  });

  /**
   * Re-read the saved-track set on demand.
   *
   * Exists because the set is otherwise refreshed at startup and on the 6-hourly backfill tick, so
   * a track liked a minute ago still reads as not liked — and a *stale* `false` is the one wrong
   * answer this indicator can give that matters. `GET /me/tracks/contains` is **403** in
   * Development Mode, so there is no single-track check to fall back on; re-reading the list is
   * the only way to be current.
   *
   * User-initiated only. Nothing polls this, because ~12 requests on a timer to keep a badge warm
   * would spend the rate limit that label resolution actually needs.
   */
  router.post('/api/liked/refresh', async (req, res) => {
    if (deps.likedSet === null) {
      res.status(503).json({ error: 'Saved-track status is unavailable.', detail: deps.labelStartupError });
      return;
    }

    try {
      await deps.likedSet.refresh();
    } catch (error) {
      // A refresh failure leaves the previous set in place by design, so the honest response is
      // the status we still hold rather than an error that would blank the badge.
      console.error('[liked] manual refresh failed:', error);
    }

    const trackId = typeof req.query.trackId === 'string' ? req.query.trackId : null;
    res.json({
      size: deps.likedSet.size,
      available: deps.likedSet.available,
      liked: trackId === null ? null : (deps.likedFor(trackId) ?? null),
    });
  });

  // -- U4: rule observability ------------------------------------------------
  //
  // ⚠️ All read-only except the reload, which re-READS. `./config` stays mounted `:ro`;
  // granting `:rw` a unit before an editor exists is what the musicbrainz.json comment warns
  // against.

  /** The rule set in force, its version, and per-rule status including disabled reasons. */
  router.get('/api/rules', (_req, res) => {
    if (deps.ruleSet === null) {
      res.status(503).json({ error: 'The rules engine is not running.' });
      return;
    }

    const set = deps.ruleSet();
    res.json({
      version: set.version,
      contentHash: set.contentHash,
      loadedAt: set.loadedAt,
      state: set.state,
      // ⚠️ Present whenever a reload was refused, and it names the version STILL IN FORCE.
      // A red light that only says "something failed" leaves exactly the ambiguity the
      // indicator exists to remove, and a silent last-known-good is indistinguishable from a
      // successful reload.
      rejection: set.rejection,
      rules: set.rules.map((loaded) => ({
        id: loaded.rule.id,
        name: loaded.rule.name,
        enabled: loaded.rule.enabled,
        action: loaded.rule.action,
        onUnknown: loaded.rule.onUnknown,
        dryRun: loaded.rule.dryRun ?? false,
        status: loaded.status,
      })),
    });
  });

  /** The decision log, filtered and paginated. One row per rule evaluated (BR-23.1). */
  router.get('/api/decisions', (req, res) => {
    if (deps.decisionLog === null) {
      res.status(503).json({ error: 'The decision log is unavailable.' });
      return;
    }

    const limit = Math.min(Number(req.query['limit'] ?? 100) || 100, 500);
    const filter: DecisionFilter = {
      limit,
      ...(typeof req.query['from'] === 'string' ? { from: req.query['from'] } : {}),
      ...(typeof req.query['to'] === 'string' ? { to: req.query['to'] } : {}),
      ...(typeof req.query['ruleId'] === 'string' ? { ruleId: req.query['ruleId'] } : {}),
      ...(typeof req.query['trackId'] === 'string' ? { trackId: req.query['trackId'] } : {}),
      ...(req.query['matchedOnly'] === 'true' ? { matchedOnly: true } : {}),
      ...(typeof req.query['cursor'] === 'string'
        ? { cursor: Number(req.query['cursor']) }
        : {}),
    };

    const rows = deps.decisionLog.list(filter);
    res.json({
      rows,
      // Grouped into one trace per decision, rendered from these same rows and nothing else.
      traces: groupIntoTraces(rows),
      nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
    });
  });

  /**
   * Back-test one rule over a range (FR-42).
   *
   * ⚠️ **Writes nothing** (BR-28.6) — not a decision row, not a play row, not a cached
   * report. POST only because a predicate does not fit a query string.
   */
  router.post('/api/backtest', (req, res) => {
    if (deps.backTest === null || deps.ruleSet === null) {
      res.status(503).json({ error: 'Back-testing is unavailable.' });
      return;
    }

    const body = req.body as { ruleId?: unknown; from?: unknown; to?: unknown } | undefined;
    const ruleId = typeof body?.ruleId === 'string' ? body.ruleId : null;
    const from = typeof body?.from === 'string' ? body.from : null;
    const to = typeof body?.to === 'string' ? body.to : null;

    if (ruleId === null || from === null || to === null) {
      res.status(400).json({ error: 'ruleId, from and to are required.' });
      return;
    }

    const loaded = deps.ruleSet().rules.find((r) => r.rule.id === ruleId);
    if (loaded === undefined) {
      res.status(404).json({ error: `No rule with id '${ruleId}' is loaded.` });
      return;
    }

    res.json(deps.backTest.run(loaded, { from, to }));
  });

  /**
   * Re-read the rules file now (P-19's manual trigger).
   *
   * ⚠️ **The same loader the poll uses.** Re-implementing it is the WebSocket `403` shape.
   */
  router.post('/api/rules/reload', async (_req, res) => {
    if (deps.reloadRules === null || deps.ruleSet === null) {
      res.status(503).json({ error: 'The rules engine is not running.' });
      return;
    }

    const outcome = await deps.reloadRules();
    const set = deps.ruleSet();
    // 200 even on a rejected reload: the REQUEST succeeded, and the rule set's state is the
    // answer rather than an HTTP error. The body says which version is still in force.
    res.json({
      outcome: outcome.kind,
      version: set.version,
      state: set.state,
      rejection: set.rejection,
    });
  });

  // -- U5: automated skipping ------------------------------------------------

  /**
   * The body all three automation routes return.
   *
   * ## ⚠️ One shape from one builder, because the UI must not learn two of them
   *
   * `GET`, `POST` and the acknowledgement all answer the same question — *what is true now?* — so they
   * return the same body. A `POST` that replied with a narrower shape would make the client either
   * re-GET (a race) or merge two shapes (a second copy of the rendering rules).
   *
   * ## ⚠️ The derived VIEW is computed here, in `src/`, and never in `public/app.js`
   *
   * `app.js` has no tests, is outside the orphan check, and cannot import from `src/` — there is no
   * bundler. So *"the judgement lives in a tested module"* means **the server derives it and ships it**,
   * exactly as the status-bar indicators already arrive pre-derived on the WebSocket snapshot.
   *
   * ⚠️ **The raw facts are returned ALONGSIDE the view, not instead of it.** `enabled`, `halt`,
   * `source` and `writable` are what a script or a probe wants; `view` and `haltPanel` are what a button
   * needs. Dropping the facts would make the route untestable except through its own prose.
   */
  function automationPayload(
    automation: AutomationControl,
    lastWriteError: string | null,
  ): Record<string, unknown> {
    const read = automation.read();
    const queued = deps.skipAttempts?.queued() ?? [];
    const nowMs = Date.parse(deps.now());
    const oldest = queued
      .map((a) => Date.parse(a.enqueuedAt))
      .filter((ms) => Number.isFinite(ms))
      .reduce<number | null>((min, ms) => (min === null || ms < min ? ms : min), null);

    const writable = automation.probeWritable();
    const facts = {
      enabled: read.state.globalAutomationEnabled,
      halt: read.state.runawayHalt,
      source: read.source,
      detail: read.detail ?? null,
      writable,
      executorEnabled: deps.skipExecutorEnabled,
      queue: {
        depth: queued.length,
        // ⚠️ `null` with an empty queue, never 0: "nothing waiting" and "something waiting for no time
        // at all" are different facts, and the standing rule is that `null` is unknown.
        oldestQueuedAgeMs: oldest === null ? null : Math.max(0, nowMs - oldest),
      },
      lastAttempt: deps.skipAttempts?.latest() ?? null,
    };

    return {
      ...facts,
      /**
       * ⚠️ **Its own field, NOT `detail`.** `detail` already means *why the state file could not be
       * read*; a failed write is a different fact, and reusing one key for both would make the UI
       * report a parse problem as a save problem (or hide one behind the other).
       */
      writeError: lastWriteError,
      view: switchView({
        enabled: facts.enabled,
        halt: read.state.runawayHalt,
        source: read.source,
        writable,
        executorEnabled: deps.skipExecutorEnabled,
        lastWriteError,
      }),
      haltPanel: haltPanel(read.state.runawayHalt),
    };
  }

  /**
   * Everything the automation indicator and the kill switch need, in one read.
   *
   * ## ⚠️ FACTS *and* a derived view — and both are computed in `src/`, never in `app.js`
   *
   * `public/app.js` has no tests, is outside the orphan check, and **cannot import from `src/`** — there
   * is no bundler. So *"the judgement lives in a tested module"* means the server derives it and ships
   * it, which is already how the status-bar indicators arrive on the WebSocket snapshot.
   *
   * ⚠️ So this route returns `view` (`switchView`) and `haltPanel` alongside the raw fields. **It still
   * does not name FC-U5-1's seven states**: that indicator is derived by `automationIndicator` and
   * travels on the snapshot, because it belongs to the status bar rather than to this panel.
   *
   * ⚠️ **`source` is part of the answer, not debug detail.** `absent` and `unreadable` both read as
   * *off*, and they are different facts: the first is a fresh install behaving correctly, the second is
   * a file this app could not parse — where the switch would appear to work in the UI and not persist.
   */
  router.get('/api/automation', (_req, res) => {
    if (deps.automation === null) {
      res.status(503).json({ error: 'Automation is unavailable.' });
      return;
    }

    // ⚠️ No write has been attempted on a GET, so `lastWriteError` is null. That is not the same as
    // *the file is writable* — `view.warning` reports both, from different fields.
    res.json(automationPayload(deps.automation, null));
  });

  /**
   * Arm or disarm automation (FR-47, FR-38).
   *
   * ## ⚠️ The response is READ BACK FROM DISK, never echoed from the request
   *
   * The button must reflect what persisted. An optimistic response would show *on* after a write that
   * failed — on an unwritable `/state`, the one case where the user most needs to know the switch did
   * not take. So every path below re-reads and returns `GET`'s own shape.
   *
   * ⚠️ **Arming is refused while a halt stands** (BR-35.6): a latch cleared as a side effect of
   * flipping a switch is not an acknowledgement. `409`, and the body names the route that can clear it.
   *
   * ⚠️ **Disarming is never refused for that reason.** Turning automation OFF must work in every
   * state the app can be in, including halted and including mid-drain.
   */
  router.post('/api/automation', (req, res) => {
    if (deps.automation === null) {
      res.status(503).json({ error: 'Automation is unavailable.' });
      return;
    }

    const body = req.body as { enabled?: unknown } | undefined;
    if (typeof body?.enabled !== 'boolean') {
      // ⚠️ A boolean and nothing else. `'false'`, `0` and `undefined` are all falsy and would arm or
      // disarm by accident; this is the surface that controls whether the app touches playback.
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    const enabled = body.enabled;

    const before = deps.automation.read();
    if (enabled && before.state.runawayHalt !== null) {
      res.status(409).json({
        error: 'Automation is halted and cannot be armed by this route.',
        detail:
          'A runaway halt clears only on explicit acknowledgement (BR-35.6). ' +
          'POST /api/automation/acknowledge-halt.',
        halt: before.state.runawayHalt,
      });
      return;
    }

    const outcome = deps.automation.write({ ...before.state, globalAutomationEnabled: enabled });

    // 200 only when the write landed. ⚠️ A 503 whose body still carries the state READ BACK FROM DISK:
    // the request failed and the UI must still render the truth, which is the PREVIOUS value.
    res.status(outcome.ok ? 200 : 503).json({
      ...automationPayload(deps.automation, outcome.ok ? null : outcome.reason),
      error: outcome.ok ? undefined : 'Could not persist the automation state.',
    });
  });

  /**
   * Acknowledge a runaway halt (BR-35.5, BR-35.8).
   *
   * ## ⚠️ IT ALWAYS LEAVES AUTOMATION OFF. There is no `reArm`, by design.
   *
   * Revised 2026-10-04. It used to take `reArm: boolean`, required and undefaulted, so that
   * *"I have reviewed this"* and *"turn automation back on"* stayed distinct decisions (BR-35.5).
   * **The distinction is right; putting it in this route was wrong.**
   *
   * ⚠️ Acknowledging now **unconditionally sets `globalAutomationEnabled: false`**, so resuming is a
   * **second, deliberate** act performed on `POST /api/automation` — the ordinary switch. That separates
   * the two acts more strictly than a parameter did: with `reArm`, a single click could clear a safety
   * latch *and* re-arm in one request, which is precisely what BR-35.5 exists to prevent.
   *
   * ⚠️ **And it collapses the UI's state space.** Three simultaneous controls — the kill switch plus two
   * halt buttons — made a linear recovery combinatorial, with orderings that had to be defined and added
   * nothing. One action here, one on the switch afterwards.
   *
   * ⚠️ **`reArm` in the body is now a 400, not an ignored field.** A stale client sending `reArm: true`
   * would otherwise believe it had resumed, and be wrong — the silent-success failure mode.
   *
   * ⚠️ **`409` when nothing is halted**, rather than an idempotent success, so this cannot become a
   * second route that touches the switch. The body carries the current state so the UI re-renders.
   */
  router.post('/api/automation/acknowledge-halt', (req, res) => {
    if (deps.automation === null) {
      res.status(503).json({ error: 'Automation is unavailable.' });
      return;
    }

    const body = req.body as { reArm?: unknown } | undefined;
    if (body !== undefined && 'reArm' in body) {
      // ⚠️ Refused rather than ignored: a client that sent `reArm: true` and got a 200 would believe it
      // had resumed automation. Silently doing less than asked is the worst of the three options.
      res.status(400).json({
        error: 'reArm is no longer accepted.',
        detail:
          'Acknowledging a halt always leaves automation OFF. Resume with ' +
          'POST /api/automation {"enabled":true}, which is a separate, deliberate act (BR-35.5).',
      });
      return;
    }

    const before = deps.automation.read();
    if (before.state.runawayHalt === null) {
      res.status(409).json({
        error: 'Nothing is halted.',
        enabled: before.state.globalAutomationEnabled,
        halt: null,
        source: before.source,
      });
      return;
    }

    // ⚠️ BOTH fields, every time. Clearing the latch without disarming would let automation resume the
    // instant the halt went away — which is the compound action BR-35.5 forbids, just implicit.
    const outcome = deps.automation.write({
      ...before.state,
      runawayHalt: null,
      globalAutomationEnabled: false,
    });
    const payload = automationPayload(deps.automation, outcome.ok ? null : outcome.reason);

    res.status(outcome.ok ? 200 : 503).json({
      ...payload,
      // ⚠️ Read back from disk, never set to `true` because the write was requested. A failed write
      // that still reported `acknowledged` would clear a safety latch in the UI only.
      acknowledged: payload['halt'] === null,
      error: outcome.ok ? undefined : 'Could not persist the acknowledgement.',
    });
  });

  /** The most recent plays, so the trace UI has something to offer without a search box. */
  router.get('/api/history/recent', (_req, res) => {
    if (deps.repository === null) {
      res.status(503).json({ error: 'History is unavailable.' });
      return;
    }
    // NEWEST first (2026-10-09 fix): `listPlays` streams oldest-first and returned the corpus's first 50 plays.
    const rows = deps.repository.recentPlays(50).map((play) => ({
      id: play.id,
      title: play.title,
      artistName: play.artistName,
      startedAt: play.startedAt,
    }));
    res.json({ plays: rows });
  });

  // ── U6: backup and restore (FR-57…FR-59, BR-44…BR-51) ─────────────────────────────────────────────

  const refuse = (res: ExpressResponse, r: Refused) => res.status(r.status).json({ error: r.reason, rule: r.rule ?? null });
  const maintenanceUnavailable = (res: ExpressResponse) =>
    res.status(503).json({ error: 'Backup and restore are unavailable: history is not running.' });

  /** Read-only: busy state, capability, last restore, previous database, sizes against caps. */
  router.get('/api/maintenance', (_req, res) => {
    if (!deps.maintenance) return void maintenanceUnavailable(res);
    const status = deps.maintenance.status();
    // ⭐ The DERIVED view rides along, because app.js cannot import from src/ (the U5 precedent).
    res.json({ ...status, view: statusView(status) });
  });

  /**
   * *Create backup* — streams one `.tar.gz` (BR-44.6). Behind `ingestGuard` too: it writes no file the user
   * supplies, but a cross-site page must not be able to make the app do maintenance work on its behalf.
   */
  router.post('/api/maintenance/backup', ingestGuard, async (_req, res) => {
    if (!deps.maintenance) return void maintenanceUnavailable(res);
    const r = await deps.maintenance.backup();
    if (!r.ok) return void refuse(res, r);
    res.on('close', r.cleanup);
    res.status(200);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Length', String(r.bytes));
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    r.stream.pipe(res);
  });

  /**
   * *Restore backup*, part 1 — the file IS the request body (P-41, `application/gzip`), streamed to a work dir
   * with the cap counted as bytes arrive. ⚠️ `express.json` above does not consume it: it parses only JSON
   * bodies. Responds with the comparison and a staging token; nothing outside `data/.work/` has changed.
   */
  router.post('/api/maintenance/restore', ingestGuard, async (req, res) => {
    if (!deps.maintenance) return void maintenanceUnavailable(res);
    const r = await deps.maintenance.receiveUpload(req);
    if (!r.ok) return void refuse(res, r);
    res.json({ token: r.token, comparison: r.comparison, view: comparisonView(r.comparison, CONFIRM_WORD, 'restore') });
  });

  /** *Undo last restore*, part 1 — stages `previous/` through the same verification (BR-49.2). */
  router.post('/api/maintenance/undo', ingestGuard, (_req, res) => {
    if (!deps.maintenance) return void maintenanceUnavailable(res);
    const r = deps.maintenance.prepareUndo();
    if (!r.ok) return void refuse(res, r);
    res.json({ token: r.token, comparison: r.comparison, view: comparisonView(r.comparison, CONFIRM_WORD, 'undo') });
  });

  /** Part 2 for both — the typed confirmation (BR-48.2), then stage and restart. */
  router.post('/api/maintenance/restore/confirm', ingestGuard, (req, res) => {
    if (!deps.maintenance) return void maintenanceUnavailable(res);
    const body = req.body as { token?: unknown; typed?: unknown; applyRules?: unknown } | undefined;
    if (typeof body?.token !== 'string' || typeof body.typed !== 'string') {
      res.status(400).json({ error: 'token and typed must be strings.' });
      return;
    }
    // U7 (BR-59.2): opt-in. Only a literal `true` opts in — anything else is the default, unticked.
    const r = deps.maintenance.confirm(body.token, body.typed, body.applyRules === true);
    if (!r.ok) return void refuse(res, r);
    // 202: accepted — the swap happens at the next startup, which the response cannot report on.
    res.status(202).json({ restarting: r.restarting });
  });

  router.post('/api/maintenance/restore/cancel', ingestGuard, (req, res) => {
    if (!deps.maintenance) return void maintenanceUnavailable(res);
    const body = req.body as { token?: unknown } | undefined;
    if (typeof body?.token === 'string') deps.maintenance.cancel(body.token);
    res.status(204).end();
  });

  // ─── U7: configuration management (FR-66…FR-70) ───────────────────────────────────────────────────────────

  const RULES_STATUS: Record<RulesRefusal['reason'], 400 | 409 | 413 | 422 | 503> = {
    invalid: 422,
    'too-large': 413,
    'stale-base': 409,
    'changed-since-staging': 409,
    'confirmation-required': 400,
    'staging-expired': 409,
    'nothing-to-undo': 409,
    'write-failed': 503,
    'reload-rejected': 422,
  };
  const CREDENTIALS_STATUS: Record<CredentialsRefusal['reason'], 400 | 413 | 500 | 503> = {
    invalid: 400,
    'too-large': 413,
    'mcp-did-not-stop': 503,
    'write-failed': 503,
    'read-back-mismatch': 500,
  };
  const rulesRefuse = (res: ExpressResponse, r: RulesRefusal) =>
    res.status(RULES_STATUS[r.reason]).json({ error: r.message, reason: r.reason, errors: r.errors });
  const credentialsRefuse = (res: ExpressResponse, r: CredentialsRefusal) =>
    // ⚠️ FIELD NAMES only (P-53) — the writer never puts a value in a refusal, and nothing is added here.
    res.status(CREDENTIALS_STATUS[r.reason]).json({ error: r.message, reason: r.reason, fields: r.fields });
  const rulesUnavailable = (res: ExpressResponse) => res.status(503).json({ error: 'Rules editing is unavailable.' });
  // U8: the version rides on this payload even when it is a 503, because Settings shows it either way.
  const appVersion = deps.appVersion ?? UNKNOWN_VERSION;
  const credentialsUnavailable = (res: ExpressResponse) =>
    res.status(503).json({ error: 'Credential settings are unavailable.', appVersion });

  /**
   * The rules upload body is the file's TEXT (`text/plain`), so the 64 KB JSON parser above never sees it; this
   * parser takes it up to the rules cap (BR-60.2). An oversized body becomes a JSON 413 (the handler at the end).
   */
  const rulesText = express.text({ type: 'text/plain', limit: RULES_UPLOAD_CAP_BYTES });

  /** BR-53.2 — the file as it is, with its hash, which the UI sends back as the upload's base. */
  router.get('/api/rules/file', (_req, res) => {
    if (!deps.rulesWriter) return void rulesUnavailable(res);
    const file = deps.rulesWriter.download();
    if (file === null) {
      res.status(404).json({ error: 'No rules file yet — upload one, or run `npm run rules:init`.' });
      return;
    }
    const stamp = deps.now().slice(0, 19).replace(/[-:]/g, '');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rules-${stamp}Z.json"`);
    res.setHeader('X-Rules-Hash', file.hash);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.content);
  });

  /** What the Rules pop-up needs for its *Rules file* section: the base hash, undo availability, the last write. */
  router.get('/api/rules/file/status', (_req, res) => {
    if (!deps.rulesWriter) return void rulesUnavailable(res);
    const status = { hash: deps.rulesWriter.download()?.hash ?? null, hasPrevious: deps.rulesWriter.hasPrevious(), lastWrite: deps.rulesWriter.lastWrite() };
    // ⭐ The DERIVED view rides along (app.js cannot import src/ — the U5/U6 precedent).
    res.json({ ...status, replaceWord: REPLACE_WORD, view: rulesFileStatusView(status) });
  });

  /** FR-66 part 1 — stage an upload: validate, compare, never write. Base hash in `X-Rules-Base-Hash` (optional). */
  router.post('/api/rules/upload', ingestGuard, rulesText, (req, res) => {
    if (!deps.rulesWriter) return void rulesUnavailable(res);
    if (typeof req.body !== 'string') {
      res.status(415).json({ error: 'Send the rules file as text/plain.' });
      return;
    }
    const base = req.get('x-rules-base-hash');
    const r = deps.rulesWriter.stageUpload(req.body, base === undefined || base === '' ? null : base);
    if (!r.ok) return void rulesRefuse(res, r);
    res.json({ ...r, view: { panel: comparisonPanelView(r.comparison), confirm: rulesConfirmView(r, REPLACE_WORD) } });
  });

  /** BR-55 part 1 — stage *Undo last rules change*. Confirmed through the same route as an upload. */
  router.post('/api/rules/undo', ingestGuard, (_req, res) => {
    if (!deps.rulesWriter) return void rulesUnavailable(res);
    const r = deps.rulesWriter.stageUndo();
    if (!r.ok) return void rulesRefuse(res, r);
    res.json({ ...r, view: { panel: comparisonPanelView(r.comparison), confirm: rulesConfirmView(r, REPLACE_WORD) } });
  });

  /** FR-66/67 part 2 — confirm a staged upload or undo. The answer is the WATCHER's version, never the write's. */
  router.post('/api/rules/confirm', ingestGuard, async (req, res) => {
    if (!deps.rulesWriter) return void rulesUnavailable(res);
    const body = req.body as { token?: unknown; typed?: unknown } | undefined;
    if (typeof body?.token !== 'string') {
      res.status(400).json({ error: 'token must be a string.' });
      return;
    }
    const r = await deps.rulesWriter.confirm(body.token, typeof body.typed === 'string' ? body.typed : null);
    if (!r.ok) return void rulesRefuse(res, r);
    res.json({ ...r, view: { message: appliedMessage(r.version, r.comparison) } });
  });

  /** FR-69/70 — what Settings shows. ⚠️ Views only: no field of either can hold a secret (P-53). */
  router.get('/api/settings/credentials', (_req, res) => {
    if (!deps.credentials) return void credentialsUnavailable(res);
    const spotify = deps.credentials.spotifyView();
    const musicbrainz = deps.credentials.musicbrainzView();
    const labelsActive = deps.labelsActive ?? false;
    res.json({
      appVersion,
      spotify,
      musicbrainz,
      labelsActive,
      lastWrite: deps.credentials.lastWrite(),
      view: { spotify: spotifySectionView(spotify), musicbrainz: musicbrainzSectionView(musicbrainz, labelsActive) },
    });
  });

  /** FR-69 — replace the Spotify credentials. Q5 = B: no check first; FR-71 shows a bad one red. */
  router.post('/api/settings/spotify', ingestGuard, async (req, res) => {
    if (!deps.credentials) return void credentialsUnavailable(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const r = await deps.credentials.saveSpotify(
      { clientId: body['clientId'], clientSecret: body['clientSecret'], redirectUri: body['redirectUri'], refreshToken: body['refreshToken'] },
      Number(req.get('content-length') ?? 0),
    );
    if ('ok' in r) return void credentialsRefuse(res, r);
    res.json(r);
  });

  /** FR-70 — the MusicBrainz contact. A contact saved while labels are OFF takes effect after a restart. */
  router.post('/api/settings/musicbrainz', ingestGuard, async (req, res) => {
    if (!deps.credentials) return void credentialsUnavailable(res);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const r = await deps.credentials.saveMusicBrainzContact(body['contact'], Number(req.get('content-length') ?? 0));
    if ('ok' in r) return void credentialsRefuse(res, r);
    res.json({ ...r, restartNeeded: !(deps.labelsActive ?? false) });
  });

  /** An oversized body on a U7 route is a JSON 413 the UI can show — not Express's HTML error page. */
  router.use((err: { type?: string }, req: express.Request, res: ExpressResponse, next: express.NextFunction) => {
    if (err?.type === 'entity.too.large' && (req.path.startsWith('/api/rules/') || req.path.startsWith('/api/settings/'))) {
      res.status(413).json({ error: 'That is too large. Nothing was changed.', reason: 'too-large' });
      return;
    }
    next(err);
  });

  return router;
}
