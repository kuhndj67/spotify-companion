# Spotify Companion

A **local, single-user** companion for Spotify subscribers (you need to have a paid subscription for api access). It shows what is playing and enriches it with the record label,
genres, liked status and your own history with the track. It records every play, and it can skip tracks
automatically by rules you write.

## Why it exists

**Primary.** It started as a **data-collection instrument for a testable, unproven hypothesis**: that tracks placed in your feed by
signed (major-label) artists include paid promotion, and so are likelier to be ones you dislike. Since then, Spotify
has publicly said that it does promote content, so now I'm wondering whether that is detectable (which would indicate
that their promotion algorithm is not well aligned with user listening preference).

In either case, the rules engine lets users fine-tune their feeds by having it automatically skip content based on
metadata or prior listening history: only play unsigned artists, or music less than 5 years old, or automatically
skip tracks I've manually skipped before.

**Secondary.** As someone who is a leader of developers but doesn't get to write code much anymore, I wanted to better understand Generative
AI workflows and how a developer can use the tools. I'm using the AWSLabs AI-DLC framework (open source) and Claude
(primarily Opus 5.5 with Fable code reviews) in VS Code to build this app, and I chose to do it in a language and devops
environment I'm unfamiliar with (maybe not the right call in hindsight... but here we are) to see if I could get a
quality product with AI doing all the coding.

## What it is not (at the moment; some of this will change when I get to it)

- **Not a hosted service.** Each person runs their own copy, on their own machine, with their **own Spotify
  account and developer credentials**. Nothing is shared between installs.
- **Not reachable from other machines.** The app answers only on `localhost`.

## Status

Beta. Both install routes have been walked end to end on Windows with Rancher Desktop. The development install was
walked by its owner, by hand and with an AI agent. The app-only install was walked by AI agents on a clean Windows
machine and by its owner, and installed and ran each time. Linux and macOS are written for but not yet walked. The running version is in **Settings** (and in `package.json`).
New versions are announced on the [Releases page](https://github.com/kuhndj67/spotify-companion/releases) (**Watch → Custom → Releases** to be notified). Automated skipping ships **off** and stays
off until you arm it.

## Install

Each install runs on your own machine, with your own Spotify account and your own Spotify developer credentials (a
client id and secret; the install steps show you how to get them).

- **Just the app** (most people): [`docs/INSTALL-APP.md`](docs/INSTALL-APP.md). Docker and a prebuilt image; no
  source code or development tools.
- **Full development environment** (to change the code): [`docs/INSTALL-DEV.md`](docs/INSTALL-DEV.md). Then
  `npm ci` and `npm run verify` (see [`CONTRIBUTING.md`](CONTRIBUTING.md)).

Either can be done with you by Claude Code: see [`docs/claude-start.md`](docs/claude-start.md).

## Getting started

- **Architecture**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the system as built, and the rules it rests on.
- **Contribute**: [`CONTRIBUTING.md`](CONTRIBUTING.md): how a change gets in, and the traps worth knowing first.
- **Security**: [`SECURITY.md`](SECURITY.md): report vulnerabilities privately.
- **Design records**: [`aidlc-docs/`](aidlc-docs/), starting at
  [`aidlc-docs/aidlc-state.md`](aidlc-docs/aidlc-state.md).

## Licence

[GPL-3.0-or-later](LICENSE).
