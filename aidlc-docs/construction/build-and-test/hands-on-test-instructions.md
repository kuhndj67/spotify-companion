# Hands-on Test Instructions — every delivered unit, U0–U7

**Written**: 2026-10-09 · **For**: the person running the app, checking by hand that everything works together on the
live deployment · **Time**: about 90 minutes, plus listening time for the music-driven tests.

Automated tests and tonight's U7 Build & Test check pieces. This walks the **whole app as a user meets it** — the
kind of check that found two defects tonight that every test had passed. Record each result in the table at the
end (or tick the boxes) and note anything odd, even if the test "passed".

---

## Before you start — the safety rules

| Rule | Why |
|---|---|
| **The live app is `http://localhost:3010`.** The throwaway test copy is `http://localhost:3011` and exists only between `npm run verify:up` and `npm run verify:down` | A tab left on `:3011` after `verify:down` shows its last state for ever — it looks like a broken app |
| **Never restore a backup into the live app in this plan.** Restore tests use the `:3011` copy | Restore REPLACES your history |
| ⚠️ **Automation is armable.** `SKIP_EXECUTOR_ENABLED` is `true` and the rule **"Over 20 years old AND major"** is enabled and **not** dry-run. Turning *Automated skipping* on **will skip real tracks** | Leave the switch **off** except in test U5-3, and turn it off again there |
| **Credentials**: before any credentials test, keep your own copy of `secrets/spotify-config.json` somewhere outside the project | A save replaces them and the app keeps no previous copy (by design) |
| If something fails, **note the time (and the track)** before retrying | The logs and the decision log are time-indexed |

Useful while testing: `docker logs -f spotify-now-playing` in a terminal · Settings → **Run diagnostics…**.

---

## 0. Preflight — 5 minutes

- [ ] **P-1** Open `http://localhost:3010` and press **Ctrl+F5** (load the current files). *Expect*: the card shows what
  is playing, or **PAUSED / nothing playing**, within a few seconds — never stuck on *Connecting…*.
- [ ] **P-2** The status bar has **five** dots — Recording · Rules vN · Connection · Spotify · Automation — Spotify
  **green**, Automation **off**.
- [ ] **P-3** Settings → **Run diagnostics…** → *Expect* every step ✅ or ⏭. In the **Configuration** block: rules
  directory, Spotify credentials and MusicBrainz contact all *writable*; *Now-playing polls* shows `playing / idle /
  error` with **error 0**.

## U0 — Display and enrichment

- [ ] **U0-1 Now playing** *(music)* Play a track. *Expect*: title, artist, album, art, progress moving, device and
  volume; Track detail fills in within ~10 s (released, age, following, explicit, release type).
- [ ] **U0-2 Liked badge** *(music)* Like the playing track in Spotify, then click the **♥ badge** beside the title.
  *Expect*: it changes to liked; the tooltip says how old the answer is.
- [ ] **U0-3 Reconnects after a restart** With the page open, run `docker restart spotify-now-playing`. *Expect*: the
  Connection dot goes red / *reconnecting…*, then green again within ~15 s **without reloading the page**. (Recording
  pauses ~10 s.)
- [ ] **U0-4 Listening statistics** *(music)* For a track you play often: *Times played* and *First heard* fill in;
  **Weekly plays** draws for the primary artist; *Table view* lists the same weeks.

## U1 — Listening history and export

- [ ] **U1-1 A completed play** *(music)* Let a track play to the end. Then Settings → **Export history…** and find it.
  *Expect*: outcome **completed**.
- [ ] **U1-2 A skipped play** *(music)* Skip a track yourself, well before its end (press Next in Spotify). *Expect* in
  the export: outcome **skipped**, skip source **user**.
- [ ] **U1-3 Export formats** Export once as CSV and once as JSON; open both. *Expect*: unknown values appear as the
  word `unknown`, never blank and never `0`.
- [ ] **U1-4 Snapshots** `ls data/snapshots/` — *Expect*: a dated file from within the last 24 h, and no more than 14.

## U2 — Label enrichment

- [ ] **U2-1 Label on a recent play** *(music)* Play a track from a well-known major-label album. Within ~10 s:
  *Expect* **Label** shows a verdict and **Label detail** names the label(s) — or explains itself (*not yet resolved* /
  *MusicBrainz lists no label*), never a bare dash.
- [ ] **U2-2 Coverage** Diagnostics → the coverage figures carry an *as of* time.
- [ ] **U2-3 Explain a play** Diagnostics → enter a recent play id in **trace** → *Expect*: the resolution trace (ISRC →
  release → label → verdict).

## U3 / U4 — Rules and observability

- [ ] **U3-1 Loaded set** Rules → *Loaded rule set*: *Expect* the two rules; **Major-label release** marked disabled (by
  you), **Over 20 years old AND major** active.
- [ ] **U4-1 Decision log** *(music)* After a few tracks, the Decision log has **one row per track**, matched or not,
  each naming the rule, the verdict and *settled* timing. Tick **matches only** → only matches remain.
- [ ] **U4-2 Why didn't it fire?** Expand **N field(s) read** on a row → *Expect*: the values the rule saw (age, label).
- [ ] **U4-3 Re-read file** Click **Re-read file** → the version stays the same if nothing changed.

## U5 — Automated skipping ⚠️

- [ ] **U5-1 Off by default** Rules → *Automated skipping*: *Expect* **off**, and the status-bar Automation dot says off.
- [ ] **U5-2 The switch persists** Turn it **on**, then immediately **off**. Run `cat state/automation-state.json` —
  *Expect* `"globalAutomationEnabled": false`. Restart the container — still off.
- [ ] **U5-3 A real skip** *(music — optional, deliberate)* Turn automation **on**. Play a track over 20 years old on a
  major label (e.g. a classic-rock single). *Expect*: skipped within ~10 s; the decision log shows the match and the
  attempt. **Turn automation off.**
- [ ] **U5-4 The runaway halt** *(optional)* With automation on, three matching tracks in a row → *Expect*: the third is
  skipped, the fourth is **refused** with a halt shown in the Rules pop-up. Acknowledge it; **turn automation off**.

## U6 — Backup and restore

- [ ] **U6-1 Create backup (live)** Settings → **Create backup**. *Expect*: a `spotify-backup-…tar.gz` download
  (~2 MB) while music keeps recording.
- [ ] **U6-2 The backup is real** Extract it to a folder, then `npm run db:restore -- <folder> --verify-only` →
  *Expect* **✅ VERIFIED RESTORABLE**.
- [ ] **U6-3 Restore round trip (copy)** `npm run verify:up` → open **`http://localhost:3011`** → Settings → **Restore
  backup…** with the file from U6-1 → *Expect* a comparison table (backup vs current), the warning, **Restore**
  disabled until you type `RESTORE` → restore → the page says it is restarting and comes back with *Restored N plays*.
- [ ] **U6-4 Undo restore (copy)** **Undo last restore…** → same confirmation → the copy's previous history returns.

*(Keep the `:3011` copy running for U7-5 and U7-7; `npm run verify:down` at the end.)*

## U7 — Configuration management (new)

- [ ] **U7-1 Download, edit, upload (live)** Rules → **Download rules** → edit the file: change the **name** of
  *Major-label release* (only the name) → **Upload rules…** → *Expect* the comparison **"1 changed"** naming the rule and
  the field `name`; plain **Apply** (no typed word) → *"Applied — … version N; no restart needed"*; the loaded set shows
  the new name.
- [ ] **U7-2 Undo (live)** **Undo last rules change…** → the comparison shows the reverse change → Apply → old name back.
- [ ] **U7-3 The guards (live)** Without downloading first, upload a file containing `{"version":1,"rules":[]}` →
  *Expect* **"2 removed"**, both reasons (*removes N of your N rules* and *wasn't downloaded in this
  session*), **Apply visibly greyed** until you type `REPLACE`. Then click **Cancel** — your rules are unchanged.
- [ ] **U7-4 The "becomes live" warning (live)** Download, set `"enabled": true` on *Major-label release*, upload →
  *Expect* the bold warning **"…will be able to skip tracks once automation is on"** above the comparison. **Cancel.**
- [ ] **U7-5 Broken credentials show RED (copy)** On `:3011` (no real credentials): *Expect* the Spotify dot **red ✗**
  and the line *"Spotify returned an error: … Failed to get access token."* — never *ok* or *PAUSED*.
- [ ] **U7-6 Credentials section (live — read only)** Settings → **Spotify**: *Expect* *"Set · client xxxx…xxxx · …"*;
  **How do I get these?** lists five steps; **Save…** is greyed with *"Fill in all four fields to save."* Do not save.
- [ ] **U7-6b Re-save your credentials (live — optional)** With your own copy kept: **Fill from spotify-config.json…** →
  pick `secrets/spotify-config.json` → **Save…** → read the warning → **Replace credentials**. *Expect*: *"Saved.
  Checking with Spotify…"*, the Spotify dot stays/turns **green** within a few seconds, playback keeps updating.
- [ ] **U7-7 Restore with rules (copy)** On `:3011`, upload a backup whose rules differ from the copy's (change the
  copy's rules first, as in U7-1) → *Expect* the **unticked** box *"Also replace my rules with the backup's"*; ticking it
  shows the rules comparison. Restore once **ticked** (rules replaced; the message says so) and once **unticked** (rules
  kept; no rules sentence).
- [ ] **U7-8 MusicBrainz contact (live — read only)** Settings → **MusicBrainz**: *Expect* *"Contact: x…y@domain"*.
- [ ] **U7-9 Diagnostics** Run diagnostics after U7-1 → *Last rules write* shows the upload as *applied* with its
  version; after U7-6b, *Last credentials change* shows *spotify: saved* — and **no credential value anywhere**.

Finish the copy: `npm run verify:down` → *Expect* **✅ Removed. The live deployment is unchanged…** (if it lists
*tracked files changed*, check whether you edited project files meanwhile — that alone is expected).

## Ops — the deployment itself

- [ ] **O-1 Autostart after a reboot** Reboot, log in, wait 3 minutes, then `powershell -File scripts/post-boot-check.ps1`
  → read each **[PASS]** line (the overall verdict can say *INCONCLUSIVE* for reasons that are fine — see CLAUDE.md).
- [ ] **O-2 Docker CLI** `docker ps` from Windows works (it broke after the 26H2 update until a reboot).
- [ ] **O-3 Rancher log size** `ls -la %LOCALAPPDATA%\rancher-desktop\logs\docker.log` — *Expect* small (KB–MB), not
  growing fast. (It reached 4.8 GB from a retry loop on 2026-10-08.)
- [ ] **O-4 Rollback image exists** `docker images spotify-now-playing` → `u6-rollback` present.

---

## Results

| Test | Pass / Fail / Skipped | Notes (time, track, what you saw) |
|---|---|---|
| P-1 … P-3 | | |
| U0-1 … U0-4 | | |
| U1-1 … U1-4 | | |
| U2-1 … U2-3 | | |
| U3-1, U4-1 … U4-3 | | |
| U5-1 … U5-4 | | |
| U6-1 … U6-4 | | |
| U7-1 … U7-9 | | |
| O-1 … O-4 | | |

**When something fails**: note the test id, the time, and what the screen said; run diagnostics and keep the output;
then tell Claude the test id — the logs and decision log can be read from there.
