# Infrastructure Design — U7: Configuration Management

**Date**: 2026-10-08 · **Stage**: CONSTRUCTION — Infrastructure Design, U7 · **Status**: ✅ approved 2026-10-08
**Answers**: Q1–Q6 all **A**, as recommended — [`../../plans/u7-infrastructure-design-plan.md`](../../plans/u7-infrastructure-design-plan.md).
Picture: [`deployment-architecture.md`](deployment-architecture.md).

> ⚠️ **This unit reverses a posture on purpose.** `./config` and `musicbrainz.json` become writable by the app.
> What protects them afterwards is **BR-53/54's guards and `CredentialsWriter`'s narrow scope**, not the mount —
> and the compose comments must say so, or the next reader will either re-tighten the mount and break U7, or
> loosen something else on the strength of a comment that no longer explains anything.

---

## IN-U7-1 · `./config` becomes `:rw` *(Q1 = A)*

`compose.yaml`: `./config:/config:ro` → `./config:/config:rw`, and the comment block is **rewritten**, not
edited. It must state, in this order:

1. **The rule now**: *`./config` holds the rules. The app writes them ONLY through `RulesWriter` — validated,
   compared, confirmed, hash-checked, one previous copy kept (BR-53/54). It writes nothing else here.*
2. **What still holds**: app-written **runtime** state lives in `./state`; ⚠️ **the kill switch must never move
   here** — an agent that edits rules must not be able to reach it.
3. **Why it is a directory mount** (unchanged reason, now live rather than theoretical: `RulesWriter` does
   temp-then-rename).
4. **History, condensed**: `:ro` was deliberate from U3 to U6 and was corrected twice (2026-09-21, 2026-10-03) to
   stop it being loosened early; U7 loosens it with guards in its place (FD Q1 = A, 2026-10-08).
5. The `npm run rules:init` note and the root-ownership correction, kept.

`compose.verify.yaml` gets the same change (`./verify-install/config:/config:rw`) so the exit test exercises the
real mount mode. `.gitignore` needs nothing: `config/*` already ignores `rules.previous.json` and temp files.

## IN-U7-2 · `musicbrainz.json` becomes `:rw` *(Q2 = A)*

Single-file mount, `:ro` → `:rw`; written **in place**, never renamed. ✅ This is the pattern already proven on
this host: the MCP server rewrites `spotify-config.json` in place through a single-file mount every hour. The
comment is rewritten: *the app now writes the `contact` field through `CredentialsWriter` (FR-70) and nothing
else; it is still a single-file mount, so a temp-then-rename write here would detach the container's view.*

## IN-U7-3 · Real credentials for probe P-U7-1 only *(Q3 = A — a written, probe-only amendment to IN-U6-3)*

IN-U6-3 says the `:3011` copy holds **no Spotify credentials**. For **P-U7-1 only**, that is amended:

| | |
|---|---|
| What | A copy of `secrets/spotify-config.json` reduced to `clientId`, `clientSecret`, `redirectUri`, `refreshToken`, with `accessToken: "placeholder"` and `expiresAt: 0` — exactly the shape BR-56.4 would write |
| Where | `verify-install/secrets/spotify-config.json` (gitignored), mounted where the copy's MCP server reads it |
| When | Code Generation step 1, for the probe's duration only |
| Removed | by `npm run verify:down`, which removes `verify-install/` whole; the step records that the file is gone |
| Cost, stated | two pollers on one Spotify app for a few minutes (≈ 2× the poll rate, inside the measured 10-per-30 s window); the copy refreshes with the **same refresh token**, which F3 says is safe |
| Afterwards | IN-U6-3's *no credentials* contract applies again for every other use of the copy, including U7's exit test of the **broken**-credentials case (P-U7-3), which uses a deliberately invalid config |

⚠️ **Never** the live file itself, and never mounted `:rw` from `secrets/` — a probe that could write the live
credentials is a probe that could break live recording.

## IN-U7-4 · Rollback image *(Q4 = A)*

Before the first U7 build: `docker tag spotify-now-playing:0.1.0 spotify-now-playing:u6-rollback`. Then verify
**live**, against a copy of `data/` and `config/` that contains U7's leftovers — a `rules.previous.json`, a
`.rules.*.tmp`, a `restore-pending/stage.json` with `applyRules: true` — that U6's image starts, reports
`integrity_check: ok`, applies **no** rules from the stage, and ignores the extra files. Schema stays **v7**, so
there is no database question. ⚠️ Live, not by reading U6's code — the U4 and U5 precedent.

## IN-U7-5 · Safety copies before the first deploy *(Q5 = A)*

1. **In-app *Create backup*** (history + rules — the user path) and keep the archive.
2. Host copies of `config/rules.json` and `secrets/musicbrainz.json` into `data/before-u7-<UTC stamp>/`
   (gitignored).
3. ⚠️ **Not** `spotify-config.json`: `data/` is what a backup archives, and FR-60 says credentials never go there.
   FD Q5 = B leaves keeping a copy of them to the user.

Reason: U7's image is the first that can **write** `rules.json` and the credential files.

## IN-U7-6 · Monitoring *(Q6 = A)*

Diagnostics gains a **Configuration** block:

| Field | Source |
|---|---|
| `config/` writable | probed at startup **through the container** (the `probeWritable` pattern U5 uses for `/state`) |
| `musicbrainz.json` writable | probed at startup the same way — an append-free open for writing, never a content change |
| last rules write | when, outcome (`applied` / refusal reason), version |
| last credentials write | when, which (Spotify / MusicBrainz), outcome — **never values** (P-53) |
| polls | `pollsTotal`, `pollsIdle`, `pollsError`, `idleShare` (P-55) |

A `:ro` left in place by mistake then shows on the first page load, not on the first save.

---

## Deployment steps for U7 (live)

1. `docker tag spotify-now-playing:0.1.0 spotify-now-playing:u6-rollback` (IN-U7-4)
2. Safety copies (IN-U7-5)
3. `docker compose up -d --build` — check the build's exit code **directly**, not through a pipe
4. `/api/health`, `/api/diagnostics`: schema **v7**; Configuration block shows both writable; poll counts moving
5. Verification installation: P-U7-3 (broken credentials show **red**) and the exit tests, then `verify:down`
   with the no-impact proof
6. Rollback verified live (IN-U7-4)

## What does not change

`./data`, `./state`, the `spotify-config.json` mount (already `:rw`), ports, environment, restart policy · the
schema (**v7**) · `localGuard` / `decideAccess` / `ingestGuard` — every new route sits behind them.
