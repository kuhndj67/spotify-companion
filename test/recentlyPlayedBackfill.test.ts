/**
 * Recently-played backfill (FR-22, BR-5).
 *
 * ## Why this file exists
 *
 * It did not, until 2026-09-06, and that is exactly how the `played_at` defect survived from U1 to
 * production. `RecentlyPlayedBackfill` had **no tests at all**: the full suite was green, the
 * integration test exercised the observer rather than this, and the bug only became visible as a
 * number on a chart climbing when the user knew it should not have been.
 *
 * The defect: `played_at` is the moment a track **finished**, not when it started. Storing it as
 * `startedAt` put every backfilled row about one track duration late, and — because deduplication
 * compared it against stored *starts* — put a whole track between the two instants being
 * compared, so every play already recorded live looked new and was inserted again on each
 * restart. Four container restarts in one session produced eleven duplicate `unknown` rows.
 *
 * The evidence is not a reading of the documentation, which is silent. Across 41 plays this app
 * had itself observed start and end, `played_at` matched the recorded END with a median error of
 * 3.0 s, and matched a start exactly once — by 177 s, itself about a track length.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RecentlyPlayedBackfill } from '../src/history/RecentlyPlayedBackfill.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { DEFAULT_TOLERANCES, CLASSIFIER_VERSION, summarise } from '../src/history/outcomeClassifier.js';
import type { SpotifyWebApiClient } from '../src/spotify/webApiClient.js';
import type { NewPlayRecord } from '../src/history/types.js';
import { completeTrail } from './historyGenerators.js';

const TRACK_ID = 'abcdefghijklmnopqrstuv';
const DURATION_MS = 180_000;

/** An API returning one fixed recently-played page. */
function fakeApi(items: unknown[]): SpotifyWebApiClient {
  return {
    get: async () => ({ items }),
  } as unknown as SpotifyWebApiClient;
}

function item(playedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    played_at: playedAt,
    track: {
      id: TRACK_ID,
      name: 'A Track',
      duration_ms: DURATION_MS,
      artists: [{ id: 'artist1234567890123456', name: 'An Artist' }],
      album: { name: 'An Album', release_date: '2019-05-17' },
      external_ids: { isrc: 'USUM71703861' },
      ...overrides,
    },
    context: { type: 'playlist' },
  };
}

/** A play as the observer would have recorded it, running 10:00:00 → 10:03:00. */
function livePlay(): NewPlayRecord {
  const trail = completeTrail(DURATION_MS);
  return {
    trackId: TRACK_ID,
    isrc: 'USUM71703861',
    title: 'A Track',
    artistName: 'An Artist',
    artistId: 'artist1234567890123456',
    albumName: 'An Album',
    releaseDate: '2019-05-17',
    ageYears: 7,
    following: true,
    startedAt: '2026-08-25T10:00:00.000Z',
    endedAt: '2026-08-25T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    evidence: summarise(trail, DEFAULT_TOLERANCES),
    provenance: 'live',
    skipSource: null,
    contextType: 'playlist',
    explicit: null,
    albumType: null,
    classifierVersion: CLASSIFIER_VERSION,
  };
}

describe('played_at is the END of the play', () => {
  it('derives startedAt by subtracting the track duration', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    await new RecentlyPlayedBackfill(fakeApi([item('2026-08-25T10:03:00.000Z')]), repo).run();

    const rows = [...repo.listPlays()];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.endedAt, '2026-08-25T10:03:00.000Z');
    assert.equal(rows[0]!.startedAt, '2026-08-25T10:00:00.000Z');
    repo.close();
  });

  it('never stores a row whose start equals its end', () => {
    // The old behaviour: both fields got `played_at`, so every backfilled play had zero span.
    // That is not merely untidy — it is the shape a week-bucketed chart reads as a real event.
    const repo = new SqliteHistoryRepository(':memory:');
    return new RecentlyPlayedBackfill(fakeApi([item('2026-08-25T10:03:00.000Z')]), repo)
      .run()
      .then(() => {
        const row = [...repo.listPlays()][0]!;
        assert.notEqual(row.startedAt, row.endedAt);
        assert.ok(Date.parse(row.startedAt) < Date.parse(row.endedAt));
        repo.close();
      });
  });

  it('does not produce a start after the end when duration is missing or absurd', async () => {
    // A bad duration must degrade to a zero-length row, never to an impossible one.
    for (const duration of [undefined, 0, -5000]) {
      const repo = new SqliteHistoryRepository(':memory:');
      await new RecentlyPlayedBackfill(
        fakeApi([item('2026-08-25T10:03:00.000Z', { duration_ms: duration })]),
        repo,
      ).run();
      const row = [...repo.listPlays()][0]!;
      assert.ok(
        Date.parse(row.startedAt) <= Date.parse(row.endedAt),
        `duration ${String(duration)} produced a start after the end`,
      );
      repo.close();
    }
  });
});

describe('deduplication against plays already recorded', () => {
  it('does NOT re-insert a play the observer already recorded live', async () => {
    // The regression. Live play 10:00:00 → 10:03:00; recently-played reports it as 10:03:00.
    // Matching that against the stored START compared instants three minutes apart, so the row
    // was inserted again — and again on every restart.
    const repo = new SqliteHistoryRepository(':memory:');
    repo.recordPlay(livePlay(), []);

    const report = await new RecentlyPlayedBackfill(
      fakeApi([item('2026-08-25T10:03:02.000Z')]),
      repo,
    ).run();

    assert.equal(report.duplicates, 1);
    assert.equal(report.inserted, 0);
    assert.equal([...repo.listPlays()].length, 1, 'the live play was duplicated');
    repo.close();
  });

  it('is idempotent across repeated runs, which is what a restart is', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const api = fakeApi([item('2026-08-25T10:03:00.000Z')]);

    await new RecentlyPlayedBackfill(api, repo).run();
    await new RecentlyPlayedBackfill(api, repo).run();
    const third = await new RecentlyPlayedBackfill(api, repo).run();

    assert.equal([...repo.listPlays()].length, 1);
    assert.equal(third.duplicates, 1);
    assert.equal(third.inserted, 0);
    repo.close();
  });

  it('still records a genuine repeat play of the same track', async () => {
    // The dedup must not be so eager that listening to a track twice becomes one row. Two plays
    // of a three-minute track end at least three minutes apart, well outside the window.
    const repo = new SqliteHistoryRepository(':memory:');
    await new RecentlyPlayedBackfill(
      fakeApi([item('2026-08-25T10:03:00.000Z'), item('2026-08-25T10:06:05.000Z')]),
      repo,
    ).run();

    assert.equal([...repo.listPlays()].length, 2);
    repo.close();
  });
});

describe('backfilled rows stay honest', () => {
  it('records outcome unknown with no trail, never a completion', async () => {
    // recently-played reports no progress at all. Calling these completions would inflate the
    // completion rate exactly during the periods the app was down — a bias correlated with
    // downtime rather than randomly distributed.
    const repo = new SqliteHistoryRepository(':memory:');
    await new RecentlyPlayedBackfill(fakeApi([item('2026-08-25T10:03:00.000Z')]), repo).run();

    const row = [...repo.listPlays()][0]!;
    assert.equal(row.outcome, 'unknown');
    assert.equal(row.provenance, 'backfilled');
    assert.equal(row.evidence.observationCount, 0);
    assert.equal(row.following, null, 'follow status must not be asserted retroactively');
    assert.deepEqual(repo.getTrail(row.id), []);
    repo.close();
  });

  it('fills every optional field with a default when Spotify omits it', async () => {
    // Not hypothetical: this endpoint has been seen to return items with no `external_ids` at
    // all, which is why backfilled plays carry no ISRC (open item 3). The remaining fields are
    // optional in the same way, and a missing one must become a documented default rather than
    // `undefined` reaching the schema.
    const repo = new SqliteHistoryRepository(':memory:');
    await new RecentlyPlayedBackfill(
      fakeApi([
        {
          played_at: '2026-08-25T10:03:00.000Z',
          track: { id: TRACK_ID, name: 'Bare Track', duration_ms: DURATION_MS },
        },
      ]),
      repo,
    ).run();

    const row = [...repo.listPlays()][0]!;
    assert.equal(row.artistName, '');
    assert.equal(row.artistId, null);
    assert.equal(row.albumName, '');
    assert.equal(row.releaseDate, null);
    assert.equal(row.isrc, null, 'a missing ISRC is null, never an empty string');
    assert.equal(row.contextType, null);
    repo.close();
  });

  it('skips an item with no track or no timestamp instead of writing a partial row', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const report = await new RecentlyPlayedBackfill(
      fakeApi([
        { played_at: '2026-08-25T10:03:00.000Z' },
        { track: { id: TRACK_ID, name: 'No Timestamp', duration_ms: DURATION_MS } },
        { played_at: '2026-08-25T11:03:00.000Z', track: { name: 'No Id', duration_ms: 1000 } },
      ]),
      repo,
    ).run();

    assert.equal(report.fetched, 3);
    assert.equal(report.inserted, 0);
    assert.equal([...repo.listPlays()].length, 0);
    repo.close();
  });

  it('tolerates a response with no items at all', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const report = await new RecentlyPlayedBackfill(fakeApi([]), repo).run();
    assert.equal(report.fetched, 0);
    assert.equal(report.inserted, 0);
    assert.equal(report.error, null);
    repo.close();
  });

  it('reports an upstream failure without throwing', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const failing = {
      get: async () => {
        throw new Error('429 Too Many Requests');
      },
    } as unknown as SpotifyWebApiClient;

    const report = await new RecentlyPlayedBackfill(failing, repo).run();
    assert.match(report.error ?? '', /429/);
    assert.equal(report.inserted, 0);
    repo.close();
  });
});

/**
 * U4 / schema v5 — the two columns the backfill can fill at no extra cost.
 *
 * ⚠️ These exist because the endpoint was believed not to return them. It does: probed live
 * 2026-09-20, HTTP 200, `explicit` and `album.album_type` present on 3/3 items. What made them
 * look absent was this file's own hand-written response type, which declared only
 * `album?: { name, release_date }` — **a field a local type does not declare is
 * indistinguishable from a field the API does not send.**
 */
describe('explicit and album_type are captured from recently-played', () => {
  it('stores both when the endpoint sends them', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const api = fakeApi([
      item('2026-09-20T10:03:00.000Z', {
        explicit: true,
        album: { name: 'An Album', release_date: '2019-05-17', album_type: 'single' },
      }),
    ]);

    await new RecentlyPlayedBackfill(api, repo).run();

    const [row] = repo.listPlays({ limit: 10 });
    assert.equal(row!.explicit, true);
    assert.equal(row!.albumType, 'single');
  });

  it('stores explicit: false as false, distinctly from absent', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const api = fakeApi([
      item('2026-09-20T10:03:00.000Z', {
        explicit: false,
        album: { name: 'An Album', release_date: '2019-05-17', album_type: 'album' },
      }),
    ]);

    await new RecentlyPlayedBackfill(api, repo).run();

    const [row] = repo.listPlays({ limit: 10 });
    // Not null: the endpoint answered, and the answer was "no".
    assert.equal(row!.explicit, false);
  });

  /**
   * ⚠️ The `?? null` that must never become `?? false`. An item that omits `explicit` is
   * unknown, and recording it as "not explicit" is a fabricated fact about a backfilled play —
   * the same error as writing `completed` onto a row with no observation trail.
   */
  it('records an absent field as unknown, never as false or empty', async () => {
    const repo = new SqliteHistoryRepository(':memory:');
    const api = fakeApi([
      item('2026-09-20T10:03:00.000Z', {
        album: { name: 'An Album', release_date: '2019-05-17' },
      }),
    ]);

    await new RecentlyPlayedBackfill(api, repo).run();

    const [row] = repo.listPlays({ limit: 10 });
    assert.equal(row!.explicit, null);
    assert.equal(row!.albumType, null);
  });
});
