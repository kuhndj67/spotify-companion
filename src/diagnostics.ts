/**
 * End-to-end check of the connect / auth / query cycle.
 *
 * Each step runs in order and reports independently, so a failure localises the problem
 * instead of just saying "it doesn't work". Steps that depend on a previous step's output
 * (anything needing a track ID) are reported as "skipped" rather than "failed" when the
 * prerequisite is unavailable — nothing playing is not a fault.
 */

import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import type { RunawayHalt, SkipAttempt } from './playback/types.js';
import type { UpstreamSnapshot } from './playback/upstreamMetrics.js';
import type { SpotifyMcpClient } from './mcp/spotifyMcpClient.js';
import type { SpotifyWebApiClient } from './spotify/webApiClient.js';
import type { EnrichmentService } from './spotify/enrichment.js';

import type { MaintenanceStatus } from './maintenance/MaintenanceService.js';
import { maintenanceDiagnosticSteps } from './maintenance/maintenanceDiagnostics.js';
import { configurationDiagnosticSteps, type ConfigurationDiagnosticsInput } from './configuration/configurationDiagnostics.js';
import { readAppVersion } from './version.js';

export interface DiagnosticStep {
  name: string;
  /** U10 (BR-81.3): `warn` is a risk, not a fault — a run with warnings and no failure is not a failed run. */
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail: string;
  durationMs: number;
}

/**
 * Label coverage (BR-10) — a **measurement**, not a health check.
 *
 * It rides alongside `steps` rather than inside them because the step renderer only speaks
 * ok/fail/skip, and rendering a 58% coverage rate as a green tick would present the instrument R2
 * is measured with as a verdict about system health.
 */
export interface CoverageReport {
  /**
   * ⚠️ **Required, not decorative.** Under BR-13 the same query run twice can legitimately
   * differ, because a previously-`unknown` ISRC may have resolved in between. A coverage figure
   * without a timestamp is not interpretable.
   */
  asOf: string;
  total: number;
  resolved: number;
  /** Queued or in flight — never counted as `unknown` (BR-7.7). */
  pending: number;
  byVerdict: Record<string, number>;
  unknownByReason: Record<string, number>;
  /**
   * The breakdown that keeps R2 visible. Measured: pre-2022 resolved 5/5, 2022-onward 6/14.
   * A single aggregate would hide that the misses concentrate on recent independent releases —
   * exactly the population the hypothesis is about.
   */
  byReleaseYear: { year: string; total: number; resolved: number }[];
}

export interface DiagnosticsReport {
  ranAt: string;
  ok: boolean;
  steps: DiagnosticStep[];
  /** Absent when label enrichment is disabled or history is unavailable. */
  coverage?: CoverageReport;
  /**
   * M1–M4 (U5). Absent when automation is not deployed.
   *
   * ⚠️ **Rides alongside `steps` for the same reason `coverage` does**: these are measurements, and
   * the step renderer only speaks ok/fail/skip. *1,216 Spotify requests in the last hour* is not a
   * green tick or a red cross — Spotify publishes no limit to compare it against, so rendering it as a
   * verdict would assert a judgement the data does not contain.
   *
   * ⚠️ **And no separate route** (Infrastructure Q6). `/api/diagnostics` is already the on-demand
   * sweep; a second endpoint would be a second thing to remember to look at.
   */
  metrics?: UpstreamSnapshot;
}

async function step(
  name: string,
  run: () => Promise<string | null>,
): Promise<DiagnosticStep> {
  const started = performance.now();
  try {
    const detail = await run();
    return detail === null
      ? { name, status: 'skip', detail: 'Skipped — prerequisite unavailable', durationMs: Math.round(performance.now() - started) }
      : { name, status: 'ok', detail, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      name,
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * U10: a step whose level was already decided elsewhere (a pure rule), so diagnostics reports it rather than
 * re-deriving it. `off` and a missing verdict are `skip`.
 */
function leveled(name: string, verdict: { level: 'ok' | 'warn' | 'fail' | 'off'; detail: string } | null): DiagnosticStep {
  if (verdict === null) return { name, status: 'skip', detail: 'Skipped — prerequisite unavailable', durationMs: 0 };
  return { name, status: verdict.level === 'off' ? 'skip' : verdict.level, detail: verdict.detail, durationMs: 0 };
}

/** U1 subsystems, passed in so diagnostics stays usable when history failed to start. */
export interface HistoryDiagnosticsInput {
  repository: {
    schemaVersion: number;
    coverage(): { totalPlays: number; countedGaps: number; unknownIsrc: number };
  } | null;
  observerStats: {
    recorded: number;
    gaps: number;
    degraded: boolean;
    lastRecordedAt: string | null;
  } | null;
  /** U10 (BR-81.2): the scheduler's verdict on automatic backups; `null` when there is no scheduler. */
  backupHealth: { level: 'ok' | 'warn' | 'fail' | 'off'; detail: string } | null;
  /** U10 (FR-82, BR-87.4): the weekly download reminder; `off` is skipped. Optional for callers that predate it. */
  backupReminder?: { level: 'ok' | 'warn' | 'off'; detail: string } | null;
  startupError: string | null;
  dbPath: string;
}

/** U2 subsystems, passed in so diagnostics still works when label enrichment failed to start. */
export interface LabelDiagnosticsInput {
  coverage: CoverageReport | null;
  queueDepth: number;
  queuePaused: boolean;
  likedSetSize: number;
  likedSetAvailable: boolean;
  backfillRunning: boolean;
  startupError: string | null;
  userAgent: string | null;
}

/**
 * U5 subsystems. Passed in for the same reason as the U2 ones — diagnostics must still answer when
 * automation is not deployed, and must say *not deployed* rather than failing.
 */
export interface AutomationDiagnosticsInput {
  /**
   * ⚠️ **Read FRESH at diagnostics time, never cached.** The whole point of this entry is to answer
   * *what will the next action point see*, and a cached copy answers *what did startup see* — which is
   * the question that was already wrong when someone threw the switch.
   */
  state: {
    enabled: boolean;
    halt: RunawayHalt | null;
    /** `file` | `absent` | `unreadable`. ⚠️ Part of the answer, not debug detail. */
    source: string;
    detail?: string;
  };
  /** Is `SkipExecutor` CONSTRUCTED — `SKIP_EXECUTOR_ENABLED`, not the kill switch. */
  executorEnabled: boolean;
  statePath: string;
  /** ⚠️ A probe, not an inference from `compose.yaml`. */
  stateWritable: boolean;
  queue: { depth: number; oldestQueuedAgeMs: number | null };
  /**
   * Attempts that reached the player and were never linked to a play row.
   *
   * ⚠️ **Non-zero means the consecutive halt is UNDER-COUNTING**, because the counter joins on
   * `play_id`. Instrumented rather than designed around — the previous attempt to make that key immune
   * to a missing link broke on an 11–14 ms race instead.
   */
  unlinkedFiredAttempts: number;
  lastAttempt: SkipAttempt | null;
  metrics: UpstreamSnapshot;
}

/**
 * ⚠️ How long a `queued` attempt may sit before this reports a fault.
 *
 * The drain has two entry points and the slower of them is the 3-second poll tick, so 60 s is **20
 * missed ticks** — generous by design. ⚠️ **Arbitrary, and deliberately so**: it is a liveness
 * heuristic for a human reading a diagnostics page, not a pre-registered threshold, and nothing
 * measured depends on its value. Contrast `MAX_UNOBSERVED_TAIL_MS`, which must not be tuned.
 */
const QUEUE_STALE_MS = 60_000;

/**
 * The U5 steps, as their own function so they can be TESTED.
 *
 * ## ⚠️ Why this is extracted rather than inlined like the U2 block
 *
 * `runDiagnostics` reaches for the MCP client, the Web API and the credentials file, so it is one of the
 * three modules this project knowingly leaves untested — `ALLOWED_ORPHANS` records that. Inlining the
 * automation steps would put **the halt banner, the unwritable-`/state` fault and the stale-queue
 * threshold** inside that untested region, which is the `recordSuccessorLag` trap: logic that is live,
 * reachable, and covered by nothing.
 *
 * ⚠️ This function takes **plain data only** — no clients, no clock, no filesystem — so every branch
 * below is reachable from a test. That is the point of the extraction, not tidiness.
 */
export async function automationDiagnosticSteps(
  automation: AutomationDiagnosticsInput,
): Promise<DiagnosticStep[]> {
  const steps: DiagnosticStep[] = [];

  /**
   * ⚠️ **OFF IS NOT A FAULT, and this step must never report one for it.**
   *
   * `globalAutomationEnabled: false` is FR-47's default and the correct state for a fresh install.
   * A red cross here would train the reader to ignore red crosses on the one page where the unit
   * that can cause harm reports itself.
   *
   * ⚠️ `source` is reported in the same breath as the value, because `absent` and `unreadable` both
   * read as *off* and are different facts: the first is correct behaviour, the second is a file this
   * app could not parse — where a switch thrown in the UI would appear to work and not persist.
   */
  steps.push(
    await step('Automation posture', async () => {
      const machinery = automation.executorEnabled
        ? 'SkipExecutor constructed'
        : 'SkipExecutor NOT constructed (SKIP_EXECUTOR_ENABLED unset) — no skip can be issued';
      const switchState = automation.state.enabled ? 'kill switch ON' : 'kill switch off';
      const from = `state read from: ${automation.state.source}`;
      const why = automation.state.detail === undefined ? '' : ` (${automation.state.detail})`;
      return `${machinery} · ${switchState} · ${from}${why}`;
    }),
  );

  /**
   * The halt latch (BR-35).
   *
   * ⚠️ **A standing halt IS a fault, and is reported as one.** It is the system saying it stopped
   * itself, and it clears only on an explicit acknowledgement — so leaving it green would hide the
   * one condition the user is required to act on. The evidence names real attempt ids (BR-35.8).
   */
  steps.push(
    await step('Runaway halt', async () => {
      const halt = automation.state.halt;
      if (halt === null) return 'Not halted';
      throw new Error(
        `HALTED at ${halt.haltedAt} by ${halt.trigger}: observed ${halt.observedCount} against a ` +
          `threshold of ${halt.threshold}. Attempts: ${halt.attemptIds.join(', ')}. ` +
          `Clears only on explicit acknowledgement (BR-35.6).`,
      );
    }),
  );

  /**
   * ⚠️ **Writability is a PROBE, not an inference from `compose.yaml`** — and the answer has to be
   * known *before* the user reaches for the switch, not at the moment they need it.
   *
   * `skip` rather than `fail` when the executor was never constructed: an unwritable `/state` is
   * harmless if nothing can write it, and a red cross for a mount that is not in use yet is noise.
   */
  steps.push(
    await step('Automation state file', async () => {
      if (automation.stateWritable) return `${automation.statePath} · writable`;
      if (!automation.executorEnabled) return null;
      throw new Error(
        `${automation.statePath} is NOT writable. The kill switch would appear to change in the UI ` +
          `and not persist, so automation cannot be armed. Recording is unaffected (NFR-13). ` +
          `Check that ./state is mounted :rw — and verify THROUGH THE CONTAINER, not on the host.`,
      );
    }),
  );

  /**
   * ⚠️ **An attempt stuck in `queued` is the one failure mode a count of rows cannot show.** The
   * drain has two entry points, the slower being the 3 s tick, so a minute in the queue means ~20
   * missed ticks — the drain is not running, and the attempt will neither fire nor close.
   *
   * ⚠️ Depth alone is NOT the signal. A depth of 1 is normal for the second or two between the
   * decision and the `POST`; what matters is how long the oldest one has waited.
   */
  steps.push(
    await step('Skip attempt queue', async () => {
      const { depth, oldestQueuedAgeMs } = automation.queue;
      if (depth === 0) return 'Empty';
      const age = oldestQueuedAgeMs === null ? 'age unknown' : `oldest ${oldestQueuedAgeMs} ms`;
      if (oldestQueuedAgeMs !== null && oldestQueuedAgeMs > QUEUE_STALE_MS) {
        throw new Error(
          `${depth} attempt(s) queued, ${age} — past ${QUEUE_STALE_MS} ms. The drain appears not to ` +
            `be running: it is called from the 3 s tick as well as on enqueue, so an attempt this ` +
            `old has survived ~${Math.round(oldestQueuedAgeMs / 3000)} ticks.`,
        );
      }
      return `${depth} queued · ${age}`;
    }),
  );

  /**
   * ⚠️ **The state that would quietly weaken the runaway halt.**
   *
   * `recentPlaysForCounting` joins `skip_attempt` on `play_id`, so an attempt that reached the player and
   * was never linked is invisible to the consecutive count — and a halt that under-counts is a halt that
   * does not fire. `attachPlayId` runs inside a try/catch, so this is reachable.
   *
   * ⚠️ Instrumented rather than designed around: the previous attempt to make the key immune to a
   * missing link broke on an 11–14 ms race instead. A visible failure beats a clever key.
   */
  steps.push(
    await step('Skip attempts linked to plays', async () => {
      if (automation.unlinkedFiredAttempts === 0) return 'All issued skips are linked to a play row';
      throw new Error(
        `${automation.unlinkedFiredAttempts} issued skip(s) have no play_id. The consecutive halt counts ` +
          `through that link, so it is UNDER-COUNTING by that many. Check the ` +
          `'[automation] could not link' lines in the container log.`,
      );
    }),
  );

  /**
   * ⚠️ **Reports the last attempt in ANY state, including `refused`.**
   *
   * A "last attempt" that showed only the ones that fired would answer *when did automation last
   * act* while appearing to answer *is automation working* — and those diverge in exactly the case
   * worth seeing: a rule matching repeatedly and being refused every time, which from the outside
   * looks identical to no matches at all.
   *
   * ⚠️ **Never a fault.** Most refusals ARE the system working — `automation-off` is the default,
   * `already-attempted` is the loop guard, `no-active-device` is the listener pressing stop. A red
   * cross on any of those would be the opposite of informative.
   */
  steps.push(
    await step('Last skip attempt', async () => {
      const last = automation.lastAttempt;
      if (last === null) return 'None recorded';
      const why = last.refusedReason === null ? '' : ` (${last.refusedReason})`;
      const playRow = last.playId === null ? 'play row not yet linked' : `play ${last.playId}`;
      return `#${last.id} ${last.state}${why} · rule ${last.ruleId} · ${last.enqueuedAt} · ${playRow}`;
    }),
  );

  return steps;
}

export async function runDiagnostics(
  mcp: SpotifyMcpClient,
  api: SpotifyWebApiClient,
  enrichment: EnrichmentService,
  history?: HistoryDiagnosticsInput,
  labels?: LabelDiagnosticsInput,
  automation?: AutomationDiagnosticsInput,
  maintenance?: MaintenanceStatus,
  configuration?: ConfigurationDiagnosticsInput,
): Promise<DiagnosticsReport> {
  const steps: DiagnosticStep[] = [];
  let trackId: string | null = null;
  let artistId: string | null = null;

  // Paths differ between host and container, and a mismatch is the most likely cause of
  // "not found" failures below — so state which mode is active before anything else runs.
  steps.push(
    await step('Environment', async () =>
      `${config.inContainer ? 'Container' : 'Host'} · MCP: ${config.mcpServerEntrypoint}`,
    ),
  );

  // U8 (frontend-components §2, BR-66.6): BOTH versions, each labelled, so they cannot be confused. The app version
  // says which code this is; the schema version says whether this database can be opened. Neither derives the other.
  steps.push(
    await step('Version', async () => {
      const schema = history?.repository ? `v${history.repository.schemaVersion}` : 'unknown (history not running)';
      return `App version ${readAppVersion()} · Database schema ${schema}`;
    }),
  );

  // --- Credentials -------------------------------------------------------
  steps.push(
    await step('Credentials file', async () => {
      let raw: string;
      try {
        raw = await readFile(config.spotifyConfigPath, 'utf8');
      } catch {
        throw new Error(
          `Not found at ${config.spotifyConfigPath}. Run \`npm run auth\` to create it.`,
        );
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${config.spotifyConfigPath} is not valid JSON. Re-run \`npm run auth\`.`);
      }

      const missing = ['clientId', 'clientSecret', 'refreshToken'].filter((k) => !parsed[k]);
      if (missing.length) {
        throw new Error(`Missing field(s): ${missing.join(', ')}. Re-run \`npm run auth\`.`);
      }
      return `Found at ${config.spotifyConfigPath}`;
    }),
  );

  // --- Auth --------------------------------------------------------------
  steps.push(
    await step('Spotify auth (token refresh)', async () => {
      const token = await api.getAccessToken();
      return `Access token acquired (${token.slice(0, 6)}…)`;
    }),
  );

  // --- Basic query -------------------------------------------------------
  steps.push(
    await step('Web API query (GET /me)', async () => {
      const me = await api.get<{ display_name?: string; id: string }>('/me');
      if (!me) throw new Error('Empty response from /me');
      return `Authenticated as ${me.display_name ?? me.id}`;
    }),
  );

  // --- MCP link ----------------------------------------------------------
  steps.push(
    await step('MCP server connect', async () => {
      try {
        const tools = await mcp.listToolNames();
        return `${tools.length} tools available`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A spawn failure means the build simply isn't there — say so, rather than
        // surfacing a raw ENOENT that points at the node binary.
        if (/ENOENT|Connection closed/i.test(message) && !config.inContainer) {
          throw new Error(
            `Could not start the MCP server at ${config.mcpServerEntrypoint}. ` +
              'Run `npm run mcp:setup` to build it for host use.',
          );
        }
        throw error;
      }
    }),
  );

  steps.push(
    await step('MCP getNowPlaying', async () => {
      const nowPlaying = await mcp.getNowPlaying();
      if (!nowPlaying) return 'Connected — nothing currently playing';
      trackId = nowPlaying.trackId;
      return `"${nowPlaying.track}" by ${nowPlaying.artist}`;
    }),
  );

  // --- Enrichment chain --------------------------------------------------
  steps.push(
    await step('Track lookup (GET /tracks/{id})', async () => {
      if (!trackId) return null;
      const track = await api.get<{
        name: string;
        album: { release_date: string; images?: { url: string; width: number | null }[] };
        artists: { id: string; name: string }[];
      }>(`/tracks/${trackId}`);
      if (!track) throw new Error('Track not found');
      artistId = track.artists?.[0]?.id ?? null;
      const art = track.album?.images?.length
        ? `${track.album.images.length} art size(s)`
        : 'no album art';
      return `${track.name} — released ${track.album?.release_date ?? 'unknown'} · ${art}`;
    }),
  );

  steps.push(
    await step('Followed artists (GET /me/following)', async () => {
      const count = await enrichment.followedArtistCount();
      return `${count} followed artist(s) cached for local lookup`;
    }),
  );

  steps.push(
    await step('Follow status for current artist', async () => {
      if (!artistId) return null;
      const result = await enrichment.fetch(trackId!);
      if (result.following === null) throw new Error('Follow status could not be resolved');
      return result.following ? 'You follow this artist' : 'You do not follow this artist';
    }),
  );

  steps.push(
    await step('Full enrichment chain', async () => {
      if (!trackId) return null;
      const result = await enrichment.fetch(trackId);
      if (result.warnings.length) throw new Error(result.warnings.join('; '));
      return `Released ${result.releaseDate ?? '?'} · age ${result.ageYears ?? '?'}y · following=${result.following}`;
    }),
  );

  // -- U1: listening history --------------------------------------------------
  // History is optional to the app's core function, so a missing database reports `skip`
  // rather than `fail` — the same convention the rest of this report uses. Only an active
  // fault (degraded recording, a failed snapshot) is a failure.
  if (history) {
    steps.push(
      await step('Database', async () => {
        if (!history.repository) {
          if (history.startupError) throw new Error(history.startupError);
          return null;
        }
        return `${history.dbPath} · schema v${history.repository.schemaVersion}`;
      }),
    );

    steps.push(
      await step('Listening history', async () => {
        if (!history.repository || !history.observerStats) return null;
        const coverage = history.repository.coverage();
        if (history.observerStats.degraded) {
          throw new Error(
            `Recording degraded — ${history.observerStats.gaps} gap(s) counted. Display unaffected.`,
          );
        }
        return (
          `${coverage.totalPlays} play(s) recorded · ` +
          `last ${history.observerStats.lastRecordedAt ?? 'none yet'} · ` +
          `${coverage.unknownIsrc} without ISRC · ${coverage.countedGaps} gap(s)`
        );
      }),
    );

    // U10 (BR-81.2, FR-80): was *Snapshots*, which said `ok` for "scheduled; none written yet" for 18 days.
    steps.push(leveled('Backups', history.backupHealth));
    steps.push(leveled('Copy elsewhere', history.backupReminder ?? null));
  }

  // -- U2: label enrichment ---------------------------------------------------
  //
  // Label enrichment is optional to everything else: with MusicBrainz entirely unreachable the
  // display, recording and export are unaffected and only the label column is missing. So a
  // disabled or unavailable subsystem reports `skip`, and only an active fault is a failure.
  if (labels) {
    steps.push(
      await step('MusicBrainz identity (NFR-14)', async () => {
        if (labels.startupError) throw new Error(labels.startupError);
        if (labels.userAgent === null) return null;
        return `User-Agent: ${labels.userAgent}`;
      }),
    );

    steps.push(
      await step('Label request queue', async () => {
        if (labels.userAgent === null) return null;
        if (labels.queuePaused) {
          throw new Error(
            `Paused after repeated 503s. ${labels.queueDepth} request(s) waiting; ` +
              'lookups are delayed, not failed.',
          );
        }
        return `${labels.queueDepth} queued · 1 req/sec · ${labels.backfillRunning ? 'backfill running' : 'idle'}`;
      }),
    );

    steps.push(
      await step('Saved tracks (liked status)', async () => {
        if (!labels.likedSetAvailable) {
          // Not a failure: liked status degrades to `unknown`, which is a recorded value
          // rather than a fabricated `false`.
          return null;
        }
        return `${labels.likedSetSize} saved track(s) cached for local lookup`;
      }),
    );
  }

  // --- U5: automated skipping --------------------------------------------
  //
  // ⚠️ Extracted so the halt banner, the unwritable-`/state` fault and the stale-queue threshold are
  // reachable from a test — this function is not.
  if (automation !== undefined) {
    steps.push(...(await automationDiagnosticSteps(automation)));
  }

  // --- U6: backup and restore ---------------------------------------------
  //
  // ⚠️ Extracted and pure for the same reason as U5's: decided here, nothing could test it.
  if (maintenance !== undefined) steps.push(...maintenanceDiagnosticSteps(maintenance));

  // --- U7: configuration (IN-U7-6) ------------------------------------------
  if (configuration !== undefined) steps.push(...configurationDiagnosticSteps(configuration));

  return {
    ranAt: new Date().toISOString(),
    ok: steps.every((s) => s.status !== 'fail'),
    steps,
    ...(labels?.coverage ? { coverage: labels.coverage } : {}),
    ...(automation ? { metrics: automation.metrics } : {}),
  };
}
