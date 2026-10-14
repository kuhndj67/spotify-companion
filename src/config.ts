/**
 * Runtime configuration, read from the environment.
 *
 * Reflects the answered requirements: WebSocket push (Q5), localhost-only access (Q7),
 * minimal-but-enforced local security (Q9).
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Defaults differ between the container and a host `npm start`, and getting this wrong
 * produces confusing "credentials not found" errors, so it is detected rather than assumed.
 *
 * Note the MCP server resolves its own spotify-config.json relative to its *script location*
 * (`__dirname/../spotify-config.json`), not the working directory — so the file must sit at
 * the root of the MCP server's own directory. compose.yaml mounts it there; on the host,
 * `npm run mcp:setup` places a copy there.
 */
const CONTAINER_MCP_DIR = '/opt/spotify-mcp';
const inContainer = existsSync(CONTAINER_MCP_DIR);
const mcpDir = inContainer ? CONTAINER_MCP_DIR : join(projectRoot, '.mcp-server');

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  /** Port the web app listens on. */
  port: int('PORT', 3000),

  /**
   * Bind interface. Inside a container this must be 0.0.0.0 to receive published traffic;
   * compose.yaml publishes only to 127.0.0.1 on the host, and the loopback guard below
   * rejects anything that still arrives from off-box. Outside a container, default to
   * loopback so `npm start` is never exposed by accident.
   */
  host: process.env.HOST ?? '127.0.0.1',

  /** Path to the built spotify-mcp-server entrypoint that we spawn over stdio. */
  mcpServerEntrypoint:
    process.env.MCP_SERVER_ENTRYPOINT ?? join(mcpDir, 'build', 'index.js'),

  /** Working directory for the spawned MCP server process. */
  mcpServerCwd: process.env.MCP_SERVER_CWD ?? mcpDir,

  /**
   * The credential file this app reads. In the container it is the same file the MCP server
   * uses (mounted). On the host it is `secrets/spotify-config.json`, the canonical output of
   * `npm run auth`, while the MCP server gets its own copy under `.mcp-server/`.
   *
   * Divergence between the two copies is harmless: this app only ever reads clientId,
   * clientSecret and refreshToken, none of which change when an access token is refreshed.
   */
  spotifyConfigPath:
    process.env.SPOTIFY_CONFIG_PATH ??
    (inContainer
      ? join(CONTAINER_MCP_DIR, 'spotify-config.json')
      : join(projectRoot, 'secrets', 'spotify-config.json')),

  /** True when running inside the container image. Surfaced in diagnostics. */
  inContainer,

  /**
   * How often the backend asks the MCP server for the current track. The browser no longer
   * polls at all — this is the only thing that drives load against Spotify, regardless of
   * how many tabs are open.
   */
  pollIntervalMs: int('POLL_INTERVAL_MS', 3000),

  /**
   * Reject requests that did not originate from this machine (Q7/Q9). Kept deliberately
   * simple: a loopback check on the socket address, plus Host/Origin validation to blunt
   * DNS-rebinding. Disable only for deliberate LAN exposure.
   */
  localOnly: process.env.LOCAL_ONLY !== 'false',

  /**
   * Skip the peer-address check while keeping Host/Origin validation (open item 1, option B,
   * chosen by the user 2026-09-05). Set only in `compose.yaml`.
   *
   * ⚠️ Defaults to **false**, and is deliberately NOT inferred from `inContainer`. Enabling it
   * must be a visible deployment decision, not something that switches on silently depending on
   * where the process happens to be running. See `localGuard.ts` for why the peer check is inert
   * inside a container.
   */
  trustPublishedPort: process.env.TRUST_PUBLISHED_PORT === 'true',

  // -- U1: listening history --------------------------------------------------

  /**
   * Where the listening-history database lives (NFR-11).
   *
   * In the container this is a bind-mounted directory so a rebuild never destroys history; on
   * the host it defaults to `./data/`. The *directory* is mounted, not the file — SQLite's
   * `-wal` and `-shm` siblings must live beside the database or crash recovery breaks. Copying
   * the single-file `secrets/` mount pattern here would be a subtle and hard-to-diagnose
   * mistake.
   */
  historyDbPath: process.env.HISTORY_DB_PATH ?? join(projectRoot, 'data', 'history.db'),

  /** Set false to run without recording. The display works either way. */
  historyEnabled: process.env.HISTORY_ENABLED !== 'false',

  /**
   * Ratio at or above which a play counts as completed (U1 Functional Design Q1 + Q5).
   *
   * The ratio is *listened time* over duration, so it can exceed 1.0 when a track is replayed.
   * Changing this does not rewrite existing verdicts — stored trails allow reclassification, so
   * a change can be applied retroactively rather than only going forward.
   */
  completionThreshold: Number.parseFloat(process.env.COMPLETION_THRESHOLD ?? '0.90'),

  /** Slack for progress jitter between polls; also bounds the forward-step cap. */
  jitterToleranceMs: int('JITTER_TOLERANCE_MS', 1500),

  /**
   * Classifier v2. Largest unobserved tail (`duration - maxProgress`) that still counts as a
   * completion on a `track-change` close, in milliseconds.
   *
   * ⚠️ Milliseconds rather than a ratio on purpose — a proportional threshold over a
   * constant-time effect misfiles short tracks. Derivation in `outcomeClassifier`.
   * Like `completionThreshold`, changing this does not rewrite stored verdicts; trails allow
   * retroactive reclassification.
   */
  maxUnobservedTailMs: int('MAX_UNOBSERVED_TAIL_MS', 55_000),

  /** Classifier v2. Sanity rail on the rule above; only bites below ~110 s of duration. */
  minObservedPositionRatio: Number.parseFloat(process.env.MIN_OBSERVED_POSITION_RATIO ?? '0.75'),

  /**
   * The zone every calendar bucket — chart weeks and report days/weeks/months — is computed in.
   *
   * ⚠️ **Configuration, never read from the system clock.** `Intl` would happily default to the
   * host zone, and then the same play would bucket differently on two machines with every test
   * still passing. `reporting/timeBuckets.ts` therefore has no default and `purity.test.ts`
   * rejects the system-zone reads.
   *
   * ⚠️ Changing it **restates history**: 63% of this corpus's plays fall between 23:00Z and
   * 04:00Z, so a zone change moves ~49% of plays across a day boundary and ~3% across a week
   * boundary. Charts read before and after a change are not directly comparable.
   */
  reportTimeZone: process.env.REPORT_TIME_ZONE ?? 'America/New_York',

  // -- U1: export and snapshots (FR-56) ---------------------------------------

  snapshotDir: process.env.SNAPSHOT_DIR ?? join(projectRoot, 'data', 'snapshots'),
  snapshotIntervalHours: int('SNAPSHOT_INTERVAL_HOURS', 24),
  snapshotKeep: int('SNAPSHOT_KEEP', 14),
  snapshotsEnabled: process.env.SNAPSHOTS_ENABLED !== 'false',

  // -- U2: label enrichment ---------------------------------------------------

  /** Set false to run without MusicBrainz entirely. Display and recording are unaffected. */
  labelsEnabled: process.env.LABELS_ENABLED !== 'false',

  /**
   * Where the NFR-14 contact address lives.
   *
   * A separate file from `spotify-config.json`, and deliberately so: that file is written by
   * `npm run auth` and **rewritten by the MCP server on every token refresh**, so a hand-added
   * field there would be clobbered by a process we do not control — silently, and only
   * sometimes.
   *
   * `secrets/` is already gitignored and already mounted into the container, which is why it
   * beat a second `.env` convention: one place to check before publishing rather than two.
   */
  musicbrainzConfigPath:
    process.env.MUSICBRAINZ_CONFIG_PATH ??
    (inContainer
      ? '/app/secrets/musicbrainz.json'
      : join(projectRoot, 'secrets', 'musicbrainz.json')),

  /** Overridable so BR-1.2's regression test can point at a fixture stub. */
  musicbrainzBaseUrl: process.env.MUSICBRAINZ_BASE_URL ?? 'https://musicbrainz.org/ws/2',

  /**
   * TTLs are **measurement parameters** and belong beside `completionThreshold` — they shape
   * what the dataset contains, and R2 guarantees they need revisiting once there is real
   * coverage data.
   *
   * The two differ because they answer different questions: an `unknown` is re-tried because
   * MusicBrainz's *completeness* changes, a success because the underlying *fact* can change.
   * Without the second, the version chain could only ever record `unknown → known` and never
   * `independent → major`, which is the case it exists for.
   */
  labelTtlUnknownDays: int('LABEL_TTL_UNKNOWN_DAYS', 30),
  labelTtlResolvedDays: int('LABEL_TTL_RESOLVED_DAYS', 90),

  labelBackfillIntervalHours: int('LABEL_BACKFILL_INTERVAL_HOURS', 6),
  labelBackfillBatch: int('LABEL_BACKFILL_BATCH', 25),

  /** How long after a play closes to re-check for a late like (BR-9.3). */
  likedGraceMs: int('LIKED_GRACE_MS', 30_000),
  likedRefreshMinutes: int('LIKED_REFRESH_MINUTES', 15),

  // NOTE: the MusicBrainz request spacing (1 req/sec, NFR-15) and the retry policy are NOT
  // settings. There is no legitimate value other than one per second, so a knob here would
  // exist only to violate the policy -- most likely while debugging, and then forgotten.
} as const;

/** The `User-Agent` contact details MusicBrainz policy requires (NFR-14). */
export interface MusicBrainzIdentity {
  contact: string;
  appName: string;
  appVersion: string;
}

/**
 * Load the MusicBrainz identity, **failing closed**.
 *
 * There is no anonymous fallback. NFR-14 compliance is a choice this project made deliberately,
 * and sending unidentified traffic while believing we are compliant is worse than refusing to
 * start — it is the kind of wrong that looks fine from the inside.
 *
 * Returns `null` only when labels are disabled outright, which is an explicit choice rather than
 * an accident.
 *
 * `appVersion` comes from `src/version.ts` (U8, BR-66.2). A legacy `appVersion` field in the file is **ignored**:
 * a per-install copy is a version no release can reach.
 */
export function loadMusicBrainzIdentity(
  readFileSync: (path: string) => string,
  appVersion: string,
): MusicBrainzIdentity {
  let raw: string;
  try {
    raw = readFileSync(config.musicbrainzConfigPath);
  } catch {
    throw new Error(
      `MusicBrainz contact details not found at ${config.musicbrainzConfigPath}. ` +
        'Copy secrets/musicbrainz.example.json and fill in a contact address — ' +
        'MusicBrainz policy (NFR-14) requires requests to identify themselves. ' +
        'Set LABELS_ENABLED=false to run without label enrichment.',
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${config.musicbrainzConfigPath} is not valid JSON.`);
  }

  const checked = validateMusicBrainzContact(parsed.contact);
  if (!checked.ok) {
    throw new Error(`${config.musicbrainzConfigPath} needs a real "contact" address. ${checked.message}`);
  }

  return {
    contact: checked.contact,
    appName: typeof parsed.appName === 'string' ? parsed.appName : 'SpotifyNowPlaying',
    appVersion,
  };
}

/**
 * Is this a usable MusicBrainz contact? (NFR-14, BR-57.2)
 *
 * ⚠️ **The ONE copy of this rule** — used at startup by `loadMusicBrainzIdentity` and by U7's Settings save
 * (`CredentialsWriter`). A second copy is how the two would come to disagree, so that Settings accepts a contact
 * the app then refuses to start with.
 */
export function validateMusicBrainzContact(
  raw: unknown,
): { readonly ok: true; readonly contact: string } | { readonly ok: false; readonly message: string } {
  const contact = typeof raw === 'string' ? raw.trim() : '';
  if (contact === '') return { ok: false, message: 'MusicBrainz policy requires a way to reach whoever is making the requests.' };
  if (contact.includes('example.com')) return { ok: false, message: 'That is the placeholder from the example file — enter your own contact.' };
  return { ok: true, contact };
}

/** The header MusicBrainz asks for: application, version, and a way to reach us. */
export function userAgentFrom(identity: MusicBrainzIdentity): string {
  return `${identity.appName}/${identity.appVersion} ( ${identity.contact} )`;
}
