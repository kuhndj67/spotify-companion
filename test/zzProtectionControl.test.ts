/**
 * ⚠️ THROWAWAY — U8 BR-63.5 positive control. This PR exists to be REFUSED: it fails one required check on purpose,
 * and `main`'s ruleset must block the merge. Never merge it; the branch is deleted after the check.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';

it('BR-63.5 positive control: fails on purpose', () => {
  assert.fail('deliberate failure — branch protection must refuse to merge this PR');
});
