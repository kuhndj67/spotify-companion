/**
 * Is the credentials directory mounted the way U9 needs it? (LC-61, P-68, NFR Design Q5 = A)
 *
 * ## Why this exists
 *
 * From U9 both writers of `spotify-config.json` -- the connector refreshing its token, `CredentialsWriter` saving
 * Settings -- write a temp file beside it and rename it over the original. That needs the DIRECTORY to be a
 * writable bind mount. A compose file from 1.0.0-beta.2 or earlier mounts single FILES instead, and a rename onto a
 * single-file mount fails with EBUSY (probed 2026-10-18): every token refresh would fail, about an hour after
 * starting. A stale *App only* folder or a half-done rollback can produce exactly that.
 *
 * ## What it does about it: start, and say so
 *
 * The app still starts (NFR-13), but the connector is NOT spawned against a path that cannot take a rename. The
 * Spotify indicator names the cause in words and `/api/diagnostics` reports the class. MusicBrainz's refuse-to-start
 * rule (NFR-14) is a different case and is unchanged.
 *
 * The classifier is ⚙️ PURE over the probe answers (PBT-76). The probes are at the bottom, at the edge.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { probeDirectoryWritable } from './atomicWrite.js';

export type CredentialsDirectoryClass = 'ok' | 'not-mounted' | 'not-writable' | 'single-file';

export interface CredentialsDirectoryProbes {
  /** False on a host run (`npm start`): no mounts there, and upstream's own write works. */
  readonly inContainer: boolean;
  /** The directory holding `spotify-config.json` exists. */
  readonly directoryExists: boolean;
  /** That directory is itself a mount point. `null` when the mount table could not be read. */
  readonly directoryIsMount: boolean | null;
  /** `spotify-config.json` is itself a mount point: the pre-U9 single-file pattern. `null` when unknown. */
  readonly fileIsMount: boolean | null;
  /** A file can be created in the directory (a temp file, removed again). */
  readonly directoryWritable: boolean;
}

/**
 * The class, by the first rule that applies.
 *
 * ⚠️ An unreadable mount table (`null`) does not block: in a container it is always readable, and a false
 * `not-mounted` would stop Spotify for a setup that works. Writability is still required, so the case where a
 * rename would really fail is still caught.
 */
export function classifyCredentialsDirectory(p: CredentialsDirectoryProbes): CredentialsDirectoryClass {
  if (!p.inContainer) return 'ok';
  if (p.fileIsMount === true) return 'single-file';
  if (!p.directoryExists) return 'not-mounted';
  if (p.directoryIsMount === false) return 'not-mounted';
  if (!p.directoryWritable) return 'not-writable';
  return 'ok';
}

const UPGRADING = 'see Upgrading in docs/INSTALL.md';

/**
 * The words the Spotify indicator and diagnostics show; `null` for `ok`. Kept under the indicator's 200-character
 * bound (BR-58.2) so the fix is never clipped off the end (tested).
 */
export function credentialsDirectoryMessage(cls: CredentialsDirectoryClass, directory: string): string | null {
  switch (cls) {
    case 'ok':
      return null;
    case 'single-file':
      return `Credentials are mounted as single files, which cannot take a token refresh: mount ./secrets as a directory at ${directory} (${UPGRADING}).`;
    case 'not-mounted':
      return `Credentials directory ${directory} is not mounted: mount ./secrets there (${UPGRADING}).`;
    case 'not-writable':
      return `Credentials directory ${directory} is read-only, so a token refresh cannot be saved: mount ./secrets read-write.`;
  }
}

/**
 * Mount points from `/proc/self/mountinfo` text. ⚙️ PURE. Field 5 is the mount point, with spaces and other
 * special characters octal-escaped (`\040`).
 */
export function mountPointsFrom(mountinfo: string): Set<string> {
  const points = new Set<string>();
  for (const line of mountinfo.split('\n')) {
    const field = line.split(' ')[4];
    if (field) points.add(field.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8))));
  }
  return points;
}

/** The probes, at the edge. Read once at startup: mounts do not change while the container runs. */
export function probeCredentialsDirectory(spotifyConfigPath: string, inContainer: boolean): CredentialsDirectoryProbes {
  const directory = dirname(spotifyConfigPath);
  let mounts: Set<string> | null = null;
  try {
    mounts = mountPointsFrom(readFileSync('/proc/self/mountinfo', 'utf8'));
  } catch {
    mounts = null;
  }
  const directoryExists = existsSync(directory) && statSync(directory).isDirectory();
  return {
    inContainer,
    directoryExists,
    directoryIsMount: mounts === null ? null : mounts.has(directory),
    fileIsMount: mounts === null ? null : mounts.has(spotifyConfigPath),
    directoryWritable: directoryExists && probeDirectoryWritable(spotifyConfigPath),
  };
}
