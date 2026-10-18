/**
 * The release decision (U8, LC-50, P-60) — PBT-68 … PBT-71.
 *
 * ⚠️ PBT-71 is the positive control and it is not garnish: a `decide` that refused EVERYTHING would satisfy
 * PBT-68, PBT-69 and PBT-70 perfectly (the PBT-34a lesson). So for every tag set, the next PATCH / MINOR / MAJOR
 * must be ACCEPTED.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import { compareSemVer, decide, type ReleaseFacts } from '../scripts/lib/releaseDecision.js';

const n = fc.nat({ max: 30 });
const pre = fc.option(
  fc.array(fc.oneof(fc.nat({ max: 20 }).map(String), fc.constantFrom('alpha', 'beta', 'rc', 'x-1')), { minLength: 1, maxLength: 3 }),
  { nil: undefined },
);
const version = fc.tuple(n, n, n, pre).map(([a, b, c, p]) => `${a}.${b}.${c}${p ? `-${p.join('.')}` : ''}`);
const tagSet = fc.uniqueArray(version, { maxLength: 8 });

const PIN_A = 'a'.repeat(40);
const PIN_B = 'b'.repeat(40);

const ok = (over: Partial<ReleaseFacts> & { candidate: string }): ReleaseFacts => ({
  gitTags: [],
  imageTags: [],
  verifyPassed: true,
  treeClean: true,
  // U9: by default the pin did not move and the old container is not running, so PBT-68…71 test what they did.
  pin: PIN_A,
  previousPin: PIN_A,
  acceptedPins: [],
  oldContainerRunning: false,
  ...over,
});

function latest(vs: readonly string[]): string | null {
  return [...vs].sort(compareSemVer).at(-1) ?? null;
}

/** The next release after `v` at each level, as SemVer defines them (pre-release dropped). */
function bumps(v: string | null): string[] {
  if (v === null) return ['0.0.1', '0.1.0', '1.0.0'];
  const [core = '', p] = v.split('-');
  const [a = 0, b = 0, c = 0] = core.split('.').map(Number);
  // From a pre-release, the release of the same core is already greater (1.0.0-beta.1 -> 1.0.0).
  const patch = p === undefined ? `${a}.${b}.${c + 1}` : `${a}.${b}.${c}`;
  return [patch, `${a}.${b + 1}.0`, `${a + 1}.0.0`];
}

describe('PBT-68 — accepts only a valid SemVer strictly greater than every existing tag', () => {
  it('for any tag set and candidate, an accept implies strictly greater than all', () => {
    fc.assert(
      fc.property(tagSet, version, (tags, candidate) => {
        const d = decide(ok({ candidate, gitTags: tags.map((t) => `v${t}`) }));
        if (d.accept) for (const t of tags) assert.ok(compareSemVer(candidate, t) > 0, `${candidate} accepted over ${t}`);
        // ...and the converse: with every other fact favourable, a refusal means some tag is >= the candidate.
        else assert.ok(tags.some((t) => compareSemVer(t, candidate) >= 0), `${candidate} refused: ${d.detail}`);
      }),
    );
  });

  it('invalid versions and build metadata are refused', () => {
    for (const candidate of ['', '1.0', 'v1.0.0', '01.0.0', '1.0.0+build.1', 'latest']) {
      assert.equal(decide(ok({ candidate })).accept, false, candidate);
    }
  });

  it('non-version git tags are ignored, not compared', () => {
    assert.equal(decide(ok({ candidate: '0.8.0', gitTags: ['u5-rollback', 'vnext', 'release'] })).accept, true);
  });
});

describe('PBT-69 — pre-release ordering', () => {
  it('X.Y.Z-beta.N < X.Y.Z-beta.N+1 < X.Y.Z, and the decision follows it', () => {
    fc.assert(
      fc.property(n, n, n, fc.nat({ max: 50 }), (a, b, c, k) => {
        const base = `${a}.${b}.${c}`;
        const lo = `${base}-beta.${k}`;
        const hi = `${base}-beta.${k + 1}`;
        assert.ok(compareSemVer(lo, hi) < 0);
        assert.ok(compareSemVer(hi, base) < 0);
        assert.equal(decide(ok({ candidate: hi, gitTags: [`v${lo}`] })).accept, true);
        assert.equal(decide(ok({ candidate: base, gitTags: [`v${hi}`] })).accept, true);
        assert.equal(decide(ok({ candidate: lo, gitTags: [`v${hi}`] })).accept, false);
        assert.equal(decide(ok({ candidate: hi, gitTags: [`v${base}`] })).accept, false);
      }),
    );
  });

  it('the spec examples, in order (semver.org §11)', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 1; i < chain.length; i += 1) assert.ok(compareSemVer(chain[i - 1]!, chain[i]!) < 0, `${chain[i - 1]} < ${chain[i]}`);
  });
});

describe('PBT-70 — an existing image tag or git tag refuses, whatever else is true', () => {
  it('for any facts, a candidate whose image or git tag exists is refused', () => {
    fc.assert(
      fc.property(
        tagSet, version, fc.boolean(), fc.boolean(), fc.boolean(),
        // U9: the new facts are arbitrary too -- "whatever else is true" includes them.
        fc.constantFrom(PIN_A, PIN_B), fc.constantFrom(PIN_A, PIN_B, null), fc.subarray([PIN_A, PIN_B]), fc.constantFrom(true, false, null),
        (tags, candidate, viaImage, verifyPassed, treeClean, pin, previousPin, acceptedPins, oldContainerRunning) => {
        const d = decide({
          candidate,
          gitTags: viaImage ? tags.map((t) => `v${t}`) : [...tags.map((t) => `v${t}`), `v${candidate}`],
          imageTags: viaImage ? [candidate] : [],
          verifyPassed,
          treeClean,
          pin,
          previousPin,
          acceptedPins,
          oldContainerRunning,
        });
        assert.equal(d.accept, false);
      }),
    );
  });

  it('verify failing or a dirty tree refuses even a perfect candidate', () => {
    assert.deepEqual(decide(ok({ candidate: '0.8.0', verifyPassed: false })), { accept: false, reason: 'verify-failed', detail: '`npm run verify` did not pass' });
    assert.equal(decide(ok({ candidate: '0.8.0', treeClean: false })).accept, false);
  });
});

describe('⭐ PBT-71 — positive control: the next PATCH / MINOR / MAJOR is accepted', () => {
  it('for any tag set, each next version with verify passed and a clean tree is accepted', () => {
    fc.assert(
      fc.property(tagSet, (tags) => {
        const top = latest(tags);
        for (const candidate of bumps(top)) {
          const d = decide(ok({ candidate, gitTags: tags.map((t) => `v${t}`), imageTags: tags }));
          assert.ok(d.accept, `${candidate} after ${top ?? '(none)'} was refused: ${d.accept ? '' : d.detail}`);
          assert.equal(d.previous, top);
        }
      }),
    );
  });

  it("this project's first releases: 0.8.0 from nothing, then 1.0.0-beta.1, then 1.0.0", () => {
    const first = decide(ok({ candidate: '0.8.0', imageTags: ['0.1.0', 'u6-rollback'] }));
    assert.deepEqual(first, { accept: true, gitTag: 'v0.8.0', imageTag: 'spotify-companion:0.8.0', previous: null });
    assert.equal(decide(ok({ candidate: '1.0.0-beta.1', gitTags: ['v0.8.0'] })).accept, true);
    assert.equal(decide(ok({ candidate: '1.0.0', gitTags: ['v0.8.0', 'v1.0.0-beta.1'] })).accept, true);
  });
});

describe('U9 (P-74) — a moved connector pin needs a recorded pass', () => {
  it('refuses a moved pin with no pass, and accepts it once accepted; an unmoved pin needs nothing', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(PIN_A, PIN_B, 'c'.repeat(40)), { maxLength: 3 }), (accepted) => {
        const d = decide(ok({ candidate: '1.0.0', pin: PIN_B, previousPin: PIN_A, acceptedPins: accepted }));
        assert.equal(d.accept, accepted.includes(PIN_B));
        if (!d.accept) assert.equal(d.reason, 'pin-not-accepted');
        assert.equal(decide(ok({ candidate: '1.0.0', pin: PIN_A, previousPin: PIN_A, acceptedPins: accepted })).accept, true);
      }),
    );
  });

  it('the first release ever (no previous pin) is not asked for an acceptance', () => {
    assert.equal(decide(ok({ candidate: '0.8.0', previousPin: null, pin: PIN_B })).accept, true);
  });
});

describe('PBT-77 — the crossing guard: refuses while the pre-U9 container runs, or when Docker cannot say', () => {
  it('for any otherwise-acceptable facts, running or unknown refuses with old-container-running', () => {
    fc.assert(
      fc.property(fc.constantFrom(true, null), tagSet, (running, tags) => {
        const candidate = bumps(latest(tags))[0]!;
        const d = decide(ok({ candidate, gitTags: tags.map((t) => `v${t}`), oldContainerRunning: running }));
        assert.equal(d.accept, false);
        if (!d.accept) assert.equal(d.reason, 'old-container-running');
      }),
    );
  });

  it('⭐ positive control: not running, and the same facts are accepted', () => {
    fc.assert(
      fc.property(tagSet, (tags) => {
        const candidate = bumps(latest(tags))[0]!;
        assert.equal(decide(ok({ candidate, gitTags: tags.map((t) => `v${t}`), oldContainerRunning: false })).accept, true);
      }),
    );
  });
});
