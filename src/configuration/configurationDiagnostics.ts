/**
 * The Configuration block of `/api/diagnostics` (IN-U7-6). ⚙️ PURE
 *
 * Extracted and pure for the same reason as U5's `automationDiagnosticSteps` and U6's `maintenanceDiagnosticSteps`:
 * `diagnostics.ts` is reached only from `server.ts`, so anything decided inline there is decided where nothing can
 * check it.
 *
 * Its job is that a `:ro` left in place by mistake shows on the FIRST PAGE LOAD, not on the first save — the
 * writability answers are probes taken through the container, passed in here.
 *
 * ⚠️ Nothing merely ABSENT is a fault: no rules write yet, no credentials change yet. And credential VALUES never
 * reach this module — only when, which, and the outcome (P-53).
 */

import type { DiagnosticStep } from '../diagnostics.js';
import type { CredentialsDirectoryClass } from './credentialsDirectory.js';
import type { LastCredentialsWrite } from './CredentialsWriter.js';
import type { LastRulesWrite } from './RulesWriter.js';

export interface ConfigurationDiagnosticsInput {
  readonly configWritable: boolean;
  readonly rulesPath: string;
  readonly musicbrainzWritable: boolean;
  readonly musicbrainzPath: string;
  readonly spotifyWritable: boolean;
  readonly spotifyPath: string;
  /** U9 (LC-61): how the credentials directory is mounted, and the words for anything but `ok`. */
  readonly credentialsDirectory: { readonly class: CredentialsDirectoryClass; readonly message: string | null };
  readonly lastRulesWrite: LastRulesWrite | null;
  readonly lastCredentialsWrite: LastCredentialsWrite | null;
  /** P-55's three outcomes. */
  readonly polls: { readonly total: number; readonly idle: number; readonly error: number; readonly idleShare: number | null };
}

const step = (name: string, status: DiagnosticStep['status'], detail: string): DiagnosticStep => ({ name, status, detail, durationMs: 0 });

export function configurationDiagnosticSteps(c: ConfigurationDiagnosticsInput): DiagnosticStep[] {
  const steps: DiagnosticStep[] = [];

  steps.push(
    c.configWritable
      ? step('Rules directory writable (config/)', 'ok', `the app can save rules to ${c.rulesPath}`)
      : step('Rules directory writable (config/)', 'fail', `cannot write beside ${c.rulesPath} — is ./config still mounted :ro? Uploading rules will fail`),
  );
  steps.push(
    c.credentialsDirectory.class === 'ok'
      ? step('Credentials directory', 'ok', 'mounted as a directory and writable: token refreshes and Settings saves can be stored')
      : step('Credentials directory', 'fail', `${c.credentialsDirectory.class}: ${c.credentialsDirectory.message ?? ''}`),
  );
  steps.push(
    c.spotifyWritable
      ? step('Spotify credentials writable', 'ok', `${c.spotifyPath} can be replaced from Settings`)
      : step('Spotify credentials writable', 'fail', `cannot write beside ${c.spotifyPath} — Settings cannot replace the credentials, and the MCP server cannot store a refreshed token`),
  );
  steps.push(
    c.musicbrainzWritable
      ? step('MusicBrainz contact writable', 'ok', `${c.musicbrainzPath} can be changed from Settings`)
      : step('MusicBrainz contact writable', 'fail', `cannot write beside ${c.musicbrainzPath} — is ./secrets mounted :ro?`),
  );

  const r = c.lastRulesWrite;
  steps.push(
    r === null
      ? step('Last rules write', 'skip', 'none since the app started')
      // A refusal (stale base, missing REPLACE…) is the guard WORKING, not a fault. Only a failed write or a reload the
      // engine rejected means something is wrong with the installation.
      : step('Last rules write', r.outcome === 'write-failed' || r.outcome === 'reload-rejected' ? 'fail' : 'ok',
          `${r.at} — ${r.kind}: ${r.outcome}${r.version === null ? '' : ` (rules version ${r.version})`}`),
  );

  const w = c.lastCredentialsWrite;
  steps.push(
    w === null
      ? step('Last credentials change', 'skip', 'none since the app started')
      : step('Last credentials change', w.outcome === 'saved' ? 'ok' : 'fail', `${w.at} — ${w.which}: ${w.outcome}`),
  );

  const p = c.polls;
  const share = p.idleShare === null ? 'unknown' : `${Math.round(p.idleShare * 100)}% idle`;
  steps.push(
    p.total === 0
      ? step('Now-playing polls (playing / idle / error)', 'skip', 'no poll yet')
      : step(
          'Now-playing polls (playing / idle / error)',
          // An error share at or above half means Spotify is mostly refusing — the FR-71 case, said in words here
          // as well as on the indicator.
          p.error * 2 >= p.total ? 'fail' : 'ok',
          `${p.total - p.idle - p.error} / ${p.idle} / ${p.error} of ${p.total} — ${share} of the polls that got an answer`,
        ),
  );

  return steps;
}
