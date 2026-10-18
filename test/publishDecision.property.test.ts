/**
 * The publish decision (U9, LC-64) — PBT-75.
 *
 * ⚠️ The positive control is part of PBT-75, not garnish: a `decidePublish` that refused everything would satisfy
 * every "refuses when…" property perfectly (the PBT-34a lesson).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './fc-config.js';
import { decidePublish, type RegistryAnswer } from '../scripts/lib/publishDecision.js';

const n = fc.nat({ max: 20 });
const pre = fc.option(fc.constantFrom('beta.1', 'beta.3', 'rc.1', 'alpha'), { nil: undefined });
const version = fc.tuple(n, n, n, pre).map(([a, b, c, p]) => `${a}.${b}.${c}${p ? `-${p}` : ''}`);
const registry = fc.constantFrom<RegistryAnswer>('absent', 'present', 'unknown');
const tag = fc.oneof(version.map((v) => `v${v}`), version, fc.string({ maxLength: 12 }));

describe('PBT-75 — CI publishes only v<version> that the registry was asked about and does not hold', () => {
  it('for any facts: publish ⇔ tag is exactly v+version AND the registry said absent', () => {
    fc.assert(
      fc.property(tag, version, registry, (t, v, r) => {
        const d = decidePublish({ tag: t, version: v, registry: r });
        assert.equal(d.publish, t === `v${v}` && r === 'absent');
        if (d.publish) assert.equal(d.imageTag, v);
      }),
    );
  });

  it('⭐ positive control: every valid version, tagged v<version> and not yet published, IS published', () => {
    fc.assert(
      fc.property(version, (v) => {
        assert.deepEqual(decidePublish({ tag: `v${v}`, version: v, registry: 'absent' }), { publish: true, imageTag: v });
      }),
    );
  });

  it('an unknown registry answer refuses (it cannot prove the tag is free); present refuses as never-overwrite', () => {
    assert.equal(decidePublish({ tag: 'v1.0.0', version: '1.0.0', registry: 'unknown' }).publish, false);
    const d = decidePublish({ tag: 'v1.0.0', version: '1.0.0', registry: 'present' });
    assert.ok(!d.publish && d.reason === 'already-published');
  });

  it('a version Docker cannot tag (build metadata) or that is not SemVer is refused before anything else', () => {
    for (const v of ['1.0.0+build.1', 'latest', '1.0']) {
      const d = decidePublish({ tag: `v${v}`, version: v, registry: 'absent' });
      assert.ok(!d.publish && d.reason === 'invalid-version', v);
    }
  });
});
