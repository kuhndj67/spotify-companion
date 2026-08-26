# Component Methods

**Date**: 2026-08-25 · **Stage**: INCEPTION — Application Design

Signatures and intent only. **Detailed business rules belong to Functional Design**, which the
execution plan runs once per delivery phase.

TypeScript notation, matching the existing codebase (ES modules, `#private` fields, `node:test`).

---

## Shared types

```ts
/** Tri-state. The absence of a value is a value (FR-32). */
type Known<T> = { known: true; value: T };
type Unknown = { known: false; reason: string };
type Maybe<T> = Known<T> | Unknown;

type PlayOutcome = 'completed' | 'skipped' | 'unknown';   // 'abandoned' retired — U1 FD Q7
type Provenance  = 'live' | 'backfilled';
type SkipSource  = 'user' | 'rule';
type LabelClass  = 'major' | 'independent' | 'unknown';
type RuleAction  = 'skip';        // enum, not boolean — Q-B seam
type Verdict     = 'match' | 'no-match' | 'unknown';
```

---

## Phase 1 — History

### `history/outcomeClassifier` ⚙️ PURE

```ts
interface Observation {
  atMs: number;            // wall clock of the poll
  trackId: string;
  progressMs: number;
  durationMs: number;
  isPlaying: boolean;
}

interface OutcomeEvidence {
  listenedMs: number;          // total listening time — sum of forward progress; re-listening adds
  durationMs: number;
  completionRatio: number;     // listenedMs / duration — MAY EXCEED 1.0. Never clamp above
  maxProgressMs: number;       // furthest point reached — evidence only
  maxObservationGapMs: number; // staleness bound — the tolerance window
  observationCount: number;
  sawPause: boolean;
  rewound: boolean;            // evidence only — does NOT affect classification
  endedWithIdle: boolean;      // 204 / device off
}
// 2026-08-25: ratio switched from position-based to listened-time. Rewinding raises the ratio by
// itself, so no rewind rule, no replay branch, and no forward-seek detection are needed.

/** Summarise a trail into the evidence the verdict rests on. */
function summarise(trail: readonly Observation[]): OutcomeEvidence;

/** The verdict. Deterministic, total, no clock. */
function classify(
  evidence: OutcomeEvidence,
  tolerance: ClassifierTolerances,
): { outcome: PlayOutcome; rationale: string };

/** FR-20: recompute historical verdicts from stored trails. */
function reclassify(
  trail: readonly Observation[],
  tolerance: ClassifierTolerances,
): { outcome: PlayOutcome; evidence: OutcomeEvidence; rationale: string };
```

**Note**: `classify` takes tolerances as an argument rather than reading config. That is what
allows a future tolerance change to be re-run over stored history without redeploying.

### `history/PlayObserver` 🔌

```ts
class PlayObserver {
  constructor(source: NowPlayingService, repo: HistoryRepository, clock?: Clock);

  start(): void;
  stop(): void;

  /** Called per tick. Segments plays; flushes on boundary. */
  #onTick(observation: Observation): void;

  /** True when the tick begins a different play (track change, or replay of the same track). */
  #isBoundary(previous: Observation | null, current: Observation): boolean;

  /** Persist the finished play plus its trail. */
  #flush(): Promise<void>;
}
```

### `history/HistoryRepository` (interface) 🔌

```ts
interface PlayRecord {
  id: number;
  trackId: string;
  isrc: Maybe<string>;          // Phase 2's join key — stored from Phase 1
  title: string;
  artistName: string;
  artistId: Maybe<string>;
  albumName: string;
  releaseDate: Maybe<string>;
  ageYears: Maybe<number>;
  following: Maybe<boolean>;
  startedAt: string;            // ISO 8601
  endedAt: string;
  outcome: PlayOutcome;
  evidence: OutcomeEvidence;
  provenance: Provenance;
  skipSource: Maybe<SkipSource>;  // FR-23; always unknown until Phase 4
  contextType: Maybe<string>;
}

interface HistoryRepository {
  recordPlay(play: Omit<PlayRecord, 'id'>, trail: readonly Observation[]): Promise<number>;
  getPlay(id: number): Promise<PlayRecord | null>;
  listPlays(filter: HistoryFilter): AsyncIterable<PlayRecord>;   // streamed for export
  getTrail(playId: number): Promise<Observation[]>;
  updateOutcome(playId: number, outcome: PlayOutcome, evidence: OutcomeEvidence): Promise<void>;
  hasPlayAt(trackId: string, startedAt: string): Promise<boolean>;  // backfill dedup
  coverage(): Promise<CoverageStats>;                                // FR-51
}
```

`listPlays` returns `AsyncIterable` deliberately — export must stream, not buffer (US-25).

### `history/migrations` 🔌

```ts
interface Migration { version: number; description: string; up(db: DatabaseSync): void; }

function currentVersion(db: DatabaseSync): number;
function migrate(db: DatabaseSync, migrations: readonly Migration[]): MigrationReport;
```

Forward-only. No `down` — NFR-12 forbids drop-and-recreate, and a reverse migration over
irreplaceable data is a trap rather than a safety net.

### `export/serialisers` ⚙️ PURE

```ts
function toCsvRows(plays: readonly PlayRecord[]): string[];
function toCsvHeader(): string;
function toJsonLines(plays: readonly PlayRecord[]): string[];

/** FR-51: unknown must never render as blank, zero, or false. */
function renderMaybe<T>(value: Maybe<T>): string;
```

---

## Phase 2 — Labels

### `musicbrainz/labelClassifier` ⚙️ PURE

```ts
type SignalName = 'curated-major-list' | 'mb-label-relationship' | 'isrc-registrant';

interface SignalVote { signal: SignalName; vote: LabelClass; detail: string; }

interface LabelClassification {
  classification: LabelClass;
  confidence: 'high' | 'medium' | 'low';
  votes: SignalVote[];      // FR-13 — disagreement preserved, not resolved away
  disagreement: boolean;
}

/** US-09: records how each signal voted, not just the verdict. */
function classifyLabel(input: {
  labelName: Maybe<string>;
  isrc: Maybe<string>;
  parentLabels: readonly string[];
}): LabelClassification;

/** `USUM71703861` -> `UM7` -> Universal. Free: no network call. */
function registrantFromIsrc(isrc: string): Maybe<string>;
```

### `musicbrainz/MusicBrainzClient` + `RequestQueue` 🔌

```ts
class RequestQueue {
  constructor(minIntervalMs: number);   // ~1100 for MusicBrainz
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

class MusicBrainzClient {
  constructor(queue: RequestQueue, userAgent: string);
  lookupByIsrc(isrc: string): Promise<Maybe<MusicBrainzLabelInfo>>;
}
```

### `musicbrainz/LabelCache` / `LabelBackfillJob` 🔌

```ts
interface LabelCache {
  get(isrc: string): Promise<LabelClassification | null>;
  put(isrc: string, result: LabelClassification): Promise<void>;
}

class LabelBackfillJob {
  /** Resolve labels for plays recorded before Phase 2, via stored ISRCs. */
  run(options: { batchSize: number; signal?: AbortSignal }): Promise<BackfillReport>;
}
```

---

## Phase 3 — Rules

### `rules/fieldCatalogue` ⚙️ PURE

```ts
type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'enum';

interface FieldDefinition {
  name: string;                       // "label.classification"
  type: FieldType;
  description: string;
  enumValues?: readonly string[];
  availability: 'always' | 'usually' | 'often-unknown';  // FR-28, surfaced to the author
  read(facts: TrackFacts): Maybe<unknown>;
}

function allFields(): readonly FieldDefinition[];
function findField(name: string): FieldDefinition | undefined;
function operatorsFor(type: FieldType): readonly Operator[];
```

`availability` exists so the Curator sees *before arming* which fields are frequently unknown —
US-17's last criterion.

### `rules/TrackFacts` ⚙️ PURE

```ts
interface TrackFacts {
  track:   { id: string; title: string; durationMs: number; explicit: Maybe<boolean>; isrc: Maybe<string> };
  artist:  { id: Maybe<string>; name: string; following: Maybe<boolean> };
  album:   { name: string; releaseDate: Maybe<string>; ageYears: Maybe<number>; type: Maybe<string> };
  label:   { name: Maybe<string>; classification: Maybe<LabelClass>; confidence: Maybe<string> };
  context: { type: Maybe<string>; deviceName: Maybe<string>; atMs: number };
  history: { playsOfTrack: Maybe<number>; skipsOfTrack: Maybe<number>;
             playsOfArtist: Maybe<number>; skipsOfArtist: Maybe<number> };
}

function assembleFacts(input: FactSources): TrackFacts;
```

History counts are `Maybe` — insufficient history yields `unknown`, **not zero** (US-16). Zero
would silently make "never skipped this" true for a track never seen.

### `rules/predicate` ⚙️ PURE

```ts
type Operator = 'eq'|'neq'|'lt'|'lte'|'gt'|'gte'|'in'|'contains'|'exists';

type Predicate =
  | { kind: 'compare'; field: string; op: Operator; value: unknown }
  | { kind: 'and'; operands: Predicate[] }
  | { kind: 'or';  operands: Predicate[] }
  | { kind: 'not'; operand: Predicate };

/** Tri-state. NEVER collapses unknown to false (NFR-25). */
function evaluate(predicate: Predicate, facts: TrackFacts): Verdict;
```

### `rules/ruleValidator` ⚙️ PURE

```ts
interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  action: RuleAction;                            // enum — Q-B seam
  onUnknown: 'no-match' | 'match' | 'hold';      // FR-33; default 'no-match'
  predicate: Predicate;
}

function validateRule(rule: unknown): ValidationResult<Rule>;
function validateRuleSet(raw: unknown): ValidationResult<Rule[]>;
```

### `rules/RuleEngine` ⚙️ PURE

```ts
interface RuleOutcome { ruleId: string; verdict: Verdict; applied: Verdict; fieldsSeen: Record<string, unknown>; }

interface Decision {
  action: RuleAction | 'none';
  matchedRuleIds: string[];
  outcomes: RuleOutcome[];
  restedOnUnknown: boolean;   // US-17 last criterion
  partialData: boolean;       // FR-35 — deadline expired before enrichment landed
}

function evaluateRules(rules: readonly Rule[], facts: TrackFacts): RuleOutcome[];

/**
 * FR-30 OR-fold, deliberately a single named function.
 * Q-B's exemption rules would replace THIS, not ripple through the engine.
 */
function foldDecisions(outcomes: readonly RuleOutcome[]): Decision;
```

### `rules/RuleStore` / `DecisionLog` / `BackTestService` 🔌

```ts
class RuleStore {
  load(): Promise<ValidationResult<Rule[]>>;   // whole file rejected on failure
  watch(onChange: (rules: Rule[]) => void): void;
  current(): readonly Rule[];
}

interface DecisionLog {
  record(entry: { playId: Maybe<number>; decision: Decision; executed: boolean;
                  dryRun: boolean; error: Maybe<string> }): Promise<void>;
  list(filter: DecisionFilter): AsyncIterable<DecisionLogEntry>;
}

class BackTestService {
  /** FR-42: replay a rule over history; deterministic, never skips anything. */
  run(rule: Rule, range: DateRange): Promise<BackTestReport>;
}

interface BackTestReport {
  evaluated: number;
  wouldMatch: number;
  unknownFieldCount: number;          // reported, not silently excluded
  agreedWithUserSkip: number;
  disagreedWithUserKeep: number;
  excludedRuleInitiated: number;      // FR-23
}
```

---

## Phase 4 — Act

### `rules/DecisionExecutor` 🔌 — the phase boundary

```ts
interface DecisionExecutor {
  execute(decision: Decision, facts: TrackFacts): Promise<ExecutionResult>;
}

/** Phase 3: the ONLY implementation. Logs; cannot act. */
class LoggingExecutor implements DecisionExecutor {}

/** Phase 4: added alongside. Consults the governor before acting. */
class SkipExecutor implements DecisionExecutor {
  constructor(governor: SafetyGovernor, playback: PlaybackController, log: DecisionLog);
}
```

### `playback/SafetyGovernor` ⚙️+🔌

```ts
interface GovernorState { enabled: boolean; recentSkipTimes: number[]; consecutiveSkips: number; skippedTrackIds: Set<string>; }

/** PURE decision — property-testable without a clock or database. */
function authoriseSkip(state: GovernorState, trackId: string, nowMs: number, limits: SafetyLimits):
  { allowed: boolean; reason: string; haltAutomation: boolean };

class SafetyGovernor {
  isEnabled(): boolean;
  kill(reason: string): Promise<void>;      // FR-38, persists across restart
  arm(): Promise<void>;
  authorise(trackId: string): Promise<AuthorisationResult>;
}
```

### `playback/PlaybackController` 🔌

```ts
class PlaybackController {
  /** FR-46/48: skip, then confirm it took effect. */
  skipToNext(expectedTrackId: string): Promise<{ skipped: boolean; confirmed: boolean; detail: string }>;
}
```

---

## Method-level design notes

Four signatures encode decisions that would otherwise be lost in implementation:

1. **`classify` takes tolerances as a parameter.** Reading them from config would make FR-20's
   recomputation depend on deployment state rather than stored data.
2. **`listPlays` returns `AsyncIterable`.** Export streams; a year of history must not be
   buffered in memory.
3. **History counts in `TrackFacts` are `Maybe`, not `number`.** Zero and unknown are different
   claims, and conflating them makes "never skipped" true for unseen tracks.
4. **`foldDecisions` is separate from `evaluateRules`.** The OR-fold is the seam Q-B named; keeping
   it standalone is what makes exemption rules a replacement rather than a rewrite.
