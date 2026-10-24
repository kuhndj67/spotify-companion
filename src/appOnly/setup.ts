/**
 * *App only* setup: the image writes a user's folder (U9, LC-68, BR-74.2, FD Q11 = A).
 *
 * `docker run --rm -v "${PWD}:/work" ghcr.io/kuhndj67/spotify-companion:<version> setup` writes, into the folder:
 *
 *   compose.yaml                image-only (no `build:`), pinned to THIS image's version
 *   secrets/app/musicbrainz.json  from the example; the user puts their contact address in it
 *   config/rules.json           from the rules example (what `npm run rules:init` does for a source install)
 *   data/  state/               empty
 *
 * U11 (IN-U11-3, Q8 = A): `setup --server` writes the SERVER template (`compose.server.yaml`) as compose.yaml, and
 * also creates `config/ca/` and `secrets/app/tls/` (empty), where the owner places the CA's certificate and the
 * app's certificate and key. ⚠️ It never creates a certificate or a key: the CA key must not be on a server (IN-U11-5).
 *
 * so a GHCR read token is the ONLY credential an *App only* user needs: no clone, no second credential to read a
 * private repository's files, and the files always match the image (BR-74.1).
 *
 * ⚠️ It REFUSES to overwrite anything, and says which files are in the way -- as `npm run rules:init` does. It
 * writes nothing at all unless it can write everything, so a refusal never leaves a half-set-up folder.
 *
 * The decision is ⚙️ PURE (PBT-78); the writer around it is a few file copies.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What setup writes: target path (relative to the folder) ← template file name (in the image's templates dir). */
export const SETUP_FILES: ReadonlyArray<readonly [target: string, template: string]> = [
  ['compose.yaml', 'compose.app.yaml'],
  ['secrets/app/musicbrainz.json', 'musicbrainz.example.json'],
  ['config/rules.json', 'rules.example.json'],
];
export const SETUP_DIRECTORIES: readonly string[] = ['secrets/app', 'config', 'data', 'state'];

/** U11 (IN-U11-3): `setup --server`. The same files, with the server template as compose.yaml. */
export const SERVER_SETUP_FILES: ReadonlyArray<readonly [target: string, template: string]> = [
  ['compose.yaml', 'compose.server.yaml'],
  ['secrets/app/musicbrainz.json', 'musicbrainz.example.json'],
  ['config/rules.json', 'rules.example.json'],
];
export const SERVER_SETUP_DIRECTORIES: readonly string[] = [...SETUP_DIRECTORIES, 'config/ca', 'secrets/app/tls'];

export type SetupKind = 'app' | 'server';
const FILES: Record<SetupKind, typeof SETUP_FILES> = { app: SETUP_FILES, server: SERVER_SETUP_FILES };
const DIRECTORIES: Record<SetupKind, readonly string[]> = { app: SETUP_DIRECTORIES, server: SERVER_SETUP_DIRECTORIES };

export type SetupDecision =
  | { readonly write: true; readonly files: readonly string[] }
  | { readonly write: false; readonly inTheWay: readonly string[] };

/** ⚙️ PURE: given which target files already exist, write all of them or none. */
export function decideSetup(existing: ReadonlySet<string>, files: typeof SETUP_FILES = SETUP_FILES): SetupDecision {
  const inTheWay = files.map(([target]) => target).filter((t) => existing.has(t));
  return inTheWay.length > 0 ? { write: false, inTheWay } : { write: true, files: files.map(([t]) => t) };
}

export type SetupOutcome =
  | { readonly ok: true; readonly written: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** The writer: check, decide, then copy. `templates` is the image's templates directory. */
export function runSetup(folder: string, templates: string, kind: SetupKind = 'app'): SetupOutcome {
  const setupFiles = FILES[kind];
  const missingTemplates = setupFiles.map(([, t]) => t).filter((t) => !existsSync(join(templates, t)));
  if (missingTemplates.length > 0) {
    return { ok: false, message: `the image is missing its setup templates (${missingTemplates.join(', ')}); this is a build fault` };
  }
  const existing = new Set(setupFiles.map(([target]) => target).filter((t) => existsSync(join(folder, t))));
  const decision = decideSetup(existing, setupFiles);
  if (!decision.write) {
    return {
      ok: false,
      message: `refusing to overwrite: ${decision.inTheWay.join(', ')} already exist(s) in this folder. Nothing was written. ` +
        'Move them away (or use an empty folder) and run setup again.',
    };
  }
  for (const dir of DIRECTORIES[kind]) mkdirSync(join(folder, dir), { recursive: true });
  for (const [target, template] of setupFiles) {
    mkdirSync(dirname(join(folder, target)), { recursive: true });
    copyFileSync(join(templates, template), join(folder, target));
  }
  return { ok: true, written: decision.files };
}
