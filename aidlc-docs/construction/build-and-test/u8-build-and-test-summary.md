# U8 Build & Test Summary — Team Workflow & Onboarding

**Date**: 2026-10-14 (UTC) · **Status**: 🟡 **local part done; outward-facing part awaiting the owner's go-ahead**
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
| BR-63.1 CI runs smoke, knip, secret scan | ⏳ **first CI run needs a push** |
| BR-63.3/63.5 `main` protected, **seen to refuse** | ⏳ **needs `npm run protect -- --apply` and the refused PR** |
| BR-66 versions and releases | ✅ `v0.8.0`, `v0.8.1` made by `npm run release`; repeat refused; version derived everywhere |
| LC-57 version display | ✅ deployed, looked at, fixed, re-checked |
| BR-65.3 MCP licence issue | ⏳ draft ready; **the owner posts it** |
| FR-65 / BR-62 the cold walk → `1.0.0-beta.1` | ⏳ guide written: [`e2e-test-instructions.md`](e2e-test-instructions.md). Needs the VM work (§1–§2 there) and the pushed tag |

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

## 4. Owed: the outward-facing part, awaiting the owner's go-ahead

1. `git push origin main --follow-tags` (5 commits, tags `v0.8.0` and `v0.8.1`).
2. Watch CI: the three jobs green. Then trigger *Secret history scan* once (`gh workflow run secret-history.yml`) and
   watch it go green.
3. `npm run protect` (diff), then `npm run protect -- --apply` (writes the ruleset; reads it back).
4. **Positive control (BR-63.5)**: a throwaway branch that breaks one check → PR → CI red → `gh pr merge` **without
   `--admin`** must be **refused** → close the PR and delete the branch.
5. The owner posts the MCP licence issue.
