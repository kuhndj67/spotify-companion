/**
 * Forward-only schema migration (NFR-12).
 *
 * ## Why forward-only
 *
 * There are no `down` migrations. Reversing a migration over irreplaceable data is a trap
 * dressed as a safety net: the rollback that looks reassuring in a code review is the one that
 * deletes months of listening history when someone runs it by mistake.
 *
 * ## Why migrations exist from day one
 *
 * The schema grows per phase (Application Design Q4 = B): U2 adds label columns, U5 adds rule
 * attribution. Exercising the migration path from U1 means it is proven before U2's backfill
 * depends on it, rather than first attempted under pressure against real accumulated data.
 *
 * ## Migration 001 creates exactly what U1 needs and nothing more
 *
 * No speculative label or rule columns sitting null. Each phase's schema is informed by what the
 * previous one taught.
 */

import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  description: string;
  up(db: DatabaseSync): void;
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'listening history: play, observation, gap counter',
    up(db) {
      db.exec(`
        CREATE TABLE play (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id             TEXT    NOT NULL,
          isrc                 TEXT,
          title                TEXT    NOT NULL,
          artist_name          TEXT    NOT NULL,
          artist_id            TEXT,
          album_name           TEXT    NOT NULL,
          release_date         TEXT,
          age_years            INTEGER,
          following            INTEGER,
          started_at           TEXT    NOT NULL,
          ended_at             TEXT    NOT NULL,
          outcome              TEXT    NOT NULL
                                 CHECK (outcome IN ('completed','skipped','unknown')),
          close_reason         TEXT    NOT NULL,
          provenance           TEXT    NOT NULL
                                 CHECK (provenance IN ('live','backfilled')),
          skip_source          TEXT    CHECK (skip_source IN ('user','rule')),
          context_type         TEXT,
          classifier_version   INTEGER NOT NULL,
          ev_listened_ms       INTEGER NOT NULL,
          ev_duration_ms       INTEGER NOT NULL,
          ev_completion_ratio  REAL    NOT NULL,
          ev_max_progress_ms   INTEGER NOT NULL,
          ev_max_gap_ms        INTEGER NOT NULL,
          ev_observation_count INTEGER NOT NULL,
          ev_saw_pause         INTEGER NOT NULL,
          ev_rewound           INTEGER NOT NULL,
          ev_ended_with_idle   INTEGER NOT NULL
        );

        CREATE TABLE observation (
          play_id     INTEGER NOT NULL REFERENCES play(id) ON DELETE CASCADE,
          sequence    INTEGER NOT NULL,
          at_ms       INTEGER NOT NULL,
          progress_ms INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          is_playing  INTEGER NOT NULL,
          PRIMARY KEY (play_id, sequence)
        );

        CREATE INDEX idx_play_started ON play(started_at);
        CREATE INDEX idx_play_track   ON play(track_id);
        CREATE INDEX idx_play_isrc    ON play(isrc);
        CREATE INDEX idx_play_outcome ON play(outcome);

        CREATE TABLE recording_gap (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          occurred_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    description: 'label enrichment: versioned resolutions, liked evidence',
    up(db) {
      db.exec(`
        -- ============================================================================
        -- Cached MusicBrainz facts. APPEND-ONLY (BR-13.1).
        --
        -- Re-resolving inserts a NEW ROW rather than replacing the old one, because two
        -- different things are both called "the data changed":
        --
        --   our knowledge changed  a volunteer catalogued a release we could not see
        --                          -> the old verdict was WRONG, prefer the new one
        --   the world changed      the artist signed to a major
        --                          -> the old verdict was RIGHT FOR ITS TIME, keep it
        --
        -- MusicBrainz cannot tell you which occurred: a lookup that 404'd in August and
        -- returns Atlantic in January is byte-identical either way. So both readings are
        -- kept and the choice is made per level at analysis time (BR-13.6).
        -- ============================================================================

        CREATE TABLE label_resolution (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          isrc           TEXT    NOT NULL,
          recording_mbid TEXT,
          match_method   TEXT    NOT NULL
                           CHECK (match_method IN ('isrc','search','none')),
          narrowing_tier TEXT    NOT NULL
                           CHECK (narrowing_tier IN ('title-date','title','all','none')),
          release_count  INTEGER NOT NULL DEFAULT 0,
          resolved_at    TEXT    NOT NULL,
          status         TEXT    NOT NULL
                           CHECK (status IN ('resolved','not-found','error')),
          supersedes_id  INTEGER REFERENCES label_resolution(id),
          -- Idempotence guard for BR-8.6: a backfill re-run that resolved the same ISRC
          -- twice in the same instant would otherwise silently double the candidate set.
          UNIQUE (isrc, resolved_at)
        );

        -- Candidates key to the RESOLUTION VERSION, never to the ISRC (BR-13.2). Keyed to
        -- the ISRC they would accumulate across every resolution, and BR-8.7's
        -- reclassification would fold 2026 facts together with 2027 facts and vote on the
        -- union -- a verdict derived from a world-state that never existed at any moment.
        CREATE TABLE label_candidate (
          resolution_id  INTEGER NOT NULL
                           REFERENCES label_resolution(id) ON DELETE CASCADE,
          label_name     TEXT    NOT NULL,
          label_mbid     TEXT,
          label_type     TEXT,
          catalog_number TEXT,
          release_id     TEXT    NOT NULL,
          release_title  TEXT,
          release_date   TEXT,
          release_status TEXT
        );

        CREATE TABLE artist_label_resolution (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          spotify_artist_id TEXT    NOT NULL,
          artist_mbid       TEXT,
          release_count     INTEGER NOT NULL DEFAULT 0,
          named_label_count INTEGER NOT NULL DEFAULT 0,
          resolved_at       TEXT    NOT NULL,
          status            TEXT    NOT NULL
                              CHECK (status IN ('resolved','not-found','error')),
          supersedes_id     INTEGER REFERENCES artist_label_resolution(id),
          UNIQUE (spotify_artist_id, resolved_at)
        );

        CREATE TABLE artist_label (
          resolution_id INTEGER NOT NULL
                          REFERENCES artist_label_resolution(id) ON DELETE CASCADE,
          label_name    TEXT    NOT NULL,
          label_mbid    TEXT,
          label_type    TEXT,
          release_count INTEGER NOT NULL DEFAULT 0
        );

        -- Votes are split by scope rather than carrying a scope column, because once they key
        -- to a resolution_id a single column would have to point into TWO tables. SQLite
        -- cannot express a polymorphic foreign key and therefore cannot enforce it; six
        -- columns of duplication buys a real REFERENCES with cascade on both.
        CREATE TABLE label_signal_vote (
          resolution_id INTEGER NOT NULL
                          REFERENCES label_resolution(id) ON DELETE CASCADE,
          signal        TEXT    NOT NULL
                          CHECK (signal IN ('major-root-list','label-relationship','isrc-prefix')),
          verdict       TEXT    NOT NULL
                          CHECK (verdict IN ('major','independent','unknown')),
          strength      TEXT    NOT NULL CHECK (strength IN ('strong','weak')),
          evidence      TEXT
        );

        CREATE TABLE artist_label_signal_vote (
          resolution_id INTEGER NOT NULL
                          REFERENCES artist_label_resolution(id) ON DELETE CASCADE,
          signal        TEXT    NOT NULL
                          CHECK (signal IN ('major-root-list','label-relationship','isrc-prefix')),
          verdict       TEXT    NOT NULL
                          CHECK (verdict IN ('major','independent','unknown')),
          strength      TEXT    NOT NULL CHECK (strength IN ('strong','weak')),
          evidence      TEXT
        );

        -- ============================================================================
        -- The derived snapshot on the play: AS-OF-PLAY, immutable once written (BR-8.4a).
        --
        -- Every column is nullable and NULL means UNKNOWN -- never false, never 0, end to
        -- end including exports, where it renders as the literal token "unknown". Missing
        -- data here is correlated with the variable being measured (R2), so a blank that
        -- reads as "no" would manufacture the finding.
        -- ============================================================================

        ALTER TABLE play ADD COLUMN label_verdict TEXT
          CHECK (label_verdict IN ('major','independent','unknown'));
        ALTER TABLE play ADD COLUMN label_confidence TEXT
          CHECK (label_confidence IN ('high','medium','low'));
        ALTER TABLE play ADD COLUMN label_contested INTEGER;
        ALTER TABLE play ADD COLUMN label_names TEXT;
        ALTER TABLE play ADD COLUMN label_match_method TEXT;
        ALTER TABLE play ADD COLUMN label_narrowing_tier TEXT;
        ALTER TABLE play ADD COLUMN label_unknown_reason TEXT;
        ALTER TABLE play ADD COLUMN artist_label_verdict TEXT
          CHECK (artist_label_verdict IN ('major','independent','unknown'));
        ALTER TABLE play ADD COLUMN artist_label_confidence TEXT
          CHECK (artist_label_confidence IN ('high','medium','low'));
        ALTER TABLE play ADD COLUMN artist_label_names TEXT;
        ALTER TABLE play ADD COLUMN label_classifier_version INTEGER;

        -- Pointers to the EXACT versions the verdict came from (BR-13.4). These replace the
        -- label_resolved_at timestamp proposed at NFR Design: a pointer is strictly more
        -- informative and cannot drift out of step with the row it describes. They are also
        -- what lets BR-12's trace reconstruct the derivation from the candidates that
        -- version actually held, rather than from whatever the current ones happen to be.
        ALTER TABLE play ADD COLUMN label_resolution_id INTEGER
          REFERENCES label_resolution(id);
        ALTER TABLE play ADD COLUMN artist_label_resolution_id INTEGER
          REFERENCES artist_label_resolution(id);

        -- Liked evidence. NULL means unknown and NEVER false: the saved-track set can be
        -- unavailable, and a false written in its place would read as an observed choice
        -- and is unrecoverable (BR-9.5).
        ALTER TABLE play ADD COLUMN liked_at_start INTEGER;
        ALTER TABLE play ADD COLUMN liked_at_end INTEGER;
        ALTER TABLE play ADD COLUMN liked_added_at TEXT;
        ALTER TABLE play ADD COLUMN liked_transition TEXT
          CHECK (liked_transition IN
            ('liked-during','unliked-during','kept-liked','kept-unliked','unknown'));

        -- The current version for a key is ORDER BY resolved_at DESC LIMIT 1 (BR-13.3).
        -- There is deliberately NO is_current flag: a maintained flag has to be updated on
        -- every insert, and its failure mode is two rows both claiming to be current, which
        -- reads as valid data. A query cannot go stale.
        CREATE INDEX idx_label_resolution_key
          ON label_resolution(isrc, resolved_at DESC);
        CREATE INDEX idx_artist_resolution_key
          ON artist_label_resolution(spotify_artist_id, resolved_at DESC);
        CREATE INDEX idx_label_candidate_res ON label_candidate(resolution_id);
        CREATE INDEX idx_artist_label_res    ON artist_label(resolution_id);
        CREATE INDEX idx_label_vote_res      ON label_signal_vote(resolution_id);
        CREATE INDEX idx_artist_vote_res     ON artist_label_signal_vote(resolution_id);
        CREATE INDEX idx_play_label_verdict  ON play(label_verdict);
        CREATE INDEX idx_play_artist_id      ON play(artist_id);
      `);
    },
  },
  {
    version: 3,
    description: 'artist genres from MusicBrainz (Spotify no longer supplies them)',
    up(db) {
      db.exec(`
        -- Spotify's GET /artists/{id} returns NO genres field at all -- one of this project's
        -- four documentation-vs-reality catches. MusicBrainz has them, and we are already
        -- talking to it for labels, so a genre is one extra request per distinct artist per
        -- TTL window rather than a new integration.
        --
        -- Stored as a JSON array of {name, count}. The count is MusicBrainz's vote tally, kept
        -- rather than discarded because it separates "four people agree this is hard rock"
        -- from one person's opinion -- and because U3's rules will want to threshold on it.
        --
        -- NULL means unknown, as everywhere else. An empty array means "we asked and there are
        -- none", which is a different fact.
        ALTER TABLE artist_label_resolution ADD COLUMN genres TEXT;

        -- The as-of-play snapshot, same immutability rule as the label columns (BR-8.4a).
        ALTER TABLE play ADD COLUMN artist_genres TEXT;
      `);
    },
  },
  {
    version: 4,
    description: 'artist level is genres only; the artist-label verdict and its evidence are gone',
    up(db) {
      db.exec(`
        -- ============================================================================
        -- Removing the artist-level LABEL verdict. Genres stay; they are why the artist
        -- level still exists at all.
        --
        -- The verdict was classified over \`browse /release?artist=<mbid>\`, and that browse
        -- returns every release the artist appears on INCLUDING ONES THEY ONLY FEATURE ON.
        -- Probed live 2026-09-06 on Bad Bunny: 201 official releases, of which 92 are his
        -- and 109 are other artists' records he guests on. 49 of the 64 distinct label
        -- names were reachable ONLY through a guest credit -- Atlantic from Cardi B's
        -- \`I Like It\`, El Cartel from Daddy Yankee's \`Dura (remix)\`, Capitol, RCA, Sony,
        -- Kemosabe, Mad Decent. None of them are his deal.
        --
        -- Because BR-4.3's fold makes ONE strong \`major\` vote decisive, this made every
        -- collaborative artist read \`major\`. That is not noise in the outcome variable, it
        -- is bias in the INDEPENDENT one, and it points the way that would mask R1 -- the
        -- feature-heavy end of the catalogue is exactly where the independents are. On the
        -- panel it showed as 42 label names beside a track released on Rimas.
        --
        -- A second defect rode along: the browse was \`limit=100\` with no paging, and
        -- \`release_count\` recorded that 100 as though it were a total. Bad Bunny has 205;
        -- page 2 alone held 20 labels page 1 never saw. 18 of 56 stored resolutions sat
        -- exactly at 100. Same family as the denominator traps -- an arbitrary sample
        -- written down as a complete count, with nothing marking it truncated.
        --
        -- Neither defect touches the RELEASE level, which narrows through the ISRC to the
        -- specific pressing and answers the actual question: what label was this track
        -- released under. There is no second label question worth two requests, so the
        -- browse is deleted rather than filtered (Q12 is withdrawn, not amended).
        --
        -- The rows go rather than being left in place. They are derived, not observed --
        -- regenerable in principle from MusicBrainz, unlike a play record -- and a wrong
        -- verdict left in a research database is a liability: it reads as a finding.
        -- ============================================================================

        DROP TABLE artist_label;
        DROP TABLE artist_label_signal_vote;

        ALTER TABLE play DROP COLUMN artist_label_verdict;
        ALTER TABLE play DROP COLUMN artist_label_confidence;
        ALTER TABLE play DROP COLUMN artist_label_names;

        ALTER TABLE artist_label_resolution DROP COLUMN release_count;
        ALTER TABLE artist_label_resolution DROP COLUMN named_label_count;

        -- Renamed, not kept: a table called artist_label_resolution holding only genres is
        -- the kind of name someone later reads as evidence that a verdict exists somewhere.
        -- SQLite rewrites play's foreign key to follow the rename (probed, plus
        -- foreign_key_check).
        ALTER TABLE play RENAME COLUMN artist_label_resolution_id TO artist_resolution_id;
        ALTER TABLE artist_label_resolution RENAME TO artist_resolution;
      `);
    },
  },
  {
    version: 5,
    description: 'decision log, the two play columns rules read, and the schema-era watermark',
    up(db) {
      db.exec(`
        -- ============================================================================
        -- U4. Purely additive: two CREATE TABLEs, three indexes, two ADD COLUMNs and one
        -- row. ADD COLUMN with no default is an O(1) metadata operation in SQLite, so the
        -- corpus size is irrelevant. Rollback to U3's image stays safe -- migrate() skips
        -- every migration <= the stored version, so the old image simply never reads any
        -- of this. THAT GUARANTEE HOLDS ONLY WHILE MIGRATIONS STAY ADDITIVE.
        -- ============================================================================

        -- One row per RULE EVALUATED, not per decision (BR-23.1). Ten rules writes ten
        -- rows sharing an evaluation_id, which is what lets the log answer "why did my
        -- rule NOT fire?" -- a question a matched-only log cannot answer at all.
        CREATE TABLE decision_log (
          id                     INTEGER PRIMARY KEY AUTOINCREMENT,
          evaluation_id          TEXT    NOT NULL,
          decided_at             TEXT    NOT NULL,

          -- NULLABLE AND STAYS NULLABLE (BR-24.1). A decision is taken DURING a play; the
          -- play row is written when the play CLOSES, seconds to minutes later. NOT NULL
          -- would force a decision to wait for its own consequence.
          play_id                INTEGER REFERENCES play(id),

          -- Why play_id is absent (BR-24.3a). Without this column a permanent NULL means
          -- two incompatible things: "the play never closed" (a W-3 case, expected) and
          -- "the play closed but its row failed to write" (a fault, on the one artefact
          -- here that cannot be regenerated). PlayObserver fires onPlayRecorded only after
          -- recordPlay succeeds, so the second case is silent by construction.
          play_link              TEXT    NOT NULL DEFAULT 'pending',

          -- Recorded independently of play_id, so a decision stays attributable even when
          -- the link never arrives.
          track_id               TEXT    NOT NULL,

          rule_id                TEXT    NOT NULL,
          -- Denormalised on purpose (BR-23.6): a renamed or deleted rule must not orphan
          -- its own history, and a stored decision that disagrees with a recomputation is
          -- attributable to an edit rather than unexplainable.
          rule_name              TEXT    NOT NULL,
          rule_hash              TEXT    NOT NULL,

          verdict                TEXT    NOT NULL,
          matched                INTEGER NOT NULL,

          -- JSON. Nulls are written EXPLICITLY, never by omission (BR-23.4): a field the
          -- rule demonstrably read must not vanish from its own record.
          fields_seen            TEXT    NOT NULL,
          unknown_fields         TEXT    NOT NULL,

          rested_on_unknown      INTEGER NOT NULL,
          partial_data           INTEGER NOT NULL,

          -- Always 1 / 0 / NULL in U4 (BR-23.8). The columns exist now so U5 changes
          -- behaviour rather than the schema.
          dry_run                INTEGER NOT NULL,
          executed               INTEGER NOT NULL,
          error                  TEXT,

          engine_version         INTEGER NOT NULL,
          -- For the UI only. It RESETS TO 1 ON RESTART (BR-26.8), so on a permanent table
          -- a repeating small integer identifies nothing.
          rule_set_version       INTEGER NOT NULL,
          -- What actually attributes this row to a rule set across restarts (BR-23.7a).
          rule_set_content_hash  TEXT    NOT NULL
        );

        -- NO UNIQUE CONSTRAINT ANYWHERE ABOVE, AND THAT IS DELIBERATE (BR-22.1a).
        -- BR-22.1's one-decision-per-play is a U4 invariant, enforced by the coordinator's
        -- \`decided\` flag and tested there. FR-34 is a Must and requires re-evaluation when
        -- slow enrichment lands, so U5 will write a second decision for one play
        -- legitimately. A constraint added here would have to be DROPPED then -- a
        -- non-additive migration, which would retire the by-image rollback guarantee above.

        CREATE INDEX idx_decision_decided_at ON decision_log(decided_at);
        CREATE INDEX idx_decision_evaluation ON decision_log(evaluation_id);
        CREATE INDEX idx_decision_play       ON decision_log(play_id);

        -- ----------------------------------------------------------------------------
        -- Two fields the app already pays for and was throwing away. Both come back from
        -- the GET /tracks/{id} call made for every enriched track, and both are on
        -- recently-played too (probed 2026-09-20: HTTP 200, present on 3/3 items), so
        -- persisting them costs ZERO additional upstream requests.
        --
        -- Nullable, and NULL is never false. Three different causes reach this column as
        -- NULL: the row predates this migration (unanswerable), the fetch failed
        -- (unknown), or enrichment had not landed (unknown). Only the first is decided by
        -- the watermark below.
        -- ----------------------------------------------------------------------------
        ALTER TABLE play ADD COLUMN explicit   INTEGER;
        ALTER TABLE play ADD COLUMN album_type TEXT;

        -- ----------------------------------------------------------------------------
        -- The schema-era watermark (BR-31.7). There is no key/value table in this database
        -- -- schema_version(version, applied_at) is the only metadata table and it is
        -- append-only history of the migrations themselves, so overloading it would make
        -- migrate()'s own bookkeeping a place application code writes.
        --
        -- IT IS A ROW ID, NOT A DATE, AND THAT IS THE POINT (BR-27.5c). The 6-hourly
        -- backfill inserts rows dated in the PAST, so a row written after this migration
        -- for a play that happened before it genuinely carries both new values. Judging
        -- era by started_at would mark that real data unanswerable; judging by id answers
        -- correctly. Written in this same transaction, so a rolled-back 005 cannot leave a
        -- watermark behind for columns that do not exist.
        -- ----------------------------------------------------------------------------
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

        INSERT INTO meta (key, value)
          SELECT 'v5_watermark_play_id', CAST(COALESCE(MAX(id), 0) AS TEXT) FROM play;
      `);
    },
  },
  {
    version: 6,
    description: 'skip attribution: who ended a skipped play, and the evidence for it',
    up(db) {
      db.exec(`
        -- ============================================================================
        -- WHY THIS IS A NEW COLUMN RATHER THAN A NEW skip_source VALUE
        --
        -- The obvious change is to let skip_source hold a third value. It cannot:
        --
        --     skip_source TEXT CHECK (skip_source IN ('user','rule'))
        --
        -- SQLite has no ALTER TABLE ... DROP CONSTRAINT, so widening that CHECK means
        -- rebuilding \`play\` through the 12-step procedure -- on the one table in this
        -- project that cannot be regenerated, and it would make this migration
        -- NON-ADDITIVE, retiring the by-image rollback guarantee that migration 005
        -- still enjoys. Two ADD COLUMNs buy the same semantics for none of that risk.
        --
        -- Overloading NULL was the other tempting option and is worse: skip_source is
        -- NULL today for "this play was not a skip". Making it also mean "a skip by
        -- an unknown actor" merges two facts into one value, which is the exact defect
        -- this whole column exists to correct.
        --
        -- ⚠️ skip_source IS NOT BACKFILLED AND IS NOT CORRECTED. It keeps saying 'user'
        -- on every historical skip, because that is what the app asserted at the time and
        -- rewriting it would destroy the evidence that the assertion was ever made.
        -- skip_attribution is the answer; skip_source is the claim.
        -- ============================================================================

        -- 'user' | 'unattributed'. NULL when the play was not a skip, exactly as
        -- skip_source has always been NULL for a non-skip.
        --
        -- 'unattributed' says NOT THE LISTENER and deliberately names no cause. Crossfade
        -- is ruled out (Spotify caps it at 12s; these lose 21-41s) and wrong duration
        -- metadata is ruled out (the same tracks reach full length on other plays). What
        -- remains is indicated but unproven, and a column value is the wrong place to
        -- record a guess.
        ALTER TABLE play ADD COLUMN skip_attribution TEXT;

        -- How far into the NEXT track the app was when it first observed it, in ms.
        -- Corroborating evidence, recorded and never fed back into the attribution --
        -- one hand-checked play sat at ratio 0.858 with a successor lag of only 2s, so
        -- requiring both signals would have mis-attributed it.
        --
        -- NULL means not measured (no successor yet, or a pre-v6 row), NEVER zero.
        ALTER TABLE play ADD COLUMN successor_lag_ms INTEGER;

        -- The attribution is derived, so a partially-reattributed corpus must be
        -- distinguishable from a consistent one -- the same reason classifier_version
        -- exists for the outcome. Without it, "these rows say user because the listener
        -- skipped them" and "these rows say user because nothing has looked yet" are
        -- indistinguishable.
        ALTER TABLE play ADD COLUMN attribution_version INTEGER;

        CREATE INDEX idx_play_skip_attribution ON play(skip_attribution);
      `);
    },
  },
  {
    version: 7,
    description: 'U5 automated skipping: skip attempts, re-evaluation trigger, context uri',
    up(db) {
      db.exec(`
        -- ============================================================================
        -- ADDITIVE ONLY, AND THAT IS THE ROLLBACK GUARANTEE (BR-37.4)
        --
        -- \`migrate()\` skips every migration whose version is at or below current, so
        -- U4's image against a v7 database finds nothing to apply, reports from:7 to:7
        -- and runs normally -- the new table and columns simply go unread. That is the
        -- recovery path if U5 misbehaves, and U5 is the only unit that can interrupt
        -- the music.
        --
        -- ⚠️ The guarantee holds ONLY while migrations stay additive. One that REWRITES
        -- or DROPS breaks it SILENTLY: the old image starts happily against data it can
        -- no longer interpret. This is also why skip_attribution is nulled rather than
        -- dropped -- do not tidy it.
        -- ============================================================================

        -- ----------------------------------------------------------------------------
        -- decision_log.trigger -- which evaluation pass wrote the row (BR-37.3)
        --
        -- U4 took exactly ONE decision per play (BR-22.1). FR-34 requires a second pass
        -- when slow enrichment lands, so rows now need to say which pass produced them.
        --
        -- ⚠️ THE 909 EXISTING ROWS ARE 'initial' BY CONSTRUCTION, and the DEFAULT is what
        -- supplies that -- not an UPDATE. Probed 2026-10-02: ALTER TABLE ... ADD COLUMN
        -- NOT NULL DEFAULT backfills existing rows in SQLite, leaving zero nulls. An
        -- UPDATE would be a judgement ABOUT those rows; the default is a statement about
        -- what the code that wrote them could possibly have meant.
        --
        -- ⚠️ \`trigger\` IS A SQLITE KEYWORD (CREATE TRIGGER), and using it as a column name
        -- is the kind of thing that fails in one position and works in four others. Probed
        -- 2026-10-02 rather than assumed: unquoted ADD COLUMN, SELECT, INSERT and WHERE all
        -- work. No quoting is needed, and adding some would only hide the question.
        --
        -- ⚠️ NO UNIQUE CONSTRAINT IS ADDED HERE OR ANYWHERE BELOW (BR-22.1a, BR-37.2).
        -- One-decision-per-play was scoped to U4 and enforced by a flag, never by the
        -- schema, precisely so this migration could stay additive. A UNIQUE index on
        -- (play_id, rule_id) is the obvious way to express the old rule and would make
        -- rollback impossible.
        -- ----------------------------------------------------------------------------
        ALTER TABLE decision_log ADD COLUMN trigger TEXT NOT NULL DEFAULT 'initial';

        -- ----------------------------------------------------------------------------
        -- play.context_uri -- ONE column, not two (BR-41.1, corrected 2026-10-02)
        --
        -- ⚠️ context_type ALREADY EXISTS. It has been in the schema since v1 (see the
        -- CREATE TABLE play above), is already read and written, and is already populated
        -- on backfilled rows -- measured 2026-10-02: 86 'playlist', 2 'artist', and NULL on
        -- all 765 live plays. Re-adding it would fail the ALTER, abort this migration inside
        -- its own transaction, and leave the app running DISPLAY-ONLY (NFR-13) with the page
        -- loading and nothing being recorded.
        --
        -- What U5 adds is POPULATING BOTH ON LIVE PLAYS. recently-played carries context;
        -- the MCP getNowPlaying the poll loop reads does not (BR-41.2) -- so the field was
        -- available exactly where the outcome variable was not.
        --
        -- ⚠️ EVIDENCE ONLY. No rule field is exposed over context in U5, and that is a rule
        -- rather than a preference (BR-41.3/41.5): context_uri GOES STALE -- it kept naming
        -- an album through 33 minutes of autoplay by other artists -- so a rule over it would
        -- classify algorithmic placement as album playback, which is wrong in the direction
        -- that HIDES what R1 is about.
        --
        -- Existing rows stay NULL. NULL is unknown and is never backfilled with a guess, and
        -- recently-played cannot supply it for a play it has aged out of (a 50-play window).
        -- ----------------------------------------------------------------------------
        ALTER TABLE play ADD COLUMN context_uri TEXT;

        -- ----------------------------------------------------------------------------
        -- skip_attempt -- the action, as a record rather than a side effect
        --
        -- ⚠️ A TABLE, NOT COLUMNS ON play. A play may have an attempt that was REFUSED, and
        -- that must be distinguishable from a play never attempted (BR-36.3). Columns on
        -- play would force one row's worth of state into the play and lose the refusal.
        --
        -- ⚠️ EVERY COLUMN THAT CAN SAY "nothing happened" SAYS WHY. refused_reason is a
        -- first-class column because fired_at IS NULL has several causes -- some correct
        -- behaviour, some defects -- and cannot distinguish them. This is U4's play_link
        -- lesson at higher stakes: "why is this absent" must never be inferred from the
        -- absence itself.
        --
        -- ⚠️ NO retry column, and no attempt counter. Surface, do not retry (FR-48,
        -- BR-36.4): one attempt is the budget per PLAY ROW, and a failed attempt does not
        -- earn another. There is deliberately nothing here to increment.
        -- ----------------------------------------------------------------------------
        CREATE TABLE skip_attempt (
          id                           INTEGER PRIMARY KEY AUTOINCREMENT,

          -- The decision this acts on. Joins to decision_log(evaluation_id).
          evaluation_id                TEXT    NOT NULL,

          -- ⚠️ NOT NULL, unlike decision_log.play_id. An attempt without a play has
          -- nothing to be one-per (BR-36.1), so the guard would be unenforceable.
          --
          -- ⚠️ And the guard is keyed on THE PLAY, never on track_id (BR-36.2). A recurring
          -- track is a NEW play and stays fully skippable -- suppressing it would be the
          -- same class of error as clamping completionRatio to 1.0: hygiene that destroys
          -- signal. FR-40's original "never skip the same track twice in a session" was
          -- WITHDRAWN for exactly this reason.
          play_id                      INTEGER NOT NULL,

          -- The track the RULE MATCHED -- not necessarily what was playing when the drain
          -- ran. The difference is the evidence columns below.
          track_id                     TEXT    NOT NULL,
          rule_id                      TEXT    NOT NULL,

          -- queued | cancelled | refused | fired | confirmed | unconfirmed
          --
          -- ⚠️ No CHECK constraint, and that is deliberate rather than an omission: SQLite
          -- has no ALTER TABLE DROP CONSTRAINT, so a CHECK here would have to be widened by
          -- rebuilding the table -- making a future migration NON-ADDITIVE and retiring the
          -- rollback guarantee. Migration 006 recorded the same reasoning for skip_source.
          -- The union is enforced in TypeScript, where it is also exhaustively switched.
          state                        TEXT    NOT NULL,

          enqueued_at                  TEXT    NOT NULL,

          -- When the POST was issued. NULL while queued, or if it never fired.
          fired_at                     TEXT,

          -- ⚠️ WHY nothing happened. Never inferred from fired_at being NULL.
          refused_reason               TEXT,

          -- Evidence: what the API reported immediately before and after the POST (BR-43.2),
          -- so the BR-43.3 confirmation is auditable after the fact rather than only live.
          --
          -- ⚠️ These exist because no fixed timing offset may be assumed (P-34). Probe
          -- P-U5-1 found the AI DJ has at least three transition behaviours and that one of
          -- them has a NEGATIVE audio lag -- so even the sign varies, and nothing in the API
          -- predicts which is coming. Stored observations let the judgement be recomputed;
          -- a stored verdict alone could not be.
          reported_track_id_before     TEXT,
          reported_progress_ms_before  INTEGER,
          reported_track_id_after      TEXT,
          reported_progress_ms_after   INTEGER,

          FOREIGN KEY (play_id) REFERENCES play(id)
        );

        -- BR-36.1's one-attempt-per-play lookup, on every drain.
        CREATE INDEX idx_skip_attempt_play ON skip_attempt(play_id);

        -- BR-35.2's rolling-hour window, and the startup sweep for surviving 'queued' rows.
        CREATE INDEX idx_skip_attempt_enqueued ON skip_attempt(enqueued_at);

        -- Joining an attempt back to the decision that caused it (FR-41).
        CREATE INDEX idx_skip_attempt_evaluation ON skip_attempt(evaluation_id);
      `);
    },
  },
];

/**
 * `idx_play_isrc` is created here, before U2 exists, deliberately. The label backfill scans for
 * plays that have an ISRC and no label; without the index that is a full table scan over a
 * growing table, repeated for every batch.
 */

export function currentVersion(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

/**
 * Apply pending migrations in order.
 *
 * Called at startup **before** anything subscribes to the tick stream. A half-migrated schema
 * must never accept writes — the resulting rows would be structurally wrong in a way that is hard
 * to detect and impossible to undo, so refusing to write is correct even though it means running
 * degraded.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
  nowIso: string = new Date().toISOString(),
): MigrationReport {
  const from = currentVersion(db);
  const applied: string[] = [];

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;

    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        nowIso,
      );
      db.exec('COMMIT');
      applied.push(`${migration.version}: ${migration.description}`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.version} (${migration.description}) failed: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return { from, to: currentVersion(db), applied };
}
