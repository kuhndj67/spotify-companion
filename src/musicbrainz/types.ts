/**
 * Label enrichment domain types (U2).
 *
 * Two conventions from U1 carry over unchanged and matter more here than they did there:
 *
 * **`null` means "unknown", never `false` and never `0`.** U2 is the unit where missing data is
 * *correlated with the variable being measured* — MusicBrainz coverage is 58% and the misses skew
 * recent and independent (R2), which is exactly the population the promotion hypothesis is about.
 * A blank that reads as "no" would manufacture the finding.
 *
 * **`pending` is not `unknown`.** A lookup that has not happened yet and a lookup that came back
 * empty are different facts. Collapsing them corrupts the coverage metric that exists to measure
 * R2 (BR-7.7).
 *
 * ## The standing rule for this unit
 *
 * User, U2 Functional Design Q5: *"prioritise accuracy in the 'Artist Is Independent'
 * determination even if it ultimately misses some independent products."*
 *
 * It is deliberately asymmetric, and the asymmetry is encoded in the types and the classifier
 * rather than left to convention: missing an independent track costs one row, while calling a
 * major track independent **manufactures support for the hypothesis under test**, invisibly.
 */

/**
 * The verdict. Three values, and `unknown` is a real answer rather than an absence — it is
 * counted, exported as a literal token, and broken down by reason (BR-10.2).
 */
export type LabelVerdict = 'major' | 'independent' | 'unknown';

/**
 * Ordinal, never numeric. User, Q6: *"we shouldn't imply precision that doesn't exist."* Three
 * heuristics that measurably disagree do not support a calibrated 0–1 score.
 */
export type Confidence = 'high' | 'medium' | 'low';

/**
 * How a recording was found. Recorded per row because search misattributes: for Ren's *Starry
 * Night Act III* the top **two** hits scored 100 and were different recordings, while the
 * near-correct one scored 95. `score` does not rank correctness, so searched matches must be
 * excludable from analysis without re-deriving them (BR-2, Q3 = D).
 */
export type MatchMethod = 'isrc' | 'search' | 'none';

/**
 * Which tier of the narrowing cascade fired. An input to confidence, not metadata: tier `all`
 * means we could not tell which release Spotify played and are voting over everything ever
 * pressed, which caps confidence at `low` (Q1 = A).
 */
export type NarrowingTier = 'title-date' | 'title' | 'all' | 'none';

/**
 * Three states that look alike and are not.
 *
 * `not-found` is a fact about MusicBrainz's catalogue and is cacheable. `error` is a fact about
 * the network on a particular Tuesday and must not poison the record. Folding the second into the
 * first inflates the apparent coverage gap with transport noise — and that gap is the measurement
 * R2 depends on (P-4, BR-10.2).
 */
export type ResolutionStatus = 'resolved' | 'not-found' | 'error';

/** Why a verdict is `unknown`. Coverage is reported broken down by this (BR-10.2). */
export type UnknownReason = 'noIsrc' | 'notFound' | 'noEligibleCandidate' | 'error';

/**
 * MusicBrainz's own label typing. `Publisher` is the one that matters.
 *
 * Faouzia's *only* MusicBrainz label entry is `Faouzia Music`, type `Publisher`, disambiguation
 * `SOCAN` — a publishing entity. She records for Atlantic. Taken at face value that produces a
 * confident **"independent"** verdict that is wrong, and wrong in the direction that falsely
 * supports the hypothesis, because majors routinely use publishing subsidiaries (BR-3.1).
 */
export type LabelType =
  | 'Imprint'
  | 'Original Production'
  | 'Distributor'
  | 'Publisher'
  | 'Holding'
  | 'Reissue Production'
  | null;

/**
 * How much a vote counts. `Distributor` and untyped entries vote `weak` (Q13 = A): `broke`
 * (Marino, bbno$) is typed `Distributor` and self-describes as an independent label and
 * distributor — genuinely independent, but the *type alone* does not establish that a deal does
 * not exist behind it.
 */
export type VoteStrength = 'strong' | 'weak';

/** Which heuristic produced a vote. All three exist and measurably disagree (R3, Part 5). */
export type SignalName = 'major-root-list' | 'label-relationship' | 'isrc-prefix';

/** The two levels, stored separately and **never merged** (Q12). */
export type ResolutionScope = 'release' | 'artist';

/**
 * One label as it appears on one release. Immutable.
 *
 * `releaseStatus` exists to suppress bootlegs: an artist's set is inflated by unofficial pressings
 * and regional licensees, which say nothing about who they are signed to.
 */
export interface LabelCandidate {
  labelName: string;
  labelMbid: string | null;
  labelType: LabelType;
  catalogNumber: string | null;
  releaseId: string;
  releaseTitle: string | null;
  releaseDate: string | null;
  releaseStatus: string | null;
}

/** One heuristic's opinion, retained underneath the confidence band (Q11 = A, FR-13). */
export interface SignalVote {
  signal: SignalName;
  verdict: LabelVerdict;
  strength: VoteStrength;
  /** Human-readable justification — which root matched, which prefix, which relationship. */
  evidence: string | null;
}

/**
 * The MusicBrainz facts for one ISRC **at one moment**.
 *
 * Append-only (BR-13.1). Re-resolving inserts a new version rather than replacing the old one, so
 * an ISRC accumulates a chain. The reason is that two different things are both called "the data
 * changed": our knowledge changing (a volunteer catalogued a release) means the old verdict was
 * wrong, while the world changing (the artist signed) means the old verdict was *right for its
 * time*. MusicBrainz cannot tell you which occurred — a lookup that 404'd in August and returns
 * `Atlantic` in January is byte-identical either way — so the design keeps both readings.
 */
export interface LabelResolution {
  /** Version identity. What candidates, votes and plays point at (BR-13.2, BR-13.4). */
  id: number;
  /** The join key from U1. **Not** unique — one row per version. */
  isrc: string;
  recordingMbid: string | null;
  matchMethod: MatchMethod;
  narrowingTier: NarrowingTier;
  /** Total releases seen before narrowing — the ambiguity measure. */
  releaseCount: number;
  /** TTL input, **and** the version ordering key (BR-13.3). */
  resolvedAt: string;
  status: ResolutionStatus;
  /** The version this one replaced; `null` for the first. */
  supersedesId: number | null;
  candidates: LabelCandidate[];
  votes: SignalVote[];
}

/**
 * The artist-level equivalent, resolved through an **exact** Spotify-URL join rather than by name.
 *
 * MusicBrainz stores streaming links as first-class `url` entities, so the Spotify artist ID the
 * app already holds is a direct key — no name matching, none of the misattribution hazard that
 * makes search unsafe. MusicBrainz holds three artists named `Prof`; the join returns the right
 * one by construction.
 *
 * ⚠️ **It answers a different question from the release level and must never be merged with it.**
 * Token — *Full Bag* is `Never Too Different` (independent) at release level and `Atlantic` at
 * artist level. Both are true: an Atlantic artist releasing this one independently.
 */
export interface ArtistLabelResolution {
  id: number;
  spotifyArtistId: string;
  artistMbid: string | null;
  releaseCount: number;
  namedLabelCount: number;
  resolvedAt: string;
  status: ResolutionStatus;
  supersedesId: number | null;
  candidates: LabelCandidate[];
  votes: SignalVote[];
}

/**
 * The derived verdict. Judgement, not observation — recomputable from the candidates and votes
 * above with zero upstream requests (BR-8.7), which is what makes re-tuning cheap rather than
 * impossible. R3 guarantees the classifier will be re-tuned.
 */
export interface LabelClassification {
  verdict: LabelVerdict;
  confidence: Confidence;
  /**
   * **Major-vs-major only** (Q2 = A+C). Audioslave's single title+date match carries Epic *and*
   * Interscope — Sony and Universal on one release. An artist imprint distributed by a major is
   * not contested; it is one arrangement.
   */
  contested: boolean;
  /** Every label that voted, in the order they were seen. */
  labelNames: string[];
  votes: SignalVote[];
  /** Present only when `verdict` is `unknown` (BR-12.8). */
  unknownReason: UnknownReason | null;
  /** Which rules fired, for the trace (BR-12.3). */
  rulesFired: string[];
}

/**
 * A candidate paired with the eligibility decision made about it.
 *
 * `suppressedBy` is the field that carries the standing rule. The precision principle operates by
 * **exclusion**, and exclusion is invisible in a verdict: `unknown` because MusicBrainz knew
 * nothing and `unknown` because a `Publisher` candidate was found and refused are the same output
 * with entirely different meanings. This records which rule refused it (BR-12.3).
 */
export interface CandidateDecision {
  candidate: LabelCandidate;
  eligible: boolean;
  suppressedBy: string | null;
  strength: VoteStrength;
}

/** Everything the classifier needs, passed in. Nothing is read from the world (BR-4.8). */
export interface ClassificationContext {
  /** The curated major-label root list. Passed in so the classifier stays pure. */
  majorRoots: readonly string[];
  narrowingTier: NarrowingTier;
  /** ISRC registrant prefix vote — the only signal with 100% coverage. */
  isrcVote: SignalVote | null;
  /** Artist-level confidence is capped at `medium`: it aggregates a career, not a release. */
  capConfidenceAt?: Confidence;
}
