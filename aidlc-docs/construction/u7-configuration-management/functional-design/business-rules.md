# U7 Business Rules — Configuration Management (BR-53 … BR-60)

**Stage**: Functional Design · **Written**: 2026-10-08 · **Status**: ✅ approved 2026-10-08
**Requirements**: FR-66 … FR-72 (ratified 2026-10-08, Question 19 = A) · story **US-29**
**Settled answers**: [`u7-functional-design-plan.md`](../../plans/u7-functional-design-plan.md) §3, §3a · Q19a = A

> U7 makes the app a **writer of its own configuration**. Every rule below exists so that a write through the app
> is at least as safe as the hand edit it replaces — and, for credentials, so that a bad write **cannot look
> healthy** (FR-71).

---

## 0. Facts measured for this design — 2026-10-08 (source read, not yet probed live)

| | Fact | Consequence |
|---|---|---|
| F1 | The MCP server **re-reads `spotify-config.json` on every call**, but caches its Spotify client **in process memory** (`cachedSpotifyApi`, `.mcp-server/src/utils.ts`) | A replaced file is not fully in force until the MCP process is replaced → BR-56.5 |
| F2 | ⚠️ **A file with no `accessToken` does not work.** `createSpotifyApi` falls back to **client-credentials** (no user — `/me/player` cannot be read) and `spotifyFetch` throws *"No access token available"*. Refresh happens **only** when an `accessToken` is present and `expiresAt` is due | FR-69's four fields alone would produce a dead file → BR-56.4, **probe P-U7-1** |
| F3 | The server refreshes with the **same refresh token** and never stores a new one (`refreshAccessToken` saves only `access_token`/`expiresAt`). It has done so roughly hourly for weeks on the live deployment | **Evidence that a refresh token survives reuse** — the question U7 plan Q5 left open. Inferred from running behaviour; P-U7-1 re-confirms it incidentally |
| F4 | The server rewrites the file with `JSON.stringify` of the **whole parsed object** | Unknown fields (e.g. `replacedAt`) survive its hourly rewrite → BR-56.7 |
| F5 | ⚠️ **The §2 defect, corrected.** A failed `getNowPlaying` returns `Error getting current track: …` as text. `parseNowPlaying` does **not** read it as *nothing playing* (`null`); it returns an object with **every field null** and `isPlaying: false`. The snapshot is `{ playing: true }` — so the card shows **PAUSED**, the status reads **ok**, and `recordPollMetrics` counts it as a **playing** poll and the MCP call as **ok**. The plan said *"counted as idle"* — **that was an inference, and wrong** | BR-58 |
| F6 | ⚠️ **And a *thrown* MCP error is counted as IDLE by M4 today** — `recordPoll(playing)` with `playing = false` for an error snapshot (`server.ts` `recordPollMetrics`, `upstreamMetrics.ts:112`). So converting the text error into an error snapshot, alone, would move credential failures from *playing* to *idle* — **still wrong** | BR-58.3: polls become three-way |
| F7 | The server reports errors as text in **20 places** across five tools, always `Error <verb>ing …: <message>` | BR-58.1 applies at the one MCP call site, for every tool |
| F7′ | ⚠️ **CORRECTED 2026-10-08 by PBT-66's first run**: **25** templates — 19 `Error <verb>ing …:`, **6 single-quoted `Error: <message>`** (input validation), one with an interpolated verb. F7's grep matched only backtick templates. No non-error text starts with `Error`. BR-58.1's pattern is therefore `^Error[^
]*:` | BR-58.1 widened |
| F8 | `config/` is a **directory** mount `:ro`; `spotify-config.json` and `musicbrainz.json` are **single-file** mounts (`:rw` and `:ro`) | Rules write by temp-then-rename (BR-53.4); the two credential files **must** be written in place (BR-56.3, BR-57.3) |

---

## BR-53: Rules download and upload (FR-66)

| ID | Rule | Source |
|---|---|---|
| **BR-53.1** | `config/rules.json` stays the **single source of truth**. The app becomes a writer of it; there is no second rules file and no precedence rule | Q1 = A |
| **BR-53.2** | **Download** returns the file's bytes unchanged, as `rules-<UTC stamp>.json`, with its content hash (`hashRuleSetContent`) in a response header. No file → `404` with *"No rules file yet — upload one, or run `npm run rules:init`"* | — |
| **BR-53.3** | **Upload** is staged, never applied: FR-64's admission path (one regular JSON file, **256 KB** cap — BR-46.4) → `JSON.parse` → `validateRuleSet`. A refusal changes nothing and **names the rule id and the field path** the validator reports | Q2a, Q3 |
| **BR-53.4** | An accepted upload returns a **comparison** (BR-53.6) and a staging token (10-minute TTL, as U6). **Confirm** writes: current file → `config/rules.previous.json` (temp + rename), new content → temp file in `config/` → **rename over `rules.json`** → `RuleSetWatcher.reloadNow()`. The response carries the watcher's outcome, so *"applied"* is reported only when the running set changed | Q1, Q3 |
| **BR-53.5** | Applied **without a restart** — the watcher's own loader, never a second parser (the WebSocket `403` lesson) | Q3 |
| **BR-53.6** | **The comparison**, keyed by rule `id`: added · removed · changed (with which top-level fields) · **would load disabled, with the reason** · ⚠️ **would change from dry-run to live** (`dryRun` true → false). The last is shown first and in words: *"this upload makes rule X able to skip tracks once automation is on"* | Q2e, Q3 |
| **BR-53.7** | **One comparison function, one write path** — used by upload, undo (BR-55) and restore (BR-59). Never re-implemented per caller | FR-64's precedent |

## BR-54: Write guards (FR-67)

| ID | Rule | Source |
|---|---|---|
| **BR-54.1** | ⚠️ **Mass removal needs a typed confirmation**: when the current set has ≥ 1 rule and the upload removes **all** of them or **more than half** (`removed > current / 2`), confirm requires typing `REPLACE`. The valid-but-empty file is the case `config/` was made `:ro` for | Q2b |
| **BR-54.2** | **Stale base → refused** (`409`). The UI keeps the hash of the version it last downloaded or displayed and sends it as `baseHash`; if it differs from the hash on disk, the upload is refused: *"Your rules changed since you downloaded them (by hand, or in another tab). Download them again."* | Q2c |
| **BR-54.3** | **Changed between comparison and confirm → refused.** The hash on disk is recorded at staging and re-checked at confirm; a mismatch refuses the confirm and discards the staging | Q2c |
| **BR-54.4** | ⚠️ **Unknown base → typed confirmation, not refusal.** An upload with no `baseHash` (page reloaded, another browser, a file kept from last month) cannot be checked for staleness. It is **not** refused — that would make the feature unusable across sessions — but the comparison says *"This file was not downloaded in this session; check what it removes"* and confirm requires `REPLACE`, as BR-54.1. **This is the limit of FR-67's staleness check, stated rather than hidden** | design decision — for review |
| **BR-54.5** | A rules write **never** reads or writes `state/` — the automation switch and halt latch are untouched. Pinned structurally: the rules-writing module imports nothing from `src/playback/` | Q2e, FR-61 |
| **BR-54.6** | ⚠️ **Arming needs a typed confirmation** (added 2026-10-12, hands-on finding): when the comparison's `becomesLive` is non-empty — a rule that could not skip before can after this write — confirm requires `REPLACE`, with the reason *"This lets N rule(s) skip tracks when automation is on — it/they could not before."* Asked **regardless of whether automation is on**: BR-54.5 forbids this module reading `state/`, and the switch can be turned on a moment after the write. Disarming is never gated. Undo runs through the same check (BR-55.3) | user, 2026-10-12 |

## BR-55: Undo last rules change (FR-68)

| ID | Rule | Source |
|---|---|---|
| **BR-55.1** | Exactly **one** previous file, `config/rules.previous.json`, replaced by every write | Q2d |
| **BR-55.2** | *Undo* **swaps** current and previous through BR-53.4's write path, so undoing an undo restores the newer set (U6's *undo ×2* behaviour) | consistency with FR-59 |
| **BR-55.3** | Undo shows the comparison and runs BR-54's guards like any other write; the previous file is **re-validated**, never trusted for having once been valid | — |
| **BR-55.4** | No previous file → *Undo* is disabled with *"Nothing to undo yet"*, never hidden | empty states explain themselves |

## BR-56: Spotify credentials (FR-69)

| ID | Rule | Source |
|---|---|---|
| **BR-56.1** | **Settings → Spotify** holds four fields: client id, client secret, redirect URI, refresh token. *Upload spotify-config.json* reads the file **in the browser** and fills the same fields — the server never receives the file, only the submitted fields (one server path: *save*) | Q4a = A |
| **BR-56.2** | **Save requires all four.** Each is trimmed, non-empty, without whitespace, ≤ 512 characters; the redirect URI must parse as an absolute `http(s)` URL. The body passes FR-64's admission with the **16 KB** cap. Nothing is carried over from the current file | Q4a, Q5 = B |
| **BR-56.3** | Written **in place** (same inode) — `spotify-config.json` is a single-file mount, and a rename would detach the container's view (the inode hazard). ⚠️ Not atomic: a crash mid-write leaves a broken file, which FR-71 then shows **red**. Accepted under Q5 = B | F8 |
| **BR-56.4** | ⚠️ The written file is `{ clientId, clientSecret, redirectUri, refreshToken, accessToken: "<placeholder>", expiresAt: 0, replacedAt }`. The placeholder plus a past `expiresAt` makes the MCP server **refresh on its first call** (F2). ⚠️ **Must be proven by probe P-U7-1 before code generation writes it** — this is reasoning from source, and this project has been wrong about Spotify six times | F2 |
| **BR-56.5** | Applied **without a restart**: after the write, the app closes its MCP client (the next poll spawns a fresh server process, so F1's in-memory cache is gone) and drops `WebApiClient`'s cached access token. In force within one poll interval | F1 |
| **BR-56.6** | **Before saving**, the dialog states: *"Your current Spotify credentials will be replaced and not kept anywhere — backups never include them. If the new ones are wrong, the Spotify indicator turns red and recording stops until working ones are entered."* No probe, no previous copy, no undo | Q5 = B |
| **BR-56.7** | **Display**: *set / not set*; client id as first 4 + `…` + last 4; redirect URI in full; secret and refresh token **never** shown back — only *set · replaced &lt;local time&gt;*, from the `replacedAt` field (F4: it survives the server's rewrites; the file mtime does not, because the server rewrites hourly). A file written by `npm run auth` has no `replacedAt` → *"set · source: file on disk"* | Q4a |
| **BR-56.8** | **Guidance text** in the section, collapsed by default: register an app at the Spotify developer dashboard · add the redirect URI `http://127.0.0.1:8888/callback` · copy client id and secret · run `npm run auth` on a computer with a browser, which writes `secrets/spotify-config.json` · upload that file here. Notes that **each user registers their own app** (FR-65) and that Development Mode limits who may use it. ⚠️ The text names `npm run auth`, so U8's install routine and this text must agree — **U8 owns keeping them in step** | Q4a note |
| **BR-56.9** | Credential values are **never** logged, never in Diagnostics, never in a backup (FR-60), never echoed in an error message | NFR-05, NFR-28 |

## BR-57: MusicBrainz contact (FR-70)

| ID | Rule | Source |
|---|---|---|
| **BR-57.1** | **Settings → MusicBrainz**: one *contact* field, displayed masked — first character of the local part, `…`, last character, `@domain` (`<email address>`); a non-email contact (a URL is allowed) shows its first 8 characters and `…` | Q4b |
| **BR-57.2** | Validated by the **same function** `loadMusicBrainzIdentity` applies at startup — extracted and shared, never re-implemented: non-empty, not a placeholder (`example.com`) | NFR-14 |
| **BR-57.3** | Written **in place** (single-file mount, F8); only `contact` changes — `appName` / `appVersion` are preserved untouched (Question 18 will make the version derived, in U8) | — |
| **BR-57.4** | Applied **without a restart**: the MusicBrainz client reads its identity through a getter, so the next request carries the new User-Agent | — |

## BR-58: A Spotify failure is a failure (FR-71)

| ID | Rule | Source |
|---|---|---|
| **BR-58.1** | At the **one** MCP call site (`SpotifyMcpClient.#callToolText`), a text result matching `^Error [a-z]+ing\b.*:` is treated exactly like `isError`: it **throws**, carrying the server's message. Applies to **every tool** (F7) — the queue probe included | Q6, F5, F7 |
| **BR-58.2** | The poll then publishes an **error snapshot**; the Spotify indicator shows **red** with the reason (≤ 200 characters, credential values never included — BR-56.9) | FR-71 |
| **BR-58.3** | ⚠️ **Polls become three-way: `playing` · `idle` · `error`.** `recordPoll` takes the outcome; M4 is **idle ÷ (playing + idle)**, and errors are their own count. Fixes F6 as well as F5 — without it, BR-58.1 would merely move credential failures from *playing* to *idle* | F6 |
| **BR-58.4** | **Negative controls, pinned by tests using the server's real strings**: `Nothing is currently playing on Spotify` stays **idle / ok**; a normal *Currently Playing* block stays **playing**; `Currently playing item is not a track (might be a podcast episode)` keeps today's behaviour (out of scope, recorded) | Q6 |
| **BR-58.5** | Recording is unaffected: an error snapshot already maps to *no sample* (`toPlaybackSample`), a play boundary — as for any MCP failure today | — |
| **BR-58.6** | ⚠️ **Historic M4 figures** mixed both defects (F5 counted as playing, F6 as idle). M4 has not been used to conclude anything (W-7 not started); `upstreamMetrics.ts`'s header says so after this change | Q6 note |

## BR-59: Restore can also restore rules — only if asked (FR-72; amends BR-48.7)

| ID | Rule | Source |
|---|---|---|
| **BR-59.1** | When the archive holds `rules.json`, staging **validates** it (`validateRuleSet`) and computes BR-53.6's comparison against the current file. **BR-48.7 is amended**: the archive's rules are no longer discarded at staging | Q7 |
| **BR-59.2** | The restore dialog shows *identical / differs* and, when it differs, an **opt-in checkbox, unchecked by default**: *"Also replace my rules with the backup's"*, with the comparison beneath it. An **invalid** backup rules file shows the checkbox **disabled**, with the validator's reason | Q7 |
| **BR-59.3** | Ticked → the comparison's warnings (mass removal, dry-run → live) are shown on the same dialog, and the **single typed `RESTORE`** confirms both. A second typed word is not added: the user is confirming one dialog with all its consequences visible | Q7, FR-67 — design decision, for review |
| **BR-59.4** | Ticked → `rules.json` stays in `restore-pending/` and `stage.json` records `applyRules: true` and the current rules hash. Unticked → it is removed at confirm, as U6 does today | Q7a = A |
| **BR-59.5** | ⚠️ At startup, the rules are applied **only after BR-48.5 step 5 succeeds**, through BR-53.4's write path (`rules.previous.json` kept), **before** `RuleSetWatcher.start()`. If the database restore falls back (BR-48.6), the rules are **not** applied | Q7a = A |
| **BR-59.6** | If the current rules changed between confirm and startup (hash differs from `stage.json`), the backup's rules are **not** applied, and Settings says so | BR-54.3 |
| **BR-59.7** | **Undo last restore (FR-59) does not revert rules**; rules have their own undo (FR-68). The after-restore message says which applied | — |
| **BR-59.8** | Restore still **never** writes `secrets/` or `state/` (FR-60, FR-61) | — |

## BR-60: Common to every U7 write

| ID | Rule | Source |
|---|---|---|
| **BR-60.1** | Every new state-changing route is behind **`ingestGuard`** (custom header) **and** the existing local guard. ⚠️ **Not reachable off-machine until NFR-29 / U9** | NFR-01…04 |
| **BR-60.2** | Every body passes **FR-64's** admission (`admitIngest`) with its cap: rules **256 KB**, credentials and contact **16 KB** | FR-64, BR-46.4 |
| **BR-60.3** | Placement (Q19a = A): rules download / upload / undo in the **Rules pop-up**; Spotify and MusicBrainz in **Settings**; the restore-rules checkbox in **Settings → Restore** | Q19a |
| **BR-60.4** | Nothing a U7 write touches is ever in `state/`; nothing in `secrets/` is ever in a backup | FR-60, FR-61 |

---

## Probe obligations — must be discharged before the code that depends on them

| ID | Question | How | Blocks |
|---|---|---|---|
| **P-U7-1** | Does a file with the four values, a placeholder `accessToken` and `expiresAt: 0` work on the **first** poll (the MCP server refreshes and stores a real token)? | On the **verification installation** (`:3011`), with a **copy** of the real credentials reduced to the four values. ⚠️ Never against the live file | BR-56.4 |
| **P-U7-2** | Does closing the MCP client **end** the child process, so the next poll gets a fresh one (F1)? | Process count before and after, in the container | BR-56.5 |
| **P-U7-3** | With deliberately wrong credentials, what **exact** text reaches the app — and does BR-58.1's pattern match it? | Verification installation with a broken config — the case U6's copy showed green | BR-58.1, exit criterion |
