/**
 * 2026-10-23 — a host run refuses an UNPATCHED connector, which would use its own copy of the real credentials
 * instead of the path the app passes (`src/mcp/hostConnector.ts`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hostConnectorMessage } from '../src/mcp/hostConnector.js';
import { ORIGINAL_LINE, PATCHED_LINE } from '../scripts/lib/patchConfigPath.js';

describe('hostConnectorMessage', () => {
  it('⭐ on the host, an unpatched connector is refused, naming the fix', () => {
    const msg = hostConnectorMessage(false, `import path from 'path';\n${ORIGINAL_LINE}\n`);
    assert.match(msg ?? '', /unpatched.*not started.*npm run mcp:setup/);
  });

  it('positive control: the patched connector is allowed', () => {
    assert.equal(hostConnectorMessage(false, `import path from 'path';\n${PATCHED_LINE}\n`), null);
  });

  it('the container (patched at build) and a missing checkout are not this check\'s to decide', () => {
    assert.equal(hostConnectorMessage(true, ORIGINAL_LINE), null);
    assert.equal(hostConnectorMessage(false, null), null);
  });
});
