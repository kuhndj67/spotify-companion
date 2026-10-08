# Requirements Verification Questions

Please answer each question by filling in the letter choice after the `[Answer]:` tag.
If none of the options match, choose the last option (Other) and describe your preference
after the tag. Let me know when you're done.

**Context**: Greenfield project. Selected MCP server is `marcelmarais/spotify-mcp-server`
(see `aidlc-docs/inception/research/research-findings.md` for the evaluation).

---

## Question 1
What is the primary purpose of this project?

A) A working now-playing display I will actually use day to day

B) A learning exercise for MCP and local container deployment — the display is the excuse

C) A foundation for a larger Spotify tool (agent-driven playback control, library analysis)

D) All of the above, roughly equally

X) Other (please describe after [Answer]: tag below)

[Answer]: X - Initially the goal is to provide realtime details on the artists and tracks Spotify is selecting for me (things like artist name/genre/whether they're independant or signed/track info including publishing date, number of plays, etc). Depending on the information available through the API that might include more advanced agentic features like "how well does the track align with my preferences", and "is the artist in my followed group". Longer term if possible I would like to have an agentic tool that allows me to provide more guidance for selected music... It might take the form of a music player that replaces the spotify app (less desireable) OR an automation tool that is able to automate the spotify app directly. (for example, I can't tell the spotify dj that I don't want it to play music more than 5 years old so it frequently throws in "oldies" that I have no interest in... would like THIS app to just use the spotify controls to jump to the next track when an old track is played). 

Ultimately, would like a method to more precisely tune the artist and track list that spotify plays... with the goal of avoiding music I have a low liklihood of enjoying.

## Question 2
Beyond the currently-playing track, what should the app display?

A) Just the essentials — track, artist, album, album art, progress bar

B) Essentials plus playback context — active device, volume, shuffle/repeat state

C) Essentials plus the upcoming queue ("up next")

D) Everything the MCP server exposes — B and C combined

X) Other (please describe after [Answer]: tag below)

[Answer]: X- use answer A plus internet queried additional information as discussed in Question 1.

## Question 2a
**Album artwork is not available through the MCP server.** Its `getNowPlaying` tool returns
text only — no image URL. It does return the track ID, so art could be fetched by calling
the Spotify Web API directly, but that adds a second auth path alongside MCP. How should
we handle artwork?

A) Skip album art — text-only display, stay purely MCP

B) Fetch art from the Spotify Web API directly using the track ID, accepting the second auth path

C) Fork/patch the MCP server to include the image URL in its response, and use that

X) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 3
The chosen MCP server speaks **stdio only**. What deployment topology do you want?

A) Single container — the web app spawns the MCP server as a child process (simplest; this is what the provisional scaffold does)

B) Two containers with a stdio-to-HTTP bridge (e.g. `supergateway`) — more service-oriented, more moving parts

C) Kubernetes manifests rather than Docker Compose — I want to use the k8s side of Rancher Desktop

D) Two containers AND Kubernetes — the full exercise

X) Other (please describe after [Answer]: tag below)

[Answer]: A for now but don't create technical debt for a Kubernetes solution if possible (we may need to add a database layer in the future to track information)

## Question 4
Should the app be read-only, or also control playback?

A) Read-only — display what's playing, nothing else

B) Read-only now, but design so playback control can be added later without rework

C) Include basic playback control now (play/pause/skip)

X) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 5
How should the display stay current?

A) Browser polls the backend on an interval (simplest; ~1-5s)

B) Server-Sent Events — backend pushes updates to the browser

C) WebSocket — bidirectional, needed if playback control is added

X) Other (please describe after [Answer]: tag below)

[Answer]: C because we're likely going to want some amount of playback control in the future

## Question 6
How will you handle Spotify OAuth for a containerized app? (The MCP server's normal flow
runs `npm run auth` interactively and writes a token file.)

A) Authenticate once on the host, mount the resulting token file into the container as a volume

B) Run the OAuth flow inside the container, exposing the callback port and persisting tokens to a named volume

C) Supply a pre-obtained refresh token via environment variable / `.env` file

X) Other (please describe after [Answer]: tag below)

[Answer]: X - recommend a solution that is the most straightforward for the user.

## Question 7
Who and what can reach this app?

A) Localhost only, single user, no authentication — it's my machine

B) Reachable from other devices on my LAN (e.g. a wall-mounted tablet or spare monitor)

C) LAN-reachable with some basic access control

X) Other (please describe after [Answer]: tag below)

[Answer]: A - no access outside the local machine.

## Question 8
The selected MCP server (`marcelmarais/spotify-mcp-server`) declares **no license**. How
should we proceed?

A) Fine — personal local use only, pull it as a dependency and move on

B) Vendor the source into this repo so the build is reproducible, accepting the same caveat

C) Concerned — re-evaluate toward an MIT-licensed alternative even if less actively maintained

X) Other (please describe after [Answer]: tag below)

[Answer]: A but make a note that this is a concern if the tool is useful enough to be published as an open source project.

## Question 9: Security Extensions
Should security extension rules be enforced for this project?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)

B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)

X) Other (please describe after [Answer]: tag below)

[Answer]: X - because this is a local only tool keep security as simple as possible but there should be enough to insure that it is only ever accessed by the local system.

## Question 10: Property-Based Testing Extension
Should property-based testing (PBT) rules be enforced for this project?

A) Yes — enforce all PBT rules as blocking constraints (recommended for projects with business logic, data transformations, serialization, or stateful components)

B) Partial — enforce PBT rules only for pure functions and serialization round-trips (suitable for projects with limited algorithmic complexity)

C) No — skip all PBT rules (suitable for simple CRUD applications, UI-only projects, or thin integration layers with no significant business logic)

X) Other (please describe after [Answer]: tag below)

[Answer]: B - I think this will be a fairly simple application.


---
---

# Phase 5 round — Requirements Analysis re-entered (2026-10-07)

**Why this round exists**: Phase 5 (*Share*) was added on 2026-10-06 after Phases 0–4 delivered. Its
questions were first written into a separate `plans/phase-5-plan.md`, which **is not an AI-DLC artefact**.
Moved here on 2026-10-07 (user: *"use the existing process"*); that file is now a pointer. Q2 and Q5 of the
old plan were **unit design** questions and moved to the Units Generation round
([`../plans/unit-of-work-plan.md`](../plans/unit-of-work-plan.md), *carried to U9*).

Same convention as above: fill in the letter after `[Answer]:`; choose X and describe if nothing fits.

## Context for this round

**What changes, and what does not**

| | |
|---|---|
| **Single *user*** | **UNCHANGED.** One listener, one Spotify account, one corpus **per deployment**. Each person runs their own install on their own machine (user, 2026-10-06). Not multi-tenancy |
| **Single *developer*** | **CHANGES.** Others may review, test and contribute |
| **Single *machine*** | **CHANGES.** A deployment may move to a Synology (or other) Docker host on the same LAN |

**What this invalidates**: *"commit directly to `main`"* (`CLAUDE.md`) · *local-only access is the whole
security model* (`localGuard.ts`, Question 9 above) · *the install path is known* (it is tacit, never
walked cold).

**Facts measured 2026-10-06/07**

- `localGuard.ts:141` requires a **loopback `Host`**, so every off-machine request — page **and** WebSocket
  — returns 403. That is Question 9's answer working as specified, not a defect.
- `README.md` is **463 lines** describing a *"walking skeleton"* with *"enrichment not built yet"*. No
  `LICENSE`, `CONTRIBUTING` or `SECURITY` exists.
- NFR Q9 (U5) specified `smoke` and `knip` **in CI**; `ci.yml` runs **neither** (re-verified 2026-10-07).
- Spotify Premium is required for Development Mode (since 2026-03-09).

**Explicitly NOT in Phase 5**: internet exposure · multi-tenancy or a user model · a shared corpus or
cross-user analysis · W-6's wider programme (only its two shipped guards get wired into CI).

---

## Question 11 — ⭐ Security model once the app is not loopback-only
⚠️ **Blocks off-machine deployment (U9)**, and bounds U6's upload routes (BR-46: they stay local-only until
this is answered). Today the model is **no authentication**, with reachability as the entire control
(Question 9). The app has no identity concept, so "auth" here means gating the one user.

A) **Network layer only** — keep local-only enforcement; reach the app over a VPN (Tailscale/WireGuard). App unchanged ⭐ *recommended*

B) **Reverse proxy with authentication in front** (DSM's own, Caddy, Traefik); the app gains a trusted-proxy allowance in `localGuard` ⭐ *fallback*

C) **LAN allowlist** — accept configured hosts/CIDRs. ⚠️ Admits every device on the LAN, guests and IoT included

D) **Authentication inside the app** (shared secret/password). ⚠️ Largest new surface; must be implemented twice (HTTP and the WebSocket upgrade) — the exact split that caused the 2026-09-05 `403` incident

X) Other (please describe after [Answer]: tag below)

⚠️ Whatever is chosen, HTTP and the WebSocket upgrade must keep going through **one** policy function.

[Answer]:
I think long term we're going to want to implement robust industry standard security for web apps (to allow aws hosting or other cloud deployment). What short term pattern adds the minimal technical debt for that long term vision?

## Question 12 — Ratify U6's requirements, written during its Functional Design
⚠️ **Process correction.** When W-5 was promoted to unit U6, its requirements were written *during* the
design stage instead of here first. Their content comes from your FD answers; this question puts them
through the standard step. Text: [`requirements.md` §3.7](requirements.md) and story **US-28**.

| | |
|---|---|
| FR-57 | Create backup — one download, taken without stopping recording |
| FR-58 | Restore backup — upload, compare, confirm, replace; a failing file changes nothing |
| FR-59 | Undo last restore — exactly one previous history kept |
| FR-60 / FR-61 | Credentials / automation state never in a backup, never changed by restore |
| FR-62 | Nothing left behind beyond the one previous history |
| FR-63 | Settings pop-up (backup/restore, export, diagnostics); rules stay on the main screen |
| FR-64 | Every uploaded file passes one shared admission path |
| W-9 / W-10 | Deferred: scheduled off-site backups · TLS for in-app Spotify sign-in |

A) Ratify as written

B) Ratify with amendments (describe after [Answer]: tag below)

X) Other (please describe after [Answer]: tag below)

[Answer]:
A

## Question 13 — Check-in gating, given reviewers who may not contribute
Today: direct to `main`, no protection, CI advisory.

A) Protect `main`: PRs required, CI must pass, no force-push

B) A, **plus the owner may still push directly** (admin bypass) ⭐ *recommended*

C) Full review — every change needs a second approver. ⚠️ Blocks the person doing the work on people who signed up only to look

X) Other (please describe after [Answer]: tag below)

⚠️ Whichever: the required checks must include `smoke` and `knip`, or gating formalises the gap above.

[Answer]:
B

## Question 14 — `npm run smoke` in CI
⚠️ It is **weaker in CI**: a fresh checkout has no `history.db`, `secrets/` or corrupt snapshot, so it
proves each script **loads** rather than that it **behaves**. That is still what it asserts.

A) Run it in CI as-is, and **say in the workflow** it is a link check there and a behaviour check locally ⭐ *recommended*

B) Build fixtures so CI exercises more of each script (W-6 territory)

X) Other (please describe after [Answer]: tag below)

[Answer]:
A

## Question 15 — What does the README become?
It now serves three readers: a reviewer deciding whether to look, a user installing, a contributor changing.

A) **Short README** (what it is, status, where to read more) + `docs/INSTALL.md` + `CONTRIBUTING.md` ⭐ *recommended*

B) One long README, rewritten

X) Other (please describe after [Answer]: tag below)

[Answer]:
A

## Question 16 — Licence
⚠️ There is none, so contributors have no granted rights to use or modify the work. Needed **before**
anyone is invited. The repository being private does not remove the need. *(No recommendation — your
call. Plain-language differences only, not legal advice.)*

A) **MIT** — permissive, shortest; anyone may reuse, including in closed software

B) **Apache-2.0** — permissive like MIT, plus an explicit patent grant and contribution terms

C) **GPL-3.0** — copyleft; derivatives that are distributed must stay open under the same licence

D) **No open licence** — all rights reserved, with a written collaborator agreement instead

X) Other (please describe after [Answer]: tag below)

[Answer]:
C

## Question 17 — The install routine
User direction (2026-10-06): *"what we WILL need is an install routine (either manual or AI directions)
that every user will follow to configure their install for their use (on their own machine)."* It must
cover what is tacit today: Spotify Premium + a developer app registration and redirect URI · `npm run auth`
· `secrets/*.json` from their examples · `npm run rules:init` · MusicBrainz contact (NFR-14) · `docker
compose up -d` and the `localhost:3010` check · that automation starts **off** · and, for a returning
user, U6's *Restore backup*.

A) `docs/INSTALL.md` written for a person

B) Directions written for an AI coding agent to execute

C) **One source, both readers**: a step list where every step carries its **verification command and expected output** — what a person needs to check, and what an agent needs to execute ⭐ *recommended*

X) Other (please describe after [Answer]: tag below)

⚠️ Whichever: **walked cold, on a clean machine, by someone who does not already know it.**

[Answer]:
C

## Question 17a — Whose Spotify app registration does each user use?
My reading of your direction, to confirm rather than assume:

A) **Each user creates their own** Spotify developer app (own client id/secret) during install. No registration is ever shared, so Development Mode's per-registration user limit never applies ⭐ *my reading*

B) Users share **one** registration. ⚠️ Then the per-registration user limit matters and **must be probed** — this project has been wrong about Spotify's docs six times

X) Other (please describe after [Answer]: tag below)

[Answer]:
A and also we should insure credentials are never written to the repo.

---

## Phase 5 round — answer analysis and follow-ups (2026-10-07)

**Settled**: Q12 = **A** — FR-57…FR-64 and US-28 **ratified as written** · Q13 = **B** (protect `main`, owner
may push directly; required checks include `smoke` and `knip`) · Q14 = **A** · Q15 = **A** · Q17 = **C** ·
Q17a = **A** — each user creates their own Spotify app registration, so the per-registration user limit never
applies and needs no probe.

**Still open**: **Q11** (answered with a question — see Q11a) · **Q16** (licence — blank) · and Q17a's added
clause, which is a new requirement (Q17b).

---

## Question 11a — What short-term security pattern adds the least debt toward industry-standard cloud security?

You asked this in answer to Question 11, about a long-term goal of running on AWS or another cloud.

**The industry-standard shape for a web app like this one** is *delegated authentication*: the app never sees
a password. An identity provider (OIDC — Cognito, Google, Entra ID, Auth0…) signs the user in, and something in
front of the app — a load balancer or proxy — enforces it and terminates TLS. The app receives a **signed
identity token** with each request and verifies it. On AWS, the Application Load Balancer does this natively
(its OIDC/Cognito authentication action forwards a signed JWT); Cloudflare Access, `oauth2-proxy`, Authelia and
Authentik do the same in front of any server, including a NAS. *(Product behaviour as documented — the exact
header and key-endpoint details get verified in U9's design, per this project's probe rule.)*

**So the least-debt short-term step is to build the app's half of that shape now** — the part that does not
change when the front end changes:

- `decideAccess` gains a **trusted-proxy mode** that requires a **verified identity token** on every request —
  HTTP **and** the WebSocket upgrade, still through the **one** policy function.
- What sits in front is configuration. On the NAS today: a proxy with OIDC sign-in. In AWS later: the ALB. The
  app does not change between them.
- TLS ends at that proxy, which also **unblocks W-10** (Spotify sign-in from inside the app needs HTTPS).

A) **VPN only for now** (Question 11 A). Zero app change and zero debt — but zero progress: the cloud move
starts from nothing

B) **Delegated authentication, with a signed-token check in the app** ⭐ *recommended.* Short-term front: an
OIDC-capable proxy on the NAS (choice of product is U9's). Long-term: swap in the cloud load balancer; the app
side stays

C) B's shape, but the app trusts a **plain identity header** instead of verifying a signed token. Simpler now —
⚠️ but anything that reaches the app without passing the proxy can forge it, and that is exactly the gap a
cloud move widens. Debt you would pay back first

D) **Login inside the app** (Question 11 D). ⚠️ This is the debt: sessions, password storage and a second
WebSocket path, all replaced when you move to an identity provider

X) Other (please describe after [Answer]: tag below)

⚠️ Hosting your own deployment in the cloud is still **single-user** — one person's install. This does not
reopen multi-tenancy.

[Answer]:
B - and fyi the synology nas has an OAuth service (installed but not configured to support any apps currently) if that is of any use. As we work through this it may be beneficial to find an mcp server for synology products to allow you to automate configuration tasks as needed (faster than walking me through them). The Nas hostname is SYNNAS (192.168.0.223).

## Question 17b — Enforce "credentials are never written to the repo"

Your Q17a answer adds this. **Measured 2026-10-07**: `.gitignore` ignores all of `secrets/` except the three
`*.example.json` templates, and a scan of **every commit in the history** found **no credential values** — the
only matches were the templates' placeholders (`your-spotify-client-secret`, `mb_paste…`). ⚠️ But **nothing
enforces it**: one `git add -f`, or a new credential file outside `secrets/`, and it is committed. NFR-05 covers
logs, UI and the database — not the repository.

A) Record it as a requirement; `.gitignore` stays the only control

B) **New NFR-28, enforced in CI**: a secret scanner on every push (e.g. `gitleaks`) **plus** a test that the
only tracked files under `secrets/` are `*.example.json` ⭐ *recommended*

C) B, plus a local pre-commit hook so a credential is stopped before it is committed, not after it is pushed

X) Other (please describe after [Answer]: tag below)

⚠️ With Q13 = B, the owner can push directly to `main`, so the CI check runs **after** the push. C is the only
option that stops a credential before it leaves the machine.

[Answer]:
B

---

## Phase 5 round — final answer analysis (2026-10-07) — ✅ ROUND COMPLETE

| Q | Answer | Becomes |
|---|---|---|
| 11 / **11a** | **B** — delegated authentication; the app verifies a **signed identity token** | **NFR-29** |
| 12 | A — FR-57…FR-64 and US-28 ratified | requirements §3.7 |
| 13 | B — protect `main`, owner may push directly | **NFR-30** |
| 14 | A — `smoke` in CI as a link check, said so in the workflow | **NFR-31** |
| 15 | A — short README + INSTALL + CONTRIBUTING | **NFR-33** |
| 16 | **C — GPL-3.0** | **NFR-32** |
| 17 | C — one install routine for a person and an agent, every step verifiable | **FR-65** |
| 17a | A — each user registers their own Spotify app | **FR-65** |
| **17b** | **B** — credentials never committed, enforced in CI | **NFR-28** |

No contradictions. Consistency checks:
- **Q13 = B + Q17b = B**: with an owner bypass, the CI secret scan runs **after** a direct push, so a credential
  could reach GitHub before CI flags it. Accepted knowingly (C, a local pre-commit hook, was offered).
- **Q11a = B + W-10**: TLS terminating at the proxy is what unblocks in-app Spotify sign-in later.
- **Q16 = C + the bundled MCP server** — see the finding below.

**Recorded from the Q11a answer, for U9's design** (not decided here): the user's Synology NAS has its OAuth
service installed but not configured — a candidate identity provider, to be **probed** rather than assumed;
and a Synology MCP server could let the agent perform NAS configuration directly. ⚠️ That would hand an agent
**administrator credentials to the NAS** — a credential under NFR-28 and a least-privilege question in itself.

### ⚠️ Finding raised by Q16 — the bundled MCP server has NO licence

Checked 2026-10-07: `marcelmarais/spotify-mcp-server`, which the `Dockerfile` clones and builds into the image,
has **no LICENSE file** and GitHub reports **`license: null`**. Without a licence the default is *all rights
reserved*. The app's own 95 runtime dependencies are MIT / ISC / BSD — all GPL-3.0-compatible.

What this does and does not affect (plain language, not legal advice):
- **This repository** does not contain the server's code — it is fetched at build time — so licensing *this*
  code GPL-3.0 is unaffected.
- **Each user building their own image** fetches it themselves, as today.
- ⚠️ **Publishing a built image** (a registry, a NAS package) would **redistribute** unlicensed code. **Do not
  publish an image until this is resolved** (NFR-32). Options for U8: ask the author to add a licence ·
  replace the server · keep build-it-yourself as the only install path.


---

# Addendum to the Phase 5 round — app versioning (2026-10-08)

Raised by the user before U7 began: the **schema** is versioned (v7, forward-only migrations), but is the
**app**? Owner settled by the user: **U8**, because that is when installs by someone else begin and a version
starts to matter. Only the scheme is open.

## Question 18 — The application version scheme

**Measured 2026-10-08**: the app has been `0.1.0` since the first commit — 114 commits and seven delivered units
(U0–U6) later. It is written in four places, none of them managed:

| Where | Problem |
|---|---|
| `package.json` `version` | never bumped |
| image tag `spotify-now-playing:0.1.0` (`compose.yaml`, `compose.verify.yaml`) | every build **overwrites** it, so rollback has relied on hand-made tags (`u4-rollback`, `u5-rollback`) |
| U6 backup manifest `appVersion` (BR-44.4), read from `package.json` | always `0.1.0` — **looks like provenance, records none** |
| MusicBrainz User-Agent, from `appVersion` in the gitignored `secrets/musicbrainz.json` | a **second copy, per install**, that no bump can reach — the User-Agent would misreport the version (NFR-14) |

No git tags exist. ⚠️ **The schema version stays separate** whatever is chosen: it answers *can this database be
opened*, the app version answers *which code is this*.

A) **Semantic Versioning, pre-1.0 = development.** `0.MINOR.PATCH` — MINOR per delivered unit, PATCH per fix
release (today would be `0.7.0`). `1.0.0-beta.N` pre-releases once someone else installs it (U8/U9), **`1.0.0`
when FR-65's install routine has been walked cold**. After 1.0, MAJOR means *an existing user must act by hand*
— an existing `rules.json` no longer loads, an older backup cannot be restored, or credential setup changes; the
UI's own HTTP API is not a public interface. **One source of truth** (`package.json`): the image tag, the backup
manifest and the User-Agent all derive from it, `appVersion` is removed from `musicbrainz.json`, each release
gets a git tag `vX.Y.Z`, rollback uses the previous version's image instead of `uN-rollback`, and the version is
shown in the UI / `/api/diagnostics` ⭐ *recommended*

B) As A, but with `0.x` itself carrying the stage (e.g. `0.1–0.4` alpha, `0.5–0.9` beta) instead of SemVer
pre-release labels. ⚠️ Tools that compare versions do not know that convention; `-beta.N` they do

C) Calendar versioning (`2026.10.0`). Says *when*, not *what changed*. ⚠️ Cannot express "this release breaks
your rules file", which is the one thing a user installing it needs to know

X) Other (please describe after [Answer]: tag below)

⚠️ **Until U8, every backup's manifest records `0.1.0`** — U7's included. Accepted when the owner was chosen.

[Answer]:

---

# U7 round — Requirements Analysis for Configuration Management (2026-10-08)

Per U7 FD plan **Q9 = A**: U7's requirements are ratified **here, before** its Functional Design is written — the
order U6 had to correct afterwards (Question 12). Their content comes from your answers in
[`u7-functional-design-plan.md`](../../construction/plans/u7-functional-design-plan.md) §3 and §3a. **Nothing
below is in `requirements.md` yet**; it is written there only once ratified.

## Question 19 — Ratify U7's requirements

| ID | Proposed requirement | From |
|---|---|---|
| FR-66 | **Download and upload the rules.** Download gives the current `rules.json`. An upload passes FR-64's admission path and U3's validator **before anything is written**; the user then sees a **comparison** — rules added, removed and changed, by id, and any that would become *disabled with a reason* — and confirms. Applied **without a restart**. A refused upload changes nothing, and the refusal names the rule and field | Q1, Q2a, Q3 |
| FR-67 | **A rules write can never silently lose rules.** An upload that removes **every** rule, or **more than half**, needs a typed confirmation. An upload based on an **older version** than the file now on disk (changed by hand or in another tab since it was downloaded) is **refused**. A rules write **never** changes the automation switch or halt latch | Q2b, c, e |
| FR-68 | **Undo last rules change**: exactly one previous rules file is kept and can be put back | Q1, Q2d |
| FR-69 | **Spotify credentials in Settings**: fields for client id, client secret, redirect URI and refresh token, plus *Upload spotify-config.json* that fills the same form. Saving **requires every field** and **replaces the whole set** — nothing is carried over and **no previous copy is kept**, which the UI states before saving. The secret and refresh token are **never shown back** (only *set · replaced &lt;when&gt;*); the client id is shown partly, the redirect URI in full. **Guidance text** in the section explains how to obtain each value (registering a Spotify app, running `npm run auth`) | Q4, Q4a, Q5 |
| FR-70 | **MusicBrainz contact in Settings**: one field, shown masked (`k…7@gmail.com`), refused if empty or a placeholder — the same rule the app applies at startup (NFR-14) | Q4b |
| FR-71 | **A Spotify failure is never reported as "nothing playing".** When the Spotify connection returns an error, the poll is a **failure**: the Spotify indicator shows it with the reason, and it is not counted as an idle poll (M4). A genuine *nothing playing* still reads as healthy | Q6 |
| FR-72 | **Restore can also restore rules — only if asked.** When a backup holds rules, the restore dialog says whether they are identical to or differ from the current ones and offers an **opt-in, unchecked** *"also replace my rules"*, with FR-66's comparison and FR-67's guards. The rules are applied **only if the database restore succeeds**; otherwise, and when not ticked, the current rules are untouched. **Amends BR-48.7 / FR-58** | Q7, Q7a |
| US-29 | Persona **P2 (Curator)**: *"Change my rules and my credentials from inside the app, on any machine it runs on, without ever silently losing rules or breaking recording."* | Q8 |

Unchanged and still binding: **FR-60** (restore never changes credentials) · **FR-61** (nor the automation state) ·
**NFR-01…04** (every new route is local-only until NFR-29/U9).

⚠️ **FR-71 is a precondition of FR-69**, not a companion: with FR-69's *"write it and let the user find out"*
(Q5 = B), finding out depends on a bad credential showing as a failure. It ships no later than FR-69.

A) Ratify as written ⭐

B) Ratify with amendments (describe after [Answer]: tag below)

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

## Question 19a — Where do the rules download/upload controls go?

⚠️ **FR-63** (ratified, Question 12) says *"rules and the automation switch stay on the main screen"* — the Rules
pop-up opened from it — while backup, export and diagnostics live in Settings.

A) **In the existing Rules pop-up**, beside the rules they act on; credentials go in Settings. FR-63 unchanged ⭐

B) In Settings with the other file transfers (backup, export). ⚠️ Amends FR-63

X) Other (please describe after [Answer]: tag below)

[Answer]:
A - the backup restore process can affect rules as part of it... but all other rules processes should be in the rules pop-up to keep it straightforward for users.
---
