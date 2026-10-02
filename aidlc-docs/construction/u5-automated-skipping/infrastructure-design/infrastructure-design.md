# Infrastructure Design — U5: Automated Skipping

**Date**: 2026-10-01 · **Stage**: CONSTRUCTION — Infrastructure Design, U5
**Answers**: Q1 **C** · Q2 **A** · Q3 **A** · Q4 **A** · Q5 **A** · Q6 **A** — all as recommended.
Plan: [`../../plans/u5-infrastructure-design-plan.md`](../../plans/u5-infrastructure-design-plan.md)

> **This is the stage where the app gains two write capabilities it has never had**: a write to the
> Spotify player, and a write to disk outside `data/`. Both are small changes to `compose.yaml` and
> both are scoped deliberately narrowly.

---

## 1. Migration 007 — additive only

| Target | Change |
|---|---|
| `decision_log` | **+ `trigger` TEXT** — `initial` \| `enrichment-arrived` |
| `play` | **+ `context_uri` TEXT** nullable — ⚠️ **ONE column, not two** |
| `skip_attempt.play_id` | ⚠️ **NULLABLE** — amended 2026-10-02. The play row is written at close, so there is no `playId` when a skip fires. The guard keys on `evaluation_id` |
| new table | **`skip_attempt`** — holds the `SkipAttempt` entity |

### ⚠️ CORRECTED 2026-10-02: `context_type` ALREADY EXISTS and migration 007 must not re-add it

This plan and BR-41.1 both said 007 adds `context_type` **and** `context_uri`. **`context_type` has
existed since the v1 schema** (`migrations.ts:61`), is already read and written by
`SqliteHistoryRepository`, and is **already populated on backfilled rows** — measured 2026-10-02:
86 `playlist`, 2 `artist`, and `null` on all **765** live plays.

✅ **The intent of BR-41.1 was right and is unchanged**: both values get recorded **on live plays** for
the first time. ⚠️ **Only the migration's scope was wrong.** `ALTER TABLE play ADD COLUMN context_type`
against an existing column fails, which would abort migration 007 inside its own transaction and leave
the app running **display-only** (NFR-13) — the page loading, the track displaying, and nothing being
recorded.

⚠️ **The field was available exactly where the outcome variable was not**, which is why it reads as
missing: `recently-played` carries context, and the MCP `getNowPlaying` the poll loop uses does not
(BR-41.2). Found by the compiler during Step 1, when adding the type produced a duplicate-identifier
error rather than a missing one.

### Existing rows get `trigger = 'initial'` by DEFAULT, not by a judgement

The 909 existing `decision_log` rows were all written by U4's single-decision-per-play coordinator, so
they are `initial` **by construction**. The column's default supplies that; no `UPDATE` statement
decides it retroactively.

### ⚠️ No `UNIQUE` constraint anywhere

BR-22.1a and BR-37.2 both forbid it, on `playId`, on `(playId, ruleId)` and on `evaluationId`-per-play.
U4 deliberately created none so that this migration could stay additive.

⚠️ **The one-attempt-per-play rule is enforced in code** — `SkipAttemptRepository.attemptedForPlay`
(LC-24) — **and not by the schema.** A `UNIQUE` index would be the obvious way to express it and would
make migration 007 non-additive, which breaks rollback by image.

### ⚠️ Existing play rows keep whatever they have; nothing is backfilled with a guess

`null` means unknown and is never backfilled with a guess. ⚠️ **`recently-played` cannot supply these
retroactively** for a play it has aged out of — its window is 50 plays.

These two columns are **evidence only** (BR-41.3). No rule field is exposed over playback context in
U5, because `context_uri` goes stale: it named an album through 33 minutes of autoplay by other
artists.

### `skip_attempt` is a table, not columns on `play`

A play may have an attempt that was **refused**, and BR-36.3 requires that to be distinguishable from a
play never attempted. Columns on `play` would force one row's worth of state into the play and lose the
refusal reason.

### Deployment sequence *(Q2 = A)*

Migration 007 runs **automatically at startup**, like 005 and 006. `SqliteHistoryRepository` calls
`migrate()` before any write (`SqliteHistoryRepository.ts:198`).

```
1. npm run db:restore -- data/backup-before-migration-007-20260929T172027Z --verify-only
2. docker compose down
3. docker compose build          # check the exit code DIRECTLY, not through a pipe
4. docker compose up -d
5. docker logs spotify-now-playing | head -40   ->  "migrated 7:" EXACTLY ONCE
```

⚠️ **Step 3's exit code must be read directly.** `docker compose build | tail` reports the *pipe's*
exit status, and a failing build once read as success here.

⚠️ **Why not run the migration by hand against a stopped container?** During U4 a maintenance script
wrote to `history.db` while the container was also writing, and it corrupted an index. The app at
startup is the one writer we can be certain is alone, and it wraps each migration in its own
`BEGIN`/`COMMIT`. ⚠️ The script-level guard meant to catch a second writer **could not see the
container at all** until it was fixed on 2026-09-29.

### ✅ Rollback is by image, and it is verified live *(Q3 = A)*

`migrate()` skips every migration at or below the current version:

```ts
if (migration.version <= from) continue;        // migrations.ts
```

**Verification required before U5 ships**: run U4's image against a **v7** database and confirm it
reports `from: 7, to: 7` and runs normally.

⚠️ **Reading the line is not sufficient, and the distinction matters.** The code proves *migration 007
is skipped*. It does not prove *U4's code runs correctly against a database carrying one extra table
and three extra columns it never reads*. Those are separate claims, and the rollback guarantee is the
second one.

⚠️ **Run it against a COPY**, not the live corpus — `HISTORY_DB_PATH` makes that possible.

> ⚠️ **Rollback stays safe only while migrations remain additive** (BR-37.4). A migration that rewrites
> or drops breaks it **silently**: the old image starts happily against data it can no longer
> interpret. ⚠️ **This is also why `skip_attribution` is nulled rather than dropped.** Do not tidy it.

---

## 2. Mounts — one new mount, and `config/` stays read-only *(Q1 = C)*

| Mount | Mode | Change |
|---|---|---|
| `./data:/data` | `rw` | unchanged — holds `history.db` and `snapshots/` |
| `./config:/config` | **`ro`** | ⚠️ **unchanged. Stays read-only in U5** |
| `./secrets/spotify-config.json` | `rw` | unchanged — the MCP server rewrites its own token |
| `./secrets/musicbrainz.json` | `ro` | unchanged |
| **`./state:/state`** | **`rw`** | ⭐ **NEW** — app-written state only |

`automation-state.json` lives at **`/state/automation-state.json`**.

### ⚠️ Why `config/` does NOT become `:rw`, against the obvious one-word alternative

`config/` holds `rules.json`, the user's hand-authored rule set. Making the directory writable would
grant the app permission to overwrite it, and **no code in U5 would ever use that permission**. BR-30
rejects the same shape one level down: it forbids giving `LoggingExecutor` a playback collaborator it
never calls, because an unused capability leaves one line of code preventing its use.

⚠️ **BR-20.8 would not catch a truncation.** Its last-known-good path reloads the previous rule set
when a new file **fails to parse**. A file truncated to valid-but-empty JSON parses successfully, so it
would be accepted as a deliberate empty rule set.

### ⚠️ Why not put the state file under `data/`, which is already writable

`data/` holds `history.db`, the one file here that cannot be rebuilt. **The objection is restore.**
Today `backup-history.mjs` copies only `history.db*`, so a state file there would be untouched — but
**W-5** is specified as a *full-inventory* backup of `data/`. Once that exists, restoring a week-old
backup would also restore the week-old automation state. **If automation was armed then and has since
been turned off, the restore turns it back on and nothing says so.**

### ✅ The AI-rules future strengthens this split rather than weakening it

The user raised (2026-10-01) that `rules.json` will eventually need to be writable by an app, as rule
authoring moves to an AI-assisted system. **That does not change the decision:**

- The future mount change is still one word: `./config:/config:ro` → `:rw`, in the unit that adds rule
  editing. C declines to pre-pay for it; it does not obstruct it.
- The two files want different permissions even once both are writable. One is a machine-written safety
  latch; the other is authored intent, changed rarely and costly to lose.
- ⚠️ **A kill switch stored in the same writable directory as the file an AI agent edits is a kill
  switch that agent can disable** — by a bug or a bad generation pass. That argument gets stronger as
  the rule author becomes less predictable, not weaker.
- If the rule system becomes a *separate app*, separate mounts express it cleanly: this app holds
  `state:rw` + `config:ro`, the rules app holds `config:rw`.

### ⚠️ `./state` must be a DIRECTORY mount, like `./config` and `./data`

A single-file bind mount binds an **inode**. `automation-state.json` is written by
write-temp-then-rename (BR-34.2), and a rename **replaces** the inode — so through a single-file mount
that rename either fails or silently detaches the container's view from the host file.

### ⚠️ First-run: the directory must exist, and writability must be PROBED

If `./state` is missing, Docker creates it. Measured on this host 2026-09-11, a Docker-created
bind-mount directory came out `rwxrwxrwx root:root` and the app (running as user `node`) could **read**
it. ⚠️ **That measurement covered reads, and U5 needs to write.**

`AutomationStateStore.probeWritable()` (LC-29) tests this at startup by writing and removing a temp
file. ⚠️ **It must not refuse to start on failure.** NFR-13: an unwritable `/state` means automation
cannot be **armed**, not that the app stops recording. **Recording is the irreplaceable function.**

⚠️ **Verify the write THROUGH THE CONTAINER, never on the host.** On the host the write succeeds and
the bug is invisible. This is Phase 4 exit criterion 3, and the one most likely to pass on the host and
fail in the container.

### Two `compose.yaml` comment corrections to apply at code generation

1. ⚠️ The `./config` comment says `:rw` arrives *"in the unit that adds **RULE EDITING**, and not
   before."* Under Q1 = C that **conclusion is correct** — U5 writes nothing to `config/`. **But the
   reasoning is wrong**: it implies rule editing is the only reason the directory might need to be
   writable. Restate the rule instead of the trigger: **`config/` holds user-authored intent and the
   app never writes it; app-written state lives in `./state`.** ⚠️ That comment has already been
   corrected once (2026-09-21) for naming the wrong *unit*; leaving the wrong *reason* in place is how
   it goes stale a third time.
2. The same comment predicts the inode hazard would *"surface the first time the U4 rule editor
   saves."* U4 had no editor and U5 has none either. **The hazard now surfaces at `./state`**, and the
   comment on the new mount must carry it.

---

## 3. Environment — and what is deliberately NOT an env value *(Q4 = A)*

### New env values

| Value | Default | Why it is a setting |
|---|---|---|
| `AUTOMATION_STATE_PATH` | `/state/automation-state.json` | Path only, like `RULES_PATH`. Lets a test point elsewhere |
| `SKIP_EXECUTOR_ENABLED` | `false` | Selects `SkipExecutor` over `LoggingExecutor` (BR-33.6). ⚠️ **Not the kill switch** — it chooses which executor is wired, and the kill switch is checked at the action point regardless |

### ⚠️ The BR-35 safety thresholds are CONSTANTS IN SOURCE, not env values

```
MAX_CONSECUTIVE_RULE_SKIPS = 3      // BR-35.1
MAX_RULE_SKIPS_PER_HOUR    = 10     // BR-35.2
```

They are **not** in `compose.yaml`, not readable from the environment, and not settings.

⚠️ **This is an exception to the established habit in this project, which is why it is stated
explicitly.** `compose.yaml` already holds `POLL_INTERVAL_MS`, `RULES_POLL_INTERVAL_MS` and
`ENRICHMENT_WAIT_MS`. Someone adding a number will reach for the same place by default.

**Why these two are different:**

1. They are **safety limits, not tuning values**. BR-35 says so directly: *"If a legitimate rule trips
   the halt, that is information about the rule."*
2. ⚠️ **The halt will fire during normal listening, not only when something is broken.** The busiest
   hour in the corpus held **27 plays**, so 10 rule-skips per hour is reached by any rule matching more
   than **37%** of tracks.
3. ⚠️ **If the number lived in `compose.yaml`, changing it would be a one-line edit.** When the halt
   interrupts listening, the easiest response is to raise the limit — 10 to 25 — until it stops firing.
   After that it never fires again: the halt remains in the code but prevents nothing.

**Two existing precedents.** The Phase 2 hypothesis gate (BR-11) keeps its thresholds in
`pre-registration.md`, and the script's comment says to change them by amending that document rather
than editing the script. U3's `MAX_PREDICATE_DEPTH` is deliberately not configurable — `compose.yaml`
says *"Only the PATH is configurable. The bounds are not."*

⚠️ **The thresholds must be pre-registered in writing before any rule is armed** — still open on the
FD plan checklist.

---

## 4. Automation state survives a restart *(Q5 = A)*

`globalAutomationEnabled` **persists**, and the runaway halt persists with it (BR-34.1, BR-35.7).

⚠️ **The consequence, stated rather than left implicit: once automation is armed, a reboot resumes
skipping.** The chain is Windows login → Rancher Desktop → dockerd → container → rules acting, with
nobody watching. **FR-47's "off by default" means fresh install, not fresh boot.**

**Why not require re-arming after every restart?** The app is designed to run unattended and this
machine sleeps and resumes dozens of times a week. Automation would be off for most of that time
**without saying so**, and the user would believe rules were acting when they were not. That is the
opposite error from an unwanted skip, but it is still a wrong belief about whether a safety control is
active.

✅ **What makes it visible without a click**: FC-U5-1's indicator shows `disabled` when automation is
off and `halted` when the runaway latch is set, on the primary screen. The *control* stays on the Rules
pop-up; the *state* is always visible.

⚠️ **A corrupt or unreadable state file means OFF** (BR-34.5). A damaged file must never be a path to
*on*.

---

## 5. Metrics are exposed on `/api/diagnostics` only *(Q6 = A)*

M1–M4 (LC-28) are reported by the existing diagnostics route. **No new route, and no new WebSocket
surface.**

⚠️ **Why not a dedicated `/api/metrics`:** it would be a second route applying the same local-access
check, for no capability diagnostics does not already provide. That duplication caused the WebSocket
`403` — the local-access policy was written in two places, the copies drifted, and every page load
returned `200` while every handshake returned `403`.

⚠️ **Why not a Prometheus-style endpoint:** it is designed to be polled by an external scraper, which
means a second process making repeated requests and a new network surface on a deliberately local-only
deployment (NFR-01–04). If a dashboard ever wants these, that is **W-1**, deferred because it *"needs a
security architecture this project does not have."*

---

## 6. What is deliberately unchanged

| | |
|---|---|
| Ports | `127.0.0.1:3010:3000`. Nothing new listens; the `POST` is outbound |
| `./data:/data:rw` | Unchanged. Directory mount, for SQLite's `-wal` and `-shm` siblings |
| `./config:/config:ro` | ⚠️ **Unchanged, deliberately** — see §2 |
| The healthcheck | Unchanged |
| `restart: unless-stopped` | Unchanged. ✅ Proven 2026-09-30: it revived the container by itself once dockerd returned |
| `decideAccess` / the upgrade handler | Unchanged. The kill-switch route sits in `api.ts` behind the existing guard |
| `node:sqlite` | Unchanged. R10 is mitigated by NFR-10's interface |

---

## 7. Post-deploy verification

| Check | How |
|---|---|
| Migration applied once | `docker logs spotify-now-playing \| head -40` → `migrated 7:` exactly once |
| Schema is v7 | `/api/diagnostics` → `Database … schema v7` |
| Corpus intact | Play count and `integrity_check: ok` before and after |
| `/state` writable **in the container** | `/api/diagnostics` → the writability probe passes |
| Automation is OFF | Fresh state file absent ⇒ off (BR-33.1) |
| `config/` still read-only | A write attempt inside the container fails |
| Rollback | U4's image against a **v7 copy** reports `from: 7, to: 7` |
| Guards intact | UI `200`, WebSocket `101`, cross-site Origin `403` on both |

⚠️ **Three things CI cannot close:**

1. The **dry-run review** that arms the first rule — Q1's actual gate from the NFR plan.
2. The **first real skip**, heard by the user, confirming it costs 2–3 s rather than 18–41 s.
3. **`probeWritable` against the real `/state` mount**, verified by writing through the container.

⚠️ **Back up before deploying, and the backup is already taken**:
`data/backup-before-migration-007-20260929T172027Z`, verified. Re-check it with
`npm run db:restore -- <dir> --verify-only` — read-only, safe any time.
