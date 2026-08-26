# Requirements Clarification Questions

Your answers to the first round were clear, and most are settled. Two things need resolving
before I can write `requirements.md`:

1. **One contradiction** between your Q2 and Q2a answers.
2. **Several of your Q1 goals are not achievable through Spotify's API** — it was restricted
   twice since 2024, and three items on your wishlist are now unreachable. That changes what
   this product can be, so you should decide the direction rather than have me assume it.

Full evidence is in [`../research/research-findings.md`](../research/research-findings.md),
Part 2. Summary below.

---

## What I confirmed is still available

✅ Track / artist / album names · **release date** · **artist genre** (thin in practice) ·
**"is this artist in my followed list"** · full playback control (skip/pause/volume/shuffle)

**Your flagship feature works.** *"Skip anything more than 5 years old that the DJ throws in"*
is fully achievable: `getNowPlaying` → track ID → `GET /albums/{id}` for `release_date` →
`POST /me/player/next`. Every endpoint in that chain survives the restrictions.

## What is no longer achievable through Spotify

❌ **Independent vs. signed** — `label` was removed from the Album object in Feb 2026.

❌ **Number of plays** — Spotify never exposed play counts. `popularity` (0–100) was the
closest proxy and was removed from track *and* artist objects in Feb 2026.

❌ **"How well does this track align with my preferences"** — this depended on the
`audio-features` vector (tempo, energy, valence, danceability). Deprecated Nov 2024, no
replacement. The obvious substitute, AcousticBrainz, shut down in 2022 and its frozen dataset
covers nothing released after July 2022.

## Two constraints you need to know about

⚠️ **Spotify Premium is now mandatory** for the app owner as of 9 March 2026 — Development
Mode API access requires it. If you don't have Premium, this project cannot proceed at all.

⚠️ **Extended access is out of reach permanently.** It requires a registered business with
250,000 monthly active users. This project stays in Development Mode forever, so every
restriction above is permanent, not a temporary state to apply your way out of.

---

## Contradiction 1: "purely MCP" vs. enriched data

You answered **Q2: "A plus internet queried additional information"** but
**Q2a: "A — skip album art, stay purely MCP"**.

These cannot both hold. The selected MCP server exposes **no tool** for get-artist,
get-album, or check-following — so genre, release date, and follow status are all
unreachable through MCP. Even your auto-skip feature needs `release_date`, which the MCP
server cannot provide.

*(Note: album art itself is settled — you said skip it, and that stands regardless.)*

### Clarification Question 1
How should the app get enrichment data (genre, release date, follow status)?

A) **Hybrid** — keep MCP for now-playing and playback control, call the Spotify Web API directly for enrichment. One OAuth credential set serves both. Least work, keeps MCP where it earns its place

B) **Extend the MCP server** — fork it and add `getArtist` / `getAlbum` / `checkFollowing` tools, so the app stays a pure MCP client. More faithful to the MCP premise; adds a fork to maintain against an upstream with no license

C) **Drop MCP** — call the Spotify Web API directly throughout. Simplest possible code; abandons the MCP goal

X) Other (please describe after [Answer]: tag below)

[Answer]: A — resolved implicitly on 2026-08-24 by the instruction to build the read items.
Enrichment is impossible through MCP alone, so building it necessarily implied the hybrid.
Confirmed retrospectively; the hybrid is built and verified against live Spotify.

---

## Clarification Question 2: the three unreachable items

Given that label, play counts, and audio-features are gone from Spotify, how far do you want
to go to recover them?

A) **Drop them.** Build on what Spotify still gives — genre, release date, follow status, and the auto-skip feature. Revisit later

B) **Add MusicBrainz only** — free, no API key, fills the signed-vs-independent gap via label and release relationships. Rate limited to ~1 request/second

C) **Add MusicBrainz + Last.fm** — also recovers play/listener counts and community genre tags, which are richer than Spotify's sparse genres. Needs a free Last.fm API key

D) **Add external sources and build my own preference model** — record listening and skip history locally, derive preference signal from my actual behaviour rather than a vendor's audio vector

X) Other (please describe after [Answer]: tag below)

[Answer]: B, narrowed — **MusicBrainz, and pull only the label / signed-vs-independent
signal.** Not genres, not play counts.

**The reason, which reframes the feature:** the goal is not trivia about the artist. It is to
estimate **the likelihood that a given track was *promoted* into my feed rather than selected
because it fits my profile.** The working hypothesis is that signed-artist placements are
disproportionately paid promotion, and are therefore more likely to be tracks I won't enjoy.
Signed-vs-independent is a *proxy variable for promotional placement*, not an end in itself.

**Additional user story:** to collect the dataset needed for that statistical analysis, the app
must also record what Spotify actually plays for me. This needs a database (or a schema-aware
file format such as JSON Schema-validated JSON), with a schema recording, per play: the
collected information about the track, a timestamp, and **whether the track played to
completion or was skipped.**

---

## Clarification Question 3: what to build first

Your Q1 answer describes a long arc: display → enrichment → preference scoring → automated
guidance. That is several releases, not one. What should Unit 1 deliver?

A) **Now-playing display + enrichment only.** Prove the data pipeline before automating anything

B) **Display + enrichment + the auto-skip rule** ("skip tracks older than N years"). Delivers your most concrete want immediately

C) **Display + enrichment + a general rules engine** — auto-skip by age is just the first rule; also genre-based, artist-based, unfollowed-artist rules

X) Other (please describe after [Answer]: tag below)

[Answer]: C — **general rules engine.** Auto-skip by age is the first rule, not the only one;
also genre-based, artist-based and unfollowed-artist rules. Design the rule evaluation as a
first-class concept rather than hard-coding the age check.

---

## Clarification Question 4: listening history and the database

Your Q3 answer said to avoid technical debt that would block a future database and
Kubernetes move. Recording listening history is also the only viable route to preference
scoring (see CQ2 option D). When should the database arrive?

A) **Now** — add persistence in Unit 1 and start accumulating listening history immediately, since preference modelling needs months of data and starting late costs you that time

B) **Structure for it now, add it later** — repository interfaces and clean seams, in-memory implementation for now, no database container yet

C) **Not yet** — keep it stateless; revisit when preference scoring is actually being built

X) Other (please describe after [Answer]: tag below)

[Answer]: A — **now.** Persistence lands in Unit 1 and starts accumulating listening history
immediately. Reinforced by the CQ2 answer: the promotion-likelihood analysis is a statistical
model over play history, so every day without recording is a day of lost training data.

---

## Clarification Question 5: Spotify Premium

Do you have an active Spotify Premium subscription on the account you'll use?

A) Yes — Premium, ready to proceed

B) No, but I'm willing to subscribe

C) No — and I'd want to reconsider the project in that case

X) Other (please describe after [Answer]: tag below)

[Answer]: A — **Yes, Premium, ready to proceed.** The hard prerequisite is satisfied; this risk
is closed.

---

## For information — decisions I've already made from round 1

No answer needed on these; flagged so you can object if you disagree.

- **Q6 (OAuth): resolved to Option A** — authenticate on the host, mount the token file.
  You asked for the most straightforward option, and Option B turns out to be *impossible*:
  the upstream callback server binds `127.0.0.1` **inside the container**, which a published
  Docker port cannot reach, and the flow tries to open a browser that doesn't exist there.
  I've scripted Option A down to a single `npm run auth` command.
- **Q5 (WebSocket)**, **Q7 (localhost-only)**, **Q9 (minimal security, local-only enforcement)**,
  **Q10 (partial PBT)** — all settled and being applied.
- **Q8 (no license)** — noted as a blocker for open-sourcing this later; recorded in
  `aidlc-state.md` under Known Risks.
