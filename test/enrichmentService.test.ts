/**
 * Tests for EnrichmentService — caching, deduplication, the followed-artists workaround,
 * and partial-failure behaviour.
 *
 * The Web API client is stubbed, so these exercise orchestration rather than I/O. The
 * followed-artists pagination matters: it exists because GET /me/following/contains is 403
 * in Development Mode, so it is load-bearing rather than an optimisation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EnrichmentService } from '../src/spotify/enrichment.js';
import type { SpotifyWebApiClient } from '../src/spotify/webApiClient.js';

interface StubOptions {
  track?: unknown;
  followedPages?: { items: { id: string }[]; next: string | null; after?: string }[];
  failOn?: (path: string) => Error | null;
}

/** Records every path requested, so call counts can be asserted. */
function stubApi(options: StubOptions = {}) {
  const requests: string[] = [];
  let followPage = 0;

  const api = {
    async get(path: string, params?: Record<string, string>) {
      requests.push(path);

      const failure = options.failOn?.(path);
      if (failure) throw failure;

      if (path.startsWith('/tracks/')) {
        return options.track === undefined ? defaultTrack() : options.track;
      }

      if (path === '/me/following') {
        const pages = options.followedPages ?? [
          { items: [{ id: 'artist-1' }], next: null },
        ];
        const page = pages[followPage] ?? { items: [], next: null };
        followPage++;
        return {
          artists: {
            items: page.items,
            next: page.next,
            cursors: { after: page.after },
          },
        };
      }

      return null;
    },
  };

  return { api: api as unknown as SpotifyWebApiClient, requests };
}

function defaultTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: 'track-1',
    name: 'Test Track',
    track_number: 3,
    duration_ms: 200_000,
    explicit: true,
    artists: [{ id: 'artist-1', name: 'Test Artist' }],
    album: {
      id: 'album-1',
      name: 'Test Album',
      album_type: 'album',
      release_date: '2020-06-15',
      release_date_precision: 'day',
      total_tracks: 12,
      images: [
        { url: 'https://i.scdn.co/image/big', width: 640, height: 640 },
        { url: 'https://i.scdn.co/image/mid', width: 300, height: 300 },
      ],
    },
    external_urls: { spotify: 'https://open.spotify.com/track/track-1' },
    ...overrides,
  };
}

describe('EnrichmentService', () => {
  it('builds a complete enrichment from one track lookup', async () => {
    const { api } = stubApi();
    const result = await new EnrichmentService(api).fetch('track-1');

    assert.equal(result.releaseDate, '2020-06-15');
    assert.equal(result.releaseYear, 2020);
    assert.ok((result.ageYears ?? 0) >= 5);
    assert.equal(result.albumType, 'album');
    assert.equal(result.totalTracks, 12);
    assert.equal(result.trackNumber, 3);
    assert.equal(result.explicit, true);
    assert.equal(result.primaryArtistId, 'artist-1');
    assert.equal(result.primaryArtistName, 'Test Artist');
    assert.equal(result.art?.full, 'https://i.scdn.co/image/big');
    assert.deepEqual(result.warnings, []);
  });

  // Genres are gone from the Development Mode API; the UI needs to explain that rather
  // than render a bare dash.
  it('reports genres as unavailable with a reason', async () => {
    const { api, requests } = stubApi();
    const result = await new EnrichmentService(api).fetch('track-1');

    assert.deepEqual(result.genres, []);
    assert.match(result.genresUnavailableReason ?? '', /Development Mode/);
    // The artist endpoint returns no genres, so it must not be called at all.
    assert.equal(
      requests.some((path) => path.startsWith('/artists/')),
      false,
      'should not call the artist endpoint',
    );
  });

  it('resolves follow status from the followed list, not /following/contains', async () => {
    const { api, requests } = stubApi();
    const result = await new EnrichmentService(api).fetch('track-1');

    assert.equal(result.following, true);
    assert.equal(
      requests.some((path) => path.includes('contains')),
      false,
      'must not call the 403-returning contains endpoint',
    );
  });

  it('reports false when the artist is not followed', async () => {
    const { api } = stubApi({ followedPages: [{ items: [{ id: 'someone-else' }], next: null }] });
    const result = await new EnrichmentService(api).fetch('track-1');
    assert.equal(result.following, false);
  });

  it('follows the cursor across multiple pages of followed artists', async () => {
    const { api, requests } = stubApi({
      followedPages: [
        { items: [{ id: 'a' }], next: 'more', after: 'cursor-1' },
        { items: [{ id: 'b' }], next: 'more', after: 'cursor-2' },
        { items: [{ id: 'artist-1' }], next: null },
      ],
    });

    const service = new EnrichmentService(api);
    assert.equal(await service.followedArtistCount(), 3);
    assert.equal(requests.filter((p) => p === '/me/following').length, 3);
  });

  it('stops paginating when the cursor is missing, rather than looping forever', async () => {
    // next says "more" but no cursor is supplied — a malformed response must terminate.
    const { api, requests } = stubApi({
      followedPages: [{ items: [{ id: 'a' }], next: 'more', after: undefined }],
    });

    assert.equal(await new EnrichmentService(api).followedArtistCount(), 1);
    assert.equal(requests.filter((p) => p === '/me/following').length, 1);
  });

  it('caches by track ID so a repeated track costs no API calls', async () => {
    const { api, requests } = stubApi();
    const service = new EnrichmentService(api);

    await service.fetch('track-1');
    const before = requests.length;
    await service.fetch('track-1');

    assert.equal(requests.length, before, 'second fetch must not hit the API');
  });

  it('exposes a cached result synchronously via get()', async () => {
    const { api } = stubApi();
    const service = new EnrichmentService(api);

    assert.equal(service.get('track-1'), undefined);
    await service.fetch('track-1');
    assert.ok(service.get('track-1'));
  });

  it('deduplicates concurrent fetches of the same track', async () => {
    const { api, requests } = stubApi();
    const service = new EnrichmentService(api);

    await Promise.all([service.fetch('track-1'), service.fetch('track-1'), service.fetch('track-1')]);

    assert.equal(
      requests.filter((path) => path.startsWith('/tracks/')).length,
      1,
      'concurrent callers must share one lookup',
    );
  });

  it('reuses the followed-artists list across different tracks', async () => {
    const { api, requests } = stubApi();
    const service = new EnrichmentService(api);

    await service.fetch('track-1');
    await service.fetch('track-2');

    assert.equal(
      requests.filter((path) => path === '/me/following').length,
      1,
      'the followed list must be cached across tracks',
    );
  });

  describe('partial failure', () => {
    it('returns a usable result when the track lookup fails', async () => {
      const { api } = stubApi({
        failOn: (path) => (path.startsWith('/tracks/') ? new Error('track boom') : null),
      });
      const result = await new EnrichmentService(api).fetch('track-1');

      assert.equal(result.trackId, 'track-1');
      assert.equal(result.releaseDate, null);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0]!, /track boom/);
    });

    it('keeps track data when only the follow check fails', async () => {
      const { api } = stubApi({
        failOn: (path) => (path === '/me/following' ? new Error('follow boom') : null),
      });
      const result = await new EnrichmentService(api).fetch('track-1');

      assert.equal(result.releaseDate, '2020-06-15', 'track data must survive');
      assert.equal(result.following, null);
      assert.match(result.warnings.join(' '), /follow boom/);
    });

    // A transient failure must not be remembered forever, or a blip would poison the track
    // until restart.
    it('does not cache a result that carries warnings', async () => {
      let shouldFail = true;
      const { api } = stubApi({
        failOn: (path) => (shouldFail && path.startsWith('/tracks/') ? new Error('blip') : null),
      });
      const service = new EnrichmentService(api);

      const failed = await service.fetch('track-1');
      assert.equal(failed.warnings.length, 1);

      shouldFail = false;
      const retried = await service.fetch('track-1');
      assert.deepEqual(retried.warnings, [], 'a retry must be able to succeed');
      assert.equal(retried.releaseDate, '2020-06-15');
    });
  });

  it('handles a track with no album art', async () => {
    const { api } = stubApi({ track: defaultTrack({ album: { ...defaultTrack().album, images: [] } }) });
    const result = await new EnrichmentService(api).fetch('track-1');
    assert.equal(result.art, null);
  });

  it('handles a track with no artists', async () => {
    const { api } = stubApi({ track: defaultTrack({ artists: [] }) });
    const result = await new EnrichmentService(api).fetch('track-1');

    assert.equal(result.primaryArtistId, null);
    assert.equal(result.following, null, 'follow status is unknowable without an artist');
  });
});
