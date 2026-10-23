/**
 * The connector's config-path patch (U9, LC-58, P-65) — PBT-73, PBT-74.
 *
 * ⚠️ PBT-74 is the positive control: a `patchConfigPath` that refused EVERYTHING would satisfy PBT-73 perfectly
 * (the PBT-34a lesson). So for any source with exactly one original line, it must SUCCEED.
 */

import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { ORIGINAL_LINE, PATCHED_LINE, patchConfigPath } from '../scripts/lib/patchConfigPath.js';

/** Arbitrary source lines that are never the original or patched line (they may contain `CONFIG_FILE`). */
const otherLine = fc
  .oneof(
    fc.string({ maxLength: 40 }),
    fc.constantFrom(
      "const CONFIG_FILE = path.join(__dirname, '../other.json');",
      'export const CONFIG_FILE_NAME = 1;',
      "// const CONFIG_FILE = path.join(__dirname, '../spotify-config.json'); in a comment, still a different line",
      '',
      '  ',
    ),
  )
  .map((s) => s.replace(/[\r\n]/g, ''))
  .filter((s) => s.trim() !== ORIGINAL_LINE && s.trim() !== PATCHED_LINE);

const otherLines = fc.array(otherLine, { maxLength: 12 });
const indent = fc.constantFrom('', '  ', '\t');

describe('patchConfigPath (LC-58)', () => {
  it('PBT-73: refuses when the original line occurs 0 or ≥ 2 times, and the reason names the count', () => {
    fc.assert(
      fc.property(otherLines, fc.oneof(fc.constant(0), fc.integer({ min: 2, max: 4 })), indent, (others, count, ind) => {
        const lines = [...others];
        for (let i = 0; i < count; i += 1) lines.splice(Math.min(i * 2, lines.length), 0, `${ind}${ORIGINAL_LINE}`);
        const result = patchConfigPath(lines.join('\n'));
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, new RegExp(`found it ${count} time`));
      }),
    );
  });

  it('PBT-74 ⭐ positive control: exactly one original line → patched once, nothing else changed', () => {
    fc.assert(
      fc.property(otherLines, otherLines, indent, fc.boolean(), (head, tail, ind, crlf) => {
        const eol = crlf ? '\r\n' : '\n';
        const source = [...head, `${ind}${ORIGINAL_LINE}`, ...tail].join(eol);
        const result = patchConfigPath(source);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        const out = result.patched.split(eol);
        assert.equal(out.length, head.length + 1 + tail.length);
        assert.deepEqual(out.slice(0, head.length), head);
        assert.deepEqual(out.slice(head.length + 1), tail);
        assert.equal(out[head.length], `${ind}${PATCHED_LINE}`);
        assert.equal(out.filter((l) => l.trim() === ORIGINAL_LINE).length, 0);
      }),
    );
  });

  it('keeps upstream\'s default when SPOTIFY_CONFIG_PATH is unset (the replacement\'s fallback is the original expression)', () => {
    assert.ok(PATCHED_LINE.includes("?? path.join(__dirname, '../spotify-config.json')"));
  });

  // The real file, when a checkout is present (as PBT-66 reads it). Skipped with a reason rather than passing
  // vacuously when the checkout is absent or at a pin that predates the line's current form.
  const upstream = join(process.cwd(), '.mcp-server', 'src', 'utils.ts');
  it('patches the real upstream src/utils.ts at the pinned commit', (t) => {
    if (!existsSync(upstream)) return t.skip('.mcp-server/src/utils.ts absent: run `npm run mcp:setup`');
    // ⚠️ Upstream's COMMITTED file, not the working copy: since 2026-10-23 `npm run mcp:setup` patches the host
    // checkout too, so the working file already carries the patched line.
    const committed = execFileSync('git', ['show', 'HEAD:src/utils.ts'], { cwd: join(process.cwd(), '.mcp-server'), encoding: 'utf8' });
    const result = patchConfigPath(committed);
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
  });
});
