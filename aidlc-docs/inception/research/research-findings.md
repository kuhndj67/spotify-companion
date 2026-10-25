# Research Findings: Spotify MCP Server Selection

**Date**: 2026-08-24
**Stage**: INCEPTION — Requirements Analysis (input)
**Question**: Which Spotify MCP server is the most mature choice for a locally-hosted
"now playing" display application?

---

## Why this was researched before requirements

The user's request named "the most mature spotify mcp server" as a deliverable. The choice
is not cosmetic — it constrains the requirements themselves:

- **Transport** (stdio vs. HTTP/SSE) determines whether the web app and the MCP server can
  be separate containers or must share one.
- **Auth model** determines what secrets the container needs and how first-run onboarding works.
- **Tool surface** determines whether "now playing" is a first-class tool or must be
  assembled from lower-level calls.

So this spike ran first, and its result feeds the clarifying questions.

---

## Candidates evaluated

| Repo | Lang | Stars | Last push | Now-playing tool | Notes |
|---|---|---:|---|---|---|
| **marcelmarais/spotify-mcp-server** | TypeScript | 435 | 2026-08-21 | ✅ `getNowPlaying` | Actively maintained; explicit device/volume/progress data |
| varunneal/spotify-mcp | Python | 613 | 2026-03-11 | ⚠️ not first-class | **Self-declared inactive**: "Most PRs will not be merged" |
| tylerpina/spotify-mcp | TypeScript | low | — | partial | Broad library/playlist focus, smaller community |
| igorgarbuz/spotify-mcp | Node | low | — | partial | Playback + playlist control |
| darrenjaworski/spotify-mcp | TypeScript | low | — | partial | Published to npm |
| Carrieukie/spotify-mcp-server | Kotlin | low | — | partial | JVM runtime — heavier container |
| thebigredgeek/spotify-mcp-server | TypeScript | 0 | — | ❌ not listed | Strong token-handling design, but no traction |

Star counts and push dates retrieved from the GitHub API on 2026-08-24.

---

## Selection: `marcelmarais/spotify-mcp-server`

**Rationale**

1. **It is actively maintained.** Last push three days before evaluation. The higher-starred
   alternative (`varunneal/spotify-mcp`, 613 stars) is explicitly declared inactive by its
   own maintainer as of March 2026 — raw star count is a lagging indicator here, and
   "most mature" should mean *maintained*, not *most historically popular*.
2. **`getNowPlaying` is a first-class tool** and returns exactly the payload this project
   displays: track name, artist, album, playback progress, duration, playback state,
   active device, volume, and shuffle/repeat state. No assembly from primitives needed.
3. **`getQueue` is available** for a natural "up next" extension without adding a dependency.
4. **TypeScript/Node** matches a Node-based web app — one runtime in the container image,
   one toolchain, smaller image than the Kotlin/JVM alternative.

**Known trade-offs (carried into requirements)**

- **`getNowPlaying` returns markdown text, not JSON.** Inspection of `src/read.ts` confirms
  the handler builds a template literal:

  ```
  # Currently Playing

  **Track**: "Song Name"
  **Artist**: Artist One, Artist Two
  **Album**: Album Name
  **Progress**: 1:23 / 3:45
  **ID**: 4cOdK2wGLETKBW3PvgPWqT

  **Device**: MacBook Pro (Computer)
  **Volume**: 75%
  **Shuffle**: Off | **Repeat**: off
  ```

  The web app must therefore **parse markdown** to get structured fields. This is normal for
  MCP (tools are designed for LLM consumption, not programmatic clients) but it is a brittle
  seam: a template change upstream silently breaks parsing. The scaffold isolates this in a
  single module with the raw text always passed through for debugging.

- **No album artwork is available via MCP.** The `getNowPlaying` template contains no image
  URL. The track **ID** is returned, so artwork could be fetched — but only by calling the
  Spotify Web API directly (`GET /v1/tracks/{id}`), which means a second auth path alongside
  MCP and partially defeats the "MCP-only" premise. This materially affects how good the
  display can look, so it is raised explicitly as Q2a.

- **No license file.** The repository does not declare a license. This is a real
  consideration for anything beyond personal local use — it is raised as Q8.
- **stdio transport only.** No HTTP/SSE mode is documented. A two-container split would
  need a stdio↔HTTP bridge (e.g. `supergateway`). This drives Q3.
- **17 open issues**, normal for a project of this size, but worth watching.
- **Spotify Premium is generally required** for playback-control endpoints. Read-only
  "currently playing" is less restricted, but this should be confirmed against your account.

---

## Architectural consequence

`getNowPlaying` over stdio means the MCP **client** must be able to spawn the MCP server
process. Two viable topologies:

```
Option A — single container (default assumption in the scaffold)
+--------------------------------------------------+
|  Container: now-playing                          |
|                                                  |
|  [ Browser ] --HTTP--> [ Express app ]           |
|                             |                    |
|                        stdio (child process)     |
|                             v                    |
|                    [ spotify-mcp-server ] --HTTPS--> Spotify Web API
+--------------------------------------------------+

Option B — two containers, needs a bridge
+---------------------+        +----------------------------+
| Container: web app  | -HTTP->| Container: bridge + MCP     | --HTTPS--> Spotify Web API
| [ Express + UI ]    |        | [ supergateway -> stdio ]   |
+---------------------+        +----------------------------+
```

Option A is simpler, has fewer moving parts, and is what the provisional scaffold implements.
Option B is more faithful to a service-oriented deployment and is the better answer if this
is meant as a Kubernetes learning exercise on Rancher Desktop. This is Q3.

---

## Worth stating plainly

For a read-only now-playing display, MCP is **not** the minimal path — the Spotify Web API's
`GET /v1/me/player/currently-playing` would do this in a few dozen lines with no MCP layer
at all. MCP earns its place here if the intent is to (a) learn/exercise MCP, or (b) leave the
door open for an LLM agent to drive playback later. The user asked for MCP, so the design
uses MCP; this note exists so the trade-off is on the record rather than assumed. Q1 and Q2
check which of those intents applies.

---

---

# Part 2: Spotify Web API Capability Audit (2026)

**Triggered by**: the Question 1 answer, which expanded intent well beyond a now-playing
display — artist genre, signed-vs-independent status, play counts, release dates,
preference-alignment scoring, follow status, and eventually auto-skipping tracks.

**Finding**: Spotify has restricted its Web API twice since 2024, and **several of these
goals are no longer achievable through Spotify's API at all**. This needs to be settled
before requirements are written, because it changes what the product can be.

## The two restriction waves

**27 November 2024** — restricted for apps without prior extended access:
Related Artists · Recommendations · **Audio Features** · **Audio Analysis** ·
Get Featured Playlists · Get Category's Playlists · 30-second preview URLs ·
algorithmic and Spotify-owned editorial playlists.

**6 February 2026** (Development Mode apps, migration deadline **9 March 2026**):
- **Spotify Premium is now mandatory for the app owner.**
- 1 Client ID per developer; 5 users per app.
- Search limit reduced: max 50 → **10**, default 20 → **5**.
- Batch/multi-get endpoints removed (`GET /tracks`, `/albums`, `/artists`, …) — fetch individually.
- Removed: browse categories, new releases, **artist top tracks**, public user profiles, `GET /markets`.
- **Fields stripped from responses** (verbatim from the migration guide):
  - **Track**: `available_markets`, `linked_from`, **`popularity`**
  - **Album**: `album_group`, `available_markets`, **`label`**, **`popularity`**
  - **Artist**: `followers`, **`popularity`**
  - **User** (`GET /me`): `country`, `email`, `explicit_content`, `followers`, `product`

Extended Quota Mode is exempt — but it requires a registered business and **250,000 monthly
active users**. A personal tool cannot qualify. **This project is permanently in Development Mode.**

## Scorecard against the Question 1 wishlist

| Goal (from Q1/Q2) | Status | Detail |
|---|---|---|
| Track / artist / album names | ✅ Available | `getNowPlaying` already returns these |
| **Release date** | ✅ Available | `release_date` on `GET /albums/{id}` — survives |
| **Artist genre** | ⚠️ Available but thin | `genres` not in the removed-fields list. In practice Spotify's artist genres are frequently empty, especially for smaller artists |
| **Is artist in my followed group** | ✅ Available | `GET /me/following/contains` survives |
| Playback control (auto-skip) | ✅ Available | next/previous/pause/seek/volume/shuffle/repeat all survive |
| **Independent vs. signed** | ❌ **Gone** | `label` was the only Spotify signal and was **removed from the Album object** in Feb 2026 |
| **Number of plays** | ❌ **Never existed** | Spotify has never exposed play counts. `popularity` (0–100) was the closest proxy and is **now removed** from track *and* artist |
| **"How well does this align with my preferences"** | ❌ **Gone** | `audio-features` (tempo, energy, valence, danceability…) was the mechanism. Deprecated Nov 2024, no replacement |
| Recommendations / related artists | ❌ Gone | Deprecated Nov 2024 |

**Three of the wishlist items are unreachable via Spotify.** They need external data or a
different approach — see below.

## The headline result: the auto-skip feature works

The single most concrete thing asked for — *"tell the Spotify DJ I don't want music more
than 5 years old, and skip it automatically"* — is **fully achievable**:

```
getNowPlaying  ->  track ID
GET /albums/{id}   ->  release_date        (survives Feb 2026)
   if (now - release_date) > threshold
POST /me/player/next                       (survives Feb 2026)
```

This is worth stating plainly because it is the highest-value, lowest-risk item in the
entire request, and it is unaffected by every deprecation above.

## External enrichment options for the three gaps

| Source | Fills | Cost / constraints |
|---|---|---|
| **MusicBrainz** | Label, release relationships → signed vs. independent | Free, no API key. Requires descriptive User-Agent, **~1 request/second**. Match via ISRC or artist+title |
| **Last.fm** | Play counts, listener counts, community tags (genre) | Free API key. Good coverage of exactly the "number of plays" gap |
| **Discogs** | Label, pressing detail | Free key; rate limited; strongest for physical releases |
| **AcousticBrainz** | Audio features (the deprecated Spotify vector) | ⚠️ **Service shut down Feb 2022.** Only a frozen July 2022 dump exists — nothing released after that date, ~60% coverage of recent releases, requires MBIDs. Not viable for current music |
| **Self-hosted Essentia** | Audio features, computed locally | The toolkit AcousticBrainz used. Needs audio to analyse — which Spotify does not give you. Impractical here |

**On preference alignment specifically**: since neither Spotify audio-features nor
AcousticBrainz can serve current tracks, the realistic path is to **build preference signal
from your own behaviour** — release-year distribution, genre/tag frequency, artists you
follow, saved-track overlap, and skip history that this app records. That is a data-collection
problem, not an API problem, and it is a strong argument for the database layer already
anticipated in the Question 3 answer.

## Consequence: the MCP server does not cover this use case

`marcelmarais/spotify-mcp-server` exposes no tool for **get artist**, **get album**, or
**check-following**. So the enrichment data — genre, release date, follow status — **cannot
be obtained through the selected MCP server at all**, and `getNowPlaying` returns only
names plus a track ID.

This collides with the Question 2a answer ("stay purely MCP"). The options are:

- **(a) Hybrid** — MCP for playback/now-playing, Spotify Web API directly for enrichment.
  One OAuth credential set serves both; the MCP server's own `spotify-config.json` tokens
  can be reused. Least work, keeps MCP where it adds value.
- **(b) Extend the MCP server** — fork and add `getArtist` / `getAlbum` / `checkFollowing`
  tools. Keeps the app purely an MCP client; adds a fork to maintain against an
  unlicensed upstream.
- **(c) Drop MCP** — go direct to the Web API throughout.

Also note: the MCP server's `getAlbums(albumIds)` tool calls the **batch** albums endpoint,
which was **removed** in February 2026. That tool is already broken in Development Mode.

## Question 6 resolved (the answer was "recommend the most straightforward option")

**Recommendation: Option A — authenticate on the host, mount the token file.**

Not because it is the tidiest, but because **Option B cannot work**. Inspection of the
upstream `authorizeSpotify()` shows the callback server binds container-loopback:

```js
server.listen(Number.parseInt(port), '127.0.0.1', () => {
```

A published Docker port forwards to the container's external interface, not its loopback,
so a host browser could never reach the callback. The flow also calls `open(authorizationUrl)`,
and there is no browser in the container.

Option A is made straightforward by scripting it: one `npm run auth` on the host handles
clone, build, credential prompt, browser flow, and token placement.

---

---

# Part 3: Empirical Verification (2026-08-24)

**This part corrects two claims in Part 2.** Part 2 was derived from Spotify's published
migration guide. Part 3 is derived from **live calls with a real Development Mode token**.
Where they disagree, Part 3 is authoritative — documentation described the removed-fields
list, but the live API is more restricted than that list implies.

## Correction 1: `GET /me/following/contains` is 403, not available

Part 2 listed this endpoint as surviving. It does not.

```
Granted scopes on the token include: user-follow-read   ✅ confirmed
GET /v1/me/following/contains?type=artist&ids=...    ->  403 Forbidden
```

The scope is genuinely present — this was verified by inspecting the `scope` field returned
with the refresh-token grant. The endpoint itself is restricted in Development Mode.

**Workaround, implemented and working**: `GET /me/following?type=artist` returns **200**.
The full followed-artists list is fetched once (cursor-paginated, 50 per page), cached for
10 minutes, and membership is checked locally.

This is strictly better than the original design: following changes rarely, so one paginated
fetch serves every track, and a track change now costs **zero** follow-related API calls.
Verified against a live account: 42 followed artists cached, membership resolving in 0 ms.

## Correction 2: artist genres are not returned at all

Part 2 said `genres` was "not in the removed-fields list" and therefore probably available
but sparse. In practice the field is **entirely absent** from the response.

```
GET /v1/artists/{id}  ->  200
Fields returned: external_urls, href, id, images, name, type, uri
```

No `genres`, no `followers`, no `popularity`. The `GET /artists/{id}` call was **removed
from the enrichment chain** rather than left in as dead weight — it returned nothing the app
displays. Genre now requires an external source (CQ2: MusicBrainz tags or Last.fm tags).

## Confirmed working, end to end

| Step | Result |
|---|---|
| Token refresh | ✅ |
| `GET /me` | ✅ |
| MCP server connect | ✅ 30 tools |
| MCP `getNowPlaying` | ✅ **markdown parser verified against real output** |
| `GET /tracks/{id}` | ✅ release date, album type, track number, explicit |
| `GET /me/following` | ✅ 42 artists |
| Follow status (local) | ✅ |

## Correction 3: album artwork is available at zero extra cost

Q2a was answered "skip album art" on the premise that artwork required a second auth path.
That premise was wrong. `track.album.images` is returned by the `GET /tracks/{id}` call the
enrichment chain **already makes** — no extra request, no extra auth, no extra scope.

Verified live:

```
GET /v1/tracks/{id} -> album.images = [
  { url: "https://i.scdn.co/image/ab67616d0000b273...", width: 640, height: 640 },
  { url: "https://i.scdn.co/image/ab67616d00001e02...", width: 300, height: 300 },
  { url: "https://i.scdn.co/image/ab67616d00004851...", width:  64, height:  64 }
]
Image fetch -> 200 image/jpeg, host i.scdn.co
```

Sizes vary by album, so the app selects by measured width rather than array position:
largest for the blurred backdrop, ≤400px for the cover thumbnail, smallest as a fast first
paint. **Artwork was added on 2026-08-24 at the user's direction, reversing Q2a.**

## Net effect on the enrichment chain

Went from 3 API calls per track to **1** (`GET /tracks/{id}`), plus one cached list fetch
per 10 minutes. Available fields: release date, release precision, **age in years**, album
type, total tracks, track number, explicit flag, primary artist, follow status, Spotify URL.

Still unavailable from Spotify: genre, label/independent status, play counts, audio features.

---

---

# Part 4: Saved-Track ("Liked") Status — Empirical Probe (2026-08-26)

Prompted by the question *"can the API show the favourite status for a track?"*. Probed live
rather than answered from documentation, given Part 3's record.

## Result: available, but only through the list endpoint

| Endpoint | Status | Detail |
|---|---|---|
| `GET /me/tracks/contains?ids={id}` | ❌ **403 Forbidden** | Despite `user-library-read` present on the token |
| `GET /me/tracks?limit=n` | ✅ **200** | Returns the saved set — **596 tracks** on this account |
| `GET /me/albums/contains?ids={id}` | ❌ **403 Forbidden** | Same restriction |

Token scopes confirmed at probe time include `user-library-read` and `user-library-modify`, so
this is an endpoint-level restriction, not a scope problem.

## The generalisable pattern

This is the **third** `/contains` endpoint found blocked while its list counterpart works:

| Blocked | Working alternative | Found |
|---|---|---|
| `GET /me/following/contains` | `GET /me/following` | Part 3 |
| `GET /me/tracks/contains` | `GET /me/tracks` | Part 4 |
| `GET /me/albums/contains` | `GET /me/albums` (untested, expected 200) | Part 4 |

**Development Mode appears to restrict the membership-check family generally, while leaving the
list endpoints open.** That is worth stating as a rule of thumb: it predicts behaviour for
endpoints not yet tried, and it means the workaround is always the same — fetch the set once,
cache it, resolve membership locally.

Ironically the restricted endpoints are the *cheaper* ones. Blocking them forces clients to
download entire collections to answer a one-bit question.

## Cost of the workaround

596 saved tracks = **12 requests** at `limit=50`, cached with a TTL — the same shape as the
existing `FollowedArtistsCache`, which already does exactly this for 42 followed artists.

Refreshing periodically rather than per track means a track change costs **zero** additional API
calls, as with follow status.

## Why this matters more than follow status

**Liking a track is an explicit, per-track positive judgement.** Following an artist is a coarser
signal — it says something about a body of work, not about the track playing now.

For the promotion hypothesis (R1) it is also a **control variable**: an already-liked track is
self-evidently profile-matched rather than promoted, so liked status separates "Spotify played me
something I already chose" from "Spotify introduced something new" — which is the population the
hypothesis is actually about.

## A subtlety worth designing around

Liked status must be **snapshotted at play time**, as `following` already is. But there is a
second-order signal hiding here:

> **A track that was not liked when it started playing, and *is* liked shortly afterwards, was
> almost certainly just liked because of that play.**

That transition is arguably the strongest positive signal the Spotify API can yield — stronger
than a completion, because completion can be passive and liking cannot. Capturing it needs the
before value stored per play (which the snapshot gives) plus a later comparison against the
refreshed set.

Not in scope for U1; recorded so the option is not lost.

---

## Part 4b: Liked-status transitions — the four-state model (2026-08-26)

The user observed that liked status across a play forms a natural enumeration: the 2×2 over
*(liked at start, liked at end)*. That is exhaustive and correct.

| Start | End | State | Signal |
|---|---|---|---|
| ✗ | ✓ | **`liked-during`** | **Strongest positive available.** An explicit, deliberate act caused by this play |
| ✓ | ✗ | **`unliked-during`** | **Strongest negative available** — stronger than a skip, which can be idle impatience. Removing a track is deliberate |
| ✓ | ✓ | `kept-liked` | Positive but passive. Interesting mainly *in combination* — liked yet skipped is a real signal about mood or overplay |
| ✗ | ✗ | `kept-unliked` | **The null case.** See the caution below |
| — | — | `unknown` | Needed as a fifth member: the liked set may be unavailable, so either end can be unknown (project tri-state discipline) |

### ⚠️ The two static states are not symmetric in informativeness

`kept-liked` and `kept-unliked` look like a matched pair and are not one.

The user's framing — *"indicating I chose not to change the status"* — holds well for `kept-liked`:
the track was in the library, it stayed there, and a skip against that background says something.

It **over-reads** `kept-unliked`. That state covers the overwhelming majority of plays, nearly all
of which involve no like/unlike consideration whatsoever. **Absence of an action is not evidence of
a decision.** Treating it as one would import a deliberate-choice interpretation into the baseline
population of a statistical model — precisely the kind of error that is invisible once the data is
aggregated.

Recommendation: keep the four states, but treat `kept-unliked` as the *reference level* in any
analysis rather than as an observed choice.

### Detectability is also asymmetric — and this shapes the implementation

Probed 2026-08-26: **`GET /me/tracks` is ordered most-recently-saved first**, and every item
carries `added_at` with second precision.

```
0  2026-08-25T01:41:24Z  Mason Jar
1  2026-08-25T01:36:03Z  HOT!
2  2026-08-25T01:26:06Z  Revenge And a Little More
...
593 (of 596)  2025-03-12T14:25:13Z  M.I.A
```

| Transition | Cost to detect | Attribution quality |
|---|---|---|
| **`liked-during`** | **1 request** — page 1 only; a new like appears at position 0 | **Definitive.** `added_at` falling inside the play's window proves the like belongs to that play, rather than being inferred |
| **`unliked-during`** | Expensive — unliking leaves **no tombstone and no timestamp**. The row simply vanishes | Imprecise: only "sometime since the last refresh" |

**The cheap trick for unlikes**: an unlike is only *possible* when `likedAtStart` was true. The
cache knows that track's `added_at`, hence its approximate rank in the list, so a targeted
`offset` probe of a small window confirms presence or absence in ~1–2 requests rather than a
full 12-request diff.

Net cost: **1 request per play** in the common case, 2–3 when the played track was already liked.
That is affordable, where a full-set refresh per play (12 requests × ~200 plays/day) would not be.

### Design consequence

Store the two booleans (`likedAtStart`, `likedAtEnd`) as **evidence**, and derive the enumeration
from them — the same separation of observation from judgement used for play outcomes. The
difference: unlike an observation trail, these are point-in-time facts that cannot be
reconstructed later, so they must be captured correctly at the time. Recording `added_at` alongside
gives the transition an exact timestamp rather than an inference.

---

# Part 5: MusicBrainz — first live probe (2026-08-26)

**Until this probe, every U2 assumption was documentation-derived.** MusicBrainz had never been
called by this project. Probed against the **19 distinct ISRCs actually in `history.db`** — real
listening, not a curated sample. Raw responses retained.

`User-Agent: SpotifyNowPlaying-Research/0.1 ( <email> )` (NFR-14), 1.2 s spacing (NFR-15).
**47 requests total.** No rate-limit rejection, no API key needed. Latency 0.1–6.7 s, highly
variable — confirming NFR-16 (never on the display path) is a real constraint, not a precaution.

## Correction 4: `inc=` is silently ignored on the ISRC endpoint

The obvious first attempt — `GET /ws/2/isrc/{isrc}?inc=releases` — returns **200 with recordings
and no releases**. Not an error, not a warning: the parameter is dropped. Nineteen ISRCs came back
looking like "MusicBrainz has no releases for anything I listen to", which is false.

**A wrong request shape here is indistinguishable from absent data.** Had this not been checked
against a track known to have 44 releases, it would have been recorded as a coverage finding.
Fourth instance of the documentation-vs-reality pattern in this project, and the first where the
wrong answer was *plausible* rather than an error code.

### The chain that works — 2 requests per track

```
1.  GET /ws/2/isrc/{isrc}                       -> recording MBID   (404 if unknown)
2.  GET /ws/2/release?recording={mbid}&inc=labels&limit=100
                                                -> releases, each with label-info
```

Step 2 is a **browse**, not a lookup, and `inc=labels` *is* honoured there. This matches R11's
"2 MusicBrainz calls" estimate exactly. Label classification adds `GET /ws/2/label/{mbid}?
inc=label-rels`, but labels are a small recurring set — cache by label MBID, not per track.

## Coverage — measured, not estimated

| Stage | Result |
|---|---|
| ISRC resolves to a recording | **13 / 19 — 68.4 %** |
| …and yields a **named** label | **11 / 19 — 57.9 %** |
| Resolved, but label is `[no label]` | 2 (Imminence, Red Leather) |
| ISRC unknown to MusicBrainz (404) | 6 |

### ⚠️ R2 is confirmed on real data, and the bias is recency

| Spotify release year | Label resolved |
|---|---|
| 2002 – 2021 | **5 / 5 — 100 %** |
| 2022 – 2026 | **6 / 14 — 43 %** |

The gap is not random. Audioslave (2002) and Slipknot (2004) resolve richly; the misses are
Prof, Ren singles, BOVSKI, Ark Woods and a 2022 remix — recent independent releases, **exactly the
population the promotion hypothesis is about**. R2 moves from "feared" to **measured**: any
analysis that drops `unknown` rows silently drops the newest independent music first.

**All five `QZ*`-prefixed ISRCs missed** (0/5), while `USUM`(Universal), `USSM`(Sony) and
`GBUM`(Universal UK) all resolved. The ISRC registrant prefix is available for **100 %** of tracks,
including the 404s — see the classification signals below.

## ⚠️ "The label" is not a single value

This is the finding that most affects the design. A recording maps to *many* releases, and they
carry **different labels — sometimes different corporate parents**.

| Track | Releases | Distinct labels |
|---|---|---|
| Slipknot — Duality | **50** | **12** — Roadrunner, Warner Music France, Rhino, X5, Sum, EMI… |
| Audioslave — Like a Stone | **44** | **10** — **Epic (Sony) *and* Interscope / A&M / UMe (Universal)** |
| NF — The Search | 3 | 3 — NF Real Music, Capitol, Caroline |

FR-13 already says *store per-signal votes, not a boolean*. The probe shows the ambiguity starts
**one step earlier than FR-13 assumed** — not in classifying the label, but in deciding which label
is even the input.

### Narrowing by Spotify's album title and date

Spotify supplies `album_name` and `release_date`. Matching those against the release list:

| Strategy | Behaviour on the 13 resolved tracks |
|---|---|
| Album title **and** exact date | Precise where it fires (Audioslave 44 → **1**), but **fires on only 8/13**. Fails on year-only Spotify dates (Slipknot `2004`) and deluxe reissues (DPS `-!- (Deluxe)`) |
| Album title only (normalised) | **Fires on 13/13.** Slipknot 50 → **1 release → Roadrunner Records**, which is correct |
| Any release | Maximum recall, maximum noise |

A **cascade** — title+date, else title, else all — is the only strategy that both fires reliably
and narrows meaningfully. Title-only reduced Slipknot from 12 labels to the right one.

## Classification signals — all three exist, and they disagree

FR-13's three signals were speculative. All three are now confirmed present, with real
disagreements:

**Signal 1 — label `type`.** MusicBrainz types labels: `Imprint`, `Original Production`,
`Distributor`, `Publisher`, or **null**. ⚠️ **`Publisher` is not a record label.** Faouzia's only
"label" is `Faouzia Music`, type **Publisher**, disambiguation `SOCAN` — a publishing entity.
Faouzia records for Atlantic. **Taking it as the label yields a confidently wrong "independent"
verdict.** Publisher-typed entries must be excluded, or independence is over-counted exactly where
majors use publishing subsidiaries.

**Signal 2 — label relationships.** `inc=label-rels` returns three distinct relation types —
`imprint`, `label ownership`, `label distribution` — each with a direction. They are **not
interchangeable**:

| Label | Walks to | Correct? |
|---|---|---|
| Epic | `imprint` → Sony Music Entertainment Inc. | ✅ Sony |
| Interscope Records | `imprint` → UMGRI Interscope; disambiguation *"part of UMG Recordings, Inc."* | ✅ Universal |
| Roadrunner Records | `imprint` → Elektra Music Group; `distribution` → Atlantic Records Group | ✅ Warner |
| **Spinefarm Records** | `distribution` → **[PIAS] UK Ltd.** (an indie); `ownership` → Candlelight | ❌ **Spinefarm is Universal-owned** |

**Spinefarm is R3 happening on real data**: following `distribution` says independent, and the
truth is Universal. Ownership and distribution must be voted separately, never merged.
`broke` (Marino, bbno$) is typed `Distributor`, *"LA-based independent label & distributor"* —
correct, and readable from `type` alone. `CloudKid` and `The Other Songs` have **no type and no
useful parent**: present in MusicBrainz, unclassifiable from it.

**Signal 3 — the ISRC registrant prefix.** Free, no request, and — uniquely — **available for the
6 tracks MusicBrainz cannot resolve at all**. `USUM`→Universal, `USSM`→Sony, `GBUM`→Universal UK
all matched the label MusicBrainz returned. `QZ*`/`QT*`/`GX*` are indie-distributor ranges
(DistroKid, CD Baby, TuneCore) and were exactly the ranges that 404'd. Weakest signal — a
distributor prefix says nothing about a deal — but it is the **only** signal with full coverage.

## Fallback search for the 6 misses — recovers little, and misattributes

Tested `GET /ws/2/recording?query=recording:"…" AND artist:"…"`:

| Track | Result |
|---|---|
| BOVSKI — Low Again | ✅ count=1, score 100, exact |
| Prof — Kia Boy | ✅ count=1, score 100, exact |
| Mjhanks — Parachute (Remix) | ⚠️ Found, but the recording has **no releases** — no label obtainable |
| Ark Woods — Soul in Love | ❌ count=0 |
| Prof, Ren — Pain Salesmen | ❌ count=0 |
| **Ren — Vincent's Tale · Starry Night Act III** | 🚨 **count=7; the top two hits score 100 and are *different tracks*** (*The Bedroom*, *Self Portrait*). The near-correct *Starry Night, Act II* scores **95** — lower |

**Net: 2 clean recoveries out of 6, and one confident wrong answer.** The Ren case is the
important one — `score` does not rank correctness, so "take the top hit" would attach another
track's label to the play, and nothing downstream could detect it. A wrong label is worse than
`unknown` here: `unknown` is visible in the coverage counts (FR-51), a misattribution is not.

## Backfill cost

47 of the 71 recorded plays are backfilled and carry **no ISRC** (open item 3). They do carry
`track_id`, so ISRC is recoverable via `GET /tracks/{id}` — 47 Spotify requests, one-off. Whether
that is worth spending is a Functional Design question, not a foregone conclusion.

---

# Part 6: MusicBrainz — second probe, artist-level (2026-08-26)

Triggered by the user's Q5 answer: *"prioritise accuracy in the **Artist Is Independent**
determination even if it ultimately misses some independent products."* Two things in that sentence
warranted testing rather than interpreting — the **precision-over-recall** principle, and the fact
that it is framed at the **artist** level, where U2 had been designed at the release level.

## ⚠️ Correction 5: `[no label]` is NOT an assertion of self-release

Part 5 recommended treating the `[no label]` sentinel as `independent`, reasoning that it is an
assertion rather than an absence. **That recommendation was wrong.** Tested by asking whether the
same artists carry real labels on their *other* MusicBrainz releases:

| Artist | Releases | Named label | `[no label]` | Labels actually present |
|---|---|---|---|---|
| **Imminence** | 66 | **41** | 8 | Arising Empire, Sumerian Records, **Virgin Music Group** |
| **Red Leather** | 25 | 6 | 8 | EMPIRE, Sounds Good |

Both of the sample's `[no label]` tracks belong to artists MusicBrainz **knows to have labels** —
one of them Virgin Music Group, i.e. **Universal**. The sentinel reflects *incomplete per-release
data entry*, not a claim that the release had no label.

Under the Part 5 recommendation both plays would have been classified **`independent`** — wrong,
and wrong in the direction that **falsely supports the promotion hypothesis**. This is the
"confident wrong data" failure mode arriving in the one place a recommendation had waved it
through. `[no label]` must be `unknown`.

## 🔑 An exact Spotify → MusicBrainz artist join exists

The most consequential finding in U2 so far, and it was not known at Application Design.

```
GET /ws/2/url?resource=https://open.spotify.com/artist/{spotifyArtistId}&inc=artist-rels
   -> relations[].artist.id   (MusicBrainz artist MBID)
```

MusicBrainz stores streaming links as first-class `url` entities. **The Spotify artist ID we
already hold is therefore a direct, exact key** — no name matching, no `score`, no misattribution
hazard of the kind that made search fallback unsafe in Part 5.

The hazard it removes is real: MusicBrainz holds **three** artists named `Prof`. Name search
happened to rank the right one first (score 100 vs 82), but nothing guarantees that, and the Part 5
Ren case proved `score` does not rank correctness. The URL join returned the same MBID **by
construction rather than by luck**. It also resolved `Mjhanks`, which name search failed to find
at all.

## Artist-level coverage, measured on the same 19 tracks

Directly comparable to Part 5's release-level figures:

| Level | Coverage |
|---|---|
| Release-level (ISRC → recording → releases) | **11 / 19 — 57.9 %** |
| Spotify artist URL → MusicBrainz artist | **15 / 17 — 88.2 %** |
| …and artist has ≥ 1 named label | **13 / 17 — 76.5 %** |

Artist-level recovers **5 of the 6 ISRC 404s** (BOVSKI, Ark Woods, Prof ×2, Ren) **and both
`[no label]` cases**. Misses: `bbno$` and `Silent Child` have no MusicBrainz artist behind the
Spotify URL; `Faouzia` and `Mjhanks` resolve but carry no named label.

## ⚠️ But artist-level answers a *different question*

It is not a strictly better version of the release-level signal, and one track in the sample proves
it:

> **Token — *Full Bag***. Release-level says **`Never Too Different`** (an independent).
> Artist-level says **`Atlantic`**. Both are true: Token is an Atlantic artist who put *this*
> release out independently.

That is the distinction between *"is this artist signed?"* and *"was this particular track a
label release?"* — and the promotion hypothesis arguably wants the first as a **control** and the
second as the **treatment**. They should be stored as **separate fields**, never merged into one
"label" column.

**Two artist-level noise sources to handle:**
- **Bootlegs and regional licensees inflate the label set.** Slipknot's 100 releases yield
  Roadrunner alongside `Smokin' Cactus`, `Metal Mind Records`, `Jigu Records Corporation`.
  Weight by release count, or restrict to `status = Official`.
- **Career aggregation ignores time.** Audioslave shows Epic, Interscope, Columbia, Polydor,
  Geffen across a career. For "is this artist signed" that is fine; it is not a statement about any
  one release.

**Cost**: 2 requests per *artist* (URL join + release browse), and artists repeat heavily across a
listening history — so a per-artist cache is far more effective than a per-track one.

## Machine 2's SSO Server as an OIDC provider (U11, 2026-10-24)

Probed from this machine, unauthenticated, after the owner installed *SSO Server*, imported a **test** certificate
for `<Machine 2's name>.local` (a CA generated on this machine, name-constrained; no private key of the CA on the NAS), set the
Server URL to `https://<Machine 2's name>.local:5001` and enabled OIDC. Before enabling, the same address returned
`400 {"error":"not enabled"}`; before installing, `403`.

| | Measured |
|---|---|
| Discovery | `GET /webman/sso/.well-known/openid-configuration` → `200` JSON |
| **Issuer** | `https://<name>.local:5001/webman/sso`: **derived from the Server URL**, so changing that URL changes the issuer every token carries |
| Keys | `jwks_uri` `…/webman/sso/openid-jwks.json` → `200`: **one RSA 2048-bit key, `alg RS256`, `use sig`**, with a `kid` |
| ID-token signing | `RS256` only |
| Claims offered | `aud`, `email`, `exp`, `groups`, `iat`, `iss`, `sub`, `username` |
| Scopes | `openid`, `email`, `groups` |
| Flows | `authorization_code` and `implicit`; response types include `code`; PKCE `S256` **and `plain`** |
| Client authentication | `client_secret_basic`, `client_secret_post` |
| ⚠️ TLS | Port 5001 still **presents DSM's factory certificate** (`CN = synology.com`) for `<Machine 2's name>.local`, so the test certificate was accepted by the Server URL check but is **not being served**. DSM's "valid certificate" check therefore did not verify what is served (inference: it checks that a certificate covering the name exists in its store) |

**Then, the same day: SSO Server on its own port, with the test certificate served.** *Login Portal → Applications →
Synology SSO → customized HTTPS port* (`5443` refused, *"reserved for system use only"*; `9443` accepted), the test
certificate assigned to the new `ssoserver-9443` entry under *Certificate → Settings*, Server URL set to
`https://<name>.local:9443`. Measured:

| | |
|---|---|
| TLS on 9443 | presents `CN = <name>.local`, issued by the test CA; `openssl s_client -verify_hostname` → `0 (ok)` |
| Positive controls | `curl` with system trust only → `SEC_E_UNTRUSTED_ROOT`; Node without the CA → `SELF_SIGNED_CERT_IN_CHAIN`. Both connect when given only the test CA (`--cacert`; `NODE_EXTRA_CA_CERTS`) |
| ⚠️ Windows `curl` (Schannel) | also needs `--ssl-no-revoke`: the test CA publishes no revocation list (`CERT_TRUST_REVOCATION_STATUS_UNKNOWN`). Node and OpenSSL do not require one |
| Issuer | `https://<name>.local:9443/webman/sso`; all endpoints moved to 9443; the **signing key is unchanged** (same `kid`) |
| Port 5001 | still DSM's factory certificate (DSM's own pages untouched); the SSO paths there now answer `400 unknown endpoint`. **SSO Server answers on one Server URL only** |
| Before the Server URL moved | 9443 answered `400 unknown endpoint` too: same rule |

**Then, one real sign-in** (2026-10-24 14:58Z): a throwaway OIDC application (*Spotify Companion probe*) registered by
the owner; authorization code flow with PKCE `S256`, `state` and `nonce`, run by a scratchpad script that printed
decoded claims and check results only, never a raw token or the secret.

| | Measured |
|---|---|
| Redirect URIs | `https://localhost:8765/callback` refused (*"invalid uri"*); `https://<name>.local:8765/callback` accepted: **another port on the same name is fine**, `localhost` is not |
| ⚠️ An account that cannot use DSM | the owner's read-only account **loops** at SSO Server's sign-in page (`/#/signin`) with no error, and SSO Server's log records **nothing** for it. A privileged account signs in. Owner's reading: the read-only account has no access to DSM's main screens. **Not verified**; *Application Privileges* has no SSO Server entry |
| Second factor | **asked for** (Secure SignIn), in Chrome, for the privileged account |
| ⚠️ The sign-in does not resume the request | after signing in from the authorize link, the browser landed on SSO Server's **account portal**, not on the redirect. Opening the authorize link **again**, now signed in, redirected at once with a code (no consent page). The proxy must start the flow so that a second pass happens, or this must be retested |
| Token response | `200`: `access_token`, `expires_in`, `id_token`, `token_type`. ⚠️ **No `refresh_token`** |
| ID token | `RS256`, the published `kid`; **signature verifies**; positive control (signature altered) **does not verify** |
| Claims | `iss` = the issuer; `aud` = the application ID, **a string**; `nonce` echoed; `auth_time`, `iat`, `exp`; `email`; `groups` (`users`, `administrators` for that account); ⚠️ **`sub` = the DSM user name** (same value as `username`), not an opaque ID: renaming the account changes who the app thinks it is |
| No `amr` / `acr` | the token **does not say** whether a second factor was used. The app cannot check it; it is SSO Server's policy |
| ⚠️ **Lifetime** | `exp − iat` = **180 s**, `expires_in` 180. Clock skew between Machine 2 and this machine: 0 s |
| Access token | opaque (not a JWT) |

**Silent re-sign-in** (`prompt=none`, 15:01Z, the same browser still signed in to SSO Server, ~2 min after the first
token): redirected **at once** with a code, no page shown; a new ID token, same checks all pass (signature, altered
copy refused, `iss`, `aud`, `nonce`), again **180 s**. ⚠️ `auth_time` **equals the new `iat`**, not the time of the
real sign-in, so `auth_time` cannot measure how old the sign-in is. ⚠️ **`prompt=none` with no SSO Server session** (15:05Z, a Chrome incognito window): SSO Server showed its **sign-in
page**, not `error=login_required`. So it does **not** honour `prompt=none` there; a silent refresh after the session
ends lands on a hidden sign-in page. Signing in from it (privileged account, second factor) then **looped** back to
sign-in, second factor included. ⚠️ This revises the read-only account's loop above: the privileged account loops
too, so the loop is **not** shown to be about account privileges; it may belong to sign-ins that start from an
authorize link with no session (the first Chrome sign-in also failed to resume, landing on the portal). Not
measured: SSO Server's own session length.

⚠️ **Consequence for the design** (not a measurement): a 3-minute ID token with no refresh token cannot be checked by
the app "on every request" for a whole session unless the proxy repeats the sign-in redirect every 3 minutes, which
breaks background requests and the WebSocket. U11's FD Q4 must settle what the app verifies after the first minutes.


**The P-95 retest on Machine 2** (U11 Code Generation Step 10, 2026-10-24, from 00:22Z on 2026-10-25): the candidate
build (`spotify-companion:candidate-u11-signin`) running on Machine 2 in server mode, with its own CA's certificates
on the app and on SSO Server (`ssoserver-9443`), the CA installed in this PC's current-user root store. Edge, InPrivate.

| | Measured |
|---|---|
| The app on Machine 2 | serves HTTPS on 3443 (Node runs on the Atom C2538); `/` → 302 to `/auth/sign-in`; `/auth/sign-in` → 302 to SSO Server's authorize endpoint, so `extra_hosts` and `NODE_EXTRA_CA_CERTS` work inside the container (discovery fetched over TLS); `/api/health` and a WebSocket without a session → 401; the LAN address as Host → 403 |
| ⚠️ Folder permissions | on a DSM share the container's user (uid 1000) is refused by the share's ACL even when it owns the files (`d---------+`; the ACL names only `administrators` and `ContainerManager`). `chown -R 1000:1000` plus `chmod -R u+rwX` on the four mounted folders switched them to Linux mode (`rwx------`, uid 1000) and the app started. Consequence: those folders are no longer browsable in File Station |
| ⚠️ A lock that cannot be created | `EACCES` on `history.db.lock` **crashed the app into a restart loop** (`WriterLock.acquire` rethrows anything but `EEXIST`; nothing catches it): a U10 defect, to be fixed |
| A new account, wrong state | SSO Server says *"account or password is invalid"* for an account whose creation was not saved: SSO Server's own refusal, before the app |
| ⚠️ **Sign-in from the authorize link, no SSO Server session** | a dedicated non-administrator account **loops** at SSO Server's sign-in page, with only a shared-folder privilege and also with the DSM application privilege added; **an administrator account loops too**. The app's log shows **no callback at all** for any attempt (no `[access]` line from 00:22Z to 00:31Z), so the loop is inside SSO Server. The same dedicated account signs in to DSM directly (port 5001) with no prompt |
| **With an SSO Server session first** (normal Edge window: sign in at `:9443`, then open the app) | **completes**: the app's page appears with a session (attempt 2). Then: the app's session cookie deleted and the page reloaded → silently signed in again, new cookie (attempt 3, what a 7-day expiry will look like while SSO Server's session lives); a deep link `/?tab=history` → completed (attempt 4) |
| Conclusion (measured, matches the 14:58Z probe) | SSO Server's sign-in page does **not resume** an authorization request that arrived with no SSO Server session; once its own session exists, the authorize link redirects back at once. Not about accounts or privileges. Not yet measured: SSO Server's own session length; attempt 5 (after signing out of SSO Server's portal) |

## `openid-client` 6.8.8, measured against the fake provider (U11, 2026-10-24)

Measured through the app's real routes against `test/support/fakeOidcProvider.ts`, one misbehaviour per test.

| | Measured |
|---|---|
| ⚠️ **ID-token signature** | **Not verified** for a token from the token endpoint by default (OIDC Core 3.1.3.7 allows trusting TLS instead): a tampered signature and a key the key set never published were **admitted**. `enableNonRepudiationChecks` (passed to `discovery` in `execute`) makes both refused. `alg: none` and `HS256` were refused either way (the `RS256` expectation) |
| ⚠️ `iat` in the future | **Not refused** by the library; the app checks it (BR-90.4) |
| Unknown `kid` | the key set is fetched again only if the cached one is **≥ 60 s** old; the cache is dropped at **300 s** (oauth4webapi 3.8.8). So a rotated key is refused for up to a minute after the last fetch |
| Basic client authentication | the ID and secret are **form-encoded** before base64 (RFC 6749 §2.3.1): `-` is sent as `%2D`. A provider that compares without decoding refuses it. ⚠️ Not yet seen against SSO Server |
| Node's own `fetch` and `NODE_EXTRA_CA_CERTS` | trusted (Node 22.17; positive control: without it, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`) |

## Sources

- [Spotify: Introducing some changes to our Web API (Nov 2024)](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
- [Spotify: February 2026 Web API Dev Mode Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify: Update on Developer Access and Platform Security (Feb 2026)](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
- [Spotify: Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [TechCrunch: Spotify changes developer mode API to require premium accounts](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/)
- [MetaBrainz: Pissed off by Spotify enshittifying more API endpoints?](https://blog.metabrainz.org/2024/11/28/pissed-off-by-spotify-enshittifying-more-api-endpoints-we-can-help/)
- [MusicBrainz API documentation](https://musicbrainz.org/doc/MusicBrainz_API)
- [marcelmarais/spotify-mcp-server](https://github.com/marcelmarais/spotify-mcp-server)
- [varunneal/spotify-mcp](https://github.com/varunneal/spotify-mcp)
- [thebigredgeek/spotify-mcp-server](https://github.com/thebigredgeek/spotify-mcp-server)
- [tylerpina/spotify-mcp](https://github.com/tylerpina/spotify-mcp)
- [igorgarbuz/spotify-mcp](https://github.com/igorgarbuz/spotify-mcp)
- [darrenjaworski/spotify-mcp](https://github.com/darrenjaworski/spotify-mcp)
- [Carrieukie/spotify-mcp-server](https://github.com/Carrieukie/spotify-mcp-server)
