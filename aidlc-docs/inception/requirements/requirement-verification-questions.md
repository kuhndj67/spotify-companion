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
