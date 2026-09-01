/**
 * Enrichment service, cache TTL policy, and the backfill sweep.
 *
 * The properties that matter here are the ones that protect the *dataset* rather than the code:
 * backfill must never revise a play's recorded verdict, and the TTL must be capable of recording a
 * label that actually changed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { LabelCache } from '../src/musicbrainz/LabelCache.js';
import { LabelBackfillJob } from '../src/musicbrainz/LabelBackfillJob.js';
import { LabelEnrichmentService } from '../src/musicbrainz/LabelEnrichmentService.js';
import { MusicBrainzClient } from '../src/musicbrainz/MusicBrainzClient.js';
import { RequestQueue } from '../src/musicbrainz/RequestQueue.js';
import type { NewPlayRecord } from '../src/history/types.js';

function instantQueue(): RequestQueue {
  let now = 0;
  return new RequestQueue({
    minIntervalMs: 0,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
}

function stubFetch(handler: (url: URL) => { status?: number; body?: unknown }) {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const { status = 200, body } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

/** Responds with one release carrying the given label. */
function labelledFetch(labelName: string, labelType: string | null = 'Imprint') {
  return stubFetch((url) => {
    if (url.pathname.includes('/isrc/')) return { body: { recordings: [{ id: 'rec-1' }] } };
    if (url.pathname.endsWith('/release')) {
      return {
        body: {
          releases: [
            {
              id: 'r1',
              title: 'An Album',
              date: '2022-03-14',
              status: 'Official',
              'label-info': [{ label: { id: 'l1', name: labelName, type: labelType } }],
            },
          ],
        },
      };
    }
    if (url.pathname.endsWith('/url')) return { body: { relations: [] } };
    return { status: 404 };
  });
}

function makeStack(fetchImpl: typeof fetch, now = '2026-08-31T00:00:00.000Z') {
  const repository = new SqliteHistoryRepository(':memory:');
  const client = new MusicBrainzClient({
    queue: instantQueue(),
    userAgent: 'SpotifyNowPlaying/0.1 ( test@example.com )',
    baseUrl: 'https://stub.invalid/ws/2',
    fetchImpl,
    // Retry is exercised, but its backoff costs no wall-clock time here.
    sleep: async () => undefined,
  });
  const cache = new LabelCache({ repository });
  const enrichment = new LabelEnrichmentService({ client, cache, now: () => now });
  return { repository, cache, enrichment, client };
}

function play(over: Partial<NewPlayRecord> = {}): NewPlayRecord {
  return {
    trackId: 'track-1',
    isrc: 'USUM71903783',
    title: 'A Song',
    artistName: 'An Artist',
    artistId: 'artist-1',
    albumName: 'An Album',
    releaseDate: '2022-03-14',
    ageYears: 4,
    following: true,
    startedAt: '2026-08-31T10:00:00.000Z',
    endedAt: '2026-08-31T10:03:00.000Z',
    outcome: 'completed',
    closeReason: 'track-change',
    provenance: 'live',
    skipSource: null,
    contextType: 'playlist',
    classifierVersion: 1,
    evidence: {
      listenedMs: 180_000,
      durationMs: 180_000,
      completionRatio: 1,
      maxProgressMs: 180_000,
      maxObservationGapMs: 3_000,
      observationCount: 60,
      sawPause: false,
      rewound: false,
      endedWithIdle: false,
    },
    ...over,
  };
}

describe('the enrichment service resolves and stores a version', () => {
  it('appends a resolution and returns it', async () => {
    const { repository, enrichment } = makeStack(labelledFetch('Atlantic'));

    const resolution = await enrichment.resolveRelease({
      isrc: 'USUM71903783',
      artistName: 'An Artist',
      artistId: 'artist-1',
      albumName: 'An Album',
      releaseDate: '2022-03-14',
      title: 'A Song',
    });

    assert.equal(resolution?.status, 'resolved');
    assert.equal(resolution?.candidates[0]?.labelName, 'Atlantic');
    assert.equal(repository.getCurrentLabelResolution('USUM71903783')?.id, resolution?.id);
    repository.close();
  });

  it('serves a fresh resolution from the cache without a request', async () => {
    let requests = 0;
    const counting = stubFetch((url) => {
      requests += 1;
      if (url.pathname.includes('/isrc/')) return { body: { recordings: [{ id: 'rec-1' }] } };
      return { body: { releases: [] } };
    });

    const { repository, enrichment } = makeStack(counting);
    const track = {
      isrc: 'USUM71903783',
      artistName: 'A',
      artistId: null,
      albumName: 'An Album',
      releaseDate: null,
      title: 'T',
    };

    await enrichment.resolveRelease(track);
    const after = requests;
    await enrichment.resolveRelease(track);

    assert.equal(requests, after, 'a fresh cache entry must not cost a request (FR-14)');
    repository.close();
  });

  it('records a transport failure as error, not as not-found', async () => {
    // Both read as `unknown`, but one is a finding about MusicBrainz's catalogue and the other
    // about the network on a Tuesday. Folding them together fills the coverage gap with noise.
    const failing = stubFetch(() => ({ status: 500 }));
    const { repository, enrichment } = makeStack(failing);

    const resolution = await enrichment.resolveRelease({
      isrc: 'USUM71903783',
      artistName: 'A',
      artistId: null,
      albumName: null,
      releaseDate: null,
      title: 'T',
    });

    assert.equal(resolution?.status, 'error');

    // ⚠️ The snapshot is null, and that is the point. The play snapshot is immutable once
    // written (BR-8.4a), so recording `unknown / error` would let ONE NETWORK BLIP permanently
    // mark a play unresolvable -- it would never re-enter the backfill work set, because that
    // set is "plays with no verdict". A transport failure is not an answer.
    //
    // Found by running the real system against an unreachable endpoint: 21 plays were written
    // as `unknown / error` in a single sweep, every one of them permanently.
    assert.equal(enrichment.toSnapshot(resolution, 'USUM71903783'), null);
    repository.close();
  });

  it('records a genuine 404 as not-found', async () => {
    const missing = stubFetch(() => ({ status: 404 }));
    const { repository, enrichment } = makeStack(missing);

    const resolution = await enrichment.resolveRelease({
      isrc: 'QZXXX2312345',
      artistName: 'A',
      artistId: null,
      albumName: null,
      releaseDate: null,
      title: 'T',
    });

    assert.equal(resolution?.status, 'not-found');
    repository.close();
  });

  it('returns null without any request when the track has no ISRC', async () => {
    let requests = 0;
    const counting = stubFetch(() => {
      requests += 1;
      return { body: {} };
    });
    const { repository, enrichment } = makeStack(counting);

    const resolution = await enrichment.resolveRelease({
      isrc: null,
      artistName: 'A',
      artistId: null,
      albumName: null,
      releaseDate: null,
      title: 'T',
    });

    assert.equal(resolution, null);
    assert.equal(requests, 0);
    // No ISRC IS an answer -- there is nothing to look up and never will be, so unlike a
    // transport failure this is safely recorded as a permanent verdict.
    assert.equal(enrichment.toSnapshot(null, null)?.unknownReason, 'noIsrc');
    repository.close();
  });
});

describe('TTL policy (P-3)', () => {
  const repository = () => new SqliteHistoryRepository(':memory:');

  it('treats a recent resolved row as fresh', () => {
    const store = repository();
    const cache = new LabelCache({ repository: store, unknownTtlDays: 30, resolvedTtlDays: 90 });
    assert.equal(
      cache.isFresh({ resolvedAt: '2026-08-01T00:00:00.000Z', status: 'resolved' }, '2026-08-31T00:00:00.000Z'),
      true,
    );
    store.close();
  });

  it('expires an unknown sooner than a success', () => {
    // MusicBrainz's completeness changes faster than the underlying fact does, and the misses
    // are recency-biased toward exactly the music the hypothesis is about.
    const store = repository();
    const cache = new LabelCache({ repository: store, unknownTtlDays: 30, resolvedTtlDays: 90 });
    const at = '2026-08-31T00:00:00.000Z';
    const sixtyDaysAgo = '2026-07-02T00:00:00.000Z';

    assert.equal(cache.isFresh({ resolvedAt: sixtyDaysAgo, status: 'not-found' }, at), false);
    assert.equal(cache.isFresh({ resolvedAt: sixtyDaysAgo, status: 'resolved' }, at), true);
    store.close();
  });

  it('never treats an error as fresh', () => {
    // An `error` is a fact about the network, not an answer. Caching it would let one transient
    // failure suppress every retry for the whole 30-day unknown TTL -- and the LIVE path
    // consults isFresh directly, so it never reaches the SQL sweep that would have caught it.
    const store = repository();
    const cache = new LabelCache({ repository: store, unknownTtlDays: 30, resolvedTtlDays: 90 });
    assert.equal(
      cache.isFresh(
        { resolvedAt: '2026-08-31T00:00:00.000Z', status: 'error' },
        '2026-08-31T00:00:01.000Z',
      ),
      false,
      'one second old and already stale, because it is not an answer',
    );
    store.close();
  });

  it('eventually expires a success too, which is what makes the chain useful', () => {
    // Without this the version chain could only ever record unknown -> known, never
    // independent -> major, which is the case it exists for.
    const store = repository();
    const cache = new LabelCache({ repository: store, unknownTtlDays: 30, resolvedTtlDays: 90 });
    assert.equal(
      cache.isFresh({ resolvedAt: '2026-01-01T00:00:00.000Z', status: 'resolved' }, '2026-08-31T00:00:00.000Z'),
      false,
    );
    store.close();
  });
});

describe('backfill', () => {
  it('fills in a play that had no verdict', async () => {
    const { repository, cache, enrichment } = makeStack(labelledFetch('Sub Pop'));
    const playId = repository.recordPlay(play(), []);

    const job = new LabelBackfillJob({ repository, cache, enrichment, api: null });
    const report = await job.runOnce();

    assert.equal(report.labelsResolved, 1);
    assert.equal(repository.listPlaysNeedingLabels(10).length, 0);
    assert.ok(playId > 0);
    repository.close();
  });

  it('never revises a verdict already recorded (BR-8.4a)', async () => {
    // This is the property the whole versioning design exists to protect. A later resolution
    // appends a version; what was believed at the time of the play stands.
    const { repository, cache, enrichment } = makeStack(labelledFetch('Atlantic'));
    const playId = repository.recordPlay(play(), []);

    repository.applyLabelSnapshot(playId, {
      verdict: 'independent',
      confidence: 'high',
      contested: false,
      labelNames: ['Never Too Different'],
      matchMethod: 'isrc',
      narrowingTier: 'title-date',
      unknownReason: null,
      resolutionId: null,
      classifierVersion: 1,
    });

    const job = new LabelBackfillJob({ repository, cache, enrichment, api: null });
    await job.runOnce();

    const coverage = repository.labelCoverage('2026-08-31T12:00:00.000Z');
    assert.equal(coverage.byVerdict.independent, 1, 'the as-of-play verdict must stand');
    assert.equal(coverage.byVerdict.major, 0);
    repository.close();
  });

  it('is idempotent — a second sweep finds nothing left to do', async () => {
    const { repository, cache, enrichment } = makeStack(labelledFetch('Sub Pop'));
    repository.recordPlay(play(), []);

    const job = new LabelBackfillJob({ repository, cache, enrichment, api: null });
    const first = await job.runOnce();
    const second = await job.runOnce();

    assert.equal(first.labelsResolved, 1);
    assert.equal(second.labelsResolved, 0);
    repository.close();
  });

  it('keeps going when one play fails persistently', async () => {
    // A failure leaves the row in the work set, which is exactly what P-5's derived queue is
    // for — the sweep must not stall on it.
    //
    // The failure has to be PERSISTENT to exercise this now: the client retries transient
    // failures three times (P-4), so a single 500 is recovered rather than recorded. That is
    // the behaviour a live run demanded — 6 of 19 real tracks took a 503 on one pass.
    const flaky = stubFetch((url) => {
      if (url.searchParams.get('query') === null && url.pathname.includes('ISRC00000001')) {
        return { status: 500 };
      }
      if (url.pathname.includes('/isrc/')) return { body: { recordings: [{ id: 'rec-1' }] } };
      if (url.pathname.endsWith('/release')) return { body: { releases: [] } };
      return { body: { relations: [] } };
    });

    const { repository, cache, enrichment } = makeStack(flaky);
    repository.recordPlay(play({ trackId: 'a', isrc: 'ISRC00000001' }), []);
    repository.recordPlay(
      play({
        trackId: 'b',
        isrc: 'ISRC00000002',
        startedAt: '2026-08-31T11:00:00.000Z',
        endedAt: '2026-08-31T11:03:00.000Z',
      }),
      [],
    );

    const job = new LabelBackfillJob({ repository, cache, enrichment, api: null });
    const report = await job.runOnce();

    // One succeeded; the one that hit a transport failure is deliberately left `pending`.
    assert.equal(report.labelsResolved, 1);
    assert.ok(report.errors >= 1);
    assert.equal(
      repository.listPlaysNeedingLabels(10).length,
      1,
      'the failed play stays in the work set so the next sweep retries it',
    );

    // `errors` is not asserted exactly, and the reason is worth recording. This stack pins the
    // enrichment clock, so the stale-sweep's re-resolution lands on the SAME `resolved_at` as
    // the first attempt and trips UNIQUE(isrc, resolved_at) -- BR-8.6's idempotence guard doing
    // exactly its job. Real timestamps advance, so the collision cannot happen in production;
    // the job counts it as an error and keeps going either way, which is the property that
    // matters here.
    repository.close();
  });

  it('retries an errored resolution on the next sweep, not in 30 days', async () => {
    // Three statuses, three lifetimes. `error` is a fact about the network on a Tuesday, so
    // making it wait out the 30-day `unknown` TTL would treat a transport blip as a finding
    // about MusicBrainz's catalogue -- exactly the confusion BR-10.2 exists to prevent.
    const store = new SqliteHistoryRepository(':memory:');
    store.insertLabelResolution({
      isrc: 'ISRC00000001',
      recordingMbid: null,
      matchMethod: 'none',
      narrowingTier: 'none',
      releaseCount: 0,
      resolvedAt: '2026-08-31T00:00:00.000Z',
      status: 'error',
      candidates: [],
      votes: [],
    });

    // One minute later: far inside every TTL, and still stale because it errored.
    const stale = store.listStaleLabelResolutions('2026-08-31T00:01:00.000Z', 30, 90, 10);
    assert.equal(stale.length, 1);
    assert.equal(stale[0]?.status, 'error');
    store.close();
  });

  it('does not run two sweeps concurrently', async () => {
    // A scheduled sweep must not overlap the startup one; two sweeps would double the rate
    // against the single queue's budget.
    const { repository, cache, enrichment } = makeStack(labelledFetch('Sub Pop'));
    repository.recordPlay(play(), []);

    const job = new LabelBackfillJob({ repository, cache, enrichment, api: null });
    const [first, second] = await Promise.all([job.runOnce(), job.runOnce()]);

    assert.equal(first.labelsResolved + second.labelsResolved, 1, 'the work is done exactly once');
    repository.close();
  });
});
