import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { SpotifyMcpClient } from './mcp/spotifyMcpClient.js';
import { SpotifyWebApiClient } from './spotify/webApiClient.js';
import { EnrichmentService } from './spotify/enrichment.js';
import { NowPlayingService, type Snapshot } from './nowPlayingService.js';
import { runDiagnostics } from './diagnostics.js';
import { localGuard, isLoopbackAddress, isAllowedOrigin, isLoopbackHostHeader } from './localGuard.js';
import { SqliteHistoryRepository } from './history/SqliteHistoryRepository.js';
import { PlayObserver, type PlaybackSample } from './history/PlayObserver.js';
import { RecentlyPlayedBackfill } from './history/RecentlyPlayedBackfill.js';
import {
  ExportService,
  ExportValidationError,
  parseFormat,
  suggestedFilename,
  validateFilter,
} from './export/ExportService.js';
import { SnapshotScheduler } from './export/SnapshotScheduler.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const spotify = new SpotifyMcpClient();
const webApi = new SpotifyWebApiClient();
const enrichment = new EnrichmentService(webApi);
const nowPlaying = new NowPlayingService(spotify, enrichment);

// -- U1: listening history ---------------------------------------------------
//
// Everything below is optional to the app's core function. If the database cannot be opened or
// migrated, `repository` stays null and the app runs display-only (NFR-13). U0 worked before
// history existed and must keep working when history is broken.

let repository: SqliteHistoryRepository | null = null;
let observer: PlayObserver | null = null;
let exportService: ExportService | null = null;
let snapshots: SnapshotScheduler | null = null;
let historyStartupError: string | null = null;

if (config.historyEnabled) {
  try {
    repository = new SqliteHistoryRepository(config.historyDbPath);
    // Probe rather than assume: bind-mount permission problems otherwise surface at the first
    // play boundary, minutes after startup, behind a healthy-looking UI.
    repository.verifyWritable();

    observer = new PlayObserver(repository, {
      completionThreshold: config.completionThreshold,
      jitterToleranceMs: config.jitterToleranceMs,
    });
    exportService = new ExportService(repository);

    if (config.snapshotsEnabled) {
      snapshots = new SnapshotScheduler(
        exportService,
        config.snapshotDir,
        config.snapshotIntervalHours,
        config.snapshotKeep,
      );
    }
  } catch (error) {
    historyStartupError = error instanceof Error ? error.message : String(error);
    console.error('[history] unavailable; running display-only:', historyStartupError);
    repository = null;
    observer = null;
    exportService = null;
  }
}

/**
 * Project a snapshot onto the fields the observer needs.
 *
 * Returns null when nothing is playing, which the observer treats as a play boundary.
 */
function toPlaybackSample(snapshot: Snapshot): PlaybackSample | null {
  if ('error' in snapshot || !snapshot.playing) return null;
  if (!snapshot.trackId || snapshot.progressMs === null || snapshot.durationMs === null) return null;

  const enrichmentData = snapshot.enrichment;
  return {
    trackId: snapshot.trackId,
    title: snapshot.track ?? '',
    artistName: snapshot.artist ?? '',
    albumName: snapshot.album ?? '',
    progressMs: snapshot.progressMs,
    durationMs: snapshot.durationMs,
    isPlaying: snapshot.isPlaying,
    isrc: enrichmentData?.isrc ?? null,
    artistId: enrichmentData?.primaryArtistId ?? null,
    releaseDate: enrichmentData?.releaseDate ?? null,
    ageYears: enrichmentData?.ageYears ?? null,
    following: enrichmentData?.following ?? null,
    contextType: null,
  };
}

const app = express();
app.disable('x-powered-by');
app.use(localGuard);

/** REST snapshot. The UI uses the WebSocket; this stays for scripting and debugging. */
app.get('/api/now-playing', (_req, res) => {
  const snapshot = nowPlaying.current;
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
app.get('/api/diagnostics', async (_req, res) => {
  const report = await runDiagnostics(spotify, webApi, enrichment, {
    repository,
    observerStats: observer?.stats ?? null,
    snapshotStatus: snapshots?.status ?? null,
    startupError: historyStartupError,
    dbPath: config.historyDbPath,
  });
  res.status(report.ok ? 200 : 503).json(report);
});

/** Liveness plus a real MCP round-trip, which is what actually tends to break. */
app.get('/api/health', async (_req, res) => {
  try {
    const tools = await spotify.listToolNames();
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
app.get('/api/history/export', async (req, res) => {
  if (!exportService) {
    res.status(503).json({ error: 'History is unavailable.', detail: historyStartupError });
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

  const filename = suggestedFilename(format, new Date().toISOString());
  res.setHeader('Content-Type', exportService.contentType(format));
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  try {
    await exportService.writeTo(res, { format, filter });
    res.end();
  } catch (error) {
    // Headers are already sent, so there is no status code to change. Terminate and log.
    console.error('[export] stream failed:', error);
    res.destroy();
  }
});

/** Coverage counts without downloading anything — cheap enough for the UI to poll. */
app.get('/api/history/coverage', (_req, res) => {
  if (!repository) {
    res.status(503).json({ error: 'History is unavailable.', detail: historyStartupError });
    return;
  }
  res.json({ ...repository.coverage(), ...observer?.stats });
});

app.use(express.static(publicDir));

const server = createServer(app);

// -- WebSocket push (Q5) ----------------------------------------------------
// noServer + manual upgrade handling, so the same local-only rules apply to the
// WebSocket handshake as to HTTP. `ws` does not run Express middleware.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // The upgrade socket is typed as Duplex, but for an HTTP server it is always a net.Socket.
  const remoteAddress = (socket as import('node:net').Socket).remoteAddress;

  const allowed =
    !config.localOnly ||
    (isLoopbackAddress(remoteAddress) &&
      isLoopbackHostHeader(request.headers.host) &&
      isAllowedOrigin(request.headers.origin));

  if (!allowed || request.url !== '/ws') {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

function broadcast(snapshot: Snapshot): void {
  const payload = JSON.stringify(snapshot);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

wss.on('connection', (ws) => {
  // Send current state immediately so a new tab isn't blank until the next poll.
  ws.send(JSON.stringify(nowPlaying.current));
});

nowPlaying.on('tick', broadcast);

/**
 * History capture consumes `tick`, never `change`.
 *
 * `change` is signature-suppressed and the signature deliberately excludes progress. Feeding the
 * observer from it would produce a trail containing only the samples where something *else*
 * changed — losing exactly the progress data the classifier depends on. It would still produce
 * verdicts; they would simply be wrong, and invisibly so.
 */
if (observer) {
  nowPlaying.on('tick', (snapshot: Snapshot) => {
    try {
      observer!.observe(toPlaybackSample(snapshot), Date.now());
    } catch (error) {
      // Recording must never interfere with the display.
      console.error('[history] observe failed:', error);
    }
  });
}

// ---------------------------------------------------------------------------

server.listen(config.port, config.host, () => {
  console.log(`spotify-now-playing listening on http://${config.host}:${config.port}`);
  console.log(`MCP server entrypoint: ${config.mcpServerEntrypoint}`);
  console.log(`Local-only enforcement: ${config.localOnly ? 'on' : 'OFF'}`);

  if (repository) {
    console.log(`History: ${config.historyDbPath} (schema v${repository.schemaVersion})`);
    for (const applied of repository.migrationReport.applied) console.log(`  migrated ${applied}`);
  } else {
    console.log(`History: DISABLED${historyStartupError ? ` — ${historyStartupError}` : ''}`);
  }

  nowPlaying.start();
  snapshots?.start();

  // Backfill after the server is listening, so a slow or failing Spotify call never delays the
  // UI becoming available (BR-5.6).
  if (repository) {
    void new RecentlyPlayedBackfill(webApi, repository)
      .run()
      .then((report) => {
        if (report.error) console.warn('[backfill] incomplete:', report.error);
        else console.log(`[backfill] ${report.inserted} inserted, ${report.duplicates} already known`);
      })
      .catch((error) => console.warn('[backfill] failed:', error));
  }
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down.`);
    nowPlaying.stop();
    snapshots?.stop();

    // Flush the in-progress play as `unknown` rather than discarding it (BR-2.6). Discarding
    // would lose a real listening event; asserting completed or skipped would claim something
    // unobserved. `unknown` records what actually happened: a play occurred, and its ending was
    // not seen.
    try {
      observer?.flush();
      repository?.close();
    } catch (error) {
      console.error('[history] shutdown flush failed:', error);
    }

    for (const client of wss.clients) client.close();
    server.close(() => void spotify.close().then(() => process.exit(0)));
  });
}
