import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { USER_SKIP_RATIO_CEILING } from '../src/history/skipAttribution.js';
import { ATTRIBUTION_VERSION } from '../src/history/types.js';

/**
 * ⚠️ The repair script carries its own copy of the threshold, because it runs standalone
 * against a database file. A copy that drifts would reattribute history by a different rule
 * than the one live plays use — and the two would silently disagree for ever.
 */
describe('the attribution repair script agrees with the module', () => {
  const src = readFileSync(new URL('../scripts/attribute-skips.mjs', import.meta.url), 'utf8');

  it('uses the same ratio ceiling', () => {
    const m = /const USER_SKIP_RATIO_CEILING = ([0-9.]+);/.exec(src);
    assert.ok(m, 'the script must declare the constant so this can check it');
    assert.equal(Number(m[1]), USER_SKIP_RATIO_CEILING);
  });

  it('uses the same attribution version', () => {
    const m = /const ATTRIBUTION_VERSION = (\d+);/.exec(src);
    assert.ok(m);
    assert.equal(Number(m[1]), ATTRIBUTION_VERSION);
  });

  /** ⚠️ It must never touch the columns the hypothesis gate reads. */
  it('never writes outcome or skip_source', () => {
    const updates = src.match(/UPDATE play SET[^`']*/g) ?? [];
    assert.ok(updates.length > 0, 'the guard must not pass by there being no UPDATE');
    for (const u of updates) {
      assert.ok(!/\boutcome\b/.test(u), `an UPDATE touches outcome: ${u}`);
      assert.ok(!/\bskip_source\b/.test(u), `an UPDATE touches skip_source: ${u}`);
    }
  });

  it('leaves backfilled rows alone, which have no ratio to attribute from', () => {
    assert.match(src, /provenance !== 'live'/);
  });
});
