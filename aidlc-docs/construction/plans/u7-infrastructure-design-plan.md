# Infrastructure Design Plan — U7: Configuration Management

**Date**: 2026-10-08 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U7
**Status**: ✅ **ALL 6 ANSWERED (2026-10-08), every one A.** Deliverables: `infrastructure-design/infrastructure-design.md` (**IN-U7-1…6**), `deployment-architecture.md` — ✅ **APPROVED 2026-10-08**.
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U7 FD (BR-53…BR-60) and NFR Design (P-49…P-57, LC-40…LC-48) — both approved 2026-10-08 · `compose.yaml`,
`compose.verify.yaml`, `.gitignore` · U6 Infrastructure Design (IN-U6-1…6) as precedent

> ⚠️ **This stage reverses a security posture on purpose, and should read that way.** `compose.yaml`'s comment on
> `./config` states the rule *"./config holds USER-AUTHORED INTENT and the app never writes it"*, corrected twice
> so that no later session would loosen it by accident. FD Q1 = A loosens it **deliberately**. What replaces the
> `:ro` mount as protection is BR-53/54's guards — so the comment must be rewritten to say what protects the file
> now, not merely have `:ro` changed to `:rw`.

---

## 1. Facts measured for this plan — 2026-10-08

| | |
|---|---|
| `./config` | directory mount, **`:ro`**. Tracked content: `config/rules.example.json` only; `config/*` otherwise gitignored |
| `./secrets/musicbrainz.json` | **single-file** mount, **`:ro`** — comment: *"nothing rewrites this file … copying the `rw` out of habit would grant a write capability with no use"*. U7 gives it a use |
| `./secrets/spotify-config.json` | single-file mount, `:rw` (unchanged) |
| ✅ **In-place writes through a single-file mount work on this host** | Evidence, not inference: the MCP server rewrites `spotify-config.json` **in place** (`writeFileSync`) roughly hourly through exactly this kind of mount, and the host file carries the refreshed tokens. So BR-56.3/57.3's in-place write is the proven pattern, and **rename** is the one that would break |
| `./state` | `:rw`, untouched by U7 |
| `compose.verify.yaml` | `:3011` copy; mounts `./verify-install/config:/config:ro` and a **placeholder** Spotify config. `verify-install/` is gitignored and removed whole by `verify:down` |
| Docker CLI | ✅ restored 2026-10-08 after the reboot |

## 2. What this stage must produce

`construction/u7-configuration-management/infrastructure-design/infrastructure-design.md` (**IN-U7-1 …**) and
`deployment-architecture.md`.

---

## 3. Questions

### Question 1 — ⭐ Security posture — `./config` becomes writable

A) ⭐ **`./config:/config:rw`, and the comment REWRITTEN, not edited.** The new rule it states: *"./config holds
the rules. The app writes them ONLY through `RulesWriter` — validated, compared, confirmed, hash-checked, one
previous copy kept (BR-53/54). It never writes anything else here. App-written RUNTIME state still lives in
./state, and the kill switch must never move here (an agent that edits rules must not be able to reach it)."*
The history of the two earlier corrections stays, condensed, so the reason for the reversal is visible.
`.gitignore` already covers `rules.previous.json` and temp files (`config/*`)

B) A narrower mount — e.g. move the app-writable rules into `./config/live/` with only that subdirectory `:rw`.
⚠️ Moves the rules file every install already has, and protects only `rules.example.json`, which is tracked in git
anyway

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 2 — Security posture — `musicbrainz.json` becomes writable

A) ⭐ **Single-file `:rw`, written in place** (the proven pattern, §1), comment rewritten to say the app now writes
the `contact` field through `CredentialsWriter` and nothing else

B) Leave it `:ro` and drop FR-70's in-app editing. ⚠️ Contradicts the ratified FR-70; an appliance user could not
set their contact

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 3 — ⚠️ Probing with real credentials (P-U7-1)

P-U7-1 asks whether the four values plus a placeholder token work on the **first** poll. That needs a **real**
refresh token, and the `:3011` installation has only a placeholder by design (IN-U6-3: *"NEVER the live file"*).

A) ⭐ **A copy of the real credentials, reduced to the four values, placed in `verify-install/secrets/` for the
probe only, and removed with `verify:down`.** Consequences, stated: for the probe's few minutes **two pollers** use
your Spotify app (≈ 2× the poll rate — well inside the 10-per-30 s window measured); the copy's MCP server refreshes
the access token with the **same refresh token**, which F3 says is safe. The IN-U6-3 contract is amended **for
this probe only**, in writing. ⚠️ The copy exists in the working tree, gitignored, for the probe's duration

B) Run P-U7-1 against the **live** deployment instead. ⚠️ If the placeholder theory is wrong, live recording stops
until the real file is restored — and the probe's whole point is that we don't know yet

C) Skip P-U7-1; rely on Build & Test. ⚠️ Code would be written on an unverified premise

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 4 — Rollback

A) ⭐ **As IN-U6-4**: `docker tag spotify-now-playing:0.1.0 spotify-now-playing:u6-rollback` before the first U7
build, and **verify live** that the U6 image runs against U7's leftovers: a `rules.previous.json` in `/config`, a
`stage.json` carrying `applyRules`, the renamed metrics fields. Expected: all ignored, nothing breaks. No schema
change, so no database question

B) Rollback by rebuilding from git

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 5 — Safety copies before the first deploy

U7 changes no schema, but it is the first unit that **writes `rules.json`** and **writes credentials**.

A) ⭐ **Three copies, all outside the repo's tracked files**: an in-app *Create backup* (history + rules, the user
path), plus host copies of `config/rules.json` and `secrets/musicbrainz.json` into a dated folder under `data/`
(gitignored). ⚠️ **Not** a copy of `spotify-config.json` into `data/` — `data/` is what a backup archives, and
FR-60 says credentials never go there; you keep your own copy if you want one (FD Q5 = B)

B) The in-app backup only

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

### Question 6 — Monitoring

A) ⭐ **Diagnostics gains a *Configuration* block**: `config/` writable (probed at startup like `/state`'s
`probeWritable`, through the container), `musicbrainz.json` writable, last rules write (when, outcome), last
credentials write (when, outcome — never values), and the three-way poll counts (P-55). A `:ro` left in place by
mistake then shows on the first page load, not on the first save

B) No new diagnostics

X) Other (please describe after [Answer]: tag below)

[Answer]:
A
---

## 4. Out of scope

| | |
|---|---|
| Off-machine reachability | NFR-29 / U9 — the new routes stay local-only |
| Image publishing | NFR-32 — the bundled MCP server has no licence |
| The NAS's mounts | U9 |
