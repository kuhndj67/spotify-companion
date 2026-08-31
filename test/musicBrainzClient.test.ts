/**
 * MusicBrainz client.
 *
 * The fixtures are shaped after the **live probe responses** (research-findings Part 5 and 6),
 * including the one that lied: `GET /isrc/{isrc}?inc=releases` returning 200 with the `inc`
 * silently dropped.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MusicBrainzClient, MusicBrainzError } from '../src/musicbrainz/MusicBrainzClient.js';
import { RequestQueue } from '../src/musicbrainz/RequestQueue.js';

/** A queue with no waiting, so these tests exercise the client rather than the limiter. */
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

interface Call {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(routes: (url: URL) => { status?: number; body?: unknown; raw?: string }) {
  const calls: Call[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url: url.toString(), headers: (init?.headers ?? {}) as Record<string, string> });

    const { status = 200, body, raw } = routes(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (raw !== undefined) return JSON.parse(raw);
        return body;
      },
    } as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function makeClient(fetchImpl: typeof fetch) {
  return new MusicBrainzClient({
    queue: instantQueue(),
    userAgent: 'SpotifyNowPlaying/0.1 ( test@example.com )',
    baseUrl: 'https://stub.invalid/ws/2',
    fetchImpl,
  });
}

// ---------------------------------------------------------------------------
// A recording KNOWN to have many releases. This is the fixture BR-1.2 requires.
// ---------------------------------------------------------------------------
const AUDIOSLAVE_RELEASES = Array.from({ length: 44 }, (_, i) => ({
  id: `release-${i}`,
  title: i === 0 ? 'Audioslave' : `Audioslave (Edition ${i})`,
  date: '2002-11-19',
  status: 'Official',
  'label-info': [
    { 'catalog-number': `CAT-${i}`, label: { id: 'epic-id', name: 'Epic', type: 'Imprint' } },
  ],
}));

describe('BR-1.2 — the two-call chain must stay two calls', () => {
  // The obvious single call, GET /isrc/{isrc}?inc=releases, returns 200 with the `inc`
  // SILENTLY DROPPED. Nineteen ISRCs looked like "MusicBrainz has nothing", which was false.
  //
  // This test is written against a recording known to have 44 releases precisely so that it
  // CANNOT pass against that bug. A test asserting "no releases" would have passed happily.
  it('resolves a recording with many releases, proving the chain works', async () => {
    const { impl, calls } = stubFetch((url) => {
      if (url.pathname.includes('/isrc/')) {
        return { body: { recordings: [{ id: 'recording-mbid' }] } };
      }
      if (url.pathname.endsWith('/release')) {
        return { body: { releases: AUDIOSLAVE_RELEASES } };
      }
      return { status: 404 };
    });

    const client = makeClient(impl);
    const { recordingMbid } = await client.lookupRecordingByIsrc('USSM10211357');
    assert.equal(recordingMbid, 'recording-mbid');

    const releases = await client.listReleasesForRecording(recordingMbid!);
    assert.equal(releases.length, 44, 'a known-many-releases recording must return them all');
    assert.ok(
      releases.every((r) => r.labels.length > 0),
      'labels must survive the mapping — this is what inc=labels is for',
    );
    assert.equal(calls.length, 2, 'exactly two requests: the chain is not collapsible');
  });

  it('never sends inc= on the ISRC lookup', async () => {
    // Passing it there is the bug. Asserting its absence is cheaper than re-discovering it.
    const { impl, calls } = stubFetch(() => ({ body: { recordings: [{ id: 'x' }] } }));
    await makeClient(impl).lookupRecordingByIsrc('USSM10211357');

    const isrcCall = new URL(calls[0]!.url);
    assert.equal(isrcCall.searchParams.get('inc'), null);
  });

  it('sends inc=labels on the release lookup, where it actually works', async () => {
    const { impl, calls } = stubFetch(() => ({ body: { releases: [] } }));
    await makeClient(impl).listReleasesForRecording('recording-mbid');

    const releaseCall = new URL(calls[0]!.url);
    assert.equal(releaseCall.searchParams.get('inc'), 'labels');
    assert.equal(releaseCall.searchParams.get('recording'), 'recording-mbid');
  });
});

describe('NFR-14 — every request identifies the application', () => {
  it('sends the configured User-Agent', async () => {
    const { impl, calls } = stubFetch(() => ({ body: { recordings: [] } }));
    await makeClient(impl).lookupRecordingByIsrc('USSM10211357');
    assert.match(calls[0]!.headers['User-Agent'] ?? '', /SpotifyNowPlaying.*test@example\.com/);
  });

  it('always requests JSON', async () => {
    const { impl, calls } = stubFetch(() => ({ body: { recordings: [] } }));
    await makeClient(impl).lookupRecordingByIsrc('USSM10211357');
    assert.equal(new URL(calls[0]!.url).searchParams.get('fmt'), 'json');
  });
});

describe('failures are classified, not collapsed (BR-10.2)', () => {
  // `not-found` is a fact about MusicBrainz's catalogue and is cacheable. `throttled`/`network`
  // are facts about the network on a particular Tuesday. Both read as `unknown`, but folding
  // the second into the first inflates the coverage gap with transport noise.
  it('reports a 404 as not-found', async () => {
    const { impl } = stubFetch(() => ({ status: 404 }));
    await assert.rejects(
      makeClient(impl).lookupRecordingByIsrc('QZXXX2312345'),
      (error: unknown) => error instanceof MusicBrainzError && error.kind === 'not-found',
    );
  });

  it('reports a 503 as a throttle, which is what stops the queue', async () => {
    // MusicBrainz signals rate-limit rejection with 503, not 429.
    const { impl } = stubFetch(() => ({ status: 503 }));
    await assert.rejects(makeClient(impl).lookupRecordingByIsrc('USSM10211357'), /503/);
  });

  it('reports an unparseable 200 as malformed rather than as empty', async () => {
    // A 200 carrying something unexpected is not an empty result. Parsing optimistically here
    // is the same mistake as trusting the inc=-ignored response.
    const { impl } = stubFetch(() => ({ raw: 'not json at all' }));
    await assert.rejects(
      makeClient(impl).lookupRecordingByIsrc('USSM10211357'),
      (error: unknown) => error instanceof MusicBrainzError && error.kind === 'malformed',
    );
  });

  it('reports a network failure distinctly', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await assert.rejects(
      makeClient(impl).lookupRecordingByIsrc('USSM10211357'),
      (error: unknown) => error instanceof MusicBrainzError && error.kind === 'network',
    );
  });
});

describe('an ISRC MusicBrainz does not know', () => {
  it('returns a null recording rather than throwing when the response is simply empty', async () => {
    // 200 with no recordings is an ANSWER: MusicBrainz looked and has nothing.
    const { impl } = stubFetch(() => ({ body: { recordings: [] } }));
    const { recordingMbid } = await makeClient(impl).lookupRecordingByIsrc('QZXXX2312345');
    assert.equal(recordingMbid, null);
  });
});

describe('the exact Spotify artist join', () => {
  it('returns the artist MBID from the url entity', async () => {
    // MusicBrainz holds three artists named `Prof`. This join returns the right one by
    // construction rather than by luck — no name matching, no score.
    const { impl, calls } = stubFetch(() => ({
      body: { relations: [{ artist: { id: 'artist-mbid' } }] },
    }));

    const mbid = await makeClient(impl).lookupArtistBySpotifyId('4Ws4bnyoc0Q8FQvpBoRvIz');
    assert.equal(mbid, 'artist-mbid');

    const url = new URL(calls[0]!.url);
    assert.equal(
      url.searchParams.get('resource'),
      'https://open.spotify.com/artist/4Ws4bnyoc0Q8FQvpBoRvIz',
    );
    assert.equal(url.searchParams.get('inc'), 'artist-rels');
  });

  it('returns null when MusicBrainz has no link for the artist', async () => {
    const { impl } = stubFetch(() => ({ body: { relations: [] } }));
    assert.equal(await makeClient(impl).lookupArtistBySpotifyId('unknown-artist'), null);
  });
});

describe('search fallback refuses to guess (Q3 = B)', () => {
  // The Ren case: the top TWO hits scored 100 and were different recordings, while the
  // near-correct one scored 95. `score` does not rank correctness, so any threshold rule is
  // occasionally confidently wrong — and a wrong label is invisible downstream.
  it('accepts a single exact match', async () => {
    const { impl } = stubFetch(() => ({
      body: {
        count: 1,
        recordings: [{ id: 'found', title: 'Wake Up', 'artist-credit': [{ name: 'BOVSKI' }] }],
      },
    }));
    assert.equal(await makeClient(impl).searchRecording('BOVSKI', 'Wake Up'), 'found');
  });

  it('refuses when more than one recording matched', async () => {
    const { impl } = stubFetch(() => ({
      body: {
        count: 7,
        recordings: [
          { id: 'a', title: 'Starry Night Act III', 'artist-credit': [{ name: 'Ren' }] },
        ],
      },
    }));
    assert.equal(await makeClient(impl).searchRecording('Ren', 'Starry Night Act III'), null);
  });

  it('refuses a single hit whose title does not match exactly', async () => {
    const { impl } = stubFetch(() => ({
      body: {
        count: 1,
        recordings: [{ id: 'a', title: 'A Different Song', 'artist-credit': [{ name: 'Ren' }] }],
      },
    }));
    assert.equal(await makeClient(impl).searchRecording('Ren', 'Starry Night Act III'), null);
  });

  it('refuses a single hit by a different artist', async () => {
    const { impl } = stubFetch(() => ({
      body: {
        count: 1,
        recordings: [{ id: 'a', title: 'Wake Up', 'artist-credit': [{ name: 'Someone Else' }] }],
      },
    }));
    assert.equal(await makeClient(impl).searchRecording('BOVSKI', 'Wake Up'), null);
  });

  it('escapes Lucene syntax in the query', async () => {
    // A title containing a quote or a colon must not be able to alter the query it appears in.
    const { impl, calls } = stubFetch(() => ({ body: { count: 0, recordings: [] } }));
    await makeClient(impl).searchRecording('AC/DC', 'Rock "n" Roll: Part 1');

    const query = new URL(calls[0]!.url).searchParams.get('query') ?? '';
    assert.ok(query.includes('\\/'), 'the slash in AC/DC must be escaped');
    assert.ok(query.includes('\\:'), 'the colon in the title must be escaped');
  });
});

describe('label mapping', () => {
  it('drops label-info entries carrying no label name', async () => {
    // MusicBrainz emits label-info rows with a catalog number and a null label. They are not
    // candidates, and letting an empty name through would produce a nameless vote.
    const { impl } = stubFetch(() => ({
      body: {
        releases: [
          {
            id: 'r1',
            title: 'An Album',
            date: '2022-03-14',
            status: 'Official',
            'label-info': [
              { 'catalog-number': 'CAT-1', label: null },
              { 'catalog-number': 'CAT-2', label: { id: 'l2', name: 'Sub Pop', type: 'Imprint' } },
            ],
          },
        ],
      },
    }));

    const releases = await makeClient(impl).listReleasesForRecording('recording-mbid');
    assert.equal(releases[0]?.labels.length, 1);
    assert.equal(releases[0]?.labels[0]?.labelName, 'Sub Pop');
  });

  it('preserves the MusicBrainz label type, which drives eligibility', async () => {
    const { impl } = stubFetch(() => ({
      body: {
        releases: [
          {
            id: 'r1',
            title: 'An Album',
            date: '2022-01-01',
            status: 'Official',
            'label-info': [
              { label: { id: 'l1', name: 'Faouzia Music', type: 'Publisher' } },
            ],
          },
        ],
      },
    }));

    const releases = await makeClient(impl).listReleasesForRecording('recording-mbid');
    assert.equal(releases[0]?.labels[0]?.labelType, 'Publisher');
  });
});
