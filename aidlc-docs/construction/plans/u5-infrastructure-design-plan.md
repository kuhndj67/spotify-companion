# Infrastructure Design Plan — U5: Automated Skipping

**Date**: 2026-10-01 · **Stage**: CONSTRUCTION — Infrastructure Design, Unit U5
**Workspace root**: `D:/Software/Spotify` · **Project type**: Brownfield
**Inputs**: U5 Functional Design (**BR-33…BR-43**) · NFR Design (**P-27…P-37**, **LC-23…LC-31**,
**PBT-34…PBT-50**) · the plan's [§5.1](u5-nfr-design-plan.md) answers

> **U5 is the only unit that can cause harm, and this is the stage where it gains the capability.**
> Until now the app has been read-only against playback and read-only against `config/`. This plan
> grants it a write path to the player and a write path to disk outside `data/`. Both are one-line
> changes, and both are the kind of line a later session copies without re-deriving.

---

## What U5 needs from infrastructure

| | |
|---|---|
| **Migration** | **007**, additive only — `decision_log.trigger`, `play.context_type`, `play.context_uri`, new table `skip_attempt` |
| **Write path to disk** | `automation-state.json` — the kill switch and the runaway latch (BR-34.1) |
| **Write path upstream** | `POST /me/player/next` — no new port, no new mount |
| **New ports / volumes** | **None** |
| **Env values** | ⚠️ See **Q4** — the safety thresholds must NOT become settings |

---

## Facts established for this plan

### Migrations run automatically, at repository construction, unattended

`SqliteHistoryRepository` calls `migrate()` before any write (`SqliteHistoryRepository.ts:198`), at
server startup. **Deploying U5 therefore runs migration 007 unattended** — and the container is on
Rancher Desktop autostart, so that could first happen at a boot nobody is watching.

Each migration is wrapped in `BEGIN` / `COMMIT` with `ROLLBACK` on failure, so a partial migration
cannot be committed.

### ✅ Rollback to U4's image is safe — the mechanism is verified in code

`migrate()` skips every migration whose version is at or below current:

```ts
if (migration.version <= from) continue;        // migrations.ts
```

So against a **v7** database, U4's image finds nothing to apply, reports `from: 7, to: 7`, and runs
normally. The new table and three new columns are simply unread.

> ⚠️ **That property holds only while migrations stay additive** (BR-37.4). A future migration that
> *rewrites* or *drops* breaks rollback **silently** — the old image starts happily against data it
> can no longer interpret. ⚠️ **And `skip_attribution` is nulled rather than dropped for exactly this
> reason.** Do not tidy it.

### ✅ The `before-migration-007` backup is taken and VERIFIED

`data/backup-before-migration-007-20260929T172027Z` — schema v6, all eight checks pass, 850 plays.
`npm run db:restore -- <dir> --verify-only` re-checks it any time, read-only.

⚠️ **The sweep reads 1 fully verified · 10 intact but unverifiable · 1 CORRUPT.** The CORRUPT
directory is the **load-bearing negative control** for `--self-test` and must not be tidied away.

### ⚠️ `compose.yaml`'s `:rw` comment — right in outcome, wrong in reasoning

> *"It becomes `:rw` in the unit that adds **RULE EDITING**, and not before."* — `compose.yaml:174–182`

**When this plan was written, that sentence looked wrong.** U5 adds no rule editing (authoring stays
file-based, `frontend-components.md` §4) but was about to become the first unit that **writes** to
`config/`, for `automation-state.json`. A reader following the sentence literally would have refused the
change U5 appeared to need.

✅ **Q1 = C removed the conflict rather than resolving it.** `automation-state.json` goes to a new
`./state` mount, so **U5 never writes to `config/` at all** and the mount stays `:ro`. The sentence's
*conclusion* is now correct.

⚠️ **But its reasoning is still wrong, and that is what must be fixed at code generation.** It implies
the only reason to make `config/` writable is rule editing. The real rule is narrower and clearer:
**`config/` holds user-authored intent and the app never writes it; app-written state lives in
`./state`.** Rule editing happens to be the one change that would alter that.

⚠️ **That comment has already been corrected once** (2026-09-21), when it said *"this becomes `:rw` at
U4"* and U4 had no editor — *"an instruction a later session would follow without re-deriving."* It was
wrong about the **unit** then and about the **reason** now. **Restate the rule, not the trigger.**

### ⚠️ `config/` holds the user's hand-authored rules, and nothing else

```
config/rules.json           1,167 bytes — hand-authored, the live rule set
config/rules.example.json      34 bytes — the committed template
```

⚠️ **Making this directory `:rw` would grant the app permission to overwrite `rules.json`** — the one
file U3 and U4 deliberately protected. Nothing in U5 needs that permission.

✅ **Resolved by Q1 = C: `config/` stays `:ro`.** ⚠️ And note what BR-20.8 does *not* cover: it reloads
the last-known-good rule set when a new file **fails to parse**. A file truncated to valid-but-empty
JSON parses successfully, so it would be accepted as a deliberate empty rule set rather than rejected.

### ⚠️ The backup scripts capture `history.db*` and nothing else

`backup-history.mjs` copies `history.db`, `-wal` and `-shm`. **Wherever `automation-state.json`
lives, it is not backed up** — which is correct (it is a latch, not a record) but should be stated
rather than assumed. ✅ **This decided Q1 against `data/`**: once W-5's full-inventory backup exists, restoring a week-old
backup would also restore the week-old automation latch, **silently re-arming automation**.
⚠️ **The same argument applies to `./state`, and is why it is NOT backed up**: a kill switch whose
state can be restored from an archive is not reliably off.

---

## Plan

- [x] ✅ **All six settled 2026-10-01**: Q1 **C** · Q2 **A** · Q3 **A** · Q4 **A** · Q5 **A** ·
      Q6 **A** — all as recommended. Q1 asked whether the planned AI-authored rules system changes the
      answer; **it does not, and it strengthens C** — see the ⚙ note under Q1
- [x] ✅ Write `infrastructure-design/infrastructure-design.md` (2026-10-01)
- [ ] Apply the two `compose.yaml` comment corrections at code generation. ⚠️ Under Q1 = C the
      existing `./config` comment is **right in outcome and wrong in reasoning**, and the inode hazard
      it predicts now belongs on the new `./state` mount
- [ ] ⚠️ **Verify rollback live before U5 ships** (Q3 = A): U4's image against a **v7 copy**, expecting
      `from: 7, to: 7`
- [ ] ⚠️ **Pre-register the BR-35 thresholds in writing before any rule is armed** (carried from the
      FD plan; still open)

---

## Questions

### Question 1 — Where does `automation-state.json` live? ⚠️ This revisits a settled answer

**NFR plan Q5 settled `config/automation-state.json`**, and that answer stands on everything it
considered. ⚠️ **But it did not consider what `:rw` on `config/` grants**, and the consequence is a
posture change rather than a path choice — so it is brought back rather than implemented quietly.

`config/` contains **the user's hand-authored `rules.json`**. Today the app cannot write it, by
deliberate design in both U3 and U4.

| | Option | Grants write access to | New mount |
|---|---|---|---|
| **A** | **`./config:/config:rw`** — as Q5 settled | ⚠️ `rules.json` **and** the state file | no |
| **B** | **`data/automation-state.json`** — `./data` is already `:rw` | nothing new | no |
| **C** | ⭐ **`./state:/state:rw`** — a third mount, for app-written state only | only the state file | **yes** |

**A's cost:** the app gains permission to overwrite `config/rules.json`, the rule set you typed by
hand. No code in U5 would write that file. But the permission would exist, and BR-30 already rejects
the same shape one level down: it forbids giving `LoggingExecutor` a playback collaborator it never
calls, because an unused capability leaves only one line of code preventing its use.

⚠️ **If a bug ever did truncate `rules.json`, BR-20.8 would not save you.** Its last-known-good path
reloads the previous rule set when a new file **fails to parse**. A file truncated to valid-but-empty
JSON parses successfully, so it would be accepted as a deliberate empty rule set.

**B's cost is what happens on a restore.** `data/` holds `history.db`, the one file here that cannot
be rebuilt. The compose comment says hand-edited files stay out of that directory;
`automation-state.json` is written by the app rather than by hand, so that rule does not exclude it.

⚠️ **The objection is restore, and it is specific.** Today `backup-history.mjs` copies only
`history.db*`, so the state file is untouched. But **W-5** is specified as a *full-inventory* backup of
`data/`. Once that exists, restoring a week-old backup would also restore the week-old automation
state. **If automation was armed then and you have since turned it off, the restore turns it back on
and nothing tells you.**

**C's cost:** one extra mount line in `compose.yaml`, and the `./state` directory has to exist before
the first `compose up` — the same first-run requirement that `npm run rules:init` covers for `config/`.

⚠️ **One thing here needs checking rather than assuming.** If `./state` is missing, Docker creates it.
Measured on this host on 2026-09-11, a Docker-created bind-mount directory came out as
`rwxrwxrwx root:root`, and the app (which runs as user `node`) could **read** it. **That measurement
covered reads only, and U5 needs to write.** LC-29's `probeWritable` tests this at startup, so the
check exists — but do not assume the answer before running it.

**Recommendation: C.** It is the only option where `config/` stays read-only permanently, `data/`
contains nothing but the corpus, and the app's new write permission covers exactly one file.

⚠️ **A is your settled answer and it is still defensible**: one word changed, no new mount, and no
code in U5 would write `rules.json`. The trade is a permanent write permission over your hand-authored
rules, in exchange for avoiding one mount line.

[Answer]:
So in the long term we will move from externally manually edited rules to an AI enabled rules system (possibly as a part of this app, possibly as a separate app) but rules.json will EVENTUALLY need to be rw by an app. Does that change the recommendation?

If it doesn't then C is my choice

### ⚙ Answered 2026-10-01: no, it does not change the recommendation — **C stands**

The planned move to an AI-authored rule system does not weaken C, and one part of it makes C the
stronger choice.

1. **C does not block that future.** Today the mounts are `./state:/state:rw` and
   `./config:/config:ro`. When rule editing arrives they become `./state:/state:rw` and
   `./config:/config:rw`. That future change is still a one-word edit. C declines to pre-pay for it; it
   does not obstruct it.
2. **The two files stay different even after both are writable.** `automation-state.json` is a
   machine-written safety latch, rewritten whenever the switch is toggled. `rules.json` is authored
   intent — the user's or an AI's — changed rarely and costly to lose. They want different permissions,
   different backup treatment and different blast radius, so separate mounts remain correct.
3. **"Eventually" is an unbounded window.** Granting `config/:rw` now means the permission exists for
   however long that takes, with no code using it — which is BR-30's argument. ⚠️ This project already
   corrected the same mistake once: the compose comment used to say `:rw` arrives *"at U4"*, and U4 had
   no editor.
4. ⚠️ **The strongest reason, and it is specific to the AI-rules plan: a kill switch stored in the same
   writable directory as the file an AI agent edits is a kill switch that agent can disable** — by a
   bug or by a bad rule-generation pass. U5's automation kill switch should live somewhere the rule
   author cannot reach, and that argument gets *stronger* as the rule author becomes less predictable.

⚠️ **And if the rule system turns out to be a separate app, separate mounts express that cleanly**:
this app gets `state:rw` + `config:ro`, the rules app gets `config:rw`. Under option A this app would
hold a write permission it never exercises while a different process does the writing.

**Settled: C.** `./state:/state:rw`, a new directory mount for app-written state only. `config/` stays
`:ro` in U5 and becomes `:rw` in the unit that adds rule editing — which is what the `compose.yaml`
comment should have said all along.
---

### Question 2 — How is migration 007 deployed?

Same shape as U4's Q1, and the answer there was to let it run automatically.

| | Option |
|---|---|
| **A** | ⭐ **Automatically at startup**, as 005 and 006 were. Back up first (done), build, `up -d`, read the startup log |
| **B** | Run it by hand against a stopped container, then start |
| **C** | Gate it behind an env flag |

⚠️ **B is riskier than it looks, and it has already gone wrong here.** During U4 a maintenance script
wrote to `history.db` while the container was also writing, and it corrupted an index. The app at
startup is the one writer we can be certain is alone, and it runs each migration inside its own
`BEGIN`/`COMMIT`.

⚠️ The script-level guard meant to prevent a second writer **could not see the container at all**
until it was fixed on 2026-09-29. So "run it by hand with the container down" depended on the operator
remembering, not on the guard catching a mistake.

⚠️ **C adds a flag someone has to remember to set.** If the migration does not run,
`SqliteHistoryRepository` leaves `repository` null and the app runs display-only (NFR-13): the page
loads, the track displays, the WebSocket connects, **and nothing is recorded.** On an unattended
autostart nobody reads the startup log, so that state could persist unnoticed.

**Recommendation: A**, with the deployment order stated: ✅ backup verified → `docker compose down` →
build **checking the exit code directly** → `up -d` → confirm `migrated 7:` appears **exactly once**
in the startup log.

[Answer]:
A
---

### Question 3 — Is rollback to U4's image verified live, or taken from the code?

U4 **verified** it rather than reasoning: it ran U3's image against a v5 database and confirmed
`from: 5, to: 5`.

| | Option |
|---|---|
| **A** | ⭐ **Verify live** — run U4's image against the v7 database once, confirm it reports `from: 7, to: 7` and runs normally |
| **B** | Take it from the code. The skip condition is one line and plainly correct |

⚠️ **B proves a narrower claim than the one you need.** Reading that line proves *migration 007 will
be skipped*. It does not prove *U4's code runs correctly against a database carrying one extra table
and three extra columns it never reads*. Those are two separate claims, and the rollback guarantee is
the second one.

Rollback by image is the recovery path if U5 misbehaves, and U5 is the only unit that can interrupt
your music. ⚠️ This project has drawn six wrong conclusions from documentation, each caught only by
running a live probe.

**Recommendation: A.** It costs one container start and it is the recovery path for everything else in
this unit. ⚠️ Run it **against a copy**, not the live corpus — `HISTORY_DB_PATH` already makes that
possible.

[Answer]:
A
---

### Question 4 — Are the BR-35 safety thresholds env-configurable? ⚠️ Recommendation: NO

BR-35.1 halts automation after **3 consecutive** rule-skips. BR-35.2 halts it after **10 rule-skips in
a rolling hour**. The question is only *where those two numbers are stored* — not what they should be.

| | Option | Changing the number requires |
|---|---|---|
| **A** | ⭐ **Constants in the TypeScript source.** Not in `compose.yaml`, not readable from the environment | editing source, rebuilding the image |
| **B** | Environment variables in `compose.yaml`, defaulting to 3 and 10 | editing one line, restarting the container |

Four reasons for A:

1. `compose.yaml` already holds three operational numbers — `POLL_INTERVAL_MS`,
   `RULES_POLL_INTERVAL_MS` and `ENRICHMENT_WAIT_MS`. Putting a number there is the established habit
   in this project, so an exception has to be stated explicitly or someone will follow the habit.
2. These two numbers are a different kind of thing: safety limits, not tuning values. BR-35 says so
   directly — *"If a legitimate rule trips the halt, that is information about the rule."*
3. **The halt will fire during normal listening, not only when something is broken.** The busiest hour
   in the corpus held **27 plays**, so a limit of 10 rule-skips per hour is reached by any rule
   matching more than **37%** of tracks.
4. ⚠️ **If the number lives in `compose.yaml`, changing it is a one-line edit.** When the halt
   interrupts your listening, the easiest response is to raise the limit — say from 10 to 25 — until
   it stops firing. After that it never fires again: the halt remains in the code but no longer
   prevents anything.

**Two existing precedents in this project treat limits the same way.** The Phase 2 hypothesis gate
(BR-11) keeps its thresholds in `pre-registration.md`, and the script's own comment says to change them
by amending that document rather than editing the script. U3's `MAX_PREDICATE_DEPTH` is deliberately
not configurable — `compose.yaml` says *"Only the PATH is configurable. The bounds are not."*

**Recommendation: A**, and the pre-registration written **before** any rule is armed, as the FD plan's
checklist still requires.

[Answer]:
A
---

### Question 5 — Does *armed* survive a restart into an unattended autostart boot?

FR-47 puts automation **off by default** and BR-34.1 **persists** the state. Those are consistent —
"default" means fresh install. But the consequence is worth stating out loud:

> **Once the user arms automation, the app comes back ARMED after a reboot, on an autostart chain,
> with nobody watching.** Windows login → Rancher Desktop → dockerd → container → skipping.

| | Option |
|---|---|
| **A** | ⭐ **Armed persists**, as BR-34.1 settles. A reboot is not a safety event |
| **B** | Armed **does not** survive a restart — re-arming is always a deliberate act |
| **C** | Armed persists, but the **runaway halt** additionally survives (already BR-35.7) and a restart while halted stays halted |

⚠️ **B is tempting for a unit that can cause harm, but it has a real cost.** The app is designed to
run unattended, and this machine sleeps and resumes dozens of times a week. Under B, automation would
be off for most of that time **without saying so**, and you would believe your rules were acting when
they were not. That is the opposite error from an unwanted skip, but it is still a wrong belief about
whether a safety control is active.

⚠️ **C is already true** and is not an alternative: BR-35.7 persists the halt and BR-34.5 fails
closed. Worth confirming rather than choosing.

**Recommendation: A**, with the consequence recorded in `CLAUDE.md` rather than left implicit — ⚠️ **a
reboot resumes skipping**, and the FC-U5-1 indicator showing `disabled`/armed state on the primary
screen is what makes that visible without a click.

[Answer]:
A
---

### Question 6 — Where are M1–M4 exposed?

LC-28 computes them. Q8 settled that diagnostics reports them.

| | Option |
|---|---|
| **A** | ⭐ **`/api/diagnostics` only** — it is already the authoritative surface (NFR-24), already local-guarded, and already the thing the user opens when something looks wrong |
| **B** | A new `/api/metrics` route as well |
| **C** | A Prometheus-style text endpoint |

⚠️ **C is designed to be polled by an external scraper.** That means a second process making
repeated requests, and a new network surface on a deployment that is deliberately local-only
(NFR-01–04).

⚠️ **B adds a second route that has to apply the same access check**, for no capability the diagnostics
route does not already provide. That duplication is what caused the WebSocket `403`: the local-access
policy was written in two places, the two copies drifted apart, and every page load returned `200`
while every WebSocket handshake returned `403`.

**Recommendation: A.** ⚠️ **No new route, and no new WebSocket surface.** If a dashboard ever wants
these, that is **W-1** (read-only HTTP data API), which is deferred precisely because it *"needs a
security architecture this project does not have."*

[Answer]:
A
---

## Out of scope for U5 Infrastructure Design

| | Why |
|---|---|
| New ports | Nothing listens; the `POST` is outbound |
| A metrics scraper or dashboard | **W-1**, deferred — needs a security architecture this project lacks |
| W-5 full-inventory backup | Backlog. The minimal pair is built and the 007 backup is verified |
| **W-7** idle poll backoff | ⚠️ Changes the **recording instrument**, and is blocked on M1–M4 |
| Down-migrations | Forward-only. Rollback is **by image**, which works *because* 007 is additive |
| Moving off `node:sqlite` | R10 is mitigated by NFR-10's interface. Nothing in U5 pressures it |

---

## Standing hazards

- ⚠️ **`docker compose down` before anything that writes `history.db`** — and the script-level lock
  guard **cannot see the container** (probed 2026-09-27; fixed to use `docker ps` 2026-09-29).
  `docker compose down` is the only real protection.
- ⚠️ **Verify the `:rw` write THROUGH THE CONTAINER, never on the host.** On the host the write
  succeeds and the bug is invisible. This is Phase 4 exit criterion 3, and the one most likely to pass
  on the host and fail in the container.
- ⚠️ **Check build exit codes directly** — `docker compose build | tail` reports the *pipe's* exit
  code, and a failing build once read as success here.
- **The app is `http://localhost:3010`.** `localhost:3000` is a different project.
- ⚠️ **A WSL update during Modern Standby can destroy the container engine** (2026-09-30, ~13 hours
  of silent downtime). `restart: unless-stopped` recovers the container once dockerd returns, but
  nothing recovers dockerd. `post-boot-check.ps1` is a **reboot** test and reads `INCONCLUSIVE` for
  this case — read its individual `[PASS]` lines.
