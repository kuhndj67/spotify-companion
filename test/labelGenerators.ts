/**
 * Domain generators for label-classification property tests.
 *
 * These produce *plausible MusicBrainz shapes*, not random strings. The classifier's behaviour
 * depends on the interaction between label names, MusicBrainz label types and the narrowing tier,
 * so the generators are built to hit those combinations rather than to vary characters.
 *
 * The independent-label names are drawn from a fixed pool that is checked, in the property suite
 * itself, to contain **no accidental major roots** — a generated "independent" name that happened
 * to normalise to `island` would make the asymmetry properties pass for the wrong reason.
 */

import fc from 'fast-check';
import type { LabelCandidate, LabelType, NarrowingTier } from '../src/musicbrainz/types.js';
import { MAJOR_ROOTS } from '../src/musicbrainz/majorRootList.js';

/** Real major imprints, in the spellings MusicBrainz actually uses. */
export const MAJOR_LABEL_NAMES = [
  'Atlantic',
  'Atlantic Records',
  'Columbia',
  'Epic',
  'Interscope',
  'Interscope Records',
  'Island Records',
  'Def Jam Recordings',
  'Capitol Records',
  'Virgin Music Group',
  'RCA',
  'Warner Records',
  'Roadrunner Records',
  'Spinefarm Records',
] as const;

/**
 * Independent label names, including the awkward ones the probe surfaced.
 *
 * `broke` and `Never Too Different` are real: `broke` is typed Distributor and genuinely
 * independent; `Never Too Different` is Token's release-level label while his artist-level label
 * is Atlantic — both true, which is why the two levels are never merged.
 */
export const INDIE_LABEL_NAMES = [
  'broke',
  'Never Too Different',
  'Arising Empire',
  'EMPIRE',
  'Sounds Good',
  'Smokin Cactus',
  'Jigu Records',
  'Sumerian Records',
  'Hopeless Records',
  'Epitaph',
  'Sub Pop',
  'Dirty Hit',
] as const;

export const labelTypeArb: fc.Arbitrary<LabelType> = fc.constantFrom<LabelType>(
  'Imprint',
  'Original Production',
  'Distributor',
  'Publisher',
  'Holding',
  'Reissue Production',
  null,
);

/** Types that are eligible to vote — Publisher is excluded by BR-3.1. */
export const eligibleLabelTypeArb: fc.Arbitrary<LabelType> = fc.constantFrom<LabelType>(
  'Imprint',
  'Original Production',
  'Distributor',
  'Holding',
  'Reissue Production',
  null,
);

/** Types that vote `strong` — the ones that make a verdict confident. */
export const strongLabelTypeArb: fc.Arbitrary<LabelType> = fc.constantFrom<LabelType>(
  'Imprint',
  'Original Production',
);

export const narrowingTierArb: fc.Arbitrary<NarrowingTier> = fc.constantFrom<NarrowingTier>(
  'title-date',
  'title',
  'all',
  'none',
);

function makeCandidate(labelName: string, labelType: LabelType, index: number): LabelCandidate {
  return {
    labelName,
    labelMbid: null,
    labelType,
    catalogNumber: null,
    releaseId: `release-${index}`,
    releaseTitle: 'Generated Album',
    releaseDate: '2022-03-14',
    releaseStatus: 'Official',
  };
}

/** A candidate carrying a real major imprint. */
export function majorCandidateArb(
  typeArb: fc.Arbitrary<LabelType> = eligibleLabelTypeArb,
): fc.Arbitrary<LabelCandidate> {
  return fc
    .tuple(fc.constantFrom(...MAJOR_LABEL_NAMES), typeArb, fc.nat({ max: 50 }))
    .map(([name, type, index]) => makeCandidate(name, type, index));
}

/** A candidate carrying an independent label name. */
export function indieCandidateArb(
  typeArb: fc.Arbitrary<LabelType> = eligibleLabelTypeArb,
): fc.Arbitrary<LabelCandidate> {
  return fc
    .tuple(fc.constantFrom(...INDIE_LABEL_NAMES), typeArb, fc.nat({ max: 50 }))
    .map(([name, type, index]) => makeCandidate(name, type, index));
}

/** Any candidate at all, including publishers and the `[no label]` sentinel. */
export const anyCandidateArb: fc.Arbitrary<LabelCandidate> = fc
  .tuple(
    fc.oneof(
      fc.constantFrom(...MAJOR_LABEL_NAMES),
      fc.constantFrom(...INDIE_LABEL_NAMES),
      fc.constant('[no label]'),
      fc.constant(''),
    ),
    labelTypeArb,
    fc.nat({ max: 50 }),
  )
  .map(([name, type, index]) => makeCandidate(name, type, index));

/** Exported for the guard test that keeps the indie pool free of accidental majors. */
export const majorRootsForTests = MAJOR_ROOTS;
