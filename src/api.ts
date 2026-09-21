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

import express, { type Router } from 'express';
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
import { MAJOR_ROOTS } from './musicbrainz/majorRootList.js';
import { isrcPrefixVote } from './musicbrainz/isrcPrefix.js';
import { LABEL_CLASSIFIER_VERSION } from './musicbrainz/LabelEnrichmentService.js';
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
      const window = trendWindow(deps.repository.firstPlayStartedAt(), asOf);
      const plays = deps.repository.listPlayTimesForArtist(artistId, `${window.start}T00:00:00.000Z`);
      artist = {
        artistId,
        playsInWindow: plays.length,
        firstPlayedAt: plays[0]?.startedAt ?? null,
        window,
        weeks: weeklyBuckets(plays, window),
      };
    }

    res.json({
      asOf,
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

  /** The most recent plays, so the trace UI has something to offer without a search box. */
  router.get('/api/history/recent', (_req, res) => {
    if (deps.repository === null) {
      res.status(503).json({ error: 'History is unavailable.' });
      return;
    }
    const rows = [...deps.repository.listPlays({ limit: 50 })].map((play) => ({
      id: play.id,
      title: play.title,
      artistName: play.artistName,
      startedAt: play.startedAt,
    }));
    res.json({ plays: rows });
  });

  return router;
}
