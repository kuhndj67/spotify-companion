/**
 * Entry point for the image's `setup` command (U9, LC-68). The behaviour is `runSetup` in `setup.ts`, which is
 * tested; this only names the two directories the entrypoint arranges and prints the outcome.
 */

import { runSetup } from './setup.js';

const outcome = runSetup('/work', '/app/app-only');
if (!outcome.ok) {
  console.error(`✗ setup: ${outcome.message}`);
  process.exit(1);
}
console.log(`✓ setup wrote: ${outcome.written.join(', ')} (and empty data/, state/)`);
console.log('Next: put your contact address in secrets/musicbrainz.json, then run the sign-in (README, App only).');
