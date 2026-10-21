
---

## 2026-10-18T23:40:00Z — New scope: data safety for users and developers; Inception re-entered (Q29–33, Units Q8)

Owner asked whether the design already covers: new users never getting the owner's database; users updating without
losing theirs (*"maybe part of the pipeline?"*); developers safe from losing theirs. **Measured**: the first is
covered (no `.db` tracked; `data/` ignored by git and build; the image check refuses it; App-only setup creates an
empty `data/`). The other two only partly: no automatic backup before migration or release; **automatic snapshots
silently stopped on 2026-10-03** (24-hour timer reset by every restart, never run at startup) while diagnostics
reports `ok` ("scheduled; none written yet"), a false green; host `npm start` defaults to the container's own
`data/history.db` with nothing but `CLAUDE.md` stopping two writers; no App-only update path.

Owner (question prompt): **"New unit before U10 (Recommended)"**; sample database: **"No sample db"**. Opened:
Requirements **Questions 29–33** (`requirement-verification-questions.md`) and Units **Question 8**
(`unit-of-work-plan.md`). U9 continues unchanged (Build & Test awaits approval of its Code Generation).

---

## 2026-10-18T23:55:00Z — Data-safety round answered: Q29–33 all A, Units Q8 = A → U10 Data Safety; NAS → U11, Team Operations → U12

Owner: Q30–33 and Units Q8 answered **A** in the files; Q29 was left blank and answered by question prompt: *"A: both
(Recommended)"*, then *"I accepted the recommendation for 29"*. Written: `requirements.md` §3.10 **FR-76…80**;
**U10 Data Safety** declared in `unit-of-work.md`; renumbered in the living Inception documents and in the two code
comments that name the NAS (`src/api.ts`, `compose.verify.yaml`). **U9's own records** (written earlier the same day)
keep "U10" for the NAS, stated in `unit-of-work.md`.

**Also this round**: the owner **merged PR #3** (U9's code) into `main` (`cc32bf0`). Nothing is deployed by a merge;
U9's Build & Test is still to run. The data-safety commit `40873c2` had been pushed after the merge, so this work
continues on a new branch `inception-data-safety` from `main`. The owner's answers and README edit had been stashed to
move them across; the stash conflicted, and an attempted `git reset --hard` was blocked as destructive (correctly).
Rebuilt without discarding anything: the two question files from the stash, `audit.md` and `aidlc-state.md` from
`40873c2`; verified the result equals `40873c2` plus the owner's answers and README text. The stash is kept.

**README** (owner's new *Why it exists → Secondary* paragraph): light edits keeping the owner's voice: `dev's` →
`developers`, `VSCode` → `VS Code`, a comma, trailing spaces, and the *Primary*/*Secondary* labels made bold on the
paragraph's first line (as separate lines they ran into the paragraph when rendered).

**Gate**: requirements and units round awaits the owner's approval before U10's Functional Design. U9's Build & Test
awaits approval of its Code Generation.

---

## 2026-10-19T00:10:00Z — ✅ U10 round APPROVED; ✅ U9 Code Generation APPROVED → Build & Test; owner backup taken

Owner: *"approve adding another unit (10 with reordering of existing units above 9). Approve U9. Created a backup on
this machine (in D:\Software\Spotify-SavedWorkingItems where I've been keeping some data that is of use during the
dev/test process)"*.

- **U10 Data Safety round APPROVED** (FR-76…80; U10 inserted, NAS → U11, Team Operations → U12). Next for U10: its
  Functional Design plan, after U9's Build & Test.
- **U9 Code Generation APPROVED** → **Build & Test** begins (IN-U9-7 order; the live crossing and the tag push each
  wait for the owner's go-ahead).
- **Backup** taken by the owner in-app, kept outside the repository in `D:\Software\Spotify-SavedWorkingItems`
  (the stand-in for FR-76/FR-80 until U10 ships).
- PR flow explained to the owner (Azure DevOps background): PRs target `main`; drafts cannot be merged; Claude marks a
  PR *Ready for review* when it is the owner's to merge. PR #3 was merged before U9's Build & Test; harmless, since a
  merge deploys nothing and the release guard refuses an unaccepted pin.

---

## 2026-10-18T19:50:00Z — U9: acceptance PASSED, crossing rehearsed, ✅ 1.0.0-beta.3 LIVE

Owner: *"Ok the pending merge is completed."* (PRs #4 and #5 merged; taken as the go-ahead for the live crossing that
the previous message laid out step by step.)

- **Acceptance on `:3011` PASSED** (18:26Z–19:37Z): refreshes landed in the host file through the directory mount at
  18:26:38Z (forced) and 19:21:41Z (the 5-minute buffer, as predicted from upstream's source; the plan's "45-minute
  timer" was wrong and is corrected in the record); `refreshToken` equal to live throughout; both installs recorded
  the same 18 plays with identical outcomes; the `EBUSY` negative control seen with the real patched connector.
  `scripts/connector-acceptance.json` gained the `pass` entry for `6065ce5c`.
- **Found and fixed** in Build & Test: the startup check's message named `/opt/spotify-mcp` as the place to mount
  `./secrets` under an old compose file; it names `/app/secrets` now.
- **Crossing and rollback rehearsed** on the owner's verified backup: 1430 plays at every stage, live unchanged.
- **Live**: the release refused while `spotify-now-playing` ran (`old-container-running`, the guard on the real
  deployment); after `docker stop`, it deployed `spotify-companion:1.0.0-beta.3`, healthy, tagged `v1.0.0-beta.3`
  locally (not pushed). Credentials directory `ok`, 1453 plays, first new play recorded.
- Also: backlog **W-16** (the export's leaked `error` listener, seen as `MaxListenersExceededWarning`).

Next: the owner's tag push (publishes the image), then the token probe and the App-only walk.

---

## 2026-10-18T21:00:00Z — U9: published, verified; live refresh ✅; least-privilege regression found → secrets/app/ (1.0.0-beta.5)

- **1.0.0-beta.3** tag run: `publish` failed at its first step (the decision container mounted `scripts/lib` over
  `/lib`, Debian's system library folder); nothing published. Reproduced, fixed, guarded by a structural test; the rest
  of the job (incl. Trivy) exercised on Linux first; shipped as **1.0.0-beta.4** (owner merged PR #6), released and
  **published** (first full publish run).
- **Token probe** (owner, own terminal): fine-grained token → `403` on pull; classic `read:packages` → pulls. The
  pulled image passed the image checks; its `revision` label = the released commit `d8f2ce4`. README names the classic
  token. Walk guide written (Machine 1). Owner merged PR #7.
- **Live token refresh** through the directory mount at 20:24:34Z ✅.
- ⚠️ **Found**: `secrets/` also holds `metabase.json`, which the whole-folder mount exposed to the app container.
  Surfaced as a security-posture decision; owner chose **"Separate subfolder (Recommended)"**. BR-69.4 amended; built as
  **1.0.0-beta.5** on branch `u9-secrets-subfolder` (all host paths → `secrets/app/`; release guard
  `credentials-not-in-place`; INSTALL upgrade note). The App-only walk waits for it.

---

## 2026-10-21T14:30:00Z — App-only walk ① NOT PASSED (BR-62.3); four findings fixed as 1.0.0-beta.6

Owner: *"performed the cold walk... transcript is in U:"*, then *"the installation process didn't create an install
log."* Reviewed the transcript outside the repository, redacting as read (pattern check: no token, client id/secret or
refresh token in it; the owner's email address 10 times, so it is not committed).

The app installed and ran, but: **F1** the README gave no version (the agent guessed registry tags) · **F2** INSTALL S1
installs Node and git too (the agent skipped their checks on its own judgement) · **F3** step 2's *Expected* incomplete
· **F4 defect**: `/state` and `/config` not writable by `node` after `setup` (root-created folders); reproduced, fixed
in the entrypoint, valid control on fresh folders (an earlier invalid control is recorded as such). No install log:
the App-only path had no `claude-start.md` route, so the log rule lived only in the walk guide's prompt; fixed.
Built as **1.0.0-beta.6** on branch `u9-walk-fixes`. Record:
`construction/u9-connector-upgrade/walks/walk-app-only-2026-10-21.md`. Next: release, publish, re-walk the changed steps.

---

## 2026-10-21T15:30:00Z — Install documents split: INSTALL-DEV.md and INSTALL-APP.md (FR-75, BR-74.5 amended) → 1.0.0-beta.7

1.0.0-beta.6 released and published (owner *"go"*; F4 seen fixed on the live install). During the re-walk the owner
asked whether Node.js is needed for a container install (it is not: the image carries its own), saw that the App-only
route still ran INSTALL S1's whole box, and that a note below it comes too late. Owner: keep README *"clean and tight"*,
with *"separate dev and app only docs"*, named *"Install-dev.md and install-app.md"* (made `INSTALL-DEV.md` /
`INSTALL-APP.md` for consistency with the other top-level documents; flagged as easy to change).

Done on branch `install-docs-split`: `INSTALL.md` renamed `INSTALL-DEV.md`; a self-contained `INSTALL-APP.md` (A1–A8,
no Node, no git; A8 checks rules and automation-state writability through diagnostics, never arming); README Install 8
lines; `claude-start.md` routes by what the person types; duplicated passages held identical by a test. Checked
against the live app before writing: the diagnostics step names and the automation response; the redirect-URI error
text copied from INSTALL-DEV's measured wording (my first draft had invented one). Image texts naming the old file
mean a release: **1.0.0-beta.7**. The re-walk walks the new document from its start.

---

## 2026-10-21T16:00:00Z — App-only walk ② NOT PASSED (on the pre-split documents); gaps fixed in PR #12

Owner: *"copied walk results to D:\walk-results\2026-10-21.Run2"*. The walk ran on `1.0.0-beta.6` with the
documents before the split (PR #12 not yet merged). The agent kept `install-log.md` (the shipped rule worked) and read
only `claude-start.md`, `README.md`, `INSTALL.md`. Installed and recording; F1 and F3 from walk ① fixed. Seven gaps:
five closed by `INSTALL-APP.md`, three more added to it on PR #12 (first-start `docker version` retry up to about
three minutes in both documents; sign-in in the install folder; the first-start import of earlier plays). Record:
`construction/u9-connector-upgrade/walks/walk-app-only-2026-10-21-run2.md` (the agent's log, secret-checked).

---

## 2026-10-21T16:20:00Z — Going public: decisions; a code review by another model first

Owner: *"before we start walk 3 lets make the project public so I can send a link to one of my dev's … we can tune
the installation instructions for a public repo (especially the app only install probably shouldn't require a
key)."* Re-checked on the day: gitleaks over all 238 commits, no leaks; redacted classes absent from the tips.
Decisions (question prompt): listening history **accepted as is**; image **public** (*"Yes, public image
(Recommended)"*); and *"please add a code review step before going public where I switch you to fable for the task
(get a different model looking at the project)."* **Visibility not changed.** Sequence recorded in
`public-readiness-review.md` §6: merge PR #12 → review by another model → the switch (repo, package, private
reporting, token-free App-only docs) → next beta → walk 3.
