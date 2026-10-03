/**
 * The HTTP API (`src/api.ts`).
 *
 * ## Why this file exists
 *
 * Until 2026-09-06 these nine routes had **no tests at all**, and the suite reported 98.96% line
 * coverage while they did. That figure was not wrong about what it measured — it simply could not
 * see them: V8 coverage only reports modules a test actually loads, and nothing could load
 * `server.ts` because importing it connects to the MCP server, opens SQLite, starts the poll loop
 * and calls `listen()`. A file no test imports is missing from the *denominator*, not counted as
 * zero, so the untested code could not drag the number down. The same denominator trap this
 * project has met twice before, wearing a reassuring number.
 *
 * It is also the file with the worst defect history here — the WebSocket `403` that left the UI
 * on "Disconnected — reconnecting…" for the life of a deployment passed all 411 tests.
 *
 * These run over **real HTTP** on an ephemeral port rather than by calling handlers directly.
 * Handler-level tests would have missed that defect too: it was a wiring bug, not a logic one.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApi, type ApiDeps } from '../src/api.js';
import { validateRuleSet } from '../src/rules/ruleValidator.js';
import type { DecisionLogRepository } from '../src/rules/DecisionLogRepository.js';
import type { DateRange, DecisionLogEntry, LoadedRule, LoadedRuleSet } from '../src/rules/types.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { ExportService } from '../src/export/ExportService.js';
import { DEFAULT_TOLERANCES, CLASSIFIER_VERSION, summarise } from '../src/history/outcomeClassifier.js';
import type { NewPlayRecord } from '../src/history/types.js';
import { completeTrail } from './historyGenerators.js';

/**
 * `Response.json()` is typed `unknown` by design — the runtime cannot know the shape. These
 * tests assert against shapes the routes themselves define, so naming that here beats scattering
 * casts through every assertion.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const TRACK = 'abcdefghijklmnopqrstuv';
const ARTIST = 'artist1234567890123456';
/** Wednesday. The trend window must end on the Monday of this week, 2026-09-02. */
const NOW = '2026-09-02T12:00:00.000Z';

function play(overrides: Partial<NewPlayRecord> = {}): NewPlayRecord {
  return {
    trackId: TRACK,
    isrc: 'USUM71703861',
    title: 'A Track',
    artistName: 'An Artist',
    artistId: ARTIST,
    albumName: 'An Album',
    releaseDate: '2019-05-17',
    ageYears: 7,
    following: true,
    startedAt: '2026-09-01T10:00:00.000Z',
    endedAt: '2026-09-01T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    evidence: summarise(completeTrail(180_000), DEFAULT_TOLERANCES),
    provenance: 'live',
    skipSource: null,
    contextType: 'playlist',
    contextUri: null,
    explicit: null,
    albumType: null,
    successorLagMs: null,
    classifierVersion: CLASSIFIER_VERSION,
    ...overrides,
  };
}

/** A server carrying one set of deps, torn down after the suite. */
function serve(overrides: Partial<ApiDeps> = {}) {
  const deps: ApiDeps = {
    repository: null,
    historyStartupError: null,
    exportService: null,
    likedSet: null,
    labelStartupError: null,
    observerStats: null,
    nowPlaying: { current: { playing: false } as never },
    listToolNames: async () => ['a', 'b'],
    diagnostics: async () => ({ ok: true, steps: [] }) as never,
    likedFor: () => undefined,
    // U4. Null by default: every route must degrade to 503 rather than throw when the rules
    // engine is not running, and that is the state most of these tests exercise.
    ruleSet: null,
    decisionLog: null,
    backTest: null,
    reloadRules: null,
    now: () => NOW,
    reportTimeZone: 'America/New_York',
    ...overrides,
  };

  const app = express();
  app.use(createApi(deps));
  const server = createServer(app);
  return server;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('history is unavailable — every route degrades, none throws', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = serve({ historyStartupError: 'disk is read-only' });
    base = await listen(server);
  });
  after(() => close(server));

  // NFR-13: U0 worked before history existed and must keep working when history is broken.
  for (const path of [
    '/api/history/coverage',
    '/api/history/recent',
    '/api/history/stats?trackId=x',
    '/api/explain/1',
    '/api/history/export?format=csv',
  ]) {
    it(`${path} answers 503, not 500`, async () => {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 503);
      const body: Body = await response.json();
      assert.match(String(body.error), /unavailable/i);
    });
  }

  it('names the startup error rather than hiding it', async () => {
    const body: Body = await (await fetch(`${base}/api/history/coverage`)).json();
    assert.equal(body.detail, 'disk is read-only');
  });

  it('/api/liked/refresh is 503 when the saved-track set never loaded', async () => {
    const response = await fetch(`${base}/api/liked/refresh`, { method: 'POST' });
    assert.equal(response.status, 503);
  });
});

describe('/api/now-playing', () => {
  it('passes a snapshot through as 200', async () => {
    const server = serve({
      nowPlaying: { current: { playing: true, trackId: TRACK } as never },
    });
    const base = await listen(server);
    const response = await fetch(`${base}/api/now-playing`);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as Body).trackId, TRACK);
    await close(server);
  });

  it('reports an upstream failure as 502, not 200 with an error body', async () => {
    const server = serve({
      nowPlaying: { current: { error: 'Could not reach the MCP server.' } as never },
    });
    const base = await listen(server);
    const response = await fetch(`${base}/api/now-playing`);
    assert.equal(response.status, 502);
    await close(server);
  });
});

describe('/api/health — a real MCP round-trip is what actually breaks', () => {
  it('is 200 with a tool count when MCP answers', async () => {
    const server = serve({ listToolNames: async () => ['one', 'two', 'three'] });
    const base = await listen(server);
    const body: Body = await (await fetch(`${base}/api/health`)).json();
    assert.equal(body.status, 'ok');
    assert.equal(body.toolCount, 3);
    await close(server);
  });

  it('is 503 and degraded when MCP does not', async () => {
    const server = serve({
      listToolNames: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const base = await listen(server);
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 503);
    const body: Body = await response.json();
    assert.equal(body.mcp, 'disconnected');
    assert.match(body.detail, /ECONNREFUSED/);
    await close(server);
  });
});

describe('/api/diagnostics', () => {
  it('maps a failing sweep onto 503', async () => {
    const server = serve({ diagnostics: async () => ({ ok: false }) as never });
    const base = await listen(server);
    assert.equal((await fetch(`${base}/api/diagnostics`)).status, 503);
    await close(server);
  });
});

describe('/api/history/stats', () => {
  let repository: SqliteHistoryRepository;
  let server: Server;
  let base: string;

  before(async () => {
    repository = new SqliteHistoryRepository(':memory:');
    repository.recordPlay(play({ startedAt: '2026-08-20T10:00:00.000Z' }), []);
    repository.recordPlay(play({ startedAt: '2026-09-01T10:00:00.000Z', outcome: 'skipped' }), []);
    repository.recordPlay(
      play({ startedAt: '2026-09-01T11:00:00.000Z', provenance: 'backfilled', outcome: 'unknown' }),
      [],
    );
    server = serve({ repository, observerStats: null });
    base = await listen(server);
  });
  after(async () => {
    await close(server);
    repository.close();
  });

  it('refuses a request naming neither a track nor an artist', async () => {
    const response = await fetch(`${base}/api/history/stats`);
    assert.equal(response.status, 400);
  });

  it('answers the two halves independently', async () => {
    const trackOnly: Body = await (await fetch(`${base}/api/history/stats?trackId=${TRACK}`)).json();
    assert.equal(trackOnly.artist, null);
    assert.equal(trackOnly.track.totalPlays, 3);

    // A track with no artist id still gets its count — Spotify does not always supply one.
    const artistOnly: Body = await (await fetch(`${base}/api/history/stats?artistId=${ARTIST}`)).json();
    assert.equal(artistOnly.track, null);
    assert.equal(artistOnly.artist.playsInWindow, 3);
  });

  it('separates "the app was off" from "the app could not tell"', async () => {
    // The fixture holds one completed, one skipped, and one BACKFILLED play. The backfilled row
    // must land in `not-observed`, never in `inconclusive`: it came from recently-played, which
    // reports no progress, so nothing about it was ever measured.
    const body: Body = await (await fetch(`${base}/api/history/stats?trackId=${TRACK}`)).json();
    assert.deepEqual(body.track.byBucket, {
      completed: 1,
      skipped: 1,
      inconclusive: 0,
      'not-observed': 1,
    });
  });

  it('reports the same split on the weekly buckets', async () => {
    const body: Body = await (await fetch(`${base}/api/history/stats?artistId=${ARTIST}`)).json();
    const totals = body.artist.weeks.reduce(
      (sum: Record<string, number>, week: Body) => {
        for (const [key, value] of Object.entries(week.byBucket)) {
          sum[key] = (sum[key] ?? 0) + (value as number);
        }
        return sum;
      },
      {} as Record<string, number>,
    );
    assert.equal(totals['not-observed'], 1);
    assert.equal(totals.inconclusive, 0);
    assert.equal(totals.completed, 1);
  });

  it('ends the window on the week containing now', async () => {
    // The payoff of injecting the clock: NOW is a Wednesday, so the last bucket must be the
    // Monday of that week. With an ambient clock this assertion could not exist.
    const body: Body = await (await fetch(`${base}/api/history/stats?artistId=${ARTIST}`)).json();
    assert.equal(body.artist.window.end, '2026-08-31');
    assert.equal(body.artist.weeks.at(-1).weekStart, '2026-08-31');
  });

  it('reports capped=false when the axis stops at the corpus, not at the limit', async () => {
    // These are different facts and the caption depends on telling them apart: "all history"
    // versus "last 26 weeks". The corpus starts 2026-08-20, well inside the cap.
    const body: Body = await (await fetch(`${base}/api/history/stats?artistId=${ARTIST}`)).json();
    assert.equal(body.artist.window.capped, false);
    assert.equal(body.artist.window.start, '2026-08-17');
    assert.equal(body.artist.weeks.length, 3);
  });

  it('reports capped=true and exactly 26 weeks once the corpus outruns the cap', async () => {
    const old = new SqliteHistoryRepository(':memory:');
    old.recordPlay(play({ startedAt: '2025-01-06T10:00:00.000Z' }), []);
    const s = serve({ repository: old });
    const b = await listen(s);

    const body: Body = await (await fetch(`${b}/api/history/stats?artistId=${ARTIST}`)).json();
    assert.equal(body.artist.window.capped, true);
    assert.equal(body.artist.weeks.length, 26);
    await close(s);
    old.close();
  });

  it('returns zeros for an unheard track rather than 404', async () => {
    const body: Body = await (await fetch(`${base}/api/history/stats?trackId=neverheardaaaaaaaaaaa`)).json();
    assert.equal(body.track.totalPlays, 0);
    assert.equal(body.track.firstPlayedAt, null);
  });

  it('rejects an absurdly long id instead of querying with it', async () => {
    const response = await fetch(`${base}/api/history/stats?trackId=${'x'.repeat(200)}`);
    assert.equal(response.status, 400);
  });

  it('stamps asOf, because these counts move', async () => {
    const body: Body = await (await fetch(`${base}/api/history/stats?trackId=${TRACK}`)).json();
    assert.equal(body.asOf, NOW);
  });
});

describe('/api/liked/refresh', () => {
  function fakeLikedSet(overrides: Record<string, unknown> = {}) {
    return {
      refresh: async () => {},
      isLiked: () => true,
      addedAt: () => '2026-09-01T00:00:00Z',
      loadedAt: Date.parse(NOW),
      size: 42,
      available: true,
      ...overrides,
    } as never;
  }

  it('returns the status for the named track', async () => {
    const server = serve({
      likedSet: fakeLikedSet(),
      likedFor: () => ({ isLiked: true, addedAt: '2026-09-01T00:00:00Z', asOf: NOW }),
    });
    const base = await listen(server);
    const body: Body = await (await fetch(`${base}/api/liked/refresh?trackId=${TRACK}`, { method: 'POST' })).json();
    assert.equal(body.liked.isLiked, true);
    assert.equal(body.size, 42);
    await close(server);
  });

  it('returns null for liked when no track is named, never false', async () => {
    // `null` is "not asked"; `false` would be an observed answer. They must not collapse.
    const server = serve({ likedSet: fakeLikedSet() });
    const base = await listen(server);
    const body: Body = await (await fetch(`${base}/api/liked/refresh`, { method: 'POST' })).json();
    assert.equal(body.liked, null);
    await close(server);
  });

  it('still answers with the set it holds when the refresh itself fails', async () => {
    // A failed refresh means the answer is older than hoped, not that it is unknown. Blanking
    // the badge would turn a stale truth into a false negative.
    const server = serve({
      likedSet: fakeLikedSet({
        refresh: async () => {
          throw new Error('429 Too Many Requests');
        },
      }),
      likedFor: () => ({ isLiked: true, addedAt: null, asOf: NOW }),
    });
    const base = await listen(server);
    const response = await fetch(`${base}/api/liked/refresh?trackId=${TRACK}`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as Body).liked.isLiked, true);
    await close(server);
  });
});

describe('/api/explain/:playId', () => {
  let repository: SqliteHistoryRepository;
  let server: Server;
  let base: string;

  before(async () => {
    repository = new SqliteHistoryRepository(':memory:');
    repository.recordPlay(play(), []);
    server = serve({ repository });
    base = await listen(server);
  });
  after(async () => {
    await close(server);
    repository.close();
  });

  it('rejects a non-integer id', async () => {
    assert.equal((await fetch(`${base}/api/explain/not-a-number`)).status, 400);
  });

  it('is 404 for a play that does not exist', async () => {
    assert.equal((await fetch(`${base}/api/explain/9999`)).status, 404);
  });

  /**
   * ⚠️ There used to be an `artist` trace beside this one, and its absence is the assertion.
   *
   * It derived a label verdict from `browse /release?artist=`, which returns every release the
   * artist appears on including ones they only feature on — 109 of Bad Bunny's 201 official
   * releases are other people's records. The trace explained that derivation rigorously, which
   * made a wrong question look like a careful answer.
   */
  it('traces the release level, and only the release level', async () => {
    const body: Body = await (await fetch(`${base}/api/explain/1`)).json();
    assert.ok(body.release, 'release level missing');
    assert.equal(body.artist, undefined, 'the artist-level trace was removed with its verdict');
    assert.equal(body.play.id, 1);
  });
});

describe('/api/history/export', () => {
  let repository: SqliteHistoryRepository;
  let server: Server;
  let base: string;

  before(async () => {
    repository = new SqliteHistoryRepository(':memory:');
    repository.recordPlay(play(), []);
    server = serve({ repository, exportService: new ExportService(repository) });
    base = await listen(server);
  });
  after(async () => {
    await close(server);
    repository.close();
  });

  it('validates the format BEFORE the first byte, while there is still a status code', async () => {
    const response = await fetch(`${base}/api/history/export?format=xml`);
    assert.equal(response.status, 400);
  });

  it('streams CSV as an attachment', async () => {
    const response = await fetch(`${base}/api/history/export?format=csv`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename=/);
    assert.match(await response.text(), /A Track/);
  });
});

describe('/api/history/coverage', () => {
  it('merges the observer counters into the repository counts', async () => {
    const repository = new SqliteHistoryRepository(':memory:');
    repository.recordPlay(play(), []);
    const server = serve({
      repository,
      observerStats: {
        recorded: 7,
        gaps: 1,
        degraded: false,
        lastRecordedAt: NOW,
        inProgressTrackId: null,
      },
    });
    const base = await listen(server);

    const body: Body = await (await fetch(`${base}/api/history/coverage`)).json();
    assert.equal(body.totalPlays, 1);
    assert.equal(body.recorded, 7);
    assert.equal(body.gaps, 1);
    await close(server);
    repository.close();
  });
});

// ---------------------------------------------------------------------------
// U4 — rule observability routes
// ---------------------------------------------------------------------------

/**
 * ⚠️ The routes in this section exist in `api.ts` rather than `server.ts` for the reason the
 * file header gives: nine routes at zero coverage while the suite reported 98.96%, because a
 * module no test loads is absent from the coverage DENOMINATOR rather than counted as zero.
 * These are the first U4 routes, and they are tested from the start.
 */

function loadedRuleSet(overrides: Partial<LoadedRuleSet> = {}): LoadedRuleSet {
  const parsed = validateRuleSet({
    rules: [
      {
        id: 'skip-majors',
        name: 'Skip majors',
        enabled: true,
        action: 'skip',
        onUnknown: 'no-match',
        predicate: { kind: 'compare', field: 'label.classification', op: 'eq', value: 'major' },
      },
      {
        // ⚠️ This rule used `onUnknown: 'hold'` to be DISABLED until 2026-10-02, when FR-33 completed
        // and `hold` began loading ACTIVE. The test below needs a genuinely disabled rule, so the
        // cause changed to an unknown field — the DisabledReason migration 004 made real.
        //
        // ✅ That FR-33 landed without any rule file changing is the point of BR-18.6: `hold` was
        // stored-and-disabled rather than refused precisely so this would be free.
        id: 'held',
        name: 'Held rule',
        enabled: true,
        action: 'skip',
        onUnknown: 'no-match',
        predicate: { kind: 'compare', field: 'artist.labelVerdict', op: 'eq', value: 'major' },
      },
    ],
  });
  assert.ok(parsed.ok);

  return {
    version: 6,
    contentHash: 'set-hash-6',
    loadedAt: '2026-09-20T10:00:00.000Z',
    rules: parsed.value,
    state: 'applied',
    rejection: null,
    ...overrides,
  };
}

function decisionRow(overrides: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
  return {
    id: 1,
    evaluationId: 'ev-1',
    decidedAt: '2026-09-20T10:00:00.000Z',
    playId: null,
    playLink: 'pending',
    trackId: 'track-1',
    ruleId: 'skip-majors',
    ruleName: 'Skip majors',
    ruleHash: 'rule-hash',
    verdict: 'true',
    matched: true,
    fieldsSeen: { 'label.classification': 'major', 'artist.genres': null },
    unknownFields: ['artist.genres'],
    restedOnUnknown: false,
    partialData: false,
    dryRun: true,
    executed: false,
    error: null,
    engineVersion: 1,
    ruleSetVersion: 6,
    ruleSetContentHash: 'set-hash-6',
    trigger: 'initial',
    ...overrides,
  };
}

function stubLog(rows: DecisionLogEntry[]): DecisionLogRepository {
  return {
    record: () => {},
    attachPlayId: () => {},
    markLinkFailed: () => {},
    list: () => rows,
    countSince: () => rows.length,
    count: () => rows.length,
    // U5. Unused here: only the drain pulls the latest decision, for BR-37.5 cancellation.
    latestForEvaluationAndRule: () => null,
    pruneToCap: () => 0,
  };
}

describe('the rules engine is not running — every U4 route degrades, none throws', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = serve();
    base = await listen(server);
  });
  after(() => close(server));

  for (const [method, path] of [
    ['GET', '/api/rules'],
    ['GET', '/api/decisions'],
    ['POST', '/api/backtest'],
    ['POST', '/api/rules/reload'],
  ] as const) {
    it(`${method} ${path} answers 503 rather than throwing`, async () => {
      const response = await fetch(`${base}${path}`, {
        method,
        ...(method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, body: '{}' }
          : {}),
      });

      assert.equal(response.status, 503);
      const body = (await response.json()) as Body;
      assert.ok(typeof body.error === 'string' && body.error.length > 0, 'and it says why');
    });
  }
});

describe('GET /api/rules', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = serve({ ruleSet: () => loadedRuleSet() });
    base = await listen(server);
  });
  after(() => close(server));

  it('names the running version and its content hash', async () => {
    const body = (await (await fetch(`${base}/api/rules`)).json()) as Body;

    assert.equal(body.version, 6);
    // ⚠️ The version resets to 1 on restart, so the hash is what identifies the set over time.
    assert.equal(body.contentHash, 'set-hash-6');
    assert.equal(body.state, 'applied');
  });

  /**
   * ⚠️ A disabled rule must say WHY, in words. A rule that silently does nothing is
   * indistinguishable from a rule that does not match — which is exactly the case someone would
   * otherwise read as broken. ⚠️ The fixture's disabling cause changed when FR-33 completed; the
   * property under test did not.
   */
  it('reports each rule status, including the reason a rule is disabled', async () => {
    const body = (await (await fetch(`${base}/api/rules`)).json()) as Body;

    const held = (body.rules as Body[]).find((r) => r.id === 'held')!;
    assert.equal(held.status.state, 'disabled');
    assert.ok(typeof held.status.detail === 'string' && held.status.detail.length > 0);
  });
});

describe('GET /api/rules — a rejected reload', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = serve({
      ruleSet: () =>
        loadedRuleSet({
          state: 'rejected',
          rejection: {
            attemptedAt: '2026-09-20T10:05:00.000Z',
            errors: ["rule 'skip majors' references unknown field 'album.kind'"],
          },
        }),
    });
    base = await listen(server);
  });
  after(() => close(server));

  /**
   * ⚠️ FQ5. A red light that only says "something failed" leaves exactly the ambiguity the
   * indicator exists to remove, and a silent last-known-good is indistinguishable from a
   * successful reload.
   */
  it('reports the rejection AND the version still in force', async () => {
    const body = (await (await fetch(`${base}/api/rules`)).json()) as Body;

    assert.equal(body.state, 'rejected');
    assert.equal(body.version, 6, 'the running version must be nameable');
    assert.match(String(body.rejection.errors[0]), /album\.kind/);
  });
});

describe('GET /api/decisions', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = serve({
      decisionLog: stubLog([
        decisionRow({ id: 2, ruleId: 'skip-majors', matched: true }),
        decisionRow({ id: 1, ruleId: 'held', matched: false, verdict: 'unknown' }),
      ]),
    });
    base = await listen(server);
  });
  after(() => close(server));

  it('returns the rows of a decision', async () => {
    const body = (await (await fetch(`${base}/api/decisions`)).json()) as Body;

    assert.equal((body.rows as unknown[]).length, 2);
  });

  /** One row per rule evaluated, grouped into one trace per decision (BR-23.1, BR-32). */
  it('groups the rows into a trace, rendered from those same rows', async () => {
    const body = (await (await fetch(`${base}/api/decisions`)).json()) as Body;

    assert.equal((body.traces as unknown[]).length, 1, 'both rows share one evaluationId');
    assert.equal((body.traces as Body[])[0]!.rules.length, 2);
  });

  it('renders a field that read null as the token unknown, never blank', async () => {
    const body = (await (await fetch(`${base}/api/decisions`)).json()) as Body;

    const fields = (body.traces as Body[])[0]!.rules[0].fields as Body[];
    const genres = fields.find((f) => f.name === 'artist.genres')!;
    assert.equal(genres.display, 'unknown');
  });
});

describe('POST /api/backtest', () => {
  let server: Server;
  let base: string;

  before(async () => {
    server = serve({
      ruleSet: () => loadedRuleSet(),
      backTest: {
        run: (loaded: LoadedRule, range: DateRange) =>
          ({
            ruleId: loaded.rule.id,
            range,
            truncated: false,
          }) as never,
      } as never,
    });
    base = await listen(server);
  });
  after(() => close(server));

  it('runs the named rule over the range', async () => {
    const response = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ruleId: 'skip-majors',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as Body;
    assert.equal(body.ruleId, 'skip-majors');
    assert.equal(body.truncated, false, 'required, never optional');
  });

  it('refuses a request missing its range rather than inventing one', async () => {
    const response = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ruleId: 'skip-majors' }),
    });

    assert.equal(response.status, 400);
  });

  it('404s for a rule that is not loaded, rather than silently testing nothing', async () => {
    const response = await fetch(`${base}/api/backtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ruleId: 'no-such-rule',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    });

    assert.equal(response.status, 404);
  });
});

describe('POST /api/rules/reload', () => {
  it('reports the outcome and the version in force after a rejected reload', async () => {
    let reloaded = false;
    const server = serve({
      ruleSet: () =>
        loadedRuleSet({
          state: 'rejected',
          rejection: { attemptedAt: '2026-09-20T10:05:00.000Z', errors: ['invalid JSON'] },
        }),
      reloadRules: async () => {
        reloaded = true;
        return { kind: 'failed', errors: ['invalid JSON'] };
      },
    });
    const base = await listen(server);

    try {
      const response = await fetch(`${base}/api/rules/reload`, { method: 'POST' });

      // ⚠️ 200: the REQUEST succeeded. The rule set's state is the answer, not an HTTP error —
      // and the body names the version still running.
      assert.equal(response.status, 200);
      const body = (await response.json()) as Body;
      assert.equal(body.outcome, 'failed');
      assert.equal(body.state, 'rejected');
      assert.equal(body.version, 6);
      assert.ok(reloaded);
    } finally {
      await close(server);
    }
  });
});
