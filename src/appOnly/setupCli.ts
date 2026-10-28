/**
 * Entry point for the image's `setup` command (U9, LC-68). The behaviour is `runSetup` in `setup.ts`, which is
 * tested; this only names the two directories the entrypoint arranges and prints the outcome.
 */

import { runSetup } from './setup.js';

// U11 (IN-U11-3): `setup --server` writes the server template. Anything else is refused, not guessed at.
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--server')) {
  console.error(`✗ setup: unknown option ${JSON.stringify(args.join(' '))}; the only option is --server`);
  process.exit(2);
}
const kind = args[0] === '--server' ? 'server' : 'app';

const outcome = runSetup('/work', '/app/app-only', kind);
if (!outcome.ok) {
  console.error(`✗ setup: ${outcome.message}`);
  process.exit(1);
}
if (kind === 'server') {
  console.log(`✓ setup --server wrote: ${outcome.written.join(', ')} (and empty data/, state/, config/ca/, secrets/app/tls/)`);
  console.log('Next (docs/INSTALL-SERVER.md, N4): fill in every <placeholder> on a setting line of compose.yaml; put');
  console.log('ca-cert.pem in config/ca/, the app\'s certificate and key in secrets/app/tls/, the client secret in');
  console.log('secrets/app/oidc-client-secret; your contact address in secrets/app/musicbrainz.json. Then N5.');
} else {
  console.log(`✓ setup wrote: ${outcome.written.join(', ')} (and empty data/, state/)`);
  console.log('Next: put your contact address in secrets/app/musicbrainz.json, then run the sign-in (README, App only).');
}
