# U8 Build & Test Summary — Team Workflow & Onboarding

**Date**: 2026-10-14 (UTC) · **Status**: ✅ **local and outward-facing parts done (owner: "go ahead with 1-3")**. Remaining: the MCP licence issue (owner) and the cold walk (needs the VM work). ⚠️ **§4a: CI could never fail on a test, until today**
**Deployed**: `spotify-now-playing:0.8.1` (tagged `v0.8.1`, **not pushed**) · rollback `0.8.0`, then `0.1.0`
`npm run verify` green inside both releases: **1631 tests**, typecheck, smoke, knip. Schema **v7** (unchanged).

## 1. Deployment

| Step | Result |
|---|---|
| Safety copy | In-app *Create backup* from the live app (2.26 MB: `manifest.json`, `history.db`, `rules.json`) → `data/before-u8-20261014T190510Z/`. **Verified restorable** by the developer verifier: 1225 plays, every check passed |
| `npm run release` (plan) | first **refused `tree-dirty`** (an uncommitted audit entry). ✅ The guard working as designed; committed, then *would ACCEPT 0.8.0* |
| `npm run release -- --apply` → **0.8.0** | verify green → build exit 0 → `up -d` → **healthy** → `git tag v0.8.0`. Not pushed |
| Repeat release of 0.8.0 | ✅ **refused `image-tag-exists`**: BR-66.7 seen to refuse, not just tested |
| Live checks on 0.8.0 | image `spotify-now-playing:0.8.0`, 0 restarts · `/api/health` ok, 30 tools · Settings payload `appVersion: 0.8.0` · diagnostics **`Version · App version 0.8.0 · Database schema v7`** · ✅ **User-Agent `SpotifyNowPlaying/0.8.0`**, while the live `musicbrainz.json` still holds the legacy `"appVersion": "0.1.0"`: the *ignored if present* path, proved on a real install file · polls 9/9 playing |
| **Click-test, LOOKED AT** (Chrome) | ⚠️ **DEFECT: "Version 0.8.0" was CLIPPED against the dialog's right edge.** The paragraph sat outside the sections' 1.25rem inset. Every test passed, because they assert the text, which was right. **The U6 lesson again: only looking found it.** No console errors |
| Fix → **0.8.1** | inset added (`public/styles.css`). Previewed live in the page first, then released as a **new PATCH**. ✅ The first real use of *a tag is never overwritten*: the fix could not go out as 0.8.0 |
| Live checks on 0.8.1 | `Version 0.8.1` fully inside the dialog, 20 px from the edge like the sections (screenshot) · healthy |
| Recording across both deploys | ✅ continued. See §3 for what two deploys in four minutes cost |

## 2. Exit criteria

| Criterion | Status |
|---|---|
| BR-64.2 one-time history scan | ✅ 154 commits, no credentials (Code Generation, record in `u8-team-workflow/code/`) |
| BR-63.1 CI runs smoke, knip, secret scan | ✅ first run green: range scan **6 commits**, no leaks; smoke ran. Manual *Secret history scan*: **159 commits**, checksum OK, no leaks |
| BR-63.3/63.5 `main` protected, **seen to refuse** | ✅ ruleset id `25110056` applied; owner bypass push accepted. PR #1: test job **red** → `BLOCKED` → `gh pr merge` without `--admin` **refused** (*"the base branch policy prohibits the merge"*) → closed, branch deleted. ⚠️ But only after §4a's fix: the first run of the control went **green** |
| BR-66 versions and releases | ✅ `v0.8.0`, `v0.8.1` made by `npm run release`; repeat refused; version derived everywhere |
| LC-57 version display | ✅ deployed, looked at, fixed, re-checked |
| BR-65.3 MCP licence issue | ✅ posted by the owner 2026-10-16: [marcelmarais/spotify-mcp-server#106](https://github.com/marcelmarais/spotify-mcp-server/issues/106), open |
| FR-65 / BR-62 the cold walk → `1.0.0-beta.1` | ✅ **PASSED 2026-10-18**, attempt 4 on `v0.8.5`, the user's own path (`claude-start.md`). Attempts 1–3 each found real gaps, fixed in 0.8.2–0.8.5, including the Windows `auth.mjs` `&` bug. **`1.0.0-beta.1` released** from the walked commit. Records in `u8-team-workflow/walks/` |

## 3. Finding: a deploy splits the play in progress

One listen of *Pixie* (progress 0 → 237 s) became **three rows**: 1267 and 1268 `unknown` / `app-shutdown` (in-progress
plays flushed at shutdown, by design), and **1269 `completed`**, which started at progress **187 s** and observed
only the last ~50 s. Verified by a read-only query **inside the container**.

- **Not new, and not U8's**: the 2026-09-06 audit counts `app-shutdown` rows from rebuilds, and every restart does
  this.
- **The cost**: one listen reads as **3 plays** in *Times played*. The surviving `completed` is right (the track was
  heard), and the fragments are `unknown`, so the gate's `ELIGIBLE` predicate excludes them. Nothing reaches R1.
- **Rows are not touched** (project rule). Whether to stitch a resumed play to its shutdown fragment (same
  `track_id`, gap of a few seconds, resumed progress > 0) is a **backlog question for the owner**, not a fix made
  here.

## 4a. ⚠️ Finding: a failing test NEVER failed CI — found by the positive control

The first run of the refused-PR control **went green and MERGEABLE**: the deliberately failing test ran and failed
(`# fail 4` in the log), and the job passed. Cause: the step `npm run test:coverage 2>&1 | tee test-output.txt` ran
under GitHub's default `bash -e {0}`, **without `pipefail`**, so it took **`tee`'s** exit code. **That has been
true since the step was written.** Every green CI run before 2026-10-14 says only that the suite *ran*, not that it
*passed*. Local `npm run verify` has always been the real gate, which is why nothing reached `main` broken. As far as
can be told: today's first `pipefail` run found exactly one CI-only failure, and it was new (below).

- **Fix**: `defaults: run: shell: bash` in both workflows (`bash --noprofile --norc -e -o pipefail`, confirmed in
  the log). `test/rulesetMatchesWorkflow.test.ts` pins it, with a positive control.
- **The first CI run that could fail, did**: the new docs test failed **only in CI**. It stripped the trailing slash
  before `git check-ignore`, and `.gitignore`'s `data/` matches only what git knows is a directory; CI's fresh
  checkout has no `data/`. Fixed (slash kept, probed in a clean clone without `data/`). The whole suite was then run
  in that clean clone before pushing (all pass except PBT-66, which needs the MCP source that CI fetches itself).
- **The project's own trap, one layer up**: *"check build exit codes directly — a piped build once read as
  success"*. It was written about a local `docker compose build | tail`, and the same shape sat in CI.
- Also fixed on the first live `protect --apply`: its read-back always said **DIFFERS** (GitHub reorders keys and
  adds defaults). It now compares only the fields the file sets. Positive control: a fourth required check added to
  the file is reported.

The deployed image is unaffected (workflows, tests and `protect.mjs` are not in it), so `0.8.1` stands.

## 4. The outward-facing part — ✅ done 2026-10-14 (owner: "go ahead with 1-3")

1. `git push origin main --follow-tags` (5 commits, tags `v0.8.0` and `v0.8.1`).
2. Watch CI: the three jobs green. Then trigger *Secret history scan* once (`gh workflow run secret-history.yml`) and
   watch it go green.
3. `npm run protect` (diff), then `npm run protect -- --apply` (writes the ruleset; reads it back).
4. **Positive control (BR-63.5)**: a throwaway branch that breaks one check → PR → CI red → `gh pr merge` **without
   `--admin`** must be **refused** → close the PR and delete the branch.
5. The owner posts the MCP licence issue.
