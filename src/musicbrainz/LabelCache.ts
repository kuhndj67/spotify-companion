/**
 * Resolution reads and writes, with the TTL policy that decides when to look again.
 *
 * **Not a cache in the evictable sense.** It is a durable, append-only record that BR-8.7 and
 * BR-12 both depend on: reclassification recomputes verdicts from the stored candidates and votes,
 * and the trace re-runs the classifier over the same rows. Eviction would break both.
 *
 * ## The TTL is a measurement decision, not a performance one
 *
 * Two different problems, deliberately given different lifetimes (P-3):
 *
 * | Row | TTL | Because |
 * |---|---|---|
 * | `unknown` | ~30 days | MusicBrainz's **completeness** changes. Coverage was measured at 43% for 2022-onward releases against 100% pre-2022 — the gap is recency-biased toward exactly the music the hypothesis is about |
 * | `resolved` | ~90 days | The underlying **fact** changes. An artist signs |
 *
 * ⚠️ **The second row is what makes the version chain worth having.** With successes cached
 * forever, the chain could only ever record `unknown → known` — our own catalogue gaps filling in
 * — and never `independent → major`, which is the case it exists for. It would have looked like it
 * was working the whole time.
 */

import type {
  LabelRepository,
  NewArtistResolution,
  NewLabelResolution,
  StaleResolution,
} from './LabelRepository.js';
import type { ArtistResolution, LabelResolution } from './types.js';

export interface LabelCacheOptions {
  repository: LabelRepository;
  unknownTtlDays?: number;
  resolvedTtlDays?: number;
}

export class LabelCache {
  readonly #repository: LabelRepository;
  readonly #unknownTtlDays: number;
  readonly #resolvedTtlDays: number;

  constructor(options: LabelCacheOptions) {
    this.#repository = options.repository;
    this.#unknownTtlDays = options.unknownTtlDays ?? 30;
    this.#resolvedTtlDays = options.resolvedTtlDays ?? 90;
  }

  /** The newest version for an ISRC, or `null` if never resolved. */
  getRelease(isrc: string): LabelResolution | null {
    return this.#repository.getCurrentLabelResolution(isrc);
  }

  getArtist(spotifyArtistId: string): ArtistResolution | null {
    return this.#repository.getCurrentArtistResolution(spotifyArtistId);
  }

  /**
   * Is this resolution still current enough to use, or should we look again?
   *
   * `now` is a parameter rather than a clock read, so the policy is testable without waiting
   * ninety days — and so this class stays trivially deterministic.
   */
  isFresh(resolution: { resolvedAt: string; status: string }, now: string): boolean {
    // ⚠️ An `error` is NEVER fresh. It is a fact about the network on a Tuesday, not an answer,
    // so caching it would let one transient failure suppress every retry for the whole TTL.
    //
    // Found in Build and Test: 17 artist resolutions written during a deliberate
    // unreachable-endpoint run would have been treated as valid cache entries for THIRTY DAYS.
    // The equivalent hole in the SQL sweep had already been fixed; this one had not, and only
    // running the real system surfaced it -- the live path consults `isFresh` and never reaches
    // the sweep at all.
    if (resolution.status === 'error') return false;

    const ageMs = Date.parse(now) - Date.parse(resolution.resolvedAt);
    const ttlDays =
      resolution.status === 'resolved' ? this.#resolvedTtlDays : this.#unknownTtlDays;
    return ageMs < ttlDays * 86_400_000;
  }

  /** Append a release-level version (BR-13.1). Returns its id. */
  putRelease(resolution: NewLabelResolution): number {
    return this.#repository.insertLabelResolution(resolution);
  }

  putArtist(resolution: NewArtistResolution): number {
    return this.#repository.insertArtistResolution(resolution);
  }

  /** Keys whose newest version has aged past its TTL and should be re-resolved. */
  listStale(now: string, limit: number): StaleResolution[] {
    return this.#repository.listStaleLabelResolutions(
      now,
      this.#unknownTtlDays,
      this.#resolvedTtlDays,
      limit,
    );
  }
}
