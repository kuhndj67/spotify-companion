/**
 * Fact assembly — mapping already-fetched values into `TrackFacts`. ⚙️ PURE
 *
 * ## This module issues no request and reads no clock
 *
 * Everything arrives as an argument. The caller does the fetching; this maps. That separation is
 * what lets the whole rules core be replayed identically during back-testing (FR-42).
 *
 * ## ⚠️ No default is ever substituted
 *
 * An absent input arrives `null` and stays `null` (BR-21.5). Substituting `0` for an unknown
 * history count would make *"never skipped this track"* silently true for a track never seen,
 * which is US-16's stated failure mode — and the same error as writing `completed` onto a
 * backfilled play row. A default here is a fabricated fact about the variable under study.
 */

import type { LabelClass, LikedTransition, Maybe, TrackFacts } from './types.js';

/**
 * What the caller must supply. Every optional value is `Maybe`, never optional-undefined, so a
 * forgotten field is a type error rather than a silent `unknown`.
 */
export interface FactSources {
  readonly trackId: string;
  readonly title: string;
  readonly durationMs: number;
  readonly explicit: Maybe<boolean>;
  readonly isrc: Maybe<string>;

  readonly artistId: Maybe<string>;
  readonly artistName: string;
  readonly following: Maybe<boolean>;
  readonly genres: Maybe<readonly string[]>;

  readonly albumName: string;
  readonly releaseDate: Maybe<string>;
  readonly ageYears: Maybe<number>;
  readonly albumType: Maybe<string>;

  readonly labelName: Maybe<string>;
  readonly labelClassification: Maybe<LabelClass>;
  readonly labelConfidence: Maybe<string>;

  readonly likedAtStart: Maybe<boolean>;
  readonly likedTransition: Maybe<LikedTransition>;

  readonly playsOfTrack: Maybe<number>;
  readonly skipsOfTrack: Maybe<number>;
  readonly playsOfArtist: Maybe<number>;
  readonly skipsOfArtist: Maybe<number>;

  /** The evaluation instant, from the caller. This module never reads a clock. */
  readonly evaluatedAtMs: number;
}

/**
 * Total: any well-typed input produces a well-formed `TrackFacts`. Nothing is computed, nothing
 * is defaulted, nothing is fetched.
 *
 * `durationMs` is floored at zero because a negative duration is meaningless and would make
 * `track.durationMs > x` answerable in a way the data does not support. That is a normalisation
 * of an impossible value, not a default for a missing one.
 */
export function assembleFacts(input: FactSources): TrackFacts {
  return {
    track: {
      id: input.trackId,
      title: input.title,
      durationMs: Math.max(0, input.durationMs),
      explicit: input.explicit,
      isrc: input.isrc,
    },
    artist: {
      id: input.artistId,
      name: input.artistName,
      following: input.following,
      // Passed through exactly: `null` (never asked) and `[]` (asked, none) stay distinct.
      genres: input.genres,
    },
    album: {
      name: input.albumName,
      releaseDate: input.releaseDate,
      ageYears: input.ageYears,
      type: input.albumType,
    },
    label: {
      name: input.labelName,
      classification: input.labelClassification,
      confidence: input.labelConfidence,
    },
    liked: {
      atStart: input.likedAtStart,
      transition: input.likedTransition,
    },
    history: {
      playsOfTrack: input.playsOfTrack,
      skipsOfTrack: input.skipsOfTrack,
      playsOfArtist: input.playsOfArtist,
      skipsOfArtist: input.skipsOfArtist,
    },
    evaluatedAtMs: input.evaluatedAtMs,
  };
}
