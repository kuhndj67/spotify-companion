/**
 * Narrowing a recording's releases down to the one Spotify actually played.
 *
 * ⚙️ **PURE.** Releases and an album title/date in, a candidate set and a tier out.
 *
 * ## The problem this solves, measured
 *
 * FR-13 anticipated ambiguity in *classifying* a label. The probe found the ambiguity starts one
 * step earlier — in deciding which label is even the input:
 *
 * > **Audioslave → 44 releases → 10 labels spanning two different majors** (Epic/Sony *and*
 * > Interscope/Universal). **Slipknot → 50 releases → 12 labels.**
 *
 * A recording maps to every pressing, reissue and regional edition anyone ever released. Voting
 * over all of them answers "who has ever pressed this?", which is not the question.
 *
 * ## The cascade, and why it is a cascade
 *
 * | Strategy | Fired on | Effect |
 * |---|---|---|
 * | Album title **and** exact date | 8 / 13 | Precise — Audioslave 44 → 1 |
 * | Album title only, normalised | **13 / 13** | Slipknot 50 → 1 → Roadrunner, correct |
 * | All releases | 13 / 13 | Everything anyone ever pressed |
 *
 * Title+date is the most precise and misses a third of the time — not because the data is bad but
 * because Spotify reports year-only dates and MusicBrainz carries deluxe reissues. Falling back to
 * title-only recovers all of them. Falling back again to *all* keeps coverage rather than
 * discarding the row, but the tier is recorded and **tier `all` caps confidence at `low`**
 * (Q1 = A), because voting over every pressing is materially weaker evidence.
 */

import type { LabelCandidate, NarrowingTier } from './types.js';

/** One release as MusicBrainz returns it, reduced to what narrowing needs. */
export interface ReleaseSummary {
  releaseId: string;
  title: string | null;
  date: string | null;
  status: string | null;
  labels: {
    labelName: string;
    labelMbid: string | null;
    labelType: LabelCandidate['labelType'];
    catalogNumber: string | null;
  }[];
}

export interface NarrowingResult {
  tier: NarrowingTier;
  candidates: LabelCandidate[];
  /** Releases seen *before* narrowing — the ambiguity measure, stored on the resolution. */
  releaseCount: number;
}

/**
 * Compare album titles ignoring what varies meaninglessly between Spotify and MusicBrainz.
 *
 * Deliberately does **not** strip parenthetical suffixes. `(Deluxe Edition)` and
 * `(Remastered 2010)` are different releases that genuinely can carry different labels — treating
 * them as the same album is exactly the over-matching that puts two majors on one verdict.
 */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Do two dates refer to the same release date?
 *
 * Spotify reports `release_date` at varying precision (`2022`, `2022-03`, `2022-03-14`) and
 * declares which via `release_date_precision`; MusicBrainz is equally variable. Comparison is
 * therefore done at **the coarser of the two precisions** — comparing `2022` against `2022-03-14`
 * as strings would fail on data that agrees.
 *
 * ⚠️ Year-only agreement is weak, and that weakness is the whole reason the title+date tier fired
 * on only 8 of 13. It is not compensated for here: a loose match would make the precise tier
 * meaningless. The cascade handles the misses instead.
 */
export function datesMatch(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;

  const partsA = a.split('-');
  const partsB = b.split('-');
  const depth = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < depth; i += 1) {
    // Normalise away zero-padding differences ("03" vs "3").
    if (Number.parseInt(partsA[i]!, 10) !== Number.parseInt(partsB[i]!, 10)) return false;
  }
  return true;
}

function toCandidates(releases: ReleaseSummary[]): LabelCandidate[] {
  const candidates: LabelCandidate[] = [];
  for (const release of releases) {
    for (const label of release.labels) {
      candidates.push({
        labelName: label.labelName,
        labelMbid: label.labelMbid,
        labelType: label.labelType,
        catalogNumber: label.catalogNumber,
        releaseId: release.releaseId,
        releaseTitle: release.title,
        releaseDate: release.date,
        releaseStatus: release.status,
      });
    }
  }
  return candidates;
}

/**
 * Run the cascade.
 *
 * A tier only counts as having fired if it produced **at least one release carrying at least one
 * label**. A tier that matches a release with no label information at all has not narrowed
 * anything usefully — it has found a row and learned nothing — so the cascade continues rather
 * than stopping with an empty candidate set and a misleadingly precise tier.
 */
export function narrowReleases(
  releases: ReleaseSummary[],
  albumTitle: string | null,
  albumDate: string | null,
): NarrowingResult {
  const releaseCount = releases.length;

  if (releaseCount === 0) {
    return { tier: 'none', candidates: [], releaseCount: 0 };
  }

  const hasLabels = (subset: ReleaseSummary[]) =>
    subset.some((release) => release.labels.length > 0);

  if (albumTitle !== null) {
    const wanted = normaliseTitle(albumTitle);

    const titleMatches = releases.filter(
      (release) => release.title !== null && normaliseTitle(release.title) === wanted,
    );

    // Tier 1 — title AND date.
    const exact = titleMatches.filter((release) => datesMatch(release.date, albumDate));
    if (exact.length > 0 && hasLabels(exact)) {
      return { tier: 'title-date', candidates: toCandidates(exact), releaseCount };
    }

    // Tier 2 — title only.
    if (titleMatches.length > 0 && hasLabels(titleMatches)) {
      return { tier: 'title', candidates: toCandidates(titleMatches), releaseCount };
    }
  }

  // Tier 3 — everything. Caps confidence at `low` downstream (Q1 = A).
  return { tier: 'all', candidates: toCandidates(releases), releaseCount };
}
