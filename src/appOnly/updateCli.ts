/**
 * Entry point for the image's `update` command (U10, LC-79, BR-83). The behaviour is `runUpdate` in `update.ts`,
 * which is tested; this only names the folder the entrypoint mounts and prints the outcome and the next step.
 */

import { readAppVersion } from '../version.js';
import { runUpdate } from './update.js';

const outcome = runUpdate('/work', readAppVersion());
if (!outcome.ok) {
  console.error(`✗ update: ${outcome.message}`);
  process.exit(1);
}
if (!outcome.changed) {
  console.log(`✓ update: compose.yaml already runs ${outcome.to}. Nothing to do.`);
} else {
  console.log(`✓ update: compose.yaml now runs ${outcome.to} (was ${outcome.from}). Only the image line changed.`);
  console.log('Next: docker compose up -d');
  console.log('The new version backs up your listening history before its first run (data/backups/before-change/).');
  console.log(`What changed: https://github.com/kuhndj67/spotify-companion/releases/tag/v${outcome.to}`);
}
