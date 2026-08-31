/**
 * The curated major-label root list, and the name normalisation that makes matching it possible.
 *
 * ⚙️ **PURE.** Data and string functions only — see `test/purity.test.ts`.
 *
 * ## Why a curated list rather than a lookup
 *
 * R3 says there is no clean, authoritative major/independent split. MusicBrainz has label
 * *relationships* (`label ownership`, `label distribution`, `imprint`), and they are genuinely
 * useful, but the live probe showed they cannot be the only signal:
 *
 * > **Spinefarm's `distribution` relationship points at [PIAS], an independent** — while
 * > Spinefarm itself is Universal-owned. Following distribution alone would classify a Universal
 * > imprint as independent.
 *
 * So ownership and distribution vote separately (BR-6.5), and a curated root list of the three
 * majors' well-known imprints provides the strong signal. The list is deliberately *conservative*:
 * a name missing from it produces `unknown`, not `independent`.
 *
 * ## The asymmetry, again
 *
 * Adding a wrong entry here is far more damaging than omitting a right one. A false major
 * classification costs one row; a false **independent** classification manufactures support for
 * the hypothesis under test. Everything in this list is an imprint whose ownership is a matter of
 * public record, and anything uncertain is left out on purpose.
 */

/**
 * Imprints and sub-labels of the three majors — Universal, Sony, Warner.
 *
 * ⚠️ **Every entry must already be in `labelRoot` form**, and `test/majorRootList.test.ts` asserts
 * it. This fails *silently* otherwise: `labelRoot` trims trailing `records` / `recordings` /
 * `entertainment`, so an entry like `legacy recordings` would be compared against candidates that
 * have already been reduced to `legacy` and could never match. Nothing would go red — the label
 * would simply never be recognised as major, which is a false `independent` in waiting.
 *
 * `J Records` is dropped rather than reduced for the same class of reason: its root is the single
 * letter `j`, which would match `J Dilla Music` by word boundary. RCA absorbed it anyway, and RCA
 * is listed.
 *
 * Entries are roots, so word-boundary matching catches `Columbia Records`, `Columbia UK` and so on
 * from a single `columbia`.
 */
export const MAJOR_ROOTS: readonly string[] = Object.freeze([
  // -- Universal Music Group -------------------------------------------------
  'universal',
  'interscope',
  'geffen',
  'aftermath',
  'def jam',
  'island',
  'republic',
  'capitol',
  'virgin',
  'motown',
  'polydor',
  'decca',
  'deutsche grammophon',
  'emi',
  'verve',
  'blue note',
  'mercury',
  'roc nation',
  'darkroom',
  'spinefarm', // Universal-owned; see the header note — its distribution points at [PIAS]
  'abkco',
  'cash money',
  'shady',

  // -- Sony Music ------------------------------------------------------------
  'sony',
  'columbia',
  'rca',
  'epic',
  'arista',
  'legacy',
  'masterworks',
  'jive',
  'laface',
  'century media', // Sony-owned since 2015
  'ultra', // Sony bought out the remaining stake in 2021

  // -- Warner Music Group ----------------------------------------------------
  'warner',
  'atlantic',
  'elektra',
  'reprise',
  'parlophone',
  'asylum',
  'nonesuch',
  'sire',
  'rhino',
  '300',
  'big beat',
  'fueled by ramen',
  'roadrunner', // Warner-owned; the probe confirmed Roadrunner -> Warner
  'east west',
  'maverick',
]);

/**
 * Deliberately absent: **Nuclear Blast**. It was acquired by Believe in 2018, which is an
 * independent company, so listing it as a major root would be factually wrong. It is the kind of
 * entry that looks obviously major from the genre and is not — which is why the list is curated
 * from ownership records rather than intuition.
 */

/**
 * Normalise a label name for comparison.
 *
 * MusicBrainz spellings vary in ways that are meaningless for classification — `Epic`,
 * `Epic Records`, `Epic/Sony Music`, trailing disambiguators in brackets, curly apostrophes.
 * Normalisation strips what does not carry meaning and leaves what does.
 *
 * Deliberately **not** stripping numbers: `300 Entertainment` and `4AD` are real label names where
 * the digits are the identity.
 */
export function normaliseLabelName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // Drop combining marks so accented spellings match their plain forms.
    .replace(/[̀-ͯ]/g, '')
    // MusicBrainz disambiguation lives in brackets and is not part of the name.
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    // Curly quotes to straight, then drop apostrophes entirely.
    .replace(/[‘’‚‛]/g, "'")
    .replace(/'/g, '')
    // Anything not a letter, digit or space becomes a separator.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Corporate suffixes that carry no identity. Removed only when they are trailing words, so
 * `Records DK` keeps its meaning and `Island Records` reduces to `island`.
 */
const TRAILING_NOISE = [
  'records',
  'record',
  'recordings',
  'recording',
  'music group',
  'music',
  'entertainment group',
  'entertainment',
  'group',
  'ltd',
  'limited',
  'llc',
  'inc',
  'gmbh',
  'company',
  'label',
];

/**
 * Reduce a normalised name to its root by trimming trailing corporate noise.
 *
 * Iterative because names stack them: `Island Records Ltd` → `island records` → `island`.
 *
 * ⚠️ **Never reduces to empty.** A label literally named `Records` would otherwise normalise to
 * nothing and then match every root prefix, classifying it as whatever came first in the list.
 * The last non-empty form wins instead.
 */
export function labelRoot(name: string): string {
  let current = normaliseLabelName(name);

  let changed = true;
  while (changed) {
    changed = false;
    for (const noise of TRAILING_NOISE) {
      const suffix = ' ' + noise;
      if (current.endsWith(suffix)) {
        const trimmed = current.slice(0, -suffix.length).trim();
        if (trimmed.length > 0) {
          current = trimmed;
          changed = true;
          break;
        }
      }
    }
  }

  return current;
}

/**
 * Does this label name belong to a major?
 *
 * Matches on the root, and requires a **word boundary** rather than a bare `startsWith`: without
 * it, `universal` would match `Universal Sound` (an unrelated independent) purely on prefix, and
 * that error runs in the safe direction only by luck. Requiring the root to be the whole name or
 * to be followed by a space keeps the match honest.
 *
 * Returns the matched root so the vote can carry evidence, or `null`.
 */
export function matchMajorRoot(
  labelName: string,
  roots: readonly string[] = MAJOR_ROOTS,
): string | null {
  const root = labelRoot(labelName);
  if (root.length === 0) return null;

  for (const candidate of roots) {
    if (root === candidate) return candidate;
    if (root.startsWith(candidate + ' ')) return candidate;
  }
  return null;
}

/**
 * MusicBrainz's sentinel for "this release had no label".
 *
 * ⚠️ **It means `unknown`, not `independent`** (BR-3.2, Q10 = A). This was tested rather than
 * assumed, and the assumption was wrong: both `[no label]` artists in the probe carry real labels
 * on their *other* MusicBrainz releases — **Imminence: 41 of 66 named, including Virgin Music
 * Group (Universal)**; Red Leather: EMPIRE. The sentinel reflects incomplete data entry, not a
 * claim of self-release.
 *
 * Treating it as `independent` would have been wrong in the direction that falsely supports the
 * hypothesis. This is the error the user's precision principle caught.
 */
export const NO_LABEL_SENTINEL = '[no label]';

/** True when MusicBrainz asserted the sentinel rather than a real label name. */
export function isNoLabelSentinel(labelName: string): boolean {
  return normaliseLabelName(labelName) === normaliseLabelName(NO_LABEL_SENTINEL);
}
