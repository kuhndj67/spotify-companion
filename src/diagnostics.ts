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
import type { SpotifyMcpClient } from './mcp/spotifyMcpClient.js';
import type { SpotifyWebApiClient } from './spotify/webApiClient.js';
import type { EnrichmentService } from './spotify/enrichment.js';

export interface DiagnosticStep {
  name: string;
  status: 'ok' | 'fail' | 'skip';
  detail: string;
  durationMs: number;
}

export interface DiagnosticsReport {
  ranAt: string;
  ok: boolean;
  steps: DiagnosticStep[];
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
  snapshotStatus: {
    lastRunAt: string | null;
    lastRowCount: number | null;
    lastError: string | null;
  } | null;
  startupError: string | null;
  dbPath: string;
}

export async function runDiagnostics(
  mcp: SpotifyMcpClient,
  api: SpotifyWebApiClient,
  enrichment: EnrichmentService,
  history?: HistoryDiagnosticsInput,
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

    steps.push(
      await step('Snapshots', async () => {
        if (!history.snapshotStatus) return null;
        if (history.snapshotStatus.lastError) throw new Error(history.snapshotStatus.lastError);
        return history.snapshotStatus.lastRunAt
          ? `last ${history.snapshotStatus.lastRunAt} · ${history.snapshotStatus.lastRowCount} row(s)`
          : 'scheduled; none written yet';
      }),
    );
  }

  return {
    ranAt: new Date().toISOString(),
    ok: steps.every((s) => s.status !== 'fail'),
    steps,
  };
}
