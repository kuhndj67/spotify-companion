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

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const spotify = new SpotifyMcpClient();
const webApi = new SpotifyWebApiClient();
const enrichment = new EnrichmentService(webApi);
const nowPlaying = new NowPlayingService(spotify, enrichment);

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
  const report = await runDiagnostics(spotify, webApi, enrichment);
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

// ---------------------------------------------------------------------------

server.listen(config.port, config.host, () => {
  console.log(`spotify-now-playing listening on http://${config.host}:${config.port}`);
  console.log(`MCP server entrypoint: ${config.mcpServerEntrypoint}`);
  console.log(`Local-only enforcement: ${config.localOnly ? 'on' : 'OFF'}`);
  nowPlaying.start();
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down.`);
    nowPlaying.stop();
    for (const client of wss.clients) client.close();
    server.close(() => void spotify.close().then(() => process.exit(0)));
  });
}
