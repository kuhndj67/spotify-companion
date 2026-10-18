# Spotify Companion

A **local, single-user** companion for Spotify. It shows what is playing and enriches it with the record label,
genres, liked status and your own history with the track. It records every play, and it can skip tracks
automatically by rules you write. 

## Why it exists

It started as a **data-collection instrument for a testable, unproven hypothesis**: that tracks placed in your feed by
signed (major-label) artists include paid promotion, and so likelier to be ones you dislike. Since then Spotify publicly 
shared that yes they promote content so now I'm wondering if it's detectable (which would indicate that their promotion
algorithm is not wall aligned with user listening preference).
In either case the rules engine allows users to fine tune their feeds by having it automatically skip content based on 
metadata or prior listening history (only play unsigned artists, or music less than 5 years old... or automatically 
skip tracks I've manually skipped before).

## What it is not (at the moment but some of this will change when I get to it)

- **Not a hosted service.** Each person runs their own copy, on their own machine, with their **own Spotify
  developer app** and account. Nothing is shared between installs.
- **Not reachable from other machines.** The app answers only on `localhost`.
- **No published image.** You build your own from this source (see [`docs/INSTALL.md`](docs/INSTALL.md)). The
  bundled Spotify MCP server became MIT-licensed on 2026-10-16, but this project still builds it from an earlier,
  unlicensed commit, so for now no built image is published.

## Status

Pre-1.0. The running version is in **Settings** (and in `package.json`). Automated skipping ships **off** and stays
off until you arm it.

## Install

Each install runs on your own machine, with your own Spotify account. Pick one way:

- **From source, with VS Code and Claude Code** (Windows; recommended). You need VS Code with the Claude Code
  extension, signed in, a Spotify account, and read access to this repository.
  1. Create an empty folder, and copy [`docs/INSTALL.md`](docs/INSTALL.md) and
     [`docs/claude-start.md`](docs/claude-start.md) into it, from the release you want to install.
  2. Open the folder in VS Code and start a Claude Code session.
  3. Type: *Read claude-start.md and follow it.* Claude does the steps it can, and shows you a **👤 YOU DO THIS** box
     for each step that needs you.
- **From source, by hand** (Windows with Rancher Desktop, or Docker Engine on Linux): follow
  [`docs/INSTALL.md`](docs/INSTALL.md) yourself. It is the same routine.

Other ways to install, such as a prebuilt image or another kind of host, will be listed here as they become
available.

## Getting started

- **Contribute**: [`CONTRIBUTING.md`](CONTRIBUTING.md): how a change gets in, and the traps worth knowing first.
- **Security**: [`SECURITY.md`](SECURITY.md): report vulnerabilities privately.
- **Design records**: [`aidlc-docs/`](aidlc-docs/), starting at
  [`aidlc-docs/aidlc-state.md`](aidlc-docs/aidlc-state.md).

## Licence

[GPL-3.0-or-later](LICENSE).
