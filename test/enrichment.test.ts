/**
 * Tests for the pure enrichment helpers.
 *
 * `pickArt` and `ageInYears` are the two pieces of real logic in the enrichment path;
 * everything else there is I/O. `ageInYears` feeds the planned auto-skip rule, so an error
 * in it would silently skip the wrong tracks — worth testing carefully.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js'; // seed selection and reporting (PBT-08)
import { pickArt, ageInYears, parseYear, type SpotifyImage } from '../src/spotify/enrichment.js';
import { imageSetArb, releaseDateArb } from './generators.js';

const RUNS = { numRuns: 500 };

describe('pickArt — example-based', () => {
  /** The three sizes Spotify actually returned on 2026-08-24. */
  const LIVE_IMAGES: SpotifyImage[] = [
    { url: 'https://i.scdn.co/image/big', width: 640, height: 640 },
    { url: 'https://i.scdn.co/image/mid', width: 300, height: 300 },
    { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
  ];

  it('selects the expected size for each role', () => {
    const art = pickArt(LIVE_IMAGES);
    assert.ok(art);
    assert.equal(art.full, 'https://i.scdn.co/image/big');
    assert.equal(art.display, 'https://i.scdn.co/image/mid');
    assert.equal(art.thumb, 'https://i.scdn.co/image/small');
  });

  // Spotify returns largest-first by convention, but that is not guaranteed — selection
  // must be by measured width, not array position.
  it('selects by width even when the array is not ordered', () => {
    const shuffled = [LIVE_IMAGES[1]!, LIVE_IMAGES[2]!, LIVE_IMAGES[0]!];
    assert.deepEqual(pickArt(shuffled), pickArt(LIVE_IMAGES));
  });

  it('returns null when there is no artwork', () => {
    assert.equal(pickArt([]), null);
    assert.equal(pickArt(undefined), null);
  });

  it('handles a single image by using it for all three roles', () => {
    const art = pickArt([{ url: 'only', width: 300, height: 300 }]);
    assert.deepEqual(art, { full: 'only', display: 'only', thumb: 'only' });
  });

  it('ignores entries with no usable URL', () => {
    const art = pickArt([
      { url: '', width: 640, height: 640 },
      { url: 'good', width: 300, height: 300 },
    ]);
    assert.equal(art?.full, 'good');
  });

  it('falls back to the largest when nothing is small enough to be a thumbnail', () => {
    const art = pickArt([{ url: 'huge', width: 1000, height: 1000 }]);
    assert.equal(art?.display, 'huge');
  });
});

describe('pickArt — property-based', () => {
  // PBT-03: every returned URL must come from the input. Fabricating a URL would produce
  // a broken image in the UI.
  it('only ever returns URLs present in the input', () => {
    fc.assert(
      fc.property(imageSetArb, (images) => {
        const art = pickArt(images);
        if (art === null) return;
        const urls = new Set(images.map((image) => image.url));
        for (const chosen of [art.full, art.display, art.thumb]) {
          assert.ok(urls.has(chosen), `fabricated URL: ${chosen}`);
        }
      }),
      RUNS,
    );
  });

  // PBT-03: size ordering invariant — the backdrop image is never smaller than the thumb.
  it('never picks a full image smaller than the thumb', () => {
    fc.assert(
      fc.property(imageSetArb, (images) => {
        const art = pickArt(images);
        if (art === null) return;
        const widthOf = (url: string) =>
          images.find((image) => image.url === url)?.width ?? 0;
        assert.ok(
          widthOf(art.full) >= widthOf(art.thumb),
          'full must be at least as large as thumb',
        );
      }),
      RUNS,
    );
  });

  it('returns null exactly when no usable image exists', () => {
    fc.assert(
      fc.property(imageSetArb, (images) => {
        const usable = images.filter((image) => image.url);
        assert.equal(pickArt(images) === null, usable.length === 0);
      }),
      RUNS,
    );
  });

  it('is idempotent with respect to input ordering', () => {
    fc.assert(
      fc.property(imageSetArb, (images) => {
        assert.deepEqual(pickArt(images), pickArt([...images].reverse()));
      }),
      RUNS,
    );
  });
});

describe('ageInYears — example-based', () => {
  it('computes age from a year-only release date', () => {
    const thisYear = new Date().getUTCFullYear();
    assert.equal(ageInYears(String(thisYear), 'year'), 0);
    assert.equal(ageInYears(String(thisYear - 5), 'year'), 5);
  });

  it('computes age from a full date', () => {
    const age = ageInYears('2020-01-01', 'day');
    assert.ok(age !== null && age >= 5, `expected at least 5 years, got ${age}`);
  });

  it('returns null for missing or unparseable dates', () => {
    assert.equal(ageInYears(undefined, 'day'), null);
    assert.equal(ageInYears('not-a-date', 'day'), null);
  });

  // REGRESSION: found by the property test, shrunk to a date two days in the future.
  // Spotify returns future release dates for scheduled and pre-release items, which
  // produced age -1 — nonsense to display and unsafe for the planned skip rule.
  it('clamps a future release date to zero rather than going negative', () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    assert.equal(ageInYears(`${nextYear}-01-01`, 'day'), 0);
    assert.equal(ageInYears(String(nextYear), 'year'), 0);

    const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    assert.equal(ageInYears(inTwoDays, 'day'), 0);
  });

  it('parses the year out of each precision format', () => {
    assert.equal(parseYear('1994'), 1994);
    assert.equal(parseYear('1994-06'), 1994);
    assert.equal(parseYear('1994-06-15'), 1994);
    assert.equal(parseYear(undefined), null);
  });
});

describe('ageInYears — property-based', () => {
  // PBT-03: this feeds the planned "skip tracks older than N years" rule, so a negative or
  // NaN age would make the rule behave unpredictably.
  it('never returns a negative age for a past release', () => {
    fc.assert(
      fc.property(releaseDateArb, ({ date, precision }) => {
        const age = ageInYears(date, precision);
        assert.ok(age !== null, `failed to compute age for ${date}`);
        assert.ok(Number.isFinite(age), `non-finite age for ${date}`);
        assert.ok(age >= 0, `negative age ${age} for ${date}`);
      }),
      RUNS,
    );
  });

  // Older releases must never compute as younger — the ordering drives the skip threshold.
  it('is monotonic: an earlier release is never younger', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2020 }),
        fc.integer({ min: 1, max: 100 }),
        (year, delta) => {
          const older = ageInYears(String(year), 'year');
          const newer = ageInYears(String(Math.min(year + delta, 2026)), 'year');
          assert.ok(older !== null && newer !== null);
          assert.ok(older >= newer, `${year} computed younger than ${year + delta}`);
        },
      ),
      RUNS,
    );
  });

  it('agrees with parseYear across all precisions', () => {
    fc.assert(
      fc.property(releaseDateArb, ({ date }) => {
        const year = parseYear(date);
        assert.equal(year, Number.parseInt(date.slice(0, 4), 10));
      }),
      RUNS,
    );
  });
});
