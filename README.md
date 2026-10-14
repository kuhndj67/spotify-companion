# Spotify Companion

A **local, single-user** companion for Spotify. It shows what is playing and enriches it with the record label,
genres, liked status and your own history with the track. It records every play, and it can skip tracks
automatically by rules you write.

## Why it exists

It is a **data-collection instrument for a testable, unproven hypothesis**: that tracks placed in your feed by
signed (major-label) artists are disproportionately paid promotion, and so likelier to be ones you dislike.
Signed-versus-independent is a *proxy*, not the point. The app is built so the hypothesis can be **disconfirmed**,
and its first pre-registered test did **not** support it. Rules are yours to write and stay useful either way.
Analysis happens outside the app, on its exports.

## What it is not

- **Not a hosted service.** Each person runs their own copy, on their own machine, with their **own Spotify
  developer app** and account. Nothing is shared between installs.
- **Not reachable from other machines.** The app answers only on `localhost`.
- **No published image.** You build your own from this source (see [`docs/INSTALL.md`](docs/INSTALL.md)). The
  bundled Spotify MCP server has no licence yet, so a built image may not be redistributed.

## Status

Pre-1.0. The running version is in **Settings** (and in `package.json`). Automated skipping ships **off** and stays
off until you arm it.

## Getting started

- **Install**: [`docs/INSTALL.md`](docs/INSTALL.md): Windows with Rancher Desktop, or Docker Engine on Linux.
- **Contribute**: [`CONTRIBUTING.md`](CONTRIBUTING.md): how a change gets in, and the traps worth knowing first.
- **Security**: [`SECURITY.md`](SECURITY.md): report vulnerabilities privately.
- **Design records**: [`aidlc-docs/`](aidlc-docs/), starting at
  [`aidlc-docs/aidlc-state.md`](aidlc-docs/aidlc-state.md).

## Licence

[GPL-3.0-or-later](LICENSE).
