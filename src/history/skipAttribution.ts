/**
 * ⚰️ RETIRED 2026-09-22 — SUPERSEDED BY CLASSIFIER v2. This module exports nothing.
 *
 * It is kept, rather than deleted, because it records a real finding and the reasoning that led
 * to it. The same reason `skip_source` was kept when it turned out to be an assertion: the
 * historical claim stays visible.
 *
 * ## What it did
 *
 * `outcomeClassifier` v1 answered *"did this track change before it finished?"* and the observer
 * then asserted that every such change was the **user's** doing:
 *
 * ```ts
 * skipSource: outcome === 'skipped' ? 'user' : null,   // "every live-observed skip is the user's"
 * ```
 *
 * ⚠️ **That was an assumption written as an observation, and it was false.** It was caught by a
 * listener saying *"I never skip Ren"* while the statistics panel showed multiple Ren skips — no
 * test could have found it, because the code did exactly what it said.
 *
 * This module added a second, derived column beside it — `skip_attribution`, `user` vs
 * `unattributed` — splitting skips on the completion ratio at 0.75. Over 35 live skips the ratio
 * was bimodal with an empty band:
 *
 * ```
 * 0.01 … 0.44 0.49 0.49
 *              <- nothing between 0.49 and 0.81 ->
 * 0.81 0.82 … 0.89 0.90
 * ```
 *
 * ## Why it is retired rather than corrected
 *
 * It was a **filter applied after an over-broad outcome**. v1 labelled every below-threshold
 * track-change `skipped`, so something downstream had to separate rejections from transitions,
 * and this was it.
 *
 * Classifier v2 moved that judgement **into the outcome** (see THE UNOBSERVED TAIL in
 * `outcomeClassifier`). A `skipped` row now means "the listener rejected it" by construction,
 * because the overlap closes were filtered out before the label was assigned. That makes this
 * module's question already answered — and worse than redundant, because the two rules used
 * **different axes** and could therefore disagree:
 *
 * - this module: `completionRatio >= 0.75` -> not a rejection
 * - v2:          unobserved tail `> 55 s`  -> a rejection
 *
 * A 5:00 track skipped at 4:00 has a 60 s tail (v2: `skipped`, a rejection) and a 0.80 ratio
 * (this module: `unattributed`, not a rejection). The row would have asserted both at once, and
 * two consumers would have read it differently — the statistics panel routing on attribution, and
 * `BackTestService` counting every `skipped` row regardless of it. **Zero rows were in that state
 * when this was retired, but 31% of the corpus's tracks are long enough to reach it.** It had not
 * happened yet only because nobody had skipped a long track in its final quarter.
 *
 * ## What replaced what
 *
 * | question | answered by |
 * |---|---|
 * | was this a rejection at all? | `outcome === 'skipped'` (classifier v2) |
 * | listener or rule? | **`skip_source`** — still live, and what U5 needs |
 * | how far from the end did reporting stop? | `ev_duration_ms - ev_max_progress_ms` |
 *
 * ⚠️ `skip_source` IS NOT THIS COLUMN AND WAS NOT RETIRED. Rule-initiated skips are a separate
 * question that only U5 can answer, and recording them distinctly is a Phase 4 exit criterion.
 *
 * ## The column, and why it still exists
 *
 * `play.skip_attribution` and `play.attribution_version` are **left in the schema and set to
 * NULL**, not dropped. Migration 004 did drop columns for a comparable removal, but dropping this
 * one would break the by-image rollback guarantee the U4 handoff depends on: every earlier
 * image's repository selects `skip_attribution` by name.
 *
 * Nulling is rollback-safe *and* semantically correct under the old code — the pre-2026-09-22
 * `bucketOf` maps a null attribution to `skipped`, and after v2 every remaining skip really is
 * one. So an older image reads the nulled data correctly rather than merely tolerating it.
 *
 * ⚠️ **DO NOT RE-DERIVE THE COLUMN.** `scripts/attribute-skips.mjs` was deleted for this reason:
 * it held its own copy of `USER_SKIP_RATIO_CEILING = 0.75` and would repopulate a judgement that
 * v2 supersedes, on an axis v2 disagrees with. The pre-retirement values are preserved in the
 * `classification-snapshot-before.csv` inside `data/backup-before-classifier-v2-<stamp>/`, and in
 * `audit.md`.
 *
 * ## The measurement that survives, because it is an observation rather than a judgement
 *
 * The finding this module rested on is not withdrawn — it was confirmed on live data on
 * 2026-09-22 and is *why* v2 exists. Full record in
 * `aidlc-docs/construction/u5-automated-skipping/probes/r11-queue-lookahead-2026-09-22.md`:
 * in the AI DJ context the API stops reporting a track ~18–41 s before it stops playing, while
 * album, autoplay and radio playback show 0–3 s. 24 plays were reclassified `skipped` ->
 * `completed` as a result.
 *
 * ⚠️ The old note here said crossfade was ruled out *"because Spotify caps it at 12 s"*. That
 * argument was doubly wrong — it assumed cut length equals crossfade length, and crossfade is
 * disabled on the machine, so it was never a candidate. A UI fact was used as though it were a
 * probe result. Recorded because the claim is in this file's history.
 */

export {};
