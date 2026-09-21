import express from 'express';
import { randomUUID } from 'node:crypto';
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
import { createApi, type DisplayLiked } from './api.js';
import { BackTestService } from './rules/BackTestService.js';
import { EvaluationCoordinator } from './rules/EvaluationCoordinator.js';
import { LiveFactSource } from './rules/liveFactSource.js';
import { LoggingExecutor } from './rules/LoggingExecutor.js';
import { RuleSetWatcher } from './rules/RuleSetWatcher.js';
import { RuleStore } from './rules/RuleStore.js';
import { SqliteDecisionLogRepository } from './rules/SqliteDecisionLogRepository.js';
import { DECISION_LOG_CAP } from './rules/types.js';
import { SqliteHistoryRepository } from './history/SqliteHistoryRepository.js';
import { PlayObserver, type PlaybackSample } from './history/PlayObserver.js';
import { RecentlyPlayedBackfill } from './history/RecentlyPlayedBackfill.js';
import { ExportService } from './export/ExportService.js';
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
          liveFacts.noteLikedAtStart(sample.trackId, likedSet?.isLiked(sample.trackId) ?? null);
          // ⚠️ U4: the trigger takes the play boundary FROM HERE and never re-derives it
          // (BR-22.8). Two segmenters that must agree is the WebSocket `403` shape, and the
          // evaluationId -> playId back-fill depends on their agreement, so a divergence
          // would mis-link decisions to plays rather than fail.
          coordinator?.onPlayStarted(sample.trackId, Date.now());
        },
        // Enrichment happens AFTER the row is written, never before and never on the display
        // path (NFR-16, BR-7.5): MusicBrainz latency was measured at 0.1-6.7s and can be
        // minutes behind a backfill sweep.
        onPlayRecorded: (playId, record) => {
          // ⚠️ This fires ONLY after recordPlay() succeeded. A failed write takes the other
          // path below, because a permanently-null playId would otherwise mean both "the play
          // never closed" (expected) and "the write failed" (a fault) — BR-24.3a.
          coordinator?.onPlayRecorded(record.trackId, playId);
          void enrichRecordedPlay(playId, record);
        },
        onPlayDropped: (record) => {
          coordinator?.onPlayDropped(record.trackId);
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
  /** `pending` when only genres resolved — never `unknown`, which is an answer. */
  verdict: string;
  confidence: string | null;
  contested: boolean;
  names: string[];
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
  // U4: the trigger waits on this, so it has to know a lookup started (BR-22.5).
  liveFacts.noteLabelPending(trackId);
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

    let genres: { name: string; count: number }[] | null = null;
    if (sample.artistId !== null) {
      const artist = await labelEnrichment.resolveArtist(sample.artistId, 'high');
      const artistSnapshot = labelEnrichment.toArtistSnapshot(artist);
      if (artistSnapshot !== null) genres = artistSnapshot.genres;
    }

    // Nothing at all resolved -- leave it uncached so a later tick tries again, rather than
    // pinning `pending` on the panel for the rest of the track.
    //
    // ⚠️ U4: this is one of the four exits that leave a track UNCACHED, and it is a transient
    // FAILURE rather than "still working". Saying so explicitly is what stops the trigger
    // waiting out the full cap and stamping `partialData` on a lookup that already finished
    // — recording a failure as a timeout (BR-22.5a).
    if (snapshot === null && genres === null) {
      liveFacts.noteLabelResult(sample.trackId, 'failed');
      return;
    }

    labelByTrack.set(sample.trackId, {
      verdict: snapshot?.verdict ?? 'pending',
      confidence: snapshot?.confidence ?? null,
      contested: snapshot?.contested ?? false,
      names: snapshot?.labelNames ?? [],
      genres,
    });

    // U4. ⚠️ `pending` is a DISPLAY state meaning "genres only, no release verdict"; for the
    // rules engine the lookup has completed and the classification is simply unknown. Passing
    // the display token through as a classification would invent a fourth LabelClass.
    liveFacts.noteLabelResult(sample.trackId, 'completed', {
      name: snapshot?.labelNames?.[0] ?? null,
      classification:
        snapshot?.verdict === 'major' ||
        snapshot?.verdict === 'independent' ||
        snapshot?.verdict === 'unknown'
          ? snapshot.verdict
          : null,
      confidence: snapshot?.confidence ?? null,
      // `null` = never asked, `[]` = asked and there are none. The distinction is load-bearing.
      genres: genres === null ? null : genres.map((g) => g.name),
    });

    while (labelByTrack.size > MAX_DISPLAY_LABELS) {
      const oldest = labelByTrack.keys().next().value;
      if (oldest === undefined) break;
      labelByTrack.delete(oldest);
    }
  } catch (error) {
    // A label is enrichment. Failing to get one must never affect the display (NFR-18).
    console.error('[labels] display resolution failed:', error);
    // ⚠️ And it must not leave the trigger waiting out the cap on a lookup that has already
    // ended. `failed` is not `pending`, and neither is `unknown`.
    liveFacts.noteLabelResult(sample.trackId, 'failed');
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
      if (artistSnapshot !== null) repository.applyArtistSnapshot(playId, artistSnapshot);
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
    // U4 / schema v5. `?? null` is the right coalesce here and `?? false` would be a defect:
    // enrichment that has not landed, and a `GET /tracks/{id}` that failed, both arrive as
    // absent — and neither is evidence that the track is clean (BR-31.3b).
    explicit: enrichmentData?.explicit ?? null,
    albumType: enrichmentData?.albumType ?? null,
  };
}

/**
 * ## U4: the rules engine, wired in dry-run
 *
 * ⚠️ **This is where U3's containment guarantee retires** (BR-30). U3's was "`git status src/`
 * shows only `src/rules/`"; from here the phase boundary rests on `src/playback/` not existing
 * and on `LoggingExecutor` taking no playback collaborator. Nothing below can skip a track —
 * there is no code in this process that can.
 *
 * ⚠️ **Everything here is optional.** A rules subsystem that fails to start must never stop the
 * app recording: the play records are the artefact that cannot be regenerated, and rules are
 * text that can be retyped (BR-20.10).
 */
const RULES_PATH = process.env['RULES_PATH'] ?? '/config/rules.json';
const RULES_POLL_INTERVAL_MS = Number(process.env['RULES_POLL_INTERVAL_MS'] ?? 5_000);
/**
 * ⚠️ **An admitted guess, and the only number in U4 openly unmeasured** (BR-22.3). The
 * enrichment latency it waits on has never been measured — the 0.2 s figure that looked like a
 * measurement was `resolvedAt` stamped BEFORE the two MusicBrainz calls.
 *
 * ⚠️ Raising it widens BR-22.7's blind spot: plays that END before the cap produce no decision
 * row at all — 2.8% of plays and 4 of 31 skips at 10 s, 3.5% and 5 of 31 at 15 s. The
 * `partialData` rate is the first real measurement; re-measure before changing this.
 */
const ENRICHMENT_WAIT_MS = Number(process.env['ENRICHMENT_WAIT_MS'] ?? 10_000);

const liveFacts = new LiveFactSource(labelEnrichment !== null);

let ruleWatcher: RuleSetWatcher | null = null;
let decisionLog: SqliteDecisionLogRepository | null = null;
let coordinator: EvaluationCoordinator | null = null;
let backTest: BackTestService | null = null;
let lastRuleCheck: string | null = null;

// ⚠️ No repository means no decision log and no evaluation (BR-22.8a), accepted knowingly:
// the trigger hangs off PlayObserver's hooks, and the log lives in history.db anyway.
if (repository !== null) {
  try {
    decisionLog = new SqliteDecisionLogRepository(repository.database);

    ruleWatcher = new RuleSetWatcher({
      store: new RuleStore(RULES_PATH),
      intervalMs: RULES_POLL_INTERVAL_MS,
      now: () => new Date().toISOString(),
    });

    coordinator = new EvaluationCoordinator({
      rules: () => ruleWatcher!.rules(),
      ruleSet: () => ruleWatcher!.current(),
      liveFacts,
      executor: new LoggingExecutor(decisionLog),
      historyCounts: (trackId, artistId, beforeIso) =>
        repository!.historyCountsBefore(trackId, artistId, beforeIso),
      attachPlayId: (evaluationId, playId) => decisionLog!.attachPlayId(evaluationId, playId),
      markLinkFailed: (evaluationId) => decisionLog!.markLinkFailed(evaluationId),
      nowMs: () => Date.now(),
      newEvaluationId: () => randomUUID(),
      enrichmentWaitMs: ENRICHMENT_WAIT_MS,
    });

    backTest = new BackTestService({
      playsInRange: (range) => repository!.listPlays({ since: range.from, until: range.to }),
      historyCountsBefore: (trackId, artistId, beforeIso) =>
        repository!.historyCountsBefore(trackId, artistId, beforeIso),
      v5Watermark: () => repository!.v5Watermark(),
      now: () => new Date().toISOString(),
    });

    void ruleWatcher.start().then(() => {
      lastRuleCheck = new Date().toISOString();
    });
  } catch (error) {
    // Inert, never fatal. The display and the recorder are unaffected.
    console.error('[rules] failed to start — running with no rules engine:', error);
    ruleWatcher = null;
    decisionLog = null;
    coordinator = null;
    backTest = null;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(localGuard);

/**
 * The API lives in `api.ts`, built from injected dependencies.
 *
 * The routes moved out so they could be tested. Importing this file starts the MCP client, opens
 * SQLite, starts the poll loop and calls `listen()`, so nothing could import it and nothing did
 * — nine routes at zero coverage while the suite reported 98.96%, because a file no test loads is
 * absent from the coverage denominator rather than counted as zero. This file keeps the wiring;
 * `api.ts` keeps the decisions.
 */
app.use(
  createApi({
    repository,
    historyStartupError,
    exportService,
    likedSet,
    labelStartupError,
    observerStats: observer?.stats ?? null,
    nowPlaying,
    listToolNames: () => spotify.listToolNames(),
    diagnostics: runDiagnosticsReport,
    likedFor,
    now: () => new Date().toISOString(),
    // ⚠️ The rule set comes from the WATCHER, which owns it. `RuleStore` has no `current()`
    // to wire this to by mistake (BR-26.3b).
    ruleSet: ruleWatcher === null ? null : () => ruleWatcher!.current(),
    decisionLog,
    backTest,
    reloadRules:
      ruleWatcher === null
        ? null
        : async () => {
            const outcome = await ruleWatcher!.reloadNow();
            lastRuleCheck = new Date().toISOString();
            return outcome;
          },
  }),
);

/**
 * The diagnostics sweep, wired here because its collaborators are all module state.
 *
 * `asOf` on the coverage figures is required rather than decorative: under BR-13 the same
 * coverage query run twice can legitimately differ, so a figure without a timestamp is not
 * interpretable.
 */
async function runDiagnosticsReport() {
  return runDiagnostics(
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
}

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
 * ⚠️ **U4's trigger consumes `tick`, never `change`** (BR-22.6), for the same reason history
 * capture does: `change` is signature-suppressed and the signature excludes progress, so a
 * trigger fed from it would evaluate sparsely, at the wrong moments, and would look like it
 * was working.
 *
 * Registered AFTER the observer's tick handler, so the observer has opened the play (and the
 * coordinator has its boundary) before the first evaluation attempt for that track.
 */
function registerEvaluationTick(): void {
  if (coordinator === null) return;
  nowPlaying.on('tick', (snapshot: Snapshot) => {
    try {
      coordinator!.onTick(toEvaluationSample(snapshot), Date.now());
    } catch (error) {
      // ⚠️ Rules are text that can be retyped; the play records cannot be regenerated. A
      // failure here must never reach the recorder or the display (BR-20.10).
      console.error('[rules] evaluation tick failed:', error);
    }
  });
}

/** Project a snapshot onto what a rule may read. Null when nothing is playing. */
function toEvaluationSample(snapshot: Snapshot) {
  if ('error' in snapshot || !snapshot.playing) return null;
  if (!snapshot.trackId) return null;

  const enrichmentData = snapshot.enrichment;
  return {
    trackId: snapshot.trackId,
    title: snapshot.track ?? '',
    durationMs: snapshot.durationMs ?? 0,
    explicit: enrichmentData?.explicit ?? null,
    isrc: enrichmentData?.isrc ?? null,
    artistId: enrichmentData?.primaryArtistId ?? null,
    artistName: snapshot.artist ?? '',
    following: enrichmentData?.following ?? null,
    albumName: snapshot.album ?? '',
    releaseDate: enrichmentData?.releaseDate ?? null,
    ageYears: enrichmentData?.ageYears ?? null,
    albumType: enrichmentData?.albumType ?? null,
    // ⚠️ Whether enrichment LANDED, not whether its fields happen to be non-null. A track
    // with no ISRC and no artist id has landed and is permanently unanswerable; inferring
    // "pending" from null fields is the confusion BR-22.5 exists to prevent.
    enrichmentLanded: enrichmentData !== null && enrichmentData !== undefined,
  };
}

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

registerEvaluationTick();

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
