# U10 — Data Safety — Business Rules (BR-78 … BR-86)

**Inputs**: FR-76…81 (FR-56/76/79/80 as amended 2026-10-21) · FD plan Q1–Q6 (all A) · US-33.
⚙️ marks a decision that is **pure** (a function of its inputs) and so a property-test candidate; PBT numbers are
allocated at NFR Design, not here.

---

## BR-78 — One writer per database (FR-77; Q3 = A)

- **78.1 Where and what.** The lock is `<database>.lock`, beside the database (`data/history.db.lock`), so it is on
  the same mount as what it guards. It holds a **token** (random, per acquisition), the holder's **kind** (`app` or
  `script:<name>`), process id, host name, app version and acquisition time. It never appears in a backup, an export
  or an HTTP response other than diagnostics.
- **78.2 Acquire** by **exclusive create** (create-if-absent; `EEXIST` means held). Measured to be exclusive across
  the bind mount in both directions.
- **78.3 Held by another: watch, do not guess.** Read the holder; watch the lock's heartbeat (its modification time)
  for one **stale window**. It moved → the holder is alive → **refuse**. It did not move → stale → take over
  (78.4). Staleness is never judged by comparing this machine's clock with the lock's time. ⚙️ The verdict
  (alive / stale) from two observations and the window.
- **78.4 Take over without a race.** Only a process holding the **takeover mutex** (`<database>.lock.takeover`,
  itself taken by exclusive create) may delete a stale lock. Under the mutex it reads the lock **again** and deletes
  it only if it still carries the token it watched; then it creates its own lock by exclusive create and releases
  the mutex. Two would-be takers therefore cannot both win, and nobody deletes a lock that changed hands meanwhile.
  A mutex older than the stale window is itself stale and is removed (logged).
- **78.5 Heartbeat and self-check.** The holder touches the lock every heartbeat interval, then reads it back: a
  missing lock or a different token means it has **lost** the database; it stops writing at once, closes it, and
  history becomes unavailable until a restart. It never re-takes the lock on its own.
- **78.6 Release.** On orderly shutdown the holder deletes the lock **only if it still carries its token**.
- **78.7 Who takes it.** The app (container or host) and every script that **writes** `history.db`: `db:restore`,
  `db:backup`, `reclassify -- --apply`, `repair-*`. The lock **replaces** their `docker ps` guard and its
  `--i-have-stopped-the-container` override. Read-only scripts take none. ⚠️ A guard must be seen to fail: a test
  holds the lock and shows each writing script refusing.
- **78.8 Refusal is loud and harmless.** A refused app runs display-only; diagnostics **fail** naming the holder's
  kind, host name and how long its heartbeat has been moving; the recording indicator says history is unavailable.
  A refused script exits non-zero with the same facts. Neither touches the database.
- **78.9 Order.** The lock is taken **before** the startup restore swap (U6), which is a write.

## BR-79 — A backup before a risky change (FR-76a, as amended; Q1 = A)

- **79.1 Triggers.** At startup, after the lock and the restore swap and before migrating: a backup is due when
  **(a)** a migration is pending, or **(b)** the database's recorded *last app version* differs from the running
  version, or is absent. ⚙️ `due(pending, lastVersion, runningVersion)`.
- **79.2 Through the app's own connection**, before migrating: U6's `createBackup`, into the store (BR-80), kind
  `before-change`, the reason in the manifest's label (e.g. *migration 7→8*, *version 1.0.0-beta.8→1.0.0-beta.9*).
- **79.3 Refuse on failure.** If the backup fails for any reason, the app does **not** migrate and does **not**
  record: it closes the database untouched and runs display-only; diagnostics fail with the reason.
- **79.4 Last app version** is stored **in the database** (a one-row metadata table, added by the migration U10
  introduces), because it is a property of that database: a restored file brings its own. It is written **after**
  a successful migration, never before the backup.
- **79.5 A downgrade is a change too.** Running an older image against a newer database (a rollback) is a version
  difference and is backed up first; migration then applies nothing, as today.

## BR-80 — The kept-backup store (FR-76, FR-80; Q2 = A)

- **80.1 One format.** Every kept backup is the archive *Create backup* makes, built and verified exactly as U6 does;
  *Restore backup* must accept every file the store holds. ⚠️ Positive control: a test restores a kept backup through
  the upload path.
- **80.2 Place.** `data/backups/scheduled/` and `data/backups/before-change/`, beside the database (derived from
  `HISTORY_DB_PATH`). No new setting.
- **80.3 Atomic arrival.** Built in `data/.work/`, then moved into place by rename on the same mount, so the store
  never holds a partial file.
- **80.4 Rotation per kind.** Scheduled: keep `SNAPSHOT_KEEP` (default 14). Before-change: keep 5 (configurable).
  Rotation deletes only that kind's own `spotify-backup-*.tar.gz` files, oldest first, and only **after** the new one
  has arrived. ⚙️ `toDelete(files, keep)`. Nothing else in `data/` is ever deleted; the old CSV snapshots stay.
- **80.5 One operation at a time.** A kept backup takes U6's busy lock (BR-51.3); a scheduled backup that finds it
  busy tries again at the next check.

## BR-81 — Scheduled backups, truthfully reported (FR-80, as amended)

- **81.1 Scheduled from disk.** Every 15 minutes, and once at startup: if the newest scheduled backup is older than
  the interval (`SNAPSHOT_INTERVAL_HOURS`, default 24), or none exists, take one. At most one per interval, whatever
  the restarts. ⚙️ `due(newestAt, now, interval)`.
- **81.2 Diagnostics step *Backups*** (replaces *Snapshots*). ⚙️ Level from (newest scheduled, uptime, interval, last
  error):
  - **fail**: the last attempt failed; or none exists after one interval of uptime;
  - **warn**: the newest is older than two intervals; or none exists yet, within the first interval;
  - **ok**: the newest is within two intervals. **Never ok for "none written".**

  The detail names the newest of each kind and its age.
- **81.3** Diagnostics gains the level **warn**; a run with warnings and no failure is not a failed run.
- **81.4** The CSV timer is **retired**; *Export* (on demand) is unchanged.

## BR-82 — Backup before a release deploys (FR-76b)

- **82.1** `npm run release -- --apply` asks the running app, before building, to keep a before-change backup with
  the reason *release &lt;version&gt;*.
- **82.2** It continues only if the app reports the backup kept **and** the host sees that file under
  `data/backups/before-change/`.
- **82.3** App unreachable or busy after retries → refuse, naming the cause. `--app-is-down` overrides that refusal
  only, and the output then says that the new version will back up before its first run (BR-79).

## BR-83 — `update` (FR-79, as amended)

- **83.1** Exactly one `image: ghcr.io/kuhndj67/spotify-companion:<version>` line in `compose.yaml`, or refuse.
- **83.2** ⚙️ `decideUpdate(current, own)`: own **older** → refuse; **equal** → no change; **newer** → rewrite.
  SemVer precedence (pre-releases rank below their release).
- **83.3** Rewrite **that line only**; every other byte, line ending and comment is kept. ⚙️ The rewrite is a
  function of the file and the version. Written to a temporary file in the folder, then renamed.
- **83.4** Never touches `data/`, `config/`, `state/` or `secrets/`; needs neither the app nor its network.
- **83.5** Prints the next command and the Release page; says the updated app backs up first.

## BR-84 — Developer data apart (FR-78; Q4 = A)

- **84.1** A host run with no `HISTORY_DB_PATH` uses `data-dev/history.db`; the container's path is unchanged.
- **84.2** `data-dev/` is gitignored and excluded from the image build context.
- **84.3** Startup prints which database it opened (as today), so a developer sees `data-dev` at once.
- **84.4** Scripts keep `data/history.db`; the lock (BR-78) refuses them while anything holds it.

## BR-85 — The update check (FR-81)

- **85.1 Opt-out.** Enabled unless `state/update-check.json` says otherwise (absent = enabled, Q35 = B). Disabled
  means **no request at all**, including the startup one.
- **85.2 Timing.** About a minute after start, unless the last check was under an hour ago; then every 24 hours.
  Turning it on in Settings schedules a check under the same one-hour rule.
- **85.3 The request.** One anonymous `GET https://api.github.com/repos/kuhndj67/spotify-companion/releases?per_page=10`;
  no token, no cookie, no identifier beyond what any HTTP request carries. ⚠️ **Not** `/releases/latest` (404 while
  every release is a pre-release, measured).
- **85.4 Its own User-Agent**, `spotify-companion/<version>`. ⚠️ Never the MusicBrainz User-Agent, which carries the
  user's contact address (NFR-14). Positive control: a test with a contact address configured shows it absent from
  the request.
- **85.5 Which releases count.** ⚙️ `newest(releases, running)`: not drafts; tag `v<SemVer>`; pre-releases only if the
  running version is a pre-release; the highest by SemVer precedence; *newer* only if strictly above the running
  version.
- **85.6 Untrusted response.** Only the tag, the pre-release and draft flags and the page URL are read. The URL is
  shown only if it begins `https://github.com/kuhndj67/spotify-companion/releases/`; everything is rendered as text.
- **85.7 Silent failure.** A failed or malformed check keeps the last good answer and records *could not check
  (time)* for Settings. The status bar never shows an error for it.
- **85.8 Never on the poll's path**: its own timer and request; never the Spotify client, queue or budget.
- **85.9 The preference** lives in `state/` (runtime state beside the kill switch): not `data/` (backed up and
  restored with the history), not `config/` (written only by `RulesWriter`). Written by temporary file and rename.

## BR-86 — What the user sees (FR-80, FR-81; Q5 = A)

- **86.1 Settings → Version** shows *App version &lt;v&gt;*; when a newer version exists, one line beneath it:
  *"&lt;new&gt; is available: what changed"* (the Release page) and how to update (FR-79's `update`, or the
  documents for a source install).
- **86.2** Beside it, the switch *Check GitHub for new versions* and one sentence saying what is sent and to whom.
  The sentence is always visible while the switch is: it is the user's only notice of the call.
- **86.3 Status bar.** An *Update* indicator appears **only** when a newer version exists; it never takes the message
  line; glyph and label as well as colour.
- **86.4 Settings → Backup & restore** shows the newest kept backup of each kind and its age, and the folder path.
  Restoring stays *Restore backup*. No list, no second restore path.
- **86.5 Status indicator** *(added 2026-10-22, NFR Q3)*. One status-bar indicator, **Status**, always visible: a
  light **and** its text. ⚙️ Its level is the worst of its sources; U10's sources are backup health (BR-81.2), a
  refused or lost lock (BR-78.8, 78.5), a failed before-change backup (BR-79.3) and, added 2026-10-22, the backup reminder (BR-87). Healthy → `ok`; otherwise `warn`
  or `fail`, and its pop-up says *Check the Diagnostics page*. Later units add sources; it never takes the message
  line.
- **86.6 Diagnostics button** *(added 2026-10-22, NFR Q3c; amends FR-63)*. The header reads **Settings ·
  Diagnostics · Rules**. *Diagnostics* opens the existing diagnostics pop-up, moved out of Settings with its ids and
  test ids kept.
- **86.7 Backup reminder** *(added 2026-10-22, FR-82)*. See BR-87.

## BR-87 — A reminder to keep a copy elsewhere (FR-82; added 2026-10-22, owner)

- **87.1 What counts.** Only a *Create backup* download whose response **completed** (every byte sent). A refused,
  failed or abandoned download does not count; kept backups in `data/backups/` do not count (they share the
  database's disk, IN-U10-2). The app cannot know the user kept the file, so the words say *downloaded*, never
  *saved*.
- **87.2 The clock.** ⚙️ `reminderLevel(enabled, lastDownloadAt, firstRunAt, now)`: off → nothing; otherwise **warn**
  when the latest of the last completed download and the first run is more than **7 days** ago, else **ok**. A fresh
  install is therefore not warned in its first week. Never **fail**: a missing off-machine copy is a risk, not a
  fault.
- **87.3 Where it is kept.** `state/backup-reminder.json` (`enabled`, `lastDownloadAt`, `firstRunAt`), not `data/`:
  restoring an older database must not roll the date back. Absent file → enabled, `firstRunAt` = now (written once).
- **87.4 Where it shows.** A diagnostics step *Copy elsewhere* (warn: *No backup downloaded since &lt;date&gt; (N
  days)*), and a source of the **Status** light (BR-86.5), so the light turns yellow (warn) with *Check the
  Diagnostics page*.
- **87.5 Opt-out.** Settings → *Backup & restore*: a switch *Remind me to download a backup every week*, with the
  sentence *Turn this off if the whole computer or server running the app is already backed up.* Off → no step
  level, no Status source.
