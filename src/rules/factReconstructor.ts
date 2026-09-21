/**
 * Rebuilding `TrackFacts` from a stored `play` row, for back-testing (FR-42). ⚙️ PURE
 *
 * ## This module reads no clock and issues no request
 *
 * Everything arrives as an argument, including the history counts. A `Date.now()` here would
 * break NFR-26's determinism **while every other test passed** — the same trap as the outcome
 * classifier, in a new place. `test/purity.test.ts` is what catches it.
 *
 * ## ⚠️ Two different absences, and they must never be merged
 *
 * A field can read `null` for two incompatible reasons, and the back-test reports them in
 * different columns:
 *
 *   - **unknown** — the row was asked and the answer was nothing. `label.classification` null
 *     with `unknownReason = 'notFound'` means *MusicBrainz has no label for this release*. That
 *     is a **finding**, and R2 is about exactly this.
 *   - **unanswerable** — the row could never answer, whatever the data says. A pre-v5
 *     `track.explicit` has no column behind it; a `label.*` on a row that was never asked has no
 *     lookup behind it.
 *
 * Folding the second into the first produces *"your rule matched nothing"* where the truth is
 * *"your rule could not be asked"* — a wrong answer that reads as a finding, and the same family
 * as the `Label detail` dash and the MusicBrainz `inc=releases` 200.
 */

import type { PlayRecord } from '../history/types.js';
import { assembleFacts } from './trackFacts.js';
import type { HistoryCounts } from '../history/types.js';
import type { LabelClass, LikedTransition, TrackFacts } from './types.js';

/**
 * The instant a back-test evaluates "as of". A reconstruction is *of* a past play, so the
 * evaluation instant is that play's start — never the wall clock (NFR-26).
 */
export function reconstruct(row: PlayRecord, counts: HistoryCounts): TrackFacts {
  const label = row.label;

  return assembleFacts({
    trackId: row.trackId,
    title: row.title,
    // `evidence.durationMs` is the track length as observed. A backfilled row has an evidence
    // block of zeroes, so this can legitimately be 0 — `assembleFacts` floors it rather than
    // inventing a length.
    durationMs: row.evidence.durationMs,
    explicit: row.explicit,
    isrc: row.isrc,

    artistId: row.artistId,
    artistName: row.artistName,
    following: row.following,
    // ⚠️ `null` (never asked) and `[]` (asked, none) stay distinct — collapsing them repeats
    // the 2026-09-06 unknown-merge. The stored shape carries vote counts the rule cannot read.
    genres: label?.artistGenres ? label.artistGenres.map((g) => g.name) : null,

    albumName: row.albumName,
    releaseDate: row.releaseDate,
    ageYears: row.ageYears,
    albumType: row.albumType,

    // The release-level verdict, narrowed through the ISRC. There is no artist-level label
    // verdict to fall back on and there must not be one — see migration 004.
    labelName: firstLabelName(label?.names ?? null),
    labelClassification: asLabelClass(label?.verdict ?? null),
    labelConfidence: label?.confidence ?? null,

    likedAtStart: label?.likedAtStart ?? null,
    likedTransition: asLikedTransition(label?.likedTransition ?? null),

    playsOfTrack: counts.playsOfTrack,
    skipsOfTrack: counts.skipsOfTrack,
    playsOfArtist: counts.playsOfArtist,
    skipsOfArtist: counts.skipsOfArtist,

    evaluatedAtMs: Date.parse(row.startedAt),
  });
}

/**
 * ⚠️ Narrowing, not defaulting. An unrecognised stored string becomes `null` (unknown) rather
 * than being coerced into a member of the union — a value the classifier never wrote is not
 * evidence for any particular class.
 */
function asLabelClass(value: string | null): LabelClass | null {
  return value === 'major' || value === 'independent' || value === 'unknown' ? value : null;
}

function asLikedTransition(value: string | null): LikedTransition | null {
  return value === 'kept-liked' ||
    value === 'kept-unliked' ||
    value === 'liked-during' ||
    value === 'unliked-during' ||
    value === 'unknown'
    ? value
    : null;
}

/**
 * The catalogue exposes one `label.name`, while a release can carry several. The first is used
 * and the rest are not silently dropped from the record — `label.names` stays on the play row,
 * and the resolution trace holds the full set.
 */
function firstLabelName(names: readonly string[] | null): string | null {
  if (names === null || names.length === 0) return null;
  return names[0] ?? null;
}

/** Catalogue fields that depend on `play.explicit` / `play.album_type` (schema era). */
const SCHEMA_V5_FIELDS = ['track.explicit', 'album.type'] as const;

/** Catalogue fields that depend on a release-level MusicBrainz lookup having been attempted. */
const LABEL_FIELDS = ['label.name', 'label.classification', 'label.confidence'] as const;

/**
 * Which catalogue fields **this row** cannot answer, whatever its values say (BR-27.4/27.5).
 *
 * ⚠️ Computed from the row, never from a value coming back null. Two eras reach this, and only
 * one of them has a migration behind it.
 *
 * ### Schema era — `track.explicit`, `album.type` (BR-27.5a/5c)
 *
 * Decided by **row id against the v5 watermark, never by date**. The 6-hourly backfill inserts
 * rows dated in the past, so a row written *after* migration 005 for a play that happened
 * *before* it genuinely carries both values. Judging by `started_at` would mark real data
 * unanswerable.
 *
 * ### Provenance gap — `label.*` (BR-27.5b/5d)
 *
 * Measured on the live corpus 2026-09-20: **82 backfilled rows** dated 2026-08-20 → 08-31 carry
 * no ISRC, and on every one of them both `label_verdict` **and** `label_unknown_reason` are
 * null — never asked. Every row that *was* asked carries a verdict or a reason (`notFound` 151,
 * `noEligibleCandidate` 48).
 *
 * ⚠️ **The cause is unestablished, and it is not the code.** `recently-played` returns
 * `external_ids.isrc` (probed 2026-09-20) and `RecentlyPlayedBackfill` has read it since U1. No
 * `ALTER TABLE` marks the boundary, so **no schema-derived watermark can find it** — which is
 * why answerability is a predicate over the row rather than over the range.
 *
 * Without this, those 82 rows would be counted as plays that "read `label.classification`
 * absent", which any reader takes for **coverage** — the
 * 28%→12%-where-the-truth-was-86%→44% denominator bug, reappearing inside the back-test.
 */
export function unanswerableFields(row: PlayRecord, v5Watermark: number | null): string[] {
  const out: string[] = [];

  // A null watermark means migration 005 never recorded one. Era is then undecidable, and
  // claiming the fields ARE answerable would be the more dangerous guess of the two.
  if (v5Watermark === null || row.id <= v5Watermark) {
    out.push(...SCHEMA_V5_FIELDS);
  }

  if (wasNeverAskedForLabel(row)) {
    out.push(...LABEL_FIELDS);
  }

  return out;
}

/**
 * ⚠️ The **pair** of nulls is the discriminator, not either one alone.
 *
 * `verdict === null` alone would also catch a row whose lookup failed transiently and is still
 * pending — that row is *unknown*, not unanswerable, and it may yet be resolved. Requiring
 * `unknownReason` to be null as well restricts this to rows nothing ever asked about.
 */
function wasNeverAskedForLabel(row: PlayRecord): boolean {
  const label = row.label;
  if (label === undefined) return true;
  return label.verdict === null && label.unknownReason === null;
}
