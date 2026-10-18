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
import type { AutomationDiagnosticsInput } from './diagnostics.js';
import { localGuard, decideAccess } from './localGuard.js';
import { createApi, type DisplayLiked } from './api.js';
import { BackTestService } from './rules/BackTestService.js';
import { EvaluationCoordinator } from './rules/EvaluationCoordinator.js';
import { LiveFactSource } from './rules/liveFactSource.js';
import { LoggingExecutor } from './rules/LoggingExecutor.js';
import type { DecisionExecutor } from './rules/types.js';
import { AutomationStateStore } from './playback/AutomationStateStore.js';
import { PlaybackContextCache } from './playback/playbackContext.js';
import { SkipDrain } from './playback/skipDrain.js';
import { SkipExecutor } from './playback/SkipExecutor.js';
import { SpotifyPlayerClient } from './playback/spotifyPlayerClient.js';
import { SqliteSkipAttemptRepository } from './playback/SqliteSkipAttemptRepository.js';
import { pollOutcomeOf, UpstreamMetrics } from './playback/upstreamMetrics.js';
import { RuleSetWatcher } from './rules/RuleSetWatcher.js';
import { RuleStore } from './rules/RuleStore.js';
import { formatDecisionSummary } from './rules/decisionSummary.js';
import { SqliteDecisionLogRepository } from './rules/SqliteDecisionLogRepository.js';
import { DECISION_LOG_CAP } from './rules/types.js';
import {
  automationIndicator,
  freshUnconfirmedSkip,
  recordingIndicator,
  rulesIndicator,
  spotifyIndicator,
  type Indicator,
} from './ui/statusBar.js';
import type { AutomationIndicatorState } from './ui/statusBar.js';
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
import { loadMusicBrainzIdentity, userAgentFrom, type MusicBrainzIdentity } from './config.js';
import { readAppVersion } from './version.js';
import { probeDirectoryWritable, probeFileWritable } from './configuration/atomicWrite.js';
import {
  classifyCredentialsDirectory,
  credentialsDirectoryMessage,
  probeCredentialsDirectory,
} from './configuration/credentialsDirectory.js';
import type { ConfigurationDiagnosticsInput } from './configuration/configurationDiagnostics.js';
import { CredentialsWriter } from './configuration/CredentialsWriter.js';
import { RulesWriter } from './configuration/RulesWriter.js';
import { readFileSync } from 'node:fs';
import type { NewPlayRecord } from './history/types.js';
import { MaintenanceService } from './maintenance/MaintenanceService.js';
import {
  applyPendingRestore,
  finishRestoreRules,
  revertToPrevious,
  sweepLeftovers,
  type RestoreOutcome,
} from './maintenance/startupRestorer.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * U9 (LC-61, P-68): read ONCE at startup -- mounts do not change while the container runs. Anything but `ok` keeps
 * the connector from being spawned (no refresh into a path that would fail with EBUSY), shows the reason on the
 * Spotify indicator, and is reported by diagnostics. The app itself still starts (NFR-13).
 */
const credentialsDirectoryClass = classifyCredentialsDirectory(
  probeCredentialsDirectory(config.spotifyConfigPath, config.inContainer),
);
const credentialsDirectoryText = credentialsDirectoryMessage(credentialsDirectoryClass, dirname(config.spotifyConfigPath));
if (credentialsDirectoryText !== null) console.error(`[credentials] ${credentialsDirectoryText}`);
const spotify = new SpotifyMcpClient({ blockedBecause: () => credentialsDirectoryText });
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

// ── U6: apply a staged restore, then sweep leftovers — BEFORE the database is opened (P-38, LC-37/38) ──
//
// ⚠️ THIS ORDER IS THE WHOLE GUARANTEE, and `test/maintenanceWiring.test.ts` pins it. *Restore backup* stages a
// verified file and exits; Docker restarts the app and the swap happens HERE, when nothing has the database open.
// There is no second writer to guard against — on this machine or any other. Moving this below the repository's
// construction would make the swap rename a file the app is already writing.
let startupRestore: RestoreOutcome = { kind: 'none' };
let startupSwept = 0;
const historyDataDir = dirname(config.historyDbPath);
if (config.historyEnabled) {
  try {
    startupRestore = applyPendingRestore(historyDataDir);
    startupSwept = sweepLeftovers(historyDataDir);
    if (startupRestore.kind === 'applied') {
      console.log(`[restore] applied at startup: ${startupRestore.plays ?? 'unknown'} plays, backup taken ${startupRestore.takenAt ?? 'at an unknown time'}`);
    } else if (startupRestore.kind === 'failed') {
      console.warn(`[restore] NOT applied: ${startupRestore.reason}`);
    }
    if (startupSwept > 0) console.warn(`[restore] removed ${startupSwept} leftover working file(s) — an operation was interrupted`);
  } catch (error) {
    // Never fatal: the app starts on whatever database is there. The restorer's own invariant is that this is
    // never an empty one.
    console.error('[restore] startup restore check failed:', error);
  }
}

/**
 * Open the history database. ⚠️ If a restore was applied at THIS start and the restored file will not open or
 * migrate, put the previous database back and open that instead (BR-48.6) — never start empty.
 */
function openHistory(): SqliteHistoryRepository {
  try {
    return new SqliteHistoryRepository(config.historyDbPath);
  } catch (error) {
    if (startupRestore.kind === 'applied' && revertToPrevious(historyDataDir)) {
      const reason = error instanceof Error ? error.message : String(error);
      startupRestore = { kind: 'failed', reason: `the restored database would not open (${reason}); your previous history was put back` };
      console.error(`[restore] ${startupRestore.reason}`);
      return new SqliteHistoryRepository(config.historyDbPath);
    }
    throw error;
  }
}

if (config.historyEnabled) {
  try {
    repository = openHistory();
    // Probe rather than assume: bind-mount permission problems otherwise surface at the first
    // play boundary, minutes after startup, behind a healthy-looking UI.
    repository.verifyWritable();

    observer = new PlayObserver(
      repository,
      {
        completionThreshold: config.completionThreshold,
        jitterToleranceMs: config.jitterToleranceMs,
        maxUnobservedTailMs: config.maxUnobservedTailMs,
        minObservedPositionRatio: config.minObservedPositionRatio,
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
          // ⚠️ This links the skip attempt too, via the coordinator's `attachPlayId` callback — which
          // is where the "is this still the play that was decided" guard lives. Do NOT add a second
          // call here; see the note on that callback.
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
/** U7: kept so a contact saved in Settings can rebuild the User-Agent (BR-57.4). */
let labelIdentity: MusicBrainzIdentity | null = null;
let labelStartupError: string | null = null;
let backfillTimer: NodeJS.Timeout | null = null;

if (config.labelsEnabled && repository !== null) {
  try {
    // Fails closed: no anonymous User-Agent fallback. NFR-14 compliance is a choice this
    // project made, and unidentified traffic sent while believing we are compliant is worse
    // than refusing to start.
    const identity = loadMusicBrainzIdentity((path) => readFileSync(path, 'utf8'), readAppVersion());
    labelIdentity = identity;
    labelUserAgent = userAgentFrom(identity);

    labelQueue = new RequestQueue();
    const client = new MusicBrainzClient({
      queue: labelQueue,
      // U7 (BR-57.4): a GETTER, so a contact saved in Settings applies to the next request without a restart.
      userAgent: () => labelUserAgent ?? '',
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
    // ⚠️ U5, BR-41.1. The MCP `getNowPlaying` this sample is built from returns NO context (BR-41.2),
    // which is why `context_type` was null on every live play since v1 while backfilled rows carried
    // it — the field was available exactly where the outcome variable was not. These two come from
    // `GET /me/player/currently-playing`, fetched once per TRACK by the tick handler.
    //
    // ⚠️ `null` on the first tick of a track, because the fetch has not returned yet — which is
    // *unknown*, and correct. The play row is not written until the play CLOSES, by which time the
    // value has arrived; this sample feeds the display, where a one-tick delay costs nothing.
    //
    // ⚠️ EVIDENCE ONLY, never a rule input (BR-41.3/41.5). `contextUri` goes stale on its own, and
    // `contextType` cannot tell the AI DJ from a radio station — both are `type: playlist`.
    contextType: playbackContext.get(snapshot.trackId).contextType,
    contextUri: playbackContext.get(snapshot.trackId).contextUri,
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
 * shows only `src/rules/`"; U4's was `src/playback/` not existing.
 *
 * ⚠️ **BOTH ARE GONE AS OF U5, and the old sentence here — *"nothing below can skip a track, there
 * is no code in this process that can"* — IS NO LONGER TRUE.** Corrected 2026-10-02. What replaces it:
 *
 *   - **`SKIP_EXECUTOR_ENABLED` is `false` by default**, so `SkipExecutor` is not even constructed.
 *     That is a deployment-time posture, not a dev flag: it is what lets U5 ship **inert** while the
 *     dry-run log is reviewed, which is BR-40.1's actual arming gate.
 *   - **`globalAutomationEnabled` is `false` by default** and is re-read at the action point, so even a
 *     constructed `SkipExecutor` cannot act until the switch is thrown (FR-47, BR-33.5).
 *   - **`LoggingExecutor` still takes one collaborator**, pinned by `LoggingExecutor.length === 1`.
 *   - **Nothing in `src/rules/` imports `src/playback/`**, pinned structurally (P-33).
 *
 * ⚠️ **Everything here is optional.** A rules subsystem that fails to start must never stop the
 * app recording: the play records are the artefact that cannot be regenerated, and rules are
 * text that can be retyped (BR-20.10).
 */
const RULES_PATH = process.env['RULES_PATH'] ?? '/config/rules.json';
const RULES_POLL_INTERVAL_MS = Number(process.env['RULES_POLL_INTERVAL_MS'] ?? 5_000);

/**
 * U7 — the ONE path by which the app writes `rules.json` (LC-43). Constructed BEFORE the watcher, with none
 * attached, because BR-59.5 applies a restored backup's rules here — after the restored database has opened
 * (`openHistory` above) and before the watcher's first load, so no rule ever runs against the wrong corpus.
 */
const rulesWriter = new RulesWriter({ rulesPath: RULES_PATH, watcher: null, now: () => Date.now() });
{
  // `startupRestore` is still `applied` only if the restored database OPENED: `openHistory` turns it into `failed`
  // when it falls back to the previous history (BR-48.6) — and then the backup's rules must not be applied either.
  const rulesResult = finishRestoreRules(startupRestore, repository !== null, rulesWriter);
  if (rulesResult !== null && startupRestore.kind === 'applied') {
    startupRestore = { ...startupRestore, rulesResult };
    if (rulesResult === 'applied') console.log('[restore] the backup’s rules were applied, as requested');
    else if (typeof rulesResult === 'object') console.warn(`[restore] the backup’s rules were NOT applied: ${rulesResult.skipped}`);
  }
}
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

/**
 * ⚠️ **Which `DecisionExecutor` is CONSTRUCTED. Not the kill switch.**
 *
 * Two off switches, and they are not redundant (code-gen Q2):
 *
 *   | | answers | changing it | checked |
 *   |---|---|---|---|
 *   | `SKIP_EXECUTOR_ENABLED` | *is the skip machinery built at all?* | this file + restart | once, at startup |
 *   | `globalAutomationEnabled` | *may a built attempt fire?* | one UI click | every attempt, at the action point |
 *
 * ⚠️ Collapsing them would break FR-38: a control that needs a restart cannot satisfy *no skip is
 * issued after the switch is thrown*. And dropping this flag would lose the ability to deploy U5
 * **inert** for the dry-run review.
 */
const SKIP_EXECUTOR_ENABLED = process.env['SKIP_EXECUTOR_ENABLED'] === 'true';

/**
 * ⚠️ On its own mount, NOT in `config/` (Infrastructure Q1 = C).
 *
 * `:rw` on `config/` would grant this app permission to overwrite the user's hand-authored
 * `rules.json` — a permission no U5 code would use, and one BR-20.8 would not protect, since it
 * reloads on a *parse failure* and a file truncated to valid-but-empty JSON parses fine.
 *
 * ⚠️ `data/` was rejected because of RESTORE: once W-5's full-inventory backup exists, restoring a
 * week-old backup would restore the week-old latch and **silently re-arm automation**.
 */
const AUTOMATION_STATE_PATH =
  process.env['AUTOMATION_STATE_PATH'] ?? '/state/automation-state.json';

const liveFacts = new LiveFactSource(labelEnrichment !== null);

/**
 * M1–M4. Constructed unconditionally, because the question it answers — *is this app a good citizen
 * of the vendor APIs?* — does not depend on whether automation is armed.
 */
const upstreamMetrics = new UpstreamMetrics();

const automationState = new AutomationStateStore(AUTOMATION_STATE_PATH);

/**
 * ⚠️ **A PROBE, not an inference from `compose.yaml`**, and it runs whether or not automation is
 * enabled — because the answer has to be known *before* the user reaches for the kill switch, not at
 * the moment they need it.
 *
 * ⚠️ **It must not prevent startup** (NFR-13). An unwritable `/state` means automation cannot be
 * **armed**; it does not mean the app stops **recording**. Recording is the irreplaceable function.
 */
const automationStateWritable = automationState.probeWritable();
if (!automationStateWritable) {
  console.error(
    `[automation] ⚠️ ${AUTOMATION_STATE_PATH} is NOT WRITABLE. Automation cannot be armed, and a ` +
      `kill-switch change would appear to work in the UI and not persist. Recording is unaffected. ` +
      `Check that ./state is mounted :rw — and verify THROUGH THE CONTAINER, not on the host.`,
  );
}

/**
 * Playback context, fetched once per track (BR-41.1/41.2) — ~16 requests/hour, against the poll's 1,200.
 *
 * ⚠️ **Constructed unconditionally**, like `upstreamMetrics` and unlike `labelEnrichment`: `webApi` is
 * non-nullable here, so there is no "only when the client exists" case to guard. A FAILED fetch is what
 * leaves the field `null`, and `null` is *unknown* — the honest value, never a guess.
 */
const playbackContext = new PlaybackContextCache(webApi, (outcome) =>
  upstreamMetrics.record('spotify', outcome === 'ok' ? 'ok' : 'error', Date.now()),
);

let ruleWatcher: RuleSetWatcher | null = null;
let decisionLog: SqliteDecisionLogRepository | null = null;
let coordinator: EvaluationCoordinator | null = null;
let backTest: BackTestService | null = null;
let lastRuleCheck: string | null = null;
let skipAttempts: SqliteSkipAttemptRepository | null = null;
let skipDrain: SkipDrain | null = null;

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
    // U7: an interactive rules write reports the WATCHER's verdict, so the writer needs it from here on.
    rulesWriter.attachWatcher(ruleWatcher);

    skipAttempts = new SqliteSkipAttemptRepository(repository.database);

    /**
     * ⚠️ **THE ONE PLACE THE TWO EXECUTORS DIVERGE, and the default is the inert one.**
     *
     * `LoggingExecutor` records and never acts (BR-30/33.6). `SkipExecutor` is a second implementation
     * **added alongside it**, never grown out of it — so `LoggingExecutor.length === 1` still holds.
     *
     * ⚠️ With `SKIP_EXECUTOR_ENABLED` unset, nothing in this block is constructed: no player client,
     * no drain, no attempt rows. That is how U5 ships **inert** for the dry-run review.
     */
    let executor: DecisionExecutor = new LoggingExecutor(decisionLog);

    if (SKIP_EXECUTOR_ENABLED) {
      const player = new SpotifyPlayerClient(
        () => webApi.getAccessToken(),
        () => webApi.invalidateAccessToken(),
      );

      const drain = new SkipDrain({
        attempts: skipAttempts,
        state: automationState,
        decisions: decisionLog,
        ruleSet: () => ruleWatcher!.current(),
        recentPlays: (limit) => repository!.recentPlaysForCounting(limit),
        // The POST is counted like every other upstream call (M1/M2). ⚠️ A 429 here is recorded as a
        // rate limit rather than an error, because the two mean different things about this app's
        // behaviour and `lastRetryAfterMs` is the only observed ceiling Spotify ever states.
        player: {
          skipToNext: async () => {
            const outcome = await player.skipToNext();
            upstreamMetrics.record(
              'spotify',
              outcome.kind === 'refused' && outcome.reason === 'upstream-rate-limited'
                ? 'rate-limited'
                : outcome.kind === 'failed'
                  ? 'error'
                  : 'ok',
              Date.now(),
            );
            return outcome;
          },
        },
        /**
         * ⚠️ **`evaluationId`, not `trackId`, is what the attempt is matched against** — it is the only
         * per-play identifier that exists while the play is OPEN, which is the same fact that made
         * `skip_attempt.play_id` nullable. A repeat listen is a different play, so an attempt from the
         * earlier one cannot fire against the later one.
         *
         * Returns `null` whenever the answer is not unambiguous — nothing playing, an error snapshot, no
         * progress, or a snapshot whose track disagrees with the coordinator. **The drain reads `null` as
         * `play-closed` and refuses**, which is what BR-34 wants when we cannot tell.
         */
        currentPlay: () => {
          const inProgress = coordinator?.inProgress ?? null;
          if (inProgress === null) return null;
          const snapshot = nowPlaying.current;
          if ('error' in snapshot || !snapshot.playing) return null;
          if (!snapshot.trackId || snapshot.progressMs === null) return null;
          if (snapshot.trackId !== inProgress.trackId) return null;
          return {
            evaluationId: inProgress.evaluationId,
            trackId: snapshot.trackId,
            progressMs: snapshot.progressMs,
          };
        },
        nowIso: () => new Date().toISOString(),
        nowMs: () => Date.now(),
        // BR-43.4's confirmation grace. `unref` so a pending 3 s wait cannot hold the process open.
        delay: (ms) =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, ms).unref();
          }),
        // ⚠️ The drain does not know the UI exists. It reports the latch here; the indicator reads the
        // state file, which the drain has already written by the time this runs.
        onHalt: (halt) =>
          console.error(
            `[automation] ⚠️ HALTED: ${halt.trigger} — observed ${halt.observedCount} against a ` +
              `threshold of ${halt.threshold}. Automation is latched OFF and clears ONLY on explicit ` +
              `acknowledgement (BR-35.6). Attempts: ${halt.attemptIds.join(', ')}`,
          ),
      });

      /**
       * ⚠️ **THE STARTUP SWEEP, AND IT RUNS BEFORE THE FIRST DRAIN EVER COULD** (P-29).
       *
       * A `queued` row that survived a restart is one whose drain never ran. Firing it would skip
       * whatever is playing **now** rather than the track the rule matched — the clearest way this unit
       * could do harm. Closed as `refused: play-closed` rather than deleted, because an attempt that
       * never fired must stay distinguishable from one that never existed.
       *
       * ⚠️ `currentPlay` above would refuse them anyway, since no `evaluationId` from a previous process
       * can match. **Two independent guards, and neither is grounds for dropping the other.**
       */
      const swept = drain.sweepOrphaned();
      if (swept > 0) {
        console.log(
          `[automation] swept ${swept} skip attempt(s) left queued by a previous process — closed as ` +
            `play-closed, NOT fired.`,
        );
      }

      skipDrain = drain;
      executor = new SkipExecutor({
        log: decisionLog,
        attempts: skipAttempts,
        state: automationState,
        nowIso: () => new Date().toISOString(),
        // ⚠️ Scheduled, never awaited: `execute` is synchronous and is itself called unawaited from a
        // timer. `drain` is contracted never to throw, and the 3 s tick calls the SAME drain as a
        // backstop — one drain function, two entry points.
        scheduleDrain: () => {
          setImmediate(() => void drain.drain());
        },
      });

      console.log(
        `[automation] SkipExecutor is CONSTRUCTED and can issue skips. ⚠️ Whether one fires is still ` +
          `governed by the kill switch, which is OFF by default and re-read at every action point.`,
      );
    }

    coordinator = new EvaluationCoordinator({
      rules: () => ruleWatcher!.rules(),
      ruleSet: () => ruleWatcher!.current(),
      liveFacts,
      executor,
      historyCounts: (trackId, artistId, beforeIso) =>
        repository!.historyCountsBefore(trackId, artistId, beforeIso),
      /**
       * ⚠️ **BOTH links go through THIS ONE callback, because the GUARD lives in the coordinator.**
       *
       * `onPlayRecorded` fires when a play CLOSES, and by then `#current` may already be the next
       * track — so the coordinator checks `play.trackId === trackId && play.decided` before calling
       * this. An independent `skipAttempts.attachPlayId` on the `onPlayRecorded` hook would NOT have
       * that check, and would attach the closing play's id to the NEXT play's attempt.
       *
       * ⚠️ That is the WebSocket `403` shape again: one rule implemented twice, with the second copy
       * missing a term. One call site, one guard — and `src/rules/` still imports nothing from
       * `src/playback/` (P-33), because the coordinator only knows it was handed a function.
       */
      attachPlayId: (evaluationId, playId) => {
        decisionLog!.attachPlayId(evaluationId, playId);
        // ⚠️ Convenience for analysis, never load-bearing: the one-attempt guard keys on
        // `evaluationId` and does not read `play_id`. Caught here so it cannot cost the decision
        // log its own link, which IS load-bearing (BR-24.1).
        try {
          skipAttempts?.attachPlayId(evaluationId, playId);

          /*
           * ⚠️ **AND the `skip_source` label, here and nowhere else** (BR-35.3).
           *
           * This is the first instant at which the question is answerable by the key that works:
           * `skip_attempt.play_id` has just been set, one line above. `PlayObserver` wrote `'user'`
           * provisionally because the play row did not exist when it ran.
           *
           * ⚠️ A previous fix answered it inside `PlayObserver` by matching the attempt against the
           * play's time window, and it failed live by **11–14 ms** — `ended_at` is the last observation
           * and the attempt is enqueued from the decision taken just after it.
           *
           * ⚠️ The SAFETY LIMIT does not depend on this: `recentPlaysForCounting` joins `skip_attempt`
           * directly, so a failure here costs analysis accuracy and never costs a halt.
           */
          if (skipAttempts?.reachedPlayerForEvaluation(evaluationId) === true) {
            repository!.markSkippedByRule(playId);
          }
        } catch (error) {
          console.error('[automation] could not link a skip attempt to its play row:', error);
        }
      },
      markLinkFailed: (evaluationId) => decisionLog!.markLinkFailed(evaluationId),
      nowMs: () => Date.now(),
      newEvaluationId: () => randomUUID(),
      enrichmentWaitMs: ENRICHMENT_WAIT_MS,
      // One line per DECISION — per play, so ~50-100/day, not the per-tick volume BR-3.8
      // forbids. It is the only per-play line this app writes; everything else on this
      // stream speaks on failure only, and that stays true.
      //
      // ⚠️ Summary only. Every field value is already durable in `decision_log` and served
      // by GET /api/decisions, so reprinting it here would duplicate a queryable record into
      // a stream that scrolls away — and would bury the recording-failure lines that BR-3.8
      // keeps rare precisely so they get noticed.
      onDecision: (summary) => console.log(formatDecisionSummary(summary)),
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

/**
 * U6 — backup, restore and undo (FR-57…FR-59). `null` when history is off, so the routes answer 503.
 *
 * ⚠️ `requestRestart` goes through the app's one `shutdown` path, and is deferred a tick so the 202 that
 * says *restarting* reaches the browser before the server closes.
 */
const maintenance: MaintenanceService | null = config.historyEnabled
  ? new MaintenanceService({
      dataDir: historyDataDir,
      rulesPath: RULES_PATH,
      appVersion: readAppVersion(),
      liveDb: () => repository?.database ?? null,
      requestRestart: () => void setTimeout(() => shutdown('A restore was staged'), 250),
      supervised: config.inContainer,
      now: () => new Date(),
      startup: { restore: startupRestore, swept: startupSwept },
      // U7 (BR-59.1, BR-59.4): one comparison, one hash — the rules writer's.
      rulesCandidate: (text) => rulesWriter.compareCandidate(text),
      currentRulesHash: () => rulesWriter.download()?.hash ?? null,
    })
  : null;

/**
 * U7 — Spotify credentials and the MusicBrainz contact from Settings (LC-44). The poll loop, the MCP client and the
 * Web API client are passed as PORTS: the writer pauses the first, waits for the second's child to EXIT (P-49),
 * and makes the third forget the credentials it cached (it caches the whole file, not just the token).
 */
const credentials = new CredentialsWriter({
  spotifyConfigPath: config.spotifyConfigPath,
  musicbrainzPath: config.musicbrainzConfigPath,
  poller: nowPlaying,
  mcp: spotify,
  webApi,
  // BR-57.4: the MusicBrainz client reads its User-Agent through `labelUserAgent`, so the next request carries the
  // new contact. ⚠️ If labels were DISABLED at startup (no contact then), nothing is constructed to use it until a
  // restart — the Settings route says so (`restartNeeded`).
  onContactChanged: (contact) => {
    if (labelIdentity !== null) {
      labelIdentity = { ...labelIdentity, contact };
      labelUserAgent = userAgentFrom(labelIdentity);
    }
  },
  now: () => Date.now(),
});

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
    reportTimeZone: config.reportTimeZone,
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
    // U5. ⚠️ The STORE itself, with no adapter: `AutomationControl` names `probeWritable` so the
    // store satisfies it structurally. One implementation, reached one way.
    automation: automationState,
    // U6. Behind `localGuard` (app-wide, above) AND `ingestGuard` (per route, in api.ts).
    maintenance,
    // ⚠️ The POSTURE, not the switch. False means `SkipExecutor` was never constructed, so the UI
    // must say *the machinery is not built* rather than draw a switch that would do nothing if thrown.
    skipExecutorEnabled: SKIP_EXECUTOR_ENABLED,
    skipAttempts,
    // U7. Behind `localGuard` (app-wide) AND `ingestGuard` (per route, in api.ts), like U6.
    rulesWriter,
    credentials,
    labelsActive: labelUserAgent !== null,
    appVersion: readAppVersion(),
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
    automationDiagnostics(),
    maintenance?.status(),
    configurationDiagnostics(),
  );
}

/**
 * U7 (IN-U7-6) — probed FRESH on every sweep, through the container, like `/state`'s: a `:ro` left in place then
 * shows on the first page load rather than on the first save. Credential VALUES never reach this (P-53).
 */
function configurationDiagnostics(): ConfigurationDiagnosticsInput {
  const m = upstreamMetrics.snapshot(Date.now());
  return {
    configWritable: probeDirectoryWritable(RULES_PATH),
    rulesPath: RULES_PATH,
    musicbrainzWritable: probeFileWritable(config.musicbrainzConfigPath),
    musicbrainzPath: config.musicbrainzConfigPath,
    spotifyWritable: probeFileWritable(config.spotifyConfigPath),
    spotifyPath: config.spotifyConfigPath,
    credentialsDirectory: { class: credentialsDirectoryClass, message: credentialsDirectoryText },
    lastRulesWrite: rulesWriter.lastWrite(),
    lastCredentialsWrite: credentials.lastWrite(),
    polls: { total: m.pollsTotal, idle: m.pollsIdle, error: m.pollsError, idleShare: m.idleShare },
  };
}

/**
 * The U5 half of the diagnostics input.
 *
 * ⚠️ **Reads the state FRESH on every sweep**, and probes writability fresh with it. Both are cheap
 * (one small file), and a cached copy would answer *what did startup see* — which is precisely the
 * question that was already stale when someone threw the switch and wondered why nothing changed.
 */
function automationDiagnostics(): AutomationDiagnosticsInput {
  const read = automationState.read();
  const queued = skipAttempts?.queued() ?? [];
  const nowMs = Date.now();
  const oldest = queued
    .map((a) => Date.parse(a.enqueuedAt))
    .filter((ms) => Number.isFinite(ms))
    .reduce<number | null>((min, ms) => (min === null || ms < min ? ms : min), null);

  return {
    state: {
      enabled: read.state.globalAutomationEnabled,
      halt: read.state.runawayHalt,
      source: read.source,
      ...(read.detail === undefined ? {} : { detail: read.detail }),
    },
    executorEnabled: SKIP_EXECUTOR_ENABLED,
    statePath: AUTOMATION_STATE_PATH,
    stateWritable: automationState.probeWritable(),
    queue: {
      depth: queued.length,
      // ⚠️ `null` with an empty queue, never 0 — and `Math.max(0, …)` because a clock that moved
      // backwards must not produce a negative age that reads as a future timestamp.
      oldestQueuedAgeMs: oldest === null ? null : Math.max(0, nowMs - oldest),
    },
    lastAttempt: skipAttempts?.latest() ?? null,
    // ⚠️ Non-zero means the consecutive halt is under-counting. See the diagnostics step.
    unlinkedFiredAttempts: skipAttempts?.unlinkedFiredCount() ?? 0,
    metrics: upstreamMetrics.snapshot(nowMs),
  };
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

/**
 * Attach everything the panel shows but the poll loop does not carry: label verdict, liked,
 * and the status bar's indicators.
 *
 * ⚠️ **`status` is attached even when nothing is playing.** That is precisely when someone
 * looks at the bar — an idle screen is the state in which "is this thing still recording?"
 * cannot be answered by watching the track change.
 */
function decorate(
  snapshot: Snapshot,
): Snapshot & { label?: DisplayLabel; liked?: DisplayLiked; status?: StatusIndicators } {
  const status = statusIndicators(snapshot);
  const trackId = (snapshot as { trackId?: string | null }).trackId ?? null;
  if (trackId === null) return { ...snapshot, status };

  const label = labelByTrack.get(trackId);
  const liked = likedFor(trackId);

  return {
    ...snapshot,
    ...(label === undefined ? {} : { label }),
    ...(liked === undefined ? {} : { liked }),
    // ⚠️ The `status` computed ABOVE, not a second call. This called `statusIndicators(snapshot)`
    // twice -- harmless while every input was an in-memory counter, and no longer: from U5 the
    // automation indicator READS THE STATE FILE and queries `skip_attempt`, so a second call doubled
    // both on every tick. Fixed 2026-10-02.
    //
    // ⚠️ It would also have been possible for the two copies to DISAGREE, since the file can change
    // between them -- a payload whose dot and whose message came from different reads.
    status,
  };
}

/**
 * The status bar's three server-known indicators (FC-1), derived by the tested pure functions
 * in `src/ui/statusBar.ts` and broadcast with every snapshot.
 *
 * ## ⚠️ Why these are derived here and not in `public/app.js`
 *
 * `app.js` has no tests and is outside the orphan check. **A false green would come from
 * exactly this derivation**, and it matters most on Recording, where green says "your
 * listening is being saved" about the one artefact that cannot be regenerated. The DOM wiring
 * stays in `app.js`; the judgement does not.
 *
 * ## ⚠️ The Connection dot is the exception, and it is the safe one to except
 *
 * Its input is the browser's own socket state, which no server can know, so it is rendered
 * from a small switch in `app.js`. That is acceptable precisely because its failure mode is
 * **visible rather than silent**: a page that has stopped updating is apparent on screen,
 * whereas a Recording dot that is wrongly green looks exactly like one that is rightly green.
 *
 * ## ⚠️ Spotify reads the SNAPSHOT, never a polled `/api/health`
 *
 * `/api/health` does a real MCP round-trip per request; polling it to keep a dot warm would
 * spend rate limit that label resolution needs — the reasoning that stopped the liked badge
 * being polled. The snapshot already carries the error state every tick, at no cost.
 */
interface StatusIndicators {
  recording: Indicator;
  rules: Indicator;
  spotify: Indicator;
  /**
   * FC-U5-1. ⚠️ **A SECOND dot, never a recolouring of `Rules v#`** — that one already maps all four
   * original levels to rules-FILE load health, where red *names the version still in force*.
   * Recolouring it would make red mean either *your rules file is broken* or *a rule matched and the
   * skip failed*, and the user would not know whether to open their rules file or their decision log.
   */
  automation: Indicator;
}

function statusIndicators(snapshot: Snapshot): StatusIndicators {
  return {
    recording: recordingIndicator({
      repositoryOpen: repository === null ? false : true,
      degraded: observer?.stats.degraded ?? false,
      gaps: observer?.stats.gaps ?? 0,
      startupError: historyStartupError,
    }),
    rules: rulesIndicator(
      ruleWatcher === null
        ? { version: null, state: null, activeRules: 0, disabledRules: 0, rejectionErrors: [] }
        : (() => {
            const set = ruleWatcher.current();
            const disabled = set.rules.filter((r) => r.status.state === 'disabled').length;
            return {
              version: set.version,
              state: set.state,
              activeRules: set.rules.length - disabled,
              disabledRules: disabled,
              rejectionErrors: set.rejection?.errors ?? [],
            };
          })(),
    ),
    spotify: spotifyIndicator({
      hasSnapshot: true,
      snapshotError: 'error' in snapshot ? String(snapshot.error) : null,
    }),
    // ⚠️ `inMessage: false` (2026-10-11): the automation dot never takes the red line above the bar — app.js assembles
    // the bar from these, and honours the flag exactly as statusBar() does.
    automation: { ...automationIndicator(automationIndicatorState()), inMessage: false as const },
  };
}

/**
 * FC-U5-1's facts, gathered fresh on every tick.
 *
 * ## ⚠️ The state file is RE-READ here, not cached
 *
 * One small file read every 3 s, against the 1,200 Spotify requests/hour the poll already spends — so
 * the cost is nothing and the alternative is a dot that lags the switch. **The documented worst case for
 * this control is a kill switch that appears to change and does not persist**; an indicator reading
 * cached client-side state would be the same defect one layer up. The drain re-reads at every action
 * point for the same reason.
 *
 * ## ⚠️ `liveRules` counts what could ACT, not what is loaded
 *
 * Active **and** enabled **and** not dry-run (BR-33.2). Ten dry-run rules look busy in `Rules v#` and
 * can skip nothing, and the honest word for that is *off* — which is why this feeds `disabled` rather
 * than `idle`.
 */
function automationIndicatorState(): AutomationIndicatorState {
  const read = automationState.read();
  const set = ruleWatcher?.current() ?? null;
  const liveRules =
    set === null
      ? 0
      : set.rules.filter(
          (loaded) =>
            loaded.status.state === 'active' && loaded.rule.enabled && loaded.rule.dryRun !== true,
        ).length;

  const play = coordinator?.inProgress ?? null;
  const latest = skipAttempts?.latest() ?? null;

  return {
    // ⚠️ `null` only when the rules engine never started — with no repository there is no decision
    // log, no evaluation and no automation, so *unknown* is the honest answer rather than *off*.
    automationEnabled: coordinator === null ? null : read.state.globalAutomationEnabled,
    executorConstructed: SKIP_EXECUTOR_ENABLED,
    halt: read.state.runawayHalt,
    liveRules,
    evaluation:
      play === null
        ? null
        : {
            decided: play.decided,
            decidedOnPartialData: play.decidedOnPartialData,
            holding: play.holding,
          },
    // ⚠️ The LATEST attempt only, and only while FRESH (2026-10-11): a later skip clears it, and so do a few
    // minutes — re-evaluated on every broadcast, so the dot clears without a reload.
    unconfirmedSkipAt: freshUnconfirmedSkip(latest, Date.now()),
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
/**
 * Count this poll, and fetch the track's playback context if it is new. ⚠️ IMPURE, and never throws.
 *
 * ## ⚠️ M4 is recorded on EVERY tick, including the ones that find nothing
 *
 * That is the entire point. *"No new play rows"* cannot distinguish **polling and hearing silence**
 * from **not polling at all** — and the 2026-09-30 outage ran roughly 13 hours unnoticed for exactly
 * that reason. A high idle share with a non-zero total says the instrument is alive and the listener is
 * not listening. A total of zero says the instrument is down.
 *
 * ⚠️ So an early return on `nothing playing` would delete the signal this exists to produce.
 */
function recordPollMetrics(snapshot: Snapshot): void {
  // U7 (P-55, BR-58.3): three outcomes. A Spotify error — including one the MCP server returned as TEXT, now an
  // error snapshot (FR-71) — is neither playing nor idle, and it is an MCP error for M2.
  const outcome = pollOutcomeOf(snapshot);
  const errored = outcome === 'error';
  const playing = outcome === 'playing';

  upstreamMetrics.recordPoll(outcome);
  upstreamMetrics.record('mcp', errored ? 'error' : 'ok', Date.now());

  // BR-41.1: once per TRACK, not once per tick — the cache decides, not this call site. A per-tick
  // fetch would DOUBLE this app's Spotify footprint to collect a value that cannot change within a
  // play. ⚠️ Unawaited: `ensure` never throws, and a failure records `null`, which is *unknown*.
  if (playing && 'trackId' in snapshot && snapshot.trackId) {
    void playbackContext.ensure(snapshot.trackId);
  }
}

function registerEvaluationTick(): void {
  if (coordinator === null) return;
  nowPlaying.on('tick', (snapshot: Snapshot) => {
    recordPollMetrics(snapshot);

    try {
      coordinator!.onTick(toEvaluationSample(snapshot), Date.now());

      // ⚠️ **THE DRAIN'S BACKSTOP, and it is load-bearing rather than belt-and-braces** (P-29). It is
      // what moves an attempt whose scheduled drain was lost — process exit, an unhandled rejection
      // upstream of it — to a terminal state, instead of leaving it `queued` for ever. The drain's own
      // re-entrancy guard is what makes two entry points safe.
      //
      // ⚠️ Inside the try, so a throw lands on the same handler: a failure here must never reach the
      // recorder or the display, exactly as for evaluation.
      void skipDrain?.drain();
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

/**
 * The ONE shutdown path — for a signal, and for a staged restore (U6). ⚠️ A restore reuses it rather than
 * calling `process.exit` itself: the in-progress play must still be flushed as `unknown` and the database
 * closed cleanly, or the swap at the next start would move aside a database with an unflushed WAL.
 * Exits 0; under Docker, `restart: unless-stopped` brings the app back (probed 2026-10-07).
 */
function shutdown(why: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${why}, shutting down.`);
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
  // U7: `close()` now waits for the MCP child to EXIT (P-49) and rejects past its bound — so exit regardless, or a
  // child that will not die would turn a shutdown into a hang. ⚠️ It also adds ~2 s (P-U7-2) to a restart.
  server.close(() => void spotify.close().catch((error: unknown) => console.warn('[shutdown] MCP child:', error)).finally(() => process.exit(0)));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => shutdown(`Received ${signal}`));
}
