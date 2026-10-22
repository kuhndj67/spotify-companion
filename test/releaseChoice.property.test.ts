/**
 * PBT-88 (newest release) and PBT-89 (release-page acceptance) — U10, LC-78, BR-85.5, BR-85.6.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import { newestRelease, parseReleases, releasePageAccepted, type ReleaseEntry } from '../src/update/releaseChoice.js';
import { compareSemVer } from '../src/version.js';

const core = fc.tuple(fc.nat(3), fc.nat(3), fc.nat(3)).map(([a, b, c]) => `${a}.${b}.${c}`);
const version = fc.oneof(core, fc.tuple(core, fc.nat(12)).map(([c, n]) => `${c}-beta.${n}`));
const entry: fc.Arbitrary<ReleaseEntry> = fc.record({
  tag: fc.oneof(version.map((v) => `v${v}`), fc.constantFrom('latest', 'v1.0', 'nightly', 'v1.0.0+build.1')),
  prerelease: fc.boolean(),
  draft: fc.boolean(),
  pageUrl: fc.constant('https://github.com/kuhndj67/spotify-companion/releases/tag/v1.0.0'),
});
const isPre = (v: string) => v.includes('-');

describe('PBT-88 — newestRelease', () => {
  it('never a draft or a non-v<SemVer> tag; pre-releases only for a pre-release; the highest; newer iff strictly above', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 12 }), version, (entries, running) => {
        const r = newestRelease(entries, running);
        const eligible = entries.filter(
          (e) => !e.draft && /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(e.tag) && (isPre(running) || (!e.prerelease && !isPre(e.tag.slice(1)))),
        );
        if (eligible.length === 0) {
          assert.equal(r, null);
          return;
        }
        assert.ok(r);
        for (const e of eligible) assert.ok(compareSemVer(r.version, e.tag.slice(1)) >= 0, `${r.version} < ${e.tag}`);
        assert.equal(r.newer, compareSemVer(r.version, running) > 0);
        if (!isPre(running)) assert.equal(isPre(r.version), false, 'a stable install hears only of stable releases');
      }),
    );
  });

  it('⭐ positive control: a newer pre-release IS reported to a pre-release install', () => {
    const r = newestRelease(
      [
        { tag: 'v1.0.0-beta.9', prerelease: true, draft: false, pageUrl: 'https://github.com/kuhndj67/spotify-companion/releases/tag/v1.0.0-beta.9' },
        { tag: 'v1.0.0-beta.10', prerelease: true, draft: true, pageUrl: null },
      ],
      '1.0.0-beta.8',
    );
    assert.deepEqual(r, { version: '1.0.0-beta.9', pageUrl: 'https://github.com/kuhndj67/spotify-companion/releases/tag/v1.0.0-beta.9', newer: true });
  });

  it('an unknown running version never claims an update', () => {
    assert.equal(newestRelease([{ tag: 'v9.9.9', prerelease: false, draft: false, pageUrl: null }], 'unknown'), null);
  });

  it('parses only the four fields, dropping malformed entries', () => {
    assert.deepEqual(parseReleases([{ tag_name: 'v1.0.0', prerelease: false, draft: false, html_url: 'x', body: '<script>' }, { name: 'no tag' }, null, 7]), [
      { tag: 'v1.0.0', prerelease: false, draft: false, pageUrl: 'x' },
    ]);
    assert.deepEqual(parseReleases({ message: 'Not Found' }), []);
  });
});

describe('PBT-89 — releasePageAccepted', () => {
  it('⭐ accepts this repository\'s release pages', () => {
    for (const tag of ['v1.0.0', 'v1.0.0-beta.8']) assert.equal(releasePageAccepted(`https://github.com/kuhndj67/spotify-companion/releases/tag/${tag}`), true);
  });

  it('refuses look-alikes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'http://github.com/kuhndj67/spotify-companion/releases/tag/v1',
          'https://github.com.evil.example/kuhndj67/spotify-companion/releases/tag/v1',
          'https://evil.example/https://github.com/kuhndj67/spotify-companion/releases/',
          'https://user@github.com/kuhndj67/spotify-companion/releases/tag/v1',
          'https://github.com:444/kuhndj67/spotify-companion/releases/tag/v1',
          'https://github.com/someone/spotify-companion/releases/tag/v1',
          'https://github.com/kuhndj67/spotify-companion/issues/1',
          'javascript:alert(1)',
          'not a url',
        ),
        (url) => assert.equal(releasePageAccepted(url), false, url),
      ),
    );
  });
});
