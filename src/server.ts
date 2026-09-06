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
import { localGuard, decideAccess } from './localGuard.js';
import { SqliteHistoryRepository } from './history/SqliteHistoryRepository.js';
import { PlayObserver, type PlaybackSample } from './history/PlayObserver.js';
import { RecentlyPlayedBackfill } from './history/RecentlyPlayedBackfill.js';
import {
  trendWindow,
  weeklyBuckets,
  type TrendWindow,
  type WeekBucket,
} from './history/playStats.js';
import {
  ExportService,
  ExportValidationError,
  parseFormat,
  suggestedFilename,
  validateFilter,
} from './export/ExportService.js';
import { SnapshotScheduler } from './export/SnapshotScheduler.js';
import { RequestQueue } from './musicbrainz/RequestQueue.js';
import { MusicBrainzClient } from './musicbrainz/MusicBrainzClient.js';
import { LabelCache } from './musicbrainz/LabelCache.js';
import {
  LABEL_CLASSIFIER_VERSION,
  LabelEnrichmentService,
} from './musicbrainz/LabelEnrichmentService.js';
import { LabelBackfillJob } from './musicbrainz/LabelBackfillJob.js';
import { LikedSetCache } from './spotify/LikedSetCache.js';
import { buildTrace, summariseTrace } from './musicbrainz/resolutionTrace.js';
import { MAJOR_ROOTS } from './musicbrainz/majorRootList.js';
import { isrcPrefixVote } from './musicbrainz/isrcPrefix.js';
import { loadMusicBrainzIdentity, userAgentFrom } from './config.js';
import { readFileSync } from 'node:fs';
import type { NewPlayRecord } from './history/types.js';

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

    observer = new PlayObserver(
      repository,
      {
        completionThreshold: config.completionThreshold,
        jitterToleranceMs: config.jitterToleranceMs,
      },
      {
        // BR-9.1 — sampled at play start because it cannot be recovered afterwards.
        onPlayStarted: (sample) => {
          // BR-9.1 — liked state is point-in-time and needs only the track id, which is present
          // on the very first sample. Unlike the label below, it cannot wait.
          likedAtStartByTrack.set(sample.trackId, likedSet?.isLiked(sample.trackId) ?? null);
        },
        // Enrichment happens AFTER the row is written, never before and never on the display
        // path (NFR-16, BR-7.5): MusicBrainz latency was measured at 0.1-6.7s and can be
        // minutes behind a backfill sweep.
        onPlayRecorded: (playId, record) => {
          void enrichRecordedPlay(playId, record);
        },
      },
    );
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

// -- U2: label enrichment ----------------------------------------------------
//
// Optional in exactly the way U1 is optional to U0. With MusicBrainz unreachable, or the contact
// address missing, the display and recording are unaffected and only the label column is absent.
// The whole subsystem therefore fails to a null rather than taking the process down.

let labelQueue: RequestQueue | null = null;
let labelEnrichment: LabelEnrichmentService | null = null;
let labelBackfill: LabelBackfillJob | null = null;
let likedSet: LikedSetCache | null = null;
let labelUserAgent: string | null = null;
let labelStartupError: string | null = null;
let backfillTimer: NodeJS.Timeout | null = null;

if (config.labelsEnabled && repository !== null) {
  try {
    // Fails closed: no anonymous User-Agent fallback. NFR-14 compliance is a choice this
    // project made, and unidentified traffic sent while believing we are compliant is worse
    // than refusing to start.
    const identity = loadMusicBrainzIdentity((path) => readFileSync(path, 'utf8'));
    labelUserAgent = userAgentFrom(identity);

    labelQueue = new RequestQueue();
    const client = new MusicBrainzClient({
      queue: labelQueue,
      userAgent: labelUserAgent,
      baseUrl: config.musicbrainzBaseUrl,
    });
    const cache = new LabelCache({
      repository,
      unknownTtlDays: config.labelTtlUnknownDays,
      resolvedTtlDays: config.labelTtlResolvedDays,
    });
    labelEnrichment = new LabelEnrichmentService({ client, cache });
    labelBackfill = new LabelBackfillJob({
      repository,
      cache,
      enrichment: labelEnrichment,
      api: webApi,
      batchSize: config.labelBackfillBatch,
    });

    likedSet = new LikedSetCache({
      api: webApi,
      ttlMs: config.likedRefreshMinutes * 60_000,
      graceMs: config.likedGraceMs,
    });
  } catch (error) {
    labelStartupError = error instanceof Error ? error.message : String(error);
    console.error('[labels] unavailable; running without label enrichment:', labelStartupError);
    labelQueue = null;
    labelEnrichment = null;
    labelBackfill = null;
    likedSet = null;
    labelUserAgent = null;
  }
}

/**
 * `likedAtStart`, captured when each play opened.
 *
 * Keyed by track rather than play id because the play id does not exist until the row is
 * written — and the value has to be sampled before then (BR-9.1).
 */
const likedAtStartByTrack = new Map<string, boolean | null>();

/**
 * Label verdicts for display, keyed by track.
 *
 * Bounded: a listening session touches a few hundred distinct tracks at most, and the map is
 * pruned to the most recent entries rather than growing for the lifetime of the process.
 */
const labelByTrack = new Map<string, DisplayLabel>();
const labelInFlight = new Set<string>();
const MAX_DISPLAY_LABELS = 500;

interface DisplayLabel {
  /** `pending` when only the artist level resolved — never `unknown`, which is an answer. */
  verdict: string;
  confidence: string | null;
  contested: boolean;
  names: string[];
  artistVerdict: string | null;
  artistNames: string[];
  /**
   * Artist genres from MusicBrainz. Spotify's `GET /artists/{id}` returns no genres field at all
   * — one of this project's documentation-vs-reality catches — so this is the only source.
   */
  genres: { name: string; count: number }[] | null;
}

/**
 * Decide whether to resolve a label for the track on screen.
 *
 * ⚠️ **Driven by the tick, not by the play-start hook, and the reason is subtle.**
 *
 * `snapshot.enrichment` is `null` on the first tick of a new track — U1's `PlayObserver` says so
 * in as many words: *"enrichment usually lands a moment after the track starts, so the first
 * sample of a play often has null isrc/following that later samples carry."* Resolving from that
 * first sample means resolving with **no ISRC and no artist id**, which yields a permanent
 * `noIsrc` answer that is then cached for the whole track and never revisited.
 *
 * That was a real defect: the Label row read `unknown` and the Artist label row read `—` for
 * every track, for the entire play. Same family as the three Build-and-Test defects — a premature
 * answer becoming sticky.
 *
 * So: wait until enrichment has actually landed, and until there is at least one usable key.
 */
function maybeResolveLabelForDisplay(snapshot: Snapshot): void {
  if (labelEnrichment === null) return;
  if ('error' in snapshot || !snapshot.playing || !snapshot.trackId) return;

  const trackId = snapshot.trackId;
  if (labelByTrack.has(trackId) || labelInFlight.has(trackId)) return;

  const enrichmentData = snapshot.enrichment;
  if (enrichmentData === null) return;

  // Nothing to look anything up with. Not cached, so a later tick can still try.
  if (enrichmentData.isrc === null && enrichmentData.primaryArtistId === null) return;

  labelInFlight.add(trackId);
  void resolveLabelForDisplay({
    trackId,
    isrc: enrichmentData.isrc ?? null,
    artistName: snapshot.artist ?? '',
    artistId: enrichmentData.primaryArtistId ?? null,
    albumName: snapshot.album ?? '',
    releaseDate: enrichmentData.releaseDate ?? null,
    title: snapshot.track ?? '',
  }).finally(() => labelInFlight.delete(trackId));
}

/**
 * Resolve a label for the panel, off the display path.
 *
 * ⚠️ **Nothing here is ever awaited by a render** (NFR-16, BR-7.5). MusicBrainz latency was
 * measured at 0.1–6.7 s and can be minutes behind a backfill sweep; the panel shows `pending`
 * until this lands and then picks it up on the next tick.
 */
async function resolveLabelForDisplay(sample: {
  trackId: string;
  isrc: string | null;
  artistName: string;
  artistId: string | null;
  albumName: string;
  releaseDate: string | null;
  title: string;
}): Promise<void> {
  if (labelEnrichment === null) return;

  try {
    const resolution = await labelEnrichment.resolveRelease(
      {
        isrc: sample.isrc,
        artistName: sample.artistName,
        artistId: sample.artistId,
        albumName: sample.albumName,
        releaseDate: sample.releaseDate,
        title: sample.title,
      },
      'high',
    );
    // A null snapshot means the release lookup failed transiently. That must not suppress the
    // ARTIST level too -- the two resolve independently, through different endpoints, and the
    // same conflation cost 21 real plays their artist verdict during Build and Test.
    const snapshot = labelEnrichment.toSnapshot(resolution, sample.isrc);

    let artistVerdict: string | null = null;
    let artistNames: string[] = [];
    let genres: { name: string; count: number }[] | null = null;
    if (sample.artistId !== null) {
      const artist = await labelEnrichment.resolveArtist(sample.artistId, 'high');
      const artistSnapshot = labelEnrichment.toArtistSnapshot(artist);
      if (artistSnapshot !== null) {
        artistVerdict = artistSnapshot.verdict;
        artistNames = artistSnapshot.labelNames;
        genres = artistSnapshot.genres;
      }
    }

    // Nothing at all resolved -- leave it uncached so a later tick tries again, rather than
    // pinning `pending` on the panel for the rest of the track.
    if (snapshot === null && artistVerdict === null) return;

    labelByTrack.set(sample.trackId, {
      verdict: snapshot?.verdict ?? 'pending',
      confidence: snapshot?.confidence ?? null,
      contested: snapshot?.contested ?? false,
      names: snapshot?.labelNames ?? [],
      artistVerdict,
      artistNames,
      genres,
    });

    while (labelByTrack.size > MAX_DISPLAY_LABELS) {
      const oldest = labelByTrack.keys().next().value;
      if (oldest === undefined) break;
      labelByTrack.delete(oldest);
    }
  } catch (error) {
    // A label is enrichment. Failing to get one must never affect the display (NFR-18).
    console.error('[labels] display resolution failed:', error);
  }
}

/**
 * Enrich a play that has just been recorded.
 *
 * Runs **after** the row exists and is never awaited by anything on the display path. A failure
 * here costs the label column on one row and nothing else (NFR-18).
 */
async function enrichRecordedPlay(playId: number, record: NewPlayRecord): Promise<void> {
  const likedAtStart = likedAtStartByTrack.get(record.trackId) ?? null;
  likedAtStartByTrack.delete(record.trackId);

  // -- Liked status ----------------------------------------------------------
  if (likedSet !== null && repository !== null) {
    try {
      const { likedAtEnd, likedAddedAt } = await likedSet.captureAtClose(
        playId,
        record.trackId,
        record.startedAt,
        likedAtStart,
      );
      repository.updateLikedEvidence(playId, { likedAtStart, likedAtEnd, likedAddedAt });
    } catch (error) {
      console.error('[labels] liked capture failed:', error);
    }
  }

  // -- Label resolution ------------------------------------------------------
  if (labelEnrichment === null || repository === null) return;

  try {
    // HIGH priority: this is the track the user just heard, and it jumps ahead of any backfill
    // sweep. Priority affects ordering only -- it still waits its turn in the 1 req/sec cadence.
    const resolution = await labelEnrichment.resolveRelease(
      {
        isrc: record.isrc,
        artistName: record.artistName,
        artistId: record.artistId,
        albumName: record.albumName,
        releaseDate: record.releaseDate,
        title: record.title,
      },
      'high',
    );
    // A null snapshot means the lookup failed transiently. Writing nothing leaves the play
    // `pending`, so it stays in the backfill work set and is retried; writing `unknown / error`
    // would be permanent under BR-8.4a and one network blip would poison the row for good.
    const snapshot = labelEnrichment.toSnapshot(resolution, record.isrc);
    if (snapshot !== null) repository.applyLabelSnapshot(playId, snapshot);


    if (record.artistId !== null) {
      const artist = await labelEnrichment.resolveArtist(record.artistId, 'high');
      const artistSnapshot = labelEnrichment.toArtistSnapshot(artist);
      if (artistSnapshot !== null) repository.applyArtistLabelSnapshot(playId, artistSnapshot);
    }
  } catch (error) {
    console.error('[labels] enrichment failed for play', playId, error);
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
  const report = await runDiagnostics(
    spotify,
    webApi,
    enrichment,
    {
      repository,
      observerStats: observer?.stats ?? null,
      snapshotStatus: snapshots?.status ?? null,
      startupError: historyStartupError,
      dbPath: config.historyDbPath,
    },
    {
      // `asOf` is required rather than decorative: under BR-13 the same coverage query run
      // twice can legitimately differ, so a figure without a timestamp is not interpretable.
      coverage: repository ? repository.labelCoverage(new Date().toISOString()) : null,
      queueDepth: labelQueue?.depth ?? 0,
      queuePaused: labelQueue?.paused ?? false,
      likedSetSize: likedSet?.size ?? 0,
      likedSetAvailable: likedSet?.available ?? false,
      backfillRunning: labelBackfill?.running ?? false,
      startupError: labelStartupError,
      userAgent: labelUserAgent,
    },
  );
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
app.get('/api/explain/:playId', (req, res) => {
  if (repository === null) {
    res.status(503).json({ error: 'History is unavailable.' });
    return;
  }

  const playId = Number.parseInt(req.params.playId ?? '', 10);
  if (Number.isNaN(playId)) {
    res.status(400).json({ error: 'playId must be an integer.' });
    return;
  }

  const play = repository.getPlay(playId);
  if (play === null) {
    res.status(404).json({ error: `No play with id ${playId}.` });
    return;
  }

  const raw = repository.getPlayLabelPointers(playId);

  const releaseResolution =
    raw.labelResolutionId === null
      ? null
      : repository.getLabelResolutionById(raw.labelResolutionId);
  const artistResolution =
    raw.artistLabelResolutionId === null
      ? null
      : repository.getArtistLabelResolutionById(raw.artistLabelResolutionId);

  const release = buildTrace({
    playId,
    resolution: releaseResolution,
    scope: 'release',
    storedClassifierVersion: raw.labelClassifierVersion,
    runningClassifierVersion: LABEL_CLASSIFIER_VERSION,
    majorRoots: MAJOR_ROOTS,
    isrcVote: isrcPrefixVote(play.isrc),
    unknownReason: raw.labelUnknownReason,
  });

  const artist = buildTrace({
    playId,
    resolution: artistResolution,
    scope: 'artist',
    storedClassifierVersion: raw.labelClassifierVersion,
    runningClassifierVersion: LABEL_CLASSIFIER_VERSION,
    majorRoots: MAJOR_ROOTS,
    isrcVote: null,
    capConfidenceAt: 'medium',
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
    // Two levels, reported side by side and never merged (Q12). Token - Full Bag is
    // `Never Too Different` at release level and `Atlantic` at artist level; both are true.
    release: { ...release, summary: summariseTrace(release) },
    artist: { ...artist, summary: summariseTrace(artist) },
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
app.get('/api/history/stats', (req, res) => {
  if (repository === null) {
    res.status(503).json({ error: 'History is unavailable.', detail: historyStartupError });
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
  const asOf = new Date().toISOString();

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
    const window = trendWindow(repository.firstPlayStartedAt(), asOf);
    const plays = repository.listPlayTimesForArtist(artistId, `${window.start}T00:00:00.000Z`);
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
    track: trackId === null ? null : repository.trackPlayStats(trackId),
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
app.post('/api/liked/refresh', async (req, res) => {
  if (likedSet === null) {
    res.status(503).json({ error: 'Saved-track status is unavailable.', detail: labelStartupError });
    return;
  }

  try {
    await likedSet.refresh();
  } catch (error) {
    // A refresh failure leaves the previous set in place by design, so the honest response is
    // the status we still hold rather than an error that would blank the badge.
    console.error('[liked] manual refresh failed:', error);
  }

  const trackId = typeof req.query.trackId === 'string' ? req.query.trackId : null;
  res.json({
    size: likedSet.size,
    available: likedSet.available,
    liked: trackId === null ? null : (likedFor(trackId) ?? null),
  });
});

/** The most recent plays, so the trace UI has something to offer without a search box. */
app.get('/api/history/recent', (_req, res) => {
  if (repository === null) {
    res.status(503).json({ error: 'History is unavailable.' });
    return;
  }
  const rows = [...repository.listPlays({ limit: 50 })].map((play) => ({
    id: play.id,
    title: play.title,
    artistName: play.artistName,
    startedAt: play.startedAt,
  }));
  res.json({ plays: rows });
});

app.use(express.static(publicDir));

const server = createServer(app);

// -- WebSocket push (Q5) ----------------------------------------------------
// noServer + manual upgrade handling, so the same local-only rules apply to the
// WebSocket handshake as to HTTP. `ws` does not run Express middleware, so the policy has to be
// invoked explicitly here — but via `decideAccess`, the SAME function `localGuard` uses.
//
// ⚠️ This used to inline its own copy of the rule, and the copies diverged. Option B
// (`trustPublishedPort`) was added to the HTTP path only, so in the container every page load
// succeeded and every WebSocket handshake got a 403 — the UI loaded and then sat on
// "Disconnected — reconnecting…" forever. Do not re-inline the conditions here.
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const decision = decideAccess(
    {
      // The upgrade socket is typed as Duplex, but for an HTTP server it is always a net.Socket.
      remoteAddress: (socket as import('node:net').Socket).remoteAddress,
      host: request.headers.host,
      origin: request.headers.origin,
    },
    { localOnly: config.localOnly, trustPublishedPort: config.trustPublishedPort },
  );

  if (!decision.ok || request.url !== '/ws') {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

/**
 * Attach the label to a snapshot, if one has resolved for this track.
 *
 * Carried on the existing snapshot rather than as a new message type, so a client that has not
 * been updated simply ignores an extra field instead of trying to render an unknown message.
 *
 * ⚠️ **Absent means `pending`, and the client renders it that way** — never as `unknown`
 * (BR-7.7). At 1 req/sec behind a backfill sweep, `pending` is a common state rather than a
 * transient one, and collapsing it into `unknown` would corrupt what the coverage panel reports.
 */
/**
 * Saved-track status as the display needs it.
 *
 * ⚠️ **`isLiked === null` means unknown and is never `false`.** The set can be unavailable
 * (Spotify unreachable at startup), and rendering that as "No" would show an observed choice
 * that was never observed — the same rule the recorded `likedAtStart` column follows.
 *
 * `asOf` is not decoration. The set is refreshed at startup and then on the label-backfill
 * interval, so a `false` here can be hours old — and the case that matters is someone who has
 * just liked the track and wants to see it register. There is no cheaper way to be current:
 * `GET /me/tracks/contains` returns **403** in Development Mode, which is why this is a cached
 * set rather than a membership check in the first place.
 */
interface DisplayLiked {
  isLiked: boolean | null;
  addedAt: string | null;
  asOf: string | null;
}

function likedFor(trackId: string): DisplayLiked | undefined {
  if (likedSet === null) return undefined;
  const isLiked = likedSet.isLiked(trackId);
  return {
    isLiked,
    addedAt: isLiked === true ? likedSet.addedAt(trackId) : null,
    asOf: likedSet.loadedAt === null ? null : new Date(likedSet.loadedAt).toISOString(),
  };
}

/** Attach everything the panel shows but the poll loop does not carry: label verdict, liked. */
function decorate(
  snapshot: Snapshot,
): Snapshot & { label?: DisplayLabel; liked?: DisplayLiked } {
  const trackId = (snapshot as { trackId?: string | null }).trackId ?? null;
  if (trackId === null) return snapshot;

  const label = labelByTrack.get(trackId);
  const liked = likedFor(trackId);
  if (label === undefined && liked === undefined) return snapshot;

  return {
    ...snapshot,
    ...(label === undefined ? {} : { label }),
    ...(liked === undefined ? {} : { liked }),
  };
}

function broadcast(snapshot: Snapshot): void {
  const payload = JSON.stringify(decorate(snapshot));
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

wss.on('connection', (ws) => {
  // Send current state immediately so a new tab isn't blank until the next poll.
  ws.send(JSON.stringify(decorate(nowPlaying.current)));
});

nowPlaying.on('tick', broadcast);

// Label resolution for the panel. On the tick rather than on play start, because enrichment --
// and therefore the ISRC -- lands a moment after a track begins. Guarded so it runs once per
// track; failures are not cached, so a later tick can retry.
nowPlaying.on('tick', (snapshot: Snapshot) => {
  try {
    maybeResolveLabelForDisplay(snapshot);
  } catch (error) {
    console.error('[labels] display trigger failed:', error);
  }
});

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

  // -- U2 background work ----------------------------------------------------
  //
  // All of it is fire-and-forget and none of it gates the listener: the app is already serving
  // by the time any of this runs.
  if (likedSet !== null) {
    void likedSet
      .refresh()
      .then(() => console.log(`Liked tracks: ${likedSet!.size} cached`))
      .catch((error: unknown) => console.error('[labels] saved-track refresh failed:', error));
  }

  if (labelBackfill !== null) {
    // A startup sweep makes catch-up prompt rather than waiting for the first interval (Q3 = C).
    // The work set is a query over the database, so a restart loses nothing (P-5).
    void labelBackfill
      .runOnce()
      .then((report) => {
        if (report.labelsResolved > 0 || report.refreshed > 0 || report.genresFilled > 0 || report.errors > 0) {
          console.log(
            `[labels] startup sweep: ${report.labelsResolved} resolved, ` +
              `${report.refreshed} refreshed, ${report.genresFilled} genres, ` +
              `${report.errors} error(s)`,
          );
        }
      })
      .catch((error: unknown) => console.error('[labels] startup sweep failed:', error));

    backfillTimer = setInterval(
      () => {
        void likedSet?.ensureFresh();
        void labelBackfill!.runOnce().catch((error: unknown) => {
          console.error('[labels] scheduled sweep failed:', error);
        });
      },
      config.labelBackfillIntervalHours * 3_600_000,
    );
    // Never hold the process open for a background sweep.
    backfillTimer.unref?.();
  }

  console.log(
    `Labels: ${labelUserAgent === null ? `DISABLED${labelStartupError ? ` — ${labelStartupError}` : ''}` : labelUserAgent}`,
  );

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
    if (backfillTimer !== null) clearInterval(backfillTimer);

    // Flush the in-progress play as `unknown` rather than discarding it (BR-2.6). Discarding
    // would lose a real listening event; asserting completed or skipped would claim something
    // unobserved. `unknown` records what actually happened: a play occurred, and its ending was
    // not seen.
    // Pending grace-window checks are completed rather than dropped (P-8, Q7 = C). Liked state
    // is point-in-time: unlike an observation trail it cannot be reconstructed afterwards.
    void likedSet
      ?.flushPending()
      .catch((error: unknown) => console.error('[labels] grace-window flush failed:', error));

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
