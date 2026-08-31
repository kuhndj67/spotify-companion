/**
 * The ISRC registrant signal.
 *
 * ⚙️ **PURE.** String parsing and a lookup table.
 *
 * ## Why this signal matters disproportionately
 *
 * It is the **only signal with 100% coverage**. MusicBrainz resolved 13 of 19 probe ISRCs; the
 * registrant prefix is readable from all 19, including the six MusicBrainz has never heard of.
 * When everything else returns `unknown`, this is what is left — and `unknown` is the population
 * R2 is about, so a signal that survives there is worth having.
 *
 * It is also **free**: no request, no rate limit, no cache. The ISRC is already on the play row.
 *
 * ## An ISRC, decoded
 *
 * ```
 *   U S U M 7 1 9 0 3 7 8 3
 *   └┬┘ └─┬─┘ └┬┘ └───┬───┘
 *    │    │    │      └─ designation code (the recording)
 *    │    │    └──────── year of reference
 *    │    └───────────── registrant code: WHO registered it
 *    └────────────────── country of registration
 * ```
 *
 * The **registrant** is the interesting part. Majors register enormous volumes under a handful of
 * stable codes, and the probe saw this directly:
 *
 * > `USUM` / `USSM` / `GBUM` (Universal, Sony, Universal UK) **all resolved**, while **all five
 * > `QZ*` ISRCs missed**. `QZ` prefixes are issued by DIY distribution platforms.
 *
 * ## ⚠️ Why this votes `weak` and never `strong`
 *
 * A registrant code says who *registered the recording*, not who the artist is signed to. Majors
 * register on behalf of distributed independents, and independents sometimes register through
 * aggregators that also serve majors. The correlation measured in the probe is real but it is a
 * correlation, and under the standing precision rule a correlation does not get to outvote a
 * label name.
 *
 * Concretely: this signal can never *create* a `major` verdict on its own (BR-4.3 requires a
 * strong vote), and it can never create an `independent` verdict where a major label name exists.
 * It breaks ties and it speaks when nothing else can.
 */

import type { SignalVote } from './types.js';

/**
 * Registrant codes belonging to the majors, keyed by the 2-letter country + 2-character
 * registrant. Conservative by construction: an unlisted registrant votes `unknown`, never
 * `independent`.
 */
const MAJOR_REGISTRANTS: Readonly<Record<string, string>> = Object.freeze({
  // Universal
  USUM: 'Universal Music Group (US)',
  GBUM: 'Universal Music Group (UK)',
  DEUM: 'Universal Music Group (DE)',
  FRUM: 'Universal Music Group (FR)',
  USMC: 'Universal / Motown',
  USIR: 'Universal / Interscope',
  // Sony
  USSM: 'Sony Music Entertainment (US)',
  GBARL: 'Sony Music (UK, Arista/RCA legacy)',
  USRC: 'Sony / RCA',
  USJI: 'Sony / Jive legacy',
  DEA: 'Sony Music (DE)',
  // Warner
  USAT: 'Warner / Atlantic',
  USWB: 'Warner Bros. Records',
  GBAHS: 'Warner Music (UK)',
  USEE: 'Warner / Elektra',
  QMRSD: 'Warner Music distribution',
});

/**
 * Registrant codes strongly associated with DIY and independent distribution platforms.
 *
 * These are the prefixes issued by services any artist can sign up to — DistroKid, TuneCore,
 * CD Baby, Amuse and similar. **All five `QZ*` ISRCs in the probe missed MusicBrainz entirely**,
 * which is consistent with recent self-released material.
 *
 * ⚠️ Still only a `weak` vote, and for a specific reason: **majors use these platforms too**, for
 * side projects, features and back catalogue. A `QZ` prefix makes independence likely, not
 * certain, and the standing rule says likely is not enough to overrule a major label name.
 */
const INDIE_REGISTRANTS: Readonly<Record<string, string>> = Object.freeze({
  QZ: 'DIY distribution platform (QZ block)',
  QM: 'DIY distribution platform (QM block)',
  TC: 'TuneCore',
  US3: 'CD Baby / DIY block',
  SE6: 'Amuse',
  QT: 'DIY distribution platform (QT block)',
});

/** ISRCs are 12 characters: 2 country + 3 registrant + 2 year + 5 designation. */
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/;

/** Strip the formatting MusicBrainz and Spotify disagree about (`US-UM7-19-03783`). */
export function normaliseIsrc(isrc: string): string {
  return isrc.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** True when the string is a structurally valid ISRC. */
export function isValidIsrc(isrc: string): boolean {
  return ISRC_PATTERN.test(normaliseIsrc(isrc));
}

/**
 * The country + registrant portion — the first five characters.
 *
 * Returns `null` rather than a truncated guess when the input is not a valid ISRC. A malformed
 * ISRC producing a plausible-looking prefix is precisely the "confident wrong data" failure this
 * unit is built to avoid.
 */
export function registrantPrefix(isrc: string): string | null {
  const normalised = normaliseIsrc(isrc);
  if (!isValidIsrc(normalised)) return null;
  return normalised.slice(0, 5);
}

/**
 * Vote on a label verdict from the ISRC alone.
 *
 * Matching is longest-prefix-first so that a specific 5-character registrant beats a general
 * 2-character block — `USUM` (Universal) must not be shadowed by a broad `US` entry, and adding
 * one later must not silently change existing verdicts.
 *
 * Returns `null` when the ISRC is absent or malformed: **no vote at all**, which is different
 * from a vote of `unknown`. A vote of `unknown` says "this signal looked and had no opinion"; no
 * vote says "this signal could not run". Only the first should appear in a trace.
 */
export function isrcPrefixVote(isrc: string | null): SignalVote | null {
  if (isrc === null) return null;

  const normalised = normaliseIsrc(isrc);
  const prefix = registrantPrefix(normalised);
  if (prefix === null) return null;

  // Longest first: 5-character registrants, then the broader 2-4 character blocks.
  for (let length = 5; length >= 2; length -= 1) {
    const key = normalised.slice(0, length);

    const major = MAJOR_REGISTRANTS[key];
    if (major !== undefined) {
      return {
        signal: 'isrc-prefix',
        verdict: 'major',
        strength: 'weak',
        evidence: `ISRC registrant ${key} — ${major}`,
      };
    }

    const indie = INDIE_REGISTRANTS[key];
    if (indie !== undefined) {
      return {
        signal: 'isrc-prefix',
        verdict: 'independent',
        strength: 'weak',
        evidence: `ISRC registrant ${key} — ${indie}`,
      };
    }
  }

  return {
    signal: 'isrc-prefix',
    verdict: 'unknown',
    strength: 'weak',
    evidence: `ISRC registrant ${prefix} — not a recognised block`,
  };
}
