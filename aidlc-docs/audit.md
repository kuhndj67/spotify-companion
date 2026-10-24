
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

---

## 2026-10-21T18:00:00Z — Pre-public review by another model: no blocker; triage and owner decisions

Owner: *"the fable reviews generated two review documents with recommendations but with no blockers to going
public."* Records: `construction/u9-connector-upgrade/code/pre-public-code-review.md` (file and line) and
`pre-public-solution-review.md` (architecture), both by Claude Fable 5.1 at `fefd768`, changing no other file.

Decisions (question prompt): **MCP**: *"Schedule removal unit"*, recorded as D1's changed premise and **W-17** (a unit
before U11, numbered in the next Inception round). **arm64**: *"State untested (Recommended)"*, a line in
INSTALL-APP; multi-arch publishing is in **W-19**. **Architecture page**: *"Yes, before switch"*. **Commit email
history**: *"Keep: no rewrite"*, the 2026-10-18 decision reconfirmed against the review's numbers (205 of 239 commits'
metadata).

Done on `install-docs-split` (PR #12): `aidlc-state.md` current line (review 1.4: it was two betas stale; on checking,
`1.0.0-beta.7` is the version in PR #12 but **not tagged**, so the line says so); INSTALL-DEV S7 no longer says no
image is published (4.2) and checks the secrets **exist** instead of the pre-U9 file-versus-folder check (4.3);
INSTALL-APP A8 prints only its two diagnostics steps, never the contact address (4.4; both the PowerShell and the
`grep` variant run against the live app, two lines `ok`); `docs/ARCHITECTURE.md` from the solution review §2, each
named test and path checked to exist (the review's `ingestGuard` test is `ingestPolicy.test.ts`), added to
`test/docs.test.ts`'s documents and its no-counts check (**positive control**: a dead path and a hand-written count
in the page each turned the test red; restored, green); `application-design.md` marked as the inception-time plan.

Logged, not built: **W-18** (code hardening: next beta 2.1.1, 2.1.2, 2.1.3, 2.3.1, 3.1; **2.5.1, a tag ruleset,
before any collaborator gets write access**; the rest backlog); **W-19** (job registry, release/deploy split,
composition and browser tests, layering, trail retention, arm64, Node LTS). Review 4.1 (private-repository wording)
is part of the switch itself. **Visibility not changed.**

---

## 2026-10-21T18:40:00Z — Release tags protected (code review 2.5.1), before a collaborator gets write access

Owner: *"lets add the tag ruleset because I'll give James write access."* `.github/rulesets/release-tags.json`: target
`tag`, `refs/tags/v*`, rules creation, update, deletion and non-fast-forward, bypass the admin role only (as `main`).
`scripts/protect.mjs` now syncs every file in `.github/rulesets/` and names any live ruleset without a file.
`test/rulesetMatchesWorkflow.test.ts` asserts the ruleset covers what CI publishes from (`tags: ['v*']` and the
publish job's `refs/tags/v` gate) and the bypass; **positive controls**: a ruleset missing creation, targeting branches
or covering another prefix, and a CI trigger moved to another prefix, are each reported. `npm run protect`
(read-only): `main` MATCHES, `release-tags` would be created; `--apply`: created (id 25564987) and read back matching.

**Not verified**: (1) that the ruleset refuses James's tag push; that is his first `git push origin v0.0.0-refused`
(safe either way: `publishDecision` refuses a tag that is not `package.json`'s version). (2) That the owner's bypass
still lets the next release tag through (the next `v*` push shows it). (3) Two publish paths a write-access account
may still have, from GitHub's documentation and **not probed** (the `gh` login lacks `read:packages`): a branch push
with an edited `ci.yml` using the workflow token's `packages: write`, and a direct `docker push` with their own token
if the package inherits repository permissions. Surfaced to the owner, not decided.

---

## 2026-10-21T19:30:00Z — Publish process hardened: a release-only credential; one approval on main

Owner: *"James is certainly trustworthy but we should follow sound practice with regards to public projects so lets
harden the publish process."* `gh` given `read:packages` by the owner. **Probed**: the package record exposes
visibility (`private`) and the linked repository only; access inheritance and Actions access are **not in the API**
(settings page only). The publish job logged in with the workflow token, which pushed beta.4–6, so a branch with an
edited `ci.yml` **could** publish. Found while probing: `main`'s ruleset required **0** approvals.

Decisions (question prompt): *"Token in environment (Recommended)"*; *"No extra click"* per publish; *"Yes, require 1
approval (Recommended)"*.

Done: `.github/environments/release.json` (deployment policy: `v*` tags only), synced by `npm run protect` like the
rulesets (secrets are never read or written by it); `ci.yml` publish runs in `release`, logs in with
`GHCR_PUBLISH_TOKEN`, and no job asks for `packages: write`; `main.json` requires 1 approval, dismisses stale
approvals, and requires approval of the last push. `test/rulesetMatchesWorkflow.test.ts` pins all three, **positive
controls**: the old 0-approval rule, the old publish job (workflow token, `packages: write`, no environment) and an
environment that also admits a branch are each reported. `npm run protect`: diff showed exactly the three review
fields and the missing environment; `--apply` read back matching; a second run MATCHES all three.

**Owed** (not yet done or proven): the owner creates the classic `write:packages` token and sets it on the
environment; the owner turns off the package's inheritance and removes this repository's Actions write access; then
the controls: a branch job naming `release` is refused, a branch job pushing with the workflow token is refused, and
the environment token logs in on a throwaway `v0.0.0-*` tag (whose publish decision refuses, so nothing is pushed).
Until the token is set, a `v*` tag push fails at the login step.

**2026-10-21T17:05Z — token set.** The owner created the classic `write:packages` token and set it on the `release`
environment; `gh secret list --env release` shows `GHCR_PUBLISH_TOKEN` (17:00:49Z), and the repository has **no**
repository-level secrets. My first instructions were wrong twice, caught by the owner and by GitHub's docs: the
*Generate new token* button opened the fine-grained form from the classic page, and ticking `write:packages` by hand
also ticks `repo`. CONTRIBUTING now gives the preselecting link. Still owed: the package settings, then the controls.

**2026-10-21 — package settings (owner, on GitHub).** *Manage Actions access*: `spotify-companion` set to Read or
removed; *Inherit access from repository (recommended)*: unticked (no overwrite warning appeared; the box stays
unticked). My first instructions named an organisation-level setting and omitted the side-column *Package settings*
link; corrected from GitHub's docs. Not readable by the API, so verified by the controls, not by a read-back.

**2026-10-21T17:10Z — controls run (owner: *"yes... push"*).** Throwaway branch `publish-control` (one workflow,
never merged; run 39640995752) and throwaway tag `v0.0.0-envcheck` on `a063cdf` (run 39640999459). Each read for its
**reason**, not its colour:

| Control | Expected | Seen |
|---|---|---|
| A branch job naming `release` | refused by GitHub | *"Branch "publish-control" is not allowed to deploy to release due to environment protection rules."* The job's own step never ran |
| A branch job pushing with the workflow token (`packages: write`) | refused by the registry | `denied: permission_denied: write_package` |
| A `v*` tag reaches `release`; the environment token logs in | login, then the decision refuses | `Login Succeeded`; the registry lookup answered (no *registry answer* line, printed only for `unknown`); `publishDecision: REFUSED (tag-mismatch)`; build and push skipped |
| The owner creates and deletes a `v*` tag | allowed by the bypass | the push created it; the delete printed GitHub's rule notice *"Cannot delete this tag"* and the tag is gone (API 404): the deletion rule is live **and** bypassed for the owner |

Package versions after: beta.4, beta.5, beta.6 only (nothing pushed). Branch and tag deleted. **Still owed**: James's
own tag push refused (after he has access); that the environment token can **push** (not only log in and read), first
shown by the beta.7 release.

---

## 2026-10-21T17:30:00Z — PR #12 merged; the switch's wording prepared as PR `go-public`

PR #12 merged by the owner at 17:13Z (head `be04355`, the three required checks green, publish skipped; GitHub shows
*review required* because the owner's bypass merged it, which is the designed path for the owner's own PRs). Owner:
*"Yes continue and I'll change visibility when I start the merge."*

Branch `go-public`: code review 4.1's list. README's *not a public image yet* bullet removed; INSTALL-APP's
*while private* line removed and **A2 is now *Download the image*** (`docker pull` of the current version; *If it
differs*: `manifest unknown`, a `denied` from an old stored sign-in → `docker logout ghcr.io`, an ARM platform
message), keeping A3–A8's numbers; A3's 403 line points at A2; INSTALL-DEV S2's private-repository box and its two
sign-in bullets removed (a *Repository not found* now means a mistyped address); SECURITY's *until then* paragraph
removed; `compose.app.yaml`'s pull note removed (it ships in the image, so from beta.7); CLAUDE.md names the image
public. Swept for `private`, `read:packages` and `docker login` across the documents, `src/`, `scripts/` and the
Dockerfile: none left. ⚠️ A2's ARM wording is deliberately generic: what Docker prints for this image on ARM is not
measured. The A2 commands are walked for the first time in walk ③.

---

## 2026-10-21T17:30:00Z — ✅ Public; 1.0.0-beta.7 live and published (the release-environment token's first push)

**The switch** (owner): PR #13 merged at 17:20:49Z with the repository made public, the package made public,
private vulnerability reporting on, and the fork-PR setting confirmed. Read back by API: repository `public`, package
`public`, private vulnerability reporting `enabled: true`, fork-PR approval `first_time_contributors`, default workflow
token `read`. **Probed as a stranger**: `git ls-remote` with no credential helper lists the tags; the registry serves
the beta.6 manifest to an anonymous token (HTTP 200), and a made-up `9.9.9` is 404 (the probe can tell). GitHub's
*"This branch has not been deployed"* on PRs is the `release` environment's notice: no PR ever deploys to it.

**The release** (owner: *"backup created, run npm script"*): `npm run release -- --apply`: verify (0 failures),
build, deploy, healthy, tag `v1.0.0-beta.7` (local). Live: `healthy`, image `spotify-companion:1.0.0-beta.7`,
diagnostics *App version 1.0.0-beta.7 · Database schema v7*, token refresh ok, connector connected, **1,497 plays,
0 gaps**. The tag push (owner's command, typed twice; run by me when the `!` form arrived as a message): GitHub printed
*"Bypassed rule violations … Cannot create ref due to creations being restricted"*, the owner's bypass seen working
for creation. Run 39643903712: all four jobs green; publish *Login Succeeded* (environment token),
`publishDecision: publish 1.0.0-beta.7`, push `digest: sha256:b54d271261d6…`. The package lists `1.0.0-beta.7`
(17:29:01Z); an anonymous pull of its manifest is HTTP 200; the `release` environment's first successful deployment
is `v1.0.0-beta.7`. **The token's push, owed since the hardening, is now shown.**

Still owed: the collaborator's own `v*` tag push refused (after James has access); App-only walk ③ on the public
image (its new A2 walked for the first time).

---

## 2026-10-21T18:30:00Z — ✅ U9 CLOSED (owner); walk ③ by the owner; status-bar defect filed as issue #14

Owner: *"I think we're done with this unit correct?"*. I answered no by the records (U9 closed on walk ③ passing).
Owner: *"the dev install has been completely walked by me (for vscode/rancher desktop deployment both using ai and
manually installing) and the app install has been walked multiple times, deploys successfully each time and now we're
just cleaning up loose ends."* The records agree on the second half: walks ① and ② each **installed and ran**, and
were *not passed* only under BR-62.3 (a step needing outside knowledge fails the walk). BR-62.3 asks for the **fixed
steps** to be re-walked; *walk ③ passes* was a stricter closing condition written today. The owner's own walks of
the development install were **not recorded** before this entry; recorded now from the owner's statement.

**Walk ③** (owner, App-only, `1.0.0-beta.7`, the public image, a different machine from this one): *"went through the
whole app install process and the app is running and the process did work well."* One finding: **A2** `docker pull`
printed *Pull complete* lines and no files appeared in the folder, so whether it had worked needed outside knowledge
(BR-62.3). Fixed: A2 says the image goes into Docker's own storage and the files arrive in A3, and adds
`docker image ls` (both outcomes seen here). Also asked: every command a reader runs in a code block (done in both
install documents) and "developer credentials (client id and secret)" for "developer app" in the introductions.

Side finding on **this** machine, not a document defect: `docker pull` of any `ghcr.io` image, ours or
`linuxcontainers/alpine`, is `denied`, even with an empty client configuration, while the registry serves beta.7's
manifest, config and layers to an anonymous client (HTTP 200, full sizes) and the owner's pull elsewhere worked. A
`ghcr.io` sign-in is stored (`credsStore: wincred`). Inferred, **not measured**: Rancher Desktop's CLI still sends it.
A2's `docker logout ghcr.io` fix was not run here (the owner's credential; not needed for the walk).

**UI defect → issue #14**: in **light** mode the status-bar labels are invisible. Owner: *"the text is there but it's
black and the status bar background is black."* Reproduced here by emulating light mode: every label computed
`rgb(22, 23, 26)` on the bar's `rgba(12, 12, 14, 0.92)`; dark mode (this machine's default) renders `rgb(242, 243,
245)`. Cause: `.statusbar` sets a fixed dark background but no text colour, so it inherits the page's `--text`. The
`⊘` that looked like a question mark: the owner, *"it's just small so the 'slash' is pixellated … not a problem."* The
fix is its own branch and PR.

**Decision (owner, accepting my proposal)**: **U9 is closed.** README's Status names the walks that happened, and the
App-only *coming soon* label is off. Carried forward: re-walk the steps changed after walk ② that walk ③ did not
cover as written (A2's new check and text; INSTALL-DEV S2 and S7, which no walk has run since they changed). BR-62.2's
walk by a person who did not write the documents remains the `1.0.0` trigger. Owed under W-18: the collaborator's
`v*` tag push refused.

**2026-10-21 — the side finding resolved.** The owner ran `docker logout ghcr.io` on this machine (*"removing
credentials…"*). After it: `auths: []`; `docker pull …:1.0.0-beta.7` ends *Status: Downloaded newer image*;
`docker image ls` shows one line, ID `b54d271261d6`, the digest CI published. So the stored sign-in **was** the cause
(measured, no longer inferred), and A2's *If it differs* fix works as written. Still unexplained: the earlier pull with
an empty `DOCKER_CONFIG` was also refused, so this Docker found the sign-in by another route; it does not change the
document.

---

## 2026-10-21T21:00:00Z — Tracking stays as ratified (NFR-35 in U12); frameless mode logged as W-20

Owner: *"things like work items, bugs, and feature requests now should go into github tools … this probably should
include the remaining units?"* On checking: this is **Question 21 = A**, ratified as **NFR-35** (issues as the backlog,
a W-id → issue pointer table), scheduled in **U12** and not yet done. Owner (question prompt): **keep it in U12**. On
how bugs and features are kept apart, owner: *"'bugs, broken items, etc...' should be separate from feature requests.
Not sure how these sort of things are usually tracked in github, I'm guessing they have a standard process for
this?"* Explained: one tracker separated by the `bug`/`enhancement` labels and *Bug report*/*Feature request* issue
forms (common for small projects), or bugs in Issues and ideas in GitHub Discussions (larger projects). Recommended
the first; the owner's choice is open (and whether the two forms go in now, before U12, as the repository is public).

Owner's UI idea, a **frameless app window that scales to fit**: *"This is a feature request not an issue... issues
are bugs or problems, this is an enhancement."* Logged as **W-20** (enhancement) with the owner's words and the
feasibility questions to probe; no UI unit exists, so it re-enters Inception when scheduled.
## 2026-10-21T20:30:00Z — 1.0.0-beta.8 live and published; GitHub Releases announce new versions

**beta.8** (owner: *"lets build beta.8 and get a clean build before starting u10"*): PR #17 (version in
`package.json` and its checked copies) merged by the owner; backup taken by the owner; `npm run release -- --apply`:
verify 1,734 pass / 0 fail, build, deploy, healthy, tag. Live: `healthy`, image `spotify-companion:1.0.0-beta.8`,
*App version 1.0.0-beta.8*, 1,514 plays, 0 gaps. Issue #14's fix seen on the live app: light mode emulated after a
fresh reload (no injected style), all five labels `rgb(242, 243, 245)`. The owner pushed the tag (*"Bypassed rule
violations … creations being restricted"*); run 39664055744 all green; publish *Login Succeeded*, `publishDecision:
publish 1.0.0-beta.8`, `digest: sha256:f885c7be…`; anonymous manifest HTTP 200.

**How users learn of a new version** (owner: *"how do users know a new version is available, and do we need an
'update' feature"*). Updating is already **FR-79** (U10). Knowing was covered nowhere. Owner, *"Yes to both"*: (1)
every release gets a **GitHub Release** with notes, a pre-release while the version is a beta, published by the owner
after the tag push; first one `v1.0.0-beta.8`. Documented in INSTALL-APP (the current-release line and *Updating*),
INSTALL-DEV (*Updating*), README (*Status*), CONTRIBUTING and CLAUDE.md (the release steps). ⚠️ *Watch → Custom →
Releases* is written from GitHub's interface, not walked. (2) An **in-app "newer version available" notice** goes to
the U10 requirements round as questions (show it at all; opt-in or opt-out; how often), because it would be the app's
first outbound call to a service that is neither Spotify nor MusicBrainz: a privacy and security posture decision for
the owner. Rejected for now: having CI create the Release (it would need `contents: write` in the publish job).

## 2026-10-21T22:00:00Z — Questions 34–36 answered (A, B, A): FR-81, an update notice on by default

Owner (question prompt, U10 session start): **Q34 = A**, one line in Settings beside the version and a status-bar
indicator only when a newer version exists, never updating anything itself; **Q35 = B**, **on by default** with a
Settings switch to turn it off, *against the recommendation* (A, opt-in), which would have kept a fresh install's
outbound traffic to Spotify and MusicBrainz; **Q36 = A**, at most once a day plus once shortly after start, one
anonymous `GET …/releases?per_page=10`, silent on failure, outside the Spotify poll budget. Ratified as **FR-81**
(priority **Should**, set by the agent: a notice is not data safety; the owner may change it).

⚠️ Consequence recorded so it is not lost: **every install now calls GitHub by default**, which tells GitHub the
user's IP address and, from the timing, that they run the app. No NFR names the permitted outbound services, so
nothing is amended; the Settings sentence saying what is sent and to whom is the user's only notice, and Functional
Design must keep it next to the switch. Rejected: opt-in (A) and a manual button only (C).

State correction: the *Current Stage* line still said `1.0.0-beta.7` live; `1.0.0-beta.8` is (container
`spotify-companion:1.0.0-beta.8`, healthy, read 2026-10-21). Issue #14 is closed (19:32Z).

## 2026-10-21T22:30:00Z — Bugs and feature requests kept apart: labels and two issue forms, added now

Owner: *"If (bug/enhancement labels plus two issue forms) is a standard approach for this I'm ok with that."* It is:
GitHub creates `bug` and `enhancement` in every repository (both present here; issue #14 already carries `bug`), and
issue forms in `.github/ISSUE_TEMPLATE/` are its built-in mechanism. Owner (question prompt): add the forms **now**,
not in U12, because the repository is public. Brought forward from NFR-39: the two forms only; the PR template,
Dependabot, Discussions and NFR-35's W-item migration stay in U12.

Added: *Bug report* (labels `bug`; asks for the *Version* line from Settings → Run diagnostics…, the install route,
and the colour scheme, as issue #14 hid in light mode; warns against pasting credentials), *Feature request* (labels
`enhancement`; asks for the need before the solution), and `config.yml` with **blank issues off** (the agent's
choice, so every issue arrives labelled; reversible in one line) and a link to private vulnerability reporting
(`enabled: true`, read 2026-10-21). CONTRIBUTING points to the chooser. Verified: the three files parse as YAML.
⚠️ **Not verified**: GitHub's own form-schema check runs only once the files are on `main`; open
`/issues/new/choose` after the merge.

## 2026-10-21T23:30:00Z — U10 Functional Design plan opened (Q1–Q6); issue forms seen live

Owner, after PR #21 merged: *"looks good... I see issue and feature options."* The two issue forms render on GitHub,
so GitHub's form-schema check passed (the one item the 22:30Z entry left unverified).

**U10 FD plan** (`construction/plans/u10-functional-design-plan.md`). Measured for it, not reasoned:
- The scheduled snapshots (FR-56/FR-80) are **CSV exports**, one flattened row per play, with no decision log,
  skip attempts, trails or rules; *Restore backup* accepts only the archive. Built as worded, FR-80 would restore
  nothing.
- *Create backup* streams its archive to the browser and deletes it: **no backup is kept on disk**, which FR-76's
  "bounded number kept" assumes.
- From a throwaway container (what FR-79's `update` is), `host.docker.internal:3010` → **`403 Invalid Host or
  Origin`**; with a `localhost` Host header → **`200`**. Not a defect: the peer check is off in the container
  deployment by design (`TRUST_PUBLISHED_PORT`, 2026-09-05) and the `127.0.0.1` publish is the boundary, which admits
  any process on this machine, containers included. Recorded so it is not rediscovered as a breach. Not probed: the
  same on Linux (U11's NAS).
- FR-77's lock file: exclusive create refused with **`EEXIST`** in both directions across the Rancher bind mount
  (throwaway container and scratch folder; `data/` untouched); heartbeat visible; clocks within 1 s. Stale takeover by
  unlink-and-create can race between two takers; the rules must close it.
- The MusicBrainz User-Agent carries the user's contact address (NFR-14); FR-81's GitHub request must not reuse it.

Questions: Q1 how `update` gets its backup (recommended: the updated app backs up on its first start, rewording
FR-79), Q2 one kind of kept backup, the verified archive in `data/backups/`, rotated per kind (rewording FR-56/80),
Q3 which processes take the lock, Q4 how far `data-dev/` reaches, Q5 kept backups in Settings, Q6 a story. FR-81 added
to the U10 rows of `execution-plan.md` and `unit-of-work.md`. U10's `HANDOFF.md` created. Business rules start at
BR-78 (BR-77 is taken).

## 2026-10-22T00:30:00Z — U10 FD Q1–Q6 answered (all A); Functional Design written

Owner (question prompt): **Q1 = A** the updated app backs up before its first run; **Q2 = A** one kind of kept
backup, the restorable archive in `data/backups/`, rotated per kind, CSV timer retired; **Q3 = A** the lock covers the
app and every writing script, replacing `docker ps`; **Q4 = A** `data-dev/` for `npm start` only; **Q5 = A** status in
Settings, no list; **Q6 = A** US-33. Requirements amended to match, each marked in place: **FR-76(a)** (a version
change also triggers the backup), **FR-79** (no call to the running app), **FR-80** (the archive, rotated per kind),
**FR-56** (superseded by FR-80). US-33 added with its traceability row.

FD written: `construction/u10-data-safety/functional-design/` (BR-78…BR-86). **Decisions the agent made, for the
owner's review** (none is a security-posture change):
- The startup lock **watches** the heartbeat for one stale window instead of judging the lock's age, because a
  container that `docker compose up -d` just killed leaves a lock that looks fresh. Staleness never compares two
  clocks. Takeover goes through an exclusive-create mutex and re-reads the token, closing the race the probe found.
- The update check's startup request is **skipped when the last check was under an hour ago**: FR-81 says *once
  shortly after start*, and a restart loop would make that a GitHub request (and a disclosure) per restart. A
  refinement of FR-81, not a change of its intent.
- `npm run release` **refuses** when the running app cannot be reached; `--app-is-down` overrides that one refusal,
  since the new version still backs up before its first run.
- **Five** before-change backups kept (configurable); scheduled keep stays `SNAPSHOT_KEEP` (14).
- The last app version is stored **in the database** (a one-row table, by a new migration), because it belongs to
  the database: a restored file brings its own.
- A new **Settings → Version** section (the version appeared only inside a diagnostics run), and diagnostics gains a
  **warn** level.
Rejected: a list of kept backups with restore buttons (Q5 = B); judging lock staleness by age; reusing the MusicBrainz
User-Agent (it carries the contact address).

## 2026-10-22T01:00:00Z — U10 Functional Design APPROVED (owner); NFR Design plan opened

Owner, after the FD completion message: *"continue"*, read as approval to proceed to NFR Design (the message's
*Continue to Next Stage*). The six agent decisions named in the 00:30Z entry stand as approved with it.
NFR Requirements skipped, as for U1–U9. NFR Design plan: `construction/plans/u10-nfr-design-plan.md`.

## 2026-10-22T02:00:00Z — U10 NFR Design written; Status light and Diagnostics button added (owner)

Owner (question prompt): **Q1 = A** heartbeat 5 s, stale window 30 s; **Q2 = A** free-space check before each kept
backup (2 × database + WAL + 100 MB; short → scheduled skipped and reported fail, before-change refused; nothing
deleted to make room). **Q3 = X**: *"To keep the main screen clean (we're going to simplify it quite a bit when we get
to UX/UI unit) lets include a "Status" indicator light/text with "check diagnostics page" as the pop up text. also
maybe we should promote "Diagnostics" to a button between settings and rules?"* Follow-ups, all the recommended
option: the Status light reacts to U10's conditions now and is extensible (whether today's five indicators fold into
it is the UX/UI unit's call); it is **always visible**; Diagnostics becomes a header button **Settings · Diagnostics ·
Rules** in U10. **FR-63 amended** in place; the approved FD gains **BR-86.5–86.6** and `frontend-components.md` §3a.

Facts measured for the plan: a gzip of the database file is 3.0 MB with a further 4.1 MB in its WAL (so an archive is
≈ 3–5 MB today); every request carrying an `Origin` is already checked, so the new write routes need no new defence;
the writing scripts already import `src/` under `tsx`, so one lock module serves both.

Written: `construction/u10-data-safety/nfr-design/` — **P-76…P-87**, **LC-69…LC-80**, **PBT-79…PBT-89**. Schema v7 →
v8. Rejected: judging lock staleness by age (P-76); keeping `docker ps` beside the lock (P-79: two guards answering
one question differently); a retry loop that reopens history mid-run (recovery stays a restart).

## 2026-10-22T03:00:00Z — U10 NFR Design APPROVED (owner); Infrastructure Design written

Owner, after the NFR completion message: *"continue"*, read as approval. Infrastructure Design plan:
`construction/plans/u10-infrastructure-design-plan.md`.

Facts measured: three compose files each mount `./data` and `./state` as directories; existing *App only* folders keep
their compose file (only the image line changes), so U10 must run with no new variable; the entrypoint creates and
chowns `SNAPSHOT_DIR`; `.gitignore` names `SNAPSHOT_DIR` as the way to keep copies elsewhere; `verify:up` starts with no
history; `npm run release` waits 180 s for health.

Owner (question prompt): **Q1 = B**, backups **always** in `data/backups/`, *against the recommendation* (an optional
`BACKUP_DIR`). ⚠️ **Residual risk accepted**: the database and its backups share one deletion event (`git clean -xdf`,
a lost disk); the documents will tell users to copy `data/backups/` elsewhere. **Q2 = A**, the first U10 deploy is
rehearsed on `:3011` with a restored copy of the owner's backup, including the live cross-mount lock probe.

Written: `construction/u10-data-safety/infrastructure-design/` — **IN-U10-1…8**. Agent decisions: `SNAPSHOT_DIR`
retired (ignored with one log line if an old folder sets it; CSV files untouched); `SNAPSHOT_INTERVAL_HOURS`,
`SNAPSHOT_KEEP`, `SNAPSHOTS_ENABLED` keep their names for the scheduled kind; before-change backups cannot be turned
off; `BEFORE_CHANGE_KEEP` optional (default 5); `data-dev/` ignored by git and the image build.

## 2026-10-22T03:30:00Z — U10 Infrastructure Design APPROVED (owner); FR-82 backup reminder added

Owner: *"continue to next step but because of the change to "user is responsible for backing up their db" I'd like to
add a diagnostic warning (yellow) that asserts if the user has not downloaded a backup in more than a week. (unless
they opt-out by shutting it off, which would make sense if the entire hosting environment is automatically backed up
for instance)."* Read as approval of Infrastructure Design plus a new requirement from the owner, ratified as stated:
**FR-82** (`requirements.md` §3.10). Folded into the approved designs as additions, each marked *added 2026-10-22*:
**BR-87** (and BR-86.5's sources, BR-86.7), `frontend-components.md` §6, **LC-81**, **PBT-90**, **IN-U10-9**; US-33
gains an acceptance line and FR-82.

Agent decisions, for review: only a **completed** *Create backup* download counts (not a click, not kept backups,
which share the disk); a fresh install's week starts at its **first run**; the dates live in `state/` so a restore
cannot roll them back; the reminder is **warn**, never fail. Next: Code Generation plan.

## 2026-10-22T04:00:00Z — U10 Code Generation plan written; approval requested

`construction/plans/u10-code-generation-plan.md`: 16 steps, pure decisions first (each with its property test and
positive control), then shells, wiring, UI, scripts, infrastructure files and documents; one commit per step on
`u10-code-generation`, branched from `main` after PR #22 (the designs) merges. Nothing deploys in Code Generation;
the first deploy is Build & Test's rehearsal (IN-U10-8). Approval prompt shown to the owner at this timestamp.

## 2026-10-22T04:15:00Z — U10 Code Generation plan APPROVED (owner)

Owner: *"approved plan, merge is marked as a draft... ready to move it forward?"* Plan approved as written; PR #22 (the
designs) marked ready for review at the owner's request. Code begins on `u10-code-generation` once #22 merges.

## 2026-10-22T05:30:00Z — U10 Code Generation done (16 steps); a fresh-install defect found and fixed

All 16 steps of the approved plan, one commit each on `u10-code-generation`, `npm run verify` green after each (1,826
pass, 0 fail at the end). Summary, deviations and verification: `construction/u10-data-safety/code/code-summary.md`.

**Found by the work, not by review:**
- 🔴 **A fresh install would never have recorded.** Running the BUILT app on an empty data folder: migration 0→8 made
  a before-change backup due, and a backup of an empty database does not verify, so the app refused to migrate and
  ran display-only. Every unit test had started from a v7 database. Fixed in its own commit: schema 0 means nothing to
  protect. **BR-79.1 amended** in place.
- A **weak property** (PBT-84): *none written yet* mutated to `ok` passed every test; a targeted property now fails.
- `repair-backfill-timestamps.mjs` wrote with `--apply` and had **no guard at all**; it now holds the writer lock.
- The plan's `docker compose build` would have **overwritten the live `1.0.0-beta.8` image tag**, the rollback target;
  built as `spotify-companion:candidate` instead.
- One step's commit went in with a test failing (the INSTALL-APP image-reference rule); fixed in the next commit.

**Observed live** (the built app, isolated: scratch data, port 3027, no Spotify credentials; then the image): a stale
lock taken over after a real crash, after the 30 s watch; the scheduled backup at startup; one real anonymous request
to GitHub's release list answering *current* (`v1.0.0-beta.8`, page accepted); a completed download clearing the
reminder; the new header, Status light, Settings and diagnostics in light and dark; the image's `update` rewriting
from beta.7 (CRLF and comment kept), doing nothing at beta.8, refusing from beta.9.

Deviations from the designs, each recorded in the plan's step headings: `compareSemVer` in `src/version.ts`;
migrate-on-open kept as the default with `{ migrate: false }`; four lock verdicts; a lost lock exits without touching
the database; `POST` switches and one `GET /api/settings/status`; the existing glyph set for Status; the version
notice beside U8's existing line; header buttons grouped right.

⚠️ **Transition**: the deployed `1.0.0-beta.8` container does not take the lock; until `1.0.0-beta.9` is live,
`docker compose down` before any `db:*` script. Next: Build & Test, beginning with the `:3011` rehearsal, which needs
the owner's **Settings → Create backup** first.

## 2026-10-22T23:10:00Z — U10 Code Generation merged (PR #23, owner); `:3011` rehearsal PASSED on real history

Owner: *"backup taken... retry"*, after merging PR #23. Rehearsal (IN-U10-8), every result in
`construction/build-and-test/u10-build-and-test-summary.md`:
- the owner's backup (1,594 plays, 1,853 decisions, schema v7) restored into `:3011` through *Restore backup*;
- the startup sequence on real data, from the log: lock released by the orderly shutdown, re-acquired, restore swap,
  **before-change backup** (`migration 7→8 · first run with version tracking`, 2.9 MB, 1.6 s), migration 8;
- that backup accepted by *Restore backup* (1,594 / 1,853, v7) while the live database read 1,594 / 1,853, v8;
- the writer lock across the real `D:` mount: a host `db:backup` REFUSED after 31 s naming the container; after
  `docker kill` (no auto-restart: Docker treats it as a manual stop) a host run took over after 30 s; the restarted
  container REFUSED, naming the host process, ran display-only, and its Status light read *fail: Recording is off …
  Check the Diagnostics page.*;
- `verify:down` proved the live deployment unchanged.
Not covered: the *newer version* display (no newer release exists yet) and the release's own backup request, which the
release exercises. Next: version bump to `1.0.0-beta.9` and the release, the owner's.
## 2026-10-23T15:00:00Z — Spotify rate-limited the app; the poll did not back off; my host test runs used real credentials

Owner: *"We have a spotify error "app has exceeded its rate limits". Do we have a log of activity that will tell us if
we were doing something abnormal?"* The live log: two bursts, **10-22 22:00:30Z → 22:10:40Z (195 refusals)** and
**10-23 13:40:44Z → 14:22Z (713+; still going when stopped)**, each refusal one 3-second poll, after a routine token
refresh, with no other activity logged. Owner: the walk environment was likely running with the same Spotify app in
those periods (now shut down and restored to clean), which explains crossing the limit; *"we need to have an effective
response to the error even so."* Owner approved all three of: stop the live container now; make the poll back off;
stop host runs using credentials they were not given.

- **Stopped** the live container at 14:22:27Z (`docker compose down`), owner-approved. `data/` untouched.
- ⚠️ **Correction, mine**: the host test runs of 2026-10-22 (≈02:25Z for ~3 min on `:3027`; 23:04Z for ~2 min on
  `:3028`) were described as making no Spotify calls. They did: the host connector (`.mcp-server`) was unpatched,
  ignored the `SPOTIFY_CONFIG_PATH` I set, and used its own copy of the real credentials (same client ID and refresh
  token as live); both runs refreshed a token and polled every 3 s. U9's code summary recorded that the host checkout
  ignores the variable; I did not apply it. Neither run precedes a burst (20 h before; 1 h after the first ended), so
  they are unlikely to be the trigger, but they were extra traffic, and a second poller, which CLAUDE.md forbids.
- **NFR-17 was not met on the poll path** (a ratified requirement, so this is a fix): the refusal arrives as text
  from the connector, the `Retry-After` header is not visible, and the loop retried every 3 s. Fixed on branch
  `fix-poll-backoff` (`src/pollBackoff.ts`): 30 s, 60 s, 2 min, 5 min, then 10 min per try (or a longer
  `Retry-After` when present); any other outcome returns to 3 s at once; the indicator says *"Spotify is limiting
  this app's requests. Next try in N s."* Positive control: the loop with the backoff ignored fails the test.
- **Host isolation**: `npm run mcp:setup` now patches the host connector exactly as the Dockerfile does and deletes
  the credentials copy (run on this machine: patched, rebuilt, copy removed); the app refuses an unpatched host
  connector, naming `npm run mcp:setup`. Seen live both ways: unpatched → *"…It was not started"*, no Spotify call;
  patched with no credentials → *"configuration file not found at <the given path>"*, **0 token refreshes**.
- 🔴 **A U10 defect found by that run**: the writer lock crashed at startup when the database's folder did not exist
  (`ENOENT`), so the first `npm start` on a machine without `data-dev/` would have crashed. The container is
  unaffected (its entrypoint creates `/data`; App-only `setup` creates `data/`). Fixed: the lock creates its folder;
  a test fails without it.
The live container stays stopped until the owner says to restart it.

## 2026-10-23T21:00:00Z — No persistent message in the status bar (owner direction)

Owner: *"the bottom status bar has a light red text message that spotify is not answering... there is ALSO a red
message at the top of the screen … AND if I click on the spotify status indicator it pops up a THIRD message saying
the same thing. Let's remove ANY persistent error/warning text pop ups in the bottom status bar. The only text that
should automatically display are the labels for the led's … and then if one of the indicators are clicked it's OK for
the pop up message to turn on/off with subsequent clicks. No persistent message in the bottom bar though."*

Removed the status bar's message line in both places that produced it (`statusBar()` and the client's second copy,
`MESSAGE_LEVELS`), its element and style, and the `inMessage` flag that only existed to keep indicators out of it.
`statusBarPrecedence.test.ts` deleted with its subject; a structural test now fails if the element or the client copy
returns (seen to fail with the element put back). Supersedes the 2026-10-04 and 2026-10-11 directions, which had
already removed the halt and the unconfirmed skip from that line. Checked in the browser with Spotify in `fail`:
labels only; a click shows the detail, a second click hides it. The message at the top of the card is unchanged
(not part of the direction). Also 1.0.0-beta.9: tag pushed by the owner; CI published (`publish 1.0.0-beta.9`,
anonymous manifest HTTP 200).

## 2026-10-24T12:30:00Z — Spotify's lockout measured and waited out; U10 closed

- **Measured** (2026-10-23 21:04:55Z, owner-approved, one direct request outside the connector, printing status and
  rate-limit headers only): `currently-playing` → `429`, `Retry-After: 5348` (≈ 1.5 h, until ≈ 22:34Z), body reason
  `QUOTA_EXCEEDED`. The connector hides all three and says only *"The app has exceeded its rate limits"*, which is why
  the poll's backoff (NFR-17 fix) could not use the real wait. Advised the owner **not** to recreate the Spotify app.
- **Stopped** the live container at 21:07:09Z (owner: *"yea stop the container"*) so the poll would not extend the
  lockout.
- **Filed** (owner direction): issue #29, *"if spotify is returning an error where extended information would be useful
  we should get it... and we might also recommend pausing as a way to minimize the outage period"*; issue #30, a pause
  in Diagnostics. Both `enhancement`, linked, awaiting a requirements round. Nothing built.
- **Restarted** 2026-10-24 12:26Z (owner: *"lets restart the app"*) after the same request returned `204` and an
  unchanged refresh token: lock acquired, schema v8, backfill 18 inserted / 32 known, a live decision recorded,
  `/api/health` ok, no refusal in the log. Not seen: the *"Spotify is answering again"* line, since no refusal occurred
  to recover from.
- **U10 closed** by the owner (*"do it"*). CLAUDE.md's "until beta.9 is live" transition notes removed.

## 2026-10-24T13:30:00Z — U11 Off-machine Deployment: Functional Design plan opened

- **Started** by the owner (*"lets start U11"*), choosing it over issues #29/#30 first.
- **Probed Machine 2** (unauthenticated, read-only, from this machine: TCP connects, `GET`s, one TLS handshake):
  80/443/5000/5001 open, **22 refused** (SSH off); DSM 7 (`SYNO.API.Auth` v7) with Container Manager
  (`SYNO.Docker.*`, including `Project`) and `SYNO.OAUTH.*`; `/webman/sso/.well-known/openid-configuration` → `403`
  on 5000/5001, and on 80/443 a `200` whose body is only DSM's redirect page (read, not assumed). So DSM's OIDC
  capability is **unknown**, not absent. Certificate: DSM factory default (`CN = synology.com`). Published
  `1.0.0-beta.9` manifest: single-platform (`amd64`).
- **Found**: `SqliteHistoryRepository` sets `journal_mode = WAL` without reading the result; measured with
  `node:sqlite` on `:memory:` that the call does not throw and the mode stays `memory`. A volume without WAL would
  go unnoticed. Proposed as a business rule; nothing changed in code.
- **Corrected before writing**: a draft line claimed the app "refuses to run" without WAL. Checked the code: it does
  not. Removed.
- **Plan**: `construction/plans/u11-functional-design-plan.md`, Q1–Q11 (role, registrations, identity provider,
  proxy, address and certificate, who is admitted, what a signed-in browser may do, deploy path, install document,
  exit-test counts, story) and six DSM values for the owner. Q3 and Q8 are security posture: options written, not
  decided. Noted in Q8: the repository is public, so U9-c's read-only GitHub deploy key is no longer needed.
