# Contributing

Thanks for looking. This is a small, single-user app with an unusually long memory of its own mistakes. Most of this
file is that memory, the **traps** below, because they are what a newcomer, person or AI agent, would otherwise
rediscover the hard way.

To run it first, follow [`docs/INSTALL.md`](docs/INSTALL.md), then run `npm ci` once in the `spotify-companion`
folder to install the development dependencies that `npm run verify` needs. Licence: GPL-3.0-or-later ([`LICENSE`](LICENSE)).
Security reports: [`SECURITY.md`](SECURITY.md), not public issues.

---

## Two paths for a change

**1. A fix**: the behaviour is already specified (a requirement, business rule or test says what should happen) and
the code does not do it.

- Branch, change, add or fix the test that shows it, and run **`npm run verify`** (typecheck · tests · smoke ·
  knip). ⚠️ `npm test` alone has never been enough here.
- Open a pull request. CI must pass every required check: **Typecheck, test, smoke, knip, build** · **Container image
  builds** · **Secret scan**.

**2. A feature or a new requirement**: anything that changes *what* the app should do.

- It goes through the project's **AI-DLC** workflow before code: Inception (requirements, stories, units) and then
  the unit's design stages (Functional → NFR → Infrastructure → Code Generation → Build & Test). The owner approves
  each gate. The records live in [`aidlc-docs/`](aidlc-docs/): start at
  [`aidlc-docs/aidlc-state.md`](aidlc-docs/aidlc-state.md). Decisions and their reasons are in
  [`aidlc-docs/audit.md`](aidlc-docs/audit.md), which is append-only.
- Questions go in the existing documents: inception questions in the requirements and units plans, unit questions
  in `aidlc-docs/construction/plans/uN-*-plan.md`. **Do not invent new document types.**

**`main` is protected**: changes arrive by pull request, and the checks above are required. ⚠️ **The owner may push
to `main` directly.** That bypass is deliberate and lives in the committed ruleset
([`.github/rulesets/main.json`](.github/rulesets/main.json)), where review can see it. It is not hidden in settings.

**Versions** follow SemVer, and `package.json` is the only source. A release is `npm run release` (owner only). It
refuses unless verify passes, the tree is clean, and the version is new and greater than every release.

---

## The working rule: probe, don't reason

**Spotify's Development Mode has been restricted twice since 2024, and its documentation does not say so.** This
project drew a wrong conclusion from documentation six times, each caught only by a live probe:

- `GET /me/following/contains` returns **403** despite a valid scope. So does `GET /me/tracks/contains`, while
  `GET /me/tracks` works.
- `GET /artists/{id}` returns **no `genres` field at all**.
- `GET /tracks?ids=` returns **403** (even for one id), while `GET /tracks/{id}` works.
- `GET /artists/{id}/albums?limit=20` returns **400 "Invalid limit"**. `limit=10` works, the documented maximum of
  50 fails, and `album_group` is absent. ⚠️ A sandbox restriction that reads as *your query string is wrong* sends
  you auditing your own code.
- MusicBrainz `GET /ws/2/isrc/{id}?inc=releases` returns **200 with `inc` silently ignored**.

The pattern: Development Mode blocks membership checks and batch endpoints and leaves single-item and list endpoints
open. The workaround is always **fetch the set once, cache it, resolve locally**.

⚠️ **A wrong request shape is indistinguishable from absent data.** The MusicBrainz case returned plausible data
(19 ISRCs with "no releases") and read as a coverage finding. It was caught only by checking a track *known* to have
44. **When a probe says "no data", check it against a case where you know the answer.**

---

## Traps

Each of these is short. The full story is in `aidlc-docs/audit.md` under the date given.

### Evidence and measurement

- **Recorded claims decay because nothing re-tests them.** A note said `recently-played` returns no ISRC; a probe
  showed it does (2026-09-20). A script's docstring said it refused while the app held the database; it did not
  (2026-09-27). **Re-probe a "the API doesn't do X" or "this is safe" note before building on it.**
- **A plausible inference is not a measurement.** WAL file size was read as "a `.db`-only copy loses half the
  corpus"; it lost 3%, the newest rows, and still passed `integrity_check` (2026-09-27). A file-time offset was
  inferred from one coincidence and was wrong. A log-growth mechanism fitted one observation and was refuted by the
  next (2026-10-13). **Measure before you write it down.**
- **Ask what is in the denominator.** Averaging two causes of a missing label read as a 28%→12% coverage collapse;
  the truth was 86%→44% (2026-09-05). A pre-registration draft nearly said 40% from the wrong denominator.
- **Coverage cannot see a file no test imports.** V8 coverage reported 98.96% while `server.ts` had no tests: an
  unloaded module is missing from the denominator, not counted as 0%. `test/noOrphanModules.test.ts` catches
  unreached modules. **knip** catches dead methods inside live files, which that test cannot see.
- **A fixture built around a mental model confirms the model.** Twice in one day a test passed for a wrong
  behaviour because its data was written to match the belief: a halt "off by one", and a time-window match that
  failed live by 11–14 ms (2026-10-04). Coverage cannot see this.
- **A dead *value* is not dead *code*.** `skip_source` was read and written everywhere but never set to `'rule'`,
  so the runaway halt could not fire while its module sat at 100% coverage (2026-10-04).
- **Click-test and LOOK at destructive controls.** A *Restore* button looked enabled while disabled; every test
  passed because they asserted the state, which was right (2026-10-08).
- **Absence of data is not a signal.** "No new plays" looks identical to "the user didn't listen" and to "the app
  was down for 13 hours" (2026-09-30). Detection needs a *positive* heartbeat, and the app cannot report its own
  absence.
- **Pre-registered thresholds are constants, not parameters.** Change them by amending the pre-registration, never
  by editing a script. The hypothesis gate's single confirmatory run is **spent** (2026-09-10); any re-run is
  exploratory.
- **A check that cannot fail is not a check.** CI's test step piped into `tee` without `pipefail`, so a failing
  test **never failed CI**, until a PR built to fail went green (2026-10-14). Every workflow now runs
  `shell: bash` (`-eo pipefail`), pinned by a test. Prove a new gate by watching it refuse something.
- **`smoke` is a LOAD check.** It proves every script in `scripts/` starts in a safe mode. It does not prove the
  scripts work. A script once sat dead for a week with the suite green (2026-09-29).

### Data

- **Store observations, derive judgements.** Observation trails are kept so verdicts can be recomputed under a
  better classifier, and they already have been (classifier v2, 2026-09-22).
- **`null` means unknown, never `false` or `0`**, end to end. Exports print the literal `unknown`. Missing data here
  correlates with what is being measured.
- **`error` is not `unknown`, and a transient failure must never become permanent.** Three defects had this shape,
  and all passed the suite (U2).
- **Never clamp `completionRatio` to 1.0.** A replay legitimately exceeds it.
- **A ratio threshold over a constant-time effect generates a confound.** The AI DJ cuts 18–50 s off a track; as a
  ratio that files every short track as a skip. Classifier v2 thresholds **milliseconds of unobserved tail** (2026-09-22,
  mechanism corrected 2026-09-27).
- **`unknown` is two facts**: *inconclusive* (watched, could not classify) and *not-observed* (backfilled while the
  app was not running). Provenance decides, in `bucketOf`. `not-observed` is counted everywhere and drawn nowhere,
  on purpose (2026-09-06).
- **Play rows are never deleted or relabelled to tidy a display.** `recently-played` is a 50-play window. Lose a row
  and it never comes back.
- **`played_at` from `recently-played` is when the track FINISHED.** Deduplication is keyed on the end (2026-09-06).
- **The artist credit is a joined string on the live path**, and `artist_id` is the primary artist only, so
  per-artist counts undercount guests (~24% for one artist). Group aliases like `Inpatient` are real artists (backlog
  W-4).
- **Week buckets are built in JavaScript, never SQLite's `%W`/`%U`**, which emit a broken week `00` at year ends.
- **MusicBrainz `browse /release?artist=` counts releases the artist only guests on**, and a capped fetch whose
  count is stored is a truncation recorded as fact. The artist-level label verdict was removed for this (2026-09-06).
- **A work set needs a terminator that a permanent absence can satisfy**, or the same nothing is re-requested for
  ever (`artist_resolution_id IS NULL`, not `artist_genres IS NULL`).
- **MusicBrainz throttles tighter than its 1 req/s policy.** The bounded retry is load-bearing.
- **An empty state that does not explain itself will be "fixed" as broken.** Say *not yet resolved* and why.

### Code

- **`PlayObserver` consumes `tick`, never `change`.** `change` is signature-suppressed and excludes progress.
- **Pure modules import nothing impure.** One `Date.now()` in the classifier breaks re-derivation while every other
  test passes; `test/purity.test.ts` is the only guard.
- **One admission rule, invoked twice, never written twice.** `ws` does not run Express middleware, so the
  WebSocket upgrade calls `decideAccess` explicitly. A copied policy once diverged: pages loaded and every socket got
  403 (2026-09-05). Routes live in `src/api.ts` with injected dependencies (including `now`); the upgrade handler
  stays in `src/server.ts`.
- **A guard computed the same way as the thing it guards is not a guard.** A recursive depth check would have
  overflowed on the very trees it existed to refuse. `depthOf` is iterative.
- **A guard that cannot observe its condition is worse than none.** SQLite's locks do not cross the Rancher Desktop
  bind mount, so a lock probe said "free" while the container was writing (2026-09-27). The working check is
  `docker ps`, and it **fails closed**.
- **A guard that reads a label is disabled by a labelling bug.** The halt now joins `skip_attempt` directly.
- **`exists` cannot exist in a tri-state language**: use `is-unknown`. `restedOnUnknown` is the raw verdict, never an
  accumulator.
- **Genre matching is per element and on word boundaries**, or `rap` matches `trap`.
- **`onUnknown: 'hold'` is stored but not yet live** (FR-33 is partly met). The `applyOnUnknown` switch has no
  `default:` on purpose: a new `OnUnknown` member is a compile error where it must be handled.
- **A property-test generator that recurses per branch is exponential.** Build the child arbitrary once.
- **Automation has two off switches and they are not redundant**: `SKIP_EXECUTOR_ENABLED` (restart) and the UI
  kill switch (checked at every action point). The kill switch lives in `state/`, **never** `data/` (a restore would
  re-arm it) or `config/` (an agent editing rules could disable it).
- **Halted-and-still-armed is a real state**: a runaway halt is its own latch and never writes the switch. A
  halt's evidence must list only the attempts its own trigger counted.
- **Never retry a skip.** A `Retry-After` honoured on the skip path means *skip whatever is playing in 30 seconds*.
  Anything whose landing is unknown counts as landed.
- **The BR-35 safety thresholds are not environment variables**, or the obvious fix becomes raising them.
- **One writer.** Backup and restore run inside the app on its own connection. A second writer reintroduces the
  cross-machine guard problem.
- **Every uploaded file goes through one admission path** (FR-64). Do not add a second.

### Operations

- **The deployment is the container on `http://localhost:3010`.** Port 3000 on the owner's machine is a different
  app.
- **Never run the container and `npm start` together**: both poll Spotify and both write `data/history.db`.
  `docker compose down` first.
- **`data/` is the only thing that cannot be regenerated**, and being gitignored makes it *more* exposed to `git
  clean -xdf`. **Verify a backup the day you take it.** Row counts are not verification: a corrupt snapshot with
  plausible counts is kept as the negative control.
- **SQLite WAL over the Rancher Desktop bind mount works**: probed, despite general advice. Do not re-derive; re-probe.
- **A single-file bind mount binds an inode.** Write-temp-then-rename needs a directory mount: a rename onto a
  single-file mount fails with `EBUSY` (probed 2026-10-18). Since U9 the credentials are a **directory** mount
  (`./secrets` → `/app/secrets`) and every writer renames.
- **The connector is pinned, and patched in one line.** `compose.yaml`'s `MCP_SERVER_REF` is the one pin (the
  Dockerfile default and `npm run mcp:setup` follow it; a test holds them equal). Moving it repeats U9's acceptance
  on the verification install (`npm run verify:up -- --candidate --probe-credentials --poll-ms 3000`) and needs a
  `pass` in `scripts/connector-acceptance.json`, or `npm run release` refuses. Dependabot never moves it. The
  Dockerfile patches upstream's fixed config path to honour `SPOTIFY_CONFIG_PATH` (`scripts/lib/patchConfigPath.ts`);
  the build fails if upstream changes that line. It goes when upstream accepts an equivalent override.
- **Renaming a compose service orphans the old container**, and `up`/`down` leave an orphan running. U9 renamed
  everything to `spotify-companion`; upgrading from `1.0.0-beta.2` stops the old container first
  (`docs/INSTALL.md`, *Updating*), and `npm run release` refuses while it runs.
- **Check build exit codes directly.** `docker compose build | tail` reports the pipe's exit code.
- **The owner's host is UTC−4.** Check `ls --time-style=full-iso data/snapshots/` before reasoning about any file
  time. A WAL mtime is the last write, never a heartbeat.
- **The autostart chain is proven for reboot, not for a WSL update during Modern Standby**, which has taken the
  engine down twice. `restart: unless-stopped` does not restart a container someone explicitly stopped.
  `scripts/post-boot-check.ps1` is a reboot test: after a resume it says INCONCLUSIVE even when healthy, so read its
  `[PASS]` lines.
- **The 3 s poll is ~98% of the app's Spotify traffic.** Spotify publishes no rate number, so zero 429s is not
  evidence of headroom.
- **A probe that writes to the player runs with the container down**, or its skips enter the corpus.
- **The AI DJ exposes no queue**, and `context.type` cannot tell it from a radio station. Ask the queue at runtime.
